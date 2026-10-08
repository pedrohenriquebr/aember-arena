import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createTranslator, DICT } from "./i18n";

// Convenção da v2 (UX_REWRITE_PLAN §5 H-04): toda tela nova usa chaves ui.<tela>.<elemento>
// e cada chave tem as DUAS línguas. Este teste pega o t("…") órfão antes do e2e.
const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "ui");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function sourceFiles(): string[] {
  return walk(UI_DIR).filter((file) => /\.(ts|tsx)$/.test(file));
}

// Só literais: t("chave") / t('chave') e o prefixo estático de t(`prefixo.${…}`).
const STATIC_KEY = /\bt\(\s*["']([^"']+)["']/g;
const TEMPLATE_PREFIX = /\bt\(\s*`([^`$]*)\$\{/g;

function collect() {
  const keys = new Set<string>();
  const prefixes = new Set<string>();
  for (const file of sourceFiles()) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(STATIC_KEY)) keys.add(m[1]);
    for (const m of src.matchAll(TEMPLATE_PREFIX)) if (m[1]) prefixes.add(m[1]);
  }
  return { keys, prefixes };
}

const ptBR = createTranslator("ptBR");
const en = createTranslator("en");

describe("H-04 paridade i18n da v2 (UX_REWRITE_PLAN §5 H-04)", () => {
  const { keys, prefixes } = collect();

  it("toda t(\"chave\") literal em src/ui existe em pt-BR e en", () => {
    for (const key of keys) {
      const pair = DICT[key];
      expect(pair, `chave ausente no dicionário: ${key}`).toBeDefined();
      expect(ptBR(key), `sem pt-BR: ${key}`).not.toBe(key);
      expect(en(key), `sem en: ${key}`).not.toBe(key);
    }
  });

  it("todo prefixo de t(`prefixo.${…}`) tem ao menos uma chave nas duas línguas", () => {
    for (const prefix of prefixes) {
      const matches = Object.keys(DICT).filter((key) => key.startsWith(prefix));
      expect(matches.length, `nenhuma chave com o prefixo: ${prefix}`).toBeGreaterThan(0);
    }
  });

  it("nenhum par [en, pt-BR] do dicionário tem string vazia", () => {
    for (const [key, [english, portuguese]] of Object.entries(DICT)) {
      expect(english.trim(), `en vazio: ${key}`).not.toBe("");
      expect(portuguese.trim(), `pt-BR vazio: ${key}`).not.toBe("");
    }
  });
});
