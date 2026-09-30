// SPDX-License-Identifier: AGPL-3.0-only
// Onda 4 specs (docs/ROADMAP_REVIEW.md §3 — "estado de set"): ward and enrage
// tokens (keyteki WardAction.js / RemoveWardAction.js / EnrageAction.js and
// Card.warded/enraged), enhanced bonus icons (Card.bonusIcons +
// ResolveBonusIconsAction.js), take control (game.js takeControl/
// finalizeTakeControl), forging/unforging outside the key step (ForgeAction.js /
// UnforgeAction.js) and the supported "instead" replacements
// (DestroyAction.js / DealDamageAction.js). Scenarios use the printed text of
// Tricerian Legionary, Pax Sauriana, Old Egad, Soul Fiddle, Hypnobeam, Shadow
// Self, Annihilation Ritual and Key Charge — Copyright (C) keyteki contributors,
// AGPL-3.0 — adapted to this engine's API.
import { describe, expect, it } from "vitest";
import { rulesOf } from "./abilities";
import { applyMove, chooseHouse, deckFromState, endTurn, forgeKey, getLegalMoves, moveHasEffect, type CardFace, type GameState } from "./game";
import { readBonusIcons } from "./keyforgeApi";
import { byTitle, card, setupTest, titles } from "./testkit";

const creature = (title: string, power: number, text = "", extra: Partial<CardFace> = {}) =>
  card(title, { type: "Creature", house: "Brobnar", power, text, ...extra });

const cardOf = (title: string, text: string, extra: Partial<CardFace> = {}) => card(title, { type: "Action", house: "Brobnar", text, ...extra });

const board = (state: GameState, side: 0 | 1, title: string) => byTitle(state.players[side].board, title)!;

function play(state: GameState, side: 0 | 1, title: string, target?: string, decline = false): GameState {
  const item = byTitle(state.players[side].hand, title);
  if (!item) throw new Error(`${title} not in hand`);
  return applyMove(state, side, { type: "play", instanceId: item.instanceId, target, decline });
}

function fight(state: GameState, side: 0 | 1, attacker: string, defender: string): GameState {
  const enemy = side === 0 ? 1 : 0;
  return applyMove(state, side, {
    type: "fight",
    attackerId: byTitle(state.players[side].board, attacker)!.instanceId,
    targetId: byTitle(state.players[enemy].board, defender)!.instanceId,
  });
}

const gateway = () => cardOf("Gateway to Dis", "Play: Destroy each creature. Gain 3 chains.", { house: "Dis" });

