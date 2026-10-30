import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Gem, Shield, Sparkles, Swords, X } from "lucide-react";
import type { CardFace } from "../lib/game";
import type { Translator } from "../lib/i18n";
import { localizedArtUrl } from "../lib/artLocale";
import { CardText } from "./CardText";
import { CoverageBadge } from "./CoverageBadge";
import { HouseIcon } from "./HouseIcon";

export { houseColor, houseLabel } from "../lib/houses";
import { houseColor, houseLabel } from "../lib/houses";
import { useDialogFocus } from "./useDialogFocus";

type Size = "hand" | "board" | "preview";

// Preview de leitura: largura proporcional ao viewport (UX_FIT_PLAN §3.2), com folga de
// texto estimada para a altura (o line-clamp de 6 linhas do CSS garante o teto).
const ZOOM_MIN_WIDTH = 260;
const ZOOM_MAX_WIDTH = 340;
const ZOOM_TEXT_HEIGHT = 140;
// Áreas que o preview evita, com peso: placares e o END TURN/console pesam mais (o jogador
// precisa deles a qualquer momento); os móveis do tcg (pílula de casas, bandejas de pilhas,
// placar tingido) e do 3D (console como placa central) entram aqui. Do console conta só o
// conteúdo (texto e botões), não o fundo de largura total. O rail fixo entra à parte (peso 4).
const ZOOM_AVOID: readonly [string, number][] = [
  [".amber-counter, .key-counter, .key-pips", 10],
  [".end-turn-button, .console-undo, .turn-console > *", 8],
  [".house-pill", 5],
  [".pile-chips, .player-resources, .table-menu-trigger", 3],
  [".player-avatar", 2],
  [".command-rail--drawer.is-open", 1],
];
const ZOOM_GAP = 12;
const ZOOM_MARGIN = 12;
const ZOOM_DELAY = 120;
// Passo da varredura de reserva (só quando nenhuma posição preferida está livre).
const ZOOM_SWEEP = 16;
// T5 — touch: long-press inspeciona a carta (tap continua selecionando no board).
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 12;

function CardImage({ face, size }: { face: CardFace; size: Size }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Carta cujo render PT o S3 recusou (403): cai para o EN original. Guarda a URL, não um
  // boolean, para o slot não herdar o estado da carta anterior num render antes do reset.
  const [ptMissing, setPtMissing] = useState<string | null>(null);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [face.image]);

  const src = ptMissing === face.image ? face.image : localizedArtUrl(face.image);
  const hasImage = Boolean(face.image) && !failed;

  return (
    <>
      {/* VA-02: a face tipográfica cobre TODO estado sem imagem pronta (sem URL, erro, e
          a espera do download/lazy) — não depende de o <img> ter falhado. */}
      {!(hasImage && loaded) && (
        <div className="card-fallback" aria-hidden={hasImage || undefined}>
          <span className="fallback-house">{houseLabel(face.house)}</span>
          <span className="fallback-symbol">
            <Sparkles size={size === "preview" ? 25 : 19} strokeWidth={1.5} />
          </span>
          <strong>{face.title}</strong>
          <span className="fallback-type">{face.type}</span>
          <span className="fallback-stats">
            {face.power > 0 ? <span>{face.power}</span> : <span>{face.amber}A</span>}
            {face.armor > 0 && <span className="fallback-armor"><Shield size={11} aria-hidden="true" />{face.armor}</span>}
          </span>
        </div>
      )}
      {hasImage && (
        <img
          className={loaded ? undefined : "card-img-pending"}
          src={src}
          alt={`${face.title} card art`}
          /* T7a — CLS: proporção real da arte Master Vault (300×420 = 5:7 ≈ 0.714,
             a mesma usada em aspect-ratio no CSS e em ZOOM_WIDTH / 0.714). Os atributos
             dão aspect-ratio intrínseco ao browser antes do download; decoding async
             tira o decode do caminho crítico do paint. */
          width={300}
          height={420}
          loading={size === "preview" ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          ref={(img) => {
            // Imagem já em cache: o load pode ter disparado antes do handler.
            if (img?.complete && img.naturalWidth > 0) setLoaded(true);
          }}
          onLoad={() => setLoaded(true)}
          onError={() => {
            // Render PT ausente: uma tentativa com o EN antes do fallback tipográfico.
            if (src === face.image) setFailed(true);
            else setPtMissing(face.image);
          }}
        />
      )}
    </>
  );
}

interface ZoomPlacement {
  width: number;
  top: number;
  left: number;
  originX: string;
  originY: string;
}

// T5 — hover só é caminho válido quando o dispositivo anuncia "(hover: hover)";
// o pointerType sozinho não basta (tap de touch gera pointer compatível "mouse").
function hasHoverMedia() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: hover)").matches;
}

function zoomWidth() {
  const fit = (window.innerHeight - 2 * ZOOM_MARGIN - ZOOM_TEXT_HEIGHT) * 0.714;
  return Math.round(Math.max(ZOOM_MIN_WIDTH, Math.min(0.26 * window.innerWidth, fit, ZOOM_MAX_WIDTH)));
}

