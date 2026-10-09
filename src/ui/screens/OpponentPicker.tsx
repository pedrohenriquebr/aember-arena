import type { LibraryDeck } from "../../lib/cache";
import type { DeckInfo } from "../../lib/game";
import type { Translator } from "../../lib/i18n";
import { type AppSettings, type OpponentMode } from "../../lib/settings";
import { SegmentedControl } from "../primitives/SegmentedControl";

const OPPONENT_MODES: OpponentMode[] = ["mirror", "deck", "random"];

/**
 * Oponente do Warden (UX_REWRITE_PLAN §2 S3): espelho, um deck da biblioteca ou sorteado.
 * Escolher "deck" sem um escolhido pega o primeiro, como o passo Oponente da v1.
 */
export function OpponentPicker({ t, settings, decks, randomRival, onChange }: {
  t: Translator;
  settings: AppSettings;
  /** Biblioteca sem o deck do hero (o espelho nunca aparece na própria lista). */
  decks: LibraryDeck[];
  randomRival: DeckInfo | undefined;
  onChange: (next: AppSettings) => void;
}) {
  const picked = decks.find((item) => item.id === settings.opponentDeckId);
  const choose = (mode: OpponentMode) => {
    const opponentDeckId = mode === "deck" && !picked ? decks[0]?.id : settings.opponentDeckId;
    onChange({ ...settings, opponentMode: mode, opponentDeckId });
  };

  return (
    <div className="nf-match-opponent">
      <SegmentedControl<OpponentMode>
        label={t("config.opponent.title")}
        value={settings.opponentMode}
        onChange={choose}
        options={OPPONENT_MODES.map((mode) => ({ value: mode, label: t(`config.opponent.${mode}`) }))}
      />
      {settings.opponentMode === "deck" && (
        decks.length ? (
          <select
            className="nf-select"
            aria-label={t("config.opponent.pick")}
            value={picked?.id ?? ""}
            onChange={(event) => onChange({ ...settings, opponentDeckId: event.target.value })}
          >
            {!picked && <option value="" disabled>{t("config.opponent.none")}</option>}
            {decks.map((deck) => (
              <option key={deck.id} value={deck.id}>{deck.name}</option>
            ))}
          </select>
        ) : (
          <p className="nf-card-note">{t("config.opponent.none")}</p>
        )
      )}
      <p className="nf-card-note">
        {settings.opponentMode === "random" && randomRival
          ? t("ui.match.drawn", { name: randomRival.name })
          : t(`config.opponent.${settings.opponentMode}Sub`)}
      </p>
    </div>
  );
}
