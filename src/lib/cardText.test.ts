import { describe, expect, it } from "vitest";
import { rulesOf } from "./abilities";
import { parseCardText } from "./cardText";
import { DEMO_DECK } from "./demoDeck";
import { DEMO_DECK_2 } from "./demoDeck2";
import type { CardFace } from "./game";

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
  ])("%s", (text, triggers) => {
    const rules = parseCardText(face(text));
    expect(rules.coverage).toBe("full");
    expect(rules.abilities[0].on).toEqual(triggers);
  });

  it.each(["After an enemy creature is destroyed fighting this card: Gain 1A.", "Interrupt: Gain 1A.", "Scrap: Gain 1A."])(
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
    expect(rules.abilities[0].acts).toEqual([{ k: "destroy", n: 0, s: "self" }, { k: "loseAmber", n: 2, opp: true }]);
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

  it("marks a persistent ability as partial coverage", () => {
    const rules = parseCardText(face("Each friendly creature gets +1 armor. Reap: Heal 2 damage from a creature."));
    expect(rules.coverage).toBe("partial");
    expect(rules.abilities).toHaveLength(1);
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
    expect(counts).toMatchInlineSnapshot(`
      {
        "full": 35,
        "partial": 2,
        "vanilla": 21,
      }
    `);
  });
});
