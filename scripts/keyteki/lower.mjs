// SPDX-License-Identifier: AGPL-3.0-only
// Derived from keyteki card scripts (copyright keyteki contributors, AGPL-3.0).
// CardIR (parse.mjs) → { abilities, effects } in our DSL v12, or Unsupported(code).
// Fail closed (plan §1.2): a prop, helper, event or lambda the tables/library do
// not name makes the WHOLE card unsupported; nothing is ignored on the way.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { conditionOf, filterOf, path, selectionOf, Unsupported } from "./lambdas.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const table = (name) => JSON.parse(readFileSync(resolve(here, "tables", name), "utf8"));
const REGISTRARS = table("registrars.json");
const ACTIONS = table("actions.json");
const TRIGGERS = table("triggers.json");
const EFFECTS = table("effects.json");

/** Props that only feed the game log / prompts (plan §1.2). */
const COSMETIC = new Set(["effect", "effectArgs", "message", "messageArgs", "activePromptTitle", "effectAlert", "effectStyle", "chatMessage", "preferActionPromptMessage", "name"]);
/** Codes that mean "lambda/code outside the library": the C-layer bucket of the report. */
export const isCLayer = (code) => code === "lambda" || code === "condition" || code === "custom";

const lit = (n) => (n && n.t === "lit" ? n.v : undefined);
const fail = (code, detail) => {
  throw new Unsupported(code, detail);
};

/** `{...}` or `(context) => ({...})` → { props, ctx }. */
function optionsOf(node) {
  if (!node) return { props: {}, ctx: "context" };
  if (node.t === "obj") return { props: node.props, ctx: "context" };
  if (node.t === "fn" && node.body.t === "obj") return { props: node.body.props, ctx: node.params[0] ?? "context" };
  return fail("dynamic", "action arguments");
}

function applyProps(act, entry, props, name) {
  for (const [key, node] of Object.entries(props)) {
    if (COSMETIC.has(key) || key === "target") continue;
    const spec = entry.props?.[key];
    if (!spec) fail("prop", `${name}.${key}`);
    if (spec.field) {
      const v = lit(node);
      if (typeof v !== "number") fail("dynamic", `${name}.${key}`);
      act[spec.field] = v;
    } else {
      const flag = lit(node);
      if (typeof flag !== "boolean") fail("dynamic", `${name}.${key}`);
      const merge = flag ? spec.ifTrue : spec.ifFalse;
      for (const [f, v] of Object.entries(merge ?? {})) {
        if (v === null) delete act[f];
        else act[f] = v;
      }
    }
  }
}

/** Orders keys the way the parser writes them (k, n, s, …) so canon diffs read naturally. */
function lowerAction(node, sel, env) {
  if (node.t === "arr") return node.items.flatMap((i) => lowerAction(i, sel, env));
  if (node.t !== "action") return fail("gameAction", node.t);
  const entry = ACTIONS[node.name];
  if (!entry || entry.pending || entry.unsupported) return fail("action", node.name);
  if (entry.kind === "flow") {
    if (node.args.length !== 1 || node.args[0].t !== "arr") return fail("gameAction", `${node.name} args`);
    return lowerAction(node.args[0], sel, env);
  }
  const { props, ctx } = optionsOf(node.args[0]);
  const act = { k: entry.k };
  for (const [f, v] of Object.entries(entry.defaults ?? {})) act[f] = v;
  applyProps(act, entry, props, node.name);

  if (entry.kind === "token") return [act];
  if (entry.kind === "card") {
    let s = sel;
    if (props.target) {
      s = selectionOf(props.target, ctx);
      if (s === null) return fail("lambda", `${node.name}.target`);
    }
    return [{ k: act.k, ...rest(act), s }];
  }
  // player action
  if (env.inTarget) return fail("gameAction", "player action inside a target block");
  let opp = entry.default === "opp";
  if (props.target) {
    const p = path(props.target);
    if (p === `${ctx}.player`) opp = false;
    else if (p === `${ctx}.player.opponent`) opp = true;
    else return fail("lambda", `${node.name}.target`);
  }
  if (!entry.oppField && opp !== (entry.default === "opp")) return fail("gameAction", `${node.name} on the other player`);
  return [{ k: act.k, ...rest(act), ...(entry.oppField && opp ? { opp: true } : {}) }];
}
const rest = ({ k, ...others }) => others;

