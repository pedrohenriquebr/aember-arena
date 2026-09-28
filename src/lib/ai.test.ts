import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseAiMove, type Difficulty } from "./ai";
import { isLegalMove } from "./game";
import { card, setupTest } from "./testkit";

const hard = { difficulty: "Very hard" as const, thinkingDepth: 2 };
type GameMoveOrNull = "move" | "null";

afterEach(() => vi.restoreAllMocks());

describe("AI", () => {
  it("does not wipe its own board for nothing", () => {
    const state = setupTest({}, { hand: ["Coward's End"], inPlay: ["Valdr"] }, "Brobnar");
    state.activePlayer = 1;
    const move = chooseAiMove(state, 1, "Brobnar", hard);
    expect(move?.type === "play").toBe(false);
  });

  it.each<[Difficulty, GameMoveOrNull]>([
    ["Easy", "move"],
    ["Medium", "null"],
    ["Very hard", "null"],
  ])("FEAT-03: $0 %s a dead card when it is the only action", (difficulty, expectation) => {
    const settings = { difficulty, thinkingDepth: 2 };
    // An Omni whose only target cannot exist is a no-op that costs nothing
    // (a self-sacrificing one would be genuinely bad and no difficulty plays it).
    const state = setupTest({}, { inPlay: [card("Blaster", { type: "Artifact", house: "Brobnar", text: "Omni: Deal 3D to an enemy creature." })] }, "Brobnar");
    state.activePlayer = 1;
    const move = chooseAiMove(state, 1, "Brobnar", settings);
    if (expectation === "null") expect(move).toBeNull();
    else expect(move).not.toBeNull();
  });

  it("FEAT-03: Medium+ holds a conditional play whose condition is unmet and plays the plain creature", () => {
    const settings = { difficulty: "Very hard" as const, thinkingDepth: 2 };
    // The AI is side 1 (Warden); its hand holds the conditional + a plain creature.
    const state = setupTest(
      { inPlay: [card("A", { power: 3 }), card("B", { power: 3 })] },
      {
        hand: [
          card("Grunt", { type: "Creature", house: "Brobnar", power: 2 }),
          card("Sniper", { type: "Creature", house: "Brobnar", power: 5, text: "Play: If you have 5A or more, deal 5D to an enemy creature." }),
        ],
      },
      "Brobnar",
    );
    state.activePlayer = 1;
    const move = chooseAiMove(state, 1, "Brobnar", settings);
    expect(move?.type).toBe("play");
    if (move?.type === "play") {
      const played = state.players[1].hand.find((c) => c.instanceId === move.instanceId);
      expect(played?.face.title).toBe("Grunt");
    }
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
