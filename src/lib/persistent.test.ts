// SPDX-License-Identifier: AGPL-3.0-only
// Persistent-effect specs: the derived layer added in the wave-1 review
// (docs/ROADMAP_REVIEW.md §3). Card scenarios are ported from keyteki
// test/server/cards/01-Core/*.spec.js (Bulwark, Grey Monk, Staunch Knight,
// Ember Imp, Scrambler Storm) — Copyright (C) keyteki contributors, AGPL-3.0 —
// and adapted to this engine's API.
import { describe, expect, it } from "vitest";
import {
  abilitiesOf,
  applyMove,
  chooseHouse,
  effectiveArmor,
  effectivePower,
  endTurn,
  getLegalMoves,
  isLegalMove,
  keyword,
  type GameMove,
  type GameState,
} from "./game";
import { byTitle, card, setupTest, titles } from "./testkit";

const creature = (title: string, power: number, text = "", extra: Record<string, unknown> = {}) =>
  card(title, { type: "Creature", house: "Brobnar", power, text, ...extra });

const board = (state: GameState, side: 0 | 1, title: string) => byTitle(state.players[side].board, title)!;

function play(state: GameState, side: 0 | 1, title: string, target?: string): GameState {
  const card = byTitle(state.players[side].hand, title);
  if (!card) throw new Error(`${title} not in hand`);
  return applyMove(state, side, { type: "play", instanceId: card.instanceId, target });
}

function fight(state: GameState, side: 0 | 1, attacker: string, defender: string): GameState {
  const enemy = side === 0 ? 1 : 0;
  return applyMove(state, side, {
    type: "fight",
    attackerId: byTitle(state.players[side].board, attacker)!.instanceId,
    targetId: byTitle(state.players[enemy].board, defender)!.instanceId,
  });
}

describe("Bulwark (keyteki 01-Core)", () => {
  it("gives +2 armor to its neighbors, not to the rest of the line", () => {
    const state = setupTest({ inPlay: [creature("Far", 3), creature("Left", 3), card("Bulwark"), creature("Right", 3)] });
    expect(effectiveArmor(state, board(state, 0, "Left"))).toBe(2);
    expect(effectiveArmor(state, board(state, 0, "Right"))).toBe(2);
    expect(effectiveArmor(state, board(state, 0, "Far"))).toBe(0);
    expect(effectiveArmor(state, board(state, 0, "Bulwark"))).toBe(2); // its own printed armor
  });
});

describe("Grey Monk (keyteki 01-Core)", () => {
  it("increases the armor of friendly creatures, both sides of the board kept apart", () => {
    const state = setupTest(
      { inPlay: [card("Grey Monk"), creature("Grunt", 3), card("Bulwark")] },
      { inPlay: [creature("Enemy", 4)] },
    );
    expect(effectiveArmor(state, board(state, 0, "Grey Monk"))).toBe(1);
    expect(effectiveArmor(state, board(state, 0, "Grunt"))).toBe(3); // Grey Monk's +1 and Bulwark's +2
    expect(effectiveArmor(state, board(state, 0, "Bulwark"))).toBe(3); // printed 2 + 1
    expect(effectiveArmor(state, board(state, 1, "Enemy"))).toBe(0);
  });

  it("heals two damage after reaping", () => {
    const state = setupTest({ inPlay: [card("Grey Monk"), creature("Grunt", 3)] });
    board(state, 0, "Grunt").damage = 2;
    const next = applyMove(state, 0, {
      type: "reap",
      instanceId: board(state, 0, "Grey Monk").instanceId,
      target: board(state, 0, "Grunt").instanceId,
    });
    expect(board(next, 0, "Grunt").damage).toBe(0);
  });
});

describe("Staunch Knight (keyteki 01-Core)", () => {
  it("has +2 power while it is on a flank and loses it in the middle", () => {
    const flank = setupTest({ inPlay: [card("Staunch Knight"), creature("Other", 3)] });
    expect(effectivePower(flank, board(flank, 0, "Staunch Knight"))).toBe(6);
    expect(effectiveArmor(flank, board(flank, 0, "Staunch Knight"))).toBe(2);

    const middle = setupTest({ inPlay: [creature("A", 3), card("Staunch Knight"), creature("B", 3)] });
    expect(effectivePower(middle, board(middle, 0, "Staunch Knight"))).toBe(4);
  });
});

describe("power drained to 0 (keyteki: power <= 0 destroys)", () => {
  it("a creature whose effective power reaches 0 dies without taking damage", () => {
    const blight = card("Blight", { type: "Action", house: "Brobnar", text: "Play: Each enemy creature gets -2 power for the remainder of the turn." });
    const state = setupTest({ hand: [blight] }, { inPlay: [creature("Weak", 2), creature("Sturdy", 3)] });
    const next = applyMove(state, 0, { type: "play", instanceId: blight.instanceId });
    expect(titles(next.players[1].board)).toEqual(["Sturdy"]);
    expect(titles(next.players[1].discard)).toEqual(["Weak"]);
  });
});

