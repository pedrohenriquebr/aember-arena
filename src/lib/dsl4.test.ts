// SPDX-License-Identifier: AGPL-3.0-only
// Lote 4 da DSL (docs/DSL_EXPANSION_PLAN_WAVE2.md §2): Entrench/hold/noReady,
// `partial`, capture.own + Filter.least, at:"top"/pick:"bottom", `who`,
// takeControl.opp, myTurn, moveAmber + Filter.amber, removeCounter +
// Filter.counters. Onde o texto impresso não é o objeto do teste, o DSL é
// escrito à mão numa linha `manual` (como uma carta curada), prendendo a
// primitiva da engine.
import { afterEach, describe, expect, it } from "vitest";
import { type Ability, type AbilityOverride, DSL_VERSION, normaliseAbilityOverride, type PersistentEffect, setAbilityOverrides } from "./abilities";
import { holdEntrench } from "./ai";
import { parseCardText, textHash } from "./cardText";
import { sanityProblem, validateDraft } from "./catalogLlm";
import { applyMove, canReady, conditionHolds, endTurn, setHold, type CardFace, type CardInstance, type GameState } from "./game";
import { byTitle, card, setupTest, titles } from "./testkit";

const rawFace = (text: string, type = "Creature"): CardFace => ({
  id: `probe-${text.slice(0, 12)}`,
  title: "Probe",
  house: "Brobnar",
  type,
  image: "",
  text,
  amber: 0,
  power: 1,
  armor: 0,
});

const creature = (title: string, power: number, text = "", extra: Partial<CardFace> = {}, ready = true) =>
  card(title, { type: "Creature", house: "Brobnar", power, text, ...extra }, ready);

/** One manual override map for every card of a test (a later setAbilityOverrides
    never drops an earlier card's rules). */
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

function play(state: GameState, side: 0 | 1, title: string, target?: string): GameState {
  const item = byTitle(state.players[side].hand, title);
  if (!item) throw new Error(`${title} not in hand`);
  return applyMove(state, side, { type: "play", instanceId: item.instanceId, ...(target ? { target } : {}) });
}

afterEach(() => setAbilityOverrides(new Map()));

