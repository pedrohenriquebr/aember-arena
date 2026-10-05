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

/** Version of the STORED-ROW contract (docs/DSL_EXPANSION_PLAN.md, "Contrato de
    versionamento"). The DSL itself only grows — a new `k`, a new optional field
    or a new literal, never a rename — so a row is readable as long as its `v`
    is at most this. Bump with every batch that changes what a row means: rows
    above are discarded by the shape gate and stale failures earn a retry. */
export const DSL_VERSION = 12; // 1 = implicit (rows without `v`)

/** Event an ability is bound to. "after X" is the post-event window (keyteki
    reaction) and "each time X" fires again on every occurrence of X — the
    engine calls fire() once per occurrence, so no per-turn counter is needed.
    Global watchers ("Each time you play another creature") stay out: they
    would need an event bus across sources, not a card-bound trigger.
    `scrap` is the printed "Scrap:" of a card going to its discard pile; `house`
    wakes every card in play of BOTH sides when a player chooses the active house
    (Lote 5 §5.2). `forge` is a player event (someone forged a key). `ready` and
    `enter` are observer-only (Lote 6 §6.2): the gate rejects them without `of`.
    `discard` (Lote 7 §7.3) is observer-only too: a card left a HAND for the discard
    pile, on either side; the watched filter sees the discarded card (its `side`
    cannot — it controls nothing — so "from your hand" is `if: {k:"actor"}`). */
export type Trigger = "play" | "reap" | "fight" | "beforeFight" | "destroyed" | "action" | "omni" | "startOfTurn" | "endOfTurn" | "scrap" | "house" | "forge" | "ready" | "enter" | "discard";

/** A player's card zones an act can read or move cards out of. */
export type Zone = "hand" | "deck" | "discard" | "archives" | "purged";

/** Card filter. `side` is relative to the ability's controller. */
export interface Filter {
  /** `!Upgrade` is "a creature or artifact" (Lote 6 §6.7). */
  type?: "Creature" | "Artifact" | "Upgrade" | "!Upgrade";
  side?: "friendly" | "enemy";
  damaged?: boolean;
  flank?: boolean;
  other?: boolean;
  ready?: boolean;
  /** Only the N most powerful matching creatures. */
  top?: number;
  /** Only the N least powerful matching creatures (mirror of `top`). */
  least?: number;
  /** "the most powerful enemy creature" (Lote 8 §8.3): the N most powerful matching creatures, the superlative the parser reads. */
  most?: number;
  /** "creature with amber on it": worn amber (exalt/capture) present/absent. */
  amber?: boolean;
  /** "creature with a +1 power counter on it" (boolean) or a named counter present (string, Lote 6 §6.6). */
  counters?: boolean | string;
  /** Printed power at most/at least this (Lote 6 §6.1). Named powerMin/powerMax so they never collide with forgeKey.min. */
  powerMin?: number;
  powerMax?: number;
  /** Power strictly lower than the source's. */
  weaker?: boolean;
  /** Power strictly higher than the source's (mirror of `weaker`, Lote 8 §8.3). */
  stronger?: boolean;
  /** The card is the ability's chosen target. */
  target?: boolean;
  neighborsOfTarget?: boolean;
  /** The other card of the fight in progress (Lote 6 §6.2). */
  fighting?: boolean;
  /** The source card itself ("This creature gets +1 power"). */
  self?: boolean;
  /** The creature an upgrade is attached to ("This creature gets +2 armor" on an upgrade). */
  host?: boolean;
  /** The source's neighbors ("Each of ~'s neighbors gets +2 armor"). */
  neighborsOfSource?: boolean;
  /** "each Mars creature" (prefix `!` negates): a printed house name, `active`,
      `chosen`, or a relational house `self`/`target`/`fought`/`moved`/`neighbor`
      (Lote 5 §5.1, Lote 6 §6.3). */
  house?: string;
  /** "each Knight creature" (prefix `!` negates): a token of face.traits. */
  trait?: string;
  /** "Creatures to the left/right of ~ in the battleline" (Lote 11 §G): every creature of the SOURCE's
      battleline strictly left (lower index) or right of it — not only the neighbors. Needs a source. */
  leftOf?: boolean;
  rightOf?: boolean;
  /** "each exhausted creature": NOT the same as `ready` (a stunned card is ready). */
  exhausted?: boolean;
}

/** Which cards an action affects. "event" is the card that caused the event an
    observer ability (Ability.of) is watching; "targetNeighbors" the neighbors of
    the ability's chosen target (splash, which ships before the target damage). */
export type Selection =
  | "self"
  | "host"
  | "target"
  | "targetAndNeighbors"
  | "targetNeighbors"
  | "neighborsOfFought"
  | "fought"
  | "event"
  | "target2"
  | { each: Filter }
  /** `upTo` (Lote 7 §7.1): the player picks 0..n from the move's `targets` queue
      instead of the engine auto-picking exactly n; an empty queue is zero cards. */
  | { pick: Filter; n?: number; upTo?: boolean };

/** How many things a dynamic amount reads: the previous act of the ability
    ("did"/"gone"), a board filter, a zone/counter of a player or a stat summed
    over a selection. */
