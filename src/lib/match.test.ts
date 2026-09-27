import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseAiHouse, chooseAiMove } from "./ai";
import { DEMO_DECK } from "./demoDeck";
import { DEMO_DECK_2 } from "./demoDeck2";
import { applyMove, chooseHouse, createMatch, endTurn, type DeckInfo, type GameState } from "./game";
import { seededRandom } from "./testkit";

const zoneTotal = (state: GameState, index: 0 | 1) => {
  const player = state.players[index];
  const archives = (player as { archives?: unknown[] }).archives?.length ?? 0;
  return player.deck.length + player.hand.length + player.discard.length + player.board.length + archives;
};

/** Plays an AI-vs-AI match exactly like App.tsx's turn loop does for the rival. */
function simulate(deckA: DeckInfo, deckB: DeckInfo, seed: number, maxTurns = 60): GameState {
  vi.spyOn(Math, "random").mockImplementation(seededRandom(seed));
  let state = createMatch(deckA, deckB);
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

afterEach(() => vi.restoreAllMocks());

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
