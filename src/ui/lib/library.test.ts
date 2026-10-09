import { describe, expect, it } from "vitest";
import { orderLibrary } from "./library";

// H-15: a aba Meus põe os favoritos primeiro; a ordem do resto depende de "sort".
type Row = { id: string; name: string; favorite?: boolean };
const starters = new Set(["s1", "s2"]);
const rows: Row[] = [
  { id: "m-zeta", name: "Zeta" },
  { id: "s2", name: "Starter B" },
  { id: "m-alfa", name: "Alfa", favorite: true },
  { id: "s1", name: "Starter A" },
  { id: "m-beta", name: "Beta" },
  { id: "m-omega", name: "Omega", favorite: true },
];

describe("H-15 orderLibrary (aba Meus)", () => {
  it("shelf: favoritos, depois os iniciais, depois o resto na ordem da biblioteca", () => {
    expect(orderLibrary(rows, starters, "shelf").map((deck) => deck.id)).toEqual([
      "m-alfa",
      "m-omega",
      "s2",
      "s1",
      "m-zeta",
      "m-beta",
    ]);
  });

  it("name: favoritos A–Z e depois o resto A–Z", () => {
    expect(orderLibrary(rows, starters, "name").map((deck) => deck.name)).toEqual([
      "Alfa",
      "Omega",
      "Beta",
      "Starter A",
      "Starter B",
      "Zeta",
    ]);
  });

  it("não altera a lista de entrada", () => {
    const before = rows.map((deck) => deck.id).join(",");
    orderLibrary(rows, starters, "name");
    expect(rows.map((deck) => deck.id).join(",")).toBe(before);
  });

  it("biblioteca vazia (só iniciais já estão no set) não quebra", () => {
    expect(orderLibrary([], starters, "name")).toEqual([]);
  });
});
