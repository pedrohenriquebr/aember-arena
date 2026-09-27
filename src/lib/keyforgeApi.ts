import { cacheDeck, getCachedDeck } from "./cache";
import type { CardFace, DeckInfo } from "./game";
import type { Translator } from "./i18n";

const DECK_API = "https://www.keyforgegame.com/api/decks";
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

type ApiRecord = Record<string, unknown>;

/** Failure whose text the UI resolves through t(): `key` is an i18n key
    ("vault.*"), so the message follows the app language, not always English. */
export class VaultError extends Error {
  constructor(
    readonly key: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(key);
    this.name = "VaultError";
  }
}

/** User-facing text for any failure thrown by this module. */
export function vaultErrorText(error: unknown, t: Translator): string {
  if (error instanceof VaultError) return t(error.key, error.params);
  return error instanceof Error && error.message ? error.message : t("vault.loadFailed");
}

export interface DeckPage {
  decks: DeckInfo[];
  count: number;
  page: number;
  pageSize: number;
}

function valueAsString(value: unknown, fallback = ""): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

function valueAsNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getRecord(value: unknown): ApiRecord {
  return value && typeof value === "object" ? (value as ApiRecord) : {};
}

function normaliseCard(value: unknown): CardFace | null {
  const raw = getRecord(value);
  const id = valueAsString(raw.id);
  const title = valueAsString(raw.card_title ?? raw.title ?? raw.card_title_en, "Unknown card");
  const house = valueAsString(raw.house ?? raw.House, "Unknown");
  if (!id) return null;

  return {
    id,
    title,
    house,
    type: valueAsString(raw.card_type ?? raw.Card_Type ?? raw.type, "Action"),
    image: valueAsString(raw.front_image ?? raw.Front_Image ?? raw.image),
    text: valueAsString(raw.card_text ?? raw.Card_Text ?? raw.text).replace(/\u000b/g, "\n"),
    amber: valueAsNumber(raw.amber ?? raw.Amber),
    power: valueAsNumber(raw.power ?? raw.Power),
    armor: valueAsNumber(raw.armor ?? raw.Armor),
    traits: valueAsString(raw.traits ?? raw.Traits),
    rarity: valueAsString(raw.rarity ?? raw.Rarity),
    isMaverick: Boolean(raw.is_maverick ?? raw.Is_Maverick),
    cardNumber: valueAsString(raw.card_number ?? raw.Card_Number),
  };
}

export function extractDeckId(input: string): string {
  const id = input.trim().match(UUID_PATTERN)?.[0];
  if (!id) throw new VaultError("vault.badId");
  return id.toLowerCase();
}

function readHouses(links: ApiRecord, cards: CardFace[]): string[] {
  const houseValues = Array.isArray(links.houses) ? links.houses : [];
  const houses = houseValues
    .map((house) => (typeof house === "string" ? house : valueAsString(getRecord(house).name ?? getRecord(house).Name)))
    .filter(Boolean);
  return houses.length ? [...new Set(houses)] : [...new Set(cards.map((card) => card.house))];
}

function readCards(links: ApiRecord, cardsById: Map<string, CardFace>): CardFace[] {
  const cardIds = Array.isArray(links.cards) ? links.cards : [];
  const fromIds = cardIds
    .map((item) => (typeof item === "string" ? cardsById.get(item) : normaliseCard(item)))
    .filter((card): card is CardFace => Boolean(card));
  return fromIds.length ? fromIds : [...cardsById.values()];
}

function buildDeck(record: ApiRecord, cardsById: Map<string, CardFace>, fallbackId: string): DeckInfo | null {
  const links = getRecord(record._links ?? record.links);
  const cards = readCards(links, cardsById);
  if (!cards.length) return null;

  return {
    id: valueAsString(record.id, fallbackId),
    name: valueAsString(record.name ?? record.Name, "Imported KeyForge deck"),
    houses: readHouses(links, cards),
    cards,
    expansion: valueAsNumber(record.expansion ?? record.Expansion) || undefined,
    powerLevel: valueAsNumber(record.power_level ?? record.Power_Level),
    chains: valueAsNumber(record.chains ?? record.Chains),
    wins: valueAsNumber(record.wins ?? record.Wins),
    losses: valueAsNumber(record.losses ?? record.Losses),
  };
}

