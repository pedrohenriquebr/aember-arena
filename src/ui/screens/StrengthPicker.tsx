import type { Translator } from "../../lib/i18n";
import { PRESET_ORDER, type StrengthPreset } from "../lib/presets";
import { SegmentedControl } from "../primitives/SegmentedControl";

/**
 * Força do Warden em quatro degraus (UX_REWRITE_PLAN §2 S3). Usado no Lobby e na MatchSheet:
 * o mesmo controle, o mesmo efeito (applyPreset sobre as settings). `null` = personalizada.
 */
export function StrengthPicker({ t, value, onChange }: {
  t: Translator;
  value: StrengthPreset | null;
  onChange: (preset: StrengthPreset) => void;
}) {
  return (
    <SegmentedControl<StrengthPreset>
      label={t("ui.match.strength")}
      value={value}
      onChange={onChange}
      options={PRESET_ORDER.map((id) => ({ value: id, label: t(`ui.strength.${id}`) }))}
    />
  );
}
