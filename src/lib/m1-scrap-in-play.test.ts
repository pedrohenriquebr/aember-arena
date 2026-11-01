// SPDX-License-Identifier: AGPL-3.0-only
// QA-07 · "Scrap:" de carta EM JOGO. O gatilho dispara quando a carta cai no descarte (destruída,
// sacrificada, ou caindo com o hospedeiro); retorno à mão, deck, arquivo e purge ficam calados.
// Bancada do motor: Essence Entangler (texto e linha vendored do corpus) + um artefato com Scrap
// de texto inline, para testar destino por destino sem depender de cartas específicas.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normaliseAbilityOverride, setAbilityOverrides, type AbilityOverride } from "./abilities";
import { applyMove, type CardInstance, type GameState } from "./game";
import { card, setupTest } from "./testkit";
import { harvestJson } from "./testHarvest";
const ID = "91e40053-2046-44eb-ace3-de495d5e930c";
const CORPUS = harvestJson<{ id: string; text: string }[]>("cards-corpus.json") ?? [];
const HAS_CORPUS = CORPUS.length > 0;
const TEXT = CORPUS.find((c) => c.id === ID)?.text ?? "";
const ROW = normaliseAbilityOverride((JSON.parse(readFileSync(join(process.cwd(), "src", "lib", "generated", "approved.json"), "utf8")) as { cardId: string }[]).find((r) => r.cardId === ID)) as AbilityOverride;

beforeEach(() => setAbilityOverrides(new Map([[ID, ROW]])));
afterEach(() => setAbilityOverrides(new Map()));

const entangler = () => card("Essence Entangler", { id: ID, type: "Upgrade", house: "Star Alliance", text: TEXT });
const creature = (title: string, amber = 0) => ({ ...card(title, { type: "Creature", house: "Star Alliance", power: 4, armor: 0, text: "" }), amber });
const onBoard = (state: GameState, side: 0 | 1, instanceId: string): CardInstance | undefined =>
  state.players[side].board.find((c) => c.instanceId === instanceId);
// Artefato com Scrap inline: "Scrap: Gain 1Æ" sobe o âmbar do dono — prova observável de que disparou.
const scrapTin = () => card("Scrap Tin", { type: "Artifact", house: "Star Alliance", power: 0, armor: 0, text: "Scrap: Gain 1<A>." });

describe.skipIf(!HAS_CORPUS)("QA-07 · destruição por efeito derruba o upgrade e dispara o Scrap dele", () => {
  it("'Destroy a creature' no hospedeiro: o Entangler cai no descarte e move 1Æ", () => {
    const e = entangler();
    const host = creature("Hospedeira", 0);
    const donor = creature("Doadora", 3);
    const receptora = creature("Receptora", 0);
    const zap = card("Zap", { type: "Action", house: "Star Alliance", text: "Play: Destroy a creature." });
    const state = setupTest({ hand: [e, zap], inPlay: [donor, host, receptora] }, {}, "Star Alliance");
    const withUpgrade = applyMove(state, 0, { type: "play", instanceId: e.instanceId, target: host.instanceId });
    const killed = applyMove(withUpgrade, 0, { type: "play", instanceId: zap.instanceId, target: host.instanceId });
    expect(onBoard(killed, 0, host.instanceId)).toBeUndefined();
    expect(onBoard(killed, 0, donor.instanceId)?.amber ?? 0).toBe(2);
    expect(onBoard(killed, 0, receptora.instanceId)?.amber ?? 0).toBe(1);
  });
});

describe.skipIf(!HAS_CORPUS)("QA-07 · destruir o próprio artefato dispara o Scrap (destino: descarte)", () => {
  it("'Destroy an artifact' sobre o artefato: Scrap Gain 1Æ entra no âmbar do dono", () => {
    const tin = scrapTin();
    const action = card("Demolish", { type: "Action", house: "Star Alliance", text: "Play: Destroy an artifact." });
    const state = setupTest({ hand: [action], inPlay: [tin] }, {}, "Star Alliance");
    const after = applyMove(state, 0, { type: "play", instanceId: action.instanceId, target: tin.instanceId });
    expect(onBoard(after, 0, tin.instanceId)).toBeUndefined();
    expect(after.players[0].discard.some((c) => c.instanceId === tin.instanceId)).toBe(true);
    expect(after.players[0].amber).toBe(1);
  });
});

describe.skipIf(!HAS_CORPUS)("QA-07 · retorno à mão NÃO dispara o Scrap", () => {
  it("'Return an artifact to its owner's hand': o artefato volta à mão e o Scrap fica calado", () => {
    const tin = scrapTin();
    const action = card("Recall", { type: "Action", house: "Star Alliance", text: "Play: Return an artifact to its owner's hand." });
    const state = setupTest({ hand: [action], inPlay: [tin] }, {}, "Star Alliance");
    const after = applyMove(state, 0, { type: "play", instanceId: action.instanceId, target: tin.instanceId });
    // Vacuidade: sem isto o teste passaria se o texto não parseasse e o artefato nem saísse de jogo.
    expect(after.players[0].hand.some((c) => c.instanceId === tin.instanceId)).toBe(true);
    expect(after.players[0].discard.some((c) => c.instanceId === tin.instanceId)).toBe(false);
    expect(after.players[0].amber).toBe(0);
  });
});

describe.skipIf(!HAS_CORPUS)("QA-07 · purge NÃO dispara o Scrap", () => {
  it("'Purge an artifact': o artefato sai do jogo e o Scrap fica calado", () => {
    const tin = scrapTin();
    const action = card("Obliterate", { type: "Action", house: "Star Alliance", text: "Play: Purge an artifact." });
    const state = setupTest({ hand: [action], inPlay: [tin] }, {}, "Star Alliance");
    const after = applyMove(state, 0, { type: "play", instanceId: action.instanceId, target: tin.instanceId });
    // Vacuidade: sem isto o teste passaria se o texto não parseasse e o artefato nem saísse de jogo.
    expect(after.players[0].purged.some((c) => c.instanceId === tin.instanceId)).toBe(true);
    expect(after.players[0].discard.some((c) => c.instanceId === tin.instanceId)).toBe(false);
    expect(after.players[0].amber).toBe(0);
  });
});
