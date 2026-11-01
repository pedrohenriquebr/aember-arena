// SPDX-License-Identifier: AGPL-3.0-only
// M1 · Seismo-entangler (e5f62952): "Action: Choose a house. During your opponent's next turn,
// creatures of the chosen house cannot be used to reap." Bancada do TEXTO IMPRESSO (corpus), sem
// linha vendored.
import { describe, expect, it } from "vitest";
import { applyMove, chooseHouse, endTurn, getLegalMoves, type GameState } from "./game";
import { card, setupTest, type SideSetup } from "./testkit";
import { harvestJson } from "./testHarvest";
const ID = "e5f62952-650e-4063-b534-6023a0cd30cf";
const CORPUS = harvestJson<{ id: string; text: string }[]>("cards-corpus.json") ?? [];
const HAS_CORPUS = CORPUS.length > 0;
const TEXT = CORPUS.find((c) => c.id === ID)?.text ?? "";

const seismo = () => card("Seismo-entangler", { id: ID, type: "Artifact", house: "Logos", power: 0, armor: 0, text: TEXT });
const foeBrobnar = () => card("Brobnar inimigo", { type: "Creature", house: "Brobnar", power: 3, armor: 0, text: "" });
const foeUntamed = () => card("Untamed inimigo", { type: "Creature", house: "Untamed", power: 3, armor: 0, text: "" });

/** `chooseHouse` só aceita casas do baralho (player.houses): o fixture declara as casas usadas aqui. */
function arena(p1: SideSetup, p2: SideSetup): GameState {
  const state = setupTest(p1, p2, "Logos");
  state.players[0].houses = ["Logos"];
  state.players[1].houses = ["Brobnar", "Untamed"];
  return state;
}

/** Reap legal de uma criatura do lado `side` na casa `house` (true = pode). */
const canReap = (state: GameState, side: 0 | 1, house: string, instanceId: string) =>
  getLegalMoves(state, side, house).some((m) => m.type === "reap" && m.instanceId === instanceId);

describe.skipIf(!HAS_CORPUS)("M1 · Seismo-entangler — casa escolhida não reapa no próximo turno do oponente", () => {
  it("escolhida Brobnar: no turno seguinte do oponente, a Brobnar dele não reapa (e a casa de fato foi escolhida)", () => {
    const s = seismo();
    const b = foeBrobnar();
    // Controle: sem o Seismo, a Brobnar dele reapa na própria vez (prova que a casa é legal).
    const control = chooseHouse(endTurn(arena({}, { inPlay: [b] }), 0), 1, "Brobnar");
    expect(canReap(control, 1, "Brobnar", b.instanceId)).toBe(true);
    const state = arena({ inPlay: [s] }, { inPlay: [b, foeUntamed()] });
    const played = applyMove(state, 0, { type: "use", instanceId: s.instanceId, house: "Brobnar" });
    const oppTurn = chooseHouse(endTurn(played, 0), 1, "Brobnar");
    expect(oppTurn.activeHouse).toBe("Brobnar");
    expect(canReap(oppTurn, 1, "Brobnar", b.instanceId)).toBe(false);
  });

  it("a restrição não vale para criaturas de outra casa (Untamed continua reapando na sua vez)", () => {
    const s = seismo();
    const u = foeUntamed();
    const state = arena({ inPlay: [s] }, { inPlay: [foeBrobnar(), u] });
    const played = applyMove(state, 0, { type: "use", instanceId: s.instanceId, house: "Brobnar" });
    const oppTurn = chooseHouse(endTurn(played, 0), 1, "Untamed");
    expect(oppTurn.activeHouse).toBe("Untamed");
    expect(canReap(oppTurn, 1, "Untamed", u.instanceId)).toBe(true);
  });

  it("dura só o turno seguinte: no turno depois dele a Brobnar volta a reapar", () => {
    const s = seismo();
    const b = foeBrobnar();
    const state = arena({ inPlay: [s] }, { inPlay: [b] });
    const played = applyMove(state, 0, { type: "use", instanceId: s.instanceId, house: "Brobnar" });
    const oppTurn = chooseHouse(endTurn(played, 0), 1, "Brobnar");
    const myTurn = chooseHouse(endTurn(oppTurn, 1), 0, "Logos");
    const nextOpp = chooseHouse(endTurn(myTurn, 0), 1, "Brobnar");
    expect(nextOpp.activeHouse).toBe("Brobnar");
    expect(canReap(nextOpp, 1, "Brobnar", b.instanceId)).toBe(true);
  });
});
