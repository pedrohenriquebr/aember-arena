import type { DeckInfo } from "./game";

const DATABASE_NAME = "keyforge-arena-cache";
const DATABASE_VERSION = 2;
const DECK_STORE = "decks";
const CARD_STORE = "cards";

interface CachedDeck extends DeckInfo {
  cachedAt: number;
  /** Vault page precache rows are not library decks; adoption sets this (BUG-13). */
  saved?: boolean;
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

export async function cacheDeck(deck: DeckInfo, options: { saved?: boolean } = {}): Promise<void> {
  const cached: CachedDeck = { ...deck, cachedAt: Date.now(), saved: options.saved === true };
  try {
    const database = await openDatabase();
    const transaction = database.transaction([DECK_STORE, CARD_STORE], "readwrite");
    transaction.objectStore(DECK_STORE).put(cached);
    const cards = transaction.objectStore(CARD_STORE);
    for (const card of deck.cards) cards.put(card);
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
function localFallbackDecks(): DeckInfo[] {
  const decks: DeckInfo[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("keyforge-deck-")) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        decks.push(JSON.parse(raw) as DeckInfo);
      } catch {
        // A malformed row must not break the whole library.
      }
    }
  } catch {
    // Storage unavailable: nothing to merge.
  }
  return decks;
}

export async function listCachedDecks(): Promise<DeckInfo[]> {
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
  const byId = new Map<string, DeckInfo>();
  for (const { cachedAt: _cachedAt, ...deck } of rows) {
    if ((deck as DeckInfo & { saved?: boolean }).saved === true) byId.set((deck as DeckInfo).id, deck as DeckInfo);
  }
  for (const deck of localFallbackDecks()) if (!byId.has(deck.id) && (deck as DeckInfo & { saved?: boolean }).saved === true) byId.set(deck.id, deck);
  return [...byId.values()];
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