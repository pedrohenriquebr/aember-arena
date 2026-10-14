// SPDX-License-Identifier: AGPL-3.0-only
// QA-03: Trawler jogava vanilla (sem entry no seed keyteki). As specs passam pelo
// vendoredOverrides() REAL — provam que a linha do seed chega ao motor.
import { afterEach, describe, expect, it } from "vitest";
import { setAbilityOverrides } from "./abilities";
import { applyMove } from "./game";
import { card, setupTest } from "./testkit";
import { vendoredOverrides } from "./vendored";

// Texto do MV: o glifo de Æmber é U+F360 (o hash do seed é sobre esse texto).
const TEXT = "Play: If you are haunted, capture all your opponent’s .\n";
const IDS = ["ca5f5ab1-f6a6-454e-a995-116c7f3d9100", "a94f91e2-786d-4722-b0cc-d3cac14e5075"];

const trawler = (id = IDS[0]) => card("Trawler", { id, type: "Creature", house: "Unfathomable", power: 4, text: TEXT });
const junk = (n: number) => Array.from({ length: n }, (_, index) => card(`Junk${index}`));
const warden = () => card("Warden", { type: "Creature", house: "Brobnar", power: 3, text: "" });

afterEach(() => setAbilityOverrides(new Map()));

describe("Trawler (QA-03)", () => {
  it.each(IDS)("seed row %s reaches the engine: haunted captures the whole opponent pool onto Trawler", (id) => {
    setAbilityOverrides(vendoredOverrides());
    const t = trawler(id);
    const state = setupTest({ hand: [t], discard: junk(10), amber: 2 }, { amber: 4 }, "Unfathomable");
    const after = applyMove(state, 0, { type: "play", instanceId: t.instanceId });
    const onBoard = after.players[0].board.find((item) => item.instanceId === t.instanceId)!;
    expect(onBoard.amber).toBe(4);
    expect(after.players[1].amber).toBe(0);
    expect(after.players[0].amber).toBe(2); // the capture does not touch the owner's pool
    // Play fires although the creature enters exhausted (exhaust blocks reap/fight, not the trigger).
    expect(onBoard.ready).toBe(false);
  });

  it("not haunted (9 cards in the discard) captures nothing", () => {
    setAbilityOverrides(vendoredOverrides());
    const t = trawler();
    const state = setupTest({ hand: [t], discard: junk(9) }, { amber: 4 }, "Unfathomable");
    const after = applyMove(state, 0, { type: "play", instanceId: t.instanceId });
    expect(after.players[0].board[0].amber ?? 0).toBe(0);
    expect(after.players[1].amber).toBe(4);
  });

  it("amber already captured on an enemy creature stays there (pool only)", () => {
    setAbilityOverrides(vendoredOverrides());
    const t = trawler();
    const foe = warden();
    foe.amber = 3;
    const state = setupTest({ hand: [t], discard: junk(10) }, { inPlay: [foe], amber: 4 }, "Unfathomable");
    const after = applyMove(state, 0, { type: "play", instanceId: t.instanceId });
    expect(after.players[0].board.find((item) => item.instanceId === t.instanceId)?.amber).toBe(4);
    expect(after.players[1].board[0].amber).toBe(3);
  });

  it("an empty opponent pool captures zero", () => {
    setAbilityOverrides(vendoredOverrides());
    const t = trawler();
    const state = setupTest({ hand: [t], discard: junk(10) }, {}, "Unfathomable");
    const after = applyMove(state, 0, { type: "play", instanceId: t.instanceId });
    expect(after.players[0].board[0].amber ?? 0).toBe(0);
  });

  it("without the seed the card is vanilla (guards the spec itself)", () => {
    const t = trawler();
    const state = setupTest({ hand: [t], discard: junk(10) }, { amber: 4 }, "Unfathomable");
    const after = applyMove(state, 0, { type: "play", instanceId: t.instanceId });
    expect(after.players[1].amber).toBe(4);
  });
});
