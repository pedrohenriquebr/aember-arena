// SPDX-License-Identifier: AGPL-3.0-only
// Lote 5 da DSL (docs/DSL_EXPANSION_PLAN_WAVE2.md §3): "Choose a house"
// (move.house, forceHouse/mustChoose), o gatilho `house`, casa concedida
// (houseOf/houseAs/effect.house), forged + forgeKey.less/min + purge self,
// Count.sub + even/odd e as imunidades (prevent/noSteal). Como no Lote 4, o DSL
// é escrito à mão numa linha `manual` onde o texto impresso não é o objeto.
import { afterEach, describe, expect, it } from "vitest";
import { type Ability, type AbilityOverride, type Condition, DSL_VERSION, normaliseAbilityOverride, type PersistentEffect, setAbilityOverrides } from "./abilities";
import { parseCardText, textHash } from "./cardText";
import { failureRow, validateDraft } from "./catalogLlm";
import {
  applyMove,
  chooseHouse,
  conditionHolds,
  endTurn,
  getLegalMoves,
  houseChoices,
  forgeKey,
  houseOf,
  housesFor,
  turnStamp,
  type CardFace,
  type CardInstance,
  type GameMove,
  type GameState,
} from "./game";
import { byTitle, card, setupTest } from "./testkit";

const rawFace = (text: string, type = "Action", house = "Sanctum"): CardFace => ({
  id: `probe5-${text.slice(0, 14)}`,
  title: "Probe",
  house,
  type,
  image: "",
  text,
  amber: 0,
  power: 1,
  armor: 0,
});

const creature = (title: string, house: string, power = 3, text = "", extra: Partial<CardFace> = {}) =>
  card(title, { type: "Creature", house, power, text, ...extra });

function manual(items: { card: CardInstance; dsl?: Ability[]; effects?: PersistentEffect[] }[]): CardInstance[] {
  setAbilityOverrides(
    new Map(
      items.map(({ card: item, dsl = [], effects }) => [
        item.face.id,
        {
          cardId: item.face.id,
          dsl,
          ...(effects ? { effects } : {}),
          textHash: textHash(item.face.text ?? ""),
          source: "manual",
          reviewed: true,
          generatedAt: 1,
        } satisfies AbilityOverride,
      ]),
    ),
  );
  return items.map(({ card: item }) => item);
}

const board = (state: GameState, side: 0 | 1, title: string) => byTitle(state.players[side].board, title)!;
const playMoves = (state: GameState, title: string): GameMove[] =>
  getLegalMoves(state, 0, state.activeHouse).filter((move) => move.type === "play" && move.instanceId === byTitle(state.players[0].hand, title)?.instanceId);

afterEach(() => setAbilityOverrides(new Map()));

const STUN_HOUSE: Ability = { on: ["play"], acts: [{ k: "stun", s: { each: { type: "Creature", house: "chosen" } } }] };

