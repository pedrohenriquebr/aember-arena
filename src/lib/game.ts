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
}

export interface GamePlayer {
  name: string;
  deckName: string;
  houses: string[];
  deck: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
  board: CardInstance[];
  amber: number;
  keys: number;
  chains: number;
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
}

export type GameMove =
  | { type: "play"; instanceId: string }
  | { type: "reap"; instanceId: string }
  | { type: "fight"; attackerId: string; targetId: string }
  | { type: "use"; instanceId: string };

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function instancesForDeck(deck: DeckInfo, owner: string): CardInstance[] {
  return deck.cards.map((face, index) => ({
    instanceId: `${owner}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    face,
    damage: 0,
    ready: false,
    stunned: false,
  }));
}

function makePlayer(name: string, deck: DeckInfo, owner: string): GamePlayer {
  return {
    name,
    deckName: deck.name,
    houses: deck.houses.length ? [...deck.houses] : [...new Set(deck.cards.map((card) => card.house))],
    deck: shuffle(instancesForDeck(deck, owner)),
    hand: [],
    discard: [],
    board: [],
    amber: 0,
    keys: 0,
    chains: 0,
  };
}

function drawTo(player: GamePlayer, count: number): void {
  while (player.hand.length < count) {
    if (!player.deck.length && player.discard.length) {
      player.deck = shuffle(player.discard);
      player.discard = [];
    }
    if (!player.deck.length) break;
    const card = player.deck.pop();
    if (card) player.hand.push(card);
  }
}

export function createMatch(playerDeck: DeckInfo, rivalDeck: DeckInfo): GameState {
  const rival = makePlayer("The Ember Warden", rivalDeck, "warden");
  if (playerDeck.id === rivalDeck.id) rival.deckName = "Warden's mirror deck";
  const players: [GamePlayer, GamePlayer] = [
    makePlayer("You", playerDeck, "you"),
    rival,
  ];
  drawTo(players[0], 6);
  drawTo(players[1], 6);

  return {
    players,
    activePlayer: 0,
    activeHouse: null,
    turn: 1,
    winner: null,
    log: [{ key: "log.matchStart", params: { deck: playerDeck.name, rival: players[1].deckName } }],
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
  });

  return {
    ...state,
    players: [copyPlayer(state.players[0]), copyPlayer(state.players[1])],
    log: [...state.log],
  };
}

function record(state: GameState, entry: LogEntry, silent: boolean): void {
  if (!silent) state.log = [...state.log, entry].slice(-14);
}

function canUseHouse(card: CardInstance, house: string | null): boolean {
  return !house || card.face.house === house || card.face.isMaverick === true;
}

export function getLegalMoves(state: GameState, playerIndex: 0 | 1, house: string | null = null): GameMove[] {
  if (state.winner !== null) return [];
  const player = state.players[playerIndex];
  const enemy = state.players[playerIndex === 0 ? 1 : 0];
  const moves: GameMove[] = [];

  for (const card of player.hand) {
    if (canUseHouse(card, house)) moves.push({ type: "play", instanceId: card.instanceId });
  }

  for (const creature of player.board) {
    if (!canUseHouse(creature, house) || !creature.ready || creature.stunned) continue;
    if (creature.face.type === "Creature") {
      moves.push({ type: "reap", instanceId: creature.instanceId });
      for (const target of enemy.board) {
        if (target.face.type === "Creature") {
          moves.push({ type: "fight", attackerId: creature.instanceId, targetId: target.instanceId });
        }
      }
    } else if (
      creature.face.type === "Artifact" &&
      /(?:Action|Omni):/i.test(creature.face.text)
    ) {
      moves.push({ type: "use", instanceId: creature.instanceId });
    }
  }

  return moves;
}

function findBoardCard(state: GameState, owner: 0 | 1, instanceId: string): CardInstance | undefined {
  return state.players[owner].board.find((card) => card.instanceId === instanceId);
}

function destroyCreature(state: GameState, owner: 0 | 1, instanceId: string): void {
  const player = state.players[owner];
  const index = player.board.findIndex((card) => card.instanceId === instanceId);
  if (index < 0) return;
  const [card] = player.board.splice(index, 1);
  player.discard.push(card);
}

function damageCreature(state: GameState, owner: 0 | 1, instanceId: string, amount: number): void {
  const creature = findBoardCard(state, owner, instanceId);
  if (!creature || creature.face.type !== "Creature") return;
  creature.damage += Math.max(0, amount);
  if (creature.damage >= creature.face.power + creature.face.armor) {
    destroyCreature(state, owner, instanceId);
  }
}

function chooseTarget(player: GamePlayer): CardInstance | undefined {
  return [...player.board]
    .filter((card) => card.face.type === "Creature")
    .sort((a, b) => b.face.power - a.face.power || b.damage - a.damage)[0];
}

function destroyAll(state: GameState, owner: 0 | 1, onlyUndamaged = false): void {
  const player = state.players[owner];
  const removed = player.board.filter(
    (card) => card.face.type === "Creature" && (!onlyUndamaged || card.damage === 0),
  );
  player.board = player.board.filter((card) => !removed.includes(card));
  player.discard.push(...removed);
}

function returnToHand(state: GameState, owner: 0 | 1, instanceId: string): void {
  const player = state.players[owner];
  const index = player.board.findIndex((card) => card.instanceId === instanceId);
  if (index < 0) return;
  const [card] = player.board.splice(index, 1);
  card.ready = false;
  player.hand.push(card);
}

function discardOne(player: GamePlayer, deterministic: boolean): void {
  if (!player.hand.length) return;
  const index = deterministic ? 0 : Math.floor(Math.random() * player.hand.length);
  const [card] = player.hand.splice(index, 1);
  player.discard.push(card);
}

function stunBestEnemy(state: GameState, owner: 0 | 1, withNeighbors = false): void {
  const enemyIndex = owner === 0 ? 1 : 0;
  const enemy = state.players[enemyIndex];
  const target = chooseTarget(enemy);
  if (!target) return;
  const index = enemy.board.findIndex((card) => card.instanceId === target.instanceId);
  const start = withNeighbors ? Math.max(0, index - 1) : index;
  const end = withNeighbors ? Math.min(enemy.board.length - 1, index + 1) : index;
  for (let position = start; position <= end; position += 1) {
    const card = enemy.board[position];
    if (card?.face.type === "Creature") {
      card.stunned = true;
      card.ready = false;
    }
  }
}

function resolveCardPlay(state: GameState, owner: 0 | 1, card: CardInstance, deterministic = false): void {
  const enemyIndex = owner === 0 ? 1 : 0;
  const player = state.players[owner];
  const enemy = state.players[enemyIndex];
  const title = card.face.title.toLowerCase();

  if (title === "coward's end") {
    destroyAll(state, 0, true);
    destroyAll(state, 1, true);
    player.chains += 3;
  } else if (title === "gateway to dis") {
    destroyAll(state, 0);
    destroyAll(state, 1);
    player.chains += 3;
  } else if (title === "hysteria") {
    for (const side of [0, 1] as const) {
      const sidePlayer = state.players[side];
      const creatures = sidePlayer.board.filter((item) => item.face.type === "Creature");
      sidePlayer.board = sidePlayer.board.filter((item) => item.face.type !== "Creature");
      sidePlayer.hand.push(...creatures.map((item) => ({ ...item, ready: false })));
    }
  } else if (title === "fear") {
    const target = chooseTarget(enemy);
    if (target) returnToHand(state, enemyIndex, target.instanceId);
  } else if (title === "hand of dis") {
    const candidates = enemy.board.filter(
      (item, index) => item.face.type === "Creature" && index > 0 && index < enemy.board.length - 1,
    );
    const target = candidates.sort((a, b) => b.face.power - a.face.power)[0];
    if (target) destroyCreature(state, enemyIndex, target.instanceId);
  } else if (title === "tremor") {
    stunBestEnemy(state, owner, true);
  } else if (title === "smaaash") {
    stunBestEnemy(state, owner);
  } else if (title === "smith" && player.board.filter((item) => item.face.type === "Creature").length > enemy.board.filter((item) => item.face.type === "Creature").length) {
    player.amber += 2;
  } else if (title === "the terror" && enemy.amber === 0) {
    player.amber += 2;
  } else if (title === "mind barb") {
    discardOne(enemy, deterministic);
  } else if (title === "dextre" && enemy.amber > 0) {
    enemy.amber -= 1;
    player.amber += 1;
  }

  if (card.face.type === "Creature" && title === "hebe the huge") {
    for (const side of [0, 1] as const) {
      for (const creature of [...state.players[side].board]) {
        if (creature.instanceId !== card.instanceId && creature.face.type === "Creature" && creature.damage === 0) {
          damageCreature(state, side, creature.instanceId, 2);
        }
      }
    }
  }
}

export interface MoveOptions {
  silent?: boolean;
  deterministic?: boolean;
}

export function applyMove(
  current: GameState,
  playerIndex: 0 | 1,
  move: GameMove,
  options: MoveOptions = {},
): GameState {
  const state = cloneGame(current);
  const player = state.players[playerIndex];
  const enemyIndex = playerIndex === 0 ? 1 : 0;
  const enemy = state.players[enemyIndex];
  const silent = options.silent === true;

  if (move.type === "play") {
    const handIndex = player.hand.findIndex((card) => card.instanceId === move.instanceId);
    if (handIndex < 0) return state;
    const [card] = player.hand.splice(handIndex, 1);
    player.amber += card.face.amber;
    if (card.face.type === "Creature" || card.face.type === "Artifact" || card.face.type === "Upgrade") {
      card.ready = false;
      card.stunned = false;
      card.damage = 0;
      player.board.push(card);
      resolveCardPlay(state, playerIndex, card, options.deterministic === true);
      record(state, { key: "log.play", params: { name: player.name, card: card.face.title } }, silent);
    } else {
      resolveCardPlay(state, playerIndex, card, options.deterministic === true);
      player.discard.push(card);
      record(state, { key: "log.play", params: { name: player.name, card: card.face.title } }, silent);
    }
  } else if (move.type === "reap") {
    const creature = findBoardCard(state, playerIndex, move.instanceId);
    if (!creature || !creature.ready || creature.stunned) return state;
    creature.ready = false;
    player.amber += 1;
    if (creature.face.title.toLowerCase() === "tocsin") discardOne(enemy, options.deterministic === true);
    record(state, { key: "log.reap", params: { name: player.name, card: creature.face.title } }, silent);
  } else if (move.type === "fight") {
    const attacker = findBoardCard(state, playerIndex, move.attackerId);
    const target = findBoardCard(state, enemyIndex, move.targetId);
    if (!attacker || !target || !attacker.ready || attacker.stunned) return state;
    const attackerDamage = target.face.power;
    const targetDamage = attacker.face.power;
    attacker.ready = false;
    damageCreature(state, playerIndex, attacker.instanceId, attackerDamage);
    damageCreature(state, enemyIndex, target.instanceId, targetDamage);
    if (attacker.face.title.toLowerCase() === "headhunter") player.amber += 1;
    record(state, { key: "log.fight", params: { name: player.name, card: attacker.face.title, target: target.face.title } }, silent);
  } else if (move.type === "use") {
    const artifact = findBoardCard(state, playerIndex, move.instanceId);
    if (!artifact || !artifact.ready || artifact.stunned) return state;
    artifact.ready = false;
    const title = artifact.face.title.toLowerCase();
    if (title === "screechbomb") {
      enemy.amber = Math.max(0, enemy.amber - 2);
      player.discard.push(artifact);
      player.board = player.board.filter((card) => card.instanceId !== artifact.instanceId);
    } else if (title === "key to dis") {
      destroyAll(state, 0);
      destroyAll(state, 1);
      player.discard.push(artifact);
      player.board = player.board.filter((card) => card.instanceId !== artifact.instanceId);
    } else if (title === "dominator bauble") {
      const readyCreature = player.board.find((card) => card.face.type === "Creature" && card.ready);
      if (readyCreature) readyCreature.ready = false;
      player.amber += readyCreature ? 0 : 1;
    } else {
      player.amber += 1;
    }
    record(state, { key: "log.use", params: { name: player.name, card: artifact.face.title } }, silent);
  }

  if (player.keys >= 3) state.winner = playerIndex;
  return state;
}

export function chooseHouse(state: GameState, playerIndex: 0 | 1, house: string): GameState {
  const next = cloneGame(state);
  if (playerIndex !== next.activePlayer || next.activeHouse !== null || !next.players[playerIndex].houses.includes(house)) return next;
  next.activeHouse = house;
  next.log = [...next.log, { key: "log.house", params: { name: next.players[playerIndex].name, house } }].slice(-14);
  return next;
}

export function endTurn(current: GameState, playerIndex: 0 | 1): GameState {
  const state = cloneGame(current);
  if (playerIndex !== state.activePlayer || state.winner !== null) return state;

  const endingPlayer = state.players[playerIndex];
  drawTo(endingPlayer, 6);
  record(state, { key: "log.endTurn", params: { name: endingPlayer.name } }, false);

  const nextIndex = playerIndex === 0 ? 1 : 0;
  const nextPlayer = state.players[nextIndex];
  state.activePlayer = nextIndex;
  state.activeHouse = null;
  if (nextIndex === 0) state.turn += 1;

  for (const card of nextPlayer.board) {
    if (card.stunned) {
      card.stunned = false;
      card.ready = false;
    } else {
      card.ready = true;
    }
  }

  if (nextPlayer.amber >= 6) {
    nextPlayer.amber -= 6;
    nextPlayer.keys += 1;
    record(state, { key: "log.forge", params: { name: nextPlayer.name } }, false);
    if (nextPlayer.keys >= 3) {
      state.winner = nextIndex;
      record(state, { key: "log.wins", params: { name: nextPlayer.name } }, false);
    }
  }

  return state;
}

export function refreshGameFaces(current: GameState, deck: DeckInfo): GameState {
  const state = cloneGame(current);
  const byId = new Map(deck.cards.map((face) => [face.id, face] as const));
  const player = state.players[0];
  for (const group of [player.deck, player.hand, player.discard, player.board]) {
    for (const card of group) card.face = byId.get(card.face.id) ?? card.face;
  }
  player.deckName = deck.name;
  state.log = [...state.log, { key: "log.synced", params: { deck: deck.name } }].slice(-14);
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