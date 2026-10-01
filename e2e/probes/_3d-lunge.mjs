// Probe da investida e do impacto na mesa 3D (H3D-20, docs/VIEW3D_ARENA_LAYOUT.md §3.6).
// Um board de SAVE FIXO (atacante forte do jogador x defensor fraco do Warden) luta num
// browser real e o probe amostra, quadro a quadro, a peca atacante e o portal de FX:
//   3d       investida 460±30ms em `translate` individual, `rotate` constante, estouro a
//            ~45%, "-N" a <= 6px do ponto (centro x, 35% y) do defensor, e a peca de volta
//            a pose EXATA 100ms depois do fim (sem WAAPI residual).
//   reduce   reduce-motion: 0 animacao disparada (sem investida, sem estouro).
//   2d       2D: nenhuma animacao nova (sem investida, sem estouro).
// Uso: node e2e/probes/_3d-lunge.mjs
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5221;

const seed = (view) => `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: true,
    hoverZoom: false, hints: false, language: "en", tableView: "${view}", opponentMode: "mirror", gameMode: "solo", aiSpeed: "normal", aiDelayMs: 400,
  }));
  localStorage.setItem("aember-arena-language", "en");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
})()`;

const FIXTURE = `(async () => {
  const game = await import("/src/lib/game.ts");
  const demo = await import("/src/lib/demoDeck.ts");
  const deck = demo.DEMO_DECK;
  let state = game.createMatch(deck, deck, { seed: 777 });
  state = game.keepHand(state, 0);
  state = game.keepHand(state, 1);
  const house = state.players[0].houses[0];
  const creatures = deck.cards.filter((c) => c.type === "Creature" && c.house === house && Number(c.power) > 0);
  const strong = [...creatures].sort((a, b) => Number(b.power) - Number(a.power))[0];
  const weak = deck.cards.filter((c) => c.type === "Creature" && Number(c.power) > 0).sort((a, b) => Number(a.power) - Number(b.power))[0];
  const mk = (id, face) => ({ instanceId: id, face, damage: 0, ready: true, stunned: false });
  // O atacante tem armadura de sobra (sobrevive) e o defensor aguenta o golpe: os dois ficam em
  // campo, entao ha peca para investir E "-N" no defensor.
  const tank = { ...strong, power: 4, armor: 10 };
  const wall = { ...weak, power: 9, armor: 0 };
  state.players[0].board = [mk("lg-a", creatures[0]), mk("lg-b", tank), mk("lg-c", creatures[0])];
  state.players[1].board = [mk("lg-x", wall), mk("lg-y", wall), mk("lg-z", wall)];
  state.activePlayer = 0;
  state.activeHouse = house;
  localStorage.setItem("aember-arena-match", JSON.stringify({ game: state, deckId: demo.DEMO_DECK_ID, savedAt: 1 }));
  return { house, strong: strong.title, weak: weak.title };
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

const PROBLEMS = [];
const check = (label, ok, detail) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) PROBLEMS.push(label);
};
const r1 = (n) => Math.round(n * 10) / 10;

// Dispara a luta e amostra por ~1,3s. Roda DENTRO da pagina: o clique no alvo, a leitura
// do ponto esperado (no mesmo tick do clique) e o laco de quadros.
const FIGHT = async () => {
  const art = document.querySelector('[data-iid="lg-x"] .card-art');
  const target = document.querySelector('[data-iid="lg-x"]');
  const piece = document.querySelector('[data-iid="lg-b"]').closest(".board-piece");
  const cs = getComputedStyle(piece);
  const base = { translate: cs.translate, rotate: cs.rotate };
  const rect = art.getBoundingClientRect();
  const expected = { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.35 };
  const log = { frames: [], burst: null, dmgs: [], anims: 0, bursts: 0 };
  const t0 = performance.now();
  const layer = document.querySelector(".fx-layer");
  new MutationObserver((list) => {
    for (const m of list) {
      for (const n of m.addedNodes) {
        if (n.classList?.contains("fx-burst")) {
          log.bursts += 1;
          log.burst = { t: performance.now() - t0, x: parseFloat(n.style.left), y: parseFloat(n.style.top) };
        }
        if (n.classList?.contains("fx-dmg")) log.dmgs.push({ t: performance.now() - t0, x: parseFloat(n.style.left), y: parseFloat(n.style.top) });
      }
    }
  }).observe(layer, { childList: true });
  target.click();
  await new Promise((resolveFrame) => {
    const tick = () => {
      const t = performance.now() - t0;
      const own = piece.getAnimations().filter((a) => !(a instanceof CSSTransition) && a.effect?.getKeyframes?.().some((k) => "translate" in k));
      if (own.length) {
        log.anims = Math.max(log.anims, own.length);
        log.duration = own[0].effect.getTiming().duration;
        if (log.start === undefined) log.start = t;
        log.end = t;
      }
      const now = getComputedStyle(piece);
      log.frames.push({ t, rotate: now.rotate, translate: now.translate });
      if (t < 1300) requestAnimationFrame(tick);
      else resolveFrame();
    };
    tick();
  });
  const after = getComputedStyle(piece);
  return { base, expected, log, after: { translate: after.translate, rotate: after.rotate }, residual: piece.getAnimations().filter((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation)).length, hitMarks: document.querySelectorAll('[data-fx="hit"]').length };
};

const server = startServer();
let browser;
try {
  await server.ready();
  browser = await launch();
  for (const scenario of [
    { name: "3d", view: "3d", motion: "no-preference" },
    { name: "reduce-motion 3d", view: "3d", motion: "reduce" },
    { name: "2d", view: "2d", motion: "no-preference" },
  ]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: scenario.motion });
    const SEED = seed(scenario.view);
    await context.addInitScript(SEED);
    const page = await context.newPage();
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.evaluate(SEED);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".home-screen", { timeout: 30000 });
    await page.evaluate(FIXTURE);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".home-screen", { timeout: 30000 });
    await page.locator(".resume-bar").first().click();
    await page.waitForSelector(".game-screen", { timeout: 20000 });
    await page.waitForTimeout(700);

    await page.locator('[data-iid="lg-b"]').click();
    await page.waitForTimeout(250);
    const fight = page.locator(".inspector-actions button", { hasText: /fight/i }).first();
    await fight.click();
    await page.waitForTimeout(300);
    const res = await page.evaluate(FIGHT);
    await page.waitForTimeout(100);
    const t = scenario.name;
    const { base, expected, log, after } = res;
    const dmg = [...log.dmgs].sort((a, b) => Math.hypot(a.x - expected.x, a.y - expected.y) - Math.hypot(b.x - expected.x, b.y - expected.y))[0];

    if (scenario.name === "3d") {
      const dur = (log.end ?? 0) - (log.start ?? 0);
      check(`${t}: investida existe (translate em WAAPI) com duration 460`, log.anims === 1 && log.duration === 460, `anims=${log.anims} duration=${log.duration}`);
      check(`${t}: investida dura 460 ± 30ms (medido por quadros)`, dur >= 430 && dur <= 520, `${r1(dur)}ms (amostragem de rAF ~16ms)`);
      const moving = log.frames.filter((f) => f.translate !== base.translate);
      check(`${t}: a peca de fato avanca (translate difere da pose)`, moving.length >= 5, `${moving.length} quadros fora da pose`);
      check(`${t}: rotate computada igual em todos os quadros`, log.frames.every((f) => f.rotate === base.rotate), `base=${base.rotate}`);
      // A pose de repouso e a que a peca tem ao assentar (a selecao/mira transiciona 150ms
      // no clique, entao a leitura do clique nao e a pose): o quadro 100ms apos o fim da
      // investida tem de ja ser ela, e nenhuma animacao pode sobrar.
      const settled = log.frames.find((f) => f.t >= (log.end ?? 0) + 100);
      check(`${t}: 100ms apos o fim a peca esta na pose exata (translate/rotate, 0 WAAPI)`, Boolean(settled) && settled.translate === after.translate && settled.rotate === after.rotate && after.rotate === base.rotate && res.residual === 0, `100ms=${settled?.translate} final=${after.translate} residual=${res.residual}`);
      check(`${t}: estouro nasce a ~45% da investida (207ms ± 60 apos o inicio)`, Boolean(log.burst) && log.bursts === 1 && Math.abs(log.burst.t - (log.start ?? 0) - 207) <= 60, log.burst ? `${r1(log.burst.t - (log.start ?? 0))}ms apos o inicio` : "sem estouro");
      check(`${t}: estouro no ponto (centro x, 35% y) do defensor (<= 6px)`, Boolean(log.burst) && Math.hypot(log.burst.x - expected.x, log.burst.y - expected.y) <= 6, log.burst ? `delta=${r1(Math.hypot(log.burst.x - expected.x, log.burst.y - expected.y))}px` : "");
      check(`${t}: fx-dmg a <= 6px do ponto do golpe, depois do anel`, Boolean(dmg) && Math.hypot(dmg.x - expected.x, dmg.y - expected.y) <= 6 && dmg.t > (log.burst?.t ?? 1e9), dmg ? `delta=${r1(Math.hypot(dmg.x - expected.x, dmg.y - expected.y))}px, ${r1(dmg.t - (log.burst?.t ?? 0))}ms apos o anel` : "sem fx-dmg");
    } else {
      check(`${t}: nenhuma investida (0 WAAPI de translate na peca)`, log.anims === 0, `anims=${log.anims}`);
      check(`${t}: nenhum estouro`, log.bursts === 0, `bursts=${log.bursts}`);
      check(`${t}: pose intacta (rotate igual; sem WAAPI)`, after.rotate === base.rotate && res.residual === 0, `${base.rotate} -> ${after.rotate}`);
    }
    await context.close();
  }
  console.log(PROBLEMS.length ? `\nFALHAS: ${PROBLEMS.join("; ")}` : "\nOK: investida e impacto conferem (3d, reduce-motion e 2d)");
} finally {
  if (browser) await browser.close().catch(() => {});
  server.stop();
}
process.exit(PROBLEMS.length ? 1 : 0);
