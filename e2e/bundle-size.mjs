// Mede o tamanho gzip do dist/index.html (build single-file).
// Pressupoe "npm run build" recem-rodado. Metrica: zlib.gzipSync nivel 9.
// Uso: node e2e/bundle-size.mjs [--dist dist]

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const distDir = argValue("--dist") ?? "dist";
const file = resolve(ROOT, distDir, "index.html");
if (!existsSync(file)) {
  console.error(`bundle-size: ${file} nao encontrado - rode "npm run build" antes.`);
  process.exit(2);
}
const raw = readFileSync(file);
const gz = gzipSync(raw, { level: 9 });
console.log(`gzipKB=${(gz.length / 1024).toFixed(2)}`);
console.log(`rawKB=${(raw.length / 1024).toFixed(2)}`);
