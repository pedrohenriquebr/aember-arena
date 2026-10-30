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
import { closeSavedMatch, readResult, resultProblems } from "./ui2-fixtures.mjs";

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
// H-ATL-03: a Layout Arena (tcg) entra no mesmo fluxo; a conta vira as trilhas do grid (TABLE_MEASURE).
const TABLE_VIEWS = process.argv.includes("--no-table") ? [] : ["2d", "3d", "tcg"];
// H-07: `shell` é a casca do lobby na tela inicial (sem query extra).
const SCREENS = [
  { name: "_kit", query: "screen=_kit" },
  // scope: a casca do lobby é a tela; o conteúdo v1 sob ela (deck tiles com 27px) entra em H-11/H-12.
  { name: "shell", query: "", scope: '[data-screen="shell"]' },
  // H-12: o Lobby (S2) e os estados C (loading) e V (empty) por query; o rótulo separa os três no log.
  { name: "lobby", query: "", scope: '[data-screen="lobby"]' },
  { name: "lobby", label: "lobby-loading", query: "state=loading", scope: '[data-screen="lobby"]' },
  { name: "lobby", label: "lobby-empty", query: "state=empty", scope: '[data-screen="lobby"]' },
  // H-18: Ajustes (S7) abre direto por ?screen=settings; a aba Jogo é a medida aqui, a Interface no settingsFlow.
  { name: "settings", query: "screen=settings", scope: '[data-screen="settings"]' },
  // H-28: a Biblioteca (S4) abre direto por ?screen=browse; a entrada dela (.nf-screen-enter) entra no item 5.
  { name: "library", query: "screen=browse", scope: '[data-screen="library"]' },
];

// H-02c: --theme <id> semeia o tema salvo e roda os checks naquele tema (forja é o padrão).
const THEME = process.argv.includes("--theme") ? process.argv[process.argv.indexOf("--theme") + 1] : null;
if (THEME !== null && !["forja", "aco", "claro", "arcano"].includes(THEME)) {
  console.error(`ui2: tema desconhecido "${THEME}" (forja | aco | claro | arcano)`);
  process.exit(2);
}
const SEED = `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: false,
    hoverZoom: false, hints: false, language: "en", opponentMode: "mirror", gameMode: "solo",
  }));
  localStorage.setItem("aember-arena-language", "en");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
  ${THEME ? `localStorage.setItem("aember-arena-theme", "${THEME}");` : ""}
})()`;

