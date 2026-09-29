// FX layer contract (docs/ANIMATIONS_PLAN.md §0): os efeitos são uma REVELAÇÃO
// de um estado que já foi commitado — o GameState nunca ganha uma lista de
// eventos (regra 2 do CLAUDE.md). Tudo é derivado do diff `prev → next`, que o
// App já tem em mãos, então undo/log/stats/save/replay seguem intactos.
import type { GameState } from "./game";

/** Lados do motor (o tipo Side não é exportado por game.ts). */
export type FxSide = 0 | 1;

/**
 * `enter`: a carta chegou ao board (o id da carta jogada é o próprio destino do
 * voo — `placeCreature` preserva o instanceId do clone).
 * `leave`: saiu do board (destruída, devolvida, arquivada, descartada).
 */
export type FxEvent =
  | { kind: "enter"; side: FxSide; id: string }
  | { kind: "leave"; side: FxSide; id: string };

const boardIds = (state: GameState, side: FxSide) => new Set(state.players[side].board.map((card) => card.instanceId));

/** Eventos de uma transição. Determinístico: lados 0 e 1, e dentro de cada lado
    a ordem do board — o mesmo par de estados sempre gera a mesma lista. */
export function diffFx(prev: GameState, next: GameState): FxEvent[] {
  const events: FxEvent[] = [];
  for (const side of [0, 1] as const) {
    // O set do board anterior também responde pelo `leave`: apagar o que entrou
    // deixa nele exatamente quem saiu.
    const before = boardIds(prev, side);
    for (const card of next.players[side].board) {
      if (!before.delete(card.instanceId)) events.push({ kind: "enter", side, id: card.instanceId });
    }
    for (const card of prev.players[side].board) {
      if (before.has(card.instanceId)) events.push({ kind: "leave", side, id: card.instanceId });
    }
  }
  return events;
}

/** Caixa em coordenadas de viewport (os ghosts são position: fixed). Um
    DOMRect é um snapshot: sobrevive ao commit que troca o DOM. */
export type FxRect = DOMRect;

/** Nó medido antes do commit + o clone do que ele desenhava. O clone é
    necessário porque o DOM de origem (a mão, uma peça destruída) muda ou some
    no setGame — depois dele ninguém mais pode desenhá-lo. */
export type FxSource = { rect: FxRect; node: HTMLElement | null };

/** Plano de uma revelação. O diretor (FxLayer) só executa; quem decide é o App.
    O guard de movimento vive lá: com animações desligadas não nasce plano. */
export type FxPlan = {
  /** Origem do voo (mão do jogador ou avatar do Warden). */
  from?: FxSource;
  /** `enter` da carta jogada: onde o ghost aterrissa. */
  destId?: string;
  /** Pausa no centro: a carta do Warden fica mais tempo (precisa ser lida). */
  holdMs: number;
  /** Peças que saíram do board: cada uma desvanece no lugar em vez de sumir. */
  gone?: FxSource[];
  /** No início do SLAM (VAL-04: o pouso do som), com o ghost já no destino. */
  onSlam?: () => void;
};

/** Diretor imperativo do portal de FX (FxLayer). */
export type FxDirector = {
  /** Revela uma transição já commitada; resolve no pouso (o loop da IA espera). */
  run(plan: FxPlan): Promise<void>;
  /** Pula tudo para o fim e limpa todo data-fx. O estado já está certo, então
      "pular" a animação nunca dessincroniza nada. */
  cancelAll(): void;
};

/** Guard de movimento: sem isto o voo ignoraria o toggle de animações. */
export function motionEnabled(animations: boolean): boolean {
  return animations && !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}
