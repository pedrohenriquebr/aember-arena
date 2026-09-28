// Agrega os checks de aceite da T1 (docs/WORKFLOW.md §3 T1 + §2 invariantes + §5 crit. 5):
//   1. Piso tipografico  -> "node e2e/capture.mjs --floor-only" (360x800, 5 telas).
//      Contrato (§2): 11px p/ qualquer texto informativo; 10px so em caps/eyebrow com
//      letter-spacing >= 0.1em; inputs 16px sempre.
//   2. Orcamento de bundle -> gzipKB de dist/index.html <= --max-gzip-kb.
//      Default 127.5 kB — revisado de 126 em 28/09: as features FEAT-11/14/06 desta
//      rodada consomem todo o headroom — FEAT-11 medida em 0,68 kB gz (passo
//      "Oponente" na Configuracao com espelho/deck da biblioteca/aleatorio,
//      settings.opponentMode + opponentDeckId e 11 chaves i18n) e FEAT-14 (chip de
//      cobertura por deck) + FEAT-06 (estatisticas pos-partida e W/L local) somam o
//      restante; 127.5 kB e o teto maximo pre-autorizado (sem folga residual, decisao
//      documentada no CLAUDE.md §7). A revisao anterior (125 -> 126) foi FEAT-05/08/10;
//      antes dela, 124 -> 125 com modulePreload:false + mangle toplevel + i18n compacto.
//      Pressupoe "npm run build" recem-rodado.
//   3. Bloco @media (max-width: 700px) de src/index.css com <= --block-max-lines linhas.
//      Default 99 ("menos de 100 linhas", §5 criterio 5; hoje o bloco tem ~723).
//
// Sai != 0 listando TODAS as violacoes.
// Uso: node e2e/acceptance.mjs [--max-gzip-kb N] [--block-max-lines N] [--skip-floor] [--port N]

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CSS_PATH = join(ROOT, "src", "index.css");
const DIST_HTML = join(ROOT, "dist", "index.html");
const MEDIA_QUERY = "@media (max-width: 700px)";

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
function hasFlag(name) {
  return process.argv.includes(name);
}

const maxGzipKb = Number(argValue("--max-gzip-kb") ?? 127.5);
const blockMaxLines = Number(argValue("--block-max-lines") ?? 99);
const skipFloor = hasFlag("--skip-floor");
const floorPort = Number(argValue("--port") ?? 5211);

function measureGzipKb() {
  if (!existsSync(DIST_HTML)) return null;
  return gzipSync(readFileSync(DIST_HTML), { level: 9 }).length / 1024;
}

// Conta as linhas do bloco @media via casamento de chaves a partir da linha do @media.
function measureMediaBlock(cssPath, query) {
  const lines = readFileSync(cssPath, "utf8").split(/\r?\n/);
  const openIdx = lines.findIndex((line) => line.includes(query));
  if (openIdx < 0) return null;
  let depth = 0;
  let started = false;
  for (let i = openIdx; i < lines.length; i += 1) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        depth += 1;
        started = true;
      } else if (ch === "}") {
        depth -= 1;
        if (started && depth === 0) return { start: openIdx + 1, end: i + 1, lines: i - openIdx + 1 };
      }
    }
  }
  return { start: openIdx + 1, end: null, lines: lines.length - openIdx, unterminated: true };
}

const violations = [];

console.log("== ACCEPTANCE (T1) ==");

// 1) Piso tipografico
if (skipFloor) {
  console.log("\n[1/3] piso tipografico: PULADO (--skip-floor)");
} else {
  console.log(`\n[1/3] piso tipografico (node e2e/capture.mjs --floor-only @360x800, 5 telas):`);
  const res = spawnSync(process.execPath, [join(ROOT, "e2e", "capture.mjs"), "--floor-only", "--port", String(floorPort)], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  if (res.error) {
    violations.push(`piso: nao conseguiu executar capture.mjs (${res.error.message})`);
  } else if (res.status !== 0) {
    violations.push(`piso tipografico: ${res.status === 1 ? "violacoes listadas acima" : `capture.mjs saiu com code ${res.status}`}`);
  }
}

// 2) Orcamento de bundle
console.log(`\n[2/3] orcamento de bundle (dist/index.html, zlib level 9, max ${maxGzipKb} kB):`);
const gzipKb = measureGzipKb();
if (gzipKb === null) {
  violations.push('bundle: dist/index.html nao encontrado - rode "npm run build" antes do acceptance');
  console.log("  dist/index.html ausente");
} else {
  console.log(`  gzipKB=${gzipKb.toFixed(2)}`);
  if (gzipKb > maxGzipKb) violations.push(`bundle: gzip ${gzipKb.toFixed(2)} kB > max ${maxGzipKb} kB`);
}

// 3) Bloco @media (max-width: 700px)
console.log(`\n[3/3] bloco "${MEDIA_QUERY}" em src/index.css (max ${blockMaxLines} linhas):`);
const block = measureMediaBlock(CSS_PATH, MEDIA_QUERY);
if (!block) {
  violations.push("css: bloco @media (max-width: 700px) nao encontrado em src/index.css");
  console.log("  bloco nao encontrado");
} else if (block.unterminated) {
  violations.push(`css: bloco @media (max-width: 700px) (linha ${block.start}) sem fechamento`);
} else {
  console.log(`  ${block.lines} linhas (linhas ${block.start}-${block.end} do arquivo)`);
  if (block.lines > blockMaxLines) {
    violations.push(`css: bloco @media (max-width: 700px) tem ${block.lines} linhas (max ${blockMaxLines}; meta do plano: menos de 100)`);
  }
}

console.log("\n== RESULTADO ==");
if (violations.length) {
  console.error(`ACCEPTANCE: FALHOU - ${violations.length} check(s) com violacao:`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log("ACCEPTANCE: OK - todos os checks passaram");
