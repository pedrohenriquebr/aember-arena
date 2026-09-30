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
import { rulesOf, type Ability, type Act, type Condition, type Filter, type PersistentEffect, type Restrict, type Selection, type Trigger } from "./abilities";
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
}

export interface GamePlayer {
  name: string;
  deckName: string;
  houses: string[];
  deck: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
  board: CardInstance[];
  archives: CardInstance[];
  amber: number;
  keys: number;
  chains: number;
  /** Key cost modifier active during this player's current/next turn (e.g. Lash of Broken Dreams). */
  keyCostMod: number;
  /** FEAT-10: this side already used its one mulligan. */
  mulliganed?: boolean;
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
}

/** `target` optionally names the card chosen for the triggered ability (or the
    creature an upgrade attaches to); without it the engine picks like keyteki's
    auto-target would for the controller. `slot` places a Deploy creature. */
export type GameMove =
  | { type: "play"; instanceId: string; target?: string; slot?: number; flank?: "left" | "right" }
  | { type: "reap"; instanceId: string; target?: string }
  | { type: "fight"; attackerId: string; targetId: string; target?: string }
  | { type: "use"; instanceId: string; target?: string; via?: "reap" | "action" }
  | { type: "unstun"; instanceId: string }
  | { type: "discard"; instanceId: string }
  /** Picking the archives up is optional ("may"), so it is a move of its own. */
  | { type: "takeArchives" };

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
function refill(player: GamePlayer, rng: Rng): void {
  if (player.hand.length >= HAND_SIZE) return;
  draw(player, HAND_SIZE - player.hand.length - Math.floor((player.chains + 5) / 6), rng);
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

export function cloneGame(state: GameState): GameState {
  const copyPlayer = (player: GamePlayer): GamePlayer => ({
    ...player,
    houses: [...player.houses],
    deck: player.deck.map((card) => ({ ...card })),
    hand: player.hand.map((card) => ({ ...card })),
    discard: player.discard.map((card) => ({ ...card })),
    board: player.board.map((card) => ({ ...card, under: card.under?.map((half) => ({ ...half })) })),
    archives: (player.archives ?? []).map((card) => ({ ...card })),
  });

  return {
    ...state,
    players: [copyPlayer(state.players[0]), copyPlayer(state.players[1])],
    log: [...state.log],
    lasting: state.lasting ? [...state.lasting] : [],
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

function controllerOf(state: GameState, card: CardInstance): Side | undefined {
  if (state.players[0].board.includes(card)) return 0;
  return state.players[1].board.includes(card) ? 1 : undefined;
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

/** Does this effect apply to `card` right now? (target filter + clause) */
function effectHits(state: GameState, owner: ActiveEffect, card: CardInstance): boolean {
  return matches(state, owner.side, owner.source, card, owner.effect.target) && (owner.effect.when !== "flank" || onFlank(state, card));
}

/** Power including every active modifier (keyteki card.power through effects). */
export function effectivePower(state: GameState, card: CardInstance): number {
  let power = card.face.power;
  for (const owner of allEffects(state)) if (owner.effect.power && effectHits(state, owner, card)) power += owner.effect.power;
  return Math.max(0, power);
}

/** Armor including every active modifier; as in keyteki it never drops below 0. */
export function effectiveArmor(state: GameState, card: CardInstance): number {
  let armor = card.face.armor;
  for (const owner of allEffects(state)) if (owner.effect.armor && effectHits(state, owner, card)) armor += owner.effect.armor;
  return Math.max(0, armor);
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
    if (restrict.type && (!card || card.face.type !== restrict.type)) continue;
    return true;
  }
  return false;
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

/** Key cost for `side` right now: 6 + active modifiers (keyteki player.getCurrentKeyCost). */
export function keyCost(state: GameState, side: Side): number {
  return BASE_KEY_COST + (state.players[side].keyCostMod ?? 0);
}

// ---------- specification (conditions and targets) ----------

/** Exported for the AI: the same condition evaluation the engine runs (FEAT-03). */
export function conditionHolds(condition: Condition, state: GameState, me: Side): boolean {
  if (condition.k === "not") return !holds(condition.c, state, me);
  if (condition.k === "amber") {
    const amber = state.players[condition.opp ? other(me) : me].amber;
    return condition.op === "eq" ? amber === condition.n : amber >= condition.n;
  }
  const mine = battleline(state.players[me]).length;
  const theirs = battleline(state.players[other(me)]).length;
  return condition.k === "moreCreatures" ? mine > theirs : mine < theirs;
}

function matches(state: GameState, me: Side, source: CardInstance | undefined, card: CardInstance, filter: Filter): boolean {
  const side = controllerOf(state, card);
  return (
    (!filter.type || card.face.type === filter.type) &&
    (!filter.side || (filter.side === "friendly") === (side === me)) &&
    (filter.damaged === undefined || card.damage > 0 === filter.damaged) &&
    (filter.flank === undefined || onFlank(state, card) === filter.flank) &&
    (!filter.other || card !== source) &&
    (!filter.ready || (card.ready && !card.stunned)) &&
    (!filter.self || card === source) &&
    (!filter.host || card.instanceId === source?.attachedTo) &&
    (!filter.neighborsOfSource || (source !== undefined && neighbors(state, source).includes(card)))
  );
}

function everyMatch(state: GameState, me: Side, source: CardInstance, filter: Filter): CardInstance[] {
  const found = [...state.players[me].board, ...state.players[other(me)].board].filter((card) =>
    matches(state, me, source, card, filter),
  );
  return filter.top ? found.sort((a, b) => effectivePower(state, b) - effectivePower(state, a)).slice(0, filter.top) : found;
}

const HARMFUL = new Set<Act["k"]>(["destroy", "damage", "stun", "exhaust", "returnToHand", "returnToDeck", "archive"]);
const isHarmful = (ability: Ability) => ability.acts.some((act) => HARMFUL.has(act.k));

/** Default choice for a targeted ability: harmful effects hit the strongest
    enemy (then the weakest friendly), helpful ones the strongest friendly. */
function autoPick(state: GameState, me: Side, candidates: CardInstance[], harmful: boolean): CardInstance | undefined {
  const strongest = (cards: CardInstance[]) =>
    [...cards].sort((a, b) => effectivePower(state, b) - effectivePower(state, a) || b.damage - a.damage)[0];
  const friendly = candidates.filter((card) => controllerOf(state, card) === me);
  const enemy = candidates.filter((card) => !friendly.includes(card));
  if (!harmful) return strongest(friendly) ?? strongest(enemy);
  return strongest(enemy) ?? [...friendly].sort((a, b) => effectivePower(state, a) - effectivePower(state, b))[0];
}

interface Context {
  state: GameState;
  me: Side;
  source: CardInstance;
  fought?: CardInstance;
  target?: CardInstance;
  deterministic: boolean;
  /** How a "use a creature" action resolves the creature (BUG-11). */
  useVia?: "reap" | "action";
}

/** Mutable holder: the move's chosen target is consumed by the first targeted ability. */
interface Choice {
  id?: string;
}

function select(context: Context, selection: Selection): CardInstance[] {
  const { state, source, target, fought } = context;
  if (selection === "self") return controllerOf(state, source) === undefined ? [] : [source];
  if (selection === "host") {
    return state.players.flatMap((player) => player.board.filter((card) => card.instanceId === source.attachedTo));
  }
  if (selection === "target") return target ? [target] : [];
  if (selection === "targetAndNeighbors") return target ? [target, ...neighbors(state, target)] : [];
  if (selection === "neighborsOfFought") return fought ? neighbors(state, fought) : [];
  return everyMatch(state, context.me, source, selection.each);
}

/** Specification shared by the engine and the AI: can this ability do anything now? */
export function canResolve(state: GameState, me: Side, source: CardInstance, ability: Ability): boolean {
  return (!ability.if || holds(ability.if, state, me)) && (!ability.target || everyMatch(state, me, source, ability.target).length > 0);
}

// ---------- game actions ----------

function leavePlay(state: GameState, card: CardInstance, destination: "discard" | "hand" | "deck" | "archives"): void {
  const side = controllerOf(state, card);
  if (side === undefined) return;
  const player = state.players[side];
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
    player.discard.push(half);
  }
  card.under = undefined;
  Object.assign(card, { damage: 0, ready: false, stunned: false, amber: 0, armorUsed: 0, elusiveUsed: false, poisoned: false, attachedTo: undefined });
  if (destination === "deck") player.deck.push(card);
  else player[destination].push(card);
}

// Cards whose "Destroyed:" abilities are resolving: still in play, but already
// on their way out, so sweep() must not destroy them a second time.
const dying = new WeakSet<CardInstance>();

function destroy(state: GameState, card: CardInstance, deterministic: boolean, by?: Side): void {
  const side = controllerOf(state, card);
  if (side === undefined || dying.has(card)) return;
  // FEAT-06: an enemy creature destroyed by an effect is a kill for the acting
  // side; damage-based deaths are credited by fight() (a board wipe destroys
  // both sides at once, so no single "destroyer" exists).
  if (isCreature(card) && by !== undefined && by !== side) tally(state.players[by], "creaturesDestroyed");
  dying.add(card);
  fire(state, side, card, "destroyed", { deterministic });
  dying.delete(card);
  leavePlay(state, card, "discard");
}

/** Armor absorbs damage once per turn (keyteki DealDamageAction/armorUsed). */
function dealDamage(state: GameState, card: CardInstance, amount: number, poison = false): void {
  if (!isCreature(card) || amount <= 0) return;
  const absorbed = Math.min(Math.max(0, effectiveArmor(state, card) - (card.armorUsed ?? 0)), amount);
  card.armorUsed = (card.armorUsed ?? 0) + absorbed;
  const applied = amount - absorbed;
  if (applied <= 0) return;
  card.damage += applied;
  if (poison) card.poisoned = true;
}

/** Destroys every creature whose damage reached its power (or took poison damage). */
function sweep(state: GameState, deterministic: boolean): void {
  for (;;) {
    const doomed = state.players
      .flatMap((player) => battleline(player))
      .find((card) => !dying.has(card) && (card.poisoned || (card.damage > 0 && card.damage >= effectivePower(state, card))));
    if (!doomed) return;
    destroy(state, doomed, deterministic);
  }
}

function discardRandom(player: GamePlayer, deterministic: boolean, rng: Rng): void {
  if (!player.hand.length) return;
  const index = deterministic ? 0 : Math.floor(roll(rng) * player.hand.length);
  player.discard.push(...player.hand.splice(index, 1));
}

function run(context: Context, act: Act): void {
  const { state, me, deterministic } = context;
  const player = state.players["opp" in act && act.opp ? other(me) : me];
  const cards = "s" in act ? select(context, act.s) : [];
  const amount = "n" in act ? act.n : 0;
  switch (act.k) {
    case "gainAmber":
      player.amber += amount;
      tally(player, "amberGained", amount);
      break;
    case "loseAmber":
      player.amber = Math.max(0, player.amber - amount);
      break;
    case "steal": {
      const stolen = Math.min(amount, state.players[other(me)].amber);
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
    case "discardRandom":
      for (let count = 0; count < amount; count += 1) discardRandom(player, deterministic, state);
      break;
    case "keyCost":
      player.keyCostMod = (player.keyCostMod ?? 0) + amount;
      break;
    case "capture":
      for (const card of cards.filter(isCreature)) {
        const side = controllerOf(state, card) as Side;
        const taken = Math.min(amount, state.players[other(side)].amber);
        state.players[other(side)].amber -= taken;
        card.amber = (card.amber ?? 0) + taken;
        tally(state.players[side], "amberCaptured", taken);
      }
      break;
    case "damage":
      for (const card of cards) dealDamage(state, card, amount);
      break;
    case "heal":
      for (const card of cards) card.damage = Math.max(0, card.damage - amount);
      break;
    case "destroy":
      for (const card of cards) destroy(state, card, deterministic, me);
      break;
    case "stun":
      for (const card of cards.filter(isCreature)) card.stunned = true;
      break;
    case "exhaust":
      for (const card of cards) card.ready = false;
      break;
    case "ready":
      for (const card of cards) card.ready = true;
      break;
    case "unstun":
      for (const card of cards) card.stunned = false;
      break;
    case "returnToHand":
      for (const card of cards) leavePlay(state, card, "hand");
      break;
    case "returnToDeck":
      for (const card of cards) leavePlay(state, card, "deck");
      break;
    case "archive":
      for (const card of cards) leavePlay(state, card, "archives");
      break;
    case "use":
      for (const card of cards) {
        if (!card.ready || card.stunned) continue;
        const side = controllerOf(state, card) as Side;
        // Using a creature is reap, fight or its Action, the player's choice;
        // until the UI prompts for it the engine resolves the printed Action
        // when there is one, reap otherwise (BUG-11).
        const via = context.useVia ?? (hasAbility(state, card, "action") ? "action" : "reap");
        if (via === "action") fire(state, side, card, "action", { choice: {}, deterministic });
        else reap(state, side, card, {}, deterministic);
      }
      break;
    case "fromDiscard": {
      const card = [...player.discard].reverse().find((item) => !act.type || item.face.type === act.type);
      if (card) player.discard = player.discard.filter((item) => item !== card);
      if (card) player.hand.push(card);
      break;
    }
    case "archiveTop": {
      const card = player.deck.pop();
      if (card) player.archives.push(card);
      break;
    }
    case "lasting": {
      // A triggered effect with a duration: stored as plain data (like keyteki's
      // lasting effects) and pruned when the stamp it expires on is reached.
      const until = turnStamp(state) + (act.e.duration === "next" ? 2 : 1);
      state.lasting = [...(state.lasting ?? []), { ...act.e, side: me, until }];
      break;
    }
  }
  sweep(state, deterministic);
}

/** Resolves every ability of `source` bound to `trigger` (keyteki TriggeredAbility). */
function fire(
  state: GameState,
  me: Side,
  source: CardInstance,
  trigger: Trigger,
  options: { fought?: CardInstance; choice?: Choice; deterministic: boolean; via?: "reap" | "action" },
): void {
  for (const ability of abilitiesOf(state, source)) {
    if (!ability.on.includes(trigger) || (ability.if && !holds(ability.if, state, me))) continue;
    const context: Context = { state, me, source, fought: options.fought, deterministic: options.deterministic, useVia: options.via };
    if (ability.target) {
      const legal = everyMatch(state, me, source, ability.target);
      const chosen = legal.find((card) => card.instanceId === options.choice?.id);
      if (options.choice) options.choice.id = undefined;
      context.target = chosen ?? autoPick(state, me, legal, isHarmful(ability));
      if (!context.target) continue;
    }
    for (const act of ability.acts) run(context, act);
  }
}

function reap(state: GameState, me: Side, creature: CardInstance, choice: Choice, deterministic: boolean): void {
  creature.ready = false;
  state.players[me].amber += 1;
  tally(state.players[me], "amberGained");
  fire(state, me, creature, "reap", { choice, deterministic });
}

/** keyteki ResolveFightAction: before-fight abilities, Assault/Hazardous, Elusive,
    Skirmish, Poison and Splash-attack, then "Fight:" if the attacker survived. */
function fight(state: GameState, me: Side, attacker: CardInstance, defender: CardInstance, choice: Choice, deterministic: boolean): void {
  attacker.ready = false;
  fire(state, me, attacker, "beforeFight", { fought: defender, choice, deterministic });
  const alive = () => controllerOf(state, attacker) === me && controllerOf(state, defender) === other(me);
  // FEAT-06: a creature that ended in the discard pile during the exchange is a
  // kill for the other side (assault/hazardous/poison and "Fight:" included).
  const credit = () => {
    if (state.players[me].discard.includes(attacker)) tally(state.players[other(me)], "creaturesDestroyed");
    if (state.players[other(me)].discard.includes(defender)) tally(state.players[me], "creaturesDestroyed");
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
  if (controllerOf(state, attacker) === me) fire(state, me, attacker, "fight", { fought: defender, choice, deterministic });
  credit();
}

// ---------- legality ----------

const houseAllows = (card: CardInstance, house: string | null) => !house || card.face.house === house;
const hasPrinted = (card: CardInstance, prefix: "Action" | "Omni") => new RegExp(`(^|[\\s/.])${prefix}:`, "i").test(card.face.text);

/** Does the card have an Action (or Omni) ability right now — printed or granted? */
const hasAbility = (state: GameState, card: CardInstance, trigger: "action" | "omni") =>
  hasPrinted(card, trigger === "action" ? "Action" : "Omni") || abilitiesOf(state, card).some((ability) => ability.on.includes(trigger));

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
  return card.ready && !card.stunned && ((houseAllows(card, house) && hasAbility(state, card, "action")) || hasAbility(state, card, "omni"));
}

function triggersFor(move: GameMove): Trigger[] {
  if (move.type === "play") return ["play"];
  if (move.type === "reap") return ["reap"];
  if (move.type === "fight") return ["beforeFight", "fight"];
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
  if (move.type === "play" && source.face.amber > 0) {
    const players = [...view.players] as [GamePlayer, GamePlayer];
    players[side] = { ...players[side], amber: players[side].amber + source.face.amber };
    view = { ...view, players };
  }
  const card = source;
  const triggers = triggersFor(move);
  const ability = abilitiesOf(view, card).find(
    (item) => item.target && item.on.some((trigger) => triggers.includes(trigger)) && (!item.if || holds(item.if, view, side)),
  );
  return ability?.target ? everyMatch(view, side, card, ability.target).map((item) => item.instanceId) : [];
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
      if (!houseAllows(card, house)) continue;
      if (state.plays < limit && canPlay(state, side, card)) moves.push({ type: "play", instanceId: card.instanceId });
      moves.push({ type: "discard", instanceId: card.instanceId });
    }
  }

  for (const card of player.board) {
    if (isCreature(card) && houseAllows(card, house) && card.ready) {
      if (card.stunned) {
        moves.push({ type: "unstun", instanceId: card.instanceId });
        continue;
      }
      moves.push({ type: "reap", instanceId: card.instanceId });
      for (const target of fightTargets(state, side, card)) {
        moves.push({ type: "fight", attackerId: card.instanceId, targetId: target.instanceId });
      }
    }
    if (card.face.type !== "Upgrade" && canUseCard(state, side, card, house)) moves.push({ type: "use", instanceId: card.instanceId });
  }
  return moves;
}

/** Legal moves, one per choosable target so the AI can search the choice.
    Fight moves expand too: the ability target of Fight:/Before Fight: is the
    controller's choice (BUG-06), separate from the defender. */
export function getLegalMoves(state: GameState, playerIndex: Side, house: string | null = null): GameMove[] {
  return baseMoves(state, playerIndex, house).flatMap((move) => {
    const choices = targetChoices(state, playerIndex, move);
    return choices.length > 1 ? choices.map((target) => ({ ...move, target }) as GameMove) : [move];
  });
}

/** Does the move's triggered text have any effect now? Used by the AI to prune
    moves (the Specification pattern: the same conditions the engine checks). */
export function moveHasEffect(state: GameState, side: Side, move: GameMove): boolean {
  if (move.type === "reap" || move.type === "fight" || move.type === "unstun" || move.type === "takeArchives") return true;
  if (move.type === "discard") return false;
  const source = moveSource(state, side, move);
  if (!source) return false;
  if (move.type === "play" && (source.face.type !== "Action" || source.face.amber > 0)) return true;
  const triggers = triggersFor(move);
  return abilitiesOf(state, source).some(
    (ability) => ability.on.some((trigger) => triggers.includes(trigger)) && canResolve(state, side, source, ability),
  );
}

const moveKey = (move: GameMove) =>
  move.type === "fight" ? `${move.attackerId}>${move.targetId}` : move.type === "takeArchives" ? "takeArchives" : move.instanceId;

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
  if (!isLegalMove(state, playerIndex, move)) return state;
  const player = state.players[playerIndex];
  const silent = options.silent === true;
  if (move.type === "takeArchives") {
    player.hand.push(...player.archives);
    player.archives = [];
    record(state, "log.archives", { name: player.name }, silent);
    return state;
  }
  const enemyIndex = other(playerIndex);
  const deterministic = options.deterministic === true;
  const choice: Choice = { id: "target" in move ? move.target : undefined };
  const source = moveSource(state, playerIndex, move)!;
  const params = { name: player.name, card: source.face.title };
  if (playerIndex === state.activePlayer) state.acted += 1;

  if (move.type === "play" || move.type === "discard") {
    if (playerIndex === state.activePlayer) state.played += 1;
    if (move.type === "play" && playerIndex === state.activePlayer) state.plays += 1;
    player.hand = player.hand.filter((card) => card !== source);
  }

  if (move.type === "discard") {
    player.discard.push(source);
    record(state, "log.discard", params, silent);
  } else if (move.type === "play") {
    player.amber += source.face.amber;
    tally(player, "amberGained", source.face.amber);
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
          player.amber += half.face.amber;
          tally(player, "amberGained", half.face.amber);
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
    fire(state, playerIndex, source, "play", { choice, deterministic });
    if (source.face.type !== "Creature" && source.face.type !== "Artifact" && source.face.type !== "Upgrade") player.discard.push(source);
    if (keyword(state, source, "omega") && playerIndex === state.activePlayer) state.omega = true;
  } else if (move.type === "unstun") {
    // A stunned creature's use only removes the stun (keyteki RemoveStunAction on use).
    Object.assign(source, { ready: false, stunned: false });
    record(state, "log.unstun", params, silent);
  } else if (move.type === "reap") {
    reap(state, playerIndex, source, choice, deterministic);
    record(state, "log.reap", params, silent);
  } else if (move.type === "fight") {
    const target = findOnBoard(state, enemyIndex, move.targetId)!;
    record(state, "log.fight", { ...params, target: target.face.title }, silent);
    fight(state, playerIndex, source, target, choice, deterministic);
  } else {
    source.ready = false;
    const house = playerIndex === state.activePlayer ? state.activeHouse : null;
    if (houseAllows(source, house) && hasAbility(state, source, "action")) {
      fire(state, playerIndex, source, "action", { choice, deterministic, via: move.via });
    }
    fire(state, playerIndex, source, "omni", { choice, deterministic, via: move.via });
    record(state, "log.use", params, silent);
  }

  if (player.keys >= 3) state.winner = playerIndex;
  return state;
}

export function chooseHouse(state: GameState, playerIndex: Side, house: string): GameState {
  const next = cloneGame(state);
  const player = next.players[playerIndex];
  if (playerIndex !== next.activePlayer || next.activeHouse !== null || mulliganPending(next) || !player.houses.includes(house)) return next;
  next.activeHouse = house;
  // Picking the archives up is optional ("may", docs/ROADMAP_REVIEW.md §1.2):
  // the takeArchives move is offered from the house choice on instead of
  // handing the cards over for free here.
  record(next, "log.house", { name: player.name, house });
  return next;
}

export function endTurn(current: GameState, playerIndex: Side): GameState {
  const state = cloneGame(current);
  if (playerIndex !== state.activePlayer || state.winner !== null || mulliganPending(state)) return state;
  // The turn cannot end before the mandatory house choice (BUG-02).
  if (state.activeHouse === null) return state;

  const endingPlayer = state.players[playerIndex];
  // Ready step, then draw step (keyteki ReadyPhase + DrawPhase).
  for (const card of endingPlayer.board) card.ready = true;
  refill(endingPlayer, state);
  endingPlayer.keyCostMod = 0;
  for (const card of state.players.flatMap((player) => player.board)) {
    card.armorUsed = 0;
    card.elusiveUsed = false;
  }
  record(state, "log.endTurn", { name: endingPlayer.name });

  const nextIndex = other(playerIndex);
  const nextPlayer = state.players[nextIndex];
  Object.assign(state, { activePlayer: nextIndex, activeHouse: null, acted: 0, played: 0, plays: 0, omega: false });
  if (nextIndex === 0) state.turn += 1;
  // Lasting effects whose duration ran out with this turn stop applying.
  const stamp = turnStamp(state);
  state.lasting = (state.lasting ?? []).filter((effect) => (effect.until ?? 0) > stamp);

  // Key step: forging is mandatory when affordable.
  const cost = keyCost(state, nextIndex);
  if (nextPlayer.amber >= cost) {
    nextPlayer.amber -= cost;
    nextPlayer.keys += 1;
    record(state, "log.forge", { name: nextPlayer.name });
    if (nextPlayer.keys >= 3) {
      state.winner = nextIndex;
      record(state, "log.wins", { name: nextPlayer.name });
    }
  }

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
    bonusAmber += card.amber;
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
