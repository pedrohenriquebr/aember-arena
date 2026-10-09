import type { GameState } from "../../lib/game";

/** Chaves para vencer. Espelha a regra do motor (game.ts: `keys >= 3`); a UI só exibe. */
export const KEYS_TO_WIN = 3;

/** O que o card "Continuar" mostra de uma partida viva ou salva (UX_REWRITE_PLAN §2 S2). */
export interface ResumeInfo {
  round: number;
  youKeys: number;
  wardenKeys: number;
  /** Pass-and-play: os lados são Jogador 1 e 2, não Você e Warden. */
  twoPlayers: boolean;
}

/** Lê o estado de uma partida sem alterá-la. Lado 0 é o jogador (ou o Jogador 1). */
export function resumeInfoOf(game: GameState, twoPlayers: boolean): ResumeInfo {
  return {
    round: game.turn,
    youKeys: game.players[0].keys,
    wardenKeys: game.players[1].keys,
    twoPlayers,
  };
}
