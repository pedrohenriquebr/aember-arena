// Probe de interacao na mesa 3D (H3D-07, VIEW3D_PLAN §2.7/§4). Clica NO CENTRO
// VISUAL de cada carta e confere que quem respondeu e a carta certa, com 1, 6 e
// 12 criaturas por lado, a 360 (2.5D), 768, 1280 e 1440.
//
//   node e2e/probes/_3d-hit.mjs [--viewports=360,768,1280,1440] [--browsers=chromium,firefox,webkit]
//
// O board vem de um SAVE FIXO (o proprio motor constroi: createMatch com seed
// fixa + criaturas clonadas na mao), salvo em localStorage e retomado pela UI —
// o clique atravessa React, engine e a selecao de verdade, nao um clone de DOM.
//
// Navegadores: chromium (Edge/Chrome do sistema) sempre; firefox/webkit tentam
// o binario do playwright-core se existir e, sem ele, sao PULADOS (nao falham) —
// o Safari iOS real e verificacao manual, como o plano preve.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5217;
const SHOTS = join(ROOT, "e2e", "clips", "frames");
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const VIEWPORTS = arg("--viewports", "360,768,1280,1440").split(",").map(Number).filter(Boolean)
  .map((w) => ({ w, h: w >= 1200 ? 800 : w >= 700 ? 1024 : 800 }));
const BROWSERS = arg("--browsers", "chromium,firefox,webkit").split(",").map((b) => b.trim()).filter(Boolean);

const SEED = (animations = false) => `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: ${animations},
    hoverZoom: false, hints: false, language: "en", tableView: "3d", opponentMode: "mirror", gameMode: "solo", aiSpeed: "fast",
  }));
  localStorage.setItem("aember-arena-language", "en");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
})()`;

