// Gravador de sessao em video para revisao de UX (artefato de analise, nao gate).
//
//   node e2e/record-session.mjs [--port N] [--base-url URL] [--animations] [--view 3d]
//
// Sobe o vite dev server sozinho (porta alta propria, derrubado ao sair) e abre
// UM contexto Playwright com recordVideo a 1280x800. Percorre o fluxo real de
// usuario: Home (scroll suave ate o fim e volta) -> wizard de Config -> partida
// demo (mulligan, escolha de casa, jogadas do turno humano) -> turno completo
// da IA -> turno 2 humano (colhe + jogadas) -> scroll do board/rail + log
// completo com filtro -> Home -> Vault com scroll. Pausas de 600-1200ms entre
// as acoes deixam o video "respirar".
//
// H3D-11: --view 3d (default 2d) semeia `tableView: "3d"` e o video/frames saem
// da mesa inclinada — a prova visual do modo (com --animations os voos do
// FxLayer aparecem sobre o plano em 3D). Os frames mantem os MESMOS nomes.
//
// Nota de roteiro: o motor implementa a regra de abertura do KeyForge (turno 1
// do primeiro jogador permite UMA carta, src/lib/game.ts:670-672), entao as
// 3-4 acoes humanas do plano sao distribuidas entre o turno 1 (1 carta) e o
// turno 2 (colhe + ate 3 cartas).
//
// Saidas (fora do git, ver .gitignore):
//   e2e/clips/session-1280x800.webm  - clipe final (finalizado no close do contexto)
//   e2e/clips/frames/NN-descricao.png - frames-chave de cada acao principal
//
// Reusa os padroes do e2e/capture.mjs: spawn do vite com --strictPort, navegador
// do sistema via playwright-core (sem download) e seed de localStorage
// (animations/sfx/music off, idioma "en") para manter o video estavel.

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VITE_BIN = join(ROOT, "node_modules", "vite", "bin", "vite.js");
const CLIPS_DIR = join(ROOT, "e2e", "clips");
const TMP_VIDEO_DIR = join(CLIPS_DIR, ".tmp-video");
// H3D-11: o modo 3D grava em pasta propria (frames-3d / session-1280x800-3d)
// para o clipe da mesa inclinada nao sobrescrever o do 2D.
let VIEW = "2d";
let FRAMES_DIR = join(CLIPS_DIR, "frames");
let VIDEO_NAME = "session-1280x800.webm";
const MIN_VIDEO_BYTES = 200 * 1024;
const MIN_FRAMES = 8;

const DEFAULT_PORT = 5199;
const VIEWPORT = { width: 1280, height: 800 };

// Ordem fixa dos controles de navegacao no DOM (src/App.tsx:2507-2522):
//   .header-nav .nav-link = home, browse, config, [game]
const NAV_INDEX = { home: 0, browse: 1, config: 2, game: 3 };

function parseArgs(argv) {
  const args = { port: DEFAULT_PORT, baseUrl: null, animations: false, view: "2d" };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--port") args.port = Number(argv[(i += 1)]);
    else if (a === "--base-url") args.baseUrl = argv[(i += 1)];
    else if (a === "--animations") args.animations = true;
    else if (a === "--view") args.view = argv[(i += 1)];
    else {
      console.error(`record: argumento desconhecido "${a}"`);
      process.exit(2);
    }
  }
  if (args.view !== "2d" && args.view !== "3d") {
    console.error(`record: --view aceita "2d" ou "3d" (recebi "${args.view}")`);
    process.exit(2);
  }
  return args;
}

// ---------- vite dev server ----------

