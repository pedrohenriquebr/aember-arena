import { afterEach, describe, expect, it, vi } from "vitest";
import { aiHoldScale, readSettings } from "./settings";

function seed(saved: unknown) {
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(saved) });
  return readSettings("en").aiDelayMs;
}

describe("aiDelayMs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to 1200 and migrates the old aiSpeed", () => {
    expect(seed({})).toBe(1200);
    expect(seed({ aiSpeed: "fast" })).toBe(400);
    expect(seed({ aiSpeed: "normal" })).toBe(1200);
  });

  it("clamps to 200..4000 in steps of 100", () => {
    expect(seed({ aiDelayMs: 50 })).toBe(200);
    expect(seed({ aiDelayMs: 99999 })).toBe(4000);
    expect(seed({ aiDelayMs: 1234 })).toBe(1200);
    expect(seed({ aiDelayMs: "abc" })).toBe(1200);
  });

  it("scales the flight hold without the old 1.6 ceiling", () => {
    expect(Math.round(420 * aiHoldScale(1200))).toBe(1260);
    expect(aiHoldScale(4000)).toBe(3);
    expect(aiHoldScale(400)).toBe(1);
    expect(aiHoldScale(200)).toBe(0.5);
  });
});
