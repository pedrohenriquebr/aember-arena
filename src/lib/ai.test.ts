import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseAiMove } from "./ai";
import { isLegalMove } from "./game";
import { card, setupTest } from "./testkit";

const hard = { difficulty: "Very hard" as const, thinkingDepth: 2 };

afterEach(() => vi.restoreAllMocks());

describe("AI", () => {
  it("does not wipe its own board for nothing", () => {
    const state = setupTest({}, { hand: ["Coward's End"], inPlay: ["Valdr"] }, "Brobnar");
    state.activePlayer = 1;
    const move = chooseAiMove(state, 1, "Brobnar", hard);
    expect(move?.type === "play").toBe(false);
  });

  it("prefers a card whose ability can resolve over one whose condition fails", () => {
    const state = setupTest({ hand: ["Smith", "Valdr"] }, { hand: ["Fear", "Mind Barb"] }, "Dis");
    state.activePlayer = 1;
    // Fear has no enemy creature to return; Mind Barb's discard can resolve.
    const move = chooseAiMove(state, 1, "Dis", hard);
    expect(move && "instanceId" in move ? state.players[1].hand.find((item) => item.instanceId === move.instanceId)?.face.title : null).toBe("Mind Barb");
  });

  it("only ever proposes legal moves (taunt respected)", () => {
    const taunt = card("Guard", { type: "Creature", power: 9, text: "Taunt." });
    const state = setupTest({ inPlay: [card("Weak", { type: "Creature", power: 1 }), taunt] }, { inPlay: ["Headhunter"] }, "Brobnar");
    state.activePlayer = 1;
    for (let seed = 0; seed < 5; seed += 1) {
      const move = chooseAiMove(state, 1, "Brobnar", { difficulty: "Easy", thinkingDepth: 1 });
      if (move) expect(isLegalMove(state, 1, move)).toBe(true);
    }
  });
});
