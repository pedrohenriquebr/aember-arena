import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CardFace } from "../lib/game";
import { CardArt } from "./CardArt";

// Drag-to-play (estilo Arena): só inicia depois de 20px NA DIREÇÃO DA MESA (para cima);
// antes disso nada muda — o clique curto segue sendo seleção.
const DRAG_THRESHOLD = 20;
// Cone de ~60° em torno da vertical: um arrasto lateral é scroll da mão, não jogada.
const MIN_UP_RATIO = 0.5;
const SNAP_MS = 220;
const DROP_ZONE = ".battle-zone--player";

interface Ghost {
  iid: string;
  face: CardFace;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Track {
  iid: string;
  pointerId: number;
  x: number;
  y: number;
  rect: DOMRect;
  active: boolean;
}

interface Options {
  /** Só cartas com play legal (isLegalMove) iniciam o arrasto. */
  canDrag: (iid: string) => boolean;
  faceOf: (iid: string) => CardFace | undefined;
  /** QA-08: `host` = hospedeiro legal sob o ponteiro (upgrade solta em cima da criatura). */
  onDrop: (iid: string, host?: string) => void;
  /** QA-08: hospedeiros legais da carta arrastada (upgrade); [] para o resto. Soltar sobre
      um deles anexa ali — inclusive na lane inimiga, fora da zona de drop. */
  hostsOf?: (iid: string) => string[];
  /** false = sem snap-back animado (reduce-motion / animações desligadas). */
  animate: boolean;
}

/** Pointer Events na mão: o fantasma é portado para o body (a track tem overflow e cortaria). */
export function useHandDrag({ canDrag, faceOf, onDrop, hostsOf, animate }: Options) {
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const track = useRef<Track | null>(null);
  const suppressClick = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);
  const opts = useRef({ canDrag, faceOf, onDrop, hostsOf, animate });
  opts.current = { canDrag, faceOf, onDrop, hostsOf, animate };

  useEffect(() => () => cleanup.current?.(), []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (track.current || (event.pointerType === "mouse" && event.button !== 0) || !event.isPrimary) return;
    const tile = (event.target as HTMLElement).closest<HTMLElement>("[data-iid]");
    const iid = tile?.dataset.iid;
    if (!tile || !iid || !opts.current.canDrag(iid)) return;
    const t: Track = { iid, pointerId: event.pointerId, x: event.clientX, y: event.clientY, rect: tile.getBoundingClientRect(), active: false };
    track.current = t;
    const zone = () => document.querySelector<HTMLElement>(DROP_ZONE);
    const over = (x: number, y: number) => {
      const r = zone()?.getBoundingClientRect();
      return Boolean(r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
    };
    // Os tiles da mesa que aceitam a carta (upgrade): marcados enquanto o arrasto vive.
    let hosts: HTMLElement[] = [];
    const hostAt = (x: number, y: number) =>
      document.elementsFromPoint(x, y).map((el) => el.closest<HTMLElement>(".board-piece [data-iid]")).find((el) => el && hosts.includes(el)) ?? undefined;
    const place = (dx: number, dy: number, lift: boolean) => {
      const el = ghostRef.current;
      if (el) el.style.transform = `translate(${dx}px, ${dy}px) rotate(${lift ? Math.max(-8, Math.min(8, dx * 0.06)) : 0}deg) scale(${lift ? 1.08 : 1})`;
    };

    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      const z = zone();
      if (z) delete z.dataset.drop;
      for (const host of hosts) delete host.dataset.dropHost;
      hosts = [];
      tile.removeAttribute("data-dragging");
      track.current = null;
      cleanup.current = null;
    };
    const finish = (drop: boolean, host?: string) => {
      const wasActive = t.active;
      end();
      if (!wasActive) return;
      // O click sintético que sucede o arrasto não pode selecionar a carta.
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      if (drop) {
        setGhost(null);
        opts.current.onDrop(iid, host);
        return;
      }
      const el = ghostRef.current;
      if (!opts.current.animate || !el) { setGhost(null); return; }
      el.style.transition = `transform ${SNAP_MS}ms var(--ease-out, ease-out)`;
      place(0, 0, false);
      setTimeout(() => setGhost(null), SNAP_MS + 20);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== t.pointerId) return;
      const dx = e.clientX - t.x;
      const dy = e.clientY - t.y;
      if (!t.active) {
        const dist = Math.hypot(dx, dy);
        if (dist < DRAG_THRESHOLD) return;
        if (-dy / dist < MIN_UP_RATIO) { end(); return; }
        t.active = true;
        tile.setAttribute("data-dragging", "");
        const z = zone();
        if (z) z.dataset.drop = "armed";
        const ids = opts.current.hostsOf?.(iid) ?? [];
        hosts = [...document.querySelectorAll<HTMLElement>(".board-piece [data-iid]")].filter((el) => ids.includes(el.dataset.iid ?? ""));
        for (const host of hosts) host.dataset.dropHost = "armed";
        const f = opts.current.faceOf(iid);
        if (!f) { end(); return; }
        setGhost({ iid, face: f, left: t.rect.left, top: t.rect.top, width: t.rect.width, height: t.rect.height });
      }
      e.preventDefault();
      place(dx, dy, true);
      const z = zone();
      const host = hostAt(e.clientX, e.clientY);
      for (const el of hosts) el.dataset.dropHost = el === host ? "over" : "armed";
      if (z) z.dataset.drop = !host && over(e.clientX, e.clientY) ? "over" : "armed";
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== t.pointerId) return;
      const host = t.active ? hostAt(e.clientX, e.clientY)?.dataset.iid : undefined;
      finish(t.active && (Boolean(host) || over(e.clientX, e.clientY)), host);
    };
    const cancel = (e: PointerEvent) => { if (e.pointerId === t.pointerId) finish(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") finish(false); };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    cleanup.current = end;
  }, []);

  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!suppressClick.current) return;
    event.stopPropagation();
    event.preventDefault();
  }, []);

  const ghostNode: ReactNode = ghost
    ? createPortal(
        <div ref={ghostRef} className="drag-ghost" aria-hidden="true" style={{ left: ghost.left, top: ghost.top, width: ghost.width, height: ghost.height }}>
          <CardArt face={ghost.face} size="hand" />
        </div>,
        document.body,
      )
    : null;

  return { handlers: { onPointerDown, onClickCapture, onDragStart: (e: { preventDefault: () => void }) => e.preventDefault() }, ghost: ghostNode };
}
