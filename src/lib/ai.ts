import {
  applyMove,
  chooseHouse,
  conditionHolds,
  endTurn,
  getLegalMoves,
  keyCost,
  moveHasEffect,
  type GameMove,
  type GameState,
} from "./game";
import { rulesOf } from "./abilities";
import { canResolve, seededValue } from "./game";

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
  /** Minimise over the opponent's best reply at the leaves (a real minimax layer). */
  reply: boolean;
  /** Easy plays cards whose abilities cannot resolve; Medium+ prunes them
      through the engine's own conditions (FEAT-03). */
  effectAware: boolean;
  /** Hard+ values creatures by their parsed abilities and holds conditional
      plays until the condition is close (FEAT-03). */
  abilityAware: boolean;
}

const profiles: Record<Difficulty, Profile> = {
  Easy: { depthOffset: -1, randomRate: 0.38, noise: 3.4, branchLimit: 5, reply: false, effectAware: false, abilityAware: false },
  Medium: { depthOffset: 0, randomRate: 0.08, noise: 1.1, branchLimit: 7, reply: false, effectAware: true, abilityAware: false },
  Hard: { depthOffset: 1, randomRate: 0.02, noise: 0.45, branchLimit: 8, reply: true, effectAware: true, abilityAware: true },
  "Very hard": { depthOffset: 2, randomRate: 0, noise: 0.08, branchLimit: 9, reply: true, effectAware: true, abilityAware: true },
  Impossible: { depthOffset: 3, randomRate: 0, noise: 0, branchLimit: 10, reply: true, effectAware: true, abilityAware: true },
};

const SIM = { silent: true, deterministic: true } as const;

function scoreForPlayer(state: GameState, index: 0 | 1, abilityAware: boolean): number {
  const player = state.players[index];
  const creatureScore = player.board.reduce((sum, card) => {
    if (card.face.type !== "Creature") return sum + (card.face.type === "Artifact" ? 0.65 : 0.25);
    const healthLeft = Math.max(0, card.face.power - card.damage) + card.face.armor;
    const readiness = card.ready && !card.stunned ? 0.85 : 0;
    // FEAT-03 (Hard+): value by the parsed abilities whose conditions hold
    // right now (reap/fight/action), replacing the raw-text regex guess.
    const textValue = abilityAware
      ? rulesOf(card.face).abilities.filter(
          (ability) =>
            ability.on.some((trigger) => trigger === "reap" || trigger === "fight" || trigger === "action" || trigger === "omni") &&
            canResolve(state, index, card, ability),
        ).length * 0.34
      : /(?:steal|capture|forge|gain)/i.test(card.face.text)
        ? 0.28
        : 0;
    return sum + 0.85 + card.face.power * 0.38 + Math.min(healthLeft, 4) * 0.12 + readiness + textValue - (card.amber ?? 0) * 0.9;
  }, 0);
  const handScore = [...player.hand, ...player.archives].reduce(
    (sum, card) => sum + 0.27 + card.face.amber * 0.18 + (card.face.type === "Creature" ? card.face.power * 0.07 : 0),
    0,
  );
  const cost = keyCost(state, index);
  const forgePressure = player.amber >= cost ? 2.8 : player.amber >= cost - 2 ? 0.45 : 0;
  return player.keys * 13 + player.amber * 1.2 + creatureScore + handScore + forgePressure - player.chains * 0.16;
}

export function evaluatePosition(state: GameState, aiIndex: 0 | 1, abilityAware = false): number {
  if (state.winner === aiIndex) return 10000;
  if (state.winner !== null) return -10000;
  const opponentIndex = aiIndex === 0 ? 1 : 0;
  return scoreForPlayer(state, aiIndex, abilityAware) - scoreForPlayer(state, opponentIndex, abilityAware);
}

/** Legal moves worth searching: Medium+ never discards and never plays/uses
    whose abilities cannot resolve (the engine's own conditions) unless nothing
    else is left; Easy happily plays dead cards (FEAT-03). */
function candidateMoves(state: GameState, actor: 0 | 1, effectAware = true): GameMove[] {
  const legal = getLegalMoves(state, actor, state.activeHouse).filter((move) => move.type !== "discard");
  if (!effectAware) return legal;
  const useful = legal.filter((move) => moveHasEffect(state, actor, move));
  return useful.length ? useful : legal.filter((move) => move.type === "play");
}

/** The opponent's best single answer after this turn ends (worst case for the AI). */
function replyValue(state: GameState, aiIndex: 0 | 1, budget: Budget, profile: Profile): number {
  if (budget.nodes >= budget.max) return evaluatePosition(state, aiIndex, profile.abilityAware);
  const next = endTurn(state, aiIndex);
  if (next.winner !== null) return evaluatePosition(next, aiIndex, profile.abilityAware);
  const rival = next.activePlayer;
  let worst = Infinity;
  for (const house of next.players[rival].houses) {
    const turn = chooseHouse(next, rival, house);
    worst = Math.min(worst, evaluatePosition(turn, aiIndex, profile.abilityAware));
    for (const move of candidateMoves(turn, rival, profile.effectAware)) {
      budget.nodes += 1;
      worst = Math.min(worst, evaluatePosition(applyMove(turn, rival, move, SIM), aiIndex, profile.abilityAware));
    }
  }
  return worst;
}