describe("ward (keyteki WardAction/Card.warded)", () => {
  it("wards a creature from printed text and blocks the first damage instance", () => {
    const legionary = creature("Tricerian Legionary", 4, "Taunt. Play: Ward a friendly creature.", { house: "Saurian" });
    const state = setupTest({ hand: [legionary], inPlay: [creature("Grunt", 3)] }, { inPlay: [creature("Brute", 3)] });
    const warded = play(state, 0, "Tricerian Legionary", legionary.instanceId);
    expect(board(warded, 0, "Tricerian Legionary").warded).toBe(1);

    // The first damage instance is cancelled whole (not only lethal damage) and
    // the token is discarded; the attacker still takes the fight damage.
    const next = fight(warded, 1, "Brute", "Tricerian Legionary");
    expect(board(next, 0, "Tricerian Legionary").warded).toBe(0);
    expect(board(next, 0, "Tricerian Legionary").damage).toBe(0);
    expect(titles(next.players[1].board)).toEqual([]); // the 3-power Brute fell
  });

  it("wards each creature from 'Play: Ward each creature.' and blocks the first destroy", () => {
    const pax = cardOf("Pax Sauriana", "Play: Ward each creature.", { house: "Saurian" });
    let state = setupTest({ hand: [pax, gateway(), gateway()], inPlay: [creature("Grunt", 3)] }, { inPlay: [creature("Brute", 5)] });
    state = play(state, 0, "Pax Sauriana");
    expect(board(state, 0, "Grunt").warded).toBe(1);
    expect(board(state, 1, "Brute").warded).toBe(1);

    // A board wipe consumes every ward: the creatures survive the first one...
    state.activeHouse = "Dis";
    state = play(state, 0, "Gateway to Dis");
    expect(state.players[0].board).toHaveLength(1);
    expect(board(state, 0, "Grunt").warded).toBe(0);
    expect(board(state, 1, "Brute").warded).toBe(0);
    expect(state.players[0].discard.map((item) => item.face.title)).toEqual(["Pax Sauriana", "Gateway to Dis"]);

    // ...and the next one destroys them (keyteki re-runs the state check).
    state = play(state, 0, "Gateway to Dis");
    expect(state.players[0].board).toHaveLength(0);
    expect(titles(state.players[1].board)).toEqual([]);
  });

  it.each([
    ["Purge an enemy creature.", "purged"],
    ["Return an enemy creature to its owner's hand.", "hand"],
    ["Archive an enemy creature.", "archives"],
  ] as const)("a ward cancels the leave-play effect '%s' and is spent", (text, pile) => {
    const state = setupTest({ hand: [cardOf("Mover", `Play: ${text}`)] }, { inPlay: [creature("Victim", 3)] });
    state.players[1].board[0].warded = 1;
    const next = play(state, 0, "Mover");
    expect(board(next, 1, "Victim").warded).toBe(0);
    expect(next.players[1][pile]).toHaveLength(0);
    // With the ward gone the same effect works.
    const again = setupTest({ hand: [cardOf("Mover", `Play: ${text}`)] }, { inPlay: [creature("Victim", 3)] });
    expect(titles(play(again, 0, "Mover").players[1][pile])).toEqual(["Victim"]);
  });

  it("wards the source's neighbors from a 'Destroyed:' ability (Old Egad)", () => {
    const egad = creature("Old Egad", 2, "Destroyed: Ward each of Old Egad's neighbors.", { house: "Dis" });
    const state = setupTest({ hand: [cardOf("Decimation", "Play: Destroy a creature.")], inPlay: [creature("Left", 2), egad, creature("Right", 2)] });
    const next = play(state, 0, "Decimation", egad.instanceId);
    expect(titles(next.players[0].board)).toEqual(["Left", "Right"]);
    expect(board(next, 0, "Left").warded).toBe(1);
    expect(board(next, 0, "Right").warded).toBe(1);
    expect(titles(next.players[0].discard)).toEqual(["Old Egad", "Decimation"]);
  });

  it("keeps the state JSON-safe with a ward token in play", () => {
    const legionary = creature("Tricerian Legionary", 4, "Taunt. Play: Ward a friendly creature.", { house: "Saurian" });
    const state = play(setupTest({ hand: [legionary] }), 0, "Tricerian Legionary");
    const roundTrip = JSON.parse(JSON.stringify(state)) as GameState;
    expect(JSON.stringify(roundTrip)).toBe(JSON.stringify(state));
  });

  it("recognizes the printed keyword for coverage, like exalt", () => {
    const rules = rulesOf({ id: "x", title: "Warded", house: "Saurian", type: "Creature", image: "", text: "", amber: 0, power: 3, armor: 0, keywords: ["ward"] });
    expect(rules.keywords.ward).toBe(1);
    expect(rules.coverage).toBe("full");
  });
});

describe("enrage (keyteki EnrageAction/Card.enraged)", () => {
  it("makes the enraged creature fight when used, then discards the token", () => {
    const pandulf = creature("Pandulf the Provoker", 5, "Play: Enrage an enemy creature", { house: "Dis" });
    let state = setupTest({ hand: [pandulf] }, { inPlay: [creature("Brute", 6, "", { house: "Dis" }), creature("Grunt", 2, "", { house: "Dis" })] });
    state = play(state, 0, "Pandulf the Provoker");
    expect(board(state, 1, "Brute").enraged).toBe(1);
    expect(board(state, 1, "Grunt").enraged).toBeUndefined();

    state = endTurn(state, 0);
    state = chooseHouse(state, 1, "Dis");
    const brute = board(state, 1, "Brute").instanceId;
    const moves = getLegalMoves(state, 1);
    expect(moves.some((move) => move.type === "reap" && move.instanceId === brute)).toBe(false);
    expect(moves.some((move) => move.type === "fight" && move.attackerId === brute)).toBe(true);

    state = fight(state, 1, "Brute", "Pandulf the Provoker");
    expect(board(state, 1, "Brute").enraged).toBe(0);
    expect(titles(state.players[0].board)).toEqual([]);
  });

  it("is a token, not a keyword: 'Destroyed: Enrage each enemy creature.' hits the other side", () => {
    const twin = creature("Old Egad's Evil Twin", 3, "Destroyed: Enrage each enemy creature.", { house: "Dis" });
    const state = setupTest({ inPlay: [creature("Brute", 5)] }, { inPlay: [twin, creature("Ace", 6)] });
    const next = fight(state, 0, "Brute", "Old Egad's Evil Twin");
    expect(board(next, 0, "Brute").enraged).toBe(1);
    expect(titles(next.players[1].board)).toEqual(["Ace"]);
  });

  it("leaves the creature free when no fight is legal ('if able')", () => {
    const state = setupTest({}, { inPlay: [creature("Lone", 4)] });
    const lone = board(state, 1, "Lone").instanceId;
    board(state, 1, "Lone").enraged = 1;
    expect(getLegalMoves(state, 1).some((move) => move.type === "reap" && move.instanceId === lone)).toBe(true);
  });
});

