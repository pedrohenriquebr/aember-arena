// Harness manual do PWA (envenenamento de Service Worker) — playwright-core SEM
// download de navegador (Edge/Chrome do sistema, igual e2e/capture.mjs).
//
//   node e2e/sw-reset.mjs [--port 4173]
//
// Sobe o `vite preview` do dist/ (produção, porta 4173) e valida, em perfil
// fresco de browser:
//   (a) a primeira visita registra o SW do build com o BUILD_ID injetado
//       (confere EM TEXTO no sw.js servido e no nome do cache);
//   (b) REPRO do envenenamento: registra um SW velho fake com cache fixo
//       ("aember-arena-shell-v2") servindo um index antigo → recarrega → o
//       marcador #sw-poison-marker aparece (sintoma);
//   (c) ?swreset=1 cura: o marcador some, o cache legado morre, o parâmetro sai
//       da URL e o SW volta a ser o do build;
//   (d) rebuild com BUILD_ID novo → updatefound → toast FEAT-09 ("Reload") →
//       clicar libera o skipWaiting e o activate limpa o shell cache antigo.
//
// Sai com exit != 0 se qualquer asserção falhar. Requer `npm run build` antes.
import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VITE_BIN = join(ROOT, "node_modules", "vite", "bin", "vite.js");
const DIST = join(ROOT, "dist");
const PORT = Number(process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : 4173);
const LEGACY_CACHE = "aember-arena-shell-v2"; // nome fixo da era envenenada
const POISON_MARKER = "sw-poison-marker";

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

// ---------- vite preview (produção) ----------

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

// ---------- navegador do sistema (sem download) ----------

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

// ---------- helpers de pagina (poll resiliente a reload) ----------

async function poll(fn, { timeoutMs = 20000, everyMs = 250, label = "condicao" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch {
      // execution context destruido no meio do reload: proxima tentativa.
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`timeout esperando ${label} (${timeoutMs}ms); ultimo valor: ${JSON.stringify(last)}`);
}

const cacheKeys = (page) => page.evaluate(() => caches.keys()).catch(() => null);
const hasPoison = (page) => page.evaluate((id) => !!document.getElementById(id), POISON_MARKER).catch(() => true);

// ---------- main ----------

const swSource = readFileSync(join(DIST, "sw.js"), "utf8");
const buildId1 = /self\.BUILD_ID = "([^"]+)"/.exec(swSource)?.[1];
if (!buildId1 || buildId1 === "__BUILD_ID__") {
  console.error("dist/sw.js sem BUILD_ID injetado — rode `npm run build` antes.");
  process.exit(1);
}

// SW velho fake: cache fixo, navegacao cache-first servindo o index antigo.
const legacySw = `// SW velho fake (so para o harness) — cache fixo + navigate cache-first.
const CACHE = "${LEGACY_CACHE}";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["./legacy-index.html"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE)
      .then((cache) => cache.match("./legacy-index.html"))
      .then((cached) => cached || fetch(request)),
  );
});
`;
writeFileSync(join(DIST, "legacy-sw.js"), legacySw);
// O index "antigo" e o build atual com um marcador: tem o escape hatch real
// dentro (o codigo sob teste), mas e detectavel como shell velho servido pelo SW.
const staleShell = readFileSync(join(DIST, "index.html"), "utf8")
  .replace("</body>", `<div id="${POISON_MARKER}">STALE-SHELL</div></body>`);
if (!staleShell.includes(`id="${POISON_MARKER}"`)) {
  console.error("index.html sem </body> para injetar o marcador de shell velho.");
  process.exit(1);
}
writeFileSync(join(DIST, "legacy-index.html"), staleShell);

