// Probe do layout Arena da mesa 3D (H3D-13, docs/VIEW3D_ARENA_LAYOUT.md §3/§4).
// Mede a GEOMETRIA dos elementos novos num browser real, com boards de SAVE FIXO
// (o motor constroi: createMatch + pecas clonadas), a 1296x668, 1280x800,
// 1920x1080, 1024x768 e 768x1024:
//   H3D-14  mesa no palco: sem scroll do documento, linhas <= viewport, plano em
//           grid, mao com >= 70% visivel (100% na selecionada), nenhuma carta sob
//           HUD, escala oponente/jogador 0,74-0,80, 6 criaturas sem sobreposicao.
//   H3D-15  fileiras por zona: artefatos na fileira externa (abaixo no jogador,
//           acima no oponente), fora do notch central de 200px, 0,55-0,65x da
//           criatura, linha 3 com 0px sem artefato, colunas por fileira e a lista
//           "anexos" na arvore de acessibilidade.
//   todos   hit-test do centro visual de cada peca.
// `--break` injeta `.board-lane{display:flex}` no 3D: o probe TEM de falhar (o teste
// do teste) e o exit code inverte. Uso: node e2e/probes/_3d-arena.mjs [--break]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5219;
const SHOTS = join(ROOT, "e2e", "clips", "frames");
const BREAK = process.argv.includes("--break");
const SHOOT = process.argv.includes("--shots");
const VIEWPORTS = [
  { w: 1296, h: 668 },
  { w: 1280, h: 800 },
  { w: 1920, h: 1080 },
  { w: 1024, h: 768 },
  { w: 768, h: 1024 },
];

const SEED = `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: false,
    hoverZoom: false, hints: false, language: "en", tableView: "3d", opponentMode: "mirror", gameMode: "solo", aiSpeed: "fast",
  }));
  localStorage.setItem("aember-arena-language", "en");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
})()`;

// Seeds: creatures/artifacts por lado, 1 upgrade preso a criatura 0 do jogador e
// estados (atordoada, exausta, 2 de ambar) quando `states`. Os iids levam o papel
// no prefixo (cr-/art-/up-) para o probe classificar sem depender do CSS novo.
const FIXTURE = (spec) => `(async () => {
  const game = await import("/src/lib/game.ts");
  const demo = await import("/src/lib/demoDeck.ts");
  const deck = demo.DEMO_DECK;
  let state = game.createMatch(deck, deck, { seed: 424242 });
  state = game.keepHand(state, 0);
  state = game.keepHand(state, 1);
  const house = state.players[0].houses[0];
  const creatures = deck.cards.filter((c) => c.type === "Creature" && c.house === house);
  const pool = creatures.length >= 3 ? creatures : deck.cards.filter((c) => c.type === "Creature");
  const artifacts = deck.cards.filter((c) => c.type === "Artifact");
  const upgrade = deck.cards.find((c) => c.type === "Upgrade");
  const spec = ${JSON.stringify(spec)};
  const mk = (role, i, face, extra) => ({ instanceId: role + "-" + spec.tag + "-" + i, face, damage: 0, ready: true, stunned: false, ...extra });
  const side = (s, base) => {
    const cr = Array.from({ length: s.cr }, (_, i) => mk("cr", base + i, pool[i % pool.length]));
    const art = Array.from({ length: s.art }, (_, i) => mk("art", base + i, artifacts[i % artifacts.length]));
    const up = s.up ? [mk("up", base, upgrade, { attachedTo: cr[0].instanceId })] : [];
    if (spec.states && cr.length >= 3) {
      cr[1].stunned = true;
      cr[2].ready = false;
      cr[0].amber = 2;
    }
    return [...cr, ...art, ...up];
  };
  state.players[0].board = side(spec.player, 0);
  state.players[1].board = side(spec.opp, 100);
  state.activePlayer = 0;
  state.activeHouse = house;
  localStorage.setItem("aember-arena-match", JSON.stringify({ game: state, deckId: demo.DEMO_DECK_ID, savedAt: 1 }));
  return { house, hand: state.players[0].hand.length };
})()`;

