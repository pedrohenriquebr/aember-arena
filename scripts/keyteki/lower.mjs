// SPDX-License-Identifier: AGPL-3.0-only
// Derived from keyteki card scripts (copyright keyteki contributors, AGPL-3.0).
// CardIR (parse.mjs) → { abilities, effects } in our DSL v12, or Unsupported(code).
// Fail closed (plan §1.2): a prop, helper, event or lambda the tables/library do
// not name makes the WHOLE card unsupported; nothing is ignored on the way.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { conditionOf, filterOf, houseName, path, selectionOf, Unsupported } from "./lambdas.mjs";
import { lookup, markMap, readUsage, resetUsage } from "./lambdaMap.mjs";

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
  if (node.t === "obj") {
    // Lote 15c (dynamic-amount): `amount: <expr>` / `amount: (context) => …` —
    // o map de lambdas resolve o Count; o expr vira o corpo de um fn sintético
    // para reaproveitar a chave de canon do map.
    const amt = node.props.amount;
    if (amt && amt.t !== "lit") {
      const hit = lookup(amt.t === "fn" ? amt : { t: "fn", params: ["context"], body: amt });
      if (hit?.kind === "count") {
        const { amount: _amount, ...props } = node.props;
        markMap();
        return { props, ctx: "context", per: hit.value };
      }
    }
    return { props: node.props, ctx: "context" };
  }
  if (node.t === "fn" && node.body.t === "obj") {
    const ctx = node.params[0] ?? "context";
    // lane G/M map: a dynamic `amount` the map knows becomes n x per (the Count is still gated by validateDraft). A chave do map pode ser o fn inteiro ou só o expr do amount (com outros props no corpo).
    const amt = node.body.props.amount;
    const hit = amt && amt.t !== "lit" ? (lookup(node) ?? lookup(amt.t === "fn" ? amt : { t: "fn", params: node.params, body: amt })) : null;
    if (hit?.kind === "count") {
      const { amount: _amount, ...props } = node.body.props;
      markMap();
      return { props, ctx, per: hit.value };
    }
    return { props: node.body.props, ctx };
  }
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
  // Lote 15d: as ações de duração (untilPlayerTurnEnd & cia.) viram o ato
  // `lasting` com a janela certa.
  if (entry.kind === "lasting") return lastingActOf(node, entry);
  const { props, ctx, per } = optionsOf(node.args[0]);
  const act = { k: entry.k };
  for (const [f, v] of Object.entries(entry.defaults ?? {})) act[f] = v;
  applyProps(act, entry, props, node.name);
  if (per) {
    if (entry.props?.amount?.field !== "n") return fail("dynamic", `${node.name}.amount`);
    act.per = per;
  }

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
  let mode = null;
  let numCards = null;
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
      // Lote 15b (target-select): os targetingModes do keyteki.
      case "mode": {
        const m = lit(v);
        if (m !== "house" && m !== "upTo" && m !== "exactly") fail("target", `mode ${m}`);
        mode = m;
        break;
      }
      case "numCards":
        numCards = lit(v);
        if (typeof numCards !== "number" || !(numCards > 0)) fail("target", "numCards");
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
  // Lote 15b: `mode: 'house'` ("Choose a house", Arise/BlindingLight) não é
  // alvo de carta — a escolha vira `house: "chosen"` nos filtros dos
  // gameAction (lambdas.mjs: hasHouse(context.house)) e o gameAction do nível
  // superior é que traz os atos.
  if (mode === "house") {
    if (Object.keys(filter).length || cond || acts) fail("target", "house mode with card target");
    return { house: true };
  }
  if (!acts) fail("target", "no gameAction");
  // 'exactly'/'upTo' + numCards: a escolha vira o pick do ato (a grafia do
  // parser: "Return 2 enemy creatures" = `{pick, n}`, "Choose up to N" =
  // `{pick, n, upTo: true}`). "exactly 1" é a escolha SINGULAR do print
  // ("Move 1A from a creature to the common supply"): o alvo clássico, não o
  // pick (que é engine-auto).
  if (mode) {
    if (!numCards) fail("target", `${mode} without numCards`);
    if (mode === "exactly" && numCards === 1) return { filter, acts };
    return { filter, acts, pick: { n: numCards, ...(mode === "upTo" ? { upTo: true } : {}) } };
  }
  return { filter, acts };
}

