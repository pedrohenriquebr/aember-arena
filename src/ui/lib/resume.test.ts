import { describe, expect, it } from "vitest";
import { createMatch } from "../../lib/game";
import { DEMO_DECK } from "../../lib/demoDeck";
import { DEMO_DECK_2 } from "../../lib/demoDeck2";
import { KEYS_TO_WIN, resumeInfoOf } from "./resume";

describe("resumeInfoOf (UX_REWRITE_PLAN §2 S2, card Continuar)", () => {
  it("lê rodada e chaves dos dois lados sem mutar o estado", () => {
    const game = createMatch(DEMO_DECK, DEMO_DECK_2, { seed: 7 });
    const before = JSON.stringify(game);
    const info = resumeInfoOf(game, false);
    expect(info).toEqual({ round: game.turn, youKeys: game.players[0].keys, wardenKeys: game.players[1].keys, twoPlayers: false });
    expect(JSON.stringify(game)).toBe(before);
  });

  it("marca pass-and-play para o card usar Jogador 1/2", () => {
    const game = createMatch(DEMO_DECK, DEMO_DECK_2, { seed: 7 });
    expect(resumeInfoOf(game, true).twoPlayers).toBe(true);
  });

  it("a meta de chaves é a da regra do motor", () => {
    expect(KEYS_TO_WIN).toBe(3);
  });
});
