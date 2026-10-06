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
    post-event window and "Each time <event>:" fires on every occurrence.
    Observer sentences print no colon ("After an enemy creature reaps, stun
    it."): the second branch segments them at the comma and the acts follow in
    the same sentence. */
/** `fate` is here to SEGMENT ("Fate: …" must not leak into the ability before
    it): the trigger table has no entry for it, so the segment is reported as
    unsupported and the previous ability still counts. */
const PREFIX_SRC =
  "\\b((?:play|reap|fight|destroyed|omni|action|scrap|interrupt|fate" +
    "|each time [^:.]{1,90}?|at the (?:start|end) of [^:.]{1,90}?" +
    "|after [^:.]{1,90}?|before [^:.]{1,90}?)" +
    "(?:\\/(?:after )?(?:play|reap|fight|destroyed))*)\\s*:" +
    // A turn trigger printed with a comma ("At the end of your turn, if ~ is
    // exhausted, …") instead of a colon. Segmenting here lets the condition
    // become the ability's `if` (Lote 4 §4.2) instead of leaking the whole
    // sentence into the constant-text pass.
    "|\\b(at the (?:start|end) of your turn)(?=\\s*,)" +
    "|\\b((?:after|each time) (?:(?:a|an) (?:friendly |enemy )?creatures? (?:reaps?|fights?|is destroyed)" +
    "|(?:you|your opponent) plays? a creature|you (?:use|uses) an artifact))(?=\\s*,)" +
    // Lote 5 §5.2: "After a player chooses an active house, …" (a comma, no colon).
    "|\\b(after (?:a player|you|your opponent) chooses? (?:an active house|[^,:.]{1,60}? as (?:your|their) active house))(?=\\s*,)" +
    // Lote 6 §6.2: forge / ready / enter / destroyed-fighting, comma form.
    "|\\b(after (?:you|your opponent|a player) forges? a key|after a key is forged|after a player readies a creature|after (?:a|an|another) (?:friendly |enemy )?(?:[a-z]+ )?creatures? enters play|after an enemy creature is destroyed fighting (?:~|this creature|this card|it)|after a card is discarded from (?:your|your opponent's|a player's) hand)(?=\\s*,)" +
    // "After you ready ~" / "After this creature is readied": the ready step already
    // wakes `ready` observers. TITLE is the card's own normalised name, so "Splash-attack" stays a keyword.
    "|\\b(after you ready (?:~|this creature|this card|it|TITLE)|after this creature is readied)(?=\\s*,)";

/** The card being parsed, so "After you ready <title>" is a self ready-watch. */
let cardTitle = "";

function prefixPattern(): RegExp {
  const title = cardTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(PREFIX_SRC.replace("TITLE", title || "~"), "gi");
}

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

/** Observer prefix (docs/DSL_EXPANSION_PLAN.md §3.2): the ability belongs to a
    card WATCHING an event of another card ("After an enemy creature reaps, stun
    it."). The watched card must match `of` and the event card is selected with
    `s:"event"`. Only events of cards in play are representable. */
function observerFor(raw: string): { triggers: Trigger[]; of: Filter } | null {
  const part = raw.trim();
  const creature = part.match(/^(?:after|each time) (?:a|an) (friendly |enemy )?creatures? (reaps?|fights?|is destroyed)$/);
  if (creature) {
    const filter: Filter = { type: "Creature" };
    if (creature[1]) filter.side = creature[1].trim() as "friendly" | "enemy";
    const trigger: Trigger = creature[2].startsWith("reap") ? "reap" : creature[2].startsWith("fight") ? "fight" : "destroyed";
    return { triggers: [trigger], of: filter };
  }
  const plays = part.match(/^(?:after|each time) (you|your opponent) plays? a creature$/);
  if (plays) return { triggers: ["play"], of: { type: "Creature", side: plays[1] === "you" ? "friendly" : "enemy" } };
  if (/^(?:after|each time) you (?:use|uses) an artifact$/.test(part)) return { triggers: ["action", "omni"], of: { type: "Artifact", side: "friendly" } };
  return null;
}

/** Lote 6 §6.2: forge is a player event (`actor`); ready/enter are observers (`of` required). */
function lote6Header(raw: string): { triggers: Trigger[]; of?: Filter; cond?: Condition; selfWatch?: boolean } | null {
  const part = raw.trim();
  const forge = part.match(/^after (you|your opponent|a player) forges? a key$/) ?? (part === "after a key is forged" ? ["", "a player"] as RegExpMatchArray : null);
  if (forge) {
    const who = forge[1];
    const cond: Condition | undefined = who === "you" ? { k: "actor" } : who === "your opponent" ? { k: "actor", opp: true } : undefined;
    return { triggers: ["forge"], ...(cond ? { cond } : {}) };
  }
  const discarded = part.match(/^after a card is discarded from (your|your opponent's|a player's) hand$/);
  if (discarded) {
    // The discarded card controls nothing, so "whose hand" is the `actor` of the event, not a `side`.
    const cond: Condition | undefined = discarded[1] === "your" ? { k: "actor" } : discarded[1] === "a player's" ? undefined : { k: "actor", opp: true };
    return { triggers: ["discard"], of: {}, ...(cond ? { cond } : {}) };
  }
  if (part === "after a player readies a creature") return { triggers: ["ready"], of: { type: "Creature" } };
  // "After you ready ~, …" watches this card being readied (`of.self`). Pronouns in the
  // body stay `self`: the event card IS the watcher, and "deal 2 to it" is not "stun the
  // creature that caused a foreign event". `selfWatch` keeps that reading.
  if (part === "after you ready this card" || part === "after you ready this creature" || part === "after you ready it" || part === "after you ready ~" || (cardTitle !== "" && part === `after you ready ${cardTitle}`) || part === "after this creature is readied") {
    return { triggers: ["ready"], of: { self: true }, selfWatch: true };
  }
  const enters = part.match(/^after (a|an|another) (friendly |enemy )?([a-z]+ )?creatures? enters play$/);
  if (enters) {
    const filter: Filter = { type: "Creature" };
    if (enters[1] === "another") filter.other = true;
    if (enters[2]) filter.side = enters[2].trim() as "friendly" | "enemy";
    const trait = enters[3]?.trim();
    if (trait && properNouns.has(trait)) filter.trait = trait[0].toUpperCase() + trait.slice(1);
    else if (trait) return null;
    return { triggers: ["enter"], of: filter };
  }
  if (/^after an enemy creature is destroyed fighting (?:~|this creature|this card|it)$/.test(part)) {
    return { triggers: ["destroyed"], of: { type: "Creature", side: "enemy", fighting: true } };
  }
  return null;
}

/** Lote 5 §5.2: the `house` trigger. "After you choose" only counts on the
    chooser's own turn (`myTurn`), "your opponent" on the other's; a named house
    is only readable as the card's own printed house ("choose Dis" on a Dis card
    = the card's house is the active one). */
function houseHeader(raw: string): { triggers: Trigger[]; cond?: Condition } | null {
  const part = raw.trim();
  const plain = part.match(/^after (a player|you|your opponent) chooses? an active house$/);
  if (plain) {
    const cond: Condition | undefined = plain[1] === "you" ? { k: "myTurn" } : plain[1] === "your opponent" ? { k: "not", c: { k: "myTurn" } } : undefined;
    return { triggers: ["house"], ...(cond ? { cond } : {}) };
  }
  // Lote 15c (triggers-novos): "After you choose Sanctum as your active house…"
  // — o caso nomeado também vem com "you"/"your opponent". A casa nomeada só é
  // legível como a casa da PRÓRIA carta; o estreitamento de quem escolheu se
  // perde (a escolha acorda os dois lados), como no conversor.
  const named = part.match(/^after (?:a player|you|your opponent) chooses? (.+?) as (?:your|their) active house$/);
  if (named && (named[1] === "this card's house" || named[1] === cardHouse)) {
    return { triggers: ["house"], cond: { k: "count", of: { c: { self: true, house: "active" } }, op: "gte", n: 1 } };
  }
  return null;
}

/** Header of one printed segment: its trigger group, plus the watched filter
    when the prefix names an observer event. Null when it is outside the grammar. */
function abilityHeader(raw: string): { triggers: Trigger[]; of?: Filter; cond?: Condition; selfWatch?: boolean } | null {
  const lote6 = lote6Header(raw);
  if (lote6) return lote6;
  const house = houseHeader(raw);
  if (house) return house;
  const observer = observerFor(raw);
  if (observer) return observer;
  const triggers = raw.split("/").map((part) => triggerFor(part));
  return triggers.every((trigger): trigger is Trigger => trigger !== undefined) ? { triggers } : null;
}

const num = (word: string) => (word === "a" || word === "an" ? 1 : Number(word));

/** Spelled-out counts the counter wording uses ("two +1 power counters"). */
const COUNT_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const COUNTER_COUNT = "(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)";

/** Version of the deterministic grammar. A stored `parser` row is the parser's
    own output frozen on disk, so it only counts while the parser that wrote it
    is the running one (abilities.storedAbility): bump this whenever the grammar
    changes what a text parses to. */
export const PARSER_VERSION = 18;

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

/** Lowercased printed house of the card being parsed (houseHeader reads it). */
let cardHouse = "";

/** What "that house" means inside the ability being parsed: the house its own
    "Choose a house" picked, or the active one under a `house` trigger (Lote 5). */
let thatHouse: "chosen" | "active" | null = null;

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
  // "Archive each neighboring creature" (onda 4, Code Monkey): the source's own neighbors.
  else if (token === "neighboring") filter.neighborsOfSource = true;
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
  let rest = phrase.replace(/ of the active house$/, "");
  let houseClause = rest !== phrase ? "active" : undefined;
  // "… of that house": only readable inside an ability that says which house
  // that is (Lote 5 §5.1/§5.2).
  const that = rest.replace(/ of (?:that|the chosen) house$/, "");
  if (that !== rest) {
    if (!thatHouse) return null;
    rest = that;
    houseClause = thatHouse;
  }
  let words = rest;
  let flankClause: boolean | undefined;
  const tail = words.match(/^(.*?) (?:that is )?(not )?on a flank$/);
  if (tail) {
    words = tail[1];
    flankClause = !tail[2];
  }
  // Lote 15c (action-zones): "each friendly Knight creature in play" — a
  // battleline é o default; o sufixo é decoração de texto.
  words = words.replace(/ in play$/, "");
  // Lote 15b (target-select): "a creature with the highest power" / "each
  // creature with the lowest power" — o extremo do stat ENTRE OS MATCHES,
  // empates incluídos (`mostStat`); `lowest` espelha a direção.
  let extreme: "power" | "armor" | undefined;
  let extremeLow = false;
  const superlative = words.match(/^(.*?) with (?:the )?(highest|lowest) (power|armor)$/);
  if (superlative) {
    words = superlative[1];
    extreme = superlative[3] as "power" | "armor";
    extremeLow = superlative[2] === "lowest";
  }
  // Lote 4 §4.9/§4.10: "creature with amber on it" / "with (no) +1 power
  // counters on it" — presence or absence of worn amber/counters.
  let amberClause: boolean | undefined;
  let counterClause: boolean | undefined;
  const worn = words.match(/^(.*?) with (no |a |an )?(amber|\+1 power counters?|counters?) on (?:it|them)$/);
  if (worn) {
    words = worn[1];
    if (worn[3].startsWith("amber")) amberClause = worn[2] !== "no ";
    else counterClause = worn[2] !== "no ";
  }
  let powerMax: number | undefined;
  let powerMin: number | undefined;
  let weaker: boolean | undefined;
  let stronger: boolean | undefined;
  const power = words.match(/^(.*?) with power (\d+) or (lower|less|higher|more)$/);
  if (power) {
    words = power[1];
    if (power[3] === "lower" || power[3] === "less") powerMax = Number(power[2]);
    else powerMin = Number(power[2]);
  }
  if (/ with lower power than (?:~|this creature|it|this card)$/.test(words)) {
    words = words.replace(/ with lower power than (?:~|this creature|it|this card)$/, "");
    weaker = true;
  }
  if (/ with higher power than (?:~|this creature|it|this card)$/.test(words)) {
    words = words.replace(/ with higher power than (?:~|this creature|it|this card)$/, "");
    stronger = true;
  }
  let share: string | undefined;
  const shares = words.match(/^(.*?) that (?:(does not|do not) )?shares? a house with (.+)$/);
  if (shares) {
    words = shares[1];
    const withWhom = shares[3];
    const neg = Boolean(shares[2]);
    let literal: string | undefined;
    if (/^(?:it|this creature|this card|~)$/.test(withWhom)) literal = "self";
    else if (/^the (?:discarded|purged|archived) (?:card|creature)$/.test(withWhom)) literal = "moved";
    else if (/^the destroyed creature$/.test(withWhom)) literal = "target";
    else if (/^(?:at least )?(?:1|one) of its neighbors$/.test(withWhom)) literal = "neighbor";
    if (!literal) return null;
    share = (neg ? "!" : "") + literal;
  }
  const either = words.match(/^(.*?) ?creatures? or artifacts?$/);
  if (either) {
    const rest = either[1].trim();
    const base = rest ? parseFilterWords(`${rest} creature`) : ({ type: "!Upgrade" } as Filter);
    return base ? { ...base, type: "!Upgrade" } : null;
  }
  const tokens = words.split(" ").filter(Boolean);
  const noun = tokens.pop();
  if (noun === "artifact" || noun === "artifacts") {
    /* creature or artifact is handled before the noun split, below */
  }
  if (noun !== "creature" && noun !== "creatures" && noun !== "artifact" && noun !== "artifacts" && noun !== "upgrade" && noun !== "upgrades") return null;
  const filter: Filter = {
    type: noun.startsWith("upgrade") ? "Upgrade" : noun.startsWith("artifact") ? "Artifact" : "Creature",
  };
  if (powerMax !== undefined) filter.powerMax = powerMax;
  if (powerMin !== undefined) filter.powerMin = powerMin;
  if (extreme) {
    filter.mostStat = extreme;
    if (extremeLow) filter.lowest = true;
  }
  if (weaker) filter.weaker = true;
  if (stronger) filter.stronger = true;
  if (share) filter.house = share;
  if (flankClause !== undefined) filter.flank = flankClause;
  if (amberClause !== undefined) filter.amber = amberClause;
  if (counterClause !== undefined) filter.counters = counterClause;
  if (houseClause) filter.house = houseClause;
  for (let index = 0; index < tokens.length; index += 1) {
    // Lote 15b (triagem M3, Séance Scanner): "non-Star Alliance creature" — a
    // negação atravessa o par de palavras da casa: sem isso o "non-star" caía no
    // ramo de traits (vira trait "Star") e o "alliance" seguinte sobrescrevia.
    const negation = /^(?:non-|!)/.test(tokens[index]);
    const bare = tokens[index].replace(/^(?:non-|!)/, "");
    const pair = tokens[index + 1] ? HOUSES[`${bare} ${tokens[index + 1]}`] : undefined;
    if (pair) {
      filter.house = (negation ? "!" : "") + pair;
      index += 1;
    } else if (!applyModifier(filter, tokens[index])) return null;
  }
  return filter;
}