describe("4.2 Entrench: hold, canReady e noReady", () => {
  it("the parser reads Entrench as an engine keyword", () => {
    const parsed = parseCardText(rawFace("Entrench. Reap: Gain 1<A>."));
    expect(parsed.keywords).toEqual({ entrench: 1 });
    expect(parsed.coverage).toBe("full");
  });

  it("hold keeps an exhausted entrenched creature exhausted through the ready step", () => {
    const brute = creature("Brute", 3, "Entrench.", {}, false);
    const state = setupTest({ inPlay: [brute] });
    const held = setHold(state, 0, brute.instanceId, true);
    expect(endTurn(held, 0).players[0].board[0].ready).toBe(false);
    // Without the hold the same creature readies.
    expect(endTurn(state, 0).players[0].board[0].ready).toBe(true);
  });

  it("hold without the keyword does nothing (preference needs Entrench)", () => {
    const plain = creature("Mook", 2, "", {}, false);
    const state = setupTest({ inPlay: [plain] });
    expect(endTurn(setHold(state, 0, plain.instanceId, true), 0).players[0].board[0].ready).toBe(true);
  });

  it("setHold is pure, outside the move model (no acted/Alpha) and reset on leave", () => {
    const brute = creature("Brute", 3, "Entrench.", {}, false);
    const [wipe] = manual([
      { card: card("Wipe", { type: "Action", house: "Brobnar", text: "" }), dsl: [{ on: ["play"], acts: [{ k: "destroy", s: { each: { type: "Creature" } } }] }] },
      { card: brute },
    ]);
    const state = setupTest({ hand: [wipe], inPlay: [brute] });
    const held = setHold(state, 0, brute.instanceId, true);
    expect(held.acted).toBe(0);
    expect(held.played).toBe(0);
    expect(held.players[0].board[0].hold).toBe(true);
    expect(state.players[0].board[0].hold).toBeUndefined();
    // leavePlay zeroes the preference.
    const after = play(held, 0, "Wipe");
    expect(after.players[0].discard.find((item) => item.face.title === "Brute")?.hold).toBeUndefined();
  });

  it("noReady:true blocks the step and effect-readies; noReady:'step' only the step", () => {
    const stone = creature("Stone", 3);
    const giant = creature("Giant", 3);
    const cards = manual([
      { card: stone, effects: [{ target: { self: true }, noReady: true }] },
      { card: giant, effects: [{ target: { self: true }, noReady: "step" }] },
      {
        card: card("Whip", { type: "Action", house: "Brobnar", text: "" }),
        dsl: [{ on: ["play"], acts: [{ k: "ready", s: "target" }], target: { type: "Creature", side: "friendly" } }],
      },
    ]);
    const whip = cards[2];
    const ready = setupTest({ inPlay: [stone, giant] }, {}, "Brobnar");
    ready.players[0].board.forEach((item) => (item.ready = false));
    expect(canReady(ready, stone, false)).toBe(false);
    expect(canReady(ready, giant, false)).toBe(true);
    const ended = endTurn(ready, 0);
    expect(board(ended, 0, "Stone").ready).toBe(false); // true blocks the step
    expect(board(ended, 0, "Giant").ready).toBe(false); // "step" blocks the printed step too

    const act = setupTest({ hand: [whip], inPlay: [stone, giant] }, {}, "Brobnar");
    act.players[0].board.forEach((item) => (item.ready = false));
    const after = play(act, 0, "Whip", stone.instanceId);
    expect(board(after, 0, "Stone").ready).toBe(false);
    const actStep = setupTest({ hand: [whip], inPlay: [stone, giant] }, {}, "Brobnar");
    actStep.players[0].board.forEach((item) => (item.ready = false));
    const afterStep = play(actStep, 0, "Whip", giant.instanceId);
    expect(board(afterStep, 0, "Giant").ready).toBe(true);
  });

  it("the parser reads the noReady wordings (self, upgrade host and unless)", () => {
    expect(parseCardText(rawFace("This creature cannot ready.", "Upgrade")).effects).toEqual([
      { target: { host: true }, noReady: true },
    ]);
    expect(parseCardText(rawFace('This card does not ready during your "ready cards" step.', "Creature")).effects).toEqual([
      { target: { self: true }, noReady: "step" },
    ]);
    expect(parseCardText(rawFace("This card cannot ready unless you are haunted.")).effects).toEqual([
      { target: { self: true }, noReady: true, if: { k: "not", c: { k: "count", of: { p: "discard" }, op: "gte", n: 10 } } },
    ]);
  });

  it("the parser turns a comma turn trigger into an ability with if", () => {
    const parsed = parseCardText(rawFace("Entrench. At the start of your turn, if this creature is exhausted, destroy an enemy creature."));
    expect(parsed.abilities).toEqual([
      {
        on: ["startOfTurn"],
        acts: [{ k: "destroy", s: "target" }],
        target: { type: "Creature", side: "enemy" },
        if: { k: "count", of: { c: { self: true, exhausted: true } }, op: "gte", n: 1 },
      },
    ]);
    expect(parsed.keywords).toEqual({ entrench: 1 });
    expect(parsed.coverage).toBe("full");
  });

  it("the AI holds every exhausted entrenched creature before ending its turn", () => {
    const brute = creature("Brute", 3, "Entrench.", {}, false);
    const readyBrute = creature("Ready Brute", 3, "Entrench.");
    const plain = creature("Mook", 2, "", {}, false);
    const state = setupTest({ inPlay: [brute, readyBrute, plain] }, {}, "Brobnar");
    const held = holdEntrench(state, 0);
    expect(board(held, 0, "Brute").hold).toBe(true);
    expect(board(held, 0, "Ready Brute").hold).toBeUndefined();
    expect(board(held, 0, "Mook").hold).toBeUndefined();
  });

  it("the dry-run exercises the ready step with hold both ways", () => {
    const text = "Entrench. At the start of your turn, if this creature is exhausted, destroy an enemy creature.";
    const parsed = parseCardText(rawFace(text));
    const result = validateDraft(rawFace(text), { abilities: parsed.abilities, keywords: parsed.keywords }, "llm");
    expect(result.reason).toBeUndefined();
    expect(result.ok).toBe(true);
  });
});

