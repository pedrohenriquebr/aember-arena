// SPDX-License-Identifier: AGPL-3.0-only
// card_text -> ability parser for Aember Arena. No NLP: a fixed grammar of the
// trigger prefixes printed on real cards and of the verb phrases whose semantics
// were ported from keyteki's GameActions (Copyright (C) keyteki contributors,
// AGPL-3.0). An ability is used only when EVERY sentence of it is understood;
// otherwise it is dropped and the card's coverage becomes "partial"/"vanilla",
// so the engine never half-resolves a card.
import type { Ability, Act, CardRules, Condition, Count, Filter, PersistentEffect, Replacement, Restrict, Selection, Trigger, Zone } from "./abilities";
import { ENGINE_KEYWORDS, printedKeywords, readKeyword } from "./keywords";
import type { CardFace } from "./game";

/** Every trigger prefix printed on cards. The ones without an engine trigger
    (Interrupt:, Fate: …) are recognised only to be reported as unsupported
    instead of leaking into the previous ability. "After <event>:" is the
    post-event window and "Each time <event>:" fires on every occurrence. */
/** `fate` is here to SEGMENT ("Fate: …" must not leak into the ability before
    it): the trigger table has no entry for it, so the segment is reported as
    unsupported and the previous ability still counts. */
const PREFIX = /\b((?:play|reap|fight|destroyed|omni|action|scrap|interrupt|fate|each time [^:.]{1,90}?|at the (?:start|end) of [^:.]{1,90}?|after [^:.]{1,90}?|before [^:.]{1,90}?)(?:\/(?:after )?(?:play|reap|fight|destroyed))*)\s*:/gi;

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
  scrap: "scrap",
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

/** Version of the deterministic grammar. A stored `parser` row is the parser's
    own output frozen on disk, so it only counts while the parser that wrote it
    is the running one (abilities.storedAbility): bump this whenever the grammar
    changes what a text parses to. */
export const PARSER_VERSION = 3;

/** First pass, on the RAW print: private-use glyphs (Master Vault prints Æmber
    and damage as U+F360/F361), the typographic punctuation of the export, the
    byte-order mark and the `Enhance` line — a deck-building instruction whose
    icons arrive separately in `bonusIcons`, never an ability. The sentence is
    anchored at the start of a line so a card title containing "Enhance" is not
    eaten. Whatever private-use glyph is left is decoration and goes away. */
export function normalisePre(text: string): string {
  return (text ?? "")
    .replace(/\uF360/gi, "<A>")
    .replace(/\uF361/gi, "<D>")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2011\u2013]/g, "-")
    .replace(/\uFEFF/g, "")
    .replace(/(^|[.\n]\s*)enhance\b[^.:]*\./gi, "$1")
    .replace(/[\uF300-\uF5FF]/g, "");
}

/** Second pass: exactly the body of the pre-1.1 `normalise`, frozen because
    `textHash` is taken over it — the stored rows of the ability DB were keyed
    by this text and a change here would orphan all of them. */
