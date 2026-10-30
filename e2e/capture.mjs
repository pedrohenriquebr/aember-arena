// T1 - Harness de regressao visual (docs/WORKFLOW.md §3 T1).
//
// Modos:
//   node e2e/capture.mjs --out DIR [--port N] [--base-url URL]
//       Sobe o vite dev server sozinho (spawn em porta fixa, derrubado ao sair),
//       navega pelas 5 telas (home, config, partida demo INICIADA com o deck
//       embutido, browse, inspect) e salva screenshots viewport-only em
//       DIR/<w>x<h>/<screen>.png para cada viewport 360x800, 390x844, 768x1024 e 1280x800.
//   node e2e/capture.mjs --floor-only [--port N]
//       Mesma caminhada medida a 360x800: percorre o DOM com getComputedStyle e
//       sai != 0 listando TODO font-size computado < 11px (10px so vale em
//       caps/eyebrow com letter-spacing >= 0.1em) e TODO input/textarea/select < 16px.
//   node e2e/capture.mjs --match-smoke --out DIR [--port N]
//       Inicia a partida demo, clica "end turn" 2x (esperando a vez da IA
//       terminar entre os cliques) e screenshot o board em DIR/match-smoke-<w>x<h>.png.
//
// H3D-11: --view 3d (default 2d) semeia `tableView: "3d"` nas settings, entao os
// MESMOS modos gravam a mesa 3D: capture (mesmas 5 telas), --match-smoke e
// --floor-only com o piso VISUAL (fontPx * fator de projecao, plano §2.6) a 360,
// 768, 1280 e 1440 — o 3D so existe no game screen, entao o piso 3D caminha
// home/config/game (o 2D continua nas 5 telas a 360).
//
// Determinismo: cada viewport roda em browser context isolado com localStorage
// pre-populado (animations/sfx/music OFF, idioma "en", tableView fixo) +
// reducedMotion "reduce" — docs/WORKFLOW.md §7 lista animacao como fonte de
// flake de screenshots.
//
// Driver: playwright-core SEM download de navegador — usa o Edge/Chrome do
// sistema via channel ("msedge" -> "chrome") ou executablePath padrao do Windows.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VITE_BIN = join(ROOT, "node_modules", "vite", "bin", "vite.js");

const VIEWPORTS = [
  { w: 360, h: 800 },
  { w: 390, h: 844 },
  { w: 768, h: 1024 },
  { w: 1280, h: 800 },
];
// H3D-11/§2.6: o piso visual do 3D vale nas 4 larguras de referencia.
const VIEWPORTS_3D_FLOOR = [
  { w: 360, h: 800 },
  { w: 768, h: 1024 },
  { w: 1280, h: 800 },
  { w: 1440, h: 900 },
];
const DEFAULT_PORT = 5199;
const FLOOR_PX = 11;
const CAPS_FLOOR_PX = 10;
const INPUT_FLOOR_PX = 16;

/** H3D-11: "2d" (default) ou "3d" — vira `tableView` no seed de cada contexto. */
let VIEW = "2d";
// H-25: --theme <id> semeia o tema salvo (forja | aco | claro | arcano); sem a flag nada é
// semeado e o baseline continua o da Forja (o padrão do motor de temas).
let THEME = null;

// H-29 (v2 é o padrão): a casca do Lobby tem 3 abas (Jogar · Decks · Ajustes, shellNav.ts),
// nessa ordem. As chaves seguem os nomes dos PNGs (home/browse/config).
const SHELL_TAB = { home: 0, browse: 1, config: 2 };

