// SPDX-License-Identifier: AGPL-3.0-only
// Rules engine of Aember Arena. Turn structure, fight/damage/armor, keywords,
// draw-with-chains and key cost ported from keyteki (https://github.com/keyteki/keyteki):
// server/game/GameActions/ResolveFightAction.js, DealDamageAction.js, DrawAction.js,
// server/game/player.js (getCurrentKeyCost, maxHandSize), gamesteps/ReadyPhase.js,
// gamesteps/key/KeyPhase.js, gamesteps/setup/setupphase.js and Card.js (taunt).
// Copyright (C) keyteki contributors. Rewritten in TypeScript for Aember Arena.
//
// Pure API: every exported function clones its input and returns a new state;
// the helpers below mutate only that private clone.
import { rulesOf, type Ability, type Act, type Condition, type Count, type Filter, type PersistentEffect, type Replacement, type Restrict, type Selection, type Trigger } from "./abilities";
import type { Keyword } from "./keywords";

export type CardType = "Creature" | "Action" | "Artifact" | "Upgrade" | string;

export interface CardFace {
  id: string;
  title: string;
  house: string;
  type: CardType;
  image: string;
  text: string;
  amber: number;
  power: number;
  armor: number;
  traits?: string;
  rarity?: string;
  isMaverick?: boolean;
  cardNumber?: string | number;
  /** Master Vault / keyteki keyword array ("elusive", "assault:2"), when present. */
  keywords?: string[];
  /** Enhanced bonus icons (keyteki card.bonusIcons, ResolveBonusIconsAction):
      `amber` is the total amber printed on the icons (it replaces `amber` when
      the payload carried enhancements), the rest are the extra icons resolved
      on play. Absent when the payload had no enhancements. */
  bonusIcons?: BonusIcons;
}

export interface BonusIcons {
  amber: number;
  capture?: number;
  damage?: number;
  draw?: number;
}

export interface DeckInfo {
  id: string;
  name: string;
  houses: string[];
  cards: CardFace[];
  expansion?: number;
  powerLevel?: number;
  chains?: number;
  wins?: number;
  losses?: number;
}

export interface CardInstance {
  instanceId: string;
  face: CardFace;
  damage: number;
  ready: boolean;
  stunned: boolean;
  /** Captured amber sitting on the creature. */
  amber?: number;
  armorUsed?: number;
  elusiveUsed?: boolean;
  poisoned?: boolean;
  /** Upgrades: instanceId of the creature they are attached to. */
  attachedTo?: string;
  /** Gigantic halves: the other half is played "under" this one (BUG-23). */
  under?: CardInstance[];
  /** A token creature: engine-made, never a deck card (Onda 3). Plain boolean so
      the state stays JSON-safe. */
  isToken?: boolean;
  /** Ward tokens (Onda 4, keyteki Card.warded): the first destruction or damage
      instance consumes one and is prevented instead. Tokens do not stack
      (keyteki Card.ward() no-ops when already warded), so this is 0 or 1. */
  warded?: number;
  /** Enrage tokens (keyteki Card.enraged): while enraged, using the creature
      forces a fight when one is legal; the token is removed when it fights. */
  enraged?: number;
  /** The side an effect gave control to (keyteki game.takeControl): the card
      sits in that side's battleline and its owner — the other side, the pile it
      returns to when it leaves play — is derived from it. */
  controlledBy?: Side;
  /** +1 power counters (Onda 5): each counter adds 1 power and they are reset
      when the card leaves play (keyteki Card.powerCounters). */
  counters?: number;
  /** Named counters (Lote 6 §6.6). They do not change power; leavePlay clears them. */
  marks?: Record<string, number>;
  /** Entrench (Lote 4 §4.2): the controller's choice to leave this exhausted
      creature exhausted during its "ready cards" step. A controller
      preference, not a move — it never counts in `acted`/Alpha and is reset
      when the card leaves play. */
  hold?: boolean;
  /** House an effect gave this card ("belongs to house X", Lote 5 §5.3): wins
      over the printed one while the card is in play, zeroed on leaving. */
  houseAs?: string;
}

/** Key colors (Lote 7 §7.2): a KeyForge player forges one key of each color. */
export type KeyColor = "red" | "yellow" | "blue";

export interface GamePlayer {
  name: string;
  deckName: string;
  houses: string[];
  deck: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
  board: CardInstance[];
  archives: CardInstance[];
  /** Purged cards: out of the game, never reshuffled back (keyteki 'purged'). */
  purged: CardInstance[];
  amber: number;
  keys: number;
  /** Colors of the forged keys, in forging order (Lote 7 §7.2). Absent on older saves:
      forgedKeyColors derives them from `keys` and the order. */
  keyColors?: KeyColor[];
  /** The order this side forges its colors in (a preference, set outside GameMove like `hold`). */
  keyOrder?: KeyColor[];
  chains: number;
  /** Key cost modifier active during this player's current/next turn (e.g. Lash of Broken Dreams). */
  keyCostMod: number;
  /** FEAT-10: this side already used its one mulligan. */
  mulliganed?: boolean;
  /** turnStamp of the turn this side last forged a key ("forged on your previous
      turn", Lote 5 §5.4). Absent on saves from before the lote. */
  forgedAt?: number;
  /** The forge stamp before `forgedAt` (a second forge in a later turn). */
  forgedBeforeAt?: number;
  /** An effect obliges this side's next active house choice ("must choose that
      house", Lote 5 §5.1); chooseHouse respects it and clears it. */
  mustChoose?: string;
  /** FEAT-06: per-side match tallies for the post-match panel. Plain numbers, so
      the state stays JSON-safe (matches saved before the feature read as 0). */
  amberGained: number;
  amberStolen: number;
  amberCaptured: number;
  creaturesDestroyed: number;
  cardsPlayed: number;
}

export interface LogEntry {
  key: string;
  params: Record<string, string>;
  /** FEAT-05: the round (state.turn) the entry belongs to. */
  turn: number;
}

export interface GameState {
  players: [GamePlayer, GamePlayer];
  activePlayer: 0 | 1;
  activeHouse: string | null;
  turn: number;
  winner: 0 | 1 | null;
  log: LogEntry[];
  /** Cards played, used or discarded by the active player this turn (Alpha). */
  acted: number;
  /** Cards played or discarded this turn (first-turn rule). */
  played: number;
  /** Cards played this turn — discards do not count (play-limit effects). */
  plays: number;
  /** An Omega card ended the main step. */
  omega: boolean;
  /** FEAT-08: PRNG seed and how many draws the match has consumed so far.
      Both numbers are JSON-safe — the state carries no function. */
  seed: number;
  rngCalls: number;
  /** FEAT-10: which side still has to decide its mulligan before turn 1
      (null once both did). */
  pendingMulligan: 0 | 1 | null;
  /** Triggered effects with a duration ("… on their next turn"): plain data
      copies of the parsed effect plus its owner and expiry stamp. */
  lasting?: PersistentEffect[];
  /** Onda 3: how many token creatures this match has made — the counter keeps
      their instance ids unique and deterministic (plain number, JSON-safe). */
  tokenSerial?: number;
}

/** `target` optionally names the card chosen for the triggered ability (or the
    creature an upgrade attaches to); without it the engine picks like keyteki's
    auto-target would for the controller. `slot` places a Deploy creature.
    `decline` resolves the move but skips its "You may" clauses (wave 2). `house`
    is the answer to a "Choose a house" the card's text asks (Lote 5 §5.1): only
    cards whose DSL cites `"chosen"` get one variant per house in play. */
export type GameMove = (
  | { type: "play"; instanceId: string; target?: string; slot?: number; decline?: boolean; house?: string }
  | { type: "reap"; instanceId: string; target?: string; decline?: boolean; house?: string }
  | { type: "fight"; attackerId: string; targetId: string; target?: string; decline?: boolean; house?: string }
  | { type: "use"; instanceId: string; target?: string; via?: "reap" | "action"; decline?: boolean; house?: string }
  | { type: "unstun"; instanceId: string }
  | { type: "discard"; instanceId: string; target?: string; decline?: boolean; house?: string }
  /** Picking the archives up is optional ("may"), so it is a move of its own. */
  | { type: "takeArchives" }
) & {
  /** Lote 7 §7.1: the answers after `target`, in order — the second target (`target2`)
      first, then the cards of an "up to N" selection. Absent/empty = the engine decides. */
  targets?: string[];
  /** Where a `toFlank` act sends its creature (default left). */
  flank?: "left" | "right";
  /** Lote 8 §8.4/§8.7: the option of a "Choose one:" ("a" first, "b" second) — for a move with `side:"any"`,
      "a" is the player's own zone and "b" the opponent's. Absent = the engine's default (see defaultMode). */
  mode?: "a" | "b";
};

const declines = (move: GameMove) => "decline" in move && move.decline === true;

export const BASE_KEY_COST = 6;
const HAND_SIZE = 6;
/** FEAT-05: the whole match is kept — the full-log panel groups it by round. */
const LOG_SIZE = 400;

type Side = 0 | 1;
const other = (side: Side): Side => (side === 0 ? 1 : 0);

/** mulberry32: deterministic draw number `n` (1-based) of the stream `seed`.
    The single random primitive of the engine — `seed` + `rngCalls` are the
    whole PRNG state, so it survives JSON serialization (FEAT-08). */