/** The `effect:` list of a persistent/lasting registrar → PersistentEffect fields. */
function effectFields(effects, out) {
  for (const e of effects) {
    if (e.t !== "effect") fail("effect", e.t);
    const spec = EFFECTS[e.name];
    if (!spec) fail("effect", e.name);
    if (spec.number) {
      const n = lit(e.args[0]);
      if (typeof n !== "number" || spec.number in out) fail("dynamic", `effect ${e.name}`);
      out[spec.number] = n;
    } else if (spec.house) {
      // changeHouse('mars') → o campo `house` do efeito (nome canônico).
      const h = lit(e.args[0]);
      const name = typeof h === "string" ? houseName(h) : null;
      if (!name || out.house !== undefined) fail("dynamic", `effect ${e.name}`);
      out.house = name;
    } else if (spec.control) {
      // takeControl(context.player[.opponent]) → control "you"/"opponent".
      const who = path(e.args[0])?.endsWith('.player.opponent') ? 'opponent' : path(e.args[0])?.endsWith('.player') ? 'you' : null;
      if (!who || out.control !== undefined) fail('dynamic', 'effect takeControl');
      out.control = who;
    } else if (spec.abilities) {
      // gainAbility(type, properties) → a ability concedida ao host.
      out.abilities = [...(out.abilities ?? []), grantedAbility(e.args[0], e.args[1])];
    } else if (spec.restrict) {
      // cardCannot('fight') → `restrict: {action}`; o `who` vem do
      // targetController da ação durável (lowerPersistent/lastingActOf).
      const action = lit(e.args[0]);
      if (!action || out.restrict || e.args[1]) fail("dynamic", `effect ${e.name}`);
      if (!["play", "use", "fight", "reap"].includes(action)) fail("effect", `${e.name} ${action}`);
      out.restrict = { action };
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
}


/** Lote 15e: o `when`+`gameAction` de um lasting (Crystal Hive "gain 1A each
    time a creature reaps") → o observador CONCEDIDO à fonte do efeito
    (`e.abilities`, target self): morre com a janela e roda sob os budgets de
    observador como qualquer outro. */
function triggerAbility(when, gameAction) {
  if (!when || when.t !== "obj" || Object.keys(when.props).length !== 1) fail("event", "when shape");
  const [name, f] = Object.entries(when.props)[0];
  const trig = TRIGGERS[name];
  if (!trig || trig.status !== "ok") fail("event", name);
  if (f.t !== "fn" || f.body.t === "block") fail("lambda", "when");
  const [ev, ctx] = [f.params[0] ?? "event", f.params[1] ?? "context"];
  if (!gameAction) fail("empty", "trigger without gameAction");
  const ability = { on: [trig.on], acts: lowerAction(gameAction, "self", { inTarget: false }) };
  if (!ability.acts.length) fail("empty", "lasting trigger without acts");
  let body = f.body;
  if (body.t === "logic" && body.op === "&&") {
    const parts = [body.l, body.r];
    const playerPart = parts.find((p2) => p2.t === "bin" && (p2.op === "===" || p2.op === "!==") && path(p2.l) === `${ev}.player`);
    const r = playerPart ? path(playerPart.r) : null;
    if (playerPart && (r === `${ctx}.player` || r === `${ctx}.player.opponent`)) {
      ability.if = (r === `${ctx}.player.opponent`) === (playerPart.op === "===") ? { k: "actor", opp: true } : { k: "actor" };
      body = parts.find((p2) => p2 !== playerPart);
    }
  }
  if (body.t === "lit" && body.v === true) {
    // `() => true` observa todos os eventos do tipo ("each time a creature reaps").
    ability.of = {};
    return ability;
  }
  // gatilhos de turno/jogador (sem subject): o mesmo tratamento do observer.
  if (trig.turn || trig.turnBound || trig.player) {
    const owner = (n) => path(n) === `${ctx}.game.activePlayer` || path(n) === "this.game.activePlayer";
    if (trig.turn && body.t === "bin" && body.op === "===" && path(body.l) === `${ctx}.player` && owner(body.r)) return ability;
    if ((trig.turnBound || trig.player) && body.t === "bin" && (body.op === "===" || body.op === "!==") && path(body.l) === `${ev}.player`) {
      const r = path(body.r);
      if (r === `${ctx}.player` || r === `${ctx}.player.opponent`) {
        const opp = (r === `${ctx}.player.opponent`) === (body.op === "===");
        if (trig.turnBound && opp) fail("event", "opponent turn");
        if (!trig.turnBound) ability.if = opp ? { k: "actor", opp: true } : { k: "actor" };
        return ability;
      }
    }
    fail("lambda", "when");
  }
  if (!trig.subject) fail("event", name);
  const subject = trig.subject.replace(/^event/, ev);
  const filter = filterOf({ ...f, body }, { subject, ctxName: ctx });
  if (!sameFilter(filter, { self: true })) ability.of = filter;
  return ability;
}


/** Lote 15f (gain-ability): `gainAbility(type, properties)` → a ability
    CONCEDIDA ao host (PersistentEffect.abilities). O type vira o `on`;
    reaction/interrupt pedem o `when` do properties (o observador do 15e). */
function grantedAbility(typeNode, propsNode) {
  const type = lit(typeNode);
  const { props, ctx } = optionsOf(propsNode);
  const ability = {};
  let on = null;
  if (type === "reaction" || type === "interrupt") {
    const granted = triggerAbility(props.when, props.gameAction);
    if (type === "interrupt" && granted.on[0] !== "beforeFight") fail("effect", "interrupt grant");
    return granted;
  }
  on = { reap: "reap", fight: "fight", play: "play", destroyed: "destroyed", action: "action", omni: "omni", beforeFight: "beforeFight" }[type ?? ""];
  if (!on) fail("effect", "gainAbility " + String(type));
  ability.on = [on];
  if (props.condition) {
    const c = conditionOf(props.condition);
    if (c) ability.if = c;
  }
  if (props.target) {
    const t = targetFilter(props.target);
    if (t.house || t.pick) fail("effect", "gainAbility target");
    ability.target = t.filter;
    ability.acts = lowerAction(t.acts, "target", { inTarget: true });
    if (!ability.acts.length) fail("empty", "gainAbility without acts");
  } else if (props.gameAction) {
    ability.acts = lowerAction(props.gameAction, "self", { inTarget: false });
    if (!ability.acts.length) fail("empty", "gainAbility without acts");
  } else fail("empty", "gainAbility without gameAction");
  for (const key of Object.keys(props)) {
    if (["gameAction", "target", "condition", "when", "effect", "effectArgs", "message", "messageArgs", "name", "effectAlert", "effectStyle", "activePromptTitle", "preferActionPromptMessage"].includes(key)) continue;
    fail("prop", "gainAbility." + key);
  }
  return ability;
}

/** keyteki's lasting durations → our `duration` (game.turnStamp windows). */
const DURATIONS = {
  untilPlayerTurnEnd: "turn",
  duringOpponentNextTurn: "next",
  untilPlayerNextTurnStart: "next",
  untilPlayerNextTurnEnd: "nextTurn",
};

/** Lote 15d: `ability.actions.<lasting>(props)` → `{k:"lasting", e}`. A duração
    vem do wrapper (actions.json) ou do prop `duration`/`until`; o `effect` passa
    pelo mesmo leitor dos persistentes. `when`/`gameAction` (o lasting COM
    gatilho, "gain 1 each time a creature reaps") fica de fora. */
function lastingActOf(node, entry) {
  const { props } = optionsOf(node.args[0]);
  const out = {};
  let effects = [];
  let match = null;
  let controller = null;
  let triggerNode = null;
  let triggerActs = null;
  for (const [key, v] of Object.entries(props)) {
    if (key === "message" || key === "messageArgs" || key === "effectArgs" || key === "preferActionPromptMessage" || key === "multipleTrigger" || key === "triggeredAbilityType") continue;
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
      case "when":
        triggerNode = v;
        break;
      case "gameAction":
        triggerActs = v;
        break;
      case "multipleTrigger":
        // "fires only once" não tem modelo — o padrão (true) é cosmético.
        if (lit(v) !== true) fail("lasting", "multipleTrigger");
        break;
      case "triggeredAbilityType":
        break;
      case "duration":
      case "until": {
        // `until: {onCardLeavesPlay: …}` é o "while X is in play" do keyteki —
        // o mecanismo é o boundTo do takeControl (a volta é quando a fonte sai).
        if (v.t === "obj" && Object.keys(v.props).every((k) => k === "onCardLeavesPlay")) {
          out.duration = "source";
          break;
        }
        const d = DURATIONS[lit(v)];
        if (!d) fail("lasting", `${key} ${lit(v)}`);
        out.duration = d;
        break;
      }
      default:
        fail("prop", `lasting.${key}`);
    }
  }
  if (!effects.length && !triggerNode) fail("empty", "lasting without effect");
  if (triggerNode) {
    if (!triggerActs) fail("lasting", "when without gameAction");
    out.abilities = [triggerAbility(triggerNode, triggerActs)];
    if (!match && controller === null) out.target = { self: true };
  }
  effectFields(effects, out);
  if (match) {
    const f = filterOf(match);
    // Escopo default do keyteki (match sem targetController é do lado que
    // resolve — "each friendly creature gains poison"); `any` deixa sem lado.
    if (f.side === undefined && controller !== "any") f.side = controller === "opponent" ? "enemy" : "friendly";
    out.target = f;
  } else if (controller && !out.restrict) fail("persistent", "player scope");
  else out.target = out.abilities ? { self: true } : {};
  // O `who` do restrict vem do targetController (a restrição é de jogador).
  if (out.restrict) out.restrict = { ...out.restrict, who: controller === "any" ? "any" : controller === "opponent" ? "opponent" : "you" };
  if ((out.keywords || out.power !== undefined || out.armor !== undefined) && out.target && !out.target.type) out.target = { type: "Creature", ...out.target };
  if (out.duration === undefined && entry.duration) out.duration = entry.duration;
  const { target, if: cond, ...tail } = out;
  return [{ k: "lasting", e: { target, ...tail, ...(cond ? { if: cond } : {}) } }];
}

/** Plain registrar props → Ability. `base` is { on, of?, if? } already decided. */
function lowerAbility(bag, base) {
  if (!bag || bag.t !== "obj") return fail("registrar", "argument is not an object");
  const { flags: _flags, ...plain } = base;
  const ability = { ...plain };
  let acts = null;
  let thenNode = null;
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
        // Lote 15b: "Choose a house" não traz alvo nem atos — os gameAction do
        // nível superior resolvem com os filtros `house: "chosen"`.
        if (t.house) break;
        if (t.pick) {
          // 'exactly'/'upTo': a escolha é o pick do ato, sem ability.target.
          acts = { node: t.acts, sel: { pick: t.filter, ...t.pick }, inTarget: true };
          break;
        }
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
        thenNode = v;
        break;
      default:
        fail("prop", key);
    }
  }
  if (!acts || (bag.props.gameAction && hasTarget)) fail("empty", "gameAction/target missing or both");
  ability.acts = lowerAction(acts.node, acts.sel, acts);
  if (!ability.acts.length) fail("empty", "no acts");
  // Lote 15a: o bloco `then` continua depois do gameAction principal.
  if (thenNode) ability.acts.push(...lowerThen(thenNode, acts));
  // keyteki `optional: true` is the whole "You may" clause; the engine offers the decline move only when an act is optional.
  if (ability.optional) for (const a of ability.acts) a.optional = true;
  // "creaturesInPlay.length > 0" guarding a creature target says nothing the target itself does not (no creature = no target).
  const c = ability.if;
  if (c && c.k === "count" && c.op === "gte" && c.n === 1 && ability.target && Object.keys(c.of?.c ?? {}).length === 1 && c.of.c.type && ability.target.type === c.of.c.type && Object.keys(ability.target).length === 1) delete ability.if;
  // keyteki `use` only affects a READY creature, so the chosen target must be ready.
  // Using an ENEMY card only works "as if it were yours": keyteki's default `use` resolves it for the
  // user, which our DSL spells `asYours`.
  for (const a of ability.acts) if (a.k === "use" && a.s === "target" && ability.target?.side === "enemy") a.asYours = true;
  const first = ability.acts[0];
  if (ability.target && first.k === "use" && first.s === "target" && ability.target.ready === undefined) ability.target.ready = true;
  const { on, of, if: cond, optional, target, acts: a, ...tail } = ability;
  return { on, ...(of ? { of } : {}), ...(cond ? { if: cond } : {}), ...(target ? { target } : {}), acts: a, ...(optional ? { optional } : {}), ...tail };
}

