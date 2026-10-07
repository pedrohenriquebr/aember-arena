// SPDX-License-Identifier: AGPL-3.0-only
// Leitura das pilhas laterais (chips do HUD + overlay): descarte público nos dois
// lados, arquivo virado (só o dono abre o seu) e grid ordenado de forma estável.
import { describe, expect, it } from "vitest";
import { canOpenPile, pileCount, sortPile } from "./piles";
import { card, setupTest, titles } from "./testkit";

describe("piles (chips do HUD + overlay)", () => {
  it("discard is public: both sides open it face-up", () => {
    expect(canOpenPile("discard", 0, 0)).toBe(true);
    expect(canOpenPile("discard", 1, 0)).toBe(true);
    expect(canOpenPile("discard", 0, 1)).toBe(true);
    expect(canOpenPile("discard", 1, 1)).toBe(true);
  });

  it("archives are face-down: only the owner opens theirs", () => {
    expect(canOpenPile("archives", 0, 0)).toBe(true);
    expect(canOpenPile("archives", 1, 1)).toBe(true);
    expect(canOpenPile("archives", 1, 0)).toBe(false);
    expect(canOpenPile("archives", 0, 1)).toBe(false);
  });

  it("counts the live zones of each player", () => {
    const state = setupTest({ discard: ["Rhetoric", "Squallmaster"] }, { discard: ["Bad Penny"] });
    state.players[0].archives = [card("Urchin"), card("Seismo-Entangler")];
    expect(pileCount(state.players[0], "discard")).toBe(2);
    expect(pileCount(state.players[0], "archives")).toBe(2);
    expect(pileCount(state.players[1], "discard")).toBe(1);
    expect(pileCount(state.players[1], "archives")).toBe(0);
  });

  it("orders the overlay grid alphabetically by title", () => {
    const pile = [card("Zulu Tip"), card("Alpha Tip"), card("midnight Tip")];
    expect(titles(sortPile(pile))).toEqual(["Alpha Tip", "midnight Tip", "Zulu Tip"]);
  });

  it("does not touch the pile the engine owns", () => {
    const pile = [card("Zulu Tip"), card("Alpha Tip")];
    const sorted = sortPile(pile);
    expect(titles(pile)).toEqual(["Zulu Tip", "Alpha Tip"]);
    expect(sorted).not.toBe(pile);
  });

  it("breaks ties by type and instance id so re-renders never shuffle equals", () => {
    const sameA = card("Twin Tip", { type: "Action" });
    const sameB = card("Twin Tip", { type: "Action" });
    const creature = card("Twin Tip", { type: "Creature" });
    const once = sortPile([sameA, creature, sameB]);
    const twice = sortPile([sameB, sameA, creature]);
    expect(once.map((item) => item.instanceId)).toEqual(twice.map((item) => item.instanceId));
    // "Action" antes de "Creature"; entre as iguais, a instância mais antiga.
    expect(once).toEqual([sameA, sameB, creature]);
  });

  it("renders an empty grid for an empty pile", () => {
    expect(sortPile([])).toEqual([]);
  });
});
