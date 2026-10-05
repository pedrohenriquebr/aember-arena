// Banda do jogador (You/ÆMBER/CARDS) nao pode tocar a mao: gap = topo da mao - base da banda.
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5208;
const url = `http://127.0.0.1:${PORT}/`;
const child = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
const stop = () => spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
let bad = 0;
try {
  for (let i = 0; i < 200; i += 1) { try { if ((await fetch(url)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const view of ["2d", "3d"]) for (const [w, h] of [[390, 844], [768, 1024], [1280, 800]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(url);
    await page.evaluate((v) => { localStorage.setItem("aember-arena-tutorial-seen", "1"); localStorage.setItem("aember-arena-settings", JSON.stringify({ language: "en", sfx: false, music: false, animations: false, tableView: v })); }, view);
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
    const m = await page.evaluate(() => {
      const bands = [...document.querySelectorAll(".board-content > .player-band")];
      const band = bands[bands.length - 1].getBoundingClientRect();
      const tops = [...document.querySelectorAll(".hand-track .card-tile")].map((c) => c.getBoundingClientRect().top);
      return { bandBottom: band.bottom, handTop: Math.min(...tops) };
    });
    const gap = m.handTop - m.bandBottom;
    const ok = gap >= 0;
    if (!ok) bad += 1;
    console.log(`${view} ${w}x${h} gap=${gap.toFixed(1)} ${ok ? "OK" : "TOCA"}`);
    await page.close();
  }
  await browser.close();
} finally { stop(); }
process.exit(bad ? 1 : 0);
