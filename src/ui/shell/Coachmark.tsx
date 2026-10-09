import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Translator } from "../../lib/i18n";
import { coachIndex, type CoachStep } from "../lib/coach";
import { Button } from "../primitives/Button";
import { cx } from "../primitives/cx";

// UX_REWRITE_PLAN §5 H-24: o balão da dica ancora-se no elemento marcado com data-coach="<passo>".
// É um portal position: fixed — fora do fluxo, então não soma altura à mesa (folga zero) e não
// entra no 3D. Sem âncora visível, não aparece.

/** Metade da largura do balão e a altura estimada para decidir acima/abaixo (medidas do CSS). */
const HALF_WIDTH = 150;
const BALLOON_HEIGHT = 160;
const MARGIN = 12;

interface Place {
  x: number;
  y: number;
  below: boolean;
}

export function Coachmark({ t, step, onSkip }: {
  t: Translator;
  /** Passo atual ("pickHouse" | "playCard" | "endTurn"); "done" não desenha nada. */
  step: CoachStep;
  onSkip: () => void;
}) {
  const [place, setPlace] = useState<Place | null>(null);

  // Mede a âncora e segue o layout: resize, scroll (captura, para os painéis internos) e troca de passo.
  useLayoutEffect(() => {
    const measure = () => {
      const anchor = document.querySelector<HTMLElement>(`[data-coach="${step}"]`);
      if (!anchor) {
        setPlace(null);
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const below = rect.top < BALLOON_HEIGHT + MARGIN;
      const x = Math.min(Math.max(rect.left + rect.width / 2, HALF_WIDTH + MARGIN), window.innerWidth - HALF_WIDTH - MARGIN);
      const y = below ? rect.bottom + MARGIN : rect.top - MARGIN;
      setPlace({ x, y, below });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  const index = coachIndex(step);
  if (index === null || !place) return null;

  return createPortal(
    <div className="nf-coach-layer" data-coach-layer={step}>
      <div className={cx("nf-coach", place.below && "is-below")} role="status" aria-live="polite" style={{ left: place.x, top: place.y }}>
        <p className="nf-coach-count">{t("ui.coach.count", { n: index, total: 3 })}</p>
        <p className="nf-coach-text">{t(`ui.coach.${step}`)}</p>
        <Button variant="ghost" onClick={onSkip}>{t("ui.coach.skip")}</Button>
      </div>
    </div>,
    document.body,
  );
}
