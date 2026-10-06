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
import { validateDraft, validateQueueRows } from "../../src/lib/catalogLlm";
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
/** Lote 15b — TRIAGEM DOS SEMANTIC DIFFS (método M3, parecer ao dono):
    [a] bug do conversor/lower corrigido com spec | [b] parser/interpretador
    certo, documentado | [c] equivalente, tratado na normalização abaixo |
    [d] gap de DSL listado.
    • [a] `alwaysTriggers: true` virava `then: true` (GATE) — mas é o ANTI-gate
      do keyteki (ThenAbility.resolveThenIfNeeded: o bloco dispara mesmo com
      zero eventos). lowerThen emite o follow-up SEM `then`/`if: did`. Fechou:
      Edge of the World (6 faces), Nautilus, Massing at Midnight (2), Radix of
      Suffering. Specs: lower-closed.test.mjs + dsl16.test.ts (motor).
    • [a] "non-Star Alliance creature" parseava como traits ("non-star" → trait
      "Star", "alliance" → trait "Alliance" sobrescrevendo): a negação agora
      atravessa o par de palavras da casa → `house: "!Star Alliance"` (Séance
      Scanner). Specs: dsl16.test.ts (parse + motor).
    • [c] `then: true` num ato cuja seleção é a anáfora `moved` é redundante — o
      `moved` já carrega a dependência (seleção vazia = no-op) e o keyteki só
      escreve `then` porque `preThenEvent` vive num bloco then (Arm the
      Plebeians ×2, Request Donations; o print não tem "Then,"). A normalização
      vale para os dois lados, então Cover Operation (com `then` impresso)
      continua AGREE.
    • [b] Spike Trap: print "Destroy Spike Trap" × código `sacrifice()`. Nossa
      regra exposta: sacrifice vai ao descarte do dono SEM a janela Destroyed:
      (MECHANICS_REPORT §2.6) — o parser (`destroy`) é a fonte correta e o
      código keyteki usa SacrificeAction como sinônimo de DestroyAction.
      Divergência texto × código registrada; NÃO se normaliza destroy ≡
      sacrifice (mascararia cartas com Destroyed:).
    • [b] Ragnarok Prep: print "Then, if <cond>, X" (parser mantém o link
      `then: true`, spelling do Lote 15a) × código `then: {alwaysTriggers,
      condition}` (follow-up sem gate). Aqui o gate é imaterial (makeToken nunca
      é vácuo), mas then+if ≠ if quando o ato anterior pode ser vácuo (Radix com
      o oponente em 0 âmbar, onde o `if` sozinho é o comportamento do print) —
      por isso a divergência fica documentada e NÃO normalizada.
    • [d] gaps: nenhum campo novo necessário para os 15. Refinamento futuro
      opcional: o print não denuncia o alwaysTriggers do código, então "Then,"
      condicional e "Then," sequencial puro saem iguais no parser.
    Fora do golden: Key Abduction (`modifier: 9 - hand` = `dynamic:
    forgeKey.modifier`, unsupported). */
/** Lote 15c — triagem dos diffs abertos pelo pacote de tabelas:
    • [a] wurm-tunnel ×3: `target: {mode:'exactly', numCards:1}` virava pick
      engine-auto; a escolha singular do print é o alvo clássico → corrigido em
      targetFilter (spec: lower-closed "exactly 1 is the classic target").
    • [c] mother-northelle / library-of-polliasaurus: "Move 1A from a creature
      to your pool" = supply + gainAmber(if did) no keyteki ≡ `to:"pool"` no
      parser; o `amber: true` do alvo é implicado pelo ato. Normalizado acima.
    Lote 15d — triagem dos diffs do pacote de lasting-effects:
    • [a] kelping-hands ×3: `match` sem targetController é o escopo do LADO que
      resolve no keyteki ("each friendly creature gains poison") → side default
      "friendly" em lastingActOf (spec: lower-closed "carry their window").
    • [c] opposition-research: `who` do restrict já escopa o lado e o reap é
      sempre com criatura do ator — o `e.target` {type:Creature, side:enemy} do
      print é o mesmo escopo. Normalizado no ato lasting (acima).
    • [d] sow-salt: "creatures cannot reap" (keyteki `targetController: 'any'`)
      — `Restrict.who` só tem "you"/"opponent", sem "ambos": o parser aproxima
      para "opponent" e o conversor para "you". Gap listado no relatório 15d. */
