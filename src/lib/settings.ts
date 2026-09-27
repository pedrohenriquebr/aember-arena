import type { Difficulty } from "./ai";
import type { Language } from "./i18n";

export interface AppSettings {
  difficulty: Difficulty;
  thinkingDepth: number;
  sfx: boolean;
  music: boolean;
  animations: boolean;
  hoverZoom: boolean;
  language: Language;
}

const DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard", "Very hard", "Impossible"];

export const DEFAULT_SETTINGS: AppSettings = {
  difficulty: "Medium",
  thinkingDepth: 2,
  sfx: true,
  music: false,
  animations: true,
  hoverZoom: true,
  language: "en",
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
      language: parsed.language === "en" || parsed.language === "ptBR" ? parsed.language : base.language,
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
