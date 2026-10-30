// SPDX-License-Identifier: AGPL-3.0-only
// M2 · Com. Officer Palik (cbe0466a): "Versatile. After Fight/After Reap: A friendly creature
// captures 1." Bancada do TEXTO IMPRESSO (corpus), sem linha vendored.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyMove, getLegalMoves, type GameState } from "./game";
import { card, setupTest } from "./testkit";

const ID = "cbe0466a-7a00-4816-b2e3-db7e750b90d1";
const { title: TITLE, text: TEXT } = (JSON.parse(readFileSync(join(process.cwd(), "scripts", "harvest", "cards-corpus.json"), "utf8")) as { id: string; title: string; text: string }[]).find((c) => c.id === ID)!;

const palik = () => card(TITLE, { id: ID, type: "Creature", house: "Star Alliance", power: 3, armor: 0, text: TEXT });
const ally = () => card("Aliada", { type: "Creature", house: "Star Alliance", power: 2, armor: 0, text: "" });
const foe = () => card("Inimiga", { type: "Creature", house: "Brobnar", power: 1, armor: 0, text: "" });

// "Capture" põe o âmbar capturado NA criatura (CardInstance.amber), não na pool de quem jogou.
const capturedOn = (state: GameState, side: 0 | 1, instanceId: string) => state.players[side].board.find((c) => c.instanceId === instanceId)?.amber ?? 0;

describe("M2 · Com. Officer Palik — após reap/luta, uma criatura amiga captura 1", () => {
  it("After Reap: a criatura amiga escolhida captura 1 do oponente (o +1 da minha pool é o do próprio reap)", () => {
    const p = palik();
    const a = ally();
    const state = setupTest({ inPlay: [p, a] }, { inPlay: [foe()], amber: 2 }, "Star Alliance");
    const after = applyMove(state, 0, { type: "reap", instanceId: p.instanceId, target: a.instanceId }) as GameState;
    expect(after.players[0].amber).toBe(1);
    expect(after.players[1].amber).toBe(1);
    expect(capturedOn(after, 0, a.instanceId)).toBe(1);
  });

  it("After Fight: capturar acontece depois da luta, com a amiga escolhida como alvo (sem reap, sem âmbar meu)", () => {
    const p = palik();
    const a = ally();
    const f = foe();
    const state = setupTest({ inPlay: [p, a] }, { inPlay: [f], amber: 2 }, "Star Alliance");
    const after = applyMove(state, 0, { type: "fight", attackerId: p.instanceId, targetId: f.instanceId, target: a.instanceId }) as GameState;
    expect(after.players[0].amber).toBe(0);
    expect(after.players[1].amber).toBe(1);
    expect(capturedOn(after, 0, a.instanceId)).toBe(1);
  });

  it("Versatile: com outra casa ativa (Brobnar) Palik ainda pode reap como se fosse da casa ativa", () => {
    const p = palik();
    const state = setupTest({ inPlay: [p] }, { inPlay: [foe()] }, "Brobnar");
    expect(getLegalMoves(state, 0, "Brobnar").some((m) => m.type === "reap" && m.instanceId === p.instanceId)).toBe(true);
  });
});
