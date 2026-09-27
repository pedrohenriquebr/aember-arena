const SHELL_CACHE = "aember-arena-shell-v2";
const ART_CACHE = "aember-arena-art-v2";
const SHELL_URLS = ["/", "/index.html", "/manifest.webmanifest", "/forge-icon.svg"];
const ART_HOSTS = ["mastervault-storage-prod.s3.amazonaws.com", "cdn.keyforgegame.com"];

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
        fetch(request).catch(async () => (await caches.match("/") || await caches.match("/index.html"))),
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
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok || response.type === "opaque") {
          await cache.put(request, response.clone()).catch(() => undefined);
        }
        return response;
      }),
    );
  }
});