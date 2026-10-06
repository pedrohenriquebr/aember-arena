// SPDX-License-Identifier: AGPL-3.0-only
// Lote 11 (DSL_VERSION 11): the mechanics that blocked the owner's decks. Every card is read from its REAL printed
// text (the corpus prints, glyphs and line breaks included), so a parser regression shows up as a parse failure first.
import { afterEach, describe, expect, it } from "vitest";
import { DSL_VERSION, normaliseAbilityOverride, setAbilityOverrides } from "./abilities";
import { PARSER_VERSION, parseCardText } from "./cardText";
import { FEW_SHOTS } from "./catalogLlm";
import { applyMove, chooseHouse, effectivePower, endTurn, getLegalMoves, keyword, type CardFace, type GameState } from "./game";
import { DSL_SCHEMA } from "./generated/dslSchema";
import { card, setupTest } from "./testkit";

afterEach(() => setAbilityOverrides(new Map()));

const T = {
  duskwitch: "Omega. (After you play this card, end this step.)\nElusive. (The first time this creature is attacked each turn, no damage is dealt.)\nFriendly creatures enter play ready.",
  duskwitchOld: "Omega.\rElusive.\rYour creatures enter play ready.",
  retro: "If you are haunted, Retrotechnician Le enters play ready.\nAfter Reap: You may play a creature from your discard pile.\n",
  helper: "Play: You may play one non-Logos card this turn.\r",
  remote: "Play: Use an opponent’s artifact as if it were yours.",
  seismo: "Action: Choose a house. During your opponent’s next turn, creatures of the chosen house cannot be used to reap.",
  seismoOld: "Action: Choose a house. Creatures of the chosen house cannot reap during your opponent’s next turn.",
  tantadlin: "Tantadlin only deals 2 when fighting.\rFight: Discard a random card from your opponent’s archives.",
  lollop: "Lollop the Titanic deals no damage when attacked.\r",
  zyx: "Play: Archive the top card of your deck or the top card of your discard pile.\r",
  jaga: "Skirmish. (When you use this creature to fight, it is dealt no damage in return.)\nCreatures to the left of Panpaca, Jaga in the battleline gain skirmish.\n",
  anga: "Creatures to the right of Panpaca, Anga in the battleline get +2 power.\n",
  beam: "Enhance .\nPlay: Reveal a random card from your opponent’s hand. Put that card on the bottom of their deck.\n",
  survey: "Enhance R. (These icons have already been added to cards in your deck.)\r\nPlay: Look at the top 2 cards of your deck. Discard 1 of them.﻿﻿",
  firstBlood: "Alpha. (You can only play this card before doing anything else this step.)\rPlay: Deal 2 for each friendly Brobnar creature. You may divide this damage among any number of creatures.",
  warchest: "Action: Gain 1 for each enemy creature that was destroyed in a fight this turn.",
  rig: "This creature gains, “At the end of your turn, this creature loses a +1 power counter.”\rPlay: Fully heal this creature and give it a +1 power counter for each damage healed.",
  redeem: "Omega.\nPlay: Destroy each creature. You may forge a key at +6 current cost, reduced by 1 for each Mutant creature destroyed this way. Purge Redeem the Crucible.\n",
  animating: "This upgrade enters play attached to an artifact instead of a creature. \nPlay: Take control of this artifact and put it on a flank of your battleline as a creature with 4 power and versatile.\nScrap: Gain 1.\n",
};

const face = (title: string, text: string, type = "Creature", house = "Brobnar"): CardFace => ({ id: title, title, house, type, image: "", text, amber: 0, power: 2, armor: 0 });
const row = (dsl: unknown[], extra: object = {}) => ({ cardId: "c", dsl, textHash: "h", source: "manual" as const, v: DSL_VERSION, ...extra });
const parse = (title: string, text: string, type = "Creature", house = "Brobnar") => parseCardText(face(title, text, type, house));
const foe = (title: string, extra: Partial<CardFace> = {}) => card(title, { type: "Creature", house: "Dis", power: 20, ...extra });
const legal = (state: GameState, side: 0 | 1 = 0) => getLegalMoves(state, side, side === state.activePlayer ? state.activeHouse : null);

/** Hands the turn over and lets the other side pick its house. */
function passTo(state: GameState, house: string): GameState {
  const over = endTurn(state, state.activePlayer);
  // The demo decks own other houses: the spec names the house it wants, so the side must be able to pick it.
  over.players[over.activePlayer].houses = [...over.players[over.activePlayer].houses, house];
  return chooseHouse(over, over.activePlayer, house);
}

describe("contract", () => {
  it("bumps both versions, the prompt schema carries every new field and each mechanic has a few-shot", () => {
    expect(DSL_VERSION).toBe(14);
    expect(PARSER_VERSION).toBe(16);
    for (const needle of ['k: "reveal"', "fightDamageCap?: number", "entersPlayReady?: true", "mayPlay?: true | number", "leftOf?: boolean", "divide?: true", "asYours?: true", '"healed"', "slain: Filter", '"reap"', 'when?: "attacking" | "defending"', '"revealed"']) {
      expect(DSL_SCHEMA).toContain(needle);
    }
    const shots = FEW_SHOTS.map((shot) => shot.text);
    for (const fragment of ["enter play ready", "non-Logos card this turn", "cannot be used to reap", "only deals 2", "deals no damage when attacked", "to the right of", "Reveal a random card", "divide this damage", "as if it were yours", "destroyed in a fight this turn", "for each damage healed"]) {
      expect(shots.some((text) => text.includes(fragment))).toBe(true);
    }
  });
});

