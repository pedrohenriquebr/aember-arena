import { describe, expect, it } from "vitest";
import { HOUSES } from "./houses";

describe("BUG2-15 house initials fallback (docs/BUGS_ROUND2.md)", () => {
  it("keeps the initials of glyph-less houses unique", () => {
    const shorts = Object.values(HOUSES)
      .filter((house) => !house.glyph)
      .map((house) => house.short);
    expect(new Set(shorts).size).toBe(shorts.length);
  });
});
