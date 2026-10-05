// SPDX-License-Identifier: AGPL-3.0-only
// Derived from keyteki card scripts (copyright keyteki contributors, AGPL-3.0).
// `--dump lambdas|props|reasons` (docs/KEYTEKI_CONVERSION_PLAN.md §1): frequency tables
// that feed the lambda-library (lane G) and the lowering tables (lane M).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { conditionOf, filterOf, selectionOf } from "./lambdas.mjs";
import { canonOf } from "./canon.mjs";
import { parseCardFile } from "./parse.mjs";

export { canonOf };

const EXAMPLES = 4;

/** True when some library entry (filter, condition or selection) takes the lambda. */
function isConverted(fnNode) {
  for (const f of [() => filterOf(fnNode), () => conditionOf(fnNode), () => selectionOf(fnNode.body, fnNode.params[0] ?? "context")]) {
    try {
      if (f()) return true;
    } catch {
      /* try the next recogniser */
    }
  }
  try {
    return conditionOf(fnNode) === null;
  } catch {
    return false;
  }
}

function* walk(n) {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) {
    for (const x of n) yield* walk(x);
    return;
  }
  if (n.t) yield n;
  for (const v of Object.values(n)) if (v && typeof v === "object") yield* walk(v);
}

function tally(map, key, ir, extra) {
  const slot = map.get(key) ?? { canon: key, count: 0, exemplos: [], ...extra };
  slot.count += 1;
  if (slot.exemplos.length < EXAMPLES && !slot.exemplos.some((e) => e.slug === ir.id)) slot.exemplos.push({ slug: ir.id, arquivo: ir.file });
  map.set(key, slot);
}
const ranked = (map) => [...map.values()].sort((a, b) => b.count - a.count || a.canon.localeCompare(b.canon));

/** Literal value as text; anything non-literal collapses to its node kind so shapes group. */
const valueOf = (n) => (n.t === "lit" ? JSON.stringify(n.v) : n.t === "fn" ? "fn" : n.t === "id" || n.t === "member" ? canonOf(n) : n.t);

export function dumpIr(irs) {
  const lambdas = new Map();
  const props = new Map();
  for (const ir of irs) {
    for (const reg of ir.regs) {
      for (const n of walk(reg.args)) {
        if (n.t === "fn") tally(lambdas, canonOf(n), ir, { convertida: isConverted(n) });
        if (n.t === "action" || n.t === "effect") {
          for (const a of n.args) {
            if (a.t !== "obj") continue;
            const shape = Object.keys(a.props).sort().map((k) => `${k}:${valueOf(a.props[k])}`).join(",");
            tally(props, `${n.t}.${n.name}{${shape}}`, ir, { kind: n.t, name: n.name });
          }
        }
      }
    }
  }
  return { lambdas: ranked(lambdas), props: ranked(props) };
}

function reasonsOf(setNames, root) {
  const groups = new Map();
  const files = [];
  for (const set of setNames) {
    const file = resolve(root, `scripts/harvest/keyteki-convert-${set}.json`);
    if (!existsSync(file)) continue;
    files.push(file);
    const data = JSON.parse(readFileSync(file, "utf8"));
    for (const [layer, by] of [["unsupported", data.unsupportedBy], ["cLayer", data.cLayerBy], ["gateFail", data.gateFailBy]]) {
      for (const [reason, v] of Object.entries(by ?? {})) {
        const key = `${layer}|${reason}`;
        const slot = groups.get(key) ?? { canon: reason, layer, count: 0, exemplos: [] };
        slot.count += v.n;
        for (const e of v.examples) if (slot.exemplos.length < EXAMPLES) slot.exemplos.push({ slug: String(e).split(/[:/]/)[0], detalhe: e });
        groups.set(key, slot);
      }
    }
  }
  if (!files.length) throw new Error("--dump reasons: no keyteki-convert-<set>.json found; run keyteki:convert first");
  return ranked(groups);
}

/** Entry point called from convert.mjs. `sets` = set directory names, `src` = keyteki clone. */
export function runDump(kind, { sets, src, root }) {
  const outPath = (k) => resolve(root, `scripts/harvest/keyteki-dump-${k}.json`);
  const save = (k, rows) => {
    mkdirSync(dirname(outPath(k)), { recursive: true });
    writeFileSync(outPath(k), JSON.stringify(rows, null, 1));
    console.log(`${k}: ${rows.length} distinct, ${rows.reduce((s, r) => s + r.count, 0)} total → ${outPath(k)}`);
    return rows;
  };
  if (kind === "reasons") return save("reasons", reasonsOf(sets, root));
  if (kind !== "lambdas" && kind !== "props") throw new Error("--dump expects lambdas|props|reasons");
  const irs = [];
  let files = 0;
  for (const set of sets) {
    const dir = resolve(src, "server/game/cards", set);
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".js")).sort()) {
      files += 1;
      try {
        irs.push(parseCardFile(resolve(dir, f)));
      } catch {
        /* parse errors are counted by the converter run, not here */
      }
    }
  }
  console.log(`${files} files, ${irs.length} parsed (${sets.join(", ")})`);
  const rows = dumpIr(irs)[kind];
  save(kind, rows);
  if (kind === "lambdas") console.log(`converted: ${rows.filter((r) => r.convertida).length} distinct`);
  return rows;
}
