// SPDX-License-Identifier: AGPL-3.0-only
// Exporta o catálogo de cartas direto da API do Vault para o harvest build-time
// (sem IndexedDB/browser): anda as páginas de decks mais recentes e grava as
// CardFace únicas em scripts/harvest/cards-mv.json.
//
//   npm run harvest:cards            # 25 páginas (padrão)
//   node --run via vite-node: npm run harvest:cards -- --pages 40 --out outro.json
//
// Executa com vite-node (resolve os .ts do app): `npm run harvest:cards`.
import { writeFileSync } from "node:fs";
import { fetchCardPage } from "../src/lib/keyforgeApi";

const args = process.argv.slice(2);
const value = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const PAGES = Number(value("--pages") ?? 25);
const OUT = value("--out") ?? "scripts/harvest/cards-mv.json";

const seen = new Map();
let page = 1;
for (let run = 0; run < PAGES; run += 1) {
  let result;
  try {
    result = await fetchCardPage({ page });
  } catch (error) {
    // Página instável (timeout/rede): registra e segue — o export é best-effort.
    console.error(`página ${page} falhou (${error instanceof Error ? error.message : error}); seguindo`);
    page += 1;
    continue;
  }
  if (!result.cards.length) {
    console.log(`página ${page} vazia — fim da lista`);
    break;
  }
  const fresh = result.cards.filter((card) => !seen.has(card.id));
  for (const card of fresh) seen.set(card.id, card);
  console.log(`página ${page}: +${fresh.length}/${result.cards.length} cartas (total único ${seen.size})`);
  const lastPage = result.count > 0 ? Math.max(1, Math.ceil(result.count / result.pageSize)) : 0;
  if (lastPage && page >= lastPage) break; // sem wrap: repetir a página 1 não traz carta nova
  page += 1;
}
writeFileSync(OUT, `${JSON.stringify([...seen.values()], null, 1)}\n`);
console.log(`${seen.size} cartas em ${OUT}`);
