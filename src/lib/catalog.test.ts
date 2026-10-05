// SPDX-License-Identifier: AGPL-3.0-only
// DB v4 specs (docs/DYNAMIC_CATALOG_PLAN.md §2/§3/§5): the `cards`/`abilities`
// stores round-trip, the catalog sync is incremental by textHash (fetch mocked
// with a Master Vault fixture) and rulesOf reads a trusted stored DSL before the
// text parser. Node has no IndexedDB, so the store is exercised through a small
// in-memory stand-in of the IDB surface cache.ts uses.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAbilityOverride, mergeAbilityOverrides, rulesOf, setAbilityOverrides, type Ability, type AbilityOverride } from "./abilities";
import { countCatalogCards, deleteAbilityOverride, listCatalogCardHashes, loadAbilityOverrides, putAbilityOverride, putCatalogCards } from "./cache";
import { PARSER_VERSION, parseCardText, textHash } from "./cardText";
import type { CardFace } from "./game";
import { syncCatalog } from "./keyforgeApi";
import { coverageCounts } from "../components/CoverageBadge";

// ---------- In-memory IndexedDB stand-in ----------

type Row = Record<string, unknown>;

function fakeIndexedDB(options: { oldVersion?: number; initialStores?: string[] } = {}) {
  const stores = new Map<string, { keyPath: string; rows: Map<unknown, Row> }>();
  // Write injection: a readwrite transaction aborts, so the cache-layer
  // "storage failure returns 0 / stays swallowed" paths are exercised.
  const state = { failWrites: false };
  for (const name of options.initialStores ?? []) stores.set(name, { keyPath: "id", rows: new Map() });
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
  const transaction = (names: string | string[], mode?: string) => {
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
    if (state.failWrites && mode === "readwrite") {
      // Snapshot before the puts: an aborted transaction must not commit.
      const snapshots = list.map((name) => ({ name, rows: new Map(stores.get(name)!.rows) }));
      queueMicrotask(() => {
        for (const snapshot of snapshots) stores.get(snapshot.name)!.rows = snapshot.rows;
        tx.error = new Error("write failed (injected)");
        tx.onabort?.();
      });
    } else {
      queueMicrotask(() => tx.oncomplete?.());
    }
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
      } = {
        result: database,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        transaction: null,
        oldVersion: opened ? 4 : options.oldVersion ?? 0,
      };
      opened = true;
      queueMicrotask(() => {
        req.transaction = transaction([...stores.keys()]);
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
  return {
    indexedDB,
    stores,
    /** Raw row injection (malformed store rows, v3 leftovers). */
    seed: (name: string, row: unknown) => {
      const def = stores.get(name);
      if (!def) throw new Error(`no store ${name}`);
      const record = row as Row;
      def.rows.set(record[def.keyPath], record);
    },
    set failWrites(value: boolean) {
      state.failWrites = value;
    },
    clear: () => stores.forEach((def) => def.rows.clear()),
  };
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

/** localStorage cursor key owned by keyforgeApi (not exported on purpose). */
const CURSOR_KEY = "aember-arena-catalog-cursor";

beforeEach(() => {
  fake.clear();
  localStorage.removeItem(CURSOR_KEY);
  setAbilityOverrides(new Map());
});

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

/** Page-aware Vault mock: answers the `page` query param from `pages`
    (1-based; missing index = empty page). `count` is omitted unless given, so
    the "unknown list size" case is exercised too. */
const mockFetchPages = (pages: Row[][], options: { count?: number } = {}) => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const page = Number(new URL(String(input)).searchParams.get("page"));
    const payload: Row = { data: [{ id: `deck-${page}` }], _linked: { cards: pages[page - 1] ?? [] } };
    if (options.count !== undefined) payload.count = options.count;
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const fetchedPage = (fetchMock: ReturnType<typeof vi.fn>, call = 0): number =>
  Number(new URL(String(fetchMock.mock.calls[call][0])).searchParams.get("page"));

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
  // A manual row covers the whole text (abilities + effects + keywords), which
  // is what makes rulesOf claim "full"; a dsl-only row must NOT claim it.
  effects: [],
  keywords: {},
  textHash: textHash(card.text),
  source: "manual",
  reviewed: true,
  generatedAt: 1,
  ...patch,
});

describe("DB v4 stores", () => {
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

  it("deleteAbilityOverride removes a rejected draft from the store", async () => {
    const card = face("reject-1", "Play: Look at the top card of your deck and name it.");
    await putAbilityOverride(overrideFor(card, { source: "llm", reviewed: false }));
    expect((await loadAbilityOverrides()).has(card.id)).toBe(true);
    await deleteAbilityOverride(card.id);
    expect((await loadAbilityOverrides()).has(card.id)).toBe(false);
    // Store indisponível: a remoção segue engolida, como as outras escritas.
    const realIndexedDB = globalThis.indexedDB;
    vi.stubGlobal("indexedDB", undefined);
    await expect(deleteAbilityOverride(card.id)).resolves.toBeUndefined();
    vi.stubGlobal("indexedDB", realIndexedDB);
  });

  it("reads an unavailable store as empty (storage failures stay swallowed)", async () => {
    const realIndexedDB = globalThis.indexedDB;
    vi.stubGlobal("indexedDB", undefined);
    expect(await countCatalogCards()).toBe(0);
    expect((await listCatalogCardHashes()).size).toBe(0);
    expect((await loadAbilityOverrides()).size).toBe(0);
    vi.stubGlobal("indexedDB", realIndexedDB);
  });

  it("discards malformed rows at load with a warning, never crashing the engine", async () => {
    await loadAbilityOverrides(); // abre o banco fake (stores criados)
    const card = face("bad-ok", "Play: Draw a card.");
    const good = overrideFor(card);
    fake.seed("abilities", good);
    fake.seed("abilities", { ...good, cardId: "bad-source", source: "future" });
    fake.seed("abilities", { ...good, cardId: "bad-dsl-type", dsl: "not-an-array" });
    fake.seed("abilities", { ...good, cardId: "bad-act", dsl: [{ on: ["play"], acts: [{ k: "explode" }] }] });
    fake.seed("abilities", { ...good, cardId: "bad-trigger", dsl: [{ on: ["teleport"], acts: good.dsl[0].acts }] });
    fake.seed("abilities", { ...good, cardId: "bad-hash", textHash: 42 });
    fake.seed("abilities", "not-a-row");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const loaded = await loadAbilityOverrides();

    expect([...loaded.keys()]).toEqual([card.id]); // só a linha válida passou
    expect(warn).toHaveBeenCalledTimes(6);
    warn.mockRestore();
    setAbilityOverrides(loaded);
    expect(rulesOf(card).abilities).toEqual([ability]); // motor segue de pé
  });

  it("putAbilityOverride applies to the live map right away", async () => {
    const card = face("live-1", "Play: Look at the top card of your deck and name it.");
    expect(rulesOf(card).abilities).toEqual([]);
    await putAbilityOverride(overrideFor(card));
    expect(rulesOf(card).abilities).toEqual([ability]); // sem esperar o proximo boot
    expect((await loadAbilityOverrides()).get(card.id)).toMatchObject({ cardId: card.id, source: "manual" });
  });
});

describe("catalog sync (incremental)", () => {
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

  it("persists the cursor and resumes from the stored page", async () => {
    const firstMock = mockFetchPages([[vaultCard("c1", "Alpha", "Play: Draw a card.")]], { count: 30 });
    expect(await syncCatalog({ pages: 1 })).toMatchObject({ pages: 1, added: 1 });
    expect(fetchedPage(firstMock)).toBe(1);
    expect(localStorage.getItem(CURSOR_KEY)).toBe("2");

    const secondMock = mockFetchPages([[], [vaultCard("c2", "Beta", "Reap: Gain 1 amber.")]], { count: 30 });
    expect(await syncCatalog({ pages: 1 })).toMatchObject({ pages: 1, added: 1, cards: 2 });
    expect(fetchedPage(secondMock)).toBe(2); // retomou de onde parou
    expect(localStorage.getItem(CURSOR_KEY)).toBe("3");
  });

  it("walks multiple pages in one run and reports n/total", async () => {
    mockFetchPages(
      [
        [vaultCard("c1", "Alpha", "Play: Draw a card.")],
        [vaultCard("c2", "Beta", "Reap: Gain 1 amber.")],
        [vaultCard("c3", "Gamma", "Play: Draw 2 cards.")],
      ],
      { count: 30 },
    );
    const progress: { done: number; total: number; cards: number }[] = [];
    const summary = await syncCatalog({ pages: 3, onProgress: (value) => progress.push({ ...value }) });
    expect(summary).toMatchObject({ pages: 3, added: 3, cards: 3 });
    expect(progress).toEqual([
      { done: 1, total: 3, cards: 1 },
      { done: 2, total: 3, cards: 2 },
      { done: 3, total: 3, cards: 3 },
    ]);
    expect(localStorage.getItem(CURSOR_KEY)).toBe("1"); // 3 de 3: wrap para o topo
  });

  it("wraps the cursor to page 1 after the last page", async () => {
    mockFetchPages([[vaultCard("c1", "Alpha", "Play: Draw a card.")]], { count: 1 });
    expect(await syncCatalog({ pages: 1 })).toMatchObject({ pages: 1, added: 1 });
    expect(localStorage.getItem(CURSOR_KEY)).toBe("1");
  });

  it("resets the cursor to 1 when a page comes back empty (end of list)", async () => {
    // Uma carta em disco dá validade ao cursor persistido; sem isso o guard de
    // divergência (known vazio) já recomeçaria da página 1.
    await putCatalogCards([face("seed-1", "Play: Draw a card.")]);
    localStorage.setItem(CURSOR_KEY, "7");
    mockFetchPages([[], []]);
    const summary = await syncCatalog({ pages: 3 });
    expect(summary).toMatchObject({ pages: 0, added: 0, cancelled: false });
    expect(localStorage.getItem(CURSOR_KEY)).toBe("1");
  });

  it("does not wrap when count is absent (unknown list size)", async () => {
    mockFetchPages([[vaultCard("c1", "Alpha", "Play: Draw a card.")]]); // sem count
    expect(await syncCatalog({ pages: 1 })).toMatchObject({ pages: 1, added: 1 });
    expect(localStorage.getItem(CURSOR_KEY)).toBe("2");
  });

  it("does not advance the cursor when the write fails (page is retried)", async () => {
    mockFetchPages([[vaultCard("c1", "Alpha", "Play: Draw a card.")]], { count: 30 });
    fake.failWrites = true;
    const failed = await syncCatalog({ pages: 2 });
    expect(failed).toMatchObject({ pages: 0, added: 0, cards: 0 });
    expect(localStorage.getItem(CURSOR_KEY)).toBe("1"); // não avançou
    fake.failWrites = false;

    // known não foi marcado: a mesma página é reprocessada no próximo sync.
    const retryMock = mockFetchPages([[vaultCard("c1", "Alpha", "Play: Draw a card.")]], { count: 30 });
    expect(await syncCatalog({ pages: 1 })).toMatchObject({ pages: 1, added: 1, cards: 1 });
    expect(fetchedPage(retryMock)).toBe(1);
  });

  it("aborts during the fetch keeping the cursor on the pending page", async () => {
    const controller = new AbortController();
    let pendingPage = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const page = Number(new URL(String(input)).searchParams.get("page"));
        if (page === 1) return Promise.resolve(new Response(JSON.stringify(vaultPage([vaultCard("c1", "Alpha", "Play: Draw a card.")])), { status: 200 }));
        pendingPage = page;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      }),
    );

    const run = syncCatalog({ pages: 3, signal: controller.signal });
    await vi.waitFor(() => expect(pendingPage).toBe(2));
    controller.abort();
    const summary = await run;
    expect(summary).toMatchObject({ pages: 1, added: 1, cards: 1, cancelled: true });
    // A página 2 não terminou: o cursor fica nela para o próximo sync refazer.
    expect(localStorage.getItem(CURSOR_KEY)).toBe("2");
  });
});

