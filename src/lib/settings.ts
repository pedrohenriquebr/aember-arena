import type { Difficulty } from "./ai";
import type { Language } from "./i18n";

/** FEAT-11: where the Warden's deck comes from — the player's mirror, a chosen
    library deck (`opponentDeckId`) or a random different library deck. */
export type OpponentMode = "mirror" | "deck" | "random";

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
