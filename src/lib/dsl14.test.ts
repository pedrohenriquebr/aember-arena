// SPDX-License-Identifier: AGPL-3.0-only
// Lote 14 (DSL_VERSION 13, PARSER_VERSION 15): Miasma (skipForgeStep — the opponent's NEXT key step only,
// one-shot), Spyyyder (attackKeywords: poison only while attacking an enemy flank creature) and Code Monkey
// (Deploy + "Archive each neighboring creature" + the share-a-house gain: ≥1 house in common, so a single
// moved creature shares its own house — the real ruling). Every card is read from its REAL printed text
// (corpus prints, glyph and line breaks included), so a parser regression shows up as a parse failure first.
import { afterEach, describe, expect, it } from "vitest";
import { DSL_VERSION, normaliseAbilityOverride, setAbilityOverrides } from "./abilities";
import { PARSER_VERSION, parseCardText } from "./cardText";
import { FEW_SHOTS } from "./catalogLlm";
import { applyMove, chooseHouse, endTurn, type CardFace, type GameState } from "./game";
import { DSL_SCHEMA } from "./generated/dslSchema";
import { card, setupTest } from "./testkit";

afterEach(() => setAbilityOverrides(new Map()));

// Prints of scripts/harvest/cards-corpus.json: the typographic quotes of Miasma,
// the \r line break and reminder of Spyyyder, the \n break and glyph print of
// Code Monkey ("gain 2A." is the variant of face 478d787d).
const MIASMA = "Play: Your opponent skips the “forge a key” step during their next turn.";
const MIASMA_ON = "Play: Your opponent skips the “forge a key” step on their next turn.";
const SPYYYDER = "Skirmish. (When you use this creature to fight, it is dealt no damage in return.)\rSpyyyder gains poison while attacking an enemy flank creature.";
const CODE_MONKEY = "Deploy. (This creature can enter play anywhere in your battleline.)\nPlay: Archive each neighboring creature. If those creatures share a house, gain 2.\n";
const CODE_MONKEY_A = "Deploy. (This creature can enter play anywhere in your battleline.)\rPlay: Archive each neighboring creature. If those creatures share a house, gain 2A.";

const face = (title: string, text: string, type: string, house: string, power = 3): CardFace => ({ id: title, title, house, type, image: "", text, amber: 0, power, armor: 0 });
const parse = (title: string, text: string, type: string, house: string) => parseCardText(face(title, text, type, house));
const row = (dsl: unknown[], extra: object = {}) => ({ cardId: "c", dsl, textHash: "h", source: "manual" as const, v: DSL_VERSION, ...extra });
const play = (state: GameState, id: string, slot?: number) => applyMove(state, 0, { type: "play", instanceId: id, ...(slot !== undefined ? { slot } : {}) });

/** Hands the turn over and lets the other side pick its house. */
function passTo(state: GameState, house: string): GameState {
  const over = endTurn(state, state.activePlayer);
  // The demo decks own other houses: the spec names the house it wants, so the side must be able to pick it.
  over.players[over.activePlayer].houses = [...over.players[over.activePlayer].houses, house];
  return chooseHouse(over, over.activePlayer, house);
}

describe("contract", () => {
  it("bumps both versions, the prompt schema carries the new fields and each mechanic has a few-shot", () => {
    expect(DSL_VERSION).toBe(17);
    expect(PARSER_VERSION).toBe(21);
    for (const needle of ["attackKeywords?: Keywords", "skipForgeStep?: true"]) {
      expect(DSL_SCHEMA).toContain(needle);
    }
    const shots = FEW_SHOTS.map((shot) => shot.text);
    for (const fragment of ['skips the "forge a key" step', "gains poison while attacking", "share a house"]) {
      expect(shots.some((text) => text.includes(fragment))).toBe(true);
    }
  });

  it("the shape gate reads the new fields and drops a malformed one", () => {
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "lasting", e: { target: {}, opp: true, skipForgeStep: true, duration: "next" } }] }]))?.v).toBe(DSL_VERSION);
    expect(normaliseAbilityOverride(row([], { effects: [{ target: { self: true }, attackKeywords: { poison: 1 }, whenAttacking: { type: "Creature", side: "enemy", flank: true } }] }))?.v).toBe(DSL_VERSION);
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "lasting", e: { target: {}, skipForgeStep: false } }] }]))).toBeNull();
    expect(normaliseAbilityOverride(row([], { effects: [{ target: { self: true }, attackKeywords: { hover: 1 } }] }))).toBeNull();
  });
});

