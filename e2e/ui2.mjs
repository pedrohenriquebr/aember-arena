// Gate das telas da v2 "Forja Noturna" (UX_REWRITE_PLAN §5 H-03). Sobe o dev server
// (porta própria 5211), abre ?ui=2 e, para cada tela registrada em SCREENS, mede em 5
// viewports: overflow horizontal, alvos de toque, aria-label de botão só-ícone, piso
// tipográfico e animações com reduced-motion. Sai != 0 se algum critério falhar.
// Uso: npm run e2e:ui2   (SCREENS vazio = só o boot da v2, sem telas)
//      node e2e/ui2.mjs --shots   (grava as telas em e2e/shots/ui2-kit/, fora do gate)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
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
// H-05: a galeria de primitivas entra como `_kit` (só com a flag, ?ui=2&screen=_kit).
// H-08: a partida na casca de mesa roda em 2D e 3D (o gate de soma); --no-table desliga para depurar.
const TABLE_VIEWS = process.argv.includes("--no-table") ? [] : ["2d", "3d"];
// H-07: `shell` é a casca do lobby na tela inicial (sem query extra).
const SCREENS = [
  { name: "_kit", query: "screen=_kit" },
  // scope: a casca do lobby é a tela; o conteúdo v1 sob ela (deck tiles com 27px) entra em H-11/H-12.
  { name: "shell", query: "", scope: '[data-screen="shell"]' },
];

const SEED = `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: false,
    hoverZoom: false, hints: false, language: "en", opponentMode: "mirror", gameMode: "solo",
  }));
  localStorage.setItem("aember-arena-language", "en");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
})()`;

// Roda no browser. Devolve só o que falhou (lista vazia = passou).
// scope (opcional): alvo, rótulo e texto medem só dentro dele; overflow e movimento seguem na página.
const AUDIT = (scope) => {
  const out = { overflow: null, targets: [], unlabeled: [], smallText: [], motion: [] };
  const root = (scope && document.querySelector(scope)) || document.body;
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
  for (const el of root.querySelectorAll("button,[role=button],a,input,select")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const min = el.hasAttribute("data-dense") ? 36 : 44;
    if (r.width < min || r.height < min) {
      out.targets.push(`${el.tagName.toLowerCase()} "${label(el)}" ${Math.round(r.width)}x${Math.round(r.height)} (min ${min})`);
    }
  }

  // 3: botão sem texto precisa de aria-label.
  for (const el of root.querySelectorAll("button")) {
    if (!visible(el) || el.textContent.trim() !== "") continue;
    if (!el.getAttribute("aria-label")) out.unlabeled.push(`button sem texto e sem aria-label (${el.className || "sem classe"})`);
  }

  // 4: texto visível >= 11px; 10px só em caps com letter-spacing >= 0.1em. Abaixo de 10px nunca.
  const seen = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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

// H-06: a Sheet abre pelo teclado (foco no gatilho + Enter), o foco entra no diálogo, o body
// trava a rolagem e Esc / fundo / X fecham devolvendo o foco ao gatilho. Com reduced-motion a
// folha não anima. Depois: setas/Home/End do SegmentedControl e o clique do Switch.
// Devolve a lista de falhas do fluxo (vazia = passou).
async function interactionFlow(browser, vp, url, shotDir) {
  const failures = [];
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
  await context.addInitScript(SEED);
  const page = await context.newPage();
  await page.goto(`${url}?ui=2&screen=_kit`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="_kit"]', { timeout: 30000 });
  const trigger = page.locator('[data-kit="sheet-trigger"]');
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');

  for (const how of ["escape", "backdrop", "close"]) {
    await trigger.focus();
    await page.keyboard.press("Enter");
    await dialog.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(600);

    const state = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"][aria-modal="true"]');
      return {
        focusInside: Boolean(d && d.contains(document.activeElement)),
        locked: document.body.style.overflow === "hidden",
        animation: d ? getComputedStyle(d).animationName : "sem diálogo",
        running: document.getAnimations().filter((a) => a.playState === "running").map((a) => a.animationName || a.constructor.name),
      };
    });
    if (!state.focusInside) failures.push(`${how}: foco não entrou no diálogo`);
    if (!state.locked) failures.push(`${how}: rolagem do body não travou`);
    if (state.animation !== "none") failures.push(`${how}: reduced-motion mas o diálogo anima (${state.animation})`);
    if (state.running.length) failures.push(`${how}: animações em curso com reduced-motion (${state.running.join(", ")})`);
    if (shotDir && how === "escape") await page.screenshot({ path: join(shotDir, `sheet-open-${vp.name}.png`) });

    if (how === "escape") await page.keyboard.press("Escape");
    else if (how === "backdrop") await page.locator(".nf-sheet-backdrop").click({ position: { x: 4, y: 4 } });
    else await dialog.locator(".nf-sheet-head button").click();
    await dialog.waitFor({ state: "detached", timeout: 5000 }).catch(() => failures.push(`${how}: diálogo não fechou`));

    const back = await page.evaluate(() => document.activeElement?.getAttribute("data-kit") ?? null);
    if (back !== "sheet-trigger") failures.push(`${how}: foco não voltou ao gatilho (ficou em ${back})`);
    const unlocked = await page.evaluate(() => document.body.style.overflow !== "hidden");
    if (!unlocked) failures.push(`${how}: rolagem do body não foi liberada`);
  }

  // SegmentedControl: setas movem e selecionam, com volta nas pontas; Home/End vão às pontas.
  const radioState = () => page.evaluate(() => {
    const radios = [...document.querySelectorAll('[role="radio"]')];
    return { checked: radios.findIndex((r) => r.getAttribute("aria-checked") === "true"), focused: radios.indexOf(document.activeElement) };
  });
  await page.locator('[role="radio"]').nth(0).focus();
  for (const [key, expected] of [["ArrowRight", 1], ["ArrowRight", 2], ["ArrowRight", 0], ["ArrowLeft", 2], ["Home", 0], ["End", 2]]) {
    await page.keyboard.press(key);
    const { checked, focused } = await radioState();
    if (checked !== expected || focused !== expected) failures.push(`radio ${key}: esperado ${expected}, marcado ${checked}, foco ${focused}`);
  }

  // Switch: clique alterna aria-checked.
  const toggle = page.locator('[role="switch"]');
  const before = await toggle.getAttribute("aria-checked");
  await toggle.click();
  const after = await toggle.getAttribute("aria-checked");
  if (before === after) failures.push(`switch não alternou (${before})`);

  await context.close();
  return failures;
}