function parseArgs(argv) {
  const args = { port: DEFAULT_PORT, out: null, floorOnly: false, matchSmoke: false, baseUrl: null, view: VIEW, theme: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--out") args.out = argv[(i += 1)];
    else if (a === "--port") args.port = Number(argv[(i += 1)]);
    else if (a === "--base-url") args.baseUrl = argv[(i += 1)];
    else if (a === "--view") args.view = argv[(i += 1)];
    else if (a === "--theme") args.theme = argv[(i += 1)];
    else if (a === "--floor-only") args.floorOnly = true;
    else if (a === "--match-smoke") args.matchSmoke = true;
    else {
      console.error(`capture: argumento desconhecido "${a}"`);
      process.exit(2);
    }
  }
  // H-ATL-03: "tcg" (Layout Arena) usa o piso do 2D (sem projeção); só o "3d" tem piso visual.
  if (args.view !== "2d" && args.view !== "3d" && args.view !== "tcg") {
    console.error(`capture: --view aceita "2d", "3d" ou "tcg" (recebi "${args.view}")`);
    process.exit(2);
  }
  if (args.theme !== null && !["forja", "aco", "claro", "arcano"].includes(args.theme)) {
    console.error(`capture: --theme aceita forja | aco | claro | arcano (recebi "${args.theme}")`);
    process.exit(2);
  }
  if (args.floorOnly && args.matchSmoke) {
    console.error("capture: use apenas um modo (--floor-only ou --match-smoke)");
    process.exit(2);
  }
  if (!args.out && !args.floorOnly) {
    console.error('capture: --out DIR e obrigatorio nos modos capture e --match-smoke');
    process.exit(2);
  }
  return args;
}

// ---------- vite dev server ----------

function startDevServer(port) {
  // --host 127.0.0.1: o default "localhost" do vite pode bindar so IPv6 (::1),
  // enquanto a sonda e o browser usam IPv4.
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

// ---------- navegacao no app ----------

// Pre-popula storage para baseline estavel (src/lib/settings.ts:29,
// src/lib/i18n.ts:559): idioma fixo em "en" e efeitos desligados. O tableView
// segue o --view (H3D-11): o mesmo harness grava 2D e 3D. O aiSpeed "fast"
// encurta as batidas do Warden nos modos que o deixam jogar (floor 3D e smoke)
// sem mexer nas telas capturadas (nelas a vez ainda e do humano).
// Aplicado DEPOIS do primeiro goto + reload: init scripts podem rodar antes da
// origem existir e o localStorage falha silenciosamente nessa fase.
const seedBody = () => `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: false,
    hoverZoom: true, language: "en", tableView: "${VIEW}", aiSpeed: "fast",
  }));
  localStorage.setItem("aember-arena-language", "en");
  ${THEME ? `localStorage.setItem("aember-arena-theme", "${THEME}");` : ""}
})()`;

async function newPage(browser, { w, h }) {
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    reducedMotion: "reduce",
  });
  await context.addInitScript(seedBody());
  const page = await context.newPage();
  return { context, page };
}

async function settle(page, ms = 600) {
  await page
    .evaluate(() => (document.fonts ? document.fonts.ready.then(() => null) : null))
    .catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function navTo(page, key) {
  await page.locator(".nf-shell-tab").nth(SHELL_TAB[key]).click();
}

async function openHome(page, base) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  // Semeia o storage com a origem ja estabelecida e recarrega para o app ler
  // os valores fixos (settings.ts:26-44 le na inicializacao).
  await page.evaluate(seedBody());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
  await settle(page);
}

// v2 (H-29): "Jogar" no Lobby (data-action="play") inicia a partida com o deck
// selecionado — o demo embutido por padrao (DEMO_DECK), sem o wizard da v1.
async function startDemoMatch(page) {
  await page.locator('[data-screen="lobby"] [data-action="play"]').click();
  await page.waitForSelector(".game-screen", { timeout: 20000 });
  // FEAT-10: a mao inicial pede a decisao de mulligan; o harness mantem a mao
  // (e espera o Warden decidir) para o board estabilizar antes de medir/printar.
  const keep = page.locator(".mulligan-keep");
  if (await keep.count()) await keep.click();
  await page.waitForSelector(".mulligan-shade", { state: "detached", timeout: 20000 }).catch(() => {});
}

