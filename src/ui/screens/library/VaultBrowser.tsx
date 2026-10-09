import { Search, SearchX, WifiOff } from "lucide-react";
import type { DeckInfo } from "../../../lib/game";
import { vaultErrorText } from "../../../lib/keyforgeApi";
import type { Translator } from "../../../lib/i18n";
import { useVaultBrowse, VAULT_ORDERINGS, VAULT_PAGE_SIZE, type BrowseState } from "../../../components/useVaultBrowse";
import { Button } from "../../primitives/Button";
import { Skeleton } from "../../primitives/Skeleton";
import { DeckTileV2 } from "../DeckTileV2";
import { PagerCompact } from "./PagerCompact";

/**
 * Aba Vault da biblioteca (UX_REWRITE_PLAN §2 S4). Mesma API e mesmo BrowseState da v1
 * (useVaultBrowse, BUG-15): a página e a busca sobrevivem à ida ao Detalhe. Offline não chama
 * a rede: mostra o banner e a aba Meus segue funcionando ao lado.
 */
export function VaultBrowser({ t, state, onStateChange, offline, onInspect }: {
  t: Translator;
  state: BrowseState;
  onStateChange: (next: BrowseState) => void;
  offline: boolean;
  onInspect: (deck: DeckInfo) => void;
}) {
  const { view, pendingSearch, setPendingSearch, decks, count, loading, error, noResults, totalPages, setView, submitSearch, clearSearch } = useVaultBrowse({
    state,
    onStateChange,
    enabled: !offline,
  });
  const { page, search, ordering } = view;

  return (
    <section className="nf-vault" aria-label={t("ui.library.tabVault")}>
      {offline && (
        <p className="nf-banner" role="status">
          <WifiOff size={16} aria-hidden="true" />
          <span>{t("ui.library.offlineBanner")}</span>
        </p>
      )}

      <form className="nf-vault-search" role="search" onSubmit={submitSearch}>
        <Search size={16} aria-hidden="true" />
        <input
          value={pendingSearch}
          onChange={(event) => setPendingSearch(event.target.value)}
          placeholder={t("ui.library.searchLabel")}
          aria-label={t("ui.library.searchLabel")}
          disabled={offline}
        />
        <Button type="submit" variant="secondary" disabled={offline}>{t("ui.library.searchGo")}</Button>
      </form>

      <div className="nf-vault-sorts" role="group" aria-label={t("ui.library.sortLabel")}>
        {VAULT_ORDERINGS.map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            size="sm"
            aria-pressed={ordering === item.id}
            disabled={offline}
            onClick={() => setView({ page: 1, ordering: item.id })}
          >
            {t(item.key)}
          </Button>
        ))}
      </div>

      {!offline && (
        <p className="nf-vault-status" aria-busy={loading || undefined}>
          {loading ? t("common.loading") : error ? "" : t("browse.resultCount", { count: count.toLocaleString(t("meta.locale")) })}
        </p>
      )}

      {!offline && loading && (
        <ul className="nf-shelf-grid" aria-hidden="true">
          {Array.from({ length: VAULT_PAGE_SIZE }, (_, index) => (
            <li key={index}><Skeleton height="120px" shape="block" /></li>
          ))}
        </ul>
      )}

      {!offline && !loading && noResults && (
        <div className="nf-card nf-vault-empty">
          <SearchX size={22} aria-hidden="true" />
          <p>{t("ui.library.noResults", { query: search })}</p>
          <Button variant="ghost" onClick={clearSearch}>{t("ui.library.clearSearch")}</Button>
        </div>
      )}

      {!offline && !loading && !noResults && Boolean(error) && (
        <p className="nf-card-note" role="alert">{vaultErrorText(error, t)}</p>
      )}

      {!offline && !loading && !error && (
        <>
          <ul className="nf-shelf-grid">
            {decks.map((deck) => (
              <li key={deck.id}>
                <DeckTileV2
                  deck={deck}
                  t={t}
                  variant="vault"
                  tag={deck.powerLevel ? `${t("deck.power")} ${deck.powerLevel}` : undefined}
                  onSelect={() => onInspect(deck)}
                />
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <PagerCompact t={t} page={page} totalPages={totalPages} onChange={(next) => { setView({ page: next }); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
          )}
        </>
      )}
    </section>
  );
}
