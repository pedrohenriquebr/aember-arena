// SPDX-License-Identifier: AGPL-3.0-only
// Declarative ability model ported from keyteki (https://github.com/keyteki/keyteki):
// server/game/Card.js (play/reap/fight/destroyed/action/omni registration),
// server/game/CardAbility.js + AbilityTargets (target/condition by context) and
// server/game/GameActions/* (composable game actions).
// Copyright (C) keyteki contributors. Rewritten in TypeScript for Aember Arena:
// abilities are plain data interpreted by game.ts, so the same objects feed the
// rules engine, the AI's move pruning and the coverage badge in the UI.
import { PARSER_VERSION, parseCardText, textHash } from "./cardText";
import { ENGINE_KEYWORDS, type Keywords } from "./keywords";
import type { CardFace } from "./game";

/** Event an ability is bound to. "after X" is the post-event window (keyteki
    reaction) and "each time X" fires again on every occurrence of X — the
    engine calls fire() once per occurrence, so no per-turn counter is needed.
    Global watchers ("Each time you play another creature") stay out: they
    would need an event bus across sources, not a card-bound trigger. */
export type Trigger = "play" | "reap" | "fight" | "beforeFight" | "destroyed" | "action" | "omni" | "startOfTurn" | "endOfTurn";

/** Card filter. `side` is relative to the ability's controller. */
export interface Filter {
  type?: "Creature" | "Artifact";
  side?: "friendly" | "enemy";
  damaged?: boolean;
  flank?: boolean;
  other?: boolean;
  ready?: boolean;
  /** Only the N most powerful matching creatures. */
  top?: number;
  /** The source card itself ("This creature gets +1 power"). */
  self?: boolean;
  /** The creature an upgrade is attached to ("This creature gets +2 armor" on an upgrade). */
  host?: boolean;
  /** The source's neighbors ("Each of ~'s neighbors gets +2 armor"). */
  neighborsOfSource?: boolean;
}

/** Which cards an action affects. */
export type Selection = "self" | "host" | "target" | "targetAndNeighbors" | "neighborsOfFought" | { each: Filter };

export type Act = (
  | { k: "gainAmber" | "loseAmber" | "steal" | "gainChains" | "draw" | "discardRandom" | "keyCost"; n: number; opp?: boolean }
  | { k: "capture"; n: number; s: Selection }
  | { k: "damage" | "heal" | "exalt"; n: number; s: Selection }
  | { k: "destroy" | "purge" | "sacrifice" | "stun" | "exhaust" | "ready" | "unstun" | "returnToHand" | "returnToDeck" | "archive" | "use"; s: Selection }
  /** Set tokens of the set layer (keyteki WardAction/EnrageAction/RemoveWardAction)
      and control changes (game.takeControl). */
  | { k: "ward" | "removeWard" | "enrage" | "removeEnrage" | "takeControl"; s: Selection }
  /** "Make a token creature": the token is born on the battleline (keyteki
      MakeTokenCreatureAction), never in the deck. */
  | { k: "makeToken"; n: number }
  /** Forging/unforging outside the key step (keyteki ForgeAction/UnforgeAction):
      `free` is "at no cost", `mod` a "+N cost" modifier. */
  | { k: "forgeKey"; n: number; free?: boolean; mod?: number }
  | { k: "unforgeKey"; n: number }
  | { k: "fromDiscard"; type?: "Creature" }
  | { k: "archiveTop" }
  /** A triggered effect with a duration ("Play: … on their next turn"). */
  | { k: "lasting"; e: PersistentEffect }
) & {
  /** "You may <efeito>": the actor decides whether this part resolves. */
  optional?: boolean;
};

/** Specification: "may this ability resolve now?" — evaluated by the engine and
    by the AI (ai.ts) to prune moves whose effect can never happen. */
export type Condition =
  | { k: "amber"; opp: boolean; op: "eq" | "gte"; n: number }
  | { k: "moreCreatures" }
  | { k: "fewerCreatures" }
  | { k: "not"; c: Condition };

export interface Ability {
  on: Trigger[];
  if?: Condition;
  target?: Filter;
  acts: Act[];
  /** Every act is a "You may" clause: the whole ability can be declined. */
  optional?: boolean;
}

export type Coverage = "full" | "partial" | "vanilla";

