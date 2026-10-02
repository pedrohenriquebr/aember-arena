// SPDX-License-Identifier: AGPL-3.0-only
// Lote 2 da DSL (docs/DSL_EXPANSION_PLAN.md §2): quantidades dinâmicas (`per`),
// condições de act (`if` com did/gone/haunted), filtros por casa/traço/exaustão,
// custo de chave persistente, picks, `fought`, o act `move` das zonas do jogador
// e o gatilho Scrap. Onde o texto impresso não é o objeto do teste, o DSL é
// escrito à mão numa linha `manual` (como uma carta curada) para prender a
// primitiva da engine.
import { afterEach, describe, expect, it } from "vitest";
import { type Ability, type AbilityOverride, normaliseAbilityOverride, rulesOf, setAbilityOverrides } from "./abilities";
import { textHash } from "./cardText";
import {
  applyMove,
  canResolve,
  effectivePower,
  getLegalMoves,
  isLegalMove,
  keyCost,
  moveHasEffect,
  targetChoices,
  type CardFace,
  type CardInstance,
  type GameState,
} from "./game";
import { byTitle, card, setupTest, titles } from "./testkit";

const creature = (title: string, power: number, text = "", extra: Partial<CardFace> = {}, ready = true) =>
  card(title, { type: "Creature", house: "Brobnar", power, text, ...extra }, ready);

/** Hand-written DSL for the cards of one test (a single override map, so a later
    `setAbilityOverrides` never drops an earlier card's rules). */
function script(items: [string, Ability[], Partial<CardFace>?][]): CardInstance[] {
  const rows: [string, AbilityOverride][] = [];
  const cards = items.map(([title, dsl, extra = {}]) => {
    const item = creature(title, extra.power ?? 3, extra.text ?? "", extra);
    rows.push([
      item.face.id,
      { cardId: item.face.id, dsl, textHash: textHash(item.face.text ?? ""), source: "manual", reviewed: true, generatedAt: 1 },
    ]);
    return item;
  });
  setAbilityOverrides(new Map(rows));
  return cards;
}

const board = (state: GameState, side: 0 | 1, title: string) => byTitle(state.players[side].board, title)!;

function play(state: GameState, side: 0 | 1, title: string): GameState {
  const item = byTitle(state.players[side].hand, title);
  if (!item) throw new Error(`${title} not in hand`);
  return applyMove(state, side, { type: "play", instanceId: item.instanceId });
}

function fight(state: GameState, side: 0 | 1, attacker: string, defender: string): GameState {
  const enemy = side === 0 ? 1 : 0;
  return applyMove(state, side, {
    type: "fight",
    attackerId: byTitle(state.players[side].board, attacker)!.instanceId,
    targetId: byTitle(state.players[enemy].board, defender)!.instanceId,
  });
}

/** Every non-token card in every zone (the conservation invariant of §1.4). */
const totalCards = (state: GameState) =>
  state.players.reduce(
    (total, player) =>
      total + [...player.hand, ...player.board, ...player.discard, ...player.deck, ...player.archives, ...player.purged].filter((item) => !item.isToken).length,
    0,
  );

afterEach(() => setAbilityOverrides(new Map()));

