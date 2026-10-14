import { Gem, Shield, Swords } from "lucide-react";
import type { CSSProperties } from "react";
import { CardArt } from "../../../components/CardArt";
import { CardText } from "../../../components/CardText";
import type { CardFace } from "../../../lib/game";
import { houseColor, houseLabel } from "../../../lib/houses";
import { cardTypeLabel, type Translator } from "../../../lib/i18n";

/**
 * Painel da carta do Detalhe (UX_REWRITE_PLAN §2 S5). Sem zoom flutuante: a arte aparece aqui,
 * no painel docado (desktop) ou na folha (mobile). `card` null = nada escolhido ainda.
 */
export function CardPane({ t, card }: { t: Translator; card: CardFace | null }) {
  if (!card) {
    return (
      <div className="nf-pane nf-pane--empty">
        <p className="nf-card-note">{t("ui.detail.paneEmpty")}</p>
      </div>
    );
  }
  return (
    <div className="nf-pane" style={{ "--house-color": houseColor(card.house) } as CSSProperties}>
      <div className="nf-pane-art">
        <CardArt face={card} size="preview" hoverZoom={false} />
      </div>
      <h2 className="nf-pane-title">{card.title}</h2>
      <p className="nf-pane-sub">
        {houseLabel(card.house, t)} · {cardTypeLabel(card.type, t)}{card.cardNumber ? ` · #${card.cardNumber}` : ""}
      </p>
      {card.traits && <p className="nf-pane-traits">{card.traits}</p>}
      <p className="nf-pane-text">{card.text ? <CardText text={card.text} t={t} /> : t("inspector.noText")}</p>
      <div className="nf-pane-stats">
        {card.amber > 0 && <span><Gem size={14} aria-hidden="true" /> {card.amber} {t("inspector.amber")}</span>}
        {card.power > 0 && <span><Swords size={14} aria-hidden="true" /> {card.power} {t("inspector.power")}</span>}
        {card.armor > 0 && <span><Shield size={14} aria-hidden="true" /> {card.armor} {t("inspector.armor")}</span>}
        {card.rarity && <span className="nf-pane-rarity">{card.rarity}</span>}
      </div>
    </div>
  );
}
