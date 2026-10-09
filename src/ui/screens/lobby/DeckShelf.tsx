import { Library, Plus } from "lucide-react";
import type { DeckInfo } from "../../../lib/game";
import type { Translator } from "../../../lib/i18n";
import { DeckTile } from "../../../components/DeckTile";
import type { LibraryDeck } from "../../../lib/cache";
import { Button } from "../../primitives/Button";

/**
 * Prateleira "Seus decks" (UX_REWRITE_PLAN §2 S2): os tiles da biblioteca em grade, com
 * Importar e Explorar o Vault ao lado. Sem decks salvos, diz o caminho em vez de deixar
 * a grade só com os iniciais sem explicação.
 */
export function DeckShelf({ t, decks, starterIds, selectedId, hasSaved, onPlay, onSelect, onInspect, onToggleFavorite, onRemove, onImport, onExplore }: {
  t: Translator;
  decks: LibraryDeck[];
  starterIds: ReadonlySet<string>;
  selectedId: string;
  hasSaved: boolean;
  onPlay: (deck: DeckInfo) => void;
  onSelect: (deck: DeckInfo) => void;
  onInspect: (deck: DeckInfo) => void;
  onToggleFavorite: (deck: LibraryDeck) => void;
  onRemove: (deck: LibraryDeck) => void;
  onImport: () => void;
  onExplore: () => void;
}) {
  return (
    <section className="nf-shelf" aria-labelledby="nf-shelf-title">
      <div className="nf-shelf-head">
        <h2 id="nf-shelf-title" className="nf-card-title">{t("ui.lobby.shelfTitle")}</h2>
        <div className="nf-shelf-actions">
          <Button variant="ghost" icon={<Plus size={16} />} onClick={onImport}>{t("ui.lobby.import")}</Button>
          <Button variant="ghost" icon={<Library size={16} />} onClick={onExplore}>{t("ui.lobby.explore")}</Button>
        </div>
      </div>
      {!hasSaved && <p className="nf-card-note">{t("ui.lobby.shelfEmpty")}</p>}
      <ul className="nf-shelf-grid">
        {decks.map((deck) => {
          const library = !starterIds.has(deck.id);
          return (
            <li key={deck.id}>
              <DeckTile
                deck={deck}
                t={t}
                variant="mine"
                selected={selectedId === deck.id}
                favorite={deck.favorite === true}
                tag={library ? t("deck.savedOffline") : undefined}
                onSelect={() => onSelect(deck)}
                onPlay={() => onPlay(deck)}
                onInspect={() => onInspect(deck)}
                onToggleFavorite={library ? () => onToggleFavorite(deck) : undefined}
                onRemove={library ? () => onRemove(deck) : undefined}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