export type Count =
  | "did"
  | "gone"
  /** Total damage the previous `heal` act removed (Lote 11 §E): "a +1 power counter for each damage healed". `did`
      keeps counting cards, so "for each creature healed this way" is untouched. */
  | "healed"
  /** Creatures destroyed in a fight so far THIS turn that match the filter (Lote 11 §E, The Warchest); `side` is
      relative to the counting player and was taken when the creature died. */
  | { slain: Filter }
  /** Cards the previous act sent out of play that match the filter (Lote 8 §8.5): "for each Mutant creature destroyed this way". */
  | { gone: Filter }
  | { c: Filter }
  /** `keyColors` (Lote 7 §7.2) counts DISTINCT colors among the forged keys of the player,
      of the opponent (`opp`) or of both sides together (`any`). */
  /** `div` (Lote 8 §8.9) is the floor of the count divided by an integer: "one third of the cards in your hand". */
  | { p: Zone | "keys" | "amber" | "plays" | "keyColors"; opp?: boolean; any?: boolean; div?: number }
  | { of: "damage" | "amber" | "power" | "counters"; s: Selection; name?: string }
  /** Cards the previous act moved (Lote 6 §6.4): how many, their bonus icons, or their printed power. */
  | { m: "cards" | "icons" | "power"; house?: string; type?: string }
  /** max(0, a - b): "all but 6" (Lote 5 §5.5). */
  | { sub: [Count, Count | number] }
  /** Distinct printed houses among the cards the previous act moved (Rogue Operation). Not a Selection: `"moved"` must not select board cards. */
  | { housesOf: "moved" };

export type Act = (
  /** `who` (Lote 4 §4.6) resolves the player from the reference card of the
      ability (its target, the watched event or the fought defender) as it was
      when the ability started — "Destroy a creature. Its controller gains 1" —
      and is mutually exclusive with `opp`. */
  | { k: "gainAmber" | "loseAmber" | "steal" | "gainChains" | "draw" | "discardRandom" | "keyCost"; n: number; opp?: boolean; who?: "owner" | "controller" }
  /** `own` takes the captured amber from the creature's controller instead of
      its opponent ("captures N from its own side"). */
  | { k: "capture"; n: number; s: Selection; own?: boolean }
  | { k: "exalt"; n: number; s: Selection }
  /** `n` absent = fully heal (Lote 11 §E): every damage the selected creatures carry. */
  | { k: "heal"; n?: number; s: Selection }
  /** `divide` (Lote 11 §F, First Blood): n x per is ONE pool split among the selected cards (an `upTo` pick). The
      move's `targets` queue names the creatures — the pool is divided evenly among them, the first takes the
      remainder; with no queue the engine allocates greedily (kill what it can on the enemy side). */
  | { k: "damage"; n: number; s: Selection; divide?: true }
  | { k: "destroy" | "purge" | "sacrifice" | "stun" | "exhaust" | "ready" | "unstun" | "returnToHand" | "archive"; s: Selection }
  /** Use a creature now ("Ready and fight/reap with X"): `via` forces how the
      creature is used, because its own Action would win otherwise. `asYours` (Lote 11 §B, Remote Access) resolves
      the used card's Action/Omni with the ACTING side as its controller ("use an opponent's artifact as if it were yours"). */
  | { k: "use"; s: Selection; via?: "fight" | "reap"; asYours?: true }
  /** +1 power counters ("Give X two +1 power counters"). */
  | { k: "counter"; n: number; s: Selection; name?: string }
  /** "Put X on the bottom of its owner's deck" / "shuffle X into its owner's
      deck"; `top` is the literal of the default landing (the array's end). */
  | { k: "returnToDeck"; s: Selection; at?: "top" | "bottom" | "shuffle" }
  /** One act for the player zones: mill, discard/archive from hand, purge from a
      zone, shuffle the discard into the deck. `pick` is how the cards are
      chosen (absent = the controller's choice) and `at` where they land. */
  | { k: "move"; n: number; from: Zone; to: Zone; opp?: boolean; side?: "opponent" | "any"; pick?: "top" | "bottom" | "random" | "all" | "moved" | "revealed"; at?: "top" | "bottom" | "shuffle"; type?: string; house?: string; until?: { house?: string; type?: string } }
  /** Set tokens of the set layer (keyteki WardAction/EnrageAction/RemoveWardAction)
      and control changes (game.takeControl). */
  | { k: "ward" | "removeWard" | "enrage" | "removeEnrage"; s: Selection }
  /** `whileSource` (Lote 12, Animating Force): control lasts while the resolving card stays in play and returns to the owner when it leaves. Not a PersistentEffect — control is a zone move, re-checked only at leave. */
  | { k: "takeControl"; s: Selection; opp?: boolean; whileSource?: true }
  /** The selected artifact becomes a creature (same card, not a token copy) with this power until the source leaves play. `versatile` is granted the same way. */
  | { k: "materialize"; s: Selection; power: number; keyword?: "versatile" }
  /** Move amber off cards ("Move 1 from X to the common supply"): `n` absent
      takes everything, `to:"pool"` adds to the resolving side's pool (`opp`
      flips it, "supply" discards it). */
  | { k: "moveAmber"; s: Selection; n?: number; to: "pool" | "supply" | "target2"; opp?: boolean }
  /** Remove +1 power counters ("remove each +1 power counter from X"): `n`
      absent removes them all. */
  | { k: "removeCounter"; s: Selection; n?: number; name?: string }
  /** "Make a token creature": the token is born on the battleline (keyteki
      MakeTokenCreatureAction), never in the deck. */
  | { k: "makeToken"; n: number }
  /** Forging/unforging outside the key step (keyteki ForgeAction/UnforgeAction):
      `free` is "at no cost", `mod` a "+N cost" modifier. */
  | { k: "forgeKey"; n: number; free?: boolean; mod?: number; less?: Count; min?: number }
  /** "Choose a house" side effects (Lote 5): the chosen house becomes the card's
      until it leaves play, or the opponent's mandatory next active house. */
  | { k: "setHouse"; s: Selection; house: string }
  | { k: "forceHouse"; house?: "target" | "fought" | "moved"; who?: "owner" | "controller" }
  /** Moves the selected creatures to a flank of their controller's battleline (Lote 7 §7.1);
      the flank is the move's `flank` (default: left). */
  | { k: "toFlank"; s: Selection }
  | { k: "unforgeKey"; n: number }
  | { k: "fromDiscard"; type?: "Creature" }
  | { k: "archiveTop" }
  /** "Look at your opponent's hand" / "the top N cards of your deck" (Lote 10 §10.1): shows the cards to the
      acting player only (`GameState.peek`); the log records the count, never the identities. `opp` reads the
      opponent's zone, `n` is the deck depth (default 1; a hand is shown whole). */
  | { k: "peek"; from: "hand" | "deck"; n?: number; opp?: boolean }
  /** The PUBLIC twin of `peek` (Lote 11 §H): the cards are named in the log, and the next `move` with
      `pick:"revealed"` acts on exactly those still in the zone. `pick` "random" draws from the PRNG (default "top"). */
  | { k: "reveal"; from: "hand" | "deck"; n?: number; opp?: boolean; pick?: "random" | "top" }
  /** A triggered effect with a duration ("Play: … on their next turn"). */
  | { k: "lasting"; e: PersistentEffect }
) & {
  /** "You may <efeito>": the actor decides whether this part resolves. */
  optional?: boolean;
  /** "Choose one:" (Lote 8 §8.4): the act belongs to option "a" or "b"; only the option the move chose resolves. */
  mode?: "a" | "b";
  /** "If you do, …" / "if this damage destroys that creature": gates THIS act
      on the state left by the act before it. */
  if?: Condition;
  /** "… for each <count>" (dynamic amount: n × count). */
  per?: Count;
};