describe("parser: every owner card reads as full coverage", () => {
  it.each([
    ["Duskwitch", T.duskwitch, "Creature", "Mars"],
    ["Duskwitch", T.duskwitchOld, "Creature", "Untamed"],
    ["Helper Bot", T.helper, "Creature", "Logos"],
    ["Remote Access", T.remote, "Action", "Logos"],
    ["Seismo-entangler", T.seismo, "Artifact", "Logos"],
    ["Seismo-entangler", T.seismoOld, "Artifact", "Logos"],
    ["Lollop the Titanic", T.lollop, "Creature", "Brobnar"],
    ["Z.Y.X. Researcher", T.zyx, "Creature", "Logos"],
    ["Panpaca, Jaga", T.jaga, "Creature", "Untamed"],
    ["Panpaca, Anga", T.anga, "Creature", "Untamed"],
    ["Beam of Forgetting", T.beam, "Action", "Unfathomable"],
    ["Survey", T.survey, "Action", "Star Alliance"],
    ["First Blood", T.firstBlood, "Action", "Brobnar"],
    ["The Warchest", T.warchest, "Artifact", "Brobnar"],
    ["Cybergiant Rig", T.rig, "Upgrade", "Brobnar"],
    ["Redeem the Crucible", T.redeem, "Action", "Redemption"],
  ])("%s", (title, text, type, house) => {
    expect(parse(title, text, type, house).coverage).toBe("full");
  });

  it("Tantadlin and Retrotechnician Le keep the mechanic of this lote and stay partial for the sentence outside it", () => {
    // Tantadlin's Fight: line is in scope too: it is the archives discard, now a zone of `move`.
    const tantadlin = parse("Tantadlin", T.tantadlin, "Creature", "Untamed");
    expect(tantadlin.coverage).toBe("full");
    expect(tantadlin.effects).toEqual([{ target: { self: true }, fightDamageCap: 2 }]);
    expect(tantadlin.abilities[0].acts).toEqual([{ k: "move", n: 1, from: "archives", to: "discard", opp: true, pick: "random" }]);
    const retro = parse("Retrotechnician Le", T.retro, "Creature", "Star Alliance");
    expect(retro.effects).toEqual([{ target: { self: true }, entersPlayReady: true, if: { k: "count", of: { p: "discard" }, op: "gte", n: 10 } }]);
    // "play a creature from your discard pile" is another mechanic (a play out of a zone): the card is honest about it.
    expect(retro.coverage).toBe("partial");
  });

  it("Animating Force stays unsupported (turning an artifact into a creature is cut)", () => {
    expect(parse("Animating Force", T.animating, "Upgrade", "Geistoid").coverage).not.toBe("full");
  });

  it("the shapes the engine reads", () => {
    expect(parse("Duskwitch", T.duskwitch, "Creature", "Mars").effects).toEqual([{ target: { type: "Creature", side: "friendly" }, entersPlayReady: true }]);
    expect(parse("Helper Bot", T.helper, "Creature", "Logos").abilities[0].acts).toEqual([{ k: "lasting", e: { target: { house: "!Logos" }, mayPlay: 1, duration: "turn" }, optional: true }]);
    expect(parse("Remote Access", T.remote, "Action", "Logos").abilities[0]).toMatchObject({ target: { type: "Artifact", side: "enemy", ready: true }, acts: [{ k: "use", s: "target", asYours: true }] });
    expect(parse("Lollop the Titanic", T.lollop).effects).toEqual([{ target: { self: true }, replace: { on: "damage", prevent: true, when: "defending" } }]);
    expect(parse("Panpaca, Anga", T.anga).effects).toEqual([{ target: { type: "Creature", rightOf: true }, power: 2 }]);
    expect(parse("Panpaca, Jaga", T.jaga).effects).toContainEqual({ target: { type: "Creature", leftOf: true }, keywords: { skirmish: 1 } });
    expect(parse("The Warchest", T.warchest, "Artifact").abilities[0].acts).toEqual([{ k: "gainAmber", n: 1, per: { slain: { type: "Creature", side: "enemy" } } }]);
    expect(parse("Cybergiant Rig", T.rig, "Upgrade").abilities[0].acts).toEqual([{ k: "heal", s: "host" }, { k: "counter", n: 1, s: "host", per: "healed" }]);
  });

  it("Seismo-entangler binds only the opponent (their next turn), never the creatures its own side still has to use", () => {
    const acts = parse("Seismo-entangler", T.seismo, "Artifact", "Logos").abilities[0].acts;
    expect(acts).toEqual([{ k: "lasting", e: { target: { type: "Creature", house: "chosen" }, restrict: { who: "opponent", action: "reap" }, duration: "next" } }]);
  });

  it("a constant 'cannot reap' without a duration binds both sides; a friendly one only the owner", () => {
    expect(parse("Gizmo", "Mars creatures cannot reap.", "Artifact", "Mars").effects.map((effect) => effect.restrict?.who)).toEqual(["you", "opponent"]);
    expect(parse("Gizmo", "Friendly creatures cannot reap.", "Artifact", "Mars").effects.map((effect) => effect.restrict?.who)).toEqual(["you"]);
  });

  it("'put that card' / 'discard that card' without a reveal before it is not representable", () => {
    expect(parse("X", "Play: Gain 1 amber. Put that card on the bottom of their deck.", "Action").coverage).not.toBe("full");
    expect(parse("X", "Play: Discard that card.", "Action").coverage).not.toBe("full");
  });
});

