import type { CSSProperties, ReactNode } from "react";
import { CardArt } from "../../../components/CardArt";
import { coverageCounts } from "../../../components/CoverageBadge";
import type { CardFace, DeckInfo } from "../../../lib/game";
import type { Translator } from "../../../lib/i18n";
import { HouseTrio } from "./HouseTrio";

/** Três cartas para o leque: a primeira, a do meio e a última (sem repetir). */
export function fanFaces(cards: CardFace[]): CardFace[] {
  const last = cards.length - 1;
  if (last < 0) return [];
  return [...new Set([0, Math.floor(last / 2), last])].map((index) => cards[index]);
}

/**
 * Hero do deck (UX_REWRITE_PLAN §5 H-11): leque de até 3 cartas reais (CardArt), nome em
 * display, casas com nome, contagem e quantas cartas o motor simula. `actions` é o slot
 * das ações da tela (o Lobby põe força, oponente e Jogar; o Detalhe porá o CTA dele).
 */
export function DeckHero({ deck, t, actions, heading = "h1" }: {
  deck: DeckInfo;
  t: Translator;
  actions?: ReactNode;
  /** O Lobby tem um só h1; a galeria (_kit) põe o hero abaixo do título da página. */
  heading?: "h1" | "h2";
}) {
  const faces = fanFaces(deck.cards);
  const { full } = coverageCounts(deck.cards);
  const total = deck.cards.length;
  const Heading = heading;

  return (
    <section className="nf-hero" aria-labelledby="nf-hero-name">
      <div className="nf-hero-fan" aria-hidden="true">
        {faces.map((face, index) => (
          <div
            key={`${face.id}-${index}`}
            className="nf-fan-card"
            // Ângulo simétrico em torno do centro: -11°, 0°, 11° para três cartas.
            style={{ "--fan": `${(index - (faces.length - 1) / 2) * 11}deg` } as CSSProperties}
          >
            <CardArt face={face} size="preview" />
          </div>
        ))}
      </div>
      <div className="nf-hero-copy">
        <Heading id="nf-hero-name" className="nf-hero-name">{deck.name}</Heading>
        <HouseTrio houses={deck.houses ?? []} t={t} />
        <p className="nf-hero-meta">
          <span>{total} {t("common.cards")}</span>
          <span>{t("coverage.deck", { full, total })}</span>
        </p>
        {actions}
      </div>
    </section>
  );
}
