// SPDX-License-Identifier: AGPL-3.0-only
// Derived from keyteki card scripts (copyright keyteki contributors, AGPL-3.0).
// Auto-review of the keyteki converter's queue export (docs/KEYTEKI_CONVERSION_PLAN.md,
// pós-M3). The owner delegated the human review to this gate (05/out/2026): a row is
// approved ONLY when it passes every gate the app runs on import, plus the engine
// dry-run and the provenance invariant. Anything else stays unapproved with its reason.
//
//   npx vite-node scripts/keyteki/review-auto.mjs [--in queue-export-keyteki.json] [--out queue-export-keyteki-approved.json]
//
// The approved file keeps source:"keyteki" (never renamed) and flips reviewed:true —
// the app's import applies reviewed rows directly as rules (LlmSettings.importQueue).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dryRunProblem, sanityProblem, validateQueueRows } from "../../src/lib/catalogLlm";
import { indexCorpus } from "./join.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf("--" + name);
  return i > 0 ? args[i + 1] : fallback;
};
const args = process.argv.slice(2);
const IN = resolve(ROOT, "scripts/harvest", arg("in", "queue-export-keyteki.json"));
const OUT = resolve(ROOT, "scripts/harvest", arg("out", "queue-export-keyteki-approved.json"));

const rows = JSON.parse(readFileSync(IN, "utf8"));
if (!Array.isArray(rows)) throw new Error(`not a queue: ${IN}`);
const corpus = indexCorpus(JSON.parse(readFileSync(resolve(ROOT, "scripts/harvest/cards-corpus.json"), "utf8")));
const faces = [...corpus.byTitle.values()].flat();
const byId = new Map(faces.map((f) => [f.id, f]));

// Gate 1 — the exact import gate the app runs (shape, source, hash, unknownCard, version).
const { valid, rejected } = validateQueueRows(rows, faces);

const approved = [];
const failed = [];
for (const row of valid) {
  const face = byId.get(row.cardId);
  const reject = (stage, problem) => failed.push({ cardId: row.cardId, title: face?.title ?? "?", stage, problem: String(problem).slice(0, 200) });
  // Gate 2 — provenance: converter rows only; a hand-edited file cannot smuggle reviewed rows in.
  if (row.source !== "keyteki" || !String(row.model ?? "").startsWith("keyteki-ast@")) { reject("provenance", `source=${row.source} model=${row.model}`); continue; }
  // Gate 3 — semantic invariants against the printed text (triggers named, acts sane).
  const sanity = sanityProblem(face, row);
  if (sanity) { reject("sanity", sanity); continue; }
  // Gate 4 — the engine itself reads the draft and exercises it (hand + board).
  const dry = dryRunProblem(face, row);
  if (dry) { reject("dry-run", dry); continue; }
  approved.push({ ...row, reviewed: true });
}

const preApproved = rows.filter((r) => r.reviewed).length;
writeFileSync(OUT, JSON.stringify(approved, null, 1) + "\n");
console.log(JSON.stringify({
  in: rows.length,
  shapeRejected: rejected.map((r) => r.reason),
  approved: approved.length,
  failed: failed.length,
  failures: failed,
  out: OUT,
  note: preApproved ? `${preApproved} row(s) arrived already reviewed — re-run convert --export-queue for unreviewed input` : undefined,
}, null, 1));
if (failed.length) process.exitCode = 1;