describe("shape gate", () => {
  const e = (effect: object) => row([], { effects: [{ target: {}, ...effect }] });
  it("a numbered mayPlay is only valid inside a lasting act (a constant one would never be spent)", () => {
    expect(normaliseAbilityOverride(row([], { effects: [{ target: {}, mayPlay: 1 }] }))).toBeNull();
  });
  it("accepts the new literals", () => {
    for (const effect of [
      { entersPlayReady: true },
      { mayPlay: true, target: { house: "!Logos" } },
      { fightDamageCap: 0 },
      { fightDamageCap: 2 },
      { replace: { on: "damage", prevent: true, when: "attacking" } },
      { restrict: { who: "opponent", action: "reap" }, target: { type: "Creature", house: "Mars" } },
      { target: { type: "Creature", leftOf: true }, keywords: { skirmish: 1 } },
    ]) {
      expect(normaliseAbilityOverride(e(effect))?.v).toBe(14);
    }
    for (const act of [
      { k: "reveal", from: "hand", opp: true, pick: "random" },
      { k: "reveal", from: "deck", n: 2 },
      { k: "move", n: 1, from: "hand", to: "deck", pick: "revealed", opp: true, at: "bottom" },
      { k: "damage", n: 2, s: { pick: { type: "Creature" }, n: 99, upTo: true }, divide: true, per: { c: { type: "Creature", side: "friendly" } } },
      { k: "use", s: "target", asYours: true },
      { k: "gainAmber", n: 1, per: { slain: { type: "Creature", side: "enemy" } } },
      { k: "counter", n: 1, s: "self", per: "healed" },
    ]) {
      expect(normaliseAbilityOverride(row([{ on: ["action"], target: { type: "Artifact" }, acts: [act] }]))?.v).toBe(14);
    }
  });

  it("rejects what the engine would misread", () => {
    for (const effect of [
      { entersPlayReady: false },
      { mayPlay: 0 },
      { mayPlay: 1.5 },
      { mayPlay: "yes" },
      { fightDamageCap: -1 },
      { fightDamageCap: 2.5 },
      { replace: { on: "damage", when: "attacking" } },
      { replace: { on: "damage", prevent: true, when: "sideways" } },
      { replace: { on: "destroy", prevent: true, when: "defending" } },
      { replace: { on: "damage", prevent: true, when: "defending", redirect: true } },
      { restrict: { who: "opponent", action: "reaps" } },
      { target: { leftOf: "yes", nope: true } },
    ]) {
      expect(normaliseAbilityOverride(e(effect))).toBeNull();
    }
    for (const act of [
      { k: "reveal", from: "discard" },
      { k: "reveal", from: "hand", pick: "bottom" },
      { k: "reveal", from: "hand", s: "self" },
      { k: "damage", n: 2, s: "self", divide: false },
      { k: "heal", n: 2, s: "self", divide: true },
      { k: "gainAmber", n: 1, asYours: true },
      { k: "use", s: "target", asYours: false },
      { k: "gainAmber", n: 1, per: { slain: { nope: true } } },
      { k: "gainAmber", n: 1, per: "healing" },
    ]) {
      expect(normaliseAbilityOverride(row([{ on: ["play"], target: { type: "Creature" }, acts: [act] }]))).toBeNull();
    }
    // a lasting mayPlay / cap is read by the same gate
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "lasting", e: { target: {}, mayPlay: 0, duration: "turn" } }] }]))).toBeNull();
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "lasting", e: { target: {}, mayPlay: 1, duration: "turn" } }] }]))?.v).toBe(14);
  });
});

// ---------- A: enters play ready ----------
describe("A: enters play ready", () => {
  const dusk = (house = "Mars") => card("Duskwitch", { type: "Creature", house, text: T.duskwitch, power: 1 });
  const grunt = (title = "Grunt") => card(title, { type: "Creature", house: "Mars", power: 3 });

  it("Duskwitch readies itself and the friendly creatures that come in after it; Omega ends the step", () => {
    const witch = dusk();
    const next = applyMove(setupTest({ hand: [witch] }, {}, "Mars"), 0, { type: "play", instanceId: witch.instanceId });
    expect(next.players[0].board[0].ready).toBe(true);
    expect(next.omega).toBe(true);
    const mate = grunt();
    const state = setupTest({ hand: [mate], inPlay: [dusk()] }, {}, "Mars");
    expect(applyMove(state, 0, { type: "play", instanceId: mate.instanceId }).players[0].board.find((item) => item.instanceId === mate.instanceId)?.ready).toBe(true);
  });

  it("without it a creature enters exhausted, and an ENEMY Duskwitch does not help", () => {
    const mate = grunt();
    const plain = setupTest({ hand: [mate] }, {}, "Mars");
    expect(applyMove(plain, 0, { type: "play", instanceId: mate.instanceId }).players[0].board[0].ready).toBe(false);
    const enemy = setupTest({ hand: [mate] }, { inPlay: [dusk()] }, "Mars");
    expect(applyMove(enemy, 0, { type: "play", instanceId: mate.instanceId }).players[0].board[0].ready).toBe(false);
  });

  it("Retrotechnician Le enters ready only while haunted (10+ cards in the discard pile) — itself, not the others", () => {
    const le = () => card("Retrotechnician Le", { type: "Creature", house: "Star Alliance", text: T.retro, power: 2 });
    const pile = () => Array.from({ length: 10 }, (_, index) => card(`Junk${index}`));
    const [a, b, other] = [le(), le(), grunt()];
    const haunted = setupTest({ hand: [a, other], discard: pile() }, {}, "Star Alliance");
    other.face = { ...other.face, house: "Star Alliance" };
    const played = applyMove(haunted, 0, { type: "play", instanceId: a.instanceId });
    expect(played.players[0].board.find((item) => item.instanceId === a.instanceId)?.ready).toBe(true);
    const next = applyMove(played, 0, { type: "play", instanceId: other.instanceId });
    expect(next.players[0].board.find((item) => item.instanceId === other.instanceId)?.ready).toBe(false);
    const quiet = setupTest({ hand: [b] }, {}, "Star Alliance");
    expect(applyMove(quiet, 0, { type: "play", instanceId: b.instanceId }).players[0].board[0].ready).toBe(false);
  });

  it("a token made while Duskwitch is in play is born ready", () => {
    const maker = card("Maker", { type: "Action", house: "Mars", text: "Play: Make a token creature." });
    const state = setupTest({ hand: [maker], inPlay: [dusk()] }, {}, "Mars");
    const token = applyMove(state, 0, { type: "play", instanceId: maker.instanceId }).players[0].board.find((item) => item.isToken);
    expect(token?.ready).toBe(true);
  });
});

