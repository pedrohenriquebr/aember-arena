// SPDX-License-Identifier: AGPL-3.0-only
// Onda 2 specs (docs/ROADMAP_REVIEW.md §3): "You may" as an optional Act/Ability,
// reactions ("After X:"), repeatable triggers ("Each time X:") and phase
// triggers ("At the start/end of your turn:"), plus the optional archives rule.
// Trigger windows follow keyteki's reaction()/interrupt() and onTurnEnd/onTurnStart
// (server/game/Card.js, game.js) — Copyright (C) keyteki contributors, AGPL-3.0.
import { describe, expect, it } from "vitest";
import { chooseAiMove, shouldTakeArchives } from "./ai";
import {
  applyMove,
  chooseHouse,
  endTurn,
  isLegalMove,
  moveHasEffect,
  targetChoices,
  type GameMove,
  type GameState,
} from "./game";
import { byTitle, card, setupTest, titles } from "./testkit";

const creature = (title: string, power: number, text = "", extra: Record<string, unknown> = {}) =>
  card(title, { type: "Creature", house: "Brobnar", power, text, ...extra });

const board = (state: GameState, side: 0 | 1, title: string) => byTitle(state.players[side].board, title)!;

function play(state: GameState, side: 0 | 1, title: string, extra: Partial<Extract<GameMove, { type: "play" }>> = {}): GameState {
  const item = byTitle(state.players[side].hand, title);
  if (!item) throw new Error(`${title} not in hand`);
  return applyMove(state, side, { type: "play", instanceId: item.instanceId, ...extra });
}

function fight(state: GameState, side: 0 | 1, attacker: string, defender: string): GameState {
  const enemy = side === 0 ? 1 : 0;
  return applyMove(state, side, {
    type: "fight",
    attackerId: byTitle(state.players[side].board, attacker)!.instanceId,
    targetId: byTitle(state.players[enemy].board, defender)!.instanceId,
  });
}

describe("'You may' clauses (optional Act)", () => {
  const merchant = () => creature("Merchant", 3, "Play: You may draw a card.");

  it("resolves the clause by default; declining plays the card without it", () => {
    const state = setupTest({ hand: [merchant()], deck: [creature("D1", 1), creature("D2", 1)] });
    const kept = play(state, 0, "Merchant");
    expect(titles(kept.players[0].hand)).toHaveLength(1);

    const declined = play(state, 0, "Merchant", { decline: true });
    expect(titles(declined.players[0].board)).toEqual(["Merchant"]);
    expect(declined.players[0].hand).toHaveLength(0);
  });

  it("declining 'You may X. If you do, Y' skips Y too", () => {
    const state = setupTest({ hand: [creature("Ghoul", 3, "Play: You may destroy a creature. If you do, gain 2A.")] }, { inPlay: [creature("Victim", 2)] });
    const kept = play(state, 0, "Ghoul");
    expect(kept.players[0].amber).toBe(2);
    expect(kept.players[1].board).toHaveLength(0);
    const declined = play(state, 0, "Ghoul", { decline: true });
    expect(declined.players[0].amber).toBe(0);
    expect(declined.players[1].board).toHaveLength(1);
  });

  it("only offers the declined variant when the card prints the clause", () => {
    const plain = creature("Plain", 2);
    const state = setupTest({ hand: [plain] });
    expect(isLegalMove(state, 0, { type: "play", instanceId: plain.instanceId })).toBe(true);
    expect(isLegalMove(state, 0, { type: "play", instanceId: plain.instanceId, decline: true })).toBe(false);
  });

  it("a declined optional reap waives the target prompt and the effect", () => {
    const hunter = creature("Hunter", 3, "Reap: You may destroy an enemy creature.");
    const state = setupTest({ inPlay: [hunter] }, { inPlay: [creature("Prey", 1)] });
    const reap = (extra: Partial<Extract<GameMove, { type: "reap" }>>) =>
      applyMove(state, 0, { type: "reap", instanceId: board(state, 0, "Hunter").instanceId, ...extra });

    expect(targetChoices(state, 0, { type: "reap", instanceId: hunter.instanceId, decline: true })).toEqual([]);
    const declined = reap({ decline: true });
    expect(titles(declined.players[1].board)).toEqual(["Prey"]);
    expect(declined.players[0].amber).toBe(1);

    const resolved = reap({ target: board(state, 1, "Prey").instanceId });
    expect(titles(resolved.players[1].board)).toEqual([]);
  });

  it("an optional action with no legal target is a no-op for the AI's pruning", () => {
    const blast = card("Blast", { type: "Action", house: "Brobnar", text: "Play: You may destroy an enemy creature." });
    const empty = setupTest({ hand: [blast] }, {});
    expect(moveHasEffect(empty, 0, { type: "play", instanceId: blast.instanceId })).toBe(false);
    expect(moveHasEffect(empty, 0, { type: "play", instanceId: blast.instanceId, decline: true })).toBe(false);

    const withPrey = setupTest({ hand: [blast] }, { inPlay: [creature("Prey", 1)] });
    expect(moveHasEffect(withPrey, 0, { type: "play", instanceId: blast.instanceId })).toBe(true);
  });

  it("the AI searches the declined variant but plays the clause that pays off", () => {
    const cache = card("Cache", { type: "Action", house: "Brobnar", text: "Play: You may gain 3 amber." });
    const state = setupTest({}, { hand: [cache] }, "Brobnar");
    state.activePlayer = 1;
    const move = chooseAiMove(state, 1, "Brobnar", { difficulty: "Very hard", thinkingDepth: 2 });
    expect(move?.type).toBe("play");
    expect(move && "decline" in move ? move.decline : false).toBe(false);
  });
});

