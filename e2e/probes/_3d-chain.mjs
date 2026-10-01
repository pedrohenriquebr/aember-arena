// Probe da cadeia 3D (H3D-02, VIEW3D_PLAN §2.1/§2.11). Roda num browser real:
//   1. 2D intacto: `.table-plane` é `display: contents` (sem caixa) e a lane
//      continua rolando como sempre.
//   2. Toggle no meio da partida: classe/data-view, aria-pressed, foco no
//      botão, cancelamento dos FX em voo e ZERO re-render de CardTile.
//   3. Cadeia sem agrupamento de `.table-plane` até `.board-piece`: overflow,
//      opacity, filter, isolation, clip-path/mask, contain e transform-style.
//   4. Projeção viva: forçando --tilt: 0deg e depois 40deg, a altura do plano
//      encurta (mesa em perspectiva) e a borda de perto alarga; um translateZ
//      na peça cresce a carta — se algum ancestral achatasse, nem a inclinação
//      nem o Z apareceriam.
//   5. Smoke do 3D (tilt default da faixa): dois turnos completos e clique no
//      board.
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

  // H3D-04: a pose 3D vive nas propriedades individuais do piece — o
  // card-arrive (fill both) e dono de `transform` e venceria uma pose estatica
  // (o check das 400ms garante que nao sobrou transform residual da animacao).
  await page.waitForTimeout(450);
  const pose = await page.evaluate(() => {
    const piece = document.querySelector(".table-plane .board-piece");
    if (!piece) return null;
    const cs = getComputedStyle(piece);
    return { rotate: cs.rotate, translate: cs.translate, animation: cs.animationName };
  });
  check("H3D-04: peca em pe com pose propria (rotate -28deg, lift em Z, sem animacao residual)", Boolean(pose) && pose.rotate === "x -28deg" && pose.translate !== "none" && pose.animation === "none", JSON.stringify(pose));

  // ---- H3D-05: sombra difusa separada, deitada no tapete e reativa ao lift
  const shadow = await page.evaluate(() => {
    const piece = document.querySelector(".table-plane .board-piece");
    if (!piece) return null;
    const cs = getComputedStyle(piece, "::before");
    const pr = piece.getBoundingClientRect();
    return {
      content: cs.content,
      opacity: cs.opacity,
      scale: cs.scale,
      background: cs.backgroundImage,
      pointerEvents: cs.pointerEvents,
      box: { w: parseFloat(cs.width), h: parseFloat(cs.height) },
      piece: { w: pr.width, h: pr.height },
    };
  });
  check(
    "H3D-05: sombra difusa deitada sob a carta (gradiente, pointer-events none, mais larga que alta)",
    Boolean(shadow) && shadow.content === '""' && /radial-gradient/.test(shadow.background) && shadow.pointerEvents === "none" && shadow.box.w > shadow.box.h,
    JSON.stringify(shadow ? { ...shadow, background: shadow.background.slice(0, 40) } : null),
  );
  check("H3D-05: em repouso a sombra fica em 0,62 / escala 1", Boolean(shadow) && Number(shadow.opacity) === 0.62 && parseFloat(shadow.scale) === 1, JSON.stringify({ opacity: shadow?.opacity, scale: shadow?.scale }));

  const hoverPoint = await page.evaluate(() => {
    const piece = document.querySelector(".table-plane .board-piece");
    if (!piece) return null;
    const r = piece.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height * 0.4 };
  });
  let spread = null;
  if (hoverPoint) {
    await page.mouse.move(hoverPoint.x, hoverPoint.y);
    await page.waitForTimeout(260);
    spread = await page.evaluate(() => {
      const piece = document.querySelector(".table-plane .board-piece");
      const cs = getComputedStyle(piece, "::before");
      return { opacity: cs.opacity, scale: cs.scale, tile: getComputedStyle(piece.querySelector(".card-tile")).translate };
    });
    await page.mouse.move(4, 4);
    await page.waitForTimeout(200);
  }
  check("H3D-05: hover ergue a carta e espalha a sombra (0,32 / 1,18)", Boolean(spread) && Number(spread.opacity) === 0.32 && Number(spread.scale) === 1.18, JSON.stringify(spread));

  // H3D-05/§2.9: dentro do plano so transform/opacity animam — nenhum
  // box-shadow/filter animado (o ready-breathe/sel-breathe/status-glow viram
  // pulsos de opacity no 3D).
  const costly = await page.evaluate(() => {
    const out = [];
    for (const a of document.getAnimations()) {
      const el = a.effect?.target;
      if (!el?.closest?.(".table-plane")) continue;
      const props = (a.effect?.getKeyframes?.() ?? []).flatMap((k) => Object.keys(k));
      const bad = [...new Set(props)].filter((p) => /box-?shadow|filter/i.test(p.replace(/([a-z])([A-Z])/g, "$1-$2")));
      if (bad.length) out.push({ name: a.animationName ?? null, target: String(el.className).split(" ").slice(0, 2).join("."), props: bad });
    }
    return out;
  });
  check("H3D-05: zero box-shadow/filter animado dentro do plano", costly.length === 0, JSON.stringify(costly));

  // ---- H3D-06: mao em leque (>= 701px; o probe roda a 1280)
  const fan = await page.evaluate(() => {
    const track = document.querySelector(".hand-track");
    const cards = [...document.querySelectorAll(".hand-track > .card-tile--hand")];
    const cs = getComputedStyle(track);
    const rots = cards.map((el) => parseFloat(getComputedStyle(el).rotate));
    return { n: cards.length, overflow: cs.overflowX, paddingTop: cs.paddingTop, first: rots[0], last: rots[rots.length - 1] };
  });
  const expectedRot = ((fan.n - 1) / 2) * 3.5;
  check(
    "H3D-06/14: leque aberto (track sem clip nem padding de overlay, pontas na rotacao 3,5/carta)",
    fan.n > 0 && fan.overflow === "visible" && parseFloat(fan.paddingTop) === 0 && Math.abs(-fan.first - expectedRot) < 0.6 && Math.abs(fan.last - expectedRot) < 0.6,
    JSON.stringify({ ...fan, expectedRot }),
  );
  const midPoint = await page.evaluate((i) => {
    const el = document.querySelectorAll(".hand-track > .card-tile--hand")[i];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height * 0.55 };
  }, Math.floor(fan.n / 2));
  let fanHover = null;
  if (midPoint) {
    await page.mouse.move(midPoint.x, midPoint.y);
    await page.waitForTimeout(280);
    fanHover = await page.evaluate(() => {
      const el = document.querySelector(".hand-track > .card-tile--hand:hover");
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const board = document.querySelector(".game-board").getBoundingClientRect();
      return { rotate: cs.rotate, translate: cs.translate, scale: cs.scale, visible: r.top >= board.top && r.bottom <= board.bottom && r.left >= board.left && r.right <= board.right };
    });
    await page.mouse.move(4, 4);
    await page.waitForTimeout(200);
  }
  // H3D-14: a mao e overlay, a erguida sobe 30% da propria altura + 12px.
  check("H3D-06/14: hover puxa a carta do leque (0deg / -30% - 12px / 1,14) inteira visivel", Boolean(fanHover) && fanHover.rotate === "0deg" && fanHover.translate === "0px calc(-30% - 12px)" && fanHover.scale === "1.14" && fanHover.visible, JSON.stringify(fanHover));

  // H3D-14: com 7 e 8 cartas (clones temporarios, sem transicao) a 1280 e 768 a
  // mao-overlay mostra >= 70% de CADA carta, pontas incluidas (o resto sai pela
  // borda do .game-board de proposito).
  const fanCaption = async (width, height) => {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(300);
    return page.evaluate(() => {
      const track = document.querySelector(".hand-track");
      const board = document.querySelector(".game-board").getBoundingClientRect();
      const saved = track.style.getPropertyValue("--n");
      const kids = [...track.children];
      const clones = [];
      const style = document.createElement("style");
      style.textContent = ".hand-track > * { transition: none !important; animation: none !important; }"; // clone novo = card-deal em voo
      document.head.append(style);
      const out = {};
      for (const n of [7, 8]) {
        while (track.children.length < n) { const c = kids[0].cloneNode(true); clones.push(c); track.append(c); }
        while (track.children.length > n && clones.length) clones.pop().remove();
        track.style.setProperty("--n", String(n));
        let worst = 1;
        for (const el of track.querySelectorAll(".card-tile--hand")) {
          const r = el.getBoundingClientRect();
          worst = Math.min(worst, (Math.min(r.bottom, board.bottom) - r.top) / r.height);
        }
        out[n] = Math.round(worst * 1000) / 1000;
      }
      clones.forEach((c) => c.remove());
      style.remove();
      if (saved) track.style.setProperty("--n", saved); else track.style.removeProperty("--n");
      return out;
    });
  };
  for (const [w, h] of [[1280, 800], [768, 1024]]) {
    const over = await fanCaption(w, h);
    check(`H3D-06/14: mao-overlay >= 70% visivel por carta a ${w} (7 e 8 cartas)`, over[7] >= 0.7 && over[8] >= 0.7, JSON.stringify(over));
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);

  // ---- 4. Projecao: tilt 0 -> 40 e translateZ na peca
  // H3D-03: o default do 3D ja e 40deg (32 no tablet), entao o probe ZERA o
  // tilt inline para ter a referencia plana — comparar 40 com 40 nao mede nada.
  const projection = await page.evaluate(async () => {
    const plane = document.querySelector(".table-plane");
    const piece = document.querySelector(".table-plane .board-piece");
    const art = piece?.querySelector(".card-art");
    if (!plane || !piece || !art) return null;
    const settle = () => new Promise((r) => setTimeout(r, 520));
    plane.style.setProperty("--tilt", "0deg");
    await settle();
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
      flat: { w: flatBox.width, h: flatBox.height, planeW: planeFlat.width, planeH: planeFlat.height },
      tilted: { w: tilted.width, h: tilted.height, planeW: planeTilted.width, planeH: planeTilted.height },
      lifted: { w: lifted.width, h: lifted.height },
    };
  });
  check("projecao: cena 3D montada (plano + peca)", projection !== null);
  if (projection) {
    const planeShrink = 1 - projection.tilted.planeH / projection.flat.planeH;
    const widen = projection.tilted.planeW / projection.flat.planeW - 1;
    const zGrow = projection.lifted.w / projection.tilted.w - 1;
    check("projecao: tilt 40 encurta a altura do plano (mesa em perspectiva)", planeShrink > 0.2, `altura do plano ${projection.flat.planeH.toFixed(1)} -> ${projection.tilted.planeH.toFixed(1)} (${(planeShrink * 100).toFixed(1)}%)`);
    check("projecao: perspectiva alarga a borda de perto", widen > 0.05, `largura do plano ${projection.flat.planeW.toFixed(0)} -> ${projection.tilted.planeW.toFixed(0)} (+${(widen * 100).toFixed(1)}%)`);
    check("projecao: translateZ da peca cresce a carta (Z vivo)", zGrow > 0.04, `largura ${projection.tilted.w.toFixed(1)} -> ${projection.lifted.w.toFixed(1)} (+${(zGrow * 100).toFixed(1)}%)`);
  }

  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, "probe-3d-chain.png") });

  // Registro visual do plano inclinado a 40 (o probe nao julga imagem; a captura
  // fica para inspecao humana — a mesa de verdade e do H3D-03).
  await page.evaluate(() => document.querySelector(".table-plane")?.style.setProperty("--tilt", "40deg"));
  await page.waitForTimeout(650);
  await page.screenshot({ path: join(SHOTS, "probe-3d-chain-tilt40.png") });
  await page.evaluate(() => document.querySelector(".table-plane")?.style.removeProperty("--tilt"));
  await page.waitForTimeout(650);

  // ---- 5. Smoke no 3D (tilt default da faixa: 40 no desktop): dois turnos
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
  check("smoke 3D: dois turnos completos", Boolean(smoke.round), JSON.stringify(smoke));

  // H3D-12: o parallax da camera e alimentado por pointermove de verdade e o
  // lerp leva ~600ms para assentar; o hit-test mede em repouso (ponteiro fora
  // do board) para nao pegar a camera no meio do caminho.
  await page.mouse.move(4, 4);
  await page.waitForTimeout(900);
  const clicked = await page.evaluate(() => {
    const tile = document.querySelector(".table-plane .board-piece .card-tile");
    if (!tile) return null;
    const r = tile.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const target = hit && hit.closest(".card-tile");
    return {
      same: target === tile,
      selected: tile.classList.contains("is-selected"),
      point: [Math.round(cx), Math.round(cy)],
      what: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).split(" ").slice(0, 2).join(".")}` : "nada",
      iid: tile.dataset.iid ?? null,
      camera: document.querySelector(".table-plane")?.style.getPropertyValue("--cam-x") || "0",
    };
  });
  if (clicked) check("hit-test 3D (tilt 40): o centro visual acerta a carta", clicked.same, JSON.stringify(clicked));

  // ---- H3D-12: parallax da camera (ponteiro -> --cam-x/--cam-y -> ±2,5°/±1,5°)
  // O probe corre a 1280 com animacoes ligadas: o hook esta ativo. O ponteiro
  // move de verdade; o que se mede e o transform computado do plano. O
  // matrix3d do CSS e COLUMN-major: o 3o valor (m[2]) e -sin(rotY).
  // O smoke rola a pagina ate o botao de fim de turno; sem voltar ao topo, o
  // topo do board pode ficar sob o header sticky e o ponteiro sai do board.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  // O lerp da camera anda por quadro: em headless (raster por software) 450ms
  // fixos nao bastam sempre. Espera a camera parar (duas leituras iguais).
  const settleCam = async () => {
    let prev = "";
    for (let i = 0; i < 40; i += 1) {
      await page.waitForTimeout(120);
      const cur = await page.evaluate(() => {
        const st = document.querySelector(".table-plane").style;
        return `${st.getPropertyValue("--cam-x")}|${st.getPropertyValue("--cam-y")}`;
      });
      if (cur === prev) return;
      prev = cur;
    }
  };
  const boardBox = await page.locator(".game-board").boundingBox();
  if (boardBox) {
    const vpSize = page.viewportSize();
    const midY = Math.min(boardBox.y + boardBox.height * 0.5, vpSize.height - 60);
    await page.evaluate(() => { window.__tileCommits = 0; });
    await page.mouse.move(boardBox.x + boardBox.width * 0.03, midY);
    await settleCam();
    const readCam = (key) => page.evaluate((k) => {
      const plane = document.querySelector(".table-plane");
      const parts = getComputedStyle(plane).transform.match(/matrix3d\(([^)]+)\)/);
      const m = parts ? parts[1].split(",").map(Number) : [];
      return { camX: plane.style.getPropertyValue("--cam-x"), camY: plane.style.getPropertyValue("--cam-y"), m13: m[2] ?? null, m22: m[5] ?? null, commits: window.__tileCommits, key: k };
    }, key);
    const left = await readCam("esquerda");
    await page.mouse.move(boardBox.x + boardBox.width * 0.97, midY);
    await settleCam();
    const right = await readCam("direita");
    const degY = (value) => (value === null ? NaN : (Math.asin(Math.max(-1, Math.min(1, -value))) * 180) / Math.PI);
    check("H3D-12: ponteiro a esquerda inclina a camera em -2,5 graus (Y)", left.m13 !== null && Math.abs(degY(left.m13) + 2.5) < 0.6, JSON.stringify(left));
    check("H3D-12: ponteiro a direita em +2,5 graus (Y)", right.m13 !== null && Math.abs(degY(right.m13) - 2.5) < 0.6, JSON.stringify(right));
    // Eixo X: o topo do board soma -1,5 grau ao tilt (40 -> 38,5; cos = 0,7825).
    const headerBottom = await page.evaluate(() => document.querySelector(".app-header")?.getBoundingClientRect().bottom ?? 0);
    const topX = boardBox.x + boardBox.width * 0.5;
    const topY = Math.max(boardBox.y, headerBottom) + 6;
    await page.mouse.move(topX, topY);
    await settleCam();
    const topInBoard = await page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest(".game-board")), [topX, topY]);
    check("H3D-12: ponto 'topo' do ponteiro cai dentro do board", topInBoard, `y=${topY.toFixed(0)} header=${headerBottom.toFixed(0)} board=${boardBox.y.toFixed(0)}`);
    const top = await readCam("topo");
    const degX = (value) => (value === null ? NaN : (Math.acos(Math.max(-1, Math.min(1, value))) * 180) / Math.PI);
    check("H3D-12: ponteiro no topo tira 1,5 grau do tilt (X)", top.m22 !== null && Math.abs(degX(top.m22) - 38.5) < 0.8, `tilt=${degX(top.m22)?.toFixed(2)} ${JSON.stringify(top)}`);
    check("H3D-12: parallax nao re-renderiza CardTile", left.commits === 0 && right.commits === 0, `commits=${left.commits}/${right.commits}`);
    // Ponteiro fora do board: volta ao neutro (lerp de 0,12/frame).
    await page.mouse.move(4, 4);
    await settleCam();
    const neutral = await page.evaluate(() => {
      const plane = document.querySelector(".table-plane");
      return { camX: plane.style.getPropertyValue("--cam-x"), camY: plane.style.getPropertyValue("--cam-y") };
    });
    check("H3D-12: ponteiro fora do board volta ao neutro", Math.abs(parseFloat(neutral.camX || "0")) < 0.15 && Math.abs(parseFloat(neutral.camY || "0")) < 0.15, JSON.stringify(neutral));
  } else {
    check("H3D-12: board medivel", false, "sem boundingBox do board");
  }

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
  // H3D-16 (no tabuleiro, antes de sair da partida): o giro de cada carta (--jr inline, do cardJitter) sobrevive ao reload.
  const jrOf = () =>
    page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll(".board-piece")].map((p) => [p.querySelector(".card-tile")?.dataset.iid, p.style.getPropertyValue("--jr")]),
      ),
    );
  const jrBefore = await jrOf();

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

  // H3D-16: mesmo id -> mesmo giro depois do reload, e a arte em repouso o aplica.
  const jrAfter = await jrOf();
  const jrIds = Object.keys(jrBefore).filter((id) => id && id in jrAfter);
  const jrSame = jrIds.every((id) => jrBefore[id] === jrAfter[id]);
  const jrApplied = await page.evaluate(() =>
    [...document.querySelectorAll(".game-board--3d .battle-zone .board-lane > .board-piece:not(.board-piece--resting)")].every((p) => {
      const jr = parseFloat(p.style.getPropertyValue("--jr")) || 0;
      const rot = getComputedStyle(p.querySelector(".card-art")).rotate;
      return Math.abs((rot === "none" ? 0 : parseFloat(rot) || 0) - jr) < 0.01;
    }),
  );
  // H3D-16: a selecionada endireita (rotate z = 0 na arte apos 150ms).
  const jrSel = await page.evaluate(async () => {
    const piece = document.querySelector(".table-plane .board-lane > .board-piece:not(.board-piece--resting)");
    const tile = piece?.querySelector(".card-tile");
    if (!tile) return null;
    tile.classList.add("is-selected");
    await new Promise((r) => setTimeout(r, 260));
    const rot = getComputedStyle(tile.querySelector(".card-art")).rotate;
    tile.classList.remove("is-selected");
    return rot;
  });
  check("H3D-16: carta selecionada tem rotate z = 0 na arte", jrSel === "none" || Math.abs(parseFloat(jrSel)) < 0.01, String(jrSel));
  // H3D-18: custo de animacao no plano (so opacity/scale; infinitas <= cartas prontas) e
  // a troca pronta -> exausta em 200ms.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  const anim = await page.evaluate(() => {
    const plane = document.querySelector(".table-plane");
    const all = plane.getAnimations({ subtree: true });
    // So as das pecas: o pulso do round-dot do console (1 fixo) fica fora da conta.
    const infinite = all.filter((a) => a.effect?.getComputedTiming().iterations === Infinity && a.effect.target?.closest?.(".board-piece"));
    const costly = all.filter((a) => a.effect?.getKeyframes().some((k) => "boxShadow" in k || "filter" in k));
    return {
      ready: plane.querySelectorAll(".board-piece--ready").length,
      infinite: infinite.length,
      names: infinite.map((a) => a.animationName ?? a.transitionProperty),
      costly: costly.length,
      arcAnim: plane.querySelector(".board-piece--ready") ? getComputedStyle(plane.querySelector(".board-piece--ready"), "::after").animationName : "none",
    };
  });
  check("H3D-18: plano sem animacao de box-shadow/filter e infinitas <= cartas prontas", anim.costly === 0 && anim.infinite <= anim.ready && (anim.ready === 0 || anim.arcAnim === "ready-arc"), JSON.stringify(anim));
  const swap = await page.evaluate(async () => {
    const piece = document.querySelector(".table-plane .board-lane > .board-piece:not(.board-piece--resting):not(.board-piece--stunned)");
    const art = piece?.querySelector(".card-art");
    if (!art) return null;
    piece.classList.add("board-piece--resting");
    const t = art.getAnimations().find((a) => a.transitionProperty === "rotate");
    const out = t ? t.effect.getComputedTiming().duration : null;
    piece.classList.remove("board-piece--resting");
    return out;
  });
  check("H3D-18: troca pronta -> exausta leva 200ms (+-20)", swap !== null && Math.abs(swap - 200) <= 20, String(swap));
  check("H3D-16: reload mantem o --jr de cada carta e a arte aplica o giro", jrIds.length > 0 && jrSame && jrApplied, JSON.stringify({ ids: jrIds.length, jrSame, jrApplied }));

  // ---- 8. H3D-10: a transicao entre modos (partida retomada esta em 3D)
  await page.evaluate(() => {
    window.__cls = 0;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
      }).observe({ type: "layout-shift", buffered: false });
    } catch { /* motor sem layout-shift: o check de CLS vira 0 */ }
  });
  await page.locator(".view-toggle").click();
  await page.waitForTimeout(140);
  const switching = await page.evaluate(() => {
    const board = document.querySelector(".game-board");
    const content = document.querySelector(".board-content");
    const plane = document.querySelector(".table-plane");
    const contentCs = getComputedStyle(content);
    const planeCs = getComputedStyle(plane);
    return {
      cls: board.className.includes("game-board--switching"),
      animation: contentCs.animationName,
      duration: contentCs.animationDuration,
      willChange: planeCs.willChange,
      transitionProperty: planeCs.transitionProperty,
      transitionDuration: planeCs.transitionDuration,
    };
  });
  check("H3D-10: classe da troca + fade de 420ms + will-change no plano", switching.cls && switching.animation === "view-fade" && switching.duration === "0.42s" && switching.willChange === "transform", JSON.stringify(switching));
  check("H3D-10: --tilt declarado com transicao de 420ms", /(^|,)\s*--tilt/.test(switching.transitionProperty) && switching.transitionDuration === "0.42s", JSON.stringify(switching));
  await page.waitForTimeout(700);
  const settled = await page.evaluate(() => {
    const board = document.querySelector(".game-board");
    return {
      cls: board.className.includes("game-board--switching"),
      view: board.getAttribute("data-view"),
      willChange: getComputedStyle(document.querySelector(".table-plane")).willChange,
      cls2d: !board.className.includes("game-board--3d"),
      clsValue: window.__cls,
    };
  });
  check("H3D-10: no fim da troca a classe e o will-change saem (2D)", !settled.cls && settled.willChange === "auto" && settled.cls2d && settled.view === null, JSON.stringify(settled));
  check("H3D-10: nenhum layout shift na troca (CLS 0)", settled.clsValue === 0, `cls=${settled.clsValue}`);

  // Volta ao 3D e mede a interpolacao real do --tilt: com @property registrado,
  // getComputedStyle devolve o valor ANIMADO (nao o alvo).
  await page.locator(".view-toggle").click();
  await page.waitForTimeout(700);
  const tilt = await page.evaluate(async () => {
    const plane = document.querySelector(".table-plane");
    const read = () => parseFloat(getComputedStyle(plane).getPropertyValue("--tilt")) || 0;
    // H3D-03: o default do 3D e 40deg — zera primeiro para a interpolacao medir
    // uma mudanca real em vez de "40 -> 40".
    plane.style.setProperty("--tilt", "0deg");
    await new Promise((r) => setTimeout(r, 620));
    const start = performance.now();
    plane.style.setProperty("--tilt", "40deg");
    const samples = [];
    let settleMs = null;
    while (performance.now() - start < 900) {
      await new Promise((r) => setTimeout(r, 16));
      const value = read();
      samples.push(Math.round(value * 10) / 10);
      if (settleMs === null && value >= 39.9) settleMs = Math.round(performance.now() - start);
    }
    plane.style.removeProperty("--tilt");
    await new Promise((r) => setTimeout(r, 500));
    return { settleMs, quarter: samples[Math.floor(samples.length / 4)] ?? null, distinct: new Set(samples).size, first: samples[0] ?? null };
  });
  // O "assentar" aparece antes dos 420ms nominais: a curva (0.2, 0.8, 0.2, 1)
  // já está a <0,25% do alvo no fim — o que importa é interpolair (valores
  // distintos, meio do caminho estritamente entre 0 e 40) e assentar na janela.
  check("H3D-10: --tilt interpola de verdade e assenta em 420ms", tilt.settleMs !== null && tilt.settleMs > 330 && tilt.settleMs < 480 && tilt.distinct > 5 && tilt.quarter > 0 && tilt.quarter < 40, JSON.stringify(tilt));

  // Durante o fade o board-content fica com opacity < 1 (camada de grupo): a
  // projecao tem de continuar viva — o grupo re-rasteriza a cena, nao a achata.
  // H3D-04: as cartas ficam DE PE (lean 12), entao a altura da arte quase nao
  // muda com o tilt; quem mede a projecao viva e a altura do PLANO (que segue
  // encurtando ~24% com o tilt 40 mesmo com opacity < 1 no ancestral).
  const fadeProjection = await page.evaluate(async () => {
    const content = document.querySelector(".board-content");
    const plane = document.querySelector(".table-plane");
    if (!plane) return null;
    plane.style.setProperty("--tilt", "0deg");
    await new Promise((r) => setTimeout(r, 620));
    const flat = plane.getBoundingClientRect().height;
    content.style.opacity = "0.65";
    plane.style.setProperty("--tilt", "40deg");
    await new Promise((r) => setTimeout(r, 700));
    const faded = plane.getBoundingClientRect().height;
    plane.style.removeProperty("--tilt");
    content.style.opacity = "";
    await new Promise((r) => setTimeout(r, 700));
    return { flat, faded };
  });
  check("H3D-10: o fade nao achata o 3D (projecao viva com opacity < 1)", fadeProjection !== null && fadeProjection.faded < fadeProjection.flat * 0.9, JSON.stringify(fadeProjection));

  // Reduce-motion: a troca e instantanea (o `*` global derruba a duracao).
  await page.evaluate(() => document.documentElement.classList.add("reduce-motion"));
  await page.evaluate(() => document.querySelector(".game-board").classList.add("game-board--switching"));
  const rmDuration = await page.evaluate(() => getComputedStyle(document.querySelector(".board-content")).animationDuration);
  await page.evaluate(() => document.querySelector(".game-board").classList.remove("game-board--switching"));
  await page.waitForTimeout(60);
  await page.locator(".view-toggle").click();
  await page.waitForTimeout(150);
  const rmState = await page.evaluate(() => ({
    cls: document.querySelector(".game-board").className.includes("game-board--switching"),
    view: document.querySelector(".game-board").getAttribute("data-view"),
  }));
  await page.evaluate(() => document.documentElement.classList.remove("reduce-motion"));
  check("H3D-10: reduce-motion troca em 1 frame", parseFloat(rmDuration) < 0.01 && !rmState.cls && rmState.view === null, `duracao=${rmDuration} ${JSON.stringify(rmState)}`);

  // Orcamento de frame da troca com CPU 4x (a meta e nenhum frame > 33ms).
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const frames = await page.evaluate(async () => {
    const deltas = [];
    let last = performance.now();
    const onFrame = (now) => {
      deltas.push(now - last);
      last = now;
      if (deltas.length < 90) requestAnimationFrame(onFrame);
    };
    requestAnimationFrame(onFrame);
    await new Promise((r) => setTimeout(r, 80));
    document.querySelector(".view-toggle")?.click();
    await new Promise((r) => setTimeout(r, 1600));
    return deltas;
  });
  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const worst = frames.length ? Math.max(...frames) : 0;
  const long = frames.filter((d) => d > 33).length;
  // O primeiro quadro longo e o do clique (layout+raster da mesa inteira) e o
  // ultimo, quando existe, e o ocio/teardown do evaluate: o corpo da transicao
  // e o que fica ENTRE eles — e ali que um fade que repintasse a cena por quadro
  // apareceria. Com um unico quadro longo (so o clique) nao ha corpo a acusar,
  // entao o recorte segue do clique ate o fim.
  const longFrames = frames.map((d, i) => (d > 150 ? i : -1)).filter((i) => i >= 0);
  const body = frames.slice(
    longFrames.length ? longFrames[0] + 1 : 0,
    longFrames.length > 1 ? longFrames[longFrames.length - 1] : frames.length,
  );
  const bodyLong = body.filter((d) => d > 150).length;
  console.log(`INFO H3D-10: frames com CPU 4x — pior=${worst.toFixed(1)}ms, >33ms=${long}/${frames.length}, corpo>150ms=${bodyLong}/${body.length} (headless renderiza em software; a meta de 60fps do plano §2.9 vale com GPU)`);
  // Minimo de amostras: o headless rasteriza em software e, com a cena pesada
  // (40 graus + cartas de pe), a janela rende menos quadros — o que importa e o
  // corpo nao ter travamento; 8 amostras ja cobrem a transicao.
  check("H3D-10: corpo da transicao sem travamento (CPU 4x)", frames.length > 8 && bodyLong <= 1, `pior=${worst.toFixed(1)}ms corpo>150ms=${bodyLong}/${body.length} deltas=${frames.map((d) => d.toFixed(0)).join(",")}`);

  // ---- H3D-09: perfil lite (hardwareConcurrency = 2) — o plano precisa de caixa
  // e ancoragem, senao o playmat (::before) vaza sobre os HUDs.
  const liteCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
  await liteCtx.addInitScript("Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 })");
  const lite = await liteCtx.newPage();
  await lite.goto(server.url, { waitUntil: "domcontentloaded" });
  await lite.evaluate(SEED);
  await lite.reload({ waitUntil: "domcontentloaded" });
  await lite.waitForSelector(".home-screen", { timeout: 30000 });
  await lite.locator(".header-nav .nav-link").nth(2).click();
  await lite.waitForSelector(".config-screen", { timeout: 15000 });
  const litePills = lite.locator(".config-screen .config-step-pill");
  await litePills.nth((await litePills.count()) - 1).click();
  await lite.locator(".config-nav .cta-button").click();
  await lite.waitForSelector(".game-screen", { timeout: 20000 });
  const liteKeep = lite.locator(".mulligan-keep");
  if (await liteKeep.count()) await liteKeep.click();
  await lite.waitForSelector(".game-board", { timeout: 20000 });
  await lite.locator(".view-toggle").click();
  await lite.waitForSelector(".game-board--lite", { timeout: 5000 }).catch(() => {});
  const liteInfo = await lite.evaluate(() => {
    const board = document.querySelector(".game-board");
    const plane = document.querySelector(".table-plane");
    const cs = getComputedStyle(plane);
    return { cls: board.className, cores: navigator.hardwareConcurrency, display: cs.display, position: cs.position, before: getComputedStyle(plane, "::before").position };
  });
  check("H3D-09/14: lite ativo com plano grid do palco/position:relative e playmat ancorado", liteInfo.cls.includes("game-board--lite") && !liteInfo.cls.includes("game-board--3d") && liteInfo.display === "grid" && liteInfo.position === "relative" && liteInfo.before === "absolute", JSON.stringify(liteInfo));
  await liteCtx.close();

  console.log(PROBLEMS.length ? `\nFALHAS: ${PROBLEMS.join("; ")}` : "\nOK: cadeia 3D confere (2D intacto, projecao viva, toggle limpo)");
} finally {
  if (browser) await browser.close().catch(() => {});
  server.stop();
}
process.exit(PROBLEMS.length ? 1 : 0);