function sharedCardsMap(payload: ApiRecord): Map<string, CardFace> {
  const linked = getRecord(payload._linked);
  const linkedCards = Array.isArray(linked.cards) ? linked.cards : [];
  const faces = linkedCards.map(normaliseCard).filter((card): card is CardFace => card !== null);
  return new Map(faces.map((card) => [card.id, card] as const));
}

function describeFailure(error: unknown): Error {
  if (error instanceof Error && error.name === "AbortError") {
    return new VaultError("vault.timeout");
  }
  if (error instanceof TypeError) {
    return new VaultError("vault.unreachable");
  }
  return error instanceof Error ? error : new VaultError("vault.loadFailed");
}

function withTimeout(milliseconds: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const handle = window.setTimeout(() => controller.abort(), milliseconds);
  return { signal: controller.signal, clear: () => window.clearTimeout(handle) };
}

export async function fetchKeyforgeDeck(input: string): Promise<DeckInfo> {
  const id = extractDeckId(input);
  const { signal, clear } = withTimeout(15000);

  try {
    const response = await fetch(`${DECK_API}/${encodeURIComponent(id)}/?links=cards`, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) throw new VaultError("vault.status", { status: response.status });
    const payload = getRecord(await response.json());
    const data = getRecord(payload.data ?? payload.deck ?? payload);
    const deck = buildDeck(data, sharedCardsMap(payload), id);
    if (!deck) throw new VaultError("vault.noCards");
    await cacheDeck(deck);
    return deck;
  } catch (error) {
    throw describeFailure(error);
  } finally {
    clear();
  }
}

export async function fetchDeckPage(options: {
  page: number;
  pageSize?: number;
  search?: string;
  ordering?: string;
}): Promise<DeckPage> {
  const pageSize = options.pageSize ?? 9;
  const params = new URLSearchParams({
    page: String(Math.max(1, options.page)),
    page_size: String(pageSize),
    search: options.search ?? "",
    links: "cards",
    ordering: options.ordering ?? "-date",
  });
  const { signal, clear } = withTimeout(18000);

  try {
    const response = await fetch(`${DECK_API}/?${params.toString()}`, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) throw new VaultError("vault.status", { status: response.status });
    const payload = getRecord(await response.json());
    const records = Array.isArray(payload.data) ? payload.data : [];
    const cardsById = sharedCardsMap(payload);
    const decks = records
      .map((record) => buildDeck(getRecord(record), cardsById, ""))
      .filter((deck): deck is DeckInfo => Boolean(deck));

    if (!decks.length) throw new VaultError("vault.noResults");
    // Cache the page decks one after another: together with the shared IDB
    // connection in cache.ts this keeps a single open() and one write
    // transaction at a time instead of nine concurrent ones per browse page.
    void decks
      .reduce<Promise<void>>((chain, deck) => chain.then(() => cacheDeck(deck)), Promise.resolve())
      .catch(() => undefined);

    return {
      decks,
      count: valueAsNumber(payload.count) || decks.length,
      page: Math.max(1, options.page),
      pageSize,
    };
  } catch (error) {
    throw describeFailure(error);
  } finally {
    clear();
  }
}

export async function loadDeckOrCache(input: string): Promise<{ deck: DeckInfo; fromCache: boolean }> {
  const id = extractDeckId(input);
  try {
    return { deck: await fetchKeyforgeDeck(id), fromCache: false };
  } catch (error) {
    const cached = await getCachedDeck(id);
    if (cached) return { deck: cached, fromCache: true };
    throw error;
  }
}
