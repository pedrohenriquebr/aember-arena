// SPDX-License-Identifier: AGPL-3.0-only
// Derived from keyteki card scripts (copyright keyteki contributors, AGPL-3.0).
// keyteki → DSL v12 converter CLI (docs/KEYTEKI_CONVERSION_PLAN.md, M1 skeleton).
//
//   npm run keyteki:convert -- --set 01-Core [--limit N] [--src <keyteki clone>] [--only anger]
//
// Writes scripts/harvest/keyteki-convert-<set>.json (gitignored): the drafts
// (`source: "keyteki"`, unreviewed), the coverage report and the golden diffs.
// Runs under vite-node: it imports validateDraft/parseCardText from src/lib.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DSL_VERSION } from "../../src/lib/abilities";
import { validateDraft } from "../../src/lib/catalogLlm";
import { parseCardText } from "../../src/lib/cardText";
import { isCLayer, lowerCard } from "./lower.mjs";
import { Unsupported } from "./lambdas.mjs";
import { facesOf, indexCorpus, loadPacks } from "./join.mjs";
import { parseCardFile } from "./parse.mjs";
import { runDump } from "./dump.mjs";
import { setEnabled } from "./lambdaMap.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = JSON.parse(readFileSync(resolve(ROOT, "scripts/keyteki/SOURCE.json"), "utf8"));
const args = process.argv.slice(2);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

/** Canonical form for the golden diff: sorted keys, abilities sorted by their JSON. */
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
/** `on` is a set ("Play/Fight/Reap"); `acts` order is kept unless `loose` (diff triage: same acts in another order). */
const canon = (list, loose = false) =>
  (list ?? [])
    .map((x) => {
      const c = sortKeys(x);
      if (Array.isArray(c.on)) c.on = [...c.on].sort();
      if (loose && Array.isArray(c.acts)) c.acts = c.acts.map((a) => JSON.stringify(a)).sort();
      return JSON.stringify(c);
    })
    .sort();

function bump(map, key, example) {
  const slot = map[key] ?? { n: 0, examples: [] };
  slot.n += 1;
  if (slot.examples.length < 4) slot.examples.push(example);
  map[key] = slot;
}

/** Numeric report fields summed across sets (--all); golden is one level deeper. */
function addReports(into, r) {
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === "number") into[k] = (into[k] ?? 0) + v;
    else if (v && typeof v === "object") addReports((into[k] ??= {}), v);
  }
}

