// SPDX-License-Identifier: AGPL-3.0-only
// M2 · Grasping Vines (61609682): "Play: Return up to 3 artifacts to their owners’ hands."
// Bancada do TEXTO IMPRESSO (corpus), sem linha vendored. "Up to 3" = o jogador escolhe 0..3
// artefatos de QUALQUER lado (não há "friendly"/"enemy" no texto).
import { describe, expect, it } from "vitest";
import { applyMove, type GameState } from "./game";
import { card, setupTest } from "./testkit";
import { harvestJson } from "./testHarvest";
const ID = "61609682-2c6a-4d08-8715-748cb8c8e691";
const CORPUS = harvestJson<{ id: string; title: string; text: string }[]>("cards-corpus.json") ?? [];
const HAS_CORPUS = CORPUS.length > 0;
const { title: TITLE, text: TEXT } = CORPUS.find((c) => c.id === ID) ?? { title: "", text: "" };

const vines = () => card(TITLE, { id: ID, type: "Action", house: "Untamed", text: TEXT });
const artifact = (title: string) => card(title, { type: "Artifact", house: "Untamed", text: "" });
const titlesOf = (cards: { face: { title: string } }[]) => cards.map((c) => c.face.title);

describe.skipIf(!HAS_CORPUS)("M2 · Grasping Vines — devolve até 3 artefatos de qualquer lado às mãos dos donos", () => {
  it("escolhidos 3 artefatos (dois do oponente, um meu): cada um volta à mão do dono; o 4º fica", () => {
    const v = vines();
    const mine = artifact("Meu artefato");
    const foe1 = artifact("Artefato inimigo 1");
    const foe2 = artifact("Artefato inimigo 2");
    const foe3 = artifact("Artefato inimigo 3");
    const state = setupTest({ hand: [v], inPlay: [mine] }, { inPlay: [foe1, foe2, foe3] }, "Untamed");
    const after = applyMove(state, 0, { type: "play", instanceId: v.instanceId, targets: [mine.instanceId, foe1.instanceId, foe2.instanceId] }) as GameState;
    expect(titlesOf(after.players[0].hand)).toContain("Meu artefato");
    expect(titlesOf(after.players[1].hand).sort()).toEqual(["Artefato inimigo 1", "Artefato inimigo 2"]);
    expect(titlesOf(after.players[1].board)).toEqual(["Artefato inimigo 3"]);
  });

  it("\"up to\": nenhuma escolha = nenhum artefato volta", () => {
    const v = vines();
    const state = setupTest({ hand: [v], inPlay: [artifact("Meu")] }, { inPlay: [artifact("Deles")] }, "Untamed");
    const after = applyMove(state, 0, { type: "play", instanceId: v.instanceId, targets: [] }) as GameState;
    expect(titlesOf(after.players[0].board)).toEqual(["Meu"]);
    expect(titlesOf(after.players[1].board)).toEqual(["Deles"]);
  });

  it("não devolve criatura: só artefatos são alvo", () => {
    const v = vines();
    const creature = card("Criatura inimiga", { type: "Creature", house: "Untamed", power: 3, armor: 0, text: "" });
    const state = setupTest({ hand: [v] }, { inPlay: [creature] }, "Untamed");
    const after = applyMove(state, 0, { type: "play", instanceId: v.instanceId, targets: [creature.instanceId] }) as GameState;
    expect(titlesOf(after.players[1].board)).toEqual(["Criatura inimiga"]);
    expect(titlesOf(after.players[1].hand)).toEqual([]);
  });
});