function startDevServer(port) {
  // --host 127.0.0.1: o default "localhost" do vite pode bindar so IPv6 (::1),
  // enquanto o browser usa IPv4.
  const child = spawn(process.execPath, [VITE_BIN, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let tail = "";
  const append = (chunk) => {
    tail += chunk.toString();
    if (tail.length > 8000) tail = tail.slice(-4000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);

  const stop = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === "win32") {
      try {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        // Server morre junto com o processo pai de qualquer forma.
      }
    } else {
      try {
        child.kill("SIGTERM");
      } catch {
        // Idem.
      }
    }
  };
  process.on("exit", stop);
  process.on("SIGINT", () => {
    stop();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    stop();
    process.exit(143);
  });

  return {
    url: `http://127.0.0.1:${port}/`,
    stop,
    async waitReady(timeoutMs = 60000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) {
          throw new Error(`vite dev server saiu (code ${child.exitCode}):\n${tail}`);
        }
        try {
          const res = await fetch(this.url);
          if (res.ok) return;
        } catch {
          // Ainda subindo.
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error(`vite dev server nao respondeu em ${timeoutMs}ms:\n${tail}`);
    },
  };
}

// ---------- navegador do sistema (sem download) ----------

const SYSTEM_BROWSER_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

async function launchBrowser() {
  const { chromium } = await import("playwright-core");
  const attempts = [
    { channel: "msedge" },
    { channel: "chrome" },
    ...SYSTEM_BROWSER_CANDIDATES.filter((p) => existsSync(p)).map((executablePath) => ({ executablePath })),
  ];
  const errors = [];
  for (const opts of attempts) {
    try {
      return await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
        ...opts,
      });
    } catch (err) {
      errors.push(`${JSON.stringify(opts)}: ${String(err.message).split("\n")[0]}`);
    }
  }
  throw new Error(`Nenhum Edge/Chrome do sistema disponivel para playwright-core. Tentativas:\n- ${errors.join("\n- ")}`);
}

// ---------- helpers de navegacao ----------

// Seed identico ao capture.mjs (src/lib/settings.ts): idioma "en" e efeitos
// desligados. Aplicado DEPOIS do primeiro goto + reload porque init scripts
// podem rodar antes da origem existir e o localStorage falha silenciosamente.
// --animations liga o motion (animações on, reduced-motion off) para o clipe
// provar o voo de carta das ondas de animação; --view 3d liga a mesa inclinada.
let MOTION = false;
const seedBody = () => `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2,
    sfx: false, music: false, animations: ${MOTION}, hoverZoom: true, language: "en", tableView: "${VIEW}",
  }));
  localStorage.setItem("aember-arena-language", "en");
})()`;

// Pausa de "respiro" entre acoes humanas para o video nao virar um corte seco.
async function breathe(page) {
  await page.waitForTimeout(600 + Math.floor(Math.random() * 601));
}

async function settle(page, ms = 500) {
  await page
    .evaluate(() => (document.fonts ? document.fonts.ready.then(() => null) : null))
    .catch(() => {});
  await page.waitForTimeout(ms);
}

function createFrameSaver(page) {
  rmSync(FRAMES_DIR, { recursive: true, force: true });
  mkdirSync(FRAMES_DIR, { recursive: true });
  const saved = [];
  let seq = 0;
  return {
    saved,
    async shot(label) {
      seq += 1;
      const name = `${String(seq).padStart(2, "0")}-${label}.png`;
      await page.screenshot({ path: join(FRAMES_DIR, name) });
      saved.push(name);
      console.log(`[record] frame ${name}`);
    },
  };
}

async function navTo(page, key) {
  const header = page.locator(".header-nav .nav-link");
  const count = await header.count();
  if (count > NAV_INDEX[key]) {
    const loc = header.nth(NAV_INDEX[key]);
    if (await loc.isVisible().catch(() => false)) {
      await loc.click();
      return;
    }
  }
  await page.locator(".mobile-tabs .mobile-tab").nth(NAV_INDEX[key]).click();
}

async function openHome(page, base) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.evaluate(seedBody());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".home-screen", { timeout: 30000 });
  await settle(page);
}

// ---------- scroll (mouse wheel) ----------

function atWindowEdge(dir) {
  const el = document.scrollingElement || document.documentElement;
  return dir > 0 ? el.scrollTop + el.clientHeight >= el.scrollHeight - 4 : el.scrollTop <= 4;
}

