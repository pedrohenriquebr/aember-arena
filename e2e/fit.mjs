// Harness de encaixe (UX_FIT_PLAN FIT-01): a partida demo tem de caber inteira no
// viewport, sem rolar o documento, com a mão 100% visível. Imprime a altura medida
// de cada faixa para diagnóstico e sai != 0 se algum cenário violar.
// Uso: node e2e/fit.mjs   (sobe e derruba o dev server)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5209;
// H3D-13: `--view 3d` roda o mesmo encaixe com a mesa inclinada (mao em overlay).
const VIEW3D = process.argv.includes("--view") && process.argv[process.argv.indexOf("--view") + 1] === "3d";
const VIEWPORTS = [
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1296x668", width: 1296, height: 668 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "360x844", width: 360, height: 844 },
  { name: "390x844", width: 390, height: 844 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "768x1024", width: 768, height: 1024 },
];
const SEED = () => `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: false,
    hoverZoom: false, hints: false, language: "en", opponentMode: "mirror", gameMode: "solo",${VIEW3D ? ' tableView: "3d",' : ""}
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

// Roda no browser: alturas por faixa + retângulos da mão.
const MEASURE = () => {
  const visible = (el) => el && getComputedStyle(el).display !== "none";
  // No 3D o bbox e PROJETADO (o plano encurta): a altura de layout e o offsetHeight.
  const is3d = Boolean(document.querySelector(".game-board--3d"));
  const hOf = (el) => (is3d ? el.offsetHeight : el.getBoundingClientRect().height);
  const h = (sel) => {
    const el = document.querySelector(sel);
    return visible(el) ? hOf(el) : 0;
  };
  const all = (sel) => [...document.querySelectorAll(sel)].map(hOf);
  const px = (v) => parseFloat(v) || 0;
  const scs = getComputedStyle(document.querySelector(".game-screen"));
  const bcs = getComputedStyle(document.querySelector(".game-board"));
  const heading = document.querySelector(".match-heading");
  const tabs = document.querySelector(".mobile-tabs");
  const bands = all(".game-board .player-band");
  const zones = all(".game-board .battle-zone");
  const rows = {
    header: h(".app-header"),
    screenPadding: px(scs.paddingTop) + px(scs.paddingBottom),
    title: visible(heading) && getComputedStyle(heading).position !== "absolute" ? heading.getBoundingClientRect().height + px(getComputedStyle(heading).marginBottom) : 0,
    boardBorder: px(bcs.borderTopWidth) + px(bcs.borderBottomWidth),
    bandOpponent: bands[0] ?? 0,
    zoneOpponent: zones[0] ?? 0,
    console: h(".game-board .turn-console"),
    zonePlayer: zones[1] ?? 0,
    bandPlayer: bands[1] ?? 0,
    hand: h(".game-board .hand-zone"),
    tabs: visible(tabs) ? tabs.getBoundingClientRect().height : 0,
  };
  // Conteúdo maior que a faixa que o contém (diagnóstico do que transborda).
  const overflow = [".game-board .player-band", ".game-board .battle-zone", ".game-board .turn-console", ".game-board .hand-zone", ".game-board .hand-track"]
    .flatMap((sel) => [...document.querySelectorAll(sel)].map((el, i) => (el.scrollHeight > el.clientHeight + 1 ? `${sel.split(" ").pop()}[${i}] ${el.scrollHeight}>${el.clientHeight}` : null)))
    .filter(Boolean);
  // Peças do board que vazam da própria zona (a carta tem de caber na altura dela).
  const spill = is3d ? [] : [...document.querySelectorAll(".game-board .battle-zone")].flatMap((zone, zi) => {
    const zr = zone.getBoundingClientRect();
    return [...zone.querySelectorAll(".board-piece")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top < zr.top - 1 || r.bottom > zr.bottom + 1;
    }).map(() => zi);
  });
  if (spill.length) overflow.push(`pecas fora da zona: ${spill.length}`);
  const round = (n) => Math.round(n * 10) / 10;
  const sum = Object.values(rows).reduce((a, b) => a + b, 0);
  const hand = [...document.querySelectorAll(".hand-track > .card-tile--hand")].map((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom };
  });
  const boardBottom = document.querySelector(".game-board").getBoundingClientRect().bottom;
  const boardCards = [...document.querySelectorAll(".game-board .board-lane .card-tile--board")].map((el) => el.getBoundingClientRect().width);
  return {
    rows: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, round(v)])),
    sum: round(sum),
    docScroll: document.scrollingElement.scrollHeight,
    where: [".app-header", ".game-screen", ".workspace", ".main-column", ".game-board"].map((q) => { const r = document.querySelector(q).getBoundingClientRect(); const pv = q === ".game-screen" ? (document.querySelector(q).previousElementSibling?.className ?? "") : ""; return `${pv}|${q}=${Math.round(r.top)}..${Math.round(r.bottom)}`; }).join(" "),
    innerHeight: window.innerHeight,
    hand,
    is3d,
    boardBottom,
    // VA-01: o board nao pode estourar na horizontal (console/faixas cortados).
    // No 3D o scrollWidth do board inclui a PROJECAO do plano (perspectiva alarga a
    // frente de proposito): ali vale o layout das faixas planas e do plano (offsetWidth).
    boardScrollW: is3d ? Math.max(...[...document.querySelectorAll(".game-board .player-band, .game-board .turn-console")].map((el) => el.scrollWidth), document.querySelector(".game-board .table-plane")?.offsetWidth ?? 0) : document.querySelector(".game-board").scrollWidth,
    boardClientW: document.querySelector(".game-board").clientWidth,
    overflow,
    boardCardMin: boardCards.length ? round(Math.min(...boardCards)) : null,
    boardCardMax: boardCards.length ? round(Math.max(...boardCards)) : null,
  };
};

// Move cartas da mão/baralho para a mesa (criaturas prontas; 1 artefato do jogador).
const FILL_BOARDS = () => {
  const raw = localStorage.getItem("aember-arena-match");
  if (!raw) return "sem save";
  const saved = JSON.parse(raw);
  const game = saved.game;
  const fill = (player, n, artifact) => {
    const pool = [...player.deck];
    let i = 0;
    for (const card of pool) {
      if (player.board.length >= n + (artifact ? 1 : 0)) break;
      const from = player.hand.includes(card) ? player.hand : player.deck;
      from.splice(from.indexOf(card), 1);
      const isArtifact = artifact && player.board.length === n;
      card.face = { ...card.face, type: isArtifact ? "Artifact" : "Creature", power: 4, armor: 0, text: "" };
      card.ready = true;
      card.damage = 0;
      card.stunned = false;
      player.board.push(card);
      i += 1;
    }
  };
  fill(game.players[0], 8, true);
  fill(game.players[1], 8, false);
  localStorage.setItem("aember-arena-match", JSON.stringify(saved));
  return { p: game.players[0].board.length, e: game.players[1].board.length };
};

async function report(page, vp, label) {
    const m = await page.evaluate(MEASURE);
    const problems = [];
    // Abaixo de 1041px o rail e um drawer (FIT-05), mas o celular ainda rola (FIT-06).
    if (vp.width >= 701 && m.docScroll > m.innerHeight + 1) problems.push(`documento rola: scrollHeight ${m.docScroll} > ${m.innerHeight}`);
    if (m.sum > m.innerHeight + 1) problems.push(`soma das faixas ${m.sum} > viewport ${m.innerHeight}`);
    // 3D: a mao e overlay cortado pela borda do board; cada carta mostra >= 70%.
    const cut = m.is3d
      ? m.hand.filter((r) => (Math.min(r.bottom, m.boardBottom) - Math.max(r.top, 0)) / (r.bottom - r.top) < 0.7)
      : m.hand.filter((r) => r.top < 0 || r.bottom > m.innerHeight + 0.5);
    if (m.boardScrollW > m.boardClientW + 1) problems.push(`board estoura na horizontal: scrollWidth ${m.boardScrollW} > clientWidth ${m.boardClientW}`);
    if (!m.hand.length) problems.push("mao vazia/ausente");
    else if (cut.length) problems.push(`mao cortada: ${cut.length}/${m.hand.length} cartas fora (bottom max ${Math.max(...m.hand.map((r) => r.bottom)).toFixed(0)} > ${m.innerHeight})`);

    console.log(`\n== ${vp.name} [${label}] ${problems.length ? "FAIL" : "OK"}`);
    console.log(`   faixas: ${Object.entries(m.rows).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    console.log(`   soma=${m.sum} viewport=${m.innerHeight} docScroll=${m.docScroll} cartaBoard=${m.boardCardMin}-${m.boardCardMax}px mao=${m.hand.length} (bottom ${m.hand.length ? Math.max(...m.hand.map((r) => r.bottom)).toFixed(0) : "-"})`);
    if (problems.length) console.log(`   onde: ${m.where}`);
    if (m.overflow.length) console.log(`   transborda: ${m.overflow.join(", ")}`);
    for (const p of problems) {
      console.log(`   ! ${p}`);
      failures.push(`${vp.name} [${label}]: ${p}`);
    }
}

