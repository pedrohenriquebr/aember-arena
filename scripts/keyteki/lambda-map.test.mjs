// SPDX-License-Identifier: AGPL-3.0-only
// Derived from keyteki card scripts (copyright keyteki contributors, AGPL-3.0).
// M2: lane G tables + lane M lambda-map in the lowering. A map hit converts, a null stays
// C-layer, and everything the map produces still goes through the DSL shape gate.
import { afterEach, describe, expect, it } from "vitest";
import { validateDraft } from "../../src/lib/catalogLlm";
import { setEnabled } from "./lambdaMap.mjs";
import { Unsupported } from "./lambdas.mjs";
import { isCLayer, lowerCard } from "./lower.mjs";
import { parseCardSource } from "./parse.mjs";

const card = (body) => `const Card = require('../../Card.js');
class A extends Card {
    // text
    setupCardAbilities(ability) {
${body}
    }
}
A.id = 'a';
module.exports = A;
`;
const lower = (body) => lowerCard(parseCardSource(card(body)));
const code = (body) => {
  try {
    lower(body);
  } catch (e) {
    expect(e).toBeInstanceOf(Unsupported);
    return e.code;
  }
  return "ok";
};
const face = { id: "c-1", title: "Probe", house: "Logos", type: "Creature", image: "", text: "Play: probe.", amber: 0, power: 3, armor: 0 };
const gate = (l) => validateDraft(face, { abilities: l.abilities, effects: l.effects, keywords: {} }, "llm");

afterEach(() => setEnabled(true));

describe("lambda-map in the lowering (M2)", () => {
  it("a map entry (isHaunted → count discard gte 10) converts and passes the gate", () => {
    const l = lower("        this.play({ condition: (context) => context.player.isHaunted(), gameAction: ability.actions.gainAmber() });");
    expect(l.abilities[0].if).toEqual({ k: "count", of: { p: "discard" }, op: "gte", n: 10 });
    expect(l.via.map).toBe(1);
    expect(gate(l).ok).toBe(true);
  });

  it("a null map entry stays C-layer (never guessed)", () => {
    const src = "        this.play({ condition: (context) => context.player.isTideHigh(), gameAction: ability.actions.gainAmber() });";
    expect(code(src)).toBe("condition");
    expect(isCLayer(code(src))).toBe(true);
  });

  it("a dynamic amount from the map becomes n x per, and is gated", () => {
    const l = lower("        this.play({ gameAction: ability.actions.gainAmber((context) => ({ amount: context.player.opponent.amber })) });");
    expect(l.abilities[0].acts).toEqual([{ k: "gainAmber", n: 1, per: { p: "amber", opp: true } }]);
    expect(gate(l).ok).toBe(true);
  });

  it("the corrected entries: opponent with more creatures is fewerCreatures (the engine's moreCreatures is 'you')", () => {
    const l = lower("        this.play({ condition: (context) => context.player.opponent && context.player.opponent.creaturesInPlay.length > context.player.creaturesInPlay.length, gameAction: ability.actions.steal() });");
    expect(l.abilities[0].if).toEqual({ k: "fewerCreatures" });
  });

  it("table families (no map entry): zone length and its negation", () => {
    const l = lower("        this.play({ condition: (context) => context.player.hand.length >= 4, gameAction: ability.actions.gainAmber() });");
    expect(l.abilities[0].if).toEqual({ k: "count", of: { p: "hand" }, op: "gte", n: 4 });
    expect(l.via).toEqual({ map: 0, table: 1 });
    expect(lower("        this.play({ condition: (context) => !context.player.isHaunted(), gameAction: ability.actions.gainAmber() });").abilities[0].if).toEqual({ k: "not", c: { k: "count", of: { p: "discard" }, op: "gte", n: 10 } });
    expect(gate(l).ok).toBe(true);
  });

  it("a Count in a condition slot is not used", () => {
    // `{c:{}}`-style Count entries must never leak into an `if`
    expect(code("        this.play({ condition: (context) => context.player.opponent && context.player.amber < context.player.opponent.amber, gameAction: ability.actions.gainAmber() });")).toBe("condition");
  });

  it("--baseline (map off) restores the C-layer", () => {
    setEnabled(false);
    expect(code("        this.play({ condition: (context) => context.player.isHaunted(), gameAction: ability.actions.gainAmber() });")).toBe("condition");
  });
});
