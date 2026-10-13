// BUILD_ID: trocado no build por scripts/inject-sw-version.mjs (git short hash +
// timestamp curto). Com o placeholder injetado o sw.js muda de bytes A CADA
// build → o navegador acha update → o toast FEAT-09 aparece → "Recarregar" faz
// skipWaiting → o activate abaixo limpa as caches aember-arena-* antigas pelo
// prefixo. Em dev o placeholder fica literal no lugar (dev não usa SW).
self.BUILD_ID = "__BUILD_ID__";

const SHELL_CACHE = "aember-arena-shell-" + self.BUILD_ID;
const HOUSE_CACHE = "aember-arena-houses-v1";
// Artes de deck (ART_OFFLINE): cache dedicado, preenchido SÓ quando o app pede
// (warm-art). Nunca por padrão — ver o bloco "ART" abaixo.
const ART_CACHE = "aember-arena-art-v1";
// Relative paths: resolved against the service worker script URL, so the shell
// precache works at the deployment root, under a subpath, wherever the SW is.
const SHELL_URLS = ["./", "./index.html", "./manifest.webmanifest", "./forge-icon.svg"];
const ART_HOSTS = ["mastervault-storage-prod.s3.amazonaws.com", "cdn.keyforgegame.com"];

// BUG2-05: the S3 buckets answer WITHOUT Access-Control-Allow-Origin (verified
// with curl: 200 with no ACAO on the emblems, 403 on the preflight), so every
// art response is opaque and Chromium bills ~7 MB of quota per cached opaque
// entry no matter its real size (20 entries measured 140 MB). Card art is NOT
// cached by default: the SW only keeps it when the app asks (warm-art), into
// the bounded ART_CACHE below. Only the seven original emblems (~45 KB total,
// and the ones whose offline rendering matters most) are precached in their own
// fixed, uncapped cache and never pruned. The heavier expansion emblems stay
// out: Star Alliance and Saurian are 2.3 MB each and have no smaller variant on
// the bucket (BUG2-14: Star_Alliance200/64/_small all 403), so HouseIcon renders
// their initials offline without a request and keeps the URL for the online path.
const HOUSE_ICONS = [
  "Brobnar_RTivg44.png",
  "Dis_OooSNPO.png",
  "Logos_2mOY1dH.png",
  "Mars_CmAUCXI.png",
  "Sanctum_lUWPG7x.png",
  "Shadows_z0n69GG.png",
  "Untamed_bXh9SJD.png",
].map((file) => `https://mastervault-storage-prod.s3.amazonaws.com/media/houses/${file}`);

async function precacheHouseIcons() {
  const cache = await caches.open(HOUSE_CACHE);
  await Promise.all(
    HOUSE_ICONS.map(async (url) => {
      try {
        if (await cache.match(url)) return;
        const response = await fetch(url, { mode: "no-cors", credentials: "omit" });
        // A no-cors hit is opaque (status 0), so a transient 403/5xx cannot be
        // told apart from success; for this fixed 7-file set that is accepted.
        if (response.type === "opaque") await cache.put(url, response);
      } catch {
        // The in-app SVG fallback covers this emblem.
      }
    }),
  );
}

// ART (ART_OFFLINE, fase 1): artes de deck guardadas como respostas OPACAS.
// - Só entram por warm-art (pedido do app). Limite por contagem: ART_LIMIT.
// - Serve: cache-first; miss passa direto para a rede (o comportamento de antes).
// - LRU: o índice (ordem de uso, do mais antigo ao mais novo) é um JSON gravado
//   dentro do próprio ART_CACHE, para sobreviver ao SW ser encerrado. Cada hit e
//   cada warm passam por touchArt, que serializa as escritas (fila em artSerial).
// - O custo de quota é do navegador (~7 MB por opaca), não do tamanho real: o app
//   mostra esse aviso; o SW não tenta contornar.
const ART_LIMIT = 120;
const ART_CONCURRENCY = 4;
const ART_INDEX_URL = new URL("./__art-index__", self.location.href).href;

// LRU puro: `order` vai do mais antigo ao mais recente. Devolve a ordem nova e as
// URLs que estouram `room` (as mais antigas), que quem chama apaga.
function lruTouch(order, urls, room) {
  const fresh = [...new Set(urls)];
  const touched = new Set(fresh);
  const kept = order.filter((url) => !touched.has(url)).concat(fresh);
  const overflow = Math.max(0, kept.length - room);
  return { order: kept.slice(overflow), evicted: kept.slice(0, overflow) };
}

// Escritas do índice em fila: warm e hit intercalados nunca leem o mesmo estado.
let artQueue = Promise.resolve();
function artSerial(task) {
  const run = artQueue.then(task);
  artQueue = run.catch(() => undefined);
  return run;
}

// Reconcilia o índice salvo com as chaves reais do cache: o que o índice não
// conhece entra como o mais antigo, o que sumiu (quota do navegador) sai.
async function settleArt({ touch = [], room = ART_LIMIT }) {
  return artSerial(async () => {
    const cache = await caches.open(ART_CACHE);
    const present = new Set((await cache.keys()).map((request) => request.url));
    present.delete(ART_INDEX_URL);
    const saved = await cache.match(ART_INDEX_URL);
    const data = saved ? await saved.json().catch(() => null) : null;
    // A ordem vem do índice salvo (a ordem de uso), não de cache.keys().
    const savedOrder = Array.isArray(data?.order) ? data.order : [];
    const known = new Set(savedOrder);
    const ordered = savedOrder.filter((url) => present.has(url));
    const orphans = [...present].filter((url) => !known.has(url));
    const hits = touch.filter((url) => present.has(url));
    const { order, evicted } = lruTouch([...orphans, ...ordered], hits, room);
    await Promise.all(evicted.map((url) => cache.delete(url)));
    await cache.put(ART_INDEX_URL, new Response(JSON.stringify({ order: order.filter((url) => present.has(url)) })));
  });
}

