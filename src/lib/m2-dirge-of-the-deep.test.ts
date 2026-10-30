// SPDX-License-Identifier: AGPL-3.0-only
// M2 · Dirge of the Deep (67ca7dfb): "Enhance. Play: Discard the bottom card of your opponent’s
// deck. Exhaust each creature that shares a house with that card." O parser puro devolve
// vanilla para esta carta: a bancada roda com a linha JÁ APROVADA do approved.json (a que o
// jogo carrega no boot) e prova o texto impresso contra ela.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normaliseAbilityOverride, setAbilityOverrides, type AbilityOverride } from "./abilities";
import { textHash } from "./cardText";
import { applyMove, type GameState } from "./game";
import { card, setupTest } from "./testkit";

const ID = "67ca7dfb-455a-4ba9-89a8-12c5e5be02d9";
const { title: TITLE, text: TEXT } = (JSON.parse(readFileSync(join(process.cwd(), "scripts", "harvest", "cards-corpus.json"), "utf8")) as { id: string; title: string; text: string }[]).find((c) => c.id === ID)!;
const ROW = normaliseAbilityOverride((JSON.parse(readFileSync(join(process.cwd(), "src", "lib", "generated", "approved.json"), "utf8")) as { cardId: string }[]).find((r) => r.cardId === ID)) as AbilityOverride;

beforeEach(() => setAbilityOverrides(new Map([[ID, ROW]])));
afterEach(() => setAbilityOverrides(new Map()));

const dirge = () => card(TITLE, { id: ID, type: "Action", house: "Unfathomable", text: TEXT });
const creature = (title: string, house: string) => card(title, { type: "Creature", house, power: 3, armor: 0, text: "" });
const readyOf = (state: GameState, side: 0 | 1, title: string) => state.players[side].board.find((c) => c.face.title === title)?.ready;

describe("M2 · Dirge of the Deep — linha aprovada: fundo do baralho inimigo vai ao descarte e a casa dele trava", () => {
  it("a linha passa no validador e o hash é o do texto impresso", () => {
    expect(ROW).not.toBeNull();
    expect(ROW.textHash).toBe(textHash(TEXT));
  });

  it("descarta o FUNDO do baralho do oponente (deck[0]) e exaure toda criatura da casa dele, a minha inclusive", () => {
    const d = dirge();
    // deck[0] = fundo (Untamed); o topo é o último elemento.
    const state = setupTest(
      { hand: [d], inPlay: [creature("Minha Untamed", "Untamed")] },
      { deck: [card("Fundo", { house: "Untamed" }), card("Topo", { house: "Brobnar" })], inPlay: [creature("Inimiga Untamed", "Untamed"), creature("Inimiga Brobnar", "Brobnar"), creature("Inimiga Dis", "Dis")] },
      "Unfathomable",
    );
    const after = applyMove(state, 0, { type: "play", instanceId: d.instanceId }) as GameState;
    expect(after.players[1].discard.map((c) => c.face.title)).toContain("Fundo");
    expect(after.players[1].deck.map((c) => c.face.title)).toEqual(["Topo"]);
    expect(readyOf(after, 1, "Inimiga Untamed")).toBe(false);
    expect(readyOf(after, 0, "Minha Untamed")).toBe(false);
    expect(readyOf(after, 1, "Inimiga Brobnar")).toBe(true);
    expect(readyOf(after, 1, "Inimiga Dis")).toBe(true);
  });
});
