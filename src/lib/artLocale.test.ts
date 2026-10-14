import { afterEach, describe, expect, it, vi } from "vitest";
import { currentUiLanguage, localizedArtUrl, ptArtUrl } from "./artLocale";

const EN = "https://mastervault-storage-prod.s3.amazonaws.com/media/card_front/en/341_007_CFRV9R6JG7P7_en.png";
const PT = "https://mastervault-storage-prod.s3.amazonaws.com/media/card_front/pt/341_007_CFRV9R6JG7P7_pt.png";

function stubSettings(saved: string | null | "throw") {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      if (saved === "throw") throw new Error("storage bloqueado");
      return saved;
    },
  });
}

describe("ptArtUrl", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("troca o segmento e o sufixo do render EN pelo PT", () => {
    expect(ptArtUrl(EN)).toBe(PT);
  });

  it("é idempotente: URL já PT não muda de novo", () => {
    expect(ptArtUrl(PT)).toBe(PT);
    expect(ptArtUrl(ptArtUrl(EN))).toBe(PT);
  });

  it("devolve intacto o que não é o EN do S3 do MV", () => {
    expect(ptArtUrl("")).toBe("");
    expect(ptArtUrl("https://evil.example.com/media/card_front/en/341_007_X_en.png")).toBe(
      "https://evil.example.com/media/card_front/en/341_007_X_en.png",
    );
    // Casa nova em SVG: o gate do EN é .png, então não reescreve.
    const svg = "https://mastervault-storage-prod.s3.amazonaws.com/media/card_front/en/900_001_X_en.svg";
    expect(ptArtUrl(svg)).toBe(svg);
  });
});

describe("currentUiLanguage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lê o language salvo com a mesma chave do readSettings", () => {
    stubSettings(JSON.stringify({ language: "ptBR" }));
    expect(currentUiLanguage()).toBe("ptBR");
    stubSettings(JSON.stringify({ language: "en" }));
    expect(currentUiLanguage()).toBe("en");
  });

  it("qualquer outra coisa, ausência ou erro vira en", () => {
    stubSettings(JSON.stringify({ language: "fr" }));
    expect(currentUiLanguage()).toBe("en");
    stubSettings(null);
    expect(currentUiLanguage()).toBe("en");
    stubSettings("null");
    expect(currentUiLanguage()).toBe("en");
    stubSettings("{não é json");
    expect(currentUiLanguage()).toBe("en");
    stubSettings("throw");
    expect(currentUiLanguage()).toBe("en");
  });
});

describe("localizedArtUrl", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reescreve só quando a UI está em ptBR", () => {
    stubSettings(JSON.stringify({ language: "ptBR" }));
    expect(localizedArtUrl(EN)).toBe(PT);
    stubSettings(JSON.stringify({ language: "en" }));
    expect(localizedArtUrl(EN)).toBe(EN);
    stubSettings(null);
    expect(localizedArtUrl(EN)).toBe(EN);
  });
});
