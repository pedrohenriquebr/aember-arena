import type { ReactNode } from "react";
import type { Translator } from "../../../lib/i18n";
import type { AppSettings } from "../../../lib/settings";
import { SettingRow, Switch } from "../../primitives/SettingRow";
import type { ThemeId } from "../../theme";
import { ThemePicker } from "./ThemePicker";

/**
 * Aba Interface (UX_REWRITE_PLAN §2 S7). A primeira linha é o Tema (§1.6.2): não passa por
 * AppSettings, vive no próprio motor (applyTheme) e é persistido à parte.
 */
export function InterfaceTab({ t, settings, onChange, hasHover, theme, onTheme, languageMenu }: {
  t: Translator;
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  /** Sem "(hover: hover)" o zoom ao passar some (T5), como na tela v1. */
  hasHover: boolean;
  theme: ThemeId;
  onTheme: (id: ThemeId) => void;
  /** O seletor de idioma é do App (LanguageMenu): entra como slot, como na casca do lobby. */
  languageMenu: ReactNode;
}) {
  return (
    <div className="u-settings-list">
      <div className="u-settings-theme">
        <div className="nf-setting-text">
          <span className="nf-setting-title">{t("ui.theme.title")}</span>
          <span className="nf-setting-desc">{t("ui.settings.themeDesc")}</span>
        </div>
        <ThemePicker t={t} value={theme} onChange={onTheme} />
      </div>

      <SettingRow
        title={t("config.experience.sfx")}
        description={t("config.experience.sfxSub")}
        control={<Switch checked={settings.sfx} label={t("config.experience.sfx")} onChange={(value) => onChange({ ...settings, sfx: value })} />}
      />
      <SettingRow
        title={t("config.experience.music")}
        description={t("config.experience.musicSub")}
        control={<Switch checked={settings.music} label={t("config.experience.music")} onChange={(value) => onChange({ ...settings, music: value })} />}
      />
      <SettingRow
        title={t("config.experience.animations")}
        description={t("config.experience.animationsSub")}
        control={<Switch checked={settings.animations} label={t("config.experience.animations")} onChange={(value) => onChange({ ...settings, animations: value })} />}
      />
      <SettingRow
        title={t("config.experience.view3d")}
        description={t("config.experience.view3dSub")}
        control={
          <Switch
            checked={settings.tableView === "3d"}
            label={t("config.experience.view3d")}
            onChange={(value) => onChange({ ...settings, tableView: value ? "3d" : "2d" })}
          />
        }
      />
      <SettingRow
        title={t("ui.arena.layout")}
        description={t("ui.arena.layoutSub")}
        control={
          <Switch
            checked={settings.tableView === "tcg"}
            label={t("ui.arena.layout")}
            onChange={(value) => onChange({ ...settings, tableView: value ? "tcg" : "2d" })}
          />
        }
      />
      {hasHover && (
        <SettingRow
          title={t("config.experience.zoom")}
          description={t("config.experience.zoomSub")}
          control={<Switch checked={settings.hoverZoom} label={t("config.experience.zoom")} onChange={(value) => onChange({ ...settings, hoverZoom: value })} />}
        />
      )}
      <SettingRow title={t("config.experience.language")} control={languageMenu} />
    </div>
  );
}
