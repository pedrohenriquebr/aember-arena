// SPDX-License-Identifier: AGPL-3.0-only
// Keyword and turn-rule specs. Scenarios follow keyteki's docs/keywords.md and
// test/server keyword specs (Copyright (C) keyteki contributors, AGPL-3.0).
import { describe, expect, it } from "vitest";
import { DEMO_DECK } from "./demoDeck";
import { DEMO_DECK_2 } from "./demoDeck2";
import {
  applyMove,
  chooseHouse,
  createMatch,
  endTurn,
  getLegalMoves,
  keyCost,
  moveHasEffect,
  targetChoices,
  type GameMove,
  type GameState,
} from "./game";
import { byTitle, card, setupTest, titles } from "./testkit";

const creature = (title: string, power: number, text = "", extra: Record<string, unknown> = {}) =>
  card(title, { type: "Creature", house: "Brobnar", power, text, ...extra });

function fight(state: GameState, attacker: string, defender: string): GameState {
  return applyMove(state, 0, {
    type: "fight",
    attackerId: byTitle(state.players[0].board, attacker)!.instanceId,
    targetId: byTitle(state.players[1].board, defender)!.instanceId,
  });
}

describe("fight keywords", () => {
  it("Elusive: the first attack each turn deals no damage either way", () => {
    let state = setupTest({ inPlay: [creature("A", 5), creature("B", 5)] }, { inPlay: [creature("Faerie", 2, "Elusive.")] });
    state = fight(state, "A", "Faerie");
    expect(byTitle(state.players[1].board, "Faerie")!.damage).toBe(0);
    expect(byTitle(state.players[0].board, "A")!.damage).toBe(0);
    state = fight(state, "B", "Faerie");
    expect(state.players[1].board).toHaveLength(0);
  });

  it("Elusive resets at the end of the turn", () => {
    let state = setupTest({ inPlay: [creature("A", 5)] }, { inPlay: [creature("Faerie", 2, "Elusive.")] });
    state = fight(state, "A", "Faerie");
    state = endTurn(endTurn(state, 0), 1);
    expect(byTitle(state.players[1].board, "Faerie")!.elusiveUsed).toBe(false);
  });

  it("Taunt: neighbors of a taunt creature cannot be attacked", () => {
    const state = setupTest(
      { inPlay: [creature("A", 5)] },
      { inPlay: [creature("Left", 2), creature("Guard", 4, "Taunt."), creature("Right", 2), creature("Far", 2)] },
    );
    const targets = getLegalMoves(state, 0)
      .filter((move): move is Extract<GameMove, { type: "fight" }> => move.type === "fight")
      .map((move) => byTitle(state.players[1].board, "Left")!.instanceId === move.targetId ? "Left" : state.players[1].board.find((c) => c.instanceId === move.targetId)!.face.title);
    expect(targets.sort()).toEqual(["Far", "Guard"]);
    expect(fight(state, "A", "Left").players[1].board).toHaveLength(4);
  });

  it("Assault X damages the defender first; if it dies the attacker takes nothing", () => {
    const state = setupTest({ inPlay: [creature("Bear", 5, "Assault 2.")] }, { inPlay: [creature("Small", 2)] });
    const next = fight(state, "Bear", "Small");
    expect(next.players[1].board).toHaveLength(0);
    expect(byTitle(next.players[0].board, "Bear")!.damage).toBe(0);
  });

  it("Hazardous X damages the attacker before the fight", () => {
    const state = setupTest({ inPlay: [creature("A", 3)] }, { inPlay: [creature("Spiky", 6, "Hazardous 3.")] });
    const next = fight(state, "A", "Spiky");
    expect(next.players[0].board).toHaveLength(0);
    expect(byTitle(next.players[1].board, "Spiky")!.damage).toBe(0);
  });

  it("Skirmish: the attacker takes no fight damage", () => {
    const next = fight(setupTest({ inPlay: [creature("Troll", 4, "Skirmish.")] }, { inPlay: [creature("B", 3)] }), "Troll", "B");
    expect(byTitle(next.players[0].board, "Troll")!.damage).toBe(0);
    expect(next.players[1].board).toHaveLength(0);
  });

  it("Poison destroys whatever it damages; armor that absorbs everything prevents it", () => {
    const poisoned = fight(setupTest({ inPlay: [creature("Viper", 1, "Poison.")] }, { inPlay: [creature("Big", 8)] }), "Viper", "Big");
    expect(poisoned.players[1].board).toHaveLength(0);
    const armored = fight(setupTest({ inPlay: [creature("Viper", 1, "Poison.")] }, { inPlay: [creature("Knight", 8, "", { armor: 2 })] }), "Viper", "Knight");
    expect(armored.players[1].board).toHaveLength(1);
  });

  it("Splash-attack X hits the defender's neighbors", () => {
    const state = setupTest({ inPlay: [creature("Splash", 3, "Splash-attack 2.")] }, { inPlay: [creature("L", 3), creature("M", 5), creature("R", 2)] });
    const next = fight(state, "Splash", "M");
    expect(byTitle(next.players[1].board, "L")!.damage).toBe(2);
    expect(titles(next.players[1].board)).toEqual(["L", "M"]);
  });

  it("reads keywords from the Master Vault keyword array", () => {
    const next = fight(setupTest({ inPlay: [creature("Troll", 4, "", { keywords: ["skirmish"] })] }, { inPlay: [creature("B", 3)] }), "Troll", "B");
    expect(byTitle(next.players[0].board, "Troll")!.damage).toBe(0);
  });
});

