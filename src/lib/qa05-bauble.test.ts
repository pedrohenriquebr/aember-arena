// SPDX-License-Identifier: AGPL-3.0-only
// QA-05 (Dominator Bauble, "Action: Use a friendly creature."): a carta era vanilla
// no motor, então o uso nunca pedia a criatura nem lutar/colher. A linha vendored
// (qa05-bauble-row.json) é a única coisa que muda o comportamento; a bancada prova
// o que a linha promete pelo mesmo caminho que a UI usa (getLegalMoves / pendingPrompt).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normaliseAbilityOverride, setAbilityOverrides, type AbilityOverride } from "./abilities";
import { textHash } from "./cardText";
import { applyMove, getLegalMoves, pendingPrompt, type GameMove, type GameState } from "./game";
import { card, setupTest } from "./testkit";

const ROW = JSON.parse(readFileSync(join(process.cwd(), "src", "lib", "qa05-bauble-row.json"), "utf8")) as AbilityOverride;
/** Texto impresso do corpus (96548d93). O id 76fce6b7 traz o mesmo texto com `\r\n` final. */
const PRINTED = "Action: Use a friendly creature.";

const bauble = () => card("Dominator Bauble", { id: ROW.cardId, type: "Artifact", house: "Dis", text: PRINTED });
const grunt = (ready = true) => card("Grunt", { type: "Creature", house: "Untamed", power: 3, text: "" }, ready);
const foe = () => card("Foe", { type: "Creature", house: "Brobnar", power: 1, text: "" });
const useOf = (state: GameState, instanceId: string) =>
  getLegalMoves(state, 0, "Dis").filter((move): move is Extract<GameMove, { type: "use" }> => move.type === "use" && move.instanceId === instanceId);

beforeEach(() => setAbilityOverrides(new Map([[ROW.cardId, ROW]])));
afterEach(() => setAbilityOverrides(new Map()));

describe("QA-05 · Dominator Bauble — linha vendored", () => {
  it("passa no validador e o hash é o do texto impresso (id 96548d93 e o id 76fce6b7 com \\r\\n)", () => {
    expect(normaliseAbilityOverride(ROW)).not.toBeNull();
    expect(ROW.textHash).toBe(textHash(PRINTED));
    expect(textHash(`${PRINTED}\r\n`)).toBe(ROW.textHash);
  });
});

describe("QA-05 · (a) casa não filtra a criatura usada", () => {
  it("a Untamed amiga entra nos alvos do uso e o prompt lutar/colher é oferecido", () => {
    const b = bauble();
    const g = grunt();
    const state = setupTest({ inPlay: [b, g, card("Ally", { type: "Creature", house: "Dis", power: 1, text: "" })] }, { inPlay: [foe()] }, "Dis");
    const moves = useOf(state, b.instanceId);
    expect(moves.some((move) => move.target === g.instanceId && move.mode === "a")).toBe(true);
    expect(moves.some((move) => move.target === g.instanceId && move.mode === "b")).toBe(true);
    expect(pendingPrompt(state, 0, { type: "use", instanceId: b.instanceId, target: g.instanceId })).toMatchObject({ kind: "mode", choice: "option" });
  });

  it("usar a Untamed amiga em Dis aplica o efeito (colheita de âmbar)", () => {
    const b = bauble();
    const g = grunt();
    const state = setupTest({ inPlay: [b, g] }, { inPlay: [foe()] }, "Dis");
    const after = applyMove(state, 0, { type: "use", instanceId: b.instanceId, target: g.instanceId, mode: "a" });
    expect(after.players[0].amber).toBe(1);
  });
});

describe("QA-05 · (b) criatura exausta ou atordoada não é usável", () => {
  it("exausta: fora dos alvos legais e sem efeito se forçada", () => {
    const b = bauble();
    const g = grunt(false);
    const state = setupTest({ inPlay: [b, g] }, { inPlay: [foe()] }, "Dis");
    expect(useOf(state, b.instanceId).some((move) => move.target === g.instanceId)).toBe(false);
    const after = applyMove(state, 0, { type: "use", instanceId: b.instanceId, target: g.instanceId, mode: "a" });
    expect(after.players[0].amber).toBe(0);
    expect(after.players[0].board.find((c) => c.instanceId === g.instanceId)?.ready).toBe(false);
  });

  it("atordoada: o uso não resolve nem a colheita nem a luta", () => {
    const b = bauble();
    const g = { ...grunt(), stunned: true };
    const state = setupTest({ inPlay: [b, g] }, { inPlay: [foe()] }, "Dis");
    const after = applyMove(state, 0, { type: "use", instanceId: b.instanceId, target: g.instanceId, mode: "b" });
    expect(after.players[0].amber).toBe(0);
    expect(after.players[1].board.some((c) => c.face.title === "Foe")).toBe(true);
  });
});

describe("QA-05 · (c) o caminho escolhido aplica o efeito certo", () => {
  it("modo a (colher): a criatura sem Action colhe 1 âmbar e o inimigo fica intacto", () => {
    const b = bauble();
    const g = grunt();
    const f = foe();
    const state = setupTest({ inPlay: [b, g] }, { inPlay: [f] }, "Dis");
    const after = applyMove(state, 0, { type: "use", instanceId: b.instanceId, target: g.instanceId, mode: "a" });
    expect(after.players[0].amber).toBe(1);
    expect(after.players[1].board.find((c) => c.instanceId === f.instanceId)?.damage ?? 0).toBe(0);
  });

  it("modo b (lutar): a criatura luta contra o inimigo (dano no defensor, sem colheita)", () => {
    const b = bauble();
    const g = grunt();
    const state = setupTest({ inPlay: [b, g] }, { inPlay: [foe()] }, "Dis");
    const after = applyMove(state, 0, { type: "use", instanceId: b.instanceId, target: g.instanceId, mode: "b" });
    expect(after.players[0].amber).toBe(0);
    // Foe (power 1) morre no combate contra o Grunt (power 3): dano só no defensor destruído.
    expect(after.players[1].board.some((c) => c.face.title === "Foe")).toBe(false);
    expect(after.players[0].board.find((c) => c.instanceId === g.instanceId)?.damage).toBe(1);
  });

  it("modo a com criatura de Action impressa usa a Action (default do motor, decisão documentada)", () => {
    const b = bauble();
    const thief = card("Thief", { type: "Creature", house: "Untamed", power: 2, text: "Action: Steal 2A." });
    const state = setupTest({ inPlay: [b, thief] }, { amber: 5 }, "Dis");
    const after = applyMove(state, 0, { type: "use", instanceId: b.instanceId, target: thief.instanceId, mode: "a" });
    expect(after.players[0].amber).toBe(2);
    expect(after.players[1].amber).toBe(3);
  });
});

describe("QA-05 · (d) o artefato se exaustiona ao ser usado", () => {
  it.each(["a", "b"] as const)("modo %s: o Dominator Bauble fica exausto após o uso", (mode) => {
    const b = bauble();
    const g = grunt();
    const state = setupTest({ inPlay: [b, g] }, { inPlay: [foe()] }, "Dis");
    const after = applyMove(state, 0, { type: "use", instanceId: b.instanceId, target: g.instanceId, mode });
    expect(after.players[0].board.find((c) => c.instanceId === b.instanceId)?.ready).toBe(false);
  });
});
