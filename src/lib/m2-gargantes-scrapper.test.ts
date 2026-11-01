// SPDX-License-Identifier: AGPL-3.0-only
// M2 · Gargantes Scrapper (17cf0b90): "Alpha. Play: If you have 3Æ or more, deal 3D to an enemy
// creature." Bancada do TEXTO IMPRESSO (corpus), sem linha vendored.
import { describe, expect, it } from "vitest";
import { applyMove, getLegalMoves, type GameState } from "./game";
import { card, setupTest } from "./testkit";
import { harvestJson } from "./testHarvest";
const ID = "17cf0b90-55c6-4e4b-b13a-2400dd883938";
const CORPUS = harvestJson<{ id: string; title: string; text: string }[]>("cards-corpus.json") ?? [];
const HAS_CORPUS = CORPUS.length > 0;
const { title: TITLE, text: TEXT } = CORPUS.find((c) => c.id === ID) ?? { title: "", text: "" };

const scrapper = () => card(TITLE, { id: ID, type: "Creature", house: "Brobnar", power: 4, armor: 0, text: TEXT });
const foe = () => card("Inimiga", { type: "Creature", house: "Untamed", power: 9, armor: 0, text: "" });
const damageOf = (state: GameState, instanceId: string) => state.players[1].board.find((c) => c.instanceId === instanceId)?.damage;

describe.skipIf(!HAS_CORPUS)("M2 · Gargantes Scrapper — Play: com 3Æ ou mais, 3 de dano a uma criatura inimiga", () => {
  it("com 3Æ na pool: 3 de dano no alvo inimigo e o âmbar da pool não muda", () => {
    const s = scrapper();
    const f = foe();
    const state = setupTest({ hand: [s], amber: 3 }, { inPlay: [f] }, "Brobnar");
    const after = applyMove(state, 0, { type: "play", instanceId: s.instanceId, target: f.instanceId }) as GameState;
    expect(damageOf(after, f.instanceId)).toBe(3);
    expect(after.players[0].amber).toBe(3);
  });

  it("com 2Æ na pool a condição falha: o alvo não leva dano", () => {
    const s = scrapper();
    const f = foe();
    const state = setupTest({ hand: [s], amber: 2 }, { inPlay: [f] }, "Brobnar");
    const after = applyMove(state, 0, { type: "play", instanceId: s.instanceId, target: f.instanceId }) as GameState;
    expect(damageOf(after, f.instanceId)).toBe(0);
  });

  it("Alpha: depois de fazer outra coisa no passo, Gargantes Scrapper não pode mais ser jogada", () => {
    const s = scrapper();
    const reaper = card("Reaper", { type: "Creature", house: "Brobnar", power: 3, armor: 0, text: "" });
    const state = setupTest({ hand: [s], inPlay: [reaper], amber: 3 }, { inPlay: [foe()] }, "Brobnar");
    const afterReap = applyMove(state, 0, { type: "reap", instanceId: reaper.instanceId });
    const playable = getLegalMoves(afterReap, 0, "Brobnar").some((m) => m.type === "play" && m.instanceId === s.instanceId);
    expect(playable).toBe(false);
  });
});
