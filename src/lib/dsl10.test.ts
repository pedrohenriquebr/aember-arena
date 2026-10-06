// SPDX-License-Identifier: AGPL-3.0-only
// Lote 10 (DSL_VERSION 10): `peek` (Psychic Bug's "Look at your opponent's hand") and the fight-time
// `attackBonus`/`whenAttacking` (Valdr). Both cards are read from their REAL printed text.
import { afterEach, describe, expect, it } from "vitest";
import { DSL_VERSION, normaliseAbilityOverride, setAbilityOverrides } from "./abilities";
import { PARSER_VERSION, parseCardText } from "./cardText";
import { FEW_SHOTS } from "./catalogLlm";
import { applyMove, attackBonusAgainst, chooseHouse, endTurn, revealsHiddenInfo, effectivePower, type CardFace } from "./game";
import { DSL_SCHEMA } from "./generated/dslSchema";
import { card, setupTest } from "./testkit";

afterEach(() => setAbilityOverrides(new Map()));

const PSYCHIC = "Play/Reap: Look at your opponent's hand.";
const PSYCHIC_NEW = "Play/After Reap: Look at your opponent’s hand.";
const VALDR = "Valdr deals +2 while attacking an enemy creature on the flank.";
const VALDR_NEW = "Valdr deals +2<D> while attacking an enemy flank creature.";
const face = (title: string, text: string, type = "Creature"): CardFace => ({ id: title, title, house: "Brobnar", type, image: "", text, amber: 0, power: 2, armor: 0 });

const row = (dsl: unknown[], extra: object = {}) => ({ cardId: "c", dsl, textHash: "h", source: "manual" as const, v: DSL_VERSION, ...extra });
const FLANK = { type: "Creature", side: "enemy", flank: true };

describe("contract", () => {
  it("bumps both versions and the prompt schema carries the new fields", () => {
    expect(DSL_VERSION).toBe(14);
    expect(PARSER_VERSION).toBe(16);
    expect(DSL_SCHEMA).toContain('k: "peek"');
    expect(DSL_SCHEMA).toContain("attackBonus?: number");
    expect(DSL_SCHEMA).toContain("whenAttacking?: Filter");
  });

  it("ships a few-shot per mechanic", () => {
    for (const text of [PSYCHIC, "~ deals +2<D> while attacking an enemy creature on the flank."]) expect(FEW_SHOTS.some((shot) => shot.text === text)).toBe(true);
  });
});

describe("parser", () => {
  it("reads Psychic Bug (both printed wordings) as a peek at the opponent's hand, full coverage", () => {
    for (const text of [PSYCHIC, PSYCHIC_NEW]) {
      const rules = parseCardText(face("Psychic Bug", text));
      expect(rules.coverage).toBe("full");
      expect(rules.abilities).toHaveLength(1);
      expect(rules.abilities[0].acts).toEqual([{ k: "peek", from: "hand", opp: true }]);
      expect(rules.abilities[0].on).toContain("play");
      expect(rules.abilities[0].on).toContain("reap");
    }
  });

  it("reads the deck forms, and leaves a peek that is acted upon incomplete", () => {
    expect(parseCardText(face("A", "Play: Look at the top 3 cards of your deck.", "Action")).abilities[0].acts).toEqual([{ k: "peek", from: "deck", n: 3 }]);
    expect(parseCardText(face("A", "Play: Look at the top card of your opponent's deck.", "Action")).abilities[0].acts).toEqual([{ k: "peek", from: "deck", opp: true }]);
    const acted = parseCardText(face("A", "Play: Look at the top card of your deck. You may play that card.", "Action"));
    expect(acted.coverage).not.toBe("full");
    expect(parseCardText(face("A", "Play: Look at your opponent's hand and play a creature from it.", "Action")).coverage).toBe("vanilla");
  });

  it("reads both Valdr wordings as an attacker-only bonus against a flank enemy", () => {
    for (const text of [VALDR, VALDR_NEW]) {
      const rules = parseCardText(face("Valdr", text));
      expect(rules.coverage).toBe("full");
      expect(rules.effects).toEqual([{ target: { self: true }, attackBonus: 2, whenAttacking: FLANK }]);
    }
  });
});

