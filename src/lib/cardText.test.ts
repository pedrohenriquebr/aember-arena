import { describe, expect, it } from "vitest";
import { rulesOf } from "./abilities";
import { parseCardText } from "./cardText";
import { DEMO_DECK } from "./demoDeck";
import { DEMO_DECK_2 } from "./demoDeck2";
import { getLegalMoves } from "./game";
import type { CardFace } from "./game";
import { card, setupTest } from "./testkit";

const face = (text: string, type = "Creature", title = "Test Card"): CardFace => ({
  id: "x",
  title,
  house: "Logos",
  type,
  image: "",
  text,
  amber: 0,
  power: 3,
  armor: 0,
});

describe("trigger prefixes", () => {
  it.each([
    ["Play: Gain 1A.", ["play"]],
    ["Reap: Gain 1A.", ["reap"]],
    ["Fight: Gain 1A.", ["fight"]],
    ["After Fight: Gain 1A.", ["fight"]],
    ["Before Fight: Gain 1A.", ["beforeFight"]],
    ["Destroyed: Gain 1A.", ["destroyed"]],
    ["Action: Gain 1A.", ["action"]],
    ["Omni: Gain 1A.", ["omni"]],
    ["Play/Reap: Gain 1A.", ["play", "reap"]],
    ["Play/Fight/Reap: Gain 1A.", ["play", "fight", "reap"]],
    // Onda 2: reações ("After …"), gatilhos repetíveis ("Each time …") e de fase.
    ["After Play: Gain 1A.", ["play"]],
    ["After Fight/After Reap: Gain 1A.", ["fight", "reap"]],
    ["Each time Reap: Gain 1A.", ["reap"]],
    ["At the start of your turn: Gain 1A.", ["startOfTurn"]],
    ["At the end of your turn: Gain 1A.", ["endOfTurn"]],
  ])("%s", (text, triggers) => {
    const rules = parseCardText(face(text));
    expect(rules.coverage).toBe("full");
    expect(rules.abilities[0].on).toEqual(triggers);
  });

  it.each([
    "After an enemy creature is destroyed fighting this card: Gain 1A.",
    "Interrupt: Gain 1A.",
    "Scrap: Gain 1A.",
    // Watchers globais ("each time you …") não são gatilhos da fonte: ficam
    // de fora em vez de virarem um gatilho errado da própria carta.
    "Each time you reap, gain 1A.",
  ])(
    "recognises %s but reports it as unsupported",
    (text) => {
      const rules = parseCardText(face(`Elusive. ${text}`));
      expect(rules.abilities).toHaveLength(0);
      expect(rules.coverage).toBe("vanilla");
      expect(rules.keywords.elusive).toBe(1);
    },
  );
});

describe("text normalisation", () => {
  it("reads the A / Æmber / D glyphs of Master Vault text", () => {
    expect(parseCardText(face("Play: Steal 2A.")).abilities[0].acts).toEqual([{ k: "steal", n: 2 }]);
    expect(parseCardText(face("Play: Gain 2 Æmber.")).abilities[0].acts).toEqual([{ k: "gainAmber", n: 2 }]);
    expect(parseCardText(face("Play: Deal 3D to an enemy creature.")).abilities[0]).toMatchObject({
      target: { type: "Creature", side: "enemy" },
      acts: [{ k: "damage", n: 3, s: "target" }],
    });
  });

  it("maps the card's own name to itself", () => {
    const rules = parseCardText(face("Omni: Sacrifice Boom Box. Your opponent loses 2A.", "Artifact", "Boom Box"));
    expect(rules.abilities[0].acts).toEqual([{ k: "sacrifice", n: 0, s: "self" }, { k: "loseAmber", n: 2, opp: true }]);
  });

  it("parses conditions in front of and behind the effect", () => {
    expect(parseCardText(face("Play: If your opponent has no A, gain 2A.")).abilities[0].if).toEqual({ k: "amber", opp: true, op: "eq", n: 0 });
    expect(parseCardText(face("Play: Gain 2A if you control more creatures than your opponent.")).abilities[0].if).toEqual({ k: "moreCreatures" });
  });

  it("drops a whole ability when one of its sentences is not understood", () => {
    const rules = parseCardText(face("Play: Lose 1A. If you do, you may forge a key at current cost.", "Action"));
    expect(rules.abilities).toHaveLength(0);
    expect(rules.coverage).toBe("vanilla");
  });

  it("reads constant text as a persistent effect instead of failing the card", () => {
    const rules = parseCardText(face("Each friendly creature gets +1 armor. Reap: Heal 2 damage from a creature."));
    expect(rules.coverage).toBe("full");
    expect(rules.effects[0]).toMatchObject({ target: { type: "Creature", side: "friendly" }, armor: 1 });
    expect(rules.abilities).toHaveLength(1);
  });
});