// H-07: a casca do lobby. O Tab percorre marca → 3 destinos → mudo → idioma (a ordem do DOM);
// aria-current acende só o destino da tela; Decks e Ajustes trocam de tela sem sair da casca.
// Devolve a lista de falhas (vazia = passou).
async function shellFlow(browser, vp, url) {
  const failures = [];
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
  await context.addInitScript(SEED);
  const page = await context.newPage();
  await page.goto(`${url}?ui=2`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="shell"]', { timeout: 30000 });

  const currents = () => page.evaluate(() => [...document.querySelectorAll(".nf-shell-tab")].map((b) => b.getAttribute("aria-current") === "page"));
  const expectCurrent = async (label, expected) => {
    const got = await currents();
    if (JSON.stringify(got) !== JSON.stringify(expected)) failures.push(`${label}: aria-current ${JSON.stringify(got)}, esperado ${JSON.stringify(expected)}`);
  };
  await expectCurrent("início", [true, false, false]);

  await page.locator(".nf-shell-brand").focus();
  const order = [];
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => {
      const el = document.activeElement;
      if (el?.classList.contains("nf-shell-tab")) return "destino";
      if (el?.classList.contains("nf-btn")) return "acao";
      if (el?.classList.contains("lang-trigger")) return "idioma";
      return el?.className || el?.tagName || "?";
    }));
  }
  const expectedOrder = ["destino", "destino", "destino", "acao", "idioma"];
  if (JSON.stringify(order) !== JSON.stringify(expectedOrder)) failures.push(`ordem do Tab: ${order.join(" > ")}, esperado ${expectedOrder.join(" > ")}`);

  await page.locator(".nf-shell-tab").nth(1).click();
  await page.waitForTimeout(150);
  await expectCurrent("após Decks", [false, true, false]);

  await page.locator(".nf-shell-tab").nth(2).click();
  await page.waitForSelector(".config-screen", { timeout: 15000 }).catch(() => failures.push("Ajustes não abriu a tela de configuração"));
  await expectCurrent("após Ajustes", [false, false, true]);

  await page.locator(".nf-shell-brand").click();
  await page.waitForTimeout(150);
  await expectCurrent("após a marca", [true, false, false]);
  if (!(await page.locator('[data-screen="shell"]').count())) failures.push("a casca sumiu ao voltar ao início");

  await context.close();
  return failures;
}

