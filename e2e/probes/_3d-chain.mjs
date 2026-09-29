// Probe da cadeia 3D (H3D-02, VIEW3D_PLAN §2.1/§2.11). Roda num browser real:
//   1. 2D intacto: `.table-plane` é `display: contents` (sem caixa) e a lane
//      continua rolando como sempre.
//   2. Toggle no meio da partida: classe/data-view, aria-pressed, foco no
//      botão, cancelamento dos FX em voo e ZERO re-render de CardTile.
//   3. Cadeia sem agrupamento de `.table-plane` até `.board-piece`: overflow,
//      opacity, filter, isolation, clip-path/mask, contain e transform-style.
//   4. Projeção viva: forçando --tilt: 40deg a caixa projetada da .card-art
//      difere da caixa plana (perspectiva real) e um translateZ na peça cresce
//      a carta — se algum ancestral achatasse, nem a inclinação nem o Z
//      apareceriam.
//   5. Smoke do 3D com tilt 0: dois turnos completos e clique no board.
//   6. Volta ao 2D: o wrapper volta a `display: contents`.
// Uso: node e2e/probes/_3d-chain.mjs   (derruba o dev server ao sair)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5209;
const SHOTS = join(ROOT, "e2e", "clips", "frames");

// 2D de fábrica + animações ligadas (a transição de modo roda de verdade).
// SEM tableView: é o save antigo que o H3D-01 normaliza para 2d. Aplicado
// depois do primeiro goto + reload — um addInitScript reescreveria o storage a
// cada load e mascararia o teste de persistência do fim.
const SEED = `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: true,
    hoverZoom: false, hints: false, language: "en", opponentMode: "mirror", gameMode: "solo",
    aiSpeed: "fast",
  }));
  localStorage.setItem("aember-arena-language", "en");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
})()`;

