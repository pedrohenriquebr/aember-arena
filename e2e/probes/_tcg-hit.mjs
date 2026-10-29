// Gate de toque e de marcação da variante Layout Arena (docs/ARENA_TCG_LIVE_PLAN.md §5, H-ATL-02).
// Seções por lote, ativadas por --upto NN (padrão: a maior implementada). Hoje:
//   L01 — interruptores: Ajustes › Interface e ☰ da mesa ligam/desligam a Arena e a Mesa 3D
//         (mutuamente exclusivos) e a Arena fica sem console no rail (H-ATL-01 aceite)
//   L02 — marcação: [data-seat] nos dois bands, .console-undo, e a área do END TURN na mesa
// Uso: node e2e/probes/_tcg-hit.mjs [--upto 02]   (sai != 0 se algum check falhar)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5235;
const UPTO = process.argv.includes("--upto") ? Number(process.argv[process.argv.indexOf("--upto") + 1]) : 2;
const SEED = (view) => `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: false,
    hoverZoom: false, hints: false, language: "en", tableView: "${view}", opponentMode: "mirror", gameMode: "solo", aiSpeed: "fast",
  }));
  localStorage.setItem("aember-arena-language", "en");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
})()`;

// Save fixo mínimo (2 criaturas por lado): o gate precisa de uma partida em andamento.
const FIXTURE = `(async () => {
  const game = await import("/src/lib/game.ts");
  const demo = await import("/src/lib/demoDeck.ts");
  const deck = demo.DEMO_DECK;
  let state = game.createMatch(deck, deck, { seed: 424242 });
  state = game.keepHand(state, 0);
  state = game.keepHand(state, 1);
  const house = state.players[0].houses[0];
  const creatures = deck.cards.filter((c) => c.type === "Creature" && c.house === house);
  const pool = creatures.length >= 2 ? creatures : deck.cards.filter((c) => c.type === "Creature");
  const mk = (role, i, face) => ({ instanceId: role + "-hit-" + i, face, damage: 0, ready: true, stunned: false });
  state.players[0].board = [mk("cr", 0, pool[0]), mk("cr", 1, pool[1 % pool.length])];
  state.players[1].board = [mk("cr", 100, pool[2 % pool.length]), mk("cr", 101, pool[3 % pool.length])];
  state.activePlayer = 0;
  state.activeHouse = house;
  localStorage.setItem("aember-arena-match", JSON.stringify({ game: state, deckId: demo.DEMO_DECK_ID, savedAt: 1 }));
  return true;
})()`;

const failures = [];
const passes = [];
function check(name, ok, extra = "") {
  (ok ? passes : failures).push(name);
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
      return await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"], ...opts });
    } catch { /* proximo */ }
  }
  throw new Error("sem Edge/Chrome do sistema");
}

/** Abre a partida salva (fixture) na visão pedida e espera a mesa. */
async function openMatch(browser, url, view, vp) {
  const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, reducedMotion: "reduce" });
  await context.addInitScript(SEED(view));
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.evaluate(SEED(view));
  await page.evaluate(FIXTURE);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
  await page.locator('[data-action="continue"]').first().click();
  await page.waitForSelector(".game-screen", { timeout: 20000 });
  await page.waitForTimeout(500);
  return { context, page };
}

const boardState = (page) => page.evaluate(() => {
  const board = document.querySelector(".game-board");
  return { tcg: Boolean(board?.classList.contains("game-board--tcg")), threeD: Boolean(board?.classList.contains("game-board--3d")), view: board?.getAttribute("data-view") ?? null };
});

