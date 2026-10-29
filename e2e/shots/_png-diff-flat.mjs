// Comparacao pixel a pixel de duas arvores de screenshots (tooling temporario,
// e2e/shots e gitignored): um browser decodifica os PNGs num canvas e conta os
// pixels diferentes + a bounding box da diferenca, por tela/viewport.
// Uso: node e2e/shots/_png-diff.mjs <dirA> <dirB>
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const [dirA, dirB] = process.argv.slice(2).map((p) => resolve(ROOT, p));
if (!dirA || !dirB) {
  console.error("uso: node e2e/shots/_png-diff.mjs <dirA> <dirB>");
  process.exit(2);
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
      return await chromium.launch({ headless: true, args: ["--no-sandbox"], ...opts });
    } catch { /* proximo */ }
  }
  throw new Error("sem Edge/Chrome do sistema");
}

const DIFF_FN = async ([aUrl, bUrl]) => {
  const load = (url) => new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = url; });
  const [ia, ib] = await Promise.all([load(aUrl), load(bUrl)]);
  if (ia.width !== ib.width || ia.height !== ib.height) return { sizeMismatch: [ia.width, ia.height, ib.width, ib.height] };
  const canvas = document.createElement("canvas");
  canvas.width = ia.width;
  canvas.height = ia.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const pixels = (img) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  };
  const da = pixels(ia);
  const db = pixels(ib);
  let count = 0;
  let minX = 1e9;
  let minY = 1e9;
  let maxX = -1;
  let maxY = -1;
  let maxDelta = 0;
  const bands = {};
  for (let i = 0; i < da.length; i += 4) {
    const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) + Math.abs(da[i + 3] - db[i + 3]);
    if (d > 8) {
      count += 1;
      const p = i / 4;
      const x = p % ib.width;
      const y = Math.floor(p / ib.width);
      const band = Math.floor(y / 100) * 100;
      bands[band] = (bands[band] ?? 0) + 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (d > maxDelta) maxDelta = d;
    }
  }
  return { count, bbox: count ? [minX, minY, maxX, maxY] : null, total: ib.width * ib.height, maxDelta, bands };
};

const browser = await launch();
const page = await browser.newPage();
let failed = false;
// Variante para pastas planas (o _2d-freeze grava game-360.png direto no tag): o _png-diff
// original só anda por subpastas NxN e, com pasta plana, responde "identico" sem comparar nada.
const flat = readdirSync(dirA).filter((name) => name.endsWith(".png"));
const viewports = flat.length ? ["."] : readdirSync(dirA).filter((name) => /^\d+x\d+$/.test(name));
for (const vp of viewports) {
  const screens = flat.length ? flat : readdirSync(join(dirA, vp)).filter((name) => name.endsWith(".png"));
  for (const screen of screens) {
    const a = join(dirA, vp, screen);
    const b = join(dirB, vp, screen);
    if (!existsSync(b)) {
      console.log(`[${vp}/${screen}] ausente em B`);
      failed = true;
      continue;
    }
    const dataUrl = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;
    const result = await page.evaluate(DIFF_FN, [dataUrl(a), dataUrl(b)]);
    if (result.sizeMismatch) {
      console.log(`[${vp}/${screen}] TAMANHOS DIFERENTES ${JSON.stringify(result.sizeMismatch)}`);
      failed = true;
      continue;
    }
    const pct = ((result.count / result.total) * 100).toFixed(3);
    console.log(`[${vp}/${screen}] pixels diferentes=${result.count} (${pct}%) bbox=${result.bbox ? result.bbox.join(",") : "-"} maxDelta=${result.maxDelta}`);
    if (result.count > 0) {
      console.log(`    bandas y=${Object.entries(result.bands).map(([band, n]) => `${band}:${n}`).join(" ")}`);
    }
    if (result.count > 0) failed = true;
  }
}
await browser.close();
console.log(failed ? "\nDIFF: ha diferencas (acima) — analisar se sao esperadas" : "\nDIFF: identico pixel a pixel");
process.exit(0);
