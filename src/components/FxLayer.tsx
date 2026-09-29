import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { createPortal } from "react-dom";
import type { CardFace } from "../lib/game";
import { houseColor } from "../lib/houses";
import type { FxDirector, FxPlan, FxSide, FxSource } from "../lib/fx";

// Diretor de FX (docs/ANIMATIONS_PLAN.md §0.3): portal no <body> com
// pointer-events: none, como o zoom/lightbox do CardArt — o board tem
// overflow: hidden e cortaria qualquer coisa que voe.
//
// O React só é dono do host vazio: todo visual nasce e morre imperativamente no
// cancelAll(), então nenhum destaque transitório passa por props e nenhum memo
// do board é invalidado. A coreografia vive no CSS (classes fx-*); o JS só
// mede, posiciona e passa a geometria em custom properties.
//
// Uma revelação por vez (um run cancela a anterior), então o trabalho pendente
// cabe num único slot — nada de Sets.

/** Etapas do voo em ms (plano §2): apresentação, hold e assentamento/dissolve. */
const PRESENT_MS = 260;
const SLAM_MS = 270;
const DISSOLVE_MS = 260;
/** Ação sem voo (colher, lutar): o pulso de quem age + a gema, no mesmo tempo
    do beat da IA (plano §3, reap ≈ 700ms). Também cobre o fade de .fx-gone. */
const ACTION_MS = 620;
/** Largura da carta em cena: ~1,6× a da mão no desktop (plano §2-B). */
const STAGE_WIDTH = 160;

// O clone refaz o load da arte: `lazy` (o valor dos tiles) adiaria a pintura do
// ghost por alguns frames — eager entra imediato, e o cache do browser responde.
const cloneEl = (el: Element | null) => {
  const clone = el ? (el.cloneNode(true) as HTMLElement) : null;
  clone?.querySelector("img")?.setAttribute("loading", "eager");
  return clone;
};
const byIid = (id: string) => document.querySelector<HTMLElement>(`[data-iid="${id}"]`);

/** O Warden joga da mão (fora do DOM) e a Ação não ganha slot: sem clone, o
    ghost nasce da face — imagem quando há arte; senão o fallback textual, como
    o CardImage (FX-02). */
function faceEl(face: CardFace): HTMLElement {
  const art = document.createElement("div");
  art.className = "card-art";
  art.style.setProperty("--house-color", houseColor(face.house));
  const fallback = () => {
    art.classList.add("card-fallback");
    const title = document.createElement("strong");
    title.textContent = face.title;
    art.appendChild(title);
  };
  if (face.image) {
    const img = document.createElement("img");
    img.src = face.image;
    img.alt = face.title;
    img.decoding = "async";
    img.draggable = false;
    img.onerror = () => {
      img.remove();
      fallback();
    };
    art.appendChild(img);
  } else fallback();
  return art;
}

/** Captura PRÉ-commit (plano §0.4): o DOM de que a revelação precisa muda ou
    desaparece no setGame, então a origem do voo é medida e clonada antes. Só
    leituras de DOM — nada de estado.
    H3D-08: a pose do leque vive na TILE (o art é filho e `rotate`/`scale` não
    são herdados), e a caixa projetada de uma carta girada é maior que a carta.
    Aí valem o tamanho de layout do art (× o `scale` da tile) e a rotação da
    tile, para o ghost nascer do tamanho da CARTA e alinhado ao leque. No 2D
    nenhuma das duas propriedades é usada (a pose 2D é `transform`), então o
    objeto sai exatamente como sempre saiu. */
export function captureFx(id: string | undefined, side: FxSide): FxSource | undefined {
  const tile = id ? byIid(id) : null;
  const art = tile?.querySelector(".card-art") ?? null;
  // A mão do Warden não está no DOM: a origem é o avatar do band dele.
  const el = art ?? tile ?? document.querySelector(`[data-side="${side}"] .player-avatar`);
  if (!(el instanceof HTMLElement)) return undefined;
  const rect = el.getBoundingClientRect();
  const owner = tile ?? el;
  const ownerCs = getComputedStyle(owner);
  const rot = ownerCs.rotate;
  const scale = parseFloat(ownerCs.scale) || 1;
  const turned = Boolean(rot && rot !== "none");
  if (!turned && scale === 1) return { rect, node: cloneEl(art) };
  return {
    rect,
    node: cloneEl(art),
    w: el.offsetWidth * scale,
    h: el.offsetHeight * scale,
    rot: turned ? `${rot}` : undefined,
  };
}