describe("enhanced bonus icons (keyteki Card.bonusIcons)", () => {
  it("resolves the capture icon on play, on top of the amber icons", () => {
    const signal = cardOf("Encrypted Signal", "", { bonusIcons: { amber: 1, capture: 1 } });
    const state = setupTest({ hand: [signal], inPlay: [creature("Host", 3)] }, { amber: 3, inPlay: [creature("Foe", 2)] });
    const next = play(state, 0, "Encrypted Signal");
    expect(next.players[0].amber).toBe(1);
    expect(board(next, 0, "Host").amber).toBe(1);
    expect(next.players[1].amber).toBe(2);
    expect(next.players[0].amberCaptured).toBe(1);
  });

  it("resolves the damage and draw icons on play", () => {
    const blast = cardOf("Blast", "", { bonusIcons: { amber: 0, damage: 1, draw: 1 } });
    const state = setupTest({ hand: [blast], deck: [creature("Drawn", 1)] }, { inPlay: [creature("Foe", 3)] });
    const next = play(state, 0, "Blast");
    expect(board(next, 1, "Foe").damage).toBe(1);
    expect(titles(next.players[0].hand)).toEqual(["Drawn"]);
    expect(next.players[0].amber).toBe(0);
  });

  it("keeps the plain amber when the payload had no enhancements", () => {
    const plain = cardOf("Plain", "", { amber: 2 });
    const state = play(setupTest({ hand: [plain] }), 0, "Plain");
    expect(state.players[0].amber).toBe(2);
  });

  it("counts as an effect for the AI's pruning when only the icons remain", () => {
    const blast = cardOf("Blast", "", { bonusIcons: { amber: 0, damage: 1 } });
    const state = setupTest({ hand: [blast] }, { inPlay: [creature("Foe", 3)] });
    const move = { type: "play", instanceId: byTitle(state.players[0].hand, "Blast")!.instanceId } as const;
    expect(moveHasEffect(state, 0, move)).toBe(true);
  });
});

describe("enhancements from the Master Vault payload (normaliseCard)", () => {
  it("reads the enhancement icons into bonusIcons", () => {
    expect(readBonusIcons({ enhancements: ["damage", "amber", "logos"] }, 1)).toEqual({ amber: 2, capture: 0, damage: 1, draw: 0 });
    expect(readBonusIcons({ enhancements: ["capture", "draw", "discard"] }, 0)).toEqual({ amber: 0, capture: 1, damage: 0, draw: 1 });
    expect(readBonusIcons({}, 2)).toBeUndefined();
    expect(readBonusIcons({ enhancements: "damage" }, 0)).toBeUndefined();
  });
});