function targetFilter(node) {
  if (node.t !== "obj") return fail("target", "shape");
  const filter = {};
  let acts = null;
  let cond = null;
  for (const [key, v] of Object.entries(node.props)) {
    if (COSMETIC.has(key)) continue;
    switch (key) {
      case "cardType": {
        const types = v.t === "arr" ? v.items.map(lit) : [lit(v)];
        const set = new Set(types);
        if (types.some((x) => typeof x !== "string")) fail("dynamic", "cardType");
        if (set.size === 1) {
          const t = { creature: "Creature", artifact: "Artifact", upgrade: "Upgrade" }[types[0]];
          if (!t) fail("target", `cardType ${types[0]}`);
          filter.type = t;
        } else if (set.size === 2 && set.has("creature") && set.has("artifact")) filter.type = "!Upgrade";
        else fail("target", "cardType list");
        break;
      }
      case "controller": {
        const c = lit(v);
        if (c === "self") filter.side = "friendly";
        else if (c === "opponent") filter.side = "enemy";
        else if (c !== "any") fail("target", `controller ${c}`);
        break;
      }
      case "cardCondition":
        cond = filterOf(v);
        break;
      case "gameAction":
        acts = v;
        break;
      case "location":
        if (lit(v) !== "play area") fail("target", "location");
        break;
      default:
        fail("prop", `target.${key}`);
    }
  }
  if (cond) {
    for (const [k, val] of Object.entries(cond)) {
      if (k in filter && filter[k] !== val) fail("lambda", `cardCondition conflicts with ${k}`);
      filter[k] = val;
    }
  }
  if (!acts) fail("target", "no gameAction");
  return { filter, acts };
}

/** Plain registrar props → Ability. `base` is { on, of?, if? } already decided. */
function lowerAbility(bag, base) {
  if (!bag || bag.t !== "obj") return fail("registrar", "argument is not an object");
  const { flags: _flags, ...plain } = base;
  const ability = { ...plain };
  let acts = null;
  let hasTarget = false;
  for (const [key, v] of Object.entries(bag.props)) {
    if (COSMETIC.has(key) || key === "when") continue;
    if (key === "play" || key === "reap" || key === "fight") {
      // Extra triggers exist only on the trigger registrars (extraTriggers adds them); a reaction would lose them.
      if (!base.flags || lit(v) !== true) fail("prop", key);
      continue;
    }
    switch (key) {
      case "gameAction":
        acts = { node: v, sel: "self", inTarget: false };
        break;
      case "target": {
        const t = targetFilter(v);
        ability.target = t.filter;
        acts = { node: t.acts, sel: "target", inTarget: true };
        hasTarget = true;
        break;
      }
      case "optional":
        if (lit(v) !== true) fail("prop", "optional");
        ability.optional = true;
        break;
      case "condition":
        {
          const c = conditionOf(v);
          if (c) ability.if = c;
        }
        break;
      case "then":
        fail("then", "M2");
        break;
      default:
        fail("prop", key);
    }
  }
  if (!acts || (bag.props.gameAction && hasTarget)) fail("empty", "gameAction/target missing or both");
  ability.acts = lowerAction(acts.node, acts.sel, acts);
  if (!ability.acts.length) fail("empty", "no acts");
  // keyteki `use` only affects a READY creature, so the chosen target must be ready.
  // Using an ENEMY card only works "as if it were yours": keyteki's default `use` resolves it for the
  // user, which our DSL spells `asYours`.
  for (const a of ability.acts) if (a.k === "use" && a.s === "target" && ability.target?.side === "enemy") a.asYours = true;
  const first = ability.acts[0];
  if (ability.target && first.k === "use" && first.s === "target" && ability.target.ready === undefined) ability.target.ready = true;
  const { on, of, if: cond, optional, target, acts: a, ...tail } = ability;
  return { on, ...(of ? { of } : {}), ...(cond ? { if: cond } : {}), ...(target ? { target } : {}), acts: a, ...(optional ? { optional } : {}), ...tail };
}

const sameFilter = (f, shape) => Object.keys(f).length === Object.keys(shape).length && Object.entries(shape).every(([k, v]) => f[k] === v);

/** reaction/interrupt: `when: { onXxx: (event, context) => … }` → on/of/if. */
function lowerObserver(reg) {
  const bag = reg.args[0];
  if (!bag || bag.t !== "obj") return fail("registrar", "argument is not an object");
  if (reg.registrar === "interrupt") return fail("interrupt", "before-window");
  const when = bag.props.when;
  if (!when || when.t !== "obj" || Object.keys(when.props).length !== 1) return fail("event", "when shape");
  const [name, f] = Object.entries(when.props)[0];
  const trig = TRIGGERS[name];
  if (!trig || trig.status !== "ok") return fail("event", name);
  if (f.t !== "fn" || f.body.t === "block") return fail("lambda", "when");
  const [ev, ctx] = [f.params[0] ?? "event", f.params[1] ?? "context"];
  if (trig.turn) {
    // "At the start/end of your turn": only the controller's own turn is a card-bound trigger.
    if (path(f.body.t === "bin" ? f.body.l : null) !== `${ctx}.player` || path(f.body.r) !== `${ctx}.game.activePlayer` || f.body.op !== "===") return fail("lambda", "turn owner");
    return lowerAbility(bag, { on: [trig.on] });
  }
  if (trig.player) {
    const b = f.body;
    if (b.t !== "bin" || path(b.l) !== `${ev}.player` || (b.op !== "===" && b.op !== "!==")) return fail("lambda", "event.player");
    const r = path(b.r);
    if (r !== `${ctx}.player` && r !== `${ctx}.player.opponent`) return fail("lambda", "event.player");
    const opp = (r === `${ctx}.player.opponent`) === (b.op === "===");
    return lowerAbility(bag, { on: [trig.on], if: opp ? { k: "actor", opp: true } : { k: "actor" } });
  }
  const subject = trig.subject.replace(/^event/, ev);
  const filter = filterOf(f, { subject, ctxName: ctx });
  if (sameFilter(filter, { self: true })) return lowerAbility(bag, { on: [trig.on] });
  return lowerAbility(bag, { on: [trig.on], of: filter });
}

