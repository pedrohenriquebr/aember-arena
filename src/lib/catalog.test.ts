// SPDX-License-Identifier: AGPL-3.0-only
// DB v4 specs (docs/DYNAMIC_CATALOG_PLAN.md §2/§3/§5): the `cards`/`abilities`
// stores round-trip, the catalog sync is incremental by textHash (fetch mocked
// with a Master Vault fixture) and rulesOf reads a trusted stored DSL before the
// text parser. Node has no IndexedDB, so the store is exercised through a small
// in-memory stand-in of the IDB surface cache.ts uses.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rulesOf, setAbilityOverrides, type Ability, type AbilityOverride } from "./abilities";
import { countCatalogCards, listCatalogCardHashes, loadAbilityOverrides, putAbilityOverride, putCatalogCards } from "./cache";
import { textHash } from "./cardText";
import type { CardFace } from "./game";
import { syncCatalog } from "./keyforgeApi";
import { coverageCounts } from "../components/CoverageBadge";

// ---------- In-memory IndexedDB stand-in ----------

type Row = Record<string, unknown>;

function fakeIndexedDB() {
  const stores = new Map<string, { keyPath: string; rows: Map<unknown, Row> }>();
  const request = (value: unknown) => {
    const req: { result: unknown; error: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null } = {
      result: value,
      error: null,
      onsuccess: null,
      onerror: null,
    };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  };
  const transaction = (names: string | string[]) => {
    const list = Array.isArray(names) ? names : [names];
    const tx: { error: unknown; oncomplete: (() => void) | null; onerror: (() => void) | null; onabort: (() => void) | null; objectStore: (name: string) => Row } = {
      error: null,
      oncomplete: null,
      onerror: null,
      onabort: null,
      objectStore: (name: string) => {
        const def = stores.get(name);
        if (!def) throw new Error(`no store ${name}`);
        return {
          put: (value: Row) => {
            def.rows.set(value[def.keyPath], value);
            return request(undefined);
          },
          get: (key: unknown) => request(def.rows.get(key)),
          getAll: () => request([...def.rows.values()]),
          count: () => request(def.rows.size),
          delete: (key: unknown) => {
            def.rows.delete(key);
            return request(undefined);
          },
          // v1→v2 migration path: an empty store has no cursor row.
          openCursor: () => request(null),
        } as unknown as Row;
      },
    };
    for (const name of list) if (!stores.has(name)) stores.set(name, { keyPath: "id", rows: new Map() });
    queueMicrotask(() => tx.oncomplete?.());
    return tx;
  };
  let opened = false;
  const database = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string, options: { keyPath: string }) => {
      stores.set(name, { keyPath: options.keyPath, rows: new Map() });
    },
    transaction,
    close: () => undefined,
    onversionchange: null as (() => void) | null,
    onclose: null as (() => void) | null,
  };
  const indexedDB = {
    open: () => {
      const req: {
        result: unknown;
        error: unknown;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
        onupgradeneeded: (() => void) | null;
        transaction: unknown;
        oldVersion: number;
      } = { result: database, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, transaction: null, oldVersion: opened ? 4 : 0 };
      opened = true;
      queueMicrotask(() => {
        req.transaction = transaction([...stores.keys()]);
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
  return { indexedDB, clear: () => stores.forEach((def) => def.rows.clear()) };
}

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
};

const fake = fakeIndexedDB();
vi.stubGlobal("indexedDB", fake.indexedDB);
vi.stubGlobal("localStorage", memoryStorage());

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------- Master Vault fixture ----------

const vaultCard = (id: string, title: string, text: string): Row => ({
  id,
  card_title: title,
  house: "Logos",
  card_type: "Creature",
  front_image: "",
  card_text: text,
  traits: "",
  amber: 0,
  power: "3",
  armor: "0",
  rarity: "Common",
  is_maverick: false,
  card_number: "1",
  expansion: 341,
});

const vaultPage = (cards: Row[]) => ({ data: [{ id: "deck-1" }], _linked: { cards }, count: 30 });

const mockFetch = (cards: Row[]) => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(vaultPage(cards)), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const face = (id: string, text: string): CardFace => ({
  id,
  title: `${id} title`,
  house: "Logos",
  type: "Action",
  image: "",
  text,
  amber: 0,
  power: 0,
  armor: 0,
});

const ability: Ability = { on: ["play"], acts: [{ k: "draw", n: 1 }] };

const overrideFor = (card: CardFace, patch: Partial<AbilityOverride> = {}): AbilityOverride => ({
  cardId: card.id,
  dsl: [ability],
  textHash: textHash(card.text),
  source: "manual",
  reviewed: true,
  generatedAt: 1,
  ...patch,
});

describe("DB v4 stores", () => {
  beforeEach(() => {
    fake.clear();
    setAbilityOverrides(new Map());
  });

  it("round-trips catalog rows with the text hash", async () => {
    const a = face("card-a", "Play: Draw a card.");
    const b = face("card-b", "Reap: Gain 1 amber.");
    expect(await putCatalogCards([a, b])).toBe(2);
    expect(await countCatalogCards()).toBe(2);

    const hashes = await listCatalogCardHashes();
    expect(hashes.get("card-a")).toBe(textHash(a.text));
    expect(hashes.get("card-b")).toBe(textHash(b.text));

    // A re-sync of the same id overwrites the row (no duplicate).
    await putCatalogCards([{ ...a, text: "Play: Draw 2 cards." }]);
    expect(await countCatalogCards()).toBe(2);
    expect((await listCatalogCardHashes()).get("card-a")).toBe(textHash("Play: Draw 2 cards."));
  });

  it("round-trips ability rows, source and all", async () => {
    const stored = overrideFor(face("card-a", "Play: Draw a card."), { source: "llm", reviewed: false, model: "small-model" });
    await putAbilityOverride(stored);
    const loaded = await loadAbilityOverrides();
    expect(loaded.get("card-a")).toEqual(stored);
    expect(loaded.get("card-a")?.source).toBe("llm");
  });

  it("reads an unavailable store as empty (storage failures stay swallowed)", async () => {
    const realIndexedDB = globalThis.indexedDB;
    vi.stubGlobal("indexedDB", undefined);
    expect(await countCatalogCards()).toBe(0);
    expect((await listCatalogCardHashes()).size).toBe(0);
    expect((await loadAbilityOverrides()).size).toBe(0);
    vi.stubGlobal("indexedDB", realIndexedDB);
  });
});

describe("catalog sync (incremental)", () => {
  beforeEach(() => {
    fake.clear();
    setAbilityOverrides(new Map());
  });

  it("writes the page cards once and skips them on the next run (textHash)", async () => {
    const cards = [vaultCard("c1", "Alpha", "Play: Draw a card."), vaultCard("c2", "Beta", "Reap: Gain 1 amber.")];
    mockFetch(cards);

    const progress: { done: number; total: number; cards: number }[] = [];
    const first = await syncCatalog({ pages: 1, onProgress: (value) => progress.push({ ...value }) });
    expect(first).toMatchObject({ pages: 1, added: 2, cards: 2, cancelled: false });
    expect(progress).toEqual([{ done: 1, total: 1, cards: 2 }]);
    expect((await listCatalogCardHashes()).get("c1")).toBe(textHash("Play: Draw a card."));

    // Second run: same text on the server, nothing to write.
    const second = await syncCatalog({ pages: 1 });
    expect(second).toMatchObject({ pages: 1, added: 0, cards: 2 });
  });

  it("re-processes a card whose text changed", async () => {
    mockFetch([vaultCard("c1", "Alpha", "Play: Draw a card.")]);
    await syncCatalog({ pages: 1 });

    mockFetch([vaultCard("c1", "Alpha", "Play: Draw 2 cards.")]);
    const changed = await syncCatalog({ pages: 1 });
    expect(changed).toMatchObject({ added: 1, cards: 1 });
    expect((await listCatalogCardHashes()).get("c1")).toBe(textHash("Play: Draw 2 cards."));
  });

  it("stops on cancel keeping what was already stored", async () => {
    mockFetch([vaultCard("c1", "Alpha", "Play: Draw a card.")]);
    const controller = new AbortController();
    const run = syncCatalog({ pages: 3, signal: controller.signal, onProgress: () => controller.abort() });
    const summary = await run;
    expect(summary).toMatchObject({ pages: 1, added: 1, cards: 1, cancelled: true });
  });

  it("treats an empty page as the end of the list (no error)", async () => {
    mockFetch([]);
    const summary = await syncCatalog({ pages: 3 });
    expect(summary).toMatchObject({ pages: 0, added: 0, cards: 0, cancelled: false });
  });
});

describe("rulesOf reads the ability store before the parser", () => {
  beforeEach(() => setAbilityOverrides(new Map()));

  afterAll(() => setAbilityOverrides(new Map()));

  it("uses a manual DSL and reports full coverage", () => {
    const card = face("manual-1", "Play: Look at the top card of your deck.");
    expect(rulesOf(card).coverage).not.toBe("full");
    setAbilityOverrides(new Map([[card.id, overrideFor(card)]]));
    expect(rulesOf(card).abilities).toEqual([ability]);
    expect(rulesOf(card).coverage).toBe("full");
  });

  it("ignores an unreviewed llm draft and accepts it once reviewed", () => {
    const card = face("llm-1", "Play: Look at the top card of your deck.");
    setAbilityOverrides(new Map([[card.id, overrideFor(card, { source: "llm", reviewed: false })]]));
    expect(rulesOf(card).abilities).toEqual([]);
    expect(rulesOf(card).coverage).not.toBe("full");

    // Approving later changes the answer (the memo is dropped, not stale).
    setAbilityOverrides(new Map([[card.id, overrideFor(card, { source: "llm", reviewed: true })]]));
    expect(rulesOf(card).abilities).toEqual([ability]);
    expect(rulesOf(card).coverage).toBe("full");
  });

  it("falls back to the parser when the stored text hash does not match", () => {
    const card = face("stale-1", "Play: Look at the top card of your deck.");
    setAbilityOverrides(new Map([[card.id, overrideFor(card, { textHash: textHash("some other text") })]]));
    expect(rulesOf(card).abilities).toEqual([]);
    expect(rulesOf(card).coverage).not.toBe("full");
  });

  it("keeps the parser tally for a parser-sourced entry", () => {
    const card = face("parser-1", "Reap: Gain 1 amber.");
    expect(rulesOf(card).coverage).toBe("full");
    setAbilityOverrides(new Map([[card.id, overrideFor(card, { source: "parser" })]]));
    expect(rulesOf(card).coverage).toBe("full");
    expect(rulesOf(card).abilities).toEqual([ability]);
  });

  it("counts an overridden card as full in coverageCounts", () => {
    const covered = face("count-1", "Play: Look at the top card of your deck.");
    const vanilla = face("count-2", "Play: Shuffle things around in a strange way.");
    setAbilityOverrides(new Map([[covered.id, overrideFor(covered)]]));
    expect(coverageCounts([covered, vanilla])).toEqual({ full: 1, partial: 0, vanilla: 1 });
  });
});

describe("textHash", () => {
  it("is stable across whitespace, case and reminder-text variants", () => {
    expect(textHash("Play: Draw a card. (You may do this twice.)")).toBe(textHash("play:   draw a card."));
  });

  it("changes when the printed text changes", () => {
    expect(textHash("Play: Draw a card.")).not.toBe(textHash("Play: Draw 2 cards."));
  });
});