describe("take control (keyteki game.takeControl)", () => {
  const hypnobeam = () => cardOf("Hypnobeam", "Play: Gain control of an enemy creature.", { house: "Mars" });

  it("moves the creature to the new controller's battleline on its left flank", () => {
    let state = setupTest({ hand: [hypnobeam()], inPlay: [creature("Ally", 3)] }, { inPlay: [creature("Beast", 6), creature("Biter", 2)] });
    state = play(state, 0, "Hypnobeam");
    const beast = board(state, 0, "Beast");
    expect(state.players[1].board.map((item) => item.face.title)).toEqual(["Biter"]);
    expect(state.players[0].board[0]).toBe(beast);
    expect(beast.controlledBy).toBe(0);

    // Neither side may fight a creature it controls.
    const fightMoves = getLegalMoves(state, 0).filter((move) => move.type === "fight");
    expect(fightMoves.every((move) => move.targetId !== beast.instanceId)).toBe(true);
    const enemyAttacks = getLegalMoves(state, 1).filter((move) => move.type === "fight" && move.targetId === beast.instanceId);
    expect(enemyAttacks).toHaveLength(1);

    // The state stays JSON-safe with a taken creature.
    expect(JSON.stringify(JSON.parse(JSON.stringify(state)))).toBe(JSON.stringify(state));
  });

  it("returns the card to its owner when it leaves play", () => {
    let state = setupTest({ hand: [hypnobeam()] }, { inPlay: [creature("Beast", 6)] });
    state = play(state, 0, "Hypnobeam");
    board(state, 0, "Beast").amber = 2;
    state.players[0].hand = [cardOf("Decimation", "Play: Destroy a creature.")];
    state.activeHouse = "Brobnar";
    state = play(state, 0, "Decimation");
    expect(state.players[0].board).toHaveLength(0);
    expect(titles(state.players[1].discard)).toContain("Beast");
    expect(state.players[0].discard.map((item) => item.face.title)).not.toContain("Beast");
    expect(state.players[1].amber).toBe(2); // captured amber to the controller's opponent
    expect(state.players[0].creaturesDestroyed).toBe(0);
  });

  it("credits the kill when a stolen creature dies in a fight (MX-06)", () => {
    let state = setupTest({ hand: [hypnobeam()] }, { inPlay: [creature("Beast", 2), creature("Wall", 9)] });
    state = play(state, 0, "Hypnobeam", board(state, 1, "Beast").instanceId);
    expect(board(state, 0, "Beast")).toBeDefined();
    state.activeHouse = "Brobnar";
    const fought = fight(state, 0, "Beast", "Wall"); // the Beast (2 power) dies to the 9-power Wall
    expect(titles(fought.players[1].discard)).toContain("Beast"); // back in the owner's discard
    expect(fought.players[1].creaturesDestroyed).toBe(1);
  });

  it("sends Gigantic halves under a stolen creature to the owner's discard (MX-07)", () => {
    let state = setupTest({ hand: [hypnobeam()] }, { inPlay: [creature("Colossus", 6)] });
    state.players[1].board[0].under = [creature("Half", 0)];
    state = play(state, 0, "Hypnobeam");
    state.players[0].hand = [cardOf("Decimation", "Play: Destroy a creature.")];
    state.activeHouse = "Brobnar";
    state = play(state, 0, "Decimation");
    expect(titles(state.players[1].discard)).toEqual(expect.arrayContaining(["Colossus", "Half"]));
    expect(state.players[0].discard.map((item) => item.face.title)).not.toContain("Half");
  });

  it("clears the marker when the owner takes the card back", () => {
    const state = setupTest({ hand: [hypnobeam()] }, { hand: [hypnobeam()], inPlay: [creature("Beast", 6)], amber: 0 });
    const taken = play(state, 0, "Hypnobeam");
    expect(board(taken, 0, "Beast").controlledBy).toBe(0);
    // Player 1 takes its own creature back: it is home again, so the marker goes.
    const back = play(taken, 1, "Hypnobeam");
    expect(titles(back.players[0].board)).toEqual([]);
    expect(board(back, 1, "Beast").controlledBy).toBeUndefined();
    back.players[0].hand = [cardOf("Decimation", "Play: Destroy a creature.")];
    back.activeHouse = "Brobnar";
    const destroyed = play(back, 0, "Decimation");
    expect(titles(destroyed.players[1].discard)).toContain("Beast");
  });
});