describe("4.1 partial — sanity de Fate e cobertura", () => {
  it("sanity rejects partial without Fate: and Fate: without partial", () => {
    const fate = rawFace("Play: Gain 1<A>. Fate: Archive a card.");
    const row = (patch: Partial<AbilityOverride>): AbilityOverride => ({
      cardId: fate.id,
      dsl: [{ on: ["play"], acts: [{ k: "gainAmber", n: 1 }] }],
      textHash: textHash(fate.text),
      source: "llm",
      reviewed: false,
      generatedAt: 1,
      ...patch,
    });
    expect(sanityProblem(fate, row({}))).toContain("partial: true");
    expect(sanityProblem(fate, row({ partial: true }))).toBeNull();
    const noFate = rawFace("Play: Gain 1<A>.");
    expect(sanityProblem(noFate, { ...row({ partial: true }), cardId: noFate.id, textHash: textHash(noFate.text) })).toContain("Fate:");
  });
});

describe("4.4 capture.own + Filter.least", () => {
  it("own captures from the creature's own side pool, not the opponent's", () => {
    const [snatcher] = manual([
      {
        card: creature("Snatcher", 2),
        dsl: [{ on: ["play"], acts: [{ k: "capture", n: 1, s: "self", own: true }] }],
      },
    ]);
    const state = setupTest({ hand: [snatcher], amber: 4 }, { amber: 1 });
    const next = play(state, 0, "Snatcher");
    expect(next.players[0].amber).toBe(3); // own pool paid
    expect(next.players[1].amber).toBe(1);
    expect(board(next, 0, "Snatcher").amber).toBe(1);

    const [thief] = manual([{ card: creature("Thief", 2), dsl: [{ on: ["play"], acts: [{ k: "capture", n: 1, s: "self" }] }] }]);
    const plain = setupTest({ hand: [thief], amber: 4 }, { amber: 1 });
    const taken = play(plain, 0, "Thief");
    expect(taken.players[0].amber).toBe(4); // default: the opponent's pool paid
    expect(taken.players[1].amber).toBe(0);
  });

  it("least picks the weakest enemy creature (mirror of top)", () => {
    const [cull] = manual([
      {
        card: card("Cull", { type: "Action", house: "Brobnar", text: "" }),
        dsl: [{ on: ["play"], acts: [{ k: "destroy", s: { each: { type: "Creature", side: "enemy", least: 1 } } }] }],
      },
    ]);
    const state = setupTest({ hand: [cull] }, { inPlay: [creature("Strong", 6), creature("Runt", 1), creature("Mid", 3)] });
    const next = play(state, 0, "Cull");
    expect(titles(next.players[1].discard)).toEqual(["Runt"]);
  });

  it("the parser emits capture.own and the least selection", () => {
    const parsed = parseCardText(rawFace("After Reap: The least powerful enemy creature captures 1<A> from its own side."));
    expect(parsed.abilities[0].acts).toEqual([
      { k: "capture", s: { each: { type: "Creature", side: "enemy", least: 1 } }, n: 1, own: true },
    ]);
  });
});

describe("4.5 at:top e pick:bottom", () => {
  it("returnToDeck at top lands on the array's end; bottom on the front", () => {
    const [send, bury] = manual([
      {
        card: card("Send", { type: "Action", house: "Brobnar", text: "" }),
        dsl: [{ on: ["play"], acts: [{ k: "returnToDeck", s: "target", at: "top" }], target: { type: "Creature", side: "enemy" } }],
      },
      {
        card: card("Bury", { type: "Action", house: "Brobnar", text: "" }),
        dsl: [{ on: ["play"], acts: [{ k: "returnToDeck", s: "target", at: "bottom" }], target: { type: "Creature", side: "enemy" } }],
      },
    ]);
    const top = play(setupTest({ hand: [send] }, { inPlay: [creature("Prey", 2)], deck: [card("D1"), card("D2")] }), 0, "Send");
    expect(top.players[1].deck.at(-1)?.face.title).toBe("Prey");
    const bottom = play(setupTest({ hand: [bury] }, { inPlay: [creature("Prey", 2)], deck: [card("D1"), card("D2")] }), 0, "Bury");
    expect(bottom.players[1].deck[0].face.title).toBe("Prey");
    expect(bottom.players[1].deck).toHaveLength(3);
  });

  it("move pick bottom takes from the front of the deck", () => {
    const [mill] = manual([
      {
        card: card("Mill", { type: "Action", house: "Brobnar", text: "" }),
        dsl: [{ on: ["play"], acts: [{ k: "move", n: 2, from: "deck", to: "discard", pick: "bottom" }] }],
      },
    ]);
    const state = setupTest({ hand: [mill] });
    state.players[0].deck = [card("B1"), card("B2"), card("B3")];
    const next = play(state, 0, "Mill");
    expect(titles(next.players[0].discard)).toEqual(["B1", "B2", "Mill"]);
    expect(titles(next.players[0].deck)).toEqual(["B3"]);
  });

  it("the parser emits the explicit top/bottom literals", () => {
    expect(parseCardText(rawFace("Play: Put an enemy creature on top of its owner's deck.", "Action")).abilities[0].acts).toEqual([
      { k: "returnToDeck", s: "target", at: "top" },
    ]);
    expect(parseCardText(rawFace("Play: Discard the bottom 3 cards of your deck.", "Action")).abilities[0].acts).toEqual([
      { k: "move", n: 3, from: "deck", to: "discard", pick: "bottom" },
    ]);
    expect(parseCardText(rawFace("After Reap: Put a random card from your opponent's hand on top of their deck.")).abilities[0].acts).toEqual([
      { k: "move", n: 1, from: "hand", to: "deck", opp: true, pick: "random", at: "top" },
    ]);
  });
});

