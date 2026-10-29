import { afterEach, describe, expect, it, vi } from "vitest";
import { aiHoldScale, drawDeck, readSettings, saveSettings } from "./settings";

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

describe("tableView", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the Arena layout ('tcg') through save and read", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
    saveSettings({ ...readSettings("en"), tableView: "tcg" });
    expect(readSettings("en").tableView).toBe("tcg");
  });

  it("reads an unknown value as the 2D default", () => {
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ tableView: "foo" }) });
    expect(readSettings("en").tableView).toBe("2d");
  });
});

describe("drawDeck", () => {
  const pool = ["a", "b", "c"];

  it("is deterministic for an injected rng and covers the whole pool", () => {
    expect(drawDeck(pool, () => 0)).toBe("a");
    expect(drawDeck(pool, () => 0.34)).toBe("b");
    expect(drawDeck(pool, () => 0.999)).toBe("c");
  });

  it("never reads past the pool and returns undefined when it is empty", () => {
    expect(drawDeck(pool, () => 1)).toBe("c");
    expect(drawDeck([], () => 0)).toBeUndefined();
    expect(pool).toContain(drawDeck(pool));
  });
});
