// SPDX-License-Identifier: AGPL-3.0-only
// Regression specs for the cards that were hand-coded before the ability engine.
// Scenarios ported from keyteki test/server/cards/01-Core/*.spec.js
// (Copyright (C) keyteki contributors, AGPL-3.0), adapted to this engine's API.
import { describe, expect, it } from "vitest";
import { applyMove, type GameState } from "./game";
import { byTitle, card, setupTest, titles } from "./testkit";

function play(state: GameState, title: string, player: 0 | 1 = 0): GameState {
  const target = byTitle(state.players[player].hand, title);
  if (!target) throw new Error(`${title} not in hand`);
  return applyMove(state, player, { type: "play", instanceId: target.instanceId });
}

function boardCard(state: GameState, player: 0 | 1, title: string) {
  const found = byTitle(state.players[player].board, title);
  if (!found) throw new Error(`${title} not in play`);
  return found;
}

describe("Coward's End", () => {
  it("destroys each undamaged creature and gains 3 chains", () => {
    const state = setupTest({ hand: ["Coward's End"], inPlay: ["Valdr", "Headhunter"] }, { inPlay: ["Tocsin", "The Terror"] });
    state.players[0].board[0].damage = 1;
    state.players[1].board[1].damage = 1;
    const next = play(state, "Coward's End");
    expect(titles(next.players[0].board)).toEqual(["Valdr"]);
    expect(titles(next.players[1].board)).toEqual(["The Terror"]);
    expect(titles(next.players[0].discard)).toEqual(expect.arrayContaining(["Headhunter", "Coward's End"]));
    expect(titles(next.players[1].discard)).toContain("Tocsin");
    expect(next.players[0].chains).toBe(3);
  });
});

describe("Gateway to Dis", () => {
  it("destroys each creature and gains 3 chains", () => {
    const state = setupTest({ hand: ["Gateway to Dis"], inPlay: ["Valdr"] }, { inPlay: ["Tocsin", "The Terror"] });
    const next = play(state, "Gateway to Dis");
    expect(next.players[0].board).toHaveLength(0);
    expect(next.players[1].board).toHaveLength(0);
    expect(next.players[0].chains).toBe(3);
  });
});

describe("Hysteria", () => {
  it("returns each creature to its owner's hand", () => {
    const state = setupTest({ hand: ["Hysteria"], inPlay: ["Valdr"] }, { inPlay: ["Tocsin"] });
    const next = play(state, "Hysteria");
    expect(titles(next.players[0].hand)).toContain("Valdr");
    expect(titles(next.players[1].hand)).toContain("Tocsin");
    expect(next.players[0].board).toHaveLength(0);
    expect(next.players[1].board).toHaveLength(0);
  });
});

describe("Fear", () => {
  it("returns an enemy creature to its owner's hand", () => {
    const state = setupTest({ hand: ["Fear"], inPlay: ["Valdr"] }, { inPlay: ["Tocsin", "The Terror"] });
    const next = play(state, "Fear");
    expect(next.players[1].board).toHaveLength(1);
    expect(titles(next.players[1].hand)).toContain("The Terror");
    expect(titles(next.players[0].board)).toEqual(["Valdr"]);
  });
});

describe("Hand of Dis", () => {
  it("destroys a creature that is not on a flank", () => {
    const state = setupTest({ hand: ["Hand of Dis"] }, { inPlay: ["Valdr", "Tocsin", "The Terror"] });
    const next = play(state, "Hand of Dis");
    expect(titles(next.players[1].board)).toEqual(["Valdr", "The Terror"]);
    expect(titles(next.players[1].discard)).toContain("Tocsin");
  });

  it("does nothing when every creature is on a flank", () => {
    const state = setupTest({ hand: ["Hand of Dis"] }, { inPlay: ["Valdr", "Tocsin"] });
    const next = play(state, "Hand of Dis");
    expect(next.players[1].board).toHaveLength(2);
  });
});

describe("Tremor", () => {
  it("stuns a creature and each of its neighbors", () => {
    const state = setupTest({ hand: ["Tremor"] }, { inPlay: ["Tocsin", "Valdr", "Dextre", "Doc Bookton"] });
    const next = play(state, "Tremor");
    expect(next.players[1].board.map((item) => item.stunned)).toEqual([true, true, true, false]);
  });
});

describe("Smaaash", () => {
  it("enters play and stuns a creature", () => {
    const state = setupTest({ hand: ["Smaaash"] }, { inPlay: ["Tocsin", "Valdr"] });
    const next = play(state, "Smaaash");
    expect(titles(next.players[0].board)).toEqual(["Smaaash"]);
    expect(boardCard(next, 1, "Valdr").stunned).toBe(true);
    expect(boardCard(next, 1, "Tocsin").stunned).toBe(false);
  });
});

