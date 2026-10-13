import { Library, Plus } from "lucide-react";
import type { LibraryDeck } from "../../../lib/cache";
import type { DeckInfo } from "../../../lib/game";
import type { Translator } from "../../../lib/i18n";
import type { BrowseState } from "../../../components/useVaultBrowse";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { Button } from "../../primitives/Button";
import { orderLibrary, type LibrarySort } from "../../lib/library";
import { DeckTileV2 } from "../DeckTileV2";
import { VaultBrowser } from "./VaultBrowser";

export type LibraryTab = "mine" | "vault";

export interface LibraryScreenProps {
  t: Translator;
  /** Biblioteca inteira, iniciais incluídos (a aba Meus ordena). */
  savedDecks: LibraryDeck[];
  /** Ids dos decks iniciais: não podem ser removidos e não ganham a etiqueta "salvo". */
  starterIds: ReadonlySet<string>;
  selectedId: string;
  tab: LibraryTab;
  onTab: (tab: LibraryTab) => void;
  sort: LibrarySort;
  onSort: (sort: LibrarySort) => void;
  /** Página, busca e ordem do Vault: vêm do pai para sobreviver à ida ao Detalhe (BUG-15). */
  browse: BrowseState;
  onBrowse: (next: BrowseState) => void;
  offline: boolean;
  onInspect: (deck: DeckInfo) => void;
  onPlay: (deck: DeckInfo) => void;
  onToggleFavorite: (deck: LibraryDeck) => void;
  onRemoveDeck: (deck: LibraryDeck) => void;
  onImport: () => void;
}

/**
 * Decks (UX_REWRITE_PLAN §2 S4): a biblioteca em duas abas. Meus = o que está salvo, favoritos
 * primeiro e ordenável; Vault = a busca do catálogo oficial. Importar abre a folha (H-17).
 */
export function LibraryScreen(props: LibraryScreenProps) {
  const { t, savedDecks, starterIds, selectedId, tab, sort, browse, offline } = props;
  const ordered = orderLibrary(savedDecks, starterIds, sort);
  const hasSaved = savedDecks.some((deck) => !starterIds.has(deck.id));

  return (
    <div className="nf-library nf-screen-enter" data-screen="library">
      <div className="nf-library-head">
        <h1 className="nf-library-title">{t("ui.library.title")}</h1>
        <Button variant="ghost" icon={<Plus size={16} />} onClick={props.onImport}>{t("ui.library.import")}</Button>
      </div>

      <SegmentedControl<LibraryTab>
        label={t("ui.library.title")}
        value={tab}
        onChange={props.onTab}
        options={[
          { value: "mine", label: t("ui.library.tabMine") },
          { value: "vault", label: t("ui.library.tabVault") },
        ]}
      />

      {tab === "mine" && (
        <section className="nf-library-mine nf-tab-panel" aria-label={t("ui.library.tabMine")}>
          <div className="nf-library-sort">
            <SegmentedControl<LibrarySort>
              label={t("ui.library.sortLabel")}
              value={sort}
              onChange={props.onSort}
              options={[
                { value: "shelf", label: t("ui.library.sortShelf") },
                { value: "name", label: t("ui.library.sortName") },
              ]}
            />
          </div>
          {!hasSaved && (
            <p className="nf-card-note">
              <Library size={16} aria-hidden="true" /> {t("ui.library.mineEmpty")}
            </p>
          )}
          <ul className="nf-shelf-grid">
            {ordered.map((deck) => {
              const library = !starterIds.has(deck.id);
              return (
                <li key={deck.id}>
                  <DeckTileV2
                    deck={deck}
                    t={t}
                    variant="mine"
                    selected={selectedId === deck.id}
                    favorite={deck.favorite === true}
                    tag={library ? t("deck.savedOffline") : undefined}
                    onSelect={() => props.onInspect(deck)}
                    onPlay={() => props.onPlay(deck)}
                    onToggleFavorite={library ? () => props.onToggleFavorite(deck) : undefined}
                    onRemove={library ? () => props.onRemoveDeck(deck) : undefined}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {tab === "vault" && (
        <VaultBrowser
          t={t}
          state={browse}
          onStateChange={props.onBrowse}
          offline={offline}
          onInspect={props.onInspect}
        />
      )}
    </div>
  );
}