/** "You cannot play/use/fight …" — a prohibition a card in play projects on a
    player (keyteki effects.playerCannot). `who` is relative to the card's
    controller. */
export interface Restrict {
  who: "you" | "opponent";
  action: "play" | "use" | "fight";
  /** Only cards of this type are banned; absent bans every card of the action. */
  type?: string;
  /** "cannot play more than N cards each turn" — a per-turn budget, not a ban. */
  limit?: number;
}

/** An "instead" replacement of an engine default (Onda 4, docs/ROADMAP_REVIEW.md
    §3): a `destroy` that moves the card to another zone instead of the discard
    pile, or damage redirected to the effect's source. Consulted by
    game.destroy()/leavePlay()/dealDamage() before they run the default. */
export interface Replacement {
  on: "destroy" | "damage";
  /** Where a destroyed card goes instead (keyteki's leave-play interrupt). */
  to?: "archives" | "hand" | "deck" | "purged";
  /** The damage is dealt to the effect's source instead (Shadow Self). */
  redirect?: boolean;
}

/** A persistent effect: stat deltas, granted keywords/abilities and prohibitions
    a card projects on the cards its `target` matches. Constant text is derived
    from the board on every query (game.activeEffects) and never stored; a
    triggered effect with a duration is stored as a lasting copy (`until`). */
export interface PersistentEffect {
  target: Filter;
  power?: number;
  armor?: number;
  /** Keywords granted to the target ("Each friendly creature gains Taunt"). */
  keywords?: Keywords;
  /** Abilities granted by "gains 'Reap: …'", parsed with the same grammar. */
  abilities?: Ability[];
  restrict?: Restrict;
  /** "Instead" replacement of the engine default for the target cards. */
  replace?: Replacement;
  /** Clause limiting the stat bonus ("… while it is on a flank"). */
  when?: "flank";
  /** Printed duration of a triggered effect: end of this turn, or of the
      opponent's next turn (keyteki duringOpponentNextTurn). Trap: "next" is
      stamp + 2, correct ONLY for "the opponent's next turn"; a "your next
      turn" text would be pruned as that turn starts. Branch on `side` first. */
  duration?: "turn" | "next";
  /** Lasting effects: the turn stamp (game.turnStamp) at which they expire. */
  until?: number;
  /** Lasting effects: the side that created them. */
  side?: 0 | 1;
}

export interface CardRules {
  abilities: Ability[];
  /** Constant text: modifications, grants and prohibitions read off the board. */
  effects: PersistentEffect[];
  keywords: Keywords;
  coverage: Coverage;
}

/** Card modules, in the spirit of keyteki's server/game/cards/<set>/<Card>.js,
    for cards whose starter-deck text is a paraphrase the text parser should not
    guess at. Keyed by lowercase title; `null` means "no ability beyond the
    printed bonus icons/keywords". */
const scripts: Record<string, Ability[] | null> = {
  // Starter text is reminder prose for the bonus icons / keywords.
  "dust pixie": null,
  "virtuous works": null,
  snufflegator: null,
  "ancient bear": null,
};

/** One persisted DSL entry — the DB v4 `abilities` store row (plano §2). Plain
    JSON data: the store round-trips through IndexedDB unchanged. `source` tells
    who wrote it: the deterministic `parser` (wave 1), an `llm` draft that only
    counts once a human `reviewed` it, or a `manual` curation (wave 2 fills the
    two latter; `model` records the provider for the review queue). */
export interface AbilityOverride {
  /** Store key: the Master Vault card id the DSL was written for. */
  cardId: string;
  dsl: Ability[];
  /** Constant text the DSL covers. Absent = the entry only corrects the
      triggered abilities and the parser's effects/keywords remain — in that
      case rulesOf never claims "full" coverage for the card. */
  effects?: PersistentEffect[];
  keywords?: Keywords;
  /** card_text identity (cardText.textHash) the DSL was written for. */
  textHash: string;
  source: "parser" | "llm" | "manual";
  reviewed: boolean;
  generatedAt: number;
  model?: string;
  /** `parser` rows only: the cardText.PARSER_VERSION that produced the DSL. A row
      from another version (or without one) is stale and ignored. */
  parserVersion?: number;
  /** `llm` rows that failed validation are not stored as rules; the queue keeps
      the motive so the owner sees why the card stayed vanilla (catalogLlm). */
  failure?: string;
}

