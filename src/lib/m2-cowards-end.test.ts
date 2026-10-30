// SPDX-License-Identifier: AGPL-3.0-only
// M2 · Coward’s End (7d1d5e99): "Play: Destroy each undamaged creature. Gain 3 chains."
// Bancada do TEXTO IMPRESSO (corpus), sem linha vendored.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyMove, type GameState } from "./game";
import { card, setupTest } from "./testkit";

const ID = "7d1d5e99-f0c4-4bfd-b515-0eaa50c0ce29";
const { title: TITLE, text: TEXT } = (JSON.parse(readFileSync(join(process.cwd(), "scripts", "harvest", "cards-corpus.json"), "utf8")) as { id: string; title: string; text: string }[]).find((c) => c.id === ID)!;

const coward = () => card(TITLE, { id: ID, type: "Action", house: "Brobnar", text: TEXT });
const creature = (title: string, damage = 0) => ({ ...card(title, { type: "Creature", house: "Brobnar", power: 3, armor: 0, text: "" }), damage });
const titlesOf = (cards: { face: { title: string } }[]) => cards.map((c) => c.face.title);

describe("M2 · Coward’s End — destrói toda criatura sem dano (dos dois lados) e ganha 3 correntes", () => {
  it("destrói só as criaturas sem dano, dos dois lados; as danificadas ficam; ganha 3 correntes", () => {
    const cw = coward();
    const state = setupTest(
      { hand: [cw], inPlay: [creature("Minha sem dano"), creature("Minha ferida", 1)] },
      { inPlay: [creature("Inimiga sem dano"), creature("Inimiga ferida", 2)] },
      "Brobnar",
    );
    const after = applyMove(state, 0, { type: "play", instanceId: cw.instanceId }) as GameState;
    expect(titlesOf(after.players[0].board)).toEqual(["Minha ferida"]);
    expect(titlesOf(after.players[1].board)).toEqual(["Inimiga ferida"]);
    expect(titlesOf(after.players[0].discard)).toContain("Minha sem dano");
    expect(titlesOf(after.players[1].discard)).toContain("Inimiga sem dano");
    expect(after.players[0].chains).toBe(3);
  });

  it("sem nenhuma criatura undamaged no tabuleiro: nada é destruído e as 3 correntes valem do mesmo jeito", () => {
    const cw = coward();
    const state = setupTest({ hand: [cw], inPlay: [creature("Ferida", 1)] }, { inPlay: [creature("Ferida inimiga", 1)] }, "Brobnar");
    const after = applyMove(state, 0, { type: "play", instanceId: cw.instanceId }) as GameState;
    expect(titlesOf(after.players[0].board)).toEqual(["Ferida"]);
    expect(titlesOf(after.players[1].board)).toEqual(["Ferida inimiga"]);
    expect(after.players[0].chains).toBe(3);
  });
});
