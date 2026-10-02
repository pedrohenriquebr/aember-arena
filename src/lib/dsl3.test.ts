// SPDX-License-Identifier: AGPL-3.0-only
// Lote 3 da DSL (docs/DSL_EXPANSION_PLAN.md §3): `use.via` ("Ready and fight/
// reap with"), observadores (`Ability.of` + `s:"event"`), contadores +1 de
// poder, splash (`targetNeighbors`) e a keyword versatile. Onde o texto
// impresso não é o objeto do teste, o DSL é escrito à mão numa linha `manual`
// (como uma carta curada) para prender a primitiva da engine.
import { afterEach, describe, expect, it } from "vitest";
import { type Ability, type AbilityOverride, DSL_VERSION, normaliseAbilityOverride, type PersistentEffect, setAbilityOverrides } from "./abilities";
import { evaluatePosition } from "./ai";
import { parseCardText, textHash } from "./cardText";
import { sanityProblem, validateDraft } from "./catalogLlm";
import { applyMove, effectivePower, getLegalMoves, moveHasEffect, type CardFace, type CardInstance, type GameState } from "./game";
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

/** Constant-text override (a granted observer/keyword lives in `effects`). */
function constant(title: string, effects: PersistentEffect[]): CardInstance {
  const item = creature(title, 2, "");
  setAbilityOverrides(
    new Map([[item.face.id, { cardId: item.face.id, dsl: [], effects, textHash: textHash(""), source: "manual", reviewed: true, generatedAt: 1 }]]),
  );
  return item;
}

const board = (state: GameState, side: 0 | 1, title: string) => byTitle(state.players[side].board, title)!;

function play(state: GameState, side: 0 | 1, title: string): GameState {
  const item = byTitle(state.players[side].hand, title);
  if (!item) throw new Error(`${title} not in hand`);
  return applyMove(state, side, { type: "play", instanceId: item.instanceId });
}

/** Makes `side` the active player so its creatures can reap/fight. */
function active(state: GameState, side: 0 | 1): GameState {
  state.activePlayer = side;
  state.activeHouse = "Brobnar";
  return state;
}

const reap = (state: GameState, side: 0 | 1, card: CardInstance) => applyMove(state, side, { type: "reap", instanceId: card.instanceId });

afterEach(() => setAbilityOverrides(new Map()));

describe("3.1 use.via — 'Ready and fight/reap with'", () => {
  it("readies the creature, fights with the auto-picked defender and exhausts it", () => {
    const brawl = card("Brawl", { type: "Action", house: "Brobnar", text: "Play: Ready and fight with a friendly creature." });
    const state = setupTest({ hand: [brawl], inPlay: [creature("Brute", 6, "", {}, false)] }, { inPlay: [creature("Prey", 3)] });
    const next = play(state, 0, "Brawl");
    const brute = board(next, 0, "Brute");
    expect(brute.ready).toBe(false); // the fight exhausted it
    expect(brute.damage).toBe(3); // Prey hit back
    expect(titles(next.players[1].discard)).toEqual(["Prey"]);
    expect(next.players[0].creaturesDestroyed).toBe(1);
  });

  it("records the defender for the acts after it (s:'fought')", () => {
    const [drill] = script([
      [
        "Drill",
        [
          {
            on: ["play"],
            target: { type: "Creature", side: "friendly" },
            acts: [{ k: "ready", s: "target" }, { k: "use", s: "target", via: "fight" }, { k: "stun", s: "fought" }],
          },
        ],
      ],
    ]);
    // The harmful target pick takes the weakest friendly: the 1-power Runt.
    const state = setupTest({ hand: [drill], inPlay: [creature("Runt", 1)] }, { inPlay: [creature("Tank", 9)] });
    const next = play(state, 0, "Drill");
    expect(board(next, 1, "Tank").stunned).toBe(true); // the defender, not the Runt
    expect(board(next, 1, "Tank").damage).toBe(1);
  });

  it("via reap forces a reap even when the creature prints an Action", () => {
    const [whip] = script([
      ["Whip", [{ on: ["play"], target: { type: "Creature", side: "friendly" }, acts: [{ k: "ready", s: "target" }, { k: "use", s: "target", via: "reap" }] }], { power: 1 }],
    ]);
    const actor = card("Actor", { type: "Creature", house: "Brobnar", power: 2, text: "Action: Steal 2<A>." });
    const state = setupTest({ hand: [whip], inPlay: [actor] }, { amber: 5 });
    const next = play(state, 0, "Whip");
    expect(next.players[0].amber).toBe(1); // reap amber, not the Action's steal
    expect(next.players[1].amber).toBe(5);
  });

  it("sanity rejects use s:'self' on fight/beforeFight; the parser refuses it too", () => {
    const face = card("Looper", { power: 3, text: "Fight: Ready and fight with this creature." }).face;
    const row: AbilityOverride = {
      cardId: face.id,
      dsl: [{ on: ["fight"], acts: [{ k: "ready", s: "self" }, { k: "use", s: "self", via: "fight" }] }],
      textHash: textHash(face.text),
      source: "manual",
      reviewed: true,
      generatedAt: 1,
    };
    expect(sanityProblem(face, row)).toContain("forever");
    // The deterministic parser only emits `use` for a chosen ("target") card.
    expect(parseCardText(face).coverage).toBe("vanilla");
  });
});

