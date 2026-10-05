// SPDX-License-Identifier: AGPL-3.0-only
// Lote 8 (DSL_VERSION 9): chosen-creature redirect, use toll, "most powerful", "Choose one:" modes,
// `gone` filter, granted traits, `side:"any"` zone moves, `mayFight` and `div` (the nine cards of
// the first batch of wave 4). Every card is read from its REAL printed text.
import { afterEach, describe, expect, it } from "vitest";
import { type Ability, DSL_VERSION, normaliseAbilityOverride, setAbilityOverrides } from "./abilities";
import { parseCardText } from "./cardText";
import { applyMove, conditionHolds, endTurn, getLegalMoves, pendingPrompt, traitsOf, type CardFace, type GameMove } from "./game";
import { byTitle, card, setupTest } from "./testkit";
import { FEW_SHOTS, validateDraft } from "./catalogLlm";

afterEach(() => setAbilityOverrides(new Map()));

const creature = (title: string, house: string, power: number, text = "", traits?: string) => card(title, { type: "Creature", house, power, text, ...(traits ? { traits } : {}) });
const face = (text: string, type = "Action", title = "Probe"): CardFace => ({ id: "p", title, house: "Logos", type, image: "", text, amber: 0, power: 2, armor: 0 });
const parse = (text: string, type = "Action", title = "Probe") => parseCardText(face(text, type, title));

const GABOS = "Before Fight: Choose a creature. Gabos Longarms deals damage to that creature rather than the one it is fighting.";
const GABOS_OLD = "Before Fight: Choose a creature. Gabos Longarms deals damage to that creature instead.";
const TENTACUS = "Your opponent must pay you 1<A> in order to use an artifact.";
const SILVINA = "Play: Move each <A> from a friendly creature to the most powerful enemy creature.\nScrap: Stun 2 creatures with no <A> on them.";
const DECOR = "Play: Choose one:\nExalt the most powerful creature 3 times.\nThe most powerful friendly creature captures 3.";
const REDEEM = "Omega.\nPlay: Destroy each creature. You may forge a key at +6 current cost, reduced by 1 for each Mutant creature destroyed this way. Purge Redeem the Crucible.";
const MIST = "Omni: Destroy The Mist. For the remainder of the turn, each creature gains the Mutant trait.";
const HAMSTRUNG = "Play: Discard the top card of a player’s deck. If it is a creature, purge it. ";
const LEADER = "Play: For the remainder of the turn, each friendly creature may fight.";
const TRIHARD = "Play: Each player randomly discards one third of their cards from their hand (rounding down).";

