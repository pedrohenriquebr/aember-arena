// SPDX-License-Identifier: AGPL-3.0-only
// Lote 6 (DSL_VERSION 7): power filters, forge/ready/enter, relational houses,
// ctx.moved, hand refill, named counters and the small high-yield filters.
import { afterEach, describe, expect, it } from "vitest";
import { type Ability, type AbilityOverride, DSL_VERSION, normaliseAbilityOverride, type PersistentEffect, setAbilityOverrides } from "./abilities";
import { parseCardText, textHash } from "./cardText";
import { applyMove, endTurn, forgeKey, isLegalMove, type CardFace, type CardInstance } from "./game";
import { byTitle, card, setupTest } from "./testkit";

const creature = (title: string, house: string, power: number, text = "") => card(title, { type: "Creature", house, power, text });

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

afterEach(() => setAbilityOverrides(new Map()));

const face = (text: string, type = "Action"): CardFace => ({
  id: "p",
  title: "Probe",
  house: "Logos",
  type,
  image: "",
  text,
  amber: 0,
  power: 2,
  armor: 0,
});

describe("DSL_VERSION 7", () => {
  it("accepts the new literals and rejects a newer row", () => {
    expect(DSL_VERSION).toBeGreaterThanOrEqual(7);
    const row = {
      cardId: "c",
      dsl: [{ on: ["forge"], if: { k: "actor", opp: true }, acts: [{ k: "gainAmber", n: 1 }] }],
      effects: [{ target: {}, hand: -1, opp: true }],
      textHash: "h",
      source: "manual" as const,
      v: 7,
    };
    expect(normaliseAbilityOverride(row)?.v).toBe(7);
    expect(normaliseAbilityOverride({ ...row, v: DSL_VERSION + 1 })).toBeNull();
    expect(normaliseAbilityOverride({ ...row, dsl: [{ on: ["ready"], acts: [{ k: "damage", n: 1, s: "event" }] }] })).toBeNull();
    expect(normaliseAbilityOverride({ ...row, dsl: [{ on: ["ready"], of: { type: "Creature" }, acts: [{ k: "ready", s: "event" }] }] })).toBeNull();
    expect(normaliseAbilityOverride({ ...row, dsl: [{ on: ["forge"], acts: [{ k: "forgeKey", n: 1 }] }] })).toBeNull();
    expect(normaliseAbilityOverride({ ...row, dsl: [{ on: ["enter"], of: { type: "Creature" }, acts: [{ k: "makeToken", n: 1 }] }] })).toBeNull();
    expect(normaliseAbilityOverride({ ...row, effects: [{ target: { powerMax: 3 }, power: 1 }] })).toBeNull();
    const lasting = { k: "lasting", e: { target: { type: "Creature" }, power: -1 } };
    expect(normaliseAbilityOverride({ ...row, dsl: [{ on: ["play"], acts: [lasting] }] })).not.toBeNull();
    expect(normaliseAbilityOverride({ ...row, dsl: [{ on: ["play"], acts: [{ k: "lasting", e: { target: { type: "Creature", powerMax: 3 }, power: -1 } }] }] })).toBeNull();
  });
});

describe("6.1 power filters", () => {
  it("parses power N or lower", () => {
    expect(parseCardText(face("Play: Destroy each creature with power 3 or lower.")).abilities[0].acts).toEqual([
      { k: "destroy", s: { each: { type: "Creature", powerMax: 3 } } },
    ]);
  });

  it("destroys only creatures at or below the printed threshold", () => {
    const action = card("Crush", { type: "Action", house: "Brobnar", text: "Play: Destroy." });
    const small = creature("Small", "Mars", 2);
    const big = creature("Big", "Mars", 5);
    const [played, weak, strong] = manual([
      { card: action, dsl: [{ on: ["play"], acts: [{ k: "destroy", s: { each: { type: "Creature", powerMax: 3 } } }] }] },
      { card: small },
      { card: big },
    ]);
    let state = setupTest({ inPlay: [weak, strong], hand: [played] }, {}, "Brobnar");
    state = applyMove(state, 0, { type: "play", instanceId: played.instanceId });
    expect(byTitle(state.players[0].board, "Small")).toBeUndefined();
    expect(byTitle(state.players[0].board, "Big")).toBeDefined();
  });
});

