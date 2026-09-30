// SPDX-License-Identifier: AGPL-3.0-only
// Onda 3 specs (docs/ROADMAP_REVIEW.md §3): purge as a leave-play destination of
// its own (keyteki PurgeAction.js), sacrifice as a destruction (DestroyAction
// with isSacrifice), token creatures (MakeTokenCreatureAction.js) and the exalt
// action (ExaltAction.js / docs/keywords.md#exalt) — Copyright (C) keyteki
// contributors, AGPL-3.0, adapted to this engine's API.
import { describe, expect, it } from "vitest";
import { rulesOf } from "./abilities";
import { applyMove, chooseHouse, endTurn, getLegalMoves, type CardFace, type GameState } from "./game";
import { byTitle, card, setupTest, titles } from "./testkit";

const creature = (title: string, power: number, text = "", extra: Partial<CardFace> = {}) =>
  card(title, { type: "Creature", house: "Brobnar", power, text, ...extra });

const board = (state: GameState, side: 0 | 1, title: string) => byTitle(state.players[side].board, title)!;

function play(state: GameState, side: 0 | 1, title: string): GameState {
  const item = byTitle(state.players[side].hand, title);
  if (!item) throw new Error(`${title} not in hand`);
  return applyMove(state, side, { type: "play", instanceId: item.instanceId });
}

function fight(state: GameState, side: 0 | 1, attacker: string, defender: string): GameState {
  const enemy = side === 0 ? 1 : 0;
  return applyMove(state, side, {
    type: "fight",
    attackerId: byTitle(state.players[side].board, attacker)!.instanceId,
    targetId: byTitle(state.players[enemy].board, defender)!.instanceId,
  });
}

const purger = () => card("Oubliette", { type: "Action", house: "Brobnar", text: "Play: Purge an enemy creature." });

describe("purge (keyteki PurgeAction)", () => {
  it("removes a creature from the game and returns its captured amber", () => {
    const state = setupTest({ hand: [purger()] }, { inPlay: [creature("Victim", 3)] });
    state.players[1].board[0].amber = 2;
    const next = play(state, 0, "Oubliette");
    expect(next.players[1].board).toHaveLength(0);
    expect(titles(next.players[1].purged)).toEqual(["Victim"]);
    expect(next.players[1].discard).toHaveLength(0);
    expect(next.players[1].hand).toHaveLength(0);
    expect(next.players[0].purged).toHaveLength(0);
    expect(next.players[0].amber).toBe(2); // captured amber back to the opponent of the controller
  });

  it("purged cards never come back when the discard is reshuffled", () => {
    const state = setupTest(
      { hand: [purger()] },
      { inPlay: [creature("Victim", 3)], deck: [], discard: [creature("Filed", 2)], hand: [] },
    );
    let next = play(state, 0, "Oubliette");
    // The victim is the only card that could be reshuffled; the discard holds
    // just "Filed", so a full refill proves the purged card stayed out.
    next = endTurn(next, 0);
    next = chooseHouse(next, 1, next.players[1].houses[0]);
    next = endTurn(next, 1);
    expect(titles(next.players[1].hand)).toEqual(["Filed"]);
    expect(titles(next.players[1].purged)).toEqual(["Victim"]);
    expect([...next.players[1].deck, ...next.players[1].hand, ...next.players[1].discard]).not.toContainEqual(
      expect.objectContaining({ face: expect.objectContaining({ title: "Victim" }) }),
    );
  });

  it("is not destruction: 'Destroyed:' abilities stay silent", () => {
    const state = setupTest({ hand: [purger()] }, { inPlay: [creature("Soulkeeper", 3, "Destroyed: Gain 3 amber.")] });
    const next = play(state, 0, "Oubliette");
    expect(next.players[1].amber).toBe(0);
    expect(next.players[0].creaturesDestroyed).toBe(0);
    expect(titles(next.players[1].purged)).toEqual(["Soulkeeper"]);
  });
});

describe("sacrifice (keyteki destroy with isSacrifice)", () => {
  it("sends the card to the owner's discard and fires 'Destroyed:' like any destroy", () => {
    const bomb = creature("Bomb", 2, "Action: Sacrifice Bomb. Destroyed: Gain 3 amber.");
    const sacrificed = applyMove(setupTest({ inPlay: [bomb] }), 0, { type: "use", instanceId: bomb.instanceId });
    expect(titles(sacrificed.players[0].board)).toEqual([]);
    expect(titles(sacrificed.players[0].discard)).toEqual(["Bomb"]);
    expect(sacrificed.players[0].amber).toBe(3);
    expect(sacrificed.players[0].creaturesDestroyed).toBe(0); // sacrificing your own is not a kill

    // The same text destroyed in a fight does fire the ability.
    const destroyed = fight(
      setupTest({ inPlay: [creature("Brute", 5)] }, { inPlay: [creature("Soulkeeper", 3, "Destroyed: Gain 3 amber.")] }),
      0,
      "Brute",
      "Soulkeeper",
    );
    expect(destroyed.players[1].amber).toBe(3);
  });

  it("credits a kill only when the sacrificed creature is the enemy's", () => {
    const state = setupTest(
      { hand: [card("Edict", { type: "Action", house: "Brobnar", text: "Play: Sacrifice an enemy creature." })] },
      { inPlay: [creature("Victim", 3)] },
    );
    expect(play(state, 0, "Edict").players[0].creaturesDestroyed).toBe(1);
  });

  it("returns its captured amber to the opponent", () => {
    const bomb = creature("Bomb", 2, "Action: Sacrifice Bomb.");
    const state = setupTest({ inPlay: [bomb] });
    board(state, 0, "Bomb").amber = 2;
    const next = applyMove(state, 0, { type: "use", instanceId: bomb.instanceId });
    expect(next.players[1].amber).toBe(2);
    expect(titles(next.players[0].discard)).toEqual(["Bomb"]);
  });
});

