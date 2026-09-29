const SHELL_CACHE = "aember-arena-shell-v2";
const HOUSE_CACHE = "aember-arena-houses-v1";
// Relative paths: resolved against the service worker script URL, so the shell
// precache works at the deployment root, under a subpath, wherever the SW is.
const SHELL_URLS = ["./", "./index.html", "./manifest.webmanifest", "./forge-icon.svg"];
const ART_HOSTS = ["mastervault-storage-prod.s3.amazonaws.com", "cdn.keyforgegame.com"];

// BUG2-05: the S3 buckets answer WITHOUT Access-Control-Allow-Origin (verified
// with curl: 200 with no ACAO on the emblems, 403 on the preflight), so every
// art response is opaque and Chromium bills ~7 MB of quota per cached opaque
// entry no matter its real size (20 entries measured 140 MB). Card art is left
// to the browser's own HTTP cache — the SW does not intercept it at all.
// Only the seven original emblems (~45 KB total, and the ones whose offline
// rendering matters most) are precached in their own fixed, uncapped cache and
// never pruned. The heavier expansion emblems stay out: Star Alliance and
// Saurian are 2.3 MB each, and HouseIcon's glyph/initials fallback covers them.
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

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined))
      .then(() => precacheHouseIcons()),
  );
});

// FEAT-09: o worker novo NAO assume sozinho (skipWaiting sob demanda). O app
// mostra o toast de atualizacao e envia SKIP_WAITING no "Recarregar", para a
// troca de versao nunca ser silenciosa no meio de uma partida.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        // Anything else under the prefix (the retired art cache included) goes.
        .filter((key) => key.startsWith("aember-arena-") && ![SHELL_CACHE, HOUSE_CACHE].includes(key))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

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

  // BUG2-05: emblems come from the fixed HOUSE_CACHE first; anything else on
  // the art hosts (card faces, the heavier expansion emblems) is not
  // intercepted — the browser's HTTP cache handles it, and no opaque response
  // is ever written to our caches.
  if (ART_HOSTS.includes(url.hostname) && url.pathname.startsWith("/media/houses/")) {
    event.respondWith(
      caches.open(HOUSE_CACHE).then(async (cache) => (await cache.match(request)) || fetch(request)),
    );
  }
});