describe("3.2 observers — Ability.of + \"event\"", () => {
  const watcher = () => script([["Watcher", [{ on: ["reap"], of: { type: "Creature", side: "enemy" }, acts: [{ k: "gainAmber", n: 1 }] }]]])[0];

  it("fires once for the event of the matching side, with me = the watcher's side", () => {
    const state = active(setupTest({ inPlay: [watcher()] }, { inPlay: [creature("Foe", 3)] }), 1);
    const next = reap(state, 1, state.players[1].board[0]);
    expect(next.players[1].amber).toBe(1); // the reap itself
    expect(next.players[0].amber).toBe(1); // the watcher fired exactly once
  });

  it("does not fire for a card outside the filter (friendly creature reaping)", () => {
    const friend = creature("Friend", 3);
    const state = setupTest({ inPlay: [watcher(), friend] });
    const next = reap(state, 0, friend);
    expect(next.players[0].amber).toBe(1); // only the reap amber
  });

  it("'After an enemy creature reaps, stun it.' stuns the reaper through the parser", () => {
    const snare = card("Snare", { type: "Artifact", house: "Brobnar", text: "After an enemy creature reaps, stun it." });
    const state = active(setupTest({ inPlay: [snare] }, { inPlay: [creature("Foe", 3)] }), 1);
    const next = reap(state, 1, state.players[1].board[0]);
    expect(next.players[1].board[0].stunned).toBe(true); // the event card
    expect(board(next, 0, "Snare").stunned).toBe(false); // never the watcher
  });

  it("'is destroyed' watchers see the card while it is still in play", () => {
    const [reaper] = script([["Reaper", [{ on: ["destroyed"], of: { type: "Creature", side: "enemy" }, acts: [{ k: "gainAmber", n: 2 }] }]]]);
    const wipe = card("Wipe", { type: "Action", house: "Brobnar", text: "Play: Destroy each enemy creature." });
    const state = setupTest({ hand: [wipe], inPlay: [reaper] }, { inPlay: [creature("Doomed", 2)] });
    const next = play(state, 0, "Wipe");
    expect(next.players[0].amber).toBe(2);
  });

  it("a granted copy never watches: only the card's own abilities observe", () => {
    const herald = constant("Herald", [
      { target: { type: "Creature", side: "friendly" }, abilities: [{ on: ["reap"], of: { type: "Creature", side: "enemy" }, acts: [{ k: "gainAmber", n: 2 }] }] },
    ]);
    const friend = creature("Friend", 2);
    const state = active(setupTest({ inPlay: [herald, friend] }, { inPlay: [creature("Foe", 3)] }), 1);
    const next = reap(state, 1, state.players[1].board[0]);
    expect(next.players[0].amber).toBe(0);
  });

  it("an observer draft passes the triple validation (dry-run included)", () => {
    const face = card("Seer", { type: "Creature", house: "Brobnar", text: "After an enemy creature reaps, stun it." }).face;
    const result = validateDraft(face, { abilities: parseCardText(face).abilities }, "llm");
    expect(result.reason).toBeUndefined();
    expect(result.ok).toBe(true);
  });

  it("an observer-only card offers no 'use' move and is not usable outside the house", () => {
    const seer = card("Seer", { type: "Artifact", house: "Dis", text: "Each time you use an artifact, gain 1<A>." });
    const state = setupTest({ inPlay: [seer] });
    // Off-house: the watcher (on action/omni) is not an Omni door.
    state.activeHouse = "Brobnar";
    expect(getLegalMoves(state, 0, "Brobnar").some((move) => move.type === "use")).toBe(false);
    // In-house too: there is no Action/Omni ability of its own to resolve.
    expect(getLegalMoves(state, 0, "Dis").some((move) => move.type === "use")).toBe(false);
    expect(moveHasEffect(state, 0, { type: "use", instanceId: seer.instanceId })).toBe(false);
  });

  it("the observer recursion brake ends a 'ready and reap with the event' loop", () => {
    const [loop] = script([
      ["Loop", [{ on: ["reap"], of: { type: "Creature" }, acts: [{ k: "ready", s: "event" }, { k: "use", s: "event", via: "reap" }] }]],
    ]);
    const runner = creature("Runner", 2, "", { house: "Brobnar" });
    const state = setupTest({ inPlay: [loop, runner] });
    const next = reap(state, 0, runner);
    // Initial reap + 8 nested observer passes (OBSERVER_DEPTH), then the brake
    // bites: the move must return instead of recursing forever.
    expect(next.players[0].amber).toBe(9);
    expect(board(next, 0, "Runner").ready).toBe(false);
  });

  it("four self-feeding watchers stay inside the per-move dispatch budget", () => {
    const loop = (): [string, Ability[]] => [
      "Loop",
      [{ on: ["reap"], of: { type: "Creature" }, acts: [{ k: "ready", s: "event" }, { k: "use", s: "event", via: "reap" }] }],
    ];
    const watchers = script([loop(), loop(), loop(), loop()]);
    const runner = creature("Runner", 2, "", { house: "Brobnar" });
    const state = setupTest({ inPlay: [...watchers, runner] });
    const next = reap(state, 0, runner);
    // Width, not depth: depth-first nesting spends the fire budget first, so the
    // chain ends after 80 dispatches (initial reap + 80) — inside the
    // OBSERVER_BUDGET bound of 1 + 100, with no N^8 blow-up.
    expect(next.players[0].amber).toBe(81);
  });

  it("a watcher destroyed mid-pass does not fire (board snapshot recheck)", () => {
    const [killer, late] = script([
      [
        "Killer",
        [
          {
            on: ["destroyed"],
            of: { type: "Creature", side: "enemy" },
            acts: [{ k: "gainAmber", n: 1 }, { k: "destroy", s: { each: { type: "Creature", side: "friendly", other: true } } }],
          },
        ],
      ],
      ["Late", [{ on: ["destroyed"], of: { type: "Creature", side: "enemy" }, acts: [{ k: "gainAmber", n: 5 }] }]],
    ]);
    const wipe = card("Wipe", { type: "Action", house: "Brobnar", text: "Play: Destroy each enemy creature." });
    const state = setupTest({ hand: [wipe], inPlay: [killer, late] }, { inPlay: [creature("Doomed", 2, "", { house: "Dis" })] });
    const next = play(state, 0, "Wipe");
    // Killer's dispatch destroyed Late during the same pass: Late must not see
    // the event (the board loop holds the pre-pass snapshot, so it is rechecked).
    expect(next.players[0].amber).toBe(1);
    expect(titles(next.players[0].discard)).toContain("Late");
  });

  it("a self-feeding 'use self via reap' chain ends without RangeError (fire budget)", () => {
    const [loop] = script([["Loop", [{ on: ["reap"], acts: [{ k: "ready", s: "self" }, { k: "use", s: "self", via: "reap" }] }]]]);
    const state = setupTest({ inPlay: [loop] });
    const next = reap(state, 0, loop);
    // Initial reap + one reap per FIRE_BUDGET slot, then fire() stops dispatching.
    expect(next.players[0].amber).toBe(65);
  });
});

