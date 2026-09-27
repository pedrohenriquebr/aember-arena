import { applyMove, getLegalMoves, type GameMove, type GameState } from "./game";

export type Difficulty = "Easy" | "Medium" | "Hard" | "Very hard" | "Impossible";

export interface AiSettings {
  difficulty: Difficulty;
  thinkingDepth: number;
}

interface Profile {
  depthOffset: number;
  randomRate: number;
  noise: number;
  branchLimit: number;
}

const profiles: Record<Difficulty, Profile> = {
  Easy: { depthOffset: -1, randomRate: 0.38, noise: 3.4, branchLimit: 5 },
  Medium: { depthOffset: 0, randomRate: 0.08, noise: 1.1, branchLimit: 7 },
  Hard: { depthOffset: 1, randomRate: 0.02, noise: 0.45, branchLimit: 8 },
  "Very hard": { depthOffset: 2, randomRate: 0, noise: 0.08, branchLimit: 9 },
  Impossible: { depthOffset: 3, randomRate: 0, noise: 0, branchLimit: 10 },
};

function scoreForPlayer(state: GameState, index: 0 | 1): number {
  const player = state.players[index];
  const creatureScore = player.board.reduce((sum, card) => {
    if (card.face.type !== "Creature") return sum + (card.face.type === "Artifact" ? 0.65 : 0.25);
    const healthLeft = Math.max(0, card.face.power + card.face.armor - card.damage);
    const readiness = card.ready && !card.stunned ? 0.85 : 0;
    const textValue = /(?:steal|capture|forge|gain)/i.test(card.face.text) ? 0.28 : 0;
    return sum + 0.85 + card.face.power * 0.38 + Math.min(healthLeft, 4) * 0.12 + readiness + textValue;
  }, 0);
  const handScore = player.hand.reduce(
    (sum, card) => sum + 0.27 + card.face.amber * 0.18 + (card.face.type === "Creature" ? card.face.power * 0.07 : 0),
    0,
  );
  const forgePressure = player.amber >= 6 ? 2.8 : player.amber >= 4 ? 0.45 : 0;
  return player.keys * 13 + player.amber * 1.2 + creatureScore + handScore + forgePressure - player.chains * 0.16;
}

export function evaluatePosition(state: GameState, aiIndex: 0 | 1): number {
  if (state.winner === aiIndex) return 10000;
  if (state.winner !== null) return -10000;
  const opponentIndex = aiIndex === 0 ? 1 : 0;
  return scoreForPlayer(state, aiIndex) - scoreForPlayer(state, opponentIndex);
}

function movePriority(state: GameState, actor: 0 | 1, move: GameMove, aiIndex: 0 | 1): number {
  const after = applyMove(state, actor, move, { silent: true, deterministic: true });
  const score = evaluatePosition(after, aiIndex);
  return move.type === "play" ? score + 0.12 : score;
}

function minimax(
  state: GameState,
  actor: 0 | 1,
  aiIndex: 0 | 1,
  depth: number,
  alpha: number,
  beta: number,
  profile: Profile,
  budget: { nodes: number; max: number },
): number {
  if (depth <= 0 || state.winner !== null || budget.nodes >= budget.max) {
    return evaluatePosition(state, aiIndex);
  }

  budget.nodes += 1;
  const maximizing = actor === aiIndex;
  const moves = getLegalMoves(state, actor, null);
  if (!moves.length) return evaluatePosition(state, aiIndex);

  const ordered = moves
    .map((move) => ({ move, score: movePriority(state, actor, move, aiIndex) }))
    .sort((a, b) => (maximizing ? b.score - a.score : a.score - b.score))
    .slice(0, profile.branchLimit);

  let best = maximizing ? -Infinity : Infinity;
  for (const item of ordered) {
    const next = applyMove(state, actor, item.move, { silent: true, deterministic: true });
    const nextActor = actor === 0 ? 1 : 0;
    const value = minimax(next, nextActor, aiIndex, depth - 1, alpha, beta, profile, budget);
    if (maximizing) {
      best = Math.max(best, value);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, value);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha || budget.nodes >= budget.max) break;
  }
  return best;
}

export function chooseAiHouse(state: GameState, aiIndex: 0 | 1): string {
  const player = state.players[aiIndex];
  const houses = player.houses.length ? player.houses : [...new Set(player.hand.map((card) => card.face.house))];
  if (!houses.length) return "Logos";

  return houses
    .map((house) => {
      const cards = player.hand.filter((card) => card.face.house === house || card.face.isMaverick);
      const readyCards = player.board.filter(
        (card) => card.face.house === house && card.ready && !card.stunned,
      );
      const playValue = cards.reduce(
        (sum, card) => sum + 0.8 + card.face.amber * 0.6 + (card.face.type === "Creature" ? card.face.power * 0.13 : 0),
        0,
      );
      const useValue = readyCards.reduce(
        (sum, card) => sum + (card.face.type === "Creature" ? 1.25 : /(?:Action|Omni):/i.test(card.face.text) ? 0.9 : 0),
        0,
      );
      return { house, score: playValue + useValue };
    })
    .sort((a, b) => b.score - a.score)[0].house;
}

export function chooseAiMove(
  state: GameState,
  aiIndex: 0 | 1,
  house: string,
  settings: AiSettings,
): GameMove | null {
  const legal = getLegalMoves(state, aiIndex, house);
  if (!legal.length) return null;

  const profile = profiles[settings.difficulty];
  if (Math.random() < profile.randomRate) {
    return legal[Math.floor(Math.random() * legal.length)];
  }

  const depth = Math.max(1, Math.min(6, settings.thinkingDepth + profile.depthOffset));
  const budget = { nodes: 0, max: 6500 + depth * 1800 };
  const opponentIndex = aiIndex === 0 ? 1 : 0;
  const alphaBeta: { alpha: number; beta: number } = { alpha: -Infinity, beta: Infinity };

  const scored = legal
    .map((move) => {
      const next = applyMove(state, aiIndex, move, { silent: true, deterministic: true });
      const value = minimax(
        next,
        opponentIndex,
        aiIndex,
        depth - 1,
        alphaBeta.alpha,
        alphaBeta.beta,
        profile,
        budget,
      );
      alphaBeta.alpha = Math.max(alphaBeta.alpha, value);
      return { move, value: value + (Math.random() - 0.5) * profile.noise };
    })
    .sort((a, b) => b.value - a.value);

  return scored[0]?.move ?? legal[0];
}

export function describeAiThinking(settings: AiSettings): string {
  const profile = profiles[settings.difficulty];
  const depth = Math.max(1, Math.min(6, settings.thinkingDepth + profile.depthOffset));
  return `${settings.difficulty} / ${depth} ${depth === 1 ? "ply" : "plies"}`;
}