/** Peças que o diff marca como `leave`: o clone (a `.board-piece` inteira, com
    as bordas de estado) desvanece no rect antigo — sem ele a criatura some no
    commit e as vizinhas saltam. */
export function captureGone(ids: string[]): FxSource[] {
  const sources: FxSource[] = [];
  for (const id of ids) {
    const piece = byIid(id)?.closest(".board-piece");
    if (piece) sources.push({ rect: piece.getBoundingClientRect(), node: cloneEl(piece) });
  }
  return sources;
}

/** A revelação em andamento: nós a remover, a marca a limpar, timer e o wake. */
type Run = { nodes: HTMLElement[]; marks: HTMLElement[]; mark: HTMLElement | null; timer: number; wake: (() => void) | null };

export const FxLayer = forwardRef<FxDirector>(function FxLayer(_props, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<Run | null>(null);
  const spotRef = useRef<HTMLElement[]>([]);

  const cancelAll = useCallback(() => {
    const run = runRef.current;
    runRef.current = null;
    if (!run) return;
    window.clearTimeout(run.timer);
    // Acorda o await do reveal: ele volta e percebe que não é mais o run atual.
    run.wake?.();
    for (const node of run.nodes) node.remove();
    run.mark?.removeAttribute("data-fx");
    for (const mark of run.marks) mark.removeAttribute("data-fx");
  }, []);

  /** PRE do move: quem age acende com a marca `acting` (plano §3). */
  const spot = (actorId?: string) => {
    for (const el of spotRef.current) el.removeAttribute("data-fx");
    const tile = actorId ? byIid(actorId) : null;
    spotRef.current = tile ? [tile] : [];
    tile?.setAttribute("data-fx", "acting");
  };

  /** Forja (onda 3): o board ganha o glow do lado que forjou + o shake. */
  const forge = (side: FxSide) => {
    const board = document.querySelector<HTMLElement>(".game-board");
    if (!board) return;
    board.style.setProperty("--forge-y", side === 1 ? "8%" : "88%");
    board.classList.remove("forge-flash");
    void board.offsetWidth; // reinicia a animação de um glow repetido
    board.classList.add("forge-flash");
    window.setTimeout(() => board.classList.remove("forge-flash"), 900);
  };

  /** Texto transitório no portal: aparece e sai por timer — é tempo, não
      movimento, então vale igual no reduce-motion (FX-08: legenda e banner são
      informação). Um texto novo da mesma classe substitui o anterior. */
  const flash = (cls: string, text: string) => {
    const host = hostRef.current;
    if (!host) return;
    host.querySelector(`.${cls}`)?.remove();
    const el = document.createElement("div");
    el.className = `fx-caption ${cls}`;
    el.textContent = text;
    host.appendChild(el);
    window.setTimeout(() => el.remove(), 900);
  };
  const banner = (text: string) => flash("fx-banner", text);
  const caption = (text: string) => flash("fx-caption--static", text);

  useImperativeHandle(ref, () => ({ run, cancelAll, spot, banner, forge, caption }));

  async function reveal(plan: FxPlan, host: HTMLElement, run: Run) {
    const alive = () => runRef.current === run;
    const step = (ms: number) => new Promise<void>((resolve) => {
      run.wake = resolve;
      run.timer = window.setTimeout(resolve, ms);
    });
    // Scroll DO DOCUMENTO no meio do voo: pular para o fim (rects de viewport
    // não valem mais). O clamp automático de um scroller interno (mão, log)
    // também dispara `scroll` em captura sem o jogador rolar a página, então só
    // o root conta — e um deslocamento ≤ 8px não cancela (FX-05).
    const startY = window.scrollY;
    const onScroll = (event: Event) => {
      if (event.target !== document && event.target !== document.documentElement) return;
      if (Math.abs(window.scrollY - startY) > 8) cancelAll();
    };
    const onResize = () => cancelAll();
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onResize);
    try {
      // Prefixo SÍNCRONO (antes do primeiro await): o layout effect do App roda
      // antes do paint do DOM novo, então o destino já fica escondido no frame
      // em que ele aparece — sem "flash" da carta no slot antes do voo.
      const destTile = plan.destId ? byIid(plan.destId) : null;
      const destPiece = destTile ? ((destTile.closest(".board-piece") as HTMLElement | null) ?? destTile) : null;
      if (destPiece) {
        destPiece.setAttribute("data-fx", "landing");
        run.mark = destPiece;
        // Sem animação de entrada no destino, por dois motivos: medir o slot sem
        // o translate/scale do quadro 0 e nunca replayar card-arrive/card-deal —
        // antes o voo já é a entrada. A supressão é um atributo PERSISTENTE (o
        // CSS só mata as entradas e cede às marcas acting/hit): inline venceria
        // a folha para sempre e a carta pousada nunca mais pulsaria (FX-01).
        destPiece.setAttribute("data-landed", "");
        if (destTile && destTile !== destPiece) destTile.setAttribute("data-landed", "");
      }
      const destArt = destTile?.querySelector<HTMLElement>(".card-art") ?? destTile;
      const to = destArt ? destArt.getBoundingClientRect() : null;

      // H3D-08: o destino 3D tem pose — lean de 12/10° e, quando a carta já
      // está deitada (exausta = `rotate: z 12deg` na arte), um giro no plano. O
      // ghost pousa com a MESMA pose: tira a inflação do giro da caixa projetada
      // (w·cos + h·sin) para nascer no tamanho da carta, escala por ele e
      // reaplica a pose no fim do voo (--fx-slot). Sem 3D nenhum dos dois
      // valores existe: `pose` sai vazia e o 2D não muda um pixel. A marca no
      // host leva o lean ao clone de quem sai, que nasce fora do contexto 3D.
      const lean = destPiece ? getComputedStyle(destPiece).getPropertyValue("--lean").trim() : "";
      const destSpin = destArt ? getComputedStyle(destArt).rotate : "";
      const spin = destSpin && destSpin !== "none" ? destSpin : "";
      const pose = [lean ? `rotateX(${lean})` : "", spin ? `rotateZ(${spin})` : ""].filter(Boolean).join(" ");
      const spinRad = spin ? (Math.abs(parseFloat(spin)) * Math.PI) / 180 : 0;
      const aspect = destArt && destArt.offsetWidth ? destArt.offsetHeight / destArt.offsetWidth : 1.4;
      const toWidth = to ? to.width / (Math.cos(spinRad) + aspect * Math.sin(spinRad)) : undefined;
      host.classList.toggle("fx-layer--3d", Boolean(lean));

      const { innerWidth: vw, innerHeight: vh } = window;
      const cy = vh * 0.46;
      // O ghost nasce centrado e com o tamanho da apresentação (CSS): as custom
      // properties do host dizem só de onde ele vem e onde aterrissa, já
      // relativas ao centro. A origem girada (leque 3D) usa o tamanho de layout
      // e a própria rotação no quadro 0 (H3D-08).
      const from = plan.from?.rect ?? to ?? { left: vw / 2 - 40, top: vh / 2 - 56, width: 80, height: 112 };
      const fromWidth = plan.from?.w ?? from.width;
      const fromRot = plan.from?.rot ? ` rotate(${plan.from.rot})` : "";
      // Destino fora da viewport (mão abaixo da dobra, no mobile): termina na
      // borda + fade, em vez de voar para um ponto que o jogador não vê.
      const slotY = to ? Math.max(16, Math.min(vh - 16, to.top + to.height / 2)) : cy;
      const hold = Math.max(60, plan.holdMs);
      host.style.cssText =
        `--fx-hold:${hold}ms;` +
        (lean ? `--fx-land-lean:${lean};` : "") +
        `--fx-from:translate(${from.left + from.width / 2 - vw / 2}px,${from.top + from.height / 2 - cy}px) scale(${fromWidth / STAGE_WIDTH})${fromRot};` +
        `--fx-slot:translate(${(to ? to.left + to.width / 2 : vw / 2) - vw / 2}px,${slotY - cy}px) scale(${((toWidth ?? fromWidth) / STAGE_WIDTH).toFixed(4)})${pose ? ` ${pose}` : ""}`;

      // O conteúdo do ghost: arte da mão (clone capturado antes do commit, o
      // caso da Ação sem slot) ou a do tile que acabou de nascer (o Warden joga
      // da mão, que não está no DOM — sem tile e sem clone vale a face, FX-02).
      const content = plan.from?.node ?? cloneEl(destArt) ?? (plan.face ? faceEl(plan.face) : null);
      let ghost: HTMLElement | null = null;
      if (content) {
        ghost = document.createElement("div");
        ghost.className = to ? "fx-ghost" : "fx-ghost fx-ghost--action";
        ghost.appendChild(content);
        if (plan.caption) {
          const caption = document.createElement("b");
          caption.className = "fx-caption";
          caption.textContent = plan.caption;
          ghost.appendChild(caption);
        }
        host.appendChild(ghost);
        run.nodes.push(ghost);
      }

      // Quem saiu do board desvanece no lugar antigo, em paralelo ao voo.
      for (const source of plan.gone ?? []) {
        if (!source.node) continue;
        source.node.className = "fx-gone";
        source.node.style.cssText = `left:${source.rect.left}px;top:${source.rect.top}px;width:${source.rect.width}px;height:${source.rect.height}px`;
        host.appendChild(source.node);
        run.nodes.push(source.node);
      }

      // Dano (onda 3): "-N" flutua sobre cada criatura atingida e o tile leva a
      // marca `hit` (tremida + flash de um quadro) — tudo aria-hidden no portal.
      for (const hit of plan.hits ?? []) {
        const tile = byIid(hit.id);
        if (!tile) continue;
        tile.setAttribute("data-fx", "hit");
        run.marks.push(tile);
        const box = tile.getBoundingClientRect();
        const node = document.createElement("b");
        node.className = "fx-dmg";
        node.textContent = `-${hit.amount}`;
        node.style.cssText = `left:${box.left + box.width / 2}px;top:${box.top + box.height / 3}px`;
        host.appendChild(node);
        run.nodes.push(node);
      }

      // Âmbar ganho (colheita/captura): o número nasce no card que gerou e voa
      // até o contador do dono (plano §4.2).
      if (plan.amber) {
        const counter = document.querySelector<HTMLElement>(`[data-side="${plan.amber.side}"] .amber-counter`);
        const box = ((plan.actorId ? byIid(plan.actorId) : null) ?? counter)?.getBoundingClientRect();
        const to = counter?.getBoundingClientRect();
        if (box && to) {
          const node = document.createElement("b");
          node.className = "fx-amber";
          node.textContent = `+${plan.amber.delta} Æ`;
          node.style.cssText = `left:${box.left + box.width / 2}px;top:${box.top + box.height / 2}px;--fx-dx:${to.left + to.width / 2 - box.left - box.width / 2}px;--fx-dy:${to.top + to.height / 2 - box.top - box.height / 2}px`;
          host.appendChild(node);
          run.nodes.push(node);
        }
      }

      // Correntes (onda 3): o elo cai do topo até o contador do lado.
      if (plan.chains) {
        const counter = document.querySelector<HTMLElement>(`[data-side="${plan.chains.side}"] .chain-counter`);
        const box = counter?.getBoundingClientRect();
        if (counter && box) {
          const node = document.createElement("b");
          node.className = "fx-chain";
          node.textContent = "⛓";
          node.style.cssText = `left:${box.left + box.width / 2}px;top:${box.top + box.height / 2}px;--fx-dy:${box.top + box.height / 2}px`;
          host.appendChild(node);
          run.nodes.push(node);
          counter.classList.remove("is-hit");
          void counter.offsetWidth;
          counter.classList.add("is-hit");
          window.setTimeout(() => counter.classList.remove("is-hit"), 600);
        }
      }

      if (ghost) {
        await step(PRESENT_MS + hold);
        if (!alive()) return;
        // O ghost está no destino (início do slam): é aqui que a carta "pousa"
        // e o som do pouso tem que soar (VAL-04). Sem destino (`to` falso) é
        // dissolve (Ação do Warden, FX-02): não há pouso, então sem som (VAL-04c).
        if (to) plan.onSlam?.();
        await step(to ? SLAM_MS : DISSOLVE_MS);
      } else if (plan.gone?.length || plan.actorId) {
        await step(ACTION_MS);
      }
    } finally {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onResize);
      if (alive()) {
        for (const node of run.nodes) node.remove();
        run.mark?.removeAttribute("data-fx");
        for (const mark of run.marks) mark.removeAttribute("data-fx");
        run.nodes = [];
        run.marks = [];
        run.mark = null;
      }
    }
  }

  function run(plan: FxPlan): Promise<void> {
    cancelAll();
    const host = hostRef.current;
    if (!host) return Promise.resolve();
    const current: Run = { nodes: [], marks: [], mark: null, timer: 0, wake: null };
    runRef.current = current;
    return reveal(plan, host, current);
  }

  return createPortal(<div className="fx-layer" ref={hostRef} aria-hidden="true" />, document.body);
});