// FIT-05: o drawer abre pelo botao do console, guarda as funcoes do rail, fecha com
// Esc/backdrop/X e devolve o foco ao botao.
async function checkDrawer(page, vp) {
  const bad = (msg) => { console.log(`   ! drawer: ${msg}`); failures.push(`${vp.name} [drawer]: ${msg}`); };
  const btn = page.locator('button[aria-controls="command-rail"]');
  if (!(await btn.count())) return bad("botao do drawer ausente");
  const box = await btn.boundingBox();
  if (!box || box.width < 44 || box.height < 44) bad(`alvo < 44px (${box?.width}x${box?.height})`);
  const rail = page.locator(".command-rail");
  for (const how of ["Escape", "backdrop", "X"]) {
    await btn.click();
    await page.waitForTimeout(150);
    if (!(await rail.evaluate((el) => el.classList.contains("is-open")))) return bad("nao abriu");
    if (how === "Escape") {
      const found = await page.evaluate(() => [".undo-button", ".log-full-button", ".ai-brief", ".quick-rules"].filter((q) => !document.querySelector(q) || getComputedStyle(document.querySelector(q)).display === "none"));
      if (found.length) bad(`funcoes ausentes no drawer: ${found.join(",")}`);
      await page.keyboard.press("Escape");
    } else if (how === "backdrop") {
      await page.mouse.click(5, 5);
    } else {
      await page.locator(".rail-close").click();
    }
    await page.waitForTimeout(150);
    if (await rail.evaluate((el) => el.classList.contains("is-open"))) bad(`nao fechou via ${how}`);
  }
  if (!(await page.evaluate(() => document.activeElement?.getAttribute("aria-controls") === "command-rail"))) bad("foco nao voltou ao botao");
  console.log(`   drawer ${failures.some((f) => f.includes(`${vp.name} [drawer]`)) ? "FAIL" : "OK"}`);
}

