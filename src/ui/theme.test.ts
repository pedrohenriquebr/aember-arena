import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, THEMES, THEME_COLOR, applyTheme, readTheme } from "./theme";

// Storage em memória com a mesma forma do localStorage (só o que o motor usa).
function memoryStore(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [["aember-arena-theme", initial]]);
  const store = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
  return { data, store };
}

// Raiz e documento falsos: dataset do <html> + a meta theme-color do <head>.
function fakeDocument() {
  const meta = { attrs: { content: "antes" } as Record<string, string>, setAttribute(name: string, value: string) { this.attrs[name] = value; } };
  const raw = { dataset: {} as Record<string, string>, ownerDocument: { querySelector: (sel: string) => (sel === 'meta[name="theme-color"]' ? meta : null) } };
  return { root: raw as unknown as HTMLElement, raw, meta };
}

describe("H-02b motor de temas (plano UX_REWRITE §1.6.1)", () => {
  it("o padrão é forja e está registrado em THEMES", () => {
    expect(DEFAULT_THEME).toBe("forja");
    expect(THEMES).toContain("forja");
  });

  it("sem storage (null) lê como forja", () => {
    expect(readTheme(null)).toBe("forja");
  });

  it("storage que lança lê como forja (regra 6: erro engolido)", () => {
    const broken = { getItem: () => { throw new Error("quota"); } };
    expect(readTheme(broken)).toBe("forja");
  });

  it("valor inválido ou ausente lê como forja", () => {
    expect(readTheme(memoryStore("lixo").store)).toBe("forja");
    expect(readTheme(memoryStore().store)).toBe("forja");
  });

  it("applyTheme persiste no storage e readTheme devolve o mesmo id", () => {
    const { data, store } = memoryStore();
    const { root } = fakeDocument();
    applyTheme("forja", root, store);
    expect(data.get("aember-arena-theme")).toBe("forja");
    expect(readTheme(store)).toBe("forja");
  });

  it("forja remove data-theme (o seletor padrão de tokens.css vale sem atributo)", () => {
    const { root, raw } = fakeDocument();
    raw.dataset.theme = "forja";
    applyTheme("forja", root, memoryStore().store);
    expect("theme" in raw.dataset).toBe(false);
  });

  it("applyTheme atualiza o content da meta theme-color com THEME_COLOR", () => {
    const { root, meta } = fakeDocument();
    applyTheme("forja", root, memoryStore().store);
    expect(meta.attrs.content).toBe(THEME_COLOR.forja);
  });

  it("storage que lança em setItem não derruba applyTheme", () => {
    const { root, raw } = fakeDocument();
    const broken = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(() => applyTheme("forja", root, broken)).not.toThrow();
    expect("theme" in raw.dataset).toBe(false);
  });

  it("THEME_COLOR[id] é hex de 7 caracteres para todo tema", () => {
    for (const id of THEMES) expect(THEME_COLOR[id]).toMatch(/^#[0-9a-f]{6}$/);
  });
});
