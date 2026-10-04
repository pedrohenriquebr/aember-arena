// SPDX-License-Identifier: AGPL-3.0-only
// Une o corpus do MV (cards-mv.json) com o keyteki (cards-keyteki.json) em um
// corpus único para o farm: TODOS os ids do MV + as cartas do keyteki cujo
// textHash nenhum id do MV cobre (dedupe por texto, que é o que o farm traduz).
//
//   npm run merge:cards     → scripts/harvest/cards-corpus.json
//
// Executa com vite-node (resolve os .ts do app): `npm run merge:cards`.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { textHash } from "../src/lib/cardText";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const load = (f) => JSON.parse(readFileSync(resolve(ROOT, "scripts/harvest", f), "utf8"));

const mv = load("cards-mv.json");
const kt = load("cards-keyteki.json");
const mvHashes = new Set(mv.filter((c) => c.text).map((c) => textHash(c.text)));
const ktHashes = new Set();
const extra = [];
for (const card of kt) {
  if (!card.text) continue;
  const hash = textHash(card.text);
  if (mvHashes.has(hash) || ktHashes.has(hash)) continue;
  ktHashes.add(hash);
  extra.push(card);
}
const corpus = [...mv, ...extra];
writeFileSync(resolve(ROOT, "scripts/harvest/cards-corpus.json"), `${JSON.stringify(corpus, null, 1)}\n`);
const bySet = {};
for (const card of extra) bySet[card.set ?? "?"] = (bySet[card.set ?? "?"] ?? 0) + 1;
console.log(`MV: ${mv.length} ids (${mvHashes.size} hashes) | keyteki: +${extra.length} textos novos | corpus: ${corpus.length} cartas`);
console.log("novos por set:", bySet);
