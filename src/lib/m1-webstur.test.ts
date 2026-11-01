// SPDX-License-Identifier: AGPL-3.0-only
// M1 · Webstur (62e4a39a): "Taunt. After Fight: For each damage on Webstur, you may discard the
// top card of each player's deck." A linha vendored já existe (approved.json, v10): a bancada
// carrega ESSA linha pelo mesmo validador do boot e prova o texto impresso contra ela.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normaliseAbilityOverride, setAbilityOverrides, type AbilityOverride } from "./abilities";
import { applyMove, type GameState } from "./game";
import { card, setupTest } from "./testkit";
import { harvestJson } from "./testHarvest";
const ID = "62e4a39a-3efc-4f9e-b32e-897f16d357b2";
const CORPUS = harvestJson<{ id: string; text: string }[]>("cards-corpus.json") ?? [];
const HAS_CORPUS = CORPUS.length > 0;
const TEXT = CORPUS.find((c) => c.id === ID)?.text ?? "";
const ROW = normaliseAbilityOverride((JSON.parse(readFileSync(join(process.cwd(), "src", "lib", "generated", "approved.json"), "utf8")) as { cardId: string }[]).find((r) => r.cardId === ID)) as AbilityOverride;

beforeEach(() => setAbilityOverrides(new Map([[ID, ROW]])));
afterEach(() => setAbilityOverrides(new Map()));

const webstur = (damage: number) => ({ ...card("Webstur", { id: ID, type: "Creature", house: "Geistoid", power: 5, armor: 0, text: TEXT }), damage });
const deckOf = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => card(`${prefix}${i + 1}`));
const titlesOf = (cards: { face: { title: string } }[]) => cards.map((c) => c.face.title);

describe.skipIf(!HAS_CORPUS)("M1 · Webstur — descarte do topo de cada baralho, por dano", () => {
  it("a linha vendored passa no validador e carrega com o hash do corpus", () => {
    expect(ROW).not.toBeNull();
    expect(ROW.textHash).toBe("6c23a109");
  });

  it("depois da luta, cada dano em Webstur deixa descartar o topo de cada baralho (3 danos = 3 de cada)", () => {
    const w = webstur(1);
    const enemy = card("Alvo", { type: "Creature", house: "Untamed", power: 2, armor: 0, text: "" });
    // O topo do baralho é o ÚLTIMO elemento (game.ts draw usa pop()).
    const state = setupTest({ inPlay: [w], deck: deckOf("Meu", 4) }, { inPlay: [enemy], deck: deckOf("Opp", 4) }, "Geistoid");
    const after = applyMove(state, 0, { type: "fight", attackerId: w.instanceId, targetId: enemy.instanceId }) as GameState;
    // Dano no Webstur: 1 prévio + 2 da luta = 3.
    expect(after.players[0].board.find((c) => c.instanceId === w.instanceId)?.damage).toBe(3);
    expect(titlesOf(after.players[0].discard).filter((t) => t.startsWith("Meu"))).toEqual(["Meu4", "Meu3", "Meu2"]);
    expect(titlesOf(after.players[1].discard).filter((t) => t.startsWith("Opp"))).toEqual(["Opp4", "Opp3", "Opp2"]);
  });

  it("sem nenhum dano em Webstur, nada é descartado", () => {
    const w = webstur(0);
    const enemy = card("Alvo", { type: "Creature", house: "Untamed", power: 0, armor: 0, text: "" });
    const state = setupTest({ inPlay: [w], deck: deckOf("Meu", 4) }, { inPlay: [enemy], deck: deckOf("Opp", 4) }, "Geistoid");
    const after = applyMove(state, 0, { type: "fight", attackerId: w.instanceId, targetId: enemy.instanceId }) as GameState;
    expect(after.players[0].board.find((c) => c.instanceId === w.instanceId)?.damage).toBe(0);
    expect(after.players[0].discard.filter((c) => c.face.title.startsWith("Meu"))).toHaveLength(0);
    expect(after.players[1].discard.filter((c) => c.face.title.startsWith("Opp"))).toHaveLength(0);
  });
});
