// SPDX-License-Identifier: AGPL-3.0-only
// Lote 15d (DSL_VERSION 16, PARSER_VERSION 19): lasting-effects — a janela que
// faltava ("during/until the end of your next turn" = `nextTurn`, turnStamp +
// 3, igual ao `untilPlayerNextTurnEnd` do keyteki) e o vocabulário de duração
// fechado no shape gate. O ponto é a EXPIRAÇÃO: cada `duration` vira um `until`
// de turnStamp e o lasting some quando o stamp alcança — testado atravessando
// endTurn (o passo de turno do oponente e o retorno ao dono). Prints reais do
// corpus; linhas na forma que o Conversor emite (kind `lasting`).
import { afterEach, describe, expect, it } from "vitest";
import { DSL_VERSION, normaliseAbilityOverride, setAbilityOverrides, type AbilityOverride } from "./abilities";
import { PARSER_VERSION, parseCardText, textHash } from "./cardText";
import { applyMove, chooseHouse, effectivePower, endTurn, type CardFace, type GameState } from "./game";
import { DSL_SCHEMA } from "./generated/dslSchema";
import { card, setupTest } from "./testkit";

afterEach(() => setAbilityOverrides(new Map()));

const FOOGBANK = "Play: Your opponent cannot use creatures to fight on their next turn.";
const YOUR_NEXT = "Play: During your next turn, this creature gets +2 power.";
const REMAINDER = "Play: For the remainder of the turn, this creature gets +2 power.";

const face = (title: string, text: string, type: string, house: string): CardFace => ({ id: title, title, house, type, image: "", text, amber: 0, power: 3, armor: 0 });
const parse = (title: string, text: string, type: string, house: string) => parseCardText(face(title, text, type, house));
const row = (dsl: unknown[], extra: object = {}) => ({ cardId: "c", dsl, textHash: "h", source: "manual" as const, v: DSL_VERSION, ...extra });
const overrideFor = (c: CardFace, dsl: AbilityOverride["dsl"]): AbilityOverride => ({
  cardId: c.id,
  dsl,
  effects: [],
  keywords: {},
  textHash: textHash(c.text),
  source: "manual",
  reviewed: true,
  generatedAt: 1,
  v: DSL_VERSION,
});
/** Joga a criatura com a linha e devolve o estado; a criatura é players[0].board[0]. */
const playWith = (dsl: AbilityOverride["dsl"]) => {
  const critter = card("Bearer", { type: "Creature", house: "Mars", text: "Play: …", power: 3 });
  setAbilityOverrides(new Map([[critter.face.id, overrideFor(critter.face, dsl)]]));
  const state = applyMove(setupTest({ hand: [critter] }, {}, "Mars"), 0, { type: "play", instanceId: critter.instanceId });
  return { critter, state };
};
const powerOf = (state: GameState) => effectivePower(state, state.players[0].board[0]);
/** Passa o turno E escolhe a casa do lado que entrou (o endTurn zera activeHouse). */
const passTurn = (state: GameState, side: 0 | 1) => {
  const next = endTurn(state, side);
  return chooseHouse(next, next.activePlayer, next.players[next.activePlayer].houses[0]);
};

describe("contract", () => {
  it("bumps both versions; the schema carries the new window", () => {
    expect(DSL_VERSION).toBe(16);
    expect(PARSER_VERSION).toBe(19);
    expect(DSL_SCHEMA).toContain('"nextTurn"');
    expect(DSL_SCHEMA).toContain('"turn" | "next" | "nextTurn"');
  });
});

describe("shape gate (a duração é uma escolha fechada)", () => {
  it("accepts the three windows (aceita-forma)", () => {
    for (const duration of ["turn", "next", "nextTurn"]) {
      expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "lasting", e: { target: {}, power: 2, duration } }] }]))?.v).toBe(DSL_VERSION);
    }
  });

  it("rejects a duration the engine would misread", () => {
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "lasting", e: { target: {}, power: 2, duration: "untilLeavesPlay" } }] }]))).toBeNull();
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "lasting", e: { target: {}, power: 2, duration: 3 } }] }]))).toBeNull();
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "lasting", e: { target: {}, power: 2, until: "soon" } }] }]))).toBeNull();
  });
});

