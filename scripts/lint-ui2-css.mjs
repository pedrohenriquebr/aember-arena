// Lint de tokens da v2 (UX_REWRITE_PLAN §5 H-03): nada de cor ou espaço literal em
// src/ui. tokens.css é a única exceção (é ele que define os valores).
// Uso: node scripts/lint-ui2-css.mjs [dir]   (padrão src/ui; sai != 0 se violar)
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(ROOT, process.argv[2] ?? "src/ui");
const EXEMPT = new Set(["tokens.css"]);
const EXTENSIONS = /\.(css|ts|tsx)$/;

if (!existsSync(target)) {
  console.error(`lint-ui2: diretório não existe: ${target}`);
  process.exit(2);
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

// Comentários não contam: o texto explicando "rgba(...)" não é um literal de estilo.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|\s)\/\/.*$/gm, (m) => m.replace(/[^\n]/g, " "));
}

const lineOf = (src, index) => src.slice(0, index).split("\n").length;

// Nome da função que envolve o índice (var, color-mix, ...); "" no nível da declaração.
// Literal dentro de var()/color-mix() é aceito; ao lado de um var() na mesma declaração, não.
function enclosingFn(src, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const c = src[i];
    if (c === ")") depth += 1;
    else if (c === "(") {
      if (depth === 0) return /([\w-]+)$/.exec(src.slice(Math.max(0, i - 24), i))?.[1] ?? "";
      depth -= 1;
    } else if (c === ";" || c === "{" || c === "}") return "";
  }
  return "";
}

// Trecho da declaração (entre ; { }) onde o literal aparece, para o snippet do erro.
function declarationAt(src, index) {
  const before = Math.max(src.lastIndexOf(";", index), src.lastIndexOf("{", index), src.lastIndexOf("}", index));
  const ends = [src.indexOf(";", index), src.indexOf("}", index)].filter((i) => i !== -1);
  const after = ends.length ? Math.min(...ends) : src.length;
  return src.slice(before + 1, after);
}

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGBA = /\brgba?\(/g;
// gap/margin/padding com px que não seja hairline (0/1/2): use var(--space-*).
const SPACING = /\b(gap|margin|padding)[^;{}]*?\b(\d+(?:\.\d+)?)px\b/g;

const violations = [];
const files = walk(target).filter((f) => EXTENSIONS.test(f) && !EXEMPT.has(f.split(/[\\/]/).pop()));

for (const file of files) {
  const src = stripComments(readFileSync(file, "utf8"));
  const where = relative(ROOT, file).replace(/\\/g, "/");
  const report = (index, rule, snippet) => violations.push(`${where}:${lineOf(src, index)}: ${rule} — ${snippet.trim().slice(0, 80)}`);

  for (const m of src.matchAll(HEX)) report(m.index, "cor hex literal (use var(--nf-*))", m[0]);

  for (const m of src.matchAll(RGBA)) {
    if (["var", "color-mix"].includes(enclosingFn(src, m.index))) continue;
    report(m.index, "rgba/rgb literal (use var(--nf-*))", declarationAt(src, m.index));
  }

  if (file.endsWith(".css")) {
    for (const m of src.matchAll(SPACING)) {
      if (["0", "1", "2"].includes(m[2])) continue;
      report(m.index, `${m[1]} px literal (use var(--space-*))`, m[0]);
    }
  }
}

if (violations.length) {
  console.log(violations.join("\n"));
  console.log(`\nlint:ui2 FAIL - ${violations.length} violação(ões) em ${relative(ROOT, target)}`);
  process.exit(1);
}
console.log(`lint:ui2 OK - ${files.length} arquivo(s) em ${relative(ROOT, target)}`);