async function sectionL01(browser, url) {
  // Ajustes › Interface: a Arena liga (tcg), a Mesa 3D sai da Arena e vice-versa.
  const settings = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await settings.addInitScript(SEED("2d"));
  const sp = await settings.newPage();
  await sp.goto(`${url}?ui=2&screen=settings`, { waitUntil: "domcontentloaded" });
  await sp.waitForSelector('[data-screen="settings"]', { timeout: 30000 });
  await sp.locator('[data-screen="settings"] [role="tab"]', { hasText: /Interface/ }).click();
  const stored = () => sp.evaluate(() => JSON.parse(localStorage.getItem("aember-arena-settings") ?? "{}").tableView ?? null);
  const arenaSwitch = sp.locator('[role="switch"][aria-label="Arena layout"]');
  const threeDSwitch = sp.locator('[role="switch"][aria-label="3D table"]');
  check("L01 Ajustes: interruptor 'Arena layout' existe na Interface", (await arenaSwitch.count()) === 1);
  check("L01 Ajustes: a Arena nasce desligada e a Mesa 3D nasce desligada", (await arenaSwitch.getAttribute("aria-checked")) === "false" && (await threeDSwitch.getAttribute("aria-checked")) === "false");
  await arenaSwitch.click();
  await sp.waitForTimeout(150);
  check("L01 Ajustes: ligar a Arena grava tableView \"tcg\"", (await stored()) === "tcg", `gravado=${await stored()}`);
  check("L01 Ajustes: Mesa 3D fica desligada com a Arena ligada", (await threeDSwitch.getAttribute("aria-checked")) === "false");
  await threeDSwitch.click();
  await sp.waitForTimeout(150);
  check("L01 Ajustes: ligar a Mesa 3D com a Arena ativa grava \"3d\" (a Arena desliga)", (await stored()) === "3d", `gravado=${await stored()}`);
  check("L01 Ajustes: a Arena fica desligada com a Mesa 3D ligada", (await arenaSwitch.getAttribute("aria-checked")) === "false");
  await settings.close();

  // ☰ da mesa (desktop, 1440): mesma regra; a ordem é 3D primeiro, Arena depois.
  const vp = { w: 1440, h: 900 };
  const { context, page } = await openMatch(browser, url, "2d", vp);
  const trigger = page.locator(".table-menu-trigger");
  const menuSwitches = page.locator('[role="dialog"] [role="switch"]');
  await trigger.click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  const firstLabel = await menuSwitches.first().getAttribute("aria-label");
  check("L01 ☰: o primeiro interruptor continua sendo a Mesa 3D", firstLabel === "3D table", `primeiro=${firstLabel}`);
  const arenaInMenu = page.locator('[role="dialog"] [role="switch"][aria-label="Arena layout"]');
  const threeDInMenu = page.locator('[role="dialog"] [role="switch"][aria-label="3D table"]');
  await arenaInMenu.click();
  await page.waitForTimeout(300);
  let s = await boardState(page);
  check("L01 ☰: ligar a Arena põe .game-board--tcg e data-view=\"tcg\" (sem --3d)", s.tcg && !s.threeD && s.view === "tcg", JSON.stringify(s));
  check("L01 ☰: a folha segue aberta depois do interruptor", (await page.locator('[role="dialog"]').count()) === 1);
  await threeDInMenu.click();
  await page.waitForTimeout(300);
  s = await boardState(page);
  check("L01 ☰: ligar a Mesa 3D com a Arena ativa põe --3d e tira a Arena", s.threeD && !s.tcg, JSON.stringify(s));
  check("L01 ☰: o interruptor da Arena fica desligado com o 3D", (await arenaInMenu.getAttribute("aria-checked")) === "false");
  await threeDInMenu.click();
  await page.waitForTimeout(300);
  s = await boardState(page);
  check("L01 ☰: desligar o 3D volta ao 2D (nem --3d nem --tcg)", !s.threeD && !s.tcg, JSON.stringify(s));
  await page.keyboard.press("Escape");
  await context.close();
}

async function sectionL02(browser, url) {
  // Marcação da v2 (sem efeito visual): os dois bands têm o lado; Desfazer tem a classe.
  for (const vp of [{ w: 390, h: 844 }]) {
    const { context, page } = await openMatch(browser, url, "tcg", vp);
    const s = await boardState(page);
    check(`L02 ${vp.w}x${vp.h}: .game-board--tcg presente, sem --3d`, s.tcg && !s.threeD, JSON.stringify(s));
    const top = await page.locator('.player-band[data-seat="top"]').count();
    const bottom = await page.locator('.player-band[data-seat="bottom"]').count();
    check(`L02 ${vp.w}x${vp.h}: [data-seat] nos dois bands (top=${top}, bottom=${bottom})`, top === 1 && bottom === 1);
    check(`L02 ${vp.w}x${vp.h}: .console-undo presente (console do celular)`, (await page.locator(".console-undo").count()) >= 1);
    await context.close();
  }
  // Mesa ≥1041px: o END TURN fica DENTRO do board (não no rail — A3, consoleSlot null).
  const { context, page } = await openMatch(browser, url, "tcg", { w: 1440, h: 900 });
  const endInBoard = await page.evaluate(() => {
    const end = document.querySelector(".end-turn-button");
    return Boolean(end && end.closest(".game-board") && !end.closest(".rail, .rail-console-slot"));
  });
  check("L02 1440x900: END TURN na mesa, não no rail", endInBoard);
  check("L02 1440x900: sem .turn-console dentro do rail", (await page.locator(".rail-console-slot .turn-console").count()) === 0);
  await context.close();
}

const SECTIONS = [
  { num: 1, name: "L01", run: sectionL01 },
  { num: 2, name: "L02", run: sectionL02 },
];

const server = startServer();
let browser;
try {
  await server.ready();
  browser = await launch();
  for (const section of SECTIONS) {
    if (section.num > UPTO) continue;
    try {
      await section.run(browser, server.url);
    } catch (error) {
      check(`${section.name}: a seção quebrou`, false, String(error?.message ?? error).split("\n")[0]);
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  server.stop();
}
console.log(`\n${passes.length} OK, ${failures.length} FAIL (--upto ${String(UPTO).padStart(2, "0")})`);
process.exit(failures.length ? 1 : 0);
