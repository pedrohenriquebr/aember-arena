// SPDX-License-Identifier: AGPL-3.0-only
// M1 BÔNUS · Dominator Bauble, 2º id do corpus (76fce6b7, texto com \r\n final). A linha vendored
// (approved.json) é a DSL do QA-05 com o hash carimbado deste texto. Como o hash ignora espaço no
// fim, o id 96548d93 do baralho demo também a recebe pelo fallback por textHash.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normaliseAbilityOverride, setAbilityOverrides, type AbilityOverride } from "./abilities";
import { textHash } from "./cardText";
import { applyMove, pendingPrompt } from "./game";
import { card, setupTest } from "./testkit";

const ID = "76fce6b7-5877-4f49-bb9a-a0515ffbb8f2";
const CORPUS = JSON.parse(readFileSync(join(process.cwd(), "scripts", "harvest", "cards-corpus.json"), "utf8")) as { id: string; text: string }[];
const TEXT = CORPUS.find((c) => c.id === ID)!.text;
const ROW = normaliseAbilityOverride((JSON.parse(readFileSync(join(process.cwd(), "src", "lib", "generated", "approved.json"), "utf8")) as { cardId: string }[]).find((r) => r.cardId === ID)) as AbilityOverride;

beforeEach(() => setAbilityOverrides(new Map([[ID, ROW]])));
afterEach(() => setAbilityOverrides(new Map()));

const bauble = (id = ID) => card("Dominator Bauble", { id, type: "Artifact", house: "Dis", text: TEXT });
const grunt = () => card("Grunt", { type: "Creature", house: "Untamed", power: 3, armor: 0, text: "" });
const foe = () => card("Foe", { type: "Creature", house: "Brobnar", power: 1, armor: 0, text: "" });

describe("M1 BÔNUS · Dominator Bauble (76fce6b7) — linha vendored", () => {
  it("passa no validador e o hash é o do texto impresso, com ou sem o \\r\\n final", () => {
    expect(ROW).not.toBeNull();
    expect(ROW.textHash).toBe(textHash(TEXT));
    expect(textHash("Action: Use a friendly creature.")).toBe(ROW.textHash);
  });

  it("o id 96548d93 do baralho demo (mesmo texto, sem \\r\\n) recebe a mesma linha pelo fallback de hash", () => {
    // Com um único alvo legal o movimento não traz `target`: o motor escolhe ao aplicar. Prova-se pelo efeito.
    const b = bauble("96548d93-b318-40e3-9f5c-3297c8070ebd");
    const g = grunt();
    const state = setupTest({ inPlay: [b, g] }, { inPlay: [foe()] }, "Dis");
    const after = applyMove(state, 0, { type: "use", instanceId: b.instanceId, target: g.instanceId, mode: "a" });
    expect(after.players[0].amber).toBe(1);
  });
});

describe("M1 BÔNUS · Dominator Bauble — o uso pede a criatura e aplica o efeito certo", () => {
  it("oferece lutar/colher para a criatura amiga", () => {
    const b = bauble();
    const g = grunt();
    const state = setupTest({ inPlay: [b, g] }, { inPlay: [foe()] }, "Dis");
    expect(pendingPrompt(state, 0, { type: "use", instanceId: b.instanceId, target: g.instanceId })).toMatchObject({ kind: "mode", choice: "option" });
  });

  it("modo a (colher): a criatura colhe 1 âmbar e o Bauble exaure", () => {
    const b = bauble();
    const g = grunt();
    const state = setupTest({ inPlay: [b, g] }, { inPlay: [foe()] }, "Dis");
    const after = applyMove(state, 0, { type: "use", instanceId: b.instanceId, target: g.instanceId, mode: "a" });
    expect(after.players[0].amber).toBe(1);
    expect(after.players[0].board.find((c) => c.instanceId === b.instanceId)?.ready).toBe(false);
  });

  it("modo b (lutar): a criatura luta e nada é colhido", () => {
    const b = bauble();
    const g = grunt();
    const state = setupTest({ inPlay: [b, g] }, { inPlay: [foe()] }, "Dis");
    const after = applyMove(state, 0, { type: "use", instanceId: b.instanceId, target: g.instanceId, mode: "b" });
    expect(after.players[0].amber).toBe(0);
    expect(after.players[1].board.some((c) => c.face.title === "Foe")).toBe(false);
  });
});
