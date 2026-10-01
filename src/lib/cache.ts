import { textHash } from "./cardText";
import type { AbilityOverride } from "./abilities";
import { normalizeSavedState, type CardFace, type DeckInfo, type GameState } from "./game";

const DATABASE_NAME = "keyforge-arena-cache";
const DATABASE_VERSION = 4;
const DECK_STORE = "decks";
const CARD_STORE = "cards";
const STATS_STORE = "stats";
const ABILITY_STORE = "abilities";

/** A deck in the player's library (FEAT-07): the favorite flag rides along
    with the deck row, so it survives reloads and the localStorage fallback. */
export type LibraryDeck = DeckInfo & { favorite?: boolean };

interface CachedDeck extends LibraryDeck {
  cachedAt: number;
  /** Vault page precache rows are not library decks; adoption sets this (BUG-13). */
  saved?: boolean;
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Storage transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Storage transaction was interrupted."));
  });
}

// One connection for the whole page: every operation awaits the same cached
// promise instead of firing a fresh indexedDB.open() per call (a browse page
// used to trigger nine concurrent opens). A failed open is not cached, so the
// next operation may retry; storage failures stay swallowed and the match
// remains playable through the localStorage fallbacks below.
let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = requestDatabase().catch((error) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

function requestDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable in this browser."));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DECK_STORE)) database.createObjectStore(DECK_STORE, { keyPath: "id" });
      if (!database.objectStoreNames.contains(CARD_STORE)) database.createObjectStore(CARD_STORE, { keyPath: "id" });
      // v3 (FEAT-06): local win/loss rows, one per deck.
      if (!database.objectStoreNames.contains(STATS_STORE)) database.createObjectStore(STATS_STORE, { keyPath: "deckId" });
      // v4 (catálogo dinâmico, docs/DYNAMIC_CATALOG_PLAN.md §2): the ability DSL
      // per card. Nothing is migrated — both stores grow from the first sync.
      if (!database.objectStoreNames.contains(ABILITY_STORE)) database.createObjectStore(ABILITY_STORE, { keyPath: "cardId" });
      // v1→v2: rows written before the saved flag are vault precache debris
      // from BUG-13 — they stay importable offline but leave the library.
      if ((request as IDBOpenDBRequest & { oldVersion?: number }).oldVersion! < 2 && database.objectStoreNames.contains(DECK_STORE)) {
        const store = request.transaction!.objectStore(DECK_STORE);
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const row = cursor.value as CachedDeck;
          if (row.saved === undefined) {
            row.saved = false;
            cursor.update(row);
          }
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      // The shared connection stays open for the page's lifetime: per-operation
      // close() would race with concurrent transactions on the same connection.
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      // Forget a connection the browser closed behind our back (e.g. storage
      // eviction) so the next operation reopens instead of failing forever.
      database.onclose = () => {
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open local card storage."));
  });
}

function localDeckKey(id: string): string {
  return `keyforge-deck-${id}`;
}

/** Row shape of the `cards` store (DB v4, plano §2): the whole face plus the
    text hash the ability pipeline keys on and the last sync stamp. */
export interface CatalogCard extends CardFace {
  textHash: string;
  syncedAt: number;
}

/** One `cards` row: the face and its identity. Shared by the deck precache and
    the catalog sync, so every row in the store carries the hash. */
function catalogRow(card: CardFace, syncedAt = Date.now()): CatalogCard {
  return { ...card, textHash: textHash(card.text ?? ""), syncedAt };
}

export async function cacheDeck(deck: DeckInfo, options: { saved?: boolean } = {}): Promise<void> {
  const cached: CachedDeck = { ...deck, cachedAt: Date.now(), saved: options.saved === true };
  try {
    const database = await openDatabase();
    const transaction = database.transaction([DECK_STORE, CARD_STORE], "readwrite");
    transaction.objectStore(DECK_STORE).put(cached);
    const cards = transaction.objectStore(CARD_STORE);
    const syncedAt = Date.now();
    for (const card of deck.cards) cards.put(catalogRow(card, syncedAt));
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not cache deck data."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Deck cache was interrupted."));
    });
  } catch {
    try {
      localStorage.setItem(localDeckKey(deck.id), JSON.stringify(cached));
    } catch {
      // The match remains playable even when browser storage is unavailable.
    }
  }
}

/** Decks stashed in the localStorage fallback (used when IndexedDB is off). */
function localFallbackDecks(): CachedDeck[] {
  const decks: CachedDeck[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("keyforge-deck-")) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        decks.push(JSON.parse(raw) as CachedDeck);
      } catch {
        // A malformed row must not break the whole library.
      }
    }
  } catch {
    // Storage unavailable: nothing to merge.
  }
  return decks;
}

