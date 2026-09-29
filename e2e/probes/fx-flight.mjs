// Probe de comportamento do voo da onda 1 (ANIM §2): num browser real, congela a
// linha do tempo das animações do ghost e mede a coreografia em pontos exatos —
// nascença na mão (zoom 1x), apresentação no centro (zoom ~1,6x), destino
// escondido durante o voo e tile em `landed` sem replay de entrada.
// Uso: node e2e/probes/_fx-flight.mjs   (derruba o dev server ao sair)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5205;
const SEED = `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false,
    animations: true, hoverZoom: false, language: "en",
  }));
  localStorage.setItem("aember-arena-language", "en");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
})()`;

function startServer() {
  // --host 127.0.0.1: o default "localhost" do vite pode bindar so IPv6 (::1).
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

// Congela as duas animações do ghost e lê a geometria num instante exato.
const AT = (args) => {
  const [name, time] = args;
  const ghost = document.querySelector(".fx-ghost");
  if (!ghost) return { error: "sem ghost" };
  for (const anim of ghost.getAnimations()) {
    anim.pause();
    if (anim.animationName === name) anim.currentTime = time;
  }
  const box = ghost.getBoundingClientRect();
  const dest = document.querySelector("[data-fx=landing]");
  const destArt = dest?.querySelector(".card-art") ?? dest;
  const slot = destArt ? destArt.getBoundingClientRect() : null;
  return {
    name,
    time,
    cx: Math.round(box.left + box.width / 2),
    cls: ghost.className,
    pieces: document.querySelectorAll(".board-piece").length,
    cy: Math.round(box.top + box.height / 2),
    w: Math.round(box.width),
    opacity: Number(getComputedStyle(ghost).opacity),
    destVisibility: dest ? getComputedStyle(dest).visibility : null,
    destAnims: dest ? dest.getAnimations().length : null,
    slot: slot && { cx: Math.round(slot.left + slot.width / 2), cy: Math.round(slot.top + slot.height / 2), w: Math.round(slot.width) },
    vw: innerWidth,
    vh: innerHeight,
  };
};

const PROBLEMS = [];
const check = (label, ok, detail) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) PROBLEMS.push(label);
};