describe("2.1 per: the dynamic amount", () => {
  it("'for each creature healed this way' counts the cards the heal touched (did)", () => {
    const wave = creature("Wave", 1, "Play: Heal 1<D> from each creature. Gain 1<A> for each creature healed this way.");
    const state = setupTest({ hand: [wave], inPlay: [creature("Mine", 3)] }, { inPlay: [creature("Theirs", 3)] });
    for (const player of state.players) for (const item of player.board) item.damage = 1;
    const next = play(state, 0, "Wave");
    // One amber per healed creature; the 0-damage source itself was not changed.
    expect(next.players[0].amber).toBe(2);
    expect(next.players[0].board.map((item) => item.damage)).toEqual([0, 0]);
  });

  it("'for each creature destroyed this way' uses gone, not did", () => {
    const cleanup = card("Cleanup", { type: "Action", house: "Brobnar", text: "Play: Destroy each damaged creature. Gain 1<A> for each creature destroyed this way." });
    const state = setupTest({ hand: [cleanup] }, { inPlay: [creature("Doomed", 2), creature("Whole", 4)] });
    state.players[1].board[0].damage = 2;
    const next = play(state, 0, "Cleanup");
    expect(titles(next.players[1].board)).toEqual(["Whole"]);
    expect(next.players[0].amber).toBe(1);
  });

  it("an act with no selection counts the largest counter delta (hand -> discard)", () => {
    const mill = card("Mill", { type: "Action", house: "Brobnar", text: "Play: Discard a card. Gain 1<A> for each card discarded this way." });
    const state = setupTest({ hand: [mill, creature("Kept", 2, "", { house: "Dis" }), creature("Off", 2, "", { house: "Dis" })] });
    const next = play(state, 0, "Mill");
    expect(next.players[0].amber).toBe(1);
    // The move discarded the off-house card (the controller's pick) and the
    // resolved Action followed it into the pile.
    expect(titles(next.players[0].discard)).toEqual(["Kept", "Mill"]);
  });

  it("per multiplies n: a count of 0 makes the act a no-op", () => {
    const [pulse] = script([["Pulse", [{ on: ["play"], acts: [{ k: "gainAmber", n: 1, per: { p: "hand" } }] }]]]);
    const empty = play(setupTest({ hand: [pulse] }), 0, "Pulse");
    expect(empty.players[0].amber).toBe(0);
    const two = play(setupTest({ hand: [pulse, creature("A", 1), creature("B", 1)] }), 0, "Pulse");
    expect(two.players[0].amber).toBe(2); // the hand held two cards when it resolved
  });
});

describe("2.2 act.if: the condition of a later clause", () => {
  const mender = () =>
    card("Mender", { type: "Action", house: "Brobnar", text: "Play: Heal 2<D> from a creature. If you do, draw a card." });

  it("gates the act on what the act before it did (did 0 skips)", () => {
    const untouched = setupTest({ hand: [mender()], deck: [creature("Drawn", 1)] }, { inPlay: [creature("Whole", 3)] });
    const skipped = play(untouched, 0, "Mender");
    expect(skipped.players[0].hand).toHaveLength(0);
    expect(skipped.players[0].deck).toHaveLength(1);

    const wounded = setupTest({ hand: [mender()], deck: [creature("Drawn", 1)] }, { inPlay: [creature("Hurt", 3)] });
    wounded.players[1].board[0].damage = 2;
    const drawn = play(wounded, 0, "Mender");
    expect(titles(drawn.players[0].hand)).toEqual(["Drawn"]);
  });

  it("a skipped act zeroes did/gone for the act after it", () => {
    const [chain] = script([
      [
        "Chain",
        [
          {
            on: ["play"],
            acts: [
              { k: "gainAmber", n: 1 },
              { k: "draw", n: 1, if: { k: "count", of: "did", op: "gte", n: 5 } },
              { k: "gainAmber", n: 1, per: "did" },
            ],
          },
        ],
      ],
    ]);
    const state = setupTest({ hand: [chain], deck: [creature("D1", 1), creature("D2", 1)] });
    const next = play(state, 0, "Chain");
    // The second act was skipped (1 < 5) and zeroed the did: the per act adds nothing.
    expect(next.players[0].amber).toBe(1);
    expect(next.players[0].hand).toHaveLength(0);
  });

  it("if you are haunted (10+ cards in the discard) picks the first branch, its negation the other", () => {
    const text = "Play: If you are haunted, deal 5<D> to a creature. Otherwise, return a creature to its owner's hand.";
    const filed = (n: number) => Array.from({ length: n }, (_, index) => creature(`Filed ${index}`, 1));
    const haunted = setupTest({ hand: [card("Haunt", { type: "Action", house: "Brobnar", text })], discard: filed(10) }, { inPlay: [creature("Prey", 3)] });
    const dead = play(haunted, 0, "Haunt");
    expect(dead.players[1].board).toHaveLength(0);
    expect(titles(dead.players[1].discard)).toEqual(["Prey"]);

    const calm = setupTest({ hand: [card("Haunt", { type: "Action", house: "Brobnar", text })], discard: filed(9) }, { inPlay: [creature("Prey", 3)] });
    const bounced = play(calm, 0, "Haunt");
    expect(bounced.players[1].board).toHaveLength(0);
    expect(titles(bounced.players[1].hand)).toEqual(["Prey"]);
  });

  it("'if this damage destroys that creature' reads gone", () => {
    const sniper = card("Sniper", { type: "Action", house: "Brobnar", text: "Play: Deal 3<D> to a creature. If this damage destroys that creature, gain 2<A>." });
    const lethal = play(setupTest({ hand: [sniper] }, { inPlay: [creature("Frail", 2)] }), 0, "Sniper");
    expect(lethal.players[0].amber).toBe(2);
    const survived = play(setupTest({ hand: [sniper] }, { inPlay: [creature("Stout", 6)] }), 0, "Sniper");
    expect(survived.players[0].amber).toBe(0);
  });
});

