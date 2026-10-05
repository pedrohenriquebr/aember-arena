// SPDX-License-Identifier: AGPL-3.0-only
// Derived from keyteki card scripts (copyright keyteki contributors, AGPL-3.0).
// keyteki → DSL v12 converter CLI (docs/KEYTEKI_CONVERSION_PLAN.md, M1 skeleton).
//
//   npm run keyteki:convert -- --set 01-Core [--limit N] [--src <keyteki clone>] [--only anger]
//
// Writes scripts/harvest/keyteki-convert-<set>.json (gitignored): the drafts
// (`source: "keyteki"`, unreviewed), the coverage report and the golden diffs.
// Runs under vite-node: it imports validateDraft/parseCardText from src/lib.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DSL_VERSION } from "../../src/lib/abilities";
import { validateDraft } from "../../src/lib/catalogLlm";
import { parseCardText } from "../../src/lib/cardText";
import { isCLayer, lowerCard } from "./lower.mjs";
import { Unsupported } from "./lambdas.mjs";
import { parseCardFile } from "./parse.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = JSON.parse(readFileSync(resolve(ROOT, "scripts/keyteki/SOURCE.json"), "utf8"));
const args = process.argv.slice(2);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** slug → { names, keys:"exp_number" } from keyteki-json-data (.kfdata-tmp/packs). */
function loadPacks() {
  const dir = resolve(ROOT, ".kfdata-tmp/packs");
  const slugs = new Map();
  if (!existsSync(dir)) return slugs;
  for (const file of readdirSync(dir)) {
    const pack = JSON.parse(readFileSync(resolve(dir, file), "utf8"));
    for (const card of pack.cards ?? []) {
      const entry = slugs.get(card.id) ?? { names: new Set(), keys: new Set() };
      entry.names.add(norm(card.name));
      entry.keys.add(`${card.expansion}_${card.number}`);
      slugs.set(card.id, entry);
    }
  }
  return slugs;
}

/** Corpus faces indexed by "<expansion>_<number>" (from the image URL) and by title. */
function loadCorpus() {
  const faces = JSON.parse(readFileSync(resolve(ROOT, "scripts/harvest/cards-corpus.json"), "utf8"));
  const byKey = new Map();
  const byTitle = new Map();
  const push = (map, key, face) => map.set(key, [...(map.get(key) ?? []), face]);
  for (const face of faces) {
    const m = /\/(\d+)_(\d+)_/.exec(face.image ?? "");
    if (m) push(byKey, `${m[1]}_${m[2]}`, face);
    push(byTitle, norm(face.title), face);
  }
  return { byKey, byTitle, size: faces.length };
}

function facesOf(slug, packs, corpus) {
  const entry = packs.get(slug);
  if (!entry) return null;
  const found = new Map();
  for (const key of entry.keys) for (const f of corpus.byKey.get(key) ?? []) found.set(f.id, f);
  for (const name of entry.names) for (const f of corpus.byTitle.get(name) ?? []) found.set(f.id, f);
  return [...found.values()];
}

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

function main() {
  const set = value("--set");
  if (!set) throw new Error("usage: keyteki:convert -- --set <01-Core> [--limit N] [--src <clone>] [--only <slug>]");
  const src = value("--src") ?? SOURCE.defaultSrc;
  const dir = resolve(src, "server/game/cards", set);
  const limit = Number(value("--limit") ?? Infinity);
  const only = value("--only");
  const packs = loadPacks();
  const corpus = loadCorpus();

  const files = readdirSync(dir).filter((f) => f.endsWith(".js")).sort().slice(0, limit);
  const model = `keyteki-ast@${SOURCE.commit.slice(0, 7)}`;
  const report = { set, files: 0, parseErrors: 0, noAbilities: 0, cLayer: 0, unsupported: 0, lowered: 0, noMatch: 0, noPack: 0, converted: 0, rows: 0, gateFail: 0, golden: { eligible: 0, agree: 0, diff: 0, orderOnly: 0, newlyCovered: 0 } };
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
    const faces = facesOf(ir.id, packs, corpus);
    if (faces === null) report.noPack += 1;
    if (!faces?.length) {
      report.noMatch += 1;
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
    if (any) report.converted += 1;
  }
  report.rows = rows.length;

  const out = resolve(ROOT, `scripts/harvest/keyteki-convert-${set}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ meta: { set, commit: SOURCE.commit, v: DSL_VERSION, corpus: corpus.size }, report, unsupportedBy, cLayerBy, gateFailBy, diffs, rows }, null, 1));

  console.log(JSON.stringify(report, null, 1));
  const top = (m) => Object.entries(m).sort((a, b) => b[1].n - a[1].n).slice(0, 25).map(([k, v]) => `  ${String(v.n).padStart(4)}  ${k}   e.g. ${v.examples.slice(0, 2).join(", ")}`).join("\n");
  console.log("\nUnsupported (motivo):\n" + top(unsupportedBy));
  console.log("\nC-layer:\n" + top(cLayerBy));
  console.log("\nGate fail:\n" + top(gateFailBy));
  console.log(`\n→ ${out}`);
}

main();
