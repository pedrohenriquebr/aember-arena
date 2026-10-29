// SPDX-License-Identifier: AGPL-3.0-only
// M1 · Animating Force (551a7add): "This upgrade enters play attached to an artifact instead
// of a creature. Play: Take control of this artifact and put it on a flank of your battleline
// as a creature with 4 power and versatile. Scrap: Gain 1." Bancada do TEXTO IMPRESSO (corpus),
// sem linha vendored.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyMove, effectivePower, keyword, type CardInstance, type GameState } from "./game";
import { card, setupTest } from "./testkit";

const ID = "551a7add-d9fe-4546-82da-e3c1d1814a52";
const TEXT = (JSON.parse(readFileSync(join(process.cwd(), "scripts", "harvest", "cards-corpus.json"), "utf8")) as { id: string; text: string }[]).find((c) => c.id === ID)!.text;

const animating = () => card("Animating Force", { id: ID, type: "Upgrade", house: "Geistoid", text: TEXT });
const relic = () => card("Relic", { type: "Artifact", house: "Logos", power: 0, armor: 0, text: "" });
const grunt = () => card("Grunt", { type: "Creature", house: "Geistoid", power: 3, armor: 0, text: "" });

const find = (state: GameState, side: 0 | 1, instanceId: string): CardInstance | undefined =>
  state.players[side].board.find((c) => c.instanceId === instanceId);

describe("M1 · Animating Force — entra anexada a artefato", () => {
  it("jogada num artefato inimigo, a carta fica anexada a ele e não vira criatura ainda", () => {
    const af = animating();
    const r = relic();
    const state = setupTest({ hand: [af], inPlay: [grunt()] }, { inPlay: [r] }, "Geistoid");
    const after = applyMove(state, 0, { type: "play", instanceId: af.instanceId, target: r.instanceId });
    expect(find(after, 0, af.instanceId)?.attachedTo).toBe(r.instanceId);
  });
});

describe("M1 · Animating Force — Play: pega o artefato, põe num flanco com 4 de poder e versatile", () => {
  it("o artefato do inimigo passa para a minha battleline como criatura de poder 4, no flanco esquerdo, versatile", () => {
    const af = animating();
    const r = relic();
    const g = grunt();
    const state = setupTest({ hand: [af], inPlay: [g] }, { inPlay: [r] }, "Geistoid");
    const after = applyMove(state, 0, { type: "play", instanceId: af.instanceId, target: r.instanceId });
    const taken = find(after, 0, r.instanceId);
    expect(taken, "o artefato tem de ter ido para o meu tabuleiro").toBeDefined();
    expect(after.players[1].board.some((c) => c.instanceId === r.instanceId)).toBe(false);
    expect(effectivePower(after, taken!)).toBe(4);
    expect(keyword(after, taken!, "versatile")).toBeGreaterThan(0);
    // "On a flank" = uma das pontas da battleline (o texto não diz qual; o padrão do motor é a esquerda).
    const line = after.players[0].board.filter((c) => c.face.type === "Creature" || c.instanceId === r.instanceId);
    const at = line.findIndex((c) => c.instanceId === r.instanceId);
    expect(at === 0 || at === line.length - 1).toBe(true);
  });
});