/** Same-effect rewrites the parser and keyteki spell differently: abilities with the same body merge their `on`; adjacent identical exalts sum; the `then` link on a `moved`-anaphora act is redundant (Lote 15b, triagem [c]); "to your pool" spelled as supply + gainAmber (Lote 15c, triagem [c]). */
const equivalent = (list) => {
  const merged = new Map();
  for (const a of list ?? []) {
    const { on, ...body } = a;
    const acts = [];
    for (const act of body.acts ?? []) {
      const last = acts[acts.length - 1];
      if (last && act.k === "exalt" && last.k === "exalt" && JSON.stringify({ ...last, n: 0 }) === JSON.stringify({ ...act, n: 0 })) last.n = (last.n ?? 1) + (act.n ?? 1);
      else {
        const copy = { ...act };
        if (copy.then === true && copy.s === "moved") delete copy.then;
        // Lote 15d (triagem [c]): num restrict de "reap" o `who` já escopa o
        // lado e o reap sempre é com uma criatura do ator — o print "Enemy
        // creatures cannot reap" só repete esse escopo no `e.target` (a casa e
        // os demais filtros continuam sendo lidos).
        if (copy.k === "lasting" && copy.e?.restrict?.action === "reap" && copy.e.target) {
          const t = copy.e.target;
          if ((t.type === "Creature" || t.type === undefined) && Object.keys(t).every((key) => key === "type" || key === "side")) {
            const { type: _type, side: _side, ...rest } = t;
            copy.e = { ...copy.e, target: Object.keys(rest).length ? rest : {} };
          }
        }
        // Lote 15c: "Move 1A from a creature to your pool" — o keyteki escreve
        // supply + gainAmber(if did); o parser move direto para o pool.
        const prev = acts[acts.length - 1];
        if (copy.k === "gainAmber" && copy.if?.k === "count" && copy.if.of === "did" && prev?.k === "moveAmber" && prev.to === "supply") {
          acts[acts.length - 1] = { ...prev, to: "pool", n: copy.n ?? 1 };
          continue;
        }
        acts.push(copy);
      }
    }
    // `amber: true` no alvo de um moveAmber é implicado pelo ato (só se move
    // âmbar de quem tem) — o parser não o escreve.
    const target = body.target?.amber === true && acts.some((x) => x.k === "moveAmber") ? (({ amber: _amber, ...rest }) => rest)(body.target) : body.target;
    const key = JSON.stringify(sortKeys({ ...body, ...(target ? { target } : {}), acts }));
    merged.set(key, { ...JSON.parse(key), on: [...new Set([...(merged.get(key)?.on ?? []), ...on])] });
  }
  return [...merged.values()];
};

/** Lote 15f (triagem [c]): as mesmas fusões "mesmo efeito, escrita diferente"
    no NÍVEL DO EFEITO — abilities com o mesmo corpo fundem o `on` ("Fight/Reap:"
    vs dois grants separados) e efeitos com o MESMO target e campos disjuntos são
    o mesmo efeito (uma frase "gets +2 power" e outra "gains …" vs o match único
    do keyteki). */