// Roda no browser. Devolve só o que falhou (lista vazia = passou). Async só por causa do
// settle do movimento (item 5): o page.evaluate espera a promessa.
// scope (opcional): alvo, rótulo e texto medem só dentro dele; overflow e movimento seguem na página.
const AUDIT = async (scope) => {
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
  // Julgar uma amostra única flakeia sob carga: uma transição de 150ms ainda no meio conta
  // como "rodando". Por isso o gate ESPERA o settle (poll de getAnimations, teto 2s) e só
  // falha se a animação persistir após o teto — aí lista os elementos.
  const motionLeft = () => {
    const left = [];
    for (const anim of document.getAnimations()) {
      if (anim.playState !== "running") continue;
      const timing = anim.effect?.getComputedTiming();
      const decor = anim.effect?.target?.closest?.("[data-decor]");
      if (timing?.iterations === Infinity && decor) continue;
      // Diagnóstico: propriedade em transição + marcação do alvo (o className de <img> e de quem
      // não tem classe volta vazio e antes saía "?", sem dizer qual elemento era).
      const target = anim.effect?.target;
      const prop = anim.transitionProperty || anim.animationName || anim.constructor.name;
      left.push(`${prop} em ${target?.className || "?"} <${target?.outerHTML?.slice(0, 100) ?? "sem alvo"}>`);
    }
    return left;
  };
  const deadline = performance.now() + 2000;
  let left = motionLeft();
  while (left.length && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    left = motionLeft();
  }
  out.motion = left;

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

// H-02b: um tema gravado inválido ("lixo") não quebra o boot: o motor cai no padrão, tira o
// data-theme da raiz e a Forja (--nf-void) vale. Sem erro de página. Devolve as falhas.
async function themeFlow(browser, vp, url) {
  const failures = [];
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
  await context.addInitScript(SEED);
  await context.addInitScript(`localStorage.setItem("aember-arena-theme", "lixo")`);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${url}?ui=2`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="shell"]', { timeout: 30000 });
  const state = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme ?? null,
    void: getComputedStyle(document.documentElement).getPropertyValue("--nf-void").trim(),
  }));
  if (state.theme !== null) failures.push(`data-theme ficou "${state.theme}" após boot com valor inválido`);
  if (state.void !== "#0d0f0c") failures.push(`--nf-void é "${state.void}", esperado o da Forja`);
  if (errors.length) failures.push(`erro de página: ${errors.join("; ")}`);
  await context.close();
  return failures;
}

// H-18 (§5 H-18): Ajustes › Interface. Clicar no tema troca data-theme NO MESMO FRAME (o clique
// é síncrono, lido logo depois) e persiste; "forja" tira o atributo; os 4 cartões têm --nf-accent
// distinto; setas movem o foco e Enter/Espaço aplicam; recarregar mantém o tema SEM flash: o
// primeiro backgroundColor do shell já é o --nf-void do tema salvo. Todas as abas são auditadas.
const FLASH_PROBE = `(() => {
  let first = null;
  const look = () => {
    if (first !== null) return;
    const shell = document.querySelector(".nf-shell");
    if (shell) { first = getComputedStyle(shell).backgroundColor; window.__firstShellBg = first; }
  };
  new MutationObserver(look).observe(document, { childList: true, subtree: true });
})();`;

async function settingsFlow(browser, vp, url, shotDir) {
  const failures = [];
  // Sem SEED aqui: ele regravaria o tema a cada navegação e o reload abaixo não provaria nada.
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
  await context.addInitScript(`localStorage.setItem("aember-arena-tutorial-seen", "1")`);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // A aba Jogo abre por padrão; os cartões de tema vivem na Interface.
  const openInterface = async () => {
    await page.locator('[data-screen="settings"] [role="tab"]', { hasText: /Interface/ }).click();
    await page.waitForSelector('[data-screen="settings"] .u-theme-card', { timeout: 30000 });
  };
  await page.goto(`${url}?ui=2&screen=settings`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="settings"]', { timeout: 30000 });
  await openInterface();
  if (shotDir) await page.screenshot({ path: join(shotDir, `settings-theme-${vp.name}.png`) });
  const cardOf = (id) => page.locator(`.u-theme-card[data-theme="${id}"]`);
  const activeTheme = () => page.evaluate(() => document.activeElement?.getAttribute("data-theme") ?? null);
  const appliedTheme = () => page.evaluate(() => document.documentElement.dataset.theme ?? null);

  // Clique: o dataset já está novo quando o clique devolve o controle (mesmo frame).
  const sameFrame = await page.evaluate(() => {
    document.querySelector('.u-theme-card[data-theme="aco"]').click();
    return document.documentElement.dataset.theme ?? null;
  });
  if (sameFrame !== "aco") failures.push(`clique em aco: data-theme "${sameFrame}" no mesmo frame, esperado "aco"`);
  const stored = await page.evaluate(() => localStorage.getItem("aember-arena-theme"));
  if (stored !== "aco") failures.push(`localStorage após aco: "${stored}", esperado "aco"`);

  await cardOf("forja").click();
  if (await page.evaluate(() => document.documentElement.hasAttribute("data-theme"))) failures.push("forja deixou data-theme na raiz (deveria remover)");

  const accents = await page.evaluate(() => [...document.querySelectorAll(".u-theme-card")].map((el) => getComputedStyle(el).getPropertyValue("--nf-accent").trim()));
  if (accents.length !== 4 || new Set(accents).size !== 4) failures.push(`--nf-accent dos 4 cartões não é distinto: ${accents.join(" | ")}`);

  // Teclado: a seta move só o foco; Enter e Espaço aplicam.
  await cardOf("forja").focus();
  await page.keyboard.press("ArrowRight");
  if ((await activeTheme()) !== "aco") failures.push(`seta direita: foco em "${await activeTheme()}", esperado "aco"`);
  if ((await appliedTheme()) !== null) failures.push("seta mudou o tema (deveria só mover o foco)");
  await page.keyboard.press("Enter");
  if ((await appliedTheme()) !== "aco") failures.push(`Enter no foco: tema "${await appliedTheme()}", esperado "aco"`);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  if ((await appliedTheme()) !== "claro") failures.push(`Espaço no foco: tema "${await appliedTheme()}", esperado "claro"`);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  if ((await activeTheme()) !== "forja") failures.push(`setas à esquerda: foco em "${await activeTheme()}", esperado "forja"`);

  // Persistência e reload sem flash: o tema salvo é o arcano, lido de volta no MESMO storage.
  await cardOf("arcano").click();
  await context.addInitScript(FLASH_PROBE);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="settings"]', { timeout: 30000 });
  await openInterface();
  const reload = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--nf-void)";
    document.body.append(probe);
    const voidColor = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { theme: document.documentElement.dataset.theme ?? null, first: window.__firstShellBg, voidColor };
  });
  if (reload.theme !== "arcano") failures.push(`reload: data-theme "${reload.theme}", esperado "arcano"`);
  if (reload.first !== reload.voidColor) failures.push(`reload com flash: 1º fundo do shell ${reload.first}, --nf-void do tema salvo ${reload.voidColor}`);

  // Auditoria de TODAS as abas: cada uma é aberta antes de medir (alvos, texto, movimento).
  // O settle de 600ms é o do critério 5 (H-03): nada pode seguir em curso depois dele.
  const tabs = page.locator('[data-screen="settings"] [role="tab"]');
  const tabCount = await tabs.count();
  for (let index = 0; index < tabCount; index += 1) {
    await tabs.nth(index).click();
    await page.waitForTimeout(700);
    if (shotDir) await page.screenshot({ path: join(shotDir, `settings-tab${index}-${vp.name}.png`) });
    const audit = await page.evaluate(AUDIT, '[data-screen="settings"]');
    if (failed(audit)) {
      for (const [key, items] of Object.entries(audit)) {
        if (Array.isArray(items) ? items.length : items !== null) failures.push(`aba ${index} ${key}: ${Array.isArray(items) ? items.slice(0, 6).join("; ") : items}`);
      }
    }
  }
  if (errors.length) failures.push(`erro de página: ${errors.join("; ")}`);
  await context.close();
  return failures;
}

// H-19 (§5 H-19): Ajustes › Dados e offline. O catálogo vem MOCKADO (a rota do Vault
// responde páginas com atraso): a barra de progresso avança (n/total) e o Cancelar
// interrompe entre páginas, com o botão de sync de volta ao repouso. O status do app
// mostra o BUILD_ID lido do sw.js e documenta o ?swreset=1; nunca um texto "ONLINE" fixo.
async function dataFlow(browser, vp, url, shotDir) {
  const failures = [];
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
  await context.addInitScript(SEED);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Mock do Master Vault: cartas novas por página e latência para o cancelo cair entre páginas.
  await page.route((target) => target.href.includes("keyforgegame.com/api/decks"), async (route) => {
    await new Promise((r) => setTimeout(r, 150));
    const pageNo = Number(new URL(route.request().url()).searchParams.get("page")) || 1;
    const cards = Array.from({ length: 4 }, (_, i) => ({
      id: `mock-${pageNo}-${i}`,
      card_title: `Mock ${pageNo}-${i}`,
      house: "brobnar",
      card_type: "Action",
      card_text: `Mock effect ${pageNo}-${i}.`,
    }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 40, data: [], _linked: { cards } }) });
  });

  await page.goto(`${url}?ui=2&screen=settings`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="settings"]', { timeout: 30000 });
  await page.locator('[data-screen="settings"] [role="tab"]', { hasText: /Data|Dados/ }).click();
  await page.waitForSelector('[data-screen="settings"] .u-settings-card', { timeout: 15000 });
  if (shotDir) await page.screenshot({ path: join(shotDir, `settings-data-${vp.name}.png`) });

  // Sincronizar: a barra aparece e o valor avança além da primeira página.
  await page.locator('[data-screen="settings"] .u-settings-actions button').first().click();
  await page.waitForSelector('[data-screen="settings"] [role="progressbar"]', { timeout: 5000 }).catch(() => failures.push("barra de progresso não apareceu ao sincronizar"));
  if (shotDir) await page.screenshot({ path: join(shotDir, `settings-data-progress-${vp.name}.png`) });
  await page.waitForFunction(() => {
    const bar = document.querySelector('[data-screen="settings"] [role="progressbar"]');
    return Boolean(bar) && Number(bar.getAttribute("aria-valuenow")) >= 2;
  }, undefined, { timeout: 15000 }).catch(() => failures.push("barra não progrediu (aria-valuenow < 2)"));

  // Cancelar: a barra some e o sync volta a ficar habilitado.
  await page.locator('[data-screen="settings"] button', { hasText: /^Cancel/ }).click();
  await page.waitForSelector('[data-screen="settings"] [role="progressbar"]', { state: "detached", timeout: 5000 }).catch(() => failures.push("barra não sumiu após cancelar"));
  if (await page.locator('[data-screen="settings"] .u-settings-actions button').first().isDisabled()) {
    failures.push("botão de sync segue desabilitado após cancelar");
  }

  // Status do app: BUILD_ID preenchido, ?swreset=1 documentado e nenhum "ONLINE" fixo.
  const text = await page.evaluate(() => document.querySelector('[data-screen="settings"]')?.innerText ?? "");
  const build = await page.evaluate(() => document.querySelector(".u-build-id")?.textContent ?? "");
  if (!build.trim()) failures.push("linha do BUILD_ID vazia");
  if (!text.includes("?swreset=1")) failures.push("?swreset=1 não documentado na aba Dados");
  if (/\bONLINE\b/.test(text)) failures.push(`texto "ONLINE" fixo na aba Dados: "${text.match(/\bONLINE\b.*/)?.[0]}"`);
  // ART_OFFLINE: o card de artes existe e avisa o custo de quota (~7 MB por arte no contador).
  if ((await page.locator('[data-screen="settings"] .u-art').count()) !== 1) failures.push('card "Artes offline" ausente na aba Dados');
  if (!text.includes("7 MB")) failures.push('aviso de custo das artes (7 MB) ausente na aba Dados');

  // O toast do cancelar acaba de nascer: o settle de 600ms (critério 5) o deixa terminar.
  await page.waitForTimeout(700);
  const audit = await page.evaluate(AUDIT, '[data-screen="settings"]');
  if (failed(audit)) {
    for (const [key, items] of Object.entries(audit)) {
      if (Array.isArray(items) ? items.length : items !== null) failures.push(`aba Dados ${key}: ${Array.isArray(items) ? items.slice(0, 6).join("; ") : items}`);
    }
  }
  if (errors.length) failures.push(`erro de página: ${errors.join("; ")}`);
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
  await page.waitForSelector('[data-screen="settings"]', { timeout: 15000 }).catch(() => failures.push("Ajustes não abriu a tela de Ajustes da v2"));
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
  // H-ATL-03: na variante as bandas e o console são `display: contents` (sem altura própria); a
  // conta é a das trilhas do grid do palco. O 2D e o 3D seguem com as faixas de sempre.
  const isTcg = Boolean(document.querySelector(".game-board--tcg"));
  const base = {
    mainPadding: px(mcs.paddingTop) + px(mcs.paddingBottom),
    screenPadding: px(scs.paddingTop) + px(scs.paddingBottom),
    boardBorder: px(bcs.borderTopWidth) + px(bcs.borderBottomWidth),
  };
  const rows = isTcg
    ? { ...base, tracks: getComputedStyle(document.querySelector(".game-board .board-content")).gridTemplateRows.split(" ").reduce((a, v) => a + (parseFloat(v) || 0), 0) }
    : {
      ...base,
      bandOpponent: bands[0] ?? 0,
      zoneOpponent: zones[0] ?? 0,
      console: h(".game-board .turn-console"),
      zonePlayer: zones[1] ?? 0,
      bandPlayer: bands[1] ?? 0,
      hand: h(".game-board .hand-zone"),
    };
  // DECISÃO D1-A (tcg): cada carta da mão mostra >= 70% dentro do tabuleiro (a mesma conta do 3D).
  const boardRect = document.querySelector(".game-board").getBoundingClientRect();
  const handShare = isTcg
    ? [...document.querySelectorAll(".hand-track > .card-tile--hand")].map((el) => {
      const r = el.getBoundingClientRect();
      return (Math.min(r.bottom, boardRect.bottom) - Math.max(r.top, boardRect.top)) / (r.bottom - r.top);
    })
    : [];
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
    isTcg,
    handMinShare: handShare.length ? Math.round(Math.min(...handShare) * 100) / 100 : null,
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

// H-25: os textos que o tema precisa deixar legíveis sobre o tapete e o HUD da mesa.
const CONTRAST_SELECTORS = [".zone-heading", ".player-band", ".turn-console"];

// H-25 (§5 H-25): contraste dos textos da mesa. Para cada elemento mede `color` contra o primeiro
// background-color OPACO na cadeia (ele mesmo e os ancestrais), com o alfa do texto misturado.
// Se alguma camada até esse fundo é gradiente ou translúcida, o item é "nao-medido" com o motivo:
// um gradiente não é aprovado nem reprovado em silêncio. Sem fundo sólido na cadeia, idem.
// Também devolve o Æmber: o contador tem de sair em --nf-aember e a distância ΔE76 para o acento.
const CONTRAST_MEASURE = (selectors) => {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  // O canvas normaliza qualquer cor CSS (color-mix, var(), rgb/rgba) para RGBA de 8 bits.
  const rgba = (css) => {
    ctx.fillStyle = "#000000";
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  };
  const lum = ([r, g, b]) => {
    const f = (c) => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const lab = ([r, g, b]) => {
    const lin = (c) => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    const R = lin(r);
    const G = lin(g);
    const B = lin(b);
    const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
    const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
  };
  const dE = (a, b) => {
    const la = lab(a);
    const lb = lab(b);
    return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
  };
  const label = (el) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
    return el.tagName.toLowerCase() + (cls ? `.${cls}` : "");
  };
  const rows = [];
  for (const sel of selectors) {
    const els = [...document.querySelectorAll(sel)];
    if (!els.length) rows.push({ sel, status: "ausente" });
    els.forEach((el, i) => {
      const name = `${sel}[${i}]`;
      const fgRaw = rgba(getComputedStyle(el).color);
      let blocker = null;
      let bg = null;
      for (let node = el; node && !bg; node = node.parentElement) {
        const cs = getComputedStyle(node);
        const c = rgba(cs.backgroundColor);
        if (cs.backgroundImage !== "none" && !blocker) blocker = `gradiente em ${label(node)}`;
        else if (c[3] > 0 && c[3] < 255 && !blocker) blocker = `fundo translúcido em ${label(node)}`;
        if (c[3] === 255) bg = c;
      }
      if (!bg) rows.push({ sel: name, status: "nao-medido", motivo: "sem fundo sólido na cadeia" });
      else if (blocker) rows.push({ sel: name, status: "nao-medido", motivo: blocker });
      else {
        const a = fgRaw[3] / 255;
        const fg = [0, 1, 2].map((i) => Math.round(a * fgRaw[i] + (1 - a) * bg[i]));
        const r = ratio(fg, bg);
        rows.push({ sel: name, status: r >= 4.5 ? "ok" : "fail", ratio: r });
      }
    });
  }
  const root = getComputedStyle(document.documentElement);
  const aember = rgba(root.getPropertyValue("--nf-aember"));
  const accent = rgba(root.getPropertyValue("--nf-accent"));
  const counter = document.querySelector(".amber-counter");
  const counterRgba = counter ? rgba(getComputedStyle(counter).color) : null;
  const amber = counter
    ? { counterIsAember: counterRgba.every((v, i) => v === aember[i]), deltaE: Math.round(dE(aember, accent) * 10) / 10 }
    : null;
  return { rows, amber };
};

// Casca -> Jogar (lobby) -> partida demo (mulligan mantido) -> turno do jogador pronto.
// H-18: Ajustes deixou de levar ao wizard v1; a partida começa pelo Jogar do lobby (H-11).
async function openTable(page, url) {
  await page.goto(`${url}?ui=2`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="shell"]', { timeout: 30000 });
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
  await page.locator('[data-action="play"]').click();
  await page.waitForSelector(".game-screen", { timeout: 20000 });
  const keep = page.locator(".mulligan-keep");
  if (await keep.count()) await keep.click();
  await page.waitForSelector(".mulligan-shade", { state: "detached", timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector(".end-turn-button")?.disabled, null, { timeout: 90000 });
  await page.waitForTimeout(700);
}

async function tableFlow(browser, vp, url, view, shotDir = null) {
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
    // H-ATL-03: na variante a mão espia pela borda do tabuleiro — a regra é a D1-A (abaixo), não a de 100%.
    if (m.handBottom !== null && m.handBottom > m.vp + 0.5 && !m.is3d && !m.isTcg) failures.push(`${label}: mão cortada (bottom ${m.handBottom} > ${m.vp})`);
    // H-ATL-03 (tcg, D1-A): a mão espia pela borda do tabuleiro, mas cada carta mostra >= 70%.
    if (m.isTcg && m.handMinShare !== null && m.handMinShare < 0.7) failures.push(`${label}: mão tcg com carta abaixo de 70% visível (mín ${m.handMinShare})`);
  };
  check(await page.evaluate(TABLE_MEASURE), "mesa vazia");
  // H-27: a mesa vazia tem o estado vazio da v2 nas fileiras (orbe + 1 linha) e a mão cheia não
  // mostra o da mão. O print sai com o --shots (2D e 3D, para olhar a hierarquia).
  const empty = await page.evaluate(() => ({
    lines: document.querySelectorAll(".empty-battleline.nf-empty-line").length,
    orbits: document.querySelectorAll(".nf-empty-line .empty-orbit svg").length,
    handEmpty: document.querySelectorAll(".nf-empty-hand").length,
  }));
  reports.push(`mesa vazia: ${empty.lines} fileira(s) vazia(s) com a v2, ${empty.handEmpty} mão(s) vazia(s)`);
  if (empty.lines < 1) failures.push("mesa vazia: nenhuma fileira com o estado vazio da v2 (.nf-empty-line)");
  if (empty.orbits !== empty.lines) failures.push("mesa vazia: fileira sem o orbe (ícone)");
  if (shotDir) await page.screenshot({ path: join(shotDir, `table-empty-${view}-${vp.name}.png`) });
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
    await page.locator('[data-action="continue"]').click();
    await page.waitForSelector(".game-screen", { timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector(".end-turn-button")?.disabled, null, { timeout: 60000 });
    await page.waitForTimeout(700);
    check(await page.evaluate(TABLE_MEASURE), "8x8+artefato");
  } else {
    failures.push(`mesa cheia não preparada: ${patched}`);
  }

  // H-25: contraste na mesa cheia (mais conteúdo sobre os textos). "nao-medido" é listado, não
  // reprovado: o tema não pode aprovar um gradiente em silêncio, mas também não o condena sem medida.
  const contrast = await page.evaluate(CONTRAST_MEASURE, CONTRAST_SELECTORS);
  for (const row of contrast.rows) {
    if (row.status === "ok" || row.status === "fail") reports.push(`contraste ${row.sel}: ${row.ratio.toFixed(2)}:1`);
    else if (row.status === "nao-medido") reports.push(`contraste ${row.sel}: NÃO MEDIDO (${row.motivo})`);
    else reports.push(`contraste ${row.sel}: ausente`);
    if (row.status === "fail") failures.push(`contraste ${row.sel}: ${row.ratio.toFixed(2)}:1 < 4,5:1`);
    if (row.status === "ausente") failures.push(`contraste ${row.sel}: elemento da mesa não encontrado`);
  }
  if (!contrast.amber) failures.push("contraste: .amber-counter ausente (Æmber não medido)");
  else {
    reports.push(`Æmber: ${contrast.amber.counterIsAember ? "contador = --nf-aember" : "contador FORA de --nf-aember"}; ΔE76 para o acento = ${contrast.amber.deltaE}`);
    if (!contrast.amber.counterIsAember) failures.push("Æmber: o contador não sai em --nf-aember");
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

// H-26: as pilhas da mesa (ZonesSheet). O chip do descarte do Warden abre a aba dele; o chip dos
// seus arquivos abre Arquivos; em Arquivos os do Warden aparecem só como contagem (nenhuma carta
// no DOM, e o número bate com o chip virado); Purgadas é uma aba; Esc fecha e devolve o foco ao
// chip. Devolve a lista de falhas (vazia = passou).
async function zonesFlow(browser, vp, url, shotDir) {
  const failures = [];
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
  await context.addInitScript(seedFor("2d"));
  const page = await context.newPage();
  await openTable(page, url);
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  const selectedTab = () => page.evaluate(() => [...document.querySelectorAll(".nf-zones-tabs [role=radio]")].findIndex((r) => r.getAttribute("aria-checked") === "true"));
  const focusedIs = (selector) => page.evaluate((sel) => Boolean(document.activeElement?.matches(sel)), selector);
  const openChip = async (selector, label) => {
    await page.locator(selector).click();
    await dialog.waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push(`${label}: a folha não abriu`));
    await page.waitForTimeout(600);
  };
  const closeWithEsc = async (selector, label) => {
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached", timeout: 5000 }).catch(() => failures.push(`${label}: Esc não fechou`));
    if (!(await focusedIs(selector))) failures.push(`${label}: foco não voltou ao chip`);
  };

  const oppDiscard = '.pile-chip[data-pile="discard"][data-side="1"]';
  const ownArchive = '.pile-chip[data-pile="archive"][data-side="0"]';
  const oppArchiveHidden = '.pile-chip--hidden[data-pile="archive"][data-side="1"]';

  // 1) chip do descarte do Warden → aba "Descarte (Warden)" (índice 1).
  await openChip(oppDiscard, "chip descarte Warden");
  if ((await selectedTab()) !== 1) failures.push(`chip descarte Warden abriu a aba ${await selectedTab()}, esperado 1`);
  if ((await page.locator('[data-zones-tab="discardOpp"]').count()) !== 1) failures.push("chip descarte Warden: painel discardOpp ausente");
  if ((await page.locator(".nf-zones-tabs [role=radio]").count()) !== 4) failures.push("pilhas: esperadas 4 abas");
  const audit = await page.evaluate(AUDIT, '[role="dialog"][aria-modal="true"]');
  for (const [key, items] of Object.entries(audit)) {
    if (Array.isArray(items) ? items.length : items !== null) failures.push(`pilhas ${key}: ${Array.isArray(items) ? items.slice(0, 4).join("; ") : items}`);
  }
  if (shotDir) await page.screenshot({ path: join(shotDir, `zones-discard-${vp.name}.png`) });
  await closeWithEsc(oppDiscard, "descarte Warden");

  // 2) arquivos do próprio lado → aba Arquivos (índice 2). Os do Warden: só contagem.
  await openChip(ownArchive, "chip seus arquivos");
  if ((await selectedTab()) !== 2) failures.push(`chip arquivos abriu a aba ${await selectedTab()}, esperado 2`);
  const hidden = await page.evaluate(() => {
    const section = document.querySelector('[data-zones-section="archives-opp"]');
    return section ? { cards: section.querySelectorAll(".nf-zones-card").length, text: section.textContent ?? "" } : null;
  });
  const hiddenCount = await page.locator(`${oppArchiveHidden} b`).textContent();
  if (!hidden) failures.push("Arquivos: seção do Warden ausente");
  else {
    if (hidden.cards !== 0) failures.push(`Arquivos do Warden expõem ${hidden.cards} carta(s) — deveria ser só contagem`);
    if (!hidden.text.includes(String(hiddenCount).trim())) failures.push(`Arquivos do Warden: contagem "${hidden.text}" não bate com o chip (${hiddenCount})`);
  }
  if (shotDir) await page.screenshot({ path: join(shotDir, `zones-archives-${vp.name}.png`) });
  await closeWithEsc(ownArchive, "arquivos");

  // 3) Purgadas é uma aba alcançável (índice 3) e troca o painel.
  await openChip(oppDiscard, "chip descarte Warden (2)");
  await page.locator(".nf-zones-tabs [role=radio]").nth(3).click();
  if ((await page.locator('[data-zones-tab="purged"]').count()) !== 1) failures.push("aba Purgadas não trocou o painel");
  await closeWithEsc(oppDiscard, "purgadas");

  await context.close();
  return failures;
}

// H-28 (§5 H-28): a entrada do Lobby roda em --dur-enter (420ms ±20) e a cascata para no 5º item
// (≤ 5 × --nf-stagger = 300ms). Com a animação LIGADA (o reduced-motion trocaria o tempo por
// --dur-fast): um observador de rAF guarda a duração de cada nf-rise que nasce na página.
const RISE_OBSERVER = () => {
  window.__riseDur = [];
  const seen = new WeakSet();
  const tick = () => {
    for (const anim of document.getAnimations()) {
      if (anim.animationName !== "nf-rise" || seen.has(anim)) continue;
      seen.add(anim);
      window.__riseDur.push(anim.effect.getComputedTiming().duration);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
async function motionFlow(browser, vp, url) {
  const failures = [];
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "no-preference" });
  await context.addInitScript(seedFor("2d").replace("animations: false", "animations: true"));
  await context.addInitScript(RISE_OBSERVER);
  const page = await context.newPage();
  await page.goto(`${url}?ui=2`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
  // Espera a cascata ASSENTAR (teto 3s), em vez de um sleep fixo: sob carga a entrada pode
  // começar depois dos 900ms e o gate lia zero entradas. Sem nf-rise em curso = settle.
  await page.waitForFunction(
    () => window.__riseDur.length > 0 && !document.getAnimations().some((a) => a.playState === "running" && a.animationName === "nf-rise"),
    null,
    { timeout: 3000 },
  ).catch(() => {});
  const probe = await page.evaluate(() => ({
    durations: window.__riseDur,
    delays: [...document.querySelectorAll(".nf-lobby [data-enter]")].map((el) => {
      const raw = getComputedStyle(el).animationDelay;
      return raw.endsWith("ms") ? parseFloat(raw) : parseFloat(raw) * 1000;
    }),
  }));
  if (!probe.durations.length) failures.push("lobby: nenhuma entrada nf-rise observada (a cascata não animou)");
  for (const d of probe.durations) {
    if (Math.abs(d - 420) > 20) failures.push(`lobby: entrada de ${d}ms, esperado --dur-enter 420ms ±20`);
  }
  const worstDelay = probe.delays.length ? Math.max(...probe.delays) : 0;
  if (worstDelay > 5 * 60 + 1) failures.push(`lobby: cascata de ${worstDelay}ms, teto de 5 itens = 300ms`);
  await context.close();
  return { failures, reports: [`lobby: ${probe.durations.length} entrada(s) em ${probe.durations.map((d) => Math.round(d)).join("/")}ms; maior atraso ${Math.round(worstDelay)}ms`] };
}

// H-27: a fronteira de erro da v2. Com a partida salva, ?ui=2&crash=1 (só dev) lança num filho:
// o fallback aparece, o save (aember-arena-match) fica byte a byte igual e "Voltar ao Lobby"
// leva ao lobby, onde "Continuar" retoma a mesma partida. Devolve a lista de falhas.
async function crashFlow(browser, vp, url) {
  const failures = [];
  const SAVE = "aember-arena-match";
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
  await context.addInitScript(seedFor("2d"));
  const page = await context.newPage();
  await openTable(page, url);
  const before = await page.evaluate((key) => localStorage.getItem(key), SAVE);
  if (!before) failures.push("crash: a partida não foi salva antes do erro");

  await page.goto(`${url}?ui=2&crash=1`, { waitUntil: "domcontentloaded" });
  const alert = page.locator(".nf-error[role=alert]");
  await alert.waitFor({ state: "visible", timeout: 15000 }).catch(() => failures.push("crash: o fallback da v2 não apareceu"));
  if (await alert.count()) {
    const audit = await page.evaluate(AUDIT, ".nf-error");
    for (const [key, items] of Object.entries(audit)) {
      if (Array.isArray(items) ? items.length : items !== null) failures.push(`crash ${key}: ${Array.isArray(items) ? items.slice(0, 4).join("; ") : items}`);
    }
  }
  const afterCrash = await page.evaluate((key) => localStorage.getItem(key), SAVE);
  if (afterCrash !== before) failures.push("crash: o save da partida mudou ou sumiu com o erro");

  await page.locator(".nf-error button").click();
  await page.waitForSelector('[data-screen="shell"]', { timeout: 15000 }).catch(() => failures.push("crash: o botão não voltou ao lobby"));
  if ((await page.locator(".nf-error[role=alert]").count()) !== 0) failures.push("crash: o fallback continuou depois do reset");
  const afterReset = await page.evaluate((key) => localStorage.getItem(key), SAVE);
  if (afterReset !== before) failures.push("crash: o save mudou depois de voltar ao lobby");
  const playLabel = await page.locator(".nf-shell-tab").first().textContent();
  if (!/Continu/.test(playLabel ?? "")) failures.push(`crash: lobby sem "Continuar" (destino "${playLabel}")`);

  await context.close();
  return failures;
}

// H-12: o Lobby na dobra. A 1280×800 o botão Jogar e o topo da prateleira cabem sem rolar
// (bottom <= innerHeight); a cascata anima no máximo 5 itens (UX_REWRITE_PLAN §1.5); os estados
// C (?state=loading: aria-busy + esqueletos) e V (?state=empty: só os iniciais, com a nota) existem.
// Devolve { failures, reports } (vazio = passou).
async function lobbyFlow(browser, vp, url) {
  const failures = [];
  const reports = [];
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
  await context.addInitScript(SEED);
  const page = await context.newPage();
  await page.goto(`${url}?ui=2`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => {
    const box = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
    const play = box('[data-screen="lobby"] [data-action="play"]');
    const shelf = box('[data-screen="lobby"] .nf-shelf');
    return {
      vp: window.innerHeight,
      playBottom: play ? Math.round(play.bottom) : null,
      shelfTop: shelf ? Math.round(shelf.top) : null,
      animated: document.querySelectorAll('[data-screen="lobby"] [data-enter]').length,
    };
  });
  reports.push(`lobby ${vp.name}: Jogar bottom=${m.playBottom} topo da prateleira=${m.shelfTop} (vp ${m.vp}) itens animados=${m.animated}`);
  if (m.animated > 5) failures.push(`cascata com ${m.animated} itens (máximo 5)`);
  if (vp.name === "1280x800") {
    if (m.playBottom === null) failures.push("Jogar ausente no lobby (sem partida salva)");
    else if (m.playBottom > m.vp) failures.push(`Jogar abaixo da dobra (bottom ${m.playBottom} > ${m.vp})`);
    if (m.shelfTop === null) failures.push("prateleira ausente no lobby");
    else if (m.shelfTop > m.vp) failures.push(`topo da prateleira abaixo da dobra (${m.shelfTop} > ${m.vp})`);
  }
  await context.close();

  // C: esqueletos e aria-busy; sem a prateleira real.
  const loading = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
  await loading.addInitScript(SEED);
  const lp = await loading.newPage();
  await lp.goto(`${url}?ui=2&state=loading`, { waitUntil: "domcontentloaded" });
  await lp.waitForSelector('[data-screen="lobby"][aria-busy="true"]', { timeout: 30000 }).catch(() => failures.push("estado C: lobby sem aria-busy"));
  const skeletons = await lp.evaluate(() => document.querySelectorAll('[data-screen="lobby"] [class*="skeleton"]').length);
  if (skeletons < 2) failures.push(`estado C: ${skeletons} esqueleto(s), esperado >= 2`);
  if (await lp.locator('[data-screen="lobby"] .nf-shelf').count()) failures.push("estado C: prateleira real aparece durante o carregamento");
  await loading.close();

  // V: só os iniciais na prateleira e a nota que ensina a importar.
  const empty = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
  await empty.addInitScript(SEED);
  const ep = await empty.newPage();
  await ep.goto(`${url}?ui=2&state=empty`, { waitUntil: "domcontentloaded" });
  await ep.waitForSelector('[data-screen="lobby"] .nf-shelf-grid', { timeout: 30000 });
  const tiles = await ep.locator('[data-screen="lobby"] .nf-shelf-grid .nf-tile').count();
  if (tiles !== 2) failures.push(`estado V: ${tiles} tile(s), esperado 2 (só os iniciais)`);
  if (!(await ep.locator('[data-screen="lobby"] .nf-shelf .nf-card-note').count())) failures.push("estado V: falta a nota de importar");
  await empty.close();

  return { failures, reports };
}

// H-13: a MatchSheet (S3) a partir do Lobby. Abre pela linha "contra …"; a folha passa na mesma
// auditoria do ☰ (alvos 44px, rótulos, piso tipográfico, sem animação com reduced-motion); a força
// escrita pela folha aparece em settings; o modo 2 jogadores mostra os dois decks sem repetir; Esc
// fecha e devolve o foco à linha do oponente. Devolve a lista de falhas (vazia = passou).
async function sheetFlow(browser, vp, url) {
  const failures = [];
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
  await context.addInitScript(SEED);
  const page = await context.newPage();
  await page.goto(`${url}?ui=2`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
  const trigger = page.locator(".nf-opponent");
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');

  await trigger.click();
  await dialog.waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("a linha do oponente não abriu a folha"));
  await page.waitForTimeout(600);
  if (await dialog.count()) {
    const audit = await page.evaluate(AUDIT, '[role="dialog"][aria-modal="true"]');
    for (const [key, items] of Object.entries(audit)) {
      if (Array.isArray(items) ? items.length : items !== null) failures.push(`folha ${key}: ${Array.isArray(items) ? items.slice(0, 4).join("; ") : items}`);
    }
  }

  // Força pela folha: Duro = Hard · 4 nas settings gravadas.
  await dialog.getByRole("radio", { name: /Hard|Duro/ }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("aember-arena-settings") ?? "{}"));
  if (saved.difficulty !== "Hard" || saved.thinkingDepth !== 4) failures.push(`força Duro não gravou (difficulty=${saved.difficulty}, depth=${saved.thinkingDepth})`);

  // Modo 2 jogadores: dois seletores de deck, nunca o mesmo nos dois.
  await dialog.getByRole("radio", { name: /pass-and-play|2 players|2 jogadores/ }).click();
  await page.waitForTimeout(150);
  const decks = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] .nf-match-field select')].map((s) => s.value));
  if (decks.length !== 2) failures.push(`2 jogadores: ${decks.length} seletor(es) de deck, esperado 2`);
  else if (decks[0] === decks[1]) failures.push("2 jogadores: os dois lados com o mesmo deck");
  if (await dialog.getByRole("button", { name: /Play|Jogar/ }).isDisabled()) failures.push("2 jogadores: Jogar travado com decks distintos");

  // Esc fecha e devolve o foco à linha do oponente.
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached", timeout: 5000 }).catch(() => failures.push("Esc não fechou a folha"));
  const back = await page.evaluate(() => document.activeElement?.classList.contains("nf-opponent") ?? false);
  if (!back) failures.push("folha fechada: foco não voltou à linha do oponente");

  await context.close();
  return failures;
}

// H-15: a biblioteca (S4) na casca. O Vault é mockado (page.route) com 9 decks por página e 90 no
// total. Confere: Meus lista os iniciais; Vault mostra 9 tiles e paginação compacta SEM números no
// DOM; a busca e a página sobrevivem à ida e volta do Detalhe (BUG-15); offline o banner aparece e
// Meus segue de pé; a AUDITORIA (alvos, rótulos, piso, movimento) passa nas duas abas.
// Devolve a lista de falhas (vazia = passou).
const VAULT_FILLER = { id: "grunt-lib", card_title: "Grunt", house: "Brobnar", card_type: "Creature", card_text: "", amber: 0, power: 3, armor: 0, front_image: "" };
async function libraryFlow(browser, vp, url, shotDir) {
  const failures = [];
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
  await context.addInitScript(SEED);
  const searches = [];
  await context.route("https://www.keyforgegame.com/api/decks/**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    searches.push({ page: Number(params.get("page")), search: params.get("search") ?? "" });
    const data = Array.from({ length: 9 }, (_, i) => ({
      id: `aaaaaaaa-0000-4000-8000-00000000000${i}`,
      name: `Vault Deck ${i}`,
      expansion: 341,
      _links: { houses: ["Brobnar"], cards: Array(36).fill(VAULT_FILLER.id) },
    }));
    return route.fulfill({ json: { count: 90, data, _linked: { cards: [VAULT_FILLER] } } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  const auditInto = async (label) => {
    const audit = await page.evaluate(AUDIT, '[data-screen="library"]');
    for (const [key, items] of Object.entries(audit)) {
      if (Array.isArray(items) ? items.length : items !== null) failures.push(`${label} ${key}: ${Array.isArray(items) ? items.slice(0, 4).join("; ") : items}`);
    }
  };

  await page.goto(`${url}?ui=2`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="shell"]', { timeout: 30000 });
  await page.locator(".nf-shell-tab").nth(1).click();
  await page.waitForSelector('[data-screen="library"]', { timeout: 15000 });
  // A transição do ícone da aba de destino (clique recém-feito) segue até ~600ms: a auditoria espera.
  await page.waitForTimeout(700);

  // Meus: só os iniciais (dois tiles), sem o banner de offline.
  const mine = await page.locator('[data-screen="library"] .nf-tile--mine').count();
  if (mine !== 2) failures.push(`Meus: ${mine} tile(s), esperado 2 (iniciais)`);
  await auditInto("Meus");
  if (shotDir) await page.screenshot({ path: join(shotDir, `library-mine-${vp.name}.png`), fullPage: true });

  // Vault: 9 tiles da rede mockada; paginação compacta, nada numerado no DOM.
  await page.getByRole("radio", { name: "Vault", exact: true }).click();
  await page.waitForSelector('[data-screen="library"] .nf-tile--vault', { timeout: 20000 }).catch(() => failures.push("Vault: nenhum tile"));
  const vault = await page.locator('[data-screen="library"] .nf-tile--vault').count();
  if (vault !== 9) failures.push(`Vault: ${vault} tile(s), esperado 9`);
  const numbered = await page.locator('[data-screen="library"] .pager, [data-screen="library"] .pager-pages, [data-screen="library"] .pager-slot').count();
  if (numbered) failures.push(`Vault: paginação numerada no DOM (${numbered} nó(s))`);
  await auditInto("Vault");
  if (shotDir) await page.screenshot({ path: join(shotDir, `library-vault-${vp.name}.png`), fullPage: true });

  // Página 2, busca "zeta" (volta à página 1), depois página 2 de novo: é esse estado que o Detalhe precisa devolver.
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-screen="library"] .nf-pager-status')?.textContent.includes("2"), null, { timeout: 15000 }).catch(() => failures.push("próxima página não mudou o status"));
  await page.locator(".nf-vault-search input").fill("zeta");
  await page.locator(".nf-vault-search input").press("Enter");
  await page.waitForFunction(() => document.querySelector('[data-screen="library"] .nf-vault-search input')?.value === "zeta", null, { timeout: 5000 }).catch(() => failures.push("busca não ficou no campo"));
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-screen="library"] .nf-pager-status')?.textContent.includes("2"), null, { timeout: 15000 }).catch(() => failures.push("página 2 com busca não apareceu"));
  if (!searches.some((s) => s.search === "zeta")) failures.push("a busca não chegou à API (search=zeta)");

  // Ida ao Detalhe (v2, H-16) e volta: página 2 e busca "zeta" preservadas.
  await page.locator('[data-screen="library"] .nf-tile--vault .nf-tile-select').first().click();
  await page.waitForSelector('[data-screen="detail"]', { timeout: 15000 }).catch(() => failures.push("tile da Vault não abriu o Detalhe"));
  await page.locator('[data-screen="detail"] .nf-detail-top button').click();
  await page.waitForSelector('[data-screen="library"]', { timeout: 15000 }).catch(() => failures.push("voltar do Detalhe não devolveu a biblioteca"));
  await page.waitForFunction(() => document.querySelector('[data-screen="library"] .nf-pager-status')?.textContent.includes("2"), null, { timeout: 15000 }).catch(() => failures.push("voltar do Detalhe perdeu a página"));
  const kept = await page.locator('[data-screen="library"] .nf-vault-search input').inputValue();
  if (kept !== "zeta") failures.push(`voltar do Detalhe perdeu a busca (campo "${kept}")`);

  // Offline (sem rede, sem reload): o banner aparece na Vault; Meus segue com os seus decks.
  await context.setOffline(true);
  await page.waitForSelector('[data-screen="library"] .nf-banner', { timeout: 5000 }).catch(() => failures.push("offline: sem banner"));
  const offlineVault = await page.locator('[data-screen="library"] .nf-tile--vault').count();
  if (offlineVault !== 0) failures.push(`offline: ${offlineVault} tile(s) da Vault, esperado 0`);
  await page.getByRole("radio", { name: "Mine", exact: true }).click();
  const offlineMine = await page.locator('[data-screen="library"] .nf-tile--mine').count();
  if (offlineMine !== 2) failures.push(`offline: Meus com ${offlineMine} tile(s), esperado 2`);
  await context.setOffline(false);

  if (errors.length) failures.push(`erro de página: ${errors.join("; ")}`);
  await context.close();
  return failures;
}

// H-16: o Detalhe do deck (S5) a partir do Lobby (o ⊙ do tile). Confere: a carta escolhida vai para
// o painel (hover no desktop; toque abre a folha no celular); nenhum popup de zoom fixo fica visível;
// nada fixed/absolute cobre o stat strip; o CTA "Jogar com este deck" tem >= 44px e cabe na dobra
// (390×844 e 1280×800); a aba Estatísticas renderiza; a AUDITORIA passa; "voltar" devolve ao Lobby.
// Devolve a lista de falhas (vazia = passou).
async function detailFlow(browser, vp, url, shotDir) {
  const failures = [];
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
  await context.addInitScript(SEED);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  const desktop = vp.width >= 1041;
  const audit = async (label, scope) => {
    const result = await page.evaluate(AUDIT, scope);
    for (const [key, items] of Object.entries(result)) {
      if (Array.isArray(items) ? items.length : items !== null) failures.push(`${label} ${key}: ${Array.isArray(items) ? items.slice(0, 4).join("; ") : items}`);
    }
  };

  await page.goto(`${url}?ui=2`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
  await page.locator('.nf-shelf-grid .nf-tile-actions .nf-btn--ghost').first().click();
  await page.waitForSelector('[data-screen="detail"]', { timeout: 15000 }).catch(() => failures.push("⊙ do tile não abriu o Detalhe v2"));
  await page.waitForTimeout(700);

  const cards = page.locator('[data-screen="detail"] .nf-detail-card');
  if ((await cards.count()) < 3) failures.push(`Detalhe: ${await cards.count()} carta(s), esperado >= 3`);

  // Nada fixed/absolute visível cobre o stat strip (o leque do hero e o painel ficam fora dele).
  const overlap = await page.evaluate(() => {
    const strip = document.querySelector('[data-screen="detail"] .nf-stat-strip');
    if (!strip) return "sem stat strip";
    const r = strip.getBoundingClientRect();
    const hits = [];
    for (const el of document.querySelectorAll("body *")) {
      if (strip.contains(el) || el.contains(strip)) continue;
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "absolute") continue;
      // Decoração que não recebe ponteiro não "cobre" nada de verdade: o fx-layer
      // (partículas) é um canvas full-screen pointer-events:none por desenho.
      if (cs.pointerEvents === "none") continue;
      if (cs.visibility === "hidden" || cs.opacity === "0") continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      if (b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom) hits.push(el.className || el.tagName);
    }
    return hits.length ? hits.slice(0, 3).join(" | ") : null;
  });
  if (overlap) failures.push(`stat strip coberto por elemento fixed/absolute: ${overlap}`);

  // CTA: >= 44px e inteiro na dobra (sticky no pé da coluna).
  const cta = await page.evaluate(() => {
    const b = document.querySelector('[data-screen="detail"] [data-action="play-deck"]')?.getBoundingClientRect();
    return b ? { h: b.height, top: b.top, bottom: b.bottom, vp: window.innerHeight } : null;
  });
  if (!cta) failures.push("CTA \"Jogar com este deck\" ausente");
  else {
    if (cta.h < 44) failures.push(`CTA com ${Math.round(cta.h)}px de altura (mínimo 44)`);
    if (cta.top < 0 || cta.bottom > cta.vp) failures.push(`CTA fora da dobra (${Math.round(cta.top)}–${Math.round(cta.bottom)} de ${cta.vp})`);
  }

  if (desktop) {
    // Hover atualiza o painel docado e não abre folha nem popup de zoom fixo.
    const third = cards.nth(2);
    await third.hover();
    await page.waitForTimeout(200);
    const expected = (await third.locator(".nf-detail-card-name").textContent())?.trim();
    const shown = (await page.locator('[data-screen="detail"] .nf-pane-title').textContent())?.trim();
    if (shown !== expected) failures.push(`hover: painel mostra "${shown}", esperado "${expected}"`);
    const fixedVisible = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => {
      const cs = getComputedStyle(el);
      // Decoração passiva (fx-layer etc.) não é "popup de zoom": pointer-events
      // none não interage nem cobre.
      if (cs.pointerEvents === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
      const b = el.getBoundingClientRect();
      return cs.position === "fixed" && b.width > 0 && b.height > 0;
    }).map((el) => el.className || el.tagName));
    if (fixedVisible.length) failures.push(`hover: ${fixedVisible.length} elemento(s) fixed visível(is) (popup de zoom?): ${fixedVisible.slice(0, 3).join(" | ")}`);
    if (await page.locator('[role="dialog"][aria-modal="true"]').count()) failures.push("hover abriu uma folha no desktop");
  } else {
    // Toque: a folha mostra a carta tocada e Esc a fecha.
    await cards.nth(2).click();
    await page.locator('[role="dialog"][aria-modal="true"]').waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("toque na carta não abriu a folha"));
    await page.waitForTimeout(600);
    const expected = (await cards.nth(2).locator(".nf-detail-card-name").textContent())?.trim();
    const sheetTitle = (await page.locator('[role="dialog"][aria-modal="true"] .nf-sheet-title').textContent().catch(() => ""))?.trim();
    if (sheetTitle !== expected) failures.push(`folha mostra "${sheetTitle}", esperado "${expected}"`);
    await audit("folha da carta", '[role="dialog"][aria-modal="true"]');
    await page.keyboard.press("Escape");
    await page.locator('[role="dialog"][aria-modal="true"]').waitFor({ state: "detached", timeout: 5000 }).catch(() => failures.push("Esc não fechou a folha da carta"));
  }

  await audit("detalhe", '[data-screen="detail"]');
  if (shotDir) await page.screenshot({ path: join(shotDir, `detail-cards-${vp.name}.png`), fullPage: true });

  await page.getByRole("radio", { name: "Statistics", exact: true }).click();
  await page.waitForSelector('[data-screen="detail"] .nf-detail-stats', { timeout: 5000 }).catch(() => failures.push("aba Estatísticas não abriu"));
  await page.waitForTimeout(700);
  await audit("estatísticas", '[data-screen="detail"]');
  if (shotDir) await page.screenshot({ path: join(shotDir, `detail-stats-${vp.name}.png`), fullPage: true });

  await page.locator('[data-screen="detail"] .nf-detail-top button').click();
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 15000 }).catch(() => failures.push("voltar do Detalhe não devolveu ao Lobby"));

  if (errors.length) failures.push(`erro de página: ${errors.join("; ")}`);
  await context.close();
  return failures;
}

// H-17: a folha de importação (S6) sobre o Lobby. O deck é um id próprio do harness (não é um
// inicial, então o teste não passa por acaso). Confere: ID inválido avisa sem buscar; o UUID vira
// pré-visualização com UMA busca; "Adicionar e jogar" leva à mão (o deck entra na biblioteca com
// saved:true e sobrevive ao reload); sem rede o mesmo UUID volta do cache ("Da cópia offline");
// um UUID desconhecido sem cache mostra o erro. Devolve a lista de falhas (vazia = passou).
const IMPORT_ID = "aaaaaaaa-1111-4222-8333-444444444444";
const IMPORT_MISS = "bbbbbbbb-1111-4222-8333-444444444444";
async function importFlow(browser, vp, url, shotDir) {
  const failures = [];
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
  await context.addInitScript(SEED);
  let fetches = 0;
  // setOffline não corta requisições que um route já atende: o mock recusa à mão quando "sem rede".
  let offline = false;
  await context.route("https://www.keyforgegame.com/api/decks/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (offline) return route.abort("internetdisconnected");
    if (!path.includes(IMPORT_ID)) return route.fulfill({ status: 404, json: {} });
    fetches += 1;
    return route.fulfill({
      json: {
        data: { id: IMPORT_ID, name: "Harness Import Deck", expansion: 341, _links: { houses: ["Brobnar"], cards: Array(36).fill(VAULT_FILLER.id) } },
        _linked: { cards: [VAULT_FILLER] },
      },
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  const sheet = '[role="dialog"][aria-modal="true"]';
  const input = `${sheet} input[type="text"]`;

  await page.goto(`${url}?ui=2`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
  await page.getByRole("button", { name: "Import deck", exact: true }).first().click();
  await page.waitForSelector(input, { timeout: 10000 }).catch(() => failures.push("Importar não abriu a folha"));

  // ID inválido: aviso, botão desligado, nenhuma busca.
  await page.locator(input).fill("nao-e-um-deck");
  const hintError = await page.locator(`${sheet} .nf-import-hint--error`).count();
  if (!hintError) failures.push("ID inválido sem aviso");
  if (!(await page.locator(`${sheet} button[type="submit"]`).isDisabled())) failures.push("ID inválido deixou o botão ligado");
  if (fetches) failures.push(`ID inválido buscou na rede (${fetches})`);

  // UUID: uma busca, pré-visualização com o nome e a casa.
  await page.locator(input).fill(IMPORT_ID);
  await page.locator(input).press("Enter");
  await page.waitForSelector(`${sheet} .nf-import-name`, { timeout: 15000 }).catch(() => failures.push("UUID não virou pré-visualização"));
  const name = (await page.locator(`${sheet} .nf-import-name`).textContent().catch(() => ""))?.trim();
  if (name !== "Harness Import Deck") failures.push(`pré-visualização mostra "${name}"`);
  if (fetches !== 1) failures.push(`${fetches} busca(s) na rede, esperado 1`);
  await page.waitForTimeout(500);
  const audit = await page.evaluate(AUDIT, sheet);
  for (const [key, items] of Object.entries(audit)) {
    if (Array.isArray(items) ? items.length : items !== null) failures.push(`folha ${key}: ${Array.isArray(items) ? items.slice(0, 4).join("; ") : items}`);
  }
  if (shotDir) await page.screenshot({ path: join(shotDir, `import-preview-${vp.name}.png`) });

  // Adicionar e jogar: a folha fecha e a partida abre na mão inicial.
  await page.locator(`${sheet} [data-action="import-play"]`).click();
  await page.locator(".mulligan-keep").waitFor({ state: "visible", timeout: 20000 }).catch(() => failures.push("Adicionar e jogar não abriu a partida"));
  if (await page.locator(`${sheet} .nf-import-form`).count()) failures.push("a folha continuou aberta depois de Adicionar e jogar");

  // Reload: o deck continua na biblioteca (saved:true). A partida interrompida pode aparecer no Lobby;
  // o que importa é o deck estar na prateleira.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 }).catch(() => failures.push("reload sem Lobby"));
  await page.waitForTimeout(500);
  const shelved = await page.locator('[data-screen="lobby"]').getByText("Harness Import Deck").count();
  if (!shelved) failures.push("deck importado sumiu da biblioteca depois do reload (saved:true)");

  // Sem rede: o mesmo UUID volta do cache, e a folha diz de onde veio.
  offline = true;
  await context.setOffline(true);
  await page.getByRole("button", { name: "Import deck", exact: true }).first().click();
  await page.locator(input).fill(IMPORT_ID);
  await page.locator(input).press("Enter");
  await page.waitForSelector(`${sheet} .nf-import-source`, { timeout: 15000 }).catch(() => failures.push("offline: sem pré-visualização do cache"));
  const source = (await page.locator(`${sheet} .nf-import-source`).textContent().catch(() => ""))?.trim();
  // O SEED desta harness semeia language:"en": o rótulo renderiza em inglês.
  if (source !== "From offline copy") failures.push(`offline: origem "${source}", esperado "From offline copy"`);
  offline = false;
  await context.setOffline(false);

  // UUID desconhecido e sem cache: a folha mostra o erro, sem pré-visualização.
  await page.locator(input).fill(IMPORT_MISS);
  await page.locator(input).press("Enter");
  await page.waitForSelector(`${sheet} .nf-import-error`, { timeout: 15000 }).catch(() => failures.push("UUID desconhecido não mostrou erro"));
  if (await page.locator(`${sheet} .nf-import-name`).count()) failures.push("UUID desconhecido mostrou pré-visualização");

  if (errors.length) failures.push(`erro de página: ${errors.join("; ")}`);
  await context.close();
  return failures;
}

// H-22 (S9): a partida salva é fechada com cada vencedor e o resultado é lido na tela. Mede o
// layout/a11y do overlay (AUDIT), os seis stats dos dois lados e o primário único. Com
// reduced-motion os valores finais aparecem sem contagem; com animações, a contagem termina em <= 900ms.
async function resultFlow(browser, vp, url) {
  const failures = [];
  const reports = [];
  for (const winner of [0, 1]) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
    await context.addInitScript(SEED);
    const page = await context.newPage();
    await openTable(page, url);
    await closeSavedMatch(page, winner);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
    await page.locator('[data-action="continue"]').click();
    await page.waitForSelector('[data-screen="result"]', { timeout: 20000 });
    // O cartão de recorde chega depois da gravação; sem ele a leitura não cobre o caso solo.
    await page.waitForSelector('[data-screen="result"] .nf-result-record', { timeout: 20000 }).catch(() => {});
    const read = await readResult(page);
    for (const problem of resultProblems(read, winner)) failures.push(`vencedor ${winner}: ${problem}`);
    // A regra de movimento vale após 600ms: a mesa ainda termina as animações do fim de jogo.
    await page.waitForTimeout(700);
    const audit = await page.evaluate(AUDIT, '[data-screen="result"]');
    if (failed(audit)) {
      failures.push(`vencedor ${winner}: AUDIT ${Object.entries(audit).filter(([, v]) => (Array.isArray(v) ? v.length : v !== null)).map(([k]) => k).join(", ")}`);
    }
    reports.push(`vencedor ${winner}: ${read?.marks ?? 0} marca(s) na timeline, primário "${read?.primaryText}"`);
    await context.close();
  }

  // Animação ligada: a contagem tem de terminar nos valores finais dentro do teto.
  const motion = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "no-preference" });
  await motion.addInitScript(SEED.replace("animations: false", "animations: true"));
  const page = await motion.newPage();
  await openTable(page, url);
  await closeSavedMatch(page, 0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
  await page.locator('[data-action="continue"]').click();
  await page.waitForSelector('[data-screen="result"]', { timeout: 20000 });
  const first = await readResult(page);
  await page.waitForTimeout(900);
  const settled = await readResult(page);
  for (const problem of resultProblems(settled, 0)) failures.push(`contagem: ${problem}`);
  reports.push(`contagem: primeira leitura keys=${first?.stats.keys?.[0]} -> após 900ms keys=${settled?.stats.keys?.[0]}`);
  await motion.close();
  return { failures, reports };
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
      const label = screen.label ?? screen.name;
      if (failed(audit)) {
        problems += 1;
        console.log(`[${label} ${vp.name}] FALHA`);
        for (const [key, items] of Object.entries(audit)) {
          if (Array.isArray(items) ? items.length : items !== null) {
            console.log(`    ${key}: ${Array.isArray(items) ? items.slice(0, 8).join("; ") : items}`);
          }
        }
      } else {
        console.log(`[${label} ${vp.name}] OK`);
      }
      if (shotDir) await p.screenshot({ path: join(shotDir, `${label}-${vp.name}.png`), fullPage: true });
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
      const { failures, reports } = await tableFlow(browser, vp, server.url, view, shotDir);
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

    if (TABLE_VIEWS.length) {
      const failures = await crashFlow(browser, vp, server.url);
      if (failures.length) {
        problems += 1;
        console.log(`[crash ${vp.name}] FALHA`);
        for (const failure of failures) console.log(`    ${failure}`);
      } else {
        console.log(`[crash ${vp.name}] OK`);
      }
    }

    if (TABLE_VIEWS.length) {
      const failures = await zonesFlow(browser, vp, server.url, shotDir);
      if (failures.length) {
        problems += 1;
        console.log(`[zones ${vp.name}] FALHA`);
        for (const failure of failures) console.log(`    ${failure}`);
      } else {
        console.log(`[zones ${vp.name}] OK`);
      }
    }

    {
      const { failures, reports } = await resultFlow(browser, vp, server.url);
      for (const line of reports) console.log(`[result-flow ${vp.name}] ${line}`);
      if (failures.length) {
        problems += 1;
        console.log(`[result-flow ${vp.name}] FALHA`);
        for (const failure of failures) console.log(`    ${failure}`);
      } else {
        console.log(`[result-flow ${vp.name}] OK`);
      }
    }

    {
      const { failures, reports } = await lobbyFlow(browser, vp, server.url);
      for (const line of reports) console.log(`[lobby-flow] ${line}`);
      if (failures.length) {
        problems += 1;
        console.log(`[lobby-flow ${vp.name}] FALHA`);
        for (const failure of failures) console.log(`    ${failure}`);
      } else {
        console.log(`[lobby-flow ${vp.name}] OK`);
      }
    }

    {
      const { failures, reports } = await motionFlow(browser, vp, server.url);
      for (const line of reports) console.log(`[motion ${vp.name}] ${line}`);
      if (failures.length) {
        problems += 1;
        console.log(`[motion ${vp.name}] FALHA`);
        for (const failure of failures) console.log(`    ${failure}`);
      } else {
        console.log(`[motion ${vp.name}] OK`);
      }
    }

    {
      const failures = await sheetFlow(browser, vp, server.url);
      if (failures.length) {
        problems += 1;
        console.log(`[sheet ${vp.name}] FALHA`);
        for (const failure of failures) console.log(`    ${failure}`);
      } else {
        console.log(`[sheet ${vp.name}] OK`);
      }
    }

    {
      const failures = await libraryFlow(browser, vp, server.url, shotDir);
      if (failures.length) {
        problems += 1;
        console.log(`[library-flow ${vp.name}] FALHA`);
        for (const failure of failures) console.log(`    ${failure}`);
      } else {
        console.log(`[library-flow ${vp.name}] OK`);
      }
    }

    {
      const failures = await detailFlow(browser, vp, server.url, shotDir);
      if (failures.length) {
        problems += 1;
        console.log(`[detail-flow ${vp.name}] FALHA`);
        for (const failure of failures) console.log(`    ${failure}`);
      } else {
        console.log(`[detail-flow ${vp.name}] OK`);
      }
    }

    {
      const failures = await importFlow(browser, vp, server.url, shotDir);
      if (failures.length) {
        problems += 1;
        console.log(`[import-flow ${vp.name}] FALHA`);
        for (const failure of failures) console.log(`    ${failure}`);
      } else {
        console.log(`[import-flow ${vp.name}] OK`);
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

    {
      const failures = await themeFlow(browser, vp, server.url);
      if (failures.length) {
        problems += 1;
        console.log(`[theme-flow ${vp.name}] FALHA`);
        for (const failure of failures) console.log(`    ${failure}`);
      } else {
        console.log(`[theme-flow ${vp.name}] OK`);
      }
    }

    {
      const failures = await settingsFlow(browser, vp, server.url, shotDir);
      if (failures.length) {
        problems += 1;
        console.log(`[settings-flow ${vp.name}] FALHA`);
        for (const failure of failures) console.log(`    ${failure}`);
      } else {
        console.log(`[settings-flow ${vp.name}] OK`);
      }
    }

    {
      const failures = await dataFlow(browser, vp, server.url, shotDir);
      if (failures.length) {
        problems += 1;
        console.log(`[data-flow ${vp.name}] FALHA`);
        for (const failure of failures) console.log(`    ${failure}`);
      } else {
        console.log(`[data-flow ${vp.name}] OK`);
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
