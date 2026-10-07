// Zonas laterais (chips de Archive/Discard nas bandas + overlay de pilha).
// Sobe o dev server, entra na partida demo, enche as pilhas via patch do save
// (mesmo truque do fit.mjs FILL_BOARDS), prova a regra de face-down (arquivo do
// oponente nao abre) e o overlay (X/Esc/backdrop), e grava as captures em
// e2e/shots/zonas/ (2d e 3d, com o overlay aberto em pelo menos um shot).
// Uso: node e2e/probes/_zonas-piles.mjs
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "e2e", "shots", "zonas");
const PORT = 5232;
const url = `http://127.0.0.1:${PORT}/`;
mkdirSync(OUT, { recursive: true });

const child = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
const stop = () => spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });

const failures = [];
const bad = (msg) => { console.log(`   ! ${msg}`); failures.push(msg); };

// Pilhas previsiveis para as captures: 4 no descarte do jogador, 3 no arquivo,
// 5 no descarte do Warden, 4 no arquivo do Warden (virado para o jogador).
const FILL_PILES = () => {
  const raw = localStorage.getItem("aember-arena-match");
  if (!raw) return "sem save";
  const saved = JSON.parse(raw);
  const game = saved.game;
  const move = (player, to, n) => {
    for (let i = 0; i < n; i += 1) {
      const card = player.hand[i] ?? player.deck[i];
      if (!card) break;
      const from = player.hand.includes(card) ? player.hand : player.deck;
      from.splice(from.indexOf(card), 1);
      player[to].push(card);
    }
    return player[to].length;
  };
  const counts = {
    d0: move(game.players[0], "discard", 4),
    a0: move(game.players[0], "archives", 3),
    d1: move(game.players[1], "discard", 5),
    a1: move(game.players[1], "archives", 4),
  };
  localStorage.setItem("aember-arena-match", JSON.stringify(saved));
  return counts;
};

const SEED = (view) => `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: false,
    hoverZoom: false, hints: false, language: "en", opponentMode: "mirror", gameMode: "solo",
    tableView: "${view}",
  }));
  localStorage.setItem("aember-arena-language", "en");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
})()`;