const SEEDS = [
  { tag: "base6", player: { cr: 6, art: 0, up: 0 }, opp: { cr: 6, art: 0, up: 0 } },
  { tag: "arts", player: { cr: 6, art: 2, up: 1 }, opp: { cr: 6, art: 2, up: 0 } },
  { tag: "c12", player: { cr: 12, art: 0, up: 0 }, opp: { cr: 12, art: 0, up: 0 } },
  { tag: "states", player: { cr: 6, art: 1, up: 0 }, opp: { cr: 6, art: 0, up: 0 }, states: true },
];

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

// Tudo o que o probe julga, numa ida so ao browser. Retangulos visuais = bbox
// projetado da `.card-art` (o que o olho ve); larguras de layout = offsetWidth.
const MEASURE = () => {
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height };
  };
  const board = document.querySelector(".game-board");
  const br = board.getBoundingClientRect();
  const content = document.querySelector(".board-content");
  const cr = content.getBoundingClientRect();
  const role = (iid) => (iid ?? "").split("-")[0];
  const piecesOf = (side) =>
    [...document.querySelectorAll(`.battle-zone--${side} .board-piece`)].map((piece) => {
      const tile = piece.querySelector(".card-tile");
      const art = tile.querySelector(".card-art") ?? tile;
      const a = rect(art);
      const cx = a.l + a.w / 2;
      const hit = document.elementFromPoint(cx, a.t + a.h / 2);
      const cs = getComputedStyle(piece);
      const ts = rect(tile);
      // A exausta gira 12° na arte: o topo no centro fica ~w/2·sin12° abaixo do bbox.
      const dip = piece.classList.contains("board-piece--resting") ? a.w * 0.11 : 0;
      const below = document.elementFromPoint(cx, a.t + 6 + dip);
      return {
        iid: tile.dataset.iid ?? "",
        role: role(tile.dataset.iid),
        art: a,
        layoutW: tile.offsetWidth,
        hitOk: hit?.closest?.(".card-tile") === tile,
        topOk: below?.closest?.(".card-tile") === tile,
        gridRow: cs.gridRowStart,
        gridCol: cs.gridColumnStart,
        marginStart: cs.marginInlineStart,
        inBoard: ts.l >= br.left - 1 && ts.r <= br.right + 1,
      };
    });
  const lane = (side) => {
    const el = document.querySelector(`.battle-zone--${side} .board-lane`);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      display: cs.display,
      rows: cs.gridTemplateRows,
      cols: cs.gridTemplateColumns,
      height: el.offsetHeight,
    };
  };
  const hand = [...document.querySelectorAll(".hand-track > .card-tile--hand")].map((el) => {
    const r = el.getBoundingClientRect();
    const vis = Math.max(0, Math.min(r.bottom, br.bottom) - Math.max(r.top, br.top));
    return { top: r.top, bottom: r.bottom, frac: vis / r.height };
  });
  const children = [...content.children].filter((el) => getComputedStyle(el).display !== "none");
  const sum = children.reduce((acc, el) => acc + el.offsetHeight, 0);
  const planeCs = getComputedStyle(document.querySelector(".table-plane"));
  return {
    docScroll: document.scrollingElement.scrollHeight,
    innerHeight: window.innerHeight,
    boardBottom: br.bottom,
    boardCenter: (br.left + br.right) / 2,
    rowsSum: sum,
    contentH: content.clientHeight,
    stage: board.classList.contains("game-board--stage"),
    plane: { display: planeCs.display, rows: planeCs.gridTemplateRows },
    player: piecesOf("player"),
    opp: piecesOf("opponent"),
    lanes: { player: lane("player"), opp: lane("opponent") },
    hand,
    contentTop: cr.top,
  };
};

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const r1 = (n) => Math.round(n * 10) / 10;
const px = (s) => (s ?? "").split(" ").map(parseFloat).filter((n) => !Number.isNaN(n));

