import type { Difficulty } from "./ai";
import type { Language } from "./i18n";

/** FEAT-11: where the Warden's deck comes from — the player's mirror, a chosen
    library deck (`opponentDeckId`) or a random different library deck. */
export type OpponentMode = "mirror" | "deck" | "random";

/** FEAT-13: solo against the local AI, or two humans sharing the device. */
export type GameMode = "solo" | "passAndPlay";

/** FIT-08: pausa de leitura entre ações do Warden (ms) — 200..4000, passo 100. */
export const AI_DELAY_MIN = 200;
export const AI_DELAY_MAX = 4000;
export const AI_DELAY_DEFAULT = 1200;
export const clampAiDelay = (value: number) => Math.min(AI_DELAY_MAX, Math.max(AI_DELAY_MIN, Math.round(value / 100) * 100));

/** Fator do hold do voo do Warden: ms/400 entre 0,45 e 3,0 (default 1200 -> 3,0). */
export const aiHoldScale = (delayMs: number) => Math.min(3, Math.max(0.45, delayMs / 400));

/** H3D-01 (VIEW3D_PLAN §2.11): visão da mesa — 2D (padrão, o board de sempre)
    ou 3D (a camada CSS inclinada, ligada pela classe `.game-board--3d`). */
export type TableView = "2d" | "3d";

export interface AppSettings {
  difficulty: Difficulty;
  thinkingDepth: number;
  sfx: boolean;
  music: boolean;
  animations: boolean;
  hoverZoom: boolean;
  /** FEAT-04: highlight cards with a legal move (hand + your battleline). */
  hints: boolean;
  language: Language;
  opponentMode: OpponentMode;
  opponentDeckId?: string;
  gameMode: GameMode;
  /** Pausa de leitura entre ações do Warden; escala as batidas do turno (k = ms / 400). */
  aiDelayMs: number;
  /** H3D-01: "2d" (default) ou "3d" — sobrevive a reload; save antigo lê 2D. */
  tableView: TableView;
  /** FEAT-13: pass-and-play decks, one per human (ids from the library). */
  deckP1Id?: string;
  deckP2Id?: string;
}

const DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard", "Very hard", "Impossible"];
const OPPONENT_MODES: OpponentMode[] = ["mirror", "deck", "random"];

export const DEFAULT_SETTINGS: AppSettings = {
  difficulty: "Medium",
  thinkingDepth: 2,
  sfx: true,
  music: false,
  animations: true,
  hoverZoom: true,
  hints: false,
  language: "en",
  opponentMode: "mirror",
  gameMode: "solo",
  aiDelayMs: AI_DELAY_DEFAULT,
  tableView: "2d",
};