describe("Miasma (skipForgeStep)", () => {
  it.each([
    ["during", MIASMA],
    ["on", MIASMA_ON],
  ])("parses the %s print as a one-shot lasting aimed at the opponent", (_label, text) => {
    const parsed = parse("Miasma", text, "Action", "Shadows");
    expect(parsed.coverage).toBe("full");
    expect(parsed.abilities).toEqual([
      { on: ["play"], acts: [{ k: "lasting", e: { target: {}, opp: true, skipForgeStep: true, duration: "next" } }] },
    ]);
    expect(parsed.effects).toEqual([]);
    expect(parsed.keywords).toEqual({});
  });

  const miasma = () => card("Miasma", { type: "Action", house: "Shadows", text: MIASMA });

  it("is what skipped the step (the control forges at their key step)", () => {
    const control = endTurn(setupTest({}, { amber: 8 }, "Shadows"), 0);
    expect(control.players[1].keys).toBe(1);
    expect(control.players[1].amber).toBe(2);
  });

  it("skips the opponent's next key step once and spends the copy there", () => {
    const spell = miasma();
    const cast = play(setupTest({ hand: [spell] }, { amber: 8 }, "Shadows"), spell.instanceId);
    expect((cast.lasting ?? []).length).toBe(1);
    // passTo ends our turn (the skip hits the opponent's key step) and they pick a house.
    const skipped = passTo(cast, "Dis");
    expect(skipped.players[1].keys).toBe(0);
    expect(skipped.players[1].amber).toBe(8);
    expect(skipped.lasting ?? []).toEqual([]);
    // One-shot: the key step after this one forges normally.
    const next = passTo(passTo(skipped, "Shadows"), "Dis");
    expect(next.players[1].keys).toBe(1);
    expect(next.players[1].amber).toBe(2);
  });

  it("two Miasmas still skip a single step (both copies aim at the same next turn)", () => {
    const one = miasma();
    const two = miasma();
    const cast = play(play(setupTest({ hand: [one, two] }, { amber: 8 }, "Shadows"), one.instanceId), two.instanceId);
    expect((cast.lasting ?? []).length).toBe(2);
    const skipped = passTo(cast, "Dis");
    expect(skipped.players[1].keys).toBe(0);
    expect(skipped.lasting ?? []).toEqual([]);
    expect(passTo(passTo(skipped, "Shadows"), "Dis").players[1].keys).toBe(1);
  });

  it("is spent even when the opponent could not have forged anyway", () => {
    const spell = miasma();
    const cast = play(setupTest({ hand: [spell] }, { amber: 3 }, "Shadows"), spell.instanceId);
    const skipped = endTurn(cast, 0);
    expect(skipped.players[1].keys).toBe(0);
    expect(skipped.lasting ?? []).toEqual([]);
  });
});

describe("Spyyyder (fight-time poison)", () => {
  it("parses as skirmish plus a poison grant only while attacking an enemy flank creature", () => {
    const parsed = parse("Spyyyder", SPYYYDER, "Creature", "Dis");
    expect(parsed.coverage).toBe("full");
    expect(parsed.keywords).toEqual({ skirmish: 1 });
    expect(parsed.effects).toEqual([
      { target: { self: true }, attackKeywords: { poison: 1 }, whenAttacking: { type: "Creature", side: "enemy", flank: true } },
    ]);
    expect(parsed.abilities).toEqual([]);
  });

  const spyyyder = (power = 3) => card("Spyyyder", { type: "Creature", house: "Dis", power, text: SPYYYDER });

  it("poisons and destroys the enemy flank creature it attacks, taking no damage back (skirmish)", () => {
    const bug = spyyyder();
    const tank = card("Tank", { type: "Creature", house: "Logos", power: 5 });
    const next = applyMove(setupTest({ inPlay: [bug] }, { inPlay: [tank] }, "Dis"), 0, { type: "fight", attackerId: bug.instanceId, targetId: tank.instanceId });
    // 3 damage is not enough for a 5-power creature — the poison is what kills it.
    expect(next.players[1].board).toEqual([]);
    expect(next.players[1].discard.map((item) => item.face.title)).toEqual(["Tank"]);
    expect(next.players[0].board[0].damage).toBe(0);
  });

  it("keeps its poison at home: a defender that is not on a flank survives damaged", () => {
    const bug = spyyyder();
    const tank = card("Tank", { type: "Creature", house: "Logos", power: 5 });
    const state = setupTest({ inPlay: [bug] }, { inPlay: [card("Left", { house: "Logos", power: 5 }), tank, card("Right", { house: "Logos", power: 5 })] }, "Dis");
    const next = applyMove(state, 0, { type: "fight", attackerId: bug.instanceId, targetId: tank.instanceId });
    expect(next.players[1].board.map((item) => item.face.title)).toEqual(["Left", "Tank", "Right"]);
    expect(next.players[1].board[1].damage).toBe(3);
    expect(next.players[1].board[1].poisoned).toBeFalsy();
  });

  it("gains poison only while attacking — never when it is the defender", () => {
    const bug = spyyyder(2);
    const hitter = card("Hitter", { type: "Creature", house: "Dis", power: 5 });
    const passed = passTo(setupTest({ inPlay: [bug] }, { inPlay: [hitter] }, "Dis"), "Dis");
    const next = applyMove(passed, 1, { type: "fight", attackerId: hitter.instanceId, targetId: bug.instanceId });
    const survivor = next.players[1].board[0];
    expect(survivor.face.title).toBe("Hitter");
    expect(survivor.damage).toBe(2);
    expect(survivor.poisoned).toBeFalsy();
    expect(next.players[0].discard.map((item) => item.face.title)).toEqual(["Spyyyder"]);
  });
});

