// Capturas da mesa 3D para o dono julgar (mesa unica): 4 temas x 3 viewports, com
// o mesmo save fixo do _3d-arena (6 criaturas + artefatos/upgrade em cada lado).
// Uso: node e2e/probes/_mesa-unica-shots.mjs <dir-de-saida>
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5231;
const OUT = resolve(ROOT, process.argv[2] ?? "docs/advisor/mesa-unica/tmp");
const VIEWPORTS = [{ w: 1440, h: 900 }, { w: 768, h: 1024 }, { w: 390, h: 844 }];
const THEMES = ["forja", "aco", "claro", "arcano"];
const SEED = `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: false,
    hoverZoom: false, hints: false, language: "en", tableView: "3d", opponentMode: "mirror", gameMode: "solo", aiSpeed: "fast",
  }));
  localStorage.setItem("aember-arena-language", "en");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
})()`;

// Seeds: creatures/artifacts por lado, 1 upgrade preso a criatura 0 do jogador e
// estados (atordoada, exausta, 2 de ambar) quando `states`. Os iids levam o papel
// no prefixo (cr-/art-/up-) para o probe classificar sem depender do CSS novo.
const FIXTURE = (spec) => `(async () => {
  const game = await import("/src/lib/game.ts");
  const demo = await import("/src/lib/demoDeck.ts");
  const deck = demo.DEMO_DECK;
  let state = game.createMatch(deck, deck, { seed: 424242 });
  state = game.keepHand(state, 0);
  state = game.keepHand(state, 1);
  const house = state.players[0].houses[0];
  const creatures = deck.cards.filter((c) => c.type === "Creature" && c.house === house);
  const pool = creatures.length >= 3 ? creatures : deck.cards.filter((c) => c.type === "Creature");
  const artifacts = deck.cards.filter((c) => c.type === "Artifact");
  const upgrade = deck.cards.find((c) => c.type === "Upgrade");
  const spec = ${JSON.stringify(spec)};
  const mk = (role, i, face, extra) => ({ instanceId: role + "-" + spec.tag + "-" + i, face, damage: 0, ready: true, stunned: false, ...extra });
  const side = (s, base) => {
    const cr = Array.from({ length: s.cr }, (_, i) => mk("cr", base + i, pool[i % pool.length]));
    const art = Array.from({ length: s.art }, (_, i) => mk("art", base + i, artifacts[i % artifacts.length]));
    const up = Array.from({ length: s.up }, (_, i) => mk("up", base + i, upgrade, { attachedTo: cr[0].instanceId }));
    if (spec.states && cr.length >= 3) {
      cr[1].stunned = true;
      cr[2].ready = false;
      cr[0].amber = 2;
      cr[2].damage = 2;
      cr[2].amber = 1;
    }
    return [...cr, ...art, ...up];
  };
  state.players[0].board = side(spec.player, 0);
  state.players[1].board = side(spec.opp, 100);
  state.activePlayer = 0;
  state.activeHouse = house;
  localStorage.setItem("aember-arena-match", JSON.stringify({ game: state, deckId: demo.DEMO_DECK_ID, savedAt: 1 }));
  return { house, hand: state.players[0].hand.length };
})()`;

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

const SPEC = { tag: "shot", player: { cr: 6, art: 1, up: 1 }, opp: { cr: 6, art: 1, up: 1 } };
const server = startServer();
let browser;
try {
  await server.ready();
  browser = await launch();
  mkdirSync(OUT, { recursive: true });
  for (const theme of THEMES) {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, reducedMotion: "reduce" });
      await context.addInitScript(SEED);
      await context.addInitScript(`localStorage.setItem("aember-arena-theme", "${theme}")`);
      const page = await context.newPage();
      await page.goto(server.url, { waitUntil: "domcontentloaded" });
      await page.evaluate(SEED);
      await page.evaluate(`localStorage.setItem("aember-arena-theme", "${theme}")`);
      await page.evaluate(FIXTURE(SPEC));
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
      await page.locator('[data-action="continue"]').first().click();
      await page.waitForSelector(".game-screen", { timeout: 20000 });
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(OUT, `${theme}-${vp.w}x${vp.h}.png`) });
      console.log(`${theme} ${vp.w}x${vp.h}`);
      await context.close();
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  server.stop();
}
