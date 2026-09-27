import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Gem, Shield, Sparkles, Swords, X } from "lucide-react";
import type { CardFace } from "../lib/game";
import type { Translator } from "../lib/i18n";
import { HouseIcon } from "./HouseIcon";

export { houseColor, houseLabel } from "../lib/houses";
import { houseColor, houseLabel } from "../lib/houses";

type Size = "hand" | "board" | "preview";

// Balanced reference preview: readable card art and rules text without covering the board.
const ZOOM_WIDTH = 204;
const ZOOM_TEXT_HEIGHT = 76;
const ZOOM_GAP = 12;
const ZOOM_MARGIN = 12;
const ZOOM_DELAY = 120;
// T5 — touch: long-press inspeciona a carta (tap continua selecionando no board).
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 12;

function CardImage({ face, size }: { face: CardFace; size: Size }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [face.image]);

  if (!failed && face.image) {
    return (
      <img
        src={face.image}
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
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="card-fallback">
      <span className="fallback-house">{houseLabel(face.house)}</span>
      <span className="fallback-symbol">
        <Sparkles size={size === "preview" ? 25 : 19} strokeWidth={1.5} />
      </span>
      <strong>{face.title}</strong>
      <span className="fallback-type">{face.type}</span>
      <span className="fallback-stats">
        {face.power > 0 ? <span>{face.power}</span> : <span>{face.amber}A</span>}
      </span>
    </div>
  );
}

interface ZoomPlacement {
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

function placeZoom(rect: DOMRect): ZoomPlacement {
  const artHeight = ZOOM_WIDTH / 0.714;
  const totalHeight = artHeight + ZOOM_TEXT_HEIGHT;
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
  };

  // Prefer the wider side of the card; fall back to centred above it.
  const rightSpace = viewport.width - rect.right;
  const leftSpace = rect.left;
  let left: number;
  let originX = "50%";
  if (rightSpace >= ZOOM_WIDTH + ZOOM_GAP + ZOOM_MARGIN) {
    left = rect.right + ZOOM_GAP;
    originX = "0%";
  } else if (leftSpace >= ZOOM_WIDTH + ZOOM_GAP + ZOOM_MARGIN) {
    left = rect.left - ZOOM_WIDTH - ZOOM_GAP;
    originX = "100%";
  } else {
    left = Math.max(ZOOM_MARGIN, rect.left + rect.width / 2 - ZOOM_WIDTH / 2);
  }

  const wanted = rect.top + rect.height / 2 - totalHeight / 2;
  const top = Math.max(ZOOM_MARGIN, Math.min(viewport.height - totalHeight - ZOOM_MARGIN, wanted));
  const originY = `${Math.max(0, Math.min(100, ((rect.top + rect.height / 2 - top) / totalHeight) * 100))}%`;

  return { top, left, originX, originY };
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
                  width: ZOOM_WIDTH,
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
                <p>{face.text || face.traits || `${houseLabel(face.house)} · ${face.type}`}</p>
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
          <p className="card-lightbox-text">{face.text || t("inspector.noText")}</p>
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