describe("reactions and repeatable triggers", () => {
  it("After Fight: resolves once the exchange is over", () => {
    const brawler = creature("Brawler", 4, "After Fight: Gain 1 amber.");
    const state = setupTest({ inPlay: [brawler] }, { inPlay: [creature("Weak", 1)] });
    const next = fight(state, 0, "Brawler", "Weak");
    expect(next.players[0].amber).toBe(1);
    expect(titles(next.players[1].board)).toEqual([]);
  });

  it("Each time Reap: fires on every reap, not only the first", () => {
    const leech = creature("Leech", 2, "Each time Reap: Gain 1 amber.");
    let state = setupTest({ inPlay: [leech] });
    const reap = (current: GameState) =>
      applyMove(current, 0, { type: "reap", instanceId: board(current, 0, "Leech").instanceId });

    state = reap(state);
    expect(state.players[0].amber).toBe(2); // the reap's amber plus one trigger
    board(state, 0, "Leech").ready = true; // ready it without giving up a turn
    state = reap(state);
    expect(state.players[0].amber).toBe(4);
  });
});

describe("phase triggers", () => {
  it("At the end of your turn: resolves for the ending player", () => {
    const dusk = creature("Dusk", 2, "At the end of your turn: Gain 1 amber.");
    const next = endTurn(setupTest({ inPlay: [dusk] }), 0);
    expect(next.players[0].amber).toBe(1);
    expect(next.players[1].amber).toBe(0);
  });

  it("At the start of your turn: resolves before the key step", () => {
    const dawn = creature("Dawn", 2, "At the start of your turn: Gain 2 amber.");
    const next = endTurn(setupTest({}, { inPlay: [dawn], amber: 4 }), 0);
    // The 2 amber arrive before forging: 4 + 2 pays the 6-amber key.
    expect(next.players[1]).toMatchObject({ keys: 1, amber: 0 });
  });
});

describe("optional archives (human and AI)", () => {
  it("the human can decline the pickup: the pile survives the turn and can be taken later", () => {
    const state = setupTest({}, {}, "Brobnar");
    state.players[0].archives = [card("Filed", { house: "Dis" })];
    const ended = endTurn(state, 0);
    expect(titles(ended.players[0].archives)).toEqual(["Filed"]);
    expect(titles(ended.players[0].hand)).not.toContain("Filed");

    const warden = chooseHouse(ended, 1, ended.players[1].houses[0]);
    const back = chooseHouse(endTurn(warden, 1), 0, "Brobnar");
    expect(isLegalMove(back, 0, { type: "takeArchives" })).toBe(true);
    expect(titles(applyMove(back, 0, { type: "takeArchives" }).players[0].hand)).toContain("Filed");
  });

  it("shouldTakeArchives weighs the active house and the hand room", () => {
    const state = setupTest({}, {}, "Dis");
    const hand = () => Array.from({ length: 6 }, (_, i) => card(`Filler ${i}`));
    state.players[1].archives = [card("Filed", { house: "Logos" })];
    state.players[1].hand = hand();
    expect(shouldTakeArchives(state, 1)).toBe(false); // full hand, off-house card

    state.players[1].hand = [];
    expect(shouldTakeArchives(state, 1)).toBe(true); // room for more cards

    state.players[1].archives = [card("Match", { house: "Dis" })];
    state.players[1].hand = hand();
    expect(shouldTakeArchives(state, 1)).toBe(true); // playable in the active house
  });
});