// createMatch comeca com activePlayer 0 (src/lib/game.ts:130), entao logo apos
// o inicio a vez e do humano: clicar end turn dispara a IA; espera a IA terminar
// (botao re-habilita, src/App.tsx:747 disabled={!isHumanTurn}).
async function endTurnOnce(page, i, aiTimeoutMs = 45000) {
  const enabledFn = () => {
    const b = document.querySelector(".end-turn-button");
    return !!b && !b.disabled;
  };
  await page.waitForFunction(enabledFn, null, { timeout: 10000 });
  await page.locator(".end-turn-button").click();
  await page
    .waitForFunction(() => {
      const b = document.querySelector(".end-turn-button");
      return !!b && b.disabled;
    }, null, { timeout: 10000 })
    .catch(() => {});
  await page.waitForFunction(enabledFn, null, { timeout: aiTimeoutMs });
}

/** H3D-11 (floor 3D): joga UMA CRIATURA da mao para o board ter pecas de
 *  verdade na auditoria (pose, sombra e piso visual dos textos in-card). Sem
 *  criatura jogavel, cai na primeira carta que o inspetor deixar jogar. */
async function playOneCard(page) {
  const house = await page.evaluate(() => {
    const labels = [...document.querySelectorAll(".hand-track .card-tile")].map((el) => el.getAttribute("aria-label") ?? "");
    const pick = labels.find((label) => label.includes(" Creature")) ?? labels[0] ?? "";
    return (pick.split(", ")[1] ?? "").replace(/ (Creature|Action|Artifact|Upgrade)$/, "");
  });
  await page.evaluate((name) => {
    const picks = [...document.querySelectorAll(".house-picker .house-choice:not([disabled])")];
    (picks.find((el) => el.textContent?.includes(name)) ?? picks[0])?.click();
  }, house);
  await page.waitForTimeout(250);
  const tiles = page.locator(".hand-track .card-tile");
  let fallback = null;
  for (let i = 0; i < (await tiles.count()); i += 1) {
    await tiles.nth(i).click();
    await page.waitForTimeout(140);
    const play = page.locator(".inspector-actions button.primary-action").first();
    if (!((await play.count()) && (await play.isEnabled().catch(() => false)))) continue;
    const isCreature = await page.evaluate(() => /creature/i.test(document.querySelector(".selected-card-heading .card-type-label")?.textContent ?? ""));
    if (isCreature) {
      await play.click().catch(() => {});
      await page.waitForTimeout(400);
      return "criatura";
    }
    if (fallback === null) fallback = i;
  }
  if (fallback !== null) {
    await tiles.nth(fallback).click();
    await page.waitForTimeout(140);
    const play = page.locator(".inspector-actions button.primary-action").first();
    await play.click().catch(() => {});
    await page.waitForTimeout(400);
    return "outra carta";
  }
  return "nada jogavel";
}

// Caminhada pelas 5 telas. Retorna a lista de telas visitadas; usa os callbacks
// onScreen(screen) a cada tela estabilizada.
// v2 (H-29): home = Lobby, config = Ajustes, browse = Biblioteca, inspect = Detalhe
// (aberto pelo ⊙ de um tile da prateleira). A partida fica por último: na mesa a casca
// some, então sair dela pede o ☰ — por isso a caminhada não volta depois de jogar.
async function walkScreens(page, base, onScreen) {
  await openHome(page, base);
  await onScreen("home");

  await navTo(page, "config");
  await page.waitForSelector('[data-screen="settings"]', { timeout: 15000 });
  await settle(page);
  await onScreen("config");

  await navTo(page, "browse");
  await page.waitForSelector('[data-screen="library"]', { timeout: 15000 });
  // Browse consulta a API do Master Vault (src/components/DeckBrowser.tsx);
  // espera tiles ou estado vazio, mas segue em frente se a rede falhar.
  await page.waitForSelector('[data-screen="library"] .nf-tile', { timeout: 20000 }).catch(() => {});
  await settle(page, 900);
  await onScreen("browse");

  await navTo(page, "home");
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 15000 });
  await settle(page);
  // Tile da prateleira: o ⊙ (2o botão de ação) abre o Detalhe (ui2.mjs usa o mesmo seletor).
  await page.locator('[data-screen="lobby"] .nf-shelf-grid .nf-tile-actions .nf-btn--ghost').first().click();
  await page.waitForSelector('[data-screen="detail"]', { timeout: 15000 });
  await settle(page, 900);
  await onScreen("inspect");

  await navTo(page, "home");
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 15000 });
  await settle(page);
  await startDemoMatch(page);
  await settle(page, 900);
  await onScreen("game");
}