/** Specification: "may this ability resolve now?" — evaluated by the engine and
    by the AI (ai.ts) to prune moves whose effect can never happen. */
export type Condition =
  | { k: "amber"; opp: boolean; op: "eq" | "gte"; n: number }
  | { k: "moreCreatures" }
  | { k: "fewerCreatures" }
  | { k: "count"; of: Count; op: "eq" | "gte" | "lte" | "even" | "odd"; n: number }
  /** "If you forged a key on your previous turn" (`opp`: the opponent did). */
  | { k: "forged"; opp?: boolean }
  /** "If it is not your turn": the active player is the other side. */
  | { k: "myTurn" }
  /** "After you / your opponent …": the player who caused this player-event (Lote 6 §6.2). */
  | { k: "actor"; opp?: boolean }
  /** "If a red key is forged" (`any`, either side), "your red key" (default) or "your opponent's" (`opp`) — Lote 7 §7.2. */
  | { k: "key"; color: "red" | "yellow" | "blue"; opp?: boolean; any?: boolean }
  | { k: "not"; c: Condition };

export interface Ability {
  on: Trigger[];
  if?: Condition;
  /** Observer ability (docs/DSL_EXPANSION_PLAN.md §3.2): instead of reacting to
      its own trigger, the card watches an EVENT of another card ("After an enemy
      creature reaps, …"). The filter is matched against the event's card and the
      acts select it with `s:"event"`. */
  of?: Filter;
  target?: Filter;
  /** The second chosen card (Lote 7 §7.1), always another card than `target`: "from one creature to another". */
  target2?: Filter;
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
  /** `reap` (Lote 11 §C): the creatures the effect's `target` filter matches cannot be used to reap — the
      other actions ignore the filter. (A ban on using artifacts is `use` + `type`.) */
  action: "play" | "use" | "fight" | "reap";
  /** Only cards of this type are banned; absent bans every card of the action.
      `"moved"` freezes to the type of the card the previous act moved (Lote 6 §6.4). */
  type?: string;
  /** "cannot play more than N cards each turn" — a per-turn budget, not a ban. */
  limit?: number;
  /** "Your opponent must pay you N in order to use an artifact" (Lote 8 §8.2): using costs N amber, paid to the effect's controller. */
  cost?: number;
}

/** An "instead" replacement of an engine default (Onda 4, docs/ROADMAP_REVIEW.md
    §3): a `destroy` that moves the card to another zone instead of the discard
    pile, or damage redirected to the effect's source. Consulted by
    game.destroy()/leavePlay()/dealDamage() before they run the default. */
