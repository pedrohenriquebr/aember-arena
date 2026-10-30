import { BookOpen, CircleHelp, History, LogOut, PanelRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import type { Translator } from "../../lib/i18n";
import { AI_PACES as SPEEDS } from "../../lib/settings";
import { Button } from "../primitives/Button";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { SettingRow, Switch } from "../primitives/SettingRow";
import { Sheet } from "../primitives/Sheet";

export type TableMenuProps = {
  t: Translator;
  open: boolean;
  onClose: () => void;
  view3d: boolean;
  onToggleView: () => void;
  /** H-ATL-01: Layout Arena (só com a v2; o App não passa `true` na v1). */
  tcg: boolean;
  onToggleTcg: () => void;
  sfx: boolean;
  onToggleSfx: () => void;
  music: boolean;
  onToggleMusic: () => void;
  /** Ritmo do Warden; undefined na passagem de aparelho (não há Warden para acelerar). */
  aiDelayMs?: number;
  onAiDelay?: (ms: number) => void;
  /** Só existe no drawer (<1041px): no desktop as notas já estão ao lado da mesa. */
  onOpenNotes?: () => void;
  onOpenLog: () => void;
  /** Regras rápidas: o App monta o texto (depende do custo da chave na partida). */
  rules: ReactNode;
  onTutorial: () => void;
  onExit: () => void;
};

/**
 * ☰ da mesa (UX_REWRITE_PLAN §5 H-09): agrupa o que saiu do chrome — mesa 2D/3D, sair para o
 * lobby, tutorial — e as ações do rail que não cabem mais na linha do console. Os interruptores
 * mantêm a folha aberta (ajuste); as ações de navegação fecham antes de agir.
 */
export function TableMenu({ t, open, onClose, view3d, onToggleView, tcg, onToggleTcg, sfx, onToggleSfx, music, onToggleMusic, aiDelayMs, onAiDelay, onOpenNotes, onOpenLog, rules, onTutorial, onExit }: TableMenuProps) {
  const rulesId = useId();
  const [rulesOpen, setRulesOpen] = useState(false);
  // O preset mais próximo do valor atual (AI_PACES, o mesmo da Config): um ritmo fora deles ainda marca um.
  const speedValue = aiDelayMs === undefined ? "" : SPEEDS.reduce((best, s) => (Math.abs(s.ms - aiDelayMs) < Math.abs(best.ms - aiDelayMs) ? s : best)).id;
  const closeThen = (fn: () => void) => () => { onClose(); fn(); };

  return (
    <Sheet open={open} onClose={onClose} title={t("ui.table.menu")} t={t}>
      <div className="nf-table-menu">
        <Button variant="primary" size="lg" onClick={onClose}>{t("ui.table.continue")}</Button>

        <div className="nf-table-menu-group">
          <Button variant="ghost" icon={<History size={18} />} onClick={closeThen(onOpenLog)}>{t("log.full")}</Button>
          <Button variant="ghost" icon={<CircleHelp size={18} />} aria-expanded={rulesOpen} aria-controls={rulesId} onClick={() => setRulesOpen((value) => !value)}>
            {t("rail.quickRules")}
          </Button>
          <div id={rulesId} className="nf-table-menu-rules" hidden={!rulesOpen}>{rules}</div>
          {onOpenNotes && (
            <Button variant="ghost" icon={<PanelRight size={18} />} onClick={closeThen(onOpenNotes)}>{t("ui.table.notes")}</Button>
          )}
        </div>

        <div className="nf-table-menu-group">
          <SettingRow
            title={t("ui.table.view3d")}
            control={<Switch checked={view3d} onChange={onToggleView} label={t("ui.table.view3d")} />}
          />
          <SettingRow
            title={t("ui.table.arena")}
            control={<Switch checked={tcg} onChange={onToggleTcg} label={t("ui.table.arena")} />}
          />
          <SettingRow
            title={t("config.experience.sfx")}
            control={<Switch checked={sfx} onChange={onToggleSfx} label={t("config.experience.sfx")} />}
          />
          <SettingRow
            title={t("config.experience.music")}
            control={<Switch checked={music} onChange={onToggleMusic} label={t("config.experience.music")} />}
          />
          {aiDelayMs !== undefined && onAiDelay && (
            <SettingRow
              title={t("config.experience.speed")}
              control={(
                <SegmentedControl
                  label={t("config.experience.speed")}
                  value={speedValue}
                  options={SPEEDS.map((s) => ({ value: s.id, label: t(`config.speed.${s.id}`) }))}
                  onChange={(id) => onAiDelay(SPEEDS.find((s) => s.id === id)?.ms ?? aiDelayMs)}
                />
              )}
            />
          )}
        </div>

        <div className="nf-table-menu-group">
          <Button variant="ghost" icon={<BookOpen size={18} />} onClick={closeThen(onTutorial)}>{t("tutorial.open")}</Button>
          <Button variant="secondary" icon={<LogOut size={18} />} onClick={closeThen(onExit)}>{t("ui.table.exit")}</Button>
        </div>
      </div>
    </Sheet>
  );
}