describe("5.1 Choose a house — move.house", () => {
  it("the parser reads Blinding Light's two sentences as one stun with house:chosen", () => {
    const parsed = parseCardText(rawFace("Play: Choose a house. Stun each creature of that house."));
    expect(parsed.coverage).toBe("full");
    expect(parsed.abilities).toEqual([STUN_HOUSE]);
  });

  it("'of that house' without a 'Choose a house' (and the reverse) stays outside the grammar", () => {
    expect(parseCardText(rawFace("Play: Stun each creature of that house.")).coverage).not.toBe("full");
    expect(parseCardText(rawFace("Play: Choose a house. Gain 1<A>.")).coverage).not.toBe("full");
  });

  it("one variant per house in play, only for a card whose DSL cites chosen", () => {
    const spell = card("Spell", { type: "Action", house: "Sanctum", text: "x" });
    const plain = card("Plain", { type: "Action", house: "Sanctum", text: "y" });
    manual([{ card: spell, dsl: [STUN_HOUSE] }, { card: plain, dsl: [{ on: ["play"], acts: [{ k: "gainAmber", n: 1 }] }] }]);
    const state = setupTest(
      { hand: [spell, plain], inPlay: [creature("Brute", "Brobnar")] },
      { inPlay: [creature("Mage", "Logos"), creature("Beast", "Untamed"), creature("Brute 2", "Brobnar")] },
      "Sanctum",
    );
    const variants = playMoves(state, "Spell");
    expect(variants.map((move) => (move as { house?: string }).house)).toEqual(["Brobnar", "Logos", "Untamed"]);
    expect(playMoves(state, "Plain")).toHaveLength(1);
    expect((playMoves(state, "Plain")[0] as { house?: string }).house).toBeUndefined();
    expect(houseChoices(state, 0, playMoves(state, "Plain")[0])).toEqual([]);
    expect(houseChoices(state, 0, { type: "play", instanceId: spell.instanceId })).toEqual(["Brobnar", "Logos", "Untamed"]);
  });

  it("the chosen house stuns exactly that house on both boards", () => {
    const spell = card("Spell", { type: "Action", house: "Sanctum", text: "x" });
    manual([{ card: spell, dsl: [STUN_HOUSE] }]);
    const state = setupTest(
      { hand: [spell], inPlay: [creature("Brute", "Brobnar")] },
      { inPlay: [creature("Mage", "Logos"), creature("Brute 2", "Brobnar")] },
      "Sanctum",
    );
    const next = applyMove(state, 0, { type: "play", instanceId: spell.instanceId, house: "Brobnar" });
    expect(board(next, 0, "Brute").stunned).toBe(true);
    expect(board(next, 1, "Brute 2").stunned).toBe(true);
    expect(board(next, 1, "Mage").stunned).toBe(false);
  });

  it("a move without a house still resolves with the engine's default pick", () => {
    const spell = card("Spell", { type: "Action", house: "Sanctum", text: "x" });
    manual([{ card: spell, dsl: [STUN_HOUSE] }]);
    const state = setupTest({ hand: [spell] }, { inPlay: [creature("Mage", "Logos"), creature("Mage 2", "Logos"), creature("Brute", "Brobnar")] }, "Sanctum");
    const next = applyMove(state, 0, { type: "play", instanceId: spell.instanceId });
    // Harmful text: the opponent's most numerous house.
    expect(board(next, 1, "Mage").stunned).toBe(true);
    expect(board(next, 1, "Brute").stunned).toBe(false);
  });

  it("an unresolved chosen filter matches nothing (negated too)", () => {
    const spell = card("Spell", { type: "Action", house: "Sanctum", text: "x" });
    manual([{ card: spell, dsl: [{ on: ["play"], acts: [{ k: "stun", s: { each: { type: "Creature", house: "!chosen" } } }] }] }]);
    const state = setupTest({ hand: [spell] }, { inPlay: [creature("Mage", "Logos")] }, "Sanctum");
    const next = applyMove(state, 0, { type: "play", instanceId: spell.instanceId, house: "Logos" });
    expect(board(next, 1, "Mage").stunned).toBe(false);
  });

  it("a lasting effect freezes the chosen house when it is created", () => {
    const spell = card("Spell", { type: "Action", house: "Sanctum", text: "x" });
    manual([
      {
        card: spell,
        dsl: [{ on: ["play"], acts: [{ k: "lasting", e: { target: { type: "Creature", house: "chosen" }, restrict: { who: "opponent", action: "fight" }, duration: "turn" } }] }],
      },
    ]);
    const state = setupTest({ hand: [spell] }, { inPlay: [creature("Mage", "Logos")] }, "Sanctum");
    const next = applyMove(state, 0, { type: "play", instanceId: spell.instanceId, house: "Logos" });
    expect(next.lasting?.[0].target.house).toBe("Logos");
  });
});

