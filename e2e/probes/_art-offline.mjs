// Probe do cache de arte por deck (ART_OFFLINE, fase 1) — playwright-core SEM download
// de navegador (Edge/Chrome do sistema, igual e2e/sw-reset.mjs).
//
//   node e2e/probes/_art-offline.mjs [--port 4174]
//
// Roda o build de produção (dist/, com o sw.js novo) e, em perfil fresco:
//   (a) warm-art de um deck fake (36 URLs do host de arte, respostas mockadas por route,
//       sem ACAO → opacas, como no S3 real) → progresso chega ao total, cache com 36 artes;
//   (b) imagens ONLINE: as 36 renderizam e NENHUMA chega à rede (saem do cache do SW);
//   (c) setOffline(true) + reload: a casca abre do cache, as 36 artes SERVEM do cache e
//       uma URL nunca aquecida falha (controle: o SW não inventa arte);
//   (d) clear-art: o cache de arte some e, offline, as mesmas URLs falham;
//   (e) custo de quota medido: navigator.storage.estimate antes/depois do warm, por arte.
//
// Sai com exit != 0 se qualquer asserção falhar.
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VITE_BIN = join(ROOT, "node_modules", "vite", "bin", "vite.js");
const PORT = Number(process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : 4174);
const ART_CACHE = "aember-arena-art-v1";
const ART_HOST = "https://mastervault-storage-prod.s3.amazonaws.com";
const DECK_SIZE = 36;
// 1x1 PNG real: o <img> decodifica e naturalWidth > 0 quando serve.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const artUrl = (n) => `${ART_HOST}/media/card_front/en/probe_${String(n).padStart(3, "0")}_en.png`;
const DECK = Array.from({ length: DECK_SIZE }, (_, i) => artUrl(i + 1));
const COLD = artUrl(999);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

// ---------- build + vite preview (produção) ----------

console.log("build de produção (sw.js novo)…");
execSync("npm run build", { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });

function startPreview(port) {
  const child = spawn(process.execPath, [VITE_BIN, "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let tail = "";
  const append = (chunk) => {
    tail += chunk.toString();
    if (tail.length > 8000) tail = tail.slice(-4000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  const stop = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === "win32") {
      try { spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* morre com o pai */ }
    } else {
      child.kill("SIGTERM");
    }
  };
  process.on("exit", stop);
  return {
    url: `http://127.0.0.1:${port}/`,
    stop,
    async waitReady(timeoutMs = 60000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`vite preview saiu (code ${child.exitCode}):\n${tail}`);
        try {
          const res = await fetch(this.url);
          if (res.ok) return;
        } catch { /* ainda subindo */ }
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error(`vite preview nao respondeu em ${timeoutMs}ms:\n${tail}`);
    },
  };
}

const SYSTEM_BROWSER_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

async function launchBrowser() {
  const { chromium } = await import("playwright-core");
  const attempts = [
    { channel: "msedge" },
    { channel: "chrome" },
    ...SYSTEM_BROWSER_CANDIDATES.filter((p) => existsSync(p)).map((executablePath) => ({ executablePath })),
  ];
  const errors = [];
  for (const opts of attempts) {
    try {
      return await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"], ...opts });
    } catch (err) {
      errors.push(`${JSON.stringify(opts)}: ${String(err.message).split("\n")[0]}`);
    }
  }
  throw new Error(`Nenhum Edge/Chrome do sistema disponivel:\n- ${errors.join("\n- ")}`);
}

// ---------- helpers de página ----------

async function poll(fn, { timeoutMs = 30000, everyMs = 250, label = "condicao" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch {
      // execução destruída no meio do reload: próxima tentativa.
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`timeout esperando ${label} (${timeoutMs}ms); último valor: ${JSON.stringify(last)}`);
}

// Pede ao SW (que o app usaria) e espera o progresso chegar ao total pelo broadcast.
const warmInPage = (page, key, urls) => page.evaluate(({ key, urls }) => new Promise((resolve) => {
  const last = { done: 0, failed: 0, total: urls.length };
  const listener = (event) => {
    const data = event.data;
    if (data?.type !== "art-progress" || data.key !== key) return;
    Object.assign(last, data);
    if (data.done >= data.total) {
      navigator.serviceWorker.removeEventListener("message", listener);
      resolve(last);
    }
  };
  navigator.serviceWorker.addEventListener("message", listener);
  navigator.serviceWorker.controller.postMessage({ type: "warm-art", key, urls });
}), { key, urls });

// Mesma mensagem de check/clear que a UI usa, por MessageChannel.
const askSw = (page, message) => page.evaluate((message) => new Promise((resolve) => {
  const channel = new MessageChannel();
  channel.port1.onmessage = (event) => resolve(event.data);
  navigator.serviceWorker.controller.postMessage(message, [channel.port2]);
}), message);

// Cada URL vira um <img> novo: true = renderizou (naturalWidth > 0), false = falhou.
const loadImages = (page, urls) => page.evaluate((urls) => Promise.all(urls.map((src) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve(img.naturalWidth > 0);
  img.onerror = () => resolve(false);
  img.src = src;
}))), urls);

