// SPDX-License-Identifier: AGPL-3.0-only
// M2 · Bingle Bangbang (kt:722:043): "Before Fight: Deal 5 to each neighbor of the creature Bingle
// Bangbang fights." Bancada do TEXTO IMPRESSO (corpus), sem linha vendored.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyMove, type GameState } from "./game";
import { card, setupTest } from "./testkit";

const ID = "kt:722:043:brobnar";
const { title: TITLE, text: TEXT } = (JSON.parse(readFileSync(join(process.cwd(), "scripts", "harvest", "cards-corpus.json"), "utf8")) as { id: string; title: string; text: string }[]).find((c) => c.id === ID)!;

const bingle = () => card(TITLE, { id: ID, type: "Creature", house: "Brobnar", power: 9, armor: 0, text: TEXT });
const unit = (title: string, power: number, house = "Untamed") => card(title, { type: "Creature", house, power, armor: 0, text: "" });
const onBoard = (state: GameState, side: 0 | 1, instanceId: string) => state.players[side].board.find((c) => c.instanceId === instanceId);

describe("M2 · Bingle Bangbang — antes da luta, 5 de dano em cada vizinho do alvo", () => {
  it("os dois vizinhos do alvo levam 5; o alvo só leva o dano da luta; Bingle e os vizinhos dela não", () => {
    const b = bingle();
    const amiga1 = unit("Amiga 1", 9, "Brobnar");
    const amiga2 = unit("Amiga 2", 9, "Brobnar");
    const left = unit("Vizinho E", 9);
    const alvo = unit("Alvo", 1);
    const right = unit("Vizinho D", 9);
    const state = setupTest({ inPlay: [amiga1, b, amiga2] }, { inPlay: [left, alvo, right] }, "Brobnar");
    const after = applyMove(state, 0, { type: "fight", attackerId: b.instanceId, targetId: alvo.instanceId }) as GameState;
    expect(onBoard(after, 1, left.instanceId)?.damage).toBe(5);
    expect(onBoard(after, 1, right.instanceId)?.damage).toBe(5);
    // O alvo morre na luta (power 1, dano 9 de Bingle) e não recebe o 5 do Before Fight a mais.
    expect(onBoard(after, 1, alvo.instanceId)).toBeUndefined();
    expect(onBoard(after, 0, amiga1.instanceId)?.damage).toBe(0);
    expect(onBoard(after, 0, amiga2.instanceId)?.damage).toBe(0);
    // Bingle leva só o contra-dano do alvo (power 1), nunca os 5 do próprio gatilho.
    expect(onBoard(after, 0, b.instanceId)?.damage).toBe(1);
  });

  it("alvo na ponta da battleline: só o vizinho que existe leva 5", () => {
    const b = bingle();
    const alvo = unit("Alvo ponta", 1);
    const right = unit("Vizinho único", 9);
    const state = setupTest({ inPlay: [b] }, { inPlay: [alvo, right] }, "Brobnar");
    const after = applyMove(state, 0, { type: "fight", attackerId: b.instanceId, targetId: alvo.instanceId }) as GameState;
    expect(onBoard(after, 1, right.instanceId)?.damage).toBe(5);
    expect(onBoard(after, 1, right.instanceId)?.damage).not.toBe(10);
  });
});