// Rola a janela em passos de wheel ate o fim (ou topo), com pausas curtas para
// o scroll entrar no video.
async function wheelPageToEdge(page, { x, y, direction, maxSteps = 24, stepPx = 200, stepMs = 70 }) {
  await page.mouse.move(x, y);
  for (let i = 0; i < maxSteps; i += 1) {
    await page.mouse.wheel(0, direction * stepPx);
    await page.waitForTimeout(stepMs);
    if (await page.evaluate(atWindowEdge, direction)) return true;
  }
  return false;
}

// Rola um container com scroll proprio (ex.: .command-rail no desktop >1040px).
async function wheelElementToEdge(page, selector, direction, { maxSteps = 20, stepPx = 160, stepMs = 70 } = {}) {
  const box = await page.locator(selector).first().boundingBox().catch(() => null);
  if (!box) return false;
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, box.height - 20));
  for (let i = 0; i < maxSteps; i += 1) {
    await page.mouse.wheel(0, direction * stepPx);
    await page.waitForTimeout(stepMs);
    const atEdge = await page.evaluate(
      ([sel, dir]) => {
        const el = document.querySelector(sel);
        if (!el) return true;
        if (el.scrollHeight <= el.clientHeight) return true;
        return dir > 0 ? el.scrollTop + el.clientHeight >= el.scrollHeight - 4 : el.scrollTop <= 4;
      },
      [selector, direction],
    );
    if (atEdge) return true;
  }
  return false;
}

// ---------- interacoes de partida ----------

async function waitForHumanTurn(page, timeout = 90000) {
  await page.waitForFunction(
    () => {
      const b = document.querySelector(".end-turn-button");
      return !!b && !b.disabled;
    },
    null,
    { timeout },
  );
}

// Escolhe a casa pedida (por rotulo) ou a primeira disponivel, como um usuario.
async function chooseHouse(page, houseLabel) {
  const picker = page.locator(".house-picker .house-choice:not([disabled])");
  const target = houseLabel ? picker.filter({ hasText: houseLabel }).first() : picker.first();
  await target.waitFor({ state: "visible", timeout: 20000 });
  await target.click();
  await page.waitForSelector(".house-choice.is-chosen", { timeout: 8000 }).catch(() => {});
}

// A aria-label de cada carta da mao e "Titulo, Casa Tipo" (src/App.tsx:257):
// e o que um usuario le para decidir a casa sem clicar carta a carta.
const HOUSES = ["Brobnar", "Dis", "Logos", "Mars", "Sanctum", "Shadows", "Untamed"];

async function readHandLabels(page) {
  return page.locator(".hand-track .card-tile").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") || ""));
}

function houseFromLabel(label) {
  return HOUSES.find((house) => label.includes(`, ${house} `)) ?? null;
}

// Casa jogavel com mais cartas na mao; com preferCreature, prioriza uma casa
// que tenha criatura (o turno 1 joga criatura para haver colheita no turno 2).
async function pickHouse(page, preferCreature) {
  const labels = await readHandLabels(page);
  const byHouse = new Map();
  for (const label of labels) {
    const house = houseFromLabel(label);
    if (!house) continue;
    const entry = byHouse.get(house) ?? { house, cards: 0, creatures: 0 };
    entry.cards += 1;
    if (/Creature/.test(label)) entry.creatures += 1;
    byHouse.set(house, entry);
  }
  const entries = [...byHouse.values()];
  if (!entries.length) return null;
  const score = (entry) => (preferCreature ? entry.creatures * 100 + entry.cards : entry.cards);
  entries.sort((a, b) => score(b) - score(a));
  return entries[0].house;
}

// Criatura pronta do lado humano: aria-label do CardTile termina em ", READY"
// (src/App.tsx:271 + src/lib/i18n.ts:137). A casa sai do mesmo aria-label.
async function findReadyCreature(page) {
  const tiles = page.locator(".battle-zone--player .board-piece .card-tile");
  const count = await tiles.count();
  for (let i = 0; i < count; i += 1) {
    const label = (await tiles.nth(i).getAttribute("aria-label").catch(() => "")) ?? "";
    if (!/,\s*READY$/i.test(label)) continue;
    const house = (label.split(",")[1] ?? "").trim().split(/\s+/)[0] ?? "";
    return { index: i, house, label };
  }
  return null;
}

