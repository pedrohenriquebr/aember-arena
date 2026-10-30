// QA-08 ("a weapon não anexa"): joga cada upgrade dos decks do dono pela UI real — clique na
// mão, "Jogar" no inspetor, clique no hospedeiro — nas visões 2d/tcg/3d, e confere: o prompt
// aparece com o texto do DESTINO (criatura ou artefato), o hospedeiro inimigo é clicável e a
// carta passa a ser desenhada presa a ele (lane do hospedeiro, .board-piece--upgrade).
// Uso: node e2e/probes/_upgrade-attach.mjs [--shots DIR]   (sai != 0 se algum check falhar)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5237;
const SHOTS = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
const DECKS = JSON.parse(readFileSync(join(ROOT, "scripts", "harvest", "cards-dois-decks.json"), "utf8"));
const UPGRADES = ["Blood of Titans", "Cybergiant Rig", "Essence Entangler", "Under Pressure", "Proton Siphon", "Animating Force"];
const VIEWS = ["2d", "tcg", "3d"];
const VIEWPORTS = [{ w: 1440, h: 900 }, { w: 390, h: 844 }];

const SEED = (view) => `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: false,
    hoverZoom: false, hints: false, language: "en", tableView: "${view}", opponentMode: "mirror", gameMode: "solo", aiDelayMs: 400,
  }));
  localStorage.setItem("aember-arena-language", "en");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
})()`;

// Mão = só a upgrade; 2 criaturas e 1 artefato por lado (dois artefatos: a Animating Force tem ESCOLHA,
// senão o QA-05 auto-resolve e o prompt nem aparece).
const FIXTURE = (face) => `(async () => {
  const game = await import("/src/lib/game.ts");
  const demo = await import("/src/lib/demoDeck.ts");
  const deck = demo.DEMO_DECK;
  let state = game.createMatch(deck, deck, { seed: 424242 });
  state = game.keepHand(state, 0);
  state = game.keepHand(state, 1);
  const creatures = deck.cards.filter((c) => c.type === "Creature");
  const artifact = deck.cards.find((c) => c.type === "Artifact") ?? { ...creatures[0], id: "probe-relic", title: "Relic", type: "Artifact", power: 0 };
  const mk = (id, face) => ({ instanceId: id, face, damage: 0, ready: true, stunned: false });
  const up = ${JSON.stringify(face)};
  state.players[0].hand = [mk("up-probe", up)];
  state.players[0].board = [mk("mine-0", creatures[0]), mk("mine-1", creatures[1]), mk("relic-0", artifact)];
  state.players[1].board = [mk("theirs-0", creatures[2]), mk("theirs-1", creatures[3]), mk("relic-1", artifact)];
  state.activePlayer = 0;
  state.activeHouse = up.house;
  localStorage.setItem("aember-arena-match", JSON.stringify({ game: state, deckId: demo.DEMO_DECK_ID, savedAt: 1 }));
  return true;
})()`;

const failures = [];
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

