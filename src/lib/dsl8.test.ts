// SPDX-License-Identifier: AGPL-3.0-only
// Lote 7 (DSL_VERSION 8): key colors, the move's `targets[]` (second target, "up to N",
// flank), `move.until` and the `discard` observer (docs/DSL_EXPANSION_PLAN_WAVE3.md §4).
import { afterEach, describe, expect, it } from "vitest";
import { type Ability, type AbilityOverride, DSL_VERSION, normaliseAbilityOverride, setAbilityOverrides } from "./abilities";
import { parseCardText, textHash } from "./cardText";
import { applyMove, endTurn, forgedKeyColors, forgeKey, getLegalMoves, pendingPrompt, setKeyOrder, type CardFace, type CardInstance, type GameState } from "./game";
import { byTitle, card, setupTest } from "./testkit";

afterEach(() => setAbilityOverrides(new Map()));

const creature = (title: string, house: string, power: number, text = "") => card(title, { type: "Creature", house, power, text });
const face = (text: string, type = "Action"): CardFace => ({ id: "p", title: "Probe", house: "Logos", type, image: "", text, amber: 0, power: 2, armor: 0 });
const acts = (text: string, type = "Action") => parseCardText(face(text, type)).abilities;

const BRYN = "After Fight: Steal 1<A>. If a blue key is forged, ward ~.";
const RUBY = "After Fight: If a red key is forged, deal 4<D> to each enemy flank creature. Otherwise, deal 1<D> to each enemy flank creature.";
const SABOTEURS = "Elusive.\nAfter Reap: If your red key is forged, destroy an enemy creature. If your yellow key is forged, destroy an enemy artifact. If your blue key is forged, destroy an enemy upgrade.";
const HORDE = "Play: For each color represented among forged keys, steal 1<A>.";

describe("DSL_VERSION 8", () => {
  it("accepts the new literals and rejects what would loop or dangle", () => {
    expect(DSL_VERSION).toBe(8);
    const row = (dsl: unknown[], extra: object = {}) => ({ cardId: "c", dsl, textHash: "h", source: "manual" as const, v: 8, ...extra });
    const good = [
      [{ on: ["play"], acts: [{ k: "steal", n: 1, per: { p: "keyColors", any: true } }] }],
      [{ on: ["fight"], acts: [{ k: "ward", s: "self", if: { k: "key", color: "blue", any: true } }] }],
      [{ on: ["play"], target: { type: "Creature", amber: true }, target2: { type: "Creature" }, acts: [{ k: "moveAmber", s: "target", to: "target2" }] }],
      [{ on: ["play"], acts: [{ k: "damage", n: 1, s: { pick: { type: "Creature" }, n: 3, upTo: true } }] }],
      [{ on: ["play"], target: { type: "Creature" }, acts: [{ k: "toFlank", s: "target" }] }],
      [{ on: ["play"], acts: [{ k: "move", n: 1, from: "deck", to: "discard", until: { house: "Logos" } }] }],
      [{ on: ["discard"], of: {}, acts: [{ k: "archiveTop" }] }],
    ];
    for (const dsl of good) expect(normaliseAbilityOverride(row(dsl))?.v).toBe(8);
    expect(normaliseAbilityOverride(row(good[0], { v: 9 }))).toBeNull();
    const bad = [
      [{ on: ["fight"], acts: [{ k: "ward", s: "self", if: { k: "key", color: "green" } }] }],
      [{ on: ["play"], acts: [{ k: "steal", n: 1, per: { p: "amber", any: true } }] }],
      [{ on: ["play"], acts: [{ k: "moveAmber", s: "target", to: "target2" }], target: { type: "Creature" } }],
      [{ on: ["play"], target2: { type: "Creature" }, acts: [{ k: "destroy", s: "target2" }] }],
      [{ on: ["play"], acts: [{ k: "damage", n: 1, s: { pick: {}, upTo: "yes" } }] }],
      [{ on: ["play"], acts: [{ k: "move", n: 1, from: "hand", to: "discard", until: { house: "Logos" } }] }],
      [{ on: ["play"], acts: [{ k: "move", n: 1, from: "deck", to: "discard", until: { rarity: "rare" } }] }],
      [{ on: ["discard"], acts: [{ k: "archiveTop" }] }],
      [{ on: ["discard"], of: {}, acts: [{ k: "discardRandom", n: 1 }] }],
      [{ on: ["discard"], of: {}, acts: [{ k: "move", n: 1, from: "hand", to: "discard" }] }],
    ];
    for (const dsl of bad) expect(normaliseAbilityOverride(row(dsl))).toBeNull();
  });
});

