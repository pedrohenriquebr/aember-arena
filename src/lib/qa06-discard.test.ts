// SPDX-License-Identifier: AGPL-3.0-only
// QA-06 (Witch of the Eye, "Reap: Return a card from your discard pile to your hand."): o ato
// fromDiscard pegava sempre o TOPO do descarte, sem escolha. A regra é do controlador escolher
// qualquer carta. A bancada prova o prompt "discard" (pendingPrompt, o mesmo caminho da UI) e o
// efeito da escolha (applyMove com targets), além do default da IA/sem UI (o topo).
import { describe, expect, it } from "vitest";
import { applyMove, getLegalMoves, pendingPrompt, type GameState } from "./game";
import { card, setupTest } from "./testkit";

const WITCH_TEXT = "Reap: Return a card from your discard pile to your hand.";
const CREATURE_TEXT = "Reap: Return a creature from your discard pile to your hand.";

const witch = (text = WITCH_TEXT) => card("Witch of the Eye", { type: "Creature", house: "Untamed", power: 3, text });
const foe = () => card("Foe", { type: "Creature", house: "Brobnar", power: 1, text: "" });
const grunt = (title: string) => card(title, { type: "Creature", house: "Untamed", power: 2, text: "" });
const titles = (state: GameState, zone: "hand" | "discard") => state.players[0][zone].map((item) => item.face.title);

describe("QA-06 · (a) reap da bruxa com cartas no descarte abre o prompt de escolha", () => {
  it("o prompt kind 'discard' lista o descarte do lado, mais recente primeiro", () => {
    const w = witch();
    const [a, b, c] = [grunt("Alpha"), grunt("Beta"), grunt("Gamma")];
    const state = setupTest({ inPlay: [w], discard: [a, b, c] }, { inPlay: [foe()] }, "Untamed");
    expect(pendingPrompt(state, 0, { type: "reap", instanceId: w.instanceId })).toEqual({
      kind: "discard",
      ids: [c.instanceId, b.instanceId, a.instanceId],
    });
  });

  it("o prompt só aparece enquanto a escolha não foi feita (targets indefinido)", () => {
    const w = witch();
    const a = grunt("Alpha");
    const state = setupTest({ inPlay: [w], discard: [a] }, { inPlay: [foe()] }, "Untamed");
    expect(pendingPrompt(state, 0, { type: "reap", instanceId: w.instanceId, targets: [a.instanceId] })).toBeNull();
  });
});

describe("QA-06 · (b) escolher a carta X devolve X (não o topo)", () => {
  it("a carta mais antiga volta à mão; o topo fica no descarte", () => {
    const w = witch();
    const [a, b, c] = [grunt("Alpha"), grunt("Beta"), grunt("Gamma")];
    const state = setupTest({ inPlay: [w], discard: [a, b, c] }, { inPlay: [foe()] }, "Untamed");
    const after = applyMove(state, 0, { type: "reap", instanceId: w.instanceId, targets: [a.instanceId] });
    expect(titles(after, "hand")).toEqual(["Alpha"]);
    expect(titles(after, "discard")).toEqual(["Beta", "Gamma"]);
    expect(after.players[0].amber).toBe(1);
  });

  it("o meio do descarte também é uma escolha válida", () => {
    const w = witch();
    const [a, b, c] = [grunt("Alpha"), grunt("Beta"), grunt("Gamma")];
    const state = setupTest({ inPlay: [w], discard: [a, b, c] }, { inPlay: [foe()] }, "Untamed");
    const after = applyMove(state, 0, { type: "reap", instanceId: w.instanceId, targets: [b.instanceId] });
    expect(titles(after, "hand")).toEqual(["Beta"]);
    expect(titles(after, "discard")).toEqual(["Alpha", "Gamma"]);
  });

  it("um id que não está no descarte não é aceito: a jogada cai no default (o topo)", () => {
    const w = witch();
    const [a, b] = [grunt("Alpha"), grunt("Beta")];
    const state = setupTest({ inPlay: [w], discard: [a, b] }, { inPlay: [foe()] }, "Untamed");
    const after = applyMove(state, 0, { type: "reap", instanceId: w.instanceId, targets: ["nao-existe"] });
    expect(titles(after, "hand")).toEqual(["Beta"]);
  });
});