const server = startServer();
try {
  await server.ready();
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
  await context.addInitScript(SEED);
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
  await page.locator(".house-picker .house-choice:not([disabled])").first().click();
  await page.waitForTimeout(400);

  // Primeira criatura jogável da mão (o destino do voo é o slot no board); se
  // só houver Ação jogável, o probe cai no caminho do dissolve.
  const tiles = page.locator(".hand-track .card-tile");
  const pb = page.locator(".inspector-actions button.primary-action").first();
  // O clique do Play não pode rolar a página: scroll durante o voo cancela (plano §2.7).
  await pb.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(250);
  let picked = -1;
  let fallback = -1;
  for (let i = 0; i < (await tiles.count()); i += 1) {
    const label = (await tiles.nth(i).getAttribute("aria-label")) ?? "";
    await tiles.nth(i).click();
    await page.waitForTimeout(200);
    if (!(await pb.isEnabled().catch(() => false))) continue;
    if (/Creature/.test(label)) { picked = i; break; }
    if (fallback < 0) fallback = i;
  }
  if (picked < 0) picked = fallback;
  if (picked < 0) throw new Error("nenhuma carta jogavel na mao");
  // A origem é a carta REALMENTE selecionada (o click pode rolar o hand-track).
  const sel = await page.evaluate(() => {
    const tile = document.querySelector(".card-tile.is-selected");
    const art = tile?.querySelector(".card-art")?.getBoundingClientRect();
    return { label: tile?.getAttribute("aria-label") ?? "", box: art && { x: art.x, y: art.y, width: art.width, height: art.height } };
  });
  const isCreature = /Creature/.test(sel.label);
  const handBox = sel.box;
  const idsBefore = await page.evaluate(() => [...document.querySelectorAll(".board-piece [data-iid]")].map((el) => el.getAttribute("data-iid")));
  const handCards = await tiles.count();
  // Click direto no DOM: o click do Playwright espera actionability e o voo
  // (670ms) pode terminar antes da amostra.
  const domClick = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
  // Observa o portal antes do play: prova se o ghost chegou a existir.
  await page.evaluate(() => {
    window.__fxLog = [];
    const layer = document.querySelector(".fx-layer");
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) if (n.classList?.contains("fx-ghost")) window.__fxLog.push(["add", Math.round(performance.now())]);
        for (const n of r.removedNodes) if (n.classList?.contains("fx-ghost")) window.__fxLog.push(["remove", Math.round(performance.now())]);
      }
    }).observe(layer, { childList: true });
  });
  await pb.click(); // click real: espera actionability (o voo é congelado depois)
  // "Play:" com escolha de alvo abre o pick em vez de aplicar (App: targetChoices).
  for (let i = 0; i < 3 && (await page.locator(".fight-instruction").count()); i += 1) {
    await page.evaluate(() => document.querySelector(".board-piece .card-tile:not(.is-dimmed)")?.click());
    await page.waitForTimeout(300);
  }
  await page.waitForSelector(".fx-layer .fx-ghost", { timeout: 2000 }).catch(() => {});
  console.log("DEBUG fxLog:", JSON.stringify(await page.evaluate(() => window.__fxLog)));
  console.log("DEBUG carta:", await tiles.nth(picked).getAttribute("aria-label").catch(()=>null));
  console.log("DEBUG estado pos-play:", JSON.stringify(await page.evaluate(() => ({ fight: document.querySelectorAll(".fight-instruction").length, pieces: document.querySelectorAll(".board-piece").length, hand: document.querySelectorAll(".hand-track .card-tile").length, pickHint: document.querySelector(".fight-instruction")?.textContent ?? null, logs: [...document.querySelectorAll(".log-entry p")].slice(0,3).map((p) => p.textContent) }))));
  check("a carta jogada saiu da mao", (await tiles.count()) < handCards);
  check("o ghost existe no portal", (await page.locator(".fx-layer .fx-ghost").count()) === 1);
  if (await page.evaluate(() => !document.querySelector(".fx-layer .fx-ghost"))) throw new Error("sem ghost");

  // Ordem de pintura: com pointer-events ligado no ghost, o hit-test revela quem
  // está por cima no centro da tela (elementFromPoint segue a ordem de pintura).
  const stack = await page.evaluate(() => {
    const ghost = document.querySelector(".fx-ghost");
    const img = ghost.querySelector("img");
    const handImg = document.querySelector(".hand-track .card-art img");
    return {
      ghostImg: img && { complete: img.complete, w: img.naturalWidth, src: img.getAttribute("src")?.slice(-24) },
      handImg: handImg && { complete: handImg.complete, w: handImg.naturalWidth },
      sameSrc: img?.getAttribute("src") === handImg?.getAttribute("src"),
      artBg: getComputedStyle(ghost.querySelector(".card-art")).backgroundImage.slice(0, 60),
    };
  });
  console.log("DEBUG ghost img:", JSON.stringify(stack));
  console.log("\n== COREOGRAFIA (tempos da animacao, geometria congelada) ==");
  await page.evaluate(AT, ["fx-present", 130]);
  await page.screenshot({ path: "e2e/clips/frames/probe-hold.png", clip: { x: 480, y: 176, width: 320, height: 384 } });
  const at0 = await page.evaluate(AT, ["fx-present", 0]);
  const mid = await page.evaluate(AT, ["fx-present", 130]);
  const hold = await page.evaluate(AT, ["fx-present", 260]);
  const slamStart = await page.evaluate(AT, ["fx-slam", 400]);
  const slamEnd = await page.evaluate(AT, ["fx-slam", 670]);
  for (const s of [at0, mid, hold, slamStart, slamEnd]) console.log(JSON.stringify(s));

  const zoom = (s) => s.w / handBox.width;
  check("A: nasce no rect da mao", Math.abs(at0.cx - (handBox.x + handBox.width / 2)) <= 3 && Math.abs(at0.cy - (handBox.y + handBox.height / 2)) <= 3, `ghost ${at0.cx},${at0.cy} vs mao ${Math.round(handBox.x + handBox.width / 2)},${Math.round(handBox.y + handBox.height / 2)}`);
  check("A: nasce no tamanho da mao", Math.abs(zoom(at0) - 1) < 0.03, `zoom ${zoom(at0).toFixed(2)}x`);
  check("B: chegou ao centro da viewport", Math.abs(hold.cx - hold.vw / 2) <= 3 && Math.abs(hold.cy - hold.vh * 0.46) <= 3, `ghost ${hold.cx},${hold.cy} vs centro ${hold.vw / 2},${Math.round(hold.vh * 0.46)}`);
  check("B: zoom ~1,6x da mao", zoom(hold) >= 1.55, `zoom ${zoom(hold).toFixed(2)}x`);
  check("C: parado no hold (fim do present = inicio do slam)", slamStart.cx === hold.cx && slamStart.cy === hold.cy, `${slamStart.cx},${slamStart.cy}`);
  if (isCreature) {
    check("C: destino escondido no voo inteiro", [at0, mid, hold, slamStart].every((s) => s.destVisibility === "hidden" && s.destAnims === 0));
    check("D: assentou no slot exato", Math.abs(slamEnd.cx - slamEnd.slot.cx) <= 3 && Math.abs(slamEnd.cy - slamEnd.slot.cy) <= 4, `ghost ${slamEnd.cx},${slamEnd.cy} vs slot ${slamEnd.slot.cx},${slamEnd.slot.cy}`);
  } else {
    // Ação: não há slot; o ghost dissolve no centro (só alarga e some).
    check("C: Acao sem destino (dissolve, sem marca de landing)", [at0, hold].every((s) => s.destVisibility === null));
    check("D: Acao dissolveu no centro", slamEnd.cx === hold.cx && slamEnd.opacity === 0, `${slamEnd.cx},${slamEnd.opacity}`);
  }
  check("E: ghost invisivel no fim do slam", slamEnd.opacity === 0, `opacity ${slamEnd.opacity}`);

  // Correr a linha do tempo: o reveal termina e o destino aparece.
  await page.evaluate(() => document.querySelector(".fx-layer .fx-ghost")?.getAnimations().forEach((a) => a.play()));
  await page.waitForTimeout(900);
  const end = await page.evaluate((before) => {
    const now = [...document.querySelectorAll(".board-piece [data-iid]")].map((el) => el.getAttribute("data-iid"));
    const added = now.filter((id) => !before.includes(id));
    const tile = added.length ? document.querySelector(`[data-iid="${added[0]}"]`) : null;
    const piece = tile?.closest(".board-piece") ?? null;
    return {
      added: added.length,
      ghosts: document.querySelectorAll(".fx-ghost").length,
      marks: document.querySelectorAll("[data-fx]").length,
      visibility: piece ? getComputedStyle(piece).visibility : null,
      opacity: tile ? getComputedStyle(tile).opacity : null,
      anims: piece ? piece.getAnimations().length + (tile?.getAnimations().length ?? 0) : null,
      slowAnims: piece ? [...piece.getAnimations(), ...(tile?.getAnimations() ?? [])].filter((a) => (a.effect.getComputedTiming().duration ?? 0) > 50).length : null,
      artAnims: tile?.querySelector(".card-art")?.getAnimations().length ?? null,
    };
  }, idsBefore);
  check("E: destino visivel, sem marca presa e sem replay de entrada", end.added === 1 && end.ghosts === 0 && end.marks === 0 && end.visibility === "visible" && end.opacity === "1" && end.anims === 0, JSON.stringify(end));

  // (f) Turno da IA: o ghost nasce no avatar do Warden e assenta no slot.
  await domClick(".end-turn-button");
  let aiGhost = null;
  for (let i = 0; i < 120; i += 1) {
    aiGhost = await page.evaluate(() => {
      const ghost = document.querySelector(".fx-ghost");
      if (!ghost) return null;
      for (const anim of ghost.getAnimations()) {
        anim.pause();
        if (anim.animationName === "fx-present") anim.currentTime = 0;
      }
      const box = ghost.getBoundingClientRect();
      const avatar = document.querySelector('[data-side="1"] .player-avatar')?.getBoundingClientRect();
      return {
        cx: Math.round(box.left + box.width / 2),
        cy: Math.round(box.top + box.height / 2),
        w: Math.round(box.width),
        avatar: avatar && { cx: Math.round(avatar.left + avatar.width / 2), cy: Math.round(avatar.top + avatar.height / 2) },
      };
    });
    if (aiGhost?.avatar) break;
    await page.waitForTimeout(80);
  }
  if (aiGhost?.avatar) {
    check("IA: ghost nasce no avatar do Warden", Math.abs(aiGhost.cx - aiGhost.avatar.cx) <= 4 && Math.abs(aiGhost.cy - aiGhost.avatar.cy) <= 4, JSON.stringify(aiGhost));
  } else {
    check("IA: ghost da jogada da IA", false, "nenhum ghost durante o turno da IA");
  }

  // (g) De volta ao turno humano: undo no meio do voo descarta o ghost e
  // devolve a mão, sem marca presa (o estado commitado já era final).
  await page.waitForFunction(() => !document.querySelector(".end-turn-button")?.disabled, null, { timeout: 120000 });
  await page.waitForTimeout(400);
  // Turno novo: escolhe a casa com mais cartas na mão (a jogável tem de estar
  // na casa ativa) — o pill mostra o nome da casa.
  const handHouses = await page.evaluate(() => {
    const counts = {};
    for (const tile of document.querySelectorAll(".hand-track .card-tile")) {
      const house = (tile.getAttribute("aria-label") ?? "").split(",")[1]?.trim().split(" ")[0];
      if (house) counts[house] = (counts[house] ?? 0) + 1;
    }
    return counts;
  });
  const bestHouse = Object.entries(handHouses).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  await page.evaluate((house) => {
    const pills = [...document.querySelectorAll(".house-picker .house-choice:not([disabled])")];
    const target = pills.find((el) => el.textContent?.includes(house)) ?? pills[0];
    target?.click();
  }, bestHouse);
  await page.waitForTimeout(400);
  const handBefore = await tiles.count();
  let playable = -1;
  for (let i = 0; i < handBefore; i += 1) {
    await tiles.nth(i).click();
    await page.waitForTimeout(200);
    if (await pb.isEnabled().catch(() => false)) { playable = i; break; }
  }
  if (playable >= 0) {
    await domClick(".inspector-actions button.primary-action");
    await page.waitForSelector(".fx-layer .fx-ghost", { timeout: 2000 }).catch(() => {});
    const flying = await page.evaluate(() => document.querySelectorAll(".fx-ghost").length);
    await domClick(".undo-button");
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({
      ghosts: document.querySelectorAll(".fx-ghost").length,
      hidden: [...document.querySelectorAll("[data-fx]")].filter((el) => getComputedStyle(el).visibility === "hidden").length,
    }));
    check("undo no meio do voo: voo cancelado e nada preso", after.ghosts === 0 && after.hidden === 0, JSON.stringify({ flying, ...after }));
    check("undo: mao restaurada", (await tiles.count()) === handBefore, `${await tiles.count()} vs ${handBefore}`);
  } else {
    console.log("SKIP undo no meio do voo: sem carta jogavel no turno 2");
  }

  // (h) Movimento reduzido em runtime: o guard desliga o voo por completo
  // (commit instantâneo, sem ghost e sem marca) — plano §0.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const idsRmBefore = await page.evaluate(() => [...document.querySelectorAll(".board-piece [data-iid]")].map((el) => el.getAttribute("data-iid")));
  let playable2 = -1;
  for (let i = 0; i < (await tiles.count()); i += 1) {
    await tiles.nth(i).click();
    await page.waitForTimeout(180);
    if (await pb.isEnabled().catch(() => false)) { playable2 = i; break; }
  }
  if (playable2 >= 0) {
    await domClick(".inspector-actions button.primary-action");
    let ghostSeen = 0;
    for (let i = 0; i < 10; i += 1) {
      ghostSeen += await page.evaluate(() => document.querySelectorAll(".fx-ghost").length);
      await page.waitForTimeout(60);
    }
    const rm = await page.evaluate((before) => {
      const now = [...document.querySelectorAll(".board-piece [data-iid]")].map((el) => el.getAttribute("data-iid"));
      const added = now.filter((id) => !before.includes(id));
      const tile = added.length ? document.querySelector(`[data-iid="${added[0]}"]`) : null;
      const piece = tile?.closest(".board-piece") ?? null;
      return {
        added: added.length,
        visibility: piece ? getComputedStyle(piece).visibility : null,
        anims: piece ? piece.getAnimations().length + (tile?.getAnimations().length ?? 0) : null,
        slowAnims: piece ? [...piece.getAnimations(), ...(tile?.getAnimations() ?? [])].filter((a) => (a.effect.getComputedTiming().duration ?? 0) > 50).length : null,
        marks: document.querySelectorAll("[data-fx]").length,
      };
    }, idsRmBefore);
    check("reduced-motion: nenhum ghost", ghostSeen === 0, `ghosts vistos ${ghostSeen}`);
    check("reduced-motion: commit instantaneo (sem marca; destino visivel quando houver)", rm.marks === 0 && (rm.added === 0 || (rm.visibility === "visible" && rm.slowAnims === 0)), JSON.stringify(rm));
  } else {
    console.log("SKIP reduced-motion: sem carta jogavel");
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });

  console.log(PROBLEMS.length ? `\nFALHAS: ${PROBLEMS.join("; ")}` : "\nOK: voo da onda 1 confere");
  await browser.close();
} finally {
  server.stop();
}
process.exit(PROBLEMS.length ? 1 : 0);
