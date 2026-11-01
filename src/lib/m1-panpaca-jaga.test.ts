// SPDX-License-Identifier: AGPL-3.0-only
// M1 · Panpaca, Jaga (4e8813cd): "Skirmish. Creatures to the left of Panpaca, Jaga in the
// battleline gain skirmish." Bancada do TEXTO IMPRESSO (corpus), sem linha vendored. Skirmish:
// quem luta com essa criatura não lhe causa dano de volta.
import { describe, expect, it } from "vitest";
import { applyMove, keyword, type CardInstance, type GameState } from "./game";
import { card, setupTest } from "./testkit";
import { harvestJson } from "./testHarvest";
const ID = "4e8813cd-659f-4892-bc80-7a0a9adaf238";
const CORPUS = harvestJson<{ id: string; text: string }[]>("cards-corpus.json") ?? [];
const HAS_CORPUS = CORPUS.length > 0;
const TEXT = CORPUS.find((c) => c.id === ID)?.text ?? "";

const panpaca = () => card("Panpaca, Jaga", { id: ID, type: "Creature", house: "Untamed", power: 4, armor: 0, text: TEXT });
const unit = (title: string) => card(title, { type: "Creature", house: "Untamed", power: 3, armor: 0, text: "" });

const mine = (state: GameState, instanceId: string): CardInstance => state.players[0].board.find((c) => c.instanceId === instanceId)!;

describe.skipIf(!HAS_CORPUS)("M1 · Panpaca, Jaga — concede skirmish às criaturas à esquerda", () => {
  it("as criaturas à esquerda ganham skirmish; a da direita e a própria Panpaca (que já tem) seguem a regra", () => {
    const a = unit("Esquerda A");
    const b = unit("Esquerda B");
    const p = panpaca();
    const c = unit("Direita");
    const state = setupTest({ inPlay: [a, b, p, c] }, {}, "Untamed");
    expect(keyword(state, mine(state, a.instanceId), "skirmish")).toBeGreaterThan(0);
    expect(keyword(state, mine(state, b.instanceId), "skirmish")).toBeGreaterThan(0);
    expect(keyword(state, mine(state, p.instanceId), "skirmish")).toBeGreaterThan(0);
    expect(keyword(state, mine(state, c.instanceId), "skirmish")).toBe(0);
  });

  it("a criatura da esquerda que luta com skirmish não recebe o dano de volta", () => {
    const a = unit("Esquerda A");
    const p = panpaca();
    const foe = card("Inimiga", { type: "Creature", house: "Brobnar", power: 6, armor: 0, text: "" });
    const state = setupTest({ inPlay: [a, p] }, { inPlay: [foe] }, "Untamed");
    const after = applyMove(state, 0, { type: "fight", attackerId: a.instanceId, targetId: foe.instanceId });
    expect(mine(after, a.instanceId).damage).toBe(0);
    expect(after.players[1].board.find((c) => c.instanceId === foe.instanceId)?.damage).toBe(3);
  });
});