const server = startServer();
let browser;
try {
  await server.ready();
  browser = await launch();
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, reducedMotion: "reduce" });
    await context.addInitScript(SEED);
    const page = await context.newPage();
    const tag = `${vp.w}x${vp.h}`;
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.evaluate(SEED);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".home-screen", { timeout: 30000 });

    for (const spec of SEEDS) {
      await page.evaluate(FIXTURE(spec));
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector(".home-screen", { timeout: 30000 });
      await page.locator(".resume-bar").first().click();
      await page.waitForSelector(".game-screen", { timeout: 20000 });
      if (BREAK) await page.addStyleTag({ content: ".game-board--3d .board-lane { display: flex !important; }" });
      await page.waitForTimeout(600);
      const m = await page.evaluate(MEASURE);
      const t = `${tag} ${spec.tag}`;
      const all = [...m.player, ...m.opp];
      if (SHOOT) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: join(SHOTS, `arena-${tag}-${spec.tag}.png`) });
      }

      // ---- H3D-14: mesa no palco ----
      if (spec.tag === "base6") {
        check(`${t} H3D-14: board no palco (game-board--stage)`, m.stage);
        check(`${t} H3D-14: plano em grid de 3 linhas`, m.plane.display === "grid" && px(m.plane.rows).length === 3, JSON.stringify(m.plane));
        check(`${t} H3D-14: documento sem scroll`, m.docScroll <= m.innerHeight + 1, `scrollHeight ${m.docScroll} / viewport ${m.innerHeight}`);
        check(`${t} H3D-14: linhas <= altura do palco`, m.rowsSum <= m.contentH + 1, `soma ${m.rowsSum} / palco ${m.contentH}`);
        const worst = m.hand.length ? Math.min(...m.hand.map((c) => c.frac)) : 0;
        check(`${t} H3D-14: mao com >= 70% visivel por carta (pontas incluidas)`, m.hand.length > 0 && worst >= 0.7, `${m.hand.length} cartas, pior ${r1(worst * 100)}%`);
        // Carta em foco: a selecionada sobe e aparece inteira.
        const first = page.locator(".hand-track > .card-tile--hand").last();
        await first.click();
        await page.waitForTimeout(300);
        const focused = await page.evaluate(() => {
          const el = document.querySelector(".hand-track > .card-tile--hand.is-selected");
          const board = document.querySelector(".game-board").getBoundingClientRect();
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, board: board.bottom };
        });
        check(`${t} H3D-14: carta selecionada 100% visivel`, Boolean(focused) && focused.bottom <= focused.board + 1 && focused.top >= 0, JSON.stringify(focused));
        if (vp.w >= 1041 && vp.h >= 668) {
          const w = m.player[0]?.layoutW ?? 0;
          check(`${t} H3D-14: criatura do jogador >= 84px de layout`, w >= 84, `${w}px`);
        }
        const p = m.player.filter((c) => c.role === "cr");
        if (vp.w >= 1041) {
          const overlapping = p.slice(1).filter((c) => parseFloat(c.marginStart) < -0.5);
          check(`${t} H3D-14: 6 criaturas por lado sem sobreposicao`, overlapping.length === 0, `margens ${p.slice(1).map((c) => c.marginStart).join(",")}`);
        }
        const ratio = avg(m.opp.map((c) => c.art.w)) / avg(m.player.map((c) => c.art.w));
        check(`${t} H3D-14/15: escala visual oponente/jogador 0,74-0,80`, ratio >= 0.74 && ratio <= 0.8, `razao ${r1(ratio * 100) / 100}`);
        const row3 = px(m.lanes.player?.rows);
        check(`${t} H3D-15: sem artefato a linha 3 mede 0px`, row3.length === 3 && Math.abs(row3[2]) <= 1, `rows=${m.lanes.player?.rows}`);
        const cols = px(m.lanes.player?.cols);
        check(`${t} H3D-15: 6 colunas na fileira das criaturas`, cols.length === 6, `cols=${m.lanes.player?.cols}`);
      }

      // ---- H3D-14: nenhuma carta sob HUD; hit-test do centro ----
      const hitMiss = all.filter((c) => !c.hitOk);
      check(`${t} hit-test: centro visual acerta a propria peca (${all.length})`, hitMiss.length === 0 && all.length > 0, hitMiss.length ? hitMiss.slice(0, 3).map((c) => c.iid).join(",") : "");
      if (vp.w >= 701 && spec.tag !== "c12") {
        const under = all.filter((c) => !c.topOk);
        check(`${t} H3D-14: 6px abaixo do topo visual ainda e a propria carta (nenhuma sob HUD)`, under.length === 0, under.slice(0, 3).map((c) => c.iid).join(","));
      }
      if (spec.tag === "c12" && vp.w >= 701) {
        const out = all.filter((c) => !c.inBoard);
        check(`${t} 12 criaturas dentro do board`, out.length === 0, `${out.length} fora`);
      }

      // ---- H3D-15: fileiras ----
      if (spec.tag === "arts" && vp.w >= 701) {
        const crP = m.player.filter((c) => c.role === "cr");
        const crO = m.opp.filter((c) => c.role === "cr");
        const artP = m.player.filter((c) => c.role === "art");
        const artO = m.opp.filter((c) => c.role === "art");
        check(`${t} H3D-15: 2 artefatos por lado`, artP.length === 2 && artO.length === 2, `${artP.length}/${artO.length}`);
        const baseP = Math.max(...crP.map((c) => c.art.b));
        const topO = Math.min(...crO.map((c) => c.art.t));
        const baseOpp = Math.max(...crO.map((c) => c.art.b));
        check(`${t} H3D-15: artefato do jogador abaixo da base das criaturas`, artP.every((c) => c.art.t >= baseP - 1), `topo art ${r1(Math.min(...artP.map((c) => c.art.t)))} / base cri ${r1(baseP)}`);
        check(`${t} H3D-15: artefato do oponente acima do topo das criaturas`, artO.every((c) => c.art.b <= topO + 1), `base art ${r1(Math.max(...artO.map((c) => c.art.b)))} / topo cri ${r1(topO)} (base cri ${r1(baseOpp)})`);
        const notch = [...artP, ...artO].filter((c) => c.art.r > m.boardCenter - 100 && c.art.l < m.boardCenter + 100);
        check(`${t} H3D-15: nenhum artefato no notch central de 200px`, notch.length === 0, notch.map((c) => `${c.iid}:${r1(c.art.l)}..${r1(c.art.r)}`).join(" "));
        const kP = avg(artP.map((c) => c.art.w)) / avg(crP.map((c) => c.art.w));
        const kO = avg(artO.map((c) => c.art.w)) / avg(crO.map((c) => c.art.w));
        check(`${t} H3D-15: artefato visual 0,55-0,65x da criatura`, kP >= 0.55 && kP <= 0.65 && kO >= 0.55 && kO <= 0.65, `jogador ${r1(kP * 100) / 100} oponente ${r1(kO * 100) / 100}`);
        check(`${t} H3D-15: fileira do artefato (jogador = 3, oponente = 1)`, artP.every((c) => c.gridRow === "3") && artO.every((c) => c.gridRow === "1"), `${artP.map((c) => c.gridRow)} / ${artO.map((c) => c.gridRow)}`);
        const up = m.player.find((c) => c.role === "up");
        check(`${t} H3D-15: upgrade na mesma coluna do hospedeiro`, Boolean(up) && up.gridCol === crP[0].gridCol, `${up?.gridCol} / ${crP[0].gridCol}`);
        const list = await page.getByRole("list", { name: /artifacts and upgrades/i }).count();
        check(`${t} H3D-15: lista "anexos" na arvore de acessibilidade`, list >= 2, `${list} listas`);
      }
      if (spec.tag === "arts" && vp.w >= 701 && vp.w === 1296) {
        // Clique REAL no centro de cada artefato e do upgrade: a peca certa responde.
        const targets = [...m.player, ...m.opp].filter((c) => c.role !== "cr");
        const wrong = [];
        for (const c of targets) {
          await page.mouse.click(c.art.l + c.art.w / 2, c.art.t + c.art.h / 2);
          await page.waitForTimeout(80);
          const sel = await page.evaluate(() => document.querySelector(".card-tile.is-selected")?.dataset.iid ?? null);
          if (sel !== c.iid) wrong.push(`${c.iid}->${sel}`);
        }
        check(`${t} H3D-15: clique nos artefatos/upgrade seleciona a propria (${targets.length})`, wrong.length === 0, wrong.join(" "));
      }
    }
    await context.close();
  }
  await browser.close();
} finally {
  server.stop();
}

if (BREAK) {
  // O teste do teste: com a lane em flex o probe precisa acusar.
  console.log(PROBLEMS.length ? `\n--break: ${PROBLEMS.length} violacoes detectadas (o probe enxerga a regressao)` : "\n--break: NADA detectado — o probe e cego");
  process.exit(PROBLEMS.length ? 0 : 1);
}
console.log(PROBLEMS.length ? `\nARENA FAIL - ${PROBLEMS.length} violacao(oes): ${[...new Set(PROBLEMS.map((p) => p.replace(/^\d+x\d+ \w+ /, "")))].join("; ")}` : "\nARENA OK");
process.exit(PROBLEMS.length ? 1 : 0);
