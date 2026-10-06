// SPDX-License-Identifier: AGPL-3.0-only
// Lote 15e (DSL_VERSION 17, PARSER_VERSION 21): os engineGaps do 15d fechados —
// `Restrict.who: "any"` (os dois lados), `takeControl` como efeito durável
// (resolvido como o ato e devolvido com a janela), lasting COM gatilho (o
// observador concedido à fonte, sob os budgets) e a janela BEFORE (o observador
// de beforeFight + o registrador interrupt do conversor). Prints reais do
// corpus; linhas na forma que o Conversor emite. Foco em COMPORTAMENTO: caminho
// feliz, contra-caso fora da janela/filtro, recusa, shape gate e anti-laço.
import { afterEach, describe, expect, it } from "vitest";
import { DSL_VERSION, normaliseAbilityOverride, setAbilityOverrides, type AbilityOverride } from "./abilities";
import { PARSER_VERSION, parseCardText, textHash } from "./cardText";
import { applyMove, chooseHouse, endTurn, type CardFace, type GameState } from "./game";
import { DSL_SCHEMA } from "./generated/dslSchema";
import { card, setupTest } from "./testkit";

afterEach(() => setAbilityOverrides(new Map()));

const SOW_SALT = "Play: Until the start of your next turn, creatures cannot reap.";
const CRYSTAL_HIVE = "Action: For the remainder of the turn, gain 1<A> each time a creature reaps.";
const EVASION_SIGIL = "Before a creature fights, draw a card.";

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
const passTurn = (state: GameState, side: 0 | 1, house?: string) => {
  const next = endTurn(state, side);
  return chooseHouse(next, next.activePlayer, house ?? next.players[next.activePlayer].houses[0]);
};

describe("contract", () => {
  it("bumps both versions; the schema carries the any/control windows", () => {
    expect(DSL_VERSION).toBe(17);
    expect(PARSER_VERSION).toBe(22);
    expect(DSL_SCHEMA).toContain('"any"');
    expect(DSL_SCHEMA).toContain('control?: "you" | "opponent"');
  });
});

describe("shape gate (escolhas fechadas do 15e)", () => {
  it("accepts who any, control and a granted observer (aceita-forma)", () => {
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "lasting", e: { target: {}, restrict: { who: "any", action: "reap" }, duration: "next" } }] }]))?.v).toBe(DSL_VERSION);
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "lasting", e: { target: { type: "Creature" }, control: "you", duration: "turn" } }] }]))?.v).toBe(DSL_VERSION);
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "lasting", e: { target: { self: true }, abilities: [{ on: ["reap"], of: {}, acts: [{ k: "gainAmber", n: 1 }] }], duration: "turn" } }] }]))?.v).toBe(DSL_VERSION);
  });

  it("rejects the values the engine would misread", () => {
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "lasting", e: { target: {}, restrict: { who: "both", action: "reap" } } }] }]))).toBeNull();
    const badAbilities = [{ on: ["play"], acts: [{ k: "lasting", e: { target: { self: true }, abilities: [{ on: ["nope"], acts: [{ k: "draw", n: 1 }] }] } }] }];
    expect(normaliseAbilityOverride(row(badAbilities))).toBeNull();
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "lasting", e: { target: { self: true }, abilities: [{ on: ["nope"], acts: [{ k: "draw", n: 1 }] }] } }] }]))).toBeNull();
  });
});