describe("Smith", () => {
  it("does not gain amber with fewer or equal creatures", () => {
    const fewer = play(setupTest({ hand: ["Smith"] }, { inPlay: ["Tocsin"] }), "Smith");
    expect(fewer.players[0].amber).toBe(1);
    const equal = play(setupTest({ hand: ["Smith"], inPlay: ["Valdr"] }, { inPlay: ["Tocsin"] }), "Smith");
    expect(equal.players[0].amber).toBe(1);
  });

  it("gains 2 amber when controlling more creatures", () => {
    const next = play(setupTest({ hand: ["Smith"], inPlay: ["Valdr", "Headhunter"] }, { inPlay: ["Tocsin"] }), "Smith");
    expect(next.players[0].amber).toBe(3);
  });
});

describe("The Terror", () => {
  it("gains 2 amber only if the opponent has none", () => {
    expect(play(setupTest({ hand: ["The Terror"] }, { amber: 0 }), "The Terror").players[0].amber).toBe(2);
    expect(play(setupTest({ hand: ["The Terror"] }, { amber: 1 }), "The Terror").players[0].amber).toBe(0);
  });
});

describe("Mind Barb", () => {
  it("makes the opponent discard a card", () => {
    const next = play(setupTest({ hand: ["Mind Barb"] }, { hand: ["Valdr", "Tocsin"] }), "Mind Barb");
    expect(next.players[1].hand).toHaveLength(1);
    expect(next.players[1].discard).toHaveLength(1);
    expect(next.players[0].amber).toBe(1);
  });

  it("does nothing if the opponent has no cards", () => {
    const next = play(setupTest({ hand: ["Mind Barb"] }, { hand: [] }), "Mind Barb");
    expect(next.players[1].discard).toHaveLength(0);
  });
});

describe("Hebe the Huge", () => {
  it("deals 2 to each other undamaged creature", () => {
    const state = setupTest({ hand: ["Hebe the Huge"], inPlay: ["Valdr"] }, { inPlay: ["Tocsin", "The Terror"] });
    state.players[1].board[1].damage = 1;
    const next = play(state, "Hebe the Huge");
    expect(boardCard(next, 0, "Valdr").damage).toBe(2);
    expect(boardCard(next, 0, "Hebe the Huge").damage).toBe(0);
    expect(boardCard(next, 1, "Tocsin").damage).toBe(2);
    expect(boardCard(next, 1, "The Terror").damage).toBe(1);
  });
});

describe("Tocsin", () => {
  it("reaps for 1 and makes the opponent discard a card", () => {
    const state = setupTest({ inPlay: ["Tocsin"] }, { hand: ["Valdr", "Smith", "Fear"] });
    const next = applyMove(state, 0, { type: "reap", instanceId: state.players[0].board[0].instanceId });
    expect(next.players[0].amber).toBe(1);
    expect(next.players[1].hand).toHaveLength(2);
  });
});

describe("Headhunter", () => {
  it("gains 1 amber after fighting", () => {
    const state = setupTest({ inPlay: ["Headhunter"] }, { inPlay: ["Tocsin"] });
    const next = applyMove(state, 0, { type: "fight", attackerId: state.players[0].board[0].instanceId, targetId: state.players[1].board[0].instanceId });
    expect(next.players[0].amber).toBe(1);
    expect(next.players[1].board).toHaveLength(0);
    expect(boardCard(next, 0, "Headhunter").damage).toBe(3);
  });
});

describe("Screechbomb", () => {
  it("is sacrificed and makes the opponent lose 2 amber", () => {
    const state = setupTest({ inPlay: ["Screechbomb"] }, { amber: 5 });
    const next = applyMove(state, 0, { type: "use", instanceId: state.players[0].board[0].instanceId });
    expect(next.players[1].amber).toBe(3);
    expect(next.players[0].board).toHaveLength(0);
    expect(titles(next.players[0].discard)).toContain("Screechbomb");
  });
});

describe("Key to Dis", () => {
  it("is sacrificed and destroys each creature", () => {
    const state = setupTest({ inPlay: ["Key to Dis", "Valdr"] }, { inPlay: ["Tocsin"] });
    const next = applyMove(state, 0, { type: "use", instanceId: state.players[0].board[0].instanceId });
    expect(next.players[0].board).toHaveLength(0);
    expect(next.players[1].board).toHaveLength(0);
    expect(titles(next.players[0].discard)).toEqual(expect.arrayContaining(["Key to Dis", "Valdr"]));
  });
});

describe("generic rules", () => {
  it("a creature is destroyed once damage reaches its power", () => {
    const state = setupTest({ inPlay: [card("Valdr")] }, { inPlay: ["Tocsin"] });
    const next = applyMove(state, 0, { type: "fight", attackerId: state.players[0].board[0].instanceId, targetId: state.players[1].board[0].instanceId });
    expect(next.players[1].board).toHaveLength(0);
    expect(boardCard(next, 0, "Valdr").damage).toBe(3);
  });
});