describe("armor", () => {
  it("absorbs damage once per turn instead of adding health", () => {
    let state = setupTest({ inPlay: [creature("A", 3), creature("B", 3)] }, { inPlay: [creature("Knight", 4, "", { armor: 2 })] });
    state = fight(state, "A", "Knight");
    expect(byTitle(state.players[1].board, "Knight")!.damage).toBe(1);
    state = fight(state, "B", "Knight");
    expect(state.players[1].board).toHaveLength(0);
  });
});

describe("play keywords", () => {
  it("Alpha can only be played before anything else this turn", () => {
    const state = setupTest({ hand: [card("First", { text: "Alpha.", type: "Action" }), "Smith"] });
    const smith = byTitle(state.players[0].hand, "Smith")!;
    const after = applyMove(state, 0, { type: "play", instanceId: smith.instanceId });
    expect(getLegalMoves(after, 0).some((move) => move.type === "play")).toBe(false);
    expect(getLegalMoves(state, 0).filter((move) => move.type === "play")).toHaveLength(2);
  });

  it("Omega ends the main step", () => {
    const state = setupTest({ hand: [card("Last", { text: "Omega. Play: Gain 1 amber.", type: "Action" }), "Smith"], inPlay: [creature("A", 3)] });
    const next = applyMove(state, 0, { type: "play", instanceId: byTitle(state.players[0].hand, "Last")!.instanceId });
    expect(next.players[0].amber).toBe(1);
    expect(getLegalMoves(next, 0)).toHaveLength(0);
  });

  it("creatures enter on a flank; Deploy may enter between creatures", () => {
    const state = setupTest({ hand: [creature("Plain", 2), creature("Deployer", 2, "Deploy.")], inPlay: [creature("A", 3), creature("B", 3)] });
    const left = applyMove(state, 0, { type: "play", instanceId: byTitle(state.players[0].hand, "Plain")!.instanceId, flank: "left", slot: 1 });
    expect(titles(left.players[0].board)).toEqual(["Plain", "A", "B"]);
    const deployed = applyMove(state, 0, { type: "play", instanceId: byTitle(state.players[0].hand, "Deployer")!.instanceId, slot: 1 });
    expect(titles(deployed.players[0].board)).toEqual(["A", "Deployer", "B"]);
  });
});

describe("turn structure", () => {
  it("first player opens with 7 cards and may play only one card on turn 1", () => {
    const state = chooseHouse(createMatch(DEMO_DECK, DEMO_DECK_2), 0, "Brobnar");
    expect(state.players[0].hand).toHaveLength(7);
    const first = getLegalMoves(state, 0, "Brobnar").find((move) => move.type === "play")!;
    const after = applyMove(state, 0, first);
    expect(getLegalMoves(after, 0, "Brobnar").some((move) => move.type === "play" || move.type === "discard")).toBe(false);
  });

  it("ready step readies the ending player's cards; stun stays until the creature is used", () => {
    let state = setupTest({ inPlay: [creature("A", 3)] });
    state.players[0].board[0].stunned = true;
    expect(getLegalMoves(state, 0).map((move) => move.type)).toEqual(["unstun"]);
    state = applyMove(state, 0, { type: "unstun", instanceId: state.players[0].board[0].instanceId });
    expect(state.players[0].board[0]).toMatchObject({ stunned: false, ready: false });
    state = endTurn(state, 0);
    expect(state.players[0].board[0].ready).toBe(true);
  });

  it("draw step refills to 6 minus 1 card per 6 chains, shedding a chain", () => {
    const state = setupTest({ hand: [], chains: 7, deck: Array.from({ length: 10 }, (_, i) => creature(`D${i}`, 1)) });
    const next = endTurn(state, 0);
    expect(next.players[0].hand).toHaveLength(4);
    expect(next.players[0].chains).toBe(6);
  });

  it("forges at the start of the turn at the current key cost", () => {
    const state = setupTest({}, { amber: 7 });
    const next = endTurn(state, 0);
    expect(next.players[1]).toMatchObject({ keys: 1, amber: 1 });
  });

  it("Lash of Broken Dreams: keys cost +3 during the opponent's next turn", () => {
    const state = setupTest({ inPlay: [card("Lash of Broken Dreams", {}, true)] }, { amber: 8 });
    const used = applyMove(state, 0, { type: "use", instanceId: state.players[0].board[0].instanceId });
    expect(keyCost(used, 1)).toBe(9);
    const next = endTurn(used, 0);
    expect(next.players[1]).toMatchObject({ keys: 0, amber: 8 });
    expect(keyCost(endTurn(next, 1), 1)).toBe(6);
  });

  it("wins on the third key", () => {
    const next = endTurn(setupTest({}, { amber: 6, keys: 2 }), 0);
    expect(next.winner).toBe(1);
  });

  it("archives are picked up when choosing a house", () => {
    const state = setupTest({});
    state.players[0].archives = [card("Smith")];
    const next = chooseHouse(state, 0, "Brobnar");
    expect(titles(next.players[0].hand)).toEqual(["Smith"]);
    expect(next.players[0].archives).toHaveLength(0);
  });

  it("maverick cards belong only to their printed house", () => {
    const state = setupTest({ hand: [card("Smith", { isMaverick: true })] }, {}, "Dis");
    expect(getLegalMoves(state, 0, "Dis")).toHaveLength(0);
  });

  it("an illegal move leaves the state unchanged", () => {
    const state = setupTest({ inPlay: [creature("A", 3, "", { house: "Dis" })] }, { inPlay: [creature("B", 3)] }, "Brobnar");
    const next = applyMove(state, 0, { type: "reap", instanceId: state.players[0].board[0].instanceId });
    expect(next.players[0].amber).toBe(0);
  });
});

