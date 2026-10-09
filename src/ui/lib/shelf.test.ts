import { describe, expect, it } from "vitest";
import { shelfOrder } from "./shelf";

type D = { id: string; favorite?: boolean };
const starters: D[] = [{ id: "s1" }, { id: "s2" }];

describe("shelfOrder (UX_REWRITE_PLAN §2 S2, mesma ordem da Home v1)", () => {
  it("favoritos da biblioteca vêm antes dos iniciais; o resto depois", () => {
    const decks: D[] = [...starters, { id: "a" }, { id: "b", favorite: true }, { id: "c" }];
    expect(shelfOrder(decks, starters, new Set(["s1", "s2"])).map((d) => d.id)).toEqual(["b", "s1", "s2", "a", "c"]);
  });

  it("não duplica os iniciais quando a biblioteca já os traz", () => {
    const decks: D[] = [...starters];
    const ordered = shelfOrder(decks, starters, new Set(["s1", "s2"]));
    expect(ordered.map((d) => d.id)).toEqual(["s1", "s2"]);
  });

  it("biblioteca vazia (só iniciais) devolve os iniciais na ordem dada", () => {
    expect(shelfOrder([], starters, new Set(["s1", "s2"])).map((d) => d.id)).toEqual(["s1", "s2"]);
  });
});