// ---------- B: may play / as if it were yours ----------
describe("B: mayPlay and 'as if it were yours'", () => {
  const bot = () => card("Helper Bot", { type: "Creature", house: "Logos", text: T.helper, power: 1 });
  const mars = (title: string) => card(title, { type: "Creature", house: "Mars", power: 2 });

  it("Helper Bot opens the PLAY of ONE non-Logos card, never a discard, and the permission is spent", () => {
    const [helper, one, two] = [bot(), mars("One"), mars("Two")];
    const state = setupTest({ hand: [helper, one, two] }, {}, "Logos");
    expect(legal(state).some((move) => move.type === "play" && move.instanceId === one.instanceId)).toBe(false);
    const next = applyMove(state, 0, { type: "play", instanceId: helper.instanceId });
    const moves = legal(next);
    expect(moves.some((move) => move.type === "play" && move.instanceId === one.instanceId)).toBe(true);
    expect(moves.some((move) => move.type === "discard" && move.instanceId === one.instanceId)).toBe(false);
    const after = applyMove(next, 0, { type: "play", instanceId: one.instanceId });
    expect(after.players[0].board.map((item) => item.face.title)).toContain("One");
    expect(legal(after).some((move) => move.type === "play" && move.instanceId === two.instanceId)).toBe(false);
    expect(after.lasting ?? []).toHaveLength(0);
  });

  it("an in-house play does not spend the permission, and the permission ends with the turn", () => {
    const [helper, one, home] = [bot(), mars("One"), card("Home", { type: "Creature", house: "Logos", power: 1 })];
    const next = applyMove(setupTest({ hand: [helper, one, home] }, {}, "Logos"), 0, { type: "play", instanceId: helper.instanceId });
    const afterHome = applyMove(next, 0, { type: "play", instanceId: home.instanceId });
    expect(legal(afterHome).some((move) => move.type === "play" && move.instanceId === one.instanceId)).toBe(true);
    const later = passTo(passTo(afterHome, "Mars"), "Logos");
    expect(later.lasting ?? []).toHaveLength(0);
  });

  it("declining the 'you may' keeps the house rule", () => {
    const [helper, one] = [bot(), mars("One")];
    const next = applyMove(setupTest({ hand: [helper, one] }, {}, "Logos"), 0, { type: "play", instanceId: helper.instanceId, decline: true });
    expect(legal(next).some((move) => move.type === "play" && move.instanceId === one.instanceId)).toBe(false);
  });

  it("Remote Access resolves an enemy artifact's Action FOR the actor: their amber, the artifact exhausted", () => {
    const remote = card("Remote Access", { type: "Action", house: "Logos", text: T.remote });
    const bank = card("Bank", { type: "Artifact", house: "Dis", text: "Action: Gain 2 amber." });
    const next = applyMove(setupTest({ hand: [remote] }, { inPlay: [bank] }, "Logos"), 0, { type: "play", instanceId: remote.instanceId });
    expect(next.players[0].amber).toBe(2);
    expect(next.players[1].amber).toBe(0);
    expect(next.players[1].board[0].ready).toBe(false);
  });

  it("Remote Access has no effect (and is pruned) with no ready enemy artifact; its own artifacts are not targets", () => {
    const remote = card("Remote Access", { type: "Action", house: "Logos", text: T.remote });
    const mine = card("Mine", { type: "Artifact", house: "Logos", text: "Action: Gain 2 amber." });
    const spent = card("Spent", { type: "Artifact", house: "Dis", text: "Action: Gain 2 amber." }, false);
    const next = applyMove(setupTest({ hand: [remote], inPlay: [mine] }, { inPlay: [spent] }, "Logos"), 0, { type: "play", instanceId: remote.instanceId });
    expect(next.players[0].amber).toBe(0);
    expect(next.players[0].board[0].ready).toBe(true);
  });

  it("an Omni artifact is used through its Omni", () => {
    const remote = card("Remote Access", { type: "Action", house: "Logos", text: T.remote });
    const omni = card("Omni Thing", { type: "Artifact", house: "Dis", text: "Omni: Gain 1 amber." });
    const next = applyMove(setupTest({ hand: [remote] }, { inPlay: [omni] }, "Logos"), 0, { type: "play", instanceId: remote.instanceId });
    expect(next.players[0].amber).toBe(1);
  });
});

// ---------- C: restrict reap ----------
describe("C: cannot be used to reap", () => {
  const seismo = () => card("Seismo-entangler", { type: "Artifact", house: "Logos", text: T.seismo, power: 0 });

  it("only the chosen house's creatures lose the reap, only during the opponent's next turn", () => {
    const device = seismo();
    const [marsOne, disOne] = [card("MarsGuy", { type: "Creature", house: "Mars", power: 3 }), card("DisGuy", { type: "Creature", house: "Dis", power: 3 })];
    const mine = card("Mine", { type: "Creature", house: "Mars", power: 3 });
    const state = setupTest({ inPlay: [device, mine] }, { inPlay: [marsOne, disOne] }, "Logos");
    const used = applyMove(state, 0, { type: "use", instanceId: device.instanceId, house: "Mars" });
    expect(used.lasting).toHaveLength(1);
    const reaps = (game: GameState, id: string) => legal(game, game.activePlayer).some((move) => move.type === "reap" && move.instanceId === id);
    expect(reaps(passTo(used, "Mars"), marsOne.instanceId)).toBe(false);
    expect(reaps(passTo(used, "Dis"), disOne.instanceId)).toBe(true);
    // my own Mars creature is not bound: the lasting only runs against the opponent
    const mineTurn = { ...used, activeHouse: "Mars", activePlayer: 0 as const };
    expect(reaps(mineTurn, mine.instanceId)).toBe(true);
    // two turn changes later (theirs, then mine) the lasting copy is gone
    const back = passTo(passTo(used, "Dis"), "Logos");
    expect(back.lasting ?? []).toHaveLength(0);
  });

  it("a bound creature can still fight, and a non-reap restrict never reads the filter", () => {
    const device = seismo();
    const marsOne = card("MarsGuy", { type: "Creature", house: "Mars", power: 3 });
    const victim = card("Victim", { type: "Creature", house: "Logos", power: 3 });
    const used = applyMove(setupTest({ inPlay: [device, victim] }, { inPlay: [marsOne] }, "Logos"), 0, { type: "use", instanceId: device.instanceId, house: "Mars" });
    const moves = legal(passTo(used, "Mars"), 1);
    expect(moves.some((move) => move.type === "fight" && move.attackerId === marsOne.instanceId)).toBe(true);
    expect(moves.some((move) => move.type === "reap" && move.instanceId === marsOne.instanceId)).toBe(false);
  });

  it("'use via reap' (Ready and reap) is refused to a bound creature too", () => {
    const device = seismo();
    const bound = card("Bound", { type: "Creature", house: "Mars", power: 3 });
    const pusher = card("Pusher", { type: "Creature", house: "Dis", power: 3, text: "Play: Ready and reap with a friendly creature." });
    const used = applyMove(setupTest({ inPlay: [device] }, { inPlay: [bound], hand: [pusher] }, "Logos"), 0, { type: "use", instanceId: device.instanceId, house: "Mars" });
    const theirs = passTo(used, "Dis");
    theirs.players[1].board[0].ready = false;
    const after = applyMove(theirs, 1, { type: "play", instanceId: pusher.instanceId, target: bound.instanceId });
    expect(after.players[1].amber).toBe(theirs.players[1].amber);
  });
});

