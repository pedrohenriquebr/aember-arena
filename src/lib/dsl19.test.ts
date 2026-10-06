// SPDX-License-Identifier: AGPL-3.0-only
// Lote 15f (PARSER_VERSION 22): gain-ability — "This creature gains, '…'" (a
// ability concedida ao HOST, `effect.abilities` desde o Lote 4) e as grafias do
// cluster 7: o combo "gains <keyword> and, '…'" (Armageddon Cloak), "another
// creature" (Filter.other) e "put X into its owner's archives". Prints REAIS do
// corpus. Foco em comportamento: a habilidade concedida resolve no motor, a
// recusa/counter-caso e o regresso (as grafias eram vanilla/partial antes).
import { afterEach, describe, expect, it } from "vitest";
import { DSL_VERSION, setAbilityOverrides } from "./abilities";
import { PARSER_VERSION, parseCardText } from "./cardText";
import { applyMove, type CardFace } from "./game";
import { card, setupTest } from "./testkit";

afterEach(() => setAbilityOverrides(new Map()));

const DUSKRUNNER = "This creature gains, “Reap: Steal 1A.”";
const BIOMATRIX = "This creature gains, “Destroyed: You may put this creature into its owner's archives.” ";
const STARPATCH = "This creature gains, “At the start of your turn, if this creature is exhausted, purge another creature that shares a house with it.”";
const ARMAGEDDON = "This creature gains hazardous 2 and, “Destroyed: Fully heal this creature and destroy Armageddon Cloak instead.”";
const COMBO_OK = "This creature gains poison and, “Reap: Steal 1A.”";

const face = (title: string, text: string, type: string, house: string): CardFace => ({ id: title, title, house, type, image: "", text, amber: 0, power: 3, armor: 0 });
const parse = (title: string, text: string, type: string, house: string) => parseCardText(face(title, text, type, house));

describe("contract", () => {
  it("bumps the parser with the grant grammar", () => {
    expect(PARSER_VERSION).toBe(22);
    expect(DSL_VERSION).toBe(17);
  });
});

describe("grafias do cluster (prints reais — regressão: eram vanilla/partial)", () => {
  it("'This creature gains, Reap: …' é uma ability concedida ao host", () => {
    const parsed = parse("Duskrunner", DUSKRUNNER, "Upgrade", "Shadows");
    expect(parsed.coverage).toBe("full");
    expect(parsed.effects).toEqual([{ target: { host: true }, abilities: [{ on: ["reap"], acts: [{ k: "steal", n: 1 }] }] }]);
  });

  it("o corpo concedido lê 'put X into its owner's archives' (Biomatrix Backup)", () => {
    const parsed = parse("Biomatrix Backup", BIOMATRIX, "Upgrade", "Logos");
    expect(parsed.coverage).toBe("full");
    expect(parsed.effects).toEqual([
      { target: { host: true }, abilities: [{ on: ["destroyed"], acts: [{ k: "archive", s: "self", optional: true }], optional: true }] },
    ]);
  });

  it("'another creature that shares a house with it' vira alvo other + casa self (Starpatch)", () => {
    const parsed = parse("Starpatch", STARPATCH, "Upgrade", "Mars");
    expect(parsed.coverage).toBe("full");
    expect(parsed.effects).toEqual([
      {
        target: { host: true },
        abilities: [
          {
            on: ["startOfTurn"],
            acts: [{ k: "purge", s: "target" }],
            target: { type: "Creature", house: "self", other: true },
            if: { k: "count", of: { c: { self: true, exhausted: true } }, op: "gte", n: 1 },
          },
        ],
      },
    ]);
  });

  it("o combo keyword + ability concedida lê os dois no MESMO efeito", () => {
    const parsed = parse("Combo", COMBO_OK, "Upgrade", "Dis");
    expect(parsed.coverage).toBe("full");
    expect(parsed.effects).toEqual([
      { target: { host: true }, keywords: { poison: 1 }, abilities: [{ on: ["reap"], acts: [{ k: "steal", n: 1 }] }] },
    ]);
    // contra-caso: o print real do Armageddon tem "instead" no corpo — fora da
    // gramática (documentado), a carta fica vanilla em vez de mentir cobertura.
    expect(parse("Armageddon Cloak", ARMAGEDDON, "Upgrade", "Sanctum").coverage).not.toBe("full");
  });
});

describe("comportamento: a ability concedida resolve no motor", () => {
  it("o host reapando rouba 1 pela ability concedida (e nada sem ela)", () => {
    // TEXTO real — o caminho testado é o do efeito concedido (effects.abilities),
    // não uma linha injetada.
    const host = card("Host", { type: "Creature", house: "Shadows", text: "This creature gains, “Reap: Steal 1A.”", power: 3 });
    const plain = card("Plain", { type: "Creature", house: "Shadows", text: "Reap: Draw a card.", power: 3 });
    const base = applyMove(setupTest({ inPlay: [plain], deck: [] }, { amber: 4 }, "Shadows"), 0, { type: "reap", instanceId: plain.instanceId });
    expect(base.players[1].amber).toBe(4); // contra-caso: sem o grant, sem roubo
    const cast = applyMove(setupTest({ inPlay: [host] }, { amber: 4 }, "Shadows"), 0, { type: "reap", instanceId: host.instanceId });
    expect(cast.players[1].amber).toBe(3);
    expect(cast.players[0].amber).toBe(2); // 1 do reap + 1 roubado
  });

  it("o combo concede keyword E ability juntos (Armageddon shape)", () => {
    const host = card("Combo Host", { type: "Creature", house: "Dis", text: "This creature gains poison and, “Reap: Steal 1A.”", power: 3 });
    const parsed = parse("Combo", "This creature gains poison and, “Reap: Steal 1A.”", "Creature", "Dis");
    expect(parsed.effects?.[0].keywords).toEqual({ poison: 1 });
    expect(parsed.effects?.[0].abilities).toHaveLength(1);
    const cast = applyMove(setupTest({ inPlay: [host] }, { amber: 4 }, "Dis"), 0, { type: "reap", instanceId: host.instanceId });
    expect(cast.players[1].amber).toBe(3); // a ability concedida resolve junto
  });
});