const preview = startPreview(PORT);
let browser;
try {
  await preview.waitReady();
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // (a) primeira visita, perfil fresco: registra o SW do build com BUILD_ID.
  console.log(`\n(a) primeira visita — BUILD_ID esperado: ${buildId1}`);
  await page.goto(preview.url, { waitUntil: "load" });
  // H-29: a v2 é o padrão e abre o onboarding na primeira visita, cobrindo o toast de
  // atualização; o marcador de tutorial visto tira o perfil de teste dessa primeira visita.
  // O passo gravado pela primeira carga (onboarding.ts) também sai: o reload retomaria o passo 1.
  await page.evaluate(() => {
    localStorage.setItem("aember-arena-tutorial-seen", "1");
    localStorage.removeItem("aember-arena-onboarding");
  });
  await page.reload({ waitUntil: "load" });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await poll(async () => {
    const keys = await cacheKeys(page);
    return keys?.includes(`aember-arena-shell-${buildId1}`) ? keys : false;
  }, { label: "cache do shell do build instalado" });
  const served = await page.evaluate(() => fetch("./sw.js").then((r) => r.text()));
  const servedId = /self\.BUILD_ID = "([^"]+)"/.exec(served)?.[1];
  const keysA = await cacheKeys(page);
  check("BUILD_ID em texto no sw.js servido", servedId === buildId1, `servido=${servedId}`);
  check(`cache aember-arena-shell-${buildId1} presente`, keysA.includes(`aember-arena-shell-${buildId1}`), `caches=${JSON.stringify(keysA)}`);

  // (b) REPRO do envenenamento: SW velho fake assume e serve o index antigo.
  console.log("\n(b) repro do envenenamento (SW velho fake, cache fixo)");
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.unregister();
    await navigator.serviceWorker.register("./legacy-sw.js");
  });
  await poll(async () => {
    const url = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "");
    return url.endsWith("legacy-sw.js") ? url : false;
  }, { label: "SW legado controlando a pagina" });
  await page.reload({ waitUntil: "load" });
  await poll(async () => (await hasPoison(page)) || false, { label: "sintoma (index antigo servido)" });
  const keysB = await cacheKeys(page);
  check("sintoma: #sw-poison-marker visivel (shell velho servido)", await hasPoison(page));
  check(`cache fixo ${LEGACY_CACHE} presente`, keysB.includes(LEGACY_CACHE), `caches=${JSON.stringify(keysB)}`);

  // (c) ?swreset=1 cura o envenenamento.
  console.log("\n(c) escape hatch ?swreset=1");
  await page.goto(`${preview.url}?swreset=1`, { waitUntil: "load" });
  await poll(async () => !(await hasPoison(page)), { label: "cura (marcador sumiu)" });
  await poll(async () => {
    const keys = await cacheKeys(page);
    return keys && !keys.includes(LEGACY_CACHE) ? keys : false;
  }, { label: "cache legado removido" });
  const keysC = await cacheKeys(page);
  const urlC = page.url();
  const regsC = await poll(async () => {
    const regs = await page.evaluate(async () => {
      const list = await navigator.serviceWorker.getRegistrations();
      return list.map((r) => r.active?.scriptURL ?? r.installing?.scriptURL ?? r.waiting?.scriptURL ?? "?");
    });
    return regs.length > 0 ? regs : false;
  }, { label: "SW do build registrado de novo apos a cura" });
  check("sintoma curado: marcador ausente", !(await hasPoison(page)));
  check("cache legado morto", !keysC.includes(LEGACY_CACHE), `caches=${JSON.stringify(keysC)}`);
  check("parametro swreset=1 saiu da URL", !urlC.includes("swreset=1"), `url=${urlC}`);
  check("registracoes sao todas do ./sw.js do build", regsC.length > 0 && regsC.every((u) => u.endsWith("/sw.js")), `regs=${JSON.stringify(regsC)}`);

  // (d) rebuild com BUILD_ID novo: updatefound -> toast FEAT-09 -> skipWaiting.
  console.log("\n(d) rebuild + update via toast FEAT-09");
  try {
    execSync("npm run build", { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    console.error(String(err.stdout ?? "") + String(err.stderr ?? ""));
    throw err;
  }
  const swSource2 = readFileSync(join(DIST, "sw.js"), "utf8");
  const buildId2 = /self\.BUILD_ID = "([^"]+)"/.exec(swSource2)?.[1];
  check("rebuild gerou BUILD_ID diferente", Boolean(buildId2) && buildId2 !== buildId1, `${buildId1} -> ${buildId2}`);
  await page.reload({ waitUntil: "load" });
  await poll(async () => {
    const visible = await page.evaluate(() => !!document.querySelector(".toast-message .toast-action"));
    return visible || false;
  }, { label: "toast FEAT-09 visivel (updatefound)" });
  const served2 = await page.evaluate(() => fetch("./sw.js").then((r) => r.text()));
  const servedId2 = /self\.BUILD_ID = "([^"]+)"/.exec(served2)?.[1];
  check("toast FEAT-09 visivel apos updatefound", true);
  check("sw.js servido ja e o do BUILD_ID novo", servedId2 === buildId2, `servido=${servedId2}`);
  await page.click(".toast-message .toast-action"); // "Reload" -> SKIP_WAITING
  // Troca completa: o cache novo ja existe desde o install; o antigo so morre no
  // activate (skipWaiting) — espera os dois estados.
  await poll(async () => {
    const keys = await cacheKeys(page);
    const ok = keys?.includes(`aember-arena-shell-${buildId2}`) && !keys.includes(`aember-arena-shell-${buildId1}`);
    return ok ? keys : false;
  }, { label: "troca de shell (novo presente, antigo limpo pelo activate)" });
  const keysD = await cacheKeys(page);
  check(`activate limpou o shell cache antigo (shell-${buildId1})`, !keysD.includes(`aember-arena-shell-${buildId1}`), `caches=${JSON.stringify(keysD)}`);
  check(`shell cache novo presente (shell-${buildId2})`, keysD.includes(`aember-arena-shell-${buildId2}`));
  check("houses cache preservado pelo activate", keysD.includes("aember-arena-houses-v1"), `caches=${JSON.stringify(keysD)}`);

  await context.close();
} finally {
  if (browser) await browser.close();
  preview.stop();
  for (const file of ["legacy-sw.js", "legacy-index.html"]) rmSync(join(DIST, file), { force: true });
}

console.log(`\n${failures.length === 0 ? "TODOS OS CHECKS PASSARAM" : `FALHAS (${failures.length}): ${failures.join(" | ")}`}`);
process.exit(failures.length === 0 ? 0 : 1);
