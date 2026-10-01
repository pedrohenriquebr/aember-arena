import { cacheDeck, countCatalogCards, getCachedDeck, listCatalogCardHashes, putCatalogCards } from "./cache";
import { textHash } from "./cardText";
import type { CardFace, DeckInfo } from "./game";
import type { Translator } from "./i18n";

const DECK_API = "https://www.keyforgegame.com/api/decks";
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Catalog sync defaults (plano §3): the Vault caps page_size at 10 decks, and
    one run walks a bounded number of pages so the button stays responsive. */
export const CARD_PAGE_SIZE = 10;
export const CATALOG_PAGES_PER_SYNC = 20;

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

/** Enhanced bonus icons (Onda 4): the payload's `enhancements` array lists one
    icon per enhancement ("amber", "capture", "damage", "draw", "discard",
    "power" or a house name — keyteki deck.js / Card.bonusIcons). Amber icons add
    to the printed amber; the capture/damage/draw ones are the extra icons the
    engine resolves on play. House/discard/power enhancements are not modelled,
    and a payload without enhancements keeps `amber` alone. Exported for the
    specs: the shape is the Master Vault one, so the mapping is worth asserting. */
export function readBonusIcons(raw: ApiRecord, amber: number): CardFace["bonusIcons"] {
  const enhancements = Array.isArray(raw.enhancements)
    ? raw.enhancements.filter((item): item is string => typeof item === "string").map((item) => item.toLowerCase())
    : [];
  if (!enhancements.length) return undefined;
  const count = (icon: string) => enhancements.filter((item) => item === icon).length;
  return { amber: amber + count("amber"), capture: count("capture"), damage: count("damage"), draw: count("draw") };
}

function normaliseCard(value: unknown): CardFace | null {
  const raw = getRecord(value);
  const id = valueAsString(raw.id);
  const title = valueAsString(raw.card_title ?? raw.title ?? raw.card_title_en, "Unknown card");
  const house = valueAsString(raw.house ?? raw.House, "Unknown");
  if (!id) return null;
  // Tokens/prophecies/archon powers are not playable cards; letting them in
  // made the engine discard them like Actions and the UI show raw keys (BUG-22).
  const type = valueAsString(raw.card_type ?? raw.Card_Type ?? raw.type, "Action");
  if (!["Creature", "Artifact", "Upgrade", "Action"].includes(type)) return null;
  const amber = valueAsNumber(raw.amber ?? raw.Amber);

  return {
    id,
    title,
    house,
    type,
    image: valueAsString(raw.front_image ?? raw.Front_Image ?? raw.image),
    text: valueAsString(raw.card_text ?? raw.Card_Text ?? raw.text).replace(/\u000b/g, "\n"),
    amber,
    power: valueAsNumber(raw.power ?? raw.Power),
    armor: valueAsNumber(raw.armor ?? raw.Armor),
    traits: valueAsString(raw.traits ?? raw.Traits),
    rarity: valueAsString(raw.rarity ?? raw.Rarity),
    isMaverick: Boolean(raw.is_maverick ?? raw.Is_Maverick),
    cardNumber: valueAsString(raw.card_number ?? raw.Card_Number),
    // keyteki-style keyword array ("elusive", "assault:2") when the payload has one;
    // otherwise the engine reads the keywords printed in card_text.
    keywords: Array.isArray(raw.keywords) ? raw.keywords.filter((item): item is string => typeof item === "string") : undefined,
    bonusIcons: readBonusIcons(raw, amber),
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
  // Anything else (SyntaxError from an HTML maintenance page, Cloudflare
  // interstitials...) has no user-facing message: it used to leak raw English
  // like "Unexpected token '<'" into both languages (BUG-20).
  if (!(error instanceof VaultError)) return new VaultError("vault.loadFailed");
  return error;
}

function withTimeout(milliseconds: number, external?: AbortSignal): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  // Catalog sync passes its cancel signal in: an aborted run rejects exactly like
  // a timeout (describeFailure) and syncCatalog tells both apart by the signal.
  if (external?.aborted) controller.abort();
  else external?.addEventListener("abort", abort);
  // Timers without `window.` so the specs can drive this with a fetch mock in Node.
  const handle = setTimeout(() => controller.abort(), milliseconds);
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(handle);
      external?.removeEventListener("abort", abort);
    },
  };
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

