// UX_REWRITE_PLAN §5 H-24: os três coachmarks da partida guiada. A máquina é PURA: avança por
// transição observada no estado de jogo (casa escolhida, cartas jogadas, troca de vez), nunca
// por um clique no balão. Passo fora de ordem não avança; pular encerra.

export type CoachStep = "pickHouse" | "playCard" | "endTurn" | "done";

export const COACH_KEY = "aember-arena-coach";
const STEPS: readonly CoachStep[] = ["pickHouse", "playCard", "endTurn", "done"];

/** O que a máquina observa do jogo: só o que o jogador vê mudar. */
export interface CoachSnapshot {
  /** Casa escolhida no turno; null antes da escolha. */
  activeHouse: string | null;
  /** Cartas jogadas pelo jogador (o contador do estado, não o texto do log). */
  cardsPlayed: number;
  /** Vez do jogador. A troca de vez é o fim do turno: `state.turn` conta rodadas, não turnos. */
  yourTurn: boolean;
}

/** Um passo por transição. Só o passo atual pode ser avançado: o resto fica onde está. */
export function advanceCoach(step: CoachStep, prev: CoachSnapshot, next: CoachSnapshot): CoachStep {
  switch (step) {
    case "pickHouse":
      return prev.activeHouse === null && next.activeHouse !== null && next.yourTurn ? "playCard" : step;
    case "playCard":
      return next.cardsPlayed > prev.cardsPlayed ? "endTurn" : step;
    case "endTurn":
      return prev.yourTurn && !next.yourTurn ? "done" : step;
    case "done":
      return step;
  }
}

/** Pular encerra de qualquer passo. */
export function skipCoach(): CoachStep {
  return "done";
}

/** Número do balão (1 a 3) ou null quando não há balão. */
export function coachIndex(step: CoachStep): number | null {
  const index = STEPS.indexOf(step);
  return step === "done" ? null : index + 1;
}

/** Ausente ou fora do formato vira "done": nunca mostra dica sem partida guiada gravada. */
export function parseCoach(raw: string | null): CoachStep {
  return raw === "pickHouse" || raw === "playCard" || raw === "endTurn" ? raw : "done";
}

/** Storage do passo. A partida guiada começa em "pickHouse"; sem storage não há coachmark. */
export function readCoach(): CoachStep {
  try {
    return parseCoach(localStorage.getItem(COACH_KEY));
  } catch {
    return "done";
  }
}

export function writeCoach(step: CoachStep): void {
  try {
    localStorage.setItem(COACH_KEY, step);
  } catch {
    // Sem storage a dica segue só nesta sessão.
  }
}