describe("duration expiry (endTurn consome a janela)", () => {
  it("'nextTurn' sobrevive ao turno do oponente e ao seu próximo turno, e expira no fim dele", () => {
    const { critter, state } = playWith([{ on: ["play"], acts: [{ k: "lasting", e: { target: { self: true }, power: 2, duration: "nextTurn" } }] }]);
    expect(powerOf(state)).toBe(5);
    const foeTurn = passTurn(state, 0);
    expect(powerOf(foeTurn)).toBe(5); // ainda ativo no turno do oponente
    const myNext = passTurn(foeTurn, 1);
    expect(powerOf(myNext)).toBe(5); // e no meu próximo turno
    const after = passTurn(myNext, 0);
    expect(powerOf(after)).toBe(3); // podado no fim do meu próximo turno
    expect(critter.face.power).toBe(3);
  });

  it("'turn' expira ao fim do turno corrente (contra-caso: fora da janela)", () => {
    const { state } = playWith([{ on: ["play"], acts: [{ k: "lasting", e: { target: { self: true }, power: 2, duration: "turn" } }] }]);
    expect(powerOf(state)).toBe(5);
    const after = passTurn(state, 0);
    expect(powerOf(after)).toBe(3);
  });

  it("'next' dura até o início do seu próximo turno — e não mais", () => {
    const { state } = playWith([{ on: ["play"], acts: [{ k: "lasting", e: { target: { self: true }, power: 2, duration: "next" } }] }]);
    expect(powerOf(state)).toBe(5);
    const foeTurn = passTurn(state, 0);
    expect(powerOf(foeTurn)).toBe(5);
    const myNext = passTurn(foeTurn, 1);
    expect(powerOf(myNext)).toBe(3);
  });
});

describe("recusa de opcional dentro do lasting", () => {
  it("declinado não grava efeito; aceitado grava (o lasting é o ato opcional)", () => {
    const dsl: AbilityOverride["dsl"] = [{ on: ["play"], acts: [{ k: "lasting", e: { target: { self: true }, power: 2, duration: "turn" }, optional: true }] }];
    const critter = card("Bearer", { type: "Creature", house: "Mars", text: "Play: …", power: 3 });
    setAbilityOverrides(new Map([[critter.face.id, overrideFor(critter.face, dsl)]]));
    const declined = applyMove(setupTest({ hand: [critter] }, {}, "Mars"), 0, { type: "play", instanceId: critter.instanceId, decline: true });
    expect(effectivePower(declined, declined.players[0].board[0])).toBe(3);
    const critter2 = card("Bearer", { type: "Creature", house: "Mars", text: "Play: …", power: 3 });
    setAbilityOverrides(new Map([[critter2.face.id, overrideFor(critter2.face, dsl)]]));
    const accepted = applyMove(setupTest({ hand: [critter2] }, {}, "Mars"), 0, { type: "play", instanceId: critter2.instanceId });
    expect(effectivePower(accepted, accepted.players[0].board[0])).toBe(5);
  });
});

describe("orçamento anti-laço", () => {
  it("uma cadeia self-reap que grava lasting a cada passo é cortada pelo FIRE_BUDGET", () => {
    const looper = card("Loop Tester", { type: "Creature", house: "Dis", text: "Reap: Ready this creature and use this creature via reap.", power: 200 });
    setAbilityOverrides(new Map([
      [looper.face.id, overrideFor(looper.face, [
        { on: ["reap"], acts: [{ k: "ready", s: "self" }, { k: "use", s: "self", via: "reap" }, { k: "lasting", e: { target: { self: true }, power: 1, duration: "turn" } }] },
      ])],
    ]));
    const cast = applyMove(setupTest({ inPlay: [looper] }, {}, "Dis"), 0, { type: "reap", instanceId: looper.instanceId });
    // o movimento voltou e os lastings acumulados ficaram dentro do orçamento
    expect(cast.players[0].board).toHaveLength(1);
    expect(cast.lasting?.length ?? 0).toBeLessThanOrEqual(64);
  });
});

describe("grafias do cluster (cartas reais)", () => {
  it("'During your next turn, X' lê a janela nextTurn (regressão: era vanilla)", () => {
    const parsed = parse("Zephyr Node", YOUR_NEXT, "Creature", "Mars");
    expect(parsed.coverage).toBe("full");
    expect(parsed.abilities).toEqual([{ on: ["play"], acts: [{ k: "lasting", e: { target: { self: true }, power: 2, duration: "nextTurn" } }] }]);
  });

  it("'For the remainder of the turn, X' continua na janela turn", () => {
    const parsed = parse("Kilo Vault", REMAINDER, "Creature", "Mars");
    expect(parsed.coverage).toBe("full");
    expect(parsed.abilities).toEqual([{ on: ["play"], acts: [{ k: "lasting", e: { target: { self: true }, power: 2, duration: "turn" } }] }]);
  });

  it("Fogbank lê o restrict com a duração next (forma do Conversor)", () => {
    const parsed = parse("Fogbank", FOOGBANK, "Action", "Dis");
    expect(parsed.coverage).toBe("full");
    expect(parsed.abilities).toEqual([{ on: ["play"], acts: [{ k: "lasting", e: { target: {}, restrict: { who: "opponent", action: "fight" }, duration: "next" } }] }]);
  });
});