describe("rulesOf reads the ability store before the parser", () => {
  it("uses a manual DSL and reports full coverage", () => {
    const card = face("manual-1", "Play: Look at the top card of your deck and name it.");
    expect(rulesOf(card).coverage).not.toBe("full");
    setAbilityOverrides(new Map([[card.id, overrideFor(card)]]));
    expect(rulesOf(card).abilities).toEqual([ability]);
    expect(rulesOf(card).coverage).toBe("full");
  });

  it("ignores an unreviewed llm draft and accepts it once reviewed", () => {
    const card = face("llm-1", "Play: Look at the top card of your deck and name it.");
    setAbilityOverrides(new Map([[card.id, overrideFor(card, { source: "llm", reviewed: false })]]));
    expect(rulesOf(card).abilities).toEqual([]);
    expect(rulesOf(card).coverage).not.toBe("full");

    // Approving later changes the answer (the memo is dropped, not stale).
    setAbilityOverrides(new Map([[card.id, overrideFor(card, { source: "llm", reviewed: true })]]));
    expect(rulesOf(card).abilities).toEqual([ability]);
    expect(rulesOf(card).coverage).toBe("full");
  });

  it("falls back to the parser when the stored text hash does not match", () => {
    const card = face("stale-1", "Play: Look at the top card of your deck and name it.");
    setAbilityOverrides(new Map([[card.id, overrideFor(card, { textHash: textHash("some other text") })]]));
    expect(rulesOf(card).abilities).toEqual([]);
    expect(rulesOf(card).coverage).not.toBe("full");
  });

  it("keeps the parser tally for a parser-sourced entry", () => {
    const card = face("parser-1", "Reap: Gain 1 amber.");
    expect(rulesOf(card).coverage).toBe("full");
    setAbilityOverrides(new Map([[card.id, overrideFor(card, { source: "parser", parserVersion: PARSER_VERSION })]]));
    expect(rulesOf(card).coverage).toBe("full");
    expect(rulesOf(card).abilities).toEqual([ability]);
  });

  it("counts an overridden card as full in coverageCounts", () => {
    const covered = face("count-1", "Play: Look at the top card of your deck and name it.");
    const vanilla = face("count-2", "Play: Shuffle things around in a strange way.");
    setAbilityOverrides(new Map([[covered.id, overrideFor(covered)]]));
    expect(coverageCounts([covered, vanilla])).toEqual({ full: 1, partial: 0, vanilla: 1 });
  });

  it("never lets a stored parser or llm row precede a hand-written script", () => {
    const parserCard = { ...face("script-parser", "Play: Draw a card."), title: "Ancient Bear" };
    const parsed = parseCardText(parserCard);
    setAbilityOverrides(
      new Map([[parserCard.id, overrideFor(parserCard, { source: "parser", parserVersion: PARSER_VERSION, dsl: parsed.abilities, effects: parsed.effects, keywords: parsed.keywords })]]),
    );
    // scripts["ancient bear"] = null (texto de lembrete): nenhuma habilidade, e
    // o parser congelado nao pode regredir a carta curada.
    expect(rulesOf(parserCard).abilities).toEqual([]);
    expect(rulesOf(parserCard).coverage).toBe("full");

    const llmCard = { ...face("script-llm", "Play: Draw a card."), title: "Ancient Bear" };
    setAbilityOverrides(new Map([[llmCard.id, overrideFor(llmCard, { source: "llm" })]]));
    expect(rulesOf(llmCard).abilities).toEqual([]);
  });

  it("lets a manual row precede the script", () => {
    const card = { ...face("script-manual", "Play: Draw a card."), title: "Ancient Bear" };
    const dsl: Ability[] = [{ on: ["reap"], acts: [{ k: "gainAmber", n: 1 }] }];
    setAbilityOverrides(new Map([[card.id, overrideFor(card, { dsl })]]));
    expect(rulesOf(card).abilities).toEqual(dsl);
  });

  it("ignores a row whose source is unknown or absent", () => {
    const card = face("unknown-source", "Play: Draw a card.");
    const parsed = parseCardText(card);
    setAbilityOverrides(new Map([[card.id, { ...overrideFor(card), source: "future" as AbilityOverride["source"] }]]));
    expect(rulesOf(card).abilities).toEqual(parsed.abilities);

    const missing = { ...overrideFor(card) } as Record<string, unknown>;
    delete missing.source;
    setAbilityOverrides(new Map([[card.id, missing as unknown as AbilityOverride]]));
    expect(rulesOf(card).abilities).toEqual(parsed.abilities);
  });

  it("uses a parser-sourced row made of the real parser output", () => {
    const card = face("parser-real", "Reap: Gain 1 amber.");
    const parsed = parseCardText(card);
    expect(parsed.abilities).toEqual([{ on: ["reap"], acts: [{ k: "gainAmber", n: 1 }] }]);
    setAbilityOverrides(
      new Map([[card.id, overrideFor(card, { source: "parser", parserVersion: PARSER_VERSION, dsl: parsed.abilities, effects: parsed.effects, keywords: parsed.keywords })]]),
    );
    expect(rulesOf(card).abilities).toEqual(parsed.abilities);
    expect(rulesOf(card).coverage).toBe(parsed.coverage);
  });

  it("a dsl-only row keeps parser effects and never claims full coverage", () => {
    const card = face("cover-parts", "This creature gets +2 power. Play: Look at the top card of your deck and name it.");
    const parsed = parseCardText(card);
    expect(parsed.coverage).toBe("partial");

    // Sem effects/keywords o override cobre só as abilities: a parte constante
    // continua vindo do parser e a cobertura não pode dizer "full".
    setAbilityOverrides(new Map([[card.id, overrideFor(card, { dsl: [], effects: undefined, keywords: undefined })]]));
    expect(rulesOf(card).effects).toEqual(parsed.effects);
    expect(rulesOf(card).coverage).toBe("partial");

    setAbilityOverrides(new Map([[card.id, overrideFor(card, { dsl: [], effects: [], keywords: {} })]]));
    expect(rulesOf(card).effects).toEqual([]);
    expect(rulesOf(card).coverage).toBe("full");
  });

  it("applyAbilityOverride invalidates the memo of the exact same face", () => {
    const card = face("memo-same", "Play: Look at the top card of your deck and name it.");
    expect(rulesOf(card).abilities).toEqual([]); // consulta e memoiza ESTA face
    applyAbilityOverride(overrideFor(card));
    expect(rulesOf(card).abilities).toEqual([ability]);
    expect(rulesOf(card).coverage).toBe("full");
  });

  it("boot merge never overwrites an override applied during the read", async () => {
    const card = face("race-load", "Play: Draw a card.");
    await putAbilityOverride(overrideFor(card, { dsl: [{ on: ["reap"], acts: [{ k: "gainAmber", n: 1 }] }] }));
    const loaded = await loadAbilityOverrides(); // snapshot do boot
    const session = overrideFor(card, { dsl: [{ on: ["play"], acts: [{ k: "draw", n: 2 }] }] });
    applyAbilityOverride(session); // gravado entre o getAll() e o callback
    mergeAbilityOverrides(loaded);
    expect(rulesOf(card).abilities).toEqual([{ on: ["play"], acts: [{ k: "draw", n: 2 }] }]);

    // O merge ainda adiciona chaves do disco ausentes na sessão.
    const other = face("race-other", "Reap: Gain 1 amber.");
    await putAbilityOverride(overrideFor(other));
    const loadedOther = await loadAbilityOverrides();
    setAbilityOverrides(new Map());
    mergeAbilityOverrides(loadedOther);
    expect(rulesOf(other).abilities).toEqual([ability]);
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

describe("DB migration v3 -> v4", () => {
  it("creates the abilities store on upgrade and keeps existing card rows", async () => {
    // Módulo novo: cache.ts guarda a conexão num singleton, então a migração só
    // acontece numa instância recém-importada com um banco v3 preexistente.
    vi.resetModules();
    const legacy = fakeIndexedDB({ oldVersion: 3, initialStores: ["decks", "cards", "stats"] });
    legacy.seed("cards", {
      id: "v3-card",
      title: "Old Card",
      house: "Logos",
      type: "Action",
      image: "",
      text: "Play: Draw a card.",
      amber: 0,
      power: 0,
      armor: 0,
      textHash: textHash("Play: Draw a card."),
      syncedAt: 1,
    });
    vi.stubGlobal("indexedDB", legacy.indexedDB);
    try {
      const freshCache = await import("./cache");
      expect(await freshCache.countCatalogCards()).toBe(1); // linha v3 preservada
      expect(legacy.stores.get("abilities")?.keyPath).toBe("cardId");
      expect((await freshCache.loadAbilityOverrides()).size).toBe(0); // store novo e vazio
    } finally {
      vi.stubGlobal("indexedDB", fake.indexedDB);
    }
  });
});
