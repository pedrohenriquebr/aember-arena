// FX layer contract (docs/ANIMATIONS_PLAN.md §0): os efeitos são uma REVELAÇÃO
// de um estado que já foi commitado — o GameState nunca ganha uma lista de
// eventos (regra 2 do CLAUDE.md). Tudo é derivado do diff `prev → next`, que o
// App já tem em mãos, então undo/log/stats/save/replay seguem intactos.
import type { CardFace, GameState } from "./game";

/** Lados do motor (o tipo Side não é exportado por game.ts). */
export type FxSide = 0 | 1;

/**
 * `enter`: a carta chegou ao board (o id da carta jogada é o próprio destino do
 * voo — `placeCreature` preserva o instanceId do clone).
 * `leave`: saiu do board (destruída, devolvida, arquivada, descartada).
 * `amber`: o placar mudou (colheita, bônus, roubo) — é o "+N Æ" que voa.
 * `damage`: uma criatura levou dano — é o "-N" que flutua sobre ela.
 * `chains`: correntes ganhas/perdidas na compra (o elo que cai no contador).
 * `key`: uma chave foi forjada (o glow no lado de quem forjou).
 */
export type FxEvent =
  | { kind: "enter"; side: FxSide; id: string }
  | { kind: "leave"; side: FxSide; id: string }
  | { kind: "amber"; side: FxSide; delta: number }
  | { kind: "damage"; id: string; amount: number }
  | { kind: "chains"; side: FxSide; delta: number }
  | { kind: "key"; side: FxSide };

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
    const amber = next.players[side].amber - prev.players[side].amber;
    if (amber) events.push({ kind: "amber", side, delta: amber });
    const chains = next.players[side].chains - prev.players[side].chains;
    if (chains) events.push({ kind: "chains", side, delta: chains });
    if (next.players[side].keys > prev.players[side].keys) events.push({ kind: "key", side });
    for (const card of next.players[side].board) {
      const before = prev.players[side].board.find((item) => item.instanceId === card.instanceId);
      if (before && card.damage > before.damage) events.push({ kind: "damage", id: card.instanceId, amount: card.damage - before.damage });
    }
  }
  return events;
}

/** Caixa em coordenadas de viewport (os ghosts são position: fixed). Um
    DOMRect é um snapshot: sobrevive ao commit que troca o DOM. */
export type FxRect = DOMRect;

/** Nó medido antes do commit + o clone do que ele desenhava. O clone é
    necessário porque o DOM de origem (a mão, uma peça destruída) muda ou some
    no commit — depois dele ninguém mais pode desenhá-lo. `w`/`h`/`rot` só
    existem quando a origem está girada (a carta do leque 3D, H3D-08): a caixa
    projetada de um retângulo girado é maior que a carta, então o ghost nasce no
    tamanho de layout e alinhado ao leque em vez de "pular". */
export type FxSource = { rect: FxRect; node: HTMLElement | null; w?: number; h?: number; rot?: string };

/** Plano de uma revelação. O diretor (FxLayer) só executa; quem decide é o App.
    O guard de movimento vive lá: com animações desligadas não nasce plano. */
export type FxPlan = {
  /** Origem do voo (mão do jogador ou avatar do Warden). */
  from?: FxSource;
  /** `enter` da carta jogada: onde o ghost aterrissa. */
  destId?: string;
  /** Face da carta quando não há clone no DOM (o Warden joga da mão): sem ela
      a Ação não tem de onde desenhar o ghost (FX-02). */
  face?: CardFace;
  /** Pausa no centro: a carta do Warden fica mais tempo (precisa ser lida). */
  holdMs: number;
  /** Peças que saíram do board: cada uma desvanece no lugar em vez de sumir. */
  gone?: FxSource[];
  /** No início do SLAM (VAL-04: o pouso do som), com o ghost já no destino. */
  onSlam?: () => void;
  /** Legenda sob a carta em cena (a jogada do Warden precisa ser lida). */
  caption?: string;
  /** Pulso de quem age (colheita, uso, luta): o `spot` que o App já marcou. */
  actorId?: string;
  /** "+N Æ" do card que gerou para o contador do band dono (plano §4.2). */
  amber?: { side: FxSide; delta: number };
  /** "-N" sobre cada criatura que levou dano neste commit (plano §4.2). */
  hits?: { id: string; amount: number }[];
  /** Correntes ganhas: o elo cai no contador do lado (plano §4.4). */
  chains?: { side: FxSide; delta: number };
};

/** Diretor imperativo do portal de FX (FxLayer). */
export type FxDirector = {
  /** Revela uma transição já commitada; resolve no pouso (o loop da IA espera). */
  run(plan: FxPlan): Promise<void>;
  /** Pula tudo para o fim e limpa todo data-fx. O estado já está certo, então
      "pular" a animação nunca dessincroniza nada. */
  cancelAll(): void;
  /** PRE: acende quem vai agir antes do commit — marcação, não movimento, então
      vale igual no reduce-motion (o jogador precisa do ritmo). */
  spot(actorId?: string): void;
  /** Banner central de transição ("Seu turno") por ~900ms. */
  banner(text: string): void;
  /** Legenda estática (sem voo) da jogada do Warden — reduzir movimento não
      pode remover informação (FX-08). */
  caption(text: string): void;
  /** Forja de chave (plano §4.1): o glow nasce no lado de quem forjou. */
  forge(side: FxSide): void;
};

/** Guard de movimento: sem isto o voo ignoraria o toggle de animações. */
export function motionEnabled(animations: boolean): boolean {
  return animations && !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}

/** Pose orgânica (H3D-16): a mesma carta sempre com o mesmo giro — FNV-1a do id. */
export function cardJitter(id: string): { rot: number; dy: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  // Avalanche (fmix32): ids sequenciais ("cr-1", "cr-2") só mexem nos bits baixos do FNV.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  const u = (h >>> 0) / 4294967295;
  const v = ((h >>> 11) & 0xffff) / 65535;
  return { rot: Math.round((u * 2 - 1) * 16) / 10, dy: Math.round((v * 2 - 1) * 3) };
}
