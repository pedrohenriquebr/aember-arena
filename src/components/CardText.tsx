import { Gem, Swords } from "lucide-react";
import { splitCardGlyphs } from "../lib/cardText";
import type { Translator } from "../lib/i18n";

/** Texto impresso da carta com Æmber/dano como ícone inline (o glifo privado do
    MV não existe na fonte). Sem `t` os ícones ficam só visuais. */
export function CardText({ text, t }: { text: string; t?: Translator }) {
  return (
    <>
      {splitCardGlyphs(text).map((part, index) => {
        if (typeof part === "string") return part;
        const Icon = part.glyph === "A" ? Gem : Swords;
        return (
          <span className="card-glyph" key={index}>
            <Icon size="1em" strokeWidth={2.2} aria-hidden="true" />
            {t && <span className="sr-only">{part.glyph === "A" ? t("inspector.amber") : t("inspector.damage")}</span>}
          </span>
        );
      })}
    </>
  );
}
