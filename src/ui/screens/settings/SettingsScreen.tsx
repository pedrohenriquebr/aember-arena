import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Translator } from "../../../lib/i18n";
import { sound } from "../../../lib/sound";
import type { AppSettings, LlmConfig } from "../../../lib/settings";
import type { RunProgress } from "../../../lib/catalogLlm";
import type { CatalogProgress } from "../../../lib/keyforgeApi";
import { applyTheme, readTheme, type ThemeId } from "../../theme";
import { AboutTab } from "./AboutTab";
import { DataTab } from "./DataTab";
import { GameTab } from "./GameTab";
import { InterfaceTab } from "./InterfaceTab";
import { LabTab } from "./LabTab";

type Tab = "game" | "interface" | "data" | "lab" | "about";
const TABS: Tab[] = ["game", "interface", "data", "lab", "about"];

/**
 * Ajustes da v2 (UX_REWRITE_PLAN §2 S7). As abas são tablist: setas e Home/End trocam a aba
 * (e o foco), como no padrão ARIA. Cada aba recebe só o que usa; nada de AppSettings novo aqui.
 */
export function SettingsScreen({ t, settings, onChange, hasHover, languageMenu, formatDelay, online, catalogCount, catalogSync, onSyncCatalog, onCancelCatalog, onSyncDeck, deckSyncing, updateReady, onReloadUpdate, llm, onLlmChange, llmRun, onLlmTranslate, onLlmCancel, onOpenTutorial }: {
  t: Translator;
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  hasHover: boolean;
  languageMenu: ReactNode;
  formatDelay: (ms: number) => string;
  // H-19 (aba Dados e offline): estado que continua dono do App (sync, atualização, rede).
  online: boolean;
  catalogCount: number;
  catalogSync: CatalogProgress | null;
  onSyncCatalog: () => void;
  onCancelCatalog: () => void;
  onSyncDeck: () => void;
  deckSyncing: boolean;
  updateReady: boolean;
  onReloadUpdate: () => void;
  // H-20 (abas Laboratório e Sobre): o LlmSettings e o wizard são do App, sem mudar de dono.
  llm: LlmConfig;
  onLlmChange: (next: LlmConfig) => void;
  llmRun: RunProgress | null;
  onLlmTranslate: () => void;
  onLlmCancel: () => void;
  onOpenTutorial: () => void;
}) {
  const [tab, setTab] = useState<Tab>("game");
  // O tema vigente vive aqui: a Interface mostra o que está aplicado, não o que foi salvo antes.
  const [theme, setTheme] = useState<ThemeId>(() => readTheme());
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);

  const pickTheme = (id: ThemeId) => {
    sound.play("select");
    applyTheme(id);
    setTheme(id);
  };

  const selectTab = (index: number) => {
    setTab(TABS[index]);
    tabButtons.current[index]?.focus();
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") selectTab((index + 1) % TABS.length);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") selectTab((index - 1 + TABS.length) % TABS.length);
    else if (event.key === "Home") selectTab(0);
    else if (event.key === "End") selectTab(TABS.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <div className="nf-settings nf-screen-enter" data-screen="settings">
      <h1 className="nf-settings-title">{t("ui.settings.title")}</h1>
      <div className="nf-settings-layout">
        <div role="tablist" aria-label={t("ui.settings.tabs")} className="nf-settings-tabs">
          {TABS.map((id, index) => (
            <button
              key={id}
              ref={(node) => { tabButtons.current[index] = node; }}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`settings-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              className={`nf-settings-tab${tab === id ? " is-active" : ""}`}
              onClick={() => setTab(id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              {t(`ui.settings.tab.${id}`)}
            </button>
          ))}
        </div>

        {/* key por aba: a troca remonta o painel e o cruzamento de opacidade roda (H-28). */}
        <div key={tab} role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`} className="nf-settings-panel nf-tab-panel">
          {tab === "game" && <GameTab t={t} settings={settings} onChange={onChange} formatDelay={formatDelay} />}
          {tab === "interface" && (
            <InterfaceTab
              t={t}
              settings={settings}
              onChange={onChange}
              hasHover={hasHover}
              theme={theme}
              onTheme={pickTheme}
              languageMenu={languageMenu}
            />
          )}
          {tab === "data" && (
            <DataTab
              t={t}
              online={online}
              catalogCount={catalogCount}
              catalogSync={catalogSync}
              onSyncCatalog={onSyncCatalog}
              onCancelCatalog={onCancelCatalog}
              onSyncDeck={onSyncDeck}
              deckSyncing={deckSyncing}
              updateReady={updateReady}
              onReloadUpdate={onReloadUpdate}
            />
          )}
          {tab === "lab" && (
            <LabTab
              t={t}
              llm={llm}
              onLlmChange={onLlmChange}
              catalogCount={catalogCount}
              llmRun={llmRun}
              onLlmTranslate={onLlmTranslate}
              onLlmCancel={onLlmCancel}
            />
          )}
          {tab === "about" && <AboutTab t={t} onOpenTutorial={onOpenTutorial} />}
        </div>
      </div>
    </div>
  );
}