// ---------- modo default: screenshots ----------

async function runCapture(browser, base, outDir) {
  const manifest = {
    mode: "capture",
    base,
    view: VIEW,
    generatedAt: new Date().toISOString(),
    viewports: VIEWPORTS.map(({ w, h }) => `${w}x${h}`),
    screens: ["home", "config", "game", "browse", "inspect"],
    determinism: `localStorage seedado (animations/sfx/music off, lang en, tableView ${VIEW}${THEME ? `, tema ${THEME}` : ""}) + reducedMotion:reduce`,
    note: "browse depende da API do Master Vault ao vivo; os demais funcionam offline",
    files: [],
    errors: [],
  };
  for (const vp of VIEWPORTS) {
    const { context, page } = await newPage(browser, vp);
    const vpDir = join(outDir, `${vp.w}x${vp.h}`);
    try {
      await walkScreens(page, base, async (screen) => {
        mkdirSync(vpDir, { recursive: true });
        const file = join(vpDir, `${screen}.png`);
        await page.screenshot({ path: file });
        manifest.files.push(`${vp.w}x${vp.h}/${screen}.png`);
        console.log(`[capture] ${vp.w}x${vp.h} -> ${screen}`);
      });
    } catch (err) {
      manifest.errors.push(`${vp.w}x${vp.h}: ${err.message}`);
      console.error(`[capture] FALHA em ${vp.w}x${vp.h}: ${err.message}`);
    } finally {
      await context.close().catch(() => {});
    }
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (manifest.errors.length) process.exit(1);
}

// ---------- modo --floor-only ----------

function floorAuditFn({ floor, capsFloor, inputFloor, visual }) {
  const describe = (el) => {
    const parts = [];
    let node = el;
    for (let i = 0; node && node.nodeType === 1 && parts.length < 5; i += 1, node = node.parentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id) part += `#${node.id}`;
      else if (typeof node.className === "string" && node.className.trim()) {
        part += `.${node.className.trim().split(/\s+/).slice(0, 3).join(".")}`;
      }
      parts.unshift(part);
    }
    return parts.join(" > ");
  };
  // H3D-11/VIEW3D_PLAN §2.6: o piso VISUAL do 3D. O font-size computado nao
  // enxerga transforms; o fator de projecao e a razao altura projetada /
  // altura de layout do ancestral TRANSFORMADO mais proximo (a peca, o plano,
  // a carta da mao), que ja carrega a cadeia inteira (rotateX + --depth-k +
  // perspectiva + giro do leque). Fora de um ancestral transformado o fator e
  // 1: sem transform nao ha supressao a medir, e o arredondamento de caixas
  // pequenas (offsetHeight inteiro) so criaria falso positivo em texto 2D.
  // Fator > 1 (bbox inflada por rotacao em Z do leque) trava em 1 — girar nao
  // encolhe nem cresce glifo.
  const transformed = (el) => {
    const cs = getComputedStyle(el);
    return (
      (cs.transform && cs.transform !== "none") ||
      (cs.rotate && cs.rotate !== "none") ||
      (cs.translate && cs.translate !== "none") ||
      (cs.scale && cs.scale !== "none")
    );
  };
  const visualFactor = (el) => {
    if (!visual) return 1;
    for (let node = el, depth = 0; node && node.nodeType === 1 && depth < 8; node = node.parentElement, depth += 1) {
      if (!transformed(node)) continue;
      const layout = node.offsetHeight;
      const height = node.getBoundingClientRect().height;
      if (layout < 12 || !height) return 1; // caixa pequena: o inteiro de offsetHeight domina
      return Math.min(1, height / layout);
    }
    return 1;
  };
  const violations = [];
  const report = (kind, el, cs, fontSize, pseudo, text) => {
    const lsRaw = cs.letterSpacing;
    const ls = lsRaw === "normal" ? 0 : parseFloat(lsRaw) || 0;
    const cls = typeof el.className === "string" ? el.className : "";
    const capsLike =
      cs.textTransform === "uppercase" ||
      cs.fontVariantCaps !== "normal" ||
      /(^|[\s_-])(eyebrow|caps|overline|kicker)/i.test(cls);
    const allowedCaps = fontSize >= capsFloor && ls >= 0.1 * fontSize && capsLike;
    if (allowedCaps) return;
    violations.push({
      kind,
      fontSize: Math.round(fontSize * 100) / 100,
      selector: `${describe(el)}${pseudo}`,
      text,
      letterSpacingPx: ls,
      capsLike,
      ariaHidden: el.closest?.('[aria-hidden="true"]') !== null,
    });
  };
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    if (!el.getClientRects().length) continue;
    const factor = visualFactor(el);
    const fontSize = parseFloat(cs.fontSize) * factor;
    if (!Number.isFinite(fontSize)) continue;
    const isField =
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
    if (isField) {
      if (fontSize < inputFloor) {
        violations.push({
          kind: "input",
          fontSize: Math.round(fontSize * 100) / 100,
          selector: describe(el),
          text: "",
          letterSpacingPx: NaN,
          capsLike: false,
          ariaHidden: false,
        });
      }
      continue;
    }
    let ownText = "";
    for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE) ownText += node.textContent;
    ownText = ownText.trim();
    if (ownText && fontSize < floor) {
      report("text", el, cs, fontSize, "", ownText.slice(0, 48));
    }
    for (const pseudo of ["::before", "::after"]) {
      const pcs = getComputedStyle(el, pseudo);
      const content = pcs.content || "";
      if (!content || content === "none" || content === "normal") continue;
      const text = content.replace(/^["']|["']$/g, "").trim();
      if (!text) continue;
      const pfs = parseFloat(pcs.fontSize) * factor;
      if (Number.isFinite(pfs) && pfs < floor) {
        report("pseudo", el, pcs, pfs, pseudo, text.slice(0, 48));
      }
    }
  }
  return violations;
}

