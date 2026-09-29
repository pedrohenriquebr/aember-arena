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
    leituras de DOM — nada de estado. */
export function captureFx(id: string | undefined, side: FxSide): FxSource | undefined {
  const tile = id ? byIid(id) : null;
  const art = tile?.querySelector(".card-art") ?? null;
  // A mão do Warden não está no DOM: a origem é o avatar do band dele.
  const el = art ?? tile ?? document.querySelector(`[data-side="${side}"] .player-avatar`);
  return el ? { rect: el.getBoundingClientRect(), node: cloneEl(art) } : undefined;
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

  /** Banner de transição: só texto e tempo (não passa pelo guard de movimento). */
  const banner = (text: string) => {
    const host = hostRef.current;
    if (!host) return;
    const el = document.createElement("div");
    el.className = "fx-caption fx-banner";
    el.textContent = text;
    host.appendChild(el);
    window.setTimeout(() => el.remove(), 900);
  };

  useImperativeHandle(ref, () => ({ run, cancelAll, spot, banner, forge }));

  async function reveal(plan: FxPlan, host: HTMLElement, run: Run) {
    const alive = () => runRef.current === run;
    const step = (ms: number) => new Promise<void>((resolve) => {
      run.wake = resolve;
      run.timer = window.setTimeout(resolve, ms);
    });
    // Scroll/resize no meio do voo: pular para o fim (rects de viewport não valem mais).
    const onViewport = () => cancelAll();
    window.addEventListener("scroll", onViewport, { passive: true, capture: true });
    window.addEventListener("resize", onViewport);
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
      const destArt = destTile?.querySelector(".card-art") ?? destTile;
      const to = destArt ? destArt.getBoundingClientRect() : null;

      const { innerWidth: vw, innerHeight: vh } = window;
      const cy = vh * 0.46;
      // O ghost nasce centrado e com o tamanho da apresentação (CSS): as custom
      // properties do host dizem só de onde ele vem e onde aterrissa, já
      // relativas ao centro.
      const from = plan.from?.rect ?? to ?? { left: vw / 2 - 40, top: vh / 2 - 56, width: 80, height: 112 };
      // Destino fora da viewport (mão abaixo da dobra, no mobile): termina na
      // borda + fade, em vez de voar para um ponto que o jogador não vê.
      const slotY = to ? Math.max(16, Math.min(vh - 16, to.top + to.height / 2)) : cy;
      const hold = Math.max(60, plan.holdMs);
      host.style.cssText =
        `--fx-hold:${hold}ms;` +
        `--fx-from:translate(${from.left + from.width / 2 - vw / 2}px,${from.top + from.height / 2 - cy}px) scale(${from.width / STAGE_WIDTH});` +
        `--fx-slot:translate(${(to ? to.left + to.width / 2 : vw / 2) - vw / 2}px,${slotY - cy}px) scale(${(to ? to.width : from.width) / STAGE_WIDTH})`;

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
        // e o som do pouso tem que soar (VAL-04).
        plan.onSlam?.();
        await step(to ? SLAM_MS : DISSOLVE_MS);
      } else if (plan.gone?.length || plan.actorId) {
        await step(ACTION_MS);
      }
    } finally {
      window.removeEventListener("scroll", onViewport, { capture: true });
      window.removeEventListener("resize", onViewport);
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
