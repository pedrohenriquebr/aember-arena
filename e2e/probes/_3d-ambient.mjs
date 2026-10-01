// Probe da mesa-ambiente e da entrada do inspetor (H3D-21, docs/VIEW3D_ARENA_LAYOUT.md §3.8).
//   - o background-image do `.table-plane::before` carrega a cor da casa do turno (muda com a casa),
//     tem a gravura (repeating-radial) e nenhum filter/backdrop-filter;
//   - o inspetor >= 1041 entra em 200ms (translate+opacity, fill backwards, sem residuo);
//   - reduce-motion: entrada em 1 quadro (duracao <= 0,01ms).
// Uso: node e2e/probes/_3d-ambient.mjs
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5222;

const SEED = `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: true,
    hoverZoom: false, hints: false, language: "en", tableView: "3d", opponentMode: "mirror", gameMode: "solo", aiSpeed: "normal",
  }));
  localStorage.setItem("aember-arena-language", "en");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
})()`;

const FIXTURE = (houseIndex) => `(async () => {
  const game = await import("/src/lib/game.ts");
  const demo = await import("/src/lib/demoDeck.ts");
  const hc = await import("/src/lib/houses.ts");
  const deck = demo.DEMO_DECK;
  let state = game.createMatch(deck, deck, { seed: 31337 });
  state = game.keepHand(state, 0);
  state = game.keepHand(state, 1);
  const house = state.players[0].houses[${houseIndex}];
  const face = deck.cards.find((c) => c.type === "Creature");
  state.players[0].board = [{ instanceId: "am-a", face, damage: 0, ready: true, stunned: false }];
  state.activePlayer = 0;
  state.activeHouse = house;
  localStorage.setItem("aember-arena-match", JSON.stringify({ game: state, deckId: demo.DEMO_DECK_ID, savedAt: 1 }));
  return { house, color: hc.houseColor(house) };
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

async function open(browser, server, houseIndex, motion) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: motion });
  await context.addInitScript(SEED);
  const page = await context.newPage();
  await page.goto(server.url, { waitUntil: "domcontentloaded" });
  await page.evaluate(SEED);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".home-screen", { timeout: 30000 });
  const info = await page.evaluate(FIXTURE(houseIndex));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".home-screen", { timeout: 30000 });
  await page.locator(".resume-bar").first().click();
  await page.waitForSelector(".game-screen", { timeout: 20000 });
  await page.waitForTimeout(500);
  return { context, page, info };
}

const PLAY = () => {
  const cs = getComputedStyle(document.querySelector(".table-plane"), "::before");
  return { image: cs.backgroundImage, filter: cs.filter, backdrop: cs.backdropFilter };
};

const server = startServer();
let browser;
try {
  await server.ready();
  browser = await launch();
  const seen = [];
  for (const idx of [0, 1]) {
    const { context, page, info } = await open(browser, server, idx, "no-preference");
    const m = await page.evaluate(PLAY);
    seen.push({ info, m });
    // color-mix(srgb) a 10% sai como color(srgb r g b / 0.1) no computado.
    const has = m.image.includes("color(srgb") && m.image.includes("/ 0.1)");
    check(`casa ${info.house}: camada do terreno com a cor da casa a 10%`, has, m.image.match(/color\(srgb[^)]*\)/)?.[0] ?? m.image.slice(0, 80));
    check(`casa ${info.house}: gravura (repeating-radial) presente e 5 camadas`, m.image.includes("repeating-radial-gradient") && (m.image.match(/(?:^|, )(?:repeating-)?(?:radial|linear)-gradient/g) ?? []).length >= 5, "");
    check(`casa ${info.house}: 0 filter/backdrop-filter no tapete`, m.filter === "none" && (m.backdrop === "none" || m.backdrop === ""), `${m.filter}/${m.backdrop}`);

    // Inspetor: seleciona a criatura e le a animacao de entrada.
    await page.locator('[data-iid="am-a"]').click();
    const anim = await page.evaluate(async () => {
      const el = document.querySelector(".selected-card-content");
      if (!el) return null;
      const cs = getComputedStyle(el);
      const first = { name: cs.animationName, dur: cs.animationDuration, fill: cs.animationFillMode };
      await new Promise((r) => setTimeout(r, 400));
      const after = getComputedStyle(el);
      return { ...first, translate: after.translate, transform: after.transform, opacity: after.opacity, running: el.getAnimations().length };
    });
    if (idx === 0) {
      check("inspetor: entrada de 200ms com fill backwards", anim?.name === "inspector-in" && anim.dur === "0.2s" && anim.fill === "backwards", JSON.stringify(anim));
      check("inspetor: sem transform/translate residual depois da entrada", anim?.transform === "none" && anim.translate === "none" && anim.opacity === "1" && anim.running === 0, JSON.stringify(anim));
    }
    await context.close();
  }
  check("a imagem do tapete muda com a casa do turno", seen[0].m.image !== seen[1].m.image && seen[0].info.house !== seen[1].info.house, `${seen[0].info.house} x ${seen[1].info.house}`);

  const { context, page } = await open(browser, server, 0, "reduce");
  await page.locator('[data-iid="am-a"]').click();
  const reduced = await page.evaluate(() => {
    const el = document.querySelector(".selected-card-content");
    return el ? parseFloat(getComputedStyle(el).animationDuration) * 1000 : null;
  });
  check("reduce-motion: entrada do inspetor em 1 quadro (<= 0,01ms)", reduced !== null && reduced <= 0.011, `${reduced}ms`);
  await context.close();

  console.log(PROBLEMS.length ? `\nFALHAS: ${PROBLEMS.join("; ")}` : "\nOK: mesa-ambiente e entrada do inspetor conferem");
} finally {
  if (browser) await browser.close().catch(() => {});
  server.stop();
}
process.exit(PROBLEMS.length ? 1 : 0);
