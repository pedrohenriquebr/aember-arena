import type { CardFace } from "../../lib/game";

export interface CardFilter {
  /** Texto livre (título, casa, traço, texto); vazio não filtra. */
  query: string;
  /** Casa escolhida; null = todas. */
  house: string | null;
}

/** Filtra as cartas do Detalhe. Função pura: a tela não guarda a lista filtrada. */
export function filterDeckCards(cards: CardFace[], filter: CardFilter): CardFace[] {
  const needle = filter.query.trim().toLowerCase();
  return cards.filter((card) => {
    if (filter.house && card.house !== filter.house) return false;
    if (!needle) return true;
    return [card.title, card.house, card.traits ?? "", card.text ?? ""].some((field) => field.toLowerCase().includes(needle));
  });
}

/**
 * Cartas por casa (UX_REWRITE_PLAN §2 S5): as casas do deck na ordem em que o deck as declara;
 * grupos vazios somem. Uma casa que aparece só nas cartas entra no fim (deck sem `houses`).
 */
export function groupByHouse(cards: CardFace[], houseOrder: string[]): { house: string; cards: CardFace[] }[] {
  const houses = [...new Set([...houseOrder, ...cards.map((card) => card.house)])];
  return houses
    .map((house) => ({ house, cards: cards.filter((card) => card.house === house) }))
    .filter((group) => group.cards.length > 0);
}