describe("3.3 +1 power counters", () => {
  it("adds power and counts as did for the act after (signature)", () => {
    const [charge] = script([
      ["Charge", [{ on: ["play"], target: { type: "Creature" }, acts: [{ k: "counter", n: 2, s: "target" }, { k: "gainAmber", n: 1, per: "did" }] }]],
    ]);
    const state = setupTest({ hand: [charge], inPlay: [creature("Hulk", 5)] });
    const next = play(state, 0, "Charge");
    const hulk = board(next, 0, "Hulk");
    expect(hulk.counters).toBe(2);
    expect(effectivePower(next, hulk)).toBe(7);
    expect(next.players[0].amber).toBe(1);
  });

  it("the parser reads 'Give/put … +1 power counters' with word counts", () => {
    expect(parseCardText(creature("Probe", 0, "Play: Give a creature two +1 power counters.").face).abilities[0].acts).toEqual([
      { k: "counter", n: 2, s: "target" },
    ]);
    expect(parseCardText(creature("Probe", 0, "Play: Put a +1 power counter on a friendly creature.").face).abilities[0].acts).toEqual([
      { k: "counter", n: 1, s: "target" },
    ]);
  });

  it("counters are cleared when the card leaves play", () => {
    const charged = creature("Charged", 2, "Play: Give this creature two +1 power counters.");
    const wipe = card("Wipe", { type: "Action", house: "Brobnar", text: "Play: Destroy each creature." });
    const state = setupTest({ hand: [charged, wipe] });
    const chargedState = play(state, 0, "Charged");
    expect(board(chargedState, 0, "Charged").counters).toBe(2);
    const after = play(chargedState, 0, "Wipe");
    expect(after.players[0].discard.find((item) => item.face.title === "Charged")?.counters).toBeUndefined();
  });
});

