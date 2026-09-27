import { useState, type CSSProperties } from "react";
import { Check, Eye, Swords } from "lucide-react";
import type { DeckInfo } from "../lib/game";
import { summarizeDeck } from "../lib/game";
import type { Translator } from "../lib/i18n";
import { houseColor } from "../lib/houses";
import { CardArt } from "./CardArt";
import { HouseIcon, HouseRow } from "./HouseIcon";

export { HouseRow };

/** Thin alias kept so every screen renders the official emblem. */
export function HouseMark({ house, small = false }: { house: string; small?: boolean }) {
  return <HouseIcon house={house} size={small ? "sm" : "md"} />;
}

export function DeckTile({
  deck,
  t,
  selected = false,
  tag,
  onSelect,
  onInspect,
}: {
  deck: DeckInfo;
  t: Translator;
  selected?: boolean;
  tag?: string;
  onSelect: () => void;
  onInspect?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const summary = summarizeDeck(deck);

  return (
    <article
      className={`deck-tile${selected ? " deck-tile--selected" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="deck-tile-art" style={{ "--house-color": houseColor(deck.houses[0] ?? "Logos") } as CSSProperties}>
        <CardArt face={deck.cards[0]} size="preview" hoverZoom={false} />
        <span className="deck-tile-stack" aria-hidden="true" />
        {selected && <span className="deck-tile-check"><Check size={13} /></span>}
      </div>

      <div className="deck-tile-copy">
        {/* In the copy column, not over the art: a tag wider than the art used to
            spill over the stats row and hide the Cards/Creatures values. */}
        {tag && <span className="deck-tile-tag">{tag}</span>}
        <h3 title={deck.name}>{deck.name}</h3>
        <HouseRow houses={deck.houses} />
        <dl className="deck-tile-stats">
          <div><dt>{t("common.cards")}</dt><dd>{summary.total}</dd></div>
          <div><dt>{t("deckStat.creatures")}</dt><dd>{summary.creatureCount}</dd></div>
          <div><dt>{t("deckStat.amber")}</dt><dd>{summary.bonusAmber}</dd></div>
        </dl>
      </div>

      <div className="deck-tile-actions">
        <button type="button" className="tile-action tile-action--primary" onClick={onSelect}>
          <Swords size={14} /> {selected ? t("home.selected") : t("home.select")}
        </button>
        {onInspect && (
          <button type="button" className="tile-action" onClick={onInspect} aria-label={t("inspect.open")}>
            <Eye size={14} /> {t("inspect.explore")}
          </button>
        )}
      </div>

      <span className={`deck-tile-sheen${hovered ? " is-on" : ""}`} aria-hidden="true" />
    </article>
  );
}