describe("7.2 key colors", () => {
  it("parses the three wordings and the distinct count", () => {
    expect(acts(BRYN, "Creature")[0].acts[1]).toEqual({ k: "ward", s: "self", if: { k: "key", color: "blue", any: true } });
    const ruby = acts(RUBY, "Creature");
    expect(ruby).toHaveLength(2);
    expect(ruby[1].if).toEqual({ k: "not", c: { k: "key", color: "red", any: true } });
    const saboteurs = acts(SABOTEURS, "Creature");
    expect(saboteurs).toHaveLength(1);
    expect(saboteurs[0].acts.map((act) => act.if)).toEqual([{ k: "key", color: "red" }, { k: "key", color: "yellow" }, { k: "key", color: "blue" }]);
    expect(acts(HORDE)[0].acts).toEqual([{ k: "steal", n: 1, per: { p: "keyColors", any: true } }]);
    expect(acts("Play: If your opponent's blue key is forged, gain 1<A>.")[0].if).toEqual({ k: "key", color: "blue", opp: true });
  });

  it("forge takes the colors in the side's order and unforge gives the last one back", () => {
    let state = setupTest({ amber: 0 }, {}, "Logos");
    state = forgeKey(state, 0, 2, { free: true });
    expect(forgedKeyColors(state, 0)).toEqual(["red", "yellow"]);
    state = setKeyOrder(state, 1, ["blue", "red", "yellow"]);
    state = forgeKey(state, 1, 1, { free: true });
    expect(forgedKeyColors(state, 1)).toEqual(["blue"]);
    // Not a permutation: ignored.
    expect(setKeyOrder(state, 1, ["red", "red", "blue"]).players[1].keyOrder).toEqual(["blue", "red", "yellow"]);
    // A save without colors is completed from `keys`.
    const old = setupTest({ keys: 2 }, {}, "Logos");
    expect(forgedKeyColors(old, 0)).toHaveLength(2);
  });

  it("defaults to the color the deck's own cards cite", () => {
    const payoff = creature("Payoff", "Logos", 2, "After Fight: If your blue key is forged, gain 1<A>.");
    const state = forgeKey(setupTest({ inPlay: [payoff] }, {}, "Logos"), 0, 1, { free: true });
    expect(forgedKeyColors(state, 0)).toEqual(["blue"]);
  });

  it("Deep Blue Bryn wards itself only once a blue key exists (either side)", () => {
    const run = (state: GameState) => {
      const bryn = byTitle(state.players[0].board, "Bryn")!;
      const next = applyMove(state, 0, { type: "fight", attackerId: bryn.instanceId, targetId: state.players[1].board[0].instanceId });
      return byTitle(next.players[0].board, "Bryn")?.warded ?? 0;
    };
    const make = () => setupTest({ inPlay: [creature("Bryn", "Logos", 12, BRYN)] }, { inPlay: [creature("Dummy", "Dis", 9)] }, "Logos");
    expect(run(make())).toBe(0);
    // Only the opponent forged blue: "a blue key" counts.
    let foe = setKeyOrder(make(), 1, ["blue", "red", "yellow"]);
    foe = forgeKey(foe, 1, 1, { free: true });
    expect(run(foe)).toBe(1);
    // Own yellow/red keys are not blue.
    const mine = forgeKey(setKeyOrder(make(), 0, ["red", "yellow", "blue"]), 0, 2, { free: true });
    expect(run(mine)).toBe(0);
  });

  it("Ruby Rackham: 4 to each enemy flank with a red key, 1 without", () => {
    const board = () => [creature("L", "Dis", 9), creature("M", "Dis", 9), creature("R", "Dis", 9)];
    const fightWith = (keys: number) => {
      let state = setupTest({ inPlay: [creature("Ruby", "Logos", 20, RUBY)] }, { inPlay: board() }, "Logos");
      state = forgeKey(setKeyOrder(state, 1, ["red", "yellow", "blue"]), 1, keys, { free: true });
      const ruby = byTitle(state.players[0].board, "Ruby")!;
      const next = applyMove(state, 0, { type: "fight", attackerId: ruby.instanceId, targetId: state.players[1].board[1].instanceId });
      return ["L", "M", "R"].map((title) => byTitle(next.players[1].board, title)?.damage ?? 0);
    };
    // Fight damage of the middle creature (5) lands on M too, so compare the flanks only.
    const noKey = fightWith(0);
    const redKey = fightWith(1);
    expect([noKey[0], noKey[2]]).toEqual([1, 1]);
    expect([redKey[0], redKey[2]]).toEqual([4, 4]);
  });

  it("Skulking Saboteurs resolves each color on its own", () => {
    const setup = (colors: ("red" | "yellow" | "blue")[]) => {
      const target = creature("Victim", "Dis", 3);
      const art = card("Relic", { type: "Artifact", house: "Dis" });
      let state = setupTest({ inPlay: [creature("Sab", "Logos", 3, SABOTEURS)] }, { inPlay: [target, art] }, "Logos");
      state = setKeyOrder(state, 0, [...colors, ...(["red", "yellow", "blue"] as const).filter((c) => !colors.includes(c))] as never);
      state = forgeKey(state, 0, colors.length, { free: true });
      const sab = byTitle(state.players[0].board, "Sab")!;
      const next = applyMove(state, 0, { type: "reap", instanceId: sab.instanceId });
      return { victim: !!byTitle(next.players[1].board, "Victim"), relic: !!byTitle(next.players[1].board, "Relic") };
    };
    expect(setup([])).toEqual({ victim: true, relic: true });
    // Only yellow forged: the creature survives but the artifact goes.
    expect(setup(["yellow"])).toEqual({ victim: true, relic: false });
    expect(setup(["red"])).toEqual({ victim: false, relic: true });
    expect(setup(["red", "yellow"])).toEqual({ victim: false, relic: false });
  });

  it("Glittering Horde steals once per distinct color across both sides", () => {
    const play = (mine: number, theirs: number, foeOrder: ("red" | "yellow" | "blue")[] = ["red", "yellow", "blue"]) => {
      const horde = card("Horde", { type: "Action", house: "Logos", text: HORDE });
      let state = setupTest({ hand: [horde] }, { amber: 9 }, "Logos");
      state = setKeyOrder(state, 0, ["red", "yellow", "blue"]);
      state = setKeyOrder(state, 1, foeOrder);
      state = forgeKey(state, 0, mine, { free: true });
      state = forgeKey(state, 1, theirs, { free: true });
      return applyMove(state, 0, { type: "play", instanceId: horde.instanceId }).players[0].amber;
    };
    expect(play(0, 0)).toBe(0);
    // Both sides forged red first: still one color.
    expect(play(1, 1)).toBe(1);
    expect(play(2, 1)).toBe(2);
    expect(play(2, 1, ["blue", "red", "yellow"])).toBe(3);
    expect(play(0, 2)).toBe(2);
  });

  it("the colors survive a turn's key step", () => {
    // The key step is the first step of the NEXT turn: the opponent forges as the turn passes.
    const state = setupTest({}, { amber: 6 }, "Logos");
    const next = endTurn(state, 0);
    expect(next.players[1].keys).toBe(1);
    expect(forgedKeyColors(next, 1)).toHaveLength(1);
  });
});