describe("4.6 who — dono/controlador capturados no início", () => {
  const siphon = (who: "owner" | "controller") =>
    manual([
      {
        card: card("Siphon", { type: "Action", house: "Brobnar", text: "" }),
        dsl: [
          {
            on: ["play"],
            target: { type: "Creature" },
            acts: [{ k: "destroy", s: "target" }, { k: "gainAmber", n: 1, who }],
          },
        ],
      },
    ])[0];

  it("controller and owner diverge for a card I took control of (captured before destroy)", () => {
    // A card on MY board taken from the opponent: controller = 0, owner = 1.
    const stolen = creature("Stolen", 3);
    stolen.controlledBy = 0;
    const state = setupTest({ hand: [siphon("controller")], inPlay: [stolen] });
    const next = play(state, 0, "Siphon", stolen.instanceId);
    expect(next.players[0].amber).toBe(1);
    expect(next.players[1].amber).toBe(0);

    const spoiled = creature("Spoiled", 3);
    spoiled.controlledBy = 0;
    const ownerState = setupTest({ hand: [siphon("owner")], inPlay: [spoiled] });
    const after = play(ownerState, 0, "Siphon", spoiled.instanceId);
    expect(after.players[0].amber).toBe(0);
    expect(after.players[1].amber).toBe(1);
    // The destroyed card went to its owner's discard, not its controller's.
    expect(titles(after.players[1].discard)).toContain("Spoiled");
  });

  it("an act with who and no reference card is skipped", () => {
    const [orphan] = manual([
      { card: card("Orphan", { type: "Action", house: "Brobnar", text: "" }), dsl: [{ on: ["play"], acts: [{ k: "gainAmber", n: 1, who: "owner" }] }] },
    ]);
    const state = setupTest({ hand: [orphan] });
    expect(play(state, 0, "Orphan").players[0].amber).toBe(0);
  });

  it("the parser and the gate: its owner/controller, who+opp rejected", () => {
    expect(parseCardText(rawFace("Play: Destroy a creature. Its controller gains 1<A>.", "Action")).abilities[0].acts).toEqual([
      { k: "destroy", s: "target" },
      { k: "gainAmber", n: 1, who: "controller" },
    ]);
    expect(parseCardText(rawFace("Destroyed: Its owner draws a card.")).abilities[0].acts).toEqual([{ k: "draw", n: 1, who: "owner" }]);
    const base = { cardId: "gate", textHash: "h", source: "manual", reviewed: true, generatedAt: 1 };
    expect(
      normaliseAbilityOverride({ ...base, dsl: [{ on: ["play"], acts: [{ k: "gainAmber", n: 1, who: "owner", opp: true }] }] }),
    ).toBeNull();
    // `who` only exists on the four player-counter acts.
    expect(normaliseAbilityOverride({ ...base, dsl: [{ on: ["play"], acts: [{ k: "damage", n: 1, s: "self", who: "owner" }] }] })).toBeNull();
  });
});

