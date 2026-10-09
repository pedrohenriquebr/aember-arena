// Probe do motion do Detalhe (H-25): reproduz o detailFlow do ui2 no tema escolhido e despeja
// as animações em curso (tipo, propriedade, alvo, tempo) após a troca para a aba Estatísticas.
// Uso: node e2e/probes/_detail-motion.mjs [tema=claro] [rodadas=6]
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5212;
const THEME = process.argv[2] ?? "claro";
const RUNS = Number(process.argv[3] ?? 6);
const VP = { width: 1920, height: 1080 };
const SEED = `(() => {
  localStorage.setItem("aember-arena-settings", JSON.stringify({
    difficulty: "Medium", thinkingDepth: 2, sfx: false, music: false, animations: false,
    hoverZoom: false, hints: false, language: "en", opponentMode: "mirror", gameMode: "solo",
  }));
  localStorage.setItem("aember-arena-language", "en");
  localStorage.setItem("aember-arena-tutorial-seen", "1");
  localStorage.setItem("aember-arena-theme", "${THEME}");
})()`;

// Despeja o que está rodando: tipo, propriedade/nome, alvo (tag#id.class), tempos e o pai imediato.
const DUMP = () => document.getAnimations().filter((a) => a.playState === "running").map((a) => {
  const t = a.effect?.target;
  const timing = a.effect?.getComputedTiming?.();
  const tt = a.effect?.getTiming?.();
  return {
    kind: a.constructor.name,
    prop: a.transitionProperty || a.animationName || "-",
    target: t ? `${t.tagName.toLowerCase()}#${t.id || ""}.${t.getAttribute("class") || ""}` : "SEM ALVO",
    html: t?.outerHTML?.slice(0, 140) ?? null,
    pseudo: a.effect?.pseudoElement ?? null,
    parent: t?.parentElement ? `${t.parentElement.tagName.toLowerCase()}.${t.parentElement.getAttribute("class") || ""}` : null,
    delay: tt?.delay, duration: tt?.duration, iter: tt?.iterations, fill: tt?.fill,
    currentTime: Math.round(a.currentTime ?? -1),
    activeDuration: timing?.activeDuration, endTime: timing?.endTime,
    startTime: a.startTime,
  };
});

const server = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
const url = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 200; i += 1) {
  try { if ((await fetch(url)).ok) break; } catch { /* subindo */ }
  await new Promise((r) => setTimeout(r, 250));
}

const { chromium } = await import("playwright-core");
let browser = null;
for (const opts of [{ channel: "msedge" }, { channel: "chrome" }]) {
  try { browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"], ...opts }); break; } catch { /* proximo */ }
}
if (!browser) {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(existsSync);
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"], executablePath: candidates[0] });
}

try {
  for (let run = 1; run <= RUNS; run += 1) {
    const context = await browser.newContext({ viewport: VP, reducedMotion: "reduce" });
    await context.addInitScript(SEED);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto(`${url}?ui=2`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-screen="lobby"]', { timeout: 30000 });
    await page.locator(".nf-shelf-grid .nf-tile-actions .nf-btn--ghost").first().click();
    await page.waitForSelector('[data-screen="detail"]', { timeout: 15000 });
    await page.waitForTimeout(700);
    // Mesmo passo do detailFlow no desktop: hover na 3ª carta e espera antes da aba.
    await page.locator('[data-screen="detail"] .nf-detail-card').nth(2).hover();
    await page.waitForTimeout(200);
    const before = await page.evaluate(DUMP);
    console.log(`\n== rodada ${run} · antes da aba: ${before.length} animação(ões)`);
    for (const a of before) console.log("   pre ", JSON.stringify(a));

    await page.getByRole("radio", { name: "Statistics", exact: true }).click();
    await page.waitForSelector('[data-screen="detail"] .nf-detail-stats', { timeout: 5000 }).catch(() => console.log("   aba não abriu"));
    let elapsed = 0;
    for (const step of [0, 150, 250, 300, 500]) {
      if (step) await page.waitForTimeout(step);
      elapsed += step;
      const live = await page.evaluate(DUMP);
      console.log(`   t≈${elapsed}ms: ${live.length} rodando`);
      for (const a of live) console.log("     ", JSON.stringify(a));
    }
    if (errors.length) console.log("   erros de página:", errors.join(" | "));
    await context.close();
  }
} finally {
  await browser.close();
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill("SIGTERM");
}