describe("shape gate", () => {
  it("accepts peek and attackBonus, in a constant effect and in a lasting act", () => {
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "peek", from: "deck", n: 2 }] }]))).not.toBeNull();
    expect(normaliseAbilityOverride(row([], { effects: [{ target: { self: true }, attackBonus: 2, whenAttacking: FLANK }] }))).not.toBeNull();
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "lasting", e: { target: { type: "Creature" }, attackBonus: 1, duration: "turn" } }] }]))).not.toBeNull();
  });

  it("rejects what the engine would misread", () => {
    for (const act of [{ k: "peek", from: "discard" }, { k: "peek", from: "deck", n: 0 }, { k: "peek", from: "deck", n: 1.5 }, { k: "peek", from: "hand", s: "self" }, { k: "peek" }]) {
      expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [act] }]))).toBeNull();
    }
    for (const effect of [
      { target: {}, attackBonus: 0 },
      { target: {}, attackBonus: "2" },
      { target: {}, whenAttacking: FLANK },
      { target: {}, attackBonus: 2, whenAttacking: { flank: true, nope: true } },
    ]) {
      expect(normaliseAbilityOverride(row([], { effects: [effect] }))).toBeNull();
    }
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "lasting", e: { target: {}, whenAttacking: FLANK, duration: "turn" } }] }]))).toBeNull();
  });
});

describe("peek (Psychic Bug)", () => {
  const setup = () => {
    const bug = card("Psychic Bug", { type: "Creature", house: "Logos", text: PSYCHIC, power: 2 });
    const secret = [card("Secret Alpha", { type: "Action", house: "Dis" }), card("Secret Beta", { type: "Creature", house: "Mars" })];
    return { bug, secret, state: setupTest({ hand: [bug] }, { hand: secret }, "Logos") };
  };

  it("shows the opponent's hand to the acting side, in a modal-ready snapshot", () => {
    const { bug, secret, state } = setup();
    const next = applyMove(state, 0, { type: "play", instanceId: bug.instanceId });
    expect(next.peek).toMatchObject({ side: 0, owner: 1, from: "hand" });
    expect(next.peek?.faces.map((item) => item.title)).toEqual(secret.map((item) => item.face.title));
    expect(next.players[1].hand).toHaveLength(2);
  });

  it("logs only how many cards were looked at, never which", () => {
    const { bug, state } = setup();
    const next = applyMove(state, 0, { type: "play", instanceId: bug.instanceId });
    const entry = next.log.find((item) => item.key === "log.peek");
    expect(entry?.params.n).toBe("2");
    const logged = JSON.stringify(next.log);
    expect(logged).not.toContain("Secret");
    expect(logged).not.toContain("Alpha");
  });

  it("the snapshot is plain JSON data, reap opens it again and the next move replaces it", () => {
    const { bug, state } = setup();
    const next = applyMove(state, 0, { type: "play", instanceId: bug.instanceId });
    expect(JSON.parse(JSON.stringify(next.peek))).toEqual(next.peek);
    const reaper = next.players[0].board.find((item) => item.instanceId === bug.instanceId)!;
    reaper.ready = true;
    const after = applyMove(next, 0, { type: "reap", instanceId: bug.instanceId });
    expect(after.peek).toMatchObject({ side: 0, from: "hand" });
    expect(after.peek).not.toBe(next.peek);
  });

  it("a move that peeks at nothing clears the previous snapshot", () => {
    const { bug, state } = setup();
    const next = applyMove(state, 0, { type: "play", instanceId: bug.instanceId });
    const filler = card("Filler", { type: "Creature", house: "Logos", power: 1 });
    next.players[0].hand = [filler];
    const after = applyMove(next, 0, { type: "play", instanceId: filler.instanceId });
    expect(after.peek).toBeUndefined();
  });

  it("undoing a peek needs confirmation: it counts as revealed information", () => {
    const { bug, state } = setup();
    const next = applyMove(state, 0, { type: "play", instanceId: bug.instanceId });
    expect(revealsHiddenInfo(state, next)).toBe(true);
    const quiet = card("Quiet", { type: "Creature", house: "Logos", power: 1 });
    const plain = setupTest({ hand: [quiet] }, {}, "Logos");
    expect(revealsHiddenInfo(plain, applyMove(plain, 0, { type: "play", instanceId: quiet.instanceId }))).toBe(false);
  });

  it("a peek made last in the turn does not cross endTurn", () => {
    const { bug, state } = setup();
    const next = applyMove(state, 0, { type: "play", instanceId: bug.instanceId });
    expect(next.peek).toBeDefined();
    expect(endTurn(next, 0).peek).toBeUndefined();
  });

  it("choosing the house clears a stale peek", () => {
    const { state } = setup();
    const stale = { ...state, activeHouse: null, peek: { side: 0 as const, owner: 1 as const, from: "hand" as const, faces: [] } };
    expect(chooseHouse(stale, 0, "Logos").peek).toBeUndefined();
  });

  it("an empty hand is looked at (count 0) without opening anything", () => {
    const bug = card("Psychic Bug", { type: "Creature", house: "Logos", text: PSYCHIC, power: 2 });
    const state = setupTest({ hand: [bug] }, {}, "Logos");
    const next = applyMove(state, 0, { type: "play", instanceId: bug.instanceId });
    expect(next.peek).toBeUndefined();
    expect(next.log.find((item) => item.key === "log.peek")?.params.n).toBe("0");
  });

  it("the deck form reads the top N cards, top first, and does not move them", () => {
    const spy = card("Spy", { type: "Action", house: "Logos", text: "Play: Look at the top 2 cards of your opponent's deck." });
    const deck = [card("Bottom"), card("Middle"), card("Top")];
    const state = setupTest({ hand: [spy] }, { deck }, "Logos");
    const next = applyMove(state, 0, { type: "play", instanceId: spy.instanceId });
    expect(next.peek?.faces.map((item) => item.title)).toEqual(["Top", "Middle"]);
    expect(next.peek).toMatchObject({ from: "deck", owner: 1 });
    expect(next.players[1].deck).toHaveLength(3);
  });
});

