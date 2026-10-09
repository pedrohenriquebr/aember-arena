import type { AppSettings } from "../../lib/settings";

type Deck = { id: string };
type PassSettings = Pick<AppSettings, "deckP1Id" | "deckP2Id">;

/**
 * Os dois decks de um pass-and-play (movido de App.tsx sem mudança de regra). Com pelo menos
 * dois decks na biblioteca, os lados nunca repetem; o fallback só aparece com biblioteca de um.
 */
export function resolvePassDecks<D extends Deck>(savedDecks: D[], fallback: D, settings: PassSettings): [D, D] {
  const p1 = savedDecks.find((item) => item.id === settings.deckP1Id) ?? fallback;
  const p2 =
    savedDecks.find((item) => item.id === settings.deckP2Id && item.id !== p1.id) ??
    savedDecks.find((item) => item.id !== p1.id) ??
    fallback;
  return [p1, p2];
}

/**
 * Patch de settings para o picker de um lado: escolher o deck do Jogador 2 para o Jogador 1
 * move o 2 para outro deck da biblioteca (nunca dois iguais), como a revisão da v1 faz.
 */
export function pickPassDeck<D extends Deck>(savedDecks: D[], fallback: D, settings: PassSettings, side: 1 | 2, id: string): PassSettings {
  const [p1, p2] = resolvePassDecks(savedDecks, fallback, settings);
  if (side === 2) return { deckP1Id: p1.id, deckP2Id: id };
  return { deckP1Id: id, deckP2Id: id === p2.id ? savedDecks.find((item) => item.id !== id)?.id : p2.id };
}
