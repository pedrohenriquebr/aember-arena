const SHELL_CACHE = "aember-arena-shell-v2";
const ART_CACHE = "aember-arena-art-v2";
// Relative paths: resolved against the service worker script URL, so the shell
// precache works at the deployment root, under a subpath, wherever the SW is.
const SHELL_URLS = ["./", "./index.html", "./manifest.webmanifest", "./forge-icon.svg"];
const ART_HOSTS = ["mastervault-storage-prod.s3.amazonaws.com", "cdn.keyforgegame.com"];

// Simple LRU cap on the art cache. Cache.keys() returns requests in insertion
// order, so the head of the list is the least recently used and re-putting a
// hit moves it to the tail. Keeps offline browsing of the Master Vault from
// growing the cache without bound until the browser evicts it silently.
const ART_CACHE_LIMIT = 300;

// Official house emblems: precached so faction badges render offline.
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
  const cache = await caches.open(ART_CACHE);
  await Promise.all(
    HOUSE_ICONS.map(async (url) => {
      try {
        if (await cache.match(url)) return;
        const response = await fetch(url, { mode: "no-cors", credentials: "omit" });
        if (response.ok || response.type === "opaque") await cache.put(url, response);
      } catch {
        // The in-app SVG fallback covers this emblem.
      }
    }),
  );
}

function isQuotaError(error) {
  return (
    error?.name === "QuotaExceededError" ||
    error?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    (typeof error?.message === "string" && /quota/i.test(error.message))
  );
}

// Drops the oldest half of the cache. Used when the storage quota is hit so a
// fresh entry can still be stored on the retry.
async function pruneOldestArt(cache) {
  const keys = await cache.keys();
  const count = Math.ceil(keys.length / 2);
  await Promise.all(keys.slice(0, count).map((request) => cache.delete(request)));
}

// Enforces the cap after a put: deletes from the head (oldest) until the cache
// holds at most ART_CACHE_LIMIT entries.
async function trimArtCache(cache) {
  const keys = await cache.keys();
  const count = keys.length - ART_CACHE_LIMIT;
  if (count <= 0) return;
  await Promise.all(keys.slice(0, count).map((request) => cache.delete(request)));
}

// Best-effort put with quota handling. On QuotaExceededError it prunes the
// oldest half and retries once; every remaining failure is swallowed on
// purpose — the page already holds the network response, so caching is an
// optimization, never a gate.
async function putArtEntry(cache, request, entry) {
  const retryCopy = entry.clone();
  try {
    await cache.put(request, entry);
  } catch (error) {
    if (!isQuotaError(error)) return;
    try {
      await pruneOldestArt(cache);
      await cache.put(request, retryCopy);
    } catch {
      // Still over quota: give up on this entry.
    }
    return;
  }
  try {
    await trimArtCache(cache);
  } catch {
    // A failed trim is retried on the next put.
  }
}

// LRU touch: deleting and re-putting a hit moves it to the tail (most
// recently used) of the cache's insertion order.
async function touchArtEntry(cache, request, entry) {
  try {
    await cache.delete(request);
    await cache.put(request, entry);
  } catch {
    // Worst case the entry keeps its old position; it is still served.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined))
      .then(() => precacheHouseIcons())
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("aember-arena-") && ![SHELL_CACHE, ART_CACHE].includes(key))
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
        // Relative matches resolve against the SW script URL, same base as the
        // precached SHELL_URLS — consistent at root and under a subpath.
        fetch(request).catch(async () => (await caches.match("./") || await caches.match("./index.html"))),
      );
      return;
    }
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })),
    );
    return;
  }

  if (ART_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(ART_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          // Clone while the body is still unused; the page gets the original.
          const copy = cached.clone();
          event.waitUntil(touchArtEntry(cache, request, copy));
          return cached;
        }
        const response = await fetch(request);
        if (response.ok || response.type === "opaque") {
          const copy = response.clone();
          event.waitUntil(putArtEntry(cache, request, copy));
        }
        return response;
      }),
    );
  }
});
