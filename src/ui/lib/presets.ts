import type { Difficulty } from "../../lib/ai";

export type StrengthPreset = "casual" | "standard" | "hard" | "relentless";
export const PRESET_ORDER: StrengthPreset[] = ["casual", "standard", "hard", "relentless"];

export const PRESETS: Record<StrengthPreset, { difficulty: Difficulty; thinkingDepth: number }> = {
  casual:     { difficulty: "Easy",      thinkingDepth: 1 },
  standard:   { difficulty: "Medium",    thinkingDepth: 2 },   // = DEFAULT_SETTINGS
  hard:       { difficulty: "Hard",      thinkingDepth: 4 },
  relentless: { difficulty: "Very hard", thinkingDepth: 6 },
};

/** null = combinação "custom" (aparece só em Avançado). */
export function presetOf(s: { difficulty: Difficulty; thinkingDepth: number }): StrengthPreset | null {
  return PRESET_ORDER.find((id) => PRESETS[id].difficulty === s.difficulty && PRESETS[id].thinkingDepth === s.thinkingDepth) ?? null;
}

export function applyPreset<T extends { difficulty: Difficulty; thinkingDepth: number }>(s: T, p: StrengthPreset): T {
  return { ...s, difficulty: PRESETS[p].difficulty, thinkingDepth: PRESETS[p].thinkingDepth };
}