describe("DSL_VERSION 9", () => {
  it("accepts the new literals and rejects what would loop or dangle", () => {
    expect(DSL_VERSION).toBe(11);
    const row = (dsl: unknown[], extra: object = {}) => ({ cardId: "c", dsl, textHash: "h", source: "manual" as const, v: 9, ...extra });
    const redirect = { k: "lasting", e: { target: { fighting: true }, replace: { on: "damage", redirect: "chosen" } } };
    const good: unknown[][] = [
      [{ on: ["beforeFight"], target: { type: "Creature" }, acts: [redirect] }],
      [{ on: ["play"], acts: [{ k: "exalt", n: 3, s: { each: { type: "Creature", most: 1 } }, mode: "a" }, { k: "capture", n: 3, s: { each: { type: "Creature", side: "friendly", most: 1 } }, mode: "b" }] }],
      [{ on: ["play"], acts: [{ k: "forgeKey", n: 1, mod: 6, less: { gone: { type: "Creature", trait: "Mutant" } } }] }],
      [{ on: ["play"], acts: [{ k: "move", n: 1, from: "hand", to: "discard", pick: "random", per: { p: "hand", div: 3 } }] }],
      [{ on: ["play"], acts: [{ k: "move", n: 1, from: "deck", to: "discard", pick: "top", side: "any" }] }],
      [{ on: ["play"], acts: [{ k: "move", n: 1, from: "deck", to: "discard", pick: "top", side: "opponent" }] }],
      [{ on: ["omni"], acts: [{ k: "lasting", e: { target: { type: "Creature" }, traits: "Mutant", duration: "turn" } }] }],
      [{ on: ["play"], acts: [{ k: "lasting", e: { target: { type: "Creature", side: "friendly" }, mayFight: true, duration: "turn" } }] }],
      [{ on: ["play"], target: { type: "Creature" }, target2: { type: "Creature", most: 1, stronger: false }, acts: [{ k: "moveAmber", s: "target", to: "target2" }] }],
    ];
    for (const dsl of good) expect(normaliseAbilityOverride(row(dsl))?.v).toBe(9);
    expect(normaliseAbilityOverride(row([], { effects: [{ target: {}, restrict: { who: "opponent", action: "use", type: "Artifact", cost: 1 } }] }))?.v).toBe(9);
    expect(normaliseAbilityOverride(row([], { effects: [{ target: { type: "Creature" }, traits: "Mutant", mayFight: true }] }))?.v).toBe(9);
    expect(normaliseAbilityOverride(row(good[0], { v: 12 }))).toBeNull();

    const bad: unknown[][] = [
      // the chosen redirect reads the ability's target and a fight
      [{ on: ["beforeFight"], acts: [redirect] }],
      // on "fight" the redirect is written after the damage and cleared at the end: inert
      [{ on: ["fight"], target: { type: "Creature" }, acts: [redirect] }],
      [{ on: ["play"], target: { type: "Creature" }, acts: [redirect] }],
      [{ on: ["beforeFight"], target: { type: "Creature" }, acts: [{ k: "lasting", e: { target: {}, replace: { on: "destroy", redirect: "chosen" } } }] }],
      // a lone option is not a choice, and a mode is only "a" or "b"
      [{ on: ["play"], acts: [{ k: "gainAmber", n: 1, mode: "a" }] }],
      [{ on: ["play"], acts: [{ k: "gainAmber", n: 1, mode: "c" }, { k: "gainAmber", n: 2, mode: "a" }] }],
      // div: an integer of at least 2, never on key colors
      [{ on: ["play"], acts: [{ k: "move", n: 1, from: "hand", to: "discard", per: { p: "hand", div: 1 } }] }],
      [{ on: ["play"], acts: [{ k: "move", n: 1, from: "hand", to: "discard", per: { p: "hand", div: 2.5 } }] }],
      [{ on: ["play"], acts: [{ k: "steal", n: 1, per: { p: "keyColors", div: 2 } }] }],
      // side belongs to a move, and cannot fight the opp flag
      [{ on: ["play"], acts: [{ k: "gainAmber", n: 1, side: "any" }] }],
      [{ on: ["play"], acts: [{ k: "move", n: 1, from: "deck", to: "discard", opp: true, side: "any" }] }],
      [{ on: ["play"], acts: [{ k: "move", n: 1, from: "deck", to: "discard", side: "left" }] }],
      // a toll only exists for using; mayFight is a plain true
      [{ on: ["play"], acts: [{ k: "lasting", e: { target: {}, restrict: { who: "opponent", action: "play", cost: 1 } } }] }],
      [{ on: ["play"], acts: [{ k: "lasting", e: { target: {}, restrict: { who: "opponent", action: "use", cost: 0 } } }] }],
      [{ on: ["play"], acts: [{ k: "lasting", e: { target: {}, mayFight: false } }] }],
      // an effect that grants a trait and filters by trait would ask itself
      [{ on: ["play"], acts: [{ k: "lasting", e: { target: { type: "Creature", trait: "Beast" }, traits: "Mutant" } }] }],
      // the superlative reads effective power: a power effect aimed by it would recurse
      [{ on: ["play"], acts: [{ k: "lasting", e: { target: { type: "Creature", most: 1 }, power: 1 } }] }],
      [{ on: ["play"], acts: [{ k: "gainAmber", n: 1, per: { gone: { type: "Creature", rarity: "rare" } } }] }],
    ];
    for (const dsl of bad) expect(normaliseAbilityOverride(row(dsl))).toBeNull();
    const badEffects: object[][] = [
      [{ target: { type: "Creature", trait: "Beast" }, traits: "Mutant" }],
      [{ target: {}, replace: { on: "damage", redirect: "chosen" } }],
      [{ target: {}, restrict: { who: "opponent", action: "fight", cost: 1 } }],
      [{ target: { type: "Creature" }, power: 1, per: { c: { type: "Creature", most: 1 } } }],
      [{ target: { type: "Creature", stronger: true }, power: 1 }],
      [{ target: {}, mayFight: false }],
    ];
    for (const effects of badEffects) expect(normaliseAbilityOverride(row([], { effects }))).toBeNull();
  });
});