// H-08: a partida na casca de mesa (data-shell="table"). Começa pela casca (Ajustes → início),
// mede a SOMA das faixas do palco na mesa vazia e com 8+8 criaturas e um artefato (a mesma conta
// do fit.mjs, que não muda). Exige: soma + respiro em [viewport-1, viewport+1] (a tolerância é a
// do fit), documento sem rolagem, mão visível. Devolve { failures, reports }; os números vão para o log.
const seedFor = (view) => SEED.replace('gameMode: "solo",', `gameMode: "solo", tableView: "${view}",`);

const TABLE_MEASURE = () => {
  const is3d = Boolean(document.querySelector(".game-board--3d"));
  const hOf = (el) => (is3d ? el.offsetHeight : el.getBoundingClientRect().height);
  const visible = (el) => Boolean(el) && getComputedStyle(el).display !== "none";
  const h = (sel) => {
    const el = document.querySelector(sel);
    return visible(el) ? hOf(el) : 0;
  };
  const all = (sel) => [...document.querySelectorAll(sel)].map(hOf);
  const px = (v) => parseFloat(v) || 0;
  const scs = getComputedStyle(document.querySelector(".game-screen"));
  const bcs = getComputedStyle(document.querySelector(".game-board"));
  const mcs = getComputedStyle(document.querySelector(".app-main"));
  const bands = all(".game-board .player-band");
  const zones = all(".game-board .battle-zone");
  const rows = {
    mainPadding: px(mcs.paddingTop) + px(mcs.paddingBottom),
    screenPadding: px(scs.paddingTop) + px(scs.paddingBottom),
    boardBorder: px(bcs.borderTopWidth) + px(bcs.borderBottomWidth),
    bandOpponent: bands[0] ?? 0,
    zoneOpponent: zones[0] ?? 0,
    console: h(".game-board .turn-console"),
    zonePlayer: zones[1] ?? 0,
    bandPlayer: bands[1] ?? 0,
    hand: h(".game-board .hand-zone"),
  };
  // Respiro do plano 3D (desktop, console no rail): a linha do meio do grid do plano fica
  // reservada por desenho (index.css, bloco .game-board--console-docked: "respiro do plano";
  // geometria calibrada H3D-14/17). É a única folga que o gate aceita, e só essa linha.
  const planeRows = document.querySelector(".game-board--3d .table-plane");
  const planeTracks = planeRows ? getComputedStyle(planeRows).gridTemplateRows.split(" ") : [];
  const respiro = is3d && document.querySelector(".game-board--console-docked") && planeTracks.length === 3 ? parseFloat(planeTracks[1]) || 0 : 0;
  const hand = [...document.querySelectorAll(".hand-track > .card-tile--hand")].map((el) => el.getBoundingClientRect().bottom);
  const boardCards = [...document.querySelectorAll(".game-board .board-lane .card-tile--board")].map((el) => el.getBoundingClientRect().width);
  return {
    is3d,
    shell: document.querySelector(".app-root")?.getAttribute("data-shell") ?? null,
    shellPresent: Boolean(document.querySelector('[data-screen="shell"]')),
    rows: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, Math.round(v * 10) / 10])),
    sum: Math.round(Object.values(rows).reduce((a, b) => a + b, 0) * 10) / 10,
    respiro: Math.round(respiro * 10) / 10,
    vp: window.innerHeight,
    docH: document.scrollingElement.scrollHeight,
    handBottom: hand.length ? Math.max(...hand) : null,
    cardMin: boardCards.length ? Math.round(Math.min(...boardCards)) : null,
    cardMax: boardCards.length ? Math.round(Math.max(...boardCards)) : null,
  };
};

