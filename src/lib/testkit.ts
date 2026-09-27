// Test-only helpers (never imported by the app, so they stay out of the bundle).
// The setupTest shape mirrors keyteki's test/helper (player1/player2 with hand,
// inPlay, amber) so specs ported from there read the same way.
import { DEMO_DECK } from "./demoDeck";
import { DEMO_DECK_2 } from "./demoDeck2";
import { createMatch, type CardFace, type CardInstance, type GameState } from "./game";

const faces = new Map<string, CardFace>();
for (const face of [...DEMO_DECK.cards, ...DEMO_DECK_2.cards]) faces.set(face.title.toLowerCase(), face);

let serial = 0;

export function face(title: string, overrides: Partial<CardFace> = {}): CardFace {
  const known = faces.get(title.toLowerCase());
  const base: CardFace = known ?? {
    id: `test-${title}`,
    title,
    house: "Brobnar",
    type: "Creature",
    image: "",
    text: "",
    amber: 0,
    power: 3,
    armor: 0,
  };
  return { ...base, ...overrides };
}

export function card(title: string, overrides: Partial<CardFace> = {}, ready = true): CardInstance {
  serial += 1;
  return { instanceId: `t${serial}-${title}`, face: face(title, overrides), damage: 0, ready, stunned: false };
}

export interface SideSetup {
  hand?: (string | CardInstance)[];
  inPlay?: (string | CardInstance)[];
  discard?: (string | CardInstance)[];
  deck?: (string | CardInstance)[];
  amber?: number;
  chains?: number;
  keys?: number;
}

const toCards = (items: (string | CardInstance)[] = []) => items.map((item) => (typeof item === "string" ? card(item) : item));

export function setupTest(player1: SideSetup, player2: SideSetup = {}, house: string | null = null): GameState {
  const state = createMatch(DEMO_DECK, DEMO_DECK_2);
  state.players.forEach((player, index) => {
    const setup = index === 0 ? player1 : player2;
    player.hand = toCards(setup.hand);
    player.board = toCards(setup.inPlay);
    player.discard = toCards(setup.discard);
    player.deck = setup.deck ? toCards(setup.deck) : player.deck;
    player.amber = setup.amber ?? 0;
    player.chains = setup.chains ?? 0;
    player.keys = setup.keys ?? 0;
  });
  state.activeHouse = house;
  // Past the first-turn rule unless a spec opts back in.
  state.turn = 2;
  state.log = [];
  return state;
}

export const byTitle = (cards: CardInstance[], title: string) => cards.find((item) => item.face.title === title);
export const titles = (cards: CardInstance[]) => cards.map((item) => item.face.title);

/** Seeded PRNG (mulberry32) so shuffles/random discards are reproducible in tests. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