function legacy(text: string): string {
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

/** Third pass: the glyphs legacy does not read because no number precedes them
    ("any <A> you would gain"). */
function normalisePost(text: string): string {
  return text
    .replace(/<a>/g, " amber")
    .replace(/<d>/g, " damage")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalise(text: string): string {
  return normalisePost(legacy(normalisePre(text)));
}

/** The printed text as the LLM prompt should carry it: glyphs readable as
    <A>/<D>, no parenthetical reminders and no Enhance line. Case is kept (the
    model reads the card, it does not run the grammar). */
export function readableText(text: string): string {
  return normalisePre(text ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Identity of a card's printed text (DB v4 `cards.textHash`, plano §3): the
    hash decides whether the ability store still matches the text — an entry
    written for a different text is ignored, exactly like the parser would be
    re-run. FNV-1a over the frozen `legacy` form, so whitespace/reminder/icon
    variants of the same print do not invalidate a stored DSL and the rows
    written before the three-pass normalisation keep their key. */
export function textHash(text: string): string {
  let hash = 0x811c9dc5;
  const source = legacy(text ?? "");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Printed house names, canonical form included: only a token from this closed
    list is read as a house ("non-Mars creature"). The text is lowercased by
    normalise, so the keys are lowercase too. */
const HOUSES: Record<string, string> = {
  brobnar: "Brobnar",
  dis: "Dis",
  logos: "Logos",
  mars: "Mars",
  sanctum: "Sanctum",
  shadows: "Shadows",
  untamed: "Untamed",
  "star alliance": "Star Alliance",
  saurian: "Saurian",
  unfathomable: "Unfathomable",
  ekwidon: "Ekwidon",
  geistoid: "Geistoid",
  skyborn: "Skyborn",
  redemption: "Redemption",
  keyraken: "Keyraken",
  ouboros: "Ouboros",
  rebels: "Rebels",
  elders: "Elders",
};

/** A KeyForge trait is a proper noun ("Knight", "Anemon"), so the case of the
    ORIGINAL print is what tells a trait from a conjunction, a keyword or a
    possessive ("Mars or Logos creature", "an elusive creature", "your
    opponent's creatures"). The grammar runs on lowercased text, so the
    capitalised words are collected once per card, before parsing. */
let properNouns: ReadonlySet<string> = new Set();

const collectProperNouns = (text: string): ReadonlySet<string> =>
  new Set(text.match(/\b[A-Z][a-zA-Z'\u2019-]*/g)?.map((word) => word.toLowerCase()));

/** Words that must never become a trait: the printed keywords, the
    conjunctions/articles/possessives and the participles that describe a state.
    The printed capitalisation is the first net; this list is the second. */
const NOT_TRAITS: ReadonlySet<string> = new Set([
  ...ENGINE_KEYWORDS,
  "overwhelm",
  "a",
  "an",
  "and",
  "the",
  "of",
  "or",
  "your",
  "their",
  "its",
  "my",
  "each",
  "non",
  "creature",
  "artifact",
  "stunned",
  "warded",
  "enraged",
  "poisoned",
  "token",
  "unique",
  "random",
  "chosen",
  "neighboring",
  "most",
  "powerful",
]);

/** One modifier before the noun of a filter phrase. Returns false when the word
    is outside every closed list. */
function applyModifier(filter: Filter, token: string): boolean {
  if (token === "other") filter.other = true;
  else if (token === "friendly" || token === "enemy") filter.side = token;
  else if (token === "damaged" || token === "undamaged") filter.damaged = token === "damaged";
  else if (token === "ready") filter.ready = true;
  else if (token === "exhausted") filter.exhausted = true;
  else if (token === "flank") filter.flank = true;
  else if (NOT_TRAITS.has(token)) return false;
  else {
    const negation = /^(?:non-|!)/.test(token);
    const name = token.replace(/^(?:non-|!)/, "");
    const house = HOUSES[name];
    if (house) filter.house = (negation ? "!" : "") + house;
    // Only a capitalised word is a trait; a possessive is never one.
    else if (properNouns.has(name) && !/'s$/.test(name)) filter.trait = (negation ? "!" : "") + name[0].toUpperCase() + name.slice(1);
    else return false;
  }
  return true;
}

/** "friendly mars flank creature" -> Filter. The noun ends the phrase (a flank
    clause may follow) and every other word must be a known modifier. */
function parseFilterWords(phrase: string): Filter | null {
  // "creature of the active house" reads state.activeHouse at query time.
  const rest = phrase.replace(/ of the active house$/, "");
  let words = rest;
  let flankClause: boolean | undefined;
  const tail = words.match(/^(.*?) (?:that is )?(not )?on a flank$/);
  if (tail) {
    words = tail[1];
    flankClause = !tail[2];
  }
  const tokens = words.split(" ");
  const noun = tokens.pop();
  if (noun !== "creature" && noun !== "creatures" && noun !== "artifact" && noun !== "artifacts") return null;
  const filter: Filter = { type: noun.startsWith("artifact") ? "Artifact" : "Creature" };
  if (flankClause !== undefined) filter.flank = flankClause;
  if (rest !== phrase) filter.house = "active";
  for (let index = 0; index < tokens.length; index += 1) {
    const pair = tokens[index + 1] ? HOUSES[`${tokens[index]} ${tokens[index + 1]}`] : undefined;
    if (pair) {
      filter.house = pair;
      index += 1;
    } else if (!applyModifier(filter, tokens[index])) return null;
  }
  return filter;
}

function parseObject(phrase: string, upgrade: boolean): { s: Selection; target?: Filter } | null {
  if (/^(this card|this creature|itself|it)$/.test(phrase)) return { s: upgrade && phrase === "this creature" ? "host" : "self" };
  if (phrase === "a creature and each of its neighbors") return { s: "targetAndNeighbors", target: { type: "Creature" } };
  if (/^each neighbor of the creature this card fights$/.test(phrase)) return { s: "neighborsOfFought" };
  // "The creature ~ fights" (Before Fight): the defender of the fight in progress.
  if (/^the creature (?:this card|it) fights?$/.test(phrase)) return { s: "fought" };
  // "Ward each of Old Egad's neighbors" — the source's own neighbors.
  if (/^(?:each of )?(?:this card's|its) neighbors?$/.test(phrase)) return { s: { each: { neighborsOfSource: true } } };
  const top = phrase.match(/^the (\d+) most powerful creatures$/);
  if (top) return { s: { each: { type: "Creature", top: Number(top[1]) } } };
  // "<verb> N (friendly|enemy) creatures": the engine picks the N cards.
  const many = phrase.match(/^(\d+) (.+)$/);
  if (many) {
    const filter = parseFilterWords(many[2]);
    return filter ? { s: { pick: filter, n: Number(many[1]) } } : null;
  }
  const m = phrase.match(/^(a|an|each)\s+(.+)$/);
  if (!m) return null;
  const filter = parseFilterWords(m[2]);
  if (!filter) return null;
  return m[1] === "each" ? { s: { each: filter } } : { s: "target", target: filter };
}

/** A `count` condition: a dynamic amount compared to a printed number. */
const count = (of: Count, op: "eq" | "gte" | "lte", n: number): Condition => ({ k: "count", of, op, n });

/** "Haunted" prints no number: it is the rulebook's 10+ cards in a discard pile. */
const HAUNTED = 10;

function parseCondition(clause: string): Condition | null {
  const amber = clause.match(/^(your opponent has|you have) (no|\d+) amber( or more)?$/);
  if (amber) {
    return { k: "amber", opp: amber[1] === "your opponent has", op: amber[2] === "no" ? "eq" : "gte", n: amber[2] === "no" ? 0 : Number(amber[2]) };
  }
  if (clause === "you control more creatures than your opponent") return { k: "moreCreatures" };
  if (clause === "your opponent controls more creatures than you") return { k: "fewerCreatures" };
  // "Overwhelmed" is the printed word for "the opponent has more creatures".
  if (clause === "you are overwhelmed") return { k: "fewerCreatures" };
  // Lote 2: "If you do" is the did-count of the act before (keyteki's `then`).
  if (clause === "you do") return count("did", "gte", 1);
  if (/^(?:this damage destroys that creature|that creature is destroyed|it is destroyed)$/.test(clause)) return count("gone", "gte", 1);
  if (/^(?:it|that creature) is not destroyed$/.test(clause)) return count("gone", "eq", 0);
  const haunted = clause.match(/^(you|your opponent) (?:is |are )?haunted$/);
  if (haunted) return { k: "count", of: { p: "discard", ...(haunted[1] === "you" ? {} : { opp: true }) }, op: "gte", n: HAUNTED };
  if (/^this (?:card|creature) is on a flank$/.test(clause)) return { k: "count", of: { c: { self: true, flank: true } }, op: "gte", n: 1 };
  if (/^this (?:card|creature) is exhausted$/.test(clause)) return { k: "count", of: { c: { self: true, exhausted: true } }, op: "gte", n: 1 };
  const none = clause.match(/^there (?:are|is) no (.+)$/);
  const filter = none ? parseFilterWords(none[1]) : null;
  return filter ? { k: "count", of: { c: filter }, op: "eq", n: 0 } : null;
}

/** The amount behind "for each X" (docs/DSL_EXPANSION_PLAN.md §2.1). */
function parsePer(phrase: string): Count | null {
  if (/^creatures? (?:healed|damaged) this way$/.test(phrase) || /^cards? discarded this way$/.test(phrase)) return "did";
  if (/^creatures? destroyed this way$/.test(phrase)) return "gone";
  const zone = phrase.match(/^cards? in your (hand|deck|discard(?: pile)?|archives|purged)$/);
  if (zone) return { p: (zone[1] === "discard pile" ? "discard" : zone[1]) as Zone };
  if (/^(?:forged )?keys? your opponent has$/.test(phrase)) return { p: "keys", opp: true };
  if (/^amber on (?:it|this card|this creature)$/.test(phrase)) return { of: "amber", s: "self" };
  if (/^damage on (?:it|this card|this creature)$/.test(phrase)) return { of: "damage", s: "self" };
  // "each of ~'s <House> neighbors" (the "for each" already went by).
  const neighbors = phrase.match(/^(?:each )?of (?:this card's|its) (.+?) neighbors$/);
  if (neighbors) return HOUSES[neighbors[1]] ? { c: { neighborsOfSource: true, house: HOUSES[neighbors[1]] } } : null;
  const filter = parseFilterWords(phrase);
  return filter ? { c: filter } : null;
}

interface Sentence {
  acts: Act[];
  target?: Filter;
  cond?: Condition;
  optional?: boolean;
}

const SIMPLE: [RegExp, (m: RegExpMatchArray) => Act][] = [
  [/^gain (\d+) amber$/, (m) => ({ k: "gainAmber", n: +m[1] })],
  [/^your opponent gains (\d+) amber$/, (m) => ({ k: "gainAmber", n: +m[1], opp: true })],
  [/^your opponent loses (\d+) amber$/, (m) => ({ k: "loseAmber", n: +m[1], opp: true })],
  [/^lose (\d+) amber$/, (m) => ({ k: "loseAmber", n: +m[1] })],
  [/^steal (\d+) amber$/, (m) => ({ k: "steal", n: +m[1] })],
  [/^gain (a|\d+) chains?$/, (m) => ({ k: "gainChains", n: num(m[1]) })],
  [/^draw (a|\d+) cards?$/, (m) => ({ k: "draw", n: num(m[1]) })],
  [/^your opponent draws (a|\d+) cards?$/, (m) => ({ k: "draw", n: num(m[1]), opp: true })],
  [/^your opponent discards (a|\d+) random cards?(?: from their hand)?$/, (m) => ({ k: "discardRandom", n: num(m[1]), opp: true })],
  [/^keys cost \+(\d+) (?:amber )?during your opponent's next turn$/, (m) => ({ k: "keyCost", n: +m[1], opp: true })],
  [/^archive the top card of your deck$/, () => ({ k: "archiveTop" })],
  // Onda 3: tokens nascem na mesa (keyteki MakeTokenCreatureAction).
  [/^(?:make|create) (a|an|\d+) token creatures?$/, (m) => ({ k: "makeToken", n: num(m[1]) })],
  // Onda 4: forjar/desforjar fora do passo de chave (keyteki ForgeAction e
  // UnforgeAction — todo texto "unforge" impresso mira a chave do oponente).
  [/^forge (?:another )?a? ?key at current cost$/, () => ({ k: "forgeKey", n: 1 })],
  [/^forge (?:another )?a? ?key at no cost$/, () => ({ k: "forgeKey", n: 1, free: true })],
  [/^forge (?:another )?a? ?key at \+(\d+)(?: amber)?(?: current)?(?: cost)?$/, (m) => ({ k: "forgeKey", n: 1, mod: Number(m[1]) })],
  [/^unforge (?:your )?(?:an? )?(?:opponent's|opponents'?|enemy) keys?$/, () => ({ k: "unforgeKey", n: 1 })],
  [/^return a card from your discard pile to your hand$/, () => ({ k: "fromDiscard" })],
  [/^return a creature from your discard pile to your hand$/, () => ({ k: "fromDiscard", type: "Creature" })],
  // Lote 2 (§2.6): the zone moves of the player, one act for mill, discard,
  // archive and purge. "the top" of a deck is the end of the array (game.move).
  [/^discard the top(?: (\d+))? cards? of (your|your opponent's) deck$/, (m) => ({
    k: "move",
    n: m[1] ? Number(m[1]) : 1,
    from: "deck",
    to: "discard",
    pick: "top",
    ...(m[2] === "your opponent's" ? { opp: true } : {}),
  })],
  [/^archive (a|an|\d+) cards?$/, (m) => ({ k: "move", n: num(m[1]), from: "hand", to: "archives" })],
  [/^discard (a|an|\d+) cards?(?: from your hand)?$/, (m) => ({ k: "move", n: num(m[1]), from: "hand", to: "discard" })],
  [/^discard your hand$/, () => ({ k: "move", n: 1, from: "hand", to: "discard", pick: "all" })],
  [/^your opponent purges a random card from their hand$/, () => ({ k: "move", n: 1, from: "hand", to: "purged", opp: true, pick: "random" })],
  [/^purge (a|an|\d+) (creature|card)s? from your discard pile$/, (m) => ({
    k: "move",
    n: num(m[1]),
    from: "discard",
    to: "purged",
    ...(m[2] === "creature" ? { type: "Creature" } : {}),
  })],
  [/^shuffle your discard pile into your deck$/, () => ({ k: "move", n: 1, from: "discard", to: "deck", pick: "all", at: "shuffle" })],
];

// Each verb declares which capture group holds the object phrase; assuming a
// group that a sibling regex does not have crashes parseObject (BUG-01).
const VERBS: [RegExp, (m: RegExpMatchArray) => { k: Act["k"]; n?: number; obj: number; at?: "bottom" | "shuffle" }][] = [
  [/^destroy (.+)$/, () => ({ k: "destroy", obj: 1 })],
  [/^purge (.+)$/, () => ({ k: "purge", obj: 1 })],
  [/^sacrifice (.+)$/, () => ({ k: "sacrifice", obj: 1 })],
  [/^exalt (.+?)( twice)?$/, (m) => ({ k: "exalt", n: m[2] ? 2 : 1, obj: 1 })],
  [/^deal (\d+)(?: damage)? to (.+)$/, (m) => ({ k: "damage", n: +m[1], obj: 2 })],
  [/^stun (.+)$/, () => ({ k: "stun", obj: 1 })],
  [/^exhaust (.+)$/, () => ({ k: "exhaust", obj: 1 })],
  [/^ready (.+)$/, () => ({ k: "ready", obj: 1 })],
  [/^unstun (.+)$/, () => ({ k: "unstun", obj: 1 })],
  [/^heal (\d+) damage from (.+)$/, (m) => ({ k: "heal", n: +m[1], obj: 2 })],
  [/^fully heal (.+)$/, () => ({ k: "heal", n: 99, obj: 1 })],
  [/^return (.+?) to (?:its|their) owners?'s? hands?$/, () => ({ k: "returnToHand", obj: 1 })],
  [/^return (.+?) to your hand$/, () => ({ k: "returnToHand", obj: 1 })],
  [/^put (.+) on top of your deck$/, () => ({ k: "returnToDeck", obj: 1 })],
  // Lote 2 (§2.6): where the card lands in its owner's deck.
  [/^put (.+?) on (?:the )?bottom of (?:its|their) owners?'s? de(?:ck)s?$/, () => ({ k: "returnToDeck", obj: 1, at: "bottom" })],
  [/^shuffle (.+?) into (?:its|their) owners?'s? de(?:ck)s?$/, () => ({ k: "returnToDeck", obj: 1, at: "shuffle" })],
  [/^archive (.+)$/, () => ({ k: "archive", obj: 1 })],
  [/^use (.+)$/, () => ({ k: "use", obj: 1 })],
  // Onda 4: tokens de set e troca de controle ("Ward a creature", "Ward each
  // creature", "Enrage a creature", "Take control of an enemy creature",
  // "Gain control of an enemy artifact"). A counted target ("Ward 2 friendly
  // creatures") needs a multi-target choice the move model does not have, so
  // the sentence stays unparsed instead of resolving only half of it.
  [/^ward (.+)$/, () => ({ k: "ward", obj: 1 })],
  [/^remove (?:the |a )?ward(?: token)? from (.+)$/, () => ({ k: "removeWard", obj: 1 })],
  [/^enrage (.+)$/, () => ({ k: "enrage", obj: 1 })],
  [/^remove (?:the |a )?enrage(?: token)? from (.+)$/, () => ({ k: "removeEnrage", obj: 1 })],
  [/^(?:take|gain) control of (.+)$/, () => ({ k: "takeControl", obj: 1 })],
  [/^(.+?) captures? (\d+) amber$/, (m) => ({ k: "capture", n: +m[2], obj: 1 })],
];

/** A printed sentence. A leading "You may" makes every act of the sentence
    optional — the actor chooses whether it resolves (keyteki optional). */
function parseSentence(sentence: string, upgrade: boolean, creature: boolean, quoted: string[]): Sentence | null {
  const may = sentence.match(/^you may:? (.+)$/);
  let body = may ? may[1] : sentence;
  // "… for each <count>" (either side of the clause): the dynamic amount of
  // every act of the sentence (docs/DSL_EXPANSION_PLAN.md §2.1).
  let per: Count | null = null;
  const suffix = body.match(/^(.+?) for each (.+)$/);
  const prefix = body.match(/^for each (.+?), (.+)$/);
  if (suffix) {
    per = parsePer(suffix[2]);
    if (!per) return null;
    body = suffix[1];
  } else if (prefix) {
    per = parsePer(prefix[1]);
    if (!per) return null;
    body = prefix[2];
  }
  const parsed = parseSentenceBody(body, upgrade, creature, quoted);
  if (parsed && per) {
    for (const act of parsed.acts) {
      if (act.k === "lasting") act.e.per = per;
      else act.per = per;
    }
  }
  if (parsed && may) {
    parsed.optional = true;
    for (const act of parsed.acts) act.optional = true;
  }
  return parsed;
}

function parseSentenceBody(sentence: string, upgrade: boolean, creature: boolean, quoted: string[]): Sentence | null {
  // "If you do, X" (keyteki's `then`) is the did-count of the clause before it,
  // so the conditional branch below reads it as a condition on X.
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
  // "Each player gains N" is two acts on the same side of the table (me first).
  const eachGains = sentence.match(/^each player gains (\d+) amber$/);
  if (eachGains) return { acts: [{ k: "gainAmber", n: +eachGains[1] }, { k: "gainAmber", n: +eachGains[1], opp: true }] };
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
    const { k, n, obj, at } = build(m);
    const object = parseObject(m[obj], upgrade);
    if (!object) return null;
    // keyteki's UseAction only affects creatures that can be used right now.
    if (k === "use" && object.target) object.target.ready = true;
    // An s-only verb carries no `n` at all (the number belongs to the verbs that
    // read one) — the few-shots and the schema teach exactly this shape.
    return { acts: [{ k, s: object.s, ...(n === undefined ? {} : { n }), ...(at ? { at } : {}) } as Act], target: object.target };
  }
  return null;
}

/** The abilities of one printed segment. One segment can hold TWO abilities:
    "If you are overwhelmed, steal 2A. Otherwise, steal 1A." closes the first
    one and opens a twin with the negated condition. The negation is the whole
    point — a second `if:{k:"not"}` can never be expressed as one ability. */
function parseAbilities(triggers: Trigger[], body: string, upgrade: boolean, creature: boolean, quoted: string[]): Ability[] | null {
  const done: Ability[] = [];
  let ability: Ability = { on: triggers, acts: [] };
  const close = (): boolean => {
    if (!ability.acts.length) return false;
    // Every act optional and the whole ability is a single "You may" clause.
    if (ability.acts.every((act) => act.optional)) ability.optional = true;
    // "Sacrifice X. Destroy an artifact." — the sacrifice consumed the source, so
    // the printed target cannot be the source itself (BUG-10).
    if (ability.target && ability.acts.some((act) => (act.k === "destroy" || act.k === "sacrifice") && "s" in act && act.s === "self")) {
      ability.target = { ...ability.target, other: true };
    }
    done.push(ability);
    return true;
  };
  for (const sentence of body.split(/\.\s*/).map((part) => part.trim()).filter(Boolean)) {
    // The branch of an "Otherwise" is only legal right after a conditional
    // clause, and it negates the condition printed BEFORE it.
    const otherwise = sentence.match(/^otherwise,? (.+)$/);
    if (otherwise) {
      const condition = ability.if;
      if (!condition || !close()) return null;
      ability = { on: triggers, if: { k: "not", c: condition }, acts: [] };
    }
    const parsed = parseSentence(otherwise ? otherwise[1] : sentence, upgrade, creature, quoted);
    if (!parsed) return null;
    // "You may X. If you do, Y.": declining X declines Y too, so the dependent
    // clause inherits the optional flag of the clause before it.
    if (!otherwise && /^if you do,? /.test(sentence) && ability.acts.length && ability.acts.every((act) => act.optional)) {
      for (const act of parsed.acts) act.optional = true;
    }
    if (parsed.target) {
      if (ability.target) {
        // A later "a/an … creature" sentence has no `target` slot left: those
        // cards are engine-picked (the player only chooses the first target).
        for (const act of parsed.acts) if ("s" in act && act.s === "target") act.s = { pick: parsed.target };
      } else ability.target = parsed.target;
    }
    if (parsed.cond) {
      // The condition the ability OPENS with gates the whole ability (it keeps
      // the AI's pruning); one printed in a later clause gates only its own
      // acts — "Damage a creature. If it is not destroyed, draw a card."
      if (!ability.acts.length && !ability.if) ability.if = parsed.cond;
      else for (const act of parsed.acts) act.if = parsed.cond;
    }
    ability.acts.push(...parsed.acts);
  }
  return close() ? done : null;
}

// ---------- persistent text (constant effects and lasting grants) ----------

/** Quoted ability inside a persistent sentence. The body is masked before the
    trigger-prefix scan, so a "Reap:" inside quotes cannot split the sentence;
    the quoted text is re-parsed with the same grammar when the grant is read.
    A double-quoted ability may contain apostrophes ("its owner's") — the
    typographic quotes were already mapped to `"` by the first pass. */
const QUOTED_ABILITY =
  /"((?:play|reap|fight|destroyed|omni|action|scrap|before|after|at the)[^"]{2,300})"|'((?:play|reap|fight|destroyed|omni|action|scrap|before|after|at the)[^']{2,300})'/gi;

function maskQuotes(text: string): { text: string; quoted: string[] } {
  const quoted: string[] = [];
  const masked = text.replace(QUOTED_ABILITY, (_match, double: string, single: string) => {
    quoted.push(double ?? single);
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
  if (/^(?:(?:each of (?:this card's|its)|each) neighbors?|each neighbor of this card)$/.test(phrase)) return { neighborsOfSource: true };
  // "Each friendly Knight creature gets +1 power": the same closed lists as the
  // act objects (houses, traits, states).
  const head = phrase.match(/^(?:each of your |each of its |each |all |your )(.+)$/);
  return head ? parseFilterWords(head[1]) : null;
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
    if (!target) return null;
    const abilities = parseQuoted(quoted[Number(grant[2])], upgrade, creature, quoted);
    return abilities ? { target, abilities } : null;
  }
  const keyword = sentence.match(/^(.+?) gains? ([a-z-]+(?: \d+)?)$/);
  if (!keyword) return null;
  const target = parseSubject(keyword[1], upgrade);
  const parsed = readKeyword(keyword[2]);
  return target && parsed ? { target, keywords: { [parsed[0]]: parsed[1] } } : null;
}

/** Body of a quoted grant ("Reap: Gain 1A.") through the same parser. */
function parseQuoted(inner: string, upgrade: boolean, creature: boolean, quoted: string[]): Ability[] | null {
  const match = inner.match(
    /^((?:play|reap|fight|destroyed|omni|action|scrap|before [^:.]{1,90}|after [^:.]{1,90}|at the [^:.]{1,90})(?:\/(?:after )?(?:play|reap|fight|destroyed))*)\s*:\s*(.+)$/i,
  );
  if (!match) return null;
  const triggers = match[1].split("/").map((part) => triggerFor(part));
  return triggers.every((trigger): trigger is Trigger => trigger !== undefined)
    ? parseAbilities(triggers, match[2], upgrade, creature, quoted)
    : null;
}

const RESTRICT_TYPES: Record<string, string> = { action: "Action", creature: "Creature", artifact: "Artifact", upgrade: "Upgrade" };

/** "Instead" replacements of an engine default (Onda 4): a destroyed card that
    leaves play to another zone, or damage redirected to this card. Supported
    forms, all constant text:
      "If this creature would be destroyed, archive it instead."
      "… return it to your hand instead." / "… purge it instead." /
      "… put it on top of your deck instead."
      "When a creature would enter a discard pile from play, it is purged instead."
      "Damage dealt to [non-<trait>] neighbors is dealt to this creature instead."
    The trait exception of the redirect form is not modelled (the filter has no
    trait clause) — see docs/MECHANICS_REPORT.md §6. */
const LEAVE_INSTEAD: Record<string, Replacement["to"]> = {
  "archive it": "archives",
  "return it to your hand": "hand",
  "put it on top of your deck": "deck",
  "purge it": "purged",
};

function parseReplacement(sentence: string): PersistentEffect | null {
  const self = sentence.match(/^if (?:this creature|this card|it) would be destroyed, (?:instead )?(.+?) instead$/);
  if (self) {
    const to = LEAVE_INSTEAD[self[1]];
    return to ? { target: { self: true }, replace: { on: "destroy", to } } : null;
  }
  const pile = sentence.match(/^when a creature would enter a discard pile from play, it is (purged|archived) instead$/);
  if (pile) return { target: { type: "Creature" }, replace: { on: "destroy", to: pile[1] === "purged" ? "purged" : "archives" } };
  const redirect = sentence.match(/^damage dealt to (?:non-\w+ )?neighbors is dealt to (?:this creature|this card|it) instead$/);
  return redirect ? { target: { neighborsOfSource: true }, replace: { on: "damage", redirect: true } } : null;
}

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
    lasting one): stats, grants, prohibitions and key costs. Returns every part
    of the sentence it understood, or null when the wording is outside the
    grammar. */
function parsePersistent(sentence: string, upgrade: boolean, creature: boolean, quoted: string[]): PersistentEffect[] | null {
  let body = sentence;
  let duration: PersistentEffect["duration"];
  let per: Count | null = null;
  let condition: Condition | null = null;
  const prefix = body.match(/^for the remainder of the turn, (.+)$/);
  if (prefix) {
    body = prefix[1];
    duration = "turn";
  }
  // "While <condition>, X" / "For each <count>, X" gate or scale the effect.
  // A clause that is neither leaves the sentence to the branches below ("If
  // this creature would be destroyed, archive it instead" is a replacement).
  const clause = body.match(/^(while|for each|if) (.+?), (.+)$/);
  if (clause) {
    const counted = clause[1] === "for each" ? parsePer(clause[2]) : undefined;
    const cond = clause[1] === "for each" ? undefined : parseCondition(clause[2]);
    if (counted || cond) {
      per = counted ?? null;
      condition = cond ?? null;
      body = clause[3];
    }
  }
  const tail = body.match(/ (for the remainder of the turn|on their next turn|during their next turn|each turn)$/);
  if (tail) {
    if (tail[1] !== "each turn") duration = tail[1].includes("next turn") ? "next" : "turn";
    body = body.slice(0, -tail[0].length);
  }
  const scaled = body.match(/ for each (.+)$/);
  if (scaled) {
    const counted = parsePer(scaled[1]);
    if (!counted) return null;
    per = counted;
    body = body.slice(0, -scaled[0].length);
  }
  /** The `if`/`per` every branch of the sentence must carry. */
  const gate: Partial<PersistentEffect> = { ...(per ? { per } : {}), ...(condition ? { if: condition } : {}) };
  // "Your opponent's keys cost +N": opp only for the wording that names the
  // opponent, so a plain "keys cost +N" charges BOTH players (two effects).
  const keys = body.match(/^(your opponent's )?keys cost \+(\d+)(?: amber)?$/);
  if (keys) {
    const keyCost = Number(keys[2]);
    const effect: PersistentEffect = { target: {}, keyCost, ...gate };
    const effects: PersistentEffect[] = keys[1] ? [{ ...effect, opp: true }] : [effect, { ...effect, opp: true }];
    return effects.map((item) => ({ ...item, duration }));
  }
  const restrict = parseRestriction(body);
  if (restrict) return [{ target: {}, restrict, duration, ...gate }];
  const replacement = parseReplacement(body);
  if (replacement) return [{ ...replacement, duration, ...gate }];
  let when: PersistentEffect["when"];
  const flank = body.match(FLANK_CLAUSE);
  if (flank) {
    body = body.slice(0, -flank[0].length);
    when = "flank";
  }
  const stats = parseStats(body, upgrade);
  if (stats) return [{ ...stats, when, duration, ...gate }];
  const grant = parseGrant(body, upgrade, creature, quoted);
  return grant ? [{ ...grant, when, duration, ...gate }] : null;
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
  properNouns = collectProperNouns(face.text ?? "");
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
    const parsed = triggers.every((trigger): trigger is Trigger => trigger !== undefined)
      ? parseAbilities(triggers, body.replace(self, "this card"), upgrade, creature, quoted)
      : null;
    if (parsed) {
      abilities.push(...parsed);
      understood += 1;
    } else {
      unknown += 1;
    }
  }

  const coverage = unknown === 0 ? "full" : understood === 0 ? "vanilla" : "partial";
  return { abilities, effects, keywords, coverage };
}
