// SPDX-License-Identifier: AGPL-3.0-only
// QA-04: glifos privados do MV (U+F360/F361) na EXIBIÇÃO — nunca tofu.
import { describe, expect, it } from "vitest";
import { displayCardText, readableText, splitCardGlyphs } from "./cardText";

describe("displayCardText (QA-04)", () => {
  it("maps Æmber and damage glyphs to <A>/<D>", () => {
    expect(displayCardText("Play: If you are haunted, capture all your opponent’s .\n")).toBe("Play: If you are haunted, capture all your opponent’s <A>.\n");
    expect(displayCardText("Deal 2 to a creature.")).toBe("Deal 2<D> to a creature.");
  });

  it("drops other private-use decoration (Enhance icons) and the BOM, keeps normal text", () => {
    expect(displayCardText("﻿Enhance . Æmber æ ö")).toBe("Enhance . Æmber æ ö");
  });

  it("splits into text and glyph parts for the inline icon renderer", () => {
    expect(splitCardGlyphs("Gain 1, deal 1")).toEqual(["Gain 1", { glyph: "A" }, ", deal 1", { glyph: "D" }]);
    expect(splitCardGlyphs("")).toEqual([]);
  });

  it("leaves the engine's normaliser alone", () => {
    expect(readableText("capture ")).toContain("<A>");
  });
});