// Contador de re-render por tile: o hook do DevTools dá o root a cada commit;
// a tile memoizada é achada pelo host <button class="card-tile" data-iid> e um
// bailout do memo preserva a identidade do objeto de props — identidade nova ==
// aquele CardTile foi redesenhado (o "0 commits de tile" do H3D-01/10 sem
// instrumentar o app; o nome do componente muda com o fast-refresh, o DOM não).
const HOOK = `(() => {
  window.__tileProps = {};
  window.__tileCommits = 0;
  window.__tilesSeen = 0;
  const hook = {
    supportsFiber: true,
    renderers: new Map(),
    isDisabled: false,
    inject(renderer) { const id = this.renderers.size + 1; this.renderers.set(id, renderer); return id; },
    onCommitFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    checkDCE() {},
  };
  hook.onCommitFiberRoot = (id, root) => {
    const walk = (fiber) => {
      for (let node = fiber; node; node = node.sibling) {
        const el = node.stateNode;
        if (node.type === "button" && el && el.classList && el.classList.contains("card-tile")) {
          window.__tilesSeen += 1;
          const key = String(el.dataset.iid ?? "(sem iid)");
          if (key in window.__tileProps && window.__tileProps[key] !== node.memoizedProps) window.__tileCommits += 1;
          window.__tileProps[key] = node.memoizedProps;
        }
        if (node.child) walk(node.child);
      }
    };
    walk(root.current);
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
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

// Auditoria de agrupamento: sobe da peça até `.table-plane` (inclusive).
const CHAIN_AUDIT = () => {
  const bad = [];
  const planes = [...document.querySelectorAll(".table-plane")];
  const pieces = [...document.querySelectorAll(".table-plane .board-piece")];
  for (const plane of planes) {
    const cs = getComputedStyle(plane);
    const rows = [
      ["plane", "overflow", `${cs.overflowX}/${cs.overflowY}`],
      ["plane", "opacity", cs.opacity],
      ["plane", "filter", cs.filter],
      ["plane", "isolation", cs.isolation],
      ["plane", "clip-path", cs.clipPath],
      ["plane", "mask", cs.maskImage],
      ["plane", "transform-style", cs.transformStyle],
      ["plane", "contain", cs.contain],
    ];
    for (const [who, prop, value] of rows) {
      const ok =
        prop === "overflow" ? value === "visible/visible"
        : prop === "opacity" ? Number(value) === 1
        : prop === "isolation" ? value !== "isolate"
        : prop === "transform-style" ? value === "preserve-3d"
        : prop === "contain" ? !String(value).includes("paint")
        : value === "none";
      if (!ok) bad.push({ who, prop, value });
    }
    if (cs.transform === "none") bad.push({ who: "plane", prop: "transform", value: cs.transform });
  }
  for (const piece of pieces) {
    for (let node = piece; node && !node.classList.contains("table-plane"); node = node.parentElement) {
      const cs = getComputedStyle(node);
      const rows = [
        ["overflow", `${cs.overflowX}/${cs.overflowY}`, "visible/visible"],
        ["opacity", cs.opacity, "1"],
        ["filter", cs.filter, "none"],
        ["isolation", cs.isolation, "isolate"],
        ["clip-path", cs.clipPath, "none"],
        ["mask", cs.maskImage, "none"],
        ["transform-style", cs.transformStyle, "preserve-3d"],
        ["contain", cs.contain, "paint"],
      ];
      for (const [prop, value, expect] of rows) {
        const ok =
          prop === "opacity" ? Number(value) === 1
          : prop === "isolation" ? value !== "isolate"
          : prop === "transform-style" ? value === "preserve-3d"
          : prop === "contain" ? !String(value).includes("paint")
          : value === expect;
        if (!ok) bad.push({ who: node.className || node.tagName, prop, value });
      }
    }
  }
  return { planes: planes.length, pieces: pieces.length, bad };
};

const server = startServer();
let browser;
try {
  await server.ready();
  browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
  // So o hook fica em init script (o SEED e aplicado depois do primeiro goto).
  await context.addInitScript(HOOK);
  const page = await context.newPage();
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
  // Casa de uma criatura da mao (garante jogada legal) e joga uma carta: a peca
  // no board e o fim da cadeia auditada.
  const house = await page.evaluate(() => {
    const labels = [...document.querySelectorAll(".hand-track .card-tile")].map((el) => el.getAttribute("aria-label") ?? "");
    const pick = labels.find((label) => label.includes(" Creature")) ?? labels[0] ?? "";
    return (pick.split(", ")[1] ?? "").replace(/ (Creature|Action|Artifact|Upgrade)$/, "");
  });
  await page.evaluate((name) => {
    const picks = [...document.querySelectorAll(".house-picker .house-choice:not([disabled])")];
    (picks.find((el) => el.textContent?.includes(name)) ?? picks[0])?.click();
  }, house);
  await page.waitForTimeout(300);
  const handTiles = page.locator(".hand-track .card-tile");
  for (let i = 0; i < (await handTiles.count()); i += 1) {
    await handTiles.nth(i).click();
    await page.waitForTimeout(140);
    const play = page.locator(".inspector-actions button.primary-action").first();
    if ((await play.count()) && (await play.isEnabled().catch(() => false))) { await play.click(); break; }
  }
  await page.waitForTimeout(600);
  // Turnos ate o board ter peca (o Warden joga toda vez): sem peca a auditoria
  // da cadeia seria vazia.
  const enabled = () => !document.querySelector(".end-turn-button")?.disabled;
  const pieces = () => document.querySelectorAll(".table-plane .board-piece").length;
  for (let turn = 0; turn < 3; turn += 1) {
    if (await page.evaluate(pieces)) break;
    await page.waitForFunction(enabled, null, { timeout: 90000 });
    await page.locator(".end-turn-button").click();
    await page.waitForFunction(() => document.querySelector(".end-turn-button")?.disabled, null, { timeout: 10000 }).catch(() => {});
    await page.waitForFunction(enabled, null, { timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(400);

  // ---- 1. 2D intacto
  const flat = await page.evaluate(CHAIN_AUDIT);  const flatState = await page.evaluate(() => {
    const plane = document.querySelector(".table-plane");
    const board = document.querySelector(".game-board");
    const lane = document.querySelector(".board-lane");
    return {
      display: plane ? getComputedStyle(plane).display : null,
      rects: plane ? plane.getClientRects().length : -1,
      cls3d: board ? board.className.includes("game-board--3d") : null,
      dataView: board ? board.getAttribute("data-view") : "sem board",
      laneOverflow: lane ? getComputedStyle(lane).overflowX : null,
      laneTransform: lane ? getComputedStyle(lane).transformStyle : null,
    };
  });
  check("2D: .table-plane e display: contents (sem caixa)", flatState.display === "contents" && flatState.rects === 0, JSON.stringify(flatState));
  check("2D: board sem classe/data-view 3D e lane com scroll", !flatState.cls3d && flatState.dataView === null && flatState.laneOverflow === "auto" && flatState.laneTransform === "flat", JSON.stringify(flatState));
  check("2D: pecas no board para a auditoria", flat.pieces > 0, `pieces=${flat.pieces}`);
  // H3D-01: o seed do probe NAO traz tableView (save antigo) — o app normaliza.
  const legacy = await page.evaluate(() => JSON.parse(localStorage.getItem("aember-arena-settings") ?? "{}").tableView);
  check("save antigo sem tableView le 2d", legacy === "2d", `tableView=${legacy}`);

  // ---- 2. Toggle no meio da partida
  await page.evaluate(() => { window.__tileCommits = 0; });
  await page.locator(".view-toggle").click();
  await page.waitForTimeout(120);
  const toggled = await page.evaluate(() => {
    const btn = document.querySelector(".view-toggle");
    const board = document.querySelector(".game-board");
    return {
      pressed: btn.getAttribute("aria-pressed"),
      focused: document.activeElement === btn,
      cls3d: board.className.includes("game-board--3d"),
      dataView: board.getAttribute("data-view"),
      tileCommits: window.__tileCommits,
      tilesSeen: window.__tilesSeen,
    };
  });
  check("toggle: aria-pressed, foco e classe/data-view", toggled.pressed === "true" && toggled.focused && toggled.cls3d && toggled.dataView === "3d", JSON.stringify(toggled));
  check("toggle: 0 re-render de CardTile", toggled.tileCommits === 0 && toggled.tilesSeen > 0, `commits=${toggled.tileCommits} tilesVistas=${toggled.tilesSeen}`);
  await page.waitForTimeout(500);

  // ---- 3. Cadeia sem agrupamento
  const chain = await page.evaluate(CHAIN_AUDIT);
  check("cadeia: .table-plane -> .board-piece sem agrupamento", chain.bad.length === 0, chain.bad.length ? JSON.stringify(chain.bad.slice(0, 6)) : `planes=${chain.planes} pieces=${chain.pieces}`);
  const piecePreserve = await page.evaluate(() => {
    const piece = document.querySelector(".table-plane .board-piece");
    return piece ? getComputedStyle(piece).transformStyle === "preserve-3d" : false;
  });
  check("cadeia: preserve-3d computado na peca", piecePreserve);
  const camera = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector(".board-content"));
    return { perspective: cs.perspective, origin: cs.perspectiveOrigin };
  });
  check("cadeia: perspective real no board-content", camera.perspective !== "none" && parseFloat(camera.perspective) > 500, JSON.stringify(camera));

  // ---- 4. Projecao: tilt 40 e translateZ na peca
  const projection = await page.evaluate(async () => {
    const plane = document.querySelector(".table-plane");
    const piece = document.querySelector(".table-plane .board-piece");
    const art = piece?.querySelector(".card-art");
    if (!plane || !piece || !art) return null;
    const settle = () => new Promise((r) => setTimeout(r, 520));
    const flatBox = art.getBoundingClientRect();
    const planeFlat = plane.getBoundingClientRect();
    plane.style.setProperty("--tilt", "40deg");
    await settle();
    const tilted = art.getBoundingClientRect();
    const planeTilted = plane.getBoundingClientRect();
    piece.style.translate = "0 0 80px";
    await settle();
    const lifted = art.getBoundingClientRect();
    piece.style.translate = "";
    plane.style.removeProperty("--tilt");
    await settle();
    return {
      flat: { w: flatBox.width, h: flatBox.height, planeW: planeFlat.width },
      tilted: { w: tilted.width, h: tilted.height, planeW: planeTilted.width },
      lifted: { w: lifted.width, h: lifted.height },
    };
  });
  check("projecao: cena 3D montada (plano + peca)", projection !== null);
  if (projection) {
    const shrink = 1 - projection.tilted.h / projection.flat.h;
    const widen = projection.tilted.planeW / projection.flat.planeW - 1;
    const zGrow = projection.lifted.w / projection.tilted.w - 1;
    check("projecao: tilt 40 encolhe a altura da .card-art (caixa != plana)", shrink > 0.08, `altura ${projection.flat.h.toFixed(1)} -> ${projection.tilted.h.toFixed(1)} (${(shrink * 100).toFixed(1)}%)`);
    check("projecao: perspectiva alarga a borda de perto", widen > 0.05, `largura do plano ${projection.flat.planeW.toFixed(0)} -> ${projection.tilted.planeW.toFixed(0)} (+${(widen * 100).toFixed(1)}%)`);
    check("projecao: translateZ da peca cresce a carta (Z vivo)", zGrow > 0.04, `largura ${projection.tilted.w.toFixed(1)} -> ${projection.lifted.w.toFixed(1)} (+${(zGrow * 100).toFixed(1)}%)`);
  }

  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, "probe-3d-chain.png") });

  // ---- 5. Smoke com tilt 0: dois turnos em 3D
  for (let turn = 0; turn < 2; turn += 1) {
    await page.waitForFunction(enabled, null, { timeout: 90000 });
    await page.locator(".end-turn-button").click();
    await page.waitForFunction(() => document.querySelector(".end-turn-button")?.disabled, null, { timeout: 10000 }).catch(() => {});
    await page.waitForFunction(enabled, null, { timeout: 90000 }).catch(() => {});
  }
  await page.waitForFunction(enabled, null, { timeout: 90000 }).catch(() => {});
  const smoke = await page.evaluate(() => ({
    round: document.querySelector(".turn-console .round-kicker")?.textContent ?? null,
    pieces: document.querySelectorAll(".table-plane .board-piece").length,
    winner: Boolean(document.querySelector(".winner-shade")),
  }));
  check("smoke 3D (tilt 0): dois turnos completos", Boolean(smoke.round), JSON.stringify(smoke));

  const clicked = await page.evaluate(() => {
    const tile = document.querySelector(".table-plane .board-piece .card-tile");
    if (!tile) return null;
    const r = tile.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const target = hit && hit.closest(".card-tile");
    return { same: target === tile, selected: tile.classList.contains("is-selected") };
  });
  if (clicked) check("hit-test 3D (tilt 0): o centro visual acerta a carta", clicked.same, JSON.stringify(clicked));

  // ---- 6. Volta ao 2D
  await page.evaluate(() => { window.__tileCommits = 0; });
  await page.locator(".view-toggle").click();
  await page.waitForTimeout(700);
  const back = await page.evaluate(() => {
    const plane = document.querySelector(".table-plane");
    const board = document.querySelector(".game-board");
    const lane = document.querySelector(".board-lane");
    return {
      display: getComputedStyle(plane).display,
      rects: plane.getClientRects().length,
      cls3d: board.className.includes("game-board--3d"),
      dataView: board.getAttribute("data-view"),
      laneOverflow: getComputedStyle(lane).overflowX,
      pressed: document.querySelector(".view-toggle").getAttribute("aria-pressed"),
      focused: document.activeElement === document.querySelector(".view-toggle"),
      tileCommits: window.__tileCommits,
    };
  });
  check("volta ao 2D: display contents, sem classe e lane com scroll", back.display === "contents" && back.rects === 0 && !back.cls3d && back.dataView === null && back.laneOverflow === "auto", JSON.stringify(back));
  check("volta ao 2D: aria-pressed=false, foco e 0 commits de tile", back.pressed === "false" && back.focused && back.tileCommits === 0, JSON.stringify(back));

  // Teste do teste: o contador enxerga um render de verdade — selecionar troca
  // `selected` na tile memoizada (sem isto, "0 commits" poderia ser um detector
  // cego). Roda aqui, com a vez do humano e as tiles respondendo.
  await page.evaluate(() => { window.__tileCommits = 0; });
  const detectorClicked = await page.evaluate(() => {
    const tile = document.querySelector(".hand-track .card-tile:not(:disabled)") ?? document.querySelector(".board-piece .card-tile:not(:disabled)");
    if (!tile) return false;
    tile.click();
    return true;
  });
  await page.waitForTimeout(300);
  const detector = await page.evaluate(() => ({ commits: window.__tileCommits, tiles: window.__tilesSeen }));
  check("teste do teste: o contador enxerga render de tile", detectorClicked && detector.commits > 0 && detector.tiles > 0, `click=${detectorClicked} commits=${detector.commits} tilesVistas=${detector.tiles}`);

  // ---- 7. H3D-01: toggle da Config + persistencia + reload
  // (a sessao esta em 2D: o toggle da Config comeca desligado e liga ao clique.)
  await page.locator(".header-nav .nav-link").nth(2).click();
  await page.waitForSelector(".config-screen", { timeout: 15000 });
  await page.locator(".config-screen .config-step-pill").nth(4).click();
  await page.waitForTimeout(250);
  const configToggle = page.locator('.config-screen [role="switch"][aria-label="3D table"]');
  const configState = {
    count: await configToggle.count(),
    checked: await configToggle.first().getAttribute("aria-checked").catch(() => null),
  };
  check("config: linha do toggle da mesa 3D presente e refletindo o 2D", configState.count === 1 && configState.checked === "false", JSON.stringify(configState));
  await configToggle.first().click();
  await page.waitForTimeout(250);
  const configOn = await page.evaluate(() => ({
    checked: document.querySelector('.config-screen [role="switch"][aria-label="3D table"]')?.getAttribute("aria-checked"),
    stored: JSON.parse(localStorage.getItem("aember-arena-settings") ?? "{}").tableView,
  }));
  await configToggle.first().click();
  await page.waitForTimeout(250);
  const configOff = await page.evaluate(() => ({
    checked: document.querySelector('.config-screen [role="switch"][aria-label="3D table"]')?.getAttribute("aria-checked"),
    stored: JSON.parse(localStorage.getItem("aember-arena-settings") ?? "{}").tableView,
  }));
  await configToggle.first().click();
  await page.waitForTimeout(250);
  check("config: toggle liga/desliga e persiste", configOn.checked === "true" && configOn.stored === "3d" && configOff.checked === "false" && configOff.stored === "2d", JSON.stringify({ configOn, configOff }));
  await page.locator(".config-screen .config-step-pill").last().click();
  await page.waitForTimeout(250);
  const review = await page.evaluate(() =>
    [...document.querySelectorAll(".review-list li")].map((li) => li.textContent ?? "").filter((text) => text.includes("3D table")),
  );
  check("config: resumo do setup mostra a visao da mesa", review.length === 1 && /On/.test(review[0]), JSON.stringify(review));

  // Recarrega: o app le o setting salvo e a partida retomada abre em 3D.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".home-screen", { timeout: 20000 });
  const resume = page.locator(".resume-bar");
  check("reload: partida em andamento oferecida na Home", (await resume.count()) > 0);
  await resume.first().click();
  await page.waitForSelector(".game-screen", { timeout: 20000 });
  const resumed = await page.evaluate(() => {
    const board = document.querySelector(".game-board");
    return { cls3d: board?.className.includes("game-board--3d") ?? false, view: board?.getAttribute("data-view") ?? null };
  });
  check("reload: setting sobreviveu (partida retomada abre em 3D)", resumed.cls3d && resumed.view === "3d", JSON.stringify(resumed));

  console.log(PROBLEMS.length ? `\nFALHAS: ${PROBLEMS.join("; ")}` : "\nOK: cadeia 3D confere (2D intacto, projecao viva, toggle limpo)");
} finally {
  if (browser) await browser.close().catch(() => {});
  server.stop();
}
process.exit(PROBLEMS.length ? 1 : 0);