// Board fixo com n criaturas por lado, todas prontas e da casa ativa do
// jogador: os cliques, a selecao e a luta sao legais no motor.
const FIXTURE = (n, att = false) => `(async () => {
  const game = await import("/src/lib/game.ts");
  const demo = await import("/src/lib/demoDeck.ts");
  const deck = demo.DEMO_DECK;
  let state = game.createMatch(deck, deck, { seed: 424242 });
  state = game.keepHand(state, 0);
  state = game.keepHand(state, 1);
  const house = state.players[0].houses[0];
  const creatures = deck.cards.filter((c) => c.type === "Creature" && c.house === house);
  const extras = deck.cards.filter((c) => c.type === "Creature" && c.house !== house);
  const pool = creatures.length >= 3 ? creatures : creatures.concat(extras);
  const mk = (i) => {
    const face = pool[i % pool.length];
    return { instanceId: "hit-" + i + "-" + face.id, face, damage: 0, ready: true, stunned: false };
  };
  // H3D-15: com ${att} cada lado ganha 2 artefatos (iid hit-art-*) e o jogador 1 upgrade
  // preso a criatura 0 (hit-up-*): os cliques na fileira externa entram no probe.
  const artifacts = deck.cards.filter((c) => c.type === "Artifact");
  const upgrade = deck.cards.find((c) => c.type === "Upgrade");
  const extra = (base, host) => ${att} ? [
    ...[0, 1].map((i) => ({ instanceId: "hit-art-" + (base + i) + "-" + artifacts[i].id, face: artifacts[i], damage: 0, ready: true, stunned: false })),
    ...(host ? [{ instanceId: "hit-up-" + base + "-" + upgrade.id, face: upgrade, damage: 0, ready: true, stunned: false, attachedTo: host }] : []),
  ] : [];
  const mine = Array.from({ length: ${n} }, (_, i) => mk(i));
  state.players[0].board = [...mine, ...extra(0, mine[0].instanceId)];
  state.players[1].board = [...Array.from({ length: ${n} }, (_, i) => mk(100 + i)), ...extra(100, null)];
  state.activePlayer = 0;
  state.activeHouse = house;
  localStorage.setItem("aember-arena-match", JSON.stringify({ game: state, deckId: demo.DEMO_DECK_ID, savedAt: 1 }));
  return { house, n: ${n}, hand: state.players[0].hand.length };
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

async function launchBrowser(name) {
  const pw = await import("playwright-core");
  if (name === "chromium") {
    for (const opts of [{ channel: "msedge" }, { channel: "chrome" }, ...CANDIDATES.filter(existsSync).map((executablePath) => ({ executablePath }))]) {
      try {
        return await pw.chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"], ...opts });
      } catch { /* proximo */ }
    }
    return null;
  }
  try {
    // Sem channel: usa o binario que o playwright-core tiver instalado; sem ele
    // o launch falha e o navegador e PULADO (o probe nao mente sobre cobertura).
    return await pw[name].launch({ headless: true });
  } catch {
    return null;
  }
}

const PROBLEMS = [];
const SKIPPED = [];
const check = (label, ok, detail) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) PROBLEMS.push(label);
};

// Mede tudo o que o probe julga numa ida so ao browser: caixa visual das cartas,
// hit-test do centro de cada uma, alvos dos controles e o estado da pose 3D.
const MEASURE = () => {
  const describe = (el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")}`;
  const laneBox = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  };
  const lanes = {
    opponent: laneBox(document.querySelector(".battle-zone--opponent .board-lane")),
    player: laneBox(document.querySelector(".battle-zone--player .board-lane")),
  };
  const pieces = [...document.querySelectorAll(".table-plane .board-piece")];
  const cards = pieces.map((piece) => {
    const tile = piece.querySelector(".card-tile");
    const r = tile.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const lane = piece.closest(".battle-zone--opponent") ? "opponent" : "player";
    const box = lanes[lane];
    // No 2.5D a lane rola: a carta fora do scrollport nao e alcancavel por um
    // dedo (o usuario rola antes) — o alvo medido e o que esta visivel.
    const visible = Boolean(box) && cx >= box.left && cx <= box.right;
    const hit = visible ? document.elementFromPoint(cx, cy) : null;
    const hitTile = hit?.closest?.(".card-tile") ?? null;
    return {
      iid: tile.dataset.iid ?? null,
      lane,
      visible,
      hitOk: !visible || hitTile === tile,
      hitWhat: hit ? describe(hit) : "fora do scrollport",
      w: Math.round(r.width),
      h: Math.round(r.height),
      x: Math.round(r.left),
      y: Math.round(r.top),
      cx: Math.round(cx),
      cy: Math.round(cy),
      disabled: tile.disabled === true,
      dimmed: tile.classList.contains("is-dimmed"),
    };
  });
  const control = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  };
  const piece = document.querySelector(".table-plane .board-piece");
  const lane = document.querySelector(".board-lane");
  return {
    cards,
    visible: cards.filter((card) => card.visible).length,
    controls: {
      house: control(".house-choice"),
      endTurn: control(".end-turn-button"),
      toggle: control(".view-toggle"),
    },
    pose: piece ? { rotate: getComputedStyle(piece).rotate, translate: getComputedStyle(piece).translate } : null,
    laneOverflow: lane ? getComputedStyle(lane).overflowX : null,
    headings: [...document.querySelectorAll(".zone-heading")].map((el) => {
      const r = el.getBoundingClientRect();
      return { text: el.textContent.trim().slice(0, 40), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom), clipped: r.left < -1 || r.right > window.innerWidth + 1 };
    }),
    zoneClearance: [...document.querySelectorAll(".battle-zone")].map((zone) => {
      const heading = zone.querySelector(".zone-heading");
      const cards = [...zone.querySelectorAll(".board-piece .card-tile")];
      if (!heading || !cards.length) return null;
      const hb = heading.getBoundingClientRect();
      const top = Math.min(...cards.map((card) => card.getBoundingClientRect().top));
      return { zone: zone.className.split(" ").pop(), gap: Math.round(top - hb.bottom) };
    }).filter(Boolean),
    selected: document.querySelector(".card-tile.is-selected")?.dataset.iid ?? null,
    inspectorActions: document.querySelectorAll(".inspector-actions button").length,
    inspectorHint: Boolean(document.querySelector(".inspector-hint")),
    fightInstruction: Boolean(document.querySelector(".fight-instruction")),
  };
};

