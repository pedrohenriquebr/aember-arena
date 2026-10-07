// SPDX-License-Identifier: AGPL-3.0-only
// Zonas laterais da mesa (chips do HUD + overlay de pilha): o motor guarda as
// pilhas em GamePlayer.discard / GamePlayer.archives; aqui ficam só as regras de
// leitura da UI — quem pode abrir o quê e a ordem do grid do overlay.
import type { CardInstance, GamePlayer } from "./game";

export type PileKind = "discard" | "archives";

/** Regras oficiais: o descarte é público — os dois lados abrem face-up; o
    arquivo é virado — só o dono abre o seu (a qualquer momento); o do
    oponente mostra só a contagem, sem ação. */
export function canOpenPile(kind: PileKind, owner: number, viewer: number): boolean {
  return kind === "discard" || owner === viewer;
}

/** Contagem do chip (`Discard (n)` / `Archive (n)`) lida do estado vivo. */
export function pileCount(player: GamePlayer, kind: PileKind): number {
  return (kind === "discard" ? player.discard : player.archives).length;
}

/** Ordem do grid do overlay: alfabética por título (a pilha do motor guarda
    ordem de chegada, que a leitura não precisa), com desempate estável por
    tipo e instância — cartas iguais não trocam de lugar entre re-renders. */
export function sortPile(cards: readonly CardInstance[]): CardInstance[] {
  return [...cards].sort(
    (a, b) =>
      a.face.title.localeCompare(b.face.title) ||
      a.face.type.localeCompare(b.face.type) ||
      (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0),
  );
}
