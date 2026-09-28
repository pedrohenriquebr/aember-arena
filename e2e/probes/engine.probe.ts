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
});