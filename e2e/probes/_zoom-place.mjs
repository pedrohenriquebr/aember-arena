// Preview de leitura (CardArt placeZoom) nos móveis novos: Layout Arena (tcg — bandejas de
// pilhas, placar tingido, pílula de END TURN, pílula de casas) e mesa 3D (console = placa
// central). Passa o mouse em CADA carta da mesa e da mão e mede o .card-zoom contra os
// obstáculos reais (getBoundingClientRect). Falha se o zoom cobrir a própria carta, sair da
// tela ou cobrir um obstáculo quando existia um lugar livre (o "livre" é procurado em grade).
// Uso: node e2e/probes/_zoom-place.mjs [--shots DIR] [--views tcg,3d]   (sai != 0 se falhar)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5239;
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const SHOTS = arg("--shots");
const VIEWS = (arg("--views") ?? "tcg,3d").split(",");
const VIEWPORTS = [{ w: 1280, h: 800 }, { w: 1296, h: 668 }, { w: 1920, h: 1080 }];

// O que o preview não pode cobrir (rótulo -> seletor). Do console conta o conteúdo, não o fundo.
const OBSTACLES = {
  placar: ".amber-counter, .key-counter, .key-pips",
  recursos: ".player-resources",
  bandejas: ".pile-chips",
  endTurn: ".end-turn-button",
  console: ".turn-console > *",
  casas: ".house-pill",
  avatar: ".player-avatar",
  menu: ".table-menu-trigger",
  undo: ".console-undo, .command-rail:not(.command-rail--drawer) .rail-console-slot > *",
  // VA-04: o rail fixo guarda inspetor/Undo/log — cobri-lo é o pior caso (mesmo contrato do placeZoom).
  rail: ".command-rail:not(.command-rail--drawer)",
};

const SEED = (view) => `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: false,
    hoverZoom: true, hints: false, language: "en", tableView: "${view}", opponentMode: "mirror", gameMode: "solo", aiDelayMs: 400,
  }));
  localStorage.setItem("aember-arena-language", "en");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
})()`;

// Mesa cheia de verdade: 5 criaturas + 1 artefato por lado, mão de 6.
const FIXTURE = `(async () => {
  const game = await import("/src/lib/game.ts");
  const demo = await import("/src/lib/demoDeck.ts");
  const deck = demo.DEMO_DECK;
  let state = game.createMatch(deck, deck, { seed: 424242 });
  state = game.keepHand(state, 0);
  state = game.keepHand(state, 1);
  const creatures = deck.cards.filter((c) => c.type === "Creature");
  const artifact = deck.cards.find((c) => c.type === "Artifact") ?? creatures[0];
  const mk = (id, face) => ({ instanceId: id, face, damage: 0, ready: true, stunned: false });
  state.players[0].board = [...creatures.slice(0, 5).map((f, i) => mk("mine-" + i, f)), mk("mine-art", artifact)];
  state.players[1].board = [...creatures.slice(5, 10).map((f, i) => mk("theirs-" + i, f)), mk("theirs-art", artifact)];
  state.players[0].hand = deck.cards.slice(10, 16).map((f, i) => mk("hand-" + i, f));
  state.activePlayer = 0;
  state.activeHouse = state.players[0].houses[0];
  localStorage.setItem("aember-arena-match", JSON.stringify({ game: state, deckId: demo.DEMO_DECK_ID, savedAt: 1 }));
  return true;
})()`;

const failures = [];
const report = [];
function check(name, ok, extra = "") {
  if (!ok) failures.push(name);
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
}

