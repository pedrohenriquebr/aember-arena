// QA do gate "2D pixel-identico" (e2e/shots e gitignored). O capture oficial
// sorteia a mao demo (seed aleatorio) e o game.png nunca bate entre duas
// rodadas; aqui a partida vem de um SAVE FIXO (createMatch com seed fixa +
// criaturas fixas) para comparar 2D antes/depois de um diff de CSS.
//
// Uso: node e2e/shots/_2d-freeze.mjs --tag antes|depois [--view 2d|3d] [360 1280]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5243;
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const TAG = arg("--tag", "freeze");
const VIEW = arg("--view", "2d");
const SIZES = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
const VIEWPORTS = (SIZES.length ? SIZES : [360, 1280]).map((w) => ({ w, h: w >= 1000 ? 800 : w >= 700 ? 1024 : 800 }));

const seed = (view) => `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: false,
    hoverZoom: false, hints: false, language: "en", tableView: "${view}", opponentMode: "mirror", gameMode: "solo", aiSpeed: "normal",
  }));
  localStorage.setItem("aember-arena-language", "en");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
})()`;

// O save fixo: seed 20260929, mao mantida dos dois lados e um board conhecido
// (2 criaturas do jogador + 1 do Warden, uma com dano). Tudo deterministico —
// mesmos instanceIds, mesma mao, mesmo dano em qualquer rodada.
const FIXTURE = `(async () => {
  const game = await import("/src/lib/game.ts");
  const demo = await import("/src/lib/demoDeck.ts");
  const deck = demo.DEMO_DECK;
  let state = game.createMatch(deck, deck, { seed: 20260929 });
  state = game.keepHand(state, 0);
  state = game.keepHand(state, 1);
  const creatures = deck.cards.filter((c) => c.type === "Creature");
  const mk = (face, i, damage) => ({ instanceId: "fix-" + i + "-" + face.id, face, damage, ready: true, stunned: false });
  state.players[0].board = [mk(creatures[0], 0, 0), mk(creatures[1], 1, 2)];
  state.players[1].board = [mk(creatures[2], 2, 0)];
  state.activePlayer = 0;
  state.activeHouse = state.players[0].houses[0];
  localStorage.setItem("aember-arena-match", JSON.stringify({ game: state, deckId: demo.DEMO_DECK_ID, savedAt: 1 }));
  return { turn: state.turn, hand: state.players[0].hand.length, house: state.activeHouse };
})()`;

const child = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
const url = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 200; i += 1) {
  try {
    if ((await fetch(url)).ok) break;
  } catch { /* subindo */ }
  await new Promise((r) => setTimeout(r, 250));
}

const CANDIDATES = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"];
const { chromium } = await import("playwright-core");
let browser;
for (const opts of [{ channel: "msedge" }, { channel: "chrome" }, ...CANDIDATES.filter(existsSync).map((executablePath) => ({ executablePath }))]) {
  try { browser = await chromium.launch({ headless: true, args: ["--no-sandbox"], ...opts }); break; } catch { /* proximo */ }
}

const shots = join(ROOT, "e2e", "shots", TAG);
mkdirSync(shots, { recursive: true });
for (const vp of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, reducedMotion: "reduce" });
  await context.addInitScript(seed(VIEW));
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.evaluate(seed(VIEW));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".home-screen", { timeout: 30000 });
  const fixture = await page.evaluate(FIXTURE);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".home-screen", { timeout: 30000 });
  await page.locator(".resume-bar").first().click();
  await page.waitForSelector(".game-screen", { timeout: 20000 });
  await page.waitForTimeout(900);
  // Determinismo: congela TODA animação/transição no momento da captura e espera
  // as fontes. Sem isso um pulso de feature nova (pill/chips) vira 300+ px
  // fantasma no diff mesmo com animations:false (3 de 8 rodadas, canto 22x22).
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(shots, `game-${vp.w}.png`) });
  await page.locator(".game-board").screenshot({ path: join(shots, `board-${vp.w}.png`) });
  const metrics = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const heading = document.querySelector(".battle-zone--opponent .zone-heading");
    const cards = [...document.querySelectorAll(".battle-zone--player .board-piece .card-tile")];
    const gap = heading && cards.length ? Math.round(Math.min(...cards.map((c) => c.getBoundingClientRect().top)) - heading.getBoundingClientRect().bottom) : null;
    const pw = document.querySelector(".battle-zone--player .card-tile--board");
    const ow = document.querySelector(".battle-zone--opponent .card-tile--board");
    return {
      handTop: box(".hand-track")?.top ?? null,
      boardTop: box(".game-board")?.top ?? null,
      plane: box(".table-plane"),
      gap,
      ratio: pw && ow ? Math.round((ow.getBoundingClientRect().width / pw.getBoundingClientRect().width) * 1000) / 1000 : null,
      viewport: window.innerHeight,
    };
  });
  console.log(`[${TAG}] ${vp.w}x${vp.h} fixture=${JSON.stringify(fixture)} view=${VIEW} metrics=${JSON.stringify(metrics)}`);
  await context.close();
}
await browser.close();
if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
else child.kill("SIGTERM");
process.exit(0);