describe("2.3 filters: house, trait and exhaustion", () => {
  it("house and !house narrow the selection, case-insensitively", () => {
    const purge = card("Purge", { type: "Action", house: "Brobnar", text: "Play: Destroy each non-Mars creature." });
    const state = setupTest({ hand: [purge] }, { inPlay: [creature("Martian", 3, "", { house: "Mars" }), creature("Logical", 3, "", { house: "Logos" })] });
    const next = play(state, 0, "Purge");
    expect(titles(next.players[1].board)).toEqual(["Martian"]);
  });

  it("a trait filter reads face.traits (•-separated)", () => {
    const banner = creature("Banner", 2, "Each friendly Knight creature gets +1 power.");
    const state = setupTest({ inPlay: [creature("Sir", 2, "", { traits: "Knight • Soldier" }), creature("Grunt", 2, "", { traits: "Soldier" }), banner] });
    expect(effectivePower(state, board(state, 0, "Sir"))).toBe(3);
    expect(effectivePower(state, board(state, 0, "Grunt"))).toBe(2);
  });

  it("exhausted:true is !card.ready and does not disturb the ready filter", () => {
    const sweep = card("Sweep", { type: "Action", house: "Brobnar", text: "Play: Destroy each exhausted creature." });
    const state = setupTest(
      { hand: [sweep], inPlay: [creature("Tired", 3, "", {}, false), creature("Alert", 3)] },
      { inPlay: [creature("Also tired", 3, "", {}, false)] },
    );
    const next = play(state, 0, "Sweep");
    expect(titles(next.players[0].board)).toEqual(["Alert"]);
    expect(next.players[1].board).toHaveLength(0);
  });

  it("house 'active' reads state.activeHouse at query time", () => {
    const scout = creature("Scout", 2, "Reap: Gain 1<A> for each ready friendly creature of the active house.");
    const state = setupTest({ inPlay: [scout, creature("Mate", 2), creature("Stranger", 2, "", { house: "Dis" })] }, {}, "Brobnar");
    const next = applyMove(state, 0, { type: "reap", instanceId: scout.instanceId });
    // The reaping Scout is exhausted before the ability fires: only Mate counts.
    expect(next.players[0].amber).toBe(2);
  });
});

describe("2.4 persistent effects: if, per and keyCost", () => {
  it("'your opponent's keys cost +N for each …' charges exactly the other side", () => {
    const tax = creature("Tax", 2, "Your opponent's keys cost +1<A> for each card in your archives.");
    const state = setupTest({ inPlay: [tax] });
    state.players[0].archives = [creature("A1", 1), creature("A2", 1)];
    expect(keyCost(state, 0)).toBe(6);
    expect(keyCost(state, 1)).toBe(8);
  });

  it("a plain 'keys cost +N' is two effects (owner and opponent)", () => {
    const toll = creature("Toll", 2, "Keys cost +2<A>.");
    const state = setupTest({ inPlay: [toll] });
    expect(keyCost(state, 0)).toBe(8);
    expect(keyCost(state, 1)).toBe(8);
  });

  it("while you are haunted, ~ gets +N power", () => {
    const text = "While you are haunted, Ghost gets +3 power.";
    const filed = (n: number) => Array.from({ length: n }, (_, index) => creature(`Filed ${index}`, 1));
    const haunted = setupTest({ inPlay: [creature("Ghost", 2, text)], discard: filed(10) });
    const calm = setupTest({ inPlay: [creature("Ghost", 2, text)], discard: filed(9) });
    expect(effectivePower(haunted, board(haunted, 0, "Ghost"))).toBe(5);
    expect(effectivePower(calm, board(calm, 0, "Ghost"))).toBe(2);
  });

  it("'for each' scales a stat bonus", () => {
    const swarm = creature("Swarm", 2, "Swarm gets +1 power for each card in your archives.");
    const state = setupTest({ inPlay: [swarm] });
    state.players[0].archives = [creature("A1", 1), creature("A2", 1), creature("A3", 1)];
    expect(effectivePower(state, board(state, 0, "Swarm"))).toBe(5);
  });

  it("the shape gate rejects if/per that would recurse through effectivePower", () => {
    const target = { target: {} };
    // {of:"power"} and a `top` filter both reach effectivePower -> allEffects.
    expect(normaliseAbilityOverride(row({ ...target, power: 1, per: { of: "power", s: "self" } }))).toBeNull();
    expect(normaliseAbilityOverride(row({ ...target, armor: 1, per: { c: { type: "Creature", top: 2 } } }))).toBeNull();
    expect(normaliseAbilityOverride(row({ ...target, power: 1, if: { k: "count", of: { c: { type: "Creature", top: 1 } }, op: "gte", n: 1 } }))).toBeNull();
    // A count that never touches power is fine.
    expect(normaliseAbilityOverride(row({ ...target, keyCost: 1, per: { p: "archives" } }))).not.toBeNull();
  });
});

