import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowLeft, Filter, Gem, Layers, Search, Shield, Sparkles, Swords, X } from "lucide-react";
import type { CardFace, DeckInfo } from "../lib/game";
import { summarizeDeck } from "../lib/game";
import type { Translator } from "../lib/i18n";
import { sound } from "../lib/sound";
import { ZoomIn } from "lucide-react";
import { houseColor, houseLabel } from "../lib/houses";
import { CardArt, CardLightbox } from "./CardArt";
import { HouseMark } from "./DeckTile";
import { HouseIcon } from "./HouseIcon";
import { Pagination } from "./Pagination";

const PAGE_SIZE = 12;
const TYPE_ORDER = ["Creature", "Action", "Artifact", "Upgrade"];

export function DeckInspector({
  deck,
  t,
  onBack,
  onUseDeck,
  selected,
}: {
  deck: DeckInfo;
  t: Translator;
  onBack: () => void;
  onUseDeck: () => void;
  selected: boolean;
}) {
  const [query, setQuery] = useState("");
  const [house, setHouse] = useState<string>("all");
  const [type, setType] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<CardFace | null>(() => deck.cards[0] ?? null);
  const [lightboxCard, setLightboxCard] = useState<CardFace | null>(null);

  const summary = useMemo(() => summarizeDeck(deck), [deck]);
  const houses = deck.houses.length ? deck.houses : [...new Set(deck.cards.map((card) => card.house))];
  const types = TYPE_ORDER.filter((item) => summary.byType[item]);

  // Unknown card types fall back to their raw API label instead of a translation key.
  const typeLabel = (value: string): string => {
    const key = `type.${value}`;
    const translated = t(key);
    return translated === key ? value : translated;
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return deck.cards.filter((card) => {
      if (house !== "all" && card.house !== house) return false;
      if (type !== "all" && card.type !== type) return false;
      if (!needle) return true;
      return (
        card.title.toLowerCase().includes(needle) ||
        card.house.toLowerCase().includes(needle) ||
        houseLabel(card.house, t).toLowerCase().includes(needle) ||
        (card.traits ?? "").toLowerCase().includes(needle) ||
        (card.text ?? "").toLowerCase().includes(needle)
      );
    });
  }, [deck, house, query, t, type]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const filtersOn = query.trim() !== "" || house !== "all" || type !== "all";

  useEffect(() => setPage(1), [query, house, type]);

  const resetFilters = () => {
    sound.play("click");
    setQuery("");
    setHouse("all");
    setType("all");
  };

  return (
    <div className="screen inspect-screen">
      <div className="sub-head">
        <button type="button" className="icon-back" onClick={() => { sound.play("click"); onBack(); }} aria-label={t("common.back")}>
          <ArrowLeft size={16} />
        </button>
        <div className="sub-head-copy">
          <span className="eyebrow">{t("inspect.eyebrow")}</span>
          <h1>{deck.name}</h1>
        </div>
        <div className="sub-head-meta">
          <span className="meta-chip"><Layers size={12} /> {summary.total} {t("common.cards")}</span>
          {deck.expansion ? <span className="meta-chip">{t("deck.set")} {deck.expansion}</span> : null}
          {deck.powerLevel ? <span className="meta-chip"><Sparkles size={12} /> {t("deck.power")} {deck.powerLevel}</span> : null}
          {deck.chains ? <span className="meta-chip">{deck.chains} {t("deck.chains")}</span> : null}
          {/* A record only means something once the deck has one. */}
          {deck.wins || deck.losses ? <span className="meta-chip">{deck.wins ?? 0}W · {deck.losses ?? 0}L</span> : null}
        </div>
      </div>

      <section className="stat-strip" aria-label={t("inspect.stats")}>
        <div className="stat-cell stat-cell--lead">
          <span className="stat-label">{t("inspect.stats")}</span>
          <div className="deck-houses deck-houses--lg">
            {houses.map((item) => <HouseMark key={item} house={item} />)}
          </div>
        </div>
        {types.map((item) => (
          <div className="stat-cell" key={item}>
            <span className="stat-label">{t(`type.${item}`)}</span>
            <strong className="stat-value">{summary.byType[item] ?? 0}</strong>
          </div>
        ))}
        <div className="stat-cell">
          <span className="stat-label">{t("deckStat.amber")}</span>
          <strong className="stat-value stat-value--amber"><Gem size={13} /> {summary.bonusAmber}</strong>
        </div>
        <div className="stat-cell">
          <span className="stat-label">{t("deckStat.avgPower")}</span>
          <strong className="stat-value">{summary.averagePower}</strong>
        </div>
        <div className="stat-cell">
          <span className="stat-label">{t("deckStat.armored")}</span>
          <strong className="stat-value"><Shield size={13} /> {summary.armoredCount}</strong>
        </div>
        <div className="stat-cell">
          <span className="stat-label">{t("deckStat.unique")}</span>
          <strong className="stat-value">{summary.unique}</strong>
        </div>
      </section>

      <div className="inspect-layout">
        <div className="inspect-main">
          <div className="filter-bar">
            <div className="filter-search">
              <Search size={14} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("inspect.searchPlaceholder")}
                aria-label={t("inspect.searchPlaceholder")}
              />
            </div>
            <div className="filter-chips" role="group" aria-label={t("inspect.houseFilter")}>
              <button type="button" className={`filter-chip${house === "all" ? " is-active" : ""}`} onClick={() => { sound.play("click"); setHouse("all"); }}>
                {t("inspect.all")}
              </button>
              {houses.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`filter-chip filter-chip--house${house === item ? " is-active" : ""}`}
                  style={{ "--house-color": houseColor(item) } as CSSProperties}
                  onClick={() => { sound.play("click"); setHouse(item); }}
                >
                  <HouseIcon house={item} size="xs" />
                  {houseLabel(item, t)}
                </button>
              ))}
            </div>
            <div className="filter-chips" role="group" aria-label={t("inspect.typeFilter")}>
              <button type="button" className={`filter-chip filter-chip--ghost${type === "all" ? " is-active" : ""}`} onClick={() => { sound.play("click"); setType("all"); }}>
                <Filter size={12} /> {t("inspect.allTypes")}
              </button>
              {types.map((item) => (
                <button key={item} type="button" className={`filter-chip filter-chip--ghost${type === item ? " is-active" : ""}`} onClick={() => { sound.play("click"); setType(item); }}>
                  {t(`type.${item}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="inspect-result-row">
            <span className="inspect-result-count">
              {t("inspect.showing", { shown: filtered.length, total: summary.total })}
            </span>
            {filtersOn && (
              <button type="button" className="link-button" onClick={resetFilters}>
                <X size={12} /> {t("inspect.clearFilters")}
              </button>
            )}
          </div>

          {visible.length ? (
            <div className="card-grid">
              {visible.map((card, index) => (
                <button
                  type="button"
                  key={`${card.id}-${index}`}
                  className={`card-cell${active?.id === card.id ? " is-active" : ""}`}
                  style={{ "--house-color": houseColor(card.house), animationDelay: `${Math.min(index, 11) * 26}ms` } as CSSProperties}
                  onClick={() => {
                    sound.play("select");
                    setActive(card);
                    if (typeof window !== "undefined" && window.innerWidth <= 1040) {
                      setLightboxCard(card);
                    }
                  }}
                >
                  <CardArt face={card} size="hand" hoverZoom />
                  <span className="card-cell-caption">
                    <strong>{card.title}</strong>
                    <small>{typeLabel(card.type)}{card.power ? ` · ${card.power}` : card.amber ? ` · ${card.amber}A` : ""}</small>
                  </span>
                  {card.isMaverick && <span className="maverick-flag">MV</span>}
                </button>
              ))}
            </div>
          ) : (
            <div className="card-grid-empty">
              <Search size={20} />
              <p>{t("inspect.noResults")}</p>
              <button type="button" className="link-button" onClick={resetFilters}>{t("inspect.clearFilters")}</button>
            </div>
          )}

          <div className="inspect-pager">
            <Pagination
              page={currentPage}
              totalPages={totalPages}
              onChange={(next) => { sound.play("click"); setPage(next); }}
              label={t("inspect.pagerLabel")}
              t={t}
              compact
            />
          </div>
        </div>

        <aside className="card-detail" aria-live="polite">
          {active ? (
            <div className="card-detail-inner">
              <div className="card-detail-head">
                <span className="eyebrow">{t("inspect.cardDetail")}</span>
                <div className="card-detail-head-actions">
                  <button
                    type="button"
                    className="quiet-icon-button"
                    onClick={() => { sound.play("click"); setLightboxCard(active); }}
                    aria-label={t("inspector.zoomCard")}
                    title={t("inspector.zoomCard")}
                  >
                    <ZoomIn size={14} />
                  </button>
                  <button type="button" className="quiet-icon-button" onClick={() => setActive(null)} aria-label={t("common.close")}>
                    <X size={14} />
                  </button>
                </div>
              </div>
              <button
                type="button"
                className="card-detail-art card-detail-art--button"
                style={{ "--house-color": houseColor(active.house) } as CSSProperties}
                onClick={() => { sound.play("click"); setLightboxCard(active); }}
                title={t("inspector.zoomCard")}
              >
                <CardArt face={active} size="preview" hoverZoom={false} />
              </button>
              <div className="card-detail-body">
                <div className="card-detail-title-row">
                  <HouseMark house={active.house} small />
                  <h2>{active.title}</h2>
                </div>
                <p className="card-detail-sub">{houseLabel(active.house, t)} · {typeLabel(active.type)}{active.cardNumber ? ` · #${active.cardNumber}` : ""}</p>
                {active.traits && <p className="card-detail-traits">{active.traits}</p>}
                <p className="card-detail-text">{active.text || t("inspector.noText")}</p>

                <div className="card-detail-stats">
                  {active.amber > 0 && <span><Gem size={13} /> {active.amber} {t("inspector.amber")}</span>}
                  {active.power > 0 && <span><Swords size={13} /> {active.power} {t("inspector.power")}</span>}
                  {active.armor > 0 && <span><Shield size={13} /> {active.armor} {t("inspector.armor")}</span>}
                  {active.rarity && <span className="rarity">{active.rarity}</span>}
                </div>
              </div>
            </div>
          ) : (
            <div className="card-detail-empty">
              <span className="card-detail-empty-icon"><Sparkles size={20} /></span>
              <strong>{t("inspect.pickCard")}</strong>
              <p>{t("inspect.pickCardBody")}</p>
              <div className="rarity-legend">
                {Object.entries(summary.byRarity).map(([rarity, amount]) => (
                  <span key={rarity}><i />{rarity} <b>{amount}</b></span>
                ))}
              </div>
            </div>
          )}

          <button type="button" className={`cta-button card-detail-cta${selected ? " is-selected" : ""}`} onClick={() => { sound.play("click"); onUseDeck(); }}>
            <Swords size={15} /> {selected ? t("home.selected") : t("inspect.useDeck")}
          </button>
        </aside>
      </div>
      <CardLightbox face={lightboxCard} t={t} onClose={() => setLightboxCard(null)} />
    </div>
  );
}