/** Cards with a DSL stored on disk, keyed by card id (DB v4 `abilities`). The
    map is loaded once at boot by App (`cache.loadAbilityOverrides`) because
    rulesOf is synchronous — the store is read into memory, never per card. */
let overrides = new Map<string, AbilityOverride>();

/** Overrides apply only BETWEEN matches: swapping rules under a live match would
    change cards already in play (and reset the memo mid-turn). While a match is
    held, writes wait in `pending` and the App flushes them at launch, resume or
    victory. */
let held = false;
const pending = new Map<string, AbilityOverride>();

/** App flips this with the match lifecycle (a match in progress = held). */
export function holdAbilityOverrides(next: boolean): void {
  held = next;
}

/** Applies what waited during a match. Idempotent; called at launch/resume/win. */
export function flushAbilityOverrides(): void {
  if (!pending.size) return;
  for (const [cardId, record] of pending) overrides.set(cardId, record);
  pending.clear();
  cache = new WeakMap();
}

/** Boot/reload hook: swaps the override map and drops the memo (faces already
    answered keep the parser result otherwise). A late override — a review
    approval, a re-sync — goes through applyAbilityOverride, so the next
    rulesOf call re-reads the card. */
export function setAbilityOverrides(next: Map<string, AbilityOverride>): void {
  overrides = next;
  pending.clear();
  cache = new WeakMap();
}

/** One DSL row comes back from the store (or a review queue) and joins the live
    map without a full reload; the memo is dropped so even the exact face
    already consulted picks the new rules up — unless a match is in progress,
    then it is staged for the next boundary. */
export function applyAbilityOverride(record: AbilityOverride): void {
  if (held) {
    pending.set(record.cardId, record);
    return;
  }
  pending.delete(record.cardId);
  overrides.set(record.cardId, record);
  cache = new WeakMap();
}

/** Boot load merge. The snapshot read from disk must not overwrite an entry
    already applied during this session (a write landing between getAll() and
    the boot callback would be lost otherwise); the session entry wins, staged
    ones included. Only a real change drops the memo. */
export function mergeAbilityOverrides(loaded: Map<string, AbilityOverride>): void {
  let changed = false;
  for (const [cardId, record] of loaded) {
    if (overrides.has(cardId) || pending.has(cardId)) continue;
    if (held) pending.set(cardId, record);
    else {
      overrides.set(cardId, record);
      changed = true;
    }
  }
  if (changed) cache = new WeakMap();
}

/** Rows currently known (live + staged), newest wins — the review queue's list. */
export function listAbilityOverrides(): AbilityOverride[] {
  return [...new Map([...overrides, ...pending]).values()];
}

/** Runs `run` with `record` visible to rulesOf, then restores. For the dry-run
    of a draft in a SYNTHETIC match only: the record must carry a synthetic
    cardId (never a live card's), so a real match and its memo are untouched
    and the between-matches rule above is not bypassed for real cards. */
export function withTrialOverride<T>(record: AbilityOverride, run: () => T): T {
  const previous = overrides.get(record.cardId);
  overrides.set(record.cardId, record);
  try {
    return run();
  } finally {
    if (previous) overrides.set(record.cardId, previous);
    else overrides.delete(record.cardId);
  }
}

/** Live override of a card (what the engine would read once trusted) — the
    review queue lists from this plus the staged rows. */
export function abilityOverrideOf(cardId: string): AbilityOverride | undefined {
  return pending.get(cardId) ?? overrides.get(cardId);
}

/** Memo per face; replaced (not mutated) when the overrides map changes. */
let cache = new WeakMap<CardFace, CardRules>();

/** The stored DSL for this exact face, when it can be trusted. Trust is a
    whitelist: `manual` (human-authored), `parser` (deterministic output for the
    same text) or an `llm` entry a human reviewed. An absent/unknown source
    (corrupted disk, schema from another version) and an unreviewed LLM draft
    never reach the table — plano §4: nunca meio-resolver. The text hash must
    match, so a card whose text changed falls back to the live parser. */