const server = startServer();
let chromiumBrowser = null;
try {
  await server.ready();
  for (const browserName of BROWSERS) {
    const browser = await launchBrowser(browserName);
    if (!browser) {
      SKIPPED.push(browserName);
      console.log(`SKIP ${browserName}: binario do playwright-core nao instalado (sistema: chromium/Edge sempre ha; Safari iOS e manual)`);
      continue;
    }
    if (browserName === "chromium") chromiumBrowser = browser;
    try {
      for (const vp of VIEWPORTS) {
        const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, reducedMotion: "reduce" });
        await context.addInitScript(SEED());
        const page = await context.newPage();
        const tag = `${browserName}/${vp.w}x${vp.h}`;
        await page.goto(server.url, { waitUntil: "domcontentloaded" });
        await page.evaluate(SEED());
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector(".home-screen", { timeout: 30000 });

        for (const [n, att] of [[1, false], [6, false], [12, false], [6, true]]) {
          const fixture = await page.evaluate(FIXTURE(n, att));
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.waitForSelector(".home-screen", { timeout: 30000 });
          await page.locator(".resume-bar").first().click();
          await page.waitForSelector(".game-screen", { timeout: 20000 });
          await page.waitForTimeout(700);

          const measure = await page.evaluate(MEASURE);
          const minW = vp.w >= 701 ? 56 : 44;
          const minH = vp.w >= 701 ? 78 : 44;
          // A fileira externa (artefatos/upgrade, 0,6x) fica fora do piso de 56x78 do
          // board (excecao documentada do plano Arena §3.2); o alvo de toque e >= 44.
          const small = measure.cards.filter((card) => !/^hit-(art|up)-/.test(card.iid ?? "") && (card.w < minW || card.h < minH));
          check(`${tag} n=${n}${att ? "+anexos" : ""}: ${measure.cards.length} cartas na mesa (ao menos ${Math.min(n, 12) * 2})`, measure.cards.length >= n * 2, `cartas=${measure.cards.length}`);
          check(`${tag} n=${n}${att ? "+anexos" : ""}: caixa visual >= ${minW}x${minH}`, small.length === 0, small.length ? JSON.stringify(small.slice(0, 3)) : `menor=${Math.min(...measure.cards.map((c) => c.w))}x${Math.min(...measure.cards.map((c) => c.h))}`);
          const misses = measure.cards.filter((card) => !card.hitOk);
          check(
            `${tag} n=${n}${att ? "+anexos" : ""}: centro visual acerta a propria carta (${measure.visible}/${measure.cards.length} no scrollport)`,
            misses.length === 0 && measure.visible > 0,
            misses.length ? JSON.stringify(misses.slice(0, 4)) : "elementFromPoint = mesmo data-iid",
          );

          // Clique REAL em cada carta: quem responde e o React do tile certo.
          const clicks = await page.evaluate(async () => {
            const tiles = [...document.querySelectorAll(".table-plane .board-piece .card-tile")];
            const out = [];
            for (const tile of tiles) {
              tile.click();
              await new Promise((r) => setTimeout(r, 60));
              const selected = document.querySelector(".card-tile.is-selected");
              const mine = Boolean(tile.closest(".battle-zone--player"));
              out.push({
                iid: tile.dataset.iid,
                selected: selected?.dataset.iid ?? null,
                mine,
                inspected: (() => {
                  const title = (tile.getAttribute("aria-label") ?? "").split(",")[0];
                  return title !== "" && (document.querySelector(".inspector-section")?.textContent ?? "").includes(title);
                })(),
                actions: document.querySelectorAll(".inspector-actions button").length,
                hint: Boolean(document.querySelector(".inspector-hint")),
              });
            }
            return out;
          });
          // Anexos nao levam `is-selected`: o inspetor aberto com o titulo e a resposta.
          const wrong = clicks.filter((click) => (/^hit-(art|up)-/.test(click.iid) ? !click.inspected : click.iid !== click.selected));
          check(`${tag} n=${n}${att ? "+anexos" : ""}: clique em cada carta seleciona a propria (${clicks.length} cliques)`, wrong.length === 0, wrong.length ? JSON.stringify(wrong.slice(0, 4)) : "todas certas");
          // A barra de acoes do inspetor: criatura propria mostra Reap/Fight;
          // carta do oponente mostra a dica (nao ha acao a oferecer).
          const mineOk = clicks.filter((click) => click.mine && !/^hit-(art|up)-/.test(click.iid)).every((click) => click.actions >= 2);
          const theirsOk = clicks.filter((click) => !click.mine && !/^hit-(art|up)-/.test(click.iid)).every((click) => click.hint);
          check(
            `${tag} n=${n}: inspetor acessivel (acoes na propria, dica no oponente)`,
            mineOk && theirsOk,
            JSON.stringify({ proprias: clicks.filter((c) => c.mine).length, acoes: clicks.find((c) => c.mine)?.actions, dicas: clicks.filter((c) => !c.mine && c.hint).length }),
          );

          if (n === 12 && !att) {
            const controls = measure.controls;
            const bad = Object.entries(controls).filter(([, box]) => box && (box.w < 44 || box.h < 44));
            check(`${tag}: controles >= 44x44 visuais`, bad.length === 0, JSON.stringify(controls));
            // H3D-12: a carta de pe avanca acima da caixa de layout e o topo passa
            // por cima do heading da zona (limite conhecido, ver o CSS): o probe
            // guarda SO o limite — um recuo maior que 40px no desktop acusa.
            const tight = measure.zoneClearance.filter((entry) => entry.gap < (vp.w >= 701 ? -40 : 4));
            check(`${tag}: heading da zona atrás das cartas em pé dentro do limite`, tight.length === 0, JSON.stringify(measure.zoneClearance));
            if (vp.w >= 701) {
              check(`${tag}: peca em pe (pose 3D viva)`, Boolean(measure.pose) && measure.pose.rotate !== "none" && measure.pose.translate !== "none", JSON.stringify(measure.pose));
              check(`${tag}: lane sem scroll (overflow visible)`, measure.laneOverflow === "visible", String(measure.laneOverflow));
            } else {
              check(`${tag}: 2.5D sem pose 3D na peca`, Boolean(measure.pose) && measure.pose.rotate === "none" && measure.pose.translate === "none", JSON.stringify(measure.pose));
              check(`${tag}: lane rola como no 2D`, measure.laneOverflow === "auto", String(measure.laneOverflow));
            }
            const clipped = measure.headings.filter((h) => h.clipped);
            check(`${tag}: headings das zonas sem corte`, clipped.length === 0, JSON.stringify(measure.headings));
          }
        }

        // H3D-12: a camera no extremo do parallax nao pode custar precisao.
        if (vp.w >= 701) {
          // H3D-14: a folha do inspetor (< 1041px) cobre a fileira do fundo no palco; o
          // que se mede aqui e a camera, entao ela e fechada antes.
          await page.keyboard.press("Escape");
          await page.waitForTimeout(250);
          const extreme = await page.evaluate(async () => {
            const plane = document.querySelector(".table-plane");
            plane.style.setProperty("--cam-x", "1");
            plane.style.setProperty("--cam-y", "1");
            await new Promise((r) => setTimeout(r, 150));
            const cards = [...document.querySelectorAll(".table-plane .board-piece .card-tile")].map((tile) => {
              const r = tile.getBoundingClientRect();
              const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return hit?.closest?.(".card-tile") === tile;
            });
            const transform = getComputedStyle(plane).transform;
            plane.style.removeProperty("--cam-x");
            plane.style.removeProperty("--cam-y");
            await new Promise((r) => setTimeout(r, 100));
            return { ok: cards.filter(Boolean).length, total: cards.length, transform };
          });
          check(`${tag}: hit-test 100% com a camera no extremo`, extreme.ok === extreme.total && extreme.total > 0, JSON.stringify(extreme));
        }

        // Fluxo real de luta: seleciona um atacante pronto da casa ativa, clica
        // Fight, confere a instrucao e clica o alvo aceso — o pick resolve.
        const startFight = () => page.evaluate(async () => {
          const attacker = document.querySelector(".battle-zone--player .board-piece .card-tile:not(:disabled)");
          if (!attacker) return { error: "sem atacante" };
          attacker.click();
          await new Promise((r) => setTimeout(r, 200));
          const buttons = [...document.querySelectorAll(".inspector-actions button")];
          const fightBtn = buttons.find((btn) => /fight/i.test(btn.textContent ?? ""));
          if (!fightBtn) return { error: "sem botao de luta", buttons: buttons.map((b) => b.textContent) };
          if (fightBtn.disabled) return { error: "luta desabilitada", buttons: buttons.map((b) => b.textContent) };
          fightBtn.click();
          await new Promise((r) => setTimeout(r, 350));
          const instruction = Boolean(document.querySelector(".fight-instruction"));
          const dimmed = document.querySelectorAll(".board-piece .card-tile.is-dimmed").length;
          const liftedPiece = document.querySelector(".board-piece:has(> .card-tile:not(.is-dimmed))");
          return {
            instruction,
            dimmed,
            lifted: liftedPiece ? getComputedStyle(liftedPiece).getPropertyValue("--lift").trim() : null,
            damageBefore: document.querySelectorAll(".table-plane .board-piece .damage-label").length,
          };
        });
        const finishFight = () => page.evaluate(async () => {
          const target = document.querySelector(".board-piece .card-tile:not(.is-dimmed):not(:disabled)") ?? document.querySelector(".board-piece .card-tile:not(.is-dimmed)");
          if (!target) return { error: "sem alvo aceso" };
          const iid = target.dataset.iid;
          target.click();
          await new Promise((r) => setTimeout(r, 400));
          return {
            resolved: !document.querySelector(".fight-instruction"),
            // Dano real: o badge aparece, ou o alvo morreu e saiu do board.
            damaged: Boolean(document.querySelector(`[data-iid="${iid}"] .damage-label`)),
            gone: !document.querySelector(`[data-iid="${iid}"]`),
          };
        });
        const fight = await startFight();
        if (fight.error) check(`${tag}: fluxo de luta`, false, JSON.stringify(fight));
        else {
          check(`${tag}: alvo de luta destaca (instrucao + esmaecidos)`, fight.instruction && fight.dimmed > 0, JSON.stringify({ instruction: fight.instruction, dimmed: fight.dimmed }));
          check(`${tag}: alvos do pick sobem no 3D (--lift maior)`, vp.w < 701 || parseFloat(fight.lifted) > 16, `lift=${fight.lifted}`);
          if (browserName === "chromium") {
            mkdirSync(SHOTS, { recursive: true });
            await page.screenshot({ path: join(SHOTS, `probe-3d-hit-targeting-${vp.w}.png`) });
          }
          const done = await finishFight();
          check(`${tag}: luta resolve com o clique no alvo`, !done.error && done.resolved && (done.damaged || done.gone), JSON.stringify(done));
        }

        if (browserName === "chromium") {
          mkdirSync(SHOTS, { recursive: true });
          await page.screenshot({ path: join(SHOTS, `probe-3d-hit-${vp.w}.png`) });
        }
        await context.close();
      }

      // H3D-12: os portoes do parallax. Animações desligadas (settings) e
      // prefers-reduced-motion são estados de SESSÃO — cada um num contexto
      // próprio, com a MESMA caminhada, e o ponteiro varre o board.
      if (browserName === "chromium") {
        for (const gate of [
          { name: "animações off", animations: false, reduced: "no-preference" },
          { name: "prefers-reduced-motion", animations: true, reduced: "reduce" },
        ]) {
          const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: gate.reduced });
          const gateSeed = SEED(gate.animations);
          await context.addInitScript(gateSeed);
          const page = await context.newPage();
          await page.goto(server.url, { waitUntil: "domcontentloaded" });
          await page.evaluate(gateSeed);
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.waitForSelector(".home-screen", { timeout: 30000 });
          await page.evaluate(FIXTURE(2));
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.waitForSelector(".home-screen", { timeout: 30000 });
          await page.locator(".resume-bar").first().click();
          await page.waitForSelector(".game-screen", { timeout: 20000 });
          await page.waitForTimeout(500);
          const box = await page.locator(".game-board").boundingBox();
          await page.mouse.move(box.x + box.width * 0.2, box.y + Math.min(box.height * 0.5, 700));
          await page.waitForTimeout(200);
          await page.mouse.move(box.x + box.width * 0.8, box.y + Math.min(box.height * 0.5, 700));
          await page.waitForTimeout(300);
          const state = await page.evaluate(() => document.querySelector(".table-plane")?.getAttribute("style") ?? "");
          check(`H3D-12: parallax desligado com ${gate.name}`, !/--cam-/.test(state), `style="${state}"`);
          await context.close();
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }
  }
  console.log(SKIPPED.length ? `\nPULADOS: ${SKIPPED.join(", ")} (sem binario; cobertura real: chromium + Safari iOS manual)` : "");
  console.log(PROBLEMS.length ? `\nFALHAS: ${PROBLEMS.join("; ")}` : "\nOK: hit-test 3D confere (centro visual, clique, alvo de luta e alvos de toque)");
} finally {
  if (chromiumBrowser) await chromiumBrowser.close().catch(() => {});
  server.stop();
}
process.exit(PROBLEMS.length ? 1 : 0);