describe("5.1 forceHouse — mustChoose", () => {
  const FORCE: Ability = { on: ["play"], acts: [{ k: "forceHouse" }] };

  it("Control the Weak's text parses to forceHouse", () => {
    const parsed = parseCardText(rawFace("Play: Choose a house on your opponent's identity card. Your opponent must choose that house next turn."));
    expect(parsed.coverage).toBe("full");
    expect(parsed.abilities).toEqual([FORCE]);
  });

  it("the chooser offers the opponent's houses and writes mustChoose on them", () => {
    const spell = card("Spell", { type: "Action", house: "Sanctum", text: "x" });
    manual([{ card: spell, dsl: [FORCE] }]);
    const state = setupTest({ hand: [spell] }, {}, "Sanctum");
    const foeHouses = state.players[1].houses;
    expect(houseChoices(state, 0, { type: "play", instanceId: spell.instanceId })).toEqual(foeHouses);
    const next = applyMove(state, 0, { type: "play", instanceId: spell.instanceId, house: foeHouses[1] });
    expect(next.players[1].mustChoose).toBe(foeHouses[1]);
    expect(next.players[0].mustChoose).toBeUndefined();
  });

  it("the forced side can only pick that house, and the obligation is cleared", () => {
    const state = setupTest({}, {}, null);
    state.players[0].mustChoose = state.players[0].houses[2];
    expect(housesFor(state, 0)).toEqual([state.players[0].houses[2]]);
    expect(chooseHouse(state, 0, state.players[0].houses[0]).activeHouse).toBeNull();
    const chosen = chooseHouse(state, 0, state.players[0].houses[2]);
    expect(chosen.activeHouse).toBe(state.players[0].houses[2]);
    expect(chosen.players[0].mustChoose).toBeUndefined();
  });

  it("a forced house the deck does not hold frees the choice (and is still cleared)", () => {
    const state = setupTest({}, {}, null);
    state.players[0].mustChoose = "Saurian";
    expect(housesFor(state, 0)).toEqual(state.players[0].houses);
    expect(chooseHouse(state, 0, state.players[0].houses[0]).players[0].mustChoose).toBeUndefined();
  });

  it("survives a JSON round-trip of the state", () => {
    const state = setupTest({}, {}, null);
    state.players[0].mustChoose = state.players[0].houses[1];
    const copy = JSON.parse(JSON.stringify(state)) as GameState;
    expect(housesFor(copy, 0)).toEqual([state.players[0].houses[1]]);
  });
});

describe("5.2 gatilho house", () => {
  const GAIN: Ability = { on: ["house"], acts: [{ k: "gainAmber", n: 1 }] };

  it("fires on both sides' cards with me = each controller", () => {
    const mine = creature("Mine", "Brobnar", 3, "a");
    const theirs = creature("Theirs", "Logos", 3, "b");
    manual([{ card: mine, dsl: [GAIN] }, { card: theirs, dsl: [GAIN] }]);
    const state = setupTest({ inPlay: [mine] }, { inPlay: [theirs] }, null);
    const next = chooseHouse(state, 0, state.players[0].houses[0]);
    expect(next.players[0].amber).toBe(1);
    expect(next.players[1].amber).toBe(1);
  });

  it("'After you choose' (myTurn) pays only on the chooser's own choice; 'your opponent' the reverse", () => {
    const you = creature("You", "Brobnar", 3, "a");
    const foe = creature("Foe", "Brobnar", 3, "b");
    manual([
      { card: you, dsl: [{ ...GAIN, if: { k: "myTurn" } }] },
      { card: foe, dsl: [{ on: ["house"], acts: [{ k: "gainAmber", n: 2 }], if: { k: "not", c: { k: "myTurn" } } }] },
    ]);
    const state = setupTest({ inPlay: [you, foe] }, {}, null);
    const next = chooseHouse(state, 0, state.players[0].houses[0]);
    // `you` is mine and it is my turn: +1. `foe` is also mine: not (not myTurn) -> nothing.
    expect(next.players[0].amber).toBe(1);
  });

  it("the parser reads the three headers and the named house of the card itself", () => {
    const a = parseCardText(rawFace("After you choose an active house, gain 1<A>.", "Creature"));
    expect(a.abilities).toEqual([{ on: ["house"], if: { k: "myTurn" }, acts: [{ k: "gainAmber", n: 1 }] }]);
    const b = parseCardText(rawFace("After your opponent chooses an active house, gain 1<A>.", "Creature"));
    expect(b.abilities[0].if).toEqual({ k: "not", c: { k: "myTurn" } });
    const c = parseCardText(rawFace("After a player chooses Sanctum as their active house, gain 1<A>.", "Creature", "Sanctum"));
    expect(c.abilities).toEqual([{ on: ["house"], if: { k: "count", of: { c: { self: true, house: "active" } }, op: "gte", n: 1 }, acts: [{ k: "gainAmber", n: 1 }] }]);
    expect(parseCardText(rawFace("After a player chooses Dis as their active house, gain 1<A>.", "Creature", "Sanctum")).coverage).not.toBe("full");
  });

  it("is bound by the existing budgets: a huge board cannot fire past FIRE_BUDGET", () => {
    const crowd = Array.from({ length: 100 }, (_, index) => creature(`Watcher ${index}`, "Brobnar", 2, `w${index}`));
    manual(crowd.map((item) => ({ card: item, dsl: [GAIN] })));
    const state = setupTest({ inPlay: crowd }, {}, null);
    const next = chooseHouse(state, 0, state.players[0].houses[0]);
    expect(next.players[0].amber).toBeGreaterThan(0);
    expect(next.players[0].amber).toBeLessThanOrEqual(64);
  });
});

