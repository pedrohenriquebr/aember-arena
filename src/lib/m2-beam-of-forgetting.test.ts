// SPDX-License-Identifier: AGPL-3.0-only
// M2 · Beam of Forgetting (c1aea816): "Enhance. Play: Reveal a random card from your opponent’s
// hand. Put that card on the bottom of their deck." Bancada do TEXTO IMPRESSO (corpus), sem
// linha vendored: o parser puro precisa cumprir tudo.
import { describe, expect, it } from "vitest";
import { applyMove, getLegalMoves, type GameState } from "./game";
import { card, setupTest } from "./testkit";
import { harvestJson } from "./testHarvest";
const ID = "c1aea816-4bb8-4fb8-86c1-78384997b739";
const CORPUS = harvestJson<{ id: string; title: string; text: string }[]>("cards-corpus.json") ?? [];
const HAS_CORPUS = CORPUS.length > 0;
const { title: TITLE, text: TEXT } = CORPUS.find((c) => c.id === ID) ?? { title: "", text: "" };

const beam = () => card(TITLE, { id: ID, type: "Action", house: "Unfathomable", text: TEXT });
const titlesOf = (cards: { face: { title: string } }[]) => cards.map((c) => c.face.title);

describe.skipIf(!HAS_CORPUS)("M2 · Beam of Forgetting — revela uma carta aleatória da mão inimiga e a põe no fundo do baralho", () => {
  it("tira UMA carta da mão do oponente e a põe no FUNDO (deck[0]) do baralho dele", () => {
    const b = beam();
    const state = setupTest({ hand: [b] }, { hand: ["Opp A", "Opp B"], deck: ["Fundo 1", "Fundo 2"] }, "Unfathomable");
    const after = applyMove(state, 0, { type: "play", instanceId: b.instanceId }) as GameState;
    const opp = after.players[1];
    expect(opp.hand).toHaveLength(1);
    expect(opp.deck).toHaveLength(3);
    const moved = ["Opp A", "Opp B"].find((t) => !titlesOf(opp.hand).includes(t));
    expect(moved).toBeDefined();
    // Fundo = deck[0]: o topo é o último elemento (game.ts usa pop()).
    expect(opp.deck[0].face.title).toBe(moved);
    expect(opp.deck.at(-1)!.face.title).toBe("Fundo 2");
  });

  it("mão do oponente vazia: nada é revelado e o baralho dele não muda", () => {
    const b = beam();
    const state = setupTest({ hand: [b] }, { hand: [], deck: ["Fundo 1"] }, "Unfathomable");
    const after = applyMove(state, 0, { type: "play", instanceId: b.instanceId }) as GameState;
    expect(after.players[1].deck.map((c) => c.face.title)).toEqual(["Fundo 1"]);
    expect(after.players[1].hand).toHaveLength(0);
  });

  it("é uma Ação jogável na casa ativa Unfathomable e sai da mão do jogador", () => {
    const b = beam();
    const state = setupTest({ hand: [b] }, { hand: ["Opp A"] }, "Unfathomable");
    expect(getLegalMoves(state, 0, "Unfathomable").some((m) => m.type === "play" && m.instanceId === b.instanceId)).toBe(true);
    const after = applyMove(state, 0, { type: "play", instanceId: b.instanceId }) as GameState;
    expect(after.players[0].hand).toHaveLength(0);
    expect(titlesOf(after.players[0].discard)).toContain(TITLE);
  });
});
