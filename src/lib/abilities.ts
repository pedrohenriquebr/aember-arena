// SPDX-License-Identifier: AGPL-3.0-only
// Declarative ability model ported from keyteki (https://github.com/keyteki/keyteki):
// server/game/Card.js (play/reap/fight/destroyed/action/omni registration),
// server/game/CardAbility.js + AbilityTargets (target/condition by context) and
// server/game/GameActions/* (composable game actions).
// Copyright (C) keyteki contributors. Rewritten in TypeScript for Aember Arena:
// abilities are plain data interpreted by game.ts, so the same objects feed the
// rules engine, the AI's move pruning and the coverage badge in the UI.
import { parseCardText } from "./cardText";
import type { Keywords } from "./keywords";
import type { CardFace } from "./game";

export type Trigger = "play" | "reap" | "fight" | "beforeFight" | "destroyed" | "action" | "omni";

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

export type Act =
  | { k: "gainAmber" | "loseAmber" | "steal" | "gainChains" | "draw" | "discardRandom" | "keyCost"; n: number; opp?: boolean }
  | { k: "capture"; n: number; s: Selection }
  | { k: "damage" | "heal"; n: number; s: Selection }
  | { k: "destroy" | "stun" | "exhaust" | "ready" | "unstun" | "returnToHand" | "returnToDeck" | "archive" | "use"; s: Selection }
  | { k: "fromDiscard"; type?: "Creature" }
  | { k: "archiveTop" }
  /** A triggered effect with a duration ("Play: … on their next turn"). */
  | { k: "lasting"; e: PersistentEffect };

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
  /** Clause limiting the stat bonus ("… while it is on a flank"). */
  when?: "flank";
  /** Printed duration of a triggered effect: end of this turn, or of the
      opponent's next turn (keyteki duringOpponentNextTurn). */
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

const cache = new WeakMap<CardFace, CardRules>();

/** Abilities, keywords and honest coverage for a card face (memoised per face). */
export function rulesOf(face: CardFace): CardRules {
  let rules = cache.get(face);
  if (!rules) {
    const parsed = parseCardText(face);
    const title = face.title.toLowerCase();
    rules = title in scripts ? { ...parsed, abilities: scripts[title] ?? [], coverage: "full" } : parsed;
    cache.set(face, rules);
  }
  return rules;
}