describe("zone verbs and tokens (Onda 3)", () => {
  it("reads purge, sacrifice and exalt as separate verbs", () => {
    const purge = parseCardText(face("Play: Purge an enemy creature."));
    expect(purge.coverage).toBe("full");
    expect(purge.abilities[0]).toMatchObject({
      target: { type: "Creature", side: "enemy" },
      acts: [{ k: "purge", n: 0, s: "target" }],
    });

    const sacrifice = parseCardText(face("Play: Sacrifice a friendly creature."));
    expect(sacrifice.abilities[0]).toMatchObject({ acts: [{ k: "sacrifice", n: 0, s: "target" }] });

    const exalt = parseCardText(face("Play: Exalt a friendly creature."));
    expect(exalt.abilities[0]).toMatchObject({
      target: { type: "Creature", side: "friendly" },
      acts: [{ k: "exalt", n: 1, s: "target" }],
    });
    const twice = parseCardText(face("Play: Exalt Grimlocus Dux twice.", "Creature", "Grimlocus Dux"));
    expect(twice.abilities[0].acts).toEqual([{ k: "exalt", n: 2, s: "self" }]);
  });

  it("reads 'Make/Create a token creature' with a count", () => {
    expect(parseCardText(face("Play: Make a token creature.")).abilities[0].acts).toEqual([{ k: "makeToken", n: 1 }]);
    expect(parseCardText(face("Play: Make 2 token creatures.")).abilities[0].acts).toEqual([{ k: "makeToken", n: 2 }]);
    expect(parseCardText(face("Reap: Create a token creature.")).abilities[0].acts).toEqual([{ k: "makeToken", n: 1 }]);
  });

  it("keeps purge wording outside the object grammar unparsed", () => {
    const rules = parseCardText(face("Play: Purge a creature with power 3 or lower."));
    expect(rules.coverage).toBe("vanilla");
    expect(rules.abilities).toHaveLength(0);
  });
});

describe("optional 'You may' clauses (Onda 2)", () => {  it("marks a whole 'You may' sentence as optional and keeps the card full", () => {
    const rules = parseCardText(face("Play: You may draw a card."));
    expect(rules.coverage).toBe("full");
    expect(rules.abilities[0]).toMatchObject({ on: ["play"], optional: true });
    expect(rules.abilities[0].acts).toEqual([{ k: "draw", n: 1, optional: true }]);
  });

  it("reads the 'You may:' colon form printed on some cards", () => {
    const rules = parseCardText(face("Reap: You may: Gain 2 amber."));
    expect(rules.abilities[0].acts).toEqual([{ k: "gainAmber", n: 2, optional: true }]);
  });

  it("keeps a mixed ability mandatory and marks only the 'may' sentence", () => {
    const rules = parseCardText(face("Play: Draw a card. You may gain 2 amber."));
    expect(rules.coverage).toBe("full");
    expect(rules.abilities[0].optional).toBeUndefined();
    expect(rules.abilities[0].acts).toEqual([{ k: "draw", n: 1 }, { k: "gainAmber", n: 2, optional: true }]);
  });
});