describe("parser: the real texts", () => {
  it("reads each of the nine cards in full", () => {
    const cases: [string, string, string, string][] = [
      ["Gabos Longarms", GABOS, "Creature", "Gabos Longarms"],
      ["Gabos Longarms (old print)", GABOS_OLD, "Creature", "Gabos Longarms"],
      ["Tentacus", TENTACUS, "Creature", "Tentacus"],
      ["Governess Silvina", SILVINA, "Creature", "Governess Silvina"],
      ["Degenerate Decor", DECOR, "Action", "Degenerate Decor"],
      ["Redeem the Crucible", REDEEM, "Action", "Redeem the Crucible"],
      ["The Mist", MIST, "Artifact", "The Mist"],
      ["Hamstrung", HAMSTRUNG, "Action", "Hamstrung"],
      ["Follow the Leader", LEADER, "Action", "Follow the Leader"],
      ["Trihard", TRIHARD, "Creature", "Trihard"],
    ];
    for (const [name, text, type, title] of cases) expect([name, parse(text, type, title).coverage]).toEqual([name, "full"]);
  });

  it("emits the exact shapes", () => {
    const gabos: Ability = { on: ["beforeFight"], acts: [{ k: "lasting", e: { target: { fighting: true }, replace: { on: "damage", redirect: "chosen" } } }], target: { type: "Creature" } };
    expect(parse(GABOS, "Creature", "Gabos Longarms").abilities).toEqual([gabos]);
    expect(parse(GABOS_OLD, "Creature", "Gabos Longarms").abilities).toEqual([gabos]);
    expect(parse(TENTACUS, "Creature", "Tentacus").effects).toEqual([{ target: {}, restrict: { who: "opponent", action: "use", type: "Artifact", cost: 1 } }]);
    expect(parse(SILVINA, "Creature", "Governess Silvina").abilities).toEqual([
      {
        on: ["play"],
        acts: [{ k: "moveAmber", s: "target", to: "target2" }],
        target: { type: "Creature", side: "friendly", amber: true },
        target2: { type: "Creature", side: "enemy", most: 1 },
      },
      { on: ["scrap"], acts: [{ k: "stun", s: { pick: { type: "Creature", amber: false }, n: 2 } }] },
    ]);
    expect(parse(DECOR, "Action", "Degenerate Decor").abilities[0].acts).toEqual([
      { k: "exalt", n: 3, s: { each: { type: "Creature", most: 1 } }, mode: "a" },
      { k: "capture", n: 3, s: { each: { type: "Creature", side: "friendly", most: 1 } }, mode: "b" },
    ]);
    expect(parse(REDEEM, "Action", "Redeem the Crucible").abilities[0].acts).toEqual([
      { k: "destroy", s: { each: { type: "Creature" } } },
      { k: "forgeKey", n: 1, mod: 6, less: { gone: { type: "Creature", trait: "Mutant" } }, optional: true },
      { k: "purge", s: "self" },
    ]);
    expect(parse(MIST, "Artifact", "The Mist").abilities).toEqual([
      { on: ["omni"], acts: [{ k: "destroy", s: "self" }, { k: "lasting", e: { target: { type: "Creature" }, traits: "Mutant", duration: "turn" } }] },
    ]);
    expect(parse(HAMSTRUNG, "Action", "Hamstrung").abilities[0].acts).toEqual([
      { k: "move", n: 1, from: "deck", to: "discard", pick: "top", side: "any" },
      { k: "move", n: 1, from: "discard", to: "purged", pick: "moved", type: "Creature", side: "any" },
    ]);
    expect(parse(LEADER, "Action", "Follow the Leader").abilities[0].acts).toEqual([
      { k: "lasting", e: { target: { type: "Creature", side: "friendly" }, mayFight: true, duration: "turn" } },
    ]);
    expect(parse(TRIHARD, "Creature", "Trihard").abilities[0].acts).toEqual([
      { k: "move", n: 1, from: "hand", to: "discard", pick: "random", per: { p: "hand", div: 3 } },
      { k: "move", n: 1, from: "hand", to: "discard", opp: true, pick: "random", per: { p: "hand", opp: true, div: 3 } },
    ]);
  });

  it("keeps a choice with the wrong number of options outside the grammar", () => {
    expect(parse("Play: Choose one:\nGain 1<A>.\nGain 2<A>.\nGain 3<A>.").coverage).not.toBe("full");
    expect(parse("Play: Choose one:\nGain 1<A>.").coverage).not.toBe("full");
  });
});

