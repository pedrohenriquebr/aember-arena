import { describe, expect, it } from "vitest";
import { destinationOf } from "./shellNav";

describe("H-07 destinos do shell do lobby", () => {
  it("a partida e o início acendem Jogar", () => {
    expect(destinationOf("home")).toBe("play");
    expect(destinationOf("game")).toBe("play");
  });

  it("Vault e o detalhe de deck acendem Decks", () => {
    expect(destinationOf("browse")).toBe("decks");
    expect(destinationOf("inspect")).toBe("decks");
  });

  it("Ajustes (config legado ou settings novo) acende Ajustes", () => {
    expect(destinationOf("config")).toBe("settings");
    expect(destinationOf("settings")).toBe("settings");
  });
});
