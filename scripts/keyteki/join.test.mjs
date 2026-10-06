// SPDX-License-Identifier: AGPL-3.0-only
// Specs of the slug → corpus face join (join.mjs): the text of the card file decides.
import { describe, expect, it } from "vitest";
import { canonDeTexto, facesOf, indexCorpus } from "./join.mjs";

const face = (id, title, key, text) => ({ id, title, text, image: `https://x/media/card_front/en/${key}_ABC_en.png` });
const packs = new Map([
  ["old-egad", { names: new Set(["oldegad"]), keys: new Set(["496_056"]) }],
  ["old-egad-evil-twin", { names: new Set(["oldegad"]), keys: new Set(["496_004"]) }],
  ["veylan-analyst", { names: new Set(["veylananalyst"]), keys: new Set(["722_305"]) }],
  ["its-coming", { names: new Set(["itscoming"]), keys: new Set(["722_305"]) }],
  ["ghost", { names: new Set(["ghost"]), keys: new Set(["1_1"]) }],
  ["dissonant-chord", { names: new Set(["dissonantchord"]), keys: new Set(["12_01", "12_02", "12_03"]) }],
  ["protective-playmate", { names: new Set(["protectiveplaymate"]), keys: new Set(["99_01"]) }],
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

describe("keyteki join — forma canônica (Lote 15a)", () => {
  it("canonDeTexto equaliza glifo, letra digitada e palavra do Æmber/dano", () => {
    expect(canonDeTexto("Play: Deal 3D to a creature.")).toBe(canonDeTexto("Play: Deal 3\uF361 to a creature."));
    expect(canonDeTexto("Play: Deal 3D to a creature.")).toBe(canonDeTexto("Play: Deal 3 damage to a creature."));
    expect(canonDeTexto("with A on it")).toBe(canonDeTexto("with \uF360 on it"));
    expect(canonDeTexto("with A on it")).toBe(canonDeTexto("with amber on it"));
    // o artigo "a" nunca vira símbolo
    expect(canonDeTexto("destroy a creature")).not.toBe(canonDeTexto("destroy amber creature"));
  });

  it("canonDeTexto remove linhas que são só keyword impressa", () => {
    expect(canonDeTexto("Taunt.\nPlay: Draw a card.")).toBe(canonDeTexto("Play: Draw a card."));
    expect(canonDeTexto("Elusive. (The first time this creature is attacked each turn, no damage is dealt.)\nPlay: X.")).toBe(canonDeTexto("Play: X."));
    // uma linha com ability não é keyword-only
    expect(canonDeTexto("Taunt. Fight/Reap: Capture 1A.")).not.toBe(canonDeTexto("Fight/Reap: Capture 1A."));
  });

  it("o fallback canônico casa o header com a face que só diverge na forma do símbolo", () => {
    const glyph = face("g", "Dissonant Chord", "12_01", "Play: Deal 3\uF361 to a creature. If this damage destroys that creature, stun it.");
    const corpus = indexCorpus([glyph]);
    expect(facesOf("dissonant-chord", "Play: Deal 3D to a creature. If this damage destroys that creature, stun it.", packs, corpus).faces.map((f) => f.id)).toEqual(["g"]);
  });

  it("o fallback canônico tolera a linha de keyword que o header omite", () => {
    const printed = face("p", "Protective Playmate", "99_01", "Taunt.\nWhile you are haunted, Protective Playmate gets +6 power.");
    const corpus = indexCorpus([printed]);
    expect(facesOf("protective-playmate", "While you are haunted, Protective Playmate gets +6 power.", packs, corpus).faces.map((f) => f.id)).toEqual(["p"]);
    // e a forma impressa continua casando pelo texto cru quando bate
    expect(facesOf("protective-playmate", "Taunt.\nWhile you are haunted, Protective Playmate gets +6 power.", packs, corpus).faces.map((f) => f.id)).toEqual(["p"]);
  });

  it("canon igual com notação diferente é a MESMA impressão: todas casam", () => {
    const glyph = face("g", "Dissonant Chord", "12_01", "Play: Deal 3 to a creature.");
    const letter = face("l", "Dissonant Chord", "12_02", "Play: Deal 3D to a creature.");
    const corpus = indexCorpus([glyph, letter]);
    expect(facesOf("dissonant-chord", "Play: Deal 3 damage to a creature.", packs, corpus).faces.map((f) => f.id).sort()).toEqual(["g", "l"]);
  });

  it("canon igual com impressões diferentes (linha de keyword) é ambíguo: nenhum casa", () => {
    const taunt = face("a", "Dissonant Chord", "12_01", "Taunt.\nPlay: Deal 3 to a creature.");
    const plain = face("b", "Dissonant Chord", "12_02", "Play: Deal 3 to a creature.");
    const corpus = indexCorpus([taunt, plain]);
    // o canon casa os dois, mas são impressões diferentes — como no `ambiguous`,
    // nenhum deles ganha a linha do arquivo
    expect(facesOf("dissonant-chord", "Play: Deal 3D to a creature.", packs, corpus)).toEqual({ faces: [], why: "noTextMatch" });
    // sozinha, cada impressão casa normalmente
    expect(facesOf("dissonant-chord", "Play: Deal 3D to a creature.", packs, indexCorpus([plain])).faces.map((f) => f.id)).toEqual(["b"]);
    expect(facesOf("dissonant-chord", "Taunt.\nPlay: Deal 3D to a creature.", packs, indexCorpus([taunt])).faces.map((f) => f.id)).toEqual(["a"]);
  });

  it("o texto cru decide primeiro: uma face exata não divide o join com a irmã canônica", () => {
    const exact = face("e", "Dissonant Chord", "12_01", "Play: Deal 3D to a creature.");
    const glyph = face("g", "Dissonant Chord", "12_02", "Play: Deal 3\uF361 to a creature.");
    const corpus = indexCorpus([exact, glyph]);
    expect(facesOf("dissonant-chord", "Play: Deal 3D to a creature.", packs, corpus).faces.map((f) => f.id)).toEqual(["e"]);
  });
});