/** Lote 15a: a cláusula anterior acabou de criar token(s) ("make a token
    creature, then ready it"): "it" é o resultado dela, não a própria carta. */
let madeToken = false;

/** Lote 15b (target-select): a cláusula "Choose up to N …" abriu uma escolha do
    jogador — "each chosen creature" das frases seguintes lê este pick. */
let chosenCards: { n: number; filter: Filter } | null = null;

function parseObject(phrase: string, upgrade: boolean, observer = false): { s: Selection; target?: Filter } | null {
  // Inside an observer ability the event card is the subject: "stun it" stuns
  // the creature that caused the event, not the watcher.
  if (observer && (phrase === "it" || phrase === "~")) return { s: "event" };
  // Lote 15a: depois de um makeToken, "it"/"that card" é o token criado
  // (keyteki `preThenEvent.card`) — o resultado do ato anterior.
  if (madeToken && /^(?:it|that card|that creature)$/.test(phrase)) return { s: "moved" };
  // Lote 15b (target-select): "each chosen creature" é a escolha do JOGADOR que
  // a cláusula "Choose up to N …" abriu — o pick `upTo` da fila `targets` do
  // movimento ("Choose up to 2 creatures. Shuffle each chosen creature…").
  if (/^each (?:of (?:the|those) )?chosen (?:creature|card|artifact)s?$/.test(phrase)) {
    return chosenCards ? { s: { pick: chosenCards.filter, n: chosenCards.n, upTo: true } } : null;
  }
  // Lote 15a: "…, ward that creature" — a anáfora da cláusula anterior é o alvo
  // escolhido da ability ("Move 1 amber from a creature…, ward that creature").
  if (/^(?:that|the chosen) (?:card|creature|artifact)$/.test(phrase)) return { s: "target" };
  if (/^(this card|this creature|this artifact|itself|it|~)$/.test(phrase)) {
    return { s: upgrade && (phrase === "this creature" || phrase === "this artifact") ? "host" : "self" };
  }
  if (phrase === "a creature and each of its neighbors") return { s: "targetAndNeighbors", target: { type: "Creature" } };
  if (/^each neighbor of the creature this card fights$/.test(phrase)) return { s: "neighborsOfFought" };
  // "The creature ~ fights" (Before Fight): the defender of the fight in progress.
  if (/^the creature (?:this card|it) fights?$/.test(phrase)) return { s: "fought" };
  // "Ward each of Old Egad's neighbors" — the source's own neighbors.
  if (/^(?:each of )?(?:this card's|its) neighbors?$/.test(phrase)) return { s: { each: { neighborsOfSource: true } } };
  const top = phrase.match(/^the (\d+) most powerful creatures$/);
  if (top) return { s: { each: { type: "Creature", top: Number(top[1]) } } };
  // Lote 4 §4.4: "the least powerful [enemy|friendly] creature" — one card, the
  // mirror of `top` by effective power.
  const least = phrase.match(/^the least powerful (.+)$/);
  if (least) {
    const filter = parseFilterWords(least[1]);
    return filter ? { s: { each: { ...filter, least: 1 } } } : null;
  }
  // Lote 8 §8.3: the mirror of "the least powerful": one card, the highest effective power.
  const most = phrase.match(/^the most powerful (.+)$/);
  if (most) {
    const filter = parseFilterWords(most[1]);
    return filter ? { s: { each: { ...filter, most: 1 } } } : null;
  }
  // Lote 7 §7.1: "up to three creatures" / "any number of friendly creatures" — the player's queue.
  const upTo = phrase.match(/^(?:up to (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)|any number of) (.+)$/);
  if (upTo) {
    const filter = parseFilterWords(upTo[2]);
    const n = upTo[1] ? (COUNT_WORDS[upTo[1]] ?? Number(upTo[1])) : 99;
    return filter && n > 0 ? { s: { pick: filter, n, upTo: true } } : null;
  }
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
const count = (of: Count, op: "eq" | "gte" | "lte" | "even" | "odd", n: number): Condition => ({ k: "count", of, op, n });

/** "Haunted" prints no number: it is the rulebook's 10+ cards in a discard pile. */
const HAUNTED = 10;

function parseCondition(clause: string): Condition | null {
  const amber = clause.match(/^(your opponent has|you have) (no|\d+) amber( or more)?$/);
  if (amber) {
    return { k: "amber", opp: amber[1] === "your opponent has", op: amber[2] === "no" ? "eq" : "gte", n: amber[2] === "no" ? 0 : Number(amber[2]) };
  }
  // Lote 5 §5.5: parity of an amber pool; `n` is ignored by the engine.
  const parity = clause.match(/^(your opponent has|you have) an? (even|odd) (?:amount|number) of amber$/);
  if (parity) return count({ p: "amber", ...(parity[1] === "you have" ? {} : { opp: true }) }, parity[2] as "even" | "odd", 0);
  // Lote 5 §5.4: the turn stamp of the last forge (game.forge records it).
  const forged = clause.match(/^(you|your opponent) forged a key (?:(?:on|during) (?:your|their) )?(?:previous|last) turn$/);
  if (forged) return forged[1] === "you" ? { k: "forged" } : { k: "forged", opp: true };
  // Lote 7 §7.2: key colors. "A red key is forged" reads either side; "your" / "your opponent's" one.
  const keyed = clause.match(/^(an?|your|your opponent's|an opponent's) (red|yellow|blue) key is forged$/);
  if (keyed) {
    const color = keyed[2] as "red" | "yellow" | "blue";
    return keyed[1].startsWith("a") && keyed[1] !== "an opponent's" ? { k: "key", color, any: true } : keyed[1] === "your" ? { k: "key", color } : { k: "key", color, opp: true };
  }
  if (clause === "you control more creatures than your opponent") return { k: "moreCreatures" };
  if (clause === "your opponent controls more creatures than you") return { k: "fewerCreatures" };
  // "Overwhelmed" is the printed word for "the opponent has more creatures".
  if (clause === "you are overwhelmed") return { k: "fewerCreatures" };
  // Lote 2: "If you do" is the did-count of the act before (keyteki's `then`).
  if (clause === "you do") return count("did", "gte", 1);
  // Lote 4 §4.10: "if one or more counters are removed this way" is the did of
  // the removeCounter act just run.
  if (clause === "one or more counters are removed this way") return count("did", "gte", 1);
  // Lote 4 §4.8: "If it is not your turn" = not myTurn (state.activePlayer).
  if (/^(?:it is not|it's not) your turn$/.test(clause)) return { k: "not", c: { k: "myTurn" } };
  if (/^(?:this damage destroys that creature|that creature is destroyed|it is destroyed)$/.test(clause)) return count("gone", "gte", 1);
  if (/^(?:it|that creature) is not destroyed$/.test(clause)) return count("gone", "eq", 0);
  // Lote 11 §E: "if an enemy creature was destroyed in a fight this turn".
  const slainNow = clause.match(/^(?:an?|any|at least one) (.+?) (?:was|were) destroyed in a fight this turn$/);
  if (slainNow) {
    const filter = parseFilterWords(slainNow[1]);
    return filter ? count({ slain: filter }, "gte", 1) : null;
  }
  if (clause === "it was already exhausted" || clause === "it is already exhausted") return count({ c: { target: true, exhausted: true } }, "gte", 1);
  const houseCard = clause.match(/^it is (not )?a ([a-z ]+?) card$/);
  if (houseCard && HOUSES[houseCard[2]]) {
    return count({ c: { house: (houseCard[1] ? "!" : "") + HOUSES[houseCard[2]], target: true } }, houseCard[1] ? "eq" : "gte", houseCard[1] ? 0 : 1);
  }
  const haunted = clause.match(/^(you|your opponent) (?:is |are )?(not )?haunted$/);
  if (haunted) {
    const count: Condition = { k: "count", of: { p: "discard", ...(haunted[1] === "you" ? {} : { opp: true }) }, op: "gte", n: HAUNTED };
    return haunted[2] ? { k: "not", c: count } : count;
  }
  // Both state words fold into ONE self filter ("exhausted and on a flank"), so no `and` condition is needed.
  const selfState = clause.match(/^this (?:card|creature) is (exhausted|on a flank)(?: and (exhausted|on a flank))?$/);
  if (selfState && selfState[1] !== selfState[2]) {
    const states = [selfState[1], selfState[2]];
    return { k: "count", of: { c: { self: true, ...(states.includes("on a flank") ? { flank: true } : {}), ...(states.includes("exhausted") ? { exhausted: true } : {}) } }, op: "gte", n: 1 };
  }
  // Onda 4 (Code Monkey): "If those creatures share a house" — the cards the
  // previous act moved hold one distinct printed house between them (Rogue
  // Operation's `housesOf`). A single moved creature shares its own house; none
  // moved shares nothing.
  if (/^those (?:creatures|cards) share a house$/.test(clause)) return count({ housesOf: "moved" }, "eq", 1);
  const none = clause.match(/^there (?:are|is) no (.+)$/);
  const filter = none ? parseFilterWords(none[1]) : null;
  return filter ? { k: "count", of: { c: filter }, op: "eq", n: 0 } : null;
}

/** The amount behind "for each X" (docs/DSL_EXPANSION_PLAN.md §2.1). */
function parsePer(phrase: string): Count | null {
  if (/^creatures? (?:healed|damaged) this way$/.test(phrase) || /^cards? discarded this way$/.test(phrase)) return "did";
  if (/^creatures? destroyed this way$/.test(phrase)) return "gone";
  // Lote 11 §E: the total damage the heal before removed, and the creatures that died in a fight this turn.
  if (/^damage healed(?: this way)?$/.test(phrase)) return "healed";
  const slain = phrase.match(/^(.+?) (?:that (?:was|were) )?destroyed in a fight this turn$/);
  if (slain) {
    const filter = parseFilterWords(slain[1]);
    return filter ? { slain: filter } : null;
  }
  // Lote 8 §8.5: "each Mutant creature destroyed this way" counts only the destroyed cards that match.
  const destroyed = phrase.match(/^(.+?) destroyed this way$/);
  if (destroyed) {
    const filter = parseFilterWords(destroyed[1]);
    return filter ? { gone: filter } : null;
  }
  if (/^(?:bonus icons?|.+ counters?) (?:on the discarded card|removed this way)$/.test(phrase)) return phrase.startsWith("bonus") ? { m: "icons" } : "did";
  if (/^the (?:archived|purged|discarded) (?:creature|card)'?s? power$/.test(phrase)) return { m: "power" };
  // Lote 7 §7.2: distinct colors among the forged keys (both sides unless named).
  // Lote 12: distinct houses on the cards the previous act moved (the discard that filled `scope.moved`).
  if (/^houses? represented among the discarded cards$/.test(phrase)) return { housesOf: "moved" };
  const colors = phrase.match(/^colors? represented among (?:(your opponent's|your) )?forged keys$/);
  if (colors) return { p: "keyColors", ...(colors[1] === "your" ? {} : colors[1] ? { opp: true } : { any: true }) };
  const zone = phrase.match(/^cards? in your (hand|deck|discard(?: pile)?|archives|purged)$/);
  if (zone) return { p: (zone[1] === "discard pile" ? "discard" : zone[1]) as Zone };
  if (/^(?:forged )?keys? your opponent has$/.test(phrase)) return { p: "keys", opp: true };
  // Lote 5 §5.4: "for each amber in your opponent's pool" (forgeKey.less).
  const pool = phrase.match(/^amber in (your|your opponent's) pool$/);
  if (pool) return { p: "amber", ...(pool[1] === "your" ? {} : { opp: true }) };
  if (/^amber on (?:it|this card|this creature)$/.test(phrase)) return { of: "amber", s: "self" };
  if (/^damage on (?:it|this card|this creature)$/.test(phrase)) return { of: "damage", s: "self" };
  // Lote 4 §4.10: "for each +1 power counter on X" sums the counters.
  const counters = phrase.match(/^\+1 power counters? on (.+)$/);
  if (counters) {
    const object = parseObject(counters[1], false);
    return object ? { of: "counters", s: object.s } : null;
  }
  // "each of ~'s <House> neighbors" (the "for each" already went by).
  const neighbors = phrase.match(/^(?:each )?of (?:this card's|its) (.+?) neighbors$/);
  if (neighbors) return HOUSES[neighbors[1]] ? { c: { neighborsOfSource: true, house: HOUSES[neighbors[1]] } } : null;
  const filter = parseFilterWords(phrase);
  return filter ? { c: filter } : null;
}

interface Sentence {
  acts: Act[];
  target?: Filter;
  /** The second chosen card (Lote 7 §7.1). */
  target2?: Filter;
  cond?: Condition;
  optional?: boolean;
}

const SIMPLE: [RegExp, (m: RegExpMatchArray) => Act][] = [
  [/^gain (\d+) amber$/, (m) => ({ k: "gainAmber", n: +m[1] })],
  [/^your opponent gains (\d+) amber$/, (m) => ({ k: "gainAmber", n: +m[1], opp: true })],
  [/^your opponent loses (\d+) amber$/, (m) => ({ k: "loseAmber", n: +m[1], opp: true })],
  [/^they lose (\d+) amber$/, (m) => ({ k: "loseAmber", n: +m[1], opp: true })],
  [/^lose (\d+) amber$/, (m) => ({ k: "loseAmber", n: +m[1] })],
  [/^steal (\d+) amber$/, (m) => ({ k: "steal", n: +m[1] })],
  // Lote 5 §5.5: "all but N" = the pool minus N, floored at 0 (Count.sub).
  [/^steal all but (\d+)(?: amber)? of your opponent's amber$/, (m) => ({ k: "steal", n: 1, per: { sub: [{ p: "amber", opp: true }, +m[1]] } })],
  [/^gain (a|\d+) chains?$/, (m) => ({ k: "gainChains", n: num(m[1]) })],
  [/^draw (a|\d+) cards?$/, (m) => ({ k: "draw", n: num(m[1]) })],
  [/^your opponent draws (a|\d+) cards?$/, (m) => ({ k: "draw", n: num(m[1]), opp: true })],
  [/^your opponent discards (a|\d+) random cards?(?: from their hand)?$/, (m) => ({ k: "discardRandom", n: num(m[1]), opp: true })],
  [/^keys cost \+(\d+) (?:amber )?during your opponent's next turn$/, (m) => ({ k: "keyCost", n: +m[1], opp: true })],
  [/^archive the top card of your deck$/, () => ({ k: "archiveTop" })],
  // Lote 10 §10.1: a bare "look at" is a private peek; anything that acts on what was seen stays a separate
  // (unsupported) sentence, so the card is at worst partial.
  [/^look at your opponent's hand$/, () => ({ k: "peek", from: "hand", opp: true })],
  [/^look at the top (card|\d+ cards) of (your|your opponent's) deck$/, (m) => ({
    k: "peek",
    from: "deck",
    ...(m[1] === "card" ? {} : { n: parseInt(m[1], 10) }),
    ...(m[2] === "your" ? {} : { opp: true }),
  })],
  // Lote 11 §D (Tantadlin): the archives are a zone of the move act like the rest.
  [/^discard a random card from your opponent's archives$/, () => ({ k: "move", n: 1, from: "archives", to: "discard", opp: true, pick: "random" })],
  // Lote 11 §H: the public reveal; a following "put/discard that card" reads it (`pick:"revealed"`, see parseAbilityBody).
  [/^reveal a random card from your opponent's hand$/, () => ({ k: "reveal", from: "hand", opp: true, pick: "random" })],
  [/^reveal your opponent's hand$/, () => ({ k: "reveal", from: "hand", opp: true })],
  [/^reveal the top (card|\d+ cards) of your deck$/, (m) => ({ k: "reveal", from: "deck", ...(m[1] === "card" ? {} : { n: parseInt(m[1], 10) }) })],
  // Onda 3: tokens nascem na mesa (keyteki MakeTokenCreatureAction).
  [/^(?:make|create) (a|an|\d+) token creatures?$/, (m) => ({ k: "makeToken", n: num(m[1]) })],
  // Onda 4: forjar/desforjar fora do passo de chave (keyteki ForgeAction e
  // UnforgeAction — todo texto "unforge" impresso mira a chave do oponente).
  [/^forge (?:another )?a? ?key at current cost$/, () => ({ k: "forgeKey", n: 1 })],
  [/^forge (?:another )?a? ?key at no cost$/, () => ({ k: "forgeKey", n: 1, free: true })],
  [/^forge (?:another )?a? ?key at \+(\d+)(?: amber)?(?: current)?(?: cost)?$/, (m) => ({ k: "forgeKey", n: 1, mod: Number(m[1]) })],
  [/^unforge (?:it|(?:your )?(?:an? )?(?:opponent's|opponents'?|enemy) keys?)$/, () => ({ k: "unforgeKey", n: 1 })],
  [/^return a card from your discard pile to your hand$/, () => ({ k: "fromDiscard" })],
  [/^return a creature from your discard pile to your hand$/, () => ({ k: "fromDiscard", type: "Creature" })],
  // Lote 2 (§2.6): the zone moves of the player, one act for mill, discard,
  // archive and purge. "the top" of a deck is the end of the array (game.move).
  // Lote 8 §8.7: "a player's deck" is either one — the move's option decides whose.
  [/^discard the top(?: (\d+))? cards? of (your|your opponent's|a player's) deck$/, (m) => ({
    k: "move",
    n: m[1] ? Number(m[1]) : 1,
    from: "deck",
    to: "discard",
    pick: "top",
    ...(m[2] === "your opponent's" ? { opp: true } : m[2] === "a player's" ? { side: "any" as const } : {}),
  })],
  // Lote 4 §4.5: the deck's bottom is the array's start.
  [/^discard the bottom(?: (\d+))? cards? of (your|your opponent's) deck$/, (m) => ({
    k: "move",
    n: m[1] ? Number(m[1]) : 1,
    from: "deck",
    to: "discard",
    pick: "bottom",
    ...(m[2] === "your opponent's" ? { opp: true } : {}),
  })],
  // Lote 4 §4.5: a card forced from a hand to the top of its owner's deck.
  [/^put a random card from your opponent's hand on top of their deck$/, () => ({ k: "move", n: 1, from: "hand", to: "deck", opp: true, pick: "random", at: "top" })],
  [/^your opponent puts a random card from their hand on top of their deck$/, () => ({ k: "move", n: 1, from: "hand", to: "deck", opp: true, pick: "random", at: "top" })],
  // Lote 4 §4.6: the actor is read off the ability's reference card.
  [/^its owner draws (a|\d+) cards?$/, (m) => ({ k: "draw", n: num(m[1]), who: "owner" })],
  [/^its (owner|controller) gains (\d+) amber$/, (m) => ({ k: "gainAmber", n: Number(m[2]), who: m[1] as "owner" | "controller" })],
  [/^its (owner|controller) loses (\d+) amber$/, (m) => ({ k: "loseAmber", n: Number(m[2]), who: m[1] as "owner" | "controller" })],
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
const VERBS: [
  RegExp,
  (m: RegExpMatchArray) => { k: Act["k"]; n?: number; obj: number; at?: "top" | "bottom" | "shuffle"; own?: boolean; opp?: boolean },
][] = [
  [/^destroy (.+)$/, () => ({ k: "destroy", obj: 1 })],
  [/^purge (.+)$/, () => ({ k: "purge", obj: 1 })],
  [/^sacrifice (.+)$/, () => ({ k: "sacrifice", obj: 1 })],
  [/^exalt (.+?)(?: (twice)| (\d+|one|two|three|four|five) times?)?$/, (m) => ({ k: "exalt", n: m[2] ? 2 : m[3] ? (COUNT_WORDS[m[3]] ?? Number(m[3])) : 1, obj: 1 })],
  [/^deal (\d+)(?: damage)? to (.+)$/, (m) => ({ k: "damage", n: +m[1], obj: 2 })],
  [/^stun (.+)$/, () => ({ k: "stun", obj: 1 })],
  [/^exhaust (.+)$/, () => ({ k: "exhaust", obj: 1 })],
  [/^ready (.+)$/, () => ({ k: "ready", obj: 1 })],
  [/^unstun (.+)$/, () => ({ k: "unstun", obj: 1 })],
  [/^heal (\d+) damage from (.+)$/, (m) => ({ k: "heal", n: +m[1], obj: 2 })],
  [/^fully heal (.+)$/, () => ({ k: "heal", obj: 1 })],
  [/^return (.+?) to (?:its|their) owners?'s? hands?$/, () => ({ k: "returnToHand", obj: 1 })],
  [/^return (.+?) to your hand$/, () => ({ k: "returnToHand", obj: 1 })],
  [/^put (.+) on top of your deck$/, () => ({ k: "returnToDeck", obj: 1, at: "top" })],
  // Lote 4 §4.5: "top" is the explicit literal of the default landing (push).
  [/^put (.+?) on (?:the )?top of (?:its|their) owners?'s? de(?:ck)s?$/, () => ({ k: "returnToDeck", obj: 1, at: "top" })],
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
  // Lote 4 §4.7: "Give control of X to your opponent" (the destination side).
  [/^give control of (.+?) to (?:your|their) opponent$/, () => ({ k: "takeControl", obj: 1, opp: true })],
  [/^(.+?) captures? (\d+)(?: amber)?$/, (m) => ({ k: "capture", n: +m[2], obj: 1 })],
  // Lote 4 §4.4: capture out of the creature's own side's pool.
  [/^(.+?) captures? (\d+) amber from its own side$/, (m) => ({ k: "capture", n: +m[2], obj: 1, own: true })],
];

/** A printed sentence. A leading "You may" makes every act of the sentence
    optional — the actor chooses whether it resolves (keyteki optional). */
function parseSentence(sentence: string, upgrade: boolean, creature: boolean, quoted: string[], observer = false): Sentence | null {
  const may = sentence.match(/^you may:? (.+)$/);
  let body = may ? may[1] : sentence;
  // Lote 5 §5.4: "Forge a key at +N current cost, reduced by 1 for each X" is ONE
  // act (`less`), so it is read before the generic "for each" split.
  const reduced = body.match(/^(forge (?:another )?a? ?key at (?:current cost|\+\d+(?: amber)?(?: current cost)?)), reduced by 1(?: amber)? for each (.+?)(?:, to a minimum of (\d+)(?: amber)?)?$/);
  if (reduced) {
    const less = parsePer(reduced[2]);
    const head = less ? parseSentenceBody(reduced[1], upgrade, creature, quoted, observer) : null;
    const forge = head?.acts[0];
    if (!less || !head || forge?.k !== "forgeKey") return null;
    forge.less = less;
    if (reduced[3]) forge.min = Number(reduced[3]);
    if (may) {
      head.optional = true;
      forge.optional = true;
    }
    return head;
  }
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
  const parsed = parseSentenceBody(body, upgrade, creature, quoted, observer);
  if (parsed && per) {
    for (const act of parsed.acts) {
      if (act.k === "lasting") act.e.per = per;
      else if (!(per === "healed" && act.k === "heal")) act.per = per;
    }
  }
  if (parsed && may) {
    parsed.optional = true;
    for (const act of parsed.acts) act.optional = true;
  }
  return parsed;
}

/** Lote 7 §7.3: the printed stop of a deck-mill loop, as the engine's `until`. */
function untilOf(word: string): { house?: string; type?: string } | null {
  const house = HOUSES[word];
  if (house) return { house };
  const type = { creature: "Creature", artifact: "Artifact", action: "Action", upgrade: "Upgrade" }[word];
  return type ? { type } : null;
}

function parseSentenceBody(sentence: string, upgrade: boolean, creature: boolean, quoted: string[], observer: boolean): Sentence | null {
  // Lote 7 §7.3: "Discard cards from the top of your deck until you discard a Logos card or run out of cards."
  const mill = sentence.match(/^discard cards from the top of your deck until you discard an? ([a-z]+) card or run out of cards$/);
  if (mill) {
    const until = untilOf(mill[1]);
    return until ? { acts: [{ k: "move", n: 1, from: "deck", to: "discard", pick: "top", until }] } : null;
  }
  const keep = sentence.match(/^if you discard an? ([a-z]+) card this way, put it into your hand$/);
  if (keep) {
    const until = untilOf(keep[1]);
    return until ? { acts: [{ k: "move", n: 1, from: "discard", to: "hand", pick: "moved", ...until }] } : null;
  }
  // Lote 7 §7.1: two chosen cards, and the flank choice.
  if (/^move all amber from one creature to another creature$/.test(sentence)) {
    return { acts: [{ k: "moveAmber", s: "target", to: "target2" }], target: { type: "Creature", amber: true }, target2: { type: "Creature" } };
  }
  if (/^move each \+1 power counter from a creature to another creature$/.test(sentence)) {
    return {
      acts: [
        { k: "removeCounter", s: "target" },
        { k: "counter", n: 1, s: "target2", per: "did" },
      ],
      target: { type: "Creature", counters: true },
      target2: { type: "Creature" },
    };
  }
  // Lote 8 §8.3: all the amber of one friendly creature goes to the most powerful enemy (the target is the player's pick).
  const toMost = sentence.match(/^move (?:each|all) amber from (.+?) to the most powerful (.+)$/);
  if (toMost) {
    const from = parseObject(toMost[1], upgrade, observer);
    const to = parseFilterWords(toMost[2]);
    if (!from || from.s !== "target" || !from.target || !to) return null;
    return { acts: [{ k: "moveAmber", s: "target", to: "target2" }], target: { ...from.target, amber: true }, target2: { ...to, most: 1 } };
  }
  // Lote 8 §8.1 (Gabos Longarms): the choice is the ability's target; the redirect is the fight's own.
  if (sentence === "choose a creature") return { acts: [], target: { type: "Creature" } };
  // Lote 15c (action-zones): "Purge a creature from a discard pile." — ato de
  // ZONA (fora da battleline): o `move` do estoque, sem `pick` = a escolha do
  // controller ("from your opponent's …" usa o lado deles).
  const fromZone = sentence.match(/^(purge|discard|return) (a|an|one|two|three|\d+|each|all) (.+?) from (your opponent's|their|your|a|an) (discard pile|discard|hand|archives|deck)$/);
  if (fromZone) {
    const to = fromZone[1] === "purge" ? "purged" : fromZone[1] === "discard" ? "discard" : "hand";
    const from = fromZone[5] === "discard pile" ? "discard" : fromZone[5];
    // "a card" é sem restrição de tipo ("Purge a card from your discard pile");
    // frase com modificadores fora do padrão ("a random card") cai para os
    // handlers seguintes em vez de matar a sentença.
    const filter = /^(?:card|cards)$/.test(fromZone[3]) ? {} : parseFilterWords(fromZone[3]);
    if (filter) {
      const each = fromZone[2] === "each" || fromZone[2] === "all";
      return {
        acts: [
          {
            k: "move",
            n: each ? 1 : fromZone[2] === "a" || fromZone[2] === "an" || fromZone[2] === "one" ? 1 : fromZone[2] === "two" ? 2 : fromZone[2] === "three" ? 3 : Number(fromZone[2]),
            from: from as Zone,
            to,
            ...(each ? { pick: "all" as const } : {}),
            ...(filter.type ? { type: filter.type } : {}),
            ...(fromZone[4] === "your opponent's" || fromZone[4] === "their" ? { opp: true } : {}),
          },
        ],
      };
    }
  }
  // Lote 15b (target-select): "Choose up to 2 creatures." — a escolha do
  // jogador (fila `targets` do movimento) vira o pick `upTo` que as frases
  // seguintes leem como "each chosen creature"; sozinha não resolve ato nenhum.
  const chooseUpTo = sentence.match(/^choose up to (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) (.+)$/);
  if (chooseUpTo) {
    const n = COUNT_WORDS[chooseUpTo[1]] ?? Number(chooseUpTo[1]);
    const filter = parseFilterWords(chooseUpTo[2]);
    if (!filter || !n) return null;
    chosenCards = { n, filter };
    return { acts: [] };
  }
  if (/^(?:this card|this creature|~) deals damage to that creature (?:instead|rather than the (?:one|creature) (?:it|this card|this creature) is fighting)$/.test(sentence)) {
    return { acts: [{ k: "lasting", e: { target: { fighting: true }, replace: { on: "damage", redirect: "chosen" } } }] };
  }
  // Lote 8 §8.7: "If it is a creature, purge it" — the card the act before milled (Hamstrung).
  const purgeIt = sentence.match(/^if it is an? (creature|artifact|action|upgrade), purge it$/);
  if (purgeIt) return { acts: [{ k: "move", n: 1, from: "discard", to: "purged", pick: "moved", type: RESTRICT_TYPES[purgeIt[1]] }] };
  // Lote 8 §8.9 (Trihard): a fraction of each hand, rounded down — two acts, me first.
  const fraction = sentence.match(/^each player randomly discards one (third|half) of their cards from their hand$/);
  if (fraction) {
    const div = fraction[1] === "third" ? 3 : 2;
    return {
      acts: [
        { k: "move", n: 1, from: "hand", to: "discard", pick: "random", per: { p: "hand", div } },
        { k: "move", n: 1, from: "hand", to: "discard", opp: true, pick: "random", per: { p: "hand", opp: true, div } },
      ],
    };
  }
  // Lote 12 (Animating Force): one sentence, two acts. The "and" split would stop at "and versatile".
  const animate = sentence.match(/^take control of this artifact and put it on a flank of your battleline as a creature with (\d+) power and versatile$/);
  if (animate) {
    return {
      acts: [
        { k: "takeControl", s: "host", whileSource: true },
        { k: "materialize", s: "host", power: Number(animate[1]), keyword: "versatile" },
      ],
    };
  }
  const flank = sentence.match(/^move a creature to a flank of its controller's battleline( and exhaust it)?$/);
  if (flank) {
    return { acts: [{ k: "toFlank", s: "target" }, ...(flank[1] ? [{ k: "exhaust" as const, s: "target" as const }] : [])], target: { type: "Creature" } };
  }

  // Lote 11 §G: a choice between two sources is the "Choose one:" machinery (mode a/b) inside one sentence.
  if (sentence === "archive the top card of your deck or the top card of your discard pile") {
    return {
      acts: [
        { k: "move", n: 1, from: "deck", to: "archives", pick: "top", mode: "a" },
        { k: "move", n: 1, from: "discard", to: "archives", pick: "top", mode: "b" },
      ],
    };
  }
  // Lote 11 §H: the card(s) the reveal/peek before showed. `from`/`opp` are copied from that act in parseAbilityBody.
  const putRevealed = sentence.match(/^put that card on (?:the )?(top|bottom) of (?:their|its owner's|your opponent's|your) deck$/);
  if (putRevealed) return { acts: [{ k: "move", n: 1, from: "hand", to: "deck", pick: "revealed", at: putRevealed[1] as "top" | "bottom" }] };
  if (/^discard (?:that card|(?:a|1|one) of (?:them|those cards))$/.test(sentence)) return { acts: [{ k: "move", n: 1, from: "deck", to: "discard", pick: "revealed" }] };
  // Lote 11 §B (Remote Access): the opponent's artifact, used for the acting side.
  if (/^use an? (?:opponent's|enemy) artifact as if it were yours$/.test(sentence)) {
    return { acts: [{ k: "use", s: "target", asYours: true }], target: { type: "Artifact", side: "enemy", ready: true } };
  }
  // Lote 11 §F (First Blood): one pool divided among the creatures the player names (parseAbilityBody joins the two sentences).
  const divided = sentence.match(/^deal (\d+) damage divided among (.+)$/);
  if (divided) {
    const object = parseObject(divided[2], upgrade, observer);
    return object && typeof object.s === "object" && "pick" in object.s ? { acts: [{ k: "damage", n: Number(divided[1]), s: object.s, divide: true }] } : null;
  }

  // "If you do, X" (keyteki's `then`) is the did-count of the clause before it,
  // so the conditional branch below reads it as a condition on X.
  const conditional = sentence.match(/^if ([^,]+), (.+)$/) ?? sentence.match(/^(.+?) if (you control more creatures than your opponent)$/);
  if (conditional) {
    const [condText, rest] = sentence.startsWith("if ") ? [conditional[1], conditional[2]] : [conditional[2], conditional[1]];
    const cond = parseCondition(condText);
    const body = cond && parseSentence(rest, upgrade, creature, quoted, observer);
    return body && !body.cond ? { ...body, cond } : null;
  }

  // Lote 5 §5.1: "Choose a house" resolves no act itself — the move carries the
  // house and later sentences read it as "that house". Choosing among the houses
  // of the opponent's identity card is the same sentence (the engine offers the
  // opponent's houses to a card that forces the choice).
  if (/^choose a house(?: on your opponent's identity card)?$/.test(sentence)) {
    choseHouse = true;
    thatHouse = "chosen";
    return { acts: [] };
  }
  if (/^your opponent must choose that house(?: as their active house)?(?: (?:on|during))?(?: their)? next turn$/.test(sentence)) {
    return thatHouse === "chosen" ? { acts: [{ k: "forceHouse" }] } : null;
  }
  // Mark of Dis: a house read off the target, not chosen (so it never pairs with "Choose a house").
  if (/^(?:its|that creature's|the creature's) controller must choose (?:that creature's|the creature's|its) house as their active house(?: (?:on|during) their next turn)?$/.test(sentence)) {
    return { acts: [{ k: "forceHouse", house: "target", who: "controller" }] };
  }

  // A sentence that sets a lasting effect ("… on their next turn") rather than
  // resolving now (keyteki lastingEffect / duringOpponentNextTurn).
  const persistent = parsePersistent(sentence, upgrade, creature, quoted);
  if (persistent) return { acts: persistent.map((e) => ({ k: "lasting", e })) };

  const discardedWay = sentence.match(/^put (a|each) (non-)?([a-z]+) cards? discarded this way into your hand$/);
  if (discardedWay) {
    const house = HOUSES[discardedWay[3]];
    if (!house) return null;
    return {
      acts: [{ k: "move", n: discardedWay[1] === "each" ? 99 : 1, from: "discard", to: "hand", pick: "moved", house: (discardedWay[2] ? "!" : "") + house }],
    };
  }
  const namedPut = sentence.match(new RegExp(`^put (${COUNTER_COUNT}) ([a-z]+) counters? on (.+)$`));
  if (namedPut && namedPut[2] !== "power") {
    const object = parseObject(namedPut[3], upgrade, observer);
    const n = COUNT_WORDS[namedPut[1]] ?? Number(namedPut[1]);
    return object && n ? { acts: [{ k: "counter", n, s: object.s, name: namedPut[2] }], target: object.target } : null;
  }
  const namedRemove = sentence.match(/^remove (?:each |all )?([a-z]+) counters? from (.+)$/);
  if (namedRemove && namedRemove[1] !== "power") {
    const object = parseObject(namedRemove[2], upgrade, observer);
    return object ? { acts: [{ k: "removeCounter", s: object.s, name: namedRemove[1] }], target: object.target } : null;
  }

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
    const object = parseObject(stunExhaust[1], upgrade, observer);
    return object ? { acts: [{ k: "stun", s: object.s }, { k: "exhaust", s: object.s }], target: object.target } : null;
  }

  // Lote 3 (§3.1): "Ready and fight/reap with X" readies and then uses the SAME
  // creature, forcing how (its printed Action would win otherwise).
  const readyFight = sentence.match(/^ready and (fight|reap) with (.+)$/);
  if (readyFight) {
    const object = parseObject(readyFight[2], upgrade, observer);
    if (!object || object.s !== "target") return null;
    return {
      acts: [{ k: "ready", s: object.s }, { k: "use", s: object.s, via: readyFight[1] as "fight" | "reap" }],
      target: object.target,
    };
  }

  // Lote 3 (§3.4): splash damage ships BEFORE the target damage, so the target
  // dying cannot rob its neighbors of the splash — the only exception to the
  // printed order (the system prompt states it).
  const splash = sentence.match(/^deal (\d+) damage to (.+?), with (\d+) damage splash$/);
  if (splash) {
    const object = parseObject(splash[2], upgrade, observer);
    if (!object || object.s !== "target") return null;
    return {
      acts: [
        { k: "damage", n: Number(splash[3]), s: "targetNeighbors" },
        { k: "damage", n: Number(splash[1]), s: "target" },
      ],
      target: object.target,
    };
  }

  // Lote 3 (§3.3): +1 power counters ("give X two +1 power counters", "put two
  // +1 power counters on X"). Removal and "for each counter" stay out.
  const giveCounters = sentence.match(new RegExp(`^give (.+?) (${COUNTER_COUNT}) \\+1 power counters?$`));
  if (giveCounters) {
    const object = parseObject(giveCounters[1], upgrade, observer);
    return object ? { acts: [{ k: "counter", n: COUNT_WORDS[giveCounters[2]] ?? Number(giveCounters[2]), s: object.s }], target: object.target } : null;
  }
  const putCounters = sentence.match(new RegExp(`^put (${COUNTER_COUNT}) \\+1 power counters? on (.+)$`));
  if (putCounters) {
    const object = parseObject(putCounters[2], upgrade, observer);
    return object ? { acts: [{ k: "counter", n: COUNT_WORDS[putCounters[1]] ?? Number(putCounters[1]), s: object.s }], target: object.target } : null;
  }
  // Lote 4 §4.10: counters off cards; the number is optional (absent = all).
  const removeCounter = sentence.match(/^remove (?:each |all |(a|an|one|\d+) )?\+1 power counters? from (.+)$/);
  if (removeCounter) {
    const object = parseObject(removeCounter[2], upgrade, observer);
    if (!object) return null;
    return {
      acts: [{ k: "removeCounter", ...(removeCounter[1] ? { n: COUNT_WORDS[removeCounter[1]] ?? Number(removeCounter[1]) } : {}), s: object.s }],
      target: object.target,
    };
  }
  // Lote 11 §E (Cybergiant Rig): "this creature loses a +1 power counter".
  const loses = sentence.match(/^(.+?) loses? (a|an|one|\d+) \+1 power counters?$/);
  if (loses) {
    const object = parseObject(loses[1], upgrade, observer);
    return object ? { acts: [{ k: "removeCounter", n: COUNT_WORDS[loses[2]] ?? Number(loses[2]), s: object.s }], target: object.target } : null;
  }
  // Lote 4 §4.9: amber off cards ("to your pool" / "to the common supply").
  const moveAmber = sentence.match(/^(?:move|return) (\d+) amber from (.+?) to your pool$/);
  if (moveAmber) {
    const object = parseObject(moveAmber[2], upgrade, observer);
    return object
      ? { acts: [{ k: "moveAmber", n: Number(moveAmber[1]), s: object.s, to: "pool" }], target: object.target }
      : null;
  }
  const supply = sentence.match(/^(?:move|return) (?:(\d+)|each|all) amber from (.+?) to the common supply$/);
  if (supply) {
    const object = parseObject(supply[2], upgrade, observer);
    return object
      ? { acts: [{ k: "moveAmber", ...(supply[1] ? { n: Number(supply[1]) } : {}), s: object.s, to: "supply" }], target: object.target }
      : null;
  }

  // Lote 15a: o "and" com vírgula ("purge Art Project, and your opponent draws
  // 10 cards") é o composto de sempre — a vírgula só sobra no lado esquerdo.
  const conjunction = sentence.match(/^(.+?),? and (.+)$/);
  if (conjunction && !/^stun and |^ready and /.test(sentence)) {
    const left = parseSentenceBody(conjunction[1].replace(/,$/, ""), upgrade, creature, quoted, observer);
    // On an upgrade "it" after "this creature" is still the host (Cybergiant Rig), not the upgrade card.
    const right = parseSentenceBody(upgrade ? conjunction[2].replace(/^give it /, "give this creature ") : conjunction[2], upgrade, creature, quoted, observer);
    if (left && right && left.acts.length && right.acts.length && !left.cond && !right.cond) {
      // "Deal 1D to a creature and enrage it": "it" is the creature the left clause chose, not the source card.
      if (left.target && !right.target && !upgrade && !observer && /(?:^| )it$/.test(conjunction[2])) {
        for (const act of right.acts) if ("s" in act && act.s === "self") act.s = "target";
      }
      return { acts: [...left.acts, ...right.acts], target: left.target ?? right.target, ...(left.optional || right.optional ? { optional: true } : {}) };
    }
    // Lote 15b (target-select): "Destroy each creature with the lowest power and
    // each creature with the highest power" — o lado direito é OBJETO puro do
    // mesmo verbo (sem verbo próprio): o ato da esquerda se repete com a nova
    // seleção. Só quando o ato da esquerda também é seleção de CONJUNTO
    // (each/pick) — "stun a creature and each of its neighbors" continua sendo o
    // composto de um objeto só (`targetAndNeighbors`) e "a X and an Y" pediria um
    // segundo alvo escolhido, ambos fora.
    if (left && (!right || !right.acts.length) && left.acts.length === 1 && !left.cond) {
      const [head] = left.acts;
      const object = parseObject(conjunction[2], upgrade, observer);
      if ("s" in head && typeof head.s === "object" && object && typeof object.s === "object") {
        return { acts: [...left.acts, { ...head, s: object.s } as Act], ...(left.target ? { target: left.target } : {}), ...(left.optional ? { optional: true } : {}) };
      }
    }
  }

  for (const [pattern, build] of VERBS) {
    const m = sentence.match(pattern);
    if (!m) continue;
    const { k, n, obj, at, own, opp } = build(m);
    const object = parseObject(m[obj], upgrade, observer);
    if (!object) return null;
    // keyteki's UseAction only affects creatures that can be used right now.
    if (k === "use" && object.target) object.target.ready = true;
    // An s-only verb carries no `n` at all (the number belongs to the verbs that
    // read one) — the few-shots and the schema teach exactly this shape.
    return {
      acts: [
        {
          k,
          s: object.s,
          ...(n === undefined ? {} : { n }),
          ...(at ? { at } : {}),
          ...(own ? { own: true } : {}),
          ...(opp ? { opp: true } : {}),
        } as Act,
      ],
      target: object.target,
    };
  }
  return null;
}

/** The abilities of one printed segment. One segment can hold TWO abilities:
    "If you are overwhelmed, steal 2A. Otherwise, steal 1A." closes the first
    one and opens a twin with the negated condition. The negation is the whole
    point — a second `if:{k:"not"}` can never be expressed as one ability. */
function parseAbilities(triggers: Trigger[], body: string, upgrade: boolean, creature: boolean, quoted: string[], of?: Filter, headerIf?: Condition, selfWatch = false): Ability[] | null {
  // "That house" is the active one under a `house` trigger, the chosen one after
  // the ability's own "Choose a house" (Lote 5); a quoted grant parsed inside
  // this ability starts clean and hands the state back.
  const savedThat = thatHouse;
  const savedChose = choseHouse;
  thatHouse = triggers.includes("house") ? "active" : null;
  choseHouse = false;
  try {
    const done = parseAbilityBody(triggers, body, upgrade, creature, quoted, of, headerIf, selfWatch);
    // "Choose a house" and a `chosen` reader must come together: one without the
    // other would claim full coverage for a text the engine cannot resolve.
    // `redirect:"chosen"` (Lote 8) names the ability's chosen creature, not a house.
    return done && choseHouse === /"(?:chosen|!chosen)"|"forceHouse"\}/.test(JSON.stringify(done).replaceAll('"redirect":"chosen"', "")) ? done : null;
  } finally {
    thatHouse = savedThat;
    choseHouse = savedChose;
  }
}

/** The ability had its own "Choose a house" sentence (Lote 5 §5.1). */
let choseHouse = false;

function parseAbilityBody(triggers: Trigger[], body: string, upgrade: boolean, creature: boolean, quoted: string[], of?: Filter, headerIf?: Condition, selfWatch = false): Ability[] | null {
  // Lote 15b: a escolha do jogador ("Choose up to N …") é por ability — uma
  // ability seguinte não herda o pick da anterior.
  chosenCards = null;
  const done: Ability[] = [];
  const watching = of ? { of } : {};
  // `of` marks an observer, whose "it" is the event card. A self ready-watch still
  // needs `of` (only observers hear the ready step) but "deal 2 to it" names the watcher.
  const observer = of !== undefined && !selfWatch;
  // Lote 8 §8.4: "Choose one:" followed by exactly two options (the printed lines collapse into sentences).
  const modal = body.trim().match(/^choose one:\s*(.+)$/);
  if (modal) {
    const options = modal[1].split(/\.\s*/).map((part) => part.trim()).filter(Boolean);
    if (options.length !== 2) return null;
    const modalActs: Act[] = [];
    for (const [index, option] of options.entries()) {
      const parsed = parseSentence(option, upgrade, creature, quoted, observer);
      if (!parsed || parsed.target || parsed.target2 || parsed.cond || !parsed.acts.length) return null;
      for (const act of parsed.acts) act.mode = index === 0 ? "a" : "b";
      modalActs.push(...parsed.acts);
    }
    return [{ on: triggers, ...(headerIf ? { if: headerIf } : {}), acts: modalActs, ...watching }];
  }
  let ability: Ability = { on: triggers, ...(headerIf ? { if: headerIf } : {}), acts: [], ...watching };
  const close = (): boolean => {
    if (!ability.acts.length) return false;
    // Lote 11 §H: "put/discard that card" acts on what the act right before showed — same zone, same owner — or it is orphan.
    let orphan = false;
    ability.acts.forEach((act, index) => {
      if (act.k !== "move" || act.pick !== "revealed") return;
      const shown = ability.acts[index - 1];
      if (shown?.k !== "reveal" && shown?.k !== "peek") orphan = true;
      else {
        act.from = shown.from;
        if (shown.opp) act.opp = true;
      }
    });
    if (orphan) return false;
    // "Discard the top card of a player's deck. If it is a creature, purge it": the second move follows the first one's zone owner (Lote 8 §8.7).
    ability.acts.forEach((act, index) => {
      const before = ability.acts[index - 1];
      if (act.k === "move" && act.pick === "moved" && before?.k === "move" && before.side && !act.side && !act.opp) act.side = before.side;
    });
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
  // The leading comma of an observer segment ("…reaps, stun it.") belongs to the
  // prefix, not to the sentence.
  const sentences = body.split(/\.\s*/).map((part) => part.trim().replace(/^,\s*/, "")).filter(Boolean);
  // Lote 11 §F: "Deal 2 for each X. You may divide this damage among any number of creatures." is ONE act.
  for (let index = 0; index < sentences.length - 1; index += 1) {
    const pool = sentences[index].match(/^deal (\d+) damage for each (.+)$/);
    const split = sentences[index + 1].match(/^(?:you may )?divide this damage among (.+)$/);
    if (pool && split) sentences.splice(index, 2, `deal ${pool[1]} damage divided among ${split[1]} for each ${pool[2]}`);
  }
  // Lote 15a: "…, then …" / "Then, …" abrem um link sequencial (`then`); cada
  // vírgula-then vira uma cláusula própria, com o gate no ato anterior.
  const clauses: { text: string; link: boolean }[] = [];
  for (const sentence of sentences) {
    sentence.split(/\s*,\s*then\s+|\s+then,\s+/).forEach((part, index) => {
      const text = (index === 0 ? part.replace(/^then,\s+/, "") : part).trim();
      if (text) clauses.push({ text, link: index > 0 || /^then[,\s]/.test(sentence) });
    });
  }
  const independent = clauses.filter((part) => /^if (?!you do)/.test(part.text)).length;
  // Lote 15b: uma cláusula condicional que não resolve ato próprio ("If you do,
  // choose a house.") guarda o gate para a frase seguinte — "Enrage each
  // creature of that house" tem de morrer com o "You may" recusado (Draco Praeco).
  let carryCond: Condition | null = null;
  for (const { text: sentence, link } of clauses) {
    // The branch of an "Otherwise" is only legal right after a conditional
    // clause, and it negates the condition printed BEFORE it.
    const otherwise = sentence.match(/^otherwise,? (.+)$/);
    if (otherwise) {
      const condition = ability.if;
      if (!condition || !close()) return null;
      ability = { on: triggers, if: { k: "not", c: condition }, acts: [], ...watching };
    }
    const parsed = parseSentence(otherwise ? otherwise[1] : sentence, upgrade, creature, quoted, observer);
    if (!parsed) return null;
    const ifYouDo = !otherwise && /^if you do,? /.test(sentence);
    // "You may X. If you do, Y.": declining X declines Y too, so the dependent
    // clause inherits the optional flag of the clause before it.
    if (ifYouDo && ability.acts.length && ability.acts.every((act) => act.optional)) {
      for (const act of parsed.acts) act.optional = true;
    }
    if (parsed.target2) ability.target2 = parsed.target2;
    if (parsed.target) {
      if (ability.target) {
        // A later "a/an … creature" sentence has no `target` slot left: those
        // cards are engine-picked (the player only chooses the first target).
        for (const act of parsed.acts) if ("s" in act && act.s === "target") act.s = { pick: parsed.target };
      } else ability.target = parsed.target;
    }
    // Lote 15a: o link sequencial marca os atos da cláusula com `then` — o bloco
    // de um "If you do, X, and Y" (mais de um ato) compartilha o gate do ato
    // anterior, como o `then: {gameAction: […]}` do keyteki. "If you do" de um
    // ato só continua sendo `if: count did` (o did do ato imediatamente antes).
    const linked = link || (ifYouDo && parsed.acts.length > 1);
    if (linked) {
      for (const act of parsed.acts) act.then = true;
      // "Then, if <cond>, X": o `then` é o gate; o `if` é a condição impressa.
      if (parsed.cond && !ifYouDo) for (const act of parsed.acts) act.if = parsed.cond;
    } else if (parsed.cond) {
      // The condition the ability OPENS with gates the whole ability (it keeps
      // the AI's pruning); one printed in a later clause gates only its own
      // acts — "Damage a creature. If it is not destroyed, draw a card."
      // Lote 7: with two independent conditionals ("If your red key is forged, … If your yellow
      // key is forged, …") the first cannot gate the ability — each one gates only its own acts.
      if (!ability.acts.length && !ability.if && independent < 2) ability.if = parsed.cond;
      else for (const act of parsed.acts) act.if = parsed.cond;
    }
    // O gate de uma cláusula sem atos acompanha a próxima cláusula com atos.
    if (carryCond && parsed.acts.length && !parsed.cond) {
      for (const act of parsed.acts) if (act.if === undefined) act.if = carryCond;
    }
    carryCond = parsed.cond && !parsed.acts.length ? parsed.cond : null;
    madeToken = parsed.acts.some((act) => act.k === "makeToken");
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
  // Lote 11 §G (Panpaca): every creature to one side of the source in its battleline, not only the neighbors.
  const beside = phrase.match(/^(?:friendly )?creatures? to the (left|right) of (?:this card|this creature|it|~)(?: in the battleline)?$/);
  if (beside) return { type: "Creature", ...(beside[1] === "left" ? { leftOf: true } : { rightOf: true }) };
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
    // The quoted text runs on the creature that RECEIVES it (the host of an upgrade), so inside it "this creature" is the source (Lote 11 §E).
    const abilities = upgrade ? parseQuoted(quoted[Number(grant[2])], false, true, quoted) : parseQuoted(quoted[Number(grant[2])], upgrade, creature, quoted);
    return abilities ? { target, abilities } : null;
  }
  // Onda 4 (Spyyyder): "gains poison while attacking an enemy flank creature" —
  // the keyword exists only during the fights the target starts, against the
  // defenders its filter matches (`whenAttacking`, like the attack bonus).
  const fighting = sentence.match(/^(.+?) gains? ([a-z-]+(?: \d+)?) while attacking (?:an? |the )?(.+)$/);
  if (fighting) {
    const target = parseSubject(fighting[1], upgrade);
    const parsed = readKeyword(fighting[2]);
    const defender = parseFilterWords(fighting[3].replace(/ on the flank$/, " on a flank"));
    return target && parsed && defender ? { target, attackKeywords: { [parsed[0]]: parsed[1] }, whenAttacking: defender } : null;
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
    // A comma-terminated turn trigger is legal inside a grant too ("gains, 'At
    // the start of your turn, if this creature is exhausted, …'", §4.2).
    /^((?:play|reap|fight|destroyed|omni|action|scrap|before [^:.]{1,90}|after [^:.]{1,90}|at the (?:start|end) of your turn(?=\s*,)|at the [^:.]{1,90})(?:\/(?:after )?(?:play|reap|fight|destroyed))*)\s*(?::|,)\s*(.+)$/i,
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
  // Lote 8 §8.2 (Tentacus): a toll to use an artifact, paid to the card's controller.
  const toll = sentence.match(/^your opponent must pay you (\d+) amber in order to use an artifact$/);
  if (toll) return { who: "opponent", action: "use", type: "Artifact", cost: Number(toll[1]) };
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
  if (/^ cards of the purged card's type$/.test(rest)) return { ...restrict, type: "moved" };
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
  // Lote 12: the upgrade's legal host is an artifact. Read at play time (`hosts`), not as a stat.
  if (sentence === "this upgrade enters play attached to an artifact instead of a creature") return [{ target: { self: true }, hosts: "Artifact" }];
  let body = sentence;
  let duration: PersistentEffect["duration"];
  const untilNext = body.match(/^until the start of your next turn, (.+)$/);
  if (untilNext) {
    body = untilNext[1];
    duration = "next";
  }
  const refill = body.match(
    /^during (your|their) "?draw cards"? step, (you|your opponent|each player) refills? (?:your|their) hands? to (\d+) (additional|less) cards?$/,
  ) ?? body.match(/^(you|your opponent|each player) refills? (?:your|their) hands? to (\d+) (additional|less) cards? during (your|their) "?draw cards"? step$/);
  if (refill) {
    const who = refill[0].startsWith("during") ? refill[2] : refill[1];
    const count = Number(refill[0].startsWith("during") ? refill[3] : refill[2]);
    const dir = refill[0].startsWith("during") ? refill[4] : refill[3];
    const hand = dir === "less" ? -count : count;
    const effect: PersistentEffect = { target: {}, hand };
    const effects = who === "each player" ? [effect, { ...effect, opp: true }] : who === "you" ? [effect] : [{ ...effect, opp: true }];
    return effects.map((item) => (duration ? { ...item, duration } : item));
  }
  let per: Count | null = null;
  let condition: Condition | null = null;
  const prefix = body.match(/^for the remainder of the turn, (.+)$/);
  if (prefix) {
    body = prefix[1];
    duration = "turn";
  }
  // Lote 11 §C: "During your opponent's next turn, creatures … cannot reap" (either position) — the lasting duration of the
  // "on their next turn" tail. Only for this sentence: "Keys cost +N during your opponent's next turn" is the keyCost ACT
  // of SIMPLE (opp), and reading it here would charge both players.
  const opponentsTurn = body.match(/^during your opponent's next turn, (.+ (?:cannot be used to reap|cannot reap))$/) ?? body.match(/^(.+ (?:cannot be used to reap|cannot reap)) during your opponent's next turn$/);
  if (opponentsTurn) {
    body = opponentsTurn[1];
    duration = "next";
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
  // "… unless <condition>" (Lote 4 §4.2): the effect applies while the
  // condition does NOT hold ("cannot ready unless you are haunted").
  const unless = body.match(/^(.+) unless (.+)$/);
  if (unless) {
    const cond = parseCondition(unless[2]);
    if (cond) {
      condition = { k: "not", c: cond };
      body = unless[1];
    }
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
  // Onda 4 (Miasma): "Your opponent skips the 'forge a key' step during their
  // next turn" — a one-shot lasting: the engine consumes it at the opponent's
  // next key step ("on/during their next turn" already set the duration).
  const skipForge = body.match(/^your opponent skips the "?forge a key"? step$/);
  if (skipForge) return [{ target: {}, opp: true, skipForgeStep: true, duration: duration ?? "next", ...gate }];
  // Lote 4 §4.2: "This creature cannot ready" (always) / "does not ready during
  // your 'ready cards' step" (step only). The subject is the host of an upgrade
  // or the card itself.
  const noReady = body.match(/^(.+?) (?:cannot ready|does not ready during your "?ready cards"? step)$/);
  if (noReady) {
    const target = parseSubject(noReady[1], upgrade) ?? parseFilterWords(noReady[1]);
    if (!target) return null;
    return [{ target, noReady: body.endsWith("step") ? "step" : true, duration, ...gate }];
  }
  // Lote 5 §5.6: only the unqualified immunities ("by Mutant creatures" and
  // "unless" stay out of the grammar).
  // "Invulnerable" (Seda the Sleeper) reuses the same damage `prevent`: it already cancels fight damage before
  // ward/armor, so the ward is never spent. "Cannot be destroyed" by non-damage effects is not modelled.
  const immune = body.match(/^(.+?) (?:cannot be dealt damage|(?:gains?|is|are) invulnerable)$/);
  if (immune) {
    const target = parseSubject(immune[1], upgrade) ?? parseFilterWords(immune[1]);
    return target ? [{ target, replace: { on: "damage", prevent: true }, duration, ...gate }] : null;
  }
  if (body === "your amber cannot be stolen") return [{ target: {}, noSteal: true, duration, ...gate }];
  // Lote 5 §5.3: "This creature belongs to all houses" / to a named house. A
  // target that filters by house would recurse in game.houseOf (the gate rejects
  // it too), so the grammar never produces one.
  const belongs = body.match(/^(.+?) belongs? to (all houses|(?:house )?([a-z ]+?)(?: house)?)$/);
  if (belongs) {
    const house = belongs[2] === "all houses" ? "all" : HOUSES[belongs[3]];
    const target = house ? (parseSubject(belongs[1], upgrade) ?? parseFilterWords(belongs[1])) : null;
    return target && target.house === undefined ? [{ target, house, duration, ...gate }] : null;
  }
  // Lote 8 §8.6: a granted trait (only a printed proper noun is a trait, like the filters).
  const trait = body.match(/^(.+?) gains? the ([a-z]+) trait$/);
  if (trait && properNouns.has(trait[2])) {
    const target = parseSubject(trait[1], upgrade) ?? parseFilterWords(trait[1]);
    return target && target.trait === undefined ? [{ target, traits: trait[2][0].toUpperCase() + trait[2].slice(1), duration, ...gate }] : null;
  }
  // Lote 8 §8.8: "each friendly creature may fight" (outside the active house).
  const mayFight = body.match(/^(.+?) may fight$/);
  if (mayFight) {
    const target = parseSubject(mayFight[1], upgrade) ?? parseFilterWords(mayFight[1]);
    return target ? [{ target, mayFight: true, duration, ...gate }] : null;
  }
  // Lote 10 §10.2: "~ deals +2 while attacking an enemy creature on the flank" — a fight-time bonus of the
  // attacker, optionally narrowed by a filter on the defender (never power: see game.attackBonusAgainst).
  const attack = body.match(/^(this card|this creature|it|~) deals \+(\d+)(?: damage)? while attacking (?:an? |the )?(.+)$/);
  if (attack) {
    const defender = parseFilterWords(attack[3].replace(/ on the flank$/, " on a flank"));
    return defender ? [{ target: upgrade ? { host: true } : { self: true }, attackBonus: Number(attack[2]), whenAttacking: defender, duration, ...gate }] : null;
  }
  // Lote 11 §D: a fight-damage ceiling of the attacker, and damage cancelled at its dealer by role.
  const cap = body.match(/^(this card|this creature|it|~) only deals (\d+) damage when (?:fighting|attacking)$/);
  if (cap) return [{ target: upgrade ? { host: true } : { self: true }, fightDamageCap: Number(cap[2]), duration, ...gate }];
  const noDamage = body.match(/^(this card|this creature|it|~) deals no damage when (attacked|attacking|fighting)$/);
  if (noDamage) {
    const roles: ("attacking" | "defending")[] = noDamage[2] === "attacked" ? ["defending"] : noDamage[2] === "attacking" ? ["attacking"] : ["attacking", "defending"];
    return roles.map((when) => ({ target: upgrade ? { host: true } : { self: true }, replace: { on: "damage", prevent: true, when }, duration, ...gate }));
  }
  // Lote 11 §A: "Your creatures enter play ready" / "If you are haunted, ~ enters play ready" (the `if` is the gate).
  const entersReady = body.match(/^(.+?) enters? play ready$/);
  if (entersReady) {
    const who = entersReady[1].replace(/^(?:each |all )?(?:of )?your /, "friendly ");
    const target = parseSubject(who, upgrade) ?? parseFilterWords(who);
    return target ? [{ target, entersPlayReady: true, duration, ...gate }] : null;
  }
  // Lote 11 §B (Helper Bot): "play one non-Logos card this turn" opens the play outside the active house.
  const mayPlay = body.match(/^play (a|an|one|two|three|\d+) (non-)?([a-z ]+?) cards? this turn$/);
  if (mayPlay) {
    const house = HOUSES[mayPlay[3]];
    return house ? [{ target: { house: (mayPlay[2] ? "!" : "") + house }, mayPlay: COUNT_WORDS[mayPlay[1]] ?? Number(mayPlay[1]), duration: duration ?? "turn", ...gate }] : null;
  }
  // Lote 11 §C (Seismo-entangler): creatures that cannot be used to reap; the filter names which.
  const noReap = body.match(/^(.+?) (?:cannot be used to reap|cannot reap)$/);
  if (noReap) {
    const target = parseSubject(noReap[1], upgrade) ?? parseFilterWords(noReap[1]);
    if (!target) return null;
    // Without a side both players are bound — except "during your opponent's next turn", where only the opponent acts.
    const who: ("you" | "opponent")[] = target.side === "enemy" || (!target.side && duration === "next") ? ["opponent"] : target.side === "friendly" ? ["you"] : ["you", "opponent"];
    return who.map((side) => ({ target: { ...target }, restrict: { who: side, action: "reap" }, duration, ...gate }));
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
  cardHouse = (face.house ?? "").toLowerCase();
  madeToken = false;
  chosenCards = null;
  const { text, quoted } = maskQuotes(normalise(face.text ?? ""));
  // Self references only inside ability text, so a card named like a keyword keeps its keywords.
  // The title is also a ready-prefix ("After you ready Seda the Sleeper"); splicing it into
  // the whole text would eat "Splash-attack".
  const self = new RegExp(`\\b${normalise(face.title).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  cardTitle = normalise(face.title);
  const upgrade = face.type === "Upgrade";
  const creature = face.type === "Creature";
  const segments: { prefix: string | null; body: string }[] = [];
  let last = 0;
  let prefix: string | null = null;
  for (const match of text.matchAll(prefixPattern())) {
    segments.push({ prefix, body: text.slice(last, match.index) });
    prefix = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6] ?? null;
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
    const header = abilityHeader(raw!);
    const parsed = header
      ? parseAbilities(header.triggers, body.replace(self, "this card"), upgrade, creature, quoted, header.of, header.cond, header.selfWatch)
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
