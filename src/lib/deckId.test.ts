import { describe, expect, it } from "vitest";
import { parseDeckId } from "./deckId";

// H-17: a folha de importação aceita UUID puro ou link; o que não tem UUID é recusado sem rede.
const DEMO = "ec86db52-e41e-4e6a-9f1a-a2d0e3d3277d";

describe("H-17 parseDeckId", () => {
  it("aceita o UUID puro", () => {
    expect(parseDeckId(DEMO)).toBe(DEMO);
  });

  it("tira o UUID de um link deck-details e ignora espaços ao redor", () => {
    expect(parseDeckId(`  https://www.keyforgegame.com/deck-details/${DEMO}  `)).toBe(DEMO);
  });

  it("devolve minúsculas (o Vault responde pelo id em minúsculas)", () => {
    expect(parseDeckId(DEMO.toUpperCase())).toBe(DEMO);
  });

  it("recusa texto sem UUID, vazio e UUID truncado", () => {
    expect(parseDeckId("")).toBeNull();
    expect(parseDeckId("   ")).toBeNull();
    expect(parseDeckId("meu baralho")).toBeNull();
    expect(parseDeckId(DEMO.slice(0, 30))).toBeNull();
  });
});
