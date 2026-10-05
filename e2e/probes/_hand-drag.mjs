// Drag-to-play: >20px rumo a mesa arma a battleline; soltar nela joga; soltar fora = snap-back;
// clique curto continua selecionando; carta fora da casa nao arrasta; touch-action: pan-x.
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5209;
const url = `http://127.0.0.1:${PORT}/`;
const child = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
const stop = () => spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "OK  " : "FAIL"} ${name} ${extra}`); };
try {
  for (let i = 0; i < 200; i += 1) { try { if ((await fetch(url)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const [view, w, h] of [["2d", 1280, 800], ["3d", 1280, 800], ["2d", 390, 844]]) {
    const tag = `${view} ${w}x${h}:`;
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(url);
    await page.evaluate((v) => { localStorage.setItem("aember-arena-tutorial-seen", "1"); localStorage.setItem("aember-arena-settings", JSON.stringify({ language: "en", sfx: false, music: false, animations: true, tableView: v })); }, view);
    await page.reload();
    await page.waitForSelector(".home-screen");
    const nav = page.locator(".header-nav .nav-link").nth(2);
    if (await nav.isVisible().catch(() => false)) await nav.click(); else await page.locator(".mobile-tabs .mobile-tab").nth(2).click();
    await page.locator(".config-screen .config-step-pill").last().click();
    await page.locator(".config-screen .cta-button").click();
    await page.waitForSelector(".game-screen");
    const keep = page.locator(".mulligan-keep");
    if (await keep.count()) await keep.click();
    await page.waitForTimeout(800);
    // escolhe a casa que tem carta na mao
    const label = await page.locator(".hand-track .card-tile").first().getAttribute("aria-label");
    const choices = page.locator(".house-choice");
    let pickIdx = 0;
    for (let i = 0; i < (await choices.count()); i += 1) {
      const txt = ((await choices.nth(i).getAttribute("aria-label")) ?? "") + (await choices.nth(i).innerText());
      const house = txt.trim().split(/s+/)[0];
      if (house && label.includes(house)) { pickIdx = i; break; }
    }
    await choices.nth(pickIdx).click();
    await page.waitForTimeout(500);
    const handCount = () => page.locator(".hand-track .card-tile").count();
    const center = async (sel) => { const b = await sel.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const tiles = page.locator(".hand-track .card-tile");
    const n0 = await handCount();
    let playable = -1, dimmed = -1;
    for (let i = 0; i < n0; i += 1) {
      const dim = await tiles.nth(i).evaluate((e) => e.classList.contains("is-dimmed"));
      if (!dim && playable < 0) playable = i;
      if (dim && dimmed < 0) dimmed = i;
    }
    check(`${tag} ha carta jogavel`, playable >= 0, `n=${n0} playable=${playable} dimmed=${dimmed}`);
    if (playable < 0) { await page.close(); continue; }
    check(`${tag} touch-action pan-x na carta da mao`, (await tiles.nth(0).evaluate((e) => getComputedStyle(e).touchAction)) === "pan-x");

    // 1. clique curto seleciona, sem ghost
    await tiles.nth(playable).click();
    await page.waitForTimeout(200);
    check(`${tag} clique curto seleciona`, (await page.locator(".hand-track .card-tile.is-selected").count()) === 1 && (await page.locator(".drag-ghost").count()) === 0);
    await page.locator(".inspector-section .quiet-icon-button").first().click().catch(() => {});
    await page.waitForTimeout(200);

    // 2. arrasto abaixo do threshold nao arma
    let c = await center(tiles.nth(playable));
    await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x, c.y - 10, { steps: 3 });
    check(`${tag} 10px nao inicia o drag`, (await page.locator(".drag-ghost").count()) === 0 && (await page.locator("[data-drop]").count()) === 0);
    await page.mouse.up();
    await page.waitForTimeout(150);
    await page.locator(".inspector-section .quiet-icon-button").first().click().catch(() => {});

    // 3. arrasto lateral nao arma
    c = await center(tiles.nth(playable));
    await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + 60, c.y - 5, { steps: 5 });
    check(`${tag} arrasto lateral nao inicia`, (await page.locator(".drag-ghost").count()) === 0);
    await page.mouse.up();
    await page.waitForTimeout(150);
    await page.locator(".inspector-section .quiet-icon-button").first().click().catch(() => {});

    // 4. drag armado + soltar na mao = snap-back
    c = await center(tiles.nth(playable));
    await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x, c.y - 40, { steps: 6 });
    const armed = await page.evaluate(() => ({ ghost: document.querySelectorAll(".drag-ghost").length, drop: document.querySelector(".battle-zone--player")?.dataset.drop, dragging: document.querySelectorAll("[data-dragging]").length }));
    check(`${tag} drag arma ghost + zona valida`, armed.ghost === 1 && armed.drop === "armed" && armed.dragging === 1, JSON.stringify(armed));
    await page.mouse.move(c.x, c.y, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const back = await page.evaluate(() => ({ ghost: document.querySelectorAll(".drag-ghost").length, drop: document.querySelector(".battle-zone--player")?.dataset.drop ?? null, sel: document.querySelectorAll(".hand-track .is-selected").length }));
    check(`${tag} soltar fora = snap-back (sem jogar, sem selecionar)`, back.ghost === 0 && back.drop === null && back.sel === 0 && (await handCount()) === n0, JSON.stringify(back));

    // 5. carta fora da casa nao arrasta
    if (dimmed >= 0) {
      c = await center(tiles.nth(dimmed));
      await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x, c.y - 60, { steps: 6 });
      check(`${tag} carta nao jogavel nao arrasta`, (await page.locator(".drag-ghost").count()) === 0);
      await page.mouse.up();
      await page.waitForTimeout(150);
    }

    // 6. soltar sobre a battleline joga
    c = await center(tiles.nth(playable));
    const z = await page.locator(".battle-zone--player").boundingBox();
    const zx = z.x + z.width / 2, zy = z.y + z.height / 2;
    await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x, c.y - 30, { steps: 4 }); await page.mouse.move(zx, zy, { steps: 10 });
    const over = await page.evaluate(() => document.querySelector(".battle-zone--player")?.dataset.drop);
    check(`${tag} sobre a zona = over`, over === "over", String(over));
    await page.mouse.up();
    await page.waitForTimeout(1500);
    const after = await handCount();
    const pickOpen = (await page.locator(".turn-console .secondary-action, .pick-banner, .flank-pick").count()) > 0;
    check(`${tag} drop joga a carta (mao -1 ou fluxo de alvo aberto)`, after === n0 - 1 || pickOpen, `mao ${n0} -> ${after} pick=${pickOpen}`);
    check(`${tag} sem ghost/zona armada depois do drop`, (await page.evaluate(() => document.querySelectorAll(".drag-ghost, [data-drop]").length)) === 0);
    await page.close();
  }
  await browser.close();
} finally { stop(); }
process.exit(bad ? 1 : 0);
