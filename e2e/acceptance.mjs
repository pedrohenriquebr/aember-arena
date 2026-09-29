// Agrega os checks de aceite da T1 (docs/WORKFLOW.md §3 T1 + §2 invariantes + §5 crit. 5):
//   1. Piso tipografico  -> "node e2e/capture.mjs --floor-only" (360x800, 5 telas).
//      Contrato (§2): 11px p/ qualquer texto informativo; 10px so em caps/eyebrow com
//      letter-spacing >= 0.1em; inputs 16px sempre.
//   2. Orcamento de bundle -> gzipKB de dist/index.html <= --max-gzip-kb.
//      Default 143,5 kB — revisado de 141 em 29/09 pelo visual do 3D
//      (VIEW3D H3D-03..06, docs/VIEW3D_PLAN.md §2.1-§2.5: mesa inclinada com
//      playmat e billboards, cartas de pe/levitando com --n por lane, sombras
//      no tapete e mao em leque + checks do probe _3d-chain; so CSS/TS, zero
//      dependencia — mediu 141,38 kB gz, +1,25 sobre os 140,13 da fundacao).
//      A revisao anterior (139,5 -> 141) foi a fundacao do modo 3D
//      (VIEW3D H3D-01..10, docs/VIEW3D_PLAN.md §2/§5: tableView persistido +
//      toggle, wrapper .table-plane com a cadeia perspective/preserve-3d,
//      transicao de modo com @property --tilt e o probe _3d-chain; so CSS/TS,
//      zero dependencia — a fundacao mediu +0,87 kB gz, de 139,26 para 140,13). A
//      revisao anterior (138 -> 139.5) foi a ANIM onda 3
//      (docs/ANIMATIONS_PLAN.md §4:
//      forja com glow localizado + shake, numeros flutuantes de dano,
//      morte com dissolve do clone e correntes com elo no contador); mediu
//      138.68 kB gz. A revisao anterior (136.5 -> 138) foi a ANIM onda 2 (plano §3:
//      palco do turno da IA — batidas por ação, legenda, pulso + "+N Æ", selo da
//      casa, banner "Seu turno", resumo persistente, toque para acelerar e
//      aiSpeed em settings); mediu 137.92 kB gz. A revisao anterior (135 -> 136.5)
//      foi a ANIM onda 1
//      (docs/ANIMATIONS_PLAN.md): infra de FX (lib/fx.ts puro, diretor FxLayer no
//      portal, data-iid/data-side, voo da carta, fade de quem sai do board, glow
//      de seleção) + VAL-04; mediu 136.46 kB gz e a varredura de mortos previa
//      removeu 6 overrides .reduce-motion redundantes (CLAUDE.md §7). Antes:
//      134 (fechamento do tutorial de primeiro acesso, 28/09: o snapshot WIP
//      (cd81435) trazia TutorialWizard + i18n + CSS, 133.88 kB gz; auditoria de
//      codigo morto nao achou peso removivel e o build final mediu 133.90) e
//      132 (FEAT-13 pass-and-play, 130.45). Antes dela: 127.5 -> 129.5 com
//      FEAT-12a/12b; 126 -> 127.5 com FEAT-11/14/06; 125 -> 126 com FEAT-05/08/10
//      e 124 -> 125 com modulePreload:false + mangle toplevel + i18n compacto.
//      Pressupoe "npm run build" recem-rodado.
//   3. Bloco @media (max-width: 700px) de src/index.css com <= --block-max-lines linhas.
//      Default 99 ("menos de 100 linhas", §5 criterio 5; hoje o bloco tem ~723).
//   4. Piso VISUAL do 3D (H3D-11) -> "capture.mjs --floor-only --view 3d": mesmo
//      contrato medido com o fator de projecao (rect.height / offsetHeight) a
//      360/768/1280/1440, com teste do teste (tilt 60 tem de acusar). Pula com
//      --skip-floor3d.
//
// Sai != 0 listando TODAS as violacoes.
// Uso: node e2e/acceptance.mjs [--max-gzip-kb N] [--block-max-lines N] [--skip-floor] [--skip-floor3d] [--port N]

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

const maxGzipKb = Number(argValue("--max-gzip-kb") ?? 143.5);
const blockMaxLines = Number(argValue("--block-max-lines") ?? 99);
const skipFloor = hasFlag("--skip-floor");
const skipFloor3d = hasFlag("--skip-floor3d");
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
  console.log("\n[1/4] piso tipografico: PULADO (--skip-floor)");
} else {
  console.log(`\n[1/4] piso tipografico (node e2e/capture.mjs --floor-only @360x800, 5 telas):`);
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
console.log(`\n[2/4] orcamento de bundle (dist/index.html, zlib level 9, max ${maxGzipKb} kB):`);
const gzipKb = measureGzipKb();
if (gzipKb === null) {
  violations.push('bundle: dist/index.html nao encontrado - rode "npm run build" antes do acceptance');
  console.log("  dist/index.html ausente");
} else {
  console.log(`  gzipKB=${gzipKb.toFixed(2)}`);
  if (gzipKb > maxGzipKb) violations.push(`bundle: gzip ${gzipKb.toFixed(2)} kB > max ${maxGzipKb} kB`);
}

// 3) Bloco @media (max-width: 700px)
console.log(`\n[3/4] bloco "${MEDIA_QUERY}" em src/index.css (max ${blockMaxLines} linhas):`);
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

// 4) Piso visual do 3D (H3D-11)
if (skipFloor3d) {
  console.log("\n[4/4] piso visual 3D: PULADO (--skip-floor3d)");
} else {
  console.log(`\n[4/4] piso visual 3D (node e2e/capture.mjs --floor-only --view 3d @360/768/1280/1440):`);
  const res = spawnSync(process.execPath, [join(ROOT, "e2e", "capture.mjs"), "--floor-only", "--view", "3d", "--port", String(floorPort + 1)], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  if (res.error) {
    violations.push(`piso 3D: nao conseguiu executar capture.mjs (${res.error.message})`);
  } else if (res.status !== 0) {
    violations.push(`piso visual 3D: ${res.status === 1 ? "violacoes listadas acima" : `capture.mjs saiu com code ${res.status}`}`);
  }
}

console.log("\n== RESULTADO ==");
if (violations.length) {
  console.error(`ACCEPTANCE: FALHOU - ${violations.length} check(s) com violacao:`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log("ACCEPTANCE: OK - todos os checks passaram");