// Diagnostico do teste do teste: os menores tamanhos VISUAIS dentro do plano
// (mesmo fator do gate), com o ancestral que o produziu. Só aparece quando o
// stressor nao acusa — e o que diz ONDE o fator deixou de medir.
function floorSamplesFn({ floor }) {
  const transformed = (el) => {
    const cs = getComputedStyle(el);
    return (
      (cs.transform && cs.transform !== "none") ||
      (cs.rotate && cs.rotate !== "none") ||
      (cs.translate && cs.translate !== "none") ||
      (cs.scale && cs.scale !== "none")
    );
  };
  const factorOf = (el) => {
    for (let node = el, depth = 0; node && node.nodeType === 1 && depth < 8; node = node.parentElement, depth += 1) {
      if (!transformed(node)) continue;
      const layout = node.offsetHeight;
      const height = node.getBoundingClientRect().height;
      if (layout < 12 || !height) return { who: `${node.tagName.toLowerCase()}.${String(node.className).split(" ")[0]}`, factor: 1 };
      return { who: `${node.tagName.toLowerCase()}.${String(node.className).split(" ")[0]}`, factor: Math.min(1, height / layout) };
    }
    return { who: null, factor: 1 };
  };
  const out = [];
  for (const el of document.querySelectorAll(".table-plane *, .hand-track *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    if (!el.getClientRects().length) continue;
    let own = "";
    for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE) own += node.textContent;
    own = own.trim();
    if (!own) continue;
    const font = parseFloat(cs.fontSize);
    if (!Number.isFinite(font)) continue;
    const { who, factor } = factorOf(el);
    out.push({ text: own.slice(0, 24), font, factor: Math.round(factor * 1000) / 1000, visual: Math.round(font * factor * 100) / 100, who, below: font * factor < floor });
  }
  return out.sort((a, b) => a.visual - b.visual).slice(0, 6);
}