describe("3.4 splash — targetNeighbors", () => {
  it("damages the neighbors BEFORE the target, so a dead target does not spare them", () => {
    const splash = card("Splashy", { type: "Action", house: "Brobnar", text: "Play: Deal 3<D> to a creature, with 1<D> splash." });
    // The strongest enemy is the MIDDLE one, so it has two neighbors.
    const state = setupTest({ hand: [splash] }, { inPlay: [creature("Left", 1), creature("Middle", 3), creature("Right", 2)] });
    const next = play(state, 0, "Splashy");
    // Harmful auto-pick: Middle. The splash ships first: Left (1 power) dies,
    // Right survives with 1 damage, Middle dies after.
    expect(titles(next.players[1].board)).toEqual(["Right"]);
    expect(board(next, 1, "Right").damage).toBe(1);
    expect(titles(next.players[1].discard)).toEqual(["Left", "Middle"]);
  });

  it("the parser emits the neighbor act first", () => {
    const acts = parseCardText(creature("Probe", 0, "Play: Deal 3<D> to a creature, with 1<D> splash.").face).abilities[0].acts;
    expect(acts).toEqual([
      { k: "damage", n: 1, s: "targetNeighbors" },
      { k: "damage", n: 3, s: "target" },
    ]);
  });
});

describe("3.5 keyword versatile", () => {
  it("a printed Versatile lets the card be played and used outside the active house", () => {
    const nomad = creature("Nomad", 2, "Versatile.", { house: "Dis" });
    const plain = creature("Homebody", 2, "", { house: "Dis" });
    const wand = card("Wand", { type: "Artifact", house: "Dis", text: "Versatile. Action: Gain 1<A>." });
    const state = setupTest({ hand: [nomad, plain], inPlay: [wand] });
    state.activeHouse = "Brobnar";
    const moves = getLegalMoves(state, 0, "Brobnar");
    expect(moves.some((move) => move.type === "play" && move.instanceId === nomad.instanceId)).toBe(true);
    expect(moves.some((move) => move.type === "play" && move.instanceId === plain.instanceId)).toBe(false);
    expect(moves.some((move) => move.type === "use" && move.instanceId === wand.instanceId)).toBe(true);
  });

  it("a granted 'gains versatile' lifts the restriction through the filter", () => {
    const banner = card("Banner", { type: "Artifact", house: "Dis", text: "Each friendly creature gains versatile." });
    const nomad = creature("Nomad", 2, "", { house: "Untamed" });
    const state = setupTest({ inPlay: [nomad, banner] });
    state.activeHouse = "Brobnar";
    // The grant only reaches a creature in play, so the reap move is the proof.
    expect(getLegalMoves(state, 0, "Brobnar").some((move) => move.type === "reap" && move.instanceId === nomad.instanceId)).toBe(true);
    const without = setupTest({ inPlay: [creature("Homebody", 2, "", { house: "Untamed" })] });
    without.activeHouse = "Brobnar";
    // Without the grant the same off-house creature cannot be used.
    expect(getLegalMoves(without, 0, "Brobnar").some((move) => move.type === "reap")).toBe(false);
  });
});

