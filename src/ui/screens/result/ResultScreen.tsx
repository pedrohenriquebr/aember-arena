import { useEffect, useMemo, useState } from "react";
import { Crown, Eye, Home, Layers, RotateCcw } from "lucide-react";
import type { DeckStats } from "../../../lib/cache";
import type { GameState } from "../../../lib/game";
import type { Translator } from "../../../lib/i18n";
import { useDialogFocus } from "../../../components/useDialogFocus";
import { summarizeMatch } from "../../lib/matchSummary";
import { Button } from "../../primitives/Button";
import { cx } from "../../primitives/cx";

// UX_REWRITE_PLAN §2 S9 / §5 H-22: o fim da partida (S9) é um overlay sobre a mesa, com um
// único clímax — a contagem dos stats sobe em COUNT_MS (abaixo do teto de 700ms). Com
// reduced-motion (ou animações desligadas) os valores finais aparecem direto.
const COUNT_MS = 600;

const STAT_ROWS = ["amberGained", "amberStolen", "amberCaptured", "creaturesDestroyed", "cardsPlayed", "keys"] as const;
const STAT_LABEL = {
  amberGained: "stats.amberGained",
  amberStolen: "stats.amberStolen",
  amberCaptured: "stats.amberCaptured",
  creaturesDestroyed: "stats.creaturesDestroyed",
  cardsPlayed: "stats.cardsPlayed",
  keys: "ui.result.keys",
} as const;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Progresso 0→1 em COUNT_MS. `run` falso já começa no fim: nenhum frame de contagem. */
function useCountProgress(run: boolean): number {
  const [progress, setProgress] = useState(run ? 0 : 1);
  useEffect(() => {
    if (!run) {
      setProgress(1);
      return;
    }
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const next = Math.min(1, (now - started) / COUNT_MS);
      setProgress(next);
      if (next < 1) frame = requestAnimationFrame(tick);
    };
    setProgress(0);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [run]);
  return progress;
}

export interface ResultScreenProps {
  t: Translator;
  game: GameState;
  /** Nomes localizados dos lados (App.localizeName): "Você"/"O Warden" ou "Jogador 1/2". */
  sideNames: [string, string];
  passAndPlay: boolean;
  /** settings.animations: o reduced-motion do SO é checado aqui dentro. */
  animate: boolean;
  /** Recorde do deck DEPOIS de gravar esta partida (App). Null omite o cartão. */
  record: DeckStats | null;
  canReplay: boolean;
  onRematch: () => void;
  onChooseDeck: () => void;
  onReplay: () => void;
  onLobby: () => void;
}

export function ResultScreen({ t, game, sideNames, passAndPlay, animate, record, canReplay, onRematch, onChooseDeck, onReplay, onLobby }: ResultScreenProps) {
  const summary = useMemo(() => summarizeMatch(game), [game]);
  // Fixo na montagem: a contagem não recomeça se o SO mudar o reduced-motion no meio.
  const [counting] = useState(() => animate && !prefersReducedMotion());
  const progress = useCountProgress(counting);
  const dialogRef = useDialogFocus<HTMLDivElement>();
  if (!summary) return null;

  const won = summary.winner === 0;
  const title = passAndPlay
    ? t("game.playerWin", { name: sideNames[summary.winner] })
    : won ? t("game.youWin") : t("game.aiWin");
  const shown = (value: number) => Math.round(value * progress);
  // Chaves por lado a partir da timeline: se somam menos que o contador, o log cortou o começo.
  const marksOf = (side: 0 | 1) => summary.forgeTimeline.filter((mark) => mark.side === side).length;
  const timelinePartial = summary.sides.some((stats, side) => marksOf(side as 0 | 1) < stats.keys);

  return (
    <div className="nf-result-shade" data-screen="result">
      <div ref={dialogRef} className={cx("nf-result", won ? "nf-result--won" : "nf-result--lost")} role="dialog" aria-modal="true" aria-labelledby="nf-result-title" tabIndex={-1}>
        <header className="nf-result-head">
          <span className="nf-result-emblem" aria-hidden="true"><Crown size={24} /></span>
          <span className="nf-result-eyebrow">{t("game.matchComplete")}</span>
          <h2 id="nf-result-title">{title}</h2>
          {!passAndPlay && <p className="nf-result-sub">{won ? t("game.youWinSub") : t("game.aiWinSub")}</p>}
        </header>

        {/* Revanche é o primeiro foco e o único primary: "empurrar o próximo" (S9). */}
        <div className="nf-result-actions">
          <Button variant="primary" size="lg" icon={<RotateCcw size={16} />} onClick={onRematch}>{t("game.rematch")}</Button>
          <Button variant="secondary" icon={<Layers size={16} />} onClick={onChooseDeck}>{t("ui.result.chooseDeck")}</Button>
          {canReplay && <Button variant="ghost" icon={<Eye size={16} />} onClick={onReplay}>{t("game.replay")}</Button>}
          <Button variant="ghost" icon={<Home size={16} />} onClick={onLobby}>{t("ui.result.lobby")}</Button>
        </div>

        <section className="nf-result-block" aria-labelledby="nf-result-duel">
          <h3 id="nf-result-duel" className="nf-result-h">{t("ui.result.duel")}</h3>
          <p className="nf-result-rounds">{t("stats.rounds")}: <strong>{summary.rounds}</strong></p>
          <table className="nf-result-duel-table">
            <thead>
              <tr>
                <td />
                <th scope="col">{sideNames[0]}</th>
                <th scope="col">{sideNames[1]}</th>
              </tr>
            </thead>
            <tbody>
              {STAT_ROWS.map((key) => (
                <tr key={key} data-stat={key}>
                  <th scope="row">{t(STAT_LABEL[key])}</th>
                  <td data-side="0">{shown(summary.sides[0][key])}</td>
                  <td data-side="1">{shown(summary.sides[1][key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="nf-result-block" aria-labelledby="nf-result-timeline">
          <h3 id="nf-result-timeline" className="nf-result-h">{t("ui.result.timeline")}</h3>
          {summary.forgeTimeline.length ? (
            <ol className="nf-result-marks">
              {summary.forgeTimeline.map((mark, index) => (
                <li key={index} className="nf-result-mark" data-side={mark.side}>
                  {t("ui.result.mark", { round: mark.turn, side: sideNames[mark.side] })}
                </li>
              ))}
            </ol>
          ) : (
            <p className="nf-result-note">{t("ui.result.timelineEmpty")}</p>
          )}
          {timelinePartial && <p className="nf-result-note">{t("ui.result.timelinePartial")}</p>}
        </section>

        {!passAndPlay && record && (
          <section className="nf-result-block nf-result-record" aria-label={t("ui.result.record")}>
            <span className="nf-result-h">{t("ui.result.record")}</span>
            <strong>{t("stats.local", { wins: record.wins, losses: record.losses })}</strong>
            <span className="nf-result-delta">{won ? t("ui.result.deltaWin") : t("ui.result.deltaLoss")}</span>
          </section>
        )}

        <p className="nf-result-seed">{t("game.seed", { seed: game.seed })}</p>
      </div>
    </div>
  );
}
