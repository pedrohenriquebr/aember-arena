// SPDX-License-Identifier: AGPL-3.0-only
// card_text -> ability parser for Aember Arena. No NLP: a fixed grammar of the
// trigger prefixes printed on real cards and of the verb phrases whose semantics
// were ported from keyteki's GameActions (Copyright (C) keyteki contributors,
// AGPL-3.0). An ability is used only when EVERY sentence of it is understood;
// otherwise it is dropped and the card's coverage becomes "partial"/"vanilla",
// so the engine never half-resolves a card.
import type { Ability, Act, CardRules, Condition, Filter, PersistentEffect, Restrict, Selection, Trigger } from "./abilities";
import { printedKeywords, readKeyword } from "./keywords";
import type { CardFace } from "./game";

/** Every trigger prefix printed on cards. The ones without an engine trigger
    (Interrupt:, Scrap: …) are recognised only to be reported as unsupported
    instead of leaking into the previous ability. "After <event>:" is the
    post-event window and "Each time <event>:" fires on every occurrence. */
const PREFIX = /\b((?:play|reap|fight|destroyed|omni|action|scrap|interrupt|each time [^:.]{1,90}?|at the (?:start|end) of [^:.]{1,90}?|after [^:.]{1,90}?|before [^:.]{1,90}?)(?:\/(?:play|reap|fight|destroyed))*)\s*:/gi;

const TRIGGERS: Record<string, Trigger> = {
  play: "play",
  reap: "reap",
  fight: "fight",
  "after fight": "fight",
  "after reap": "reap",
  "before fight": "beforeFight",
  destroyed: "destroyed",
  action: "action",
  omni: "omni",
  "at the start of your turn": "startOfTurn",
  "at the end of your turn": "endOfTurn",
};

/** Events a reaction can name after "After"/"Each time": both are post-event in
    this engine, and a repeatable trigger is just its event firing again. */
const EVENTS: Record<string, Trigger> = { play: "play", reap: "reap", fight: "fight", action: "action", omni: "omni" };

/** Trigger of a printed prefix ("After Fight", "Each time Reap", …), if any. */
function triggerFor(raw: string): Trigger | undefined {
  const part = raw.trim();
  return TRIGGERS[part] ?? EVENTS[part.replace(/^(after|each time) /, "")];
}

const num = (word: string) => (word === "a" || word === "an" ? 1 : Number(word));

export function normalise(text: string): string {
  return text
    .replace(/\u000b/g, "\n")
    .replace(/\([^)]*\)/g, " ")
    .replace(/(\d+)\s?<?A>?(?=[\s.,;:]|$)/g, "$1 amber")
    .replace(/(\d+)\s?<?D>?(?=[\s.,;:]|$)/g, "$1 damage")
    .replace(/\bno A\b/g, "no amber")
    .toLowerCase()
    .replace(/æmber|aember|æ/g, "amber")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseObject(phrase: string, upgrade: boolean): { s: Selection; target?: Filter } | null {
  if (/^(this card|this creature|itself|it)$/.test(phrase)) return { s: upgrade && phrase === "this creature" ? "host" : "self" };
  if (phrase === "a creature and each of its neighbors") return { s: "targetAndNeighbors", target: { type: "Creature" } };
  if (/^each neighbor of the creature this card fights$/.test(phrase)) return { s: "neighborsOfFought" };
  const top = phrase.match(/^the (\d+) most powerful creatures$/);
  if (top) return { s: { each: { type: "Creature", top: Number(top[1]) } } };
  const m = phrase.match(
    /^(a|an|each)( other)?( friendly| enemy)?( damaged| undamaged| ready)? (creature|artifact)s?( that is not on a flank| on a flank)?$/,
  );
  if (!m) return null;
  const filter: Filter = { type: m[5] === "artifact" ? "Artifact" : "Creature" };
  if (m[2]) filter.other = true;
  if (m[3]) filter.side = m[3] === " friendly" ? "friendly" : "enemy";
  if (m[4] === " damaged" || m[4] === " undamaged") filter.damaged = m[4] === " damaged";
  if (m[4] === " ready") filter.ready = true;
  if (m[6]) filter.flank = m[6] === " on a flank";
  return m[1] === "each" ? { s: { each: filter } } : { s: "target", target: filter };
}

