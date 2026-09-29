import type { Difficulty } from "./ai";
import type { Language } from "./i18n";

/** FEAT-11: where the Warden's deck comes from — the player's mirror, a chosen
    library deck (`opponentDeckId`) or a random different library deck. */
export type OpponentMode = "mirror" | "deck" | "random";

/** FEAT-13: solo against the local AI, or two humans sharing the device. */
export type GameMode = "solo" | "passAndPlay";

/** Onda 2 (ANIM §3): ritmo do turno da IA — normal (leitura) ou compactado. */
export type AiSpeed = "normal" | "fast";

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
  /** Onda 2: duração das batidas do turno do Warden. */
  aiSpeed: AiSpeed;
  /** FEAT-13: pass-and-play decks, one per human (ids from the library). */
  deckP1Id?: string;
  deckP2Id?: string;
}

const DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard", "Very hard", "Impossible"];
const OPPONENT_MODES: OpponentMode[] = ["mirror", "deck", "random"];
const AI_SPEEDS: AiSpeed[] = ["normal", "fast"];

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
  aiSpeed: "normal",
};

export function readSettings(fallbackLanguage: Language): AppSettings {
  const base = { ...DEFAULT_SETTINGS, language: fallbackLanguage };
  try {
    const saved = localStorage.getItem("aember-arena-settings");
    if (!saved) return base;
    const parsed = JSON.parse(saved) as Partial<AppSettings>;
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
      aiSpeed: AI_SPEEDS.includes(parsed.aiSpeed as AiSpeed) ? (parsed.aiSpeed as AiSpeed) : base.aiSpeed,
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
