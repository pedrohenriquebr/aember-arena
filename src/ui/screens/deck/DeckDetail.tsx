import { ArrowLeft, RefreshCw, Search, Swords } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { CardArt } from "../../../components/CardArt";
import { HouseIcon } from "../../../components/HouseIcon";
import type { DeckStats } from "../../../lib/cache";
import type { CardFace, DeckInfo } from "../../../lib/game";
import { summarizeDeck } from "../../../lib/game";
import { houseColor, houseLabel } from "../../../lib/houses";
import type { Translator } from "../../../lib/i18n";
import { sound } from "../../../lib/sound";
import { filterDeckCards, groupByHouse } from "../../lib/deckDetail";
import { Button } from "../../primitives/Button";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { Sheet } from "../../primitives/Sheet";
import { StatBlock } from "../../primitives/StatBlock";
import { DeckHero } from "../lobby/DeckHero";
import { CardPane } from "./CardPane";

/** Painel docado só acima de 1040px (a mesma linha do rail); abaixo, cada toque abre a folha. */
const DOCKED = "(min-width: 1041px)";

export type DetailTab = "cards" | "stats";

export interface DeckDetailProps {
  t: Translator;
  deck: DeckInfo;
  /** O deck é o do hero do Lobby (a aba Jogar já o usa). */
  selected: boolean;
  /** Recorde local (V/D de getDeckStats); null = sem partida gravada ou ainda carregando. */
  stats: DeckStats | null;
  syncing: boolean;
  onBack: () => void;
  onPlay: (deck: DeckInfo) => void;
  onSync: () => void;
}

/**
 * Detalhe do deck (UX_REWRITE_PLAN §2 S5, §5 H-16): hero, recorde, selo de estatística, cartas por
 * casa e o painel da carta. Hover no desktop atualiza o painel docado; o toque no celular abre a
 * folha. O CTA "Jogar com este deck" fica preso embaixo. Não há popup de zoom: a arte é o painel.
 */