type Box = { left: number; top: number; right: number; bottom: number };

/** Custo de `a` sobre `b` (0 ou 0,5..1): tocar já custa meio peso — raspar o placar não pode
    sair mais barato que cobrir o rail inteiro — e o resto cresce com a fração coberta. */
function covered(a: Box, b: Box) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const area = (b.right - b.left) * (b.bottom - b.top);
  return w > 0 && h > 0 && area > 0 ? 0.5 + (0.5 * w * h) / area : 0;
}

/** Só o que está de fato na tela (a pílula de casas existe com opacity 0 fora da escolha). */
function shown(el: Element) {
  return typeof el.checkVisibility === "function" ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true;
}

function placeZoom(rect: DOMRect): ZoomPlacement {
  const width = zoomWidth();
  const totalHeight = width / 0.714 + ZOOM_TEXT_HEIGHT;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const clampTop = (value: number) => Math.max(ZOOM_MARGIN, Math.min(viewport.height - totalHeight - ZOOM_MARGIN, value));
  const avoid: { box: Box; weight: number }[] = [];
  for (const [selector, weight] of ZOOM_AVOID) {
    for (const el of document.querySelectorAll(selector)) {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.height > 0 && shown(el)) avoid.push({ box, weight });
    }
  }
  const rail = document.querySelector(".command-rail:not(.command-rail--drawer)")?.getBoundingClientRect();
  if (rail && rail.width > 0) avoid.push({ box: rail, weight: 4 });

  // x: direita da carta, esquerda da carta, metade oposta do palco e, por último, o slot do
  // rail (VA-04: o rail guarda inspetor/Undo/log — cobri-lo é o pior caso). y: centrado na
  // carta e, se ali bate em placar/console, encostado no topo ou no pé — o topo preso ao
  // centro era o que empurrava o zoom para cima do rail no 3D (faixa de placar no alto).
  const cardCenter = rect.left + rect.width / 2;
  const xs: Array<[number, string]> = [[rect.right + ZOOM_GAP, "0%"], [rect.left - width - ZOOM_GAP, "100%"]];
  xs.push(cardCenter < viewport.width / 2 ? [viewport.width - width - ZOOM_MARGIN, "100%"] : [ZOOM_MARGIN, "0%"]);
  if (rail && rail.width > 0) xs.push([viewport.width - width - ZOOM_MARGIN, "100%"]);
  const ys = [...new Set([clampTop(rect.top + rect.height / 2 - totalHeight / 2), clampTop(rect.bottom - totalHeight), clampTop(rect.top), ZOOM_MARGIN, clampTop(Infinity)])];

  // A primeira posição livre na ordem de preferência; sem nenhuma, uma varredura em grade
  // pega a livre mais perto da carta; sem livre alguma, a de menor cobertura ponderada
  // (cobrir a própria carta é proibitivo).
  const scoreOf = (left: number, top: number) => {
    const box = { left, right: left + width, top, bottom: top + totalHeight };
    return covered(box, rect) * 100 + avoid.reduce((sum, item) => sum + covered(box, item.box) * item.weight, 0);
  };
  const fits = (left: number) => left >= ZOOM_MARGIN && left + width <= viewport.width - ZOOM_MARGIN;
  let chosen = { left: xs[0][0], originX: xs[0][1], top: ys[0] };
  let best = Infinity;
  search: for (const [left, originX] of xs) {
    if (!fits(left)) continue;
    for (const top of ys) {
      const score = scoreOf(left, top);
      if (score < best - 0.001) {
        best = score;
        chosen = { left, originX, top };
      }
      if (score < 0.001) break search;
    }
  }
  if (best >= 0.001) {
    let near = Infinity;
    for (let left = ZOOM_MARGIN; fits(left); left += ZOOM_SWEEP) {
      for (let top = ZOOM_MARGIN; top + totalHeight <= viewport.height - ZOOM_MARGIN; top += ZOOM_SWEEP) {
        const score = scoreOf(left, top);
        const distance = Math.hypot(left + width / 2 - cardCenter, top + totalHeight / 2 - (rect.top + rect.height / 2));
        if (score < best - 0.001 || (score < 0.001 && distance < near)) {
          best = score;
          if (score < 0.001) near = distance;
          chosen = { left, originX: left + width / 2 < cardCenter ? "100%" : "0%", top };
        }
      }
    }
  }
  const originY = `${Math.max(0, Math.min(100, ((rect.top + rect.height / 2 - chosen.top) / totalHeight) * 100))}%`;
  return { top: chosen.top, left: chosen.left, width, originX: chosen.originX, originY };
}

