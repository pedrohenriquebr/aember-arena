import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, LoaderCircle, X } from "lucide-react";
import { mergeAbilityOverrides, type AbilityOverride } from "../lib/abilities";
import { deleteAbilityOverride, listCatalogCards, loadAbilityOverrides, putAbilityOverride } from "../lib/cache";
import { parseCardText } from "../lib/cardText";
import { approvedFailures, reviewQueue, validateQueueRows, type RunProgress } from "../lib/catalogLlm";
import { applyLlmPreset, LLM_PRESETS, llmReady, parseExtraHeaders, type LlmConfig, type LlmPreset } from "../lib/settings";
import type { Translator } from "../lib/i18n";

const PRESETS: readonly LlmPreset[] = ["openai", "anthropic", "openrouter", "custom"];

/** BYOK of the ability pipeline (plano §4/§5). Without a key the queue stays
    paused and says so; the key lives in localStorage only (settings.ts). The
    same card fires the translation run (state owned by App, so it survives
    leaving Settings) and lists the drafts awaiting review. */
export function LlmSettings({ config, onChange, catalogCount, run, onTranslate, onCancel, t }: {
  config: LlmConfig;
  onChange: (next: LlmConfig) => void;
  /** Cartas em disco: sem catálogo não há o que traduzir. */
  catalogCount: number;
  /** Rodada em andamento, ou null (dona: App, como o sync do catálogo). */
  run: RunProgress | null;
  onTranslate: () => void;
  onCancel: () => void;
  t: Translator;
}) {
  const ready = llmReady(config);
  const rawHeaders = (config.extraHeaders ?? "").trim();
  const headersBad = rawHeaders !== "" && Object.keys(parseExtraHeaders(rawHeaders)).length === 0;
  const keyUrl = config.preset === "custom" ? null : LLM_PRESETS[config.preset].keyUrl;
  const [drafts, setDrafts] = useState<AbilityOverride[]>([]);
  const [approved, setApproved] = useState<AbilityOverride[]>([]);
  const [titles, setTitles] = useState<Map<string, string>>(new Map());
  const [importNote, setImportNote] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  // A fila vem do store (rascunhos e falhas não revisados); o título, do
  // catálogo. Recarrega ao montar e quando a rodada termina. Uma falha que o
  // parser cobre hoje é zumbi: o catálogo diz quais, e reviewQueue as poda
  // (higiene do pipeline, §4.0).
  const refresh = useCallback(() => {
    void Promise.all([loadAbilityOverrides(), listCatalogCards()]).then(([rows, cards]) => {
      const covered = new Set(cards.filter((card) => parseCardText(card).coverage === "full").map((card) => card.id));
      setDrafts(reviewQueue([...rows.values()], (id) => covered.has(id)));
      setApproved(approvedFailures([...rows.values()]));
    });
  }, []);
  useEffect(() => {
    refresh();
    void listCatalogCards().then((cards) => setTitles(new Map(cards.map((card) => [card.id, card.title]))));
  }, [refresh]);
  const lastRun = useRef<RunProgress | null>(null);
  useEffect(() => {
    if (lastRun.current && !run) refresh();
    lastRun.current = run;
  }, [run, refresh]);

  /** Aprovar: `reviewed: true` no store e no mapa vivo (o motor lê na hora). */
  async function approve(row: AbilityOverride) {
    const reviewed: AbilityOverride = { ...row, reviewed: true };
    await putAbilityOverride(reviewed);
    mergeAbilityOverrides(new Map([[reviewed.cardId, reviewed]]));
    refresh();
  }

  /** Reabrir uma falha aprovada: volta à fila e, pelo contrato de versão, é
      re-tentada. O merge é inofensivo (falha não afeta o motor). */
  async function reopen(row: AbilityOverride) {
    const reopened: AbilityOverride = { ...row, reviewed: false };
    await putAbilityOverride(reopened);
    mergeAbilityOverrides(new Map([[reopened.cardId, reopened]]));
    refresh();
  }

  /** Rejeitar: some do store — a próxima rodada pode tentar de novo. */
  async function reject(row: AbilityOverride) {
    await deleteAbilityOverride(row.cardId);
    refresh();
  }

  /** Transporte no teto (5) sai da fila sozinho. Zerar `tries` devolve a carta
      à próxima rodada sem apagar o motivo (Lote 6 §2). */
  async function retryTransport(row: AbilityOverride) {
    await putAbilityOverride({ ...row, tries: 0 });
    refresh();
  }

  /** Importar a fila do harvest: valida tudo antes de gravar; reviewed:true entra
      como regra (mesmo gating de sempre, o mapa vivo só vale na próxima partida). */
  async function importQueue(file: File) {
    let rows: unknown;
    try {
      rows = JSON.parse(await file.text());
    } catch {
      rows = null;
    }
    if (!Array.isArray(rows)) { setImportNote(t("config.llm.importBad")); return; }
    try {
      const [cards, existing] = await Promise.all([listCatalogCards(), loadAbilityOverrides()]);
      const { valid, rejected } = validateQueueRows(rows, cards, existing);
      for (const row of valid) await putAbilityOverride(row);
      mergeAbilityOverrides(new Map(valid.filter((row) => row.reviewed).map((row) => [row.cardId, row])));
      const reasons = [...new Set(rejected.map((item) => t(`config.llm.importReason.${item.reason}`)))].join(", ");
      setImportNote(t("config.llm.importDone", { ok: valid.length, skipped: rejected.length }) + (reasons ? t("config.llm.importReasons", { reasons }) : ""));
    } catch {
      setImportNote(t("config.llm.importError"));
    }
    refresh();
  }

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
      <label>
        <span>{t("config.llm.extraHeaders")}</span>
        <input type="text" value={config.extraHeaders ?? ""} spellCheck={false} autoComplete="off" placeholder={'{"x-opencode-session":"..."}'}
          aria-invalid={headersBad} style={headersBad ? { borderColor: "var(--danger, #e5484d)" } : undefined}
          onChange={(event) => onChange({ ...config, extraHeaders: event.target.value })} />
      </label>
      <p className="deck-input-hint">{t("config.llm.extraHeadersHint")}</p>
      {keyUrl && (
        <a className="llm-link" href={keyUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={13} /> {t("config.llm.getKey")}
        </a>
      )}
      <p className={`llm-status${ready ? "" : " llm-status--paused"}`} role="status">{ready ? t("config.llm.ready") : t("config.llm.paused")}</p>
      <div className="catalog-row">
        <button type="button" className="ghost-button" onClick={onTranslate} disabled={!ready || catalogCount === 0 || run !== null}>
          {run && <LoaderCircle size={15} className="spin" />}
          {run ? t("config.llm.running", { done: run.done, total: run.total, drafted: run.drafted, failed: run.failed }) : t("config.llm.translate")}
        </button>
        {run && (
          <button type="button" className="ghost-button" onClick={onCancel}>
            <X size={15} /> {t("common.cancel")}
          </button>
        )}
      </div>
      <div className="llm-review">
        <span className="review-label">{t("config.llm.review", { count: drafts.length })}</span>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importQueue(file);
        }} />
        <button type="button" className="ghost-button" onClick={() => fileInput.current?.click()}>{t("config.llm.import")}</button>
        {importNote && <p className="deck-input-hint" role="status">{importNote}</p>}
        {drafts.length === 0 ? (
          <p className="deck-input-hint">{t("config.llm.reviewEmpty")}</p>
        ) : (
          <ul className="llm-review-list">
            {drafts.map((row) => (
              <li key={row.cardId} className="llm-review-row">
                <div>
                  <strong>{titles.get(row.cardId) ?? row.cardId}</strong>
                  <small className="llm-review-meta">
                    {row.model ? `${row.model} · ` : ""}{row.textHash.slice(0, 8)} · {row.failure ?? t("config.llm.validated")}
                  </small>
                </div>
                <div className="llm-review-actions">
                  {row.failure?.startsWith("llm.") && (row.tries ?? 0) >= 5 && (
                    <button type="button" className="ghost-button" onClick={() => void retryTransport(row)}>{t("config.llm.retry")}</button>
                  )}
                  <button type="button" className="ghost-button" onClick={() => void approve(row)}>{t("config.llm.approve")}</button>
                  <button type="button" className="ghost-button" onClick={() => void reject(row)}>{t("config.llm.reject")}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {approved.length > 0 && (
          <details>
            <summary className="review-label">{t("config.llm.reopenTitle", { count: approved.length })}</summary>
            <ul className="llm-review-list">
              {approved.map((row) => (
                <li key={row.cardId} className="llm-review-row">
                  <div>
                    <strong>{titles.get(row.cardId) ?? row.cardId}</strong>
                    <small className="llm-review-meta">{row.textHash.slice(0, 8)} · {row.failure}</small>
                  </div>
                  <div className="llm-review-actions">
                    <button type="button" className="ghost-button" onClick={() => void reopen(row)}>{t("config.llm.reopen")}</button>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
