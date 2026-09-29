// Probe do impacto (ANIM onda 3, plano §4): num browser real, força os cenários
// difíceis de sortear — forja de chave (glow no lado de quem forjou), correntes
// (elo caindo no contador), dano (número flutuante + marca de impacto) e morte
// (dissolve do clone) — patcheando o save da partida em andamento.
// Uso: node e2e/probes/fx-impact.mjs   (derruba o dev server ao sair)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5207;
const SEED = `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: true,
    hoverZoom: false, hints: false, language: "en", opponentMode: "mirror", gameMode: "solo",
    aiSpeed: "fast",
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
  dmg: document.querySelector(".fx-dmg")?.textContent ?? null,
  hit: document.querySelectorAll('[data-fx="hit"]').length,
  gone: document.querySelectorAll(".fx-gone").length,
  chain: document.querySelector(".fx-chain") ? "elo" : null,
  chainHit: document.querySelectorAll(".chain-counter.is-hit").length,
  forge: document.querySelector(".game-board.forge-flash") ? getComputedStyle(document.querySelector(".game-board")).getPropertyValue("--forge-y").trim() : null,
  shake: !!document.querySelector(".game-board.forge-flash .board-content"),
  banner: document.querySelector(".fx-banner")?.textContent ?? null,
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
  const shot = async (name) => page.screenshot({ path: `e2e/clips/frames/probe-${name}.png` });
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
  // Uma carta no turno 1 e encerra: o Warden joga, e a mesa fica com peças.
  const tiles = page.locator(".hand-track .card-tile");
  const pb = page.locator(".inspector-actions button.primary-action").first();
  for (let i = 0; i < (await tiles.count()); i += 1) {
    await tiles.nth(i).click();
    await page.waitForTimeout(180);
    if (await pb.isEnabled().catch(() => false)) { await pb.click(); break; }
  }
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector(".end-turn-button")?.click());
  await page.waitForFunction(() => !document.querySelector(".end-turn-button")?.disabled, null, { timeout: 90000 });
  await page.waitForTimeout(600);

  // ---- patch do save: mao com Coward's End (correntes + destruicao) e 6 ambar
  // (a forja do jogador acontece no fim do turno da IA).
  const patched = await page.evaluate(() => {
    const raw = localStorage.getItem("aember-arena-match");
    if (!raw) return "sem save";
    const saved = JSON.parse(raw);
    const game = saved.game;
    const human = game.players[0];
    if (!human.hand.length) return "mao vazia";
    const face = {
      ...human.hand[0].face,
      id: "probe-cowards-end",
      title: "Coward's End",
      type: "Action",
      house: game.activeHouse ?? human.houses[0],
      traits: "", 
      text: "Play: Destroy each undamaged creature. Gain 3 chains.",
      amber: 0,
      power: 0,
      armor: 0,
      image: "",
    };
    human.hand[0].face = face;
    human.amber = 9;
    // Garante uma criatura pronta do lado humano (alvo da luta): pega uma do
    // baralho/mao e, se preciso, forja a face como criatura.
    if (!human.board.some((card) => card.ready)) {
      const idx = human.hand.findIndex((card) => card.face.type === "Creature" && card.instanceId !== human.hand[0].instanceId);
      const [creature] = human.hand.splice(idx >= 0 ? idx : 1, 1);
      creature.face = { ...creature.face, type: "Creature", power: 5, armor: 0, amber: 0, text: "", house: face.house };
      creature.ready = true;
      creature.damage = 0;
      creature.stunned = false;
      human.board.push(creature);
    }
    // Dois alvos do lado inimigo: um parrudo (sobrevive a luta e mostra o "-N")
    // e um intacto e fraco (o Coward's End dissolve ele).
    const enemy = game.players[1];
    for (const card of enemy.board) card.face = { ...card.face, type: "Creature", power: 9, armor: 0 };
    const [victim] = enemy.hand.splice(0, 1);
    if (victim) {
      victim.face = { ...victim.face, type: "Creature", power: 2, armor: 0, text: "", house: victim.face.house };
      victim.damage = 0;
      victim.ready = false;
      enemy.board.push(victim);
    }
    localStorage.setItem("aember-arena-match", JSON.stringify(saved));
    return { house: face.house, round: game.turn, enemyBoard: game.players[1].board.length, amber: human.amber };
  });
  console.log("patch:", JSON.stringify(patched));

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".home-screen", { timeout: 20000 });
  const resume = page.locator(".resume-bar");
  check("save patcheado retomavel pela Home", (await resume.count()) > 0);
  await resume.first().click();
  await page.waitForSelector(".game-screen", { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector(".end-turn-button")?.disabled, null, { timeout: 60000 });
  await page.waitForTimeout(400);
  // A casa ativa precisa ser a da carta patcheada.
  await page.evaluate((house) => {
    const pills = [...document.querySelectorAll(".house-picker .house-choice:not([disabled])")];
    (pills.find((el) => el.textContent?.includes(house)) ?? pills[0])?.click();
  }, patched.house);
  await page.waitForTimeout(400);

  // ---- Luta: numero de dano + marca de impacto
  const creatureTiles = page.locator(".battle-zone--player .board-lane > .board-piece .card-tile");
  let fightSeen = { dmg: null, hit: 0, gone: 0 };
  let readyIndex = -1;
  const labels = [];
  for (let i = 0; i < (await creatureTiles.count()); i += 1) {
    const label = (await creatureTiles.nth(i).getAttribute("aria-label")) ?? "";
    labels.push(label);
    if (readyIndex < 0 && /READY$/i.test(label) && !/STUNNED/i.test(label)) readyIndex = i;
  }
  console.log("criaturas do lado humano:", JSON.stringify(labels));
  if (readyIndex >= 0) {
    const ready = creatureTiles.nth(readyIndex);
    await ready.click();
    await page.waitForTimeout(250);
    const fight = page.locator(".inspector-actions button.secondary-action").first();
    const label = (await fight.textContent().catch(() => "")) ?? "";
    if (/fight/i.test(label) && (await fight.isEnabled().catch(() => false))) {
      await fight.click();
      await page.waitForTimeout(300);
      await page.evaluate(() => document.querySelector(".board-piece .card-tile:not(.is-dimmed)")?.click());
      let shotFight = false;
      for (let i = 0; i < 20; i += 1) {
        const s = await page.evaluate(SAMPLE);
        fightSeen.dmg ??= s.dmg;
        fightSeen.hit += s.hit;
        fightSeen.gone += s.gone;
        if (s.dmg && !shotFight) { shotFight = true; await shot("damage"); }
        await page.waitForTimeout(60);
      }
      check("luta: numero de dano flutuante", !!fightSeen.dmg && /^-\d+$/.test(fightSeen.dmg), fightSeen.dmg);
      check("luta: marca de impacto no tile", fightSeen.hit > 0, `amostras: ${fightSeen.hit}`);
    } else {
      console.log(`SKIP luta: acao primaria era "${label.trim()}"`);
    }
  } else {
    console.log("SKIP luta: nenhuma criatura pronta do lado humano");
  }

  // ---- Coward's End: correntes + dissolve das pecas destruidas
  await tiles.nth(0).click();
  await page.waitForTimeout(250);
  await page.evaluate(() => document.querySelector(".inspector-actions button.primary-action")?.click());
  const seen = { dmg: null, hit: 0, gone: 0, chain: null, chainHit: 0 };
  let shotChain = false;
  let shotGone = false;
  for (let i = 0; i < 30; i += 1) {
    const s = await page.evaluate(SAMPLE);
    seen.dmg ??= s.dmg;
    seen.hit += s.hit;
    seen.gone += s.gone;
    seen.chain ??= s.chain;
    seen.chainHit += s.chainHit;
    if (s.chain && !shotChain) { shotChain = true; await shot("chain"); }
    if (s.gone && !shotGone) { shotGone = true; await shot("dissolve"); }
    await page.waitForTimeout(60);
  }
  check("correntes: elo caindo no contador", !!seen.chain && seen.chainHit > 0, JSON.stringify({ chain: seen.chain, chainHit: seen.chainHit }));
  check("morte: dissolve do clone no board", seen.gone > 0, `amostras com .fx-gone: ${seen.gone}`);

  // ---- Forja: o fim do turno da IA forja a chave do jogador (6 ambar)
  await page.evaluate(() => document.querySelector(".end-turn-button")?.click());
  let forgeSeen = null;
  let shakeSeen = false;
  let bannerAt = null;
  for (let i = 0; i < 200; i += 1) {
    const s = await page.evaluate(SAMPLE);
    if (s.forge) {
      if (!forgeSeen) await shot("forge");
      forgeSeen ??= s.forge;
      shakeSeen = shakeSeen || s.shake;
    }
    if (s.banner) bannerAt ??= i;
    if (bannerAt !== null && i > bannerAt + 18) break;
    await page.waitForTimeout(60);
  }
  const after = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("aember-arena-match") ?? "{}");
    return saved.game ? { keys: saved.game.players[0].keys, amber: saved.game.players[0].amber, turn: saved.game.turn } : null;
  });
  console.log("pos-turno:", JSON.stringify(after));
  check("forja: glow no lado que forjou (--forge-y = 88%)", forgeSeen === "88%", `--forge-y=${forgeSeen}`);
  check("forja: shake do board-content no impacto", shakeSeen);

  console.log(PROBLEMS.length ? `\nFALHAS: ${PROBLEMS.join("; ")}` : "\nOK: impacto da onda 3 confere");
  await browser.close();
} finally {
  server.stop();
}
process.exit(PROBLEMS.length ? 1 : 0);