describe("effective power and armor in combat", () => {
  const banner = () => creature("Banner", 1, "Each friendly creature gets +1 power.");

  it("fight damage uses the modified power", () => {
    const state = setupTest({ inPlay: [creature("A", 2), banner()] }, { inPlay: [creature("Wall", 3)] });
    const next = fight(state, 0, "A", "Wall");
    expect(next.players[1].board).toHaveLength(0); // 2 + 1 = 3 reaches the wall's power
  });

  it("a buffed creature survives damage that is lethal on its printed power", () => {
    const buffed = fight(
      setupTest({ inPlay: [creature("A", 5), banner()] }, { inPlay: [creature("Tall", 5)] }),
      0,
      "A",
      "Tall",
    );
    expect(titles(buffed.players[0].board)).toContain("A");
    const plain = fight(setupTest({ inPlay: [creature("A", 5)] }, { inPlay: [creature("Tall", 5)] }), 0, "A", "Tall");
    expect(titles(plain.players[0].board)).not.toContain("A");
  });

  it("armor from a persistent effect absorbs damage once per turn", () => {
    const pad = creature("Pad", 1, "Each friendly creature gets +2 armor.");
    const state = setupTest({ inPlay: [creature("A", 3)] }, { inPlay: [creature("Padded", 3), pad] });
    const armored = fight(state, 0, "A", "Padded");
    expect(board(armored, 1, "Padded").damage).toBe(1); // 2 absorbed by the granted armor
    expect(effectiveArmor(armored, board(armored, 1, "Padded"))).toBe(2);
  });
});

describe("granted keywords", () => {
  it("Taunt on a neighbor hides the creature between two taunts", () => {
    const banner = creature("Banner", 3, "Each other friendly creature gains Taunt.");
    const state = setupTest(
      { inPlay: [creature("Small", 1), banner, creature("Far", 1)] },
      { inPlay: [creature("Attacker", 5)] },
    );
    const attacker = board(state, 1, "Attacker");
    expect(keyword(state, board(state, 0, "Small"), "taunt")).toBe(1);
    expect(keyword(state, board(state, 0, "Banner"), "taunt")).toBe(0);
    const targets = getLegalMoves(state, 1)
      .filter((move): move is Extract<GameMove, { type: "fight" }> => move.type === "fight")
      .map((move) => state.players[0].board.find((item) => item.instanceId === move.targetId)!.face.title)
      .sort();
    expect(targets).toEqual(["Far", "Small"]);
    expect(isLegalMove(state, 1, { type: "fight", attackerId: attacker.instanceId, targetId: board(state, 0, "Banner").instanceId })).toBe(false);
    expect(isLegalMove(state, 1, { type: "fight", attackerId: attacker.instanceId, targetId: board(state, 0, "Small").instanceId })).toBe(true);
  });
});

describe("prohibitions", () => {
  it("Ember Imp limits the opponent to two card plays; discarding stays legal", () => {
    let state = setupTest(
      { inPlay: [creature("Bulleteye", 5)], hand: [creature("Umbra", 2), creature("Urchin", 2), creature("Dodger", 2)] },
      { inPlay: [card("Ember Imp")] },
    );
    state = play(state, 0, "Umbra");
    expect(titles(state.players[0].board)).toContain("Umbra");
    state = play(state, 0, "Urchin");
    expect(state.plays).toBe(2);
    const dodger = byTitle(state.players[0].hand, "Dodger")!;
    expect(isLegalMove(state, 0, { type: "play", instanceId: dodger.instanceId })).toBe(false);
    expect(isLegalMove(state, 0, { type: "discard", instanceId: dodger.instanceId })).toBe(true);
    // Killing the Imp lifts the lock (keyteki spec: the third play is legal again).
    state = fight(state, 0, "Bulleteye", "Ember Imp");
    expect(state.players[1].board).toHaveLength(0);
    state = play(state, 0, "Dodger");
    expect(titles(state.players[0].board)).toContain("Dodger");
    expect(state.plays).toBe(3);
  });

  it("Scrambler Storm stops action cards on the opponent's next turn only", () => {
    let state = setupTest(
      { hand: [card("Scrambler Storm")] },
      { hand: [card("Plot", { type: "Action", house: "Dis" }), card("Grunt", { type: "Creature", house: "Dis", power: 2 })] },
    );
    state = play(state, 0, "Scrambler Storm");
    state = endTurn(state, 0);
    state = chooseHouse(state, 1, "Dis");
    expect(isLegalMove(state, 1, { type: "play", instanceId: byTitle(state.players[1].hand, "Plot")!.instanceId })).toBe(false);
    expect(isLegalMove(state, 1, { type: "play", instanceId: byTitle(state.players[1].hand, "Grunt")!.instanceId })).toBe(true);

    // The effect expires at the end of that turn, not on later ones.
    state = endTurn(state, 1);
    state = chooseHouse(state, 0, "Brobnar");
    state = endTurn(state, 0);
    state = chooseHouse(state, 1, "Dis");
    expect(isLegalMove(state, 1, { type: "play", instanceId: byTitle(state.players[1].hand, "Plot")!.instanceId })).toBe(true);
  });
});

