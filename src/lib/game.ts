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
import { rulesOf, type Ability, type Act, type Condition, type Filter, type Selection, type Trigger } from "./abilities";
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
}

export interface LogEntry {
  key: string;
  params: Record<string, string>;
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
  /** An Omega card ended the main step. */
  omega: boolean;
}

/** `target` optionally names the card chosen for the triggered ability (or the
    creature an upgrade attaches to); without it the engine picks like keyteki's
    auto-target would for the controller. `slot` places a Deploy creature. */
export type GameMove =
  | { type: "play"; instanceId: string; target?: string; slot?: number; flank?: "left" | "right" }
  | { type: "reap"; instanceId: string; target?: string }
  | { type: "fight"; attackerId: string; targetId: string; target?: string }
  | { type: "use"; instanceId: string; target?: string }
  | { type: "unstun"; instanceId: string }
  | { type: "discard"; instanceId: string };

export const BASE_KEY_COST = 6;
const HAND_SIZE = 6;
const LOG_SIZE = 14;

type Side = 0 | 1;
const other = (side: Side): Side => (side === 0 ? 1 : 0);

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function makePlayer(name: string, deck: DeckInfo, owner: string): GamePlayer {
  return {
    name,
    deckName: deck.name,
    houses: deck.houses.length ? [...deck.houses] : [...new Set(deck.cards.map((card) => card.house))],
    deck: shuffle(
      deck.cards.map((face, index) => ({
        instanceId: `${owner}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        face,
        damage: 0,
        ready: false,
        stunned: false,
      })),
    ),
    hand: [],
    discard: [],
    board: [],
    archives: [],
    amber: 0,
    keys: 0,
    chains: 0,
    keyCostMod: 0,
  };
}

/** Draws from the top of the deck (the array's end), reshuffling the discard pile when the deck runs out. */
function draw(player: GamePlayer, count: number): void {
  for (let drawn = 0; drawn < count; drawn += 1) {
    if (!player.deck.length && player.discard.length) {
      player.deck = shuffle(player.discard);
      player.discard = [];
    }
    const card = player.deck.pop();
    if (!card) break;
    player.hand.push(card);
  }
}

/** Draw step (keyteki DrawAction refill): up to 6, minus 1 card per 6 chains
    (rounded up), shedding one chain whenever the hand was below its size. */
function refill(player: GamePlayer): void {
  if (player.hand.length >= HAND_SIZE) return;
  draw(player, HAND_SIZE - player.hand.length - Math.floor((player.chains + 5) / 6));
  if (player.chains > 0) player.chains -= 1;
}

export function createMatch(playerDeck: DeckInfo, rivalDeck: DeckInfo): GameState {
  const rival = makePlayer("The Ember Warden", rivalDeck, "warden");
  if (playerDeck.id === rivalDeck.id) rival.deckName = "Warden's mirror deck";
  const players: [GamePlayer, GamePlayer] = [makePlayer("You", playerDeck, "you"), rival];
  // First player opens with 7 (keyteki setupphase: +1 hand size on the first refill).
  draw(players[0], HAND_SIZE + 1);
  draw(players[1], HAND_SIZE);

  return {
    players,
    activePlayer: 0,
    activeHouse: null,
    turn: 1,
    winner: null,
    log: [{ key: "log.matchStart", params: { deck: playerDeck.name, rival: players[1].deckName } }],
    acted: 0,
    played: 0,
    omega: false,
  };
}

export function cloneGame(state: GameState): GameState {
  const copyPlayer = (player: GamePlayer): GamePlayer => ({
    ...player,
    houses: [...player.houses],
    deck: player.deck.map((card) => ({ ...card })),
    hand: player.hand.map((card) => ({ ...card })),
    discard: player.discard.map((card) => ({ ...card })),
    board: player.board.map((card) => ({ ...card })),
    archives: (player.archives ?? []).map((card) => ({ ...card })),
  });

  return {
    ...state,
    players: [copyPlayer(state.players[0]), copyPlayer(state.players[1])],
    log: [...state.log],
  };
}

function record(state: GameState, key: string, params: Record<string, string>, silent = false): void {
  if (!silent) state.log = [...state.log, { key, params }].slice(-LOG_SIZE);
}

// ---------- board queries ----------

export const keyword = (card: CardInstance, name: Keyword): number => rulesOf(card.face).keywords[name] ?? 0;
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

/** Key cost for `side` right now: 6 + active modifiers (keyteki player.getCurrentKeyCost). */
export function keyCost(state: GameState, side: Side): number {
  return BASE_KEY_COST + (state.players[side].keyCostMod ?? 0);
}

// ---------- specification (conditions and targets) ----------

function holds(condition: Condition, state: GameState, me: Side): boolean {
  if (condition.k === "not") return !holds(condition.c, state, me);
  if (condition.k === "amber") {
    const amber = state.players[condition.opp ? other(me) : me].amber;
    return condition.op === "eq" ? amber === condition.n : amber >= condition.n;
  }
  const mine = battleline(state.players[me]).length;
  const theirs = battleline(state.players[other(me)]).length;
  return condition.k === "moreCreatures" ? mine > theirs : mine < theirs;
}

function matches(state: GameState, me: Side, source: CardInstance, card: CardInstance, filter: Filter): boolean {
  const side = controllerOf(state, card);
  return (
    (!filter.type || card.face.type === filter.type) &&
    (!filter.side || (filter.side === "friendly") === (side === me)) &&
    (filter.damaged === undefined || card.damage > 0 === filter.damaged) &&
    (filter.flank === undefined || onFlank(state, card) === filter.flank) &&
    (!filter.other || card !== source) &&
    (!filter.ready || (card.ready && !card.stunned))
  );
}

function everyMatch(state: GameState, me: Side, source: CardInstance, filter: Filter): CardInstance[] {
  const found = [...state.players[me].board, ...state.players[other(me)].board].filter((card) =>
    matches(state, me, source, card, filter),
  );
  return filter.top ? found.sort((a, b) => b.face.power - a.face.power).slice(0, filter.top) : found;
}

const HARMFUL = new Set<Act["k"]>(["destroy", "damage", "stun", "exhaust", "returnToHand", "returnToDeck", "archive"]);
const isHarmful = (ability: Ability) => ability.acts.some((act) => HARMFUL.has(act.k));

/** Default choice for a targeted ability: harmful effects hit the strongest
    enemy (then the weakest friendly), helpful ones the strongest friendly. */
function autoPick(state: GameState, me: Side, candidates: CardInstance[], harmful: boolean): CardInstance | undefined {
  const strongest = (cards: CardInstance[]) =>
    [...cards].sort((a, b) => b.face.power - a.face.power || b.damage - a.damage)[0];
  const friendly = candidates.filter((card) => controllerOf(state, card) === me);
  const enemy = candidates.filter((card) => !friendly.includes(card));
  if (!harmful) return strongest(friendly) ?? strongest(enemy);
  return strongest(enemy) ?? [...friendly].sort((a, b) => a.face.power - b.face.power)[0];
}

interface Context {
  state: GameState;
  me: Side;
  source: CardInstance;
  fought?: CardInstance;
  target?: CardInstance;
  deterministic: boolean;
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
  Object.assign(card, { damage: 0, ready: false, stunned: false, amber: 0, armorUsed: 0, elusiveUsed: false, poisoned: false, attachedTo: undefined });
  if (destination === "deck") player.deck.push(card);
  else player[destination].push(card);
}

// Cards whose "Destroyed:" abilities are resolving: still in play, but already
// on their way out, so sweep() must not destroy them a second time.
const dying = new WeakSet<CardInstance>();

function destroy(state: GameState, card: CardInstance, deterministic: boolean): void {
  const side = controllerOf(state, card);
  if (side === undefined || dying.has(card)) return;
  dying.add(card);
  fire(state, side, card, "destroyed", { deterministic });
  dying.delete(card);
  leavePlay(state, card, "discard");
}

/** Armor absorbs damage once per turn (keyteki DealDamageAction/armorUsed). */
function dealDamage(card: CardInstance, amount: number, poison = false): void {
  if (!isCreature(card) || amount <= 0) return;
  const absorbed = Math.min(Math.max(0, card.face.armor - (card.armorUsed ?? 0)), amount);
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
      .find((card) => !dying.has(card) && (card.poisoned || (card.damage > 0 && card.damage >= card.face.power)));
    if (!doomed) return;
    destroy(state, doomed, deterministic);
  }
}

function discardRandom(player: GamePlayer, deterministic: boolean): void {
  if (!player.hand.length) return;
  const index = deterministic ? 0 : Math.floor(Math.random() * player.hand.length);
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
      break;
    case "loseAmber":
      player.amber = Math.max(0, player.amber - amount);
      break;
    case "steal": {
      const stolen = Math.min(amount, state.players[other(me)].amber);
      state.players[other(me)].amber -= stolen;
      state.players[me].amber += stolen;
      break;
    }
    case "gainChains":
      player.chains += amount;
      break;
    case "draw":
      draw(player, amount);
      break;
    case "discardRandom":
      for (let count = 0; count < amount; count += 1) discardRandom(player, deterministic);
      break;
    case "keyCost":
      player.keyCostMod = (player.keyCostMod ?? 0) + amount;
      break;
    case "capture":
      for (const card of cards.filter(isCreature)) {
        const opponent = state.players[other(controllerOf(state, card) as Side)];
        const taken = Math.min(amount, opponent.amber);
        opponent.amber -= taken;
        card.amber = (card.amber ?? 0) + taken;
      }
      break;
    case "damage":
      for (const card of cards) dealDamage(card, amount);
      break;
    case "heal":
      for (const card of cards) card.damage = Math.max(0, card.damage - amount);
      break;
    case "destroy":
      for (const card of cards) destroy(state, card, deterministic);
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
      for (const card of cards) if (card.ready && !card.stunned) reap(state, controllerOf(state, card) as Side, card, {}, deterministic);
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
  }
  sweep(state, deterministic);
}

/** Resolves every ability of `source` bound to `trigger` (keyteki TriggeredAbility). */
function fire(
  state: GameState,
  me: Side,
  source: CardInstance,
  trigger: Trigger,
  options: { fought?: CardInstance; choice?: Choice; deterministic: boolean },
): void {
  for (const ability of rulesOf(source.face).abilities) {
    if (!ability.on.includes(trigger) || (ability.if && !holds(ability.if, state, me))) continue;
    const context: Context = { state, me, source, fought: options.fought, deterministic: options.deterministic };
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
  fire(state, me, creature, "reap", { choice, deterministic });
}

/** keyteki ResolveFightAction: before-fight abilities, Assault/Hazardous, Elusive,
    Skirmish, Poison and Splash-attack, then "Fight:" if the attacker survived. */
function fight(state: GameState, me: Side, attacker: CardInstance, defender: CardInstance, choice: Choice, deterministic: boolean): void {
  attacker.ready = false;
  fire(state, me, attacker, "beforeFight", { fought: defender, choice, deterministic });
  const alive = () => controllerOf(state, attacker) === me && controllerOf(state, defender) === other(me);
  if (!alive()) return;
  dealDamage(defender, keyword(attacker, "assault"));
  dealDamage(attacker, keyword(defender, "hazardous"));
  sweep(state, deterministic);
  if (!alive()) return;

  const elusive = keyword(defender, "elusive") > 0 && !defender.elusiveUsed;
  defender.elusiveUsed = true;
  if (!elusive) {
    if (!keyword(attacker, "skirmish")) dealDamage(attacker, defender.face.power, keyword(defender, "poison") > 0);
    dealDamage(defender, attacker.face.power, keyword(attacker, "poison") > 0);
  }
  const splash = keyword(attacker, "splash-attack");
  if (splash) for (const neighbor of neighbors(state, defender)) dealDamage(neighbor, splash);
  sweep(state, deterministic);
  if (controllerOf(state, attacker) === me) fire(state, me, attacker, "fight", { fought: defender, choice, deterministic });
}

// ---------- legality ----------

const houseAllows = (card: CardInstance, house: string | null) => !house || card.face.house === house;
const hasPrinted = (card: CardInstance, prefix: "Action" | "Omni") => new RegExp(`(^|[\\s/.])${prefix}:`, "i").test(card.face.text);

function mayAct(state: GameState, side: Side): boolean {
  return state.winner === null && !(side === state.activePlayer && state.omega);
}

/** First turn (keyteki setupphase firstPlayerEffects): the first player may play or discard only one card. */
function mayPlay(state: GameState, side: Side): boolean {
  return !(side === state.activePlayer && state.turn === 1 && side === 0 && state.played >= 1);
}

function canPlay(state: GameState, side: Side, card: CardInstance): boolean {
  if (keyword(card, "alpha") && side === state.activePlayer && state.acted > 0) return false;
  if (card.face.type === "Upgrade") return state.players.some((player) => battleline(player).length > 0);
  return true;
}

/** Enemy creatures `attacker` may fight: taunt protects its neighbors (keyteki Card.js). */
export function fightTargets(state: GameState, side: Side, attacker: CardInstance): CardInstance[] {
  if (!isCreature(attacker) || !attacker.ready || attacker.stunned) return [];
  return battleline(state.players[other(side)]).filter(
    (target) => keyword(target, "taunt") > 0 || !neighbors(state, target).some((neighbor) => keyword(neighbor, "taunt") > 0),
  );
}

function canUseCard(card: CardInstance, house: string | null): boolean {
  return card.ready && !card.stunned && ((houseAllows(card, house) && hasPrinted(card, "Action")) || hasPrinted(card, "Omni"));
}

function triggersFor(move: GameMove): Trigger[] {
  if (move.type === "play") return ["play"];
  if (move.type === "reap") return ["reap"];
  if (move.type === "fight") return ["beforeFight", "fight"];
  return move.type === "use" ? ["action", "omni"] : [];
}

function moveSource(state: GameState, side: Side, move: GameMove): CardInstance | undefined {
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
    view = { ...state, players };
  }
  const card = source;
  const triggers = triggersFor(move);
  const ability = rulesOf(card.face).abilities.find(
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

  if (mayPlay(state, side)) {
    for (const card of player.hand) {
      if (!houseAllows(card, house)) continue;
      if (canPlay(state, side, card)) moves.push({ type: "play", instanceId: card.instanceId });
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
    if (card.face.type !== "Upgrade" && canUseCard(card, house)) moves.push({ type: "use", instanceId: card.instanceId });
  }
  return moves;
}

/** Legal moves, one per choosable target so the AI can search the choice. */
export function getLegalMoves(state: GameState, playerIndex: Side, house: string | null = null): GameMove[] {
  return baseMoves(state, playerIndex, house).flatMap((move) => {
    const choices = move.type === "fight" ? [] : targetChoices(state, playerIndex, move);
    return choices.length > 1 ? choices.map((target) => ({ ...move, target }) as GameMove) : [move];
  });
}

/** Does the move's triggered text have any effect now? Used by the AI to prune
    moves (the Specification pattern: the same conditions the engine checks). */
export function moveHasEffect(state: GameState, side: Side, move: GameMove): boolean {
  if (move.type === "reap" || move.type === "fight" || move.type === "unstun") return true;
  if (move.type === "discard") return false;
  const source = moveSource(state, side, move);
  if (!source) return false;
  if (move.type === "play" && (source.face.type !== "Action" || source.face.amber > 0)) return true;
  const triggers = triggersFor(move);
  return rulesOf(source.face).abilities.some(
    (ability) => ability.on.some((trigger) => triggers.includes(trigger)) && canResolve(state, side, source, ability),
  );
}

const moveKey = (move: GameMove) => (move.type === "fight" ? `${move.attackerId}>${move.targetId}` : move.instanceId);

export function isLegalMove(state: GameState, side: Side, move: GameMove): boolean {
  const house = side === state.activePlayer ? state.activeHouse : null;
  return baseMoves(state, side, house).some((item) => item.type === move.type && moveKey(item) === moveKey(move));
}

// ---------- moves ----------

export interface MoveOptions {
  silent?: boolean;
  deterministic?: boolean;
}

function placeCreature(player: GamePlayer, card: CardInstance, move: Extract<GameMove, { type: "play" }>): void {
  const line = battleline(player);
  let slot = move.flank === "left" ? 0 : line.length;
  if (keyword(card, "deploy") && move.slot !== undefined) slot = Math.max(0, Math.min(line.length, move.slot));
  const anchor = line[slot];
  player.board.splice(anchor ? player.board.indexOf(anchor) : player.board.length, 0, card);
}

export function applyMove(current: GameState, playerIndex: Side, move: GameMove, options: MoveOptions = {}): GameState {
  const state = cloneGame(current);
  if (!isLegalMove(state, playerIndex, move)) return state;
  const player = state.players[playerIndex];
  const enemyIndex = other(playerIndex);
  const silent = options.silent === true;
  const deterministic = options.deterministic === true;
  const choice: Choice = { id: "target" in move ? move.target : undefined };
  const source = moveSource(state, playerIndex, move)!;
  const params = { name: player.name, card: source.face.title };
  if (playerIndex === state.activePlayer) state.acted += 1;

  if (move.type === "play" || move.type === "discard") {
    if (playerIndex === state.activePlayer) state.played += 1;
    player.hand = player.hand.filter((card) => card !== source);
  }

  if (move.type === "discard") {
    player.discard.push(source);
    record(state, "log.discard", params, silent);
  } else if (move.type === "play") {
    player.amber += source.face.amber;
    Object.assign(source, { ready: false, stunned: false, damage: 0 });
    record(state, "log.play", params, silent);
    if (isCreature(source)) {
      placeCreature(player, source, move);
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
    if (keyword(source, "omega") && playerIndex === state.activePlayer) state.omega = true;
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
    if (houseAllows(source, house) && hasPrinted(source, "Action")) fire(state, playerIndex, source, "action", { choice, deterministic });
    fire(state, playerIndex, source, "omni", { choice, deterministic });
    record(state, "log.use", params, silent);
  }

  if (player.keys >= 3) state.winner = playerIndex;
  return state;
}

export function chooseHouse(state: GameState, playerIndex: Side, house: string): GameState {
  const next = cloneGame(state);
  const player = next.players[playerIndex];
  if (playerIndex !== next.activePlayer || next.activeHouse !== null || !player.houses.includes(house)) return next;
  next.activeHouse = house;
  // Archived cards are picked up when the house is chosen (always taken here).
  player.hand.push(...player.archives);
  player.archives = [];
  record(next, "log.house", { name: player.name, house });
  return next;
}

export function endTurn(current: GameState, playerIndex: Side): GameState {
  const state = cloneGame(current);
  if (playerIndex !== state.activePlayer || state.winner !== null) return state;
  // The turn cannot end before the mandatory house choice (BUG-02).
  if (state.activeHouse === null) return state;

  const endingPlayer = state.players[playerIndex];
  // Ready step, then draw step (keyteki ReadyPhase + DrawPhase).
  for (const card of endingPlayer.board) card.ready = true;
  refill(endingPlayer);
  endingPlayer.keyCostMod = 0;
  for (const card of state.players.flatMap((player) => player.board)) {
    card.armorUsed = 0;
    card.elusiveUsed = false;
  }
  record(state, "log.endTurn", { name: endingPlayer.name });

  const nextIndex = other(playerIndex);
  const nextPlayer = state.players[nextIndex];
  Object.assign(state, { activePlayer: nextIndex, activeHouse: null, acted: 0, played: 0, omega: false });
  if (nextIndex === 0) state.turn += 1;

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