// Mesa cheia (mesma receita do fit.mjs): 8 criaturas por lado + 1 artefato do jogador.
const FILL_BOARDS_TABLE = () => {
  const raw = localStorage.getItem("aember-arena-match");
  if (!raw) return "sem save";
  const saved = JSON.parse(raw);
  const game = saved.game;
  const fill = (player, n, artifact) => {
    for (const card of [...player.deck]) {
      if (player.board.length >= n + (artifact ? 1 : 0)) break;
      const from = player.hand.includes(card) ? player.hand : player.deck;
      from.splice(from.indexOf(card), 1);
      const isArtifact = artifact && player.board.length === n;
      card.face = { ...card.face, type: isArtifact ? "Artifact" : "Creature", power: 4, armor: 0, text: "" };
      card.ready = true;
      card.damage = 0;
      card.stunned = false;
      player.board.push(card);
    }
  };
  fill(game.players[0], 8, true);
  fill(game.players[1], 8, false);
  localStorage.setItem("aember-arena-match", JSON.stringify(saved));
  return "ok";
};

// H-10: o rail do desktop (>=1041) na casca. Sem carta selecionada: sem inspetor, sem topline e
// sem rodapé; o turno cabe sem reticências; o log rola por dentro e o rail não rola.
const RAIL_MEASURE = () => {
  const out = [];
  const rail = document.querySelector(".command-rail");
  if (!rail) return ["rail ausente"];
  const shown = (sel) => [...rail.querySelectorAll(`:scope > ${sel}`)].filter((el) => getComputedStyle(el).display !== "none");
  if (shown(".rail-topline").length) out.push("topline ainda visível");
  if (shown(".rail-footer").length) out.push("rodapé ainda visível");
  if (shown(".inspector-section").length) out.push("inspetor visível sem seleção");
  const line = rail.querySelector(".turn-line");
  if (line && line.scrollWidth > line.clientWidth + 1) out.push(`turno corta: ${line.scrollWidth} > ${line.clientWidth}`);
  const log = rail.querySelector(":scope > .log-section > .match-log");
  if (!log) out.push("log ausente");
  else if (getComputedStyle(log).overflowY !== "auto") out.push(`log sem rolagem própria (${getComputedStyle(log).overflowY})`);
  if (rail.scrollHeight > rail.clientHeight + 1) out.push(`rail rola (${rail.scrollHeight} > ${rail.clientHeight}); deveria rolar só o log`);
  const h = rail.getBoundingClientRect().height;
  if (h > Math.max(520, window.innerHeight - 92) + 1) out.push(`rail mais alto que a mesa (${Math.round(h)} > ${window.innerHeight - 92})`);
  return out;
};

// Casca -> Ajustes -> partida demo (mulligan mantido) -> turno do jogador pronto.
async function openTable(page, url) {
  await page.goto(`${url}?ui=2`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="shell"]', { timeout: 30000 });
  await page.locator(".nf-shell-tab").nth(2).click();
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
}

