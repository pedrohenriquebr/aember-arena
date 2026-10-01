// SPDX-License-Identifier: AGPL-3.0-only
// Declarative ability model ported from keyteki (https://github.com/keyteki/keyteki):
// server/game/Card.js (play/reap/fight/destroyed/action/omni registration),
// server/game/CardAbility.js + AbilityTargets (target/condition by context) and
// server/game/GameActions/* (composable game actions).
// Copyright (C) keyteki contributors. Rewritten in TypeScript for Aember Arena:
// abilities are plain data interpreted by game.ts, so the same objects feed the
// rules engine, the AI's move pruning and the coverage badge in the UI.
import { parseCardText, textHash } from "./cardText";
import type { Keywords } from "./keywords";
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
  /** card_text identity (cardText.textHash) the DSL was written for. */
  textHash: string;
  source: "parser" | "llm" | "manual";
  reviewed: boolean;
  generatedAt: number;
  model?: string;
}

/** Cards with a DSL stored on disk, keyed by card id (DB v4 `abilities`). The
    map is loaded once at boot by App (`cache.loadAbilityOverrides`) because
    rulesOf is synchronous — the store is read into memory, never per card. */
let overrides = new Map<string, AbilityOverride>();

/** Boot/reload hook: swaps the override map and drops the memo (faces already
    answered keep the parser result otherwise). Overrides that arrive later —
    a wave-2 review approval, a re-sync — go through here again, so the next
    rulesOf call re-reads the card. */
export function setAbilityOverrides(next: Map<string, AbilityOverride>): void {
  overrides = next;
  cache = new WeakMap();
}

/** Memo per face; replaced (not mutated) when the overrides map changes. */
let cache = new WeakMap<CardFace, CardRules>();

/** The stored DSL for this exact face, when it can be trusted: `manual`
    (human-authored), `parser` (deterministic output for the same text) or an
    `llm` entry a human reviewed. An unreviewed LLM draft never reaches the
    table — plano §4: nunca meio-resolver. The text hash must match, so a card
    whose text changed falls back to the live parser. */
function storedAbility(face: CardFace): AbilityOverride | null {
  const entry = overrides.get(face.id);
  if (!entry || entry.textHash !== textHash(face.text ?? "")) return null;
  if (entry.source === "llm" && !entry.reviewed) return null;
  return entry;
}

/** Abilities, keywords and honest coverage for a card face (memoised per face).
    Order: store `abilities` (trusted entry, plano §1/§4) → hand-written script →
    text parser. A reviewed/manual stored DSL covers the card fully; a parser
    entry keeps the parser's own tally. */
export function rulesOf(face: CardFace): CardRules {
  let rules = cache.get(face);
  if (!rules) {
    const parsed = parseCardText(face);
    const stored = storedAbility(face);
    const title = face.title.toLowerCase();
    if (stored) {
      rules = { ...parsed, abilities: stored.dsl, coverage: stored.source === "parser" ? parsed.coverage : "full" };
    } else {
      rules = title in scripts ? { ...parsed, abilities: scripts[title] ?? [], coverage: "full" } : parsed;
    }
    cache.set(face, rules);
  }
  return rules;
}
