// Z-index do preview de leitura (card-zoom-layer, portal no body) ACIMA da ZonesSheet
// (nf-sheet-layer). Entra na partida ui2, enche o descarte do jogador, abre a folha pelo chip
// e passa o mouse em cartas do descarte: o centro do preview tem de ser pintado pela camada de
// zoom, não pelo backdrop/painel da folha.
// elementFromPoint ignora pointer-events:none (o preview é só visual), então a medição libera
// pointer-events SÓ dentro da camada de zoom enquanto consulta a pilha. Isso prova a ORDEM de
// empilhamento; o hit-test de clique segue como está (o preview nunca rouba clique).
// Uso: node e2e/probes/_zones-zindex.mjs   (sai != 0 se o preview ficar atrás da folha)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5241;
const URL = `http://127.0.0.1:${PORT}/`;
// Só desktop: o preview (.card-zoom) é display:none abaixo de 701px (hover-zoom é desktop).
const VIEWPORTS = [{ w: 1280, h: 800 }, { w: 768, h: 1024 }];
const CARDS_PER_VIEWPORT = 3;

const SEED = `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: false,
    hoverZoom: true, hints: false, language: "en", opponentMode: "mirror", gameMode: "solo", tableView: "2d",
  }));
  localStorage.setItem("aember-arena-language", "en");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
})()`;

// Descarte cheio de verdade: 4 cartas tiradas da mão do jogador (a partida demo começa vazia).
const FILL_DISCARD = () => {
  const raw = localStorage.getItem("aember-arena-match");
  if (!raw) return "sem save";
  const saved = JSON.parse(raw);
  const me = saved.game.players[0];
  for (let i = 0; i < 4; i += 1) {
    const card = me.hand[0] ?? me.deck[0];
    if (!card) break;
    const from = me.hand.includes(card) ? me.hand : me.deck;
    from.splice(from.indexOf(card), 1);
    me.discard.push(card);
  }
  localStorage.setItem("aember-arena-match", JSON.stringify(saved));
  return me.discard.length;
};

const failures = [];
const fail = (msg) => {
  console.log(`FAIL ${msg}`);
  failures.push(msg);
};

function startServer() {
  const child = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  return {
    stop: () => {
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else child.kill("SIGTERM");
    },
    async ready() {
      for (let i = 0; i < 240; i += 1) {
        try {
          if ((await fetch(URL)).ok) return;
        } catch { /* subindo */ }
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error("vite nao subiu");
    },
  };
}

const CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

async function launch() {
  const { chromium } = await import("playwright-core");
  for (const opts of [{ channel: "msedge" }, { channel: "chrome" }, ...CANDIDATES.filter(existsSync).map((executablePath) => ({ executablePath }))]) {
    try {
      return await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"], ...opts });
    } catch { /* proximo */ }
  }
  throw new Error("sem Edge/Chrome do sistema");
}

async function run(browser, vp) {
  const label = `${vp.w}x${vp.h}`;
  const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, reducedMotion: "reduce" });
  context.setDefaultTimeout(15000);
  await context.addInitScript(SEED);
  const page = await context.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());

  // Partida nova (lobby -> Jogar) e o mulligan mantido, como o ui2 faz.
  await page.goto(`${URL}?ui=2`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
  await page.locator('[data-action="play"]').click();
  await page.waitForSelector(".game-screen", { timeout: 20000 });
  const keep = page.locator(".mulligan-keep");
  if (await keep.count()) await keep.click();
  await page.waitForSelector(".mulligan-shade", { state: "detached", timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector(".end-turn-button")?.disabled, null, { timeout: 90000 });

  // Semeia o descarte no save e retoma pelo ContinueCard.
  const filled = await page.evaluate(FILL_DISCARD);
  if (typeof filled !== "number" || filled < 1) throw new Error(`${label}: descarte não semeado (${filled})`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-action="continue"]', { timeout: 30000 });
  await page.locator('[data-action="continue"]').click();
  await page.waitForSelector(".game-screen", { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector(".end-turn-button")?.disabled, null, { timeout: 90000 });
  await page.waitForTimeout(500);

  // Abre a ZonesSheet pelo chip do descarte do jogador (lado 0).
  await page.locator('.pile-chip[data-pile="discard"][data-side="0"]').click();
  await page.locator('[role="dialog"][aria-modal="true"] .nf-zones-card .card-art').first().waitFor({ state: "visible" });
  await page.waitForTimeout(600);

  const cards = page.locator('.nf-zones-panel .nf-zones-card .card-art');
  const total = await cards.count();
  if (total < 1) fail(`${label}: folha do descarte sem cartas`);
  const sample = Math.min(total, CARDS_PER_VIEWPORT);
  console.log(`[${label}] descarte com ${total} carta(s); medindo ${sample}`);

  for (let i = 0; i < sample; i += 1) {
    const box = await cards.nth(i).boundingBox();
    if (!box) {
      fail(`${label} carta ${i}: sem caixa`);
      continue;
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const shown = await page.locator(".card-zoom").waitFor({ state: "visible", timeout: 3000 }).then(() => true, () => false);
    if (!shown) {
      fail(`${label} carta ${i}: preview não abriu no hover`);
      continue;
    }
    await page.waitForTimeout(250);

    const m = await page.evaluate(() => {
      const zoom = document.querySelector(".card-zoom");
      const r = zoom.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const style = document.createElement("style");
      style.textContent = ".card-zoom-layer, .card-zoom-layer * { pointer-events: auto !important; }";
      document.head.append(style);
      const top = document.elementFromPoint(x, y);
      style.remove();
      const z = (sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).zIndex : null;
      };
      return {
        insideLayer: Boolean(top?.closest(".card-zoom-layer")),
        hit: top ? `${top.tagName.toLowerCase()}.${String(top.className).split(" ")[0]}` : "nada",
        zoomZ: z(".card-zoom-layer"),
        sheetZ: z(".nf-sheet-layer"),
      };
    });
    if (m.insideLayer) console.log(`OK   [${label}] carta ${i}: centro do preview pintado pela camada de zoom (z ${m.zoomZ} > folha ${m.sheetZ})`);
    else fail(`[${label}] carta ${i}: centro do preview pintado por "${m.hit}" — atrás da folha (zoom z ${m.zoomZ}, folha z ${m.sheetZ})`);
  }
  await context.close();
}

const server = startServer();
let browser;
try {
  await server.ready();
  browser = await launch();
  for (const vp of VIEWPORTS) await run(browser, vp);
} finally {
  await browser?.close();
  server.stop();
}

if (failures.length) {
  console.log(`\nzones-zindex: ${failures.length} FALHA(S)`);
  process.exit(1);
}
console.log("\nzones-zindex: preview acima da folha em todos os viewports medidos");