describe("abilities and targets", () => {
  it("Dextre captures from the opponent; the captured amber returns when it leaves play", () => {
    let state = setupTest({ hand: ["Dextre"] }, { amber: 3 });
    state = applyMove(state, 0, { type: "play", instanceId: state.players[0].hand[0].instanceId });
    expect(byTitle(state.players[0].board, "Dextre")!.amber).toBe(1);
    expect(state.players[1].amber).toBe(2);
    state.players[1].hand = [card("Gateway to Dis")];
    state.activePlayer = 1;
    state = applyMove(state, 1, { type: "play", instanceId: state.players[1].hand[0].instanceId });
    expect(state.players[1].amber).toBe(3);
    expect(state.players[0].deck.at(-1)!.face.title).toBe("Dextre");
  });

  it("the player's chosen target is honoured", () => {
    const state = setupTest({ hand: ["Fear"] }, { inPlay: [creature("Weak", 1), creature("Strong", 6)] });
    const fear = state.players[0].hand[0];
    const move: GameMove = { type: "play", instanceId: fear.instanceId };
    const choices = targetChoices(state, 0, move);
    expect(choices).toHaveLength(2);
    const next = applyMove(state, 0, { ...move, target: byTitle(state.players[1].board, "Weak")!.instanceId });
    expect(titles(next.players[1].board)).toEqual(["Strong"]);
  });

  it("legal moves expand one per target so the AI can search them", () => {
    const state = setupTest({ hand: ["Fear"] }, { inPlay: [creature("Weak", 1), creature("Strong", 6)] });
    expect(getLegalMoves(state, 0).filter((move) => move.type === "play")).toHaveLength(2);
  });

  it("Dominator Bauble uses a friendly creature", () => {
    const state = setupTest({ inPlay: [card("Dominator Bauble"), card("Tocsin")] }, { hand: ["Smith"] });
    const next = applyMove(state, 0, { type: "use", instanceId: state.players[0].board[0].instanceId });
    expect(next.players[0].amber).toBe(1);
    expect(next.players[1].hand).toHaveLength(0);
  });

  it("Research Smoko archives the top card of its deck when destroyed", () => {
    const state = setupTest({ inPlay: ["Research Smoko"], deck: ["Smith"] }, { inPlay: [creature("Big", 6)] });
    const next = fight(state, "Research Smoko", "Big");
    expect(titles(next.players[0].archives)).toEqual(["Smith"]);
    expect(titles(next.players[0].discard)).toEqual(["Research Smoko"]);
  });

  it("an upgrade attaches to a creature and resolves against its host", () => {
    const state = setupTest({ hand: ["Experimental Therapy"], inPlay: [creature("Host", 3)] });
    const next = applyMove(state, 0, { type: "play", instanceId: state.players[0].hand[0].instanceId });
    expect(byTitle(next.players[0].board, "Host")).toMatchObject({ stunned: true, ready: false });
    expect(byTitle(next.players[0].board, "Experimental Therapy")!.attachedTo).toBe(byTitle(next.players[0].board, "Host")!.instanceId);
  });

  it("the ability condition is the AI's pruning specification", () => {
    const state = setupTest({ hand: ["The Terror", "Smith"], inPlay: [card("Screechbomb")] }, { amber: 0 });
    const smith = byTitle(state.players[0].hand, "Smith")!;
    expect(moveHasEffect(state, 0, { type: "play", instanceId: smith.instanceId })).toBe(true); // bonus amber
    const bomb = state.players[0].board[0];
    expect(moveHasEffect(state, 0, { type: "use", instanceId: bomb.instanceId })).toBe(true);
    const barb = setupTest({ hand: [card("Mind Barb", { amber: 0 })] }, { hand: [] });
    expect(moveHasEffect(barb, 0, { type: "play", instanceId: barb.players[0].hand[0].instanceId })).toBe(true);
    const fear = setupTest({ hand: ["Fear"] });
    expect(moveHasEffect(fear, 0, { type: "play", instanceId: fear.players[0].hand[0].instanceId })).toBe(false);
  });
});