/** Lote 15a (M2): keyteki `then` — o bloco que resolve DEPOIS do gameAction
    principal ("Then, X" / "If you do, X"). Um bloco com mais de um ato ou a
    anáfora `preThenEvent` ("…, then ready it") abre o link `then: true` da cadeia
    do DSL v14; um then puro de um ato é o "If you do" de um ato só — o `if: did`
    do Lote 2. `may` ("Then, you may …") marca SÓ os atos do bloco como opcionais:
    o resto do texto é obrigatório (Legate Scipio foi o inverso — o `optional` do
    registrar desce para todos os atos).
    Lote 15b (triagem M3): `alwaysTriggers` é o ANTI-gate do keyteki
    (ThenAbility.resolveThenIfNeeded: o bloco dispara MESMO com zero eventos —
    spec "should prompt to forge a key even if no mars creatures are returned") —
    vira ato(s) SEM `then` e SEM `if: did`, como o print ("Move a creature to a
    flank. Steal 1A." não tem "Then,"). O `then: true` do Lote 15a é o gate
    (did ≥ 1); escrever gate onde o keyteki não tem um matava o follow-up quando o
    ato anterior era vácuo (Radix of Suffering com o oponente em 0 âmbar). */
function lowerThen(node, env) {
  const { props } = optionsOf(node);
  let actsNode = null;
  let next = null;
  let may = false;
  let cond = null;
  let ungated = false;
  for (const [key, v] of Object.entries(props)) {
    if (COSMETIC.has(key)) continue;
    switch (key) {
      case "gameAction":
        actsNode = v;
        break;
      case "may":
        if (typeof lit(v) !== "string") fail("dynamic", "then.may");
        may = true;
        break;
      case "alwaysTriggers":
        if (lit(v) !== true) fail("prop", "then.alwaysTriggers");
        ungated = true;
        break;
      case "condition":
        {
          const c = conditionOf(v);
          if (c) cond = c;
        }
        break;
      case "then":
        next = v;
        break;
      default:
        fail("prop", `then.${key}`);
    }
  }
  if (!actsNode) fail("empty", "then without gameAction");
  const acts = lowerAction(actsNode, env.sel, { inTarget: false });
  if (!acts.length) fail("empty", "then with no acts");
  const linked = !ungated && (cond !== null || acts.length > 1 || acts.some((a) => a.s === "moved"));
  for (const a of acts) {
    if (may) a.optional = true;
    if (ungated) {
      // alwaysTriggers: sem gate de cadeia — só a condição impressa decide.
      if (cond) a.if = cond;
    } else if (linked) {
      a.then = true;
      if (cond) a.if = cond;
    } else a.if = { k: "count", of: "did", op: "gte", n: 1 };
  }
  return next ? [...acts, ...lowerThen(next, env)] : acts;
}