describe("Code Monkey (Deploy + share a house)", () => {
  it("parses deploy, the neighbor archive and the share-a-house gain", () => {
    const parsed = parse("Code Monkey", CODE_MONKEY, "Creature", "Logos");
    expect(parsed.coverage).toBe("full");
    expect(parsed.keywords).toEqual({ deploy: 1 });
    expect(parsed.abilities).toEqual([
      {
        on: ["play"],
        acts: [
          { k: "archive", s: { each: { type: "Creature", neighborsOfSource: true } } },
          { k: "gainAmber", n: 2, if: { k: "count", of: { housesOf: "moved" }, op: "eq", n: 1 } },
        ],
      },
    ]);
  });

  it("reads the bare 'gain 2A' print the same way", () => {
    expect(parse("Code Monkey", CODE_MONKEY_A, "Creature", "Logos").abilities).toEqual(parse("Code Monkey", CODE_MONKEY, "Creature", "Logos").abilities);
    expect(parse("Code Monkey", CODE_MONKEY_A, "Creature", "Logos").coverage).toBe("full");
  });

  const monkey = () => card("Code Monkey", { type: "Creature", house: "Logos", power: 4, text: CODE_MONKEY });

  it("enters between its neighbors (Deploy), archives them and gains 2 when they share a house", () => {
    const m = monkey();
    const left = card("Left", { type: "Creature", house: "Logos", power: 2 });
    const right = card("Right", { type: "Creature", house: "Logos", power: 2 });
    const next = play(setupTest({ hand: [m], inPlay: [left, right] }, {}, "Logos"), m.instanceId, 1);
    expect(next.players[0].board.map((item) => item.face.title)).toEqual(["Code Monkey"]);
    expect(next.players[0].archives.map((item) => item.face.title).sort()).toEqual(["Left", "Right"]);
    expect(next.players[0].amber).toBe(2);
  });

  it("gains nothing when the two neighbors do not share a house", () => {
    const m = monkey();
    const left = card("Left", { type: "Creature", house: "Logos", power: 2 });
    const right = card("Right", { type: "Creature", house: "Dis", power: 2 });
    const next = play(setupTest({ hand: [m], inPlay: [left, right] }, {}, "Logos"), m.instanceId, 1);
    expect(next.players[0].archives.map((item) => item.face.title).sort()).toEqual(["Left", "Right"]);
    expect(next.players[0].amber).toBe(0);
  });

  it("a single moved creature shares its house with itself (the ruling)", () => {
    const m = monkey();
    const left = card("Left", { type: "Creature", house: "Logos", power: 2 });
    const next = play(setupTest({ hand: [m], inPlay: [left] }, {}, "Logos"), m.instanceId, 0);
    expect(next.players[0].board.map((item) => item.face.title)).toEqual(["Code Monkey"]);
    expect(next.players[0].archives.map((item) => item.face.title)).toEqual(["Left"]);
    expect(next.players[0].amber).toBe(2);
  });

  it("alone there is nothing to archive and nothing to gain", () => {
    const m = monkey();
    const next = play(setupTest({ hand: [m] }, {}, "Logos"), m.instanceId);
    expect(next.players[0].board.map((item) => item.face.title)).toEqual(["Code Monkey"]);
    expect(next.players[0].archives).toEqual([]);
    expect(next.players[0].amber).toBe(0);
  });
});
