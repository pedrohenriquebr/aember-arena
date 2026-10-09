import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { setupTest } from "../../lib/testkit";
import type { GameState, LogEntry } from "../../lib/game";
import { summarizeMatch } from "./matchSummary";

const forge = (name: string, turn: number): LogEntry => ({ key: "log.forge", params: { name }, turn });

/** Partida terminada: `winner` decide quem venceu; os contadores vêm do caller. */
function finished(winner: 0 | 1, tally: Partial<Record<"amberGained" | "keys" | "cardsPlayed", number>> = {}): GameState {
  const state = setupTest({}, {});
  state.winner = winner;
  state.turn = 9;
  Object.assign(state.players[winner], tally);
  return state;
}

describe("summarizeMatch", () => {
  it("é null enquanto a partida não acabou", () => {
    expect(summarizeMatch(setupTest({}, {}))).toBeNull();
  });

  it("vitória do jogador: lê os seis stats de cada lado e as rodadas", () => {
    const state = finished(0, { amberGained: 12, keys: 3, cardsPlayed: 14 });
    state.players[0].amberStolen = 2;
    state.players[0].amberCaptured = 1;
    state.players[0].creaturesDestroyed = 4;
    state.players[1].amberGained = 5;
    state.players[1].keys = 1;
    const summary = summarizeMatch(state);
    expect(summary).not.toBeNull();
    expect(summary?.winner).toBe(0);
    expect(summary?.rounds).toBe(9);
    expect(summary?.seed).toBe(state.seed);
    expect(summary?.sides[0]).toEqual({ amberGained: 12, amberStolen: 2, amberCaptured: 1, creaturesDestroyed: 4, cardsPlayed: 14, keys: 3 });
    expect(summary?.sides[1]).toEqual({ amberGained: 5, amberStolen: 0, amberCaptured: 0, creaturesDestroyed: 0, cardsPlayed: 0, keys: 1 });
  });

  it("vitória do Warden: o vencedor vem do estado, não de quem jogou", () => {
    const summary = summarizeMatch(finished(1, { keys: 3 }));
    expect(summary?.winner).toBe(1);
    expect(summary?.sides[1].keys).toBe(3);
  });

  it("vitória especial sem chaves: não quebra e a timeline fica vazia", () => {
    const state = finished(1);
    state.log = [{ key: "log.wins", params: { name: "The Ember Warden" }, turn: 9 }];
    const summary = summarizeMatch(state);
    expect(summary?.winner).toBe(1);
    expect(summary?.sides[1].keys).toBe(0);
    expect(summary?.forgeTimeline).toEqual([]);
  });

  it("log vazio: timeline vazia", () => {
    const state = finished(0, { keys: 3 });
    state.log = [];
    expect(summarizeMatch(state)?.forgeTimeline).toEqual([]);
  });

  it("save legado sem tallies: os contadores valem zero", () => {
    const state = finished(0);
    for (const player of state.players) {
      delete (player as Partial<typeof player>).amberGained;
      delete (player as Partial<typeof player>).cardsPlayed;
      delete (player as Partial<typeof player>).creaturesDestroyed;
    }
    const summary = summarizeMatch(state);
    expect(summary?.sides[0].amberGained).toBe(0);
    expect(summary?.sides[0].cardsPlayed).toBe(0);
    expect(summary?.sides[1].creaturesDestroyed).toBe(0);
  });

  it("timeline: atribui cada chave ao lado pelo nome cru do log, na ordem", () => {
    const state = finished(0, { keys: 2 });
    state.log = [forge("You", 3), { key: "log.reap", params: { name: "You", card: "x" }, turn: 3 }, forge("The Ember Warden", 5), forge("You", 7)];
    expect(summarizeMatch(state)?.forgeTimeline).toEqual([
      { side: 0, turn: 3 },
      { side: 1, turn: 5 },
      { side: 0, turn: 7 },
    ]);
  });

  it("timeline: nome que não bate com nenhum lado é descartado (sem chutar o jogador)", () => {
    const state = finished(0);
    state.log = [forge("Alguém", 2)];
    expect(summarizeMatch(state)?.forgeTimeline).toEqual([]);
  });

  it("timeline: nomes iguais nos dois lados são ambíguos e somem", () => {
    const state = finished(0);
    state.players[1] = { ...state.players[1], name: state.players[0].name };
    state.log = [forge(state.players[0].name, 4)];
    expect(summarizeMatch(state)?.forgeTimeline).toEqual([]);
  });

  it("pass-and-play: os nomes neutros do 2P atribuem o lado", () => {
    const state = finished(1);
    state.players[0] = { ...state.players[0], name: "Player 1" };
    state.players[1] = { ...state.players[1], name: "Player 2" };
    state.log = [forge("Player 2", 6)];
    expect(summarizeMatch(state)?.forgeTimeline).toEqual([{ side: 1, turn: 6 }]);
  });

  it("não importa nada de React", () => {
    const source = readFileSync(new URL("./matchSummary.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["']react/);
  });
});
