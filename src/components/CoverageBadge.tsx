import { rulesOf } from "../lib/abilities";
import type { CardFace } from "../lib/game";
import type { Translator } from "../lib/i18n";

/** How much of the card's printed text the engine actually simulates. Imported
    decks mix covered and vanilla cards; the badge makes that visible instead of
    letting a card silently do less than its text says. The hint is always shown
    (no hover-only information). */
export function CoverageBadge({ face, t }: { face: CardFace; t: Translator }) {
  const coverage = rulesOf(face).coverage;
  return (
    <p className={`coverage-note coverage-note--${coverage}`}>
      <span className="coverage-badge">{t(`coverage.${coverage}`)}</span>
      <span>{t(`coverage.${coverage}.hint`)}</span>
    </p>
  );
}