describe("4.7 takeControl.opp", () => {
  it("gives the weakest friendly creature to the opponent", () => {
    const [gift] = manual([
      {
        card: card("Gift", { type: "Action", house: "Brobnar", text: "" }),
        dsl: [{ on: ["play"], acts: [{ k: "takeControl", s: "target", opp: true }], target: { type: "Creature", side: "friendly" } }],
      },
    ]);
    const state = setupTest({ hand: [gift], inPlay: [creature("Weak", 1), creature("Strong", 6)] });
    const next = play(state, 0, "Gift");
    expect(titles(next.players[0].board)).toEqual(["Strong"]);
    expect(titles(next.players[1].board)).toEqual(["Weak"]);
    // controlledBy records the side that took it: the opponent. Ownership is
    // untouched (the card's owner is still me).
    expect(board(next, 1, "Weak").controlledBy).toBe(1);
  });

  it("the parser reads give control … to your opponent", () => {
    expect(parseCardText(rawFace("Play: Give control of a friendly creature to your opponent.", "Action")).abilities[0].acts).toEqual([
      { k: "takeControl", s: "target", opp: true },
    ]);
  });
});

describe("4.8 myTurn", () => {
  it("conditionHolds reads the active player", () => {
    const state = setupTest({ inPlay: [creature("Watcher", 2)] });
    state.activePlayer = 1;
    expect(conditionHolds({ k: "myTurn" }, state, 1)).toBe(true);
    expect(conditionHolds({ k: "myTurn" }, state, 0)).toBe(false);
    expect(conditionHolds({ k: "not", c: { k: "myTurn" } }, state, 0)).toBe(true);
  });

  it("the parser reads it is not your turn / while it is not your turn", () => {
    const destroyed = parseCardText(rawFace("Destroyed: If it is not your turn, gain 2<A>."));
    expect(destroyed.abilities).toEqual([
      { on: ["destroyed"], acts: [{ k: "gainAmber", n: 2 }], if: { k: "not", c: { k: "myTurn" } } },
    ]);
    const constant = parseCardText(rawFace("While it is not your turn, this creature gets +2 power."));
    expect(constant.effects).toEqual([
      { target: { self: true }, power: 2, if: { k: "not", c: { k: "myTurn" } } },
    ]);
  });
});

describe("4.9 moveAmber + Filter.amber", () => {
  it("supply removes the amber and did is the total moved, not the card count", () => {
    const [drain] = manual([
      {
        card: card("Drain", { type: "Action", house: "Brobnar", text: "" }),
        dsl: [
          {
            on: ["play"],
            target: { type: "Creature" },
            acts: [{ k: "moveAmber", n: 2, s: "target", to: "supply" }, { k: "gainAmber", n: 1, if: { k: "count", of: "did", op: "gte", n: 2 } }],
          },
        ],
      },
    ]);
    const prey = creature("Vault", 2);
    prey.amber = 3;
    const state = setupTest({ hand: [drain] }, { inPlay: [prey] });
    const next = play(state, 0, "Drain");
    expect(board(next, 1, "Vault").amber).toBe(1);
    // did = 2 (amber moved), so the gated clause fires (a card-count did would be 1).
    expect(next.players[0].amber).toBe(1);
  });

  it("pool pays the resolving side and an absent n moves everything", () => {
    const [pour, all] = manual([
      {
        card: card("Pour", { type: "Action", house: "Brobnar", text: "" }),
        dsl: [{ on: ["play"], target: { type: "Creature" }, acts: [{ k: "moveAmber", n: 1, s: "target", to: "pool" }] }],
      },
      {
        card: card("All", { type: "Action", house: "Brobnar", text: "" }),
        dsl: [{ on: ["play"], target: { type: "Creature" }, acts: [{ k: "moveAmber", s: "target", to: "supply" }] }],
      },
    ]);
    const one = creature("One", 2);
    one.amber = 2;
    const first = play(setupTest({ hand: [pour] }, { inPlay: [one] }), 0, "Pour");
    expect(first.players[0].amber).toBe(1);
    expect(board(first, 1, "One").amber).toBe(1);

    const many = creature("Many", 2);
    many.amber = 3;
    const second = play(setupTest({ hand: [all] }, { inPlay: [many] }), 0, "All");
    expect(board(second, 1, "Many").amber).toBe(0);
    expect(second.players[0].amber).toBe(0);
  });

  it("Filter.amber selects cards with amber on them (engine and parser)", () => {
    const [pick] = manual([
      {
        card: card("Pick", { type: "Action", house: "Brobnar", text: "" }),
        dsl: [{ on: ["play"], acts: [{ k: "destroy", s: { each: { type: "Creature", amber: true } } }] }],
      },
    ]);
    const rich = creature("Rich", 2);
    rich.amber = 1;
    const state = setupTest({ hand: [pick] }, { inPlay: [rich, creature("Poor", 2)] });
    const next = play(state, 0, "Pick");
    expect(titles(next.players[1].discard)).toEqual(["Rich"]);
    expect(parseCardText(rawFace("Play: Destroy each creature with amber on it.", "Action")).abilities[0].acts).toEqual([
      { k: "destroy", s: { each: { type: "Creature", amber: true } } },
    ]);
  });

  it("the parser reads amber-to-pool and to the common supply", () => {
    expect(parseCardText(rawFace("After Reap: Return 1<A> from this creature to the common supply.")).abilities[0].acts).toEqual([
      { k: "moveAmber", n: 1, s: "self", to: "supply" },
    ]);
    expect(parseCardText(rawFace("Action: Move each <A> from this card to the common supply.")).abilities[0].acts).toEqual([
      { k: "moveAmber", s: "self", to: "supply" },
    ]);
    expect(parseCardText(rawFace("After Reap: Move 1<A> from a creature to your pool.")).abilities[0].acts).toEqual([
      { k: "moveAmber", n: 1, s: "target", to: "pool" },
    ]);
  });
});

