// SPDX-License-Identifier: AGPL-3.0-only
// M1 · Ecto-Charge (ac9fd9ad): "Play: Forge a key at +20 current cost, reduced by 1 for each
// card in your discard pile (to a minimum of 6). If you do, purge Ecto-Charge." Bancada do TEXTO
// IMPRESSO (corpus), sem linha vendored.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normaliseAbilityOverride, setAbilityOverrides, type AbilityOverride } from "./abilities";
import { textHash } from "./cardText";
import { applyMove, type GameState } from "./game";
import { card, setupTest } from "./testkit";
import { harvestJson } from "./testHarvest";
const ID = "ac9fd9ad-e2a9-4744-8324-5532cedb9c72";
const CORPUS = harvestJson<{ id: string; text: string }[]>("cards-corpus.json") ?? [];
const HAS_CORPUS = CORPUS.length > 0;
const TEXT = CORPUS.find((c) => c.id === ID)?.text ?? "";

const ROW = normaliseAbilityOverride((JSON.parse(readFileSync(join(process.cwd(), "src", "lib", "generated", "approved.json"), "utf8")) as { cardId: string }[]).find((r) => r.cardId === ID)) as AbilityOverride;

beforeEach(() => setAbilityOverrides(new Map([[ID, ROW]])));
afterEach(() => setAbilityOverrides(new Map()));

describe.skipIf(!HAS_CORPUS)("M1 · linha vendored (approved.json) — validador e hash do corpus", () => {
  it("passa no validador e o hash é o do texto impresso", () => {
    expect(ROW).not.toBeNull();
    expect(ROW.textHash).toBe(textHash(TEXT));
  });
});

const ecto = () => card("Ecto-Charge", { id: ID, type: "Action", house: "Geistoid", text: TEXT });
const junk = (n: number) => Array.from({ length: n }, (_, i) => card(`Lixo${i}`));

/** Joga o Ecto-Charge com `amber` âmbar na pool e `discardCount` cartas no descarte. */
function playEcto(amber: number, discardCount: number): GameState {
  const e = ecto();
  const state = setupTest({ hand: [e], discard: junk(discardCount), amber }, {}, "Geistoid");
  return applyMove(state, 0, { type: "play", instanceId: e.instanceId });
}

describe.skipIf(!HAS_CORPUS)("M1 · Ecto-Charge — custo = +20 menos 1 por carta no descarte (mínimo 6)", () => {
  it("sem descarte o custo é 26: com 25 âmbar não forja, a carta vai ao descarte e não é purgada", () => {
    const after = playEcto(25, 0);
    expect(after.players[0].keys).toBe(0);
    expect(after.players[0].amber).toBe(25);
    expect(after.players[0].discard.some((c) => c.face.title === "Ecto-Charge")).toBe(true);
    expect(after.players[0].purged.some((c) => c.face.title === "Ecto-Charge")).toBe(false);
  });

  it("sem descarte o custo é 26: com 26 âmbar forja a chave, paga 26 e purga o Ecto-Charge", () => {
    const after = playEcto(26, 0);
    expect(after.players[0].keys).toBe(1);
    expect(after.players[0].amber).toBe(0);
    expect(after.players[0].purged.some((c) => c.face.title === "Ecto-Charge")).toBe(true);
  });

  it("com 19 cartas no descarte o custo é 7: com 6 âmbar não forja", () => {
    const after = playEcto(6, 19);
    expect(after.players[0].keys).toBe(0);
    expect(after.players[0].amber).toBe(6);
  });

  it("com 20 cartas no descarte o custo é 6: com 6 âmbar forja", () => {
    const after = playEcto(6, 20);
    expect(after.players[0].keys).toBe(1);
    expect(after.players[0].amber).toBe(0);
  });

  it("piso de 6: com 25 cartas no descarte (o desconto passaria de 6) o custo continua 6", () => {
    const after = playEcto(6, 25);
    expect(after.players[0].keys).toBe(1);
    expect(after.players[0].amber).toBe(0);
  });
});