// ---------- D: fight cap and retaliation ----------
describe("D: fight damage cap and 'deals no damage when attacked'", () => {
  const tantadlin = () => card("Tantadlin", { type: "Creature", house: "Untamed", text: T.tantadlin, power: 9 });
  const lollop = () => card("Lollop the Titanic", { type: "Creature", house: "Brobnar", text: T.lollop, power: 11 });

  it("Tantadlin deals only 2 when it attacks", () => {
    const attacker = tantadlin();
    const target = foe("Wall", { power: 8 });
    const next = applyMove(setupTest({ inPlay: [attacker] }, { inPlay: [target] }, "Untamed"), 0, { type: "fight", attackerId: attacker.instanceId, targetId: target.instanceId });
    expect(next.players[1].board[0].damage).toBe(2);
    expect(next.players[0].board[0].damage).toBe(8);
  });

  it("the cap holds in both roles: defending, Tantadlin (9) deals only 2 and a power-5 attacker survives", () => {
    const wall = tantadlin();
    const attacker = card("Raider", { type: "Creature", house: "Dis", power: 5 });
    const state = setupTest({ inPlay: [wall] }, { inPlay: [attacker] }, "Untamed");
    const theirs = passTo(state, "Dis");
    const next = applyMove(theirs, 1, { type: "fight", attackerId: attacker.instanceId, targetId: wall.instanceId });
    const hit = next.players[1].board.find((item) => item.instanceId === attacker.instanceId);
    expect(hit?.damage).toBe(2);
  });

  it("the cap applies after an attack bonus and never raises a smaller hit", () => {
    const small = card("Small", { type: "Creature", house: "Untamed", text: "Small only deals 5 damage when fighting.", power: 3 });
    const target = foe("Wall", { power: 20 });
    const next = applyMove(setupTest({ inPlay: [small] }, { inPlay: [target] }, "Untamed"), 0, { type: "fight", attackerId: small.instanceId, targetId: target.instanceId });
    expect(next.players[1].board[0].damage).toBe(3);
  });

  it("Lollop attacked: the attacker takes NOTHING back, but Lollop itself is not immune", () => {
    const wall = lollop();
    const attacker = card("Raider", { type: "Creature", house: "Dis", power: 5 });
    const theirs = passTo(setupTest({ inPlay: [wall] }, { inPlay: [attacker] }, "Brobnar"), "Dis");
    const next = applyMove(theirs, 1, { type: "fight", attackerId: attacker.instanceId, targetId: wall.instanceId });
    expect(next.players[1].board.find((item) => item.instanceId === attacker.instanceId)?.damage).toBe(0);
    expect(next.players[0].board.find((item) => item.instanceId === wall.instanceId)?.damage).toBe(5);
  });

  it("Lollop attacking still hits for 11 and still takes the retaliation", () => {
    const attacker = lollop();
    const target = foe("Wall", { power: 15 });
    const next = applyMove(setupTest({ inPlay: [attacker] }, { inPlay: [target] }, "Brobnar"), 0, { type: "fight", attackerId: attacker.instanceId, targetId: target.instanceId });
    expect(next.players[1].board[0].damage).toBe(11);
    // the 15 coming back kills the 11-power Lollop: it deals no damage only when ATTACKED
    expect(next.players[0].discard.map((item) => item.face.title)).toContain("Lollop the Titanic");
  });

  it("'deals no damage when attacked' is not 'cannot be dealt damage' (the replacement is scoped by `when`)", () => {
    const wall = lollop();
    const state = setupTest({ inPlay: [wall] }, { inPlay: [card("Pinger", { type: "Creature", house: "Dis", power: 3 })] }, "Brobnar");
    const hit = card("Zap", { type: "Action", house: "Brobnar", text: "Play: Deal 3 damage to a creature." });
    state.players[0].hand = [hit];
    const next = applyMove(state, 0, { type: "play", instanceId: hit.instanceId, target: wall.instanceId });
    expect(next.players[0].board[0].damage).toBe(3);
  });

  it("a Gabos redirect finds nothing to move when the dealer deals no damage", () => {
    const gabos = card("Gabos", { type: "Creature", house: "Brobnar", power: 6, text: "Before Fight: Choose a creature. ~ deals damage to that creature rather than the one it is fighting." });
    const wall = lollop();
    const bystander = foe("Bystander", { power: 20 });
    const state = setupTest({ inPlay: [gabos] }, { inPlay: [wall, bystander] }, "Brobnar");
    const next = applyMove(state, 0, { type: "fight", attackerId: gabos.instanceId, targetId: wall.instanceId, target: bystander.instanceId });
    expect(next.players[1].board.find((item) => item.instanceId === bystander.instanceId)?.damage).toBe(6);
    expect(next.players[1].board.find((item) => item.instanceId === wall.instanceId)?.damage).toBe(0);
    expect(next.players[0].board[0].damage).toBe(0);
  });
});

