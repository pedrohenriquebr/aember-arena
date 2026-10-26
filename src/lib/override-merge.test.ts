// SPDX-License-Identifier: AGPL-3.0-only
// Merge de boot sensível a versão: a correção vendored (v maior) precisa
// alcançar dispositivos cujo store ainda guarda a aprovação velha da mesma
// carta — o first-wins antigo mantinha a linha errada para sempre.
import { afterEach, describe, expect, it } from "vitest";
import { abilityOverrideOf, mergeAbilityOverrides, setAbilityOverrides } from "./abilities";

const row = (v: number, tag: string) => ({
  cardId: "test-merge-x",
  dsl: [{ on: ["play" as const], acts: [{ k: "gainAmber" as const, n: v, s: "target" as const }] }],
  textHash: "h1",
  source: "manual" as const,
  reviewed: true,
  generatedAt: 1,
  v,
  model: tag,
});

afterEach(() => setAbilityOverrides(new Map()));

describe("mergeAbilityOverrides (newest wins no boot)", () => {
  it("vendored mais nova substitui a row velha do store", () => {
    mergeAbilityOverrides(new Map([["test-merge-x", row(8, "store-velha")]]));
    mergeAbilityOverrides(new Map([["test-merge-x", row(17, "vendored-corrigida")]]));
    expect(abilityOverrideOf("test-merge-x")?.model).toBe("vendored-corrigida");
  });

  it("empate (mesma v): a row do store se mantém", () => {
    mergeAbilityOverrides(new Map([["test-merge-x", row(17, "store-atual")]]));
    mergeAbilityOverrides(new Map([["test-merge-x", row(17, "vendored")]]));
    expect(abilityOverrideOf("test-merge-x")?.model).toBe("store-atual");
  });

  it("vendored mais VELHA nunca derruba a do store", () => {
    mergeAbilityOverrides(new Map([["test-merge-x", row(17, "store-nova")]]));
    mergeAbilityOverrides(new Map([["test-merge-x", row(8, "vendored-velha")]]));
    expect(abilityOverrideOf("test-merge-x")?.model).toBe("store-nova");
  });
});