describe("8.1 Gabos Longarms — redirect to the chosen creature", () => {
  const setup = (text = GABOS) => {
    const gabos = creature("Gabos Longarms", "Dis", 5, text);
    const defender = creature("Defender", "Logos", 3);
    const chosen = creature("Chosen", "Logos", 6);
    const state = setupTest({ inPlay: [gabos] }, { inPlay: [defender, chosen] }, "Dis");
    return { state, gabos: state.players[0].board[0], defender: state.players[1].board[0], chosen: state.players[1].board[1] };
  };

  it("the fought creature is spared and the chosen one takes the damage; Gabos still takes the blow back", () => {
    for (const text of [GABOS, GABOS_OLD]) {
      const { state, gabos, defender, chosen } = setup(text);
      const next = applyMove(state, 0, { type: "fight", attackerId: gabos.instanceId, targetId: defender.instanceId, target: chosen.instanceId });
      expect(byTitle(next.players[1].board, "Defender")?.damage).toBe(0);
      expect(byTitle(next.players[1].board, "Chosen")?.damage).toBe(5);
      expect(byTitle(next.players[0].board, "Gabos Longarms")?.damage).toBe(3);
    }
  });

  it("the redirect ends with the fight: the defender takes later damage normally", () => {
    const { state, gabos, defender, chosen } = setup();
    const next = applyMove(state, 0, { type: "fight", attackerId: gabos.instanceId, targetId: defender.instanceId, target: chosen.instanceId });
    const probe = creature("Pinger", "Dis", 1, "Reap: Deal 2<D> to a creature.");
    const again = { ...next, players: [{ ...next.players[0], board: [...next.players[0].board, probe] }, next.players[1]] as typeof next.players };
    const reaped = applyMove(again, 0, { type: "reap", instanceId: probe.instanceId, target: next.players[1].board[0].instanceId });
    expect(byTitle(reaped.players[1].board, "Defender")?.damage).toBe(2);
  });

  it("the choice is the fight's target: one fight move per candidate, and the engine picks the strongest enemy without one", () => {
    const { state, gabos, defender } = setup();
    const fights = getLegalMoves(state, 0, "Dis").filter((move) => move.type === "fight" && move.targetId === defender.instanceId);
    expect(fights.length).toBeGreaterThan(1);
    expect(new Set(fights.map((move) => (move as { target?: string }).target)).size).toBe(fights.length);
    const next = applyMove(state, 0, { type: "fight", attackerId: gabos.instanceId, targetId: defender.instanceId });
    expect(byTitle(next.players[1].board, "Chosen")?.damage).toBe(5);
    expect(byTitle(next.players[1].board, "Defender")?.damage).toBe(0);
  });

  it("choosing the fought creature itself changes nothing", () => {
    const { state, gabos, defender } = setup();
    const next = applyMove(state, 0, { type: "fight", attackerId: gabos.instanceId, targetId: defender.instanceId, target: defender.instanceId });
    expect(byTitle(next.players[1].board, "Defender")).toBeUndefined();
  });

  it("does not ask for a house (the literal is a creature)", () => {
    const { state, gabos, defender } = setup();
    expect(getLegalMoves(state, 0, "Dis").every((move) => !("house" in move) || move.house === undefined)).toBe(true);
    expect(pendingPrompt(state, 0, { type: "fight", attackerId: gabos.instanceId, targetId: defender.instanceId })).toBeNull();
  });
});

describe("8.2 Tentacus — the toll to use an artifact", () => {
  const setup = (amber: number) => {
    const tentacus = creature("Tentacus", "Dis", 5, TENTACUS);
    const relic = card("Relic", { type: "Artifact", house: "Logos", text: "Action: Draw a card." });
    const state = setupTest({ inPlay: [tentacus], amber: 0 }, { inPlay: [relic], amber }, "Dis");
    state.activePlayer = 1;
    state.activeHouse = "Logos";
    return { state, relic: state.players[1].board[0] };
  };
  const uses = (state: ReturnType<typeof setup>["state"], relicId: string) => getLegalMoves(state, 1, state.activeHouse).some((move) => move.type === "use" && move.instanceId === relicId);

  it("the use needs the amber and pays it to the owner of Tentacus", () => {
    const poor = setup(0);
    expect(uses(poor.state, poor.relic.instanceId)).toBe(false);
    const rich = setup(3);
    expect(uses(rich.state, rich.relic.instanceId)).toBe(true);
    const next = applyMove(rich.state, 1, { type: "use", instanceId: rich.relic.instanceId });
    expect(next.players[1].amber).toBe(2);
    expect(next.players[0].amber).toBe(1);
  });

  it("the controller of Tentacus uses its own artifacts for free", () => {
    const relic = card("Relic", { type: "Artifact", house: "Dis", text: "Action: Draw a card." });
    const state = setupTest({ inPlay: [creature("Tentacus", "Dis", 5, TENTACUS), relic] }, {}, "Dis");
    const next = applyMove(state, 0, { type: "use", instanceId: state.players[0].board[1].instanceId });
    expect(next.players[0].amber).toBe(0);
    expect(next.players[1].amber).toBe(0);
  });

  it("an omni artifact pays too, but reaping with a creature does not", () => {
    const omni = card("Odd", { type: "Artifact", house: "Dis", text: "Omni: Draw a card." });
    const grunt = creature("Grunt", "Logos", 2);
    const state = setupTest({ inPlay: [creature("Tentacus", "Dis", 5, TENTACUS)] }, { inPlay: [omni, grunt], amber: 1 }, "Dis");
    state.activePlayer = 1;
    state.activeHouse = "Logos";
    const next = applyMove(state, 1, { type: "use", instanceId: state.players[1].board[0].instanceId });
    expect(next.players[1].amber).toBe(0);
    expect(next.players[0].amber).toBe(1);
    const reaped = applyMove(state, 1, { type: "reap", instanceId: state.players[1].board[1].instanceId });
    expect(reaped.players[0].amber).toBe(0);
  });
});

