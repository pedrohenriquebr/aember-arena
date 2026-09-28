import { rulesOf, type Coverage } from "../lib/abilities";
import type { CardFace, DeckInfo } from "../lib/game";
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

/** FEAT-14: per-deck tally through the same rulesOf the engine reads. */
export function coverageCounts(cards: CardFace[]): Record<Coverage, number> {
  const counts: Record<Coverage, number> = { full: 0, partial: 0, vanilla: 0 };
  for (const face of cards) counts[rulesOf(face).coverage] += 1;
  return counts;
}

/** Deck-wide coverage chip (inspector meta row + config review). The breakdown
    rides in the title so the visible chip stays one short count. */
export function DeckCoverageChip({ deck, t }: { deck: DeckInfo; t: Translator }) {
  const { full, partial, vanilla } = coverageCounts(deck.cards);
  const total = deck.cards.length;
  return (
    <span className="meta-chip" title={`${full} ${t("coverage.full")} · ${partial} ${t("coverage.partial")} · ${vanilla} ${t("coverage.vanilla")}`}>
      {t("coverage.deck", { full, total })}
    </span>
  );
}
