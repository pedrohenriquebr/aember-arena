#!/usr/bin/env node
// Lane M: classifica lambdas pendentes do dump keyteki no nosso Count/Condition via LLM (relay local).
// Uso: node scripts/keyteki/classify.mjs [--top 150] [--batch 25] [--url ...] [--model ...]
// Retomável: lambdas já presentes em lambda-map.json (inclusive null) são puladas.
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DUMP = resolve(here, "../harvest/keyteki-dump-lambdas.json");
const DATA = resolve(here, "patterns/data");
const OUT = resolve(DATA, "lambda-map.json");
const FAILS = resolve(DATA, "lambda-map.failed.json");

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : d; };
const TOP = +arg("top", 150), BATCH = +arg("batch", 25);
const URL = arg("url", "http://127.0.0.1:47815/v1/chat/completions");
const MODEL = arg("model", "mimo-v2.6-pro");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const load = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : d);
const save = (p, o) => { writeFileSync(p + ".tmp", JSON.stringify(o, null, 1)); renameSync(p + ".tmp", p); };

const counts = load(resolve(DATA, "counts.json"), { familias: [] }).familias;
const conds = load(resolve(DATA, "conditions.json"), { familias: [] }).familias;
const fam = (f) => `${f["canon-exemplo"]}  =>  ${f.mapeamento === null ? "null" : f.mapeamento}${f.notas ? "   // " + String(f.notas).slice(0, 160) : ""}`;

const SYSTEM = `Você classifica lambdas JS do keyteki (jogo KeyForge) no vocabulário Count/Condition do nosso motor declarativo.

Vocabulário (TypeScript):
type Zone = "hand"|"deck"|"discard"|"archives"|"purged";
Filter = { type?: "Creature"|"Artifact"|"Upgrade"|"!Upgrade"; side?: "friendly"|"enemy"; damaged?, flank?, other?, ready?, exhausted?, amber?: boolean; counters?: boolean|string; powerMin?, powerMax?: number; weaker?, stronger?, self?, host?, neighborsOfSource?, leftOf?, rightOf?: boolean; house?: string (prefixo ! nega); trait?: string; top?, least?, most?: number }
type Count = "did"|"gone"|"healed" | {slain: Filter} | {gone: Filter} | {c: Filter}
  | {p: Zone|"keys"|"amber"|"plays"|"keyColors"; opp?: boolean; any?: boolean; div?: number}
  | {of: "damage"|"amber"|"power"|"counters"; s: Selection; name?: string}
  | {m: "cards"|"icons"|"power"; house?: string; type?: string}
  | {sub: [Count, Count|number]} | {housesOf: "moved"};
type Condition = {k:"amber"; opp:boolean; op:"eq"|"gte"; n:number} | {k:"moreCreatures"} | {k:"fewerCreatures"}
  | {k:"count"; of: Count; op:"eq"|"gte"|"lte"|"even"|"odd"; n:number} | {k:"forged"; opp?:boolean} | {k:"myTurn"} | {k:"actor"; opp?:boolean}
  | {k:"key"; color:"red"|"yellow"|"blue"; opp?:boolean; any?:boolean} | {k:"not"; c: Condition};
Não existe comparação entre dois contadores dinâmicos, nem leitura de estado arbitrário (ex.: this.game.*, eventos genéricos) fora do acima.

Exemplos de famílias já mapeadas (lambda canon => mapeamento):
${counts.map(fam).join("\n")}
${conds.map(fam).join("\n")}

Tarefa: para cada lambda recebida, dê o Count ou Condition JSON equivalente, escrito como STRING JSON válida (sem "?" nem "..."), ou null se não for representável fielmente (seja conservador: na dúvida, null). Lambdas que são só constantes/gates sem leitura de estado (ex.: ()=>true) são null.
Responda SÓ com um JSON array, sem markdown: [{"canon": "<igual ao recebido>", "mapeamento": "<string JSON>" | null, "notas": "<curto>"}], um item por lambda, na mesma ordem.`;

async function ask(batch) {
  const user = "Lambdas:\n" + JSON.stringify(batch.map((l) => l.canon), null, 0);
  let lastErr;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer local" },
        body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: 4096, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }] }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      let txt = j.choices?.[0]?.message?.content ?? "";
      txt = txt.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
      const a0 = txt.indexOf("["), a1 = txt.lastIndexOf("]");
      const arr = JSON.parse(txt.slice(a0, a1 + 1));
      if (!Array.isArray(arr)) throw new Error("resposta não é array");
      return { arr };
    } catch (e) {
      lastErr = e;
      if (a < 2) { process.stderr.write(`\n  falha (${e.message}); retry em 30s\n`); await sleep(30000); }
    }
  }
  return { err: lastErr };
}

const validMap = (m) => { if (m === null) return true; if (typeof m !== "string") return false; try { const o = JSON.parse(m); return o && typeof o === "object"; } catch { return false; } };

const dump = JSON.parse(readFileSync(DUMP, "utf8"));
const pend = dump.filter((l) => !l.convertida).sort((a, b) => b.count - a.count).slice(0, TOP);
const map = load(OUT, {});
const todo = pend.filter((l) => !(l.canon in map));
const failed = load(FAILS, {});
let consecutive = 0, done = 0;
process.stderr.write(`pendentes alvo: ${pend.length}, a fazer: ${todo.length}\n`);

for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  const { arr, err } = await ask(batch);
  if (err) {
    consecutive++;
    for (const l of batch) failed[l.canon] = err.message;
    save(FAILS, failed);
    process.stderr.write(`\nlote falhou 3×: ${err.message}\n`);
    if (consecutive >= 1) { process.stderr.write("relay falhou 3× seguidas — parando (rede?).\n"); process.exit(2); }
  }
  consecutive = 0;
  const byCanon = new Map(arr.map((x) => [x?.canon, x]));
  batch.forEach((l, k) => {
    const x = byCanon.get(l.canon) ?? (arr.length === batch.length ? arr[k] : undefined);
    if (!x || !("mapeamento" in x) || !validMap(x.mapeamento)) { failed[l.canon] = "item ausente/inválido"; return; }
    map[l.canon] = x.mapeamento === null ? null : { mapeamento: x.mapeamento, notas: x.notas ?? "" };
    delete failed[l.canon];
  });
  save(OUT, map); save(FAILS, failed);
  done += batch.length;
  const w = 30, f = Math.round((done / todo.length) * w);
  process.stderr.write(`\r[${"#".repeat(f)}${".".repeat(w - f)}] ${done}/${todo.length}`);
}
process.stderr.write("\n");

// relatório
let ok = 0, nul = 0, fail = 0, usosOk = 0;
for (const l of pend) {
  if (l.canon in map) { if (map[l.canon]) { ok++; usosOk += l.count; } else nul++; } else fail++;
}
const tot = pend.reduce((s, l) => s + l.count, 0);
console.log(JSON.stringify({ alvo: pend.length, comMapeamento: ok, nulls: nul, falhas: fail, usosCobertos: usosOk, usosAlvo: tot }, null, 1));