describe("heurísticas: observers não valem como habilidade própria (review)", () => {
  it("moveHasEffect ignores an observer-only ability", () => {
    const [seer] = script([
      ["Seer", [{ on: ["action", "omni"], of: { type: "Artifact", side: "friendly" }, acts: [{ k: "gainAmber", n: 1 }] }]],
    ]);
    const state = setupTest({ inPlay: [seer] });
    expect(moveHasEffect(state, 0, { type: "use", instanceId: seer.instanceId })).toBe(false);
  });

  it("the ability-aware AI score does not value observer abilities as own reap/fight", () => {
    const plain = card("Plain", { type: "Creature", house: "Brobnar", power: 2 });
    const baseline = evaluatePosition(setupTest({ inPlay: [plain] }), 0, true);
    const [seer] = script([
      ["Seer", [{ on: ["reap"], of: { type: "Creature", side: "enemy" }, acts: [{ k: "gainAmber", n: 1 }] }], { power: 2 }],
    ]);
    // Same board value with and without the observer ability.
    expect(evaluatePosition(setupTest({ inPlay: [seer] }), 0, true)).toBe(baseline);
  });
});

describe("versioning contract (Lote 3)", () => {
  it("the gate accepts the new literals and rejects v > DSL_VERSION", () => {
    const base = { cardId: "gate", textHash: "h", source: "manual", reviewed: true, generatedAt: 1 };
    const lote3 = {
      ...base,
      v: DSL_VERSION,
      dsl: [
        { on: ["reap"], of: { type: "Creature", side: "enemy" }, acts: [{ k: "stun", s: "event" }] },
        { on: ["play"], target: { type: "Creature" }, acts: [{ k: "use", s: "target", via: "fight" }, { k: "counter", n: 1, s: "targetNeighbors" }] },
      ],
    };
    expect(normaliseAbilityOverride(lote3)).not.toBeNull();
    expect(normaliseAbilityOverride({ ...lote3, v: DSL_VERSION + 1 })).toBeNull();
    // A `via` outside the closed list would change the meaning of a new row.
    expect(
      normaliseAbilityOverride({ ...base, dsl: [{ on: ["play"], target: { type: "Creature" }, acts: [{ k: "use", s: "target", via: "omni" }] }] }),
    ).toBeNull();
  });

  it("versatile is a known keyword in stored rows", () => {
    const row = { cardId: "gate", dsl: [{ on: ["play"], acts: [{ k: "gainAmber", n: 1 }] }], keywords: { versatile: 1 }, textHash: "h", source: "manual", reviewed: true, generatedAt: 1 };
    expect(normaliseAbilityOverride(row)?.keywords).toEqual({ versatile: 1 });
  });
});