describe("2.5 picks and 'fought'", () => {
  it("a pick takes up to n distinct cards on the harmful side of the act", () => {
    const flare = card("Flare", { type: "Action", house: "Brobnar", text: "Play: Exhaust 2 enemy creatures." });
    const state = setupTest({ hand: [flare], inPlay: [creature("Ally", 2)] }, { inPlay: [creature("Weak", 2), creature("Strong", 5), creature("Middle", 3)] });
    const next = play(state, 0, "Flare");
    expect(titles(next.players[1].board.filter((item) => !item.ready))).toEqual(["Strong", "Middle"]);
    expect(next.players[0].board.filter((item) => !item.ready)).toHaveLength(0); // the helpful side stays ready
  });

  it("a helpful pick prefers the friendly side, strongest first", () => {
    const rally = card("Rally", { type: "Action", house: "Brobnar", text: "Play: Ready 2 friendly creatures." });
    const state = setupTest({
      hand: [rally],
      inPlay: [creature("Small", 2, "", {}, false), creature("Big", 5, "", {}, false), creature("Middle", 3, "", {}, false)],
    });
    const next = play(state, 0, "Rally");
    expect(titles(next.players[0].board.filter((item) => item.ready)).sort()).toEqual(["Big", "Middle"]);
  });

  it("'the creature ~ fights' resolves to the defender of the fight in progress", () => {
    const duelist = creature("Duelist", 3, "Before Fight: Deal 3<D> to the creature this card fights.");
    const state = setupTest({ inPlay: [duelist] }, { inPlay: [creature("Victim", 2)] });
    const next = fight(state, 0, "Duelist", "Victim");
    // The Before Fight damage killed the defender before the exchange: the
    // attacker is untouched and is credited with the kill.
    expect(titles(next.players[1].discard)).toEqual(["Victim"]);
    expect(board(next, 0, "Duelist").damage).toBe(0);
    expect(next.players[0].creaturesDestroyed).toBe(1);
  });
});