function storedAbility(face: CardFace): AbilityOverride | null {
  const entry = overrides.get(face.id);
  if (!entry || entry.textHash !== textHash(face.text ?? "")) return null;
  // A frozen parser output is only valid for the grammar that wrote it.
  if (entry.source === "parser" && entry.parserVersion !== PARSER_VERSION) return null;
  const trusted = entry.source === "manual" || entry.source === "parser" || (entry.source === "llm" && entry.reviewed === true);
  return trusted ? entry : null;
}

/** Merge a trusted stored entry over the parsed rules. `effects`/`keywords`
    are replaced only when the entry carries them; coverage claims "full" only
    when the entry covers all three parts of the printed text — a dsl-only row
    keeps the parser's tally instead of lying about text it never covered. A
    `parser` entry never raises coverage: it is the parser's own output. */
function mergeStored(parsed: CardRules, stored: AbilityOverride): CardRules {
  const coversText = stored.effects !== undefined && stored.keywords !== undefined;
  return {
    ...parsed,
    abilities: stored.dsl,
    effects: stored.effects ?? parsed.effects,
    keywords: stored.keywords ?? parsed.keywords,
    coverage: stored.source !== "parser" && coversText ? "full" : parsed.coverage,
  };
}

/** Abilities, keywords and honest coverage for a card face (memoised per face).
    Order: `manual` store entry → hand-written script → reviewed `llm` entry →
    stored `parser` output → live text parser. A `parser`-sourced row must never
    precede a script, otherwise a frozen parser output would regress a curated
    card ("ancient bear" and friends). */
export function rulesOf(face: CardFace): CardRules {
  let rules = cache.get(face);
  if (!rules) {
    const parsed = parseCardText(face);
    const stored = storedAbility(face);
    const title = face.title.toLowerCase();
    if (stored?.source === "manual") rules = mergeStored(parsed, stored);
    else if (title in scripts) rules = { ...parsed, abilities: scripts[title] ?? [], coverage: "full" };
    else if (stored) rules = mergeStored(parsed, stored);
    else rules = parsed;
    cache.set(face, rules);
  }
  return rules;
}

// ---------- stored-row shape gate (DB v4) ----------
// A row written by another version (or corrupted storage) must be discarded at
// load, never handed to the engine. The gate checks structure only — when the
// Act/Condition unions grow, their key lists below must grow too; new keys are
// rejected (and the row ignored) until then, which is the safe direction.

const ABILITY_TRIGGERS: ReadonlySet<string> = new Set<Trigger>([
  "play",
  "reap",
  "fight",
  "beforeFight",
  "destroyed",
  "action",
  "omni",
  "startOfTurn",
  "endOfTurn",
]);

const ACT_KEYS: ReadonlySet<string> = new Set([
  "gainAmber",
  "loseAmber",
  "steal",
  "gainChains",
  "draw",
  "discardRandom",
  "keyCost",
  "capture",
  "damage",
  "heal",
  "exalt",
  "destroy",
  "purge",
  "sacrifice",
  "stun",
  "exhaust",
  "ready",
  "unstun",
  "returnToHand",
  "returnToDeck",
  "archive",
  "use",
  "ward",
  "removeWard",
  "enrage",
  "removeEnrage",
  "takeControl",
  "makeToken",
  "forgeKey",
  "unforgeKey",
  "fromDiscard",
  "archiveTop",
  "lasting",
]);

/** Acts whose `n` is mandatory (a missing count would become NaN in the engine). */
const NUMERIC_ACTS: ReadonlySet<string> = new Set([
  "gainAmber",
  "loseAmber",
  "steal",
  "gainChains",
  "draw",
  "discardRandom",
  "keyCost",
  "capture",
  "damage",
  "heal",
  "exalt",
  "makeToken",
  "forgeKey",
  "unforgeKey",
]);

/** Acts whose `s` selection is mandatory. */
const SELECTED_ACTS: ReadonlySet<string> = new Set([
  "capture",
  "damage",
  "heal",
  "exalt",
  "destroy",
  "purge",
  "sacrifice",
  "stun",
  "exhaust",
  "ready",
  "unstun",
  "returnToHand",
  "returnToDeck",
  "archive",
  "use",
  "ward",
  "removeWard",
  "enrage",
  "removeEnrage",
  "takeControl",
]);

