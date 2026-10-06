// SPDX-License-Identifier: AGPL-3.0-only
// Derived from keyteki card scripts (copyright keyteki contributors, AGPL-3.0).
// Lambda pattern library (plan §1.3, "camada A/B"): local predicates over a card
// become DSL `Filter` fragments; a lambda outside the library is Unsupported
// ("C-layer") — never guessed. Patterns, over a subject S (`card`, `event.card`…):
//   S.hasHouse('x')  S.hasTrait('x')  S.isOnFlank()  S.power <op> N  S.exhausted
//   S.hasToken('damage'|'amber'|'power')  S.type === 'creature'
//   S.controller ===/!== context.player[.opponent]  S ===/!== context.source
//   S.neighbors.includes(context.source)   `&&` fuses, `!` only where the DSL negates
// Selection expressions (`target:` of an action): context.source / .target /
//   context.game|player|player.opponent .creaturesInPlay [.filter(fn)] / source.neighbors.

import { isEnabled, lookup, markMap, markTable } from "./lambdaMap.mjs";

export class Unsupported extends Error {
  constructor(code, detail = "") {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail;
  }
}

const HOUSES = {
  brobnar: "Brobnar", dis: "Dis", ekwidon: "Ekwidon", geistoid: "Geistoid", logos: "Logos", mars: "Mars",
  redemption: "Redemption", sanctum: "Sanctum", saurian: "Saurian", shadows: "Shadows", skyborn: "Skyborn",
  staralliance: "Star Alliance", unfathomable: "Unfathomable", untamed: "Untamed",
};
export const houseName = (slug) => HOUSES[String(slug).toLowerCase()] ?? null;

const TYPES = { creature: "Creature", artifact: "Artifact", upgrade: "Upgrade" };

const lit = (n) => (n && n.t === "lit" ? n.v : undefined);
const str = (n) => (typeof lit(n) === "string" ? lit(n) : null);

/** Compact source-like text of an expression, for the C-layer histogram. */
export function render(n) {
  if (!n) return "";
  switch (n.t) {
    case "lit":
      return JSON.stringify(n.v);
    case "id":
      return n.name;
    case "member":
      return `${render(n.obj)}.${n.prop}`;
    case "call":
      return `${render(n.callee)}(${n.args.map(render).join(",")})`;
    case "bin":
    case "logic":
      return `${render(n.l)} ${n.op} ${render(n.r)}`;
    case "un":
      return `${n.op}${render(n.arg)}`;
    case "fn":
      return `(${n.params.join(",")})=>${render(n.body)}`;
    case "block":
    case "unknown":
    case "tpl":
      return n.src.replace(/\s+/g, " ").slice(0, 80);
    default:
      return n.t;
  }
}

/** `a.b.c` as a dotted string, or null when the chain has anything else in it. */
export function path(n) {
  if (!n) return null;
  if (n.t === "id") return n.name;
  if (n.t === "member") {
    const p = path(n.obj);
    return p === null ? null : `${p}.${n.prop}`;
  }
  return null;
}

/** Merges filter fragments; two different values for one field cannot be both. */
function fuse(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (k in out && out[k] !== v) throw new Unsupported("lambda", `conflicting ${k}`);
    out[k] = v;
  }
  return out;
}

const FLIP = { ">=": "<=", "<=": ">=", ">": "<", "<": ">", "===": "===", "==": "==", "!==": "!==", "!=": "!=" };