describe("QA-06 · (c) IA e caminho sem UI resolvem sem prompt, pelo topo (mais recente)", () => {
  it("applyMove sem targets pega a carta mais recente do descarte (heurística documentada)", () => {
    const w = witch();
    const [a, b, c] = [grunt("Alpha"), grunt("Beta"), grunt("Gamma")];
    const state = setupTest({ inPlay: [w], discard: [a, b, c] }, { inPlay: [foe()] }, "Untamed");
    const after = applyMove(state, 0, { type: "reap", instanceId: w.instanceId });
    expect(titles(after, "hand")).toEqual(["Gamma"]);
    expect(titles(after, "discard")).toEqual(["Alpha", "Beta"]);
  });

  it("a IA não ganha variantes de escolha: a colheita da bruxa continua uma jogada só", () => {
    const w = witch();
    const state = setupTest({ inPlay: [w], discard: [grunt("Alpha"), grunt("Beta")] }, { inPlay: [foe()] }, "Untamed");
    const reaps = getLegalMoves(state, 0, "Untamed").filter((move) => move.type === "reap" && move.instanceId === w.instanceId);
    expect(reaps).toHaveLength(1);
    expect(reaps[0].targets).toBeUndefined();
  });
});

describe("QA-06 · (d) descarte vazio não pergunta nem faz nada", () => {
  it("sem cartas no descarte: nenhum prompt e a mão não muda", () => {
    const w = witch();
    const state = setupTest({ inPlay: [w] }, { inPlay: [foe()] }, "Untamed");
    expect(pendingPrompt(state, 0, { type: "reap", instanceId: w.instanceId })).toBeNull();
    const after = applyMove(state, 0, { type: "reap", instanceId: w.instanceId });
    expect(after.players[0].hand).toEqual([]);
    expect(after.players[0].discard).toEqual([]);
    expect(after.players[0].amber).toBe(1);
  });
});

describe("QA-06 · (f) 'you may' recusado não pergunta a carta", () => {
  it("a variante decline da colheita (Sem efeito) não abre o prompt nem mexe no descarte", () => {
    const w = witch(`Reap: You may return a card from your discard pile to your hand.`);
    const a = grunt("Alpha");
    const state = setupTest({ inPlay: [w], discard: [a] }, { inPlay: [foe()] }, "Untamed");
    expect(pendingPrompt(state, 0, { type: "reap", instanceId: w.instanceId, decline: true })).toBeNull();
    const after = applyMove(state, 0, { type: "reap", instanceId: w.instanceId, decline: true });
    expect(titles(after, "discard")).toEqual(["Alpha"]);
    expect(after.players[0].hand).toEqual([]);
  });
});

describe("QA-06 · (e) 'return a creature' só oferece criaturas do descarte", () => {
  it("o prompt filtra por tipo e um artefato fora do filtro não é aceito como escolha", () => {
    const w = witch(CREATURE_TEXT);
    const artifact = card("Bauble", { type: "Artifact", house: "Untamed", text: "" });
    const creature = grunt("Delta");
    const state = setupTest({ inPlay: [w], discard: [creature, artifact] }, { inPlay: [foe()] }, "Untamed");
    expect(pendingPrompt(state, 0, { type: "reap", instanceId: w.instanceId })).toEqual({ kind: "discard", ids: [creature.instanceId] });
    const after = applyMove(state, 0, { type: "reap", instanceId: w.instanceId, targets: [artifact.instanceId] });
    expect(titles(after, "hand")).toEqual(["Delta"]);
    expect(titles(after, "discard")).toEqual(["Bauble"]);
  });
});
