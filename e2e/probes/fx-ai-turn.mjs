// Probe do palco do turno da IA (ANIM onda 2, plano §3): num browser real,
// acompanha o turno do Warden e confere — batida por ação (>=700ms), legenda da
// carta jogada, pulso de quem age, "+N Æ" voando ao placar, selo da casa no band,
// banner "Seu turno", resumo persistente e o toque acelerando o resto do turno.
// Uso: node e2e/probes/fx-ai-turn.mjs   (derruba o dev server ao sair)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5206;
const SPEED = process.argv.includes("--fast") ? "fast" : "normal";
const SEED = `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: true,
    hoverZoom: false, hints: false, language: "en", opponentMode: "mirror", gameMode: "solo",
    aiSpeed: "${SPEED}",
  }));
  localStorage.setItem("aember-arena-language", "en");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
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

const SAMPLE = () => ({
  ghost: document.querySelectorAll(".fx-ghost").length,
  caption: document.querySelector(".fx-caption:not(.fx-banner)")?.textContent ?? null,
  acting: document.querySelectorAll('[data-fx="acting"]').length,
  amber: document.querySelectorAll(".fx-amber").length,
  amberText: document.querySelector(".fx-amber")?.textContent ?? null,
  banner: document.querySelector(".fx-banner")?.textContent ?? null,
  seal: document.querySelector(".player-band--ai .filter-chip")?.textContent ?? null,
  console: document.querySelector(".turn-console-copy strong")?.textContent ?? null,
  consoleText: document.querySelector(".turn-console-copy")?.textContent ?? null,
  logText: [...document.querySelectorAll(".log-entry p")].slice(0, 4).map((p) => p.textContent).join(" | "),
  phase: document.querySelector(".player-band--ai .active-turn-tag")?.getAttribute("aria-label") ?? null,
  logs: document.querySelectorAll(".log-entry p").length,
});

const PROBLEMS = [];
const check = (label, ok, detail) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) PROBLEMS.push(label);
};

const server = startServer();
try {
  await server.ready();
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
  await context.addInitScript(SEED);
  const page = await context.newPage();
  await page.goto(server.url, { waitUntil: "domcontentloaded" });
  await page.evaluate(SEED);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".home-screen", { timeout: 30000 });
  await page.locator(".header-nav .nav-link").nth(2).click();
  await page.waitForSelector(".config-screen", { timeout: 15000 });
  const pills = page.locator(".config-screen .config-step-pill");
  await pills.nth((await pills.count()) - 1).click();
  await page.locator(".config-nav .cta-button").click();
  await page.waitForSelector(".game-screen", { timeout: 20000 });
  const keep = page.locator(".mulligan-keep");
  if (await keep.count()) await keep.click();
  await page.waitForSelector(".mulligan-shade", { state: "detached", timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector(".end-turn-button")?.disabled, null, { timeout: 90000 });
  await page.evaluate(() => document.querySelector(".house-picker .house-choice:not([disabled])")?.click());
  await page.waitForTimeout(400);

  // Turno humano mínimo: joga a primeira carta jogável (se houver) e encerra.
  const tiles = page.locator(".hand-track .card-tile");
  const pb = page.locator(".inspector-actions button.primary-action").first();
  for (let i = 0; i < (await tiles.count()); i += 1) {
    await tiles.nth(i).click();
    await page.waitForTimeout(180);
    if (await pb.isEnabled().catch(() => false)) { await pb.click(); break; }
  }
  await page.waitForTimeout(1200);

  // ---- turno da IA: amostragem contínua ----
  const t0 = Date.now();
  await page.evaluate(() => document.querySelector(".end-turn-button")?.click());
  const seen = { caption: null, acting: false, amber: null, seal: null, banner: null, thinking: false, actingPhase: false };
  let firstGhostAt = null;
  let firstActionAt = null;
  let ghostSeen = 0;
  let accelerateAt = null;
  let nextEventAfterAccel = null;
  let signatureAtClick = null;
  const signature = (s) => `${s.ghost}|${s.amber}|${s.logs}|${s.console}`;
  let lastGhost = 0;
  const timeline = [];
  for (let i = 0; i < 400; i += 1) {
    const s = await page.evaluate(SAMPLE);
    const now = Date.now() - t0;
    if (s.caption) seen.caption ??= s.caption;
    if (s.acting) seen.acting = true;
    if (s.amberText) seen.amber ??= s.amberText;
    if (s.seal) seen.seal ??= s.seal;
    if (s.banner) seen.banner ??= s.banner;
    if (s.phase === "THINKING") seen.thinking = true;
    if (s.amber > 0 || s.ghost > 0) timeline.push([now, s.ghost, s.amber, s.amberText]);
    if (s.ghost > lastGhost) {
      ghostSeen += 1;
      if (firstGhostAt === null) firstGhostAt = now;
      lastGhost = s.ghost;
    } else if (s.ghost < lastGhost) {
      lastGhost = s.ghost;
    }
    // Depois do toque, o proximo evento do turno tem de vir rapido (a batida em
    // curso e cortada; as seguintes vao a 0.45x).
    if (accelerateAt !== null && nextEventAfterAccel === null && signatureAtClick !== null && signature(s) !== signatureAtClick) {
      nextEventAfterAccel = now - accelerateAt;
    }
    // Acelera no meio do turno: o toque corta a batida em curso.
    if (accelerateAt === null && ghostSeen >= 1 && now > (firstGhostAt ?? 0) + 250) {
      await page.mouse.click(640, 500);
      accelerateAt = Date.now() - t0;
      signatureAtClick = signature(s);
    }
    if (s.console === "Your turn") break;
    await page.waitForTimeout(60);
  }
  const turnMs = Date.now() - t0;
  const final = await page.evaluate(SAMPLE);
  console.log(`\n== TURNO DA IA (${SPEED}) ==`);
  console.log(JSON.stringify({ turnMs, ghostSeen, firstGhostAt, seen, accelerateAt, nextEventAfterAccel, summary: final.summary }));

  check("batida: turno da IA com >= 2 cartas/acoes levou tempo de leitura", turnMs >= 2500, `${turnMs}ms`);
  check("legenda da jogada do Warden", !!seen.caption && /Warden/.test(seen.caption) && /played/.test(seen.caption), seen.caption);
  const boardActions = /reaped with|used /.test(final.logText);
  if (boardActions) check("pulso de quem age (data-fx=acting)", seen.acting, final.logText);
  else console.log(`SKIP pulso de quem age: a IA so jogou cartas da mao neste turno`);
  console.log("timeline (ms, ghosts, gems):", JSON.stringify(timeline.slice(0, 24)));
  const gained = /\+([1-9]\d*) Æ/.test(final.consoleText ?? "");
  if (gained) check("'+N Æ' voando ao placar", !!seen.amber && /^\+\d+ Æ$/.test(seen.amber), seen.amber);
  else console.log(`SKIP '+N Æ': o turno nao gerou ambar (${final.consoleText})`);
  check("selo da casa da IA no band", !!seen.seal && /Brobnar|Dis|Logos|Mars|Sanctum|Shadows|Untamed/.test(seen.seal), seen.seal);
  check("banner 'Seu turno'", seen.banner === "Your turn", seen.banner);
  check("resumo do turno na faixa do round", /Warden:/.test(final.consoleText ?? ""), final.consoleText);
  check("toque acelera a batida em curso", nextEventAfterAccel !== null && nextEventAfterAccel <= 700, `${nextEventAfterAccel}ms apos o toque`);
  if (SPEED === "normal") {
    check("fase 'thinking' no aria do tag", seen.thinking);
  }

  // ---- Turnos extras da IA: com criaturas prontas ela colhe/luta, e aí o pulso
  // de quem age tem de aparecer (o 1o turno costuma só jogar cartas da mão).
  if (!boardActions) {
    let actingSeen = 0;
    let boardTurn = false;
    for (let turn = 0; turn < 3; turn += 1) {
      await page.evaluate(() => document.querySelector(".house-picker .house-choice:not([disabled])")?.click());
      await page.waitForTimeout(400);
      await page.evaluate(() => document.querySelector(".end-turn-button")?.click());
      for (let i = 0; i < 240; i += 1) {
        const s = await page.evaluate(SAMPLE);
        actingSeen += s.acting;
        if (s.console === "Your turn" && i > 4) break;
        await page.waitForTimeout(60);
      }
      const logs = await page.evaluate(SAMPLE);
      if (/reaped with|used |fought/.test(logs.logText)) boardTurn = true;
      if (actingSeen > 0) break;
    }
    if (actingSeen > 0) check("pulso de quem age (data-fx=acting) em turno de board", true, `amostras: ${actingSeen}`);
    else if (boardTurn) check("pulso de quem age (data-fx=acting) em turno de board", false, "turno com colheita/luta sem marca");
    else console.log("SKIP pulso de quem age: a IA nao fez acao de board nos turnos amostrados");
  }

  console.log(PROBLEMS.length ? `\nFALHAS: ${PROBLEMS.join("; ")}` : "\nOK: palco do turno da IA confere");
  await browser.close();
} finally {
  server.stop();
}
process.exit(PROBLEMS.length ? 1 : 0);
