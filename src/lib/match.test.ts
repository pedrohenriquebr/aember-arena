import { describe, expect, it } from "vitest";
import { chooseAiHouse, chooseAiMove, shouldMulligan } from "./ai";
import { DEMO_DECK } from "./demoDeck";
import { DEMO_DECK_2 } from "./demoDeck2";
import { applyMove, chooseHouse, createMatch, createPassAndPlayMatch, endTurn, keepHand, mulligan, revealsHiddenInfo, type DeckInfo, type GameState } from "./game";
import { byTitle, card, setupTest } from "./testkit";

const zoneTotal = (state: GameState, index: 0 | 1) => {
  const player = state.players[index];
  const archives = (player as { archives?: unknown[] }).archives?.length ?? 0;
  return player.deck.length + player.hand.length + player.discard.length + player.board.length + archives;
};

/** Plays an AI-vs-AI match exactly like App.tsx's turn loop does for the rival. */
function simulate(deckA: DeckInfo, deckB: DeckInfo, seed: number, maxTurns = 60): GameState {
  // FEAT-08: the seed drives the whole match — no Math.random mock needed.
  let state = createMatch(deckA, deckB, { seed });
  // FEAT-10: both sides decide the mulligan with the Warden's own heuristic.
  for (const side of [0, 1] as const) {
    state = shouldMulligan(state, side) ? mulligan(state, side) : keepHand(state, side);
  }
  const settings = { difficulty: "Medium" as const, thinkingDepth: 1 };
  for (let step = 0; step < maxTurns * 2 && state.winner === null; step += 1) {
    const actor = state.activePlayer;
    const house = chooseAiHouse(state, actor);
    state = chooseHouse(state, actor, house);
    for (let action = 0; action < 7; action += 1) {
      const move = chooseAiMove(state, actor, house, settings);
      if (!move) break;
      state = applyMove(state, actor, move);
      if (state.winner !== null) break;
    }
    if (state.winner === null) state = endTurn(state, actor);
    expect(zoneTotal(state, 0)).toBe(deckA.cards.length);
    expect(zoneTotal(state, 1)).toBe(deckB.cards.length);
  }
  return state;
}

describe("demo decks", () => {
  it.each([DEMO_DECK, DEMO_DECK_2])("$name is a legal 36-card, 3-house deck that works offline", (deck) => {
    expect(deck.cards).toHaveLength(36);
    expect(deck.houses).toHaveLength(3);
    for (const face of deck.cards) expect(deck.houses).toContain(face.house);
  });

  it("deals opening hands without losing cards", () => {
    const state = createMatch(DEMO_DECK, DEMO_DECK_2);
    expect(state.players[0].hand.length).toBeGreaterThanOrEqual(6);
    expect(state.players[1].hand).toHaveLength(6);
    expect(zoneTotal(state, 0)).toBe(36);
    expect(zoneTotal(state, 1)).toBe(36);
  });

  it.each([
    [DEMO_DECK, DEMO_DECK_2, 1],
    [DEMO_DECK_2, DEMO_DECK, 2],
    [DEMO_DECK, DEMO_DECK, 3],
  ])("AI-vs-AI match with the demo decks runs to completion (case %#)", (a, b, seed) => {
    const final = simulate(a, b, seed);
    expect(final.winner === null || final.players[final.winner].keys >= 3).toBe(true);
  });
});