export interface Replacement {
  on: "destroy" | "damage";
  /** Where a destroyed card goes instead (keyteki's leave-play interrupt). */
  to?: "archives" | "hand" | "deck" | "purged";
  /** The damage is dealt to the effect's source instead (Shadow Self). `"chosen"` (Lote 8 §8.1, only in a `lasting` act of an ability with a `target`):
      the damage the fought creature takes during this fight goes to the ability's chosen creature. */
  redirect?: boolean | "chosen";
  /** The damage is cancelled ("cannot be dealt damage", Lote 5 §5.6). */
  prevent?: boolean;
  /** With `prevent` (Lote 11 §D): the damage the target DEALS in a fight it is in as `attacking` / `defending` is
      cancelled — "deals no damage when attacked" (Lollop) — instead of the damage it receives. */
  when?: "attacking" | "defending";
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
  /** "This creature cannot ready" — `true` blocks effect-readies too, "step"
      only the printed "ready cards" step (Lote 4 §4.2). */
  noReady?: true | "step";
  /** "This creature belongs to all houses" / to a named house (Lote 5 §5.3). */
  house?: string;
  /** "each creature gains the Mutant trait" (Lote 8 §8.6): added to the printed traits. */
  traits?: string;
  /** "each friendly creature may fight" (Lote 8 §8.8): usable to fight outside the active house (versatile for fighting only). */
  mayFight?: true;
  /** "~ deals +2 while attacking …" (Lote 10 §10.2): extra damage the source deals in a fight it starts. Only the
      attacker gets it (never when defending) and it is NOT power: effectivePower stays untouched. */
  attackBonus?: number;
  /** Narrows `attackBonus` to defenders matching this filter (`side` relative to the effect's side). */
  whenAttacking?: Filter;
  /** "~ only deals 2 damage when fighting" (Lote 11 §D): a ceiling on the fight damage the target deals as the
      ATTACKER, after `attackBonus`. */
  fightDamageCap?: number;
  /** "Your creatures enter play ready" / "If you are haunted, ~ enters play ready" (Lote 11 §A): the matching creature
      comes in ready (condition: the effect's `if`). */
  entersPlayReady?: true;
  /** "This upgrade enters play attached to an artifact instead of a creature" (Lote 12). Read at play time, not as a stat. */
  hosts?: "Artifact";
  /** "You may play one non-Logos card this turn" (Lote 11 §B): the matching hand cards may be played outside the active
      house. `true` = any number, a number = that many plays (spent from the stored lasting copy). */
  mayPlay?: true | number;
  /** "Your amber cannot be stolen": steals against the effect's side do nothing. */
  noSteal?: boolean;
  /** Clause limiting the stat bonus ("… while it is on a flank"). */
  when?: "flank";
  /** Clause gating the whole effect ("While you are haunted, …"). */
  if?: Condition;
  /** A stat/key-cost bonus multiplied by a dynamic count ("… for each card in
      your archives"). */
  per?: Count;
  /** "Keys cost +N": added to the cost the effect's side pays (`opp` → the
      other side's keys). */
  keyCost?: number;
  /** keyCost applies to the opponent of the effect's source instead.
      A `hand` delta uses the same flag: the other side's draw step (Lote 6 §6.5). */
  opp?: boolean;
  /** Added to the draw-step refill size (negative = fewer cards). */
  hand?: number;
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

/** Does this card have a hand-written script? A scripted card never goes to the
    LLM: the script wins over any draft (rulesOf), so asking would burn a call
    (pipeline hygiene, Lote 4 §4.0). */
export function hasScript(face: CardFace): boolean {
  return face.title.toLowerCase() in scripts;
}

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
  /** The DSL_VERSION that produced the row. A row above the running version
      would be read as if its narrowing fields were absent (abilities.DSL_VERSION
      is the version the engine understands), so the shape gate rejects it. */
  v?: number;
  /** `llm` rows that failed validation are not stored as rules; the queue keeps
      the motive so the owner sees why the card stayed vanilla (catalogLlm). */
  failure?: string;
  /** The draft deliberately left the `Fate:` sentence out (Lote 4 §4.1): the
      rest of the card plays and coverage reports "partial", never "full". */
  partial?: boolean;
  /** `reply:` failures only: attempts spent, so a transient bad format is
      retried but never forever (Lote 4 §4.0). */
  tries?: number;
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
    `parser` entry never raises coverage: it is the parser's own output. A row
    marked `partial` deliberately left the `Fate:` sentence out and can never
    claim better than "partial". */
function mergeStored(parsed: CardRules, stored: AbilityOverride): CardRules {
  const coversText = stored.effects !== undefined && stored.keywords !== undefined;
  return {
    ...parsed,
    abilities: stored.dsl,
    effects: stored.effects ?? parsed.effects,
    keywords: stored.keywords ?? parsed.keywords,
    coverage: stored.partial ? "partial" : stored.source !== "parser" && coversText ? "full" : parsed.coverage,
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
  "scrap",
  "house",
  "forge",
  "ready",
  "enter",
  "discard",
]);

/** Every stored act, and which of its fields the engine needs: `n` (a finite
    count, a missing one would become NaN) and `s` (a selection). The table
    replaces three key sets with one map — `Object.hasOwn` is mandatory here,
    `ACTS["constructor"]` is not undefined. */
const ACTS: Record<string, string> = {
  gainAmber: "n",
  loseAmber: "n",
  steal: "n",
  gainChains: "n",
  draw: "n",
  discardRandom: "n",
  keyCost: "n",
  capture: "ns",
  damage: "ns",
  heal: "s",
  exalt: "ns",
  destroy: "s",
  purge: "s",
  sacrifice: "s",
  stun: "s",
  exhaust: "s",
  ready: "s",
  unstun: "s",
  returnToHand: "s",
  returnToDeck: "s",
  archive: "s",
  use: "s",
  counter: "ns",
  move: "n",
  moveAmber: "s",
  removeCounter: "s",
  ward: "s",
  removeWard: "s",
  enrage: "s",
  removeEnrage: "s",
  takeControl: "s",
  materialize: "s",
  makeToken: "n",
  forgeKey: "n",
  setHouse: "s",
  forceHouse: "",
  toFlank: "s",
  unforgeKey: "n",
  fromDiscard: "",
  archiveTop: "",
  peek: "",
  reveal: "",
  lasting: "",
};

const SELECTIONS: ReadonlySet<string> = new Set(["self", "host", "target", "targetAndNeighbors", "targetNeighbors", "neighborsOfFought", "fought", "event", "target2"]);

/** Fields a stored Filter may carry. A key outside the list means the row was
    written by a NEWER grammar whose narrowing field this engine would silently
    ignore ("destroy each Mars creature" would become "each creature"), so the
    row is discarded instead. Condition fields come comma-delimited below
    (`,key,` matching, so a name is never a prefix of another). */
const FILTER_FIELDS: Record<string, 0> = {
  type: 0,
  side: 0,
  damaged: 0,
  flank: 0,
  other: 0,
  ready: 0,
  top: 0,
  least: 0,
  most: 0,
  amber: 0,
  counters: 0,
  powerMin: 0,
  powerMax: 0,
  weaker: 0,
  stronger: 0,
  target: 0,
  neighborsOfTarget: 0,
  fighting: 0,
  self: 0,
  host: 0,
  leftOf: 0,
  rightOf: 0,
  neighborsOfSource: 0,
  house: 0,
  trait: 0,
  exhausted: 0,
};

const CONDITION_FIELDS: Record<string, string> = {
  amber: "k,opp,op,n",
  moreCreatures: "k",
  fewerCreatures: "k",
  count: "k,of,op,n",
  forged: "k,opp",
  myTurn: "k",
  actor: "k,opp",
  key: "k,color,opp,any",
  not: "k,c",
};
const COUNT_OPS: ReadonlySet<string> = new Set(["eq", "gte", "lte", "even", "odd"]);
const KEYWORD_NAMES: ReadonlySet<string> = new Set(ENGINE_KEYWORDS);
const OVERRIDE_SOURCES: ReadonlySet<string> = new Set(["parser", "llm", "manual"]);
/** `from`/`to` of a stored `move` act, and the `p` of a `{p}` count. */
const ZONES: ReadonlySet<string> = new Set<Zone>(["hand", "deck", "discard", "archives", "purged"]);
const COUNT_SOURCES: ReadonlySet<string> = new Set(["keys", "amber", "plays", "keyColors"]);
const KEY_COLORS: ReadonlySet<string> = new Set(["red", "yellow", "blue"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A stored Filter is a closed record: a key the engine does not know is not
    "ignored", it is a reason to drop the row. */
function validFilter(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).every((key) => Object.hasOwn(FILTER_FIELDS, key));
}

function validSelection(value: unknown): boolean {
  if (typeof value === "string") return SELECTIONS.has(value);
  if (!isRecord(value)) return false;
  if (value.each !== undefined) return Object.keys(value).every((key) => key === "each") && validFilter(value.each);
  if (value.pick !== undefined) {
    return (
      Object.keys(value).every((key) => key === "pick" || key === "n" || key === "upTo") &&
      validFilter(value.pick) &&
      (value.n === undefined || (isFiniteNumber(value.n) && value.n > 0)) &&
      (value.upTo === undefined || typeof value.upTo === "boolean")
    );
  }
  return false;
}

/** A dynamic amount. Closed record per variant: a key the engine does not read
    would change the count silently, so it drops the row. */
function validCount(value: unknown): boolean {
  if (value === "did" || value === "gone" || value === "healed") return true;
  if (!isRecord(value)) return false;
  if (value.slain !== undefined) return Object.keys(value).every((key) => key === "slain") && validFilter(value.slain);
  if (value.gone !== undefined) return Object.keys(value).every((key) => key === "gone") && validFilter(value.gone);
  if (value.c !== undefined) return Object.keys(value).every((key) => key === "c") && validFilter(value.c);
  if (value.sub !== undefined) {
    return (
      Object.keys(value).every((key) => key === "sub") &&
      Array.isArray(value.sub) &&
      value.sub.length === 2 &&
      validCount(value.sub[0]) &&
      (isFiniteNumber(value.sub[1]) || validCount(value.sub[1]))
    );
  }
  if (value.p !== undefined) {
    return (
      Object.keys(value).every((key) => key === "p" || key === "opp" || key === "any" || key === "div") &&
      typeof value.p === "string" &&
      (ZONES.has(value.p) || COUNT_SOURCES.has(value.p)) &&
      (value.opp === undefined || typeof value.opp === "boolean") &&
      (value.any === undefined || (typeof value.any === "boolean" && value.p === "keyColors")) &&
      // "one third of": the floor of the zone size over an integer >= 2 (Lote 8 §8.9).
      (value.div === undefined || (Number.isInteger(value.div) && (value.div as number) >= 2 && value.p !== "keyColors"))
    );
  }
  if (value.housesOf !== undefined) return Object.keys(value).every((key) => key === "housesOf") && value.housesOf === "moved";
  return (
    value.m === "cards" || value.m === "icons" || value.m === "power"
      ? Object.keys(value).every((key) => key === "m" || key === "house" || key === "type") &&
        (value.house === undefined || typeof value.house === "string") &&
        (value.type === undefined || typeof value.type === "string")
      : value.of === "damage" || value.of === "amber" || value.of === "power" || value.of === "counters"
        ? Object.keys(value).every((key) => key === "of" || key === "s" || key === "name") &&
          validSelection(value.s) &&
          (value.name === undefined || (value.of === "counters" && typeof value.name === "string" && value.name.length > 0))
        : false
  );
}

function validCondition(value: unknown): boolean {
  if (!isRecord(value) || typeof value.k !== "string" || !Object.hasOwn(CONDITION_FIELDS, value.k)) return false;
  const fields = CONDITION_FIELDS[value.k];
  if (!Object.keys(value).every((key) => `,${fields},`.includes(`,${key},`))) return false;
  if (value.k === "amber") return typeof value.opp === "boolean" && (value.op === "eq" || value.op === "gte") && isFiniteNumber(value.n);
  if (value.k === "not") return validCondition(value.c);
  if (value.k === "key") {
    return KEY_COLORS.has(value.color as string) && (value.opp === undefined || typeof value.opp === "boolean") && (value.any === undefined || typeof value.any === "boolean");
  }
  if (value.k === "forged" || value.k === "actor") return value.opp === undefined || typeof value.opp === "boolean";
  if (value.k === "count") {
    return validCount(value.of) && COUNT_OPS.has(value.op as string) && isFiniteNumber(value.n);
  }
  return true;
}

/** Does this Count/Condition reach effectivePower (through a `top` filter's
    sort or the `{of:"power"}` sum)? Inside a persistent effect's `if`/`per`
    those two would call allEffects again and recurse forever, so the shape gate
    rejects them (docs/DSL_EXPANSION_PLAN.md §2.4). */
function readsPower(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(
    ([key, inner]) => key === "top" || key === "least" || key === "most" || key === "powerMin" || key === "powerMax" || key === "weaker" || key === "stronger" || (key === "of" && inner === "power") || readsPower(inner),
  );
}

/** Does this key appear anywhere inside `value`? */
function mentionsKey(value: unknown, name: string): boolean {
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, inner]) => key === name || mentionsKey(inner, name));
}