// ---------- E: contextual counts ----------
describe("E: slain this turn, healed damage", () => {
  const chest = () => card("The Warchest", { type: "Artifact", house: "Brobnar", text: T.warchest, power: 0 });
  const brute = (power = 10) => card("Brute", { type: "Creature", house: "Brobnar", power });

  it("counts the enemy creatures that died in a fight this turn", () => {
    const [attacker, weak, weak2] = [brute(), foe("Weak", { power: 2 }), foe("Weak2", { power: 2 })];
    let state = setupTest({ inPlay: [chest(), attacker, brute()] }, { inPlay: [weak, weak2] }, "Brobnar");
    state = applyMove(state, 0, { type: "fight", attackerId: attacker.instanceId, targetId: weak.instanceId });
    const second = state.players[0].board.find((item) => item.face.title === "Brute" && item.ready)!;
    state = applyMove(state, 0, { type: "fight", attackerId: second.instanceId, targetId: weak2.instanceId });
    expect(state.fightDeaths).toHaveLength(2);
    const next = applyMove(state, 0, { type: "use", instanceId: state.players[0].board[0].instanceId });
    expect(next.players[0].amber).toBe(2);
  });

  it("a creature destroyed in a fight that returns to hand instead still counts as slain", () => {
    const [attacker, weak] = [brute(), foe("Weak", { power: 2, text: "If this creature would be destroyed, return it to your hand instead." })];
    const state = setupTest({ inPlay: [chest(), attacker] }, { inPlay: [weak] }, "Brobnar");
    const next = applyMove(state, 0, { type: "fight", attackerId: attacker.instanceId, targetId: weak.instanceId });
    expect(next.players[1].hand.some((item) => item.instanceId === weak.instanceId)).toBe(true);
    expect(next.fightDeaths).toHaveLength(1);
  });

  it("does not count my own dead, a kill by a spell, or yesterday's fight", () => {
    const [weak, wall, victim] = [brute(1), foe("Wall", { power: 20 }), foe("Victim", { power: 2 })];
    let state = setupTest({ inPlay: [chest(), weak] }, { inPlay: [wall, victim] }, "Brobnar");
    state = applyMove(state, 0, { type: "fight", attackerId: weak.instanceId, targetId: wall.instanceId });
    expect(state.fightDeaths).toHaveLength(1);
    const zap = card("Zap", { type: "Action", house: "Brobnar", text: "Play: Destroy a creature." });
    state.players[0].hand = [zap];
    state = applyMove(state, 0, { type: "play", instanceId: zap.instanceId, target: victim.instanceId });
    expect(applyMove(state, 0, { type: "use", instanceId: state.players[0].board[0].instanceId }).players[0].amber).toBe(0);
    expect(endTurn(state, 0).fightDeaths).toBeUndefined();
  });

  it("the snapshots are plain JSON and the filter is matched against the dead (type, trait, house)", () => {
    const [attacker, weak] = [brute(), foe("Weak", { power: 2, traits: "Mutant" })];
    const chestOfMutants = card("Mutant Chest", { type: "Artifact", house: "Brobnar", text: "Action: Gain 1<A> for each Mutant creature that was destroyed in a fight this turn." });
    let state = setupTest({ inPlay: [chestOfMutants, attacker] }, { inPlay: [weak] }, "Brobnar");
    state = applyMove(state, 0, { type: "fight", attackerId: attacker.instanceId, targetId: weak.instanceId });
    expect(JSON.parse(JSON.stringify(state.fightDeaths))).toEqual(state.fightDeaths);
    expect(applyMove(state, 0, { type: "use", instanceId: chestOfMutants.instanceId }).players[0].amber).toBe(1);
  });

  it("Cybergiant Rig fully heals the host and leaves one +1 counter per damage healed", () => {
    const host = card("Host", { type: "Creature", house: "Brobnar", power: 10 });
    host.damage = 4;
    const rig = card("Cybergiant Rig", { type: "Upgrade", house: "Brobnar", text: T.rig, power: 0 });
    const next = applyMove(setupTest({ hand: [rig], inPlay: [host] }, {}, "Brobnar"), 0, { type: "play", instanceId: rig.instanceId, target: host.instanceId });
    const healed = next.players[0].board.find((item) => item.instanceId === host.instanceId)!;
    expect(healed.damage).toBe(0);
    expect(healed.counters).toBe(4);
    expect(effectivePower(next, healed)).toBe(14);
  });

  it("heals nothing, gives nothing; and the counters wear off one per turn end", () => {
    const host = card("Host", { type: "Creature", house: "Brobnar", power: 10 });
    const rig = card("Cybergiant Rig", { type: "Upgrade", house: "Brobnar", text: T.rig, power: 0 });
    const clean = applyMove(setupTest({ hand: [rig], inPlay: [host] }, {}, "Brobnar"), 0, { type: "play", instanceId: rig.instanceId, target: host.instanceId });
    expect(clean.players[0].board.find((item) => item.instanceId === host.instanceId)?.counters).toBeUndefined();
    const hurt = card("Hurt", { type: "Creature", house: "Brobnar", power: 10 });
    hurt.damage = 3;
    const rig2 = card("Cybergiant Rig", { type: "Upgrade", house: "Brobnar", text: T.rig, power: 0 });
    const played = applyMove(setupTest({ hand: [rig2], inPlay: [hurt] }, {}, "Brobnar"), 0, { type: "play", instanceId: rig2.instanceId, target: hurt.instanceId });
    const over = endTurn(played, 0);
    expect(over.players[0].board.find((item) => item.instanceId === hurt.instanceId)?.counters).toBe(2);
  });

  it("a quoted grant on an upgrade runs on the creature that receives it (\"this creature\" is the source, not the upgrade)", () => {
    const spirit = card("Wild Spirit", { type: "Upgrade", house: "Untamed", text: "This creature gains, “Reap: Capture 1.”", power: 0 });
    const host = card("Host", { type: "Creature", house: "Untamed", power: 3 });
    const state = setupTest({ hand: [spirit], inPlay: [host] }, { }, "Untamed");
    state.players[1].amber = 3;
    const attached = applyMove(state, 0, { type: "play", instanceId: spirit.instanceId, target: host.instanceId });
    const reaped = applyMove(attached, 0, { type: "reap", instanceId: host.instanceId });
    expect(reaped.players[0].board.find((item) => item.instanceId === host.instanceId)?.amber).toBe(1);
  });

  it("'Keys cost +N during your opponent's next turn' is still the keyCost ACT (opponent only), not a lasting effect on both sides", () => {
    const rules = parse("Lash of Broken Dreams", "Action: Keys cost +3 during your opponent’s next turn.", "Artifact", "Dis");
    expect(rules.abilities[0].acts).toEqual([{ k: "keyCost", n: 3, opp: true }]);
  });

  it("`did` still counts CARDS: 'for each creature healed this way' is untouched", () => {
    const [a, b] = [brute(), brute()];
    a.damage = 5;
    b.damage = 2;
    const salve = card("Salve", { type: "Action", house: "Brobnar", text: "Play: Heal 5 damage from each friendly creature. Gain 1 amber for each creature healed this way." });
    const next = applyMove(setupTest({ hand: [salve], inPlay: [a, b] }, {}, "Brobnar"), 0, { type: "play", instanceId: salve.instanceId });
    expect(next.players[0].amber).toBe(2);
  });
});