describe("FEAT-08 seeded RNG (docs/BUGS_AND_FEATURES.md)", () => {
  it("the same seed deals the same opening hands and instance ids", () => {
    const first = createMatch(DEMO_DECK, DEMO_DECK_2, { seed: 77 });
    const second = createMatch(DEMO_DECK, DEMO_DECK_2, { seed: 77 });
    expect(second.players.map((player) => player.hand.map((card) => card.instanceId))).toEqual(
      first.players.map((player) => player.hand.map((card) => card.instanceId)),
    );
    expect(second.rngCalls).toBe(first.rngCalls);
    expect(second.seed).toBe(77);
  });

  it("seed + moves replay a whole AI-vs-AI match identically", () => {
    const first = simulate(DEMO_DECK, DEMO_DECK_2, 9, 24);
    const second = simulate(DEMO_DECK, DEMO_DECK_2, 9, 24);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe("FEAT-12 rewind safety (docs/BUGS_AND_FEATURES.md)", () => {
  const reap = (state: GameState, title: string) =>
    applyMove(state, 0, { type: "reap", instanceId: byTitle(state.players[0].board, title)!.instanceId });

  it("a plain move consumes no hidden information, so it is reversible", () => {
    const state = setupTest({ inPlay: [card("Plain", { type: "Creature", house: "Brobnar", power: 4 })] });
    const next = reap(state, "Plain");
    expect(next.players[0].amber).toBe(1);
    expect(revealsHiddenInfo(state, next)).toBe(false);
  });

  it("a move that draws hidden cards blocks the rewind", () => {
    const state = setupTest({ inPlay: [card("Doc Bookton")], deck: [card("A"), card("B")] });
    const next = reap(state, "Doc Bookton");
    expect(next.players[0].hand).toHaveLength(1);
    expect(revealsHiddenInfo(state, next)).toBe(true);
  });

  it("a mulligan shuffle blocks the rewind", () => {
    const state = setupTest({ hand: [card("A"), card("B")], deck: [card("C")] });
    state.pendingMulligan = 0;
    state.turn = 1;
    expect(revealsHiddenInfo(state, mulligan(state, 0))).toBe(true);
  });

  it("an undo restores an earlier state wholesale — FEAT-06 tallies included", () => {
    const anchor = setupTest({ inPlay: [card("Plain", { type: "Creature", house: "Brobnar", power: 4 })] });
    const before = JSON.stringify(anchor);
    const played = reap(anchor, "Plain");
    expect(played.players[0].amberGained).toBe(1);
    // The anchor is a valid earlier snapshot: restoring it rolls the counters
    // back with the rest of the state, so nothing is counted twice.
    expect(anchor.players[0].amberGained).toBe(0);
    expect(JSON.stringify(anchor)).toBe(before);
  });
});

describe("FEAT-13 pass-and-play setup (docs/BUGS_AND_FEATURES.md)", () => {
  it("names both sides and keeps each human on their own deck", () => {
    const state = createPassAndPlayMatch(DEMO_DECK, DEMO_DECK_2, { seed: 31 });
    expect(state.players.map((player) => player.name)).toEqual(["Player 1", "Player 2"]);
    expect(state.players.map((player) => player.deckName)).toEqual([DEMO_DECK.name, DEMO_DECK_2.name]);
    expect(state.players[0].hand.every((card) => DEMO_DECK.cards.includes(card.face))).toBe(true);
    expect(state.players[1].hand.every((card) => DEMO_DECK_2.cards.includes(card.face))).toBe(true);
    expect(state.activePlayer).toBe(0);
    expect(state.pendingMulligan).toBe(0);
    expect(zoneTotal(state, 0)).toBe(36);
    expect(zoneTotal(state, 1)).toBe(36);
  });

  it("both humans decide their mulligan and take the first turns in sequence", () => {
    let state = createPassAndPlayMatch(DEMO_DECK, DEMO_DECK_2, { seed: 32 });
    state = keepHand(state, 0);
    expect(state.pendingMulligan).toBe(1);
    state = mulligan(state, 1);
    expect(state.pendingMulligan).toBe(null);
    const house = state.players[0].houses[0];
    state = chooseHouse(state, 0, house);
    // The log carries the neutral names App localizes at render time.
    expect(state.log[state.log.length - 1]).toMatchObject({ key: "log.house", params: { name: "Player 1", house } });
    state = endTurn(state, 0);
    expect(state.activePlayer).toBe(1);
    const handBefore = state.players[1].hand.length;
    state = chooseHouse(state, 1, state.players[1].houses[0]);
    state = endTurn(state, 1);
    expect(state.activePlayer).toBe(0);
    expect(state.players[1].hand.length).toBeGreaterThanOrEqual(handBefore);
  });
});