describe("5.3 casa concedida", () => {
  it("effect.house:'all' lets a card be used in any active house and matches every house filter", () => {
    const therapy = creature("Therapy", "Dis", 3, "t", {});
    manual([{ card: therapy, effects: [{ target: { self: true }, house: "all" }] }]);
    const state = setupTest({ inPlay: [therapy] }, {}, "Logos");
    expect(houseOf(state, board(state, 0, "Therapy"))).toBe("all");
    expect(getLegalMoves(state, 0, "Logos").some((move) => move.type === "reap")).toBe(true);
    const spell = card("Spell", { type: "Action", house: "Sanctum", text: "x" });
    manual([
      { card: therapy, effects: [{ target: { self: true }, house: "all" }] },
      { card: spell, dsl: [{ on: ["play"], acts: [{ k: "stun", s: { each: { type: "Creature", house: "Mars" } } }] }] },
    ]);
    const next = applyMove(setupTest({ hand: [spell], inPlay: [therapy] }, {}, "Sanctum"), 0, { type: "play", instanceId: spell.instanceId });
    expect(board(next, 0, "Therapy").stunned).toBe(true);
  });

  it("Experimental Therapy's text parses to a house:all effect", () => {
    const parsed = parseCardText(rawFace("This creature belongs to all houses. Play: Stun and exhaust this creature.", "Creature", "Logos"));
    expect(parsed.coverage).toBe("full");
    expect(parsed.effects).toEqual([{ target: { self: true }, house: "all" }]);
  });

  it("setHouse writes houseAs, houseAllows/houseMatches read it, and leavePlay zeroes it", () => {
    const grant = card("Grant", { type: "Action", house: "Sanctum", text: "x" });
    const target = creature("Target", "Brobnar");
    manual([{ card: grant, dsl: [{ on: ["play"], acts: [{ k: "setHouse", s: { each: { type: "Creature", side: "friendly" } }, house: "Logos" }] }] }]);
    const state = setupTest({ hand: [grant], inPlay: [target] }, {}, "Sanctum");
    const next = applyMove(state, 0, { type: "play", instanceId: grant.instanceId });
    expect(board(next, 0, "Target").houseAs).toBe("Logos");
    expect(houseOf(next, board(next, 0, "Target"))).toBe("Logos");
    // Usable under the new house, not under the printed one.
    next.activeHouse = "Logos";
    expect(getLegalMoves(next, 0, "Logos").some((move) => move.type === "reap")).toBe(true);
    next.activeHouse = "Brobnar";
    expect(getLegalMoves(next, 0, "Brobnar").some((move) => move.type === "reap")).toBe(false);
    // Leaving play zeroes it.
    const killer = card("Killer", { type: "Action", house: "Brobnar", text: "k" });
    manual([{ card: killer, dsl: [{ on: ["play"], acts: [{ k: "returnToHand", s: { each: { type: "Creature" } } }] }] }]);
    const wiped = applyMove({ ...next, players: [{ ...next.players[0], hand: [killer] }, next.players[1]] }, 0, { type: "play", instanceId: killer.instanceId });
    expect(byTitle(wiped.players[0].hand, "Target")?.houseAs).toBeUndefined();
  });

  it("anti-recursion gate: a house effect whose target (or if/per) filters by house is rejected", () => {
    const row = (effects: unknown) => ({ cardId: "c", dsl: [], effects, textHash: "h", source: "manual" });
    expect(normaliseAbilityOverride(row([{ target: { type: "Creature", house: "Mars" }, house: "Logos" }]))).toBeNull();
    expect(normaliseAbilityOverride(row([{ target: { self: true }, house: "Logos", if: { k: "count", of: { c: { house: "Mars" } }, op: "gte", n: 1 } }]))).toBeNull();
    expect(normaliseAbilityOverride(row([{ target: { self: true }, house: "Logos" }]))).not.toBeNull();
    // A lasting act carries the same rule.
    const lasting = { on: ["play"], acts: [{ k: "lasting", e: { target: { house: "Mars" }, house: "Logos", duration: "turn" } }] };
    expect(normaliseAbilityOverride({ cardId: "c", dsl: [lasting], textHash: "h", source: "manual" })).toBeNull();
  });

  it("the parser never emits a house effect with a house-filtered target", () => {
    expect(parseCardText(rawFace("Each Mars creature belongs to all houses.", "Creature")).effects).toEqual([]);
  });

  it("a hand-written looping effect cannot hang houseOf (depth guard)", () => {
    const loop = creature("Loop", "Dis", 3, "l");
    manual([{ card: loop, effects: [{ target: { type: "Creature", house: "Dis" }, house: "Logos" }] }]);
    const state = setupTest({ inPlay: [loop] }, {}, "Dis");
    expect(() => houseOf(state, board(state, 0, "Loop"))).not.toThrow();
  });
});

