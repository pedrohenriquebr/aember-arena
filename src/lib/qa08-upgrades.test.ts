// SPDX-License-Identifier: AGPL-3.0-only
// QA-08 ("a weapon não anexa"): KeyForge não tem tipo Weapon — as cartas do dono são UPGRADES.
// Bancada das 6 upgrades dos dois decks (faces EXATAS de cards-dois-decks.json, com as linhas
// vendored carregadas como no boot do App): quem o prompt oferece, onde a carta fica no motor
// e em que lane a UI a desenha (partitionLane, QA-02). Grasping Vines é Action, fora daqui.
// Regras (rulebook, "Upgrade"): entra anexada a uma criatura escolhida por quem controla a
// upgrade; se não puder anexar, não entra em jogo; sai junto com o hospedeiro. Animating Force
// é a exceção impressa: "enters play attached to an artifact instead of a creature".
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setAbilityOverrides } from "./abilities";
import { applyMove, isLegalMove, targetChoices, type CardFace, type CardInstance, type GameState } from "./game";
import { partitionLane } from "./laneLayout";
import { card, setupTest } from "./testkit";
import { vendoredOverrides } from "./vendored";
import { harvestJson } from "./testHarvest";
const DECKS = harvestJson<CardFace[]>("cards-dois-decks.json") ?? [];
const HAS_CORPUS = DECKS.length > 0;
const faceOf = (title: string) => DECKS.find((face) => face.title === title)!;
const fromDeck = (title: string) => card(title, { ...faceOf(title) });

const creature = (title: string, house = "Brobnar") => card(title, { type: "Creature", house, power: 3, armor: 0, text: "" });
const relic = () => card("Relic", { type: "Artifact", house: "Logos", power: 0, armor: 0, text: "" });

const hostOf = (state: GameState, upgradeId: string): CardInstance | undefined => {
  for (const player of state.players) {
    const up = player.board.find((item) => item.instanceId === upgradeId);
    if (up) return state.players.flatMap((p) => p.board).find((item) => item.instanceId === up.attachedTo);
  }
  return undefined;
};

beforeEach(() => setAbilityOverrides(vendoredOverrides()));
afterEach(() => setAbilityOverrides(new Map()));

const CREATURE_UPGRADES = ["Blood of Titans", "Cybergiant Rig", "Essence Entangler", "Under Pressure", "Proton Siphon"];

