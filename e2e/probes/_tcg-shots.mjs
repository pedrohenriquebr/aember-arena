// Capturas da variante Layout Arena (docs/ARENA_TCG_LIVE_PLAN.md §5 H-ATL-02): 4 temas × 3
// viewports × 2 fixtures (leve/cheia) = 24 PNGs + report.json. Cópia do _mesa-unica-shots com:
//   --view tcg|2d|3d   (padrão tcg; vai para o tableView do save)
//   --freeze           aborta toda requisição fora do localhost (a arte cai no fallback
//                      tipográfico, determinístico) e congela animações (como o _2d-freeze)
//   --lang en|ptBR     (padrão en)
// Uso: node e2e/probes/_tcg-shots.mjs [dir-de-saida] [--view tcg] [--freeze] [--lang ptBR]
// Diff de duas pastas: as capturas são PLANAS (sem subpasta por viewport) — use
// e2e/shots/_png-diff-flat.mjs <dirA> <dirB> (o _png-diff original não anda em pasta plana).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5233;
const argv = process.argv.slice(2);
const flag = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const VIEW = flag("--view", "tcg");
const FREEZE = argv.includes("--freeze");
const LANG = flag("--lang", "en");
const positional = argv.filter((arg, i) => !arg.startsWith("--") && !["--view", "--lang"].includes(argv[i - 1]));
const OUT = resolve(ROOT, positional[0] ?? "docs/advisor/arena-tcg-live/tmp");
const VIEWPORTS = [{ w: 1440, h: 900 }, { w: 768, h: 1024 }, { w: 390, h: 844 }];
const THEMES = ["forja", "aco", "claro", "arcano"];
const SPECS = {
  leve: { tag: "leve", player: { cr: 2, art: 1, up: 0 }, opp: { cr: 2, art: 0, up: 0 } },
  cheia: { tag: "cheia", player: { cr: 6, art: 1, up: 1 }, opp: { cr: 6, art: 1, up: 1 } },
};
const SEED = `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: false,
    hoverZoom: false, hints: false, language: "${LANG === "ptBR" ? "ptBR" : "en"}", tableView: "${VIEW}", opponentMode: "mirror", gameMode: "solo", aiSpeed: "fast",
  }));
  localStorage.setItem("aember-arena-language", "${LANG === "ptBR" ? "ptBR" : "en"}");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
})()`;

// Mesmo save fixo do _mesa-unica-shots: seed 424242, mão mantida dos dois lados e o
// board do spec (criaturas da casa ativa primeiro; upgrade preso à criatura 0 do jogador).
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
    return [...cr, ...art, ...up];
  };
  state.players[0].board = side(spec.player, 0);
  state.players[1].board = side(spec.opp, 100);
  state.activePlayer = 0;
  state.activeHouse = house;
  localStorage.setItem("aember-arena-match", JSON.stringify({ game: state, deckId: demo.DEMO_DECK_ID, savedAt: 1 }));
  return { house, hand: state.players[0].hand.length };
})()`;

// Medidas que o gate lê: largura das battlelines (o critério do H-ATL-05), as trilhas do grid
// do palco (a soma tem de bater o viewport no FIT) e o scroll do documento.
const MEASURE = () => {
  const widths = [...document.querySelectorAll(".battle-zone .card-tile--board")].map((el) => el.getBoundingClientRect().width);
  const board = document.querySelector(".board-content");
  return {
    cardW: widths.length ? [Math.round(Math.min(...widths) * 10) / 10, Math.round(Math.max(...widths) * 10) / 10] : null,
    tracks: board ? getComputedStyle(board).gridTemplateRows : null,
    docScroll: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
  };
};

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
      // --ignore-certificate-errors: mesmo motivo do _mesa-unica-shots (TLS da arte do MV na rede local).
      return await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"], ...opts });
    } catch { /* proximo */ }
  }
  throw new Error("sem Edge/Chrome do sistema");
}

const server = startServer();
let browser;
const report = [];
try {
  await server.ready();
  browser = await launch();
  mkdirSync(OUT, { recursive: true });
  for (const [specName, spec] of Object.entries(SPECS)) {
    for (const theme of THEMES) {
      for (const vp of VIEWPORTS) {
        const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, reducedMotion: "reduce" });
        if (FREEZE) await context.route("**/*", (r) => (new URL(r.request().url()).hostname === "127.0.0.1" ? r.continue() : r.abort()));
        await context.addInitScript(SEED);
        await context.addInitScript(`localStorage.setItem("aember-arena-theme", "${theme}")`);
        const page = await context.newPage();
        await page.goto(server.url, { waitUntil: "domcontentloaded" });
        await page.evaluate(SEED);
        await page.evaluate(`localStorage.setItem("aember-arena-theme", "${theme}")`);
        await page.evaluate(FIXTURE(spec));
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
        await page.locator('[data-action="continue"]').first().click();
        await page.waitForSelector(".game-screen", { timeout: 20000 });
        await page.waitForTimeout(700);
        if (FREEZE) await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }" });
        // Contexto frio: a arte vem do S3 pela rede (sem --freeze). Espera as <img> completarem.
        await page.waitForFunction(() => [...document.images].every((img) => img.complete), undefined, { timeout: 20000 }).catch(() => {});
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(200);
        const file = `${theme}-${vp.w}x${vp.h}-${specName}.png`;
        await page.screenshot({ path: join(OUT, file) });
        const measured = await page.evaluate(MEASURE);
        report.push({ file, view: VIEW, theme, viewport: `${vp.w}x${vp.h}`, spec: specName, lang: LANG, freeze: FREEZE, ...measured });
        console.log(`${file} cardW=${JSON.stringify(measured.cardW)} docScroll=${measured.docScroll}/${measured.innerHeight}`);
        await context.close();
      }
    }
  }
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`report.json: ${report.length} tiro(s) em ${OUT}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  server.stop();
}