describe("6.2 forge, ready, enter, fighting", () => {
  it("parses the four observer wordings", () => {
    expect(parseCardText(face("After an enemy creature is destroyed fighting ~, gain 1 amber.", "Creature")).abilities[0].of).toEqual({
      type: "Creature",
      side: "enemy",
      fighting: true,
    });
    expect(parseCardText(face("After your opponent forges a key, gain 1 amber.", "Creature")).abilities[0].if).toEqual({ k: "actor", opp: true });
    expect(parseCardText(face("After a player readies a creature, deal 1 damage to it.", "Creature")).abilities[0].on).toEqual(["ready"]);
    expect(parseCardText(face("After a friendly Cat creature enters play, ward it.", "Creature")).abilities[0].of).toMatchObject({ trait: "Cat", side: "friendly" });
  });

  it("forge wakes both sides with the forger as actor", () => {
    const mine = creature("Mine", "Brobnar", 2, "After a player forges a key, gain 1.");
    const foe = creature("Foe", "Dis", 2, "After your opponent forges a key, gain 1.");
    const [a, b] = manual([
      { card: mine, dsl: [{ on: ["forge"], acts: [{ k: "gainAmber", n: 1 }] }] },
      { card: foe, dsl: [{ on: ["forge"], if: { k: "actor", opp: true }, acts: [{ k: "gainAmber", n: 1 }] }] },
    ]);
    const state = forgeKey(setupTest({ inPlay: [a], amber: 6 }, { inPlay: [b] }, "Brobnar"), 0);
    expect(state.players[0].amber).toBe(1);
    expect(state.players[1].amber).toBe(1);
  });

  it("the ready step damages only the creature that was exhausted", () => {
    const watcher = creature("Watch", "Logos", 4, "After a player readies a creature.");
    const fresh = creature("Fresh", "Brobnar", 4);
    const tired = creature("Tired", "Brobnar", 4);
    tired.ready = false;
    const [w, f, t] = manual([
      { card: watcher, dsl: [{ on: ["ready"], of: { type: "Creature" }, acts: [{ k: "damage", n: 1, s: "event" }] }] },
      { card: fresh },
      { card: tired },
    ]);
    const state = endTurn(setupTest({ inPlay: [w, f, t] }, {}, "Brobnar"), 0);
    expect(byTitle(state.players[0].board, "Tired")?.damage).toBe(1);
    expect(byTitle(state.players[0].board, "Watch")?.damage ?? 0).toBe(0);
    expect(byTitle(state.players[0].board, "Fresh")?.damage ?? 0).toBe(0);
  });

  it("a ready observer can use the creature that just readied", () => {
    const watcher = creature("Watch", "Logos", 1, "After a player readies a creature, use it.");
    const tired = creature("Tired", "Brobnar", 1);
    tired.ready = false;
    const [w, t] = manual([
      { card: watcher, dsl: [{ on: ["ready"], of: { type: "Creature" }, acts: [{ k: "use", s: "event", via: "reap" }] }] },
      { card: tired },
    ]);
    const state = endTurn(setupTest({ inPlay: [w, t] }, {}, "Brobnar"), 0);
    expect(state.players[0].amber).toBe(1);
    expect(byTitle(state.players[0].board, "Tired")?.ready).toBe(false);
    expect(byTitle(state.players[0].board, "Watch")?.ready).toBe(true);
  });

  it("a nested fight restores the outer fight pair", () => {
    const attacker = card("Bruiser", { type: "Creature", house: "Brobnar", power: 10, armor: 30, text: "Fight: damage." });
    const friend = creature("Ally", "Brobnar", 0);
    const outer = creature("Outer", "Logos", 20);
    const inner = creature("Inner", "Logos", 20);
    const [a, ally, o, i] = manual([
      {
        card: attacker,
        dsl: [
          { on: ["beforeFight"], acts: [{ k: "use", s: { each: { type: "Creature", side: "friendly", other: true } }, via: "fight" }] },
          { on: ["fight"], acts: [{ k: "damage", n: 1, s: { each: { type: "Creature", fighting: true } } }] },
        ],
      },
      { card: friend },
      { card: outer },
      { card: inner },
    ]);
    let state = setupTest({ inPlay: [a, ally] }, { inPlay: [o, i] }, "Brobnar");
    state = applyMove(state, 0, { type: "fight", attackerId: a.instanceId, targetId: o.instanceId });
    expect(byTitle(state.players[1].board, "Outer")?.damage).toBe(11);
    expect(byTitle(state.players[1].board, "Inner")?.damage ?? 0).toBe(0);
  });

  it("wards a creature when it enters play", () => {
    const watcher = creature("Watch", "Logos", 1, "After a creature enters play.");
    const arriving = creature("Cub", "Logos", 2, "Play: nothing.");
    const [w, cub] = manual([
      { card: watcher, dsl: [{ on: ["enter"], of: { type: "Creature" }, acts: [{ k: "ward", s: "event" }] }] },
      { card: arriving },
    ]);
    const state = applyMove(setupTest({ inPlay: [w], hand: [cub] }, {}, "Logos"), 0, { type: "play", instanceId: cub.instanceId });
    expect(byTitle(state.players[0].board, "Cub")?.warded).toBe(1);
    expect(byTitle(state.players[0].board, "Watch")?.warded ?? 0).toBe(0);
  });
});

