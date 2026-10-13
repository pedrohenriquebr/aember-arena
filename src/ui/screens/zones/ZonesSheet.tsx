import { EyeOff, Layers } from "lucide-react";
import { useMemo, useState } from "react";
import { CardArt } from "../../../components/CardArt";
import type { CardInstance, GamePlayer } from "../../../lib/game";
import { cardTypeLabel, type Translator } from "../../../lib/i18n";
import { canOpenPile, sortPile } from "../../../lib/piles";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { Sheet } from "../../primitives/Sheet";

export type ZoneTab = "discardYou" | "discardOpp" | "archives" | "purged";

export type ZonesSheetProps = {
  t: Translator;
  /** Aba que abre: o chip que disparou (descarte de um lado ou arquivos). */
  initial: ZoneTab;
  onClose: () => void;
  /** Estado vivo da partida: as cartas mudam junto enquanto a folha está aberta. */
  players: readonly GamePlayer[];
  /** Nomes já localizados (o App resolve o idioma; a folha não lê settings). */
  names: readonly [string, string];
  viewerSide: 0 | 1;
};

/**
 * Pilhas da mesa por abas (UX_REWRITE_PLAN §5 H-26): descarte dos dois lados, arquivos e
 * purgadas. A privacidade é a mesma de piles.ts: o arquivo virado do oponente mostra só a
 * contagem. Purgadas são públicas (saíram do jogo face-up). Portal via Sheet, fora da mesa 3D.
 */
export function ZonesSheet({ t, initial, onClose, players, names, viewerSide }: ZonesSheetProps) {
  const [tab, setTab] = useState<ZoneTab>(initial);
  const you = viewerSide;
  const opp = viewerSide === 0 ? 1 : 0;
  const options = [
    { value: "discardYou" as const, label: t("ui.zones.tabDiscard", { who: t("common.you") }) },
    { value: "discardOpp" as const, label: t("ui.zones.tabDiscard", { who: names[opp] }) },
    { value: "archives" as const, label: t("ui.zones.tabArchives") },
    { value: "purged" as const, label: t("ui.zones.tabPurged") },
  ];

  return (
    <Sheet open onClose={onClose} title={t("ui.zones.title")} t={t}>
      <div className="nf-zones" data-zones-tab={tab}>
        <SegmentedControl label={t("ui.zones.title")} value={tab} options={options} onChange={setTab} className="nf-zones-tabs" />

        {/* key por aba: a troca remonta o painel e o cruzamento de opacidade roda (H-28). */}
        <div key={tab} className="nf-zones-panel nf-tab-panel">
          {tab === "discardYou" && <ZoneCards cards={players[you].discard} t={t} />}
          {tab === "discardOpp" && <ZoneCards cards={players[opp].discard} t={t} />}

          {tab === "archives" && (
            <>
              <h3 className="nf-zones-heading">{names[you]}</h3>
              {canOpenPile("archives", you, viewerSide) ? (
                <ZoneCards cards={players[you].archives} t={t} />
              ) : null}
              <h3 className="nf-zones-heading">{names[opp]}</h3>
              {canOpenPile("archives", opp, viewerSide) ? (
                <ZoneCards cards={players[opp].archives} t={t} />
              ) : (
                <section className="nf-zones-hidden" data-zones-section="archives-opp">
                  <EyeOff size={20} strokeWidth={1.6} aria-hidden="true" />
                  <p>{t("ui.zones.archivesHidden", { name: names[opp], count: players[opp].archives.length })}</p>
                </section>
              )}
            </>
          )}

          {tab === "purged" && (
            <>
              <h3 className="nf-zones-heading">{names[you]}</h3>
              <ZoneCards cards={players[you].purged} t={t} />
              <h3 className="nf-zones-heading">{names[opp]}</h3>
              <ZoneCards cards={players[opp].purged} t={t} />
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/** Grid de cartas de uma pilha pública (mesma ordem do PileDialog: título, depois tipo e id). */
function ZoneCards({ cards, t }: { cards: readonly CardInstance[]; t: Translator }) {
  const sorted = useMemo(() => sortPile(cards), [cards]);
  if (!sorted.length) {
    return (
      <div className="nf-zones-empty">
        <Layers size={20} strokeWidth={1.5} aria-hidden="true" />
        <p>{t("ui.zones.empty")}</p>
      </div>
    );
  }
  return (
    <>
      <p className="nf-zones-count">{cards.length} {t("common.cards")}</p>
      <ul className="nf-zones-grid">
        {sorted.map((item) => (
          <li key={item.instanceId} className="nf-zones-card">
            <CardArt face={item.face} size="hand" hoverZoom />
            <span className="nf-zones-caption">
              <strong>{item.face.title}</strong>
              <small>
                {cardTypeLabel(item.face.type, t)}
                {item.face.power > 0 ? ` · ${item.face.power}` : item.face.amber ? ` · ${item.face.amber}A` : ""}
              </small>
            </span>
            {item.face.isMaverick && <span className="nf-zones-mv">MV</span>}
          </li>
        ))}
      </ul>
    </>
  );
}
