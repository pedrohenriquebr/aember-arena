import { ArrowLeft, CloudOff, LoaderCircle, Search, SearchX, Swords, WifiOff, X } from "lucide-react";
import type { DeckInfo } from "../lib/game";
import { vaultErrorText } from "../lib/keyforgeApi";
import type { Translator } from "../lib/i18n";
import { sound } from "../lib/sound";
import { HouseMark, DeckTile } from "./DeckTile";
import { Pagination } from "./Pagination";
import { useVaultBrowse, VAULT_ORDERINGS, VAULT_PAGE_SIZE, type BrowseState } from "./useVaultBrowse";

export type { BrowseState } from "./useVaultBrowse";

export function DeckBrowser({
  t,
  offline,
  catalogCount,
  onBack,
  onInspect,
  onUseDeck,
  /** Controlled view state: lifted so Vault -> Inspect -> Back keeps page and
      search instead of resetting to page 1 (BUG-15). */
  state,
  onStateChange,
}: {
  t: Translator;
  offline: boolean;
  /** DB v4 (plano §5): cards in the local catalog; 0 hides the chip. */
  catalogCount: number;
  onBack: () => void;
  onInspect: (deck: DeckInfo) => void;
  onUseDeck: (deck: DeckInfo) => void;
  state?: BrowseState;
  onStateChange?: (next: BrowseState) => void;
}) {
  const { view, pendingSearch, setPendingSearch, decks, count, loading, error, noResults, totalPages, setView, submitSearch, clearSearch } = useVaultBrowse({ state, onStateChange });
  const { page, search, ordering } = view;
  const errorText = error ? vaultErrorText(error, t) : "";

  return (
    <div className="screen browse-screen">
      <div className="sub-head">
        <button type="button" className="icon-back" onClick={() => { sound.play("click"); onBack(); }} aria-label={t("common.back")}>
          <ArrowLeft size={16} />
        </button>
        <div>
          <span className="eyebrow">{t("browse.eyebrow")}</span>
          <h1>{t("browse.title")}</h1>
        </div>
      </div>

      <div className="browse-toolbar">
        <form className="browse-search" onSubmit={submitSearch}>
          <Search size={14} />
          <input
            value={pendingSearch}
            onChange={(event) => setPendingSearch(event.target.value)}
            placeholder={t("browse.searchPlaceholder")}
            aria-label={t("browse.searchPlaceholder")}
          />
          {pendingSearch && (
            <button type="button" className="search-clear" onClick={() => { clearSearch(); }} aria-label={t("common.close")}>
              ×
            </button>
          )}
        </form>

        <div className="browse-sorts" role="group" aria-label={t("browse.sortLabel")}>
          {VAULT_ORDERINGS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sort-chip${ordering === item.id ? " is-active" : ""}`}
              onClick={() => { sound.play("click"); setView({ page: 1, ordering: item.id }); }}
            >
              {t(item.key)}
            </button>
          ))}
        </div>
      </div>

      <div className="browse-status">
        {loading ? (
          <span className="status-line status-line--busy"><LoaderCircle size={13} className="spin" /> {t("common.loading")}</span>
        ) : error ? (
          <span className="status-line status-line--warn">
            {noResults ? <SearchX size={13} /> : offline ? <WifiOff size={13} /> : <CloudOff size={13} />} {errorText}
          </span>
        ) : (
          <span className="status-line">
            <Swords size={13} />
            {t("browse.resultCount", { count: count.toLocaleString(t("meta.locale")) })}
          </span>
        )}
        {!loading && !error && (
          <span className="status-page">{t("browse.pageOf", { page, total: totalPages.toLocaleString(t("meta.locale")) })}</span>
        )}
        {/* DB v4 (plano §5): o catálogo sincronizado aparece junto do status. */}
        {catalogCount > 0 && (
          <span className="meta-chip">{t("catalog.chip", { count: catalogCount.toLocaleString(t("meta.locale")) })}</span>
        )}
      </div>

      {loading && (
        <div className="deck-grid">
          {Array.from({ length: VAULT_PAGE_SIZE }).map((_, index) => (
            <div className="deck-skeleton" key={index}>
              <span className="skeleton-art" />
              <span className="skeleton-lines"><i /><i /><i /></span>
            </div>
          ))}
        </div>
      )}

      {!loading && noResults && (
        <div className="browse-empty">
          <span className="browse-empty-icon"><SearchX size={22} /></span>
          <strong>{t("browse.noResultsTitle", { query: search })}</strong>
          <p>{t("browse.noResultsBody")}</p>
          <button type="button" className="ghost-button" onClick={() => { sound.play("click"); clearSearch(); }}>
            <X size={15} /> {t("browse.clearSearch")}
          </button>
        </div>
      )}

      {!loading && Boolean(error) && !noResults && (
        <div className="browse-empty">
          <span className="browse-empty-icon"><CloudOff size={22} /></span>
          <strong>{t("browse.offlineTitle")}</strong>
          <p>{t("browse.offlineBody")}</p>
          <button type="button" className="ghost-button" onClick={() => { sound.play("click"); onBack(); }}>
            <ArrowLeft size={15} /> {t("browse.useSaved")}
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="deck-grid deck-grid--browse">
            {decks.map((deck) => (
              <DeckTile
                key={deck.id}
                deck={deck}
                t={t}
                tag={deck.powerLevel ? `${t("deck.power")} ${deck.powerLevel}` : undefined}
                onInspect={() => onInspect(deck)}
                onSelect={() => onUseDeck(deck)}
              />
            ))}
          </div>
          <div className="browse-pager">
            <Pagination page={page} totalPages={totalPages} onChange={(next) => { sound.play("click"); setView({ page: next }); window.scrollTo({ top: 0, behavior: "smooth" }); }} label={t("browse.pagerLabel")} t={t} />
            <span className="pager-hint">{t("browse.pagerHint")}</span>
          </div>
        </>
      )}

      {/* VA-12: no erro as casas soltas pareciam um loader quebrado — só enfeitam a lista. */}
      {!error && (
        <div className="browse-houses" aria-hidden="true">
          {["Brobnar", "Dis", "Logos", "Sanctum", "Shadows", "Untamed", "Mars"].map((house) => (
            <HouseMark key={house} house={house} small />
          ))}
        </div>
      )}
    </div>
  );
}