describe("7.1 targets[] — two cards, up to N, flank", () => {
  const DITCH = "Play: Move all <A> from one creature to another creature.";
  const STARS = "Play: Deal 1<D> to up to three creatures. Gain 1<A> for each creature destroyed this way.";
  const CONRAD = "Play: You may move each +1 power counter from a creature to another creature.";
  const BARREL = "Play: Move a creature to a flank of its controller's battleline and exhaust it.";

  it("Ditch the Loot moves the amber from the first target to the queued second one", () => {
    const rich = creature("Rich", "Dis", 3);
    rich.amber = 3;
    const a = creature("A", "Dis", 3);
    const b = creature("B", "Dis", 3);
    const action = card("Ditch", { type: "Action", house: "Logos", text: DITCH });
    const state = setupTest({ hand: [action] }, { inPlay: [rich, a, b] }, "Logos");
    const move = { type: "play" as const, instanceId: action.instanceId, target: rich.instanceId };
    expect(pendingPrompt(state, 0, move)).toMatchObject({ kind: "target2", ids: [a.instanceId, b.instanceId] });
    const chosen = applyMove(state, 0, { ...move, targets: [b.instanceId] });
    expect(byTitle(chosen.players[1].board, "B")?.amber).toBe(3);
    expect(byTitle(chosen.players[1].board, "Rich")?.amber ?? 0).toBe(0);
    // No answer: the engine picks another creature, never the source itself.
    const auto = applyMove(state, 0, move);
    expect(byTitle(auto.players[1].board, "Rich")?.amber ?? 0).toBe(0);
    expect(auto.players[1].board.reduce((sum, item) => sum + (item.amber ?? 0), 0)).toBe(3);
  });

  it("Ditch the Loot does nothing when only one creature is in play", () => {
    const solo = creature("Solo", "Dis", 3);
    solo.amber = 2;
    const action = card("Ditch", { type: "Action", house: "Logos", text: DITCH });
    const state = setupTest({ hand: [action] }, { inPlay: [solo] }, "Logos");
    const next = applyMove(state, 0, { type: "play", instanceId: action.instanceId, target: solo.instanceId });
    expect(byTitle(next.players[1].board, "Solo")?.amber).toBe(2);
  });

  it("Cŏnrăd moves every +1 power counter, and declining moves none", () => {
    const loaded = creature("Loaded", "Dis", 3);
    loaded.counters = 3;
    const other = creature("Other", "Dis", 3);
    const conrad = card("Conrad", { type: "Creature", house: "Logos", text: CONRAD, power: 2 });
    const state = setupTest({ hand: [conrad] }, { inPlay: [loaded, other] }, "Logos");
    const move = { type: "play" as const, instanceId: conrad.instanceId, target: loaded.instanceId, targets: [other.instanceId] };
    const done = applyMove(state, 0, move);
    expect(byTitle(done.players[1].board, "Other")?.counters).toBe(3);
    expect(byTitle(done.players[1].board, "Loaded")?.counters ?? 0).toBe(0);
    const declined = applyMove(state, 0, { ...move, decline: true });
    expect(byTitle(declined.players[1].board, "Loaded")?.counters).toBe(3);
  });

  it("Throwing Stars hits only the queued creatures, at most three, and counts the dead", () => {
    const weak = [creature("W1", "Dis", 1), creature("W2", "Dis", 1), creature("W3", "Dis", 1), creature("W4", "Dis", 1)];
    const stars = card("Stars", { type: "Action", house: "Logos", text: STARS });
    const state = setupTest({ hand: [stars] }, { inPlay: weak }, "Logos");
    const ids = weak.map((item) => item.instanceId);
    const run = (targets?: string[]) => applyMove(state, 0, { type: "play", instanceId: stars.instanceId, ...(targets ? { targets } : {}) });
    const four = run(ids);
    expect(four.players[1].board.map((item) => item.face.title)).toEqual(["W4"]);
    expect(four.players[0].amber).toBe(3);
    const two = run([ids[0], ids[3]]);
    expect(two.players[1].board.map((item) => item.face.title)).toEqual(["W2", "W3"]);
    expect(two.players[0].amber).toBe(2);
    // The queue is not guessed: no answer, no damage.
    const none = run();
    expect(none.players[1].board).toHaveLength(4);
    expect(none.players[0].amber).toBe(0);
    // An id outside the filter is ignored.
    expect(run(["nope"]).players[1].board).toHaveLength(4);
  });

  it("asks the human for the cards and offers the AI a none/best pair", () => {
    const foes = [creature("F1", "Dis", 5), creature("F2", "Dis", 2), creature("F3", "Dis", 8), creature("F4", "Dis", 1)];
    const stars = card("Stars", { type: "Action", house: "Logos", text: STARS });
    const state = setupTest({ hand: [stars] }, { inPlay: foes }, "Logos");
    expect(pendingPrompt(state, 0, { type: "play", instanceId: stars.instanceId })).toMatchObject({ kind: "targets", max: 3 });
    expect(pendingPrompt(state, 0, { type: "play", instanceId: stars.instanceId, targets: [] })).toBeNull();
    const plays = getLegalMoves(state, 0).filter((move) => move.type === "play");
    expect(plays).toHaveLength(2);
    const best = plays.find((move) => move.targets?.length);
    // Enemies only, strongest first, never more than three.
    expect(best?.targets).toEqual([foes[2].instanceId, foes[0].instanceId, foes[1].instanceId]);
  });

  it("the AI never offers a harmful 'any number' of its own creatures; the human still can", () => {
    const cull = card("Cull", { type: "Action", house: "Logos", text: "Play: Destroy any number of friendly creatures. Gain 1<A> for each creature destroyed this way." });
    const mine = [creature("M1", "Logos", 2), creature("M2", "Logos", 2)];
    const state = setupTest({ hand: [cull], inPlay: mine }, { inPlay: [creature("Foe", "Dis", 3)] }, "Logos");
    const plays = getLegalMoves(state, 0).filter((move) => move.type === "play");
    expect(plays).toHaveLength(1);
    expect(plays[0].targets).toBeUndefined();
    // With no queue the act destroys nothing (the AI's skip) …
    const skipped = applyMove(state, 0, plays[0]);
    expect(skipped.players[0].board).toHaveLength(2);
    expect(skipped.players[0].amber).toBe(0);
    // … and the human's queue is honoured.
    const human = applyMove(state, 0, { type: "play", instanceId: cull.instanceId, targets: [mine[0].instanceId] });
    expect(human.players[0].board.map((item) => item.face.title)).toEqual(["M2"]);
    expect(human.players[0].amber).toBe(1);
  });

  it("Barrel Roll sends the creature to the chosen flank and exhausts it", () => {
    const line = [creature("A", "Dis", 3), creature("B", "Dis", 3), creature("C", "Dis", 3)];
    const roll = card("Roll", { type: "Action", house: "Logos", text: BARREL });
    const state = setupTest({ hand: [roll] }, { inPlay: line }, "Logos");
    const move = { type: "play" as const, instanceId: roll.instanceId, target: line[1].instanceId };
    expect(pendingPrompt(state, 0, move)).toEqual({ kind: "flank", ids: [] });
    expect(pendingPrompt(state, 0, { ...move, flank: "right" })).toBeNull();
    const left = applyMove(state, 0, { ...move, flank: "left" });
    expect(left.players[1].board.map((item) => item.face.title)).toEqual(["B", "A", "C"]);
    expect(left.players[1].board[0].ready).toBe(false);
    const right = applyMove(state, 0, { ...move, flank: "right" });
    expect(right.players[1].board.map((item) => item.face.title)).toEqual(["A", "C", "B"]);
  });
});

