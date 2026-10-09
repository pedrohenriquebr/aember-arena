import { shelfOrder } from "./shelf";

/** Ordem da aba Meus (UX_REWRITE_PLAN §2 S4): "shelf" = a da prateleira do Lobby; "name" = A–Z. */
export type LibrarySort = "shelf" | "name";

/**
 * Meus decks: favoritos sempre primeiro. Em "shelf" o resto segue a prateleira (iniciais, depois
 * o resto); em "name" o resto vai em ordem alfabética. Função pura: a tela não guarda a lista.
 */
export function orderLibrary<D extends { id: string; name: string; favorite?: boolean }>(
  decks: D[],
  starterIds: ReadonlySet<string>,
  sort: LibrarySort,
): D[] {
  if (sort === "shelf") return shelfOrder(decks, decks.filter((deck) => starterIds.has(deck.id)), starterIds);
  const byName = (a: D, b: D) => a.name.localeCompare(b.name);
  return [
    ...decks.filter((deck) => deck.favorite).sort(byName),
    ...decks.filter((deck) => !deck.favorite).sort(byName),
  ];
}