describe("8.3 the most powerful creature — Governess Silvina", () => {
  it("moves the amber of the chosen friendly creature to the most powerful enemy", () => {
    const rich = creature("Rich", "Saurian", 2);
    rich.amber = 3;
    const silvina = creature("Governess Silvina", "Saurian", 4, SILVINA);
    const small = creature("Small", "Dis", 2);
    const big = creature("Big", "Dis", 7);
    const mid = creature("Mid", "Dis", 5);
    const state = setupTest({ hand: [silvina], inPlay: [rich] }, { inPlay: [small, big, mid] }, "Saurian");
    const next = applyMove(state, 0, { type: "play", instanceId: silvina.instanceId, target: rich.instanceId });
    expect(byTitle(next.players[1].board, "Big")?.amber).toBe(3);
    expect(byTitle(next.players[1].board, "Mid")?.amber ?? 0).toBe(0);
    expect(byTitle(next.players[0].board, "Rich")?.amber ?? 0).toBe(0);
  });

  it("reads the effective power, not the printed one", () => {
    const rich = creature("Rich", "Saurian", 2);
    rich.amber = 1;
    const silvina = creature("Governess Silvina", "Saurian", 4, SILVINA);
    const printedBig = creature("PrintedBig", "Dis", 6);
    const buffed = creature("Buffed", "Dis", 3);
    buffed.counters = 5;
    const state = setupTest({ hand: [silvina], inPlay: [rich] }, { inPlay: [printedBig, buffed] }, "Saurian");
    const next = applyMove(state, 0, { type: "play", instanceId: silvina.instanceId, target: rich.instanceId });
    expect(byTitle(next.players[1].board, "Buffed")?.amber).toBe(1);
  });

  it("Scrap: stuns two creatures with no amber on them", () => {
    const silvina = card("Governess Silvina", { type: "Creature", house: "Saurian", power: 4, text: SILVINA });
    const worn = creature("Worn", "Dis", 9);
    worn.amber = 2;
    const a = creature("A", "Dis", 1);
    const b = creature("B", "Dis", 2);
    const state = setupTest({ hand: [silvina] }, { inPlay: [worn, a, b] }, "Saurian");
    const next = applyMove(state, 0, { type: "discard", instanceId: silvina.instanceId });
    const stunned = next.players[1].board.filter((item) => item.stunned).map((item) => item.face.title).sort();
    expect(stunned).toEqual(["A", "B"]);
  });

  it("`stronger` is the exact mirror of `weaker` (strictly higher than the source)", () => {
    const text = "Play: Destroy each creature with higher power than this creature.";
    expect(parse(text, "Creature").abilities[0].acts).toEqual([{ k: "destroy", s: { each: { type: "Creature", stronger: true } } }]);
    const source = creature("Src", "Dis", 4, text);
    const state = setupTest({ hand: [source] }, { inPlay: [creature("Higher", "Dis", 5), creature("Equal", "Dis", 4), creature("Lower", "Dis", 3)] }, "Dis");
    const next = applyMove(state, 0, { type: "play", instanceId: source.instanceId });
    expect(next.players[1].board.map((item) => item.face.title)).toEqual(["Equal", "Lower"]);
  });
});

describe("8.4 Degenerate Decor — Choose one", () => {
  const setup = () => {
    const decor = card("Degenerate Decor", { type: "Action", house: "Saurian", text: DECOR });
    const mine = creature("Mine", "Saurian", 4);
    const theirs = creature("Theirs", "Dis", 8);
    const state = setupTest({ hand: [decor], inPlay: [mine] }, { inPlay: [theirs], amber: 5 }, "Saurian");
    return { state, decor, mine: state.players[0].board[0], theirs: state.players[1].board[0] };
  };

  it("the legal moves carry one variant per option and the prompt asks for it", () => {
    const { state, decor } = setup();
    const plays = getLegalMoves(state, 0, "Saurian").filter((move) => move.type === "play");
    expect(plays.map((move) => move.mode).sort()).toEqual(["a", "b"]);
    expect(pendingPrompt(state, 0, { type: "play", instanceId: decor.instanceId })).toMatchObject({ kind: "mode", choice: "option" });
    expect(pendingPrompt(state, 0, { type: "play", instanceId: decor.instanceId, mode: "a" })).toBeNull();
  });

  it("option a exalts the most powerful creature of EITHER side three times", () => {
    const { state, decor } = setup();
    const next = applyMove(state, 0, { type: "play", instanceId: decor.instanceId, mode: "a" });
    expect(byTitle(next.players[1].board, "Theirs")?.amber).toBe(3);
    expect(byTitle(next.players[0].board, "Mine")?.amber ?? 0).toBe(0);
    expect(next.players[1].amber).toBe(5);
  });

  it("option b makes the most powerful FRIENDLY creature capture 3 from the opponent", () => {
    const { state, decor } = setup();
    const next = applyMove(state, 0, { type: "play", instanceId: decor.instanceId, mode: "b" });
    expect(byTitle(next.players[0].board, "Mine")?.amber).toBe(3);
    expect(next.players[1].amber).toBe(2);
    expect(byTitle(next.players[1].board, "Theirs")?.amber ?? 0).toBe(0);
  });

  it("a move without a mode resolves the first option", () => {
    const { state, decor } = setup();
    const next = applyMove(state, 0, { type: "play", instanceId: decor.instanceId });
    expect(byTitle(next.players[1].board, "Theirs")?.amber).toBe(3);
  });
});

