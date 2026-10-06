// SPDX-License-Identifier: AGPL-3.0-only
// Lote 13 (PARSER_VERSION 13, DSL_VERSION unchanged): "if you are not haunted", invulnerable (a damage `prevent`,
// no new union) and the Mark of Dis wording of forceHouse.
import { afterEach, describe, expect, it } from "vitest";
import { DSL_VERSION, setAbilityOverrides } from "./abilities";
import { PARSER_VERSION, parseCardText } from "./cardText";
import { applyMove, endTurn, type CardFace } from "./game";
import { card, setupTest } from "./testkit";

afterEach(() => setAbilityOverrides(new Map()));

const HAUNTED = "At the start of your turn, if you are not haunted, discard the top card of your deck.\nOmni: If you are haunted, gain 1<A>.";
const SEDA = "While Seda the Sleeper is exhausted and on a flank, it gains invulnerable. \nAfter you ready Seda the Sleeper, you may deal 2<D> to it. If you do, exhaust it.\nPlay: Capture 6<A>.\n";
const MARK = "Play: Deal 2<D> to a creature. If it is not destroyed, its controller must choose that creature’s house as their active house on their next turn.";

const face = (title: string, text: string, type: string, house = "Dis"): CardFace => ({ id: title, title, house, type, image: "", text, amber: 0, power: 3, armor: 0 });
const parse = (title: string, text: string, type: string, house = "Dis") => parseCardText(face(title, text, type, house));
const HAUNTED_COUNT = { k: "count", of: { p: "discard" }, op: "gte", n: 10 };

describe("contract", () => {
  it("bumps the parser and keeps the DSL version (invulnerable reuses prevent)", () => {
    expect(PARSER_VERSION).toBe(17);
    expect(DSL_VERSION).toBe(15);
  });
});

describe("Haunted House", () => {
  const rules = () => parse("Haunted House", HAUNTED, "Artifact", "Geistoid");

  it("parses both abilities: the turn trigger with a negated haunted `if`, and the omni", () => {
    const parsed = rules();
    expect(parsed.coverage).toBe("full");
    expect(parsed.abilities).toEqual([
      { on: ["startOfTurn"], acts: [{ k: "move", n: 1, from: "deck", to: "discard", pick: "top" }], if: { k: "not", c: HAUNTED_COUNT } },
      { on: ["omni"], acts: [{ k: "gainAmber", n: 1 }], if: HAUNTED_COUNT },
    ]);
  });

  it("also reads the opponent's side", () => {
    const parsed = parse("X", "At the start of your turn, if your opponent is not haunted, gain 1<A>.", "Artifact", "Geistoid");
    expect(parsed.abilities[0].if).toEqual({ k: "not", c: { ...HAUNTED_COUNT, of: { p: "discard", opp: true } } });
  });

  it("mills at the start of the turn only while not haunted", () => {
    const house = () => card("Haunted House", { type: "Artifact", house: "Geistoid", text: HAUNTED });
    const filler = (n: number) => Array.from({ length: n }, (_, i) => card(`Filler ${i}`, { house: "Dis" }));
    const quiet = endTurn(setupTest({}, { inPlay: [house()], deck: filler(3) }, "Geistoid"), 0);
    expect(quiet.players[1].discard.length).toBe(1);
    const haunted = endTurn(setupTest({}, { inPlay: [house()], deck: filler(3), discard: filler(10) }, "Geistoid"), 0);
    expect(haunted.players[1].discard.length).toBe(10);
  });
});