describe("5.4 forged, forgeKey.less/min/mod e purge ~", () => {
  const FORGE_PLAY: Ability = {
    on: ["play"],
    acts: [
      { k: "forgeKey", n: 1, mod: 8, less: { p: "amber", opp: true } },
      { k: "purge", s: "self", if: { k: "count", of: "did", op: "gte", n: 1 } },
    ],
  };

  it("the parser reads the forge sentence with less and the purge ~ continuation", () => {
    const parsed = parseCardText(rawFace("Play: Forge a key at +8<A> current cost, reduced by 1<A> for each <A> in your opponent's pool. If you do, purge this card."));
    expect(parsed.coverage).toBe("full");
    expect(parsed.abilities).toEqual([FORGE_PLAY]);
    const min = parseCardText(rawFace("Play: Forge a key at current cost, reduced by 1<A> for each <A> in your opponent's pool, to a minimum of 2<A>."));
    expect(min.abilities[0].acts[0]).toMatchObject({ k: "forgeKey", min: 2, less: { p: "amber", opp: true } });
  });

  it("mod raises, less lowers by the opponent's pool and min is the floor", () => {
    const spell = card("Spell", { type: "Action", house: "Sanctum", text: "x" });
    manual([{ card: spell, dsl: [FORGE_PLAY] }]);
    // Cost 6 + 8 - 8 (opponent holds 8) = 6: 7 amber forges and pays 6.
    const state = setupTest({ hand: [spell], amber: 7 }, { amber: 8 }, "Sanctum");
    const next = applyMove(state, 0, { type: "play", instanceId: spell.instanceId });
    expect(next.players[0].keys).toBe(1);
    expect(next.players[0].amber).toBe(1);
    // With only 5 amber the key is not affordable: nothing forged, so no purge.
    const poor = applyMove(setupTest({ hand: [spell], amber: 5 }, { amber: 8 }, "Sanctum"), 0, { type: "play", instanceId: spell.instanceId });
    expect(poor.players[0].keys).toBe(0);
    expect(poor.players[0].purged).toHaveLength(0);
    expect(byTitle(poor.players[0].discard, "Spell")).toBeDefined();

    const floor = card("Floor", { type: "Action", house: "Sanctum", text: "f" });
    manual([{ card: floor, dsl: [{ on: ["play"], acts: [{ k: "forgeKey", n: 1, less: { p: "amber", opp: true }, min: 2 }] }] }]);
    const cheap = applyMove(setupTest({ hand: [floor], amber: 9 }, { amber: 30 }, "Sanctum"), 0, { type: "play", instanceId: floor.instanceId });
    expect(cheap.players[0].amber).toBe(7);
  });

  it("purge ~ sends the Action to purged, not to the discard pile", () => {
    const spell = card("Spell", { type: "Action", house: "Sanctum", text: "x" });
    manual([{ card: spell, dsl: [FORGE_PLAY] }]);
    const next = applyMove(setupTest({ hand: [spell], amber: 7 }, { amber: 8 }, "Sanctum"), 0, { type: "play", instanceId: spell.instanceId });
    expect(byTitle(next.players[0].purged, "Spell")).toBeDefined();
    expect(byTitle(next.players[0].discard, "Spell")).toBeUndefined();
  });

  it("forge records forgedAt and the forged condition reads the previous turn of that side", () => {
    const state = setupTest({ amber: 6 }, { amber: 6 }, "Brobnar");
    state.turn = 3;
    const ended = endTurn(state, 0); // side 1 starts and forges at its own stamp
    expect(ended.players[1].forgedAt).toBeDefined();
    // It is now side 1's turn: "you forged on your previous turn" is false (it forged this turn).
    expect(conditionHolds({ k: "forged" }, ended, 1)).toBe(false);
    // Side 0 ends no further: back to side 0, the opponent (1) forged on ITS previous turn.
    const back = endTurn({ ...ended, activeHouse: "Logos" }, 1);
    expect(conditionHolds({ k: "forged", opp: true }, back, 0)).toBe(true);
    expect(conditionHolds({ k: "forged" }, back, 0)).toBe(false);
  });

  it("forging again this turn keeps 'forged last turn' true; forging only now is false", () => {
    const state = setupTest({ amber: 12 }, {}, "Brobnar");
    state.turn = 3;
    state.players[0].forgedAt = turnStamp(state) - 2;
    const again = forgeKey(state, 0, 1, { free: true });
    expect(conditionHolds({ k: "forged" }, again, 0)).toBe(true);
    const fresh = setupTest({ amber: 12 }, {}, "Brobnar");
    fresh.turn = 3;
    expect(conditionHolds({ k: "forged" }, forgeKey(fresh, 0, 1, { free: true }), 0)).toBe(false);
  });

  it("'forged a key last turn' (Key Hammer spelling) parses to the forged condition", () => {
    const parsed = parseCardText(rawFace("Play: If your opponent forged a key last turn, unforge it. Your opponent gains 6<A>.", "Artifact"));
    expect(JSON.stringify(parsed.abilities)).toContain('"forged"');
    expect(parsed.coverage).toBe("full");
  });

  it("forgedAt is absent on a fresh match and the condition is false", () => {
    const state = setupTest({}, {}, "Brobnar");
    expect(conditionHolds({ k: "forged" }, state, 0)).toBe(false);
    expect(conditionHolds({ k: "forged", opp: true }, state, 0)).toBe(false);
  });
});

