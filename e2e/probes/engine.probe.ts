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
  it.fails("BUG-06: a targeted Fight: ability exposes its choices on the fight move (AI/UI can choose)", () => {
    const state = setupTest(
      { inPlay: [creature("Basilisk", 6, "Skirmish. After Fight: Exhaust an enemy creature.")] },
      { inPlay: [creature("Low", 1), creature("Mid", 3), creature("High", 5)] },
    );
    const fights = getLegalMoves(state, 0, "Brobnar").filter((move): move is Extract<GameMove, { type: "fight" }> => move.type === "fight");
    expect(fights.some((move) => move.target !== undefined)).toBe(true);
  });

  it.fails("BUG-11: 'Use a friendly creature' lets the creature fight or use its Action, not only reap", () => {
    const bauble = card("Dominator Bauble", { type: "Artifact", house: "Brobnar", text: "Action: Use a friendly creature." });
    const thief = creature("Thief", 2, "Action: Steal 2A.");
    const state = setupTest({ inPlay: [bauble, thief] }, { amber: 5 });
    const after = applyMove(state, 0, { type: "use", instanceId: bauble.instanceId, target: thief.instanceId });
    // Using the Action would steal 2; the engine can only reap (+1 amber).
    expect(after.players[0].amber).toBe(2);
  });

});