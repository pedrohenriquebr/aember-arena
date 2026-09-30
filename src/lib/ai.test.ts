import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseAiMove, shouldMulligan, type Difficulty } from "./ai";
import { getLegalMoves, isLegalMove, type GameMove } from "./game";
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

  it("only ever proposes legal moves (taunt respected), deterministically (FEAT-08)", () => {
    const taunt = card("Guard", { type: "Creature", power: 9, text: "Taunt." });
    const state = setupTest({ inPlay: [card("Weak", { type: "Creature", power: 1 }), taunt] }, { inPlay: ["Headhunter"] }, "Brobnar");
    state.activePlayer = 1;
    const first = chooseAiMove(state, 1, "Brobnar", { difficulty: "Easy", thinkingDepth: 1 });
    const second = chooseAiMove(state, 1, "Brobnar", { difficulty: "Easy", thinkingDepth: 1 });
    if (first) expect(isLegalMove(state, 1, first)).toBe(true);
    // Same state -> same move: profile noise comes from the seed, not Math.random.
    expect(second).toEqual(first);
  });
});

describe("persistent effects (docs/ROADMAP_REVIEW.md §3)", () => {
  it("searches only the fights a granted Taunt allows", () => {
    // The banner sits between two taunting neighbors: the AI cannot attack it.
    const banner = card("Banner", { type: "Creature", house: "Brobnar", power: 3, text: "Each other friendly creature gains Taunt." });
    const state = setupTest(
      { inPlay: [card("Small", { power: 1 }), banner, card("Far", { power: 1 })] },
      { inPlay: [card("Attacker", { power: 5, house: "Brobnar" })] },
      "Brobnar",
    );
    state.activePlayer = 1;
    const fights = getLegalMoves(state, 1).filter(
      (move): move is Extract<GameMove, { type: "fight" }> => move.type === "fight",
    );
    const allowed = fights
      .map((move) => state.players[0].board.find((item) => item.instanceId === move.targetId)!.face.title)
      .sort();
    expect(allowed).toEqual(["Far", "Small"]);
    const move = chooseAiMove(state, 1, "Brobnar", { difficulty: "Easy", thinkingDepth: 1 });
    if (move?.type === "fight") {
      expect(allowed).toContain(state.players[0].board.find((item) => item.instanceId === move.targetId)!.face.title);
    }
  });
});

describe("FEAT-10 mulligan heuristic", () => {  it("takes the mulligan when the most numerous house holds no creature", () => {
    const state = setupTest({
      hand: [card("Plot", { house: "Dis", type: "Action" }), card("Scheme", { house: "Dis", type: "Action" }), card("Grunt", { house: "Brobnar", type: "Creature" })],
    });
    expect(shouldMulligan(state, 0)).toBe(true);
  });

  it("keeps a hand with a creature of its most numerous house", () => {
    const state = setupTest({
      hand: [card("Grunt", { house: "Dis", type: "Creature" }), card("Plot", { house: "Dis", type: "Action" }), card("Axe", { house: "Brobnar", type: "Action" })],
    });
    expect(shouldMulligan(state, 0)).toBe(false);
  });
});