describe("7.3 move.until", () => {
  const LETHO = "Play: Discard cards from the top of your deck until you discard a Logos card or run out of cards. If you discard a Logos card this way, put it into your hand.";
  const lethologica = () => card("Letho", { type: "Action", house: "Logos", text: LETHO });
  const filler = (title: string, house: string) => card(title, { type: "Creature", house, power: 2 });

  it("parses to a deck mill with the stop and a pick of the moved card", () => {
    expect(acts(LETHO)[0].acts).toEqual([
      { k: "move", n: 1, from: "deck", to: "discard", pick: "top", until: { house: "Logos" } },
      { k: "move", n: 1, from: "discard", to: "hand", pick: "moved", house: "Logos" },
    ]);
  });

  it("stops at the first Logos card (kept) and puts it into the hand", () => {
    // The deck's top is the array's end: D3, D2, Logos, D1 from the top.
    const deck = [filler("D1", "Dis"), filler("Wanted", "Logos"), filler("D2", "Dis"), filler("D3", "Dis")];
    const action = lethologica();
    const state = setupTest({ hand: [action], deck }, {}, "Logos");
    const next = applyMove(state, 0, { type: "play", instanceId: action.instanceId });
    expect(next.players[0].hand.map((item) => item.face.title)).toEqual(["Wanted"]);
    expect(next.players[0].discard.map((item) => item.face.title).sort()).toEqual(["D2", "D3", "Letho"]);
    expect(next.players[0].deck.map((item) => item.face.title)).toEqual(["D1"]);
  });

  it("runs out of cards without a match: the whole deck is milled and nothing returns", () => {
    const deck = [filler("D1", "Dis"), filler("D2", "Dis")];
    const action = lethologica();
    const next = applyMove(setupTest({ hand: [action], deck }, {}, "Logos"), 0, { type: "play", instanceId: action.instanceId });
    expect(next.players[0].deck).toHaveLength(0);
    expect(next.players[0].hand).toHaveLength(0);
    expect(next.players[0].discard).toHaveLength(3);
  });

  it("an empty deck is a no-op", () => {
    const action = lethologica();
    const next = applyMove(setupTest({ hand: [action], deck: [] }, {}, "Logos"), 0, { type: "play", instanceId: action.instanceId });
    expect(next.players[0].hand).toHaveLength(0);
    expect(next.players[0].discard).toHaveLength(1);
  });

  it("the safety cap bounds a very long deck", () => {
    const deck = Array.from({ length: 260 }, (_, index) => filler(`X${index}`, "Dis"));
    const action = lethologica();
    const next = applyMove(setupTest({ hand: [action], deck }, {}, "Logos"), 0, { type: "play", instanceId: action.instanceId });
    expect(next.players[0].deck).toHaveLength(60);
    expect(next.players[0].discard).toHaveLength(201);
  });
});