/** One conjunct. `S` is the dotted path naming the card; `ctx` the context param name. */
function conjunct(n, S, ctx, negated = false) {
  if (n.t === "un" && n.op === "!") return conjunct(n.arg, S, ctx, !negated);
  if (n.t === "logic") {
    if (n.op === "||") throw new Unsupported("lambda", "or");
    if (negated) throw new Unsupported("lambda", "negated and");
    return fuse(conjunct(n.l, S, ctx), conjunct(n.r, S, ctx));
  }
  // S.method('arg')
  if (n.t === "call" && n.callee.t === "member" && path(n.callee.obj) === S) {
    const arg = str(n.args[0]);
    switch (n.callee.prop) {
      case "hasHouse": {
        // Lote 15b: `card.hasHouse(context.house)` é a casa que o
        // `target: {mode: 'house'}` escolheu ("Stun each creature of that
        // house") — a variável de casa do motor (`house: "chosen"`).
        if (path(n.args[0]) === `${ctx}.house`) return { house: negated ? "!chosen" : "chosen" };
        const h = arg && houseName(arg);
        if (!h) throw new Unsupported("lambda", `house ${arg}`);
        return { house: negated ? `!${h}` : h };
      }
      case "hasTrait": {
        if (!arg) throw new Unsupported("lambda", "trait arg");
        return { trait: (negated ? "!" : "") + arg[0].toUpperCase() + arg.slice(1) };
      }
      case "isOnFlank":
        if (negated) throw new Unsupported("lambda", "not on flank");
        return { flank: true };
      case "hasToken": {
        if (negated) throw new Unsupported("lambda", "not hasToken");
        if (arg === "damage") return { damaged: true };
        if (arg === "amber") return { amber: true };
        if (arg === "power") return { counters: true };
        throw new Unsupported("lambda", `token ${arg}`);
      }
      default:
        throw new Unsupported("lambda", `method ${n.callee.prop}`);
    }
  }
  // S.exhausted / S.damage (truthy)
  if (n.t === "member" && path(n.obj) === S) {
    if (n.prop === "exhausted") return negated ? { ready: true } : { exhausted: true };
    if (n.prop === "damage" && !negated) return { damaged: true };
    if (n.prop === "damage") return { damaged: false };
    throw new Unsupported("lambda", `prop ${n.prop}`);
  }
  // S.neighbors.includes(context.source)
  if (n.t === "call" && n.callee.t === "member" && n.callee.prop === "includes" && path(n.callee.obj) === `${S}.neighbors` && path(n.args[0]) === `${ctx}.source` && !negated) return { neighborsOfSource: true };
  if (n.t === "bin") {
    let { l, r, op } = n;
    if (path(r) === S || path(r)?.startsWith(`${S}.`)) [l, r, op] = [r, l, FLIP[op] ?? op];
    const lp = path(l);
    // S.power <op> N
    if (lp === `${S}.power` && typeof lit(r) === "number") {
      const v = lit(r);
      const eff = negated ? ({ ">=": "<", "<=": ">", ">": "<=", "<": ">=" }[op] ?? op) : op;
      if (eff === ">=") return { powerMin: v };
      if (eff === ">") return { powerMin: v + 1 };
      if (eff === "<=") return { powerMax: v };
      if (eff === "<") return { powerMax: v - 1 };
      throw new Unsupported("lambda", `power ${op}`);
    }
    // S.type === 'creature'
    if (lp === `${S}.type` && str(r) && TYPES[str(r)] && (op === "===" || op === "==" || op === "!==" || op === "!=")) {
      const same = (op === "===" || op === "==") !== negated;
      if (same) return { type: TYPES[str(r)] };
      if (str(r) === "upgrade") return { type: "!Upgrade" };
      throw new Unsupported("lambda", "negated type");
    }
    // S.controller === context.player[.opponent]
    if (lp === `${S}.controller` && (op === "===" || op === "!==")) {
      const who = path(r);
      const mine = who === `${ctx}.player`;
      const theirs = who === `${ctx}.player.opponent`;
      if (mine || theirs) return { side: mine === ((op === "===") !== negated) ? "friendly" : "enemy" };
    }
    // S === / !== context.source
    if (lp === S && path(r) === `${ctx}.source` && (op === "===" || op === "!==")) {
      return (op === "===") !== negated ? { self: true } : { other: true };
    }
  }
  throw new Unsupported("lambda", `no pattern ${render(n)}`);
}