async function tableFlow(browser, vp, url, view) {
  const failures = [];
  const reports = [];
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
  await context.addInitScript(seedFor(view));
  const page = await context.newPage();
  await openTable(page, url);

  const check = (m, label) => {
    reports.push(`${label}: soma=${m.sum} respiro=${m.respiro} vp=${m.vp} docH=${m.docH} zonaOp=${m.rows.zoneOpponent} carta=${m.cardMin}-${m.cardMax} maoBottom=${m.handBottom}`);
    if (m.shell !== "table") failures.push(`${label}: data-shell=${m.shell}, esperado "table"`);
    if (m.shellPresent) failures.push(`${label}: a casca do lobby apareceu na partida`);
    // Tolerância igual à do fit.mjs (+1px de arredondamento do 3D); o respiro é somado à conta.
    const accounted = m.sum + m.respiro;
    if (accounted < m.vp - 1 || accounted > m.vp + 1) failures.push(`${label}: soma ${accounted} fora de [${m.vp - 1}, ${m.vp + 1}] (respiro ${m.respiro})`);
    if (m.docH > m.vp + 1) failures.push(`${label}: documento rola (docH ${m.docH} > ${m.vp})`);
    if (m.handBottom !== null && m.handBottom > m.vp + 0.5 && !m.is3d) failures.push(`${label}: mão cortada (bottom ${m.handBottom} > ${m.vp})`);
  };
  check(await page.evaluate(TABLE_MEASURE), "mesa vazia");
  if (vp.width >= 1041) {
    const railIssues = await page.evaluate(RAIL_MEASURE);
    reports.push(`trilho: ${railIssues.length ? railIssues.join("; ") : "ok"}`);
    for (const issue of railIssues) failures.push(`trilho: ${issue}`);
  }

  // Mesa cheia: patch do save e retomada pela home da casca (resume-bar).
  const patched = await page.evaluate(FILL_BOARDS_TABLE);
  if (patched === "ok") {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-screen="shell"]', { timeout: 20000 });
    await page.locator(".resume-bar").first().click();
    await page.waitForSelector(".game-screen", { timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector(".end-turn-button")?.disabled, null, { timeout: 60000 });
    await page.waitForTimeout(700);
    check(await page.evaluate(TABLE_MEASURE), "8x8+artefato");
  } else {
    failures.push(`mesa cheia não preparada: ${patched}`);
  }

  await context.close();
  return { failures, reports };
}

// H-09: o ☰ da mesa. Abre pelo gatilho (Enter) com o foco na folha; a folha passa no AUDIT (alvos
// 44px, rótulos, piso tipográfico); Esc fecha e devolve o foco ao ☰. O interruptor 3D troca a mesa
// sem fechar a folha. Esc abre o ☰ só no desktop (>=1041), sem nada selecionado. "Sair para o
// lobby" pede confirmação; confirmado, o lobby abre com "Continuar" (a partida fica salva).
// Devolve a lista de falhas (vazia = passou).
async function menuFlow(browser, vp, url) {
  const failures = [];
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
  await context.addInitScript(seedFor("2d"));
  const page = await context.newPage();
  await openTable(page, url);
  const desktop = vp.width >= 1041;
  const trigger = page.locator(".table-menu-trigger");
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  const focusOnTrigger = () => page.evaluate(() => document.activeElement?.classList.contains("table-menu-trigger") ?? false);

  if ((await trigger.count()) !== 1) failures.push(`☰ da mesa: ${await trigger.count()} gatilhos, esperado 1`);
  await trigger.focus();
  await page.keyboard.press("Enter");
  await dialog.waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("Enter no ☰ não abriu a folha"));
  await page.waitForTimeout(600);

  const focusInside = await page.evaluate(() => Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')?.contains(document.activeElement)));
  if (!focusInside) failures.push("☰: foco não entrou na folha");
  const audit = await page.evaluate(AUDIT, '[role="dialog"][aria-modal="true"]');
  for (const [key, items] of Object.entries(audit)) {
    if (Array.isArray(items) ? items.length : items !== null) failures.push(`☰ ${key}: ${Array.isArray(items) ? items.slice(0, 4).join("; ") : items}`);
  }

  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached", timeout: 5000 }).catch(() => failures.push("Esc não fechou o ☰"));
  if (!(await focusOnTrigger())) failures.push("☰ fechado: foco não voltou ao gatilho");

  // Esc abre só no desktop; no celular a tecla não faz nada na mesa.
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const openedByKey = (await dialog.count()) > 0;
  if (desktop && !openedByKey) failures.push("Esc no desktop não abriu o ☰");
  if (!desktop && openedByKey) failures.push("Esc abriu o ☰ no celular (só vale no desktop)");

  if (desktop) {
    // Interruptor 3D: troca a mesa e a folha segue aberta.
    const sw = dialog.locator('[role="switch"]').first();
    const before = await sw.getAttribute("aria-checked");
    await sw.click();
    await page.waitForTimeout(300);
    const after = await sw.getAttribute("aria-checked");
    const is3d = await page.evaluate(() => Boolean(document.querySelector(".game-board--3d")));
    if (before === after) failures.push("interruptor 3D não alternou");
    if (is3d !== (after === "true")) failures.push(`mesa ${is3d ? "3D" : "2D"} não bate com o interruptor (${after})`);
    if ((await dialog.count()) === 0) failures.push("interruptor 3D fechou a folha");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached", timeout: 5000 }).catch(() => failures.push("Esc não fechou o ☰ (2)"));
  }

  // Sair: a confirmação pede; Esc cancela e a partida segue.
  const confirm = page.getByRole("button", { name: "Leave", exact: true });
  await trigger.click();
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  await dialog.getByRole("button", { name: "Leave to lobby", exact: true }).click();
  await confirm.waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("sair não abriu a confirmação"));
  await page.keyboard.press("Escape");
  await confirm.waitFor({ state: "detached", timeout: 5000 }).catch(() => failures.push("Esc não cancelou a confirmação de saída"));
  if (!(await page.locator(".game-screen").count())) failures.push("cancelar a saída tirou a partida da tela");

  // Confirmado: o lobby abre e o destino de jogo diz "Continuar" (a partida foi salva).
  await trigger.click();
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  await dialog.getByRole("button", { name: "Leave to lobby", exact: true }).click();
  await confirm.click();
  await page.waitForSelector('[data-screen="shell"]', { timeout: 15000 }).catch(() => failures.push("sair não voltou ao lobby"));
  const playLabel = await page.locator(".nf-shell-tab").first().textContent();
  if (!/Continu/.test(playLabel ?? "")) failures.push(`lobby após sair: destino de jogo "${playLabel}", esperado "Continuar"`);

  await context.close();
  return failures;
}

