import { useRef, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import type { Translator } from "../../../lib/i18n";
import { THEMES, type ThemeId } from "../../theme";
import { ThemePreview } from "./ThemePreview";

/**
 * Seletor de tema com pré-visualização ao vivo (UX_REWRITE_PLAN §1.6.2). O cartão carrega o
 * data-theme do próprio tema, então a miniatura já aparece nas cores que representa. O anel do
 * tema vigente fica no slot, FORA do data-theme do cartão. Setas movem o foco; Enter/Espaço aplicam.
 */
export function ThemePicker({ t, value, onChange }: { t: Translator; value: ThemeId; onChange: (id: ThemeId) => void }) {
  const cards = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    cards.current[(index + step + THEMES.length) % THEMES.length]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={t("ui.theme.title")} className="u-theme-grid">
      {THEMES.map((id, index) => (
        <div key={id} className="u-theme-slot" data-lit={value === id}>
          <button
            ref={(node) => { cards.current[index] = node; }}
            type="button"
            role="radio"
            aria-checked={value === id}
            tabIndex={value === id ? 0 : -1}
            data-theme={id}
            className="u-theme-card"
            onClick={() => onChange(id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <ThemePreview />
            <strong>{t(`ui.theme.${id}.name`)}</strong>
            <small>{t(`ui.theme.${id}.desc`)}</small>
          </button>
          {/* Estado além da cor: o aria-checked diz ao leitor; o ícone diz a quem enxerga. */}
          <span className="u-theme-check" aria-hidden="true"><Check size={14} /></span>
        </div>
      ))}
    </div>
  );
}