// ---------- F: divided damage ----------
describe("F: divide this damage (First Blood)", () => {
  const blood = () => card("First Blood", { type: "Action", house: "Brobnar", text: T.firstBlood });
  const brobnar = (title: string) => card(title, { type: "Creature", house: "Brobnar", power: 3 });

  it("the engine's allocation kills what the pool can pay for (cheapest first) and dumps the rest on the strongest survivor", () => {
    const [a, b, c] = [foe("A", { power: 2 }), foe("B", { power: 3 }), foe("C", { power: 10 })];
    const first = blood();
    const next = applyMove(setupTest({ hand: [first], inPlay: [brobnar("X"), brobnar("Y"), brobnar("Z")] }, { inPlay: [a, b, c] }, "Brobnar"), 0, { type: "play", instanceId: first.instanceId });
    expect(next.players[1].board.map((item) => item.face.title)).toEqual(["C"]);
    expect(next.players[1].board[0].damage).toBe(1);
  });

  it("never aims the free allocation at its own creatures", () => {
    const first = blood();
    const mine = brobnar("Solo");
    const next = applyMove(setupTest({ hand: [first], inPlay: [mine] }, {}, "Brobnar"), 0, { type: "play", instanceId: first.instanceId });
    expect(next.players[0].board[0].damage).toBe(0);
  });

  it("the player's queue splits the pool evenly, the first creature takes the remainder", () => {
    const [a, b] = [foe("A", { power: 20 }), foe("B", { power: 20 })];
    const first = blood();
    const state = setupTest({ hand: [first], inPlay: [brobnar("X"), brobnar("Y"), brobnar("Z"), brobnar("W")] }, { inPlay: [a, b] }, "Brobnar");
    // pool 8, two creatures: 4 each
    const even = applyMove(state, 0, { type: "play", instanceId: first.instanceId, targets: [a.instanceId, b.instanceId] });
    expect(even.players[1].board.map((item) => item.damage)).toEqual([4, 4]);
    // one creature takes it all
    const all = applyMove(state, 0, { type: "play", instanceId: first.instanceId, targets: [b.instanceId] });
    expect(all.players[1].board.map((item) => item.damage)).toEqual([0, 8]);
  });

  it("a queue with an illegal id falls back to the engine's allocation", () => {
    const a = foe("A", { power: 2 });
    const first = blood();
    const next = applyMove(setupTest({ hand: [first], inPlay: [brobnar("X")] }, { inPlay: [a] }, "Brobnar"), 0, { type: "play", instanceId: first.instanceId, targets: ["nope"] });
    expect(next.players[1].board).toHaveLength(0);
  });

  it("the AI is never offered an even split over every enemy (no queue variants for a divided pool)", () => {
    const first = blood();
    const state = setupTest({ hand: [first], inPlay: [brobnar("X")] }, { inPlay: [foe("A"), foe("B")] }, "Brobnar");
    const plays = legal(state).filter((move) => move.type === "play");
    expect(plays.every((move) => move.targets === undefined)).toBe(true);
  });
});

// ---------- G: sources and direction ----------
describe("G: two sources, left/right of", () => {
  const zyx = () => card("Z.Y.X. Researcher", { type: "Creature", house: "Logos", text: T.zyx, power: 2 });

  it("option a archives the top of the deck, option b the top of the discard pile", () => {
    const researcher = zyx();
    const state = setupTest({ hand: [researcher], deck: [card("DeckBottom"), card("DeckTop")], discard: [card("DiscardBottom"), card("DiscardTop")] }, {}, "Logos");
    const a = applyMove(state, 0, { type: "play", instanceId: researcher.instanceId, mode: "a" });
    expect(a.players[0].archives.map((item) => item.face.title)).toEqual(["DeckTop"]);
    expect(a.players[0].discard).toHaveLength(2);
    const b = applyMove(state, 0, { type: "play", instanceId: researcher.instanceId, mode: "b" });
    expect(b.players[0].archives.map((item) => item.face.title)).toEqual(["DiscardTop"]);
    expect(b.players[0].deck.map((item) => item.face.title)).toEqual(["DeckBottom", "DeckTop"]);
  });

  it("the legal moves carry both options so the player (and the AI) can pick", () => {
    const researcher = zyx();
    const state = setupTest({ hand: [researcher] }, {}, "Logos");
    expect(legal(state).filter((move) => move.type === "play").map((move) => move.mode).sort()).toEqual(["a", "b"]);
  });

  it("an empty source simply moves nothing", () => {
    const researcher = zyx();
    const state = setupTest({ hand: [researcher], deck: [card("Only")], discard: [] }, {}, "Logos");
    expect(applyMove(state, 0, { type: "play", instanceId: researcher.instanceId, mode: "b" }).players[0].archives).toHaveLength(0);
  });

  const line = (anga: boolean) => {
    const [left, middle, right] = [card("Left", { type: "Creature", house: "Untamed", power: 3 }), card(anga ? "Panpaca, Anga" : "Panpaca, Jaga", { type: "Creature", house: "Untamed", power: 5, text: anga ? T.anga : T.jaga }), card("Right", { type: "Creature", house: "Untamed", power: 3 })];
    const far = card("Far Right", { type: "Creature", house: "Untamed", power: 3 });
    const enemy = card("Enemy", { type: "Creature", house: "Dis", power: 3 });
    return { left, middle, right, far, enemy, state: setupTest({ inPlay: [left, middle, right, far] }, { inPlay: [enemy] }, "Untamed") };
  };

  it("Panpaca, Anga: +2 to EVERY creature to its right in the battleline (not only the neighbor), nothing to the left or the enemy", () => {
    const { left, middle, right, far, enemy, state } = line(true);
    const power = (target: typeof left) => effectivePower(state, state.players.flatMap((player) => player.board).find((item) => item.instanceId === target.instanceId)!);
    expect([power(left), power(middle), power(right), power(far), power(enemy)]).toEqual([3, 5, 5, 5, 3]);
  });

  it("Panpaca, Jaga: skirmish for every creature to its left only", () => {
    const { left, middle, right, state } = line(false);
    const kw = (target: typeof left) => keyword(state, state.players[0].board.find((item) => item.instanceId === target.instanceId)!, "skirmish");
    expect([kw(left), kw(right)]).toEqual([1, 0]);
    expect(kw(middle)).toBe(1); // its own printed Skirmish
  });

  it("follows the battleline, so a creature moving to the other side loses the bonus", () => {
    const { state, right } = line(true);
    const moved = { ...state, players: [{ ...state.players[0], board: [state.players[0].board[2], ...state.players[0].board.filter((item) => item !== state.players[0].board[2])] }, state.players[1]] } as GameState;
    expect(effectivePower(moved, moved.players[0].board.find((item) => item.instanceId === right.instanceId)!)).toBe(3);
  });

  it("leftOf/rightOf need a source: a lasting filter with no source matches nothing", () => {
    const state = setupTest({ inPlay: [card("A", { type: "Creature", house: "Untamed", power: 3 }), card("B", { type: "Creature", house: "Untamed", power: 3 })] }, {}, "Untamed");
    state.lasting = [{ target: { type: "Creature", rightOf: true }, power: 9, duration: "turn", side: 0, until: 99 }];
    expect(effectivePower(state, state.players[0].board[1])).toBe(3);
  });
});