describe("6.3 relational house", () => {
  it("matches self, target, fought and a negated neighbor at runtime", () => {
    const star = card("Star", { type: "Action", house: "Mars", text: "Play: damage." });
    const mars = creature("Marsman", "Mars", 3);
    const logos = creature("Logo", "Logos", 3);
    const [played, mine, otherHouse] = manual([
      { card: star, dsl: [{ on: ["play"], acts: [{ k: "damage", n: 1, s: { each: { type: "Creature", house: "self" } } }] }] },
      { card: mars },
      { card: logos },
    ]);
    let state = applyMove(setupTest({ hand: [played], inPlay: [mine, otherHouse] }, {}, "Mars"), 0, { type: "play", instanceId: played.instanceId });
    expect(byTitle(state.players[0].board, "Marsman")?.damage).toBe(1);
    expect(byTitle(state.players[0].board, "Logo")?.damage ?? 0).toBe(0);

    const bolt = card("Bolt", { type: "Action", house: "Dis", text: "Play: damage the target house." });
    const left = creature("Left", "Brobnar", 5);
    const right = creature("Right", "Sanctum", 5);
    const [aimed, a, b] = manual([
      {
        card: bolt,
        dsl: [{
          on: ["play"],
          target: { type: "Creature" },
          acts: [{ k: "damage", n: 2, s: { each: { type: "Creature", house: "target" } } }],
        }],
      },
      { card: left },
      { card: right },
    ]);
    state = applyMove(setupTest({ hand: [aimed], inPlay: [a] }, { inPlay: [b] }, "Dis"), 0, {
      type: "play",
      instanceId: aimed.instanceId,
      target: a.instanceId,
    });
    expect(byTitle(state.players[0].board, "Left")?.damage).toBe(2);
    expect(byTitle(state.players[1].board, "Right")?.damage ?? 0).toBe(0);

    const bruiser = card("Bruiser", { type: "Creature", house: "Brobnar", power: 8, armor: 30, text: "Fight: the fought house." });
    const foe = creature("Foe", "Logos", 20);
    const bystander = creature("Bystander", "Mars", 8);
    const [fighter, enemy, other] = manual([
      { card: bruiser, dsl: [{ on: ["fight"], acts: [{ k: "damage", n: 3, s: { each: { type: "Creature", house: "fought" } } }] }] },
      { card: foe },
      { card: bystander },
    ]);
    state = applyMove(setupTest({ inPlay: [fighter] }, { inPlay: [enemy, other] }, "Brobnar"), 0, {
      type: "fight",
      attackerId: fighter.instanceId,
      targetId: enemy.instanceId,
    });
    expect(byTitle(state.players[1].board, "Foe")?.damage).toBe(11);
    expect(byTitle(state.players[1].board, "Bystander")?.damage ?? 0).toBe(0);

    const edge = creature("Edge", "Logos", 2);
    const mid = creature("Mid", "Mars", 2);
    const far = creature("Far", "Mars", 2);
    const ping = card("Ping", { type: "Action", house: "Dis", text: "Play: not a neighbor." });
    const [shot, e, m, f] = manual([
      { card: ping, dsl: [{ on: ["play"], acts: [{ k: "damage", n: 1, s: { each: { type: "Creature", house: "!neighbor" } } }] }] },
      { card: edge },
      { card: mid },
      { card: far },
    ]);
    state = applyMove(setupTest({ hand: [shot], inPlay: [e, m, f] }, {}, "Dis"), 0, { type: "play", instanceId: shot.instanceId });
    expect(byTitle(state.players[0].board, "Edge")?.damage).toBe(1);
    expect(byTitle(state.players[0].board, "Mid")?.damage ?? 0).toBe(0);
    expect(byTitle(state.players[0].board, "Far")?.damage ?? 0).toBe(0);
  });

  it("forceHouse reads the target house and the reference owner", () => {
    const order = card("Order", { type: "Action", house: "Logos", text: "Play: force." });
    const subject = creature("Subject", "Mars", 2);
    const [played, piece] = manual([
      {
        card: order,
        dsl: [{
          on: ["play"],
          target: { type: "Creature" },
          acts: [{ k: "forceHouse", house: "target", who: "owner" }],
        }],
      },
      { card: subject },
    ]);
    const state = applyMove(setupTest({ hand: [played], inPlay: [piece] }, {}, "Logos"), 0, {
      type: "play",
      instanceId: played.instanceId,
      target: piece.instanceId,
    });
    expect(state.players[0].mustChoose).toBe("Mars");
  });

  it("damages enemies that share a house with the discarded card", () => {
    const action = card("Star", { type: "Action", house: "Mars", text: "Play: Discard." });
    const mars = creature("Marsman", "Mars", 3);
    const logos = creature("Logo", "Logos", 3);
    const bottom = card("Bottom", { type: "Action", house: "Mars", text: "" });
    const [played, enemyMars, enemyLogos, deckCard] = manual([
      {
        card: action,
        dsl: [{
          on: ["play"],
          acts: [
            { k: "move", n: 1, from: "deck", to: "discard", opp: true, pick: "bottom" },
            { k: "damage", n: 2, s: { each: { type: "Creature", side: "enemy", house: "moved" } } },
          ],
        }],
      },
      { card: mars },
      { card: logos },
      { card: bottom },
    ]);
    let state = setupTest({ hand: [played] }, { inPlay: [enemyMars, enemyLogos], deck: [deckCard] }, "Mars");
    state = applyMove(state, 0, { type: "play", instanceId: played.instanceId });
    expect(byTitle(state.players[1].board, "Marsman")?.damage).toBe(2);
    expect(byTitle(state.players[1].board, "Logo")?.damage ?? 0).toBe(0);
  });
});

