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

});