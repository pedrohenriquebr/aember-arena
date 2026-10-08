// Gate das telas da v2 "Forja Noturna" (UX_REWRITE_PLAN §5 H-03). Sobe o dev server
// (porta própria 5211), abre ?ui=2 e, para cada tela registrada em SCREENS, mede em 5
// viewports: overflow horizontal, alvos de toque, aria-label de botão só-ícone, piso
// tipográfico e animações com reduced-motion. Sai != 0 se algum critério falhar.
// Uso: npm run e2e:ui2   (SCREENS vazio = só o boot da v2, sem telas)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5211;
const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1920x1080", width: 1920, height: 1080 },
];
// Tela = { name, query, seed? }: `query` vai após ?ui=2 e o elemento raiz da tela expõe
// data-screen="<name>". `seed` é JS opcional (localStorage) rodado antes do boot.
// Vazio até H-05 (KitScreen entra como `_kit`).
const SCREENS = [];

const SEED = `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: false,
    hoverZoom: false, hints: false, language: "en", opponentMode: "mirror", gameMode: "solo",
  }));
  localStorage.setItem("aember-arena-language", "en");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
})()`;

// Roda no browser. Devolve só o que falhou (lista vazia = passou).
const AUDIT = () => {
  const out = { overflow: null, targets: [], unlabeled: [], smallText: [], motion: [] };
  const sw = document.documentElement.scrollWidth;
  if (sw > window.innerWidth) out.overflow = `scrollWidth ${sw} > innerWidth ${window.innerWidth}`;

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const label = (el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40);

  // 2: alvo >= 44x44, ou >= 36x36 quando marcado data-dense.
  for (const el of document.querySelectorAll("button,[role=button],a,input,select")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const min = el.hasAttribute("data-dense") ? 36 : 44;
    if (r.width < min || r.height < min) {
      out.targets.push(`${el.tagName.toLowerCase()} "${label(el)}" ${Math.round(r.width)}x${Math.round(r.height)} (min ${min})`);
    }
  }

  // 3: botão sem texto precisa de aria-label.
  for (const el of document.querySelectorAll("button")) {
    if (!visible(el) || el.textContent.trim() !== "") continue;
    if (!el.getAttribute("aria-label")) out.unlabeled.push(`button sem texto e sem aria-label (${el.className || "sem classe"})`);
  }

  // 4: texto visível >= 11px; 10px só em caps com letter-spacing >= 0.1em. Abaixo de 10px nunca.
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.trim();
    const el = node.parentElement;
    if (!text || !el || seen.has(el) || !visible(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    const ls = parseFloat(cs.letterSpacing) || 0;
    // caps = visualmente maiúsculo, seja por text-transform seja por texto já em maiúsculas.
    const caps = cs.textTransform === "uppercase" || (/[A-Z]/.test(text) && text === text.toUpperCase());
    const ok = fs >= 11 || (fs >= 10 && caps && ls >= 0.1 * fs);
    if (!ok) out.smallText.push(`${fs}px ls=${ls.toFixed(2)} "${text.slice(0, 30)}"`);
  }

  // 5: com reduced-motion nada roda após 600ms, exceto infinite marcado data-decor.
  for (const anim of document.getAnimations()) {
    if (anim.playState !== "running") continue;
    const timing = anim.effect?.getComputedTiming();
    const decor = anim.effect?.target?.closest?.("[data-decor]");
    if (timing?.iterations === Infinity && decor) continue;
    out.motion.push(`${anim.animationName || anim.constructor.name} em ${anim.effect?.target?.className || "?"}`);
  }

  return out;
};

const failed = (audit) => Object.values(audit).some((v) => (Array.isArray(v) ? v.length > 0 : v !== null));

function startServer() {
  const child = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
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

const server = startServer();
let browser;
let problems = 0;
try {
  await server.ready();
  browser = await launch();

  for (const vp of VIEWPORTS) {
    // Boot: a v2 ligada não pode quebrar a página, mesmo sem telas registradas.
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
    await context.addInitScript(SEED);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto(`${server.url}?ui=2`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".home-screen, .app-root", { timeout: 30000 });
    await page.waitForTimeout(600);
    if (errors.length) {
      problems += 1;
      console.log(`[boot ${vp.name}] erro de página: ${errors.join(" | ")}`);
    }
    await context.close();

    for (const screen of SCREENS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
      await ctx.addInitScript(SEED);
      if (screen.seed) await ctx.addInitScript(screen.seed);
      const p = await ctx.newPage();
      await p.goto(`${server.url}?ui=2&${screen.query}`, { waitUntil: "domcontentloaded" });
      await p.waitForSelector(`[data-screen="${screen.name}"]`, { timeout: 30000 });
      await p.waitForTimeout(600);
      const audit = await p.evaluate(AUDIT);
      if (failed(audit)) {
        problems += 1;
        console.log(`[${screen.name} ${vp.name}] FALHA`);
        for (const [key, items] of Object.entries(audit)) {
          if (Array.isArray(items) ? items.length : items !== null) {
            console.log(`    ${key}: ${Array.isArray(items) ? items.slice(0, 8).join("; ") : items}`);
          }
        }
      } else {
        console.log(`[${screen.name} ${vp.name}] OK`);
      }
      await ctx.close();
    }
  }
} finally {
  if (browser) await browser.close();
  server.stop();
}

if (!SCREENS.length) console.log("\n(SCREENS vazio: só o boot da v2 foi verificado)");
console.log(problems ? `\nUI2 FAIL - ${problems} violacao(oes)` : "\nUI2 OK");
process.exit(problems ? 1 : 0);