describe("4.10 removeCounter + of:counters + Filter.counters", () => {
  it("removeCounter removes all (or n) and did is the total removed", () => {
    const [scrape] = manual([
      {
        card: card("Scrape", { type: "Action", house: "Brobnar", text: "" }),
        dsl: [
          {
            on: ["play"],
            target: { type: "Creature" },
            acts: [{ k: "removeCounter", s: "target" }, { k: "gainAmber", n: 1, per: "did" }],
          },
        ],
      },
    ]);
    const charged = creature("Charged", 2);
    charged.counters = 3;
    const first = play(setupTest({ hand: [scrape] }, { inPlay: [charged] }), 0, "Scrape");
    expect(board(first, 1, "Charged").counters).toBeUndefined();
    expect(first.players[0].amber).toBe(3);

    const [one] = manual([
      {
        card: card("One", { type: "Action", house: "Brobnar", text: "" }),
        dsl: [{ on: ["play"], target: { type: "Creature" }, acts: [{ k: "removeCounter", n: 1, s: "target" }] }],
      },
    ]);
    const partial = creature("Partial", 2);
    partial.counters = 3;
    const second = play(setupTest({ hand: [one] }, { inPlay: [partial] }), 0, "One");
    expect(board(second, 1, "Partial").counters).toBe(2);
  });

  it("Filter.counters selects cards with counters (engine and parser)", () => {
    const [sweep] = manual([
      {
        card: card("Sweep", { type: "Action", house: "Brobnar", text: "" }),
        dsl: [{ on: ["play"], acts: [{ k: "destroy", s: { each: { type: "Creature", counters: true } } }] }],
      },
    ]);
    const charged = creature("Charged", 2);
    charged.counters = 1;
    const state = setupTest({ hand: [sweep] }, { inPlay: [charged, creature("Plain", 2)] });
    const next = play(state, 0, "Sweep");
    expect(titles(next.players[1].discard)).toEqual(["Charged"]);
    expect(parseCardText(rawFace("Play: Destroy each creature with a +1 power counter on it.", "Action")).abilities[0].acts).toEqual([
      { k: "destroy", s: { each: { type: "Creature", counters: true } } },
    ]);
    expect(parseCardText(rawFace("Play: Exhaust each enemy creature with no +1 power counters on it.", "Action")).abilities[0].acts).toEqual([
      { k: "exhaust", s: { each: { type: "Creature", side: "enemy", counters: false } } },
    ]);
  });

  it("the parser reads remove-each and the did gate", () => {
    const parsed = parseCardText(rawFace("After Reap: You may remove each +1 power counter from a creature. If one or more counters are removed this way, archive a card."));
    expect(parsed.abilities[0]).toEqual({
      on: ["reap"],
      acts: [
        { k: "removeCounter", s: "target", optional: true },
        { k: "move", n: 1, from: "hand", to: "archives", if: { k: "count", of: "did", op: "gte", n: 1 } },
      ],
      target: { type: "Creature" },
    });
  });

  it("Count of counters scales an act ('for each +1 power counter on X')", () => {
    const parsed = parseCardText(rawFace("Play: For each +1 power counter on each creature, deal 1<D> to a creature.", "Action"));
    expect(parsed.abilities[0].acts).toEqual([
      { k: "damage", n: 1, s: "target", per: { of: "counters", s: { each: { type: "Creature" } } } },
    ]);
    const [volley] = manual([
      {
        card: card("Volley", { type: "Action", house: "Brobnar", text: "" }),
        dsl: [
          {
            on: ["play"],
            target: { type: "Creature" },
            acts: [{ k: "damage", n: 1, s: "target", per: { of: "counters", s: "target" } }],
          },
        ],
      },
    ]);
    const brute = creature("Brute", 2);
    brute.counters = 2;
    const next = play(setupTest({ hand: [volley] }, { inPlay: [brute] }), 0, "Volley");
    expect(board(next, 1, "Brute").damage).toBe(2);
  });
});