/** A lambda `(card[, context]) => predicate` → Filter fragment. `subject` overrides the card path (events). */
export function filterOf(fnNode, { subject = null, ctxName = null } = {}) {
  if (!fnNode || fnNode.t !== "fn") throw new Unsupported("lambda", "not a function");
  if (fnNode.body.t === "block") throw new Unsupported("lambda", "block body");
  const S = subject ?? fnNode.params[0];
  const ctx = ctxName ?? fnNode.params[1] ?? "context";
  if (!S) throw new Unsupported("lambda", "no subject");
  const f = conjunct(fnNode.body, S, ctx);
  // These fields only exist on creatures: keyteki leaves the type implicit, our filter does not.
  if (f.type === undefined && (f.flank || f.damaged || f.powerMin !== undefined || f.powerMax !== undefined)) f.type = "Creature";
  return f;
}

/** `(context) => ({ target: <expr>, … })` helpers. Returns a Selection or null when it is not one. */
export function selectionOf(n, ctx = "context") {
  const p = path(n);
  if (p === `${ctx}.source`) return "self";
  if (p === `${ctx}.target`) return "target";
  // Lote 15a: "…, then ready it" — `preThenEvent.card` é o resultado do ato
  // anterior (o token que o makeToken criou): a Selection "moved" do DSL v14.
  if (p === `${ctx}.preThenEvent.card`) return "moved";
  if (p === `${ctx}.source.neighbors`) return { each: { neighborsOfSource: true } };
  const base = (q) => {
    if (q === `${ctx}.game.creaturesInPlay`) return { type: "Creature" };
    if (q === `${ctx}.player.creaturesInPlay`) return { type: "Creature", side: "friendly" };
    if (q === `${ctx}.player.opponent.creaturesInPlay`) return { type: "Creature", side: "enemy" };
    return null;
  };
  const b = base(p);
  if (b) return { each: b };
  // <base>.filter((c) => predicate)
  if (n.t === "call" && n.callee.t === "member" && n.callee.prop === "filter" && n.args.length === 1) {
    const inner = base(path(n.callee.obj));
    if (inner) return { each: fuse(inner, filterOf(n.args[0], { ctxName: ctx })) };
  }
  return null;
}

const ZONES = new Set(["hand", "deck", "discard", "archives"]);
const CMP = { ">": (n) => ({ op: "gte", n: n + 1 }), ">=": (n) => ({ op: "gte", n }), "<=": (n) => ({ op: "lte", n }), "<": (n) => ({ op: "lte", n: n - 1 }), "===": (n) => ({ op: "eq", n }), "==": (n) => ({ op: "eq", n }) };

/** Comparison of a Count with a literal as a `count` Condition (`!==` = not eq). */
function countCmp(of, op, v) {
  if (op === "!==" || op === "!=") return { k: "not", c: { k: "count", of, op: "eq", n: v } };
  const f = CMP[op];
  if (!f) return null;
  const c = f(v);
  if (c.n < 0) return null;
  return { k: "count", of, ...c };
}

