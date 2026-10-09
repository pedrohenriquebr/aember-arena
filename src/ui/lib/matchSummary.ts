import type { GamePlayer, GameState } from "../../lib/game";

// UX_REWRITE_PLAN §5 H-21: o resumo de fim de partida é dado puro. A tela de resultado (S9)
// só desenha o que sai daqui; nada de React nem de i18n neste arquivo.

export interface SideStats {
  amberGained: number;
  amberStolen: number;
  amberCaptured: number;
  creaturesDestroyed: number;
  cardsPlayed: number;
  keys: number;
}

export interface MatchSummary {
  winner: 0 | 1;
  rounds: number;
  seed: string | number;
  sides: [SideStats, SideStats];
  /** Chaves forjadas, na ordem do log (`log.forge`), com a rodada em que aconteceram. */
  forgeTimeline: { side: 0 | 1; turn: number }[];
}

/** Saves antigos não têm os contadores (FEAT-06): `?? 0` lê o que falta como zero. */
function sideStatsOf(player: GamePlayer): SideStats {
  return {
    amberGained: player.amberGained ?? 0,
    amberStolen: player.amberStolen ?? 0,
    amberCaptured: player.amberCaptured ?? 0,
    creaturesDestroyed: player.creaturesDestroyed ?? 0,
    cardsPlayed: player.cardsPlayed ?? 0,
    keys: player.keys ?? 0,
  };
}

/**
 * O log grava `name: player.name` (o nome cru do estado: "You", "The Ember Warden",
 * "Player 1"/"Player 2"), então o lado sai da comparação com os nomes dos dois
 * jogadores. Fallback: se o nome não bate com nenhum lado OU bate com os dois, a
 * entrada é descartada — chutar o lado mostraria a chave no jogador errado.
 * O log tem teto (LOG_SIZE): em partidas longas a timeline pode começar tarde;
 * `sides[i].keys` é a contagem autoritativa.
 */
function forgeTimelineOf(game: GameState): MatchSummary["forgeTimeline"] {
  const [first, second] = game.players;
  const timeline: MatchSummary["forgeTimeline"] = [];
  for (const entry of game.log) {
    if (entry.key !== "log.forge") continue;
    const isFirst = entry.params.name === first.name;
    const isSecond = entry.params.name === second.name;
    if (isFirst === isSecond) continue;
    timeline.push({ side: isFirst ? 0 : 1, turn: entry.turn });
  }
  return timeline;
}

/** Null enquanto a partida não acabou. */
export function summarizeMatch(game: GameState): MatchSummary | null {
  if (game.winner === null) return null;
  return {
    winner: game.winner,
    rounds: game.turn,
    seed: game.seed,
    sides: [sideStatsOf(game.players[0]), sideStatsOf(game.players[1])],
    forgeTimeline: forgeTimelineOf(game),
  };
}
