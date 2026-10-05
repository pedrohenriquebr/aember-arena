// Revisão da partida: cada modo de oponente mostra os baralhos certos, o Inspecionar
// abre a lista por casa + lightbox, e no modo aleatório o baralho SORTEADO na revisão
// é o mesmo que a partida usa (o sorteio é antecipado, não refeito no início).
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5211;
const url = `http://127.0.0.1:${PORT}/`;
const child = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
const stop = () => spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
let bad = 0;
const check = (label, ok, detail = "") => {
  if (!ok) bad += 1;
  console.log(`  ${ok ? "OK   " : "FALHA"} ${label}${detail ? ` — ${detail}` : ""}`);
};
// [modo, lados esperados, lados com deck inspecionável]
const CASES = [
  [{ gameMode: "solo", opponentMode: "mirror" }, 1, 1],
  // id do segundo deck inicial (demoDeck2.ts): sem ele o modo "deck" cai no espelho.
  [{ gameMode: "solo", opponentMode: "deck", opponentDeckId: "eb5d4c4a-5957-4276-ab9a-0d1b19f42e81" }, 2, 2],
  [{ gameMode: "solo", opponentMode: "random" }, 2, 2],
  [{ gameMode: "passAndPlay", opponentMode: "mirror" }, 2, 2],
];
try {
  for (let i = 0; i < 200; i += 1) { try { if ((await fetch(url)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const [w, h] of [[390, 844], [1280, 800]]) {
    for (const [mode, sides, decks] of CASES) {
      console.log(`${w}x${h} ${mode.gameMode}/${mode.opponentMode}`);
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      await page.goto(url);
      await page.evaluate((m) => {
        localStorage.setItem("aember-arena-language", "en");
        localStorage.setItem("aember-arena-tutorial-seen", "1");
        localStorage.setItem("aember-arena-settings", JSON.stringify({ language: "en", sfx: false, music: false, animations: false, ...m }));
      }, mode);
      await page.reload();
      await page.waitForSelector(".home-screen");
      const nav = page.locator(".header-nav .nav-link").nth(2);
      if (await nav.isVisible().catch(() => false)) await nav.click(); else await page.locator(".mobile-tabs .mobile-tab").nth(2).click();
      await page.locator(".config-screen .config-step-pill").last().click();
      await page.waitForSelector(".review-sides");
      check("lados", (await page.locator(".review-side").count()) === sides);
      const inspect = page.locator(".review-side > .ghost-button");
      check("botões Inspecionar", (await inspect.count()) === decks, `${await inspect.count()}/${decks}`);
      check("sem lado pendente", (await page.locator(".review-pending").count()) === 0);
      const names = await page.locator(".review-deck-name").allTextContents();
      check("baralhos distintos", new Set(names).size === names.length, names.join(" × "));

      const last = inspect.last();
      await last.click();
      check("painel por casa", (await last.getAttribute("aria-expanded")) === "true" && (await page.locator(".review-houses .review-house-head").count()) === 3);
      const rows = await page.locator(".review-houses .review-card-row").count();
      check("cartas listadas", rows >= 36, String(rows));
      await page.locator(".review-houses .review-card-row").first().click();
      const dialog = page.locator('[role="dialog"]');
      check("lightbox", (await dialog.count()) === 1);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      check("lightbox fecha, passo mantido", (await dialog.count()) === 0 && (await page.locator(".review-sides").count()) === 1);
      const translate = page.locator(".review-translate .ghost-button");
      check("card Traduzir", (await translate.count()) === 1 && (await translate.isDisabled()));

      if (mode.opponentMode === "random") {
        const drawn = names[1];
        check("selo Sorteado", (await page.locator(".review-side--rival .review-badge").count()) === 1);
        await page.locator(".config-screen .cta-button").click();
        await page.waitForSelector(".game-screen");
        const labels = await page.locator(".player-deck-label").allTextContents();
        check("partida usa o sorteado", labels.includes(drawn), `${drawn} em [${labels.join(" | ")}]`);
      }
      await page.close();
    }
  }
  await browser.close();
} finally { stop(); }
console.log(bad ? `FALHOU: ${bad}` : "review-decks: tudo OK");
process.exit(bad ? 1 : 0);
