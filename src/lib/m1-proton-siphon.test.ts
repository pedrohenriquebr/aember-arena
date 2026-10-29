// SPDX-License-Identifier: AGPL-3.0-only
// M1 · Proton Siphon (51575391): "While you are haunted, this creature gains splash-attack 5."
// Bancada do TEXTO IMPRESSO (corpus), sem linha vendored. Haunted = 10+ cartas no próprio descarte.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyMove, keyword, type CardInstance, type GameState } from "./game";
import { card, setupTest } from "./testkit";

const ID = "51575391-e8d7-437d-a95c-e29ddec95e26";
const TEXT = (JSON.parse(readFileSync(join(process.cwd(), "scripts", "harvest", "cards-corpus.json"), "utf8")) as { id: string; text: string }[]).find((c) => c.id === ID)!.text;

const siphon = () => card("Proton Siphon", { id: ID, type: "Upgrade", house: "Star Alliance", text: TEXT });
const host = () => card("Anfitriã", { type: "Creature", house: "Star Alliance", power: 3, armor: 0, text: "" });
const junk = (n: number) => Array.from({ length: n }, (_, i) => card(`Lixo${i}`));

/** Põe o Proton Siphon na anfitriã com `discardCount` cartas no meu descarte e devolve a anfitriã. */
function attached(discardCount: number): { state: GameState; host: CardInstance } {
  const s = siphon();
  const h = host();
  const setup = setupTest({ hand: [s], inPlay: [h], discard: junk(discardCount) }, {}, "Star Alliance");
  const after = applyMove(setup, 0, { type: "play", instanceId: s.instanceId, target: h.instanceId });
  return { state: after, host: after.players[0].board.find((c) => c.instanceId === h.instanceId)! };
}

describe("M1 · Proton Siphon — splash-attack 5 só enquanto estou haunted", () => {
  it("com 10 cartas no descarte (haunted) a criatura ganha splash-attack 5", () => {
    const { state, host: h } = attached(10);
    expect(keyword(state, h, "splash-attack")).toBe(5);
  });

  it("com 9 cartas no descarte (não haunted) a criatura não ganha splash-attack", () => {
    const { state, host: h } = attached(9);
    expect(keyword(state, h, "splash-attack")).toBe(0);
  });
});