describe("2.6 move: the player zones", () => {
  it("discards the top N of a deck (the array's end)", () => {
    const mill = card("Millstone", { type: "Action", house: "Brobnar", text: "Play: Discard the top 3 cards of your deck." });
    const state = setupTest({ hand: [mill], deck: [creature("D1", 1), creature("D2", 1), creature("D3", 1), creature("D4", 1), creature("D5", 1)] });
    const before = totalCards(state);
    const next = play(state, 0, "Millstone");
    expect(titles(next.players[0].deck)).toEqual(["D1", "D2"]);
    expect(titles(next.players[0].discard)).toEqual(["D5", "D4", "D3", "Millstone"]);
    expect(totalCards(next)).toBe(before);
  });

  it("a random purge from the opponent's hand is seeded and deterministic", () => {
    const snatcher = creature("Snatcher", 3, "Destroyed: Your opponent purges a random card from their hand.");
    const hand = [creature("H1", 1), creature("H2", 1), creature("H3", 1)];
    const state = setupTest({ inPlay: [creature("Brute", 6)], hand }, { inPlay: [snatcher] });
    const next = fight(state, 0, "Brute", "Snatcher");
    // `opp` is relative to the source's controller: side 0 loses the card.
    expect(next.players[0].hand).toHaveLength(2);
    expect(next.players[0].purged).toHaveLength(1);
    expect(next.players[1].purged).toHaveLength(0);
    expect(JSON.stringify(fight(state, 0, "Brute", "Snatcher"))).toBe(JSON.stringify(next));
  });

  it("pick:all empties the zone and at:shuffle re-shuffles the destination", () => {
    const flush = card("Flush", { type: "Action", house: "Brobnar", text: "Play: Discard your hand. Shuffle your discard pile into your deck." });
    const state = setupTest({ hand: [flush, creature("H1", 1), creature("H2", 1)], deck: [creature("Deck", 1)], discard: [creature("Old", 1)] });
    const before = totalCards(state);
    const next = play(state, 0, "Flush");
    expect(next.players[0].hand).toHaveLength(0);
    expect(titles(next.players[0].discard)).toEqual(["Flush"]); // only the resolved Action itself
    expect(next.players[0].deck).toHaveLength(4); // Old, H1, H2 and Deck, shuffled
    expect(next.rngCalls).toBeGreaterThan(state.rngCalls);
    expect(totalCards(next)).toBe(before);
  });

  it("returnToDeck at:bottom lands under the deck and at:shuffle re-shuffles it", () => {
    const bottom = creature("Sinker", 2, "Action: Put a friendly creature on the bottom of its owner's deck.");
    const state = setupTest({ inPlay: [creature("Filed", 4), bottom], deck: [creature("Keep", 1)] });
    const moved = applyMove(state, 0, { type: "use", instanceId: bottom.instanceId });
    // returnToDeck is a HARMFUL act, so the auto-target takes the weakest
    // friendly — no enemy exists, so the source puts itself under the deck.
    expect(titles(moved.players[0].deck)).toEqual(["Sinker", "Keep"]);
    expect(titles(moved.players[0].board)).toEqual(["Filed"]);
    expect(totalCards(moved)).toBe(totalCards(state));

    const [shuffler] = script([
      ["Shuffler", [{ on: ["play"], target: { type: "Creature" }, acts: [{ k: "returnToDeck", s: "target", at: "shuffle" }] }]],
    ]);
    const shuffled = setupTest({ hand: [shuffler], inPlay: [creature("Back", 2)], deck: [creature("D1", 1), creature("D2", 1)] });
    const result = play(shuffled, 0, "Shuffler");
    expect(result.players[0].deck).toHaveLength(3); // D1, D2 and Back
    expect(titles(result.players[0].board)).toEqual(["Shuffler"]); // the weakest friendly (Back) left play
    expect(result.rngCalls).toBeGreaterThan(shuffled.rngCalls);
    expect(totalCards(result)).toBe(totalCards(shuffled));

    // A ward cancels the leave-play event: the card must not be copied into the deck.
    const guarded = setupTest({ hand: [shuffler], inPlay: [creature("Back", 2)] });
    guarded.players[0].board[0].warded = 1;
    const warded = play(guarded, 0, "Shuffler");
    expect(titles(warded.players[0].board).sort()).toEqual(["Back", "Shuffler"]);
    expect(titles(warded.players[0].deck)).toEqual(titles(guarded.players[0].deck));
    expect(totalCards(warded)).toBe(totalCards(guarded));
  });
});