describe.skipIf(!HAS_CORPUS)("QA-08 · upgrades de criatura dos decks do dono", () => {
  it("as 5 faces do deck são Upgrade (e Grasping Vines é Action)", () => {
    for (const title of [...CREATURE_UPGRADES, "Animating Force"]) expect(faceOf(title).type, title).toBe("Upgrade");
    expect(faceOf("Grasping Vines").type).toBe("Action");
  });

  for (const title of CREATURE_UPGRADES) {
    describe(title, () => {
      it("o prompt oferece TODAS as criaturas dos dois lados e nenhum artefato", () => {
        const up = fromDeck(title);
        const [mine, theirs, art] = [creature("Mine"), creature("Theirs"), relic()];
        const state = setupTest({ hand: [up], inPlay: [mine, art] }, { inPlay: [theirs] }, up.face.house);
        expect(isLegalMove(state, 0, { type: "play", instanceId: up.instanceId })).toBe(true);
        expect(targetChoices(state, 0, { type: "play", instanceId: up.instanceId }).sort()).toEqual([mine.instanceId, theirs.instanceId].sort());
      });

      it("anexa na criatura inimiga escolhida e a UI desenha a carta na lane do HOSPEDEIRO", () => {
        const up = fromDeck(title);
        const [mine, theirs] = [creature("Mine"), creature("Theirs")];
        const state = setupTest({ hand: [up], inPlay: [mine] }, { inPlay: [theirs] }, up.face.house);
        const after = applyMove(state, 0, { type: "play", instanceId: up.instanceId, target: theirs.instanceId });
        // O motor guarda a upgrade no board de quem a controla (quem jogou)…
        expect(after.players[0].board.some((item) => item.instanceId === up.instanceId)).toBe(true);
        expect(hostOf(after, up.instanceId)?.instanceId).toBe(theirs.instanceId);
        // …e a UI a mostra presa ao hospedeiro: na lane inimiga, fora da tira própria.
        const enemyLane = partitionLane(after.players[1].board, after.players[0].board);
        const ownLane = partitionLane(after.players[0].board, after.players[1].board);
        expect(enemyLane.upgrades.map((item) => item.instanceId)).toContain(up.instanceId);
        expect(ownLane.attachments.map((item) => item.instanceId)).not.toContain(up.instanceId);
      });

      it("com UM hospedeiro só não há escolha (QA-05: auto-resolve) e a carta anexa nele", () => {
        const up = fromDeck(title);
        const only = creature("Only");
        const state = setupTest({ hand: [up], inPlay: [only] }, {}, up.face.house);
        expect(targetChoices(state, 0, { type: "play", instanceId: up.instanceId })).toEqual([only.instanceId]);
        const after = applyMove(state, 0, { type: "play", instanceId: up.instanceId });
        expect(hostOf(after, up.instanceId)?.instanceId).toBe(only.instanceId);
        expect(partitionLane(after.players[0].board, after.players[1].board).upgrades.map((item) => item.instanceId)).toEqual([up.instanceId]);
      });

      it("sem criatura em jogo a carta não pode ser jogada (não há onde anexar)", () => {
        const up = fromDeck(title);
        const state = setupTest({ hand: [up], inPlay: [relic()] }, {}, up.face.house);
        expect(isLegalMove(state, 0, { type: "play", instanceId: up.instanceId })).toBe(false);
      });
    });
  }
});

describe.skipIf(!HAS_CORPUS)("QA-08 · Animating Force (0706d7cd, a face do deck)", () => {
  it("o prompt oferece SÓ artefatos — nenhuma criatura, de nenhum lado", () => {
    const af = fromDeck("Animating Force");
    const [mine, theirs, art, theirArt] = [creature("Mine", "Geistoid"), creature("Theirs"), relic(), relic()];
    const state = setupTest({ hand: [af], inPlay: [mine, art] }, { inPlay: [theirs, theirArt] }, "Geistoid");
    expect(targetChoices(state, 0, { type: "play", instanceId: af.instanceId }).sort()).toEqual([art.instanceId, theirArt.instanceId].sort());
  });

  it("sem artefato em jogo é injogável, mesmo com criaturas na mesa (é a regra, não bug)", () => {
    const af = fromDeck("Animating Force");
    const state = setupTest({ hand: [af], inPlay: [creature("Mine", "Geistoid")] }, { inPlay: [creature("Theirs")] }, "Geistoid");
    expect(isLegalMove(state, 0, { type: "play", instanceId: af.instanceId })).toBe(false);
  });

  it("no artefato inimigo: ele vira MINHA criatura e a upgrade fica presa a ele na minha lane", () => {
    const af = fromDeck("Animating Force");
    const theirArt = relic();
    const state = setupTest({ hand: [af], inPlay: [creature("Mine", "Geistoid")] }, { inPlay: [theirArt] }, "Geistoid");
    const after = applyMove(state, 0, { type: "play", instanceId: af.instanceId, target: theirArt.instanceId });
    expect(hostOf(after, af.instanceId)?.instanceId).toBe(theirArt.instanceId);
    const ownLane = partitionLane(after.players[0].board, after.players[1].board);
    expect(ownLane.creatures.map((item) => item.instanceId)).toContain(theirArt.instanceId);
    expect(ownLane.upgrades.map((item) => item.instanceId)).toEqual([af.instanceId]);
    expect(ownLane.artifacts.map((item) => item.instanceId)).not.toContain(af.instanceId);
  });
});