async function runFloorOnly(browser, base) {
  const visual = VIEW === "3d";
  const viewports = visual ? VIEWPORTS_3D_FLOOR : [{ w: 360, h: 800 }];
  const auditArgs = { floor: FLOOR_PX, capsFloor: CAPS_FLOOR_PX, inputFloor: INPUT_FLOOR_PX, visual };
  const perScreen = [];
  const notes = [];
  for (const vp of viewports) {
    const vpName = `${vp.w}x${vp.h}`;
    const { context, page } = await newPage(browser, vp);
    const audit = async (screen) => {
      const violations = await page.evaluate(floorAuditFn, auditArgs);
      const label = visual ? `${screen}@${vpName}` : screen;
      perScreen.push({ screen: label, violations });
      console.log(`[floor] ${label}: ${violations.length} elemento(s) abaixo do piso`);
      return violations;
    };
    try {
      if (visual) {
        // O 3D so muda o game screen; home/config entram para nao perder
        // regressao de layout do shell (2D) que o seed 3D expoe.
        await openHome(page, base);
        await audit("home");
        await navTo(page, "config");
        await page.waitForSelector('[data-screen="settings"]', { timeout: 15000 });
        await settle(page);
        await audit("config");
        await navTo(page, "home");
        await page.waitForSelector('[data-screen="lobby"]', { timeout: 15000 });
        await settle(page);
        await startDemoMatch(page);
        await settle(page, 900);
        const played = await playOneCard(page);
        await settle(page, 700);
        console.log(`[floor] 3d: carta jogada na mesa = ${played}`);
        const gameViolations = await audit("game");
        // Teste do teste: tirar a COMPENSACAO que mantem o texto de pe tem de
        // fazer o piso VISUAL acusar — sem isto um fator quebrado passaria em
        // silencio. Sao dois compensadores: o billboard do texto do plano (§2.6)
        // e o contra-tilt das cartas (a pose as deixa a lean graus da tela).
        // O stressor zera os dois e inclina a mesa a 60 graus; no 2.5D, onde nao
        // ha pose nem billboard, a mesa inclinada sozinha ja achata o texto.
        const tilted = await page.evaluate(() => {
          const plane = document.querySelector(".table-plane");
          if (!plane) return false;
          plane.style.setProperty("--tilt", "60deg");
          for (const piece of plane.querySelectorAll(".board-piece")) piece.style.setProperty("--lean", "60deg");
          for (const el of plane.querySelectorAll(".zone-heading, .turn-console, .fight-instruction, .empty-battleline")) {
            el.style.setProperty("rotate", "none");
          }
          return true;
        });
        await page.waitForTimeout(700);
        const blindViolations = tilted ? await page.evaluate(floorAuditFn, auditArgs) : [];
        if (tilted) {
          await page.evaluate(() => {
            const plane = document.querySelector(".table-plane");
            plane?.style.removeProperty("--tilt");
            for (const piece of plane?.querySelectorAll(".board-piece") ?? []) piece.style.removeProperty("--lean");
            for (const el of plane?.querySelectorAll(".zone-heading, .turn-console, .fight-instruction, .empty-battleline") ?? []) {
              el.style.removeProperty("rotate");
            }
          });
        }
        if (!tilted) notes.push(`${vpName}: sem .table-plane para o teste do teste`);
        else if (!blindViolations.length) {
          const samples = await page.evaluate(floorSamplesFn, { floor: FLOOR_PX });
          notes.push(`${vpName}: teste do teste FALHOU - sem os compensadores o piso visual nao acusa (amostras: ${samples.map((s) => `${s.text}=${s.visual}px(f=${s.factor},${s.who ?? "sem-ancestral"})`).join(" | ")})`);
        } else {
          notes.push(`${vpName}: teste do teste OK - sem os compensadores acusa ${blindViolations.length} elemento(s) (ex.: ${blindViolations[0].selector} ${blindViolations[0].fontSize}px)`);
          // O stressor so vale como teste se o estado normal estiver limpo.
          if (gameViolations.length) notes.push(`${vpName}: game screen com ${gameViolations.length} violacao(oes) no estado normal`);
        }
      } else {
        await walkScreens(page, base, audit);
      }
    } finally {
      await context.close().catch(() => {});
    }
  }

  const seen = new Map();
  for (const { screen, violations } of perScreen) {
    for (const v of violations) {
      const key = `${screen}|${v.kind}|${v.selector}|${v.fontSize}|${v.text}`;
      if (seen.has(key)) seen.get(key).count += 1;
      else seen.set(key, { screen, ...v, count: 1 });
    }
  }
  const all = [...seen.values()].sort(
    (a, b) => a.screen.localeCompare(b.screen) || a.fontSize - b.fontSize || a.selector.localeCompare(b.selector),
  );
  const scope = visual ? `3D (piso visual) a ${viewports.map((v) => `${v.w}x${v.h}`).join(", ")}` : "a 360x800 (5 telas)";
  for (const note of notes) console.log(`[floor] ${note}`);
  if (all.length) {
    console.error(`\nfloor-only: FALHOU - ${all.length} violacao(oes) unica(s) ${scope} (piso ${FLOOR_PX}px, caps 10px c/ letter-spacing >= 0.1em, inputs ${INPUT_FLOOR_PX}px):\n`);
    for (const v of all) {
      const label = v.kind === "input" ? "input" : v.kind === "pseudo" ? "texto(::before/::after)" : "texto";
      const extra = v.ariaHidden ? " [aria-hidden]" : "";
      const text = v.text ? ` text="${v.text}"` : "";
      console.error(
        `  [${v.screen}] ${label} ${v.selector} font-size=${v.fontSize}px letter-spacing=${Number.isNaN(v.letterSpacingPx) ? "-" : `${v.letterSpacingPx}px`} caps=${v.capsLike ? "sim" : "nao"}${extra} x${v.count}${text}`,
      );
    }
    process.exit(1);
  }
  if (visual && notes.some((note) => note.includes("teste do teste FALHOU"))) {
    console.error("\nfloor-only: FALHOU - o gate 3D nao reagiu ao tilt de teste (teste do teste)");
    process.exit(1);
  }
  console.log(`\nfloor-only: OK - 0 violacoes (piso ${FLOOR_PX}px, inputs ${INPUT_FLOOR_PX}px) ${scope}`);
}

