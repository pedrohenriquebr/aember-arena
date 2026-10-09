import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";
import { Chip } from "./Chip";
import { Panel } from "./Panel";
import { StatBlock } from "./StatBlock";

// Gate de tipos do H-05 (UX_REWRITE_PLAN §5): o typecheck (tsc --noEmit) cobre este arquivo,
// então o @ts-expect-error abaixo quebra o build se o botão só-ícone deixar de exigir aria-label.
describe("H-05 primitivas A", () => {
  it("Button só-ícone sem aria-label não compila", () => {
    // @ts-expect-error botão só-ícone exige aria-label (UX_REWRITE_PLAN §5 H-05)
    const unlabelled = <Button icon={<span />} />;
    expect(unlabelled).toBeDefined();
  });

  it("Button com texto aceita a forma sem aria-label", () => {
    const labelled = <Button variant="primary">Forjar</Button>;
    expect(labelled).toBeDefined();
  });

  it("Button renderiza type=button, variante e tamanho", () => {
    const html = renderToStaticMarkup(<Button variant="primary" size="lg">Forjar</Button>);
    expect(html).toContain('type="button"');
    expect(html).toContain("nf-btn--primary");
    expect(html).toContain("nf-btn--lg");
    expect(html).not.toContain("data-dense");
  });

  it("sm marca data-dense (alvo de 36px); md não", () => {
    expect(renderToStaticMarkup(<Button size="sm">x</Button>)).toContain("data-dense");
    expect(renderToStaticMarkup(<Button>x</Button>)).not.toContain("data-dense");
  });

  it("só-ícone leva o aria-label e a classe de quadrado", () => {
    const html = renderToStaticMarkup(<Button icon={<span>+</span>} aria-label="Adicionar" />);
    expect(html).toContain('aria-label="Adicionar"');
    expect(html).toContain("nf-btn--icon");
  });

  it("Chip, Panel e StatBlock montam com o texto e o tom", () => {
    expect(renderToStaticMarkup(<Chip tone="ember">Brasa</Chip>)).toContain("nf-chip--ember");
    expect(renderToStaticMarkup(<Panel tone="s2" as="section">corpo</Panel>)).toMatch(/^<section class="nf-panel nf-panel--s2">corpo<\/section>$/);
    const stat = renderToStaticMarkup(<StatBlock tone="amber" label="Æmber" value={12} hint="de 15" />);
    expect(stat).toContain("nf-stat--amber");
    expect(stat).toContain("nf-stat-hint");
  });
});
