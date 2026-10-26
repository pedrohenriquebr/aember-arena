// SPDX-License-Identifier: AGPL-3.0-only
// Correção da Call of the Void: a linha v8 do farm testava "already exhausted"
// DEPOIS do próprio exhaust (sempre verdadeira → destruía alvo pronto) e o
// loseAmber rodava depois do destroy (o if re-escaneava o board sem a carta →
// o controlador nunca perdia o Æmber). A linha v17 testa o snapshot pré-atos
// (wasExhausted/stamp) e perde o Æmber ANTES de destruir.
import { afterEach, describe, expect, it } from "vitest";
import { setAbilityOverrides } from "./abilities";
import { applyMove } from "./game";
import { card, setupTest } from "./testkit";
import { vendoredOverrides } from "./vendored";

// Texto do MV: glifo U+F360 (o textHash do seed é sobre esse texto).
const TEXT = "Play: Exhaust a creature. If it was already exhausted, destroy it instead and its controller loses 1\uF360.\n";
const COTV_ID = "3870f42c-5b24-4833-b84f-688edec6b289";

const cotv = () => card("Call of the Void", { id: COTV_ID, type: "Action", house: "Unfathomable", text: TEXT });
const foe = (opts: { ready?: boolean } = {}) => {
  const f = card("Warden", { type: "Creature", house: "Brobnar", power: 3, text: "" });
  if (opts.ready === false) f.ready = false;
  return f;
};
const playAt = (state: ReturnType<typeof setupTest>, spell: { instanceId: string }, victim: { instanceId: string }) =>
  applyMove(state, 0, { type: "play", instanceId: spell.instanceId, target: victim.instanceId });

/** setupTest re-instancia as cartas de inPlay — o `ready=false` tem que ir na
    instância VIVA, depois do setup, para o cenário "já exausto". */
const exaustarNoBoard = (state: ReturnType<typeof setupTest>, victim: { instanceId: string }) => {
  const live = state.players[1].board.find((c) => c.instanceId === victim.instanceId)!;
  live.ready = false;
  return live;
};

afterEach(() => setAbilityOverrides(new Map()));

describe("Call of the Void (seed v17, wasExhausted)", () => {
  it("alvo PRONTO: só exausta — vivo, pronto=false, âmbar do controlador intacto", () => {
    setAbilityOverrides(vendoredOverrides());
    const spell = cotv();
    const victim = foe();
    const state = setupTest({ hand: [spell] }, { inPlay: [victim], amber: 3 }, "Unfathomable");
    const after = playAt(state, spell, victim);
    const alive = after.players[1].board.find((c) => c.instanceId === victim.instanceId);
    expect(after.players[0].hand).toHaveLength(0); // a carta foi jogada
    expect(alive).toBeDefined(); // e o alvo não morreu
    expect(alive?.ready).toBe(false); // só o exhaust
    expect(after.players[1].amber).toBe(3);
  });

  it("alvo JÁ EXAUSTO: destrói E o controlador perde 1 Æmber (pool 3→2)", () => {
    setAbilityOverrides(vendoredOverrides());
    const spell = cotv();
    const victim = foe();
    const state = setupTest({ hand: [spell] }, { inPlay: [victim], amber: 3 }, "Unfathomable");
    const live = exaustarNoBoard(state, victim);
    const after = playAt(state, spell, live);
    expect(after.players[0].hand).toHaveLength(0);
    expect(after.players[1].board.find((c) => c.instanceId === live.instanceId)).toBeUndefined();
    expect(after.players[1].amber).toBe(2);
  });
});