describe("forging outside the key step (keyteki ForgeAction/UnforgeAction)", () => {
  it("Key Charge: loses 1 amber and may forge at the current cost", () => {
    const keyCharge = cardOf("Key Charge", "Play: Lose 1 amber. If you do, you may forge a key at current cost.", { house: "Untamed" });
    const forge = play(setupTest({ hand: [keyCharge], amber: 7 }), 0, "Key Charge");
    expect(forge.players[0].keys).toBe(1);
    expect(forge.players[0].amber).toBe(0);

    // The "you may" clause has a declined variant: the loss happens, the key does not.
    const declined = play(setupTest({ hand: [keyCharge], amber: 7 }), 0, "Key Charge", undefined, true);
    expect(declined.players[0].keys).toBe(0);
    expect(declined.players[0].amber).toBe(6);
  });

  it("forges at no cost and can win on the third key", () => {
    const free = cardOf("Sample 42-C", "Play: Forge a key at no cost.");
    const next = play(setupTest({ hand: [free], amber: 2, keys: 2 }), 0, "Sample 42-C");
    expect(next.players[0].keys).toBe(3);
    expect(next.players[0].amber).toBe(2);
    expect(next.winner).toBe(0);
  });

  it("pays the printed '+N cost' modifier", () => {
    const plus = cardOf("Dial of Doom", "Play: Forge a key at +2 cost.");
    const state = play(setupTest({ hand: [plus], amber: 8 }), 0, "Dial of Doom");
    expect(state.players[0]).toMatchObject({ keys: 1, amber: 0 });
  });

  it("unforges an opponent's key", () => {
    const breakKey = cardOf("Break Key", "Play: Unforge an opponent's key.");
    const state = play(setupTest({ hand: [breakKey] }, { keys: 2 }), 0, "Break Key");
    expect(state.players[1].keys).toBe(1);
    // With no key to take the act is a no-op, not a crash.
    expect(play(setupTest({ hand: [breakKey] }), 0, "Break Key").players[1].keys).toBe(0);
  });

  it("exports the same key step as forgeKey()", () => {
    const state = setupTest({ amber: 6 });
    expect(forgeKey(state, 0).players[0]).toMatchObject({ keys: 1, amber: 0 });
    expect(state.players[0].amber).toBe(6); // pure: the input stayed untouched
    expect(forgeKey(setupTest({ amber: 6, keys: 3 }), 0).players[0].keys).toBe(3);
  });
});

describe("instead replacements (keyteki DestroyAction/DealDamageAction)", () => {
  it("Shadow Self redirects damage dealt to its neighbors, ward included", () => {
    const shadow = creature("Shadow Self", 4, "Shadow Self deals no damage when fighting.\nDamage dealt to non-Specter neighbors is dealt to Shadow Self instead.", { house: "Shadows" });
    const state = setupTest({ inPlay: [creature("Grunt", 2), shadow] }, { inPlay: [creature("Brute", 6)] });
    board(state, 0, "Grunt").warded = 1;
    const next = fight(state, 1, "Brute", "Grunt");
    expect(board(next, 0, "Grunt").damage).toBe(0);
    expect(board(next, 0, "Grunt").warded).toBe(1); // the redirect ran before the target's ward
    expect(titles(next.players[0].discard)).toEqual(["Shadow Self"]);
  });

  it("Annihilation Ritual purges every creature that would reach a discard pile", () => {
    const ritual = card("Annihilation Ritual", {
      type: "Artifact",
      house: "Dis",
      text: "When a creature would enter a discard pile from play, it is purged instead.",
    });
    const state = setupTest({ inPlay: [ritual, creature("Grunt", 2)] }, { inPlay: [creature("Brute", 3)] });
    const next = fight(state, 1, "Brute", "Grunt");
    expect(titles(next.players[0].purged)).toEqual(["Grunt"]);
    expect(next.players[0].discard).toHaveLength(0);
    expect(next.players[0].creaturesDestroyed).toBe(0);
  });

  it("'If this creature would be destroyed, archive it instead.' skips the discard", () => {
    const automaton = creature("Reassembling Automaton", 3, "If this creature would be destroyed, archive it instead. Destroyed: Gain 3 amber.");
    const state = setupTest({ inPlay: [automaton] }, { inPlay: [creature("Brute", 5)] });
    const next = fight(state, 1, "Brute", "Reassembling Automaton");
    expect(titles(next.players[0].archives)).toEqual(["Reassembling Automaton"]);
    expect(next.players[0].discard).toHaveLength(0);
    expect(next.players[0].amber).toBe(0); // a replaced destruction is not a destruction
  });

  it("the replacement is read off the board, not stored in the save", () => {
    const automaton = creature("Reassembling Automaton", 3, "If this creature would be destroyed, archive it instead.");
    const state = play(setupTest({ inPlay: [automaton], hand: [gateway()] }), 0, "Gateway to Dis");
    expect(state.players[0].archives).toHaveLength(1);
  });
});

describe("deckFromState (MX-05)", () => {
  it("rebuilds the deck without the token creatures in play", () => {
    const hive = cardOf("Hive", "Play: Make a token creature.");
    const state = setupTest({ hand: [hive], inPlay: [creature("Grunt", 3)] });
    const next = play(state, 0, "Hive");
    expect(next.players[0].board.some((item) => item.isToken)).toBe(true);
    const before = deckFromState(state.players[0], "x").cards.length;
    const rebuilt = deckFromState(next.players[0], "x").cards;
    expect(rebuilt).toHaveLength(before);
    expect(rebuilt.some((face) => face.title === "Token Creature")).toBe(false);
  });
});