describe("6.4 moved cards", () => {
  it("puts back a non-matching house card discarded this way", () => {
    const action = card("Haunt", { type: "Action", house: "Geistoid", text: "Play: Discard." });
    const geist = card("G", { type: "Action", house: "Geistoid", text: "x" });
    const logos = card("L", { type: "Action", house: "Logos", text: "y" });
    const [played, g, l] = manual([
      {
        card: action,
        dsl: [{
          on: ["play"],
          acts: [
            { k: "move", n: 2, from: "deck", to: "discard", pick: "top" },
            { k: "move", n: 1, from: "discard", to: "hand", pick: "moved", house: "!Geistoid" },
          ],
        }],
      },
      { card: geist },
      { card: logos },
    ]);
    let state = setupTest({ hand: [played], deck: [g, l] }, {}, "Geistoid");
    state = applyMove(state, 0, { type: "play", instanceId: played.instanceId });
    expect(state.players[0].hand.some((item) => item.face.title === "L")).toBe(true);
    expect(state.players[0].discard.some((item) => item.face.title === "G")).toBe(true);
  });
});

describe("6.5 hand size", () => {
  it("a full hand does not spend a chain", () => {
    const hand = Array.from({ length: 6 }, (_, index) => card(`Held ${index}`, { type: "Action", house: "Brobnar" }));
    const extra = card("Extra", { type: "Action", house: "Brobnar" });
    const state = endTurn(setupTest({ hand, deck: [extra], chains: 3 }, {}, "Brobnar"), 0);
    expect(state.players[0].chains).toBe(3);
    expect(state.players[0].hand).toHaveLength(6);
  });

  it("a hand-size effect refills to one less", () => {
    const anchor = creature("Anchor", "Logos", 1);
    const deck = Array.from({ length: 8 }, (_, index) => card(`Draw ${index}`, { type: "Action", house: "Brobnar" }));
    manual([{ card: anchor, effects: [{ target: {}, hand: -1 }] }]);
    const state = endTurn(setupTest({ inPlay: [anchor], deck }, {}, "Brobnar"), 0);
    expect(state.players[0].hand).toHaveLength(5);
  });

  it("parses a smaller opponent refill", () => {
    expect(parseCardText(face('During their "draw cards" step, your opponent refills their hand to 1 less card.', "Creature")).effects).toEqual([
      { target: {}, hand: -1, opp: true },
    ]);
  });
});

