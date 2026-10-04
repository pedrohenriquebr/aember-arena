// SPDX-License-Identifier: AGPL-3.0-only
// Harvest build-time do catálogo dinâmico (docs/DYNAMIC_CATALOG_PLAN.md §4, "modo
// build-time"). Roda o pipeline fora do navegador sobre um export do catálogo.
//
//   npm run harvest -- --cards cards.json            # só mede: cobertura da gramática
//   npm run harvest -- --cards cards.json --llm      # + rascunhos via LLM (chave no env)
//   npm run harvest -- --vendor                      # grava só o que o dono APROVOU
//   npm run harvest -- --export-queue                # drafts.json -> queue-export.json (importar no app)
//
// --cards: JSON com um array de CardFace (o catálogo sincronizado exportado do
//   navegador); sem ele, usa as cartas dos dois decks demo.
// --llm: HARVEST_LLM_KEY (obrigatória), HARVEST_LLM_BASE (padrão OpenAI) e
//   HARVEST_LLM_MODEL. Os rascunhos vão para scripts/harvest/drafts.json
//   (fora do bundle, gitignored — contém texto de carta). Nada entra no bundle aqui.
// --vendor: lê drafts.json e copia para src/lib/generated/approved.json SÓ as linhas
//   com "reviewed": true (o dono aprova editando o arquivo ou pela fila do app),
//   revalidadas na porta de forma. A linha vendorizada não carrega texto de carta.
// Executa com vite-node (resolve os .ts do app): `npm run harvest`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseAbilityOverride } from "../src/lib/abilities";
import { exportableRows, pendingTranslations, runTranslation, translationTries } from "../src/lib/catalogLlm";
import { parseCardText, textHash } from "../src/lib/cardText";
import { DEMO_DECK } from "../src/lib/demoDeck";
import { DEMO_DECK_2 } from "../src/lib/demoDeck2";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DRAFTS = resolve(ROOT, "scripts/harvest/drafts.json");
const QUEUE_EXPORT = resolve(ROOT, "scripts/harvest/queue-export.json");
const APPROVED = resolve(ROOT, "src/lib/generated/approved.json");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

function demoCards() {
  const unique = new Map();
  for (const card of [...DEMO_DECK.cards, ...DEMO_DECK_2.cards]) unique.set(card.id, card);
  return [...unique.values()];
}

/** `--cards` is always united with the demo decks (Lote 6 §6.0): the demo's
    orphans never re-enter a harvest that only passes the Master Vault export. */
function loadCards() {
  const file = value("--cards");
  const unique = new Map(demoCards().map((card) => [card.id, card]));
  if (file) {
    for (const card of JSON.parse(readFileSync(resolve(file), "utf8"))) unique.set(card.id, card);
  }
  return [...unique.values()];
}

function readDrafts() {
  return existsSync(DRAFTS) ? JSON.parse(readFileSync(DRAFTS, "utf8")) : [];
}

function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 1)}\n`);
}

/** Cobertura da gramática sobre o catálogo (sem LLM, sem rede). */
function measure(cards) {
  const tally = { full: 0, partial: 0, vanilla: 0 };
  for (const card of cards) tally[parseCardText(card).coverage] += 1;
  const total = cards.length || 1;
  console.log(`cartas: ${cards.length}`);
  for (const [name, count] of Object.entries(tally)) console.log(`  ${name.padEnd(8)} ${String(count).padStart(6)}  ${((count / total) * 100).toFixed(1)}%`);
  return tally;
}

async function harvestLlm(cards) {
  const apiKey = process.env.HARVEST_LLM_KEY;
  if (!apiKey) {
    console.error("harvest --llm: defina HARVEST_LLM_KEY (e opcionalmente HARVEST_LLM_BASE / HARVEST_LLM_MODEL).");
    process.exit(2);
  }
  const config = {
    preset: "custom",
    apiKey,
    baseUrl: process.env.HARVEST_LLM_BASE ?? "https://api.openai.com/v1",
    model: process.env.HARVEST_LLM_MODEL ?? "gpt-4o-mini",
  };
  const rows = new Map(readDrafts().map((row) => [row.cardId, row]));
  const waiting = pendingTranslations(cards, (id) => rows.get(id));
  const limit = Number(value("--limit") ?? 25);
  console.log(`LLM: ${waiting.length} cartas esperando, rodando até ${limit}`);
  try {
    await runTranslation(waiting, config, {
      limit,
      // Chamadas em paralelo ao provedor (padrão 2 = max_concurrency do proxy).
      concurrency: Number(value("--concurrency") ?? process.env.HARVEST_CONCURRENCY ?? 2),
      // `reply:` é re-tentado: a linha carrega quantas tentativas já gastou (§4.0).
      previous: (id) => translationTries(rows.get(id)),
      save: async (row) => {
        rows.set(row.cardId, row);
        writeJson(DRAFTS, [...rows.values()]);
      },
      onProgress: (p) => process.stdout.write(`\r${p.done}/${p.total} (rascunhos ${p.drafted}, falhas ${p.failed})`),
    });
    console.log(`\nrascunhos em ${DRAFTS} — revise e marque "reviewed": true no que aprovar.`);
  } catch (error) {
    // A chave nunca aparece: o erro do pipeline já vem redigido (VaultError, chave llm.*).
    // A mensagem importa: erros de transporte (llm.timeout/http/...) eram invisíveis
    // quando a rodada morria numa chamada via pipe (o diagnóstico do Opus-low).
    console.error(`\nharvest interrompido: ${error?.key ?? "erro"}${error?.message ? ` — ${error.message}` : ""}`);
    process.exit(1);
  }
}

/** Só o aprovado entra: revalida cada linha e remove qualquer vestígio de texto. */
function vendor() {
  const kept = [];
  for (const draft of readDrafts()) {
    if (draft.reviewed !== true || draft.failure) continue;
    const row = normaliseAbilityOverride(draft);
    if (!row) {
      console.warn(`ignorada (forma inválida): ${draft.cardId}`);
      continue;
    }
    kept.push({ ...row, reviewed: true });
  }
  writeJson(APPROVED, kept);
  console.log(`vendorizadas ${kept.length} linhas aprovadas em src/lib/generated/approved.json`);
}

/** Exporta a fila atual para o app importar (Config > Revisão). Idempotente.
    Uma falha cujo texto o parser cobre hoje é linha-zumbi e não vai junto
    (higiene do pipeline, §4.0). */
function exportQueue() {
  const drafts = readDrafts();
  const rows = exportableRows(drafts, loadCards());
  const pruned = drafts.length - rows.length;
  writeJson(QUEUE_EXPORT, rows);
  console.log(`exportadas ${rows.length} linhas em ${QUEUE_EXPORT}${pruned ? ` (${pruned} zumbis podados)` : ""} — importe pela Config do app.`);
}

if (flag("--export-queue")) {
  exportQueue();
} else if (flag("--vendor")) {
  vendor();
} else {
  const cards = loadCards();
  measure(cards);
  const gaps = cards.filter((card) => parseCardText(card).coverage !== "full" && card.text?.trim());
  console.log(`candidatas à tradução: ${gaps.length} (hash de exemplo: ${gaps[0] ? textHash(gaps[0].text) : "-"})`);
  if (flag("--llm")) await harvestLlm(cards);
}
