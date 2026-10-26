// SPDX-License-Identifier: AGPL-3.0-only
// Correção da Hayden Oswin: a linha (v10 do farm) contava upgrades com
// `host:true` — semântica de UPGRADE ("o hospedeiro da fonte") — numa
// CRIATURA, onde nunca casa: contagem silenciosa zero. A linha v17 usa o
// filtro novo `attachedToSource`.
import { afterEach, describe, expect, it } from "vitest";
import { setAbilityOverrides } from "./abilities";
import { applyMove } from "./game";
import { card, setupTest } from "./testkit";
import { vendoredOverrides } from "./vendored";

const HAYDEN_ID = "kt:479:322:staralliance";
const TEXT = "Reap: Gain 1A for each upgrade on Hayden Oswin.";

const hayden = () => card("Hayden Oswin", { id: HAYDEN_ID, type: "Creature", house: "Star Alliance", power: 3, text: TEXT });
const upgrade = (n: number) => card(`Upgrade${n}`, { type: "Upgrade", house: "Star Alliance", text: "" });

afterEach(() => setAbilityOverrides(new Map()));

const reapHayden = (upgrades: number) => {
  setAbilityOverrides(vendoredOverrides());
  const h = hayden();
  const state = setupTest({ inPlay: [h], amber: 0 }, { amber: 0 }, "Star Alliance");
  const live = state.players[0].board.find((c) => c.face.title === "Hayden Oswin")!;
  for (let i = 0; i < upgrades; i += 1) {
    const up = upgrade(i);
    state.players[0].board.push({ ...up, attachedTo: live.instanceId });
  }
  return applyMove(state, 0, { type: "reap", instanceId: live.instanceId });
};

describe("Hayden Oswin (seed v17, attachedToSource)", () => {
  it("0 upgrades: reap base, +0 extra (âmbar 1)", () => {
    expect(reapHayden(0).players[0].amber).toBe(1);
  });

  it("1 upgrade anexado: +1 extra (âmbar 2)", () => {
    expect(reapHayden(1).players[0].amber).toBe(2);
  });

  it("2 upgrades anexados: +2 extra (âmbar 3)", () => {
    expect(reapHayden(2).players[0].amber).toBe(3);
  });
});
