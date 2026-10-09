// Jornada da v2 (UX_REWRITE_PLAN §5 H-14, §3.2): conta os CLIQUES do usuário do Lobby até o
// primeiro frame da mesa e falha se algum caminho passar de 3. Sobe o vite (porta 5212), abre
// ?ui=2 com storage limpo e mede cada cenário pelo listener de captura do próprio documento.
// Cenários: A Jogar→Manter (esperado 2) · B tile→Jogar→Manter (2) · C aba Jogar→Jogar→Manter a
// partir de Ajustes (3) · D força Duro→Jogar→Manter (3) · E Continuar após reload (1) · F abandono
// só com partida viva (confirma e cancela) · S smoke v2: dois turnos do Warden na mesa.
// Uso: npm run e2e:journey   (sai != 0 se algum critério falhar)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5212;
const VIEWPORT = { width: 1280, height: 800 };
const MAX_CLICKS = 3;

const SEED = `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: false,
    hoverZoom: false, hints: false, language: "en", opponentMode: "mirror", gameMode: "solo",
  }));
  localStorage.setItem("aember-arena-language", "en");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
})()`;

// Conta cliques reais do usuário (captura no documento inteiro). Reiniciado por cenário.
const COUNTER = `(() => {
  window.__clicks = 0;
  document.addEventListener("click", () => { window.__clicks += 1; }, true);
})()`;

