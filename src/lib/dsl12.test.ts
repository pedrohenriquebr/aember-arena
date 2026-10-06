// SPDX-License-Identifier: AGPL-3.0-only
// Lote 12 (DSL_VERSION 12): Rogue Operation (distinct houses among discarded cards) and Animating Force
// (artifact host, control while the upgrade is in play, the artifact becomes a 4-power versatile creature).
import { afterEach, describe, expect, it } from "vitest";
import { DSL_VERSION, normaliseAbilityOverride, setAbilityOverrides } from "./abilities";
import { PARSER_VERSION, parseCardText } from "./cardText";
import { FEW_SHOTS } from "./catalogLlm";
import { applyMove, effectivePower, getLegalMoves, keyword, type CardFace, type GameState } from "./game";
import { DSL_SCHEMA } from "./generated/dslSchema";
import { card, setupTest } from "./testkit";

afterEach(() => setAbilityOverrides(new Map()));

const ROGUE = "Play: Discard the top 2 cards of your deck. Steal 1A for each house represented among the discarded cards.";
const FORCE =
  "This upgrade enters play attached to an artifact instead of a creature. \nPlay: Take control of this artifact and put it on a flank of your battleline as a creature with 4 power and versatile.\nScrap: Gain 1A.\n";

const face = (title: string, text: string, type: string, house = "Shadows"): CardFace => ({ id: title, title, house, type, image: "", text, amber: 0, power: 0, armor: 0 });
const parse = (title: string, text: string, type: string, house = "Shadows") => parseCardText(face(title, text, type, house));
const legal = (state: GameState) => getLegalMoves(state, 0, state.activeHouse);
const play = (state: GameState, id: string, target?: string) => applyMove(state, 0, { type: "play", instanceId: id, ...(target ? { target } : {}) });

describe("contract", () => {
  it("bumps both versions and the schema carries the new fields", () => {
    expect(DSL_VERSION).toBe(15);
    expect(PARSER_VERSION).toBe(18);
    for (const needle of ['housesOf: "moved"', "whileSource?: true", 'k: "materialize"', 'hosts?: "Artifact"']) {
      expect(DSL_SCHEMA).toContain(needle);
    }
    const shots = FEW_SHOTS.map((shot) => shot.text);
    expect(shots.some((text) => text.includes("house represented among the discarded cards"))).toBe(true);
    expect(shots.some((text) => text.includes("attached to an artifact"))).toBe(true);
  });
});

describe("Rogue Operation", () => {
  it("parses the real sentence as a mill plus a steal per distinct house of the moved cards", () => {
    const rules = parse("Rogue Operation", ROGUE, "Action");
    expect(rules.coverage).toBe("full");
    expect(rules.abilities[0].acts).toEqual([
      { k: "move", n: 2, from: "deck", to: "discard", pick: "top" },
      { k: "steal", n: 1, per: { housesOf: "moved" } },
    ]);
  });

  it.each([
    ["one house", ["Brobnar", "Brobnar"], 1],
    ["two houses", ["Brobnar", "Logos"], 2],
    ["three would be the cap but only two cards are discarded", ["Dis", "Sanctum"], 2],
  ])("steals once per distinct house (%s)", (_label, houses, stolen) => {
    const rogue = card("Rogue Operation", { type: "Action", house: "Shadows", text: ROGUE });
    const deck = [card("Bottom", { house: "Mars" }), card("Second", { house: houses[0] }), card("Top", { house: houses[1] })];
    const next = play(setupTest({ hand: [rogue], deck }, { amber: 5 }, "Shadows"), rogue.instanceId);
    expect(next.players[0].amber).toBe(stolen);
    expect(next.players[1].amber).toBe(5 - stolen);
    expect(next.players[0].discard.map((item) => item.face.title).sort()).toEqual(["Rogue Operation", "Second", "Top"]);
  });

  it("steals nothing when the deck is empty", () => {
    const rogue = card("Rogue Operation", { type: "Action", house: "Shadows", text: ROGUE });
    const next = play(setupTest({ hand: [rogue], deck: [] }, { amber: 3 }, "Shadows"), rogue.instanceId);
    expect(next.players[0].amber).toBe(0);
    expect(next.players[1].amber).toBe(3);
  });
});

