// SPDX-License-Identifier: AGPL-3.0-only
// M2 · Haunted House (kt:700:149): "At the start of your turn, if you are not haunted, discard
// the top card of your deck. Omni: If you are haunted, gain 1Æ." Haunted = 10+ cartas no próprio
// descarte. A linha aprovada do approved.json é a que o jogo carrega no boot: a bancada roda com ela.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normaliseAbilityOverride, setAbilityOverrides, type AbilityOverride } from "./abilities";
import { textHash } from "./cardText";
import { applyMove, endTurn, type GameState } from "./game";
import { card, setupTest } from "./testkit";

const ID = "kt:700:149:geistoid";
const { title: TITLE, text: TEXT } = (JSON.parse(readFileSync(join(process.cwd(), "scripts", "harvest", "cards-corpus.json"), "utf8")) as { id: string; title: string; text: string }[]).find((c) => c.id === ID)!;
const ROW = normaliseAbilityOverride((JSON.parse(readFileSync(join(process.cwd(), "src", "lib", "generated", "approved.json"), "utf8")) as { cardId: string }[]).find((r) => r.cardId === ID)) as AbilityOverride;

beforeEach(() => setAbilityOverrides(new Map([[ID, ROW]])));
afterEach(() => setAbilityOverrides(new Map()));

const house = () => card(TITLE, { id: ID, type: "Artifact", house: "Geistoid", text: TEXT });
const junk = (n: number, prefix = "Lixo") => Array.from({ length: n }, (_, i) => card(`${prefix} ${i}`, { house: "Dis" }));
const filler = (n: number) => Array.from({ length: n }, (_, i) => card(`Baralho ${i}`, { house: "Dis" }));

describe("M2 · Haunted House — linha aprovada", () => {
  it("a linha passa no validador e o hash é o do texto impresso", () => {
    expect(ROW).not.toBeNull();
    expect(ROW.textHash).toBe(textHash(TEXT));
  });
});

// endTurn(s, 0) termina o turno do jogador 0: quem COMEÇA é o 1, então a casa fica com ele (dsl13).
// Baralho grande: se a compra esvaziar o baralho, o descarte é embaralhado de volta e some da conta.
describe("M2 · Haunted House — início do turno: descarta do topo só enquanto NÃO está assombrada", () => {
  it("sem assombro (9 no descarte): ao começar meu turno, o topo do meu baralho vai ao descarte", () => {
    const state = setupTest({}, { inPlay: [house()], deck: filler(20), discard: junk(9) }, "Geistoid");
    const after = endTurn(state, 0) as GameState;
    expect(after.players[1].discard).toHaveLength(10);
    expect(after.players[1].discard.some((c) => c.face.title.startsWith("Baralho"))).toBe(true);
  });

  it("assombrada (10 no descarte): não descarta nada no início do turno", () => {
    const state = setupTest({}, { inPlay: [house()], deck: filler(20), discard: junk(10) }, "Geistoid");
    const after = endTurn(state, 0) as GameState;
    expect(after.players[1].discard).toHaveLength(10);
  });
});

describe("M2 · Haunted House — Omni: se assombrado, ganha 1Æ", () => {
  it("assombrada (10 no descarte): usar a casa dá 1Æ", () => {
    const h = house();
    const state = setupTest({ inPlay: [h], discard: junk(10) }, {}, "Geistoid");
    const after = applyMove(state, 0, { type: "use", instanceId: h.instanceId }) as GameState;
    expect(after.players[0].amber).toBe(1);
  });

  it("não assombrada (9 no descarte): usar a casa não dá âmbar", () => {
    const h = house();
    const state = setupTest({ inPlay: [h], discard: junk(9) }, {}, "Geistoid");
    const after = applyMove(state, 0, { type: "use", instanceId: h.instanceId }) as GameState;
    expect(after.players[0].amber).toBe(0);
  });
});