function main() {
  if (args.includes("--baseline")) setEnabled(false);
  const dump = value("--dump");
  if (dump) {
    const src = value("--src") ?? SOURCE.defaultSrc;
    const root = resolve(src, "server/game/cards");
    const sets = args.includes("--all") ? readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [value("--set") ?? "01-Core"];
    runDump(dump, { sets, src, root: ROOT });
    return;
  }
  const src = value("--src") ?? SOURCE.defaultSrc;
  const packs = loadPacks(ROOT);
  const corpus = indexCorpus(JSON.parse(readFileSync(resolve(ROOT, "scripts/harvest/cards-corpus.json"), "utf8")));
  if (args.includes("--all")) {
    const sets = readdirSync(resolve(src, "server/game/cards"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    const total = {};
    for (const set of sets) addReports(total, convertSet(set, src, packs, corpus, { quiet: true, write: !args.includes("--baseline") }));
    console.log(JSON.stringify({ sets: sets.length, ...total }, null, 1));
    return;
  }
  const set = value("--set");
  if (!set) throw new Error("usage: keyteki:convert -- --set <01-Core> | --all [--baseline] [--limit N] [--src <clone>] [--only <slug>]");
  convertSet(set, src, packs, corpus, { quiet: false, write: true });
}

function convertSet(set, src, packs, corpus, { quiet, write }) {
  const dir = resolve(src, "server/game/cards", set);
  const limit = Number(value("--limit") ?? Infinity);
  const only = value("--only");

  const files = readdirSync(dir).filter((f) => f.endsWith(".js")).sort().slice(0, limit);
  const model = `keyteki-ast@${SOURCE.commit.slice(0, 7)}`;
  const report = { set, files: 0, parseErrors: 0, noAbilities: 0, cLayer: 0, unsupported: 0, lowered: 0, noMatch: 0, noPack: 0, noText: 0, noFace: 0, noTextMatch: 0, converted: 0, viaLambdaMap: 0, viaTable: 0, rows: 0, gateFail: 0, golden: { eligible: 0, agree: 0, diff: 0, orderOnly: 0, newlyCovered: 0 } };
  const unsupportedBy = {};
  const cLayerBy = {};
  const gateFailBy = {};
  const diffs = [];
  const rows = [];

  for (const file of files) {
    const ir = (() => {
      try {
        return parseCardFile(resolve(dir, file));
      } catch (e) {
        report.parseErrors += 1;
        return null;
      }
    })();
    if (!ir) continue;
    if (only && ir.id !== only) continue;
    report.files += 1;
    let lowered;
    try {
      lowered = lowerCard(ir);
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      if (isCLayer(e.code)) {
        report.cLayer += 1;
        bump(cLayerBy, e.code, `${ir.id}: ${e.detail}`);
      } else {
        report.unsupported += 1;
        bump(unsupportedBy, e.detail ? `${e.code}:${e.detail}` : e.code, ir.id);
      }
      continue;
    }
    if (!lowered.abilities.length && !lowered.effects.length) {
      report.noAbilities += 1;
      continue;
    }
    report.lowered += 1;
    const { faces, why } = facesOf(ir.id, ir.header, packs, corpus);
    if (!faces.length) {
      report.noMatch += 1;
      report[why] += 1;
      continue;
    }
    let any = false;
    for (const face of faces) {
      const parsed = parseCardText(face);
      const result = validateDraft(face, { abilities: lowered.abilities, effects: lowered.effects, keywords: parsed.keywords }, "llm", model);
      if (!result.ok) {
        report.gateFail += 1;
        bump(gateFailBy, String(result.reason).slice(0, 90), `${ir.id}/${face.id}`);
        continue;
      }
      any = true;
      rows.push({ ...result.row, source: "keyteki", reviewed: false, generatedAt: 0, v: DSL_VERSION, model });
      if (parsed.coverage === "full") {
        report.golden.eligible += 1;
        const same = JSON.stringify(canon(parsed.abilities)) === JSON.stringify(canon(lowered.abilities)) && JSON.stringify(canon(parsed.effects)) === JSON.stringify(canon(lowered.effects));
        if (same) report.golden.agree += 1;
        else {
          report.golden.diff += 1;
          const order = JSON.stringify(canon(parsed.abilities, true)) === JSON.stringify(canon(lowered.abilities, true)) && JSON.stringify(canon(parsed.effects)) === JSON.stringify(canon(lowered.effects));
          if (order) report.golden.orderOnly += 1;
          diffs.push({ kind: order ? "order-only" : "semantic", card: ir.id, title: face.title, text: face.text, parser: { abilities: parsed.abilities, effects: parsed.effects }, keyteki: lowered });
        }
      } else report.golden.newlyCovered += 1;
    }
    if (any) {
      report.converted += 1;
      // A card counts under the lambda-map when ANY of its lambdas came from there; otherwise under the tables.
      if (lowered.via.map > 0) report.viaLambdaMap += 1;
      else if (lowered.via.table > 0) report.viaTable += 1;
    }
  }
  report.rows = rows.length;

  const out = resolve(ROOT, `scripts/harvest/keyteki-convert-${set}.json`);
  if (write) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ meta: { set, commit: SOURCE.commit, v: DSL_VERSION, corpus: corpus.size }, report, unsupportedBy, cLayerBy, gateFailBy, diffs, rows }, null, 1));
  }
  if (quiet) return report;

  console.log(JSON.stringify(report, null, 1));
  const top = (m) => Object.entries(m).sort((a, b) => b[1].n - a[1].n).slice(0, 25).map(([k, v]) => `  ${String(v.n).padStart(4)}  ${k}   e.g. ${v.examples.slice(0, 2).join(", ")}`).join("\n");
  console.log("\nUnsupported (motivo):\n" + top(unsupportedBy));
  console.log("\nC-layer:\n" + top(cLayerBy));
  console.log("\nGate fail:\n" + top(gateFailBy));
  console.log(`\n→ ${out}`);
  return report;
}

main();
