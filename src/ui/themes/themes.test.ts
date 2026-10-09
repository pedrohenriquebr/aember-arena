import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEMES, THEME_COLOR, type ThemeId } from "../theme";

// Lê o CSS do disco: o ?raw do vitest devolve "" para arquivos .css (o pipeline de CSS fica desligado).
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const tokensCss = read("../tokens.css");
const acoCss = read("./aco.css");
const arcanoCss = read("./arcano.css");
const claroCss = read("./claro.css");

// Contrato de §1.6.1: os 22 tokens cromáticos que todo tema declara, com valores literais.
export const REQUIRED = ["void", "s1", "s2", "s3", "felt", "felt-text", "line", "line-strong", "edge", "text", "text-2",
  "text-3", "accent", "accent-hi", "accent-deep", "on-accent", "aember", "ether", "ember", "verdant", "shadow", "scrim"] as const;

// [fg, bg, mínimo] — a tabela de §1.6.4. "edge" é composto (alfa) sobre o bg antes de medir.
export const PAIRS = [["text", "s2", 7], ["text-2", "s2", 4.5], ["text-3", "s2", 4.5], ["accent", "s2", 4.5],
  ["on-accent", "accent", 4.5], ["on-accent", "accent-hi", 4.5], ["on-accent", "accent-deep", 4.5],
  ["ether", "s2", 4.5], ["ether", "felt", 4.5], ["ember", "s2", 4.5], ["verdant", "s2", 4.5], ["aember", "s2", 4.5],
  ["felt-text", "felt", 4.5], ["edge", "s2", 3], ["edge", "s3", 3]] as const;

// Declarações de cada bloco [data-theme="<id>"] (comentários fora). Vários blocos do mesmo
// seletor somam: o Claro tem o bloco de tokens e o override do lit, depois dos tokens.
function declarationsOf(css: string, selector: string): Record<string, string> {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Record<string, string> = {};
  const opener = `${selector} {`;
  let at = stripped.indexOf(opener);
  while (at !== -1) {
    const open = at + opener.length - 1;
    const end = stripped.indexOf("}", open);
    for (const decl of stripped.slice(open + 1, end).matchAll(/(--nf-[\w-]+|color-scheme)\s*:\s*([^;]+);/g)) out[decl[1]] = decl[2].trim();
    at = stripped.indexOf(opener, end);
  }
  return out;
}

// Os 22 tokens de um tema (sem o override do lit, que é derivado e tem var() por desenho).
function contractOf(id: ThemeId): Record<string, string> {
  const sources: Record<ThemeId, [string, string]> = {
    forja: [tokensCss, '[data-theme="forja"]'],
    aco: [acoCss, '[data-theme="aco"]'],
    claro: [claroCss, '[data-theme="claro"]'],
    arcano: [arcanoCss, '[data-theme="arcano"]'],
  };
  const [css, selector] = sources[id];
  const all = declarationsOf(css, selector);
  return Object.fromEntries(Object.entries(all).filter(([name]) => !name.startsWith("--nf-lit-")));
}

// Cor → [r, g, b, alfa] (0–255). Só hex de 6 dígitos e rgba/rgb com vírgulas, que são os formatos da tabela.
function parseColor(value: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(value);
  if (fn) {
    const parts = fn[1].split(",").map((part) => Number(part.trim()));
    return [parts[0], parts[1], parts[2], parts[3] ?? 1];
  }
  throw new Error(`cor não reconhecida: ${value}`);
}

// Alfa sobre fundo opaco (WCAG mede cor sólida).
function composite(fg: [number, number, number, number], bg: [number, number, number, number]): [number, number, number, number] {
  const [r, g, b, a] = fg;
  return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a), 1];
}

function luminance([r, g, b]: [number, number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: [number, number, number, number], b: [number, number, number, number]): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Mede um par de um tema: o bg é opaco e o fg composto sobre ele quando tem alfa.
function measure(tokens: Record<string, string>, fg: string, bg: string): number {
  const bgColor = parseColor(tokens[`--nf-${bg}`]);
  const fgRaw = parseColor(tokens[`--nf-${fg}`]);
  return contrast(composite(fgRaw, bgColor), bgColor);
}

describe("H-02c temas (plano UX_REWRITE §1.6)", () => {
  it("o tema forja em tokens.css e os temas de themes/ estão registrados em THEMES", () => {
    expect([...THEMES].sort()).toEqual(["aco", "arcano", "claro", "forja"]);
  });

  for (const id of THEMES) {
    it(`${id}: declara exatamente os 22 tokens do contrato, sem var(), e o color-scheme`, () => {
      const tokens = contractOf(id);
      expect(Object.keys(tokens).filter((name) => name !== "color-scheme").map((name) => name.slice(5)).sort())
        .toEqual([...REQUIRED].sort());
      for (const [name, value] of Object.entries(tokens)) expect(value, name).not.toMatch(/var\(/);
      expect(tokens["color-scheme"]).toBeDefined();
    });

    it(`${id}: todos os pares da tabela §1.6.4 passam o mínimo WCAG`, () => {
      const tokens = contractOf(id);
      const failures = PAIRS.flatMap(([fg, bg, min]) => {
        const ratio = measure(tokens, fg, bg);
        return ratio >= min ? [] : [`${fg}/${bg} = ${ratio.toFixed(2)} (mín ${min})`];
      });
      expect(failures).toEqual([]);
    });

    it(`${id}: color-scheme ${id === "claro" ? "light" : "dark"} e THEME_COLOR igual ao --nf-void`, () => {
      const tokens = contractOf(id);
      expect(tokens["color-scheme"]).toBe(id === "claro" ? "light" : "dark");
      expect(THEME_COLOR[id].toLowerCase()).toBe(tokens["--nf-void"].toLowerCase());
    });
  }

  it("o Claro troca o lit por anel duplo sem blur (override depois dos tokens)", () => {
    const lit = declarationsOf(claroCss, '[data-theme="claro"]');
    expect(lit["--nf-lit-accent"]).toMatch(/^0 0 0 2px var\(--nf-s2\), 0 0 0 4px var\(--nf-accent\)/);
  });
});