describe("5.5 aritmética de contagem", () => {
  const STEAL: Ability = { on: ["play"], acts: [{ k: "steal", n: 1, per: { sub: [{ p: "amber", opp: true }, 6] } }] };

  it("the parser reads 'all but N' and the even/odd condition", () => {
    expect(parseCardText(rawFace("Play: Steal all but 6 of your opponent's <A>.")).abilities).toEqual([STEAL]);
    const even = parseCardText(rawFace("Action: If your opponent has an even amount of <A>, steal 1<A>.", "Artifact"));
    expect(even.abilities[0].if).toEqual({ k: "count", of: { p: "amber", opp: true }, op: "even", n: 0 });
    const odd = parseCardText(rawFace("Action: If you have an odd amount of <A>, gain 1<A>.", "Artifact"));
    expect(odd.abilities[0].if).toEqual({ k: "count", of: { p: "amber" }, op: "odd", n: 0 });
  });

  it("sub floors at 0 and steals the surplus", () => {
    const spell = card("Spell", { type: "Action", house: "Sanctum", text: "x" });
    manual([{ card: spell, dsl: [STEAL] }]);
    const rich = applyMove(setupTest({ hand: [spell] }, { amber: 9 }, "Sanctum"), 0, { type: "play", instanceId: spell.instanceId });
    expect(rich.players[0].amber).toBe(3);
    expect(rich.players[1].amber).toBe(6);
    const poor = applyMove(setupTest({ hand: [spell] }, { amber: 4 }, "Sanctum"), 0, { type: "play", instanceId: spell.instanceId });
    expect(poor.players[0].amber).toBe(0);
    expect(poor.players[1].amber).toBe(4);
  });

  it("sub accepts a Count as the subtrahend", () => {
    const state = setupTest({ amber: 2 }, { amber: 7 }, "Brobnar");
    const gap: Condition = { k: "count", of: { sub: [{ p: "amber", opp: true }, { p: "amber" }] }, op: "eq", n: 5 };
    expect(conditionHolds(gap, state, 0)).toBe(true);
    const flipped: Condition = { k: "count", of: { sub: [{ p: "amber" }, { p: "amber", opp: true }] }, op: "eq", n: 0 };
    expect(conditionHolds(flipped, state, 0)).toBe(true);
  });

  it("even/odd ignore n", () => {
    const state = setupTest({ amber: 4 }, { amber: 3 }, "Brobnar");
    for (const n of [0, 1, 99]) {
      expect(conditionHolds({ k: "count", of: { p: "amber" }, op: "even", n }, state, 0)).toBe(true);
      expect(conditionHolds({ k: "count", of: { p: "amber", opp: true }, op: "odd", n }, state, 0)).toBe(true);
      expect(conditionHolds({ k: "count", of: { p: "amber", opp: true }, op: "even", n }, state, 0)).toBe(false);
    }
  });

  it("the shape gate accepts the new count forms and rejects malformed ones", () => {
    const row = (of: unknown, op = "gte") => ({ cardId: "c", dsl: [{ on: ["play"], acts: [{ k: "gainAmber", n: 1, if: { k: "count", of, op, n: 1 } }] }], textHash: "h", source: "manual" });
    expect(normaliseAbilityOverride(row({ sub: [{ p: "amber" }, 6] }))).not.toBeNull();
    expect(normaliseAbilityOverride(row({ sub: [{ p: "amber" }, { p: "amber", opp: true }] }, "even"))).not.toBeNull();
    expect(normaliseAbilityOverride(row({ sub: [{ p: "amber" }] }))).toBeNull();
    expect(normaliseAbilityOverride(row({ sub: [{ p: "amber" }, "6"] }))).toBeNull();
    expect(normaliseAbilityOverride(row({ p: "amber" }, "odd"))).not.toBeNull();
    expect(normaliseAbilityOverride(row({ p: "amber" }, "mod"))).toBeNull();
  });
});