/** An effect that grants a house and filters (or gates itself) by house would
    ask the house of the very cards it is deciding the house of: infinite
    recursion in houseOf, so the gate rejects it like readsPower (Lote 5 §5.3). */
function houseEffectLoops(effect: Record<string, unknown>): boolean {
  return effect.house !== undefined && (mentionsKey(effect.target, "house") || mentionsKey(effect.if, "house") || mentionsKey(effect.per, "house"));
}

/** An effect that grants a trait and filters (or gates itself) by trait would ask the traits of the
    very cards it is deciding the traits of: the same loop as houseEffectLoops (Lote 8 §8.6). */
function traitEffectLoops(effect: Record<string, unknown>): boolean {
  return effect.traits !== undefined && (mentionsKey(effect.target, "trait") || mentionsKey(effect.if, "trait") || mentionsKey(effect.per, "trait"));
}

/** `"chosen"` only makes sense inside a lasting act of an ability with a target; a constant effect never carries it. */
function validReplacement(value: unknown, allowChosen = false): boolean {
  if (!isRecord(value) || (value.on !== "destroy" && value.on !== "damage")) return false;
  // `when` (Lote 11 §D) only narrows a plain damage `prevent`: nothing else has a fight role to speak of.
  if (value.when !== undefined) {
    return (value.when === "attacking" || value.when === "defending") && value.on === "damage" && value.prevent === true && Object.keys(value).every((key) => key === "on" || key === "prevent" || key === "when");
  }
  if (value.redirect === "chosen") return allowChosen && value.on === "damage" && Object.keys(value).every((key) => key === "on" || key === "redirect");
  if (value.to !== undefined && !["archives", "hand", "deck", "purged"].includes(value.to as string)) return false;
  return (value.redirect === undefined || typeof value.redirect === "boolean") && (value.prevent === undefined || typeof value.prevent === "boolean");
}