async function run(browser, url, title, view, vp, mode) {
  const face = DECKS.find((card) => card.title === title);
  const label = `${title} · ${view} · ${vp.w}x${vp.h} · ${mode}`;
  const af = title === "Animating Force";
  const hostId = af ? "relic-1" : "theirs-1";
  const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, reducedMotion: "reduce" });
  await context.addInitScript(SEED(view));
  const page = await context.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.evaluate(FIXTURE(face));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
  await page.locator('[data-action="continue"]').first().click();
  await page.waitForSelector(".game-screen", { timeout: 20000 });
  await page.waitForTimeout(400);

  if (mode === "drag") {
    // O gesto do dono: arrastar a carta da mão e soltar EM CIMA do hospedeiro (inimigo).
    const from = await page.locator('.hand-track .card-tile[data-iid="up-probe"]').boundingBox();
    const to = await page.locator(`.board-piece .card-tile[data-iid="${hostId}"]`).first().boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) {
      await page.mouse.move(from.x + from.width / 2 + ((to.x + to.width / 2) - (from.x + from.width / 2)) * (i / 12), from.y + from.height / 2 + ((to.y + to.height / 2) - (from.y + from.height / 2)) * (i / 12));
      await page.waitForTimeout(16);
    }
    const marked = await page.evaluate((id) => document.querySelector(`.board-piece .card-tile[data-iid="${id}"]`)?.dataset.dropHost ?? null, hostId);
    check(`${label}: o hospedeiro sob o ponteiro fica marcado como destino`, marked === "over", `data-drop-host=${marked}`);
    await page.mouse.up();
    await page.waitForTimeout(500);
    return verify(page, context, label, title, view, vp, mode, af);
  }

  await page.locator('.hand-track .card-tile').first().click();
  await page.waitForTimeout(200);
  const play = page.locator(".inspector-actions button.primary-action").first();
  const canPlay = (await play.count()) > 0 && (await play.isEnabled().catch(() => false));
  check(`${label}: "Jogar" habilitado no inspetor`, canPlay);
  if (!canPlay) return context.close();
  await play.click();
  await page.waitForTimeout(250);

  const banner = (await page.locator(".fight-instruction").textContent().catch(() => "")) ?? "";
  check(`${label}: o prompt nomeia o destino (${af ? "artifact" : "creature"})`, new RegExp(af ? "artifact" : "creature", "i").test(banner), JSON.stringify(banner.trim()));
  const targetable = await page.evaluate(() => [...document.querySelectorAll(".board-piece .card-tile.is-targetable")].map((el) => el.getAttribute("data-iid")));
  const expected = af ? ["relic-0", "relic-1"] : ["mine-0", "mine-1", "theirs-0", "theirs-1"];
  check(`${label}: alvos marcados = ${expected.join(",")}`, expected.every((id) => targetable.includes(id)) && targetable.length === expected.length, JSON.stringify(targetable));

  const host = page.locator(`.board-piece .card-tile[data-iid="${hostId}"]`).first();
  let clicked = true;
  try {
    await host.click({ timeout: 3000 });
  } catch (error) {
    clicked = false;
    check(`${label}: clique no hospedeiro ${hostId} chega nele`, false, error.message.split("\n")[0]);
  }
  if (clicked) check(`${label}: clique no hospedeiro ${hostId} chega nele`, true);
  await page.waitForTimeout(500);
  return verify(page, context, label, title, view, vp, mode, af);
}

async function verify(page, context, label, title, view, vp, mode, af) {
  const where = await page.evaluate(() => {
    const tile = document.querySelector('.board-piece [data-iid="up-probe"]');
    const piece = tile?.closest(".board-piece");
    const zone = tile?.closest(".battle-zone");
    return {
      onBoard: Boolean(tile),
      inHand: Boolean(document.querySelector('.hand-track [data-iid="up-probe"]')),
      upgradePiece: Boolean(piece?.classList.contains("board-piece--upgrade")),
      zone: zone?.classList.contains("battle-zone--player") ? "player" : zone?.classList.contains("battle-zone--opponent") ? "enemy" : zone ? zone.className : null,
      pick: Boolean(document.querySelector(".fight-instruction")),
    };
  });
  // Animating Force: o artefato do Warden vira MINHA criatura e a upgrade vai junto (lane do jogador).
  const zone = af ? "player" : "enemy";
  check(`${label}: a carta saiu da mão e anexou (.board-piece--upgrade na lane ${zone})`, where.onBoard && !where.inHand && where.upgradePiece && where.zone === zone && !where.pick, JSON.stringify(where));
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${title.replace(/\s+/g, "-").toLowerCase()}-${view}-${vp.w}x${vp.h}-${mode}.png`) });
  }
  await context.close();
}

const server = startServer();
let browser;
try {
  await server.ready();
  browser = await launch();
  for (const title of UPGRADES) for (const view of VIEWS) for (const vp of VIEWPORTS) for (const mode of (process.env.PROBE_MODE ? [process.env.PROBE_MODE] : ["click", "drag"])) await run(browser, server.url, title, view, vp, mode);
} finally {
  await browser?.close();
  server.stop();
}
console.log(failures.length ? `\n${failures.length} FALHA(S)` : "\nupgrade-attach: tudo OK");
process.exit(failures.length ? 1 : 0);
