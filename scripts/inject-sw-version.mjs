// SPDX-License-Identifier: AGPL-3.0-only
// Injeta o BUILD_ID no dist/sw.js (roda no "build", depois do vite build).
// public/sw.js traz o placeholder `__BUILD_ID__` no topo; aqui ele é trocado por
// <git short hash>-<timestamp curto AAMMDDHHmmss>. Assim o sw.js muda de bytes a
// cada build → o navegador detecta update do service worker → instala → o toast
// FEAT-09 aparece → "Recarregar" faz skipWaiting → o activate limpa as caches
// aember-arena-* antigas pelo prefixo (o SHELL_CACHE do worker novo é
// "aember-arena-shell-<BUILD_ID>"). Sem isso o sw.js era estático entre builds e
// um SW velho servia o shell velho para sempre (envenenamento do preview).
// Falhar alto: placeholder ausente significa que o sw.js perdeu o versionamento.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SW_PATH = join(ROOT, "dist", "sw.js");
const PLACEHOLDER = "__BUILD_ID__";

let hash;
try {
  hash = execSync("git rev-parse --short HEAD", { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch {
  // Sem git (tarball/CI): o timestamp ainda garante unicidade por build.
  hash = "nogit";
}

const now = new Date();
const pad = (value) => String(value).padStart(2, "0");
const stamp = [
  String(now.getFullYear()).slice(2),
  pad(now.getMonth() + 1),
  pad(now.getDate()),
  pad(now.getHours()),
  pad(now.getMinutes()),
  pad(now.getSeconds()),
].join("");
const buildId = `${hash}-${stamp}`;

let source;
try {
  source = readFileSync(SW_PATH, "utf8");
} catch {
  console.error(`inject-sw-version: dist/sw.js nao encontrado em ${SW_PATH} (rode vite build antes)`);
  process.exit(1);
}
if (!source.includes(PLACEHOLDER)) {
  console.error(`inject-sw-version: placeholder ${PLACEHOLDER} ausente em ${SW_PATH} — sw.js sem versionamento`);
  process.exit(1);
}
writeFileSync(SW_PATH, source.split(PLACEHOLDER).join(buildId));
console.log(`inject-sw-version: BUILD_ID=${buildId}`);