/** Lane G families (conditions.json) as structural recognisers; null = not one of them. */
function tableCondition(n, ctx) {
  const side = (p) => (p === `${ctx}.player` || p === `${ctx}.source.controller` ? false : p === `${ctx}.player.opponent` ? true : null);
  const flag = (opp) => (opp ? { opp: true } : {});
  if (n.t === "un" && n.op === "!") {
    const inner = tableCondition(n.arg, ctx);
    return inner ? { k: "not", c: inner } : null;
  }
  // haunted: the discard pile holds 10 or more cards
  if (n.t === "call" && n.callee.t === "member" && n.callee.prop === "isHaunted" && n.args.length === 0) {
    const opp = side(path(n.callee.obj));
    return opp === null ? null : { k: "count", of: { p: "discard", ...flag(opp) }, op: "gte", n: 10 };
  }
  if (n.t !== "bin") return null;
  const lp = path(n.l);
  if (lp === `${ctx}.game.activePlayer` || path(n.r) === `${ctx}.game.activePlayer`) {
    const other = path(n.l) === `${ctx}.game.activePlayer` ? path(n.r) : path(n.l);
    if (other !== `${ctx}.player` && other !== `${ctx}.source.controller`) return null;
    if (n.op === "===" || n.op === "==") return { k: "myTurn" };
    if (n.op === "!==" || n.op === "!=") return { k: "not", c: { k: "myTurn" } };
    return null;
  }
  // moreFewerCreatures: opponent vs player battleline lengths
  const mine = `${ctx}.player.creaturesInPlay.length`;
  const theirs = `${ctx}.player.opponent.creaturesInPlay.length`;
  const rp = path(n.r);
  if ((lp === mine && rp === theirs) || (lp === theirs && rp === mine)) {
    const youBigger = (lp === mine) === (n.op === ">");
    if (n.op !== ">" && n.op !== "<") return null;
    return { k: youBigger ? "moreCreatures" : "fewerCreatures" };
  }
  const v = lit(n.r);
  if (typeof v !== "number") return null;
  const rel = n.l.t === "call" ? null : lp;
  // forgedKeys: `<player>.getForgedKeys()`
  if (n.l.t === "call" && n.l.callee.t === "member" && n.l.callee.prop === "getForgedKeys" && n.l.args.length === 0) {
    const opp = side(path(n.l.callee.obj));
    return opp === null ? null : countCmp({ p: "keys", ...flag(opp) }, n.op, v);
  }
  if (!rel?.startsWith(`${ctx}.`)) return null;
  // <game|player[.opponent]>.<zone|creaturesInPlay>.length
  const parts = rel.slice(ctx.length + 1).split(".");
  if (parts.pop() !== "length") return null;
  const prop = parts.pop();
  const who = parts.join(".");
  if (ZONES.has(prop) && (who === "player" || who === "player.opponent")) return countCmp({ p: prop, ...flag(who !== "player") }, n.op, v);
  if (prop === "creaturesInPlay" && (who === "game" || who === "player" || who === "player.opponent")) {
    return countCmp({ c: who === "game" ? { type: "Creature" } : { type: "Creature", side: who === "player" ? "friendly" : "enemy" } }, n.op, v);
  }
  return null;
}

/** `(context) => context.player.opponent.amber >= 3` → Condition (null = always true, e.g. the opponent-exists guard). */
export function conditionOf(fnNode) {
  const nope = () => new Unsupported("condition", `no pattern ${render(fnNode)}`);
  if (!fnNode || fnNode.t !== "fn") throw nope();
  // lane G/M map first: an exact canon hit is a reviewed mapping (Counts do not belong in a condition slot).
  const hit = lookup(fnNode);
  if (hit?.kind === "condition") {
    markMap();
    return hit.value;
  }
  const ctx = fnNode.params[0] ?? "context";
  const isGuard = (n) => path(n) === `${ctx}.player.opponent` || (n.t === "un" && n.op === "!" && n.arg.t === "un" && n.arg.op === "!" && path(n.arg.arg) === `${ctx}.player.opponent`);
  // A two-player game always has an opponent: the guard says nothing.
  let body = fnNode.body;
  while (body.t === "logic" && body.op === "&&" && isGuard(body.l)) body = body.r;
  if (isGuard(body)) return null;
  const viaTable = () => {
    const c = isEnabled() ? tableCondition(body, ctx) : null;
    if (!c) throw nope();
    markTable();
    return c;
  };
  if (body.t !== "bin") return viaTable();
  const { l, r, op } = body;
  const lp = path(l);
  const v = lit(r);
  if (typeof v !== "number" || (lp !== `${ctx}.player.amber` && lp !== `${ctx}.player.opponent.amber`)) return viaTable();
  const opp = lp.includes("opponent");
  if (op === ">=") return { k: "amber", opp, op: "gte", n: v };
  if (op === ">") return { k: "amber", opp, op: "gte", n: v + 1 };
  if (op === "===" || op === "==") return { k: "amber", opp, op: "eq", n: v };
  if (op === "<") return { k: "not", c: { k: "amber", opp, op: "gte", n: v } };
  if (op === "<=") return { k: "not", c: { k: "amber", opp, op: "gte", n: v + 1 } };
  throw nope();
}