// Um move com escolha de alvo abre o pick em vez de aplicar (src/App.tsx:2218).
// Como um usuario, clica num alvo valido: durante o pick os tiles fora de
// pick.ids ficam esmaecidos (BoardLane dimmed), entao "nao esmaecido" = valido.
async function resolveTargetPick(page, frames) {
  let shotTaken = false;
  for (let round = 0; round < 3; round += 1) {
    if (!(await page.locator(".fight-instruction").count())) break;
    if (!shotTaken) {
      await frames.shot("target-prompt");
      shotTaken = true;
    }
    const targets = page.locator(".board-piece .card-tile:not(.is-dimmed)");
    if (!(await targets.count())) break;
    await targets.first().click().catch(() => {});
    await page.waitForTimeout(500);
  }
  return (await page.locator(".fight-instruction").count()) === 0;
}

// Clica em Play e confirma pelo tamanho da mao (um move aplicado remove a carta
// da mao). Se um pick de alvo abrir, resolve clicando no alvo.
async function playSelectedHandCard(page, frames, shotLabel) {
  const playBtn = page.locator(".inspector-actions button.primary-action").first();
  if (!(await playBtn.isEnabled().catch(() => false))) return false;
  await frames.shot(shotLabel);
  const handBefore = await page.locator(".hand-track .card-tile").count();
  await playBtn.click().catch(() => {});
  // Com --animations o voo dura ~690ms: o frame do meio do hold (~330ms) é a
  // prova visual de que a carta sai da mão e se apresenta no centro.
  if (MOTION) {
    await page.waitForTimeout(330);
    await frames.shot("play-flight");
    await page.waitForTimeout(220);
  } else {
    await page.waitForTimeout(550);
  }
  if ((await page.locator(".hand-track .card-tile").count()) < handBefore) return true;
  if (await page.locator(".fight-instruction").count()) {
    const resolved = await resolveTargetPick(page, frames);
    if (resolved && (await page.locator(".hand-track .card-tile").count()) < handBefore) return true;
    const cancel = page.locator(".inspector-actions button.secondary-action", { hasText: /cancel/i }).first();
    if (await cancel.count()) await cancel.click().catch(() => {});
    await page.waitForTimeout(250);
  }
  return false;
}

async function selectedCardIsCreature(page) {
  const type = (await page.locator(".selected-card-heading .card-type-label").textContent().catch(() => "")) ?? "";
  return /creature/i.test(type);
}

// Turno 1: a regra de abertura permite UMA carta (game.ts:670-672). Prefere uma
// criatura, para haver uma peca pronta para colher no turno 2.
async function playOpeningCard(page, frames) {
  const tiles = page.locator(".hand-track .card-tile:not(.is-dimmed)");
  const count = await tiles.count();
  let fallbackIndex = -1;
  for (let i = 0; i < count; i += 1) {
    const tile = tiles.nth(i);
    if (!(await tile.isVisible().catch(() => false))) continue;
    await tile.click().catch(() => {});
    await breathe(page);
    if (!(await page.locator(".inspector-actions button.primary-action").first().isEnabled().catch(() => false))) continue;
    if (await selectedCardIsCreature(page)) {
      const ok = await playSelectedHandCard(page, frames, "hand-card-selected");
      if (ok) {
        await frames.shot("play-turn1");
        return 1;
      }
      return 0;
    }
    if (fallbackIndex < 0) fallbackIndex = i;
  }
  if (fallbackIndex >= 0) {
    await tiles.nth(fallbackIndex).click().catch(() => {});
    await breathe(page);
    const ok = await playSelectedHandCard(page, frames, "hand-card-selected");
    if (ok) {
      await frames.shot("play-turn1");
      return 1;
    }
  }
  return 0;
}