const SELECTIONS: ReadonlySet<string> = new Set(["self", "host", "target", "targetAndNeighbors", "neighborsOfFought"]);
const CONDITION_KINDS: ReadonlySet<string> = new Set(["amber", "moreCreatures", "fewerCreatures", "not"]);
const KEYWORD_NAMES: ReadonlySet<string> = new Set(ENGINE_KEYWORDS);
const OVERRIDE_SOURCES: ReadonlySet<string> = new Set(["parser", "llm", "manual"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validSelection(value: unknown): boolean {
  if (typeof value === "string") return SELECTIONS.has(value);
  return isRecord(value) && isRecord(value.each);
}

function validCondition(value: unknown): boolean {
  if (!isRecord(value) || typeof value.k !== "string" || !CONDITION_KINDS.has(value.k)) return false;
  if (value.k === "amber") return typeof value.opp === "boolean" && (value.op === "eq" || value.op === "gte") && isFiniteNumber(value.n);
  if (value.k === "not") return validCondition(value.c);
  return true;
}

function validAct(value: unknown): boolean {
  if (!isRecord(value) || typeof value.k !== "string" || !ACT_KEYS.has(value.k)) return false;
  if (value.optional !== undefined && typeof value.optional !== "boolean") return false;
  if (NUMERIC_ACTS.has(value.k) && !isFiniteNumber(value.n)) return false;
  if (SELECTED_ACTS.has(value.k) && !validSelection(value.s)) return false;
  if (value.k === "lasting") return isRecord(value.e) && isRecord(value.e.target);
  return true;
}

function validAbility(value: unknown): value is Ability {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.on) || !value.on.length || !value.on.every((trigger) => typeof trigger === "string" && ABILITY_TRIGGERS.has(trigger))) return false;
  if (!Array.isArray(value.acts) || !value.acts.length || !value.acts.every(validAct)) return false;
  if (value.if !== undefined && !validCondition(value.if)) return false;
  if (value.target !== undefined && !isRecord(value.target)) return false;
  if (value.optional !== undefined && typeof value.optional !== "boolean") return false;
  return true;
}

function validKeywords(value: unknown): value is Keywords {
  return isRecord(value) && Object.entries(value).every(([name, amount]) => KEYWORD_NAMES.has(name) && isFiniteNumber(amount));
}

function validEffects(value: unknown): value is PersistentEffect[] {
  return (
    Array.isArray(value) &&
    value.every(
      (effect) =>
        isRecord(effect) &&
        isRecord(effect.target) &&
        (effect.power === undefined || isFiniteNumber(effect.power)) &&
        (effect.armor === undefined || isFiniteNumber(effect.armor)) &&
        (effect.keywords === undefined || validKeywords(effect.keywords)) &&
        (effect.abilities === undefined || (Array.isArray(effect.abilities) && effect.abilities.every(validAbility))),
    )
  );
}

/** Shape gate for rows coming off the `abilities` store. A malformed row is
    discarded with a console warning by the loader; the row is rebuilt from the
    known fields only, so junk properties never ride into the rules. Required:
    `cardId`, a DSL of structurally valid abilities, `textHash` and a source in
    the whitelist. `reviewed` defaults to false (an llm row without it is simply
    untrusted) and a missing `generatedAt` becomes 0. */
export function normaliseAbilityOverride(value: unknown): AbilityOverride | null {
  if (!isRecord(value)) return null;
  const { cardId, dsl, textHash: hash, source, model } = value;
  if (typeof cardId !== "string" || !cardId) return null;
  if (!Array.isArray(dsl) || !dsl.every(validAbility)) return null;
  if (typeof hash !== "string" || !hash) return null;
  if (typeof source !== "string" || !OVERRIDE_SOURCES.has(source)) return null;
  if (value.effects !== undefined && !validEffects(value.effects)) return null;
  if (value.keywords !== undefined && !validKeywords(value.keywords)) return null;

  const record: AbilityOverride = {
    cardId,
    dsl,
    textHash: hash,
    source: source as AbilityOverride["source"],
    reviewed: value.reviewed === true,
    generatedAt: isFiniteNumber(value.generatedAt) ? value.generatedAt : 0,
  };
  if (typeof model === "string") record.model = model;
  if (isFiniteNumber(value.parserVersion)) record.parserVersion = value.parserVersion;
  if (typeof value.failure === "string") record.failure = value.failure;
  if (value.effects !== undefined) record.effects = value.effects;
  if (value.keywords !== undefined) record.keywords = value.keywords;
  return record;
}
