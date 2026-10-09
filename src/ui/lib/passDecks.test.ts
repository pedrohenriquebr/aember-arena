import { describe, expect, it } from "vitest";
import { pickPassDeck, resolvePassDecks } from "./passDecks";

const A = { id: "a" };
const B = { id: "b" };
const C = { id: "c" };
const library = [A, B, C];

describe("pass-and-play: dois decks, nunca o mesmo duas vezes (UX_REWRITE_PLAN §5 H-13)", () => {
  it("resolve os lados das configurações quando são válidos e distintos", () => {
    expect(resolvePassDecks(library, A, { deckP1Id: "b", deckP2Id: "c" })).toEqual([B, C]);
  });

  it("se o Jogador 2 repete o 1 ou some, cai no primeiro deck diferente", () => {
    expect(resolvePassDecks(library, A, { deckP1Id: "b", deckP2Id: "b" })).toEqual([B, A]);
    expect(resolvePassDecks(library, A, { deckP1Id: "b", deckP2Id: "removido" })).toEqual([B, A]);
  });

  it("escolher para o Jogador 1 o deck do 2 move o 2 para outro deck", () => {
    const settings = { deckP1Id: "a", deckP2Id: "b" };
    const patch = pickPassDeck(library, A, settings, 1, "b");
    expect(patch.deckP1Id).toBe("b");
    expect(patch.deckP2Id).not.toBe("b");
    const [p1, p2] = resolvePassDecks(library, A, { ...settings, ...patch });
    expect(p1.id).not.toBe(p2.id);
  });

  it("escolher o deck do Jogador 2 só mexe no 2", () => {
    expect(pickPassDeck(library, A, { deckP1Id: "a", deckP2Id: "b" }, 2, "c")).toEqual({ deckP1Id: "a", deckP2Id: "c" });
  });

  it("com um deck só na biblioteca os dois lados ficam iguais (a tela bloqueia o Jogar)", () => {
    const [p1, p2] = resolvePassDecks([A], A, {});
    expect(p1.id).toBe(p2.id);
  });
});
