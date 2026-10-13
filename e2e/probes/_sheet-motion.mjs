// Probe do motion da folha da carta (H-26/H-28 QA): reproduce o detail-flow mobile
// no tema pedido e despeja as animacoes ativas nos <img> apos abrir a folha.
import { spawn } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5299;
const THEME = process.argv[2] ?? "claro";
const child = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
const url = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 100; i += 1) { try { if ((await fetch(url)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 768, height: 1024 }, reducedMotion: "reduce" });
await context.addInitScript(`localStorage.setItem("aember-arena-ui","2"); localStorage.setItem("aember-arena-theme","${THEME}"); localStorage.setItem("aember-arena-tutorial-seen","1");`);
const page = await context.newPage();
await page.goto(`${url}?ui=2`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(900);
const explore = page.getByRole("button", { name: /Open deck details|Explore|deck details/i }).first();
await explore.click().catch(() => {});
await page.waitForTimeout(900);
const card = page.locator('[data-screen="detail"] button').filter({ hasText: /creature|action|artifact/i }).first();
await card.click().catch(() => {});
await page.waitForTimeout(1200);
const anims = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('[role="dialog"] img, [role="dialog"] *')) {
    const list = el.getAnimations();
    if (list.length) out.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), n: list.length, kinds: [...new Set(list.map((a) => a.constructor.name))] });
  }
  return out.slice(0, 10);
});
console.log(JSON.stringify(anims, null, 1));
await browser.close();
child.kill();
process.exit(0);
