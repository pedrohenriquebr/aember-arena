import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTranslator, DICT } from "../../../lib/i18n";
import { THEMES } from "../../theme";
import { ThemePicker } from "./ThemePicker";

// Contrato do ThemePicker (UX_REWRITE_PLAN §5 H-18, §1.6.2): radiogroup de 4 cartões
// role=radio com data-theme do próprio tema e a miniatura dentro; o anel fica no slot
// externo (fora do data-theme do cartão). As 9 chaves novas têm as duas línguas.
const t = createTranslator("ptBR");
const html = renderToStaticMarkup(<ThemePicker t={t} value="aco" onChange={() => {}} />);

describe("H-18 ThemePicker (UX_REWRITE_PLAN §5 H-18)", () => {
  it("é um radiogroup rotulado com os 4 cartões role=radio e data-theme", () => {
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain(`aria-label="${t("ui.theme.title")}"`);
    for (const id of THEMES) {
      expect(html).toContain(`role="radio"`);
      expect(html).toContain(`data-theme="${id}"`);
    }
    expect((html.match(/role="radio"/g) ?? []).length).toBe(THEMES.length);
  });

  it("aria-checked marca só o valor vigente; os demais ficam desmarcados", () => {
    expect(html).toMatch(/data-theme="aco"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-theme="aco"/);
    expect((html.match(/aria-checked="true"/g) ?? []).length).toBe(1);
  });

  it("a miniatura vive dentro do cartão e o slot (anel) envolve o cartão por fora", () => {
    // O anel --nf-lit-accent do tema vigente precisa estar no slot, FORA do data-theme
    // do cartão — dentro dele o anel sairia na cor do tema que o cartão representa.
    expect(html).toMatch(/class="u-theme-slot"[^>]*data-lit="true"/);
    expect(html.indexOf("u-theme-preview")).toBeGreaterThan(html.indexOf('data-theme="forja"'));
    expect(html.indexOf("u-theme-preview")).toBeLessThan(html.indexOf("</button>"));
  });

  it("as 9 chaves novas de tema existem nas duas línguas", () => {
    const en = createTranslator("en");
    const keys = [
      "ui.theme.title",
      ...THEMES.flatMap((id) => [`ui.theme.${id}.name`, `ui.theme.${id}.desc`]),
    ];
    expect(keys).toHaveLength(9);
    for (const key of keys) {
      expect(DICT[key], `chave ausente: ${key}`).toBeDefined();
      expect(t(key), `sem pt-BR: ${key}`).not.toBe(key);
      expect(en(key), `sem en: ${key}`).not.toBe(key);
    }
  });
});