// Turno 2+: joga ate maxPlays cartas da mao; a cada sucesso reinicia a varredura
// porque o DOM da mao muda.
async function playHandCards(page, frames, maxPlays) {
  let plays = 0;
  let attempts = 0;
  outer: while (plays < maxPlays && attempts < 10) {
    const tiles = page.locator(".hand-track .card-tile:not(.is-dimmed)");
    const count = await tiles.count();
    if (!count) break;
    for (let i = 0; i < count && plays < maxPlays && attempts < 10; i += 1) {
      attempts += 1;
      const tile = tiles.nth(i);
      if (!(await tile.isVisible().catch(() => false))) continue;
      await tile.click().catch(() => {});
      await breathe(page);
      if (await playSelectedHandCard(page, frames, "hand-card-selected")) {
        plays += 1;
        await frames.shot(`play-turn2-${plays}`);
        continue outer;
      }
    }
    break;
  }
  return plays;
}

// Turno da IA: clica End turn e espera o botao reabilitar (src/App.tsx:1319).
async function runAiTurn(page, frames) {
  await page.locator(".end-turn-button").click();
  await page.waitForTimeout(450);
  await frames.shot("turn-ended");
  if (MOTION) {
    // Voo da IA: a batida de cada jogada dura ~1s (hold 420ms no centro), então
    // frames espaçados pegam a carta em pleno voo.
    for (const [i, ms] of [700, 600, 700, 700, 700].entries()) {
      await page.waitForTimeout(ms);
      await frames.shot(`ai-turn-${i + 1}`);
    }
  } else {
    await page.waitForTimeout(1300);
    await frames.shot("ai-turn-live");
  }
  await waitForHumanTurn(page);
  await settle(page, 700);
  await frames.shot("ai-turn-done");
}

// Colhe com a primeira criatura pronta, apos escolher a casa dela.
async function reapWithReadyCreature(page, ready, frames) {
  const tile = page.locator(".battle-zone--player .board-piece .card-tile").nth(ready.index);
  await tile.click().catch(() => {});
  await breathe(page);
  const action = page.locator(".inspector-actions button.primary-action").first();
  if (!(await action.isEnabled().catch(() => false))) return false;
  await frames.shot("board-creature-selected");
  await action.click().catch(() => {});
  await settle(page, 550);
  await frames.shot("reap");
  return true;
}

async function openLogPanel(page, frames) {
  await page.locator(".log-full-button").click();
  await page.waitForSelector(".log-section .filter-chips", { timeout: 8000 });
  await breathe(page);
  await frames.shot("log-panel");
  // Filtros: grupo 0 = lado (all/you/warden), grupo 1 = acao (all/play/...).
  await page.locator(".log-section .filter-chips").nth(0).locator("button").last().click();
  await page.locator(".log-section .filter-chips").nth(1).locator("button").nth(1).click();
  await settle(page, 450);
  await frames.shot("log-filtered");
  await page.locator(".log-section .quiet-icon-button").click();
  await page.waitForTimeout(300);
}

// ---------- wizard de config ----------

// O wizard solo tem 6 passos (src/App.tsx:531): mode, difficulty, opponent,
// thinking, experience, review. Caminha pelos pills como um usuario.
async function walkConfigWizard(page, frames) {
  const pills = page.locator(".config-screen .config-step-pill");
  const count = await pills.count();
  for (let i = 0; i < count; i += 1) {
    await pills.nth(i).click();
    await breathe(page);
    if (i === 1) await frames.shot("config-difficulty");
  }
  await pills.nth(Math.max(0, count - 1)).click();
  await settle(page, 500);
  await frames.shot("config-review");
  await page.locator(".config-nav .cta-button").click();
  await page.waitForSelector(".game-screen", { timeout: 20000 });
}

// ---------- sessao completa ----------