describe("5.6 imunidades", () => {
  it("parses the unqualified immunity forms in full and leaves a qualified one unread", () => {
    expect(parseCardText(rawFace("Friendly creatures cannot be dealt damage.", "Artifact")).effects).toEqual([
      { target: { type: "Creature", side: "friendly" }, replace: { on: "damage", prevent: true } },
    ]);
    expect(parseCardText(rawFace("Your <A> cannot be stolen.", "Artifact")).effects).toEqual([{ target: {}, noSteal: true }]);
    expect(parseCardText(rawFace("This creature cannot be dealt damage by Mutant creatures.", "Creature")).coverage).not.toBe("full");
  });

  it("prevent cancels the damage before ward and armor are spent", () => {
    const shield = card("Shield", { type: "Artifact", house: "Sanctum", text: "s" });
    const guard = creature("Guard", "Brobnar", 3);
    const bolt = card("Bolt", { type: "Action", house: "Brobnar", text: "b" });
    manual([
      { card: shield, effects: [{ target: { type: "Creature", side: "friendly" }, replace: { on: "damage", prevent: true } }] },
      { card: bolt, dsl: [{ on: ["play"], acts: [{ k: "damage", n: 2, s: { each: { type: "Creature" } } }] }] },
    ]);
    const state = setupTest({ hand: [bolt], inPlay: [shield, guard] }, { inPlay: [creature("Foe", "Logos", 5)] }, "Brobnar");
    state.players[0].board[1].warded = 1;
    const next = applyMove(state, 0, { type: "play", instanceId: bolt.instanceId });
    expect(board(next, 0, "Guard").damage).toBe(0);
    expect(board(next, 0, "Guard").warded).toBe(1);
    expect(board(next, 1, "Foe").damage).toBe(2);
  });

  it("noSteal zeroes a steal against the side of the effect only", () => {
    const vault = card("Vault", { type: "Artifact", house: "Sanctum", text: "v" });
    const thief = card("Thief", { type: "Action", house: "Brobnar", text: "t" });
    manual([
      { card: vault, effects: [{ target: {}, noSteal: true }] },
      { card: thief, dsl: [{ on: ["play"], acts: [{ k: "steal", n: 2 }] }] },
    ]);
    // The opponent protects its amber: the steal does nothing.
    const blocked = applyMove(setupTest({ hand: [thief] }, { inPlay: [vault], amber: 5 }, "Brobnar"), 0, { type: "play", instanceId: thief.instanceId });
    expect(blocked.players[0].amber).toBe(0);
    expect(blocked.players[1].amber).toBe(5);
    // Protecting my own amber does not stop my own steal.
    const free = applyMove(setupTest({ hand: [thief], inPlay: [vault] }, { amber: 5 }, "Brobnar"), 0, { type: "play", instanceId: thief.instanceId });
    expect(free.players[0].amber).toBe(2);
  });
});