function parseCondition(clause: string): Condition | null {
  const amber = clause.match(/^(your opponent has|you have) (no|\d+) amber( or more)?$/);
  if (amber) {
    return { k: "amber", opp: amber[1] === "your opponent has", op: amber[2] === "no" ? "eq" : "gte", n: amber[2] === "no" ? 0 : Number(amber[2]) };
  }
  if (clause === "you control more creatures than your opponent") return { k: "moreCreatures" };
  if (clause === "your opponent controls more creatures than you") return { k: "fewerCreatures" };
  return null;
}

interface Sentence {
  acts: Act[];
  target?: Filter;
  cond?: Condition;
  optional?: boolean;
}

const SIMPLE: [RegExp, (m: RegExpMatchArray) => Act][] = [
  [/^gain (\d+) amber$/, (m) => ({ k: "gainAmber", n: +m[1] })],
  [/^your opponent loses (\d+) amber$/, (m) => ({ k: "loseAmber", n: +m[1], opp: true })],
  [/^lose (\d+) amber$/, (m) => ({ k: "loseAmber", n: +m[1] })],
  [/^steal (\d+) amber$/, (m) => ({ k: "steal", n: +m[1] })],
  [/^gain (a|\d+) chains?$/, (m) => ({ k: "gainChains", n: num(m[1]) })],
  [/^draw (a|\d+) cards?$/, (m) => ({ k: "draw", n: num(m[1]) })],
  [/^your opponent discards (a|\d+) random cards?(?: from their hand)?$/, (m) => ({ k: "discardRandom", n: num(m[1]), opp: true })],
  [/^keys cost \+(\d+) (?:amber )?during your opponent's next turn$/, (m) => ({ k: "keyCost", n: +m[1], opp: true })],
  [/^archive the top card of your deck$/, () => ({ k: "archiveTop" })],
  [/^return a card from your discard pile to your hand$/, () => ({ k: "fromDiscard" })],
  [/^return a creature from your discard pile to your hand$/, () => ({ k: "fromDiscard", type: "Creature" })],
];

// Each verb declares which capture group holds the object phrase; assuming a
// group that a sibling regex does not have crashes parseObject (BUG-01).
const VERBS: [RegExp, (m: RegExpMatchArray) => { k: Act["k"]; n?: number; obj: number }][] = [
  [/^destroy (.+)$/, () => ({ k: "destroy", obj: 1 })],
  [/^sacrifice (.+)$/, () => ({ k: "destroy", obj: 1 })],
  [/^deal (\d+)(?: damage)? to (.+)$/, (m) => ({ k: "damage", n: +m[1], obj: 2 })],
  [/^stun (.+)$/, () => ({ k: "stun", obj: 1 })],
  [/^exhaust (.+)$/, () => ({ k: "exhaust", obj: 1 })],
  [/^ready (.+)$/, () => ({ k: "ready", obj: 1 })],
  [/^unstun (.+)$/, () => ({ k: "unstun", obj: 1 })],
  [/^heal (\d+) damage from (.+)$/, (m) => ({ k: "heal", n: +m[1], obj: 2 })],
  [/^fully heal (.+)$/, () => ({ k: "heal", n: 99, obj: 1 })],
  [/^return (.+?) to (?:its|their) owners?'s? hands?$/, () => ({ k: "returnToHand", obj: 1 })],
  [/^put (.+) on top of your deck$/, () => ({ k: "returnToDeck", obj: 1 })],
  [/^archive (.+)$/, () => ({ k: "archive", obj: 1 })],
  [/^use (.+)$/, () => ({ k: "use", obj: 1 })],
  [/^(.+?) captures? (\d+) amber$/, (m) => ({ k: "capture", n: +m[2], obj: 1 })],
];

/** A printed sentence. A leading "You may" makes every act of the sentence
    optional — the actor chooses whether it resolves (keyteki optional). */
function parseSentence(sentence: string, upgrade: boolean, creature: boolean, quoted: string[]): Sentence | null {
  const may = sentence.match(/^you may:? (.+)$/);
  const parsed = parseSentenceBody(may ? may[1] : sentence, upgrade, creature, quoted);
  if (parsed && may) {
    parsed.optional = true;
    for (const act of parsed.acts) act.optional = true;
  }
  return parsed;
}

function parseSentenceBody(sentence: string, upgrade: boolean, creature: boolean, quoted: string[]): Sentence | null {
  const conditional = sentence.match(/^if ([^,]+), (.+)$/) ?? sentence.match(/^(.+?) if (you control more creatures than your opponent)$/);
  if (conditional) {
    const [condText, rest] = sentence.startsWith("if ") ? [conditional[1], conditional[2]] : [conditional[2], conditional[1]];
    const cond = parseCondition(condText);
    const body = cond && parseSentence(rest, upgrade, creature, quoted);
    return body && !body.cond ? { ...body, cond } : null;
  }

  // A sentence that sets a lasting effect ("… on their next turn") rather than
  // resolving now (keyteki lastingEffect / duringOpponentNextTurn).
  const persistent = parsePersistent(sentence, upgrade, creature, quoted);
  if (persistent) return { acts: persistent.map((e) => ({ k: "lasting", e })) };

  for (const [pattern, build] of SIMPLE) {
    const m = sentence.match(pattern);
    if (m) return { acts: [build(m)] };
  }

  const capture = sentence.match(/^capture (\d+) amber$/);
  if (capture) return creature || upgrade ? { acts: [{ k: "capture", n: +capture[1], s: upgrade ? "host" : "self" }] } : null;
  const chooseCapture = sentence.match(/^choose (a friendly creature) to capture (\d+) amber$/);
  if (chooseCapture) return { acts: [{ k: "capture", n: +chooseCapture[2], s: "target" }], target: { type: "Creature", side: "friendly" } };

  const stunExhaust = sentence.match(/^stun and exhaust (.+)$/);
  if (stunExhaust) {
    const object = parseObject(stunExhaust[1], upgrade);
    return object ? { acts: [{ k: "stun", s: object.s }, { k: "exhaust", s: object.s }], target: object.target } : null;
  }

  for (const [pattern, build] of VERBS) {
    const m = sentence.match(pattern);
    if (!m) continue;
    const { k, n, obj } = build(m);
    const object = parseObject(m[obj], upgrade);
    if (!object) return null;
    // keyteki's UseAction only affects creatures that can be used right now.
    if (k === "use" && object.target) object.target.ready = true;
    return { acts: [{ k, n: n ?? 0, s: object.s } as Act], target: object.target };
  }
  return null;
}

function parseAbility(triggers: Trigger[], body: string, upgrade: boolean, creature: boolean, quoted: string[]): Ability | null {
  const ability: Ability = { on: triggers, acts: [] };
  for (const sentence of body.split(/\.\s*/).map((part) => part.trim()).filter(Boolean)) {
    const parsed = parseSentence(sentence, upgrade, creature, quoted);
    if (!parsed) return null;
    if (parsed.target) {
      if (ability.target) return null;
      ability.target = parsed.target;
    }
    if (parsed.cond) {
      // "If …, X. Y." gates only X in the printed text; a gate in a later
      // sentence cannot be expressed as one ability condition.
      if (ability.acts.length || ability.if) return null;
      ability.if = parsed.cond;
    }
    ability.acts.push(...parsed.acts);
  }
  if (!ability.acts.length) return null;
  // Every act optional and the whole ability is a single "You may" clause.
  if (ability.acts.every((act) => act.optional)) ability.optional = true;
  // "Sacrifice X. Destroy an artifact." — the sacrifice consumed the source, so
  // the printed target cannot be the source itself (BUG-10).
  if (ability.target && ability.acts.some((act) => act.k === "destroy" && "s" in act && act.s === "self")) {
    ability.target = { ...ability.target, other: true };
  }
  return ability;
}

// ---------- persistent text (constant effects and lasting grants) ----------

/** Quoted ability inside a persistent sentence. The body is masked before the
    trigger-prefix scan, so a "Reap:" inside quotes cannot split the sentence;
    the quoted text is re-parsed with the same grammar when the grant is read. */
const QUOTED_ABILITY = /(['"])((?:play|reap|fight|destroyed|omni|action|scrap|before|after)[^'"]{2,300})\1/gi;

function maskQuotes(text: string): { text: string; quoted: string[] } {
  const quoted: string[] = [];
  const masked = text.replace(QUOTED_ABILITY, (_match, _quote, inner: string) => {
    quoted.push(inner);
    return `\u0001${quoted.length - 1}\u0001`;
  });
  return { text: masked, quoted };
}

const FLANK_CLAUSE = / while (?:it|this creature|this card) is on a flank$/;

/** Subject of a persistent sentence: the cards the effect applies to. */
function parseSubject(phrase: string, upgrade: boolean): Filter | null {
  if (/^(this card|this creature|it|itself)$/.test(phrase)) {
    return upgrade && phrase === "this creature" ? { host: true } : { self: true };
  }
  if (phrase === "each of this card's neighbors" || phrase === "each neighbor of this card") return { neighborsOfSource: true };
  const match = phrase.match(/^(?:each |all |your |each of your )?(other )?(friendly |enemy )?(flank )?(creature|artifact)s?$/);
  if (!match) return null;
  const filter: Filter = { type: match[4] === "artifact" ? "Artifact" : "Creature" };
  if (match[1]) filter.other = true;
  if (match[2]) filter.side = match[2].trim() === "friendly" ? "friendly" : "enemy";
  if (match[3]) filter.flank = true;
  return filter;
}

/** "<subject> gets +N power[/+N armor]" — the classic persistent modifier. */
function parseStats(sentence: string, upgrade: boolean): PersistentEffect | null {
  const match = sentence.match(/^(.+?) (?:gets|get) ([+-]\d+) (power|armor)(?: and ([+-]\d+) (power|armor))?$/);
  if (!match) return null;
  const target = parseSubject(match[1], upgrade);
  if (!target) return null;
  const effect: PersistentEffect = { target };
  const add = (key: "power" | "armor", value: string) => (effect[key] = (effect[key] ?? 0) + Number(value));
  add(match[3] as "power" | "armor", match[2]);
  if (match[5]) add(match[5] as "power" | "armor", match[4]);
  return effect;
}

/** "<subject> gains <keyword>" or "<subject> gains '<ability text>'". */
function parseGrant(sentence: string, upgrade: boolean, creature: boolean, quoted: string[]): PersistentEffect | null {
  const grant = sentence.match(/^(.+?) gains?,? \u0001(\d+)\u0001$/);
  if (grant) {
    const target = parseSubject(grant[1], upgrade);
    const ability = target && parseQuoted(quoted[Number(grant[2])], upgrade, creature, quoted);
    return ability ? { target, abilities: [ability] } : null;
  }
  const keyword = sentence.match(/^(.+?) gains? ([a-z-]+(?: \d+)?)$/);
  if (!keyword) return null;
  const target = parseSubject(keyword[1], upgrade);
  const parsed = readKeyword(keyword[2]);
  return target && parsed ? { target, keywords: { [parsed[0]]: parsed[1] } } : null;
}

/** Body of a quoted grant ("Reap: Gain 1A.") through the same parser. */
function parseQuoted(inner: string, upgrade: boolean, creature: boolean, quoted: string[]): Ability | null {
  const match = inner.match(
    /^((?:play|reap|fight|destroyed|omni|action|scrap|before [^:.]{1,90}|after [^:.]{1,90})(?:\/(?:play|reap|fight|destroyed))*)\s*:\s*(.+)$/i,
  );
  if (!match) return null;
  const triggers = match[1].split("/").map((part) => triggerFor(part));
  return triggers.every((trigger): trigger is Trigger => trigger !== undefined)
    ? parseAbility(triggers, match[2], upgrade, creature, quoted)
    : null;
}

const RESTRICT_TYPES: Record<string, string> = { action: "Action", creature: "Creature", artifact: "Artifact", upgrade: "Upgrade" };

/** "You cannot play/use/fight …" — a prohibition (keyteki effects.playerCannot). */
function parseRestriction(sentence: string): Restrict | null {
  const head = sentence.match(/^(you|your opponent) cannot (play|use|fight)(.*)$/);
  if (!head) return null;
  const restrict: Restrict = { who: head[1] === "you" ? "you" : "opponent", action: head[2] as Restrict["action"] };
  const rest = head[3];
  const limit = rest.match(/^ more than (\d+) cards?$/);
  if (limit) {
    restrict.limit = Number(limit[1]);
    return restrict;
  }
  if (rest.match(/^ creatures to fight$/)) return { ...restrict, action: "fight" };
  const type = rest.match(/^ (action|creature|artifact|upgrade)s?(?: cards?)?$/);
  if (type) return { ...restrict, type: RESTRICT_TYPES[type[1]] };
  if (rest.match(/^ (?:any )?cards?$/)) return restrict;
  return null;
}

/** Constant text of a card (and the body of a triggered sentence that sets a
    lasting one): stats, grants and prohibitions. Returns every part of the
    sentence it understood, or null when the wording is outside the grammar. */
function parsePersistent(sentence: string, upgrade: boolean, creature: boolean, quoted: string[]): PersistentEffect[] | null {
  let body = sentence;
  let duration: PersistentEffect["duration"];
  const prefix = body.match(/^for the remainder of the turn, (.+)$/);
  if (prefix) {
    body = prefix[1];
    duration = "turn";
  }
  const tail = body.match(/ (for the remainder of the turn|on their next turn|during their next turn|each turn)$/);
  if (tail) {
    if (tail[1] !== "each turn") duration = tail[1].includes("next turn") ? "next" : "turn";
    body = body.slice(0, -tail[0].length);
  }
  const restrict = parseRestriction(body);
  if (restrict) return [{ target: {}, restrict, duration }];
  let when: PersistentEffect["when"];
  const flank = body.match(FLANK_CLAUSE);
  if (flank) {
    body = body.slice(0, -flank[0].length);
    when = "flank";
  }
  const stats = parseStats(body, upgrade);
  if (stats) return [{ ...stats, when, duration }];
  const grant = parseGrant(body, upgrade, creature, quoted);
  return grant ? [{ ...grant, when, duration }] : null;
}

export function parseCardText(face: CardFace): CardRules {
  try {
    return parseCardBody(face);
  } catch {
    // A parser gap must never take the app down with it (BUG-01 was a white
    // screen): an unreadable card degrades to vanilla, like any text the
    // grammar does not understand.
    return { abilities: [], effects: [], keywords: {}, coverage: "vanilla" };
  }
}

function parseCardBody(face: CardFace): CardRules {
  const { text, quoted } = maskQuotes(normalise(face.text ?? ""));
  // Self references only inside ability text, so a card named like a keyword keeps its keywords.
  const self = new RegExp(`\\b${normalise(face.title).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  const upgrade = face.type === "Upgrade";
  const creature = face.type === "Creature";
  const segments: { prefix: string | null; body: string }[] = [];
  let last = 0;
  let prefix: string | null = null;
  for (const match of text.matchAll(PREFIX)) {
    segments.push({ prefix, body: text.slice(last, match.index) });
    prefix = match[1];
    last = (match.index ?? 0) + match[0].length;
  }
  segments.push({ prefix, body: text.slice(last) });

  const header = segments[0].body.split(/\.\s*/).map((part) => part.trim()).filter(Boolean);
  const keywords = printedKeywords(face, header);
  let understood = 0;
  let unknown = 0;
  const abilities: Ability[] = [];
  const effects: PersistentEffect[] = [];

  // Constant text: keywords and persistent effects that live while the card is in play.
  for (const sentence of header) {
    if (readKeyword(sentence)) continue;
    const parsed = parsePersistent(sentence.replace(self, "this card"), upgrade, creature, quoted);
    if (parsed) {
      effects.push(...parsed);
      understood += 1;
    } else {
      unknown += 1;
    }
  }

  for (const { prefix: raw, body } of segments.slice(1)) {
    const triggers = raw!.split("/").map((part) => triggerFor(part));
    const ability = triggers.every((trigger): trigger is Trigger => trigger !== undefined)
      ? parseAbility(triggers, body.replace(self, "this card"), upgrade, creature, quoted)
      : null;
    if (ability) {
      abilities.push(ability);
      understood += 1;
    } else {
      unknown += 1;
    }
  }

  const coverage = unknown === 0 ? "full" : understood === 0 ? "vanilla" : "partial";
  return { abilities, effects, keywords, coverage };
}