describe("lasting effects", () => {
  it("a 'remainder of the turn' stat bonus ends with the turn it was played in", () => {
    const rally = card("Rally", { type: "Action", house: "Brobnar", text: "Play: Each friendly creature gets +1 power for the remainder of the turn." });
    let state = setupTest({ hand: [rally], inPlay: [creature("A", 3)] }, { inPlay: [creature("B", 3)] });
    const before = effectivePower(state, board(state, 0, "A"));
    state = play(state, 0, "Rally");
    expect(effectivePower(state, board(state, 0, "A"))).toBe(before + 1);
    expect(effectivePower(state, board(state, 1, "B"))).toBe(3);
    state = endTurn(state, 0);
    expect(effectivePower(state, board(state, 0, "A"))).toBe(before);
  });

  it("keeps the state JSON-safe while a lasting effect is active", () => {
    const action = card("Stormfront", { type: "Action", house: "Brobnar", text: "Play: Your opponent cannot play action cards on their next turn." });
    let state = setupTest({ hand: [action], inPlay: [creature("A", 3)] }, {});
    state = play(state, 0, "Stormfront");
    const roundTrip = JSON.parse(JSON.stringify(state)) as GameState;
    expect(JSON.stringify(roundTrip)).toBe(JSON.stringify(state));
  });
});

describe("gainAbility", () => {
  it("grants a quoted ability to each friendly creature, resolved by the same engine", () => {
    const herald = creature("Herald", 2, "Each friendly creature gains 'Reap: Gain 1 amber.'");
    const state = setupTest({ inPlay: [creature("Grunt", 2), herald] });
    expect(abilitiesOf(state, board(state, 0, "Grunt"))).toHaveLength(1);
    const next = applyMove(state, 0, { type: "reap", instanceId: board(state, 0, "Grunt").instanceId });
    expect(next.players[0].amber).toBe(2); // the reap amber plus the granted one
  });

  it("a granted Action makes a plain creature usable", () => {
    const herald = creature("Herald", 2, "Each friendly creature gains 'Action: Gain 2 amber.'");
    const state = setupTest({ inPlay: [creature("Idle", 2), herald] }, {}, "Brobnar");
    const idle = board(state, 0, "Idle");
    expect(getLegalMoves(state, 0).some((move) => move.type === "use" && move.instanceId === idle.instanceId)).toBe(true);
    expect(applyMove(state, 0, { type: "use", instanceId: idle.instanceId }).players[0].amber).toBe(2);
  });
});

describe("optional archives (review §1.2)", () => {
  it("offers the pickup as a move after the house choice", () => {
    const state = setupTest({}, {}, null);
    state.players[0].archives = [creature("Filed", 2)];
    expect(isLegalMove(state, 0, { type: "takeArchives" })).toBe(false); // no house yet
    const chosen = chooseHouse(state, 0, "Brobnar");
    expect(isLegalMove(chosen, 0, { type: "takeArchives" })).toBe(true);
    const taken = applyMove(chosen, 0, { type: "takeArchives" });
    expect(titles(taken.players[0].hand)).toEqual(["Filed"]);
    expect(taken.players[0].archives).toHaveLength(0);
  });
});

describe("upgrade text", () => {
  it("a constant upgrade applies to its host and dies with it", () => {
    const upgrade = card("Might", { type: "Upgrade", house: "Brobnar", text: "This creature gets +2 power." });
    const state = setupTest({ hand: [upgrade], inPlay: [creature("Host", 3), creature("Other", 3)] }, { inPlay: [creature("Brute", 6)] });
    const played = play(state, 0, "Might", board(state, 0, "Host").instanceId);
    expect(effectivePower(played, board(played, 0, "Host"))).toBe(5);
    expect(effectivePower(played, board(played, 0, "Other"))).toBe(3);

    const after = fight(played, 1, "Brute", "Host"); // the host dies, the upgrade is discarded
    expect(byTitle(after.players[0].board, "Might")).toBeUndefined();
    expect(titles(after.players[0].discard)).toContain("Might");
  });
});