export function DeckDetail({ t, deck, selected, stats, syncing, onBack, onPlay, onSync }: DeckDetailProps) {
  const [tab, setTab] = useState<DetailTab>("cards");
  const [query, setQuery] = useState("");
  const [house, setHouse] = useState<string | null>(null);
  const [active, setActive] = useState<CardFace | null>(deck.cards[0] ?? null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const summary = useMemo(() => summarizeDeck(deck), [deck]);
  const houses = useMemo(
    () => (deck.houses.length ? deck.houses : [...new Set(deck.cards.map((card) => card.house))]),
    [deck],
  );
  const groups = useMemo(
    () => groupByHouse(filterDeckCards(deck.cards, { query, house }), houses),
    [deck, query, house, houses],
  );
  const filtersOn = query.trim() !== "" || house !== null;

  const clearFilters = () => {
    sound.play("click");
    setQuery("");
    setHouse(null);
  };

  // Mouse: passar por cima já mostra a carta. Toque: o clique escolhe; no celular abre a folha.
  const choose = (card: CardFace) => {
    sound.play("select");
    setActive(card);
    if (!window.matchMedia(DOCKED).matches) setSheetOpen(true);
  };

  return (
    <div className="nf-detail nf-screen-enter" data-screen="detail">
      <div className="nf-detail-main">
        <div className="nf-detail-top">
          <Button variant="ghost" icon={<ArrowLeft size={18} />} aria-label={t("common.back")} onClick={() => { sound.play("click"); onBack(); }} />
        </div>

        <DeckHero
          deck={deck}
          t={t}
          actions={(
            <div className="nf-detail-actions">
              <Button variant="ghost" icon={<RefreshCw size={16} className={syncing ? "spin" : undefined} />} disabled={syncing} onClick={onSync}>
                {syncing ? t("common.syncing") : t("common.sync")}
              </Button>
              {selected && <span className="nf-detail-selected">{t("home.selected")}</span>}
            </div>
          )}
        />

        {/* Faixa de números do deck: a mesma leitura em qualquer aba, sem abrir a estatística. */}
        <section className="nf-stat-strip" aria-label={t("inspect.stats")}>
          <StatBlock label={t("common.cards")} value={summary.total} />
          <StatBlock label={t(`type.Creature`)} value={summary.byType.Creature ?? 0} />
          <StatBlock label={t(`type.Action`)} value={summary.byType.Action ?? 0} />
          <StatBlock label={t(`type.Artifact`)} value={summary.byType.Artifact ?? 0} />
          <StatBlock tone="amber" label={t("deckStat.amber")} value={summary.bonusAmber} />
          <StatBlock label={t("deckStat.avgPower")} value={summary.averagePower} />
        </section>

        <section className="nf-card nf-detail-record" aria-labelledby="nf-detail-record-title">
          <h2 id="nf-detail-record-title" className="nf-card-title">{t("ui.lobby.recordTitle")}</h2>
          {stats && (stats.wins > 0 || stats.losses > 0) ? (
            <div className="nf-record-stats">
              <StatBlock tone="verdant" label={t("ui.lobby.wins")} value={stats.wins} />
              <StatBlock tone="ember" label={t("ui.lobby.losses")} value={stats.losses} />
            </div>
          ) : (
            <p className="nf-card-note">{t("ui.lobby.noRecord")}</p>
          )}
        </section>

        <SegmentedControl<DetailTab>
          label={t("ui.detail.tabsLabel")}
          value={tab}
          onChange={setTab}
          options={[
            { value: "cards", label: t("ui.detail.tabCards") },
            { value: "stats", label: t("ui.detail.tabStats") },
          ]}
        />

        {tab === "cards" && (
          // Wrapper da aba: o gap do grid de nf-detail-main é replicado (deck.css) para o layout não mudar.
          <div className="nf-detail-cards nf-tab-panel">
            <div className="nf-detail-filters">
              <label className="nf-detail-search">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("ui.detail.search")}
                  aria-label={t("ui.detail.search")}
                />
              </label>
              <div className="nf-detail-houses" role="group" aria-label={t("ui.detail.houseFilter")}>
                <Button variant="ghost" size="sm" aria-pressed={house === null} onClick={() => { sound.play("click"); setHouse(null); }}>
                  {t("ui.detail.houseAll")}
                </Button>
                {houses.map((item) => (
                  <Button
                    key={item}
                    variant="ghost"
                    size="sm"
                    aria-pressed={house === item}
                    style={{ "--house-color": houseColor(item) } as CSSProperties}
                    icon={<HouseIcon house={item} size="xs" />}
                    onClick={() => { sound.play("click"); setHouse(item); }}
                  >
                    {houseLabel(item, t)}
                  </Button>
                ))}
              </div>
            </div>

            {groups.length ? groups.map((group) => (
              <section key={group.house} className="nf-detail-group" aria-label={houseLabel(group.house, t)}>
                <h3 className="nf-detail-group-title">
                  <HouseIcon house={group.house} size="xs" /> {houseLabel(group.house, t)} <span>{group.cards.length}</span>
                </h3>
                <ul className="nf-detail-cards">
                  {group.cards.map((card, index) => (
                    <li key={`${card.id}-${index}`}>
                      <button
                        type="button"
                        className="nf-detail-card"
                        aria-current={active === card ? "true" : undefined}
                        onPointerEnter={(event) => { if (event.pointerType === "mouse") setActive(card); }}
                        onFocus={() => setActive(card)}
                        onClick={() => choose(card)}
                      >
                        <CardArt face={card} size="hand" hoverZoom={false} />
                        <span className="nf-detail-card-name">{card.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )) : (
              <div className="nf-card nf-detail-empty">
                <Search size={20} aria-hidden="true" />
                <p>{t("ui.detail.noCards")}</p>
                {filtersOn && <Button variant="ghost" onClick={clearFilters}>{t("ui.detail.clearFilters")}</Button>}
              </div>
            )}
          </div>
        )}

        {tab === "stats" && (
          <div className="nf-detail-stats nf-tab-panel">
            <section className="nf-card" aria-labelledby="nf-detail-rarity">
              <h2 id="nf-detail-rarity" className="nf-card-title">{t("ui.detail.rarity")}</h2>
              <ul className="nf-detail-list">
                {Object.entries(summary.byRarity).map(([rarity, amount]) => (
                  <li key={rarity}><span>{rarity}</span><strong>{amount}</strong></li>
                ))}
              </ul>
            </section>
            <section className="nf-card" aria-labelledby="nf-detail-houses-title">
              <h2 id="nf-detail-houses-title" className="nf-card-title">{t("ui.detail.houses")}</h2>
              <ul className="nf-detail-list">
                {Object.entries(summary.byHouse).map(([item, amount]) => (
                  <li key={item}><span>{houseLabel(item, t)}</span><strong>{amount}</strong></li>
                ))}
              </ul>
            </section>
            <section className="nf-card nf-detail-numbers" aria-label={t("inspect.stats")}>
              <StatBlock label={t("deckStat.unique")} value={summary.unique} />
              <StatBlock label={t("deckStat.armored")} value={summary.armoredCount} />
              <StatBlock label={t("ui.detail.maxPower")} value={summary.maxPower} />
            </section>
          </div>
        )}

        <div className="nf-detail-cta">
          <Button variant="primary" size="lg" icon={<Swords size={18} />} data-action="play-deck" onClick={() => onPlay(deck)}>
            {t("ui.detail.play")}
          </Button>
        </div>
      </div>

      <aside className="nf-detail-pane" aria-label={t("ui.detail.paneTitle")} aria-live="polite">
        <CardPane t={t} card={active} />
      </aside>

      <Sheet open={sheetOpen && active !== null} onClose={() => setSheetOpen(false)} title={active?.title ?? t("ui.detail.paneTitle")} t={t}>
        <CardPane t={t} card={active} />
      </Sheet>
    </div>
  );
}