describe("6.6 named counters", () => {
  it("stores a scheme counter apart from power and steals for each removed", () => {
    const host = creature("Mind", "Logos", 2, "Action: counters.");
    const [piece] = manual([
      {
        card: host,
        dsl: [
          { on: ["action"], acts: [{ k: "counter", n: 2, s: "self", name: "scheme" }, { k: "removeCounter", s: "self", name: "scheme" }, { k: "steal", n: 1, per: "did" }] },
        ],
      },
    ]);
    let state = setupTest({ inPlay: [piece] }, { amber: 5 }, "Logos");
    state = applyMove(state, 0, { type: "use", instanceId: piece.instanceId });
    const left = byTitle(state.players[0].board, "Mind")!;
    expect(left.counters ?? 0).toBe(0);
    expect(left.marks).toBeUndefined();
    expect(state.players[0].amber).toBe(2);
  });
});

describe("6.7 leftovers", () => {
  it("counts bonus icons and printed power of cards moved this way", () => {
    const action = card("Tally", { type: "Action", house: "Logos", text: "Play: discard." });
    const gem = card("Gem", { type: "Action", house: "Logos", amber: 2 });
    const brute = creature("Brute", "Logos", 4);
    const [icons, gemCard] = manual([
      {
        card: action,
        dsl: [{
          on: ["play"],
          acts: [
            { k: "move", n: 1, from: "deck", to: "discard", pick: "top" },
            { k: "gainAmber", n: 1, per: { m: "icons" } },
          ],
        }],
      },
      { card: gem },
    ]);
    let state = applyMove(setupTest({ hand: [icons], deck: [gemCard] }, {}, "Logos"), 0, { type: "play", instanceId: icons.instanceId });
    expect(state.players[0].amber).toBe(2);
    const [powers, body] = manual([
      {
        card: action,
        dsl: [{
          on: ["play"],
          acts: [
            { k: "move", n: 1, from: "deck", to: "discard", pick: "top" },
            { k: "gainAmber", n: 1, per: { m: "power" } },
          ],
        }],
      },
      { card: brute },
    ]);
    state = applyMove(setupTest({ hand: [powers], deck: [body] }, {}, "Logos"), 0, { type: "play", instanceId: powers.instanceId });
    expect(state.players[0].amber).toBe(4);
  });

  it("freezes a moved card's type into a play restriction", () => {
    const action = card("Lock", { type: "Action", house: "Logos", text: "Play: lock." });
    const sample = creature("Sample", "Logos", 2);
    const later = creature("Later", "Logos", 2, "Play: later.");
    const spare = card("Spare", { type: "Action", house: "Logos", text: "Play: spare." });
    const [played, fromDeck, creatureCard, actionCard] = manual([
      {
        card: action,
        dsl: [{
          on: ["play"],
          acts: [
            { k: "move", n: 1, from: "deck", to: "discard", pick: "top" },
            { k: "lasting", e: { target: {}, restrict: { who: "you", action: "play", type: "moved" } } },
          ],
        }],
      },
      { card: sample },
      { card: later },
      { card: spare },
    ]);
    const state = applyMove(setupTest({ hand: [played, creatureCard, actionCard], deck: [fromDeck] }, {}, "Logos"), 0, {
      type: "play",
      instanceId: played.instanceId,
    });
    state.turn = 2;
    state.played = 0;
    expect(isLegalMove(state, 0, { type: "play", instanceId: creatureCard.instanceId })).toBe(false);
    expect(isLegalMove(state, 0, { type: "play", instanceId: actionCard.instanceId })).toBe(true);
  });

  it("still damages the neighbors of a creature destroyed by the same ability", () => {
    const action = card("Split", { type: "Action", house: "Brobnar", text: "Play: destroy." });
    const left = creature("Left", "Brobnar", 2);
    const mid = creature("Mid", "Brobnar", 2);
    const right = creature("Right", "Brobnar", 2);
    const [played, a, b, c] = manual([
      {
        card: action,
        dsl: [{
          on: ["play"],
          target: { type: "Creature" },
          acts: [
            { k: "destroy", s: "target" },
            { k: "damage", n: 1, s: "targetNeighbors" },
          ],
        }],
      },
      { card: left },
      { card: mid },
      { card: right },
    ]);
    const state = applyMove(setupTest({ hand: [played], inPlay: [a, b, c] }, {}, "Brobnar"), 0, {
      type: "play",
      instanceId: played.instanceId,
      target: b.instanceId,
    });
    expect(byTitle(state.players[0].board, "Mid")).toBeUndefined();
    expect(byTitle(state.players[0].board, "Left")?.damage).toBe(1);
    expect(byTitle(state.players[0].board, "Right")?.damage).toBe(1);
  });

  it("clears named counters when the creature leaves play", () => {
    const host = creature("Mind", "Logos", 2, "Action: go.");
    const [piece] = manual([
      {
        card: host,
        dsl: [{ on: ["action"], acts: [{ k: "counter", n: 2, s: "self", name: "scheme" }, { k: "destroy", s: "self" }] }],
      },
    ]);
    const state = applyMove(setupTest({ inPlay: [piece] }, {}, "Logos"), 0, { type: "use", instanceId: piece.instanceId });
    const gone = state.players[0].discard.find((item) => item.face.title === "Mind");
    expect(gone?.marks).toBeUndefined();
  });

  it("reads a creature or artifact as !Upgrade and an action that archives itself", () => {
    expect(parseCardText(face("Play: Purge each creature or artifact.")).abilities[0].acts[0]).toMatchObject({
      s: { each: { type: "!Upgrade" } },
    });
    const action = card("Ideas", { type: "Action", house: "Logos", text: "Play: Archive." });
    const [played] = manual([{ card: action, dsl: [{ on: ["play"], acts: [{ k: "archive", s: "self" }] }] }]);
    let state = setupTest({ hand: [played] }, {}, "Logos");
    state = applyMove(state, 0, { type: "play", instanceId: played.instanceId });
    expect(state.players[0].archives.some((item) => item.face.title === "Ideas")).toBe(true);
    expect(state.players[0].discard.some((item) => item.face.title === "Ideas")).toBe(false);
  });
});