const sameFilter = (f, shape) => Object.keys(f).length === Object.keys(shape).length && Object.entries(shape).every(([k, v]) => f[k] === v);

/** reaction/interrupt: `when: { onXxx: (event, context) => … }` → on/of/if. */
function lowerObserver(reg) {
  const bag = reg.args[0];
  if (!bag || bag.t !== "obj") return fail("registrar", "argument is not an object");
  const when = bag.props.when;
  if (!when || when.t !== "obj" || Object.keys(when.props).length !== 1) return fail("event", "when shape");
  const [name, f] = Object.entries(when.props)[0];
  const trig = TRIGGERS[name];
  if (!trig || trig.status !== "ok") return fail("event", name);
  // Lote 15e: o interrupt é o observer da janela BEFORE — a forma do gatilho
  // vem do campo `before` da tabela (onFight → beforeFight).
  const on = reg.registrar === "interrupt" && trig.before ? trig.before : trig.on;
  if (f.t !== "fn" || f.body.t === "block") return fail("lambda", "when");
  const [ev, ctx] = [f.params[0] ?? "event", f.params[1] ?? "context"];
  if (trig.turn) {
    // "At the start/end of your turn": only the controller's own turn is a card-bound trigger. `this.game` (Liam Say) names the same game as `context.game`.
    const owner = (n) => path(n) === `${ctx}.game.activePlayer` || path(n) === "this.game.activePlayer";
    if (path(f.body.t === "bin" ? f.body.l : null) !== `${ctx}.player` || !owner(f.body.r) || f.body.op !== "===") return fail("lambda", "turn owner");
    return lowerAbility(bag, { on: [on] });
  }
  // Lote 15c: turnBound (onTurnStart) aceita as DUAS grafias do keyteki — a
  // comparação com o activePlayer ("At the start of your turn", Liam Say) e a
  // `event.player === context.player` (o evento de turno). O motor só dispara no
  // turno do próprio controller, então a checagem é o default; a variante do
  // oponente não tem evento.
  if (trig.turnBound || trig.player) {
    const b = f.body;
    const owner = (n) => path(n) === `${ctx}.game.activePlayer` || path(n) === "this.game.activePlayer";
    if (trig.turnBound && b.t === "bin" && b.op === "===" && path(b.l) === `${ctx}.player` && owner(b.r)) return lowerAbility(bag, { on: [on] });
    if (b.t !== "bin" || path(b.l) !== `${ev}.player` || (b.op !== "===" && b.op !== "!==")) return fail("lambda", "event.player");
    const r = path(b.r);
    if (r !== `${ctx}.player` && r !== `${ctx}.player.opponent`) return fail("lambda", "event.player");
    const opp = (r === `${ctx}.player.opponent`) === (b.op === "===");
    if (trig.turnBound) {
      if (opp) return fail("event", `${name} (opponent turn)`);
      return lowerAbility(bag, { on: [on] });
    }
    return lowerAbility(bag, { on: [on], if: opp ? { k: "actor", opp: true } : { k: "actor" } });
  }
  // Lote 15c: onChooseActiveHouse — `event.house === '<casa>'` (com o par
  // `event.player === <ctx>.player` opcional) é "After you choose <casa> as your
  // active house": a casa escolhida vira a ativa quando o gatilho dispara, e a
  // gramática do texto só lê a casa da PRÓRIA carta — o literal é assumido igual
  // (ver notas da tabela; literal estranho = fora da gramática).
  if (trig.house) {
    let parts = [f.body];
    if (f.body.t === "logic" && f.body.op === "&&") parts = [f.body.l, f.body.r];
    let houseLit = null;
    for (const part of parts) {
      if (part.t === "bin" && part.op === "===" && path(part.l) === `${ev}.house`) {
        houseLit = lit(part.r);
      } else if (part.t === "bin" && part.op === "===" && path(part.l) === `${ev}.player` && path(part.r) === `${ctx}.player`) {
        // "you choose" — o default (o motor acorda os dois lados)
      } else return fail("lambda", "chooseHouse shape");
    }
    if (typeof houseLit !== "string") return fail("lambda", "chooseHouse shape");
    return lowerAbility(bag, { on: ["house"], if: { k: "count", of: { c: { self: true, house: "active" } }, op: "gte", n: 1 } });
  }
  if (f.body.t === "lit" && f.body.v === true) return lowerAbility(bag, { on: [on] });
  const subject = trig.subject.replace(/^event/, ev);
  const filter = filterOf(f, { subject, ctxName: ctx });
  if (sameFilter(filter, { self: true })) return lowerAbility(bag, { on: [on] });
  return lowerAbility(bag, { on: [on], of: filter });
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
  effectFields(effects, out);
  // Keywords and power/armor only mean something on creatures: the text says "Mutant creature", keyteki's match just omits the type.
  if ((out.keywords || out.power !== undefined || out.armor !== undefined || out.abilities?.length) && out.target && !out.target.self && !out.target.host && !out.target.type) out.target = { type: "Creature", ...out.target };
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
  resetUsage();
  const out = lowerCardInner(ir);
  // Non-enumerable: usage stats for the report, not part of the lowered shape specs compare.
  return Object.defineProperty(out, "via", { value: readUsage() });
}

function lowerCardInner(ir) {
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