/** Sorteio do baralho do Warden no modo "random"; `rng` injetável para os specs. */
export function drawDeck<T>(pool: readonly T[], rng: () => number = Math.random): T | undefined {
  if (!pool.length) return undefined;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

export function readSettings(fallbackLanguage: Language): AppSettings {
  const base = { ...DEFAULT_SETTINGS, language: fallbackLanguage };
  try {
    const saved = localStorage.getItem("aember-arena-settings");
    if (!saved) return base;
    // `aiSpeed` é o formato antigo do ritmo: "fast" lê 400, o resto o padrão.
    const parsed = JSON.parse(saved) as Partial<AppSettings> & { aiSpeed?: string };
    return {
      difficulty: DIFFICULTIES.includes(parsed.difficulty as Difficulty) ? (parsed.difficulty as Difficulty) : base.difficulty,
      thinkingDepth: Math.min(6, Math.max(1, Number(parsed.thinkingDepth) || base.thinkingDepth)),
      sfx: typeof parsed.sfx === "boolean" ? parsed.sfx : base.sfx,
      music: typeof parsed.music === "boolean" ? parsed.music : base.music,
      animations: typeof parsed.animations === "boolean" ? parsed.animations : base.animations,
      hoverZoom: typeof parsed.hoverZoom === "boolean" ? parsed.hoverZoom : base.hoverZoom,
      hints: typeof parsed.hints === "boolean" ? parsed.hints : base.hints,
      language: parsed.language === "en" || parsed.language === "ptBR" ? parsed.language : base.language,
      opponentMode: OPPONENT_MODES.includes(parsed.opponentMode as OpponentMode) ? (parsed.opponentMode as OpponentMode) : base.opponentMode,
      opponentDeckId: typeof parsed.opponentDeckId === "string" ? parsed.opponentDeckId : base.opponentDeckId,
      gameMode: parsed.gameMode === "passAndPlay" ? "passAndPlay" : base.gameMode,
      aiDelayMs: Number.isFinite(Number(parsed.aiDelayMs)) && parsed.aiDelayMs !== null && parsed.aiDelayMs !== undefined
        ? clampAiDelay(Number(parsed.aiDelayMs))
        : parsed.aiSpeed === "fast" ? 400 : base.aiDelayMs,
      tableView: parsed.tableView === "3d" ? "3d" : base.tableView,
      deckP1Id: typeof parsed.deckP1Id === "string" ? parsed.deckP1Id : base.deckP1Id,
      deckP2Id: typeof parsed.deckP2Id === "string" ? parsed.deckP2Id : base.deckP2Id,
    };
  } catch {
    return base;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem("aember-arena-settings", JSON.stringify(settings));
  } catch {
    // Settings remain active for the session.
  }
}

// ---------- BYOK do pipeline de abilities (catálogo dinâmico, onda 2) ----------
// A chave é do usuário e fica SÓ no localStorage, numa entrada separada das
// settings (que são lidas/serializadas em mais lugares): nunca vai para o bundle,
// para o save de partida, nem para mensagens de erro (redactSecret).

export type LlmPreset = "openai" | "anthropic" | "openrouter" | "custom";

export interface LlmConfig {
  preset: LlmPreset;
  /** Base OpenAI-compatible (sem `/chat/completions`). */
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const LLM_PRESETS: Record<Exclude<LlmPreset, "custom">, { baseUrl: string; model: string; keyUrl: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", keyUrl: "https://platform.openai.com/api-keys" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-haiku-4-5-20251001", keyUrl: "https://console.anthropic.com/settings/keys" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", keyUrl: "https://openrouter.ai/keys" },
};

export const DEFAULT_LLM: LlmConfig = { preset: "openai", baseUrl: LLM_PRESETS.openai.baseUrl, model: LLM_PRESETS.openai.model, apiKey: "" };

const LLM_KEY = "aember-arena-llm";
const LLM_PRESET_IDS: LlmPreset[] = ["openai", "anthropic", "openrouter", "custom"];

/** Preset change: fills base URL + model; "custom" keeps what the user typed. */
export function applyLlmPreset(config: LlmConfig, preset: LlmPreset): LlmConfig {
  if (preset === "custom") return { ...config, preset };
  return { ...config, preset, baseUrl: LLM_PRESETS[preset].baseUrl, model: LLM_PRESETS[preset].model };
}

/** The queue runs only with a key, a base URL and a model. */
export function llmReady(config: LlmConfig): boolean {
  return Boolean(config.apiKey.trim() && config.baseUrl.trim() && config.model.trim());
}

/** Removes the key (and its bearer form) from any text bound for a message/log. */
export function redactSecret(text: string, secret: string): string {
  const key = secret.trim();
  return key.length >= 4 ? text.split(key).join("[redacted]") : text;
}

export function readLlmConfig(): LlmConfig {
  try {
    const saved = localStorage.getItem(LLM_KEY);
    if (!saved) return DEFAULT_LLM;
    const parsed = JSON.parse(saved) as Partial<LlmConfig>;
    const str = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback);
    return {
      preset: LLM_PRESET_IDS.includes(parsed.preset as LlmPreset) ? (parsed.preset as LlmPreset) : DEFAULT_LLM.preset,
      baseUrl: str(parsed.baseUrl, DEFAULT_LLM.baseUrl),
      apiKey: str(parsed.apiKey, ""),
      model: str(parsed.model, DEFAULT_LLM.model),
    };
  } catch {
    return DEFAULT_LLM;
  }
}

export function saveLlmConfig(config: LlmConfig): void {
  try {
    localStorage.setItem(LLM_KEY, JSON.stringify(config));
  } catch {
    // The key stays active for the session.
  }
}
