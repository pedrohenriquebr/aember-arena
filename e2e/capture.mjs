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
// Determinismo: cada viewport roda em browser context isolado com localStorage
// pre-populado (animations/sfx/music OFF, idioma "en") + reducedMotion "reduce" —
// docs/WORKFLOW.md §7 lista animacao como fonte de flake de screenshots.
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
const DEFAULT_PORT = 5199;
const FLOOR_PX = 11;
const CAPS_FLOOR_PX = 10;
const INPUT_FLOOR_PX = 16;

// Ordem fixa dos controles de navegacao no DOM:
//   .header-nav .nav-link  = home, browse, config, [game]  (src/App.tsx:1341-1354)
//   .mobile-tabs .mobile-tab = home, browse, config, game  (src/App.tsx:1539-1550)
const NAV_INDEX = { home: 0, browse: 1, config: 2, game: 3 };

function parseArgs(argv) {
  const args = { port: DEFAULT_PORT, out: null, floorOnly: false, matchSmoke: false, baseUrl: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--out") args.out = argv[(i += 1)];
    else if (a === "--port") args.port = Number(argv[(i += 1)]);
    else if (a === "--base-url") args.baseUrl = argv[(i += 1)];
    else if (a === "--floor-only") args.floorOnly = true;
    else if (a === "--match-smoke") args.matchSmoke = true;
    else {
      console.error(`capture: argumento desconhecido "${a}"`);
      process.exit(2);
    }
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
// src/lib/i18n.ts:559): idioma fixo em "en" e efeitos desligados.
// Aplicado DEPOIS do primeiro goto + reload: init scripts podem rodar antes da
// origem existir e o localStorage falha silenciosamente nessa fase.
const SEED_BODY = `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2,
    sfx: false, music: false, animations: false, hoverZoom: true, language: "en",
  }));
  localStorage.setItem("aember-arena-language", "en");
})()`;

async function newPage(browser, { w, h }) {
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    reducedMotion: "reduce",
  });
  await context.addInitScript(SEED_BODY);
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
  // Semeia o storage com a origem ja estabelecida e recarrega para o app ler
  // os valores fixos (settings.ts:26-44 le na inicializacao).
  await page.evaluate(SEED_BODY);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".home-screen", { timeout: 30000 });
  await settle(page);
}

// Wizard de config tem 4 passos (difficulty, thinking, experience, review -
// src/App.tsx:329). Vai direto ao pill "review" e aperta o CTA, que chama
// onStart -> startMatch(selectedDeck) com o deck demo embutido
// (selectedDeck default = DEMO_DECK, src/App.tsx:1008 e 1433).
async function startDemoMatch(page) {
  await page.locator(".config-screen .config-step-pill").nth(3).click();
  await page.locator(".config-screen .cta-button").click();
  await page.waitForSelector(".game-screen", { timeout: 20000 });
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

// Caminhada pelas 5 telas. Retorna a lista de telas visitadas; usa os callbacks
// onScreen(screen) a cada tela estabilizada.
async function walkScreens(page, base, onScreen) {
  await openHome(page, base);
  await onScreen("home");

  await navTo(page, "config");
  await page.waitForSelector(".config-screen", { timeout: 15000 });
  await settle(page);
  await onScreen("config");

  await startDemoMatch(page);
  await settle(page, 900);
  await onScreen("game");

  await navTo(page, "browse");
  await page.waitForSelector(".browse-screen", { timeout: 15000 });
  // Browse consulta a API do Master Vault (src/components/DeckBrowser.tsx);
  // espera tiles ou estado vazio, mas segue em frente se a rede falhar.
  await page
    .waitForSelector(".browse-screen .deck-tile, .browse-screen .browse-empty", { timeout: 20000 })
    .catch(() => {});
  await settle(page, 900);
  await onScreen("browse");

  await navTo(page, "home");
  await page.waitForSelector(".home-screen", { timeout: 15000 });
  await settle(page);
  // DeckTile: 1o botao = selecionar, 2o = inspecionar (src/components/DeckTile.tsx:58-65).
  const inspectBtn = page.locator('.deck-grid-item .tile-action[aria-label="Open deck details"]').first();
  if (await inspectBtn.count()) await inspectBtn.click();
  else await page.locator(".deck-grid-item .tile-action").nth(1).click();
  await page.waitForSelector(".inspect-screen", { timeout: 15000 });
  await settle(page, 900);
  await onScreen("inspect");
}

// ---------- modo default: screenshots ----------

async function runCapture(browser, base, outDir) {
  const manifest = {
    mode: "capture",
    base,
    generatedAt: new Date().toISOString(),
    viewports: VIEWPORTS.map(({ w, h }) => `${w}x${h}`),
    screens: ["home", "config", "game", "browse", "inspect"],
    determinism: "localStorage seedado (animations/sfx/music off, lang en) + reducedMotion:reduce",
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

function floorAuditFn({ floor, capsFloor, inputFloor }) {
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
      fontSize,
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
    const fontSize = parseFloat(cs.fontSize);
    if (!Number.isFinite(fontSize)) continue;
    const isField =
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
    if (isField) {
      if (fontSize < inputFloor) {
        violations.push({
          kind: "input",
          fontSize,
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
      const pfs = parseFloat(pcs.fontSize);
      if (Number.isFinite(pfs) && pfs < floor) {
        report("pseudo", el, pcs, pfs, pseudo, text.slice(0, 48));
      }
    }
  }
  return violations;
}

async function runFloorOnly(browser, base) {
  const vp = { w: 360, h: 800 };
  const { context, page } = await newPage(browser, vp);
  const perScreen = [];
  try {
    await walkScreens(page, base, async (screen) => {
      const violations = await page.evaluate(floorAuditFn, {
        floor: FLOOR_PX,
        capsFloor: CAPS_FLOOR_PX,
        inputFloor: INPUT_FLOOR_PX,
      });
      perScreen.push({ screen, violations });
      console.log(`[floor] ${screen}: ${violations.length} elemento(s) abaixo do piso`);
    });
  } finally {
    await context.close().catch(() => {});
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
  if (all.length) {
    console.error(`\nfloor-only: FALHOU - ${all.length} violacao(oes) unica(s) a 360x800 (piso ${FLOOR_PX}px, caps 10px c/ letter-spacing >= 0.1em, inputs ${INPUT_FLOOR_PX}px):\n`);
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
  console.log(`\nfloor-only: OK - 0 violacoes (piso ${FLOOR_PX}px, inputs ${INPUT_FLOOR_PX}px) nas 5 telas a 360x800`);
}

// ---------- modo --match-smoke ----------

async function runMatchSmoke(browser, base, outDir) {
  mkdirSync(outDir, { recursive: true });
  const errors = [];
  for (const vp of VIEWPORTS) {
    const { context, page } = await newPage(browser, vp);
    try {
      await openHome(page, base);
      await navTo(page, "config");
      await page.waitForSelector(".config-screen", { timeout: 15000 });
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
  const server = args.baseUrl ? null : startDevServer(args.port);
  const base = args.baseUrl ?? server.url;
  let browser;
  try {
    if (server) {
      console.log(`[capture] subindo vite dev server em ${base} ...`);
      await server.waitReady();
      console.log("[capture] dev server pronto");
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