// ---------- H: reveal and the card shown ----------
describe("H: reveal (public) and what is done to the shown card", () => {
  const beam = () => card("Beam of Forgetting", { type: "Action", house: "Unfathomable", text: T.beam });

  it("Beam of Forgetting names the random card in the log and sends THAT card to the bottom of the opponent's deck", () => {
    const spell = beam();
    const hand = [card("H1"), card("H2"), card("H3")];
    const state = setupTest({ hand: [spell] }, { hand, deck: [card("D1"), card("D2")] }, "Unfathomable");
    const next = applyMove(state, 0, { type: "play", instanceId: spell.instanceId });
    expect(next.players[1].hand).toHaveLength(2);
    const sent = next.players[1].deck[0];
    expect(hand.map((item) => item.face.title)).toContain(sent.face.title);
    expect(next.players[1].deck.map((item) => item.face.title).slice(1)).toEqual(["D1", "D2"]);
    const entry = next.log.find((item) => item.key === "log.reveal");
    expect(entry?.params).toEqual({ name: state.players[0].name, cards: sent.face.title });
  });

  it("it is reproducible (seeded) and consumes the PRNG; the deterministic search takes the first card", () => {
    const spell = beam();
    const make = () => setupTest({ hand: [spell] }, { hand: [card("H1"), card("H2"), card("H3")] }, "Unfathomable");
    const a = applyMove(make(), 0, { type: "play", instanceId: spell.instanceId });
    const b = applyMove(make(), 0, { type: "play", instanceId: spell.instanceId });
    expect(a.players[1].deck[0].face.title).toBe(b.players[1].deck[0].face.title);
    expect(a.rngCalls).toBeGreaterThan(make().rngCalls);
    const det = applyMove(make(), 0, { type: "play", instanceId: spell.instanceId }, { deterministic: true });
    expect(det.players[1].deck[0].face.title).toBe("H1");
  });

  it("an empty hand reveals nothing, logs nothing and leaves the deck alone", () => {
    const spell = beam();
    const next = applyMove(setupTest({ hand: [spell] }, { deck: [card("D1")] }, "Unfathomable"), 0, { type: "play", instanceId: spell.instanceId });
    expect(next.log.some((item) => item.key === "log.reveal")).toBe(false);
    expect(next.players[1].deck).toHaveLength(1);
  });

  it("a peek stays PRIVATE (count only), a reveal is PUBLIC (identities) — the one difference", () => {
    const survey = card("Survey", { type: "Action", house: "Star Alliance", text: T.survey });
    const next = applyMove(setupTest({ hand: [survey], deck: [card("Secret Card"), card("Other Secret")] }, {}, "Star Alliance"), 0, { type: "play", instanceId: survey.instanceId });
    expect(JSON.stringify(next.log)).not.toContain("Secret");
    expect(next.log.some((item) => item.key === "log.reveal")).toBe(false);
  });

  it("Survey looks at the top 2, shows them to the player and discards the CHEAPER one", () => {
    const survey = card("Survey", { type: "Action", house: "Star Alliance", text: T.survey });
    const [bottom, rich, poor] = [card("Bottom"), card("Rich", { amber: 2 }), card("Poor", { amber: 0 })];
    const next = applyMove(setupTest({ hand: [survey], deck: [bottom, poor, rich] }, {}, "Star Alliance"), 0, { type: "play", instanceId: survey.instanceId });
    expect(next.peek?.faces.map((item) => item.title)).toEqual(["Rich", "Poor"]);
    expect(next.players[0].discard.map((item) => item.face.title)).toContain("Poor");
    expect(next.players[0].deck.map((item) => item.face.title)).toEqual(["Bottom", "Rich"]);
  });

  it("only what the reveal showed AND is still in the zone moves (a one-card deck, an emptied one)", () => {
    const survey = card("Survey", { type: "Action", house: "Star Alliance", text: T.survey });
    const one = applyMove(setupTest({ hand: [survey], deck: [card("Lonely")] }, {}, "Star Alliance"), 0, { type: "play", instanceId: survey.instanceId });
    expect(one.players[0].discard.map((item) => item.face.title)).toContain("Lonely");
    const none = applyMove(setupTest({ hand: [card("Survey", { type: "Action", house: "Star Alliance", text: T.survey })], deck: [] }, {}, "Star Alliance"), 0, { type: "play", instanceId: survey.instanceId });
    expect(none.players[0].deck).toHaveLength(0);
  });
});

// ---------- I / J ----------
describe("I: Redeem the Crucible; J: Animating Force", () => {
  it("Redeem the Crucible was already covered by the Lote 9 `gone` filter: it counts only the Mutants it destroyed", () => {
    const redeem = card("Redeem the Crucible", { type: "Action", house: "Redemption", text: T.redeem });
    const mutants = [card("M1", { traits: "Mutant" }), card("M2", { traits: "Mutant" })];
    const state = setupTest({ hand: [redeem], inPlay: [card("Plain")] }, { inPlay: mutants }, "Redemption");
    state.players[0].amber = 4;
    const next = applyMove(state, 0, { type: "play", instanceId: redeem.instanceId });
    // 6 + 6 - 2 = 10 > 4 amber: nothing to forge, but the sweep happened and the Action left the game
    expect(next.players[1].board).toHaveLength(0);
    expect(next.players[0].purged.map((item) => item.face.title)).toEqual(["Redeem the Crucible"]);
  });

  it("Animating Force is cut and documented: it stays honest (not full)", () => {
    expect(parse("Animating Force", T.animating, "Upgrade", "Geistoid").coverage).not.toBe("full");
  });
});