describe("DSL_VERSION 6", () => {
  it("a stored row above the running version is rejected, the current one accepted", () => {
    const row = { cardId: "c", dsl: [], textHash: "h", source: "manual" };
    expect(DSL_VERSION).toBe(12);
    expect(normaliseAbilityOverride({ ...row, v: 9 })?.v).toBe(9);
    expect(normaliseAbilityOverride({ ...row, v: 13 })).toBeNull();
  });

  it("draft and failure rows carry v:6", () => {
    const face = rawFace("Play: Choose a house. Stun each creature of that house.");
    const parsed = parseCardText(face);
    const result = validateDraft(face, { abilities: parsed.abilities, keywords: parsed.keywords }, "llm");
    expect(result.reason).toBeUndefined();
    expect(result.row?.v).toBe(12);
    expect(failureRow(face, "reply: nope").v).toBe(12);
  });

  it("the sanity gate wants the sentence behind a chosen house and a house trigger needs its text", () => {
    const gain = rawFace("Play: Gain 1<A>.");
    const bad = validateDraft(gain, { abilities: [STUN_HOUSE] }, "llm");
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain("choose a house");
    const noTrigger = validateDraft(gain, { abilities: [{ on: ["house"], acts: [{ k: "gainAmber", n: 1 }] }] }, "llm");
    expect(noTrigger.reason).toContain("house");
  });

  it("the dry-run exercises every house variant of a chooser card", () => {
    const face = rawFace("Play: Choose a house. Stun each creature of that house.");
    const parsed = parseCardText(face);
    expect(validateDraft(face, { abilities: parsed.abilities, keywords: parsed.keywords }, "llm").ok).toBe(true);
  });
});