/** `whenAttacking` only narrows an `attackBonus`. The bonus is read at fight time, outside effectivePower, so a
    defender filter that reads power (`most`, `powerMin`…) cannot recurse (Lote 10 §10.2). */
function validAttackBonus(effect: Record<string, unknown>): boolean {
  if (effect.attackBonus === undefined) return effect.whenAttacking === undefined;
  return isFiniteNumber(effect.attackBonus) && effect.attackBonus !== 0 && (effect.whenAttacking === undefined || validFilter(effect.whenAttacking));
}

/** Lote 11 fields of a persistent effect (also read inside a `lasting` act): all of them are read at event time,
    never inside effectivePower, so none of them can recurse. */
function validLote11(effect: Record<string, unknown>, lasting = false): boolean {
  if (effect.entersPlayReady !== undefined && effect.entersPlayReady !== true) return false;
  // A numbered permit is spent only as a stored lasting copy: a constant one would never run out (unlimited).
  if (typeof effect.mayPlay === "number" && !lasting) return false;
  if (effect.mayPlay !== undefined && effect.mayPlay !== true && !(Number.isInteger(effect.mayPlay) && (effect.mayPlay as number) >= 1)) return false;
  return effect.fightDamageCap === undefined || (Number.isInteger(effect.fightDamageCap) && (effect.fightDamageCap as number) >= 0);
}

function validRestrict(value: unknown): boolean {
  if (!isRecord(value) || (value.who !== "you" && value.who !== "opponent") || !["play", "use", "fight", "reap"].includes(value.action as string)) return false;
  if (value.type !== undefined && typeof value.type !== "string") return false;
  if (value.limit !== undefined && !isFiniteNumber(value.limit)) return false;
  // A toll only exists for using: a play/fight toll has no engine path.
  return value.cost === undefined || (isFiniteNumber(value.cost) && Number.isInteger(value.cost) && value.cost > 0 && value.action === "use");
}