describe("8.5 + 8.6 Redeem the Crucible and The Mist", () => {
  const redeem = (mutants: number, others: number, amber: number) => {
    const action = card("Redeem the Crucible", { type: "Action", house: "Redemption", text: REDEEM });
    const mine = Array.from({ length: mutants }, (_, index) => creature(`Mutant${index}`, "Dis", 2, "", "Mutant • Beast"));
    const theirs = Array.from({ length: others }, (_, index) => creature(`Plain${index}`, "Logos", 2, "", "Human"));
    const state = setupTest({ hand: [action], inPlay: mine, amber }, { inPlay: theirs }, "Redemption");
    return applyMove(state, 0, { type: "play", instanceId: action.instanceId });
  };

  it("each Mutant destroyed lowers the +6 cost by 1; the other creatures do not", () => {
    // base 6 + 6 = 12, less 2 Mutants = 10.
    const forged = redeem(2, 3, 10);
    expect(forged.players[0].keys).toBe(1);
    expect(forged.players[0].amber).toBe(0);
    expect(forged.players[0].board).toHaveLength(0);
    expect(forged.players[1].board).toHaveLength(0);
    // one Mutant: 11 > 10 amber, no key.
    expect(redeem(1, 3, 10).players[0].keys).toBe(0);
    expect(redeem(0, 3, 11).players[0].keys).toBe(0);
    expect(redeem(0, 0, 12).players[0].keys).toBe(1);
  });

  it("purges itself and ends the main step (Omega)", () => {
    const next = redeem(1, 0, 0);
    expect(next.players[0].purged.some((item) => item.face.title === "Redeem the Crucible")).toBe(true);
    expect(next.players[0].discard.some((item) => item.face.title === "Redeem the Crucible")).toBe(false);
    expect(next.omega).toBe(true);
  });

  it("only the creatures that really died count (a ward saves one)", () => {
    const action = card("Redeem the Crucible", { type: "Action", house: "Redemption", text: REDEEM });
    const mine = [creature("M0", "Dis", 2, "", "Mutant"), creature("M1", "Dis", 2, "", "Mutant")];
    mine[1].warded = 1;
    const state = setupTest({ hand: [action], inPlay: mine, amber: 11 }, {}, "Redemption");
    const next = applyMove(state, 0, { type: "play", instanceId: action.instanceId });
    // 12 - 1 Mutant destroyed = 11.
    expect(next.players[0].keys).toBe(1);
  });

  it("The Mist grants Mutant to every creature for the turn — and Redeem counts it", () => {
    const mist = card("The Mist", { type: "Artifact", house: "Redemption", text: MIST });
    const beast = creature("Beast", "Dis", 2, "", "Beast");
    const human = creature("Human", "Logos", 2, "", "Human");
    const state = setupTest({ inPlay: [mist, beast], amber: 0 }, { inPlay: [human] }, "Redemption");
    const used = applyMove(state, 0, { type: "use", instanceId: state.players[0].board[0].instanceId });
    expect(used.players[0].board.some((item) => item.face.title === "The Mist")).toBe(false);
    expect(traitsOf(used, used.players[0].board[0])).toEqual(["Beast", "Mutant"]);
    expect(traitsOf(used, used.players[1].board[0])).toEqual(["Human", "Mutant"]);
    const mutants = (s: typeof used) => conditionHolds({ k: "count", of: { c: { type: "Creature", trait: "Mutant" } }, op: "eq", n: 2 }, s, 0);
    expect(mutants(used)).toBe(true);
    // A creature that arrives later in the turn is a Mutant too.
    const late = creature("Late", "Dis", 1, "", "Knight");
    const withLate = { ...used, players: [{ ...used.players[0], board: [...used.players[0].board, late] }, used.players[1]] as typeof used.players };
    expect(traitsOf(withLate, late)).toContain("Mutant");
    // It lasts for the remainder of the turn only.
    const over = endTurn(used, 0);
    expect(traitsOf(over, over.players[1].board[0])).toEqual(["Human"]);
    expect(mutants(over)).toBe(false);
    // Redeem + Mist in one turn: every creature is a Mutant, so the cost drops by all of them.
    const action = card("Redeem the Crucible", { type: "Action", house: "Redemption", text: REDEEM });
    const handed = { ...used, activeHouse: "Redemption", players: [{ ...used.players[0], hand: [action], amber: 10 }, used.players[1]] as typeof used.players };
    const forged = applyMove(handed, 0, { type: "play", instanceId: action.instanceId });
    expect(forged.players[0].keys).toBe(1);
  });
});

