// Rasteriza o forge-icon.svg em PNG 192 e 512 (o criterio de instalabilidade do
// Chrome quer PNG >= 192px; o manifesto tinha so o SVG).
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const svgPath = join(ROOT, "public", "forge-icon.svg");
const svg = readFileSync(svgPath, "utf8");

const browser = await chromium.launch({ headless: true });
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body>`);
  await page.waitForTimeout(300);
  const buf = await page.screenshot({ omitBackground: true });
  const out = join(ROOT, "public", `forge-icon-${size}.png`);
  writeFileSync(out, buf);
  console.log(`forge-icon-${size}.png: ${buf.length} bytes`);
  await page.close();
}
await browser.close();
