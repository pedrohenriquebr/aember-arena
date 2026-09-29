// Probe do FX sobre a mesa 3D (H3D-08, VIEW3D_PLAN §2.8). Mede, num browser
// real, o voo do leque ate o slot inclinado: tamanho no quadro 0 (sem "pulo"),
// caixa do ghost x caixa do destino no pouso, hold do Warden (420ms), o clone
// de quem sai e o cancelamento ao alternar o modo no meio do voo.
//
//   node e2e/probes/_3d-fx.mjs
//
// O board vem de um save fixo (createMatch com seed + mao de criatura
// controlada) para o voo ser sempre do mesmo caso. As animacoes do ghost sao
// PAUSADAS e posicionadas num instante exato, como no _fx-flight.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5219;
const SHOTS = join(ROOT, "e2e", "clips", "frames");

const SEED = `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: true,
    hoverZoom: false, hints: false, language: "en", tableView: "3d", opponentMode: "mirror", gameMode: "solo", aiSpeed: "normal",
  }));
  localStorage.setItem("aember-arena-language", "en");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
})()`;

// Mao controlada: o jogador tem 2 criaturas da casa da vez (a primeira e a
// jogada) e o Warden tem 1 criatura na mao para voar no turno dele.
const FIXTURE = `(async () => {
  const game = await import("/src/lib/game.ts");
  const demo = await import("/src/lib/demoDeck.ts");
  const deck = demo.DEMO_DECK;
  let state = game.createMatch(deck, deck, { seed: 909 });
  state = game.keepHand(state, 0);
  state = game.keepHand(state, 1);
  const house = state.players[0].houses[0];
  const mine = deck.cards.filter((c) => c.type === "Creature" && c.house === house).slice(0, 2);
  const theirs = deck.cards.filter((c) => c.type === "Creature");
  const mk = (face, i) => ({ instanceId: "fx-" + i + "-" + face.id, face, damage: 0, ready: true, stunned: false });
  state.players[0].hand = mine.map((face, i) => mk(face, i));
  state.players[0].board = [];
  state.players[1].hand = [mk(theirs[0], 90)];
  state.players[1].board = [];
  state.activePlayer = 0;
  state.activeHouse = house;
  localStorage.setItem("aember-arena-match", JSON.stringify({ game: state, deckId: demo.DEMO_DECK_ID, savedAt: 1 }));
  return { house, hand: state.players[0].hand.map((c) => c.instanceId) };
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

// Congela as animacoes do ghost no instante pedido e devolve as duas caixas.
const AT = (when) => {
  const ghost = document.querySelector(".fx-ghost");
  if (!ghost) return { error: "sem ghost" };
  const dest = document.querySelector("[data-fx=landing], [data-landed]");
  if (!dest) return { error: "sem destino" };
  const destArt = dest.querySelector(".card-art") ?? dest;
  for (const anim of ghost.getAnimations()) {
    anim.pause();
    const timing = anim.effect?.getTiming?.() ?? {};
    const delay = Number(timing.delay) || 0;
    const duration = Number(timing.duration) || 0;
    if (when === "landing") anim.currentTime = delay + duration;
    else anim.currentTime = 0;
  }
  const box = ghost.getBoundingClientRect();
  const slot = destArt.getBoundingClientRect();
  const host = document.querySelector(".fx-layer");
  const piece = destArt.closest(".board-piece");
  const slotTile = destArt.closest(".card-tile");
  return {
    ghost: { left: box.left, top: box.top, right: box.right, bottom: box.bottom, w: box.width, h: box.height },
    slot: { left: slot.left, top: slot.top, right: slot.right, bottom: slot.bottom, w: slot.width, h: slot.height },
    slotDebug: {
      destClass: String(dest.className),
      artLayout: `${destArt.offsetWidth}x${destArt.offsetHeight}`,
      tileRotate: slotTile ? getComputedStyle(slotTile).rotate : null,
      tileScale: slotTile ? getComputedStyle(slotTile).scale : null,
      tileTranslate: slotTile ? getComputedStyle(slotTile).translate : null,
      pieceRotate: piece ? getComputedStyle(piece).rotate : null,
      pieceTranslate: piece ? getComputedStyle(piece).translate : null,
      chain: (() => {
        const out = [];
        for (let node = destArt; node && node !== document.body && out.length < 7; node = node.parentElement) {
          const cs = getComputedStyle(node);
          out.push(`${node.tagName.toLowerCase()}.${String(node.className).split(" ").slice(0, 2).join(".")}:${cs.transform}|${cs.rotate}|${cs.translate}|${cs.scale}`);
        }
        return out;
      })(),
    },
    landLean: host ? host.style.getPropertyValue("--fx-land-lean") : null,
    host3d: host ? host.classList.contains("fx-layer--3d") : null,
    fromTransform: host ? host.style.getPropertyValue("--fx-from") : null,
    slotTransform: host ? host.style.getPropertyValue("--fx-slot") : null,
    rotate: getComputedStyle(ghost).rotate,
    hold: host ? host.style.getPropertyValue("--fx-hold") : null,
    destIid: dest.dataset.iid ?? null,
  };
};

const server = startServer();
let browser;
try {
  await server.ready();
  browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
  await context.addInitScript(SEED);
  const page = await context.newPage();
  await page.goto(server.url, { waitUntil: "domcontentloaded" });
  await page.evaluate(SEED);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".home-screen", { timeout: 30000 });
  const fixture = await page.evaluate(FIXTURE);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".home-screen", { timeout: 30000 });
  await page.locator(".resume-bar").first().click();
  await page.waitForSelector(".game-screen", { timeout: 20000 });
  await page.waitForTimeout(700);
  mkdirSync(SHOTS, { recursive: true });

  // ---- 1. Voo do LEQUE para o slot 3D (jogador).
  // A carta e selecionada (o inspetor exige) e o 3D a endireita; o probe forca
  // um `rotate` inline E clica Play no mesmo tick (um render do React entre os
  // dois apagaria o inline) para encenar a PONTA DO LEQUE — a pose que a origem
  // tem antes de ser tocada, que e o caso do §2.8.2.
  await page.locator(".hand-track .card-tile").last().click();
  await page.waitForTimeout(250);
  const source = await page.evaluate(async () => {
    const tile = [...document.querySelectorAll(".hand-track .card-tile")].pop();
    // O tile transiciona `rotate` em 150ms: esperar o valor assentar e o que
    // garante que a pose forçada e a lida pelo captureFx.
    tile.style.rotate = "-8deg";
    await new Promise((r) => setTimeout(r, 220));
    const art = tile.querySelector(".card-art");
    const cs = getComputedStyle(tile);
    const r = art.getBoundingClientRect();
    const out = {
      iid: tile.dataset.iid,
      w: art.offsetWidth * (parseFloat(cs.scale) || 1),
      rot: cs.rotate,
      center: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      box: { w: r.width, h: r.height },
    };
    document.querySelector(".inspector-actions button.primary-action").click();
    return out;
  });
  await page.waitForTimeout(60);
  const frame0 = await page.evaluate(AT, "start");
  if (frame0.error) check("voo 3D: ghost no quadro 0", false, JSON.stringify(frame0));
  else {
    // O ghost nasce com o tamanho da CARTA (scale do --fx-from) e a MESMA pose
    // girada da origem: a caixa projetada tem de casar com a da carta, nao com
    // o layout (era o "pulo" que o §2.8.2 evita).
    const scale = parseFloat((frame0.fromTransform.match(/scale\(([\d.]+)\)/) ?? [])[1] ?? "0");
    const implied = scale * 160;
    const jump = Math.abs(implied - source.w) / source.w;
    check("H3D-08: ghost nasce do tamanho da CARTA, nao da caixa girada (<= 4%)", jump <= 0.04, `ghost=${implied.toFixed(1)} carta=${source.w.toFixed(1)} (caixa girada=${source.box.w.toFixed(1)}) delta=${(jump * 100).toFixed(1)}%`);
    const boxJump = Math.abs(frame0.ghost.w - source.box.w) / source.box.w;
    check("H3D-08: caixa do ghost no quadro 0 = caixa da carta de origem (<= 2%)", boxJump <= 0.02, `ghost=${frame0.ghost.w.toFixed(1)} carta=${source.box.w.toFixed(1)} delta=${(boxJump * 100).toFixed(1)}%`);
    const center = Math.abs(frame0.ghost.left + frame0.ghost.w / 2 - source.center.x) + Math.abs(frame0.ghost.top + frame0.ghost.h / 2 - source.center.y);
    check("H3D-08: ghost nasce no centro da carta de origem (<= 2px)", center <= 2, `delta=${center.toFixed(1)}px`);
    check("H3D-08: quadro 0 com a rotacao da origem (ponta do leque)", /rotate\(-?[\d.]+deg\)/.test(frame0.fromTransform) && !/rotate\(0deg\)/.test(frame0.fromTransform), `--fx-from=${frame0.fromTransform}`);
    check("H3D-08: host em 3D com o lean do slot no ghost", Boolean(frame0.host3d) && frame0.landLean === "12deg", JSON.stringify({ host3d: frame0.host3d, lean: frame0.landLean }));
    await page.screenshot({ path: join(SHOTS, "probe-3d-fx-present.png") });
  }
  const landing = await page.evaluate(AT, "landing");
  if (landing.error) check("voo 3D: quadro de pouso", false, JSON.stringify(landing));
  else {
    const d = {
      left: Math.abs(landing.ghost.left - landing.slot.left),
      top: Math.abs(landing.ghost.top - landing.slot.top),
      right: Math.abs(landing.ghost.right - landing.slot.right),
      bottom: Math.abs(landing.ghost.bottom - landing.slot.bottom),
    };
    const worst = Math.max(...Object.values(d));
    console.log(`INFO pouso: ghost=${JSON.stringify(landing.ghost)} slot=${JSON.stringify(landing.slot)} slotDebug=${JSON.stringify(landing.slotDebug)} rotate=${landing.rotate} slotTransform=${landing.slotTransform}`);
    check("H3D-08: no pouso o ghost casa com a .card-art do slot (<= 3px por lado)", worst <= 3, `deltas=${JSON.stringify(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Math.round(v * 10) / 10])))}`);
    await page.screenshot({ path: join(SHOTS, "probe-3d-fx-landing.png") });
  }
  await page.waitForTimeout(900);

  // ---- 2. Hold do Warden (420ms) e voo dele ate o slot do fundo.
  await page.locator(".end-turn-button").click();
  const aiGhost = await page.waitForFunction(() => Boolean(document.querySelector(".fx-ghost")), null, { timeout: 30000 }).then(() => true).catch(() => false);
  let aiHold = null;
  let aiFrames = null;
  if (aiGhost) {
    aiHold = await page.evaluate(() => document.querySelector(".fx-layer")?.style.getPropertyValue("--fx-hold") ?? null);
    const aiLanding = await page.evaluate(AT, "landing");
    if (!aiLanding.error) {
      aiFrames = {
        ghost: { top: aiLanding.ghost.top, bottom: aiLanding.ghost.bottom, left: aiLanding.ghost.left, right: aiLanding.ghost.right },
        slot: { top: aiLanding.slot.top, bottom: aiLanding.slot.bottom, left: aiLanding.slot.left, right: aiLanding.slot.right },
        lean: aiLanding.landLean,
      };
      const worst = Math.max(
        Math.abs(aiFrames.ghost.left - aiFrames.slot.left),
        Math.abs(aiFrames.ghost.top - aiFrames.slot.top),
        Math.abs(aiFrames.ghost.right - aiFrames.slot.right),
        Math.abs(aiFrames.ghost.bottom - aiFrames.slot.bottom),
      );
      check("H3D-08: voo do Warden pousa no slot do fundo (<= 3px por lado)", worst <= 3, `pior=${(Math.round(worst * 10) / 10)}px lean=${aiLanding.landLean}`);
      await page.screenshot({ path: join(SHOTS, "probe-3d-fx-ai-landing.png") });
    } else check("H3D-08: voo do Warden pousa no slot do fundo", false, JSON.stringify(aiLanding));
  } else check("H3D-08: voo do Warden (ghost avistado)", false, "nenhum ghost no turno da IA");
  check("H3D-08: hold do Warden inalterado (420ms)", aiHold === "420ms", `hold=${aiHold}`);
  await page.waitForFunction(() => !document.querySelector(".end-turn-button")?.disabled, null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(600);

  // ---- 3. Alternar o modo durante um voo nao deixa ghost orfao nem data-fx.
  const during = await page.evaluate(async () => {
    // Turno novo: a casa precisa ser escolhida antes de qualquer jogada.
    const house = document.querySelector(".house-picker .house-choice:not([disabled])");
    house?.click();
    await new Promise((r) => setTimeout(r, 250));
    const tiles = [...document.querySelectorAll(".hand-track .card-tile")];
    if (!tiles.length) return { error: "sem carta na mao" };
    tiles[0].click();
    await new Promise((r) => setTimeout(r, 150));
    const play = document.querySelector(".inspector-actions button.primary-action");
    if (!play || play.disabled) return { error: "sem jogada", house: Boolean(house), hand: tiles.length };
    play.click();
    await new Promise((r) => setTimeout(r, 120));
    return { flying: Boolean(document.querySelector(".fx-ghost")) };
  });
  if (during.error) check("H3D-08: toggle do modo no meio do voo", false, JSON.stringify(during));
  else {
    await page.locator(".view-toggle").click();
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => ({
      ghosts: document.querySelectorAll(".fx-ghost, .fx-gone").length,
      marks: document.querySelectorAll("[data-fx]").length,
      view: document.querySelector(".game-board")?.getAttribute("data-view") ?? null,
    }));
    check("H3D-08: alternar o modo no voo cancela sem orfaos", during.flying && after.ghosts === 0 && after.marks === 0, JSON.stringify({ flying: during.flying, ...after }));
  }

  console.log(PROBLEMS.length ? `\nFALHAS: ${PROBLEMS.join("; ")}` : "\nOK: FX no 3D confere (quadro 0, pouso, hold do Warden e cancelamento)");
} finally {
  if (browser) await browser.close().catch(() => {});
  server.stop();
}
process.exit(PROBLEMS.length ? 1 : 0);