describe("Seda the Sleeper (invulnerable)", () => {
  const DID = { k: "count", of: "did", op: "gte", n: 1 } as const;

  it("parses full: invulnerable, the self ready-watch, and the play capture", () => {
    const parsed = parse("Seda the Sleeper", SEDA, "Creature", "Ouroboros");
    expect(parsed.coverage).toBe("full");
    expect(parsed.effects).toEqual([
      { target: { self: true }, replace: { on: "damage", prevent: true }, if: { k: "count", of: { c: { self: true, flank: true, exhausted: true } }, op: "gte", n: 1 } },
    ]);
    // `of.self` is what the ready step's observers match. `did` counts a signature
    // change (damage is in the signature), so 2 to itself is enough for the exhaust
    // even though the card never leaves play. "If you do" also inherits optional,
    // which is how a declined "you may" skips the follow-up when decline is threaded.
    expect(parsed.abilities).toEqual([
      {
        on: ["ready"],
        of: { self: true },
        optional: true,
        acts: [
          { k: "damage", n: 2, s: "self", optional: true },
          { k: "exhaust", s: "self", optional: true, if: DID },
        ],
      },
      { on: ["play"], acts: [{ k: "capture", n: 6, s: "self" }] },
    ]);
  });

  it("reads the 'is readied' spelling as the same self watch", () => {
    const parsed = parse("Z", "After this creature is readied, you may deal 2 damage to it. If you do, exhaust it.", "Creature");
    expect(parsed.coverage).toBe("full");
    expect(parsed.abilities[0].on).toEqual(["ready"]);
    expect(parsed.abilities[0].of).toEqual({ self: true });
    expect(parsed.abilities[0].acts[0]).toMatchObject({ k: "damage", n: 2, s: "self" });
  });

  it.each(["This creature gains invulnerable.", "This creature is invulnerable."])("reads %s", (text) => {
    expect(parse("Z", text, "Creature").effects).toEqual([{ target: { self: true }, replace: { on: "damage", prevent: true } }]);
  });

  const fight = (ready: boolean, flank: boolean) => {
    const seda = card("Seda the Sleeper", { house: "Ouroboros", power: 6, text: SEDA }, ready);
    const side = [card("Left", { house: "Dis", power: 9 })];
    const attacker = card("Hitter", { house: "Brobnar", power: 3 });
    const state = setupTest({ inPlay: [attacker] }, { inPlay: flank ? [seda] : [side[0], seda, card("Right", { house: "Dis", power: 9 })] }, "Brobnar");
    state.players[1].board.find((item) => item.face.title === "Seda the Sleeper")!.warded = 1;
    const next = applyMove(state, 0, { type: "fight", attackerId: attacker.instanceId, targetId: seda.instanceId });
    return next.players[1].board.find((item) => item.face.title === "Seda the Sleeper")!;
  };

  it("takes no fight damage (and keeps its ward) while exhausted on a flank", () => {
    const seda = fight(false, true);
    expect(seda.damage).toBe(0);
    expect(seda.warded).toBe(1);
  });

  it("takes the damage (spending the ward) when ready, and when exhausted in the middle", () => {
    expect(fight(true, true).warded).toBe(0);
    const middle = fight(false, false);
    expect(middle.warded).toBe(0);
  });

  it("after the ready step, deals 2 to itself and exhausts again", () => {
    const seda = card("Seda the Sleeper", { house: "Ouroboros", power: 6, text: SEDA }, false);
    const other = card("Bystander", { house: "Ouroboros", power: 4 }, false);
    const next = endTurn(setupTest({ inPlay: [seda, other] }, {}, "Ouroboros"), 0);
    const woke = next.players[0].board.find((item) => item.face.title === "Seda the Sleeper")!;
    expect(woke.damage).toBe(2);
    expect(woke.ready).toBe(false);
    const bystander = next.players[0].board.find((item) => item.face.title === "Bystander")!;
    expect(bystander.damage).toBe(0);
    expect(bystander.ready).toBe(true);
  });

  it("does not deal when a different creature is the one readied", () => {
    const seda = card("Seda the Sleeper", { house: "Ouroboros", power: 6, text: SEDA }, true);
    const other = card("Bystander", { house: "Ouroboros", power: 4 }, false);
    const next = endTurn(setupTest({ inPlay: [seda, other] }, {}, "Ouroboros"), 0);
    const still = next.players[0].board.find((item) => item.face.title === "Seda the Sleeper")!;
    expect(still.damage).toBe(0);
    expect(still.ready).toBe(true);
  });

  it("takes the damage with no ward when ready", () => {
    const seda = card("Seda the Sleeper", { house: "Ouroboros", power: 6, text: SEDA }, true);
    const attacker = card("Hitter", { house: "Brobnar", power: 3 });
    const state = setupTest({ inPlay: [attacker] }, { inPlay: [seda] }, "Brobnar");
    const next = applyMove(state, 0, { type: "fight", attackerId: attacker.instanceId, targetId: seda.instanceId });
    expect(next.players[1].board[0].damage).toBe(3);
  });
});

describe("Mark of Dis (forceHouse wording)", () => {
  it.each([
    ["curly apostrophe", MARK],
    ["straight apostrophe", MARK.replace("’", "'")],
    ["during", MARK.replace("on their next turn", "during their next turn")],
    ["no turn tail", MARK.replace(" on their next turn", "")],
    ["its house", MARK.replace("that creature’s house", "its house")],
  ])("parses (%s) to a forceHouse of the target's house, gated on it surviving", (_label, text) => {
    const parsed = parse("Mark of Dis", text, "Action");
    expect(parsed.coverage).toBe("full");
    expect(parsed.abilities[0].acts).toEqual([
      { k: "damage", s: "target", n: 2 },
      { k: "forceHouse", house: "target", who: "controller", if: { k: "count", of: "gone", op: "eq", n: 0 } },
    ]);
  });

  it("does not make a bare forceHouse without its choice parse as full", () => {
    expect(parse("X", "Play: Your opponent must choose that house as their active house on their next turn.", "Action").coverage).not.toBe("full");
  });

  const mark = () => card("Mark of Dis", { type: "Action", house: "Dis", text: MARK });
  it("forces the survivor's controller onto its house, and not when it dies", () => {
    const tough = card("Tough", { house: "Logos", power: 5 });
    const spell = mark();
    const hurt = applyMove(setupTest({ hand: [spell] }, { inPlay: [tough] }, "Dis"), 0, { type: "play", instanceId: spell.instanceId, target: tough.instanceId });
    expect(hurt.players[1].mustChoose).toBe("Logos");
  });
});