export async function listCachedDecks(): Promise<LibraryDeck[]> {
  let rows: CachedDeck[] = [];
  try {
    const database = await openDatabase();
    const transaction = database.transaction(DECK_STORE, "readonly");
    const request = transaction.objectStore(DECK_STORE).getAll();
    rows = await new Promise<CachedDeck[]>((resolve, reject) => {
      request.onsuccess = () => resolve((request.result ?? []) as CachedDeck[]);
      request.onerror = () => reject(request.error ?? new Error("Could not read cached decks."));
    });
  } catch {
    // IndexedDB unavailable: the localStorage fallback below still has decks
    // the player imported (BUG-16 — they used to vanish from the library).
  }
  const byId = new Map<string, LibraryDeck>();
  for (const { cachedAt: _cachedAt, ...deck } of rows) {
    if (deck.saved === true) byId.set(deck.id, deck);
  }
  for (const deck of localFallbackDecks()) if (!byId.has(deck.id) && deck.saved === true) byId.set(deck.id, deck);
  return [...byId.values()];
}

/** FEAT-07: persists the favorite flag inside the deck row itself. The
    localStorage fallback copy is updated as well — it may be the only copy
    (BUG-16). Failures are swallowed: the in-memory flag still applies. */
export async function setDeckFavorite(id: string, favorite: boolean): Promise<void> {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(DECK_STORE, "readwrite");
    const store = transaction.objectStore(DECK_STORE);
    const request = store.get(id);
    request.onsuccess = () => {
      const row = request.result as CachedDeck | undefined;
      if (row) store.put({ ...row, favorite });
    };
    await transactionDone(transaction);
  } catch {
    // The localStorage copy below still carries the flag when it exists.
  }
  try {
    const raw = localStorage.getItem(localDeckKey(id));
    if (raw) localStorage.setItem(localDeckKey(id), JSON.stringify({ ...(JSON.parse(raw) as LibraryDeck), favorite }));
  } catch {
    // Storage unavailable: the session library keeps the flag.
  }
}

/** FEAT-07: removes a library deck from IndexedDB and from the localStorage
    fallback. Card rows stay cached — decks and the vault precache share them. */
export async function deleteDeck(id: string): Promise<void> {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(DECK_STORE, "readwrite");
    transaction.objectStore(DECK_STORE).delete(id);
    await transactionDone(transaction);
  } catch {
    // IndexedDB unavailable: the localStorage copy below is the only one.
  }
  try {
    localStorage.removeItem(localDeckKey(id));
  } catch {
    // Storage unavailable: the deck leaves the session library anyway.
  }
}

export async function getCachedDeck(id: string): Promise<DeckInfo | null> {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(DECK_STORE, "readonly");
    const request = transaction.objectStore(DECK_STORE).get(id);
    const result = await new Promise<CachedDeck | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as CachedDeck | undefined);
      request.onerror = () => reject(request.error ?? new Error("Could not read cached deck."));
    });
    if (result) return result;
  } catch {
    // Fall through to the small localStorage fallback below.
  }

  try {
    const fallback = localStorage.getItem(localDeckKey(id));
    return fallback ? (JSON.parse(fallback) as DeckInfo) : null;
  } catch {
    return null;
  }
}

const MATCH_KEY = "aember-arena-match";

export interface SavedMatch {
  game: unknown;
  deckId: string;
  savedAt: number;
}

/** Persists the in-progress match after every move. localStorage is enough —
    the GameState is one JSON blob — and every failure is swallowed on purpose:
    losing the save must never break the live match (FEAT-01). */
export async function saveMatch(payload: { game: unknown; deckId: string }): Promise<void> {
  try {
    const saved: SavedMatch = { ...payload, savedAt: Date.now() };
    localStorage.setItem(MATCH_KEY, JSON.stringify(saved));
  } catch {
    // Quota/private mode: the match keeps running from memory.
  }
}

export function loadSavedMatch(): SavedMatch | null {
  try {
    const raw = localStorage.getItem(MATCH_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedMatch;
    if (!saved?.game || !saved.deckId) return null;
    // BUG2-08: normaliza saves antigos (sem seed/rngCalls/contadores) na carga,
    // não na retomada — o banner e o save já mostram números válidos.
    return { ...saved, game: normalizeSavedState(saved.game as GameState) };
  } catch {
    return null;
  }
}

export function clearSavedMatch(): void {
  try {
    localStorage.removeItem(MATCH_KEY);
  } catch {
    // Nothing to recover: the absence of a save is the acceptable state.
  }
}

export interface DeckStats {
  deckId: string;
  wins: number;
  losses: number;
  /** W/L per difficulty, kept for a future breakdown of the local record. */
  byDifficulty: Record<string, { w: number; l: number }>;
  /** Setup of the last recorded result (FEAT-06). */
  lastOpponentMode: string;
  updatedAt: number;
}

const localStatsKey = (id: string) => `keyforge-stats-${id}`;

export async function getDeckStats(deckId: string): Promise<DeckStats | null> {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(STATS_STORE, "readonly");
    const request = transaction.objectStore(STATS_STORE).get(deckId);
    const row = await new Promise<DeckStats | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as DeckStats | undefined);
      request.onerror = () => reject(request.error ?? new Error("Could not read deck stats."));
    });
    if (row) return row;
  } catch {
    // Fall through to the localStorage fallback below.
  }
  try {
    const raw = localStorage.getItem(localStatsKey(deckId));
    return raw ? (JSON.parse(raw) as DeckStats) : null;
  } catch {
    return null;
  }
}

