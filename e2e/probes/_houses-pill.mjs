// Pill do seletor de casas (flutuante sobre a mesa) + chips de pilha.
// Sobe o dev server, entra na partida demo e, por view (2d/3d) x viewport:
//   - mede o pill (alvos >= 44px), a linha unica do console e os chips (>= 40px
//     no desktop, glifo 20px, contagem colada no glifo);
//   - prova COLISAO: pill x chips de pilha, pill x avatares, pill x headings,
//     pill x mao (mobile) — nada pode se sobrepor;
//   - prova o hit-test (o clique chega no botao da casa) e a acao (is-chosen);
//   - grava as captures em e2e/shots/houses/ (desktop+mobile, 2D+3D,
//     normal+hover+chosen).
// Uso: node e2e/probes/_houses-pill.mjs
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "e2e", "shots", "houses");
const PORT = 5234;
const url = `http://127.0.0.1:${PORT}/`;
mkdirSync(OUT, { recursive: true });

const child = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
const stop = () => spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });

const failures = [];
const bad = (msg) => { console.log(`   ! ${msg}`); failures.push(msg); };

const SEED = (view) => `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: false,
    hoverZoom: false, hints: false, language: "en", opponentMode: "mirror", gameMode: "solo",
    tableView: "${view}",
  }));
  localStorage.setItem("aember-arena-language", "en");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
})()`;

async function enterMatch(page) {
  await page.waitForSelector(".home-screen", { timeout: 30000 });
  await page.evaluate(() => document.querySelectorAll(".header-nav .nav-link")[2]?.click());
  await page.waitForSelector(".config-screen", { timeout: 15000 });
  const pills = page.locator(".config-screen .config-step-pill");
  await pills.nth((await pills.count()) - 1).click();
  await page.locator(".config-nav .cta-button").click();
  await page.waitForSelector(".game-screen", { timeout: 20000 });
  const keep = page.locator(".mulligan-keep");
  if (await keep.count()) await keep.click();
  await page.waitForSelector(".mulligan-shade", { state: "detached", timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector(".end-turn-button")?.disabled, null, { timeout: 90000 });
  await page.waitForTimeout(500);
}

// Medicao no browser: retangulos do pill, chips, avatares, headings e mao +
// hit-test do centro de cada botao de casa.
const MEASURE = () => {
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
  };
  const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
  const q = (sel) => [...document.querySelectorAll(sel)];
  const pill = document.querySelector(".house-pill");
  const board = document.querySelector(".game-board");
  const pillR = pill ? rect(pill) : null;
  const targets = q(".house-choice").map((el) => {
    const r = rect(el);
    const hit = document.elementFromPoint(r.left + r.w / 2, r.top + r.h / 2);
    return { w: Math.round(r.w), h: Math.round(r.h), hit: el.contains(hit) };
  });
  const chips = q(".pile-chip").map((el) => ({ ...rect(el), side: el.getAttribute("data-side"), pile: el.getAttribute("data-pile") }));
  const avatars = q(".player-avatar").map(rect);
  const headings = q(".zone-heading").map(rect);
  const bands = q(".game-board .player-band").map(rect);
  const handCards = q(".hand-track > .card-tile--hand").map(rect);
  const name = document.querySelector(".house-choice-name");
  const nameW = name ? Math.round(name.getBoundingClientRect().width) : -1;
  // Linha unica do console: o texto visivel.
  const line = document.querySelector(".turn-line");
  const consoleH = document.querySelector(".turn-console")?.getBoundingClientRect().height ?? 0;
  const chipGlyph = document.querySelector(".pile-chip svg")?.getBoundingClientRect().height ?? 0;
  return {
    pillR, targets, chips, avatars, headings, bands, handCards, nameW,
    chipGlyph: Math.round(chipGlyph),
    lineText: (line?.textContent ?? "").trim().replace(/\s+/g, " "),
    consoleH: Math.round(consoleH),
    board: rect(board),
    vh: window.innerHeight,
    collisions: {
      chips: pillR ? chips.filter((c) => overlap(pillR, c)).map((c) => `${c.side}/${c.pile}`) : [],
      avatars: pillR ? avatars.filter((a) => overlap(pillR, a)).length : 0,
      headings: pillR ? headings.filter((a) => overlap(pillR, a)).length : 0,
      hand: pillR ? handCards.filter((a) => overlap(pillR, a)).length : 0,
      bands: pillR ? bands.filter((a) => overlap(pillR, a)).length : 0,
    },
  };
};

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1280x800", width: 1280, height: 800, shot: true },
  { name: "1296x668", width: 1296, height: 668 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "390x844", width: 390, height: 844, shot: true },
  { name: "360x844", width: 360, height: 844 },
];