// ---------- Catalog sync (DB v4, docs/DYNAMIC_CATALOG_PLAN.md §3) ----------

export interface CardPage {
  /** Unique card rows of this page (the payload inlines every card of its decks). */
  cards: CardFace[];
  /** Registered decks in the Vault for this ordering — the page cursor bound. */
  count: number;
  page: number;
  pageSize: number;
}

/** One page of the Master Vault catalog. There is no standalone cards endpoint
    (`/api/cards/` answers 404 — verified 30/09); the deck list inlines each
    deck's cards in `_linked.cards`, so the catalog is harvested with the same
    timeout/error wrapper and pagination as fetchDeckPage (plano §3). */
export async function fetchCardPage(options: { page: number; pageSize?: number; signal?: AbortSignal }): Promise<CardPage> {
  const pageSize = options.pageSize ?? CARD_PAGE_SIZE;
  const page = Math.max(1, options.page);
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
    links: "cards",
    ordering: "-date",
  });
  const { signal, clear } = withTimeout(20000, options.signal);

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
    const cards = [...sharedCardsMap(payload).values()];
    // An empty page is the end of the list, not a failure: syncCatalog stops on
    // it without an error (the browse page has its own vault.noResults state).
    return { cards, count: valueAsNumber(payload.count) || cards.length, page, pageSize };
  } catch (error) {
    throw describeFailure(error);
  } finally {
    clear();
  }
}

const CATALOG_CURSOR_KEY = "aember-arena-catalog-cursor";

/** Deck page the next sync starts from (plano §3: incremental cursor). Kept in
    localStorage so a run resumes after a reload; unreadable storage restarts
    from the newest page, which is where new cards appear. */
function readCatalogCursor(): number {
  try {
    const page = Number(localStorage.getItem(CATALOG_CURSOR_KEY));
    return Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  } catch {
    return 1;
  }
}

function saveCatalogCursor(page: number): void {
  try {
    localStorage.setItem(CATALOG_CURSOR_KEY, String(page));
  } catch {
    // Storage unavailable: the next run restarts from page 1.
  }
}

export interface CatalogProgress {
  /** Pages of THIS run (n/total) — the catalog itself has no known page count
      small enough to show (the Vault lists millions of decks). */
  done: number;
  total: number;
  /** Unique card ids seen so far, including the rows already on disk. */
  cards: number;
}

export interface CatalogSummary {
  pages: number;
  /** Rows written by this run (cards skipped by the text hash are not counted). */
  added: number;
  /** Cards on disk after the run (countCatalogCards). */
  cards: number;
  cancelled: boolean;
}

/** Incremental catalog sync: walks deck pages from the stored cursor, writes
    only cards that are new or whose textHash changed (a text edit re-processes
    the card), reports n/total progress and stops on cancel keeping everything
    already stored. Storage errors stay swallowed in cache.ts. */
export async function syncCatalog(
  options: { pages?: number; signal?: AbortSignal; onProgress?: (progress: CatalogProgress) => void } = {},
): Promise<CatalogSummary> {
  const total = Math.max(1, options.pages ?? CATALOG_PAGES_PER_SYNC);
  const known = await listCatalogCardHashes();
  let page = readCatalogCursor();
  let added = 0;
  let pages = 0;
  let cancelled = false;

  try {
    for (let run = 1; run <= total; run += 1) {
      if (options.signal?.aborted) {
        cancelled = true;
        break;
      }
      const result = await fetchCardPage({ page, signal: options.signal });
      if (!result.cards.length) break;
      const fresh = result.cards.filter((card) => known.get(card.id) !== textHash(card.text ?? ""));
      added += await putCatalogCards(fresh);
      for (const card of fresh) known.set(card.id, textHash(card.text ?? ""));
      pages += 1;
      options.onProgress?.({ done: pages, total, cards: known.size });
      const lastPage = Math.max(1, Math.ceil(result.count / result.pageSize));
      page = page >= lastPage ? 1 : page + 1;
    }
  } catch (error) {
    // Cancel rejects like a timeout (describeFailure); only a real failure throws.
    if (!options.signal?.aborted) throw error;
    cancelled = true;
  } finally {
    saveCatalogCursor(page);
  }

  return { pages, added, cards: await countCatalogCards(), cancelled };
}