// ---------- modo --match-smoke ----------

async function runMatchSmoke(browser, base, outDir) {
  mkdirSync(outDir, { recursive: true });
  const errors = [];
  for (const vp of VIEWPORTS) {
    const { context, page } = await newPage(browser, vp);
    try {
      await openHome(page, base);
      await startDemoMatch(page);
      await settle(page, 700);
      for (let i = 1; i <= 2; i += 1) {
        try {
          await endTurnOnce(page, i);
        } catch (err) {
          // Fim de jogo no meio do smoke nao e falha do harness: registra e segue.
          console.warn(`[match-smoke] ${vp.w}x${vp.h}: end turn ${i} nao re-habilitou (${err.message.split("\n")[0]}) - screenshot do estado atual`);
          break;
        }
      }
      await settle(page, 900);
      const file = join(outDir, `match-smoke-${vp.w}x${vp.h}.png`);
      await page.screenshot({ path: file });
      console.log(`[match-smoke] ${vp.w}x${vp.h} -> ${file}`);
    } catch (err) {
      errors.push(`${vp.w}x${vp.h}: ${err.message}`);
      console.error(`[match-smoke] FALHA em ${vp.w}x${vp.h}: ${err.message}`);
    } finally {
      await context.close().catch(() => {});
    }
  }
  if (errors.length) process.exit(1);
}

// ---------- main ----------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  VIEW = args.view;
  THEME = args.theme;
  const server = args.baseUrl ? null : startDevServer(args.port);
  const base = args.baseUrl ?? server.url;
  let browser;
  try {
    if (server) {
      console.log(`[capture] subindo vite dev server em ${base} ...`);
      await server.waitReady();
      console.log(`[capture] dev server pronto (view=${VIEW})`);
    }
    browser = await launchBrowser();
    if (args.floorOnly) await runFloorOnly(browser, base);
    else if (args.matchSmoke) await runMatchSmoke(browser, base, args.out);
    else await runCapture(browser, base, resolve(ROOT, args.out));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.stop();
  }
}

main().catch((err) => {
  console.error(`capture: ${err.message}`);
  process.exit(1);
});