describe("2.7 the Scrap trigger", () => {
  const scrapper = () => card("Scrapper", { type: "Action", house: "Brobnar", text: "Scrap: Gain 2<A>." });

  it("fires when the ACTIVE player discards the card, not for the other side", () => {
    const state = setupTest({ hand: [scrapper()] });
    const next = applyMove(state, 0, { type: "discard", instanceId: state.players[0].hand[0].instanceId });
    expect(next.players[0].amber).toBe(2);
    expect(titles(next.players[0].discard)).toEqual(["Scrapper"]);

    const idle = setupTest({ hand: [scrapper()] });
    idle.activePlayer = 1;
    const quiet = applyMove(idle, 0, { type: "discard", instanceId: idle.players[0].hand[0].instanceId });
    expect(quiet.players[0].amber).toBe(0);
    expect(titles(quiet.players[0].discard)).toEqual(["Scrapper"]);
  });

  it("fires from the move that discards a card from hand", () => {
    const bully = card("Bully", { type: "Action", house: "Brobnar", text: "Play: Discard a card. Draw a card." });
    // The controller's pick is the first card OUTSIDE the active house: only
    // the Scrap card is off-house, so the move must discard it.
    const state = setupTest({ hand: [bully, creature("Mate", 1), scrapper()], deck: [creature("Drawn", 1)] });
    const next = play(state, 0, "Bully");
    expect(next.players[0].amber).toBe(2); // the Scrap of the card the move discarded
    expect(titles(next.players[0].hand)).toEqual(["Mate", "Drawn"]);
  });

  it("moveHasEffect consults the Scrap clause, and a decline waives it", () => {
    const may = card("Hopeful", { type: "Action", house: "Brobnar", text: "Scrap: You may gain 2<A>." });
    const plain = card("Plain", { type: "Action", house: "Brobnar", text: "Play: Gain 1<A>." });
    const state = setupTest({ hand: [may, plain] });
    const move = (title: string) => ({ type: "discard" as const, instanceId: byTitle(state.players[0].hand, title)!.instanceId });
    expect(moveHasEffect(state, 0, move("Hopeful"))).toBe(true);
    expect(moveHasEffect(state, 0, move("Plain"))).toBe(false);

    const declined = { ...move("Hopeful"), decline: true };
    expect(isLegalMove(state, 0, declined)).toBe(true);
    expect(applyMove(state, 0, declined).players[0].amber).toBe(0);
    expect(applyMove(state, 0, move("Hopeful")).players[0].amber).toBe(2);
    // A card without the clause gets no declined variant at all.
    expect(isLegalMove(state, 0, { ...move("Plain"), decline: true })).toBe(false);
  });

  it("the source sits in the discard when it resolves: s:'self' is empty", () => {
    const [echo] = script([["Echo", [{ on: ["scrap"], acts: [{ k: "gainAmber", n: 1, per: { of: "amber", s: "self" } }] }]]]);
    const state = setupTest({ hand: [echo] });
    const next = applyMove(state, 0, { type: "discard", instanceId: echo.instanceId });
    expect(next.players[0].amber).toBe(0); // no amber on the card in the discard pile
  });

  it("the target chosen for the discard move is the one the Scrap ability uses", () => {
    const [sniper] = script([
      ["Sniper", [{ on: ["scrap"], target: { type: "Creature", side: "enemy" }, acts: [{ k: "damage", n: 3, s: "target" }] }]],
    ]);
    const state = setupTest({ hand: [sniper] }, { inPlay: [creature("Tank", 5), creature("Frail", 2)] });
    const move = { type: "discard" as const, instanceId: sniper.instanceId };
    expect(targetChoices(state, 0, move).sort()).toEqual(state.players[1].board.map((item) => item.instanceId).sort());
    const next = applyMove(state, 0, { ...move, target: board(state, 1, "Frail").instanceId });
    // The harmful auto-pick would have hit Tank: the choice wins.
    expect(titles(next.players[1].discard)).toEqual(["Frail"]);
    expect(board(next, 1, "Tank").damage).toBe(0);
  });

  it("a Scrap-only Action does nothing when played and is never a 'use'", () => {
    const stale = card("Stale", { type: "Action", house: "Brobnar", text: "Scrap: Gain 1<A>." });
    const state = setupTest({ hand: [stale] });
    expect(moveHasEffect(state, 0, { type: "play", instanceId: stale.instanceId })).toBe(false);
    expect(getLegalMoves(state, 0).some((move) => move.type === "use")).toBe(false);
    expect(canResolve(state, 0, stale, rulesOf(stale.face).abilities[0])).toBe(true);
  });
});

/** A stored row around an effect under test (the shape-gate helper). */
function row(effect: Record<string, unknown>): Record<string, unknown> {
  return {
    cardId: "gate",
    dsl: [],
    effects: [effect],
    keywords: {},
    textHash: "h",
    source: "manual",
    reviewed: true,
    generatedAt: 1,
  };
}