describe("4.0 upgrade concedida valida como Creature (Starpatch)", () => {
  it("sanity accepts a granted ability on an Upgrade when it belongs to the host", () => {
    const star = rawFace('This creature gains, "At the start of your turn, if this creature is exhausted, purge another creature."', "Upgrade");
    const row: AbilityOverride = {
      cardId: star.id,
      dsl: [],
      effects: [
        {
          target: { host: true },
          abilities: [
            {
              on: ["startOfTurn"],
              target: { type: "Creature", other: true },
              acts: [{ k: "purge", s: "target" }],
              if: { k: "count", of: { c: { self: true, exhausted: true } }, op: "gte", n: 1 },
            },
          ],
        },
      ],
      keywords: {},
      textHash: textHash(star.text),
      source: "llm",
      reviewed: false,
      generatedAt: 1,
    };
    expect(sanityProblem(star, row)).toBeNull();
  });
});

describe("versioning contract (Lote 4)", () => {
  const base = { cardId: "gate", textHash: "h", source: "manual", reviewed: true, generatedAt: 1 };

  it("accepts the new literals and rejects v > DSL_VERSION", () => {
    const lote4 = {
      ...base,
      v: DSL_VERSION,
      dsl: [
        {
          on: ["play"],
          target: { type: "Creature" },
          acts: [
            { k: "destroy", s: "target" },
            { k: "gainAmber", n: 1, who: "owner" },
            { k: "moveAmber", s: "target", to: "supply" },
            { k: "removeCounter", n: 1, s: "target" },
          ],
        },
        { on: ["reap"], acts: [{ k: "takeControl", s: "target", opp: true }, { k: "returnToDeck", s: "target", at: "top" }], if: { k: "myTurn" } },
      ],
      effects: [{ target: { type: "Creature", least: 1, counters: false, amber: true }, noReady: "step" }],
    };
    expect(normaliseAbilityOverride(lote4)).not.toBeNull();
    expect(normaliseAbilityOverride({ ...lote4, v: DSL_VERSION + 1 })).toBeNull();
  });

  it("rejects the narrowing literals outside their closed lists", () => {
    expect(normaliseAbilityOverride({ ...base, dsl: [{ on: ["play"], acts: [{ k: "move", n: 1, from: "deck", to: "discard", pick: "side" }] }] })).toBeNull();
    expect(normaliseAbilityOverride({ ...base, dsl: [{ on: ["play"], acts: [{ k: "returnToDeck", s: "self", at: "middle" }] }] })).toBeNull();
    expect(normaliseAbilityOverride({ ...base, dsl: [{ on: ["play"], acts: [{ k: "gainAmber", n: 1, who: "friend" }] }] })).toBeNull();
    expect(normaliseAbilityOverride({ ...base, dsl: [{ on: ["play"], acts: [{ k: "capture", n: 1, s: "self", own: "yes" }] }] })).toBeNull();
    expect(normaliseAbilityOverride({ ...base, dsl: [{ on: ["play"], acts: [{ k: "gainAmber", n: 1 }], if: { k: "myTurn", n: 1 } }] })).toBeNull();
    expect(normaliseAbilityOverride({ ...base, effects: [{ target: { self: true }, noReady: "always" }] })).toBeNull();
    expect(normaliseAbilityOverride({ ...base, dsl: [{ on: ["play"], acts: [{ k: "gainAmber", n: 1, per: { of: "poison", s: "self" } }] }] })).toBeNull();
  });

  it("`least` reads power: rejected inside an effect's if/per (recursion brake)", () => {
    expect(
      normaliseAbilityOverride({ ...base, effects: [{ target: { type: "Creature" }, if: { k: "count", of: { c: { least: 1 } }, op: "gte", n: 1 } }] }),
    ).toBeNull();
  });
});
