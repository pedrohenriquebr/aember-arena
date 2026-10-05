// SPDX-License-Identifier: AGPL-3.0-only
// Derived from keyteki card scripts (copyright keyteki contributors, AGPL-3.0).
// CLI import of the keyteki converter's approved queue into the app (plano T2,
// 05/out/2026): revalidates every row through the SAME gates as review-auto and
// writes src/lib/generated/keyteki.json — no card text, DSL + hash only. The boot
// (vendoredOverrides) merges it AFTER the user store, so an IndexedDB row always
// wins and no manual import click exists. Idempotent.
//
//   npx vite-node scripts/keyteki/vendor.mjs [--in queue-export-keyteki-approved.json]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dryRunProblem, sanityProblem } from "../../src/lib/catalogLlm";
import { normaliseAbilityOverride } from "../../src/lib/abilities";
import { indexCorpus } from "./join.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../..");
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i > 0 ? args[i + 1] : fallback;
};
const IN = resolve(ROOT, "scripts/harvest", arg("in", "queue-export-keyteki-approved.json"));
const OUT = resolve(ROOT, "src/lib/generated/keyteki.json");

const rows = JSON.parse(readFileSync(IN, "utf8"));
if (!Array.isArray(rows)) throw new Error(`not a queue: ${IN}`);
const corpus = indexCorpus(JSON.parse(readFileSync(resolve(ROOT, "scripts/harvest/cards-corpus.json"), "utf8")));
const byId = new Map([...corpus.byTitle.values()].flat().map((f) => [f.id, f]));

const kept = [];
const skipped = [];
for (const raw of rows) {
  const row = normaliseAbilityOverride(raw);
  const skip = (why) => skipped.push({ cardId: raw?.cardId ?? "?", why });
  if (!row) { skip("forma inválida"); continue; }
  // F0: vendor só aceita linha revisada; proveniência keyteki-ast é invariante aqui.
  if (row.reviewed !== true) { skip("não revisada (F0)"); continue; }
  if (row.source !== "keyteki" || !String(row.model ?? "").startsWith("keyteki-ast@")) { skip(`proveniência ${row.source}/${row.model}`); continue; }
  const face = byId.get(row.cardId);
  if (!face) { skip("carta ausente no corpus"); continue; }
  const problem = sanityProblem(face, row) ?? dryRunProblem(face, row);
  if (problem) { skip(problem); continue; }
  kept.push({ ...row, reviewed: true });
}
// Nenhum texto de carta viaja no artefato (mesma higiene do approved.json do farm).
kept.sort((a, b) => (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0));
writeFileSync(OUT, JSON.stringify(kept, null, 1) + "\n");
console.log(JSON.stringify({ in: rows.length, vendored: kept.length, skipped, out: OUT }, null, 1));
if (skipped.length) process.exitCode = 1;
