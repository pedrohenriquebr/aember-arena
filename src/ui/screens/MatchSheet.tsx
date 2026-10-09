import { describeAiThinking, type Difficulty } from "../../lib/ai";
import type { LibraryDeck } from "../../lib/cache";
import type { DeckInfo } from "../../lib/game";
import type { Translator } from "../../lib/i18n";
import { type AppSettings, type GameMode } from "../../lib/settings";
import { Button } from "../primitives/Button";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { Sheet } from "../primitives/Sheet";
import { pickPassDeck, resolvePassDecks } from "../lib/passDecks";
import { applyPreset, presetOf } from "../lib/presets";
import { OpponentPicker } from "./OpponentPicker";
import { StrengthPicker } from "./StrengthPicker";

const DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard", "Very hard", "Impossible"];

export interface MatchSheetProps {
  open: boolean;
  t: Translator;
  onClose: () => void;
  /** Deck do hero (Jogador 1 no solo; no 2P o Jogador 1 sai de resolvePassDecks). */
  deck: DeckInfo;
  savedDecks: LibraryDeck[];
  settings: AppSettings;
  randomRival: DeckInfo | undefined;
  /** Nome do oponente solo (espelho, deck escolhido ou sorteado): calculado pelo App. */
  opponentLabel: string;
  /** Mesma escrita da ConfigScreen: a folha não tem estado próprio das configurações. */
  onChange: (next: AppSettings) => void;
  /** Joga com este deck: o mesmo caminho do Jogar do Lobby (playDeck no App). */
  onPlay: (deck: DeckInfo) => void;
}

/**
 * S3 (UX_REWRITE_PLAN §2): ajuste fino opcional da partida numa folha só, sem "Próximo".
 * Modo, oponente (ou os dois decks no 2P), força e um resumo vivo que diz o que vai acontecer.
 */
export function MatchSheet({ open, t, onClose, deck, savedDecks, settings, randomRival, opponentLabel, onChange, onPlay }: MatchSheetProps) {
  const pass = settings.gameMode === "passAndPlay";
  const choices = savedDecks.filter((item) => item.id !== deck.id);
  const [p1, p2] = resolvePassDecks(savedDecks, deck, settings);
  // No 2P o mesmo deck dos dois lados não joga: o Jogar fica travado e a linha explica.
  const sameDeck = pass && p1.id === p2.id;
  const preset = presetOf(settings);
  const strengthText = preset ? t(`ui.strength.${preset}`) : describeAiThinking(settings);
  const summary = pass
    ? t("ui.match.versus", { a: p1.name, b: p2.name })
    : `${t("ui.match.versus", { a: deck.name, b: opponentLabel })} · ${strengthText}`;

  const footer = (
    <Button variant="primary" size="lg" data-action="match-play" disabled={sameDeck} onClick={() => onPlay(pass ? p1 : deck)}>
      {t("ui.match.play")}
    </Button>
  );

  return (
    <Sheet open={open} onClose={onClose} title={t("ui.match.title")} t={t} footer={footer}>
      <div className="nf-match">
        <section className="nf-match-section">
          <h3 className="nf-match-h">{t("config.step.mode")}</h3>
          <SegmentedControl<GameMode>
            label={t("config.step.mode")}
            value={settings.gameMode}
            onChange={(gameMode) => onChange({ ...settings, gameMode })}
            options={[
              { value: "solo", label: t("config.mode.solo") },
              { value: "passAndPlay", label: t("config.mode.passAndPlay") },
            ]}
          />
        </section>

        {pass ? (
          <section className="nf-match-section">
            <h3 className="nf-match-h">{t("config.decks.title")}</h3>
            <label className="nf-match-field">
              <span>{t("config.decks.p1")}</span>
              <select
                className="nf-select"
                value={p1.id}
                onChange={(event) => onChange({ ...settings, ...pickPassDeck(savedDecks, deck, settings, 1, event.target.value) })}
              >
                {savedDecks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="nf-match-field">
              <span>{t("config.decks.p2")}</span>
              <select
                className="nf-select"
                value={p2.id}
                onChange={(event) => onChange({ ...settings, ...pickPassDeck(savedDecks, deck, settings, 2, event.target.value) })}
              >
                {savedDecks.filter((item) => item.id !== p1.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            {sameDeck && <p className="nf-match-warn" role="alert">{t("ui.match.sameDeck")}</p>}
          </section>
        ) : (
          <>
            <section className="nf-match-section">
              <h3 className="nf-match-h">{t("config.step.opponent")}</h3>
              <OpponentPicker t={t} settings={settings} decks={choices} randomRival={randomRival} onChange={onChange} />
            </section>

            <section className="nf-match-section">
              <h3 className="nf-match-h">{t("ui.match.strength")}</h3>
              <StrengthPicker t={t} value={preset} onChange={(next) => onChange(applyPreset(settings, next))} />
              <details className="nf-match-advanced">
                <summary>{t("ui.match.advanced")}</summary>
                <div className="nf-match-advanced-body">
                  <label className="nf-match-field">
                    <span>{t("config.step.difficulty")}</span>
                    <select
                      className="nf-select"
                      value={settings.difficulty}
                      onChange={(event) => onChange({ ...settings, difficulty: event.target.value as Difficulty })}
                    >
                      {DIFFICULTIES.map((level) => <option key={level} value={level}>{t(`difficulty.${level}`)}</option>)}
                    </select>
                  </label>
                  <label className="nf-match-field">
                    <span>{t("config.thinking.title")} · {settings.thinkingDepth}</span>
                    <input
                      type="range"
                      className="nf-range"
                      min={1}
                      max={6}
                      step={1}
                      value={settings.thinkingDepth}
                      onChange={(event) => onChange({ ...settings, thinkingDepth: Number(event.target.value) })}
                    />
                  </label>
                  <p className="nf-card-note">{describeAiThinking(settings)}</p>
                </div>
              </details>
            </section>
          </>
        )}

        <section className="nf-match-summary" aria-live="polite">
          <h3 className="nf-match-h">{t("ui.match.summary")}</h3>
          <p>{summary}</p>
        </section>
      </div>
    </Sheet>
  );
}
