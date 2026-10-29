// SPDX-License-Identifier: AGPL-3.0-only
// M1 · Essence Entangler (91e40053): "This creature gets –X power, where X is the number of Æ on
// this creature. Scrap: Move 1Æ from a creature to another creature." Bancada do TEXTO IMPRESSO
// (corpus), sem linha vendored. O glifo Æ é o U+F360 do corpus: o texto vem do arquivo, não é redigitado.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normaliseAbilityOverride, setAbilityOverrides, type AbilityOverride } from "./abilities";
import { textHash } from "./cardText";
import { applyMove, effectivePower, type CardInstance, type GameState } from "./game";
import { card, setupTest } from "./testkit";

const ID = "91e40053-2046-44eb-ace3-de495d5e930c";
const TEXT = (JSON.parse(readFileSync(join(process.cwd(), "scripts", "harvest", "cards-corpus.json"), "utf8")) as { id: string; text: string }[]).find((c) => c.id === ID)!.text;

const ROW = normaliseAbilityOverride((JSON.parse(readFileSync(join(process.cwd(), "src", "lib", "generated", "approved.json"), "utf8")) as { cardId: string }[]).find((r) => r.cardId === ID)) as AbilityOverride;

beforeEach(() => setAbilityOverrides(new Map([[ID, ROW]])));
afterEach(() => setAbilityOverrides(new Map()));

describe("M1 · linha vendored (approved.json) — validador e hash do corpus", () => {
  it("passa no validador e o hash é o do texto impresso", () => {
    expect(ROW).not.toBeNull();
    expect(ROW.textHash).toBe(textHash(TEXT));
  });
});

const entangler = () => card("Essence Entangler", { id: ID, type: "Upgrade", house: "Star Alliance", text: TEXT });
const brute = (amber: number) => ({ ...card("Brute", { type: "Creature", house: "Star Alliance", power: 5, armor: 0, text: "" }), amber });

const onBoard = (state: GameState, side: 0 | 1, instanceId: string): CardInstance | undefined =>
  state.players[side].board.find((c) => c.instanceId === instanceId);

describe("M1 · Essence Entangler — –X de poder com X = Æ na criatura", () => {
  it("com 3 Æ na criatura, ela fica com poder 5 - 3 = 2", () => {
    const e = entangler();
    const b = brute(3);
    const state = setupTest({ hand: [e], inPlay: [b] }, {}, "Star Alliance");
    const after = applyMove(state, 0, { type: "play", instanceId: e.instanceId, target: b.instanceId });
    expect(effectivePower(after, onBoard(after, 0, b.instanceId)!)).toBe(2);
  });
});

describe("M1 · Essence Entangler — Scrap: a linha carrega o gatilho e o movimento de Æ", () => {
  it("a DSL do Scrap é 'mover 1 Æ de uma criatura para outra' (dados corretos, mesmo sem o gatilho em jogo)", () => {
    const ability = (ROW.dsl as { on: string[]; acts: { k: string; to?: string }[] }[]).find((a) => a.on.includes("scrap"));
    expect(ability?.acts).toEqual([expect.objectContaining({ k: "moveAmber", to: "target2" })]);
  });

  // GAP DE MOTOR (fora da moagem; motor é somente leitura nesta missão): o Scrap de carta EM JOGO
  // não dispara. `leavePlay` manda a carta direto ao descarte sem `toDiscard`, e o movimento `discard`
  // só é oferecido para cartas na mão. Quando o motor disparar o Scrap ao sair de jogo, troque para `it`.
  it.skip("quando o upgrade sai de jogo, 1 Æ sai da criatura que tem Æ e vai para a outra criatura (GAP: scrap sem gatilho em jogo)", () => {
    const e = entangler();
    const host = card("Hospedeira", { type: "Creature", house: "Star Alliance", power: 5, armor: 0, text: "" });
    const donor = { ...card("Doadora", { type: "Creature", house: "Star Alliance", power: 4, armor: 0, text: "" }), amber: 3 };
    const receptora = card("Receptora", { type: "Creature", house: "Star Alliance", power: 4, armor: 0, text: "" });
    const foe = card("Inimiga", { type: "Creature", house: "Untamed", power: 9, armor: 0, text: "" });
    const state = setupTest({ hand: [e], inPlay: [donor, host, receptora] }, { inPlay: [foe] }, "Star Alliance");
    const played = applyMove(state, 0, { type: "play", instanceId: e.instanceId, target: host.instanceId });
    const fought = applyMove(played, 0, { type: "fight", attackerId: host.instanceId, targetId: foe.instanceId });
    expect(onBoard(fought, 0, host.instanceId)).toBeUndefined();
    expect(onBoard(fought, 0, donor.instanceId)?.amber ?? 0).toBe(2);
    expect(onBoard(fought, 0, receptora.instanceId)?.amber ?? 0).toBe(1);
  });
});