describe("token creatures (keyteki MakeTokenCreatureAction)", () => {
  const hive = () => card("Hive", { type: "Action", house: "Mars", text: "Play: Make a token creature." });

  it("makes a token on the battleline from the source's house — never in the deck", () => {
    const state = setupTest({ hand: [hive()], deck: [creature("Filler", 1)] });
    const next = play(state, 0, "Hive");
    const tokens = next.players[0].board.filter((item) => item.isToken);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].face).toMatchObject({ title: "Token Creature", house: "Mars", type: "Creature", power: 1, traits: "Token" });
    expect(tokens[0].ready).toBe(false); // enters play exhausted, like putIntoPlay
    const zones = [...next.players[0].deck, ...next.players[0].hand, ...next.players[0].discard, ...next.players[0].archives];
    expect(zones.map((item) => item.face.title)).toEqual(expect.arrayContaining(["Filler", "Hive"]));
    expect(zones.some((item) => item.isToken)).toBe(false);

    // The state stays JSON-safe with a token in play.
    expect(JSON.stringify(JSON.parse(JSON.stringify(next)))).toBe(JSON.stringify(next));
  });

  it("dies like a creature and is removed from the game instead of the discard", () => {
    let state = setupTest({ hand: [hive()], deck: [creature("Filler", 1)] }, { inPlay: [creature("Brute", 4)] });
    state = play(state, 0, "Hive");
    const token = state.players[0].board.find((item) => item.isToken)!;
    const next = applyMove(state, 1, { type: "fight", attackerId: state.players[1].board[0].instanceId, targetId: token.instanceId });
    expect(next.players[0].board.filter((item) => item.isToken)).toHaveLength(0);
    expect(next.players[0].discard.some((item) => item.isToken)).toBe(false);
    expect(next.players[0].purged.some((item) => item.isToken)).toBe(false);
    expect(next.players[1].creaturesDestroyed).toBe(1); // the kill is still credited
  });
});

describe("exalt (keyteki ExaltAction, docs/keywords.md#exalt)", () => {
  const oration = () =>
    card("Inspiring Oration", { type: "Action", house: "Brobnar", text: "Play: Exalt a friendly creature." });

  it("places amber from the common supply on the creature ('twice' included)", () => {
    const state = setupTest({ hand: [oration()], inPlay: [creature("A", 3), creature("B", 2)] });
    const next = play(state, 0, "Inspiring Oration");
    expect(board(next, 0, "A").amber).toBe(1); // auto-target: the strongest friendly
    expect(board(next, 0, "B").amber).toBeUndefined();
    expect(next.players[0].amber).toBe(0); // common supply: no pool is touched
    expect(next.players[1].amber).toBe(0);

    const dux = creature("Grimlocus Dux", 5, "Play: Exalt Grimlocus Dux twice.");
    const played = play(setupTest({ hand: [dux] }), 0, "Grimlocus Dux");
    expect(board(played, 0, "Grimlocus Dux").amber).toBe(2);
  });

  it("behaves like captured amber when the creature leaves play", () => {
    const dux = creature("Grimlocus Dux", 5, "Play: Exalt Grimlocus Dux twice.");
    const state = fight(play(setupTest({ hand: [dux] }, { inPlay: [creature("Brute", 6)] }), 0, "Grimlocus Dux"), 1, "Brute", "Grimlocus Dux");
    expect(titles(state.players[0].board)).not.toContain("Grimlocus Dux");
    expect(state.players[1].amber).toBe(2);
  });

  it("is a counter, not a lock: the creature still reaps, fights and acts", () => {
    const state = play(setupTest({ hand: [oration()], inPlay: [creature("A", 3)] }), 0, "Inspiring Oration");
    const id = board(state, 0, "A").instanceId;
    expect(board(state, 0, "A").amber).toBe(1);
    // Fidelity note: docs/keywords.md §Exalt places the amber and changes
    // nothing else — there is no "cannot be used" clause in keyteki.
    expect(getLegalMoves(state, 0, "Brobnar").some((move) => move.type === "reap" && move.instanceId === id)).toBe(true);
  });

  it("recognizes the printed keyword for coverage", () => {
    const rules = rulesOf({
      id: "x",
      title: "Exalted",
      house: "Brobnar",
      type: "Creature",
      image: "",
      text: "",
      amber: 0,
      power: 3,
      armor: 0,
      keywords: ["exalt"],
    });
    expect(rules.keywords.exalt).toBe(1);
    expect(rules.coverage).toBe("full");
  });
});