describe("persistent text", () => {
  it("reads power/armor modifiers, keyword grants and prohibitions", () => {
    const armor = parseCardText(face("Each enemy creature gets -1 armor."));
    expect(armor).toMatchObject({ coverage: "full" });
    expect(armor.effects[0]).toMatchObject({ target: { type: "Creature", side: "enemy" }, armor: -1 });

    const self = parseCardText(face("Each other friendly creature gets +1 power."));
    expect(self.effects[0]).toMatchObject({ target: { type: "Creature", side: "friendly", other: true }, power: 1 });

    const flank = parseCardText(face("Staunch Knight gets +2 power while it is on a flank.", "Creature", "Staunch Knight"));
    expect(flank.effects[0]).toMatchObject({ target: { self: true }, power: 2, when: "flank" });

    const neighbors = parseCardText(face("Each of Bulwark's neighbors gets +2 armor.", "Creature", "Bulwark"));
    expect(neighbors.effects[0]).toMatchObject({ target: { neighborsOfSource: true }, armor: 2 });

    const taunt = parseCardText(face("Each other friendly creature gains Taunt."));
    expect(taunt.effects[0]).toMatchObject({ target: { type: "Creature", side: "friendly", other: true }, keywords: { taunt: 1 } });

    const imp = parseCardText(face("Your opponent cannot play more than 2 cards each turn."));
    expect(imp.coverage).toBe("full");
    expect(imp.effects[0].restrict).toEqual({ who: "opponent", action: "play", limit: 2 });

    const cannotUse = parseCardText(face("You cannot use artifacts."));
    expect(cannotUse.effects[0].restrict).toEqual({ who: "you", action: "use", type: "Artifact" });
  });

  it("reads the duration of a triggered effect", () => {
    const storm = parseCardText(face("Play: Your opponent cannot play action cards on their next turn.", "Action"));
    expect(storm.coverage).toBe("full");
    expect(storm.abilities[0].acts).toEqual([
      { k: "lasting", e: { target: {}, restrict: { who: "opponent", action: "play", type: "Action" }, duration: "next" } },
    ]);

    const turn = parseCardText(face("Play: Each friendly creature gets +1 power for the remainder of the turn.", "Action"));
    expect(turn.abilities[0].acts[0]).toMatchObject({ k: "lasting", e: { power: 1, duration: "turn" } });
  });

  it("parses a quoted ability grant with the same grammar", () => {
    const rules = parseCardText(face("Each friendly creature gains 'Reap: Gain 1 amber.'"));
    expect(rules.coverage).toBe("full");
    expect(rules.effects[0].abilities).toEqual([{ on: ["reap"], acts: [{ k: "gainAmber", n: 1 }] }]);
  });

  it("keeps wording outside the grammar as vanilla text", () => {
    const rules = parseCardText(face("During your draw step, refill your hand to 1 additional card."));
    expect(rules.coverage).toBe("vanilla");
    expect(rules.effects).toHaveLength(0);
  });
});

describe("starter decks", () => {
  const all = [...DEMO_DECK.cards, ...DEMO_DECK_2.cards];
  const unique = [...new Map(all.map((card) => [card.id, card])).values()];

  it("every card that the old if/else table implemented is fully covered", () => {
    const coded = [
      "Coward's End", "Gateway to Dis", "Hysteria", "Fear", "Hand of Dis", "Tremor", "Smaaash", "Smith",
      "The Terror", "Mind Barb", "Dextre", "Hebe the Huge", "Tocsin", "Headhunter", "Screechbomb",
      "Key to Dis", "Dominator Bauble",
    ];
    for (const title of coded) {
      const card = unique.find((item) => item.title === title)!;
      expect([title, rulesOf(card).coverage]).toEqual([title, "full"]);
    }
  });

  it("reports coverage for every starter card", () => {
    const counts = { full: 0, partial: 0, vanilla: 0 };
    for (const card of unique) counts[rulesOf(card).coverage] += 1;
    // Snapshot of the parser's reach over the 58 distinct starter cards; a
    // change here must be deliberate (and reflected in MECHANICS_REPORT.md).
    // 35 -> 40 full with the persistent layer (Bulwark, Grey Monk, Staunch
    // Knight, Ember Imp and Scrambler Storm now read their constant text).
    expect(counts).toMatchInlineSnapshot(`
      {
        "full": 40,
        "partial": 1,
        "vanilla": 17,
      }
    `);
  });
});

describe("regression: BUG-01 'Fully heal' (docs/BUGS_AND_FEATURES.md)", () => {
  it("'Fully heal …' parses instead of throwing (was: wrong capture group reached parseObject)", () => {
    const seraphic = face("This creature gets +1 armor.\nPlay: Fully heal this creature.", "Upgrade", "Seraphic Armor");
    expect(() => parseCardText(seraphic)).not.toThrow();
    expect(rulesOf(seraphic).coverage).not.toBe("vanilla");
    expect(rulesOf(seraphic).abilities.some((ability) => ability.on.includes("play"))).toBe(true);
  });

  it("a creature with 'Fully heal' in hand must not crash getLegalMoves", () => {
    const state = setupTest({
      hand: [card("Bosch the Unyielding", { text: "Taunt." + String.fromCharCode(10) + "After Fight: Fully heal Bosch the Unyielding.", power: 6 })],
    });
    expect(() => getLegalMoves(state, 0, "Brobnar")).not.toThrow();
  });
});