const server = startServer();
let browser;
let problems = 0;
// --shots grava as telas e a folha aberta em e2e/shots/ui2-kit/ (fora do gate: é para olhar).
const shotDir = process.argv.includes("--shots") ? join(ROOT, "e2e", "shots", "ui2-kit") : null;
if (shotDir) mkdirSync(shotDir, { recursive: true });
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
      const audit = await p.evaluate(AUDIT, screen.scope ?? null);
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
      if (shotDir) await p.screenshot({ path: join(shotDir, `${screen.name}-${vp.name}.png`), fullPage: true });
      await ctx.close();
    }

    if (SCREENS.some((screen) => screen.name === "_kit")) {
      const failures = await interactionFlow(browser, vp, server.url, shotDir);
      if (failures.length) {
        problems += 1;
        console.log(`[flow ${vp.name}] FALHA`);
        for (const failure of failures) console.log(`    ${failure}`);
      } else {
        console.log(`[flow ${vp.name}] OK`);
      }
    }

    for (const view of TABLE_VIEWS) {
      const { failures, reports } = await tableFlow(browser, vp, server.url, view);
      for (const line of reports) console.log(`[table ${view} ${vp.name}] ${line}`);
      if (failures.length) {
        problems += 1;
        console.log(`[table ${view} ${vp.name}] FALHA`);
        for (const failure of failures) console.log(`    ${failure}`);
      } else {
        console.log(`[table ${view} ${vp.name}] OK`);
      }
    }

    if (TABLE_VIEWS.length) {
      const failures = await menuFlow(browser, vp, server.url);
      if (failures.length) {
        problems += 1;
        console.log(`[menu ${vp.name}] FALHA`);
        for (const failure of failures) console.log(`    ${failure}`);
      } else {
        console.log(`[menu ${vp.name}] OK`);
      }
    }

    if (SCREENS.some((screen) => screen.name === "shell")) {
      const failures = await shellFlow(browser, vp, server.url);
      if (failures.length) {
        problems += 1;
        console.log(`[shell-flow ${vp.name}] FALHA`);
        for (const failure of failures) console.log(`    ${failure}`);
      } else {
        console.log(`[shell-flow ${vp.name}] OK`);
      }
    }
  }
} finally {
  if (browser) await browser.close();
  server.stop();
}

if (!SCREENS.length) console.log("\n(SCREENS vazio: só o boot da v2 foi verificado)");
console.log(problems ? `\nUI2 FAIL - ${problems} violacao(oes)` : "\nUI2 OK");
process.exit(problems ? 1 : 0);