const failures = [];
const server = startServer();
try {
  await server.ready();
  const browser = await launch();
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
    await context.addInitScript(SEED());
    const page = await context.newPage();
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".home-screen", { timeout: 30000 });
    // JS click: no celular o header-nav some (a navegação é a tab bar).
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
    await page.waitForTimeout(700);

    await report(page, vp, "vazia");

    // Mesa cheia: 8 criaturas por lado + 1 artefato do jogador (patch do save).
    const patched = await page.evaluate(FILL_BOARDS);
    if (typeof patched === "string") {
      console.log(`   (mesa cheia pulada: ${patched})`);
    } else {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector(".home-screen", { timeout: 20000 });
      await page.locator(".resume-bar").first().click();
      await page.waitForSelector(".game-screen", { timeout: 20000 });
      await page.waitForFunction(() => !document.querySelector(".end-turn-button")?.disabled, null, { timeout: 60000 });
      await page.waitForTimeout(700);
      await report(page, vp, "8x8+artefato");
    }
    if (vp.width < 1041) await checkDrawer(page, vp);
    await context.close();
  }
  await browser.close();
} finally {
  server.stop();
}
if (failures.length) {
  console.log(`\nFIT FAIL - ${failures.length} violacao(oes)`);
  process.exit(1);
}
console.log("\nFIT OK");
