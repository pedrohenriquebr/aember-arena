import type { DeckInfo } from "./game";

const DATABASE_NAME = "keyforge-arena-cache";
const DATABASE_VERSION = 1;
const DECK_STORE = "decks";
const CARD_STORE = "cards";

interface CachedDeck extends DeckInfo {
  cachedAt: number;
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

export async function cacheDeck(deck: DeckInfo): Promise<void> {
  const cached: CachedDeck = { ...deck, cachedAt: Date.now() };
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

export async function listCachedDecks(): Promise<DeckInfo[]> {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(DECK_STORE, "readonly");
    const request = transaction.objectStore(DECK_STORE).getAll();
    const rows = await new Promise<CachedDeck[]>((resolve, reject) => {
      request.onsuccess = () => resolve((request.result ?? []) as CachedDeck[]);
      request.onerror = () => reject(request.error ?? new Error("Could not read cached decks."));
    });
    return rows
      .sort((a, b) => (b.cachedAt ?? 0) - (a.cachedAt ?? 0))
      .map(({ cachedAt: _cachedAt, ...deck }) => deck as DeckInfo);
  } catch {
    return [];
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