describe("8.7 Hamstrung — a player's deck", () => {
  const setup = (topMine: string, topTheirs: string) => {
    const action = card("Hamstrung", { type: "Action", house: "Dis", text: HAMSTRUNG });
    const deckOf = (top: string, owner: string) => [creature(`${owner}Bottom`, "Dis", 1), top === "Creature" ? creature(`${owner}Top`, "Dis", 1) : card(`${owner}Top`, { type: "Action", house: "Dis" })];
    const state = setupTest({ hand: [action], deck: deckOf(topMine, "Mine") }, { deck: deckOf(topTheirs, "Theirs") }, "Dis");
    return { state, action };
  };
  const play = (mode: "a" | "b" | undefined, topMine: string, topTheirs: string) => {
    const { state, action } = setup(topMine, topTheirs);
    return applyMove(state, 0, { type: "play", instanceId: action.instanceId, ...(mode ? { mode } : {}) } as GameMove);
  };

  it("offers both decks, as two variants and a side prompt", () => {
    const { state, action } = setup("Creature", "Creature");
    expect(getLegalMoves(state, 0, "Dis").filter((move) => move.type === "play").map((move) => move.mode).sort()).toEqual(["a", "b"]);
    expect(pendingPrompt(state, 0, { type: "play", instanceId: action.instanceId })).toMatchObject({ kind: "mode", choice: "side" });
  });

  it("option a mills and purges from the player's own deck, option b from the opponent's", () => {
    const own = play("a", "Creature", "Creature");
    expect(own.players[0].purged.map((item) => item.face.title)).toEqual(["MineTop"]);
    expect(own.players[0].deck).toHaveLength(1);
    expect(own.players[1].deck).toHaveLength(2);
    const foe = play("b", "Creature", "Creature");
    expect(foe.players[1].purged.map((item) => item.face.title)).toEqual(["TheirsTop"]);
    expect(foe.players[1].deck).toHaveLength(1);
    expect(foe.players[0].deck).toHaveLength(2);
  });

  it("a card that is not a creature stays in the discard pile", () => {
    const foe = play("b", "Creature", "Action");
    expect(foe.players[1].purged).toHaveLength(0);
    expect(foe.players[1].discard.map((item) => item.face.title)).toEqual(["TheirsTop"]);
  });

  it("without an answer the engine mills the opponent's deck", () => {
    const next = play(undefined, "Creature", "Creature");
    expect(next.players[1].deck).toHaveLength(1);
    expect(next.players[0].deck).toHaveLength(2);
  });
});

describe("8.8 Follow the Leader — may fight", () => {
  const setup = () => {
    const action = card("Follow the Leader", { type: "Action", house: "Brobnar", text: LEADER });
    const outsider = creature("Outsider", "Logos", 4);
    const insider = creature("Insider", "Brobnar", 4);
    const foe = creature("Foe", "Dis", 2);
    const state = setupTest({ hand: [action], inPlay: [outsider, insider] }, { inPlay: [foe] }, "Brobnar");
    return { state, action, outsider: state.players[0].board[0] };
  };
  const movesOf = (state: ReturnType<typeof setup>["state"], id: string) =>
    getLegalMoves(state, 0, state.activeHouse).filter((move) => ("instanceId" in move && move.instanceId === id) || (move.type === "fight" && move.attackerId === id)).map((move) => move.type);

  it("a creature outside the active house can fight — and only fight — for the rest of the turn", () => {
    const { state, action, outsider } = setup();
    expect(movesOf(state, outsider.instanceId)).toEqual([]);
    const next = applyMove(state, 0, { type: "play", instanceId: action.instanceId });
    expect(movesOf(next, outsider.instanceId)).toEqual(["fight"]);
    const fought = applyMove(next, 0, { type: "fight", attackerId: outsider.instanceId, targetId: next.players[1].board[0].instanceId });
    expect(byTitle(fought.players[1].board, "Foe")).toBeUndefined();
    expect(byTitle(fought.players[0].board, "Outsider")?.ready).toBe(false);
  });

  it("ends with the turn, and never helps the opponent's creatures", () => {
    const { state, action, outsider } = setup();
    const next = applyMove(state, 0, { type: "play", instanceId: action.instanceId });
    const foeId = next.players[1].board[0].instanceId;
    expect(movesOf({ ...next, activePlayer: 1, activeHouse: "Logos" }, foeId)).toEqual([]);
    const later = endTurn(endTurn(next, 0), 1);
    later.activeHouse = "Brobnar";
    expect(movesOf(later, outsider.instanceId)).toEqual([]);
  });

  it("a stunned outsider spends its fight removing the stun", () => {
    const { state, action, outsider } = setup();
    const stunned = { ...state, players: [{ ...state.players[0], board: state.players[0].board.map((item) => (item === outsider ? { ...item, stunned: true } : item)) }, state.players[1]] as typeof state.players };
    const next = applyMove(stunned, 0, { type: "play", instanceId: action.instanceId });
    expect(movesOf(next, outsider.instanceId)).toEqual(["unstun"]);
  });
});