describe("Restrict.who \"any\" (os dois lados)", () => {
  it("'creatures cannot reap' proíbe os DOIS lados (Sow Salt)", () => {
    const spell = card("Sow Salt", { type: "Action", house: "Dis", text: SOW_SALT });
    const mine = card("My Reap", { type: "Creature", house: "Dis", power: 3 });
    const foe = card("Foe Reap", { type: "Creature", house: "Dis", power: 3 });
    const cast = applyMove(setupTest({ hand: [spell], inPlay: [mine] }, { inPlay: [foe] }, "Dis"), 0, { type: "play", instanceId: spell.instanceId });
    // nem eu nem o oponente reapam nessa janela
    const myReap = applyMove(cast, 0, { type: "reap", instanceId: cast.players[0].board.find((c) => c.face.title === "My Reap")!.instanceId });
    expect(myReap.players[0].amber).toBe(0);
    const foeReap = applyMove(cast, 1, { type: "reap", instanceId: cast.players[1].board[0].instanceId });
    expect(foeReap.players[1].amber).toBe(0);
  });

  it("contra-caso: com o dono no print (who you/opponent) so ele e proibido", () => {
    const spell = card("Your Own", { type: "Action", house: "Dis", text: "Play: Until the start of your next turn, your creatures cannot reap." });
    const mine = card("My Reap", { type: "Creature", house: "Dis", power: 3 });
    const foeHouse = setupTest({}, {}).players[1].houses[0];
    const foe = card("Foe Reap", { type: "Creature", house: foeHouse, power: 3 });
    const cast = applyMove(setupTest({ hand: [spell], inPlay: [mine] }, { inPlay: [foe] }, "Dis"), 0, { type: "play", instanceId: spell.instanceId });
    const myReap = applyMove(cast, 0, { type: "reap", instanceId: cast.players[0].board.find((c) => c.face.title === "My Reap")!.instanceId });
    expect(myReap.players[0].amber).toBe(0);
    const foeTurn = passTurn(myReap, 0, foeHouse);
    const foeReap = applyMove(foeTurn, 1, { type: "reap", instanceId: foeTurn.players[1].board.find((c) => c.face.title === "Foe Reap")!.instanceId });
    expect(foeReap.players[1].amber).toBe(1);
  });
});

describe("takeControl como efeito durável", () => {
  it("toma a criatura inimiga durante a janela e devolve com o fim dela", () => {
    const spell = card("Mind Hook", { type: "Action", house: "Dis", text: "Play: …" });
    const foe = card("Foe", { type: "Creature", house: "Dis", power: 3 });
    setAbilityOverrides(new Map([[spell.face.id, overrideFor(spell.face, [
      { on: ["play"], acts: [{ k: "lasting", e: { target: { type: "Creature", side: "enemy" }, control: "you", duration: "turn" } }] },
    ])]]));
    const cast = applyMove(setupTest({ hand: [spell] }, { inPlay: [foe] }, "Dis"), 0, { type: "play", instanceId: spell.instanceId });
    expect(cast.players[0].board.some((c) => c.face.title === "Foe")).toBe(true);
    expect(cast.players[1].board).toHaveLength(0);
    const after = passTurn(cast, 0);
    expect(after.players[0].board.some((c) => c.face.title === "Foe")).toBe(false);
    expect(after.players[1].board.some((c) => c.face.title === "Foe")).toBe(true);
  });

  it("control: \"opponent\" entrega a própria criatura (contra-caso)", () => {
    const spell = card("Gift Hook", { type: "Action", house: "Dis", text: "Play: …" });
    const mine = card("Mine", { type: "Creature", house: "Dis", power: 3 });
    setAbilityOverrides(new Map([[spell.face.id, overrideFor(spell.face, [
      { on: ["play"], acts: [{ k: "lasting", e: { target: { type: "Creature", side: "friendly" }, control: "opponent", duration: "turn" } }] },
    ])]]));
    const cast = applyMove(setupTest({ hand: [spell], inPlay: [mine] }, {}, "Dis"), 0, { type: "play", instanceId: spell.instanceId });
    expect(cast.players[1].board.some((c) => c.face.title === "Mine")).toBe(true);
  });
});

