import { describe, expect, it } from "vitest";
import type { CardFace } from "../../lib/game";
import { filterDeckCards, groupByHouse } from "./deckDetail";

// H-16: o Detalhe filtra e agrupa as cartas por casa sem tocar na lista original.
const card = (title: string, house: string, extra: Partial<CardFace> = {}) =>
  ({ id: title.toLowerCase(), title, house, traits: "", text: "", ...extra }) as CardFace;

const cards = [
  card("Dodger", "Untamed", { traits: "Beast" }),
  card("Bosch", "Brobnar", { text: "Taunt. Fully heal." }),
  card("Grunt", "Brobnar"),
  card("Ancient Bear", "Untamed", { text: "Elusive" }),
];

describe("H-16 filterDeckCards", () => {
  it("sem filtro devolve tudo, na ordem do deck", () => {
    expect(filterDeckCards(cards, { query: "", house: null }).map((c) => c.title)).toEqual(["Dodger", "Bosch", "Grunt", "Ancient Bear"]);
  });

  it("casa filtra e a busca casa com título, traço e texto, sem diferença de caixa", () => {
    expect(filterDeckCards(cards, { query: "", house: "Brobnar" }).map((c) => c.title)).toEqual(["Bosch", "Grunt"]);
    expect(filterDeckCards(cards, { query: "BEAST", house: null }).map((c) => c.title)).toEqual(["Dodger"]);
    expect(filterDeckCards(cards, { query: "heal", house: "Untamed" }).map((c) => c.title)).toEqual([]);
    expect(filterDeckCards(cards, { query: "  elusive ", house: null }).map((c) => c.title)).toEqual(["Ancient Bear"]);
  });

  it("não altera a lista de entrada", () => {
    filterDeckCards(cards, { query: "grunt", house: "Brobnar" });
    expect(cards).toHaveLength(4);
  });
});

describe("H-16 groupByHouse", () => {
  it("segue a ordem de casas do deck e descarta grupos vazios", () => {
    const groups = groupByHouse(cards, ["Untamed", "Brobnar", "Sanctum"]);
    expect(groups.map((g) => g.house)).toEqual(["Untamed", "Brobnar"]);
    expect(groups[1].cards.map((c) => c.title)).toEqual(["Bosch", "Grunt"]);
  });

  it("casa que só existe nas cartas entra no fim (deck sem houses)", () => {
    const groups = groupByHouse([...cards, card("Ogre", "Logos")], ["Brobnar"]);
    expect(groups.map((g) => g.house)).toEqual(["Brobnar", "Untamed", "Logos"]);
  });
});
