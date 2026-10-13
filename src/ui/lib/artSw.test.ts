import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

// ART_OFFLINE (fase 1): o public/sw.js REAL roda num vm com caches/fetch/clients
// simulados. Testa o contrato que o app usa (warm-art, check-art, clear-art), o LRU
// e a regra "nunca cacheia por padrão" — sem reescrever a lógica do worker aqui.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SW_SOURCE = readFileSync(join(ROOT, "public", "sw.js"), "utf8");
const ART_CACHE = "aember-arena-art-v1";
const ART_HOST = "https://mastervault-storage-prod.s3.amazonaws.com";
const artUrl = (n: number) => `${ART_HOST}/media/card_front/en/${n}.png`;

type Listener = (event: Record<string, unknown>) => void;

// Cache simulado: guarda por URL; o índice é um Response (corpo lido uma vez).
function makeEnv(failing: Set<string> = new Set()) {
  const listeners: Record<string, Listener[]> = {};
  const storage = new Map<string, Map<string, unknown>>();
  const fetches: string[] = [];
  const broadcasts: Array<Record<string, unknown>> = [];

  const storeOf = (name: string) => {
    let store = storage.get(name);
    if (!store) {
      store = new Map();
      storage.set(name, store);
    }
    return store;
  };
  const cacheOf = (name: string) => {
    const store = storeOf(name);
    const keyOf = (req: unknown) => (typeof req === "string" ? req : (req as { url: string }).url);
    return {
      match: async (req: unknown) => {
        const value = store.get(keyOf(req));
        if (value === undefined) return undefined;
        return value instanceof Response ? value.clone() : value;
      },
      put: async (req: unknown, res: unknown) => {
        store.set(keyOf(req), res);
      },
      delete: async (req: unknown) => store.delete(keyOf(req)),
      keys: async () => [...store.keys()].map((url) => ({ url })),
    };
  };

  const caches = {
    open: async (name: string) => cacheOf(name),
    // Como o navegador: procura nos caches existentes e nunca cria um.
    match: async (req: unknown, options?: { cacheName?: string }) => {
      const url = typeof req === "string" ? req : (req as { url: string }).url;
      const value = storage.get(options?.cacheName ?? "")?.get(url);
      return value instanceof Response ? value.clone() : value;
    },
    keys: async () => [...storage.keys()],
    delete: async (name: string) => storage.delete(name),
  };

  const self = {
    BUILD_ID: "test-build",
    location: { href: "https://app.example/aember/sw.js", origin: "https://app.example" },
    addEventListener: (type: string, fn: Listener) => {
      (listeners[type] ??= []).push(fn);
    },
    skipWaiting: () => undefined,
    clients: {
      claim: async () => undefined,
      matchAll: async () => [{ postMessage: (message: Record<string, unknown>) => broadcasts.push(message) }],
    },
  };

  const fetch = async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as { url: string }).url;
    fetches.push(url);
    if (failing.has(url)) throw new TypeError("network down");
    // O S3 sem CORS: a resposta no-cors é opaca (status 0), como no navegador real.
    return { type: "opaque", ok: false, status: 0 };
  };

  // Um contexto só: o SW precisa ver o mesmo `self`/`caches` que o teste.
  const context = vm.createContext({ self, caches, fetch, URL, Response, console });
  vm.runInContext(SW_SOURCE, context);

  const dispatch = (type: string, data: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = [];
    const responses: Promise<unknown>[] = [];
    const replies: unknown[] = [];
    const event = {
      data,
      ports: [{ postMessage: (payload: unknown) => replies.push(payload) }],
      request: data.request,
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
      respondWith: (promise: Promise<unknown>) => responses.push(promise),
    };
    for (const fn of listeners[type] ?? []) fn(event);
    return {
      replies,
      settled: async () => {
        await Promise.all(waits);
        return Promise.all(responses);
      },
    };
  };

  const artKeys = () => [...(storage.get(ART_CACHE)?.keys() ?? [])].filter((url) => !url.endsWith("__art-index__"));
  const artFetch = (url: string) => ({ request: { method: "GET", mode: "no-cors", url } });

  return { dispatch, fetches, broadcasts, storage, storeOf, artKeys, artFetch, caches };
}