const artCount = (page) => page.evaluate(async (name) => {
  if (!(await caches.has(name))) return 0;
  const keys = await (await caches.open(name)).keys();
  return keys.filter((request) => !request.url.endsWith("__art-index__")).length;
}, ART_CACHE);

const quotaUsage = (page) => page.evaluate(async () => (await navigator.storage.estimate()).usage ?? 0);

// ---------- main ----------

const preview = startPreview(PORT);
let browser;
try {
  await preview.waitReady();
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  // Respostas mockadas no host de arte, SEM ACAO (como o S3): o navegador as torna opacas.
  // O route roda ANTES da emulação de offline do Playwright, então o modo offline é
  // imitado aqui (abort = rede caída); senão o mock continuaria servindo a arte.
  let routeHits = 0;
  let networkDown = false;
  await context.route(`${ART_HOST}/**`, (route) => {
    if (networkDown) return route.abort("internetdisconnected");
    routeHits += 1;
    return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
  });

  const page = await context.newPage();
  await page.goto(preview.url, { waitUntil: "load" });
  await page.evaluate(() => {
    localStorage.setItem("aember-arena-tutorial-seen", "1");
    localStorage.removeItem("aember-arena-onboarding");
  });
  await page.reload({ waitUntil: "load" });
  await poll(async () => page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return Boolean(navigator.serviceWorker.controller);
  }), { label: "SW controlando a página" });

  console.log("\n(a) warm-art de um deck fake (36 artes)");
  const quota0 = await quotaUsage(page);
  const warmHitsBefore = routeHits;
  const progress = await warmInPage(page, "probe-deck", DECK);
  const quota1 = await quotaUsage(page);
  const count1 = await artCount(page);
  check("progresso chegou ao total sem falhas", progress.done === DECK_SIZE && progress.failed === 0, JSON.stringify(progress));
  check(`cache ${ART_CACHE} com as ${DECK_SIZE} artes`, count1 === DECK_SIZE, `count=${count1}`);
  check("o warm buscou pela rede mockada (o SW passa pelo route)", routeHits - warmHitsBefore === DECK_SIZE, `rede=${routeHits - warmHitsBefore}`);
  const perArt = (quota1 - quota0) / DECK_SIZE;
  console.log(`  INFO  quota: ${(quota0 / 1048576).toFixed(1)} → ${(quota1 / 1048576).toFixed(1)} MB; ~${(perArt / 1048576).toFixed(2)} MB por arte no contador`);

  console.log("\n(b) online: as artes renderizam do cache, sem chegar à rede");
  const hitsBefore = routeHits;
  const online = await loadImages(page, DECK);
  check(`${DECK_SIZE} artes renderizam online`, online.every(Boolean), `ok=${online.filter(Boolean).length}`);
  check("nenhuma arte do deck foi à rede (saíram do cache do SW)", routeHits === hitsBefore, `rede=${routeHits - hitsBefore}`);

  console.log("\n(c) offline: setOffline(true) + reload");
  networkDown = true;
  await context.setOffline(true);
  await page.reload({ waitUntil: "load" });
  const shellOffline = await page.evaluate(() => document.readyState);
  check("a casca abre offline (shell do cache)", shellOffline === "complete", `readyState=${shellOffline}`);
  const offline = await loadImages(page, DECK);
  check(`as ${DECK_SIZE} artes SERVEM do cache offline`, offline.every(Boolean), `ok=${offline.filter(Boolean).length}`);
  const cold = await loadImages(page, [COLD]);
  check("controle: URL nunca aquecida falha offline", cold[0] === false);

  console.log("\n(d) clear-art: o cache some e, offline, as artes falham");
  const cleared = await askSw(page, { type: "clear-art" });
  check("clear-art responde ok", cleared?.ok === true, JSON.stringify(cleared));
  check("cache de arte apagado", (await artCount(page)) === 0);
  await page.reload({ waitUntil: "load" });
  const afterClear = await loadImages(page, DECK);
  check("depois de limpar, offline, as artes falham", afterClear.every((ok) => ok === false), `ok=${afterClear.filter(Boolean).length}`);

  console.log("\n(f) UI: Ajustes › Dados lista o deck salvo e baixa/limpa as artes");
  // Deck salvo pelo fallback do localStorage (listCachedDecks o lê junto com o IndexedDB).
  const deck = {
    id: "probe-ui-deck",
    name: "Probe UI deck",
    houses: ["Brobnar"],
    saved: true,
    cards: DECK.map((image, i) => ({ id: `probe-${i}`, title: `Probe ${i}`, house: "Brobnar", type: "Creature", image, text: "", amber: 0, power: 1, armor: 0 })),
  };
  networkDown = false;
  await context.setOffline(false);
  const ui = await context.newPage();
  await ui.addInitScript((payload) => {
    localStorage.setItem("aember-arena-tutorial-seen", "1");
    localStorage.setItem(`keyforge-deck-${payload.id}`, JSON.stringify(payload));
  }, deck);
  await ui.goto(`${preview.url}?ui=2&screen=settings`, { waitUntil: "load" });
  await ui.locator('[data-screen="settings"] [role="tab"]', { hasText: /Dados|Data/ }).click();
  const card = ui.locator('[data-screen="settings"] .u-art');
  await card.waitFor({ timeout: 30000 });
  const row = card.locator(".u-art-row");
  await poll(async () => (await row.count()) === 1, { label: "linha do deck no card de artes" });
  const rowStart = await row.innerText();
  check("card lista o deck salvo com 0/36 e status Nada", rowStart.includes("Probe UI deck") && rowStart.includes(`0/${DECK_SIZE}`) && /Nothing|Nada/.test(rowStart), rowStart.replace(/\s+/g, " "));
  await row.locator("button").click();
  await poll(async () => (await row.innerText()).includes(`${DECK_SIZE}/${DECK_SIZE}`), { timeoutMs: 60000, label: "deck baixado 36/36 no card" });
  const rowDone = await row.innerText();
  check("depois do download o status é Baixado", /Downloaded|Baixado/.test(rowDone), rowDone.replace(/\s+/g, " "));
  await card.screenshot({ path: join(ROOT, "e2e", "shots", "art-offline-dados.png") });
  await card.locator("button", { hasText: /Clear art|Limpar artes/ }).click();
  await poll(async () => (await row.innerText()).includes(`0/${DECK_SIZE}`), { label: "limpeza zera o status do deck" });
  check("Limpar artes zera o status do deck", true);
  await ui.close();

  await context.close();
} finally {
  if (browser) await browser.close();
  preview.stop();
}

console.log(`\n${failures.length === 0 ? "TODOS OS CHECKS PASSARAM" : `FALHAS (${failures.length}): ${failures.join(" | ")}`}`);
process.exit(failures.length === 0 ? 0 : 1);
