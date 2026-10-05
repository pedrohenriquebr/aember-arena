// SPDX-License-Identifier: AGPL-3.0-only
// Exporta o catálogo de cartas direto da API do Vault para o harvest build-time
// (sem IndexedDB/browser): anda as páginas de decks mais recentes e grava as
// CardFace únicas em scripts/harvest/cards-mv.json.
//
//   npm run harvest:cards            # 25 páginas (padrão)
//   node --run via vite-node: npm run harvest:cards -- --pages 40 --out outro.json
//
// Executa com vite-node (resolve os .ts do app): `npm run harvest:cards`.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fetchCardPage } from "../src/lib/keyforgeApi";

const args = process.argv.slice(2);
const value = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const PAGES = Number(value("--pages") ?? 25);
const OUT = value("--out") ?? "scripts/harvest/cards-mv.json";

const seen = new Map();
let page = 1;
const ALL = args.includes("--all"); // anda até convergir (corpus completo), não por N páginas
const OUT_ALL = resolve(dirname(OUT), "cards-full-progress.json");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Pacing educado: o MV bloqueia (vault.status) quando a varredura martela.
const PAGE_DELAY_MS = ALL ? 3500 : 250;
let stale = 0;
const STALE_LIMIT = 10; // páginas seguidas sem carta nova = corpus coberto
if (ALL) {
  // Retomada: o progresso (página + ids já vistos) sobrevive a crash/bloqueio.
  try {
    const progress = JSON.parse(readFileSync(OUT_ALL, "utf8"));
    for (const card of progress.cards ?? []) seen.set(card.id, card);
    page = Math.max(1, progress.page ?? 1);
    console.log(`retomando: página ${page}, ${seen.size} cartas já vistas`);
  } catch { /* primeira rodada */ }
}
for (let run = 0; ALL ? Number.POSITIVE_INFINITY : run < PAGES; run += 1) {
  let result;
  let attempts = 0;
  let blocked = false;
  for (;;) {
    try {
      result = await fetchCardPage({ page });
      break;
    } catch (error) {
      attempts += 1;
      // Bloqueio do MV dura minutos a horas: em --all aborta preservando o
      // cursor (rodar de novo mais tarde retoma daqui); no modo páginas, pula.
      if (attempts > (ALL ? 5 : 3)) {
        console.error(`página ${page} falhou ${attempts - 1}× (${error instanceof Error ? error.message : error}); ${ALL ? "abortando com progresso preservado" : "pulando"}`);
        result = undefined;
        blocked = true;
        break;
      }
      const wait = 60000 * attempts;
      console.error(`página ${page} falhou (${error instanceof Error ? error.message : error}); aguardando ${wait / 60000}min antes de repetir`);
      await sleep(wait);
    }
  }
  if (blocked && ALL) break; // cursor fica na página bloqueada — retomada depois
  if (result === undefined) {
    if (ALL) {
      writeFileSync(OUT_ALL, `${JSON.stringify({ page: page + 1, cards: [...seen.values()] }, null, 1)}\n`);
      page += 1;
      continue;
    }
    continue;
  }
  if (!result.cards.length) {
    console.log(`página ${page} vazia — fim da lista`);
    break;
  }
  const fresh = result.cards.filter((card) => !seen.has(card.id));
  for (const card of fresh) seen.set(card.id, card);
  console.log(`página ${page}: +${fresh.length}/${result.cards.length} cartas (total único ${seen.size})`);
  if (ALL) {
    // Progresso gravado a cada página: crash/bloqueio não perde o caminho andado.
    writeFileSync(OUT_ALL, `${JSON.stringify({ page: page + 1, cards: [...seen.values()] }, null, 1)}\n`);
    stale = fresh.length === 0 ? stale + 1 : 0;
    if (stale >= STALE_LIMIT) {
      console.log(`${STALE_LIMIT} páginas seguidas sem carta nova — corpus convergiu`);
      break;
    }
  }
  const lastPage = result.count > 0 ? Math.max(1, Math.ceil(result.count / result.pageSize)) : 0;
  if (lastPage && page >= lastPage) break; // sem wrap: repetir a página 1 não traz carta nova
  page += 1;
  await sleep(PAGE_DELAY_MS);
}
writeFileSync(OUT, `${JSON.stringify([...seen.values()], null, 1)}\n`);
console.log(`${seen.size} cartas em ${OUT}`);
