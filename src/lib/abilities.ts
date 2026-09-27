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
}

/** Which cards an action affects. */
export type Selection = "self" | "host" | "target" | "targetAndNeighbors" | "neighborsOfFought" | { each: Filter };

export type Act =
  | { k: "gainAmber" | "loseAmber" | "steal" | "gainChains" | "draw" | "discardRandom" | "keyCost"; n: number; opp?: boolean }
  | { k: "capture"; n: number; s: Selection }
  | { k: "damage" | "heal"; n: number; s: Selection }
  | { k: "destroy" | "stun" | "exhaust" | "ready" | "unstun" | "returnToHand" | "returnToDeck" | "archive" | "use"; s: Selection }
  | { k: "fromDiscard"; type?: "Creature" }
  | { k: "archiveTop" };

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

export interface CardRules {
  abilities: Ability[];
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
    rules = title in scripts ? { abilities: scripts[title] ?? [], keywords: parsed.keywords, coverage: "full" } : parsed;
    cache.set(face, rules);
  }
  return rules;
}