interface Budget {
  nodes: number;
  max: number;
}

/** Best value reachable by the AI from here this turn: stopping is always an
    option, so the search never forces a harmful move. */
function search(state: GameState, aiIndex: 0 | 1, depth: number, profile: Profile, budget: Budget): number {
  const stop = profile.reply && state.winner === null ? replyValue(state, aiIndex, budget, profile) : evaluatePosition(state, aiIndex, profile.abilityAware);
  if (depth <= 0 || state.winner !== null || budget.nodes >= budget.max) return stop;
  const moves = candidateMoves(state, aiIndex, profile.effectAware);
  budget.nodes += moves.length;
  const ordered = moves
    .map((move) => ({ next: applyMove(state, aiIndex, move, SIM) }))
    .map((item) => ({ ...item, score: evaluatePosition(item.next, aiIndex) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, profile.branchLimit);
  let best = stop;
  for (const item of ordered) {
    best = Math.max(best, search(item.next, aiIndex, depth - 1, profile, budget));
    if (budget.nodes >= budget.max) break;
  }
  return best;
}

export function chooseAiHouse(state: GameState, aiIndex: 0 | 1): string {
  const player = state.players[aiIndex];
  const houses = player.houses.length ? player.houses : [...new Set(player.hand.map((card) => card.face.house))];
  if (!houses.length) return "Logos";

  return houses
    .map((house) => {
      const turn = chooseHouse(state, aiIndex, house);
      const moves = state.activePlayer === aiIndex ? candidateMoves(turn, aiIndex) : [];
      const cards = player.hand.filter((card) => card.face.house === house);
      const playValue = cards.reduce(
        (sum, card) => sum + 0.8 + card.face.amber * 0.6 + (card.face.type === "Creature" ? card.face.power * 0.13 : 0),
        0,
      );
      const boardValue = moves.filter((move) => move.type !== "play").length * 0.9;
      return { house, score: playValue + boardValue };
    })
    .sort((a, b) => b.score - a.score)[0].house;
}

function moveSourceFace(state: GameState, side: 0 | 1, move: GameMove) {
  const player = state.players[side];
  const id = move.type === "fight" ? move.attackerId : move.instanceId;
  return [...player.hand, ...player.board].find((card) => card.instanceId === id)?.face ?? player.hand[0]?.face;
}

export function chooseAiMove(
  state: GameState,
  aiIndex: 0 | 1,
  house: string,
  settings: AiSettings,
): GameMove | null {
  const view = state.activeHouse ? state : { ...state, activeHouse: house };
  const profile = profiles[settings.difficulty];
  const legal = candidateMoves(view, aiIndex, profile.effectAware);
  if (!legal.length) return null;
  // FEAT-08: the AI draws from the match seed instead of Math.random; the local
  // cursor keeps chooseAiMove pure (same state in, same answer out).
  let calls = state.rngCalls;
  const roll = () => seededValue(state.seed, (calls += 1));
  if (roll() < profile.randomRate) {
    return legal[Math.floor(roll() * legal.length)];
  }

  const depth = Math.max(1, Math.min(6, settings.thinkingDepth + profile.depthOffset));
  // Counted in simulated moves: keeps a phone-class device well under the
  // 340 ms pause App.tsx leaves between AI actions.
  const budget = { nodes: 0, max: 700 + depth * 250 };

  const scored = legal
    .map((move) => {
      const next = applyMove(view, aiIndex, move, SIM);
      // FEAT-03 (Hard+): playing a card whose printed condition is not met yet
      // spends it for nothing — hold it and let the search find the setup.
      const heldBack = profile.abilityAware
        ? -0.45 * rulesOf(moveSourceFace(view, aiIndex, move)).abilities.filter(
            (ability) => ability.on.includes("play") && ability.if && !conditionHolds(ability.if, view, aiIndex),
          ).length
        : 0;
      return { move, value: search(next, aiIndex, depth - 1, profile, budget) + heldBack + (roll() - 0.5) * profile.noise };
    })
    .sort((a, b) => b.value - a.value);

  // Ending the turn is always legal: stop when every move makes the position worse
  // (e.g. a board wipe that only hits the AI's own creatures).
  const stop = profile.reply ? replyValue(view, aiIndex, { nodes: 0, max: budget.max }, profile) : evaluatePosition(view, aiIndex, profile.abilityAware);
  return scored[0] && scored[0].value >= stop - profile.noise / 2 ? scored[0].move : null;
}

export function describeAiThinking(settings: AiSettings): string {
  const profile = profiles[settings.difficulty];
  const depth = Math.max(1, Math.min(6, settings.thinkingDepth + profile.depthOffset));
  return `${settings.difficulty} / ${depth} ${depth === 1 ? "ply" : "plies"}`;
}

