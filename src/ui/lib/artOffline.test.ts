import { describe, expect, it } from "vitest";
import { ART_QUOTA_COST_BYTES, artStatusOf, artUrlsOf, estimateArtQuota, formatBytes } from "./artOffline";

describe("ART_OFFLINE — estado e custo das artes por deck", () => {
  it("artUrlsOf: só https, sem repetição, sem carta sem imagem", () => {
    const urls = artUrlsOf([
      { image: "https://cdn.example/a.png" },
      { image: "https://cdn.example/a.png" },
      { image: "" },
      { image: "http://insecure.example/b.png" },
      {},
      { image: "https://cdn.example/c.png" },
    ]);
    expect(urls).toEqual(["https://cdn.example/a.png", "https://cdn.example/c.png"]);
  });

  it("artStatusOf: nada / parcial / baixado", () => {
    expect(artStatusOf([])).toBe("none");
    expect(artStatusOf([false, false])).toBe("none");
    expect(artStatusOf([true, false, true])).toBe("partial");
    expect(artStatusOf([true, true])).toBe("full");
  });

  it("estimateArtQuota: N artes × custo opaco de ~7 MB", () => {
    expect(ART_QUOTA_COST_BYTES).toBe(7 * 1024 * 1024);
    expect(estimateArtQuota(0)).toBe(0);
    expect(estimateArtQuota(36)).toBe(36 * ART_QUOTA_COST_BYTES);
    expect(estimateArtQuota(-3)).toBe(0);
  });

  it("formatBytes: MB acima de 1 MB, KB abaixo, no idioma pedido", () => {
    expect(formatBytes(ART_QUOTA_COST_BYTES, "en-US")).toBe("7 MB");
    expect(formatBytes(150 * 1024, "en-US")).toBe("150 KB");
    expect(formatBytes(1536 * 1024, "pt-BR")).toBe("1,5 MB");
  });
});
