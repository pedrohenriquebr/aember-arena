import { Play } from "lucide-react";
import type { Translator } from "../../../lib/i18n";
import { Button } from "../../primitives/Button";
import { StatBlock } from "../../primitives/StatBlock";
import { KEYS_TO_WIN, type ResumeInfo } from "../../lib/resume";

/**
 * Partida viva ou salva no Lobby (UX_REWRITE_PLAN §2 S2). É o único primário do card: o
 * botão da força e do oponente ficam secundários, para a tela ter um CTA só.
 */
export function ContinueCard({ t, resume, onContinue }: {
  t: Translator;
  resume: ResumeInfo;
  onContinue: () => void;
}) {
  const youLabel = resume.twoPlayers ? t("ui.lobby.player1") : t("ui.lobby.you");
  const wardenLabel = resume.twoPlayers ? t("ui.lobby.player2") : t("ui.lobby.warden");
  return (
    <section className="nf-card nf-continue" aria-labelledby="nf-continue-title">
      <h2 id="nf-continue-title" className="nf-card-title">{t("ui.lobby.continueTitle")}</h2>
      <div className="nf-continue-stats">
        <StatBlock label={t("ui.lobby.round")} value={resume.round} />
        <StatBlock tone="amber" label={youLabel} value={`${resume.youKeys}/${KEYS_TO_WIN}`} hint={t("ui.lobby.keys")} />
        <StatBlock tone="ember" label={wardenLabel} value={`${resume.wardenKeys}/${KEYS_TO_WIN}`} hint={t("ui.lobby.keys")} />
      </div>
      <Button variant="primary" size="lg" icon={<Play size={18} />} data-action="continue" onClick={onContinue}>
        {t("ui.lobby.continue")}
      </Button>
    </section>
  );
}
