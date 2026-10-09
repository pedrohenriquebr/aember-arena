import { LoaderCircle, Plus, RefreshCw, Swords } from "lucide-react";
import { useId, type FormEvent } from "react";
import { CardArt } from "../../../components/CardArt";
import { HouseIcon } from "../../../components/HouseIcon";
import type { DeckInfo } from "../../../lib/game";
import { houseLabel } from "../../../lib/houses";
import type { Translator } from "../../../lib/i18n";
import { parseDeckId } from "../../../lib/deckId";
import { Button } from "../../primitives/Button";
import { Sheet } from "../../primitives/Sheet";
import { Skeleton } from "../../primitives/Skeleton";

export interface ImportSheetProps {
  t: Translator;
  deckInput: string;
  setDeckInput: (value: string) => void;
  /** Pré-visualização do deck buscado (ou do cache); null = nada buscado ainda. */
  candidate: DeckInfo | null;
  loading: boolean;
  /** Mensagem de falha já traduzida (vaultErrorText); vazia = sem erro. */
  error: string;
  /** A pré-visualização veio do cache offline, não da rede. */
  fromCache: boolean;
  onFetch: (event: FormEvent<HTMLFormElement>) => void;
  onAdd: () => void;
  onAddAndPlay: () => void;
  onClose: () => void;
}

/**
 * Importar deck (UX_REWRITE_PLAN §2 S6, §5 H-17): um campo que aceita UUID ou link do Vault, a
 * pré-visualização do candidato e as duas saídas — guardar na biblioteca ou guardar e jogar. Os
 * estados são C (buscando), E (falhou) e S (pronto); "do cache" marca a cópia offline. A busca e
 * o salvamento (cacheDeck com saved:true) ficam no App, como no DeckModal que esta folha substitui.
 */
export function ImportSheet({
  t, deckInput, setDeckInput, candidate, loading, error, fromCache, onFetch, onAdd, onAddAndPlay, onClose,
}: ImportSheetProps) {
  const inputId = useId();
  const typed = deckInput.trim() !== "";
  const detected = parseDeckId(deckInput) !== null;
  const invalid = typed && !detected;

  const footer = candidate && !loading ? (
    <div className="nf-import-actions">
      <Button variant="secondary" icon={<Plus size={16} />} onClick={onAdd}>{t("ui.import.addLibrary")}</Button>
      <Button variant="primary" icon={<Swords size={16} />} data-action="import-play" onClick={onAddAndPlay}>{t("ui.import.addPlay")}</Button>
    </div>
  ) : undefined;

  return (
    <Sheet open onClose={onClose} title={t("ui.import.title")} footer={footer} t={t}>
      <p className="nf-import-intro">{t("ui.import.intro")}</p>

      <form className="nf-import-form" onSubmit={onFetch}>
        <label htmlFor={inputId}>{t("ui.import.inputLabel")}</label>
        <div className="nf-import-row">
          <input
            id={inputId}
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            value={deckInput}
            placeholder={t("ui.import.placeholder")}
            aria-invalid={invalid || undefined}
            aria-describedby={`${inputId}-hint`}
            onChange={(event) => setDeckInput(event.target.value)}
          />
          <Button type="submit" variant="secondary" disabled={loading || !detected} icon={loading ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}>
            {loading ? t("common.loading") : t("ui.import.submit")}
          </Button>
        </div>
        <span id={`${inputId}-hint`} className={invalid ? "nf-import-hint nf-import-hint--error" : "nf-import-hint"}>
          {invalid ? t("ui.import.invalid") : t("deck.hint")}
        </span>
      </form>

      {/* C: buscando. Os blocos mantêm a altura do preview para a folha não pular quando chega. */}
      {loading && (
        <div className="nf-import-preview" role="status" aria-live="polite">
          <Skeleton width="120px" height="168px" shape="block" />
          <div className="nf-import-copy">
            <Skeleton width="60%" height="1.2em" />
            <Skeleton width="40%" height="1em" />
            <span className="nf-import-note">{t("ui.import.loading")}</span>
          </div>
        </div>
      )}

      {/* E: falhou e não há cópia offline. A mensagem vem do vault.* (describeFailure). */}
      {!loading && error && (
        <p className="nf-import-error" role="alert">{error}</p>
      )}

      {/* S: pronto para guardar ou jogar. */}
      {!loading && candidate && (
        <div className="nf-import-preview" aria-live="polite">
          <CardArt face={candidate.cards[0]} size="preview" hoverZoom={false} />
          <div className="nf-import-copy">
            <p className="nf-import-source">{fromCache ? t("ui.import.fromCache") : t("deck.masterVault")}</p>
            <h3 className="nf-import-name">{candidate.name}</h3>
            <p className="nf-import-note">{candidate.cards.length} {t("common.cards")}</p>
            <ul className="nf-import-houses" aria-label={t("ui.import.houses")}>
              {candidate.houses.map((house) => (
                <li key={house}>
                  <HouseIcon house={house} size="sm" /> {houseLabel(house, t)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {!loading && !candidate && !error && (
        <p className="nf-import-note">{t("ui.import.empty")}</p>
      )}
    </Sheet>
  );
}
