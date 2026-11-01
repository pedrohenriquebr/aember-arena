// SPDX-License-Identifier: AGPL-3.0-only
// M2 · Drummernaut (kt:722:045): "Play/After Fight/After Reap: Return another friendly Giant
// creature to your hand." A linha aprovada do approved.json é igual ao que o parser puro já
// produz; a bancada roda com a linha do jogo (boot) e prova o texto impresso.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normaliseAbilityOverride, setAbilityOverrides, type AbilityOverride } from "./abilities";
import { textHash } from "./cardText";
import { applyMove, type GameState } from "./game";
import { card, setupTest } from "./testkit";
import { harvestJson } from "./testHarvest";
const ID = "kt:722:045:brobnar";
const CORPUS = harvestJson<{ id: string; title: string; text: string }[]>("cards-corpus.json") ?? [];
const HAS_CORPUS = CORPUS.length > 0;
const { title: TITLE, text: TEXT } = CORPUS.find((c) => c.id === ID) ?? { title: "", text: "" };
const ROW = normaliseAbilityOverride((JSON.parse(readFileSync(join(process.cwd(), "src", "lib", "generated", "approved.json"), "utf8")) as { cardId: string }[]).find((r) => r.cardId === ID)) as AbilityOverride;

beforeEach(() => setAbilityOverrides(new Map([[ID, ROW]])));
afterEach(() => setAbilityOverrides(new Map()));

const drum = (ready = true) => card(TITLE, { id: ID, type: "Creature", house: "Brobnar", power: 5, armor: 0, text: TEXT, traits: "Giant" }, ready);
const giant = (title: string, house = "Brobnar") => card(title, { type: "Creature", house, power: 6, armor: 0, text: "", traits: "Giant" });
const titlesOf = (cards: { face: { title: string } }[]) => cards.map((c) => c.face.title);

describe.skipIf(!HAS_CORPUS)("M2 · Drummernaut — devolve outro Giant amigo à mão (Play, After Fight, After Reap)", () => {
  it("a linha passa no validador e o hash é o do texto impresso", () => {
    expect(ROW).not.toBeNull();
    expect(ROW.textHash).toBe(textHash(TEXT));
  });

  it("After Reap: o Giant amigo volta à mão; Drummernaut e o Giant inimigo ficam no tabuleiro", () => {
    const d = drum();
    const g = giant("Giant amigo");
    const foeGiant = giant("Giant inimigo", "Dis");
    const state = setupTest({ inPlay: [d, g] }, { inPlay: [foeGiant] }, "Brobnar");
    const after = applyMove(state, 0, { type: "reap", instanceId: d.instanceId, target: g.instanceId }) as GameState;
    expect(titlesOf(after.players[0].hand)).toContain("Giant amigo");
    expect(titlesOf(after.players[0].board)).toContain(TITLE);
    expect(titlesOf(after.players[0].board)).not.toContain("Giant amigo");
    expect(titlesOf(after.players[1].board)).toContain("Giant inimigo");
  });

  it("Play: jogar Drummernaut da mão também devolve um Giant amigo", () => {
    const d = drum();
    const g = giant("Giant amigo");
    const state = setupTest({ hand: [d], inPlay: [g] }, {}, "Brobnar");
    const after = applyMove(state, 0, { type: "play", instanceId: d.instanceId, target: g.instanceId }) as GameState;
    expect(titlesOf(after.players[0].hand)).toContain("Giant amigo");
  });
});