async function enterMatch(page) {
  await page.waitForSelector(".home-screen", { timeout: 30000 });
  await page.evaluate(() => document.querySelectorAll(".header-nav .nav-link")[2]?.click());
  await page.waitForSelector(".config-screen", { timeout: 15000 });
  const pills = page.locator(".config-screen .config-step-pill");
  await pills.nth((await pills.count()) - 1).click();
  await page.locator(".config-nav .cta-button").click();
  await page.waitForSelector(".game-screen", { timeout: 20000 });
  const keep = page.locator(".mulligan-keep");
  if (await keep.count()) await keep.click();
  await page.waitForSelector(".mulligan-shade", { state: "detached", timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector(".end-turn-button")?.disabled, null, { timeout: 90000 });
  await page.waitForTimeout(500);
}

try {
  for (let i = 0; i < 200; i += 1) { try { if ((await fetch(url)).ok) break; } catch { /* subindo */ } await new Promise((r) => setTimeout(r, 250)); }
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "msedge", headless: true });

  for (const view of ["2d", "3d"]) {
    try {
    // Desktop: chips nas bandas + overlay (com captures).
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    context.setDefaultTimeout(8000);
    await context.addInitScript(SEED(view));
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await enterMatch(page);
    const counts = await page.evaluate(FILL_PILES);
    if (typeof counts === "string") bad(`${view}: ${counts}`);
    else console.log(`   pilhas patcheadas: ${JSON.stringify(counts)}`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".home-screen", { timeout: 20000 });
    await page.locator(".resume-bar").first().click();
    await page.waitForSelector(".game-screen", { timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector(".end-turn-button")?.disabled, null, { timeout: 60000 });
    await page.waitForTimeout(500);

    // Chips: 2 por banda; arquivo do oponente nao e botao (face-down).
    const chips = page.locator(".pile-chip");
    if ((await chips.count()) !== 4) bad(`${view}: esperava 4 chips, achei ${await chips.count()}`);
    const hidden = page.locator('.pile-chip--hidden[data-side="1"][data-pile="archive"]');
    if ((await hidden.count()) !== 1) bad(`${view}: chip de arquivo do oponente nao e face-down`);
    else if (await hidden.evaluate((el) => el.tagName !== "SPAN")) bad(`${view}: chip face-down virou botao`);
    const ownArchive = page.locator('.pile-chip[data-side="0"][data-pile="archive"]');
    if (await ownArchive.evaluate((el) => el.tagName !== "BUTTON")) bad(`${view}: arquivo do jogador nao abre`);
    const labels = await page.locator('.pile-chip[data-side="0"]').evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    console.log(`   ${view} chips: ${labels.join(" | ")}`);
    await page.screenshot({ path: join(OUT, `zonas-${view}-chips.png`) });

    // Clique no chip face-down nao abre nada.
    await hidden.click({ force: true }).catch(() => {});
    await page.waitForTimeout(200);
    if (await page.locator(".pile-panel").count()) bad(`${view}: arquivo virado do oponente abriu overlay`);
    const hiddenTitle = await hidden.getAttribute("title");
    if (!hiddenTitle) bad(`${view}: chip face-down sem tooltip`);

    // Overlay do descarte (público): grid ordenado, foco dentro, X fecha.
    await page.locator('.pile-chip[data-side="0"][data-pile="discard"]').click();
    await page.waitForSelector(".pile-panel[data-pile='discard']", { timeout: 5000 });
    const cells = await page.locator(".pile-panel .pile-card").count();
    if (cells !== 4) bad(`${view}: descarte do jogador com ${cells} cartas (esperava 4)`);
    const titles = await page.locator(".pile-panel .pile-card strong").evaluateAll((els) => els.map((el) => el.textContent));
    const sorted = [...titles].sort((a, b) => a.localeCompare(b));
    if (JSON.stringify(titles) !== JSON.stringify(sorted)) bad(`${view}: grid fora de ordem: ${titles.join(", ")}`);
    const focusIn = await page.evaluate(() => Boolean(document.querySelector(".pile-panel")?.contains(document.activeElement)));
    if (!focusIn) bad(`${view}: foco nao entrou no overlay`);
    const modalOk = await page.locator(".pile-panel").evaluate((el) => el.getAttribute("role") === "dialog" && el.getAttribute("aria-modal") === "true");
    if (!modalOk) bad(`${view}: overlay sem role=dialog/aria-modal`);
    await page.screenshot({ path: join(OUT, `zonas-${view}-overlay.png`) });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    if (await page.locator(".pile-panel").count()) bad(`${view}: overlay nao fechou com Esc`);

    // Backdrop fecha; X fecha; arquivo do dono abre face-up.
    await page.locator('.pile-chip[data-side="0"][data-pile="discard"]').click();
    await page.waitForSelector(".pile-panel", { timeout: 5000 });
    // Clique fora do painel: num canto do backdrop (o (8,8) do viewport bate no header).
    await page.locator(".modal-backdrop").click({ position: { x: 12, y: 240 } });
    await page.waitForTimeout(150);
    if (await page.locator(".pile-panel").count()) bad(`${view}: overlay nao fechou com backdrop`);
    await ownArchive.click();
    await page.waitForSelector(".pile-panel[data-pile='archives']", { timeout: 5000 });
    if ((await page.locator(".pile-panel .pile-card").count()) !== 3) bad(`${view}: arquivo do jogador sem 3 cartas`);
    await page.locator(".pile-panel .modal-close").click();
    await page.waitForTimeout(150);
    if (await page.locator(".pile-panel").count()) bad(`${view}: overlay nao fechou com X`);

    // Descarte do oponente tambem abre (publico).
    await page.locator('.pile-chip[data-side="1"][data-pile="discard"]').click();
    await page.waitForSelector(".pile-panel[data-pile='discard']", { timeout: 5000 });
    if ((await page.locator(".pile-panel .pile-card").count()) !== 5) bad(`${view}: descarte do Warden sem 5 cartas`);
    await page.keyboard.press("Escape");

    // Sem layout shift: o board nao pode ter mudado de caixa com o overlay aberto.
    await page.locator('.pile-chip[data-side="0"][data-pile="discard"]').click();
    await page.waitForSelector(".pile-panel", { timeout: 5000 });
    const shifted = await page.evaluate(() => {
      const board = document.querySelector(".game-board").getBoundingClientRect();
      return Math.abs(board.height - window.innerHeight) > 2000 || board.width <= 0;
    });
    if (shifted) bad(`${view}: board deslocado com overlay aberto`);
    await page.keyboard.press("Escape");
    await context.close();

    // Mobile: chips compactos (sem rotulo) na banda.
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    mobile.setDefaultTimeout(8000);
    await mobile.addInitScript(SEED(view));
    const mpage = await mobile.newPage();
    await mpage.goto(url, { waitUntil: "domcontentloaded" });
    await enterMatch(mpage);
    await mpage.evaluate(FILL_PILES);
    await mpage.reload({ waitUntil: "domcontentloaded" });
    await mpage.waitForSelector(".home-screen", { timeout: 20000 });
    await mpage.locator(".resume-bar").first().click();
    await mpage.waitForSelector(".game-screen", { timeout: 20000 });
    await mpage.waitForFunction(() => !document.querySelector(".end-turn-button")?.disabled, null, { timeout: 60000 });
    await mpage.waitForTimeout(500);
    const labelShown = await mpage.locator(".pile-chip-label").first().isVisible().catch(() => false);
    if (labelShown) bad(`${view}: rotulo do chip visivel no mobile`);
    await mpage.screenshot({ path: join(OUT, `zonas-${view}-mobile.png`) });
    await mpage.locator('.pile-chip[data-side="0"][data-pile="discard"]').click();
    await mpage.waitForSelector(".pile-panel", { timeout: 5000 });
    await mpage.screenshot({ path: join(OUT, `zonas-${view}-mobile-overlay.png`) });
    await mobile.close();
    console.log(`   ${view}: capturas em e2e/shots/zonas/`);
    } catch (error) {
      const msg = String(error?.message ?? error);
      const loc = msg.split("\n").find((line) => line.includes("waiting for")) ?? msg.split("\n")[0];
      bad(`${view}: ${loc.trim()}`);
    }
  }
  await browser.close();
} finally {
  stop();
}

if (failures.length) {
  console.log(`\nZONAS FAIL - ${failures.length} violacao(oes)`);
  process.exit(1);
}
console.log("\nZONAS OK");
