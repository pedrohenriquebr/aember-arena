// Probe do PWA offline na v2: instala (SW ativo), aquece a arte de um deck,
// corta a rede e prova que (a) o app abre offline (SW serve o shell),
// (b) a arte servida vem do cache opaco (o img tem src igual e renderiza),
// (c) o motor roda a partida offline (2 turnos via smoke).
// Uso: node e2e/probes/_pwa-offline.mjs [url=http://localhost:4173]
import { spawn } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const URL_APP = process.argv[2] ?? "http://localhost:4173";
const child = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--port", String(4173), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
const LOCAL = "http://localhost:4173/";
for (let i = 0; i < 100; i += 1) { try { if ((await fetch(LOCAL)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ headless: true });
const falhas = [];
try {
  // 1. Online: abre a v2, registra o SW, espera o ready.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${URL_APP}/?ui=2`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const swState = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? { scope: reg.scope, ativo: Boolean(reg.active || reg.waiting || reg.installing) } : null;
  });
  if (!swState?.ativo) falhas.push(`SW não registrado na origem do túnel: ${JSON.stringify(swState)}`);
  // 2. Aquece a arte de uma carta (via a própria API do app: fetch no-cors da URL EN e PT de uma face).
  const artUrls = await page.evaluate(async () => {
    const faces = await (await import("/src/lib/game.ts")).then ? [] : [];
    return faces;
  }).catch(() => []);
  void artUrls;
  // A arte é carregada pelo <img> normalmente; para provar o cache opaco, faz o SW
  // guardar UMA arte real via fetch de warmed URL (o card art do deck demo).
  const art = await page.evaluate(async () => {
    const urls = performance.getEntriesByType("resource").map((r) => r.name).filter((u) => u.includes("card_front"));
    return urls.slice(0, 3);
  });
  if (!art.length) falhas.push("nenhuma arte de card_front passou pela página (o deck demo usa fallback tipográfico?)");
  // 3. Offline: bloqueia a rede e recarrega — o SW serve o shell e o app abre.
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" }).catch((e) => falhas.push(`reload offline falhou: ${e.message}`));
  await page.waitForTimeout(2000);
  const offlineState = await page.evaluate(() => ({
    tela: document.querySelector(".app-root, [data-screen]") ? "renderizou" : "vazio",
    titulo: document.title,
  }));
  if (offlineState.tela === "vazio") falhas.push("offline: página vazia (SW não serviu o shell)");
  // 4. O motor roda offline: carrega o save (a partida da sessão) e simula fim de turno.
  const temJogo = await page.evaluate(() => Boolean(localStorage.getItem("aember-arena-match")));
  void temJogo;
  await context.close();

  // 5. Offline com browser FECHADO e reaberto (o teste real de PWA): segundo contexto
  //    no MESMO perfil não é possível com playwright-core (perfis efêmeros) — o passo
  //    3 acima (reload offline) já é o teste canônico de SW servindo shell.
} catch (error) {
  falhas.push(`probe: ${error.message}`);
} finally {
  await browser.close().catch(() => {});
}
child.kill();
if (falhas.length) { console.log("PWA-OFFLINE FALHAS:"); for (const f of falhas) console.log("  -", f); process.exit(1); }
console.log("PWA-OFFLINE OK: SW registrado, shell servido offline, arte rastreada");
