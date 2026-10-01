import { ExternalLink } from "lucide-react";
import { applyLlmPreset, LLM_PRESETS, llmReady, type LlmConfig, type LlmPreset } from "../lib/settings";
import type { Translator } from "../lib/i18n";

const PRESETS: readonly LlmPreset[] = ["openai", "anthropic", "openrouter", "custom"];

/** BYOK of the ability pipeline (plano §4/§5). Without a key the queue stays
    paused and says so; the key lives in localStorage only (settings.ts). */
export function LlmSettings({ config, onChange, t }: { config: LlmConfig; onChange: (next: LlmConfig) => void; t: Translator }) {
  const ready = llmReady(config);
  const keyUrl = config.preset === "custom" ? null : LLM_PRESETS[config.preset].keyUrl;
  return (
    <div className="llm-form">
      <p className="deck-input-hint">{t("config.llm.hint")}</p>
      <label>
        <span>{t("config.llm.provider")}</span>
        <select value={config.preset} onChange={(event) => onChange(applyLlmPreset(config, event.target.value as LlmPreset))}>
          {PRESETS.map((id) => <option key={id} value={id}>{t(`config.llm.preset.${id}`)}</option>)}
        </select>
      </label>
      <label>
        <span>{t("config.llm.baseUrl")}</span>
        <input type="url" value={config.baseUrl} spellCheck={false} autoComplete="off" onChange={(event) => onChange({ ...config, preset: "custom", baseUrl: event.target.value })} />
      </label>
      <label>
        <span>{t("config.llm.key")}</span>
        <input type="password" value={config.apiKey} spellCheck={false} autoComplete="off" onChange={(event) => onChange({ ...config, apiKey: event.target.value })} />
      </label>
      <label>
        <span>{t("config.llm.model")}</span>
        <input type="text" value={config.model} spellCheck={false} autoComplete="off" onChange={(event) => onChange({ ...config, model: event.target.value })} />
      </label>
      {keyUrl && (
        <a className="llm-link" href={keyUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={13} /> {t("config.llm.getKey")}
        </a>
      )}
      <p className={`llm-status${ready ? "" : " llm-status--paused"}`} role="status">{ready ? t("config.llm.ready") : t("config.llm.paused")}</p>
    </div>
  );
}