function startServer() {
  const child = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  const url = `http://127.0.0.1:${PORT}/`;
  return {
    url,
    stop: () => {
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else child.kill("SIGTERM");
    },
    async ready() {
      for (let i = 0; i < 240; i += 1) {
        try {
          if ((await fetch(url)).ok) return;
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

// Mede o zoom aberto e o confronta com obstáculos + uma busca em grade por um lugar livre.
const MEASURE = (obstacles) => {
  const zoom = document.querySelector(".card-zoom");
  if (!zoom) return null;
  const z = zoom.getBoundingClientRect();
  const hovered = document.querySelector("[data-zoom-probe]")?.getBoundingClientRect();
  const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const boxes = Object.entries(obstacles).flatMap(([label, sel]) =>
    [...document.querySelectorAll(sel)]
      .filter((el) => !el.closest(".card-zoom-layer") && (el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? true))
      .map((el) => ({ label, r: el.getBoundingClientRect() }))
      .filter((o) => o.r.width > 0 && o.r.height > 0));
  const covers = boxes.filter((o) => area(z, o.r) > 4).map((o) => o.label);
  const W = innerWidth;
  const H = innerHeight;
  // Existe um lugar livre do mesmo tamanho? (grade de 16px, mesma margem de 12px.) A altura
  // é a RESERVADA pelo placeZoom (arte + 140px, o teto do texto em 6 linhas), não a do texto
  // desta carta: um lugar que só serve a uma carta de texto curto não conta como livre.
  const zh = Math.max(z.height, z.width / 0.714 + 140);
  let free = false;
  for (let x = 12; x + z.width <= W - 12 && !free; x += 16) {
    for (let y = 12; y + zh <= H - 12 && !free; y += 16) {
      const box = { left: x, top: y, right: x + z.width, bottom: y + zh };
      if (hovered && area(box, hovered) > 0) continue;
      if (boxes.every((o) => area(box, o.r) <= 4)) free = true;
    }
  }
  return {
    zoom: { left: Math.round(z.left), top: Math.round(z.top), right: Math.round(z.right), bottom: Math.round(z.bottom) },
    offscreen: z.left < 0 || z.top < 0 || z.right > W || z.bottom > H,
    coversCard: hovered ? area(z, hovered) > 4 : false,
    covers: [...new Set(covers)],
    freeExists: free,
  };
};

async function run(browser, url, view, vp) {
  const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, reducedMotion: "reduce" });
  await context.addInitScript(SEED(view));
  const page = await context.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.evaluate(FIXTURE);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
  await page.locator('[data-action="continue"]').first().click();
  await page.waitForSelector(".game-screen", { timeout: 20000 });
  await page.waitForTimeout(600);

  const ids = await page.evaluate(() => [...document.querySelectorAll(".board-piece .card-tile[data-iid], .hand-track .card-tile[data-iid]")].map((el) => el.getAttribute("data-iid")));
  let bad = 0;
  let worst = null;
  for (const id of ids) {
    const art = page.locator(`.card-tile[data-iid="${id}"] .card-art`).first();
    const box = await art.boundingBox();
    if (!box) continue;
    await page.mouse.move(2, 2);
    await page.waitForTimeout(60);
    await page.evaluate((iid) => {
      document.querySelectorAll("[data-zoom-probe]").forEach((el) => el.removeAttribute("data-zoom-probe"));
      document.querySelector(`.card-tile[data-iid="${iid}"] .card-art`)?.setAttribute("data-zoom-probe", "");
    }, id);
    // Mira o centro VISÍVEL (no 3D a peça vizinha pode sobrepor uma borda).
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.4);
    await page.waitForTimeout(260);
    const m = await page.evaluate(MEASURE, OBSTACLES);
    if (!m) continue;
    const wrong = m.offscreen || m.coversCard || (m.covers.length > 0 && m.freeExists);
    report.push({ view, vp: `${vp.w}x${vp.h}`, id, ...m, wrong });
    if (wrong) {
      bad += 1;
      if (!worst) worst = { id, m };
    }
  }
  check(`${view} ${vp.w}x${vp.h}: preview sem cobrir carta/obstáculo havendo lugar livre (${ids.length} cartas)`, bad === 0, worst ? `${bad} ruins; ex. ${worst.id} cobre ${JSON.stringify(worst.m.covers)}${worst.m.coversCard ? " +carta" : ""}${worst.m.offscreen ? " +fora" : ""}` : "");
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    // Captura do pior caso (ou da 1ª carta do oponente): o zoom aberto sobre a mesa real.
    const id = worst?.id ?? ids[0];
    const box = await page.locator(`.card-tile[data-iid="${id}"] .card-art`).first().boundingBox();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(60);
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.4);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, `${view}-${vp.w}x${vp.h}.png`) });
    // E a carta do jogador mais à direita na mesa (o pior caso das bandejas laterais do tcg).
    const right = await page.evaluate(() => [...document.querySelectorAll(".battle-zone--player .board-piece .card-tile[data-iid]")].sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0]?.getAttribute("data-iid"));
    const rb = right ? await page.locator(`.card-tile[data-iid="${right}"] .card-art`).first().boundingBox() : null;
    await page.mouse.move(2, 2);
    await page.waitForTimeout(60);
    if (rb) await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height * 0.4);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, `${view}-${vp.w}x${vp.h}-right.png`) });
  }
  await context.close();
}

const server = startServer();
let browser;
try {
  await server.ready();
  browser = await launch();
  for (const view of VIEWS) for (const vp of VIEWPORTS) await run(browser, server.url, view, vp);
} finally {
  await browser?.close();
  server.stop();
}
if (SHOTS) writeFileSync(join(SHOTS, "report.json"), JSON.stringify(report, null, 2));
console.log(failures.length ? `\n${failures.length} FALHA(S)` : "\nzoom-place: tudo OK");
process.exit(failures.length ? 1 : 0);