async function recordSession(browser, base) {
  mkdirSync(CLIPS_DIR, { recursive: true });
  rmSync(TMP_VIDEO_DIR, { recursive: true, force: true });
  mkdirSync(TMP_VIDEO_DIR, { recursive: true });

  const context = await browser.newContext({
    viewport: VIEWPORT,
    reducedMotion: MOTION ? "no-preference" : "reduce",
    recordVideo: { dir: TMP_VIDEO_DIR, size: VIEWPORT },
  });
  await context.addInitScript(seedBody());
  const page = await context.newPage();
  const video = page.video();
  const frames = createFrameSaver(page);
  const stats = { actions: 0, reaped: false, turn2Plays: 0 };
  let failure = null;

  try {
    // (a) Home: scroll suave ate o fim e volta.
    await openHome(page, base);
    await frames.shot("home");
    await breathe(page);
    await wheelPageToEdge(page, { x: 640, y: 480, direction: 1 });
    await breathe(page);
    await frames.shot("home-scrolled-bottom");
    await wheelPageToEdge(page, { x: 640, y: 480, direction: -1 });
    await breathe(page);
    await frames.shot("home-back-top");

    // (b) Config: caminha pelo wizard e inicia a partida demo.
    await navTo(page, "config");
    await page.waitForSelector(".config-screen", { timeout: 15000 });
    await settle(page, 600);
    await frames.shot("config-mode");
    await walkConfigWizard(page, frames);

    // (c) Partida: mulligan, casa e acoes humanas reais.
    // FEAT-10: a mao inicial pede a decisao de mulligan; segura a overlay por um
    // respiro, mantem a mao e espera o Warden decidir.
    const keep = page.locator(".mulligan-keep");
    if (await keep.count()) {
      await breathe(page);
      await frames.shot("mulligan");
      await keep.click();
    }
    await page.waitForSelector(".mulligan-shade", { state: "detached", timeout: 20000 }).catch(() => {});
    await settle(page, 900);
    await frames.shot("board-start");
    if (VIEW === "3d") {
      // Prova numerica no log do harness: o video sozinho nao mede a pose.
      const geometry = await page.evaluate(() => {
        const board = document.querySelector(".game-board");
        const content = document.querySelector(".board-content");
        const plane = document.querySelector(".table-plane");
        const piece = document.querySelector(".table-plane .board-piece");
        const hand = document.querySelector(".hand-track > .card-tile--hand");
        const read = (el, prop) => (el ? getComputedStyle(el).getPropertyValue(prop).trim() : null);
        return {
          view: board?.getAttribute("data-view") ?? null,
          tilt: read(plane, "--tilt"),
          // A perspectiva fica no pai do plano (o plano carrega a inclinacao).
          perspective: content ? getComputedStyle(content).perspective : null,
          pieceRotate: read(piece, "rotate"),
          pieceTranslate: read(piece, "translate"),
          handRotate: read(hand, "rotate"),
        };
      });
      console.log(`[record] 3D: ${JSON.stringify(geometry)}`);
    }
    await waitForHumanTurn(page);
    await chooseHouse(page, await pickHouse(page, true));
    await breathe(page);
    await frames.shot("house-chosen");
    stats.actions += await playOpeningCard(page, frames);

    // (d) Fim do turno humano + turno completo da IA.
    await runAiTurn(page, frames);

    // Turno 2 humano: colhe com criatura pronta e joga mais cartas (colher so e
    // legal com peca pronta; a carta do turno 1 foi escolhida como criatura).
    const over = (await page.locator(".winner-shade").count()) > 0;
    if (!over) {
      const ready = await findReadyCreature(page);
      const handHouses = new Set((await readHandLabels(page)).map(houseFromLabel).filter(Boolean));
      const bestHouse = await pickHouse(page, false);
      const turn2House = ready && handHouses.has(ready.house) ? ready.house : (bestHouse ?? ready?.house ?? null);
      await chooseHouse(page, turn2House);
      await breathe(page);
      await frames.shot("human-turn-2");
      if (ready) {
        stats.reaped = await reapWithReadyCreature(page, ready, frames);
        if (stats.reaped) stats.actions += 1;
      }
      stats.turn2Plays = await playHandCards(page, frames, 3);
      stats.actions += stats.turn2Plays;
    }

    // (e) Scroll do board/rail e log completo com filtro.
    await wheelPageToEdge(page, { x: 620, y: 520, direction: 1, maxSteps: 14, stepPx: 220 });
    await breathe(page);
    await frames.shot("board-scrolled");
    await wheelElementToEdge(page, ".command-rail", 1);
    await breathe(page);
    await frames.shot("rail-scrolled");
    await openLogPanel(page, frames);

    // (f) Home e Vault (Browse) com scroll.
    await navTo(page, "home");
    await page.waitForSelector(".home-screen", { timeout: 15000 });
    await settle(page, 700);
    await frames.shot("home-return");
    await page.locator(".home-shortcuts .import-card").first().click();
    await page.waitForSelector(".browse-screen", { timeout: 15000 });
    // Browse consulta a API do Master Vault; offline mostra o estado de erro,
    // que tambem e material de analise.
    await page
      .waitForSelector(".browse-screen .deck-tile, .browse-screen .browse-empty", { timeout: 25000 })
      .catch(() => {});
    await settle(page, 900);
    await frames.shot("vault");
    await wheelPageToEdge(page, { x: 640, y: 520, direction: 1, maxSteps: 14, stepPx: 220 });
    await breathe(page);
    await frames.shot("vault-scrolled");
    await page.locator(".browse-screen .icon-back").click();
    await page.waitForSelector(".home-screen", { timeout: 15000 });
    await settle(page, 700);
    await frames.shot("home-final");
  } catch (err) {
    failure = err;
    console.error(`[record] FALHA no fluxo: ${err.message}`);
  } finally {
    // O webm so e finalizado no close do contexto/pagina.
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }

  let videoSrc = null;
  if (video) videoSrc = await video.path().catch(() => null);
  const videoPath = finalizeVideo(videoSrc);
  const videoBytes = videoPath ? statSync(videoPath).size : 0;
  console.log(`[record] clipe: ${videoPath} (${(videoBytes / 1024).toFixed(1)} KB)`);
  console.log(`[record] frames: ${frames.saved.length} em ${FRAMES_DIR}`);
  console.log(
    `[record] acoes humanas aplicadas: ${stats.actions} (turno 1: 1 carta; turno 2: ${stats.reaped ? "colheu + " : ""}${stats.turn2Plays} carta(s))`,
  );
  for (const file of frames.saved) console.log(`[record]   ${file}`);

  if (failure) throw failure;
  if (!videoPath || videoBytes < MIN_VIDEO_BYTES) {
    throw new Error(`video ausente ou pequeno demais (${videoBytes} bytes; minimo ${MIN_VIDEO_BYTES})`);
  }
  if (frames.saved.length < MIN_FRAMES) {
    throw new Error(`frames insuficientes (${frames.saved.length}; minimo ${MIN_FRAMES})`);
  }
  return { videoPath, videoBytes, frames: frames.saved, stats };
}

