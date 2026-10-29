// SPDX-License-Identifier: AGPL-3.0-only
// M1 · Titan Librarian (ca388cc0): "At the end of your turn, if Titan Librarian is not on a
// flank, archive a card." Bancada do TEXTO IMPRESSO (corpus), sem linha vendored. "Archive a
// card" = mover 1 carta da MÃO para os arquivos (cardText: `archive (a|an|N) cards` → hand→archives).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normaliseAbilityOverride, setAbilityOverrides, type AbilityOverride } from "./abilities";
import { textHash } from "./cardText";
import { endTurn, type GameState } from "./game";
import { card, setupTest } from "./testkit";

const ID = "ca388cc0-ec45-446e-a20c-7bcd962c1a6b";
const TEXT = (JSON.parse(readFileSync(join(process.cwd(), "scripts", "harvest", "cards-corpus.json"), "utf8")) as { id: string; text: string }[]).find((c) => c.id === ID)!.text;

const ROW = normaliseAbilityOverride((JSON.parse(readFileSync(join(process.cwd(), "src", "lib", "generated", "approved.json"), "utf8")) as { cardId: string }[]).find((r) => r.cardId === ID)) as AbilityOverride;

beforeEach(() => setAbilityOverrides(new Map([[ID, ROW]])));
afterEach(() => setAbilityOverrides(new Map()));

describe("M1 · linha vendored (approved.json) — validador e hash do corpus", () => {
  it("passa no validador e o hash é o do texto impresso", () => {
    expect(ROW).not.toBeNull();
    expect(ROW.textHash).toBe(textHash(TEXT));
  });
});

const titan = () => card("Titan Librarian", { id: ID, type: "Creature", house: "Logos", power: 4, armor: 0, text: TEXT });
const ally = (title: string) => card(title, { type: "Creature", house: "Logos", power: 2, armor: 0, text: "" });
const handCards = () => [card("Mão A"), card("Mão B")];

/** Fim do meu turno com a battleline dada; devolve o estado depois do fim do turno. */
function endOf(board: ReturnType<typeof card>[]): GameState {
  const state = setupTest({ inPlay: board, hand: handCards() }, {}, "Logos");
  return endTurn(state, 0);
}

describe("M1 · Titan Librarian — arquiva uma carta no fim do meu turno se não estiver em flanco", () => {
  it("no meio da battleline (não é flanco): arquiva uma carta da mão", () => {
    const t = titan();
    const after = endOf([ally("Esquerda"), t, ally("Direita")]);
    expect(after.players[0].archives.length).toBe(1);
    expect(after.players[0].hand.filter((c) => c.face.title.startsWith("Mão")).length).toBe(1);
  });

  it("na ponta da battleline (flanco): não arquiva nada", () => {
    const t = titan();
    const after = endOf([t, ally("Vizinha")]);
    expect(after.players[0].archives.length).toBe(0);
  });

  it("a carta arquivada sai da mão (não do topo do baralho)", () => {
    const t = titan();
    const after = endOf([ally("Esquerda"), t, ally("Direita")]);
    expect(after.players[0].archives.some((c) => c.face.title.startsWith("Mão"))).toBe(true);
  });
});
