// SPDX-License-Identifier: AGPL-3.0-only
// card_text -> ability parser for Aember Arena. No NLP: a fixed grammar of the
// trigger prefixes printed on real cards and of the verb phrases whose semantics
// were ported from keyteki's GameActions (Copyright (C) keyteki contributors,
// AGPL-3.0). An ability is used only when EVERY sentence of it is understood;
// otherwise it is dropped and the card's coverage becomes "partial"/"vanilla",
// so the engine never half-resolves a card.
import type { Ability, Act, CardRules, Condition, Filter, Selection, Trigger } from "./abilities";
import { printedKeywords, readKeyword } from "./keywords";
import type { CardFace } from "./game";

/** Every trigger prefix printed on cards. The ones without an engine trigger
    (After X:, Interrupt:, Scrap: …) are recognised only to be reported as
    unsupported instead of leaking into the previous ability. */
const PREFIX = /\b((?:play|reap|fight|destroyed|omni|action|scrap|interrupt|after [^:.]{1,90}?|before [^:.]{1,90}?)(?:\/(?:play|reap|fight|destroyed))*)\s*:/gi;

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
};

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

function parseSentence(sentence: string, upgrade: boolean, creature: boolean): Sentence | null {
  const conditional = sentence.match(/^if ([^,]+), (.+)$/) ?? sentence.match(/^(.+?) if (you control more creatures than your opponent)$/);
  if (conditional) {
    const [condText, rest] = sentence.startsWith("if ") ? [conditional[1], conditional[2]] : [conditional[2], conditional[1]];
    const cond = parseCondition(condText);
    const body = cond && parseSentence(rest, upgrade, creature);
    return body && !body.cond ? { ...body, cond } : null;
  }

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

function parseAbility(triggers: Trigger[], body: string, upgrade: boolean, creature: boolean): Ability | null {
  const ability: Ability = { on: triggers, acts: [] };
  for (const sentence of body.split(/\.\s*/).map((part) => part.trim()).filter(Boolean)) {
    const parsed = parseSentence(sentence, upgrade, creature);
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
  // "Sacrifice X. Destroy an artifact." — the sacrifice consumed the source, so
  // the printed target cannot be the source itself (BUG-10).
  if (ability.target && ability.acts.some((act) => act.k === "destroy" && "s" in act && act.s === "self")) {
    ability.target = { ...ability.target, other: true };
  }
  return ability;
}

export function parseCardText(face: CardFace): CardRules {
  try {
    return parseCardBody(face);
  } catch {
    // A parser gap must never take the app down with it (BUG-01 was a white
    // screen): an unreadable card degrades to vanilla, like any text the
    // grammar does not understand.
    return { abilities: [], keywords: {}, coverage: "vanilla" };
  }
}

function parseCardBody(face: CardFace): CardRules {
  const text = normalise(face.text ?? "");
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
  let unknown = header.filter((sentence) => !readKeyword(sentence)).length;
  const abilities: Ability[] = [];

  for (const { prefix: raw, body } of segments.slice(1)) {
    const triggers = raw!.split("/").map((part) => TRIGGERS[part.trim()]);
    const ability = triggers.every(Boolean) ? parseAbility(triggers, body.replace(self, "this card"), upgrade, creature) : null;
    if (ability) {
      abilities.push(ability);
      understood += 1;
    } else {
      unknown += 1;
    }
  }

  const coverage = unknown === 0 ? "full" : understood === 0 ? "vanilla" : "partial";
  return { abilities, keywords, coverage };
}
