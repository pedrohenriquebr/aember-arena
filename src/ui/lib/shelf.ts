/**
 * Ordem da prateleira do Lobby (UX_REWRITE_PLAN §2 S2): favoritos da biblioteca primeiro,
 * depois os decks iniciais, depois o resto. É a mesma ordem da Home v1 (HomeScreen), então
 * o jogador não reaprende onde está cada deck ao trocar de versão.
 */
export function shelfOrder<D extends { id: string; favorite?: boolean }>(
  decks: D[],
  starters: D[],
  starterIds: ReadonlySet<string>,
): D[] {
  const extra = decks.filter((deck) => !starterIds.has(deck.id));
  return [
    ...extra.filter((deck) => deck.favorite),
    ...starters,
    ...extra.filter((deck) => !deck.favorite),
  ];
}
