// SPDX-License-Identifier: AGPL-3.0-only
// Audit probes for docs/BUGS_AND_FEATURES.md. Each `it.fails` asserts the
// CORRECT behaviour, so it passes while the bug exists; when the executor fixes
// a BUG-xx the probe flips red and the spec should move into src/lib/*.test.ts.
// Not part of `npm test` (outside the default include); run with:
//   npx vitest run --config e2e/probes/vitest.config.ts
import { describe, expect, it } from "vitest";
import { parseCardText } from "../../src/lib/cardText";
import { applyMove, getLegalMoves, isLegalMove, moveHasEffect, targetChoices, type GameMove } from "../../src/lib/game";
import { byTitle, card, setupTest } from "../../src/lib/testkit";

const creature = (title: string, power: number, text = "", extra: Record<string, unknown> = {}) =>
  card(title, { type: "Creature", house: "Brobnar", power, text, ...extra });

describe("engine audit probes", () => {
  it.fails("BUG-04: an upgrade on an enemy creature is discarded when that creature leaves play", () => {
    let state = setupTest(
      { hand: [card("Mark", { type: "Upgrade", house: "Brobnar", text: "" })], inPlay: [creature("Brute", 5)] },
      { inPlay: [creature("Victim", 2)] },
    );
    const victim = state.players[1].board[0].instanceId;
    state = applyMove(state, 0, { type: "play", instanceId: state.players[0].hand[0].instanceId, target: victim });
    expect(byTitle(state.players[0].board, "Mark")?.attachedTo).toBe(victim);
    state = applyMove(state, 0, { type: "fight", attackerId: byTitle(state.players[0].board, "Brute")!.instanceId, targetId: victim });
    expect(state.players[1].board).toHaveLength(0);
    expect(byTitle(state.players[0].board, "Mark")).toBeUndefined();
    expect(byTitle(state.players[0].discard, "Mark")).toBeDefined();
  });

  it.fails("BUG-06: a targeted Fight: ability exposes its choices on the fight move (AI/UI can choose)", () => {
    const state = setupTest(
      { inPlay: [creature("Basilisk", 6, "Skirmish. After Fight: Exhaust an enemy creature.")] },
      { inPlay: [creature("Low", 1), creature("Mid", 3), creature("High", 5)] },
    );
    const fights = getLegalMoves(state, 0, "Brobnar").filter((move): move is Extract<GameMove, { type: "fight" }> => move.type === "fight");
    expect(fights.some((move) => move.target !== undefined)).toBe(true);
  });

  it.fails("BUG-09: target choices for a Play: condition count the card's own bonus amber", () => {
    const scrapper = card("Scrapper", { type: "Creature", house: "Brobnar", power: 5, amber: 1, text: "Play: If you have 3A or more, deal 3D to an enemy creature." });
    const state = setupTest({ hand: [scrapper], amber: 2 }, { inPlay: [creature("A", 4), creature("B", 4)] });
    const move: GameMove = { type: "play", instanceId: scrapper.instanceId };
    // The engine fires the ability (2 + 1 bonus = 3 amber)…
    const after = applyMove(state, 0, move);
    expect(after.players[1].board.filter((c) => c.damage === 3)).toHaveLength(1);
    // …but the UI was offered no choice, so the target was auto-picked.
    expect(targetChoices(state, 0, move)).toHaveLength(2);
  });

  it.fails("BUG-10: 'Sacrifice X. Destroy an artifact.' has no effect when X is the only artifact", () => {
    const gorm = card("Gorm of Omm", { type: "Artifact", house: "Brobnar", text: "Omni: Sacrifice Gorm of Omm. Destroy an artifact." });
    const state = setupTest({ inPlay: [gorm] });
    expect(moveHasEffect(state, 0, { type: "use", instanceId: gorm.instanceId })).toBe(false);
  });

  it.fails("BUG-11: 'Use a friendly creature' lets the creature fight or use its Action, not only reap", () => {
    const bauble = card("Dominator Bauble", { type: "Artifact", house: "Brobnar", text: "Action: Use a friendly creature." });
    const thief = creature("Thief", 2, "Action: Steal 2A.");
    const state = setupTest({ inPlay: [bauble, thief] }, { amber: 5 });
    const after = applyMove(state, 0, { type: "use", instanceId: bauble.instanceId, target: thief.instanceId });
    // Using the Action would steal 2; the engine can only reap (+1 amber).
    expect(after.players[0].amber).toBe(2);
  });

  it.fails("BUG-02: before a house is chosen no card may be played, reaped or used", () => {
    // setupTest leaves activeHouse null, exactly like the start of every human turn.
    const dis = card("Offhouse", { type: "Creature", house: "Dis", power: 2 });
    const state = setupTest({ hand: [dis], inPlay: [creature("Reaper", 3)] });
    expect(state.activeHouse).toBeNull();
    expect(isLegalMove(state, 0, { type: "play", instanceId: dis.instanceId })).toBe(false);
    expect(isLegalMove(state, 0, { type: "reap", instanceId: state.players[0].board[0].instanceId })).toBe(false);
  });
});
