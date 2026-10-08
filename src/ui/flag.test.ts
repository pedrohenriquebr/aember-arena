import { describe, expect, it } from "vitest";
import { readUiFlag } from "./flag";

// Storage em memória com a mesma forma do localStorage (só o que readUiFlag usa).
function memoryStore(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [["aember-arena-ui", initial]]);
  const store = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
  return { data, store };
}

describe("H-01 flag ui2 (plano UX_REWRITE §5 H-01)", () => {
  it("?ui=2 vence e persiste no storage", () => {
    const { data, store } = memoryStore();
    expect(readUiFlag("?ui=2", store)).toBe("2");
    expect(data.get("aember-arena-ui")).toBe("2");
    // sem param depois de persistido: a v2 continua ligada
    expect(readUiFlag("", store)).toBe("2");
  });

  it("?ui=1 reverte a v2 e persiste a reversão", () => {
    const { data, store } = memoryStore("2");
    expect(readUiFlag("?ui=1", store)).toBe("1");
    expect(data.get("aember-arena-ui")).toBe("1");
    expect(readUiFlag("", store)).toBe("1");
  });

  it("sem storage (null) lê como \"1\"", () => {
    expect(readUiFlag("", null)).toBe("1");
    // o param ainda vale sem storage: a sessão inteira fica na v2
    expect(readUiFlag("?ui=2", null)).toBe("2");
  });

  it("valor inválido é ignorado e cai no storage", () => {
    const stored2 = memoryStore("2");
    expect(readUiFlag("?ui=3", stored2.store)).toBe("2");
    expect(stored2.data.get("aember-arena-ui")).toBe("2");

    const empty = memoryStore();
    expect(readUiFlag("?ui=3", empty.store)).toBe("1");
    expect(empty.data.has("aember-arena-ui")).toBe(false);
  });

  it("storage que lança exceção não quebra o boot (regra 6)", () => {
    const broken = {
      getItem: () => { throw new Error("quota"); },
      setItem: () => { throw new Error("quota"); },
    };
    expect(readUiFlag("", broken)).toBe("1");
    expect(readUiFlag("?ui=2", broken)).toBe("2");
  });
});