// Só hosts de arte e https: o app não consegue usar o SW para guardar URL arbitrária.
function artUrlOf(raw) {
  try {
    const url = new URL(raw, self.location.href);
    return url.protocol === "https:" && ART_HOSTS.includes(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

function broadcast(message) {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true })
    .then((clients) => clients.forEach((client) => client.postMessage(message)))
    .catch(() => undefined);
}

async function runPool(items, size, task) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

// warm-art: busca cada URL no modo no-cors (o S3 não manda CORS, então a resposta é
// opaca e é guardada como está) e reporta progresso ao app. Nada bloqueia a UI.
async function warmArt(urls, key) {
  const wanted = [...new Set((Array.isArray(urls) ? urls : []).map(artUrlOf).filter(Boolean))].slice(0, ART_LIMIT);
  // Abre espaço ANTES do download: senão o lote inteiro estoura o limite de uma vez.
  await settleArt({ room: ART_LIMIT - wanted.length });
  const cache = await caches.open(ART_CACHE);
  const stored = [];
  let done = 0;
  let failed = 0;
  const report = () => broadcast({ type: "art-progress", key, done, failed, total: wanted.length });
  report();
  await runPool(wanted, ART_CONCURRENCY, async (url) => {
    try {
      if (await cache.match(url)) {
        stored.push(url);
      } else {
        const response = await fetch(url, { mode: "no-cors", credentials: "omit" });
        if (response.type === "opaque" || response.ok) {
          await cache.put(url, response);
          stored.push(url);
        } else {
          failed += 1;
        }
      }
    } catch {
      failed += 1;
    }
    done += 1;
    report();
  });
  await settleArt({ touch: stored });
}

// check-art: quais URLs já estão no cache (sem tocar a ordem LRU).
async function checkArt(urls) {
  const cache = await caches.open(ART_CACHE);
  return Promise.all((Array.isArray(urls) ? urls : []).map(async (raw) => {
    const url = artUrlOf(raw);
    return Boolean(url) && Boolean(await cache.match(url));
  }));
}

// FEAT-09: o worker novo NAO assume sozinho (skipWaiting sob demanda). O app
// mostra o toast de atualizacao e envia SKIP_WAITING no "Recarregar", para a
// troca de versao nunca ser silenciosa no meio de uma partida.
self.addEventListener("message", (event) => {
  const data = event.data ?? {};
  // Respostas por MessageChannel (event.ports[0]); progresso vai por broadcast.
  const reply = (payload) => event.ports?.[0]?.postMessage(payload);
  if (data.type === "SKIP_WAITING") self.skipWaiting();
  if (data.type === "warm-art") event.waitUntil(warmArt(data.urls, data.key));
  if (data.type === "check-art") event.waitUntil(checkArt(data.urls).then((present) => reply({ present })));
  if (data.type === "clear-art") {
    event.waitUntil(artSerial(() => caches.delete(ART_CACHE)).then(() => reply({ ok: true })));
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined))
      .then(() => precacheHouseIcons()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        // Anything else under the prefix (the retired art cache included) goes.
        .filter((key) => key.startsWith("aember-arena-") && ![SHELL_CACHE, HOUSE_CACHE, ART_CACHE].includes(key))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Art hit: the response is served at once; the LRU touch runs in the background.
// A touch lost to an early SW shutdown only changes the eviction order, never
// the art, so it is not chained to the response with waitUntil (that call must
// happen synchronously, before respondWith resolves).
function serveArt(event, request) {
  event.respondWith(
    // caches.match com cacheName não cria o cache: sem arte guardada, nada é aberto.
    caches.match(request, { cacheName: ART_CACHE }).then((hit) => {
      if (!hit) return fetch(request);
      void touchHit(request.url);
      return hit;
    }),
  );
}

function touchHit(url) {
  return settleArt({ touch: [url] }).catch(() => undefined);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith("/sw.js")) return;
    if (request.mode === "navigate") {
      event.respondWith(
        // Network-first with cache refresh: a successful shell fetch replaces
        // the precached copy, so the NEXT offline open serves the deployed
        // version instead of the install-day shell forever (BUG-07). Relative
        // matches resolve against the SW script URL, same base as the
        // precached SHELL_URLS — consistent at root and under a subpath.
        fetch(request).then(async (response) => {
          if (response && response.ok) {
            const copy = response.clone();
            void caches.open(SHELL_CACHE).then((cache) => cache.put("./index.html", copy));
          }
          return response;
        }).catch(async () => (await caches.match("./") || await caches.match("./index.html"))),
      );
      return;
    }
    event.respondWith(
      // Stale-while-revalidate for same-origin assets (manifest, icons): the
      // cached copy answers immediately while the network response refreshes
      // the cache, so they no longer freeze at install-day state (BUG-07).
      caches.match(request).then((cached) => {
        const network = fetch(request).then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }).catch(() => cached);
        return cached || network;
      }),
    );
    return;
  }

  // BUG2-05: emblems come from the fixed HOUSE_CACHE first; the heavier
  // expansion emblems pass through to the network. Card art on the art hosts
  // is served from ART_CACHE when the app warmed it, else from the network.
  if (ART_HOSTS.includes(url.hostname)) {
    if (url.pathname.startsWith("/media/houses/")) {
      event.respondWith(
        caches.open(HOUSE_CACHE).then(async (cache) => (await cache.match(request)) || fetch(request)),
      );
      return;
    }
    serveArt(event, request);
  }
});