describe("lasting com gatilho (observador concedido a fonte)", () => {
  it("Crystal Hive: cada reap rende 1 durante a janela - e nada fora dela", () => {
    const hive = card("Crystal Hive", { type: "Creature", house: "Mars", text: CRYSTAL_HIVE, power: 3 });
    setAbilityOverrides(new Map([[hive.face.id, overrideFor(hive.face, [
      { on: ["action"], acts: [{ k: "lasting", e: { target: { self: true }, abilities: [{ on: ["reap"], of: {}, acts: [{ k: "gainAmber", n: 1 }] }], duration: "turn" } }] },
    ])]]));
    const mine = card("My Reaper", { type: "Creature", house: "Mars", power: 3 });
    const foeHouse = setupTest({}, {}).players[1].houses[0];
    const foe = card("Foe Reaper", { type: "Creature", house: foeHouse, power: 3 });
    const cast = applyMove(setupTest({ inPlay: [hive, mine] }, { inPlay: [foe] }, "Mars"), 0, { type: "use", instanceId: hive.instanceId, house: "Mars" });
    const myReaper = cast.players[0].board.find((c) => c.face.title === "My Reaper")!;
    const during = applyMove(cast, 0, { type: "reap", instanceId: myReaper.instanceId });
    expect(during.players[0].amber).toBe(2); // 1 do proprio reap + 1 do observador
    const foeTurn = passTurn(during, 0, foeHouse);
    const foeReaper = foeTurn.players[1].board.find((c) => c.face.title === "Foe Reaper")!;
    const later = applyMove(foeTurn, 1, { type: "reap", instanceId: foeReaper.instanceId });
    expect(later.players[1].amber).toBe(1); // so o reap - a janela fechou
  });

  it("anti-laco: uma cadeia self-reap com o observador concedido e cortada pelos budgets", () => {
    const looper = card("Loop Hive", { type: "Creature", house: "Dis", text: "Reap: Ready this creature and use this creature via reap.", power: 200 });
    setAbilityOverrides(new Map([[looper.face.id, overrideFor(looper.face, [
      { on: ["reap"], acts: [{ k: "ready", s: "self" }, { k: "use", s: "self", via: "reap" }] },
      { on: ["action"], acts: [{ k: "lasting", e: { target: { self: true }, abilities: [{ on: ["reap"], of: {}, acts: [{ k: "gainAmber", n: 1 }] }], duration: "turn" } }] },
    ])]]));
    const cast = applyMove(setupTest({ inPlay: [looper] }, {}, "Dis"), 0, { type: "reap", instanceId: looper.instanceId });
    expect(cast.players[0].board).toHaveLength(1);
    expect(cast.players[0].amber).toBeLessThanOrEqual(70);
  });
});

describe("janela BEFORE", () => {
  it("'Before a creature fights' é o observador de beforeFight (regressão: era vanilla)", () => {
    const parsed = parse("Evasion Sigil", EVASION_SIGIL, "Artifact", "Logos");
    expect(parsed.coverage).toBe("full");
    expect(parsed.abilities).toEqual([{ on: ["beforeFight"], of: { type: "Creature" }, acts: [{ k: "draw", n: 1 }] }]);
  });

  it("o observador beforeFight resolve na luta; o filtro é o contra-caso", () => {
    const watcher = card("Watcher", { type: "Creature", house: "Logos", text: EVASION_SIGIL, power: 3 });
    setAbilityOverrides(new Map([[watcher.face.id, overrideFor(watcher.face, [
      { on: ["beforeFight"], of: { type: "Creature" }, acts: [{ k: "draw", n: 1 }] },
    ])]]));
    const attacker = card("Attacker", { type: "Creature", house: "Dis", power: 5 });
    const defender = card("Defender", { type: "Creature", house: "Dis", power: 1 });
    const cast = applyMove(setupTest({ inPlay: [watcher, attacker], deck: [card("Drawn A", { house: "Dis" })] }, { inPlay: [defender] }, "Dis"), 0, { type: "fight", attackerId: attacker.instanceId, targetId: defender.instanceId });
    expect(cast.players[0].hand).toHaveLength(1);
    // contra-caso: o filtro não casa (artefato não luta) — nada de draw
    const watcher2 = card("Watcher 2", { type: "Creature", house: "Logos", text: EVASION_SIGIL, power: 3 });
    setAbilityOverrides(new Map([[watcher2.face.id, overrideFor(watcher2.face, [
      { on: ["beforeFight"], of: { type: "Artifact" }, acts: [{ k: "draw", n: 1 }] },
    ])]]));
    const attacker2 = card("Attacker 2", { type: "Creature", house: "Dis", power: 5 });
    const defender2 = card("Defender 2", { type: "Creature", house: "Dis", power: 1 });
    const missed = applyMove(setupTest({ inPlay: [watcher2, attacker2], deck: [card("Drawn B", { house: "Dis" })] }, { inPlay: [defender2] }, "Dis"), 0, { type: "fight", attackerId: attacker2.instanceId, targetId: defender2.instanceId });
    expect(missed.players[0].hand).toHaveLength(0);
  });
});
