import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../lib/settings";
import { applyPreset, PRESET_ORDER, PRESETS, presetOf } from "./presets";

describe("presets da força do Warden (UX_REWRITE_PLAN §5 H-13)", () => {
  it("round-trip applyPreset → presetOf para os 4 presets", () => {
    for (const id of PRESET_ORDER) {
      const applied = applyPreset({ difficulty: "Impossible" as const, thinkingDepth: 3 }, id);
      expect(presetOf(applied)).toBe(id);
    }
  });

  it("valores fora dos presets viram null (combinação personalizada)", () => {
    expect(presetOf({ difficulty: "Impossible", thinkingDepth: 2 })).toBeNull();
    expect(presetOf({ difficulty: "Medium", thinkingDepth: 3 })).toBeNull();
    expect(presetOf({ difficulty: "Easy", thinkingDepth: 2 })).toBeNull();
  });

  it("o padrão do app é o preset Padrão", () => {
    expect(presetOf(DEFAULT_SETTINGS)).toBe("standard");
    expect(PRESETS.standard).toEqual({ difficulty: DEFAULT_SETTINGS.difficulty, thinkingDepth: DEFAULT_SETTINGS.thinkingDepth });
  });

  it("applyPreset não muda o resto das configurações", () => {
    const next = applyPreset({ ...DEFAULT_SETTINGS, sfx: false }, "hard");
    expect(next.sfx).toBe(false);
    expect(next.difficulty).toBe("Hard");
    expect(next.thinkingDepth).toBe(4);
  });
});