function startServer() {
  const child = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  const url = `http://127.0.0.1:${PORT}/`;
  return {
    url,
    stop: () => {
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else child.kill("SIGTERM");
    },
    async ready() {
      for (let i = 0; i < 200; i += 1) {
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

async function newPage(browser, seed = SEED) {
  const context = await browser.newContext({ viewport: VIEWPORT, reducedMotion: "reduce" });
  await context.addInitScript(seed);
  await context.addInitScript(COUNTER);
  const page = await context.newPage();
  // Erro não capturado na página é falha da jornada, mesmo que a tela siga de pé.
  page.on("pageerror", (err) => failures.push(`erro de página: ${err.message.split("\n")[0]}`));
  return { context, page };
}

const clicks = (page) => page.evaluate(() => window.__clicks);
const resetClicks = (page) => page.evaluate(() => { window.__clicks = 0; });

// Do Lobby até a mesa: o Manter da mão inicial é o último clique (plano §3.2).
async function keepOpeningHand(page) {
  const keep = page.locator(".mulligan-keep");
  await keep.waitFor({ state: "visible", timeout: 20000 });
  await keep.click();
  await page.waitForSelector(".mulligan-shade", { state: "detached", timeout: 20000 }).catch(() => {});
  await page.waitForSelector(".game-screen", { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector(".end-turn-button")?.disabled, null, { timeout: 60000 });
}

// Um turno do Warden: o fim de turno desabilita o botão e a IA devolve a vez.
async function endTurnAndWait(page) {
  await page.waitForFunction(() => !document.querySelector(".end-turn-button")?.disabled, null, { timeout: 45000 });
  await page.locator(".end-turn-button").click();
  await page.waitForFunction(() => document.querySelector(".end-turn-button")?.disabled === true, null, { timeout: 10000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector(".end-turn-button")?.disabled, null, { timeout: 45000 });
}

const server = startServer();
const url = server.url;
const report = [];
const failures = [];
function check(name, count, expected) {
  const ok = count === expected && count <= MAX_CLICKS;
  report.push(`[journey] ${name}: ${count} clique(s) (esperado ${expected}, máximo ${MAX_CLICKS}) ${ok ? "OK" : "FALHA"}`);
  if (!ok) failures.push(`${name}: ${count} cliques, esperado ${expected}`);
}

async function scenarioA(browser) {
  const { context, page } = await newPage(browser);
  await page.goto(`${url}?ui=2`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
  await resetClicks(page);
  await page.locator('[data-action="play"]').click();
  await keepOpeningHand(page);
  check("A Lobby recém-aberto → Jogar → Manter", await clicks(page), 2);
  if (await page.locator('[role="dialog"][aria-modal="true"]').count()) failures.push("A: Jogar sem partida viva abriu diálogo");

  // S: dois turnos do Warden na mesa (smoke v2).
  await endTurnAndWait(page);
  await endTurnAndWait(page);
  mkdirSync(join(ROOT, "e2e", "shots", "journey"), { recursive: true });
  await page.screenshot({ path: join(ROOT, "e2e", "shots", "journey", "smoke-2turns.png") });
  report.push("[journey] S smoke v2: 2 turnos do Warden na mesa OK");
  return { context, page };
}

async function scenarioB(browser) {
  const { context, page } = await newPage(browser);
  await page.goto(`${url}?ui=2`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
  await resetClicks(page);
  // Tile da biblioteca (o segundo deck inicial): o botão Jogar do próprio tile.
  await page.locator(".nf-shelf-grid .nf-tile-actions .nf-btn--secondary").nth(1).click();
  await keepOpeningHand(page);
  check("B Tile → Jogar → Manter", await clicks(page), 2);
  await context.close();
}

async function scenarioC(browser) {
  const { context, page } = await newPage(browser);
  await page.goto(`${url}?ui=2`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
  await page.locator(".nf-shell-tab").nth(2).click();
  await page.waitForSelector(".config-screen", { timeout: 15000 });
  await resetClicks(page);
  await page.locator(".nf-shell-tab").nth(0).click();
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 15000 });
  await page.locator('[data-action="play"]').click();
  await keepOpeningHand(page);
  check("C aba Jogar (de Ajustes) → Jogar → Manter", await clicks(page), 3);
  await context.close();
}

async function scenarioD(browser) {
  const { context, page } = await newPage(browser);
  await page.goto(`${url}?ui=2`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
  await resetClicks(page);
  await page.locator('[data-screen="lobby"] .nf-seg-option', { hasText: "Hard" }).click();
  await page.locator('[data-action="play"]').click();
  await keepOpeningHand(page);
  check("D força Duro → Jogar → Manter", await clicks(page), 3);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("aember-arena-settings") ?? "{}"));
  if (saved.difficulty !== "Hard" || saved.thinkingDepth !== 4) failures.push(`D: força Duro não persistiu (${saved.difficulty}·${saved.thinkingDepth})`);
  await context.close();
}

// E e F partem do mesmo save: uma partida jogada (um turno passado), depois recarregada.
// G: pass-and-play pela folha (código novo: playDeck no 2P). Não conta cliques: é o caminho de
// personalização, não o caminho feliz (plano §3.2). Só exige que a mesa de dois jogadores abra.
async function scenarioG(browser) {
  const { context, page } = await newPage(browser);
  await page.goto(`${url}?ui=2`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
  await page.locator(".nf-opponent").click();
  await page.locator('[role="dialog"][aria-modal="true"]').getByRole("radio", { name: "2 players (pass-and-play)" }).click();
  await page.locator('[data-action="match-play"]').click();
  await page.waitForSelector(".game-screen", { timeout: 20000 });
  report.push("[journey] G pass-and-play pela folha: a mesa de dois jogadores abre OK");
  await context.close();
}

async function scenarioEF(browser) {
  const { context, page } = await newPage(browser);
  await page.goto(`${url}?ui=2`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
  await page.locator('[data-action="play"]').click();
  await keepOpeningHand(page);
  await endTurnAndWait(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });

  // E: com save vivo o primário é Continuar; um clique leva à mesa, sem mão inicial.
  if (!(await page.locator('[data-action="continue"]').count())) failures.push("E: lobby sem Continuar com save vivo");
  await resetClicks(page);
  await page.locator('[data-action="continue"]').click();
  await page.waitForSelector(".game-screen", { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector(".end-turn-button")?.disabled, null, { timeout: 60000 });
  check("E Continuar (partida salva) → mesa", await clicks(page), 1);
  if (await page.locator(".mulligan-keep").count()) failures.push("E: retomar abriu a mão inicial de novo");

  // F: abandono só com partida viva. Sair da mesa pelo ☰ (a casca de mesa não tem marca) com a
  // partida em memória; "Sair para o lobby" não abandona, só volta.
  await page.locator(".table-menu-trigger").click();
  await page.locator('[role="dialog"][aria-modal="true"]').getByRole("button", { name: "Leave to lobby", exact: true }).click();
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 15000 });
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  await page.locator('[data-action="new-match"]').click();
  await dialog.waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("F: 'Nova partida' com partida viva não pediu confirmação"));
  await dialog.getByRole("button", { name: /Cancel|Cancelar/ }).click();
  await dialog.waitFor({ state: "detached", timeout: 5000 }).catch(() => failures.push("F: Cancelar não fechou o diálogo"));
  if (!(await page.locator('[data-action="continue"]').count())) failures.push("F: cancelar o abandono perdeu a partida do lobby");
  report.push("[journey] F partida viva: 'Nova partida' pede confirmação e Cancelar mantém a partida OK");

  await page.locator('[data-action="new-match"]').click();
  await dialog.waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("F: segunda 'Nova partida' sem confirmação"));
  await dialog.getByRole("button", { name: /Abandon|Abandonar/ }).click();
  await keepOpeningHand(page);
  report.push("[journey] F abandono confirmado: a partida nova começa OK");
  await context.close();
}

let browser;
try {
  await server.ready();
  browser = await launch();
  await scenarioA(browser).then(({ context }) => context.close());
  await scenarioB(browser);
  await scenarioC(browser);
  await scenarioD(browser);
  await scenarioEF(browser);
  await scenarioG(browser);
} catch (err) {
  failures.push(`exceção: ${err.message.split("\n")[0]}`);
} finally {
  if (browser) await browser.close();
  server.stop();
}

for (const line of report) console.log(line);
if (failures.length) {
  for (const failure of failures) console.log(`[journey] FALHA: ${failure}`);
  console.log(`\nJOURNEY FAIL - ${failures.length} violação(ões)`);
  process.exit(1);
}
console.log("\nJOURNEY OK");
process.exit(0);
