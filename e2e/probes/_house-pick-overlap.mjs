// GAP 1: com o inspetor ancorado aberto, o seletor de casa (house-picker) tem de
// receber o clique quando o jogo espera move.house (classe --yield no inspetor).
// Atualizado para o pill flutuante: o seletor mora sobre a mesa (.house-pill),
// nunca no rail — o probe confirma o hit-test em qualquer viewport.
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5207;
const url = `http://127.0.0.1:${PORT}/`;
const child = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
const stop = () => spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
let bad = 0;
try {
  for (let i = 0; i < 200; i += 1) { try { if ((await fetch(url)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const [w, h] of [[390, 844], [768, 1024], [1024, 768], [1280, 800]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(url);
    await page.evaluate(() => { localStorage.setItem("aember-arena-language", "en"); localStorage.setItem("aember-arena-tutorial-seen", "1"); localStorage.setItem("aember-arena-settings", JSON.stringify({ language: "en", sfx: false, music: false, animations: false })); });
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
    await page.locator(".hand-track .card-tile").first().click();
    await page.waitForTimeout(500);
    const probe = () => page.evaluate(() => {
      const sec = document.querySelector(".inspector-section");
      return [...document.querySelectorAll(".house-picker .house-choice")].map((b) => {
        const r = b.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return b.contains(el) || (sec && sec.contains(el) ? "COBERTO" : "ok-other");
      });
    });
    const before = await probe();
    await page.evaluate(() => document.querySelector(".inspector-section")?.classList.add("inspector-section--yield"));
    const after = await probe();
    // O seletor virou pill flutuante sobre a mesa (.house-pill) — fora do rail,
    // em cima do felt, em qualquer viewport.
    const inPill = await page.evaluate(() => Boolean(document.querySelector(".game-board .house-pill .house-picker .house-choice")));
    const ok = after.every((v) => v === true) && inPill;
    if (!inPill) console.log(`  seletor fora do pill: ${inPill}`);
    if (!ok) bad += 1;
    console.log(`${w}x${h} sem yield: ${JSON.stringify(before)} | com yield: ${JSON.stringify(after)} ${ok ? "OK" : "FALHA"}`);
    await page.close();
  }
  await browser.close();
} finally { stop(); }
process.exit(bad ? 1 : 0);
