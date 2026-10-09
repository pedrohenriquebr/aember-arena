import type { Translator } from "../../../lib/i18n";
import { sound } from "../../../lib/sound";
import type { AppSettings } from "../../../lib/settings";
import { applyPreset, presetOf } from "../../lib/presets";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { SettingRow, Switch } from "../../primitives/SettingRow";
import { StrengthPicker } from "../StrengthPicker";

type PaceId = "fast" | "normal" | "slow";

// Os mesmos três ritmos da tela v1 (config.speed.*); fora deles o controle fica sem marcação.
const PACE: { id: PaceId; ms: number }[] = [
  { id: "fast", ms: 400 },
  { id: "normal", ms: 1200 },
  { id: "slow", ms: 2400 },
];

/** Aba Jogo de Ajustes (UX_REWRITE_PLAN §2 S7): força do Warden, ritmo da IA e dicas. */
export function GameTab({ t, settings, onChange, formatDelay }: {
  t: Translator;
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  /** Segundos por ação no idioma atual (dono: App, que já formata o ritmo da tela v1). */
  formatDelay: (ms: number) => string;
}) {
  return (
    <div className="u-settings-list">
      <SettingRow
        title={t("ui.match.strength")}
        description={t("ui.settings.strengthDesc")}
        control={<StrengthPicker t={t} value={presetOf(settings)} onChange={(preset) => onChange(applyPreset(settings, preset))} />}
      />
      <SettingRow
        title={t("config.experience.speed")}
        description={`${t("config.experience.speedSub")} · ${t("config.speed.value", { s: formatDelay(settings.aiDelayMs) })}`}
        control={
          <SegmentedControl<PaceId>
            label={t("config.experience.speed")}
            value={PACE.find((pace) => pace.ms === settings.aiDelayMs)?.id ?? null}
            onChange={(id) => onChange({ ...settings, aiDelayMs: PACE.find((pace) => pace.id === id)?.ms ?? settings.aiDelayMs })}
            options={PACE.map((pace) => ({ value: pace.id, label: t(`config.speed.${pace.id}`) }))}
          />
        }
      />
      <SettingRow
        title={t("config.experience.hints")}
        description={t("config.experience.hintsSub")}
        control={
          <Switch
            checked={settings.hints}
            label={t("config.experience.hints")}
            onChange={(value) => { if (value) sound.play("sparkle"); onChange({ ...settings, hints: value }); }}
          />
        }
      />
    </div>
  );
}
