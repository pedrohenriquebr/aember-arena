import { afterEach, describe, expect, it, vi } from "vitest";
import { readSettings } from "./settings";

function seed(saved: unknown) {
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(saved) });
  return readSettings("en").aiDelayMs;
}

describe("aiDelayMs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to 700 and migrates the old aiSpeed", () => {
    expect(seed({})).toBe(700);
    expect(seed({ aiSpeed: "fast" })).toBe(300);
    expect(seed({ aiSpeed: "normal" })).toBe(700);
  });

  it("clamps to 200..2000 in steps of 100", () => {
    expect(seed({ aiDelayMs: 50 })).toBe(200);
    expect(seed({ aiDelayMs: 99999 })).toBe(2000);
    expect(seed({ aiDelayMs: 1234 })).toBe(1200);
    expect(seed({ aiDelayMs: "abc" })).toBe(700);
  });
});