try {
  for (let i = 0; i < 200; i += 1) { try { if ((await fetch(url)).ok) break; } catch { /* subindo */ } await new Promise((r) => setTimeout(r, 250)); }
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "msedge", headless: true });

  for (const view of ["2d", "3d"]) {
    for (const vp of VIEWPORTS) {
      try {
        const isMobile = vp.width < 701;
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          reducedMotion: "reduce",
          hasTouch: isMobile,
          isMobile: isMobile,
        });
        context.setDefaultTimeout(8000);
        await context.addInitScript(SEED(view));
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await enterMatch(page);

        const m = await page.evaluate(MEASURE);
        const label = `${view} ${vp.name}`;
        // Pill existe, dentro do board, alvos >= 44px, hit-test ok.
        if (!m.pillR) bad(`${label}: pill ausente`);
        else {
          if (m.pillR.left < m.board.left - 1 || m.pillR.right > m.board.right + 1 || m.pillR.top < m.board.top - 1 || m.pillR.bottom > m.board.bottom + 1) {
            bad(`${label}: pill fora do board (${JSON.stringify(m.pillR)})`);
          }
          if (m.pillR.bottom > m.vh + 1) bad(`${label}: pill cortado pelo viewport`);
        }
        for (const [i, t] of m.targets.entries()) {
          if (t.w < 44 || t.h < 44) bad(`${label}: alvo ${i} = ${t.w}x${t.h} (< 44px)`);
          if (!t.hit) bad(`${label}: alvo ${i} nao recebe hit-test (coberto)`);
        }
        // Colisoes: chips, avatares, headings, mao, bandas.
        for (const key of Object.keys(m.collisions)) {
          const hit = m.collisions[key];
          const n = Array.isArray(hit) ? hit.length : hit;
          if (n) bad(`${label}: pill colide com ${key}: ${Array.isArray(hit) ? hit.join(",") : n}`);
        }
        // Posicao por perfil: >= 1041 topo (sob o HUD do Warden); abaixo, base.
        if (m.pillR) {
          const warden = m.bands[0];
          if (vp.width >= 1041) {
            if (warden && m.pillR.top < warden.bottom - 1) bad(`${label}: pill sobe sobre o HUD do Warden`);
            if (m.pillR.right < m.board.right - 80) bad(`${label}: pill nao esta no canto direito`);
          } else {
            const player = m.bands[1];
            if (player && m.pillR.bottom > player.top + 1) bad(`${label}: pill cobre a banda do jogador`);
            if (m.pillR.bottom < m.board.bottom - (m.board.bottom - (player ? player.top : m.board.bottom)) - 60) bad(`${label}: pill longe da base da mesa`);
          }
        }
        // Chips: glifo 20px, contagem presente e colada no glifo (ordem glyph,count,label).
        if (m.chipGlyph < 20) bad(`${label}: glifo do chip = ${m.chipGlyph}px (< 20)`);
        const chipInfo = await page.evaluate(() => [...document.querySelectorAll(".pile-chip")].map((el) => ({
          h: Math.round(el.getBoundingClientRect().height),
          order: [...el.children].map((c) => c.tagName).join(","),
          count: el.querySelector("b")?.textContent ?? null,
        })));
        for (const c of chipInfo) {
          if (!c.count) bad(`${label}: chip sem contagem visivel`);
          if (!c.order.startsWith("svg,B")) bad(`${label}: contagem nao colada ao glifo (${c.order})`);
          if (vp.width >= 701 && c.h < 40) bad(`${label}: chip ${c.h}px (< 40 no desktop)`);
          if (vp.width < 701 && c.h < 34) bad(`${label}: chip ${c.h}px (< 34 no mobile)`);
        }
        // Linha unica do console + altura do bloco no rail.
        if (!/ROUND/i.test(m.lineText) || !/turn|vez/i.test(m.lineText)) bad(`${label}: linha do console inesperada: "${m.lineText}"`);

        // Captura normal (+hover no desktop com mouse).
        if (vp.shot || vp.name === "1280x800") {
          await page.screenshot({ path: join(OUT, `houses-${view}-${isMobile ? "mobile" : "desktop"}-normal.png`) });
          if (!isMobile) {
            const first = page.locator(".house-choice:not([disabled])").first();
            if (await first.count()) {
              await first.hover();
              await page.waitForTimeout(350);
              const hovered = await page.evaluate(MEASURE);
              if (hovered.nameW < 20) bad(`${label}: hover nao expandiu o nome (w=${hovered.nameW})`);
              await page.screenshot({ path: join(OUT, `houses-${view}-desktop-hover.png`) });
            }
          }
        }

        // Acao: clicar escolhe a casa (mesmo handler dos botoes antigos).
        const first = page.locator(".house-choice:not([disabled])").first();
        if (await first.count()) {
          await first.click();
          await page.waitForTimeout(350);
          const chosen = await page.locator(".house-choice.is-chosen").count();
          if (!chosen) bad(`${label}: clique nao escolheu a casa (sem is-chosen)`);
          if (vp.shot || vp.name === "1280x800") {
            await page.screenshot({ path: join(OUT, `houses-${view}-${isMobile ? "mobile" : "desktop"}-chosen.png`) });
          }
        } else {
          bad(`${label}: nenhuma casa clicavel`);
        }

        console.log(`   ${label}: pill ${m.pillR ? `${Math.round(m.pillR.w)}x${Math.round(m.pillR.h)} @ (${Math.round(m.pillR.left)},${Math.round(m.pillR.top)})` : "-"} | alvos ${m.targets.map((t) => `${t.w}x${t.h}`).join(" ")} | chips h=${chipInfo.map((c) => c.h).join("/")} | console ${m.consoleH}px | linha "${m.lineText}"`);
        await context.close();
      } catch (error) {
        const msg = String(error?.message ?? error);
        const loc = msg.split("\n").find((line) => line.includes("waiting for")) ?? msg.split("\n")[0];
        bad(`${view} ${vp.name}: ${loc.trim()}`);
      }
    }
    console.log(`   ${view}: capturas em e2e/shots/houses/`);
  }
  await browser.close();
} finally {
  stop();
}

if (failures.length) {
  console.log(`\nHOUSES PILL FAIL - ${failures.length} violacao(oes)`);
  process.exit(1);
}
console.log("\nHOUSES PILL OK");