const equivalentEffects = (list) => {
  const merged = [];
  for (const e of list ?? []) {
    // o parse espalha duration/when mesmo quando indefinidos — undefined é ausente
    let entry = Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined));
    if (entry.abilities?.length) {
      const byBody = new Map();
      for (const a of entry.abilities) {
        const { on, ...rest } = a;
        const key = JSON.stringify(sortKeys(rest));
        const prev = byBody.get(key);
        if (prev) prev.on = [...new Set([...prev.on, ...on])].sort();
        else byBody.set(key, { on: [...on].sort(), ...rest });
      }
      entry = { ...entry, abilities: [...byBody.values()] };
    }
        const twin = merged.find(
      (m) => JSON.stringify(sortKeys(m.target ?? {})) === JSON.stringify(sortKeys(entry.target ?? {})) && Object.keys(entry).every((k) => k === "target" || !(k in m)),
    );
    if (twin) Object.assign(twin, entry);
    else merged.push(entry);
  }
  return merged;
};

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

/** Drafts for faces the parser does NOT read fully (T1 = parser already full: no row). Filled by convertSet. */
const queue = [];
const queueFaces = [];

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
    if (args.includes("--export-queue")) exportQueue(corpus);
    return;
  }
  const set = value("--set");
  if (!set) throw new Error("usage: keyteki:convert -- --set <01-Core> | --all [--baseline] [--limit N] [--src <clone>] [--only <slug>]");
  convertSet(set, src, packs, corpus, { quiet: false, write: true });
}

/** Drafts of the faces the converter newly covers → scripts/harvest/queue-export-keyteki.json (Config > Revisão). */
function exportQueue(corpus) {
  const faces = [...corpus.byTitle.values()].flat();
  const { valid, rejected } = validateQueueRows(queue, faces);
  const out = resolve(ROOT, "scripts/harvest/queue-export-keyteki.json");
  writeFileSync(out, JSON.stringify(valid, null, 1) + "\n");
  const sigs = new Set(queueFaces.map((f) => `${f.text}|${f.type}`));
  console.log(JSON.stringify({ queueRows: queue.length, validateQueueRows: { valid: valid.length, rejected: rejected.length, reasons: rejected.map((r) => r.reason) }, distinctTextType: sigs.size, out }, null, 1));
}

function convertSet(set, src, packs, corpus, { quiet, write }) {
  const dir = resolve(src, "server/game/cards", set);
  const limit = Number(value("--limit") ?? Infinity);
  const only = value("--only");

  const files = readdirSync(dir).filter((f) => f.endsWith(".js")).sort().slice(0, limit);
  const model = `keyteki-ast@${SOURCE.commit.slice(0, 7)}`;
  const report = { set, files: 0, parseErrors: 0, noAbilities: 0, cLayer: 0, unsupported: 0, lowered: 0, noMatch: 0, noPack: 0, noText: 0, noFace: 0, noTextMatch: 0, converted: 0, viaLambdaMap: 0, viaTable: 0, rows: 0, gateFail: 0, golden: { eligible: 0, agree: 0, diff: 0, orderOnly: 0, equivalent: 0, newlyCovered: 0, fromPartial: 0, fromVanilla: 0 } };
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
          const sameEffects = JSON.stringify(canon(parsed.effects)) === JSON.stringify(canon(lowered.effects));
          const order = JSON.stringify(canon(parsed.abilities, true)) === JSON.stringify(canon(lowered.abilities, true)) && sameEffects;
          const equiv = !order && JSON.stringify(canon(equivalent(parsed.abilities), true)) === JSON.stringify(canon(equivalent(lowered.abilities), true)) && JSON.stringify(canon(equivalentEffects(parsed.effects))) === JSON.stringify(canon(equivalentEffects(lowered.effects)));
          if (order) report.golden.orderOnly += 1;
          if (equiv) report.golden.equivalent += 1;
          diffs.push({ kind: order ? "order-only" : equiv ? "equivalent" : "semantic", card: ir.id, title: face.title, text: face.text, parser: { abilities: parsed.abilities, effects: parsed.effects }, keyteki: lowered });
        }
      } else {
        report.golden.newlyCovered += 1;
        report.golden[parsed.coverage === "partial" ? "fromPartial" : "fromVanilla"] += 1;
        queue.push({ ...result.row, source: "keyteki", reviewed: false, generatedAt: 0, v: DSL_VERSION, model });
        queueFaces.push(face);
      }
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
