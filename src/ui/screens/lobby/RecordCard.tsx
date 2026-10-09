import { Eye } from "lucide-react";
import type { DeckStats } from "../../../lib/cache";
import type { Translator } from "../../../lib/i18n";
import { Button } from "../../primitives/Button";
import { StatBlock } from "../../primitives/StatBlock";

/**
 * Recorde local do deck selecionado (V/D de `getDeckStats`). Só mostra o que foi gravado:
 * sem partida, diz isso em vez de zeros que parecem resultado.
 */
export function RecordCard({ t, record, canReplay, onReplay }: {
  t: Translator;
  record: DeckStats | null;
  canReplay: boolean;
  onReplay: () => void;
}) {
  return (
    <section className="nf-card nf-record" aria-labelledby="nf-record-title">
      <h2 id="nf-record-title" className="nf-card-title">{t("ui.lobby.recordTitle")}</h2>
      {record ? (
        <div className="nf-record-stats">
          <StatBlock tone="verdant" label={t("ui.lobby.wins")} value={record.wins} />
          <StatBlock tone="ember" label={t("ui.lobby.losses")} value={record.losses} />
        </div>
      ) : (
        <p className="nf-card-note">{t("ui.lobby.noRecord")}</p>
      )}
      {canReplay && (
        <Button variant="ghost" icon={<Eye size={16} />} onClick={onReplay}>{t("ui.lobby.replay")}</Button>
      )}
    </section>
  );
}