function validAct(value: unknown): boolean {
  if (!isRecord(value) || typeof value.k !== "string" || !Object.hasOwn(ACTS, value.k)) return false;
  const need = ACTS[value.k];
  if (value.optional !== undefined && typeof value.optional !== "boolean") return false;
  if (value.mode !== undefined && value.mode !== "a" && value.mode !== "b") return false;
  if (value.if !== undefined && !validCondition(value.if)) return false;
  if (value.per !== undefined && !validCount(value.per)) return false;
  if (value.n !== undefined && !isFiniteNumber(value.n)) return false;
  if (need.includes("n") && !isFiniteNumber(value.n)) return false;
  if (need.includes("s") && !validSelection(value.s)) return false;
  if (value.opp !== undefined && typeof value.opp !== "boolean") return false;
  if (value.own !== undefined && (typeof value.own !== "boolean" || value.k !== "capture")) return false;
  // `who` resolves a player from the ability's reference card; with `opp` it
  // would have two actors at once (Lote 4 §4.6).
  if (value.who !== undefined) {
    if (value.who !== "owner" && value.who !== "controller") return false;
    if (value.opp === true) return false;
    if (value.k !== "gainAmber" && value.k !== "loseAmber" && value.k !== "draw" && value.k !== "gainChains" && value.k !== "forceHouse") return false;
  }
  if ((value.k === "counter" || value.k === "removeCounter") && value.name !== undefined && (typeof value.name !== "string" || !value.name)) return false;
  if (value.name !== undefined && value.k !== "counter" && value.k !== "removeCounter") return false;
  if (value.k === "lasting") {
    // The stored effect is read by effectivePower the same way a printed one is.
    // A power modifier whose target filters by power recurses (Lote 6 review).
    if (!isRecord(value.e) || !isRecord(value.e.target) || houseEffectLoops(value.e) || traitEffectLoops(value.e)) return false;
    if (value.e.restrict !== undefined && !validRestrict(value.e.restrict)) return false;
    if (value.e.replace !== undefined && !validReplacement(value.e.replace, true)) return false;
    if (value.e.traits !== undefined && (typeof value.e.traits !== "string" || !value.e.traits)) return false;
    if (value.e.mayFight !== undefined && value.e.mayFight !== true) return false;
    if (!validAttackBonus(value.e) || !validLote11(value.e, true)) return false;
    return !(value.e.power !== undefined && readsPower(value.e.target)) && !readsPower(value.e.if) && !readsPower(value.e.per);
  }
  if (value.k === "peek") {
    return (
      (value.from === "hand" || value.from === "deck") &&
      (value.n === undefined || (Number.isInteger(value.n) && (value.n as number) > 0)) &&
      Object.keys(value).every((key) => key === "k" || key === "from" || key === "n" || key === "opp" || key === "optional" || key === "mode" || key === "if")
    );
  }
  if (value.k === "reveal") {
    return (
      (value.from === "hand" || value.from === "deck") &&
      (value.n === undefined || (Number.isInteger(value.n) && (value.n as number) > 0)) &&
      (value.pick === undefined || value.pick === "random" || value.pick === "top") &&
      Object.keys(value).every((key) => key === "k" || key === "from" || key === "n" || key === "opp" || key === "pick" || key === "optional" || key === "mode" || key === "if")
    );
  }
  if (value.divide !== undefined && (value.divide !== true || value.k !== "damage")) return false;
  if (value.asYours !== undefined && (value.asYours !== true || value.k !== "use")) return false;
  if (value.whileSource !== undefined && (value.whileSource !== true || value.k !== "takeControl")) return false;
  // `hosts` belongs on a persistent effect. An act that carries it would be stored and ignored.
  if (value.hosts !== undefined) return false;
  if (value.k === "materialize") {
    const allowed = new Set(["k", "s", "power", "keyword", "optional", "mode", "if", "per"]);
    return (
      Object.keys(value).every((key) => allowed.has(key)) &&
      Number.isInteger(value.power) &&
      (value.power as number) > 0 &&
      (value.keyword === undefined || value.keyword === "versatile")
    );
  }
  if (value.keyword !== undefined) return false;
  if (value.k === "setHouse") return typeof value.house === "string" && value.house.length > 0;
  if (value.k === "forgeKey") {
    if (value.less !== undefined && !validCount(value.less)) return false;
    if (value.min !== undefined && !isFiniteNumber(value.min)) return false;
    if (value.mod !== undefined && !isFiniteNumber(value.mod)) return false;
    if (value.free !== undefined && typeof value.free !== "boolean") return false;
  }
  if (value.k === "use" && value.via !== undefined && value.via !== "fight" && value.via !== "reap") return false;
  if (value.at !== undefined && value.at !== "top" && value.at !== "bottom" && value.at !== "shuffle") return false;
  if (value.k === "forceHouse") {
    return value.house === undefined || value.house === "target" || value.house === "fought" || value.house === "moved";
  }
  if (value.k === "moveAmber" && value.to !== undefined && value.to !== "pool" && value.to !== "supply" && value.to !== "target2") return false;
  if (value.k === "move" && value.until !== undefined) {
    // A loop that stops at a card: only on a deck mill (Lote 7 §7.3).
    if (!isRecord(value.until) || !Object.keys(value.until).every((key) => key === "house" || key === "type")) return false;
    if (value.until.house !== undefined && typeof value.until.house !== "string") return false;
    if (value.until.type !== undefined && typeof value.until.type !== "string") return false;
    if (value.from !== "deck" || value.to !== "discard") return false;
  }
  if (value.until !== undefined && value.k !== "move") return false;
  // `side` picks whose zone a move reads: the opponent's, or either one (the move's chosen option, Lote 8 §8.7).
  if (value.side !== undefined && (value.k !== "move" || (value.side !== "opponent" && value.side !== "any") || value.opp === true)) return false;
  if (value.k === "move") {
    return (
      typeof value.from === "string" &&
      typeof value.to === "string" &&
      ZONES.has(value.from) &&
      ZONES.has(value.to) &&
      (value.pick === undefined || value.pick === "top" || value.pick === "bottom" || value.pick === "random" || value.pick === "all" || value.pick === "moved" || value.pick === "revealed") &&
      (value.type === undefined || typeof value.type === "string") &&
      (value.house === undefined || typeof value.house === "string")
    );
  }
  return true;
}