describe("attackBonus (Valdr)", () => {
  const valdr = () => card("Valdr", { type: "Creature", house: "Brobnar", text: VALDR, power: 6 });
  const enemy = (title: string, extra: Partial<CardFace> = {}) => card(title, { type: "Creature", house: "Dis", power: 20, ...extra });

  it("deals +2 attacking a flank creature", () => {
    const attacker = valdr();
    const foe = enemy("Flanker");
    const next = applyMove(setupTest({ inPlay: [attacker] }, { inPlay: [foe] }, "Brobnar"), 0, { type: "fight", attackerId: attacker.instanceId, targetId: foe.instanceId });
    expect(next.players[1].board[0].damage).toBe(8);
  });

  it("deals the plain power attacking a creature that is not on a flank", () => {
    const attacker = valdr();
    const [left, middle, right] = [enemy("L"), enemy("M"), enemy("R")];
    const next = applyMove(setupTest({ inPlay: [attacker] }, { inPlay: [left, middle, right] }, "Brobnar"), 0, { type: "fight", attackerId: attacker.instanceId, targetId: middle.instanceId });
    expect(next.players[1].board.find((item) => item.instanceId === middle.instanceId)?.damage).toBe(6);
    const onFlank = applyMove(setupTest({ inPlay: [attacker] }, { inPlay: [left, middle, right] }, "Brobnar"), 0, { type: "fight", attackerId: attacker.instanceId, targetId: right.instanceId });
    expect(onFlank.players[1].board.find((item) => item.instanceId === right.instanceId)?.damage).toBe(8);
  });

  it("is not power: the displayed power stays 6 and a defending Valdr gets no bonus", () => {
    const attacker = valdr();
    const foe = enemy("Flanker");
    const state = setupTest({ inPlay: [attacker] }, { inPlay: [foe] }, "Brobnar");
    expect(effectivePower(state, state.players[0].board[0])).toBe(6);
    expect(attackBonusAgainst(state, foe, attacker)).toBe(0);
    expect(attackBonusAgainst(state, attacker, foe)).toBe(2);
  });

  it("deals no damage at all to an Elusive flank defender (the bonus does not break Elusive)", () => {
    const attacker = valdr();
    const slippery = enemy("Slippery", { text: "Elusive.", power: 20 });
    const state = setupTest({ inPlay: [attacker] }, { inPlay: [slippery] }, "Brobnar");
    const first = applyMove(state, 0, { type: "fight", attackerId: attacker.instanceId, targetId: slippery.instanceId });
    expect(first.players[1].board[0].damage).toBe(0);
    expect(first.players[0].board[0].damage).toBe(0);
    first.players[0].board[0].ready = true;
    const second = applyMove(first, 0, { type: "fight", attackerId: attacker.instanceId, targetId: slippery.instanceId });
    expect(second.players[1].board[0].damage).toBe(8);
  });

  it("a lasting attackBonus applies to any attacker", () => {
    const attacker = card("Plain", { type: "Creature", house: "Brobnar", power: 3 });
    const foe = enemy("Flanker");
    const state = setupTest({ inPlay: [attacker] }, { inPlay: [foe] }, "Brobnar");
    state.lasting = [{ target: { type: "Creature", side: "friendly" }, attackBonus: 4, duration: "turn", side: 0, until: 99 }];
    expect(attackBonusAgainst(state, attacker, foe)).toBe(4);
  });
});
