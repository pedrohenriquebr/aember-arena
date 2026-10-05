// SPDX-License-Identifier: AGPL-3.0-only
// Specs of the slug → corpus face join (join.mjs): the text of the card file decides.
import { describe, expect, it } from "vitest";
import { facesOf, indexCorpus } from "./join.mjs";

const face = (id, title, key, text) => ({ id, title, text, image: `https://x/media/card_front/en/${key}_ABC_en.png` });
const packs = new Map([
  ["old-egad", { names: new Set(["oldegad"]), keys: new Set(["496_056"]) }],
  ["old-egad-evil-twin", { names: new Set(["oldegad"]), keys: new Set(["496_004"]) }],
  ["veylan-analyst", { names: new Set(["veylananalyst"]), keys: new Set(["722_305"]) }],
  ["its-coming", { names: new Set(["itscoming"]), keys: new Set(["722_305"]) }],
  ["ghost", { names: new Set(["ghost"]), keys: new Set(["1_1"]) }],
]);
const NORMAL = face("n", "Old Egad", "496_056", "Destroyed: Ward each of Old Egad's neighbors.");
const TWIN = face("t", "Old Egad", "496_004", "Destroyed: Enrage each enemy creature.");

describe("keyteki join (join.mjs)", () => {
  it("an evil twin sharing the title does not contaminate the normal card (and vice versa)", () => {
    const corpus = indexCorpus([NORMAL, TWIN]);
    expect(facesOf("old-egad", "Destroyed: Ward each of Old Egad's neighbors.", packs, corpus).faces.map((f) => f.id)).toEqual(["n"]);
    expect(facesOf("old-egad-evil-twin", "Destroyed: Enrage each enemy creature.", packs, corpus).faces.map((f) => f.id)).toEqual(["t"]);
  });

  it("a header that matches no candidate text is not converted", () => {
    const corpus = indexCorpus([NORMAL, TWIN]);
    expect(facesOf("old-egad", "Destroyed: Something else.", packs, corpus)).toEqual({ faces: [], why: "noTextMatch" });
    expect(facesOf("old-egad", "", packs, corpus)).toEqual({ faces: [], why: "noText" });
  });

  it("a colliding key is ambiguous: neither slug joins through it, the text still decides by title", () => {
    const a = face("a", "Veylan Analyst", "722_305", "Play: Draw a card.");
    const b = face("b", "It's Coming", "722_305", "Play: Gain 1 amber.");
    const corpus = indexCorpus([a, b]);
    expect(corpus.ambiguous.has("722_305")).toBe(true);
    expect(facesOf("veylan-analyst", "Play: Draw a card.", packs, corpus).faces.map((f) => f.id)).toEqual(["a"]);
    expect(facesOf("its-coming", "Play: Gain 1 amber.", packs, corpus).faces.map((f) => f.id)).toEqual(["b"]);
    // the other card's face must never come through the shared key
    expect(facesOf("its-coming", "Play: Draw a card.", packs, corpus).faces).toEqual([]);
  });

  it("a single face with matching text joins", () => {
    const corpus = indexCorpus([NORMAL]);
    expect(facesOf("old-egad", "destroyed: ward each of old egad's neighbors", packs, corpus).faces).toEqual([NORMAL]);
  });

  it("counts a card with no face (or no pack entry) as no match", () => {
    const corpus = indexCorpus([NORMAL]);
    expect(facesOf("ghost", "Play: x.", packs, corpus)).toEqual({ faces: [], why: "noFace" });
    expect(facesOf("unknown-slug", "Play: x.", packs, corpus)).toEqual({ faces: [], why: "noPack" });
  });
});