function finalizeVideo(src) {
  if (!src || !existsSync(src)) return null;
  const dest = join(CLIPS_DIR, VIDEO_NAME);
  rmSync(dest, { force: true });
  try {
    renameSync(src, dest);
  } catch {
    // OneDrive pode segurar o handle por um instante; copia como fallback.
    copyFileSync(src, dest);
  }
  rmSync(src, { force: true });
  rmSync(TMP_VIDEO_DIR, { recursive: true, force: true });
  return dest;
}

// ---------- main ----------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  MOTION = args.animations;
  VIEW = args.view;
  if (VIEW === "3d") {
    FRAMES_DIR = join(CLIPS_DIR, "frames-3d");
    VIDEO_NAME = "session-1280x800-3d.webm";
  }
  const server = args.baseUrl ? null : startDevServer(args.port);
  const base = args.baseUrl ?? server.url;
  let browser;
  try {
    if (server) {
      console.log(`[record] subindo vite dev server em ${base} ...`);
      await server.waitReady();
      console.log(`[record] dev server pronto (view=${VIEW}${MOTION ? ", animations" : ""})`);
    }
    browser = await launchBrowser();
    const result = await recordSession(browser, base);
    console.log(`[record] OK - ${result.videoPath}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.stop();
  }
}

main().catch((err) => {
  console.error(`record: ${err.message}`);
  process.exit(1);
});