describe("Animating Force", () => {
  const forceCard = () => card("Animating Force", { type: "Upgrade", house: "Logos", text: FORCE, power: 0 });

  it("parses the host line, the play pair and the scrap", () => {
    const rules = parse("Animating Force", FORCE, "Upgrade", "Logos");
    expect(rules.coverage).toBe("full");
    expect(rules.effects).toEqual([{ target: { self: true }, hosts: "Artifact" }]);
    expect(rules.abilities.map((ability) => ability.on)).toEqual([["play"], ["scrap"]]);
    expect(rules.abilities[0].acts).toEqual([
      { k: "takeControl", s: "host", whileSource: true },
      { k: "materialize", s: "host", power: 4, keyword: "versatile" },
    ]);
    expect(rules.abilities[1].acts).toEqual([{ k: "gainAmber", n: 1 }]);
  });

  it("will not attach to a creature, and will attach to an artifact", () => {
    const force = forceCard();
    const creatureOnly = setupTest({ hand: [force], inPlay: [card("Brute", { type: "Creature", house: "Brobnar", power: 5 })] }, {}, "Logos");
    expect(legal(creatureOnly).some((move) => move.type === "play" && move.instanceId === force.instanceId)).toBe(false);
    const artifact = card("Gauntlet", { type: "Artifact", house: "Logos", power: 0 });
    const withArtifact = setupTest({ hand: [forceCard()], inPlay: [artifact] }, {}, "Logos");
    const id = withArtifact.players[0].hand[0].instanceId;
    expect(legal(withArtifact).some((move) => move.type === "play" && move.instanceId === id)).toBe(true);
  });

  it("takes the opponent's artifact, makes it a 4-power versatile creature on our left flank, and gives it back when the upgrade leaves", () => {
    const force = forceCard();
    const artifact = card("Gauntlet", { type: "Artifact", house: "Sanctum", power: 0 });
    const friend = card("Friend", { type: "Creature", house: "Logos", power: 2 });
    const state = setupTest({ hand: [force], inPlay: [friend] }, { inPlay: [artifact] }, "Logos");
    const next = play(state, force.instanceId, artifact.instanceId);
    const upgrade = next.players[0].board.find((item) => item.face.title === "Animating Force")!;
    const shaped = next.players[0].board.find((item) => item.face.title === "Gauntlet")!;
    expect(upgrade.attachedTo).toBe(artifact.instanceId);
    expect(next.players[1].board.some((item) => item.face.title === "Gauntlet")).toBe(false);
    expect(shaped.face.type).toBe("Artifact");
    expect(shaped.asCreature).toEqual({ power: 4, versatile: true });
    expect(shaped.controlledBy).toBe(0);
    expect(shaped.boundTo).toBe(force.instanceId);
    expect(effectivePower(next, shaped)).toBe(4);
    expect(keyword(next, shaped, "versatile")).toBeGreaterThan(0);
    const creatures = next.players[0].board.filter((item) => item.face.type === "Creature" || item.asCreature);
    expect(creatures[0].face.title).toBe("Gauntlet");

    const bounce = card("Bounce", { type: "Action", house: "Logos", text: "Play: Return an upgrade to its owner's hand." });
    const force2 = forceCard();
    const artifact2 = card("Gauntlet", { type: "Artifact", house: "Sanctum", power: 0 });
    const withBounce = setupTest({ hand: [force2, bounce], inPlay: [card("Friend", { type: "Creature", house: "Logos", power: 2 })] }, { inPlay: [artifact2] }, "Logos");
    const taken = play(withBounce, force2.instanceId, artifact2.instanceId);
    const returned = play(taken, bounce.instanceId, force2.instanceId);
    const back = returned.players[1].board.find((item) => item.face.title === "Gauntlet")!;
    expect(back.asCreature).toBeUndefined();
    expect(back.controlledBy).toBeUndefined();
    expect(back.boundTo).toBeUndefined();
    expect(returned.players[0].board.some((item) => item.face.title === "Gauntlet")).toBe(false);
    expect(returned.players[0].hand.some((item) => item.face.title === "Animating Force")).toBe(true);
  });

  it("is a creature for destroy and not an artifact", () => {
    const force = forceCard();
    const artifact = card("Gauntlet", { type: "Artifact", house: "Sanctum", power: 0 });
    const killCreature = card("Zap", { type: "Action", house: "Logos", text: "Play: Destroy a creature." });
    const taken = play(
      setupTest({ hand: [force, killCreature], inPlay: [card("Friend", { type: "Creature", house: "Logos", power: 2 })] }, { inPlay: [artifact] }, "Logos"),
      force.instanceId,
      artifact.instanceId,
    );
    const shaped = taken.players[0].board.find((item) => item.face.title === "Gauntlet")!;
    const killed = play(taken, killCreature.instanceId, shaped.instanceId);
    expect(killed.players[0].board.some((item) => item.face.title === "Gauntlet")).toBe(false);
    expect(killed.players[1].discard.some((item) => item.face.title === "Gauntlet")).toBe(true);

    const force2 = forceCard();
    const artifact2 = card("Gauntlet", { type: "Artifact", house: "Sanctum", power: 0 });
    const killArtifact = card("Smash", { type: "Action", house: "Logos", text: "Play: Destroy an artifact." });
    const again = play(
      setupTest({ hand: [force2, killArtifact], inPlay: [card("Friend", { type: "Creature", house: "Logos", power: 2 })] }, { inPlay: [artifact2] }, "Logos"),
      force2.instanceId,
      artifact2.instanceId,
    );
    const shaped2 = again.players[0].board.find((item) => item.face.title === "Gauntlet")!;
    const missed = play(again, killArtifact.instanceId, shaped2.instanceId);
    expect(missed.players[0].board.some((item) => item.instanceId === shaped2.instanceId)).toBe(true);
    expect(missed.players[0].discard.some((item) => item.face.title === "Smash")).toBe(true);
  });

  it("returns the artifact clean after it fought", () => {
    const force = forceCard();
    const artifact = card("Gauntlet", { type: "Artifact", house: "Sanctum", power: 0 });
    const foe = card("Brute", { type: "Creature", house: "Brobnar", power: 3 });
    const bounce = card("Bounce", { type: "Action", house: "Logos", text: "Play: Return an upgrade to its owner's hand." });
    const taken = play(
      setupTest({ hand: [force, bounce], inPlay: [card("Friend", { type: "Creature", house: "Logos", power: 2 })] }, { inPlay: [artifact, foe] }, "Logos"),
      force.instanceId,
      artifact.instanceId,
    );
    const shaped = taken.players[0].board.find((item) => item.face.title === "Gauntlet")!;
    const fought = applyMove(taken, 0, { type: "fight", attackerId: shaped.instanceId, targetId: foe.instanceId });
    const wounded = fought.players[0].board.find((item) => item.face.title === "Gauntlet")!;
    expect(wounded.damage).toBe(3);
    expect(wounded.ready).toBe(false);
    wounded.stunned = true;
    wounded.warded = 1;
    wounded.enraged = 1;
    const returned = play(fought, bounce.instanceId, force.instanceId);
    const back = returned.players[1].board.find((item) => item.face.title === "Gauntlet")!;
    expect(back.damage).toBe(0);
    expect(back.ready).toBe(true);
    expect(back.stunned).toBe(false);
    expect(back.warded).toBeUndefined();
    expect(back.enraged).toBeUndefined();
    expect(back.asCreature).toBeUndefined();
  });

  it("accepts moved as the previous act's result and still rejects hosts outside an effect", () => {
    const row = (dsl: unknown) => ({
      cardId: "gate-12",
      dsl,
      textHash: "h",
      source: "manual",
      reviewed: true,
      generatedAt: 1,
    });
    // Lote 15a: "moved" deixou de ser dangling e virou Selection de verdade — o
    // resultado do ato anterior (o token de um makeToken, os cards de um
    // relocate); sem nada movido, o ato não afeta cards (o engine devolve []).
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "damage", n: 1, s: "moved" }] }]))).not.toBeNull();
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "steal", n: 1, per: { housesOf: "moved" } }] }]))).not.toBeNull();
    expect(
      normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "materialize", s: "host", power: 4, keyword: "versatile", hosts: "Artifact" }] }])),
    ).toBeNull();
    expect(normaliseAbilityOverride(row([{ on: ["play"], hosts: "Artifact", acts: [{ k: "gainAmber", n: 1 }] }]))).toBeNull();
  });

  it("gains 1 amber when scrapped from hand", () => {
    const force = forceCard();
    const next = applyMove(setupTest({ hand: [force] }, {}, "Logos"), 0, { type: "discard", instanceId: force.instanceId });
    expect(next.players[0].amber).toBe(1);
    expect(next.players[0].discard[0].face.title).toBe("Animating Force");
  });
});
