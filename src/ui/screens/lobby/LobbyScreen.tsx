import type { CSSProperties } from "react";
import { ChevronRight, Swords } from "lucide-react";
import type { DeckStats, LibraryDeck } from "../../../lib/cache";
import type { DeckInfo } from "../../../lib/game";
import type { Translator } from "../../../lib/i18n";
import { Button } from "../../primitives/Button";
import { Skeleton } from "../../primitives/Skeleton";
import { shelfOrder } from "../../lib/shelf";
import type { StrengthPreset } from "../../lib/presets";
import { StrengthPicker } from "../StrengthPicker";
import type { ResumeInfo } from "../../lib/resume";
import { ContinueCard } from "./ContinueCard";
import { DeckHero } from "./DeckHero";
import { DeckShelf } from "./DeckShelf";
import { RecordCard } from "./RecordCard";

export interface LobbyScreenProps {
  t: Translator;
  /** Deck do hero (o que "Jogar" leva à mesa). */
  selectedDeck: DeckInfo;
  /** Biblioteca inteira, iniciais incluídos (a prateleira ordena). */
  savedDecks: LibraryDeck[];
  /** Ids dos decks iniciais: não podem ser removidos e não ganham a etiqueta "salvo". */
  starterIds: ReadonlySet<string>;
  /** Partida viva ou salva: troca o primário para "Continuar" (UX_REWRITE_PLAN §3.2). */
  resume: ResumeInfo | null;
  /** Recorde V/D do deck do hero (null = ainda não carregou ou sem partidas). */
  lastRecord: DeckStats | null;
  /** Nome do oponente para a linha "contra …" (espelho, deck escolhido ou sorteado). */
  opponentLabel: string;
  /** Força atual (null = personalizada, em Avançado); o Lobby troca só os quatro degraus. */
  strength: StrengthPreset | null;
  onStrength: (preset: StrengthPreset) => void;
  canReplay: boolean;
  /** Estado C (UX_REWRITE_PLAN §2 S2): esqueletos no lugar do hero e da prateleira. */
  loading?: boolean;
  onPlay: (deck: DeckInfo) => void;
  onContinue: () => void;
  onOpenMatchSheet: () => void;
  onSelectDeck: (deck: DeckInfo) => void;
  onInspect: (deck: DeckInfo) => void;
  onImport: () => void;
  onExplore: () => void;
  onToggleFavorite: (deck: LibraryDeck) => void;
  onRemoveDeck: (deck: LibraryDeck) => void;
  onReplay: () => void;
}

/**
 * Lobby da v2 (UX_REWRITE_PLAN §2 S2): um painel de jogar, não uma lista de decks. Hero do
 * deck escolhido com o Jogar à vista; à direita a partida salva e o recorde; embaixo a
 * prateleira. A cascata de entrada tem 4 itens (§1.5: ≤5), e as partículas são data-decor.
 */
export function LobbyScreen(props: LobbyScreenProps) {
  const { t, selectedDeck, savedDecks, starterIds, resume, lastRecord, opponentLabel, canReplay, loading = false } = props;
  const starters = savedDecks.filter((deck) => starterIds.has(deck.id));
  const shelf = shelfOrder(savedDecks, starters, starterIds);
  const hasSaved = savedDecks.some((deck) => !starterIds.has(deck.id));

  return (
    <div className="nf-lobby" data-screen="lobby" aria-busy={loading || undefined}>
      <span className="nf-lobby-dust" data-decor aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => (
          <i key={index} />
        ))}
      </span>

      <div className="nf-lobby-top">
        <div className="nf-lobby-hero" data-enter style={{ "--i": 0 } as CSSProperties}>
          {loading ? (
            <Skeleton height="200px" shape="block" />
          ) : (
            <DeckHero
              deck={selectedDeck}
              t={t}
              actions={(
                <div className="nf-lobby-actions">
                  <StrengthPicker t={t} value={props.strength} onChange={props.onStrength} />
                  <button type="button" className="nf-opponent" onClick={props.onOpenMatchSheet}>
                    <span>{t("ui.lobby.vs", { name: opponentLabel })}</span>
                    <ChevronRight size={16} />
                  </button>
                  {resume ? (
                    <Button variant="secondary" data-action="new-match" onClick={() => props.onPlay(selectedDeck)}>
                      {t("ui.lobby.newMatch")}
                    </Button>
                  ) : (
                    <Button variant="primary" size="lg" icon={<Swords size={18} />} data-action="play" onClick={() => props.onPlay(selectedDeck)}>
                      {t("ui.lobby.play")}
                    </Button>
                  )}
                </div>
              )}
            />
          )}
        </div>

        <aside className="nf-lobby-side">
          {resume && (
            <div data-enter style={{ "--i": 1 } as CSSProperties}>
              <ContinueCard t={t} resume={resume} onContinue={props.onContinue} />
            </div>
          )}
          <div data-enter style={{ "--i": 2 } as CSSProperties}>
            <RecordCard t={t} record={lastRecord} canReplay={canReplay} onReplay={props.onReplay} />
          </div>
        </aside>
      </div>

      <div data-enter style={{ "--i": 3 } as CSSProperties}>
        {loading ? (
          <div className="nf-shelf-grid" aria-hidden="true">
            <Skeleton height="120px" shape="block" />
            <Skeleton height="120px" shape="block" />
            <Skeleton height="120px" shape="block" />
          </div>
        ) : (
          <DeckShelf
            t={t}
            decks={shelf}
            starterIds={starterIds}
            selectedId={selectedDeck.id}
            hasSaved={hasSaved}
            onPlay={props.onPlay}
            onSelect={props.onSelectDeck}
            onInspect={props.onInspect}
            onToggleFavorite={props.onToggleFavorite}
            onRemove={props.onRemoveDeck}
            onImport={props.onImport}
            onExplore={props.onExplore}
          />
        )}
      </div>

      <p className="nf-lobby-fine" role="contentinfo">{t("ui.disclaimer")}</p>
    </div>
  );
}