function validAbility(value: unknown): value is Ability {
  if (!isRecord(value)) return false;
  // `hosts` / `materialize` are effect and act fields. On the ability they would be stored and ignored.
  if (value.hosts !== undefined || value.materialize !== undefined) return false;
  if (!Array.isArray(value.on) || !value.on.length || !value.on.every((trigger) => typeof trigger === "string" && ABILITY_TRIGGERS.has(trigger))) return false;
  if (!Array.isArray(value.acts) || !value.acts.length || !value.acts.every(validAct)) return false;
  if (value.if !== undefined && !validCondition(value.if)) return false;
  if (value.of !== undefined && !validFilter(value.of)) return false;
  if (value.target !== undefined && !validFilter(value.target)) return false;
  if (value.target2 !== undefined && (!validFilter(value.target2) || value.target === undefined)) return false;
  if (value.optional !== undefined && typeof value.optional !== "boolean") return false;
  // Direct loops the budgets would only truncate (Lote 6 §6.2).
  const ons = value.on as string[];
  const kinds = new Set((value.acts as { k?: string }[]).map((act) => act.k));
  if ((ons.includes("ready") || ons.includes("enter")) && !validFilter(value.of)) return false;
  if (ons.includes("ready") && (kinds.has("ready") || kinds.has("use"))) return false;
  if (ons.includes("forge") && kinds.has("forgeKey")) return false;
  if (ons.includes("enter") && kinds.has("makeToken")) return false;
  // The discard watcher feeds on discards: a hand discard in its own acts is a direct loop (the budgets are the second line).
  if (ons.includes("discard") && (!validFilter(value.of) || value.of === undefined || kinds.has("discardRandom"))) return false;
  if (ons.includes("discard") && (value.acts as { k?: string; from?: string; to?: string }[]).some((act) => act.k === "move" && act.from === "hand" && act.to === "discard")) return false;
  // A chosen-creature redirect reads the ability's target, and only Before Fight has a live fought creature: the redirect is zeroed once the fight ends, so on "fight" it would be inert (Lote 8 §8.1).
  if (JSON.stringify(value.acts).includes('"redirect":"chosen"') && (value.target === undefined || !ons.includes("beforeFight"))) return false;
  // "Choose one:" (Lote 8 §8.4) is a pair: a lone option would be a choice with nothing to choose.
  if (new Set((value.acts as { mode?: string }[]).map((act) => act.mode).filter(Boolean)).size === 1) return false;
  // `target2` / `s:"target2"` need the second target to exist.
  if (value.target2 === undefined && JSON.stringify(value.acts).includes('"target2"')) return false;
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
        validFilter(effect.target) &&
        (effect.power === undefined || isFiniteNumber(effect.power)) &&
        (effect.armor === undefined || isFiniteNumber(effect.armor)) &&
        (effect.keywords === undefined || validKeywords(effect.keywords)) &&
        (effect.abilities === undefined || (Array.isArray(effect.abilities) && effect.abilities.every(validAbility))) &&
        (effect.if === undefined || validCondition(effect.if)) &&
        (effect.per === undefined || validCount(effect.per)) &&
        (effect.keyCost === undefined || isFiniteNumber(effect.keyCost)) &&
        (effect.opp === undefined || typeof effect.opp === "boolean") &&
        (effect.hand === undefined || isFiniteNumber(effect.hand)) &&
        !(effect.power !== undefined && readsPower(effect.target)) &&
        (effect.noReady === undefined || effect.noReady === true || effect.noReady === "step") &&
        (effect.house === undefined || (typeof effect.house === "string" && effect.house.length > 0)) &&
        (effect.noSteal === undefined || typeof effect.noSteal === "boolean") &&
        (effect.replace === undefined || validReplacement(effect.replace)) &&
        (effect.restrict === undefined || validRestrict(effect.restrict)) &&
        (effect.traits === undefined || (typeof effect.traits === "string" && effect.traits.length > 0)) &&
        (effect.mayFight === undefined || effect.mayFight === true) &&
        validAttackBonus(effect) &&
        validLote11(effect) &&
        (effect.hosts === undefined || effect.hosts === "Artifact") &&
        !houseEffectLoops(effect) &&
        !traitEffectLoops(effect) &&
        !readsPower(effect.if) &&
        !readsPower(effect.per),
    )
  );
}

/** Shape gate for rows coming off the `abilities` store. A malformed row is
    discarded with a console warning by the loader; the row is rebuilt from the
    known fields only, so junk properties never ride into the rules. Required:
    `cardId`, a DSL of structurally valid abilities, `textHash` and a source in
    the whitelist. `reviewed` defaults to false (an llm row without it is simply
    untrusted) and a missing `generatedAt` becomes 0. A `v` above DSL_VERSION
    means the row was written by a grammar this engine does not fully know, and
    it is discarded like a malformed one. */
export function normaliseAbilityOverride(value: unknown): AbilityOverride | null {
  if (!isRecord(value)) return null;
  const { cardId, dsl, textHash: hash, source, model } = value;
  if (typeof cardId !== "string" || !cardId) return null;
  if (!Array.isArray(dsl) || !dsl.every(validAbility)) return null;
  if (typeof hash !== "string" || !hash) return null;
  if (typeof source !== "string" || !OVERRIDE_SOURCES.has(source)) return null;
  if (value.effects !== undefined && !validEffects(value.effects)) return null;
  if (value.keywords !== undefined && !validKeywords(value.keywords)) return null;
  if (value.v !== undefined && (!isFiniteNumber(value.v) || value.v > DSL_VERSION)) return null;

  const record: AbilityOverride = {
    cardId,
    dsl,
    textHash: hash,
    source: source as AbilityOverride["source"],
    reviewed: value.reviewed === true,
    generatedAt: isFiniteNumber(value.generatedAt) ? value.generatedAt : 0,
  };
  if (isFiniteNumber(value.v)) record.v = value.v;
  if (typeof model === "string") record.model = model;
  if (isFiniteNumber(value.parserVersion)) record.parserVersion = value.parserVersion;
  if (typeof value.failure === "string") record.failure = value.failure;
  if (value.partial === true) record.partial = true;
  if (isFiniteNumber(value.tries)) record.tries = value.tries;
  if (value.effects !== undefined) record.effects = value.effects;
  if (value.keywords !== undefined) record.keywords = value.keywords;
  return record;
}
