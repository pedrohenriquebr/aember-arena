// SPDX-License-Identifier: AGPL-3.0-only
// M2 · Hallowed Eve Festival (b6832a73): "Play: Discard the top 5 cards of your deck. For each
// Geistoid card discarded this way, a friendly creature captures 1." O parser puro devolve
// vanilla. A row original (`gone`) estava ERRADA: "gone" conta cartas que saem do JOGO a partir do
// tabuleiro, não o descarte do topo. A linha corrigida (`m:"cards"`, anexada ao approved.json com o
// mesmo cardId) é a que vale: vendoredOverrides() é o caminho do boot e a última linha do id vence.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setAbilityOverrides } from "./abilities";
import { textHash } from "./cardText";
import { applyMove, type GameState } from "./game";
import { card, setupTest } from "./testkit";
import { vendoredOverrides } from "./vendored";
import { harvestJson } from "./testHarvest";
const ID = "b6832a73-9223-41ae-8146-98e000a57f6d";
const CORPUS = harvestJson<{ id: string; title: string; text: string }[]>("cards-corpus.json") ?? [];
const HAS_CORPUS = CORPUS.length > 0;
const { title: TITLE, text: TEXT } = CORPUS.find((c) => c.id === ID) ?? { title: "", text: "" };
const ROW = vendoredOverrides().get(ID)!;

beforeEach(() => setAbilityOverrides(vendoredOverrides()));
afterEach(() => setAbilityOverrides(new Map()));

const festival = () => card(TITLE, { id: ID, type: "Action", house: "Geistoid", text: TEXT });
const geist = (title: string) => card(title, { type: "Creature", house: "Geistoid", power: 2, armor: 0, text: "" });
const other = (title: string) => card(title, { type: "Creature", house: "Brobnar", power: 2, armor: 0, text: "" });
const titlesOf = (cards: { face: { title: string } }[]) => cards.map((c) => c.face.title);
const capturedOn = (state: GameState, side: 0 | 1, instanceId: string) => state.players[side].board.find((c) => c.instanceId === instanceId)?.amber ?? 0;

/** Topo = último elemento. Top 5 (do topo ao 5º): G1, X, G2, Y, Z. Abaixo do top 5: `below`. */
const deckWith = (top5: ReturnType<typeof card>[], below: ReturnType<typeof card>[]) => [...below, ...[...top5].reverse()];

describe.skipIf(!HAS_CORPUS)("M2 · Hallowed Eve Festival — linha aprovada: descarta 5 do topo; cada Geistoid descartado = 1 de captura", () => {
  it("a linha vigente passa no validador, tem o hash do texto impresso e conta pelo descarte do topo (m:cards)", () => {
    expect(ROW.textHash).toBe(textHash(TEXT));
    expect(ROW.v).toBe(17);
    expect(JSON.stringify(ROW.dsl)).toContain('"per":{"m":"cards","house":"Geistoid"}');
  });

  it("2 Geistoid entre os 5 do topo: a amiga escolhida captura 2 do oponente", () => {
    const f = festival();
    const ally = other("Aliada");
    const top5 = [geist("G1"), other("X"), geist("G2"), other("Y"), other("Z")];
    const state = setupTest({ hand: [f], inPlay: [ally], deck: deckWith(top5, [other("Pad")]) }, { inPlay: [], amber: 5 }, "Geistoid");
    const after = applyMove(state, 0, { type: "play", instanceId: f.instanceId, target: ally.instanceId }) as GameState;
    expect(titlesOf(after.players[0].discard)).toEqual(expect.arrayContaining(["G1", "X", "G2", "Y", "Z"]));
    // Capture põe o âmbar sobre a criatura amiga escolhida (CardInstance.amber), tirado do oponente.
    expect(capturedOn(after, 0, ally.instanceId)).toBe(2);
    expect(after.players[1].amber).toBe(3);
  });

  it("nenhum Geistoid entre os 5 do topo: a captura é zero (o oponente mantém os 5)", () => {
    const f = festival();
    const ally = other("Aliada");
    const top5 = [other("A"), other("B"), other("C"), other("D"), other("E")];
    const state = setupTest({ hand: [f], inPlay: [ally], deck: deckWith(top5, []) }, { amber: 5 }, "Geistoid");
    const after = applyMove(state, 0, { type: "play", instanceId: f.instanceId, target: ally.instanceId }) as GameState;
    expect(after.players[0].amber).toBe(0);
    expect(after.players[1].amber).toBe(5);
  });

  it("Geistoid ABAIXO do top 5 não conta: só os descartados por este texto", () => {
    const f = festival();
    const ally = other("Aliada");
    const top5 = [geist("G1"), other("X"), other("Y"), other("Z"), other("W")];
    const state = setupTest({ hand: [f], inPlay: [ally], deck: deckWith(top5, [geist("Fora do top 5")]) }, { amber: 5 }, "Geistoid");
    const after = applyMove(state, 0, { type: "play", instanceId: f.instanceId, target: ally.instanceId }) as GameState;
    expect(capturedOn(after, 0, ally.instanceId)).toBe(1);
    expect(after.players[1].amber).toBe(4);
    expect(titlesOf(after.players[0].discard)).not.toContain("Fora do top 5");
  });
});