/** FEAT-06: one local W/L row per deck, recorded when a match ends. The row is
    cosmetic, so every storage failure is swallowed on purpose. */
export async function recordMatchResult(deckId: string, win: boolean, opponentMode: string, difficulty: string): Promise<void> {
  const previous = await getDeckStats(deckId);
  const byDifficulty = { ...(previous?.byDifficulty ?? {}) };
  const row = byDifficulty[difficulty] ?? { w: 0, l: 0 };
  byDifficulty[difficulty] = win ? { w: row.w + 1, l: row.l } : { w: row.w, l: row.l + 1 };
  const stats: DeckStats = {
    deckId,
    wins: (previous?.wins ?? 0) + (win ? 1 : 0),
    losses: (previous?.losses ?? 0) + (win ? 0 : 1),
    byDifficulty,
    lastOpponentMode: opponentMode,
    updatedAt: Date.now(),
  };
  try {
    const database = await openDatabase();
    const transaction = database.transaction(STATS_STORE, "readwrite");
    transaction.objectStore(STATS_STORE).put(stats);
    await transactionDone(transaction);
  } catch {
    try {
      localStorage.setItem(localStatsKey(deckId), JSON.stringify(stats));
    } catch {
      // Storage unavailable: the record stays session-only.
    }
  }
}

// ---------- Catalog + ability store (DB v4, docs/DYNAMIC_CATALOG_PLAN.md §2/§3) ----------
// Every failure below is swallowed on purpose (invariante): sem catálogo o jogo
// funciona como hoje — API sob demanda + parser de texto.

/** Card id -> textHash of every row already on disk. The sync reads this once
    and only writes cards that are new or whose text changed (plano §3). */
export async function listCatalogCardHashes(): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  try {
    const database = await openDatabase();
    const transaction = database.transaction(CARD_STORE, "readonly");
    const request = transaction.objectStore(CARD_STORE).getAll();
    const rows = await new Promise<CatalogCard[]>((resolve, reject) => {
      request.onsuccess = () => resolve((request.result ?? []) as CatalogCard[]);
      request.onerror = () => reject(request.error ?? new Error("Could not read the card catalog."));
    });
    for (const row of rows) if (row?.id) hashes.set(row.id, row.textHash ?? "");
  } catch {
    // Unavailable storage reads as an empty catalog: the sync just writes everything.
  }
  return hashes;
}

/** Stores catalog rows (face + textHash + syncedAt) in one transaction and
    returns how many were written; 0 means storage is unavailable. */
export async function putCatalogCards(cards: CardFace[]): Promise<number> {
  if (!cards.length) return 0;
  try {
    const database = await openDatabase();
    const transaction = database.transaction(CARD_STORE, "readwrite");
    const store = transaction.objectStore(CARD_STORE);
    const syncedAt = Date.now();
    for (const card of cards) store.put(catalogRow(card, syncedAt));
    await transactionDone(transaction);
    return cards.length;
  } catch {
    return 0;
  }
}

/** Cards in the catalog store — the Home/Vault "catálogo: N cartas" chip (§5). */
export async function countCatalogCards(): Promise<number> {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(CARD_STORE, "readonly");
    const request = transaction.objectStore(CARD_STORE).count();
    return await new Promise<number>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result ?? 0);
      request.onerror = () => reject(request.error ?? new Error("Could not count the card catalog."));
    });
  } catch {
    return 0;
  }
}

/** Wave 2 writes reviewed DSL rows through this; the row keeps `source` so the
    engine knows who wrote it (abilities.rulesOf). */
export async function putAbilityOverride(record: AbilityOverride): Promise<void> {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(ABILITY_STORE, "readwrite");
    transaction.objectStore(ABILITY_STORE).put(record);
    await transactionDone(transaction);
  } catch {
    // Storage unavailable: the DSL stays session-only, like every cache row.
  }
}

/** Boot load of the `abilities` store (plano §3): rulesOf is synchronous, so
    App hands this map to abilities.setAbilityOverrides() instead of hitting
    IndexedDB per card. An unavailable store reads as "no overrides". */
export async function loadAbilityOverrides(): Promise<Map<string, AbilityOverride>> {
  const overrides = new Map<string, AbilityOverride>();
  try {
    const database = await openDatabase();
    const transaction = database.transaction(ABILITY_STORE, "readonly");
    const request = transaction.objectStore(ABILITY_STORE).getAll();
    const rows = await new Promise<AbilityOverride[]>((resolve, reject) => {
      request.onsuccess = () => resolve((request.result ?? []) as AbilityOverride[]);
      request.onerror = () => reject(request.error ?? new Error("Could not read the ability store."));
    });
    for (const row of rows) if (row?.cardId && Array.isArray(row.dsl)) overrides.set(row.cardId, row);
  } catch {
    // Storage unavailable: the parser answers every card.
  }
  return overrides;
}
