// SPDX-License-Identifier: AGPL-3.0-only
// M1 · First Blood (0ec85771): "Alpha. Play: Deal 2D for each friendly Brobnar creature.
// You may divide this damage among any number of creatures." Bancada do TEXTO IMPRESSO
// (corpus), sem linha vendored: o parser puro precisa cumprir tudo.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyMove, getLegalMoves } from "./game";
import { card, setupTest } from "./testkit";

const ID = "0ec85771-8143-4d64-8c3a-ce48bce4e81c";
const TEXT = (JSON.parse(readFileSync(join(process.cwd(), "scripts", "harvest", "cards-corpus.json"), "utf8")) as { id: string; text: string }[]).find((c) => c.id === ID)!.text;

const firstBlood = () => card("First Blood", { id: ID, type: "Action", house: "Brobnar", text: TEXT });
const brob = (title: string) => card(title, { type: "Creature", house: "Brobnar", power: 3, armor: 0, text: "" });
const foe = (title: string, house = "Untamed") => card(title, { type: "Creature", house, power: 9, armor: 0, text: "" });
const damageOf = (state: ReturnType<typeof setupTest>, side: 0 | 1, title: string) =>
  state.players[side].board.find((c) => c.face.title === title)?.damage ?? -1;

describe("M1 · First Blood — 2D por criatura Brobnar amiga", () => {
  it("soma 2 por criatura Brobnar amiga (2 amigas = 4) e não conta Brobnar inimiga nem amiga de outra casa", () => {
    const fb = firstBlood();
    const state = setupTest(
      { hand: [fb], inPlay: [brob("Amiga A"), brob("Amiga B"), card("Untamed amiga", { type: "Creature", house: "Untamed", power: 3, armor: 0, text: "" })] },
      { inPlay: [foe("Alvo"), foe("Brobnar inimiga", "Brobnar")] },
      "Brobnar",
    );
    // Um único alvo recebe a soma inteira: se a Brobnar inimiga contasse, seriam 6.
    const after = applyMove(state, 0, { type: "play", instanceId: fb.instanceId, targets: [state.players[1].board[0].instanceId] });
    expect(damageOf(after, 1, "Alvo")).toBe(4);
  });

  // A divisão é escolha de quem joga: o motor reparte a soma, o texto só garante a soma total.
  it("dividir: entre dois alvos a soma (4) é toda aplicada e os dois alvos recebem dano", () => {
    const fb = firstBlood();
    const state = setupTest({ hand: [fb], inPlay: [brob("Amiga A"), brob("Amiga B")] }, { inPlay: [foe("Alvo 1"), foe("Alvo 2")] }, "Brobnar");
    const [a1, a2] = state.players[1].board;
    const after = applyMove(state, 0, { type: "play", instanceId: fb.instanceId, targets: [a1.instanceId, a2.instanceId] });
    const hit = [damageOf(after, 1, "Alvo 1"), damageOf(after, 1, "Alvo 2")];
    expect(hit[0] + hit[1]).toBe(4);
    expect(hit.every((d) => d > 0)).toBe(true);
  });

  it("dividir pode incluir criatura amiga (any number of creatures): a soma continua 4", () => {
    const fb = firstBlood();
    const state = setupTest({ hand: [fb], inPlay: [brob("Amiga A"), brob("Amiga B")] }, { inPlay: [foe("Alvo")] }, "Brobnar");
    const amiga = state.players[0].board[0];
    const inimiga = state.players[1].board[0];
    const after = applyMove(state, 0, { type: "play", instanceId: fb.instanceId, targets: [amiga.instanceId, inimiga.instanceId] });
    const total = damageOf(after, 0, "Amiga A") + damageOf(after, 1, "Alvo");
    expect(total).toBe(4);
    expect(damageOf(after, 0, "Amiga A")).toBeGreaterThan(0);
  });
});

describe("M1 · First Blood — Alpha", () => {
  it("depois de fazer outra coisa no passo, First Blood não pode mais ser jogada", () => {
    const fb = firstBlood();
    const reaper = brob("Reaper");
    const state = setupTest({ hand: [fb], inPlay: [reaper] }, { inPlay: [foe("Alvo")] }, "Brobnar");
    const afterReap = applyMove(state, 0, { type: "reap", instanceId: reaper.instanceId });
    const playable = getLegalMoves(afterReap, 0, "Brobnar").some((m) => m.type === "play" && m.instanceId === fb.instanceId);
    expect(playable).toBe(false);
  });
});
