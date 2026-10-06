// SPDX-License-Identifier: AGPL-3.0-only
// Onda 2, entrada: parserVersion na linha `parser` e overrides só entre partidas.
import { afterEach, describe, expect, it } from "vitest";
import { abilityOverrideOf, applyAbilityOverride, DSL_VERSION, flushAbilityOverrides, holdAbilityOverrides, mergeAbilityOverrides, normaliseAbilityOverride, rulesOf, setAbilityOverrides, type Ability, type AbilityOverride } from "./abilities";
import { PARSER_VERSION, textHash } from "./cardText";
import type { CardFace } from "./game";

const card: CardFace = { id: "ov-1", title: "Ov One", house: "Logos", type: "Action", image: "", text: "Play: Look at the top card of your deck and name it.", amber: 0, power: 0, armor: 0 };
const ability: Ability = { on: ["play"], acts: [{ k: "draw", n: 1 }] };
const row = (patch: Partial<AbilityOverride> = {}): AbilityOverride => ({
  cardId: card.id,
  dsl: [ability],
  effects: [],
  keywords: {},
  textHash: textHash(card.text),
  source: "manual",
  reviewed: true,
  generatedAt: 1,
  ...patch,
});

afterEach(() => {
  holdAbilityOverrides(false);
  setAbilityOverrides(new Map());
});

describe("parserVersion", () => {
  it("a parser row only counts with the running parser version", () => {
    setAbilityOverrides(new Map([[card.id, row({ source: "parser", parserVersion: PARSER_VERSION })]]));
    expect(rulesOf(card).abilities).toEqual([ability]);
    setAbilityOverrides(new Map([[card.id, row({ source: "parser", parserVersion: PARSER_VERSION + 1 })]]));
    expect(rulesOf(card).abilities).toEqual([]);
    setAbilityOverrides(new Map([[card.id, row({ source: "parser" })]]));
    expect(rulesOf(card).abilities).toEqual([]);
  });

  it("round-trips through the shape gate; manual rows ignore it", () => {
    expect(normaliseAbilityOverride({ ...row({ source: "parser" }), parserVersion: 7 })?.parserVersion).toBe(7);
    setAbilityOverrides(new Map([[card.id, row()]]));
    expect(rulesOf(card).abilities).toEqual([ability]);
  });
});

describe("DSL_VERSION (versioning contract)", () => {
  it("rejects a row written by a newer grammar and copies the version", () => {
    expect(DSL_VERSION).toBe(15);
    expect(normaliseAbilityOverride({ ...row(), v: DSL_VERSION })?.v).toBe(DSL_VERSION);
    expect(normaliseAbilityOverride({ ...row(), v: DSL_VERSION + 1 })).toBeNull();
    expect(normaliseAbilityOverride({ ...row(), v: "2" })).toBeNull();
    // A row without `v` is version 1 (implicit) and still readable.
    expect(normaliseAbilityOverride(row())?.v).toBeUndefined();
  });

  it("drops a row carrying a key the running grammar would silently ignore", () => {
    const unknownFilter = { ...row(), dsl: [{ on: ["play"], target: { type: "Creature", stunned: true }, acts: [{ k: "destroy", s: "target" }] }] };
    expect(normaliseAbilityOverride(unknownFilter)).toBeNull();
    const eachFilter = { ...row(), dsl: [{ on: ["play"], acts: [{ k: "destroy", s: { each: { type: "Creature", power: 3 } } }] }] };
    expect(normaliseAbilityOverride(eachFilter)).toBeNull();
    const conditionKey = { ...row(), dsl: [{ on: ["play"], if: { k: "amber", opp: true, op: "gte", n: 1, house: "Mars" }, acts: [{ k: "gainAmber", n: 1 }] }] };
    expect(normaliseAbilityOverride(conditionKey)).toBeNull();
    // A count/act from a newer grammar is dropped the same way.
    expect(normaliseAbilityOverride({ ...row(), dsl: [{ on: ["play"], acts: [{ k: "gainAmber", n: 1, per: { p: "hand", zone: "deck" } }] }] })).toBeNull();
    expect(normaliseAbilityOverride({ ...row(), dsl: [{ on: ["play"], acts: [{ k: "move", n: 1, from: "board", to: "discard" }] }] })).toBeNull();
    // `constructor` is inherited, not owned: the act table must not accept it.
    expect(normaliseAbilityOverride({ ...row(), dsl: [{ on: ["play"], acts: [{ k: "constructor", n: 1 }] }] })).toBeNull();
    // The whitelist is not stricter than the current DSL: known keys still pass.
    expect(normaliseAbilityOverride({ ...row(), dsl: [{ on: ["play"], target: { type: "Creature", flank: false }, acts: [{ k: "destroy", s: "target" }] }] })).not.toBeNull();
    const lote2 = {
      ...row(),
      dsl: [
        {
          on: ["play"],
          target: { type: "Creature", house: "!Mars", trait: "Knight", exhausted: true },
          acts: [{ k: "destroy", s: "target", per: { p: "discard" } }, { k: "move", n: 1, from: "deck", to: "discard", pick: "top" }],
        },
        { on: ["scrap"], acts: [{ k: "returnToDeck", s: { pick: { type: "Creature" }, n: 2 }, at: "bottom", if: { k: "count", of: "gone", op: "gte", n: 1 } }] },
      ],
    };
    expect(normaliseAbilityOverride(lote2)).not.toBeNull();
  });
});

describe("overrides apply only between matches", () => {
  it("stages writes during a match and flushes at the boundary", () => {
    expect(rulesOf(card).abilities).toEqual([]);
    holdAbilityOverrides(true);
    applyAbilityOverride(row());
    expect(rulesOf(card).abilities).toEqual([]);
    expect(abilityOverrideOf(card.id)).toBeDefined();
    flushAbilityOverrides();
    expect(rulesOf(card).abilities).toEqual([ability]);
  });

  it("stages the boot merge too, and a staged entry beats the disk snapshot", () => {
    holdAbilityOverrides(true);
    applyAbilityOverride(row({ dsl: [] }));
    mergeAbilityOverrides(new Map([[card.id, row()]]));
    flushAbilityOverrides();
    expect(rulesOf(card).abilities).toEqual([]);
    const other = { ...card, id: "ov-2" };
    holdAbilityOverrides(true);
    mergeAbilityOverrides(new Map([[other.id, row({ cardId: other.id })]]));
    expect(rulesOf(other).abilities).toEqual([]);
    flushAbilityOverrides();
    expect(rulesOf(other).abilities).toEqual([ability]);
  });

  it("applies immediately when no match is held", () => {
    applyAbilityOverride(row());
    expect(rulesOf(card).abilities).toEqual([ability]);
  });
});