export function seededValue(seed: number, n: number): number {
  let a = (seed + n * 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** What the PRNG needs: a seed and the number of draws already made. */
type Rng = Pick<GameState, "seed" | "rngCalls">;

/** Next deterministic draw, advancing the state's counter (callers hold a clone). */
function roll(rng: Rng): number {
  rng.rngCalls += 1;
  return seededValue(rng.seed, rng.rngCalls);
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(roll(rng) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function makePlayer(name: string, deck: DeckInfo, owner: string, rng: Rng): GamePlayer {
  return {
    name,
    deckName: deck.name,
    houses: deck.houses.length ? [...deck.houses] : [...new Set(deck.cards.map((card) => card.house))],
    deck: shuffle(
      deck.cards.map((face, index) => ({
        instanceId: `${owner}-${index}-${roll(rng).toString(36).slice(2, 8)}`,
        face,
        damage: 0,
        ready: false,
        stunned: false,
      })),
      rng,
    ),
    hand: [],
    discard: [],
    board: [],
    archives: [],
    purged: [],
    amber: 0,
    keys: 0,
    chains: 0,
    keyCostMod: 0,
    amberGained: 0,
    amberStolen: 0,
    amberCaptured: 0,
    creaturesDestroyed: 0,
    cardsPlayed: 0,
  };
}

/** Draws from the top of the deck (the array's end), reshuffling the discard pile when the deck runs out. */
function draw(player: GamePlayer, count: number, rng: Rng): void {
  for (let drawn = 0; drawn < count; drawn += 1) {
    if (!player.deck.length && player.discard.length) {
      player.deck = shuffle(player.discard, rng);
      player.discard = [];
    }
    const card = player.deck.pop();
    if (!card) break;
    player.hand.push(card);
  }
}

/** Draw step (keyteki DrawAction refill): up to 6, minus 1 card per 6 chains
    (rounded up), shedding one chain whenever the hand was below its size. */
function refill(state: GameState, side: Side): void {
  const player = state.players[side];
  let size = HAND_SIZE;
  for (const owner of allEffects(state)) {
    const delta = owner.effect.hand;
    if (delta === undefined) continue;
    if ((owner.effect.opp ? other(owner.side) : owner.side) !== side) continue;
    if (owner.effect.if && !holds(owner.effect.if, state, owner.side, owner.source)) continue;
    size += delta;
  }
  size = Math.max(0, size);
  // A hand already at size has no refill: chains are spent only when the step
  // had room to draw fewer cards because of them (keyteki DrawAction).
  if (player.hand.length >= size) return;
  const want = size - player.hand.length - Math.floor((player.chains + 5) / 6);
  if (want > 0) draw(player, want, state);
  if (player.chains > 0) player.chains -= 1;
}

export function createMatch(playerDeck: DeckInfo, rivalDeck: DeckInfo, options: { seed?: number } = {}): GameState {
  // FEAT-08: a numeric seed drives every shuffle, instance id and random
  // discard, so the same seed and the same moves replay the exact match.
  const rng: Rng = { seed: (options.seed ?? Math.floor(Math.random() * 4294967296)) >>> 0, rngCalls: 0 };
  const rival = makePlayer("The Ember Warden", rivalDeck, "warden", rng);
  if (playerDeck.id === rivalDeck.id) rival.deckName = "Warden's mirror deck";
  const players: [GamePlayer, GamePlayer] = [makePlayer("You", playerDeck, "you", rng), rival];
  // First player opens with 7 (keyteki setupphase: +1 hand size on the first refill).
  draw(players[0], HAND_SIZE + 1, rng);
  draw(players[1], HAND_SIZE, rng);

  return {
    players,
    activePlayer: 0,
    activeHouse: null,
    turn: 1,
    winner: null,
    log: [{ key: "log.matchStart", params: { deck: playerDeck.name, rival: players[1].deckName }, turn: 1 }],
    acted: 0,
    played: 0,
    plays: 0,
    omega: false,
    seed: rng.seed,
    rngCalls: rng.rngCalls,
    pendingMulligan: 0,
    lasting: [],
  };
}

// ---------- pass-and-play (FEAT-13) ----------

/** A two-human match: the same engine state as createMatch, with the solo
    names ("You"/"The Ember Warden") replaced by neutral side names so the log
    and the player bands localize them (App's localizeName). Pure — the created
    state is rebuilt, never mutated. */
export function createPassAndPlayMatch(deckA: DeckInfo, deckB: DeckInfo, options: { seed?: number } = {}): GameState {
  const state = createMatch(deckA, deckB, options);
  return {
    ...state,
    players: [
      { ...state.players[0], name: "Player 1" },
      { ...state.players[1], name: "Player 2" },
    ],
  };
}

// ---------- mulligan (FEAT-10) ----------

/** True while either side still has to keep or mulligan its opening hand. */
const mulliganPending = (state: GameState) => state.pendingMulligan === 0 || state.pendingMulligan === 1;

/** Advances the micro-phase: the first player decides, then the second. */
function advanceMulligan(state: GameState, side: Side): void {
  state.pendingMulligan = side === 0 ? 1 : null;
}

/** Keeps the opening hand (the match starts once both sides decided). */
export function keepHand(current: GameState, side: Side): GameState {
  const state = cloneGame(current);
  if (state.pendingMulligan !== side) return state;
  advanceMulligan(state, side);
  return state;
}

/** One mulligan per side: the hand goes back into the shuffled deck and the
    side draws one card fewer (first player 7->6, second 6->5). */
export function mulligan(current: GameState, side: Side): GameState {
  const state = cloneGame(current);
  const player = state.players[side];
  if (state.pendingMulligan !== side || player.mulliganed) return state;
  player.mulliganed = true;
  player.deck = shuffle([...player.deck, ...player.hand], state);
  player.hand = [];
  draw(player, (side === 0 ? HAND_SIZE + 1 : HAND_SIZE) - 1, state);
  record(state, "log.mulligan", { name: player.name });
  advanceMulligan(state, side);
  return state;
}

/** Entrench preference (Lote 4 §4.2): toggles `hold` on a card of `side`'s
    board. Pure and OUTSIDE the GameMove model on purpose — it is not an action
    (no `acted`/Alpha cost) and the AI search never branches on it, it only
    changes what the next ready step does. */
export function setHold(current: GameState, side: Side, instanceId: string, hold: boolean): GameState {
  const state = cloneGame(current);
  const card = findOnBoard(state, side, instanceId);
  if (!card) return state;
  if (hold) card.hold = true;
  else delete card.hold;
  return state;
}

export function cloneGame(state: GameState): GameState {
  const copyPlayer = (player: GamePlayer): GamePlayer => ({
    ...player,
    houses: [...player.houses],
    deck: player.deck.map((card) => ({ ...card })),
    hand: player.hand.map((card) => ({ ...card })),
    discard: player.discard.map((card) => ({ ...card })),
    board: player.board.map((card) => ({ ...card, under: card.under?.map((half) => ({ ...half })) })),
    archives: (player.archives ?? []).map((card) => ({ ...card })),
    purged: (player.purged ?? []).map((card) => ({ ...card })),
    ...(player.keyColors ? { keyColors: [...player.keyColors] } : {}),
    ...(player.keyOrder ? { keyOrder: [...player.keyOrder] } : {}),
  });

  return {
    ...state,
    players: [copyPlayer(state.players[0]), copyPlayer(state.players[1])],
    log: [...state.log],
    lasting: state.lasting ? state.lasting.map((effect) => structuredClone(effect)) : [],
  };
}

function record(state: GameState, key: string, params: Record<string, string>, silent = false): void {
  if (!silent) state.log = [...state.log, { key, params, turn: state.turn }].slice(-LOG_SIZE);
}

/** FEAT-06: bumps one per-side match tally (numbers only, clones stay pure). */
const tally = (player: GamePlayer, key: "amberGained" | "amberStolen" | "amberCaptured" | "creaturesDestroyed" | "cardsPlayed", amount = 1): void => {
  player[key] += amount;
};

// ---------- board queries ----------

const isCreature = (card: CardInstance) => card.face.type === "Creature";
const battleline = (player: GamePlayer) => player.board.filter(isCreature);

/** Amber printed on a face: the bonus-icon total when the payload carried
    enhancements (amber icons are bonus icons too), the plain `amber` otherwise
    (keyteki Card.bonusIcons, Onda 4). */
const printedAmber = (face: CardFace) => face.bonusIcons?.amber ?? face.amber;

function controllerOf(state: GameState, card: CardInstance): Side | undefined {
  if (state.players[0].board.includes(card)) return 0;
  return state.players[1].board.includes(card) ? 1 : undefined;
}

/** The side a card belongs to (keyteki card.owner): the side that took control
    of it is the controller, so the owner is the other side (keyteki
    player.moveCard sends a card leaving play to its owner's pile). */
function ownerOf(state: GameState, card: CardInstance): Side | undefined {
  const holder = controllerOf(state, card);
  if (holder === undefined) return undefined;
  return card.controlledBy === undefined ? holder : other(card.controlledBy);
}

function findOnBoard(state: GameState, side: Side, instanceId: string | undefined): CardInstance | undefined {
  return state.players[side].board.find((card) => card.instanceId === instanceId);
}

export function neighbors(state: GameState, card: CardInstance): CardInstance[] {
  const side = controllerOf(state, card);
  if (side === undefined || !isCreature(card)) return [];
  const line = battleline(state.players[side]);
  const index = line.indexOf(card);
  return [line[index - 1], line[index + 1]].filter((item): item is CardInstance => Boolean(item));
}

function onFlank(state: GameState, card: CardInstance): boolean {
  return neighbors(state, card).length < 2;
}

// ---------- persistent effects (derived from the board) ----------

/** Monotonic stamp of the turn in progress (round × 2 + the side taking it).
    Lasting effects store the stamp at which they stop applying. */
export function turnStamp(state: GameState): number {
  return state.turn * 2 + state.activePlayer;
}

/** An effect owned by `side`: the constant text of one of its cards in play, or
    a lasting effect recorded by a move (whose source may already be gone). */
export interface ActiveEffect {
  side: Side;
  source?: CardInstance;
  effect: PersistentEffect;
}

/** Every persistent effect `side`'s cards project right now. Derived from the
    board on each query — the engine clones the state on every move, so a stored
    mutable effect list would fight the purity of the model (keyteki rebuilds
    its effect engine the same way). */
export function activeEffects(state: GameState, side: Side): ActiveEffect[] {
  const result: ActiveEffect[] = [];
  for (const card of state.players[side].board) {
    for (const effect of rulesOf(card.face).effects) result.push({ side, source: card, effect });
  }
  const stamp = turnStamp(state);
  for (const effect of state.lasting ?? []) {
    if (effect.side === side && (effect.until ?? 0) > stamp) result.push({ side, effect });
  }
  return result;
}

const allEffects = (state: GameState): ActiveEffect[] => [...activeEffects(state, 0), ...activeEffects(state, 1)];

/** The scope of a persistent effect's own `if`/`per`/`of` reads: its source's
    side asks the question (keyteki evaluates from the effect's controller). */
const effectScope = (state: GameState, owner: ActiveEffect): Ctx => ({ state, me: owner.side, source: owner.source, deterministic: true });

/** Does this effect apply to `card` right now? (target filter + clauses) */
function effectHits(state: GameState, owner: ActiveEffect, card: CardInstance): boolean {
  return (
    (!owner.effect.if || holds(owner.effect.if, state, owner.side, owner.source)) &&
    matches(state, owner.side, owner.source, card, owner.effect.target) &&
    (owner.effect.when !== "flank" || onFlank(state, card))
  );
}

/** A stat modifier multiplied by its dynamic count ("+1 power for each …"). */
const effectPer = (state: GameState, owner: ActiveEffect, value: number) =>
  owner.effect.per ? value * countOf(effectScope(state, owner), owner.effect.per) : value;

/** First active "instead" replacement of `on` that applies to `card` (Onda 4),
    if any. Self-replacements are read off the card's own text; a board effect
    can replace for other cards too (Annihilation Ritual). */
function replacementFor(state: GameState, card: CardInstance, on: Replacement["on"]): ActiveEffect | undefined {
  return allEffects(state).find((owner) => owner.effect.replace?.on === on && effectHits(state, owner, card));
}

/** "Cannot be dealt damage" (Lote 5 §5.6): a live `prevent` replacement cancels
    the damage instance before redirect, ward and armor. */
const damagePrevented = (state: GameState, card: CardInstance): boolean =>
  allEffects(state).some((owner) => owner.effect.replace?.on === "damage" && owner.effect.replace.prevent === true && effectHits(state, owner, card));

/** "Your amber cannot be stolen": does `victim` project a live noSteal? */
const stealBlocked = (state: GameState, victim: Side): boolean =>
  activeEffects(state, victim).some((owner) => owner.effect.noSteal === true && (!owner.effect.if || holds(owner.effect.if, state, victim, owner.source)));

/** The house a card counts as right now (Lote 5 §5.3): an effect-given
    `houseAs`, then a live `house` effect, then the printed one. "all" belongs to
    every house. The gate forbids house effects that filter by house, and the
    depth guard keeps a hand-written one from recursing forever. */
let houseDepth = 0;
export function houseOf(state: GameState, card: CardInstance): string {
  if (card.houseAs) return card.houseAs;
  if (houseDepth > 0) return card.face.house;
  houseDepth += 1;
  try {
    for (const side of [0, 1] as const) {
      for (const source of state.players[side].board) {
        for (const effect of rulesOf(source.face).effects) {
          if (effect.house && effectHits(state, { side, source, effect }, card)) return effect.house;
        }
      }
    }
    const stamp = turnStamp(state);
    for (const effect of state.lasting ?? []) {
      if (effect.house && effect.side !== undefined && (effect.until ?? 0) > stamp && effectHits(state, { side: effect.side, effect }, card)) return effect.house;
    }
  } finally {
    houseDepth -= 1;
  }
  return card.face.house;
}

/** Live damage redirect for `card` (Shadow Self): the effect's source takes the
    damage instead. A source that already left play does not redirect. */
function redirectFor(state: GameState, card: CardInstance): CardInstance | undefined {
  const owner = allEffects(state).find(
    (item) => item.effect.replace?.redirect === true && item.source !== undefined && effectHits(state, item, card),
  );
  const source = owner?.source;
  if (!source || source === card || controllerOf(state, source) === undefined) return undefined;
  return source;
}

/** Power including every active modifier (keyteki card.power through effects). */
export function effectivePower(state: GameState, card: CardInstance): number {
  let power = card.face.power + (card.counters ?? 0);
  for (const owner of allEffects(state)) if (owner.effect.power && effectHits(state, owner, card)) power += effectPer(state, owner, owner.effect.power);
  return Math.max(0, power);
}

/** Armor including every active modifier; as in keyteki it never drops below 0. */
export function effectiveArmor(state: GameState, card: CardInstance): number {
  let armor = card.face.armor;
  for (const owner of allEffects(state)) if (owner.effect.armor && effectHits(state, owner, card)) armor += effectPer(state, owner, owner.effect.armor);
  return Math.max(0, armor);
}

/** May this card become ready? (Lote 4 §4.2) A `noReady` effect blocks always
    when `true` and only during the printed ready step when "step"; an
    exhausted entrenched creature the controller held blocks the ready step
    alone — an effect that readies it still works. */
export function canReady(state: GameState, card: CardInstance, step: boolean): boolean {
  for (const owner of allEffects(state)) {
    const noReady = owner.effect.noReady;
    if (noReady && effectHits(state, owner, card) && (noReady === true || step)) return false;
  }
  return !(step && card.hold === true && keyword(state, card, "entrench") > 0);
}

/** Keyword value including the granted ones ("Each friendly creature gains Taunt"). */
export function keyword(state: GameState, card: CardInstance, name: Keyword): number {
  let value = rulesOf(card.face).keywords[name] ?? 0;
  for (const owner of allEffects(state)) {
    const granted = owner.effect.keywords?.[name];
    if (granted && effectHits(state, owner, card)) value += granted;
  }
  return value;
}

/** Abilities of a card right now: printed plus granted ("gains 'Reap: …'"). */
export function abilitiesOf(state: GameState, card: CardInstance): Ability[] {
  const printed = rulesOf(card.face).abilities;
  const granted: Ability[] = [];
  for (const owner of allEffects(state)) {
    if (owner.effect.abilities?.length && effectHits(state, owner, card)) granted.push(...owner.effect.abilities);
  }
  return granted.length ? [...printed, ...granted] : printed;
}

/** Does a "You cannot play/use/fight …" effect forbid `action` for `side`? */
function restricted(state: GameState, side: Side, action: Restrict["action"], card?: CardInstance): boolean {
  for (const owner of allEffects(state)) {
    const restrict = owner.effect.restrict;
    if (!restrict || restrict.action !== action) continue;
    if ((restrict.who === "opponent" ? other(owner.side) : owner.side) !== side) continue;
    // "cannot play more than N cards each turn" is a budget, not a ban: it is
    // enforced by playLimit, not here (keyteki Ember Imp).
    if (restrict.limit || restrict.cost) continue;
    if (restrict.type && (!card || card.face.type !== restrict.type)) continue;
    return true;
  }
  return false;
}

/** "Your opponent must pay you N in order to use an artifact" (Lote 8 §8.2): the amber `side` owes
    for using `card`, and who it is paid to. A toll is not a ban — canUseCard only asks that it can be paid. */
function useTolls(state: GameState, side: Side, card: CardInstance): { payee: Side; cost: number }[] {
  const tolls: { payee: Side; cost: number }[] = [];
  for (const owner of allEffects(state)) {
    const restrict = owner.effect.restrict;
    if (!restrict?.cost || restrict.action !== "use") continue;
    if ((restrict.who === "opponent" ? other(owner.side) : owner.side) !== side) continue;
    if (restrict.type && card.face.type !== restrict.type) continue;
    if (owner.effect.if && !holds(owner.effect.if, state, owner.side, owner.source)) continue;
    tolls.push({ payee: owner.side, cost: restrict.cost });
  }
  return tolls;
}

/** Tightest "cannot play more than N cards each turn" in force for `side`. */
function playLimit(state: GameState, side: Side): number {
  let limit = Infinity;
  for (const owner of allEffects(state)) {
    const restrict = owner.effect.restrict;
    if (!restrict?.limit || restrict.action !== "play") continue;
    if ((restrict.who === "opponent" ? other(owner.side) : owner.side) !== side) continue;
    limit = Math.min(limit, restrict.limit);
  }
  return limit;
}

/** Key cost for `side` right now: 6 + active modifiers (keyteki
    player.getCurrentKeyCost) + every active keyCost effect (`opp` means the
    effect charges the source's opponent). */
export function keyCost(state: GameState, side: Side): number {
  let cost = BASE_KEY_COST + (state.players[side].keyCostMod ?? 0);
  for (const owner of allEffects(state)) {
    const effect = owner.effect;
    if (!effect.keyCost) continue;
    if ((effect.opp ? other(owner.side) : owner.side) !== side) continue;
    if (effect.if && !holds(effect.if, state, owner.side, owner.source)) continue;
    cost += effectPer(state, owner, effect.keyCost);
  }
  return cost;
}

/** Key step core shared by endTurn and the "forge a key" acts (keyteki
    player.forgeKey): pays the (modified) cost from the pool and forges one key.
    Returns false when the side cannot forge (three keys already forged, or not
    enough amber). */
interface ForgeOptions {
  free?: boolean;
  /** "+N cost". */
  mod?: number;
  /** "reduced by …": the amount already counted (Lote 5 §5.4). */
  less?: number;
  /** Floor of the reduced cost. */
  min?: number;
  /** Forwarded to the `forge` player-event (Lote 6 §6.2). */
  deterministic?: boolean;
}

const KEY_ORDER_DEFAULT: KeyColor[] = ["red", "yellow", "blue"];

/** AI/default order: the colors the deck's own cards cite most come first, so a
    "your red key" payoff is not left to the dice; ties keep red, yellow, blue. */
function defaultKeyOrder(player: GamePlayer): KeyColor[] {
  const texts = [player.deck, player.hand, player.discard, player.board, player.archives, player.purged].flatMap((zone) => zone.map((card) => card.face.text ?? ""));
  const cites = (color: KeyColor) => texts.filter((text) => new RegExp("\\b" + color + " key", "i").test(text)).length;
  return [...KEY_ORDER_DEFAULT].sort((a, b) => cites(b) - cites(a) || KEY_ORDER_DEFAULT.indexOf(a) - KEY_ORDER_DEFAULT.indexOf(b));
}

/** Colors of the keys `side` has forged. A save (or a fixture that set `keys` by
    hand) without them is completed in the side's order, so the answer always has
    `keys` entries. */
export function forgedKeyColors(state: GameState, side: Side): KeyColor[] {
  const player = state.players[side];
  const known = (player.keyColors ?? []).slice(0, player.keys);
  if (known.length >= player.keys) return known;
  const order = player.keyOrder ?? defaultKeyOrder(player);
  return [...known, ...order.filter((color) => !known.includes(color))].slice(0, Math.min(player.keys, 3));
}

/** The player's color preference for the keys still to forge (pure, outside GameMove
    like setHold). Anything but a permutation of the three colors is ignored. */
export function setKeyOrder(current: GameState, side: Side, order: KeyColor[]): GameState {
  const state = cloneGame(current);
  if (order.length === 3 && new Set(order).size === 3 && order.every((color) => KEY_ORDER_DEFAULT.includes(color))) state.players[side].keyOrder = [...order];
  return state;
}

function forge(state: GameState, side: Side, options: ForgeOptions = {}): boolean {
  const player = state.players[side];
  if (player.keys >= 3) return false;
  const cost = options.free ? 0 : Math.max(0, options.min ?? 0, keyCost(state, side) + (options.mod ?? 0) - (options.less ?? 0));
  if (player.amber < cost) return false;
  player.amber -= cost;
  player.keys += 1;
  // The new key takes the first color of the side's order not forged yet.
  player.keyColors = forgedKeyColors(state, side);
  // Keep the earlier forge stamp: forging again this turn must not erase "forged last turn".
  if (player.forgedAt !== undefined && player.forgedAt !== turnStamp(state)) player.forgedBeforeAt = player.forgedAt;
  player.forgedAt = turnStamp(state);
  record(state, "log.forge", { name: player.name });
  // Player event, same shape as `house` (Lote 6 §6.2): every card in play, actor = who forged.
  wakePlayer(state, side, "forge", options.deterministic ?? false);
  if (player.keys >= 3) {
    state.winner = side;
    record(state, "log.wins", { name: player.name });
  }
  return true;
}

/** Pure wrapper for abilities: "forge a key at current/no cost" outside the key
    step (Onda 4, docs/ROADMAP_REVIEW.md §3). */
export function forgeKey(current: GameState, side: Side, n = 1, options: ForgeOptions = {}): GameState {
  const state = cloneGame(current);
  for (let count = 0; count < n; count += 1) if (!forge(state, side, options)) break;
  return state;
}

// ---------- specification (conditions and targets) ----------

/** Exported for the AI: the same condition evaluation the engine runs (FEAT-03).
    `source` is the card the condition belongs to (a `{c:{self:true}}` count needs
    it); `previous` carries the did/gone of the act before, for act-level `if`. */
/** What an act-level `if` (and a player-event condition) may read besides did/gone. */
interface Prior {
  did?: number;
  gone?: number;
  actor?: Side;
  moved?: CardInstance[];
  movedHouse?: string;
  fought?: CardInstance;
  foughtHouse?: string;
  target?: CardInstance;
  targetHouse?: string;
  wasNeighbors?: CardInstance[];
  goneCards?: { card: CardInstance; side: Side }[];
}

export function conditionHolds(
  condition: Condition,
  state: GameState,
  me: Side,
  source?: CardInstance,
  previous?: Prior,
): boolean {
  if (condition.k === "not") return !holds(condition.c, state, me, source, previous);
  if (condition.k === "myTurn") return state.activePlayer === me;
  if (condition.k === "actor") {
    if (previous?.actor === undefined) return false;
    return condition.opp ? previous.actor !== me : previous.actor === me;
  }
  if (condition.k === "key") {
    const colors = condition.any ? [...forgedKeyColors(state, 0), ...forgedKeyColors(state, 1)] : forgedKeyColors(state, condition.opp ? other(me) : me);
    return colors.includes(condition.color);
  }
  if (condition.k === "forged") {
    // Stamps: during side X's turn its previous turn is stamp-2, otherwise the
    // other side's turn right before is stamp-1 (turnStamp = round*2 + side).
    const side = condition.opp ? other(me) : me;
    const target = turnStamp(state) - (side === state.activePlayer ? 2 : 1);
    const { forgedAt, forgedBeforeAt } = state.players[side];
    return forgedAt === target || forgedBeforeAt === target;
  }
  if (condition.k === "amber") {
    const amber = state.players[condition.opp ? other(me) : me].amber;
    return condition.op === "eq" ? amber === condition.n : amber >= condition.n;
  }
  if (condition.k === "count") {
    const value = countOf(
      {
        state,
        me,
        source,
        deterministic: true,
        did: previous?.did,
        gone: previous?.gone,
        actor: previous?.actor,
        moved: previous?.moved,
        movedHouse: previous?.movedHouse,
        fought: previous?.fought,
        foughtHouse: previous?.foughtHouse,
        target: previous?.target,
        targetHouse: previous?.targetHouse,
        wasNeighbors: previous?.wasNeighbors,
        goneCards: previous?.goneCards,
      },
      condition.of,
    );
    // even/odd read the count alone (Lote 5 §5.5): `n` is ignored.
    if (condition.op === "even") return value % 2 === 0;
    if (condition.op === "odd") return value % 2 === 1;
    return condition.op === "eq" ? value === condition.n : condition.op === "gte" ? value >= condition.n : value <= condition.n;
  }
  const mine = battleline(state.players[me]).length;
  const theirs = battleline(state.players[other(me)]).length;
  return condition.k === "moreCreatures" ? mine > theirs : mine < theirs;
}

/** A house filter reads `state.activeHouse` when it says "active"; both sides
    compare case-insensitively (the printed text is lowercased by normalise). */
function houseMatches(state: GameState, card: CardInstance, wanted: string): boolean {
  const house = houseOf(state, card).toLowerCase();
  // A card of "all" houses is of every house (Experimental Therapy).
  if (house === "all") return true;
  if (wanted === "chosen") return chosenHouse !== undefined && house === chosenHouse.toLowerCase();
  return wanted === "active" ? house === (state.activeHouse ?? "").toLowerCase() : house === wanted.toLowerCase();
}

const REL_HOUSES = new Set(["self", "target", "fought", "moved", "neighbor"]);

/** Two cards share a house when either is "all" or the names match. */
function sameHouse(state: GameState, a: CardInstance, b: CardInstance): boolean {
  const left = houseOf(state, a).toLowerCase();
  const right = houseOf(state, b).toLowerCase();
  return left === "all" || right === "all" || left === right;
}

/** Relational house literals (Lote 6 §6.3) against a house captured when the ability started. */
function relationalHouse(state: GameState, card: CardInstance, wanted: string, source: CardInstance | undefined, scope?: Ctx): boolean {
  if (wanted === "neighbor") return neighbors(state, card).some((neighbor) => sameHouse(state, card, neighbor));
  const ref =
    wanted === "self" ? (source ? houseOf(state, source) : undefined) : wanted === "target" ? scope?.targetHouse : wanted === "fought" ? scope?.foughtHouse : scope?.movedHouse;
  if (!ref) return false;
  const mine = houseOf(state, card).toLowerCase();
  const otherHouse = ref.toLowerCase();
  return mine === "all" || otherHouse === "all" || mine === otherHouse;
}

/** The house the move in resolution chose ("Choose a house", Lote 5 §5.1). A
    transient module value like the ability budgets — moves resolve
    synchronously — set only while the chooser card's own abilities resolve (and
    by the legality queries for a given variant). Absent, a `chosen` filter
    matches nothing, negated or not. */
let chosenHouse: string | undefined;

function withChosen<T>(house: string | undefined, run: () => T): T {
  const saved = chosenHouse;
  chosenHouse = house;
  try {
    return run();
  } finally {
    chosenHouse = saved;
  }
}

/** The chooser card of the move being applied and its house: fire() hands the
    house only to that card's own abilities, never to a nested dispatch. */
let pendingChoice: { card: CardInstance; house: string } | null = null;

/** A `house` filter value that cannot hold: "chosen" with no choice made. */
const unchosen = (value: string) => positive(value) === "chosen" && chosenHouse === undefined;

const splitTraits = (traits: string | undefined) => (traits ?? "").split("•").map((trait) => trait.trim()).filter(Boolean);

/** The traits of a card right now (Lote 8 §8.6): face.traits ("Knight • Beast" prints two) plus the ones a live
    effect grants. The single reader — everything that asks "is it a Mutant?" goes through here. Like houseOf,
    a depth guard answers the printed traits while the grants themselves are being resolved, so an effect
    whose own target filters by trait cannot recurse (the gate rejects those too). */
let traitDepth = 0;
export function traitsOf(state: GameState, card: CardInstance): string[] {
  const traits = splitTraits(card.face.traits);
  if (traitDepth > 0) return traits;
  traitDepth += 1;
  try {
    for (const owner of allEffects(state)) {
      if (owner.effect.traits && effectHits(state, owner, card)) traits.push(...splitTraits(owner.effect.traits));
    }
  } finally {
    traitDepth -= 1;
  }
  return traits;
}

function traitMatches(state: GameState, card: CardInstance, wanted: string): boolean {
  return traitsOf(state, card).some((trait) => trait.toLowerCase() === wanted.toLowerCase());
}

/** Does a live "may fight" effect let this creature fight outside the active house (Lote 8 §8.8)? */
const mayFightOutOfHouse = (state: GameState, card: CardInstance): boolean =>
  allEffects(state).some((owner) => owner.effect.mayFight === true && effectHits(state, owner, card));

/** A `!`/`non-` prefixed filter value negates its test. */
const negated = (value: string) => value.startsWith("!");
const positive = (value: string) => (negated(value) ? value.slice(1) : value);

/** The fight currently resolving. Saved and restored so a nested `use via:"fight"` does not leak (Lote 6 §6.2). */
let fightPair: { attacker: CardInstance; defender: CardInstance } | null = null;

/** "Deals damage to that creature rather than the one it is fighting" (Lote 8 §8.1): the damage the
    fought creature would take goes to `to` until the fight ends. Same transient scope as fightPair. */
let fightRedirect: { from: CardInstance; to: CardInstance } | null = null;

function matches(state: GameState, me: Side, source: CardInstance | undefined, card: CardInstance, filter: Filter, scope?: Ctx): boolean {
  const side = controllerOf(state, card);
  const typeName = filter.type?.startsWith("!") ? filter.type.slice(1) : filter.type;
  const typeNeg = filter.type?.startsWith("!") === true;
  const foe = fightPair ? (fightPair.attacker === source ? fightPair.defender : fightPair.defender === source ? fightPair.attacker : undefined) : undefined;
  const neighborPool =
    scope?.target && controllerOf(state, scope.target) !== undefined ? neighbors(state, scope.target) : (scope?.wasNeighbors ?? []);
  const counterOk =
    filter.counters === undefined ||
    (typeof filter.counters === "string" ? (card.marks?.[filter.counters] ?? 0) > 0 : ((card.counters ?? 0) > 0) === filter.counters);
  return (
    (!filter.type || (card.face.type === typeName) !== typeNeg) &&
    (!filter.side || (filter.side === "friendly") === (side === me)) &&
    (filter.damaged === undefined || card.damage > 0 === filter.damaged) &&
    (filter.flank === undefined || onFlank(state, card) === filter.flank) &&
    (!filter.other || card !== source) &&
    (!filter.ready || (card.ready && !card.stunned)) &&
    (!filter.self || card === source) &&
    (!filter.host || card.instanceId === source?.attachedTo) &&
    (!filter.neighborsOfSource || (source !== undefined && neighbors(state, source).includes(card))) &&
    (!filter.neighborsOfTarget || neighborPool.includes(card)) &&
    (!filter.target || card === scope?.target) &&
    (!filter.fighting || card === foe) &&
    (filter.powerMax === undefined || effectivePower(state, card) <= filter.powerMax) &&
    (filter.powerMin === undefined || effectivePower(state, card) >= filter.powerMin) &&
    (!filter.weaker || (source !== undefined && effectivePower(state, card) < effectivePower(state, source))) &&
    (!filter.stronger || (source !== undefined && effectivePower(state, card) > effectivePower(state, source))) &&
    (filter.house === undefined ||
      (!unchosen(filter.house) &&
        (REL_HOUSES.has(positive(filter.house))
          ? relationalHouse(state, card, positive(filter.house), source, scope)
          : houseMatches(state, card, positive(filter.house))) !== negated(filter.house))) &&
    (filter.trait === undefined || traitMatches(state, card, positive(filter.trait)) !== negated(filter.trait)) &&
    (filter.exhausted === undefined || !card.ready === filter.exhausted) &&
    (filter.amber === undefined || ((card.amber ?? 0) > 0) === filter.amber) &&
    counterOk
  );
}

function everyMatch(state: GameState, me: Side, source: CardInstance | undefined, filter: Filter, scope?: Ctx): CardInstance[] {
  const found = [...state.players[me].board, ...state.players[other(me)].board].filter((card) =>
    matches(state, me, source, card, filter, scope),
  );
  // `most` (Lote 8 §8.3) is the parser's spelling of the same ordering as `top`.
  if (filter.top || filter.most) return found.sort((a, b) => effectivePower(state, b) - effectivePower(state, a)).slice(0, filter.top ?? filter.most);
  // `least` is the mirror of `top`: ties (no printed power difference) keep the
  // board order, exactly like the `top` sort does.
  if (filter.least) return found.sort((a, b) => effectivePower(state, a) - effectivePower(state, b)).slice(0, filter.least);
  return found;
}

const HARMFUL = new Set<Act["k"]>(["destroy", "purge", "damage", "stun", "exhaust", "enrage", "returnToHand", "returnToDeck", "archive"]);
/** A chosen-creature redirect (Gabos Longarms) aims its choice at an enemy like any harmful act. */
const isHarmful = (ability: Ability) => ability.acts.some((act) => HARMFUL.has(act.k) || (act.k === "lasting" && act.e.replace?.redirect === "chosen"));
/** "Give control … to your opponent" (Lote 4 §4.7): takeControl is not in
    HARMFUL, and with `opp` the auto-pick must take the weakest FRIENDLY card. */
const givesControl = (ability: Ability) => ability.acts.some((act) => act.k === "takeControl" && act.opp === true);

/** Default choice for a targeted ability: harmful effects hit the strongest
    enemy (then the weakest friendly), helpful ones the strongest friendly. */
function autoPick(state: GameState, me: Side, candidates: CardInstance[], harmful: boolean, give = false): CardInstance | undefined {
  const strongest = (cards: CardInstance[]) =>
    [...cards].sort((a, b) => effectivePower(state, b) - effectivePower(state, a) || b.damage - a.damage)[0];
  const weakest = (cards: CardInstance[]) =>
    [...cards].sort((a, b) => effectivePower(state, a) - effectivePower(state, b) || a.damage - b.damage)[0];
  const friendly = candidates.filter((card) => controllerOf(state, card) === me);
  const enemy = candidates.filter((card) => !friendly.includes(card));
  // "Give control … to your opponent" wants the cheapest creature (Lote 4 §4.7).
  if (give) return weakest(friendly) ?? weakest(enemy);
  if (!harmful) return strongest(friendly) ?? strongest(enemy);
  return strongest(enemy) ?? weakest(friendly);
}

/** What a selection (and a dynamic count) is resolved against. */
interface Ctx {
  state: GameState;
  me: Side;
  /** The card the ability belongs to (absent outside a card context). */
  source?: CardInstance;
  /** The defender of the fight in progress ("the creature ~ fights"). */
  fought?: CardInstance;
  /** Observer abilities: the card that caused the event ("After an enemy
      creature reaps, stun it." — the reaper). */
  event?: CardInstance;
  target?: CardInstance;
  /** `who` acts (Lote 4 §4.6): the owner/controller of the reference card
      (target ?? event ?? fought) as captured when the ability started —
      after a destroy the card is already gone and controllerOf answers
      undefined. */
  whoOwner?: Side;
  whoController?: Side;
  deterministic: boolean;
  /** How a "use a creature" action resolves the creature (BUG-11). */
  useVia?: "reap" | "action";
  /** The actor declined the "You may" clauses of this move (wave 2). */
  decline?: boolean;
  /** What the previous act of this ability did (`per:"did"`/`"gone"`). */
  did?: number;
  gone?: number;
  /** Cards the previous relocating act moved, and the house of the first (Lote 6 §6.4). */
  moved?: CardInstance[];
  movedHouse?: string;
  /** Neighbors of the target as they were when the ability started (Lote 6 §6.7). */
  wasNeighbors?: CardInstance[];
  /** Houses captured before a destroy clears `houseAs` (Lote 6 §6.3). */
  targetHouse?: string;
  foughtHouse?: string;
  /** Who caused the player-event this ability is answering (forge / house). */
  actor?: Side;
  /** The second chosen card (Lote 7 §7.1) and the rest of the move's `targets` queue after it. */
  target2?: CardInstance;
  queue?: string[];
  /** Where a `toFlank` act sends the creature. */
  flank?: "left" | "right";
  /** The cards the previous act sent out of play (Lote 8 §8.5), for `{gone: Filter}`. */
  goneCards?: { card: CardInstance; side: Side }[];
  /** The option of the move's "Choose one:" and of a `side:"any"` move (Lote 8 §8.4/§8.7). */
  mode?: "a" | "b";
}

/** The ability context proper: an act always runs with its source card. */
interface Context extends Ctx {
  source: CardInstance;
}

/** Mutable holder: the move's chosen target is consumed by the first targeted ability. */
interface Choice {
  id?: string;
  /** The move's `targets` queue: consumed whole by the first ability that reads it. */
  targets?: string[];
  flank?: "left" | "right";
  /** The move's chosen option (Lote 8): read by every ability of the move, never consumed. */
  mode?: "a" | "b";
}

/** The cards a selection points at. `k` is the act being resolved, which decides
    whether a `{pick}` aims at the harmful or the helpful side. */
function select(context: Ctx, selection: Selection, k?: Act["k"]): CardInstance[] {
  const { state, source, target, fought, event } = context;
  if (selection === "self") return source && controllerOf(state, source) !== undefined ? [source] : [];
  if (selection === "host") {
    return state.players.flatMap((player) => player.board.filter((card) => card.instanceId === source?.attachedTo));
  }
  if (selection === "target") return target ? [target] : [];
  if (selection === "target2") return context.target2 ? [context.target2] : [];
  if (selection === "targetNeighbors") {
    if (target && controllerOf(state, target) !== undefined) return neighbors(state, target);
    return context.wasNeighbors ?? [];
  }
  if (selection === "targetAndNeighbors") return target ? [target, ...neighbors(state, target)] : [];
  if (selection === "neighborsOfFought") return fought ? neighbors(state, fought) : [];
  if (selection === "fought") return fought ? [fought] : [];
  if (selection === "event") return event ? [event] : [];
  if ("pick" in selection) {
    // Up to `n` DISTINCT cards, chosen as the engine auto-targets: the strongest
    // enemy (or weakest friend) for a harmful act, the strongest friend for a
    // helpful one. The player only ever chooses the ability's `target`.
    const remaining = everyMatch(state, context.me, source, selection.pick, context);
    const picked: CardInstance[] = [];
    // "Up to N" (Lote 7 §7.1): the player's queue, in order, never more than N and only legal cards.
    // No queue, no cards: the engine never guesses a subset for the human.
    if (selection.upTo) {
      for (const id of context.queue ?? []) {
        if (picked.length >= (selection.n ?? 99)) break;
        const card = remaining.find((item) => item.instanceId === id);
        if (card && !picked.includes(card)) picked.push(card);
      }
      return picked;
    }
    for (let count = 0; count < (selection.n ?? 1) && remaining.length; count += 1) {
      const card = autoPick(state, context.me, remaining, k !== undefined && HARMFUL.has(k));
      if (!card) break;
      picked.push(card);
      remaining.splice(remaining.indexOf(card), 1);
    }
    return picked;
  }
  return everyMatch(state, context.me, source, selection.each, context);
}

/** A dynamic amount ("for each …"): the previous act, a board filter, a zone or
    counter of a player, or a stat summed over a selection. */
function countOf(scope: Ctx, spec: Count): number {
  if (spec === "did") return scope.did ?? 0;
  if (spec === "gone") return scope.gone ?? 0;
  if ("gone" in spec) return (scope.goneCards ?? []).filter(({ card, side }) => {
    // The dead card has no controller any more: `side` was taken before it left play.
    const { side: want, ...rest } = spec.gone;
    return (!want || (want === "friendly") === (side === scope.me)) && matches(scope.state, scope.me, scope.source, card, rest, scope);
  }).length;
  if ("c" in spec) return everyMatch(scope.state, scope.me, scope.source, spec.c, scope).length;
  if ("m" in spec) {
    const moved = (scope.moved ?? []).filter((card) => {
      if (spec.type && card.face.type !== spec.type) return false;
      if (!spec.house) return true;
      const neg = spec.house.startsWith("!");
      const name = (neg ? spec.house.slice(1) : spec.house).toLowerCase();
      const house = houseOf(scope.state, card).toLowerCase();
      const hit = house === "all" || house === name;
      return hit !== neg;
    });
    if (spec.m === "cards") return moved.length;
    const icons = (card: CardInstance) =>
      (card.face.amber ?? 0) + (card.face.bonusIcons?.amber ?? 0) + (card.face.bonusIcons?.capture ?? 0) + (card.face.bonusIcons?.damage ?? 0) + (card.face.bonusIcons?.draw ?? 0);
    if (spec.m === "icons") return moved.reduce((sum, card) => sum + icons(card), 0);
    return moved.reduce((sum, card) => sum + (card.face.power ?? 0), 0);
  }
  if ("sub" in spec) {
    const [from, less] = spec.sub;
    return Math.max(0, countOf(scope, from) - (typeof less === "number" ? less : countOf(scope, less)));
  }
  if ("p" in spec) {
    const player = scope.state.players[spec.opp ? other(scope.me) : scope.me];
    if (spec.p === "keyColors") {
      const sides: Side[] = spec.any ? [0, 1] : [spec.opp ? other(scope.me) : scope.me];
      return new Set(sides.flatMap((side) => forgedKeyColors(scope.state, side))).size;
    }
    // "one third of the cards in your hand" (Lote 8 §8.9): the floor of the size over `div`.
    const divide = (value: number) => (spec.div ? Math.floor(value / spec.div) : value);
    if (spec.p === "keys" || spec.p === "amber") return divide(player[spec.p]);
    if (spec.p === "plays") return divide(scope.state.plays);
    return divide(player[spec.p].length);
  }
  return select(scope, spec.s).reduce(
    (sum, card) =>
      sum +
      (spec.of === "damage"
        ? card.damage
        : spec.of === "amber"
          ? (card.amber ?? 0)
          : spec.of === "counters"
            ? spec.name
              ? (card.marks?.[spec.name] ?? 0)
              : (card.counters ?? 0)
            : effectivePower(scope.state, card)),
    0,
  );
}

/** Specification shared by the engine and the AI: can this ability do anything now? */
export function canResolve(state: GameState, me: Side, source: CardInstance, ability: Ability): boolean {
  if (ability.if && !holds(ability.if, state, me, source)) return false;
  if (!ability.target) return true;
  const firsts = everyMatch(state, me, source, ability.target);
  if (!firsts.length) return false;
  if (!ability.target2) return true;
  // The second target is another card than the first.
  const seconds = everyMatch(state, me, source, ability.target2);
  return firsts.some((first) => seconds.some((second) => second !== first));
}

// ---------- game actions ----------

function leavePlay(state: GameState, card: CardInstance, destination: "discard" | "hand" | "deck" | "archives" | "purged"): void {
  const side = controllerOf(state, card);
  if (side === undefined) return;
  const player = state.players[side];
  // A card leaving play goes to its owner's pile, not its controller's
  // (keyteki player.moveCard: "card.owner.moveCard(card, targetLocation)").
  const owner = state.players[ownerOf(state, card) ?? side];
  player.board = player.board.filter((item) => item !== card);
  // Captured amber goes to the opponent of the creature's controller.
  if (card.amber) state.players[other(side)].amber += card.amber;
  // Upgrades may be attached by the other player too (BUG-04): scan both boards.
  for (const upgrade of state.players.flatMap((p) => p.board).filter((item) => item.attachedTo === card.instanceId)) {
    leavePlay(state, upgrade, "discard");
  }
  // A Gigantic half under this creature leaves play with it (BUG-23).
  for (const half of card.under ?? []) {
    Object.assign(half, { damage: 0, ready: false, stunned: false, amber: 0, armorUsed: 0, elusiveUsed: false, poisoned: false });
    owner.discard.push(half);
  }
  card.under = undefined;
  // Leaving play strips the set-layer state too: keyteki resets the controller
  // to the owner and the tokens travel with the zone move (Onda 4).
  Object.assign(card, {
    damage: 0,
    ready: false,
    stunned: false,
    amber: 0,
    armorUsed: 0,
    elusiveUsed: false,
    poisoned: false,
    attachedTo: undefined,
    warded: undefined,
    enraged: undefined,
    controlledBy: undefined,
    counters: undefined,
    marks: undefined,
    hold: undefined,
    houseAs: undefined,
  });
  // A token creature has no card behind it (isToken): it is removed from the
  // game instead of entering hand/discard/deck, so it can never be drawn or
  // reshuffled into a deck (Onda 3).
  if (card.isToken) return;
  if (destination === "deck") owner.deck.push(card);
  else owner[destination].push(card);
}

/** Purge / return / archive by an effect: a ward intercepts these leave-play
    events too (keyteki Card.js onCardPurged/onCardLeavesPlay) — the token is
    spent and the creature stays. Only creatures carry ward. */
function leaveByEffect(state: GameState, card: CardInstance, destination: "hand" | "deck" | "archives" | "purged"): void {
  if (isCreature(card) && card.warded) {
    card.warded = 0;
    return;
  }
  leavePlay(state, card, destination);
}

// Cards whose "Destroyed:" abilities are resolving: still in play, but already
// on their way out, so sweep() must not destroy them a second time.
const dying = new WeakSet<CardInstance>();

// Actions whose own text purged them ("If you do, purge ~"): applyMove sends
// them to the purged zone instead of the discard pile (Lote 5 §5.4).
/** An Action still resolving that moved itself out of the discard pile (Lote 6 §6.7). */
const selfLeave = new WeakMap<CardInstance, "purged" | "archives" | "deck" | "hand">();

function destroy(state: GameState, card: CardInstance, deterministic: boolean, by?: Side): boolean {
  const side = controllerOf(state, card);
  if (side === undefined || dying.has(card)) return false;
  // Onda 4 — ward first (keyteki Card.js keywordReactions: an interrupt that
  // cancels the destruction and discards the token), then the printed "instead"
  // replacement ("If this creature would be destroyed, archive it instead").
  // A replaced destruction is not a destruction: "Destroyed:" stays silent and
  // no kill is credited, like keyteki's cancelled onCardDestroyed event.
  if (card.warded) {
    card.warded = 0;
    return false;
  }
  const replacement = replacementFor(state, card, "destroy")?.effect.replace;
  if (replacement?.to) {
    leavePlay(state, card, replacement.to);
    return true;
  }
  // FEAT-06: an enemy creature destroyed by an effect is a kill for the acting
  // side; damage-based deaths are credited by fight() (a board wipe destroys
  // both sides at once, so no single "destroyer" exists).
  if (isCreature(card) && by !== undefined && by !== side) tally(state.players[by], "creaturesDestroyed");
  dying.add(card);
  fire(state, side, card, "destroyed", { deterministic });
  dying.delete(card);
  leavePlay(state, card, "discard");
  return true;
}

/** Sacrifice (keyteki DestroyAction with isSacrifice): it is a destruction —
    ward, "instead" replacements and "Destroyed:" all apply. The kill credit
    follows destroy(): only when the acting side does not control the card. */
function sacrifice(state: GameState, card: CardInstance, deterministic: boolean, by: Side): void {
  destroy(state, card, deterministic, by);
}

/** "Make a token creature" (keyteki MakeTokenCreatureAction): the token enters
    play exhausted on the right flank. Its face is synthesized — the engine has
    no token card data — with the house of the card that made it, 1 power and
    the "Token" trait; `isToken` marks the instance so it never touches a deck. */
function makeToken(state: GameState, side: Side, house: string): CardInstance {
  state.tokenSerial = (state.tokenSerial ?? 0) + 1;
  const token: CardInstance = {
    instanceId: `token-${side}-${state.tokenSerial}`,
    face: {
      id: `token-${state.tokenSerial}`,
      title: "Token Creature",
      house,
      type: "Creature",
      image: "",
      text: "",
      amber: 0,
      power: 1,
      armor: 0,
      traits: "Token",
    },
    damage: 0,
    ready: false,
    stunned: false,
    isToken: true,
  };
  state.players[side].board.push(token);
  return token;
}

/** Armor absorbs damage once per turn (keyteki DealDamageAction/armorUsed).
    Ward prevents the whole instance and an active redirect takes it instead
    (Onda 4); `allowRedirect` stops a redirected packet from bouncing again. */
function dealDamage(state: GameState, card: CardInstance, amount: number, poison = false, allowRedirect = true): void {
  if (!isCreature(card) || amount <= 0) return;
  // Gabos Longarms (Lote 8 §8.1): during the fight the fought creature's damage goes to the chosen one.
  if (allowRedirect && fightRedirect?.from === card && fightRedirect.to !== card && controllerOf(state, fightRedirect.to) !== undefined) {
    dealDamage(state, fightRedirect.to, amount, poison, false);
    return;
  }
  // "Cannot be dealt damage" (Lote 5 §5.6) is checked after the Gabos redirect, so the chosen creature (not the
  // fought one) is the one that may be immune; below it nothing is redirected, absorbed or warded.
  if (damagePrevented(state, card)) return;
  // A redirect is an interrupt on the damage-applied event (keyteki Shadow
  // Self), so it runs before armor and before the target's own ward: a warded
  // neighbor still sends the damage to the redirecting creature.
  if (allowRedirect) {
    const redirected = redirectFor(state, card);
    if (redirected) {
      dealDamage(state, redirected, amount, poison, false);
      return;
    }
  }
  // Ward cancels the damage event (keyteki unwardAndCancel) before armor is
  // accounted: the token is discarded and nothing else happens.
  if (card.warded) {
    card.warded = 0;
    return;
  }
  const absorbed = Math.min(Math.max(0, effectiveArmor(state, card) - (card.armorUsed ?? 0)), amount);
  card.armorUsed = (card.armorUsed ?? 0) + absorbed;
  const applied = amount - absorbed;
  if (applied <= 0) return;
  card.damage += applied;
  if (poison) card.poisoned = true;
}

/** Destroys every creature whose damage reached its power, whose effective power
    fell to 0 (keyteki: power <= 0) or that took poison damage.
    A ward spares the first pass and is consumed, so the next pass destroys the
    creature — keyteki re-checks the game state after the cancelled destruction. */
function sweep(state: GameState, deterministic: boolean): void {
  for (;;) {
    const doomed = state.players
      .flatMap((player) => battleline(player))
      .find((card) => !dying.has(card) && (card.poisoned || effectivePower(state, card) <= 0 || (card.damage > 0 && card.damage >= effectivePower(state, card))));
    if (!doomed) return;
    destroy(state, doomed, deterministic);
  }
}

/** The single door into a player's discard pile: fires the Scrap: trigger of
    every card that lands there. Only the active player's discards are live — a
    card discarded outside its controller's turn cannot react (keyteki raises
    the event on the card, and Scrap is a discard trigger of that side). The
    move's chosen target is forwarded so a Scrap ability can use it. */
function toDiscard(state: GameState, side: Side, cards: CardInstance[], deterministic: boolean, decline = false, choice?: Choice, fromHand = false): void {
  state.players[side].discard.push(...cards);
  if (side === state.activePlayer) for (const card of cards) fire(state, side, card, "scrap", { deterministic, decline, choice });
  // Lote 7 §7.3: a card that left a HAND wakes the `discard` observers of both sides (mills do not);
  // `side` is who discarded, read by `if: {k:"actor"}`.
  if (fromHand) for (const card of cards) fireObservers(state, card, "discard", deterministic, side);
}

function discardRandom(state: GameState, side: Side, deterministic: boolean): CardInstance | undefined {
  const player = state.players[side];
  if (!player.hand.length) return undefined;
  const index = deterministic ? 0 : Math.floor(roll(state) * player.hand.length);
  const [card] = player.hand.splice(index, 1);
  toDiscard(state, side, [card], deterministic, false, undefined, true);
  return card;
}

/** Extra bonus icons resolved when a card is played (keyteki
    ResolveBonusIconsAction): each capture icon captures 1 amber from the
    opponent onto a friendly creature, each damage icon deals 1 damage to a
    creature and each draw icon draws a card. keyteki prompts for the capture/
    damage target; the engine auto-picks like every other auto-target. */
function resolveBonusIcons(state: GameState, side: Side, icons: BonusIcons): void {
  const me = state.players[side];
  for (let count = 0; count < (icons.capture ?? 0); count += 1) {
    const host = autoPick(state, side, battleline(me), false);
    if (!host) break;
    const taken = Math.min(1, state.players[other(side)].amber);
    state.players[other(side)].amber -= taken;
    host.amber = (host.amber ?? 0) + taken;
    tally(me, "amberCaptured", taken);
  }
  for (let count = 0; count < (icons.damage ?? 0); count += 1) {
    const target = autoPick(state, side, state.players.flatMap((player) => battleline(player)), true);
    if (!target) break;
    dealDamage(state, target, 1);
  }
  if (icons.draw) draw(me, icons.draw, state);
}

/** What an act leaves behind, for the "did"/"gone" counts of the act after it. */
interface Snapshot {
  /** The counters of both players: amber, keys, chains and the five zone sizes. */
  counters: number[];
  /** The act's selection as it was, with the signature each card showed. */
  cards?: { card: CardInstance; signature: string; inPlay: boolean; side?: Side }[];
}

/** Everything an act can change about a card that stays in play — the signature
    "did" compares ("for each creature healed this way"). */
const signature = (state: GameState, card: CardInstance) =>
  `${controllerOf(state, card)}|${card.damage}|${card.ready ? 1 : 0}|${card.stunned ? 1 : 0}|${card.amber ?? 0}|${card.warded ?? 0}|${card.enraged ?? 0}|${card.counters ?? 0}`;

const countersOf = (state: GameState): number[] =>
  state.players.flatMap((player) => [
    player.amber,
    player.keys,
    player.chains,
    player.hand.length,
    player.deck.length,
    player.discard.length,
    player.archives.length,
    player.purged.length,
  ]);

/** did/gone of the act just run, measured AFTER the sweep: with a selection, the
    cards it affected (changed signature or left play); without one, the largest
    absolute move of the counters. */
function measured(state: GameState, before: Snapshot): { did: number; gone: number; goneCards: { card: CardInstance; side: Side }[] } {
  if (!before.cards) {
    const after = countersOf(state);
    return { did: Math.max(...after.map((value, index) => Math.abs(value - before.counters[index]))), gone: 0, goneCards: [] };
  }
  let did = 0;
  let gone = 0;
  const goneCards: { card: CardInstance; side: Side }[] = [];
  for (const entry of before.cards) {
    if (entry.inPlay && entry.side !== undefined && controllerOf(state, entry.card) === undefined) {
      gone += 1;
      goneCards.push({ card: entry.card, side: entry.side });
    }
    if (signature(state, entry.card) !== entry.signature) did += 1;
  }
  return { did, gone, goneCards };
}

/** The previous relocating act's cards, with the first card's house taken before leavePlay. */
function remember(context: Context, cards: CardInstance[], houses?: Map<CardInstance, string>): void {
  context.moved = cards;
  const first = cards[0];
  context.movedHouse = first ? (houses?.get(first) ?? houseOf(context.state, first)) : undefined;
}

const iconScore = (card: CardInstance) =>
  (card.amber ?? 0) + (card.face.amber ?? 0) + (card.face.bonusIcons?.amber ?? 0) + (card.face.bonusIcons?.capture ?? 0) + (card.face.bonusIcons?.damage ?? 0) + (card.face.bonusIcons?.draw ?? 0);

function run(context: Context, act: Act): void {
  // The other option of a "Choose one:" is not a skipped act, it is not part of this move at all.
  if (act.mode && act.mode !== (context.mode ?? "a")) return;
  // A skipped act did nothing: the did/gone of the act before do not carry on.
  if ((act.optional && context.decline) || (act.if && !holds(act.if, context.state, context.me, context.source, context))) {
    context.did = 0;
    context.gone = 0;
    context.goneCards = [];
    return;
  }
  const { state, me, source, deterministic } = context;
  // `who` (Lote 4 §4.6) names the actor dynamically from the reference card
  // captured when the ability started; with no reference the act is skipped.
  const who = "who" in act ? act.who : undefined;
  const whoSide = who === "owner" ? context.whoOwner : who === "controller" ? context.whoController : undefined;
  if (who && whoSide === undefined) {
    context.did = 0;
    context.gone = 0;
    context.goneCards = [];
    return;
  }
  // `opp` flips the actor of the act (and the player whose zones it reads); a move's `side` names the
  // opponent's zone outright or leaves the player's option to decide it (Lote 8 §8.7).
  const flipped = ("opp" in act && act.opp) || (act.k === "move" && (act.side === "opponent" || (act.side === "any" && context.mode === "b")));
  const side: Side = whoSide ?? (flipped ? other(me) : me);
  const player = state.players[side];
  const cards = "s" in act ? select(context, act.s, act.k) : [];
  // Acts whose `did` is a total rather than a card count (moveAmber,
  // removeCounter) record it themselves after the sweep.
  let explicitDid: number | undefined;
  const before: Snapshot = "s" in act
    ? { counters: [], cards: cards.map((card) => ({ card, signature: signature(state, card), inPlay: controllerOf(state, card) !== undefined, side: controllerOf(state, card) })) }
    : { counters: countersOf(state) };
  // "for each …": the count is read from the state the act starts in. Absent
  // `n` (moveAmber/removeCounter = "all") counts as 0 here; those acts read the
  // cards themselves.
  const amount = "n" in act && act.n !== undefined ? act.n * (act.per ? countOf(context, act.per) : 1) : 0;
  switch (act.k) {
    case "gainAmber":
      player.amber += amount;
      tally(player, "amberGained", amount);
      break;
    case "loseAmber":
      player.amber = Math.max(0, player.amber - amount);
      break;
    case "steal": {
      // "Your amber cannot be stolen" zeroes the steal against that side.
      const stolen = stealBlocked(state, other(me)) ? 0 : Math.min(amount, state.players[other(me)].amber);
      state.players[other(me)].amber -= stolen;
      state.players[me].amber += stolen;
      tally(state.players[me], "amberStolen", stolen);
      break;
    }
    case "gainChains":
      player.chains += amount;
      break;
    case "draw":
      draw(player, amount, state);
      break;
    case "discardRandom": {
      const discarded: CardInstance[] = [];
      for (let count = 0; count < amount; count += 1) {
        const card = discardRandom(state, side, deterministic);
        if (card) discarded.push(card);
      }
      remember(context, discarded);
      break;
    }
    case "keyCost":
      player.keyCostMod = (player.keyCostMod ?? 0) + amount;
      break;
    case "capture":
      for (const card of cards.filter(isCreature)) {
        const controller = controllerOf(state, card) as Side;
        // "from its own side" captures out of the creature's controller's pool
        // instead of that controller's opponent (Lote 4 §4.4).
        const from = act.own ? controller : other(controller);
        const taken = Math.min(amount, state.players[from].amber);
        state.players[from].amber -= taken;
        card.amber = (card.amber ?? 0) + taken;
        tally(state.players[controller], "amberCaptured", taken);
      }
      break;
    case "damage":
      for (const card of cards) dealDamage(state, card, amount);
      break;
    case "heal":
      for (const card of cards) card.damage = Math.max(0, card.damage - amount);
      break;
    case "destroy": {
      const houses = new Map(cards.map((card) => [card, houseOf(state, card)] as const));
      for (const card of cards) destroy(state, card, deterministic, me);
      remember(context, cards.filter((card) => controllerOf(state, card) === undefined), houses);
      break;
    }
    case "purge": {
      // A leave-play destination of its own (keyteki PurgeAction): the card is
      // out of the game and cannot come back through a reshuffle.
      const houses = new Map(cards.map((card) => [card, houseOf(state, card)] as const));
      for (const card of cards) leaveByEffect(state, card, "purged");
      // "Purge ~" on an Action still being played: it is not in play yet, so
      // applyMove sends it to purged instead of the discard pile (Lote 5 §5.4).
      if (act.s === "self" && controllerOf(state, source) === undefined) selfLeave.set(source, "purged");
      remember(context, cards.filter((card) => controllerOf(state, card) === undefined), houses);
      break;
    }
    case "sacrifice": {
      const houses = new Map(cards.map((card) => [card, houseOf(state, card)] as const));
      for (const card of cards) sacrifice(state, card, deterministic, me);
      remember(context, cards.filter((card) => controllerOf(state, card) === undefined), houses);
      break;
    }
    case "exalt":
      // keyteki ExaltAction: place N amber from the common supply on the
      // creature. It behaves like captured amber (returns to the opponent when
      // the creature leaves play) — no player's pool is touched.
      for (const card of cards.filter(isCreature)) card.amber = (card.amber ?? 0) + amount;
      break;
    case "counter":
      // A named counter lives in `marks` and does not change power (Lote 6 §6.6).
      // Absent `name`, it is the +1 power counter (Onda 5).
      for (const card of cards) {
        if (act.name) card.marks = { ...card.marks, [act.name]: (card.marks?.[act.name] ?? 0) + amount };
        else card.counters = (card.counters ?? 0) + amount;
      }
      break;
    case "ward":
      // keyteki WardAction/Card.ward(): the token does not stack, so warding a
      // warded creature is a no-op ("if (!this.hasToken('ward')) addToken").
      for (const card of cards.filter(isCreature)) if (!card.warded) card.warded = 1;
      break;
    case "removeWard":
      for (const card of cards.filter(isCreature)) card.warded = 0;
      break;
    case "enrage":
      // keyteki EnrageAction/Card.enrage(): one token, never stacked.
      for (const card of cards.filter(isCreature)) if (!card.enraged) card.enraged = 1;
      break;
    case "removeEnrage":
      for (const card of cards.filter(isCreature)) card.enraged = 0;
      break;
    case "takeControl": {
      // keyteki game.takeControl: the card leaves its controller's battleline
      // and joins the new controller's on a flank (the left one unless a
      // "takeControlOn…" effect says otherwise) — this engine always takes the
      // left flank, as the automated keyteki prompt does by default. With
      // `opp` the destination is the other side ("Give control … to your
      // opponent", Lote 4 §4.7).
      const to: Side = act.opp ? other(me) : me;
      for (const card of cards) {
        const from = controllerOf(state, card);
        if (from === undefined || from === to) continue;
        // Control given back to the owner is not foreign control any more.
        const returning = ownerOf(state, card) === to;
        state.players[from].board = state.players[from].board.filter((item) => item !== card);
        state.players[to].board.unshift(card);
        card.controlledBy = returning ? undefined : to;
        record(state, "log.takeControl", { name: state.players[to].name, card: card.face.title });
      }
      break;
    }
    case "moveAmber": {
      // Takes `n` (absent = all) from each selected card; "pool" pays the
      // resolving side (`opp` the other one), "supply" discards it. `did` is
      // the total amber moved (Lote 4 §4.9).
      let moved = 0;
      // "…to another creature" (Lote 7 §7.1): without a living second target nothing leaves the first.
      const dest = act.to === "target2" ? context.target2 : undefined;
      for (const card of cards) {
        if (act.to === "target2" && (!dest || controllerOf(state, dest) === undefined || dest === card)) continue;
        const have = card.amber ?? 0;
        const taken = Math.min(act.n ?? have, have);
        if (taken <= 0) continue;
        card.amber = have - taken;
        moved += taken;
      }
      if (dest && moved > 0) dest.amber = (dest.amber ?? 0) + moved;
      if (act.to === "pool" && moved > 0) state.players[act.opp ? other(me) : me].amber += moved;
      explicitDid = moved;
      break;
    }
    case "removeCounter": {
      // Removes `n` counters (absent = all). A name reads `marks`; otherwise +1 power.
      // `did` is the total removed (Lote 4 §4.10, Lote 6 §6.6).
      let removed = 0;
      for (const card of cards) {
        const have = act.name ? (card.marks?.[act.name] ?? 0) : (card.counters ?? 0);
        const taken = Math.min(act.n ?? have, have);
        if (taken <= 0) continue;
        const left = have - taken;
        if (act.name) {
          const marks = { ...card.marks };
          if (left > 0) marks[act.name] = left;
          else delete marks[act.name];
          card.marks = Object.keys(marks).length ? marks : undefined;
        } else card.counters = left > 0 ? left : undefined;
        removed += taken;
      }
      explicitDid = removed;
      break;
    }
    case "toFlank":
      // Lote 7 §7.1: the creature leaves its slot and re-enters at the chosen end of its
      // controller's battleline (artifacts/upgrades in the board array do not count as flanks).
      for (const card of cards.filter(isCreature)) {
        const owner = controllerOf(state, card);
        if (owner === undefined) continue;
        const rest = state.players[owner].board.filter((item) => item !== card);
        const line = rest.filter(isCreature);
        const at = context.flank === "right" ? (line.length ? rest.indexOf(line[line.length - 1]) + 1 : rest.length) : line.length ? rest.indexOf(line[0]) : rest.length;
        rest.splice(at, 0, card);
        state.players[owner].board = rest;
      }
      break;
    case "forgeKey":
      // keyteki ForgeAction: the cost comes out of the pool unless the text
      // says "at no cost"; `mod` is the printed "+N cost".
      // `less` is read again for every key: the pool it counts changes.
      for (let count = 0; count < amount; count += 1) {
        const less = act.less ? countOf(context, act.less) : undefined;
        if (!forge(state, me, { free: act.free, mod: act.mod, less, min: act.min, deterministic })) break;
      }
      break;
    case "setHouse":
      // The card counts as that house until it leaves play (leavePlay zeroes it).
      for (const card of cards) {
        const house = act.house === "chosen" ? chosenHouse : act.house;
        if (house) card.houseAs = house;
      }
      break;
    case "forceHouse": {
      // The next active house of `who` (default: the opponent). `house` reads a
      // reference card captured when the ability started (Lote 6 §6.3).
      const house = act.house === "target" ? context.targetHouse : act.house === "fought" ? context.foughtHouse : act.house === "moved" ? context.movedHouse : chosenHouse;
      const whoSide = act.who === "owner" ? context.whoOwner : act.who === "controller" ? context.whoController : other(me);
      if (house && whoSide !== undefined) state.players[whoSide].mustChoose = house;
      break;
    }
    case "unforgeKey":
      // keyteki UnforgeAction: every printed "unforge" takes an opponent's key.
      for (let count = 0; count < amount; count += 1) {
        const foe = state.players[other(me)];
        if (foe.keys <= 0) break;
        // The most recently forged color is the one that goes back.
        const colors = forgedKeyColors(state, other(me));
        foe.keys -= 1;
        foe.keyColors = colors.slice(0, foe.keys);
        record(state, "log.unforge", { name: foe.name });
      }
      break;
    case "makeToken":
      for (let count = 0; count < amount; count += 1) {
        const token = makeToken(state, me, source.face.house);
        fireObservers(state, token, "enter", deterministic);
      }
      break;
    case "stun":
      for (const card of cards.filter(isCreature)) card.stunned = true;
      break;
    case "exhaust":
      for (const card of cards) card.ready = false;
      break;
    case "ready":
      // An effect-readied creature ignores Entrench/hold but not `noReady: true`.
      // `ready` observers see each creature this act actually readied (Lote 6 §6.2).
      for (const card of cards) {
        if (card.ready || !canReady(state, card, false)) continue;
        card.ready = true;
        fireObservers(state, card, "ready", deterministic);
      }
      break;
    case "unstun":
      for (const card of cards) card.stunned = false;
      break;
    case "returnToHand": {
      const houses = new Map(cards.map((card) => [card, houseOf(state, card)] as const));
      for (const card of cards) leaveByEffect(state, card, "hand");
      if (act.s === "self" && controllerOf(state, source) === undefined) selfLeave.set(source, "hand");
      remember(context, cards.filter((card) => state.players.some((player) => player.hand.includes(card))), houses);
      break;
    }
    case "returnToDeck": {
      // `at` repositions the card after the leave-play move: the deck's top is
      // the array's end (where leavePlay already pushes), so the absent `at`
      // and the explicit "top" are the same, "bottom" is the front and
      // "shuffle" re-shuffles.
      const houses = new Map(cards.map((card) => [card, houseOf(state, card)] as const));
      const landed: CardInstance[] = [];
      for (const card of cards) {
        const owner = ownerOf(state, card) ?? me;
        leaveByEffect(state, card, "deck");
        if (state.players[owner].deck.includes(card)) landed.push(card);
        // A ward (or a token leaving the game) cancels the move: only a card
        // that really landed in the deck is repositioned.
        const deck = state.players[owner].deck;
        if (deck.lastIndexOf(card) < 0) continue;
        if (act.at === "bottom") {
          deck.splice(deck.lastIndexOf(card), 1);
          deck.unshift(card);
        } else if (act.at === "shuffle") state.players[owner].deck = shuffle(deck, state);
      }
      if (act.s === "self" && controllerOf(state, source) === undefined) selfLeave.set(source, "deck");
      remember(context, landed, houses);
      break;
    }
    case "move": {
      // One act for the player zones. `pick` chooses the cards: "top" is the
      // array's end (the deck's top), "random" draws from the PRNG and "all"
      // ignores n. Without `pick` the controller chooses — from a hidden hand
      // that means the first card outside the active house, elsewhere the top.
      const from = player[act.from];
      const candidates = act.type ? from.filter((card) => card.face.type === act.type) : [...from];
      const choose = () =>
        act.pick === "random"
          ? candidates[Math.floor(roll(state) * candidates.length)]
          : act.pick === "bottom"
            ? candidates[0]
            : act.pick === undefined && act.from === "hand"
              ? (candidates.find((card) => card.face.house !== state.activeHouse) ?? candidates[candidates.length - 1])
              : candidates[candidates.length - 1];
      const moved: CardInstance[] = [];
      if (act.until) {
        // Lote 7 §7.3: one card at a time off the top until one matches (that one is kept in the
        // pile) or the deck runs out. The deck is finite, UNTIL_LIMIT is the belt over the braces.
        const stops = (card: CardInstance) => {
          const wanted = act.until!;
          if (wanted.type && card.face.type !== wanted.type) return false;
          if (!wanted.house) return true;
          const neg = wanted.house.startsWith("!");
          const name = (neg ? wanted.house.slice(1) : wanted.house).toLowerCase();
          return (houseOf(state, card).toLowerCase() === name) !== neg;
        };
        for (let step = 0; step < UNTIL_LIMIT && player.deck.length; step += 1) {
          const card = player.deck.pop()!;
          moved.push(card);
          if (stops(card)) break;
        }
        if (moved.length) toDiscard(state, side, moved, deterministic, context.decline);
        remember(context, moved);
        break;
      }
      if (act.pick === "moved") {
        // Still sitting in `from`. The engine keeps the highest amber + icons
        // when `n` is smaller than the pile (Lote 6 §6.4); a real choice waits for targets[].
        const pool = (context.moved ?? []).filter((card) => from.includes(card));
        const fitting = pool.filter((card) => {
          if (act.type && card.face.type !== act.type) return false;
          if (!act.house) return true;
          const neg = act.house.startsWith("!");
          const name = (neg ? act.house.slice(1) : act.house).toLowerCase();
          const house = card.face.house.toLowerCase();
          return (house === name) !== neg;
        });
        fitting.sort((a, b) => iconScore(b) - iconScore(a));
        moved.push(...fitting.slice(0, Math.min(amount, fitting.length)));
      }
      // `all` takes the whole zone, so the bound is read before the picks.
      const take = act.pick === "moved" ? 0 : act.pick === "all" ? candidates.length : Math.min(amount, candidates.length);
      for (let count = 0; count < take; count += 1) {
        const card = choose();
        if (!card) break;
        moved.push(card);
        candidates.splice(candidates.indexOf(card), 1);
      }
      if (!moved.length) {
        remember(context, []);
        break;
      }
      player[act.from] = from.filter((card) => !moved.includes(card));
      if (act.to === "discard") toDiscard(state, side, moved, deterministic, context.decline, undefined, act.from === "hand");
      else {
        const destination = player[act.to];
        if (act.at === "bottom") destination.unshift(...moved);
        else destination.push(...moved);
        if (act.at === "shuffle") player[act.to] = shuffle(destination, state);
      }
      remember(context, moved);
      break;
    }
    case "archive": {
      const houses = new Map(cards.map((card) => [card, houseOf(state, card)] as const));
      for (const card of cards) leaveByEffect(state, card, "archives");
      if (act.s === "self" && controllerOf(state, source) === undefined) selfLeave.set(source, "archives");
      remember(
        context,
        cards.filter((card) => state.players.some((player) => player.archives.includes(card))),
        houses,
      );
      break;
    }
    case "use":
      for (const card of cards) {
        if (!card.ready || card.stunned) continue;
        const side = controllerOf(state, card) as Side;
        // Using a creature is reap, fight or its Action, the player's choice;
        // until the UI prompts for it the engine resolves the printed Action
        // when there is one, reap otherwise (BUG-11). An explicit `via` of the
        // act wins ("Ready and fight/reap with X").
        const via = act.via ?? context.useVia ?? (hasAbility(state, card, "action") ? "action" : "reap");
        if (via === "fight") {
          // The fight auto-targets like every engine-picked choice; with no
          // legal defender the creature simply stays ready ("if able").
          const target = autoPick(state, side, fightTargets(state, side, card), true);
          if (target) {
            context.fought = target;
            fight(state, side, card, target, {}, deterministic, context.decline);
          }
        } else if (via === "action") fire(state, side, card, "action", { choice: {}, deterministic, decline: context.decline });
        else reap(state, side, card, {}, deterministic, context.decline);
      }
      break;
    case "fromDiscard": {
      const card = [...player.discard].reverse().find((item) => !act.type || item.face.type === act.type);
      if (card) player.discard = player.discard.filter((item) => item !== card);
      if (card) {
        player.hand.push(card);
        remember(context, [card]);
      }
      break;
    }
    case "archiveTop": {
      const card = player.deck.pop();
      if (card) {
        player.archives.push(card);
        remember(context, [card]);
      }
      break;
    }
    case "lasting": {
      // Lote 8 §8.1: the redirect lives only as long as the fight, so it is the transient fightRedirect,
      // not a stored effect. Needs both the fought creature and a living chosen one.
      if (act.e.replace?.redirect === "chosen") {
        if (context.fought && context.target && controllerOf(state, context.target) !== undefined) fightRedirect = { from: context.fought, to: context.target };
        break;
      }
      // A triggered effect with a duration: stored as plain data (like keyteki's
      // lasting effects) and pruned when the stamp it expires on is reached.
      const until = turnStamp(state) + (act.e.duration === "next" ? 2 : 1);
      // A "chosen" house is only known now: freeze it into the stored copy.
      const stored = structuredClone(act.e);
      if (stored.target.house !== undefined && positive(stored.target.house) === "chosen") {
        if (!chosenHouse) break;
        stored.target.house = (negated(stored.target.house) ? "!" : "") + chosenHouse;
      }
      // "cards of the purged card's type": freeze the literal when the lasting is stored.
      if (stored.restrict?.type === "moved") {
        const type = context.moved?.[0]?.face.type;
        if (!type) break;
        stored.restrict = { ...stored.restrict, type };
      }
      state.lasting = [...(state.lasting ?? []), { ...stored, side: me, until }];
      break;
    }
  }
  sweep(state, deterministic);
  // "did"/"gone" describe what THIS act did: they are read after the sweep, so
  // a creature destroyed by the damage just dealt already counts as gone.
  Object.assign(context, measured(state, before));
  if (explicitDid !== undefined) context.did = explicitDid;
}

/** Resolves every ability of `source` bound to `trigger` (keyteki TriggeredAbility).
    The `if` of every ability of the trigger is read BEFORE the first act runs:
    "If you are overwhelmed, steal 2. Otherwise, steal 1." must pick its branch
    from the state as it was, not from what the first branch just changed.
    Observer abilities (`of`) are not the source's own reaction: they run once
    after the event, for every card in play watching it (fireObservers). */
/** `forge` / the house choice: each card in play of both sides, the causer as `actor`. */
function wakePlayer(state: GameState, actor: Side, trigger: Trigger, deterministic: boolean): void {
  for (const side of [actor, other(actor)] as const) {
    for (const card of [...state.players[side].board]) {
      if (controllerOf(state, card) !== side) continue;
      if (abilitiesOf(state, card).some((ability) => !ability.of && ability.on.includes(trigger))) {
        fire(state, side, card, trigger, { deterministic, actor });
      }
    }
  }
}

function stamp(state: GameState, context: Context, fought?: CardInstance): void {
  if (context.target) {
    context.targetHouse = houseOf(state, context.target);
    context.wasNeighbors = neighbors(state, context.target).slice();
  }
  if (fought) context.foughtHouse = houseOf(state, fought);
}

function fire(
  state: GameState,
  me: Side,
  source: CardInstance,
  trigger: Trigger,
  options: { fought?: CardInstance; choice?: Choice; deterministic: boolean; via?: "reap" | "action"; decline?: boolean; actor?: Side },
): void {
  // A self-re-triggering chain ("Reap: ready and use ~ via reap") has no
  // observer at all: the per-move fire budget stops it (GAP 3 review).
  if (fireBudget <= 0) return;
  fireBudget -= 1;
  // Only the chooser card's own abilities see the house its move chose; a
  // nested dispatch (a Destroyed: of another card) has no choice of its own.
  withChosen(pendingChoice?.card === source ? pendingChoice.house : undefined, () => fireOwn(state, me, source, trigger, options));
  fireObservers(state, source, trigger, options.deterministic);
}

function fireOwn(
  state: GameState,
  me: Side,
  source: CardInstance,
  trigger: Trigger,
  options: { fought?: CardInstance; choice?: Choice; deterministic: boolean; via?: "reap" | "action"; decline?: boolean; actor?: Side },
): void {
  const firing: Ability[] = [];
  for (const ability of abilitiesOf(state, source)) {
    if (ability.of || !ability.on.includes(trigger) || (options.decline && ability.optional)) continue;
    firing.push(ability);
  }
  const prior: Prior = { actor: options.actor, fought: options.fought, foughtHouse: options.fought ? houseOf(state, options.fought) : undefined };
  const live = firing.map((ability) => !ability.if || holds(ability.if, state, me, source, prior));
  for (const [index, ability] of firing.entries()) {
    if (!live[index]) continue;
    const context: Context = { state, me, source, fought: options.fought, foughtHouse: prior.foughtHouse, actor: options.actor, deterministic: options.deterministic, useVia: options.via, decline: options.decline, mode: options.choice?.mode ?? defaultMode(ability) };
    if (ability.target) {
      const legal = everyMatch(state, me, source, ability.target);
      const chosen = legal.find((card) => card.instanceId === options.choice?.id);
      if (options.choice) options.choice.id = undefined;
      context.target = chosen ?? autoPick(state, me, legal, isHarmful(ability), givesControl(ability));
      if (!context.target) continue;
    }
    // Lote 7 §7.1: the second target and the rest of the queue belong to the first ability that reads them.
    context.flank = options.choice?.flank;
    if (ability.target2 || citesQueue(ability)) {
      const queue = options.choice?.targets ?? [];
      if (options.choice) options.choice.targets = undefined;
      let rest = queue;
      if (ability.target2) {
        const legal = everyMatch(state, me, source, ability.target2, context).filter((card) => card !== context.target);
        const chosen = legal.find((card) => card.instanceId === queue[0]);
        context.target2 = chosen ?? autoPick(state, me, legal, isHarmful(ability), givesControl(ability));
        if (!context.target2) continue;
        rest = chosen ? queue.slice(1) : queue;
      }
      context.queue = rest;
    }
    // `who` (Lote 4 §4.6) captures the reference card's owner/controller BEFORE
    // the acts run: "Destroy a creature. Its controller gains 1" would read a
    // card already out of play otherwise.
    const reference = context.target ?? context.event ?? context.fought;
    if (reference) {
      context.whoController = controllerOf(state, reference);
      context.whoOwner = ownerOf(state, reference);
    }
    stamp(state, context, options.fought);
    for (const act of ability.acts) run(context, act);
  }
}

/** Does an ability ask the player to choose an option ("Choose one:" or a `side:"any"` move, Lote 8)? */
const modeCache = new WeakMap<Ability, boolean>();
function citesMode(ability: Ability): boolean {
  let cites = modeCache.get(ability);
  if (cites === undefined) {
    const text = JSON.stringify(ability.acts);
    cites = text.includes('"mode":') || text.includes('"side":"any"');
    modeCache.set(ability, cites);
  }
  return cites;
}

/** The option a move that did not choose one resolves: a `side:"any"` move reads the opponent's zone (the
    engine's guess for the player's side of the table), a "Choose one:" its first option. */
const defaultMode = (ability: Ability): "a" | "b" => (JSON.stringify(ability.acts).includes('"side":"any"') ? "b" : "a");

/** Does an ability select with an "up to N" pick (it reads the move's `targets` queue)? */
const queueCache = new WeakMap<Ability, boolean>();
function citesQueue(ability: Ability): boolean {
  let cites = queueCache.get(ability);
  if (cites === undefined) {
    cites = JSON.stringify(ability.acts).includes('"upTo"');
    queueCache.set(ability, cites);
  }
  return cites;
}

/** Ability budgets for one move (Lote 3 §3.2 review). OBSERVER_DEPTH bounds how
    deep observer passes nest (restored by fireObservers' own `finally`);
    OBSERVER_BUDGET bounds the TOTAL observer dispatches of a move (N
    self-feeding watchers would otherwise cost N^depth, not depth) and
    FIRE_BUDGET bounds plain fire() dispatches (a "Reap: ready and use ~ via
    reap" chain has no observer at all). The counters are transient module
    values — moves resolve synchronously, so no two matches interleave — and
    resetAbilityBudgets() refills them at every applyMove/endTurn; a spent budget
    silently stops dispatching until the move ends. */
const OBSERVER_DEPTH = 8;
/** Iterations a `move.until` loop may run in one act (Lote 7 §7.3). */
const UNTIL_LIMIT = 200;
const OBSERVER_BUDGET = 100;
const FIRE_BUDGET = 64;
let observerDepth = 0;
let observerBudget = OBSERVER_BUDGET;
let fireBudget = FIRE_BUDGET;

/** Fresh budgets for the move about to resolve. */
function resetAbilityBudgets(): void {
  observerDepth = 0;
  observerBudget = OBSERVER_BUDGET;
  fireBudget = FIRE_BUDGET;
}

/** Observer abilities (docs/DSL_EXPANSION_PLAN.md §3.2): cards that watch an
    event another card caused ("After an enemy creature reaps, stun it."). Every
    card in play on BOTH sides is scanned — only its own (printed/stored)
    abilities, never a granted copy — and the ones bound to this trigger whose
    `of` matches the event card fire with `me` = the watcher's side and the event
    card as `s:"event"`. Targets are auto-picked: the player only chooses the
    targets of their own move, and a watcher is never a "You may" decision. */
function fireObservers(state: GameState, event: CardInstance, trigger: Trigger, deterministic: boolean, actor?: Side): void {
  if (observerDepth >= OBSERVER_DEPTH || observerBudget <= 0) return;
  observerDepth += 1;
  // A watcher resolves with no house of its own choosing.
  const savedChoice = chosenHouse;
  chosenHouse = undefined;
  try {
    for (const side of [0, 1] as const) {
      for (const watcher of state.players[side].board) {
        for (const ability of rulesOf(watcher.face).abilities) {
          // The board loop iterates the pre-pass snapshot: a watcher an earlier
          // dispatch of this same pass destroyed (or took control of) is out.
          if (controllerOf(state, watcher) !== side) break;
          // A discarded card is no longer in play, so it cannot observe its own discard
          // (self-observation stays legitimate for reap/fight/ready).
          if (trigger === "discard" && watcher === event) continue;
          if (!ability.of || !ability.on.includes(trigger) || !matches(state, side, watcher, event, ability.of)) continue;
          if (ability.if && !holds(ability.if, state, side, watcher, { actor })) continue;
          const context: Context = { state, me: side, source: watcher, event, deterministic, actor, mode: defaultMode(ability) };
          if (ability.target) {
            context.target = autoPick(state, side, everyMatch(state, side, watcher, ability.target), isHarmful(ability), givesControl(ability));
            if (!context.target) continue;
          }
          // Same pre-act capture as fire(): the event card may leave play.
          const reference = context.target ?? context.event;
          if (reference) {
            context.whoController = controllerOf(state, reference);
            context.whoOwner = ownerOf(state, reference);
          }
          stamp(state, context);
          if (observerBudget <= 0) return;
          observerBudget -= 1;
          for (const act of ability.acts) run(context, act);
        }
      }
    }
  } finally {
    observerDepth -= 1;
    chosenHouse = savedChoice;
  }
}

function reap(state: GameState, me: Side, creature: CardInstance, choice: Choice, deterministic: boolean, decline?: boolean): void {
  creature.ready = false;
  state.players[me].amber += 1;
  tally(state.players[me], "amberGained");
  fire(state, me, creature, "reap", { choice, deterministic, decline });
}

/** keyteki ResolveFightAction: before-fight abilities, Assault/Hazardous, Elusive,
    Skirmish, Poison and Splash-attack, then "Fight:" if the attacker survived. */
function fight(state: GameState, me: Side, attacker: CardInstance, defender: CardInstance, choice: Choice, deterministic: boolean, decline?: boolean): void {
  const savedFight = fightPair;
  const savedRedirect = fightRedirect;
  fightPair = { attacker, defender };
  fightRedirect = null;
  try {
  fightBody(state, me, attacker, defender, choice, deterministic, decline);
  } finally {
    fightPair = savedFight;
    fightRedirect = savedRedirect;
  }
}

function fightBody(state: GameState, me: Side, attacker: CardInstance, defender: CardInstance, choice: Choice, deterministic: boolean, decline?: boolean): void {
  attacker.ready = false;
  // keyteki ResolveFightAction: the enrage token is removed when the creature
  // fights (its onUseCard child event calls card.unenrage()).
  attacker.enraged = 0;
  fire(state, me, attacker, "beforeFight", { fought: defender, choice, deterministic, decline });
  const alive = () => controllerOf(state, attacker) === me && controllerOf(state, defender) === other(me);
  // FEAT-06: a creature that ended in the discard pile during the exchange is a
  // kill for the other side (assault/hazardous/poison and "Fight:" included).
  // A token killed in the fight leaves the game instead of reaching a discard
  // pile, so "left play" is its mark (Onda 3).
  // A dead card lands in its OWNER's discard, which differs from the
  // controller's when control was taken (MX-06): capture the owners up front.
  const attackerOwner = ownerOf(state, attacker) ?? me;
  const defenderOwner = ownerOf(state, defender) ?? other(me);
  const credit = () => {
    const gone = (card: CardInstance) => card.isToken && controllerOf(state, card) === undefined;
    if (state.players[attackerOwner].discard.includes(attacker) || gone(attacker)) tally(state.players[other(me)], "creaturesDestroyed");
    if (state.players[defenderOwner].discard.includes(defender) || gone(defender)) tally(state.players[me], "creaturesDestroyed");
  };
  if (!alive()) return credit();
  dealDamage(state, defender, keyword(state, attacker, "assault"));
  dealDamage(state, attacker, keyword(state, defender, "hazardous"));
  sweep(state, deterministic);
  if (!alive()) return credit();

  const elusive = keyword(state, defender, "elusive") > 0 && !defender.elusiveUsed;
  defender.elusiveUsed = true;
  if (!elusive) {
    if (!keyword(state, attacker, "skirmish")) dealDamage(state, attacker, effectivePower(state, defender), keyword(state, defender, "poison") > 0);
    dealDamage(state, defender, effectivePower(state, attacker), keyword(state, attacker, "poison") > 0);
  }
  const splash = keyword(state, attacker, "splash-attack");
  if (splash) for (const neighbor of neighbors(state, defender)) dealDamage(state, neighbor, splash);
  sweep(state, deterministic);
  if (controllerOf(state, attacker) === me) fire(state, me, attacker, "fight", { fought: defender, choice, deterministic, decline });
  credit();
}

// ---------- legality ----------

/** May `card` be played/used with `house` active? Versatile (printed or granted)
    lifts the house restriction (docs/DSL_EXPANSION_PLAN.md §3.5). */
const houseAllows = (state: GameState, card: CardInstance, house: string | null) => {
  if (!house) return true;
  const own = houseOf(state, card);
  return own === house || own === "all" || keyword(state, card, "versatile") > 0;
};
const hasPrinted = (card: CardInstance, prefix: "Action" | "Omni") => new RegExp(`(^|[\\s/.])${prefix}:`, "i").test(card.face.text);

/** Does the card have an Action (or Omni) ability right now — printed or granted?
    Observer abilities (`of`) watch other cards: they are never the card's own
    Action/Omni, so they must not make it usable (a phantom "use" move). */
const hasAbility = (state: GameState, card: CardInstance, trigger: "action" | "omni") =>
  hasPrinted(card, trigger === "action" ? "Action" : "Omni") ||
  abilitiesOf(state, card).some((ability) => !ability.of && ability.on.includes(trigger));

function mayAct(state: GameState, side: Side): boolean {
  return !mulliganPending(state) && state.winner === null && !(side === state.activePlayer && state.omega);
}

/** First turn (keyteki setupphase firstPlayerEffects): the first player may play or discard only one card. */
function mayPlay(state: GameState, side: Side): boolean {
  return !(side === state.activePlayer && state.turn === 1 && side === 0 && state.played >= 1);
}

function canPlay(state: GameState, side: Side, card: CardInstance): boolean {
  if (restricted(state, side, "play", card)) return false;
  if (keyword(state, card, "alpha") && side === state.activePlayer && state.acted > 0) return false;
  if (card.face.type === "Upgrade") return state.players.some((player) => battleline(player).length > 0);
  // Gigantic creatures are one creature printed on two cards: both halves must
  // be in hand and they leave the hand together (BUG-23). The reminder text is
  // in parentheses, which normalise() strips — read the raw text.
  if (isGigantic(card) && !state.players[side].hand.some((item) => item !== card && item.face.title === card.face.title)) {
    return false;
  }
  return true;
}

const isGigantic = (card: CardInstance) => /play only with the other half of/i.test(card.face.text ?? "");

/** Enemy creatures `attacker` may fight: taunt protects its neighbors (keyteki Card.js),
    and "cannot fight" effects close the whole step. */
export function fightTargets(state: GameState, side: Side, attacker: CardInstance): CardInstance[] {
  if (!isCreature(attacker) || !attacker.ready || attacker.stunned) return [];
  if (restricted(state, side, "fight", attacker)) return [];
  return battleline(state.players[other(side)]).filter(
    (target) => keyword(state, target, "taunt") > 0 || !neighbors(state, target).some((neighbor) => keyword(state, neighbor, "taunt") > 0),
  );
}

function canUseCard(state: GameState, side: Side, card: CardInstance, house: string | null): boolean {
  if (restricted(state, side, "use", card)) return false;
  if (state.players[side].amber < useTolls(state, side, card).reduce((sum, toll) => sum + toll.cost, 0)) return false;
  return card.ready && !card.stunned && ((houseAllows(state, card, house) && hasAbility(state, card, "action")) || hasAbility(state, card, "omni"));
}

// ---------- "Choose a house" (Lote 5 §5.1) ----------

/** Does an ability read the house its move chose? `forceHouse` reads it too. */
const citesCache = new WeakMap<Ability, boolean>();
function citesChosen(ability: Ability): boolean {
  let cites = citesCache.get(ability);
  if (cites === undefined) {
    // `redirect:"chosen"` (Lote 8 §8.1) is a creature, not the chosen house.
    const text = JSON.stringify(ability).replaceAll('"redirect":"chosen"', "");
    cites = text.includes('"chosen"') || text.includes('"!chosen"') || text.includes('"forceHouse"');
    citesCache.set(ability, cites);
  }
  return cites;
}

/** The abilities of the move's source that the move resolves and that read the
    chosen house (a declined move waives its optional ones). */
function choosingAbilities(state: GameState, side: Side, move: GameMove): Ability[] {
  if (move.type === "unstun" || move.type === "takeArchives") return [];
  const source = moveSource(state, side, move);
  if (!source) return [];
  const triggers = triggersFor(move);
  const declined = declines(move);
  return abilitiesOf(state, source).filter(
    (ability) => !ability.of && ability.on.some((trigger) => triggers.includes(trigger)) && !(declined && ability.optional) && citesChosen(ability),
  );
}

/** Houses present on either board, in first-seen order ("all" is not a house). */
export function housesInPlay(state: GameState): string[] {
  const houses: string[] = [];
  for (const card of state.players.flatMap((player) => player.board)) {
    const house = houseOf(state, card);
    if (house && house !== "all" && !houses.includes(house)) houses.push(house);
  }
  return houses;
}

/** The houses the player must pick from before this move can resolve: empty when
    the card's text asks for no house, or the move already carries one. The UI
    shows them with the house picker. */
export function houseChoices(state: GameState, side: Side, move: GameMove): string[] {
  if ("house" in move && move.house !== undefined) return [];
  const choosing = choosingAbilities(state, side, move);
  return choosing.length ? housesOffered(state, side, choosing) : [];
}

/** The houses a chooser may name: those in play, or — for a text that forces the
    opponent's next house ("on your opponent's identity card") — the houses of the
    opponent's deck, the only ones the obligation can bite. */
function housesOffered(state: GameState, side: Side, abilities: Ability[]): string[] {
  return abilities.some((ability) => JSON.stringify(ability).includes('"forceHouse"')) ? [...state.players[other(side)].houses] : housesInPlay(state);
}

/** Engine/AI fallback when a chooser move arrives with no (valid) house: the
    most numerous house among the opponent's cards for a harmful text, among the
    side's own otherwise. */
function defaultHouse(state: GameState, side: Side, abilities: Ability[]): string | undefined {
  const offered = housesOffered(state, side, abilities);
  if (offered !== housesInPlay(state) && abilities.some((ability) => JSON.stringify(ability).includes('"forceHouse"'))) return offered[0];
  const harmful = abilities.some(isHarmful);
  const pool = state.players[harmful ? other(side) : side].board;
  const counts = new Map<string, number>();
  for (const card of pool) counts.set(houseOf(state, card), (counts.get(houseOf(state, card)) ?? 0) + 1);
  counts.delete("all");
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return best ?? housesInPlay(state)[0];
}

function triggersFor(move: GameMove): Trigger[] {
  if (move.type === "play") return ["play"];
  if (move.type === "reap") return ["reap"];
  if (move.type === "fight") return ["beforeFight", "fight"];
  if (move.type === "discard") return ["scrap"];
  return move.type === "use" ? ["action", "omni"] : [];
}

function moveSource(state: GameState, side: Side, move: GameMove): CardInstance | undefined {
  if (move.type === "takeArchives") return undefined;
  const player = state.players[side];
  const id = move.type === "fight" ? move.attackerId : move.instanceId;
  return (move.type === "play" || move.type === "discard" ? player.hand : player.board).find((card) => card.instanceId === id);
}

/** Cards the player may choose for this move's targeted ability (or an upgrade's
    host). Empty when nothing needs choosing. The creature being played counts
    as already in play, as in keyteki. */
export function targetChoices(state: GameState, side: Side, move: GameMove): string[] {
  const source = moveSource(state, side, move);
  if (!source) return [];
  if (move.type === "play" && source.face.type === "Upgrade") {
    return state.players.flatMap((player) => battleline(player)).map((item) => item.instanceId);
  }
  // Read-only view with the creature already on its flank (no deep clone needed).
  let view = state;
  if (move.type === "play" && isCreature(source)) {
    const players = [...state.players] as [GamePlayer, GamePlayer];
    players[side] = { ...players[side], board: [...players[side].board, source] };
    view = { ...view, players };
  }
  // The bonus amber is granted before "Play:" fires (applyMove), so a target
  // condition like "If you have 3A or more" must count it (BUG-09).
  if (move.type === "play" && printedAmber(source.face) > 0) {
    const players = [...view.players] as [GamePlayer, GamePlayer];
    players[side] = { ...players[side], amber: players[side].amber + printedAmber(source.face) };
    view = { ...view, players };
  }
  const card = source;
  const triggers = triggersFor(move);
  const ability = abilitiesOf(view, card).find(
    (item) =>
      // An observer's target is auto-picked when its event happens, never by
      // the player making this move.
      !item.of &&
      item.target &&
      item.on.some((trigger) => triggers.includes(trigger)) &&
      (!item.if || holds(item.if, view, side, card)) &&
      // A declined "You may" is waived: no target prompt for it.
      !(declines(move) && item.optional),
  );
  // A target filtered by the chosen house reads the move's own choice.
  const house = "house" in move ? move.house : undefined;
  return ability?.target ? withChosen(house, () => everyMatch(view, side, card, ability.target!).map((item) => item.instanceId)) : [];
}

// ---------- the choices after `target` (Lote 7 §7.1) ----------

/** The abilities this move will resolve, read against a view with the played creature
    already in play (same view as targetChoices). Observers never get a prompt. */
function resolvingAbilities(state: GameState, side: Side, move: GameMove): { view: GameState; card: CardInstance; abilities: Ability[] } | null {
  const card = moveSource(state, side, move);
  if (!card || move.type === "takeArchives" || move.type === "unstun") return null;
  let view = state;
  if (move.type === "play" && isCreature(card)) {
    const players = [...state.players] as [GamePlayer, GamePlayer];
    players[side] = { ...players[side], board: [...players[side].board, card] };
    view = { ...view, players };
  }
  const triggers = triggersFor(move);
  const abilities = abilitiesOf(view, card).filter(
    (item) => !item.of && item.on.some((trigger) => triggers.includes(trigger)) && (!item.if || holds(item.if, view, side, card)) && !(declines(move) && item.optional),
  );
  return abilities.length ? { view, card, abilities } : null;
}

/** The first "up to N" selection of an ability, with the verb that decides which side it aims at. */
function upToSpec(ability: Ability): { pick: Filter; n: number; k: Act["k"] } | undefined {
  for (const act of ability.acts) {
    const selection = "s" in act ? act.s : undefined;
    if (selection && typeof selection === "object" && "pick" in selection && selection.upTo) return { pick: selection.pick, n: selection.n ?? 99, k: act.k };
  }
  return undefined;
}

/** What the move still has to ask the player after the house and the first target. */
export interface MovePrompt {
  /** `target2`: one more card (the move's `targets[0]`); `targets`: 0..max cards; `flank`: left or right;
      `mode` (Lote 8): "a" or "b" — `choice` says whether they are two zones ("side") or two printed options ("option"). */
  kind: "target2" | "targets" | "flank" | "mode";
  ids: string[];
  max?: number;
  choice?: "side" | "option";
}

/** The next unanswered question of a move, or null when the move is complete. The UI feeds the
    answer back into `move.targets` / `move.flank` and asks again; an unanswered question
    never blocks the engine, it just resolves as "no choice made" (see select/fireOwn). */
export function pendingPrompt(state: GameState, side: Side, move: GameMove): MovePrompt | null {
  const live = resolvingAbilities(state, side, move);
  if (!live) return null;
  const { view, card, abilities } = live;
  const house = "house" in move ? move.house : undefined;
  const first = "target" in move ? move.target : undefined;
  return withChosen(house, () => {
    for (const ability of abilities) {
      if (ability.target2 && !move.targets?.length) {
        const excluded = first ?? (ability.target ? everyMatch(view, side, card, ability.target)[0]?.instanceId : undefined);
        const ids = everyMatch(view, side, card, ability.target2).map((item) => item.instanceId).filter((id) => id !== excluded);
        if (ids.length > 1) return { kind: "target2" as const, ids };
      }
      const spec = upToSpec(ability);
      if (spec && !ability.target2 && move.targets === undefined) {
        const ids = everyMatch(view, side, card, spec.pick).map((item) => item.instanceId);
        if (ids.length) return { kind: "targets" as const, ids, max: Math.min(spec.n, ids.length) };
      }
      if (move.flank === undefined && ability.acts.some((act) => act.k === "toFlank")) return { kind: "flank" as const, ids: [] };
      if (move.mode === undefined && citesMode(ability)) return { kind: "mode" as const, ids: [], choice: defaultMode(ability) === "b" ? ("side" as const) : ("option" as const) };
    }
    return null;
  });
}

/** The AI's variants of an "up to N" move: none (the engine's zero-card default) and the
    heuristic subset — enemies for a harmful verb, friends for a helpful one, strongest first.
    A harmful pick that can only reach the AI's own side ("destroy any number of friendly
    creatures") has no approved subset, so the only variant is "none": the act is skipped. */
function queueVariants(state: GameState, side: Side, move: GameMove): GameMove[] {
  // The AI's hot path: most moves cite no queue, answer before building a view.
  const origin = moveSource(state, side, move);
  if (!origin || !abilitiesOf(state, origin).some(citesQueue)) return [move];
  const live = resolvingAbilities(state, side, move);
  if (!live) return [move];
  for (const ability of live.abilities) {
    const spec = upToSpec(ability);
    if (!spec) continue;
    const harmful = HARMFUL.has(spec.k);
    const ids = everyMatch(live.view, side, live.card, spec.pick)
      .filter((item) => (controllerOf(live.view, item) === side) !== harmful)
      .sort((a, b) => effectivePower(live.view, b) - effectivePower(live.view, a))
      .slice(0, spec.n)
      .map((item) => item.instanceId);
    if (ids.length) return [move, { ...move, targets: ids } as GameMove];
  }
  return [move];
}

/** The AI's variants of a "Choose one:" / `side:"any"` move: one per option, so the search picks (Lote 8). */
function modeVariants(state: GameState, side: Side, move: GameMove): GameMove[] {
  if (move.mode !== undefined) return [move];
  const origin = moveSource(state, side, move);
  if (!origin || !abilitiesOf(state, origin).some(citesMode)) return [move];
  const live = resolvingAbilities(state, side, move);
  if (!live?.abilities.some(citesMode)) return [move];
  return [{ ...move, mode: "a" } as GameMove, { ...move, mode: "b" } as GameMove];
}

/** Every legal move before target expansion: the single legality specification
    used by getLegalMoves (UI/AI) and by applyMove's guard. */
function baseMoves(state: GameState, side: Side, house: string | null): GameMove[] {
  if (!mayAct(state, side)) return [];
  // The house is chosen before any main-phase action (keyteki ChooseHouse is
  // mandatory): with no active house nothing is legal, discards included (BUG-02).
  if (side === state.activePlayer && state.activeHouse === null) return [];
  const player = state.players[side];
  const moves: GameMove[] = [];

  // The house choice happens first; picking up the archives is offered from
  // then on (the rule is "may" — see chooseHouse).
  if (side === state.activePlayer && state.activeHouse !== null && player.archives.length) moves.push({ type: "takeArchives" });

  if (mayPlay(state, side)) {
    const limit = playLimit(state, side);
    for (const card of player.hand) {
      if (!houseAllows(state, card, house)) continue;
      if (state.plays < limit && canPlay(state, side, card)) {
        moves.push({ type: "play", instanceId: card.instanceId });
        // "You may" clauses get a declined variant of the same move.
        if (hasOptionalTrigger(state, side, card, ["play"])) moves.push({ type: "play", instanceId: card.instanceId, decline: true });
      }
      moves.push({ type: "discard", instanceId: card.instanceId });
      // "You may" Scrap: clauses get a declined variant of the discard move too.
      if (hasOptionalTrigger(state, side, card, ["scrap"])) moves.push({ type: "discard", instanceId: card.instanceId, decline: true });
    }
  }

  for (const card of player.board) {
    // Lote 8 §8.8: "may fight" opens the fight (and the stun removal that stands for it) outside the house, never the reap.
    const inHouse = isCreature(card) && houseAllows(state, card, house);
    const fightOnly = isCreature(card) && !inHouse && card.ready && mayFightOutOfHouse(state, card);
    if (isCreature(card) && (inHouse || fightOnly) && card.ready) {
      if (card.stunned) {
        moves.push({ type: "unstun", instanceId: card.instanceId });
        continue;
      }
      const targets = fightTargets(state, side, card);
      // Enrage (Onda 4, keyteki effects.mustFightIfAble): a creature that can
      // fight may only fight — its reap and Action/Omni uses are closed. With
      // no legal target it is used normally ("if able").
      const forced = card.enraged && targets.length > 0;
      if (!forced && !fightOnly) {
        moves.push({ type: "reap", instanceId: card.instanceId });
        if (hasOptionalTrigger(state, side, card, ["reap"])) moves.push({ type: "reap", instanceId: card.instanceId, decline: true });
      }
      const optionalFight = hasOptionalTrigger(state, side, card, ["beforeFight", "fight"]);
      for (const target of targets) {
        moves.push({ type: "fight", attackerId: card.instanceId, targetId: target.instanceId });
        if (optionalFight) moves.push({ type: "fight", attackerId: card.instanceId, targetId: target.instanceId, decline: true });
      }
      if (forced) continue;
    }
    if (card.face.type !== "Upgrade" && canUseCard(state, side, card, house)) {
      moves.push({ type: "use", instanceId: card.instanceId });
      if (hasOptionalTrigger(state, side, card, ["action", "omni"])) moves.push({ type: "use", instanceId: card.instanceId, decline: true });
    }
  }
  return moves;
}

/** Does one of the card's triggered abilities carry a "You may" clause for this
    move? Only then the move gets a declined variant, so a plain card keeps a
    single legal move and the UI/AI only see the choice where the text has one. */
function hasOptionalTrigger(state: GameState, side: Side, source: CardInstance, triggers: Trigger[]): boolean {
  return abilitiesOf(state, source).some(
    (ability) =>
      // Observers are not the source's own reaction: no declined variant.
      !ability.of &&
      ability.on.some((trigger) => triggers.includes(trigger)) &&
      ability.acts.some((act) => act.optional) &&
      (!ability.if || holds(ability.if, state, side, source)),
  );
}

/** Legal moves, one per choosable target so the AI can search the choice.
    Fight moves expand too: the ability target of Fight:/Before Fight: is the
    controller's choice (BUG-06), separate from the defender. */
export function getLegalMoves(state: GameState, playerIndex: Side, house: string | null = null): GameMove[] {
  return baseMoves(state, playerIndex, house).flatMap((base) => {
    // One variant per house in play, only for texts that read "chosen" (§5.1).
    const houses = houseChoices(state, playerIndex, base);
    const variants = houses.length ? houses.map((choice) => ({ ...base, house: choice }) as GameMove) : [base];
    return variants.flatMap((move) => {
      const choices = targetChoices(state, playerIndex, move);
      return (choices.length > 1 ? choices.map((target) => ({ ...move, target }) as GameMove) : [move]).flatMap((expanded) => queueVariants(state, playerIndex, expanded)).flatMap((expanded) => modeVariants(state, playerIndex, expanded));
    });
  });
}

/** Does the move's triggered text have any effect now? Used by the AI to prune
    moves (the Specification pattern: the same conditions the engine checks).
    A declined move waives its "You may" abilities entirely, so a vacuous one
    prunes instead of sending the AI into a no-op. */
export function moveHasEffect(state: GameState, side: Side, move: GameMove): boolean {
  if (move.type === "reap" || move.type === "fight" || move.type === "unstun" || move.type === "takeArchives") return true;
  const source = moveSource(state, side, move);
  if (!source) return false;
  // A discard only "has an effect" when the card prints a Scrap: trigger that
  // can resolve now (the card itself always reaches the pile). An observer's
  // `of` clause is never this card's own reaction (the card is not in play).
  if (move.type === "discard") {
    return abilitiesOf(state, source).some((ability) => !ability.of && ability.on.includes("scrap") && canResolve(state, side, source, ability));
  }
  const icons = source.face.bonusIcons;
  // A card that enters play, carries printed amber or resolves extra bonus
  // icons always does something when played (Onda 4).
  if (move.type === "play" && (source.face.type !== "Action" || printedAmber(source.face) > 0 || icons?.capture || icons?.damage || icons?.draw)) return true;
  const triggers = triggersFor(move);
  const declined = declines(move);
  const house = "house" in move ? move.house : undefined;
  return withChosen(house, () =>
    abilitiesOf(state, source).some(
      (ability) =>
        // An observer is not the source's own reap/fight/action/omni value.
        !ability.of &&
        ability.on.some((trigger) => triggers.includes(trigger)) &&
        (!declined || !ability.optional) &&
        canResolve(state, side, source, ability),
    ),
  );
}

/** Identity of a move for legality: the chosen house is a variant, not another move. */
const moveKey = (move: GameMove) =>
  `${move.type === "fight" ? `${move.attackerId}>${move.targetId}` : move.type === "takeArchives" ? "takeArchives" : move.instanceId}${declines(move) ? "!" : ""}`;

export function isLegalMove(state: GameState, side: Side, move: GameMove): boolean {
  const house = side === state.activePlayer ? state.activeHouse : null;
  return baseMoves(state, side, house).some((item) => item.type === move.type && moveKey(item) === moveKey(move));
}

// ---------- moves ----------

export interface MoveOptions {
  silent?: boolean;
  deterministic?: boolean;
}

function placeCreature(state: GameState, player: GamePlayer, card: CardInstance, move: Extract<GameMove, { type: "play" }>): void {
  const line = battleline(player);
  let slot = move.flank === "left" ? 0 : line.length;
  if (keyword(state, card, "deploy") && move.slot !== undefined) slot = Math.max(0, Math.min(line.length, move.slot));
  const anchor = line[slot];
  player.board.splice(anchor ? player.board.indexOf(anchor) : player.board.length, 0, card);
}

export function applyMove(current: GameState, playerIndex: Side, move: GameMove, options: MoveOptions = {}): GameState {
  const state = cloneGame(current);
  resetAbilityBudgets();
  if (!isLegalMove(state, playerIndex, move)) return state;
  const player = state.players[playerIndex];
  const silent = options.silent === true;
  if (move.type === "takeArchives") {
    player.hand.push(...player.archives);
    player.archives = [];
    record(state, "log.archives", { name: player.name }, silent);
    return state;
  }
  const choice: Choice = { id: "target" in move ? move.target : undefined, targets: move.targets, flank: move.flank, mode: move.mode };
  const source = moveSource(state, playerIndex, move)!;
  // "Choose a house": a move without a valid house still resolves, with the
  // engine's default pick, so replays and old callers never stall.
  const choosing = choosingAbilities(state, playerIndex, move);
  const wanted = "house" in move ? move.house : undefined;
  const chosen = choosing.length ? (wanted && housesOffered(state, playerIndex, choosing).includes(wanted) ? wanted : defaultHouse(state, playerIndex, choosing)) : undefined;
  pendingChoice = chosen ? { card: source, house: chosen } : null;
  try {
    return resolveMove(state, playerIndex, move as Exclude<GameMove, { type: "takeArchives" }>, options, source, choice);
  } finally {
    pendingChoice = null;
  }
}

function resolveMove(state: GameState, playerIndex: Side, move: Exclude<GameMove, { type: "takeArchives" }>, options: MoveOptions, source: CardInstance, choice: Choice): GameState {
  const player = state.players[playerIndex];
  const silent = options.silent === true;
  const enemyIndex = other(playerIndex);
  const deterministic = options.deterministic === true;
  const decline = declines(move);
  const params = { name: player.name, card: source.face.title };
  if (playerIndex === state.activePlayer) state.acted += 1;

  if (move.type === "play" || move.type === "discard") {
    if (playerIndex === state.activePlayer) state.played += 1;
    if (move.type === "play" && playerIndex === state.activePlayer) state.plays += 1;
    player.hand = player.hand.filter((card) => card !== source);
  }

  if (move.type === "discard") {
    // The discard move is the other door into the pile: a Scrap: trigger fires
    // for the active player (toDiscard), and a declined move waives it.
    toDiscard(state, playerIndex, [source], deterministic, decline, choice, true);
    record(state, "log.discard", params, silent);
  } else if (move.type === "play") {
    player.amber += printedAmber(source.face);
    tally(player, "amberGained", printedAmber(source.face));
    tally(player, "cardsPlayed");
    Object.assign(source, { ready: false, stunned: false, damage: 0 });
    record(state, "log.play", params, silent);
    if (isCreature(source)) {
      placeCreature(state, player, source, move);
      // The other Gigantic half leaves the hand with its partner: both amber
      // bonuses count, the second half sits "under" and is discarded with the
      // creature (BUG-23). Fidelity note: its power/text are not merged yet.
      if (isGigantic(source)) {
        const half = player.hand.find((item) => item !== source && item.face.title === source.face.title);
        if (half) {
          player.hand = player.hand.filter((item) => item !== half);
          player.amber += printedAmber(half.face);
          tally(player, "amberGained", printedAmber(half.face));
          source.under = [half];
        }
      }
    } else if (source.face.type === "Upgrade") {
      const creatures = state.players.flatMap((side) => battleline(side));
      const host = creatures.find((card) => card.instanceId === choice.id) ?? autoPick(state, playerIndex, creatures, false);
      choice.id = undefined;
      source.attachedTo = host?.instanceId;
      player.board.push(source);
    } else if (source.face.type === "Artifact") {
      player.board.push(source);
    }
    fire(state, playerIndex, source, "play", { choice, deterministic, decline });
    if (source.face.type === "Creature" && controllerOf(state, source) === playerIndex) fireObservers(state, source, "enter", deterministic);
    // The extra bonus icons resolve after the card is played (keyteki
    // BasePlayAction: the bonus sub-event follows the Play: ability).
    if (source.face.bonusIcons) resolveBonusIcons(state, playerIndex, source.face.bonusIcons);
    if (source.face.type !== "Creature" && source.face.type !== "Artifact" && source.face.type !== "Upgrade") {
      // An Action that purged itself ("If you do, purge ~") leaves the game, not for the discard pile.
      const away = selfLeave.get(source);
      if (away) {
        selfLeave.delete(source);
        player[away === "purged" ? "purged" : away].push(source);
      } else player.discard.push(source);
    }
    if (keyword(state, source, "omega") && playerIndex === state.activePlayer) state.omega = true;
  } else if (move.type === "unstun") {
    // A stunned creature's use only removes the stun (keyteki RemoveStunAction on use).
    Object.assign(source, { ready: false, stunned: false });
    record(state, "log.unstun", params, silent);
  } else if (move.type === "reap") {
    reap(state, playerIndex, source, choice, deterministic, decline);
    record(state, "log.reap", params, silent);
  } else if (move.type === "fight") {
    const target = findOnBoard(state, enemyIndex, move.targetId)!;
    record(state, "log.fight", { ...params, target: target.face.title }, silent);
    fight(state, playerIndex, source, target, choice, deterministic, decline);
  } else {
    source.ready = false;
    for (const toll of useTolls(state, playerIndex, source)) {
      const paid = Math.min(toll.cost, player.amber);
      player.amber -= paid;
      state.players[toll.payee].amber += paid;
    }
    const house = playerIndex === state.activePlayer ? state.activeHouse : null;
    // One use is one event: the in-house Action resolves, otherwise the Omni.
    // Firing both would wake an observer watching "each time you use an
    // artifact" twice for a single use (Lote 3 §3.2); a card printing both
    // abilities resolves its Action, as in keyteki.
    if (houseAllows(state, source, house) && hasAbility(state, source, "action")) {
      fire(state, playerIndex, source, "action", { choice, deterministic, via: move.via, decline });
    } else if (hasAbility(state, source, "omni")) {
      fire(state, playerIndex, source, "omni", { choice, deterministic, via: move.via, decline });
    }
    record(state, "log.use", params, silent);
  }

  if (player.keys >= 3) state.winner = playerIndex;
  return state;
}

/** Houses `side` may pick right now: an effect's `mustChoose` narrows the choice
    to that house — unless the deck does not hold it (Lote 5 §5.1). */
export function housesFor(state: GameState, side: Side): string[] {
  const player = state.players[side];
  const forced = player.mustChoose?.toLowerCase();
  const match = forced ? player.houses.find((house) => house.toLowerCase() === forced) : undefined;
  return match ? [match] : player.houses;
}

export function chooseHouse(state: GameState, playerIndex: Side, house: string): GameState {
  const next = cloneGame(state);
  const player = next.players[playerIndex];
  if (playerIndex !== next.activePlayer || next.activeHouse !== null || mulliganPending(next) || !housesFor(next, playerIndex).includes(house)) return next;
  resetAbilityBudgets();
  next.activeHouse = house;
  delete player.mustChoose;
  // Picking the archives up is optional ("may", docs/ROADMAP_REVIEW.md §1.2):
  // the takeArchives move is offered from the house choice on instead of
  // handing the cards over for free here.
  record(next, "log.house", { name: player.name, house });
  // "After a player chooses an active house" (Lote 5 §5.2): every card in play of
  // BOTH sides with a `house` ability fires, the chooser's side first, each with
  // its own controller as `me`; fire() wakes the observers under the usual budgets.
  for (const side of [next.activePlayer, other(next.activePlayer)]) {
    for (const card of [...next.players[side].board]) {
      if (controllerOf(next, card) !== side) continue;
      if (abilitiesOf(next, card).some((ability) => !ability.of && ability.on.includes("house"))) {
        fire(next, side, card, "house", { deterministic: false, actor: playerIndex });
      }
    }
  }
  return next;
}

export function endTurn(current: GameState, playerIndex: Side): GameState {
  const state = cloneGame(current);
  if (playerIndex !== state.activePlayer || state.winner !== null || mulliganPending(state)) return state;
  // The turn cannot end before the mandatory house choice (BUG-02).
  if (state.activeHouse === null) return state;
  resetAbilityBudgets();

  const endingPlayer = state.players[playerIndex];
  // Ready step, then draw step (keyteki ReadyPhase + DrawPhase). Entrench
  // (Lote 4 §4.2): a held creature with the keyword stays exhausted.
  const readied: CardInstance[] = [];
  for (const card of endingPlayer.board) {
    if (card.ready || !canReady(state, card, true)) continue;
    card.ready = true;
    readied.push(card);
  }
  // After the whole ready step, over the creatures that actually readied (Lote 6 §6.2).
  for (const card of readied) fireObservers(state, card, "ready", false);
  refill(state, playerIndex);
  endingPlayer.keyCostMod = 0;
  for (const card of state.players.flatMap((player) => player.board)) {
    card.armorUsed = 0;
    card.elusiveUsed = false;
  }
  // "At the end of your turn:" (keyteki onTurnEnd, raised after the draw step).
  for (const card of [...endingPlayer.board]) fire(state, playerIndex, card, "endOfTurn", { deterministic: false });
  record(state, "log.endTurn", { name: endingPlayer.name });

  const nextIndex = other(playerIndex);
  const nextPlayer = state.players[nextIndex];
  Object.assign(state, { activePlayer: nextIndex, activeHouse: null, acted: 0, played: 0, plays: 0, omega: false });
  if (nextIndex === 0) state.turn += 1;
  // Lasting effects whose duration ran out with this turn stop applying.
  const stamp = turnStamp(state);
  state.lasting = (state.lasting ?? []).filter((effect) => (effect.until ?? 0) > stamp);

  // "At the start of your turn:" (keyteki onTurnStart, before the forge step):
  // amber from these effects counts toward this turn's key.
  for (const card of [...nextPlayer.board]) fire(state, nextIndex, card, "startOfTurn", { deterministic: false });

  // Key step: forging is mandatory when affordable (keyteki KeyPhase/forgeKey).
  forge(state, nextIndex);

  return state;
}

/** FEAT-12: did this transition consume hidden information — randomness
    (rngCalls), a card drawn into a hand or a look at the top of a deck? The
    undo stack must not rewind past it: the player already saw those cards and
    could re-plan with information a fresh turn would not have. Returns to hand
    and discard recovery count as hidden too (the conservative side). */
export function revealsHiddenInfo(prev: GameState, next: GameState): boolean {
  if (next.rngCalls !== prev.rngCalls) return true;
  return next.players.some((player, index) => {
    const before = prev.players[index];
    return player.hand.length > before.hand.length || player.deck.length < before.deck.length;
  });
}

/** BUG2-08: a save written before FEAT-06/08 (or FEAT-10) lacks the per-side
    tallies, the PRNG state and the mulligan micro-phase. Without the defaults
    the resumed panel reads NaN, the seed prints "undefined" and
    seededValue(undefined, NaN) freezes every shuffle to the same order. Pure:
    returns a normalized clone, the caller keeps the raw save untouched. */
export function normalizeSavedState(current: GameState): GameState {
  const state = cloneGame(current);
  if (!Number.isFinite(state.seed)) state.seed = Math.floor(Math.random() * 4294967296) >>> 0;
  if (!Number.isFinite(state.rngCalls)) state.rngCalls = 0;
  if (!Number.isFinite(state.plays)) state.plays = 0;
  if (!Array.isArray(state.lasting)) state.lasting = [];
  if (state.pendingMulligan !== 0 && state.pendingMulligan !== 1) state.pendingMulligan = null;
  for (const player of state.players) {
    player.archives ??= [];
    player.purged ??= [];
    for (const key of ["amberGained", "amberStolen", "amberCaptured", "creaturesDestroyed", "cardsPlayed"] as const) {
      if (!Number.isFinite(player[key])) player[key] = 0;
    }
  }
  return state;
}

export function refreshGameFaces(current: GameState, deck: DeckInfo): GameState {
  const state = cloneGame(current);
  const byId = new Map(deck.cards.map((face) => [face.id, face] as const));
  const player = state.players[0];
  for (const group of [player.deck, player.hand, player.discard, player.board, player.archives]) {
    for (const card of group) card.face = byId.get(card.face.id) ?? card.face;
  }
  player.deckName = deck.name;
  record(state, "log.synced", { deck: deck.name });
  return state;
}

export interface DeckSummary {
  total: number;
  unique: number;
  byType: Record<string, number>;
  byHouse: Record<string, number>;
  byRarity: Record<string, number>;
  bonusAmber: number;
  averagePower: number;
  creatureCount: number;
  maxPower: number;
  armoredCount: number;
}

export function summarizeDeck(deck: DeckInfo): DeckSummary {
  const byType: Record<string, number> = {};
  const byHouse: Record<string, number> = {};
  const byRarity: Record<string, number> = {};
  let bonusAmber = 0;
  let powerTotal = 0;
  let creatureCount = 0;
  let maxPower = 0;
  let armoredCount = 0;

  for (const card of deck.cards) {
    byType[card.type] = (byType[card.type] ?? 0) + 1;
    byHouse[card.house] = (byHouse[card.house] ?? 0) + 1;
    const rarity = card.rarity || "Unknown";
    byRarity[rarity] = (byRarity[rarity] ?? 0) + 1;
    // Amber icons are bonus icons too: an enhanced card adds them to the
    // printed amber (keyteki Card.bonusIcons, Onda 4).
    bonusAmber += printedAmber(card);
    if (card.type === "Creature") {
      creatureCount += 1;
      powerTotal += card.power;
      maxPower = Math.max(maxPower, card.power);
      if (card.armor > 0) armoredCount += 1;
    }
  }

  return {
    total: deck.cards.length,
    unique: new Set(deck.cards.map((card) => card.id)).size,
    byType,
    byHouse,
    byRarity,
    bonusAmber,
    averagePower: creatureCount ? Math.round((powerTotal / creatureCount) * 10) / 10 : 0,
    creatureCount,
    maxPower,
    armoredCount,
  };
}
const holds = conditionHolds;

/** BUG2-04: rebuilds the DeckInfo a saved match played with, straight from the
    state — a deck removed from the library (or not loaded yet) must not fall
    into the demo deck and steal its title, W/L record and rematch. */
export function deckFromState(player: GameState["players"][number], id: string): DeckInfo {
  // Tokens are not deck cards (MX-05): they would inflate the count and the summary.
  const cards = [player.deck, player.hand, player.discard, player.board, player.archives ?? [], player.purged ?? []]
    .flat()
    .filter((card) => !card.isToken)
    .flatMap((card) => [card.face, ...(card.under ?? []).map((half) => half.face)]);
  return { id, name: player.deckName, houses: player.houses, cards };
}
