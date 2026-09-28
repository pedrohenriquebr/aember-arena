// SPDX-License-Identifier: AGPL-3.0-only
// Keyword and turn-rule specs. Scenarios follow keyteki's docs/keywords.md and
// test/server keyword specs (Copyright (C) keyteki contributors, AGPL-3.0).
import { describe, expect, it } from "vitest";
import { DEMO_DECK } from "./demoDeck";
import { DEMO_DECK_2 } from "./demoDeck2";
import {
  applyMove,
  chooseHouse,
  isLegalMove,
  createMatch,
  endTurn,
  getLegalMoves,
  keepHand,
  keyCost,
  moveHasEffect,
  mulligan,
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
    const opening = keepHand(keepHand(createMatch(DEMO_DECK, DEMO_DECK_2), 0), 1);
    const state = chooseHouse(opening, 0, "Brobnar");
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
    const wardenTurn = chooseHouse(next, 1, next.players[1].houses[0]);
    expect(keyCost(endTurn(wardenTurn, 1), 1)).toBe(6);
  });

  it("wins on the third key", () => {
    const next = endTurn(setupTest({}, { amber: 6, keys: 2 }), 0);
    expect(next.winner).toBe(1);
  });

  it("archives are picked up when choosing a house", () => {
    const state = setupTest({}, {}, null);
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
    state.activeHouse = "Dis";
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

describe("regression: BUG-02 house choice gates the turn (docs/BUGS_AND_FEATURES.md)", () => {
  it("before a house is chosen no card may be played or reaped, and the turn cannot end", () => {
    const state = setupTest(
      { hand: [card("Offhouse", { type: "Creature", house: "Dis", power: 2 })], inPlay: [card("Reaper")] },
      {},
      null,
    );
    expect(state.activeHouse).toBeNull();
    expect(isLegalMove(state, 0, { type: "play", instanceId: state.players[0].hand[0].instanceId })).toBe(false);
    const reaper = state.players[0].board[0].instanceId;
    expect(isLegalMove(state, 0, { type: "reap", instanceId: reaper })).toBe(false);
    expect(endTurn(state, 0).activePlayer).toBe(0);
    const chosen = chooseHouse(state, 0, "Brobnar");
    expect(isLegalMove(chosen, 0, { type: "reap", instanceId: reaper })).toBe(true);
  });
});

describe("regression: BUG-04 upgrade on an enemy host (docs/BUGS_AND_FEATURES.md)", () => {
  it("an upgrade attached to an enemy creature is discarded when that creature leaves play", () => {
    let state = setupTest(
      { hand: [card("Mark", { type: "Upgrade", house: "Brobnar", text: "" })], inPlay: [card("Brute", { power: 5 })] },
      { inPlay: [card("Victim", { power: 2 })] },
    );
    const victim = state.players[1].board[0].instanceId;
    state = applyMove(state, 0, { type: "play", instanceId: state.players[0].hand[0].instanceId, target: victim });
    expect(byTitle(state.players[0].board, "Mark")?.attachedTo).toBe(victim);
    state = applyMove(state, 0, { type: "fight", attackerId: byTitle(state.players[0].board, "Brute")!.instanceId, targetId: victim });
    expect(state.players[1].board).toHaveLength(0);
    expect(byTitle(state.players[0].board, "Mark")).toBeUndefined();
    expect(byTitle(state.players[0].discard, "Mark")).toBeDefined();
  });
});

describe("regression: BUG-09 target condition counts the card's bonus amber (docs/BUGS_AND_FEATURES.md)", () => {
  it("a Play: 'If you have 3A or more' condition sees the card's own bonus amber", () => {
    const scrapper = card("Scrapper", { type: "Creature", house: "Brobnar", power: 5, amber: 1, text: "Play: If you have 3A or more, deal 3D to an enemy creature." });
    const state = setupTest({ hand: [scrapper], amber: 2 }, { inPlay: [card("A", { power: 4 }), card("B", { power: 4 })] });
    const move: GameMove = { type: "play", instanceId: scrapper.instanceId };
    expect(targetChoices(state, 0, move)).toHaveLength(2);
    const after = applyMove(state, 0, move);
    expect(after.players[1].board.filter((c) => c.damage === 3)).toHaveLength(1);
  });
});

describe("regression: BUG-10 self-sacrifice excludes the source from its own target (docs/BUGS_AND_FEATURES.md)", () => {
  it("'Sacrifice X. Destroy an artifact.' has no effect when X is the only artifact", () => {
    const gorm = card("Gorm of Omm", { type: "Artifact", house: "Brobnar", text: "Omni: Sacrifice Gorm of Omm. Destroy an artifact." });
    const state = setupTest({ inPlay: [gorm] });
    expect(moveHasEffect(state, 0, { type: "use", instanceId: gorm.instanceId })).toBe(false);
  });
});

describe("regression: BUG-11 'Use a friendly creature' resolves the printed Action (docs/BUGS_AND_FEATURES.md)", () => {
  it("Dominator Bauble using a creature with 'Action: Steal 2A' steals, not reaps", () => {
    const bauble = card("Dominator Bauble", { type: "Artifact", house: "Brobnar", text: "Action: Use a friendly creature." });
    const thief = card("Thief", { type: "Creature", house: "Brobnar", power: 2, text: "Action: Steal 2A." });
    const state = setupTest({ inPlay: [bauble, thief] }, { amber: 5 });
    const after = applyMove(state, 0, { type: "use", instanceId: bauble.instanceId, target: thief.instanceId });
    expect(after.players[0].amber).toBe(2);
  });

  it("using a creature without a printed Action reaps, and an explicit via is honoured", () => {
    const bauble = card("Dominator Bauble", { type: "Artifact", house: "Brobnar", text: "Action: Use a friendly creature." });
    const plain = card("Grunt", { type: "Creature", house: "Brobnar", power: 2 });
    const state = setupTest({ inPlay: [bauble, plain] });
    expect(applyMove(state, 0, { type: "use", instanceId: bauble.instanceId, target: plain.instanceId }).players[0].amber).toBe(1);
    const forced = applyMove(state, 0, { type: "use", instanceId: bauble.instanceId, target: plain.instanceId, via: "reap" });
    expect(forced.players[0].amber).toBe(1);
  });
});

describe("regression: BUG-06 fight ability targets are choosable (docs/BUGS_AND_FEATURES.md)", () => {
  it("a targeted After Fight: ability exposes its choices on the fight move", () => {
    const state = setupTest(
      { inPlay: [card("Basilisk", { power: 6, text: "Skirmish. After Fight: Exhaust an enemy creature." })] },
      { inPlay: [card("Low", { power: 1 }), card("Mid", { power: 3 }), card("High", { power: 5 })] },
    );
    const fights = getLegalMoves(state, 0, "Brobnar").filter((move): move is Extract<GameMove, { type: "fight" }> => move.type === "fight");
    expect(fights.some((move) => move.target !== undefined)).toBe(true);
  });
});

describe("regression: BUG-23 Gigantic halves (docs/BUGS_AND_FEATURES.md)", () => {
  const gravitron = () =>
    card("Ultra Gravitron", {
      type: "Creature",
      house: "Logos",
      power: 12,
      amber: 1,
      text: "Gigantic. (Play only with the other half of Ultra Gravitron.)",
    });

  it("one half alone is not playable", () => {
    const solo = setupTest({ hand: [gravitron()] }, {}, "Logos");
    expect(isLegalMove(solo, 0, { type: "play", instanceId: solo.players[0].hand[0].instanceId })).toBe(false);
  });

  it("both halves enter as one creature; both amber bonuses count; the second half sits under", () => {
    const state = setupTest({ hand: [gravitron(), gravitron()], amber: 2 }, {}, "Logos");
    const played = applyMove(state, 0, { type: "play", instanceId: state.players[0].hand[0].instanceId });
    const creature = byTitle(played.players[0].board, "Ultra Gravitron");
    expect(creature).toBeDefined();
    expect(creature!.under).toHaveLength(1);
    expect(played.players[0].hand).toHaveLength(0);
    expect(played.players[0].amber).toBe(4);
    expect(byTitle(played.players[0].hand, "Ultra Gravitron")).toBeUndefined();
  });
});

describe("FEAT-08 seeded RNG (docs/BUGS_AND_FEATURES.md)", () => {
  it("a random discard is reproducible from the state's seed", () => {
    const run = () => {
      const state = setupTest({ hand: ["Mind Barb"] }, { hand: Array.from({ length: 12 }, (_, i) => card(`Filler ${i}`)) });
      const barb = state.players[0].hand[0];
      return titles(applyMove(state, 0, { type: "play", instanceId: barb.instanceId }).players[1].hand);
    };
    const first = run();
    expect(first).toHaveLength(11);
    expect(run()).toEqual(first);
  });
});

describe("FEAT-10 mulligan (docs/BUGS_AND_FEATURES.md)", () => {  const total = (state: GameState, side: 0 | 1) => {
    const player = state.players[side];
    return player.deck.length + player.hand.length + player.discard.length + player.board.length + player.archives.length;
  };

  it("no card is legal, the house cannot be chosen and the turn cannot end before both decide", () => {
    const state = createMatch(DEMO_DECK, DEMO_DECK_2, { seed: 5 });
    expect(state.pendingMulligan).toBe(0);
    expect(getLegalMoves(state, 0)).toHaveLength(0);
    expect(chooseHouse(state, 0, state.players[0].houses[0]).activeHouse).toBeNull();
    expect(endTurn(state, 0).activePlayer).toBe(0);
  });

  it("keeping the hand just advances the micro-phase", () => {
    const state = keepHand(keepHand(createMatch(DEMO_DECK, DEMO_DECK_2, { seed: 5 }), 0), 1);
    expect(state.pendingMulligan).toBeNull();
    expect(state.players[1].hand).toHaveLength(6);
  });

  it("first player's mulligan shuffles the hand back and draws one fewer; only once", () => {
    const state = mulligan(createMatch(DEMO_DECK, DEMO_DECK_2, { seed: 5 }), 0);
    expect(state.players[0].hand).toHaveLength(6);
    expect(state.players[0].mulliganed).toBe(true);
    expect(state.pendingMulligan).toBe(1);
    expect(total(state, 0)).toBe(36);
    // A second mulligan for the same side is refused (and cannot touch side 1's turn).
    const again = mulligan(state, 0);
    expect(again.players[0].hand).toHaveLength(6);
    expect(again.pendingMulligan).toBe(1);
  });

  it("second player draws one fewer than its opening 6", () => {
    const state = mulligan(keepHand(createMatch(DEMO_DECK, DEMO_DECK_2, { seed: 5 }), 0), 1);
    expect(state.pendingMulligan).toBeNull();
    expect(state.players[1].hand).toHaveLength(5);
    expect(state.players[1].mulliganed).toBe(true);
    expect(total(state, 1)).toBe(36);
  });
});

describe("FEAT-05 match log (docs/BUGS_AND_FEATURES.md)", () => {
  it("log entries carry the round they happened in, across turns", () => {
    const state = setupTest({ inPlay: [creature("A", 3)] }, {}, "Brobnar");
    const reaped = applyMove(state, 0, { type: "reap", instanceId: state.players[0].board[0].instanceId });
    expect(reaped.log.at(-1)).toMatchObject({ key: "log.reap", turn: 2 });
    const next = endTurn(reaped, 0);
    expect(next.log.at(-1)).toMatchObject({ key: "log.endTurn", turn: 2 });
    expect(next.log.at(-2)).toMatchObject({ key: "log.reap", turn: 2 });
  });
});

describe("FEAT-06 match tallies (docs/BUGS_AND_FEATURES.md)", () => {
  it("reaping and a bonus icon count as generated amber; playing counts a card", () => {
    const bonus = card("Bonus", { type: "Action", house: "Brobnar", amber: 2, text: "" });
    let state = setupTest({ inPlay: [creature("A", 3)], hand: [bonus] }, {}, "Brobnar");
    state = applyMove(state, 0, { type: "reap", instanceId: state.players[0].board[0].instanceId });
    expect(state.players[0].amberGained).toBe(1);
    state = applyMove(state, 0, { type: "play", instanceId: state.players[0].hand[0].instanceId });
    expect(state.players[0].amberGained).toBe(3);
    expect(state.players[0].cardsPlayed).toBe(1);
  });

  it("steal and capture move amber from the opponent into their own tally", () => {
    let state = setupTest({ hand: [creature("Thief", 3, "Play: Steal 1 amber.")] }, { amber: 3 }, "Brobnar");
    state = applyMove(state, 0, { type: "play", instanceId: state.players[0].hand[0].instanceId });
    expect(state.players[0].amberStolen).toBe(1);
    expect(state.players[1].amber).toBe(2);

    state = setupTest({ hand: [creature("Captor", 3, "Play: Capture 1 amber.")] }, { amber: 3 }, "Brobnar");
    state = applyMove(state, 0, { type: "play", instanceId: state.players[0].hand[0].instanceId });
    expect(state.players[0].amberCaptured).toBe(1);
    expect(state.players[1].amber).toBe(2);
    expect(state.players[0].board[0].amber).toBe(1);
  });

  it("destruction credits the side that killed: fight exchange and destroy effect", () => {
    const state = fight(setupTest({ inPlay: [creature("A", 5)] }, { inPlay: [creature("B", 2)] }), "A", "B");
    expect(state.players[1].board).toHaveLength(0);
    expect(state.players[0].creaturesDestroyed).toBe(1);
    expect(state.players[1].creaturesDestroyed).toBe(0);

    const sweeper = setupTest({ hand: [creature("Sweeper", 3, "Play: Destroy an enemy creature.")] }, { inPlay: [creature("B", 2)] }, "Brobnar");
    const after = applyMove(sweeper, 0, { type: "play", instanceId: sweeper.players[0].hand[0].instanceId });
    expect(after.players[1].board).toHaveLength(0);
    expect(after.players[0].creaturesDestroyed).toBe(1);
    expect(after.players[1].creaturesDestroyed).toBe(0);
  });

  it("the counters stay plain JSON (no functions in the state)", () => {
    let state = setupTest({ inPlay: [creature("A", 3)] });
    state = applyMove(state, 0, { type: "reap", instanceId: state.players[0].board[0].instanceId });
    const roundTrip = JSON.parse(JSON.stringify(state)) as GameState;
    expect(JSON.stringify(roundTrip)).toBe(JSON.stringify(state));
    expect(roundTrip.players[0].amberGained).toBe(1);
  });
});