describe("7.3 discard trigger", () => {
  const ENCODER = "After a card is discarded from your hand, archive the top card of your deck.";

  it("parses the three hands", () => {
    expect(acts(ENCODER, "Artifact")[0]).toMatchObject({ on: ["discard"], of: {}, if: { k: "actor" }, acts: [{ k: "archiveTop" }] });
    expect(acts("After a card is discarded from your opponent's hand, gain 1<A>.", "Artifact")[0].if).toEqual({ k: "actor", opp: true });
    expect(acts("After a card is discarded from a player's hand, gain 1<A>.", "Artifact")[0].if).toBeUndefined();
  });

  const encoder = () => card("Encoder", { type: "Artifact", house: "Logos", text: ENCODER });

  it("archives the top card when its owner discards from hand (the discard move)", () => {
    const artifact = encoder();
    const pitch = card("Pitch", { type: "Creature", house: "Logos" });
    const top = card("Top", { type: "Creature", house: "Logos" });
    const state = setupTest({ inPlay: [artifact], hand: [pitch], deck: [card("Under"), top] }, {}, "Logos");
    const next = applyMove(state, 0, { type: "discard", instanceId: pitch.instanceId });
    expect(next.players[0].archives.map((item) => item.face.title)).toEqual(["Top"]);
  });

  it("reacts to a discard by effect but not to a mill", () => {
    const artifact = encoder();
    const mill = card("Mill", { type: "Action", house: "Logos", text: "Play: Discard the top 2 cards of your deck. Discard a card." });
    const spare = card("Spare", { type: "Creature", house: "Dis" });
    const state = setupTest({ inPlay: [artifact], hand: [mill, spare], deck: [card("D1"), card("D2"), card("D3"), card("D4")] }, {}, "Logos");
    const next = applyMove(state, 0, { type: "play", instanceId: mill.instanceId });
    // Two milled cards do not trigger; the one hand discard does: exactly one archived.
    expect(next.players[0].archives).toHaveLength(1);
    expect(next.players[0].discard).toHaveLength(4);
  });

  it("a hand watcher with no `if` hears either side; the 'actor' one only its own", () => {
    const own = card("Own", { type: "Artifact", house: "Logos", text: ENCODER });
    const any: Ability[] = [{ on: ["discard"], of: {}, acts: [{ k: "gainAmber", n: 1 }] }];
    const anyCard = card("Any", { type: "Artifact", house: "Logos", text: "After a card is discarded from a player's hand, gain 1<A>." });
    expect(parseCardText(anyCard.face).abilities).toEqual(any);
    const foeDiscard = card("Chaos", { type: "Action", house: "Logos", text: "Play: Your opponent discards a random card from their hand." });
    const state = setupTest({ inPlay: [own, anyCard], hand: [foeDiscard], deck: [card("T")] }, { hand: [card("Held")] }, "Logos");
    const next = applyMove(state, 0, { type: "play", instanceId: foeDiscard.instanceId });
    expect(next.players[1].discard.map((item) => item.face.title)).toEqual(["Held"]);
    expect(next.players[0].amber).toBe(1);
    expect(next.players[0].archives).toHaveLength(0);
  });

  it("the opponent's artifact watches this side's discards when it has no `if`", () => {
    const enemyWatcher = card("Spy", { type: "Artifact", house: "Dis", text: "After a card is discarded from a player's hand, gain 1<A>." });
    const pitch = card("Pitch", { type: "Creature", house: "Logos" });
    const state = setupTest({ hand: [pitch] }, { inPlay: [enemyWatcher] }, "Logos");
    const next = applyMove(state, 0, { type: "discard", instanceId: pitch.instanceId });
    expect(next.players[1].amber).toBe(1);
  });

  it("a self-feeding watcher is stopped by the observer budgets", () => {
    const hand = Array.from({ length: 150 }, (_, index) => card(`H${index}`, { type: "Creature", house: "Logos" }));
    const watcher = card("Loop", { type: "Artifact", house: "Logos", text: "Loop." });
    const loop: AbilityOverride = {
      cardId: watcher.face.id,
      dsl: [{ on: ["discard"], of: {}, acts: [{ k: "move", n: 1, from: "hand", to: "discard" }] }],
      textHash: textHash(watcher.face.text ?? ""),
      source: "manual",
      reviewed: true,
      generatedAt: 1,
    };
    setAbilityOverrides(new Map([[watcher.face.id, loop]]));
    const state = setupTest({ inPlay: [watcher], hand }, {}, "Logos");
    const next = applyMove(state, 0, { type: "discard", instanceId: hand[0].instanceId });
    const discarded = next.players[0].discard.length;
    expect(discarded).toBeGreaterThan(1);
    expect(discarded).toBeLessThanOrEqual(101);
    expect(next.players[0].hand.length).toBeGreaterThan(40);
  });

  describe("self-observation stays legitimate outside discard", () => {
    const watch = (c: CardInstance, ability: Ability): void => {
      setAbilityOverrides(new Map([[c.face.id, {
        cardId: c.face.id, dsl: [ability], textHash: textHash(c.face.text ?? ""), source: "manual" as const, reviewed: true, generatedAt: 1,
      }]]));
    };

    it("a creature that reaps fires its own 'each time a friendly creature reaps'", () => {
      const self = creature("Imp", "Dis", 2, "Each time a friendly creature reaps, gain 1.");
      watch(self, { on: ["reap"], of: { type: "Creature", side: "friendly" }, acts: [{ k: "gainAmber", n: 1 }] });
      const next = applyMove(setupTest({ inPlay: [self] }, {}, "Dis"), 0, { type: "reap", instanceId: self.instanceId });
      expect(next.players[0].amber).toBe(2); // 1 from the reap + 1 from itself
    });

    it("a creature that fights fires its own 'each time a creature fights'", () => {
      const self = creature("Brawler", "Brobnar", 5, "Each time a creature fights, gain 1.");
      watch(self, { on: ["fight"], of: { type: "Creature" }, acts: [{ k: "gainAmber", n: 1 }] });
      const foe = creature("Foe", "Dis", 1);
      const state = setupTest({ inPlay: [self] }, { inPlay: [foe] }, "Brobnar");
      const next = applyMove(state, 0, { type: "fight", attackerId: self.instanceId, targetId: foe.instanceId });
      expect(next.players[0].amber).toBe(1);
    });

    it("a creature that readies fires its own 'after a player readies a creature'", () => {
      const self = creature("Rested", "Brobnar", 3, "After a player readies a creature, gain 1.");
      watch(self, { on: ["ready"], of: { type: "Creature" }, acts: [{ k: "gainAmber", n: 1 }] });
      self.ready = false;
      const next = endTurn(setupTest({ inPlay: [self] }, {}, "Brobnar"), 0);
      expect(next.players[0].amber).toBe(1);
    });
  });

  it("the discarded card never watches itself", () => {
    // A watcher on the board that discards ITSELF from hand is not on the board any more: nothing fires.
    const self: CardInstance = card("Selfish", { type: "Creature", house: "Logos", text: "After a card is discarded from a player's hand, gain 1<A>." });
    const state = setupTest({ hand: [self] }, {}, "Logos");
    const next = applyMove(state, 0, { type: "discard", instanceId: self.instanceId });
    expect(next.players[0].amber).toBe(0);
  });
});