describe("8.9 Trihard — one third of the hand", () => {
  const play = (mine: number, theirs: number) => {
    const trihard = creature("Trihard", "Dis", 5, TRIHARD);
    const filler = (n: number, owner: string) => Array.from({ length: n }, (_, index) => card(`${owner}${index}`, { type: "Action", house: "Logos" }));
    const state = setupTest({ hand: [trihard, ...filler(mine, "m")] }, { hand: filler(theirs, "t") }, "Dis");
    return applyMove(state, 0, { type: "play", instanceId: trihard.instanceId });
  };

  it("rounds down for each player", () => {
    const next = play(7, 8);
    expect([next.players[0].hand.length, next.players[0].discard.length]).toEqual([5, 2]);
    expect([next.players[1].hand.length, next.players[1].discard.length]).toEqual([6, 2]);
  });

  it("two cards or fewer lose nothing", () => {
    const next = play(2, 1);
    expect([next.players[0].hand.length, next.players[1].hand.length]).toEqual([2, 1]);
    const exact = play(3, 9);
    expect([exact.players[0].hand.length, exact.players[1].hand.length]).toEqual([2, 6]);
  });
});

describe("review gaps of Lote 9", () => {
  it("`gone` with `side` counts the side the dead card had BEFORE it left play", () => {
    // Side is snapshotted with the act's selection: a dead card has no controller to match.
    const run = (side: "friendly" | "enemy") => {
      const text = `Play: Destroy each creature. Gain 1<A> for each ${side} creature destroyed this way.`;
      const action = card("Cull", { type: "Action", house: "Dis", text });
      const mine = [creature("A1", "Dis", 2), creature("A2", "Dis", 2)];
      const theirs = [creature("E1", "Logos", 2), creature("E2", "Logos", 2), creature("E3", "Logos", 2)];
      const state = setupTest({ hand: [action], inPlay: mine }, { inPlay: theirs }, "Dis");
      return applyMove(state, 0, { type: "play", instanceId: action.instanceId }).players[0].amber;
    };
    expect(run("friendly")).toBe(2);
    expect(run("enemy")).toBe(3);
  });

  it("Gabos' redirect lands on the chosen creature even if the fought one cannot be dealt damage", () => {
    const gabos = creature("Gabos Longarms", "Dis", 5, GABOS);
    const defender = creature("Defender", "Logos", 3, "This creature cannot be dealt damage.");
    const chosen = creature("Chosen", "Logos", 6);
    const state = setupTest({ inPlay: [gabos] }, { inPlay: [defender, chosen] }, "Dis");
    const next = applyMove(state, 0, { type: "fight", attackerId: state.players[0].board[0].instanceId, targetId: state.players[1].board[0].instanceId, target: state.players[1].board[1].instanceId });
    expect(byTitle(next.players[1].board, "Chosen")?.damage).toBe(5);
    expect(byTitle(next.players[1].board, "Defender")?.damage).toBe(0);
  });

  it("every few-shot answer passes the gate (validateDraft), not just the parser", () => {
    for (const shot of FEW_SHOTS) {
      if ("unsupported" in shot.answer) continue;
      const { partial, ...parts } = shot.answer;
      const verdict = validateDraft(face(shot.text, shot.type, "Probe"), { ...parts, ...(partial ? { partial } : {}) }, "llm");
      expect({ text: shot.text, ok: verdict.ok, reason: verdict.ok ? undefined : verdict.reason }).toEqual({ text: shot.text, ok: true, reason: undefined });
    }
  });
});
