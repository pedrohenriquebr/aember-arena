// SPDX-License-Identifier: AGPL-3.0-only
// M1 · Cybergiant Rig (19953e87): "This creature gains, 'At the end of your turn, this creature
// loses a +1 power counter.' Play: Fully heal this creature and give it a +1 power counter for
// each damage healed." Bancada do TEXTO IMPRESSO (corpus), sem linha vendored.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyMove, effectivePower, endTurn, type CardInstance, type GameState } from "./game";
import { card, setupTest } from "./testkit";

const ID = "19953e87-7a79-4172-a122-76889afbb514";
const TEXT = (JSON.parse(readFileSync(join(process.cwd(), "scripts", "harvest", "cards-corpus.json"), "utf8")) as { id: string; text: string }[]).find((c) => c.id === ID)!.text;

const rig = () => card("Cybergiant Rig", { id: ID, type: "Upgrade", house: "Brobnar", text: TEXT });
const giant = (damage: number) => ({ ...card("Cybergiant", { type: "Creature", house: "Brobnar", power: 3, armor: 0, text: "" }), damage });

const find = (state: GameState, instanceId: string): CardInstance | undefined =>
  state.players[0].board.find((c) => c.instanceId === instanceId);

describe("M1 · Cybergiant Rig — Play: cura total e +1 de poder por dano curado", () => {
  it("com 2 de dano: cura tudo e fica com 2 contadores de +1 poder (poder 5)", () => {
    const r = rig();
    const g = giant(2);
    const state = setupTest({ hand: [r], inPlay: [g] }, {}, "Brobnar");
    const after = applyMove(state, 0, { type: "play", instanceId: r.instanceId, target: g.instanceId });
    const healed = find(after, g.instanceId)!;
    expect(healed.damage).toBe(0);
    expect(healed.counters ?? 0).toBe(2);
    expect(effectivePower(after, healed)).toBe(5);
  });

  it("sem dano a curar: nenhum contador (o texto diz 'for each damage healed')", () => {
    const r = rig();
    const g = giant(0);
    const state = setupTest({ hand: [r], inPlay: [g] }, {}, "Brobnar");
    const after = applyMove(state, 0, { type: "play", instanceId: r.instanceId, target: g.instanceId });
    expect(find(after, g.instanceId)?.counters ?? 0).toBe(0);
  });
});

describe("M1 · Cybergiant Rig — a criatura ganha 'no fim do seu turno, perde 1 contador de +1 poder'", () => {
  it("no fim do meu turno a criatura perde um contador", () => {
    const r = rig();
    const g = giant(2);
    const state = setupTest({ hand: [r], inPlay: [g] }, {}, "Brobnar");
    const played = applyMove(state, 0, { type: "play", instanceId: r.instanceId, target: g.instanceId });
    expect(find(played, g.instanceId)?.counters).toBe(2);
    const ended = endTurn(played, 0);
    expect(find(ended, g.instanceId)?.counters).toBe(1);
  });
});
