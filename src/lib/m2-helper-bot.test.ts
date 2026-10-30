// SPDX-License-Identifier: AGPL-3.0-only
// M2 · Helper Bot (21359382): "Play: You may play a non-Logos card this turn." Bancada do TEXTO
// IMPRESSO (corpus), sem linha vendored. "A card" = UMA carta: o mayPlay numerado é gasto pela
// jogada que ele permitiu (game.ts), e "may" = a variante decline recusa o efeito inteiro.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyMove, getLegalMoves, type GameState } from "./game";
import { card, setupTest } from "./testkit";

const ID = "21359382-790f-4ee2-bd62-995aafbabb8f";
const { title: TITLE, text: TEXT } = (JSON.parse(readFileSync(join(process.cwd(), "scripts", "harvest", "cards-corpus.json"), "utf8")) as { id: string; title: string; text: string }[]).find((c) => c.id === ID)!;

const helper = () => card(TITLE, { id: ID, type: "Creature", house: "Logos", power: 1, armor: 0, text: TEXT });
const brob = (title: string) => card(title, { type: "Creature", house: "Brobnar", power: 2, armor: 0, text: "" });
const canPlay = (state: GameState, instanceId: string) =>
  getLegalMoves(state, 0, "Logos").some((m) => m.type === "play" && m.instanceId === instanceId);

describe("M2 · Helper Bot — permite jogar UMA carta não-Logos neste turno", () => {
  it("antes de jogar Helper Bot, carta Brobnar (casa ativa Logos) não é jogável", () => {
    const b = brob("Brobnar A");
    const state = setupTest({ hand: [helper(), b] }, {}, "Logos");
    expect(canPlay(state, b.instanceId)).toBe(false);
  });

  it("jogado Helper Bot (aceitando o may), uma carta não-Logos fica jogável; depois de jogá-la, a segunda não", () => {
    const h = helper();
    const a = brob("Brobnar A");
    const c = brob("Brobnar C");
    const state0 = setupTest({ hand: [h, a, c] }, {}, "Logos");
    const state1 = applyMove(state0, 0, { type: "play", instanceId: h.instanceId }) as GameState;
    expect(canPlay(state1, a.instanceId)).toBe(true);
    const state2 = applyMove(state1, 0, { type: "play", instanceId: a.instanceId }) as GameState;
    expect(canPlay(state2, c.instanceId)).toBe(false);
  });

  it("recusando o may (decline), a carta não-Logos continua não jogável", () => {
    const h = helper();
    const b = brob("Brobnar A");
    const state0 = setupTest({ hand: [h, b] }, {}, "Logos");
    const state1 = applyMove(state0, 0, { type: "play", instanceId: h.instanceId, decline: true }) as GameState;
    expect(canPlay(state1, b.instanceId)).toBe(false);
  });
});