describe("ART_OFFLINE — public/sw.js (cache de arte sob demanda)", () => {
  it("não cacheia arte por padrão: um miss só passa para a rede", async () => {
    const env = makeEnv();
    const [response] = await env.dispatch("fetch", env.artFetch(artUrl(1))).settled();
    expect(env.fetches).toEqual([artUrl(1)]);
    expect(response).toEqual({ type: "opaque", ok: false, status: 0 });
    expect(env.artKeys()).toEqual([]);
    // Nem o cache é criado: a primeira imagem da Home não cria um cache vazio.
    expect(env.storage.has(ART_CACHE)).toBe(false);
  });

  it("warm-art guarda as respostas opacas e informa o progresso até o total", async () => {
    const env = makeEnv();
    await env.dispatch("message", { type: "warm-art", key: "deck-a", urls: [artUrl(1), artUrl(2), artUrl(2)] }).settled();
    expect(env.artKeys().sort()).toEqual([artUrl(1), artUrl(2)]);
    const last = env.broadcasts.at(-1);
    expect(last).toMatchObject({ type: "art-progress", key: "deck-a", done: 2, total: 2, failed: 0 });
  });

  it("warm-art ignora URLs fora dos hosts de arte e não-https", async () => {
    const env = makeEnv();
    await env.dispatch("message", {
      type: "warm-art",
      key: "x",
      urls: ["https://evil.example/a.png", "http://mastervault-storage-prod.s3.amazonaws.com/a.png", artUrl(9)],
    }).settled();
    expect(env.fetches).toEqual([artUrl(9)]);
    expect(env.artKeys()).toEqual([artUrl(9)]);
  });

  it("falha de rede conta como failed e não entra no cache", async () => {
    const env = makeEnv(new Set([artUrl(3)]));
    await env.dispatch("message", { type: "warm-art", key: "d", urls: [artUrl(3), artUrl(4)] }).settled();
    expect(env.broadcasts.at(-1)).toMatchObject({ done: 2, total: 2, failed: 1 });
    expect(env.artKeys()).toEqual([artUrl(4)]);
  });

  it("check-art responde quais URLs já estão no cache, sem tocar o LRU", async () => {
    const env = makeEnv();
    await env.dispatch("message", { type: "warm-art", key: "d", urls: [artUrl(1)] }).settled();
    const { replies, settled } = env.dispatch("message", { type: "check-art", urls: [artUrl(1), artUrl(2), "https://evil.example/z.png"] });
    await settled();
    expect(replies).toEqual([{ present: [true, false, false] }]);
  });

  it("serve do cache offline: um hit não vai à rede", async () => {
    const env = makeEnv();
    await env.dispatch("message", { type: "warm-art", key: "d", urls: [artUrl(1)] }).settled();
    env.fetches.length = 0;
    const [response] = await env.dispatch("fetch", env.artFetch(artUrl(1))).settled();
    expect(env.fetches).toEqual([]);
    expect(response).toEqual({ type: "opaque", ok: false, status: 0 });
  });

  it("LRU por contagem: ao passar de 120, sai a menos usada; um hit renova a posição", async () => {
    const env = makeEnv();
    const first = Array.from({ length: 120 }, (_, i) => artUrl(1000 + i));
    await env.dispatch("message", { type: "warm-art", key: "a", urls: first }).settled();
    expect(env.artKeys()).toHaveLength(120);

    // Usa a mais antiga: ela vira a mais recente.
    await env.dispatch("fetch", env.artFetch(first[0])).settled();
    // Espera a fila do touch (o warm com lista vazia entra depois dele na fila).
    await env.dispatch("message", { type: "warm-art", key: "none", urls: [] }).settled();

    await env.dispatch("message", { type: "warm-art", key: "b", urls: [artUrl(2000)] }).settled();
    const keys = env.artKeys();
    expect(keys).toHaveLength(120);
    expect(keys).toContain(first[0]);
    expect(keys).not.toContain(first[1]);
    expect(keys).toContain(artUrl(2000));
  });

  it("clear-art apaga o cache de arte e responde ok", async () => {
    const env = makeEnv();
    await env.dispatch("message", { type: "warm-art", key: "d", urls: [artUrl(1)] }).settled();
    const { replies, settled } = env.dispatch("message", { type: "clear-art" });
    await settled();
    expect(replies).toEqual([{ ok: true }]);
    expect(env.storage.has(ART_CACHE)).toBe(false);
  });

  it("activate mantém o cache de arte e apaga outros caches aember-arena-*", async () => {
    const env = makeEnv();
    await env.dispatch("message", { type: "warm-art", key: "d", urls: [artUrl(1)] }).settled();
    env.storeOf("aember-arena-shell-old");
    env.storeOf("aember-arena-houses-v1");
    env.storeOf("unrelated-cache");
    await env.dispatch("activate").settled();
    expect(env.storage.has(ART_CACHE)).toBe(true);
    expect(env.storage.has("aember-arena-houses-v1")).toBe(true);
    expect(env.storage.has("aember-arena-shell-old")).toBe(false);
    expect(env.storage.has("unrelated-cache")).toBe(true);
  });
});