function lowerPersistent(reg, host) {
  const bag = reg.args[0];
  if (!bag || bag.t !== "obj") return fail("registrar", "argument is not an object");
  const out = {};
  let match = null;
  let controller = null;
  let effects = [];
  for (const [key, v] of Object.entries(bag.props)) {
    if (COSMETIC.has(key) && key !== "effect") continue;
    switch (key) {
      case "effect":
        effects = v.t === "arr" ? v.items : [v];
        break;
      case "match":
        match = v;
        break;
      case "targetController":
        controller = lit(v);
        if (!["self", "current", "opponent", "any"].includes(controller)) fail("dynamic", "targetController");
        break;
      case "condition":
        {
          const c = conditionOf(v);
          if (c) out.if = c;
        }
        break;
      case "location":
      case "targetLocation":
        if (lit(v) !== "play area") fail("persistent", key);
        break;
      default:
        fail("prop", key);
    }
  }
  if (!effects.length) fail("empty", "no effect");
  if (host) {
    if (match || controller) fail("persistent", "whileAttached with match");
    out.target = { host: true };
  } else if (match) {
    const f = filterOf(match);
    if (f.side === undefined && controller !== "any") f.side = controller === "opponent" ? "enemy" : "friendly";
    out.target = f;
  } else if (controller) fail("persistent", "player scope");
  else out.target = { self: true };
  for (const e of effects) {
    if (e.t !== "effect") fail("effect", e.t);
    const spec = EFFECTS[e.name];
    if (!spec) fail("effect", e.name);
    if (spec.number) {
      const n = lit(e.args[0]);
      if (typeof n !== "number" || spec.number in out) fail("dynamic", `effect ${e.name}`);
      out[spec.number] = n;
    } else {
      const o = e.args[0];
      if (!o || o.t !== "obj" || out.keywords) fail("dynamic", `effect ${e.name}`);
      out.keywords = {};
      for (const [kw, val] of Object.entries(o.props)) {
        const n = lit(val);
        if (n !== true && typeof n !== "number") fail("dynamic", `keyword ${kw}`);
        out.keywords[kw] = n === true ? 1 : n;
      }
    }
  }
  const { target, if: cond, ...tail } = out;
  return { target, ...tail, ...(cond ? { if: cond } : {}) };
}

/** Fail closed: an object spread (or computed key) hides props the lowering never sees. */
function rejectSpreads(node) {
  if (Array.isArray(node)) return node.forEach(rejectSpreads);
  if (!node || typeof node !== "object") return;
  if (node.t === "obj" && node.spreads) fail("spread", "object spread or computed key");
  for (const v of Object.values(node)) rejectSpreads(v);
}

/** Lowers every registration of a card. Throws Unsupported on the first thing outside the tables. */
export function lowerCard(ir) {
  const { flags } = ir;
  // No setupCardAbilities and no code of its own = a vanilla creature (keywords live in the card data).
  if (flags.noSetup && !flags.customMethods && !flags.registrar) return { abilities: [], effects: [] };
  if (flags.noSetup) fail("custom", "no setupCardAbilities");
  if (flags.customMethods || flags.registrar || flags.complexSetup || flags.extendsOther) fail("custom", "code outside setupCardAbilities");
  const abilities = [];
  const effects = [];
  for (const reg of ir.regs) {
    if (reg.args.length > 1) fail("registrar", `${reg.registrar} extra arguments`);
    rejectSpreads(reg.args);
    const entry = REGISTRARS[reg.registrar];
    if (!entry) fail("registrar", reg.registrar);
    if (entry.unsupported) fail(entry.unsupported.split(":")[0], entry.unsupported.split(":")[1]);
    if (entry.kind === "trigger") abilities.push(lowerAbility(reg.args[0], { on: [entry.on, ...extraTriggers(reg)], flags: true }));
    else if (entry.kind === "observer") abilities.push(lowerObserver(reg));
    else effects.push(lowerPersistent(reg, entry.host === true));
  }
  return { abilities, effects };
}

/** `this.fight({ reap: true })` = "Fight/Reap:" (keyteki Card.reaction). */
function extraTriggers(reg) {
  const bag = reg.args[0];
  if (!bag || bag.t !== "obj") return [];
  const own = reg.registrar;
  return ["play", "reap", "fight"].filter((t) => t !== own && lit(bag.props[t]) === true);
}