export function CardArt({
  face,
  size,
  hoverZoom = false,
  onLongPress,
}: {
  face: CardFace;
  size: Size;
  hoverZoom?: boolean;
  /** T5 — caminho touch: disparado após long-press (~500ms) com pointerType touch. */
  onLongPress?: () => void;
}) {
  const [placement, setPlacement] = useState<ZoomPlacement | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const pressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const pressGuard = useRef(0);

  const enabled = hoverZoom && size !== "preview";

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
      if (pressTimer.current) window.clearTimeout(pressTimer.current);
    },
    [],
  );

  useEffect(() => setPlacement(null), [face.image, enabled]);

  // Hover-zoom (mouse/pen): UM timer por entrada do ponteiro, sem re-arm a cada move —
  // o rect é medido na hora do disparo, então mover o mouse não muda o resultado.
  const scheduleZoom = () => {
    if (!enabled || !hasHoverMedia() || timer.current) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (ref.current) setPlacement(placeZoom(ref.current.getBoundingClientRect()));
    }, ZOOM_DELAY);
  };

  const cancelZoom = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setPlacement(null);
  };

  const cancelLongPress = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
    pressStart.current = null;
  };

  const startLongPress = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" || !onLongPress) return;
    pressStart.current = { x: event.clientX, y: event.clientY };
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      pressStart.current = null;
      pressGuard.current = Date.now() + 1500;
      onLongPress();
    }, LONG_PRESS_MS);
  };

  // Dedo que desliza é scroll da mão/painel — cancela o long-press em vez de dispará-lo.
  const trackLongPressDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pressTimer.current || !pressStart.current) return;
    const dx = event.clientX - pressStart.current.x;
    const dy = event.clientY - pressStart.current.y;
    if (dx * dx + dy * dy > LONG_PRESS_SLOP * LONG_PRESS_SLOP) cancelLongPress();
  };

  return (
    <>
      <div
        ref={ref}
        className={`card-art card-art--${size}`}
        style={{ "--house-color": houseColor(face.house) } as CSSProperties}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") scheduleZoom();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch") cancelZoom();
          cancelLongPress();
        }}
        onPointerDown={startLongPress}
        onPointerMove={trackLongPressDrag}
        onPointerUp={cancelLongPress}
        onPointerCancel={() => {
          cancelZoom();
          cancelLongPress();
        }}
        onContextMenu={(event) => {
          // Android dispara contextmenu no long-press; não deixe abrir por cima do lightbox.
          if (pressTimer.current !== null || Date.now() < pressGuard.current) event.preventDefault();
        }}
      >
        <CardImage face={face} size={size} />
      </div>
      {placement &&
        createPortal(
          <div className="card-zoom-layer" aria-hidden="true">
            <div
              className="card-zoom"
              style={
                {
                  top: placement.top,
                  left: placement.left,
                  width: placement.width,
                  "--zoom-origin": `${placement.originX} ${placement.originY}`,
                  "--house-color": houseColor(face.house),
                } as CSSProperties
              }
            >
              <div className="card-zoom-art">
                <CardImage face={face} size="preview" />
              </div>
              <div className="card-zoom-text">
                <strong>{face.title}</strong>
                <p>{face.text ? <CardText text={face.text} /> : face.traits || `${houseLabel(face.house)} · ${face.type}`}</p>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export function CardLightbox({
  face,
  t,
  onClose,
}: {
  face: CardFace | null;
  t: Translator;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLElement>(Boolean(face));
  useEffect(() => {
    if (!face) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [face, onClose]);

  if (!face) return null;

  const typeKey = `type.${face.type}`;
  const localizedType = t(typeKey) === typeKey ? face.type : t(typeKey);

  return createPortal(
    <div
      className="modal-backdrop card-lightbox-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="card-lightbox"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={face.title}
        style={{ "--house-color": houseColor(face.house) } as CSSProperties}
      >
        <button type="button" className="modal-close card-lightbox-close" onClick={onClose} aria-label={t("common.close")}>
          <X size={18} />
        </button>
        <div className="card-lightbox-art">
          <CardImage face={face} size="preview" />
        </div>
        <div className="card-lightbox-info">
          <div className="card-lightbox-head">
            <HouseIcon house={face.house} size="md" />
            <div>
              <span className="card-lightbox-house">{houseLabel(face.house, t)} · {localizedType}</span>
              <h2>{face.title}</h2>
              {face.traits && <p className="card-lightbox-traits">{face.traits}</p>}
            </div>
          </div>
          <p className="card-lightbox-text">{face.text ? <CardText text={face.text} t={t} /> : t("inspector.noText")}</p>
          <CoverageBadge face={face} t={t} />
          <div className="card-lightbox-stats">
            {face.amber > 0 && <span><Gem size={14} /> {face.amber} {t("inspector.amber")}</span>}
            {face.power > 0 && <span><Swords size={14} /> {face.power} {t("inspector.power")}</span>}
            {face.armor > 0 && <span><Shield size={14} /> {face.armor} {t("inspector.armor")}</span>}
            {face.rarity && <span>{face.rarity}{face.cardNumber ? ` · #${face.cardNumber}` : ""}</span>}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
