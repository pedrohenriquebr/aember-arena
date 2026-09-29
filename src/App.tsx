import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Crosshair,
  Clock3,
  Cpu,
  Crown,
  ExternalLink,
  Eye,
  Gem,
  Home,
  KeyRound,
  Languages,
  Link2,
  LoaderCircle,
  Music,
  Radio,
  RefreshCw,
  RotateCcw,
  Settings2,
  Shield,
  Sword,
  Swords,
  Volume2,
  VolumeX,
  Trash2,
  Wand2,
  Wifi,
  WifiOff,
  X,
  Zap,
  ZoomIn,
} from "lucide-react";
import { chooseAiHouse, chooseAiMove, describeAiThinking, shouldMulligan, type Difficulty } from "./lib/ai";
import { cacheDeck, clearSavedMatch, deleteDeck, getCachedDeck, getDeckStats, listCachedDecks, loadSavedMatch, recordMatchResult, saveMatch, setDeckFavorite, type DeckStats, type LibraryDeck, type SavedMatch } from "./lib/cache";
import { DEMO_DECK, DEMO_DECK_ID } from "./lib/demoDeck";
import { DEMO_DECK_2 } from "./lib/demoDeck2";
import {
  applyMove,
  chooseHouse,
  createMatch,
  createPassAndPlayMatch,
  endTurn,
  fightTargets,
  getLegalMoves,
  isLegalMove,
  keepHand,
  keyCost,
  mulligan,
  revealsHiddenInfo,
  targetChoices,
  type CardInstance,
  type DeckInfo,
  type GameMove,
  type GameState,
  type LogEntry,
  refreshGameFaces,
} from "./lib/game";
import { fetchKeyforgeDeck, loadDeckOrCache, vaultErrorText } from "./lib/keyforgeApi";
import { createTranslator, LANGUAGES, readLanguage, saveLanguage, type Language, type Translator,
  cardTypeLabel,} from "./lib/i18n";
import { readSettings, saveSettings, type AppSettings, type GameMode, type OpponentMode } from "./lib/settings";
import { sound } from "./lib/sound";
import { CardArt, CardLightbox, houseColor, houseLabel } from "./components/CardArt";
import { CoverageBadge, DeckCoverageChip } from "./components/CoverageBadge";
import { DeckTile, HouseMark } from "./components/DeckTile";
import { HouseIcon } from "./components/HouseIcon";
import { DeckBrowser, type BrowseState } from "./components/DeckBrowser";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DeckInspector } from "./components/DeckInspector";
import { Pagination } from "./components/Pagination";
import { useDialogFocus } from "./components/useDialogFocus";
import { isFirstVisit, markTutorialSeen, TutorialWizard } from "./components/TutorialWizard";

type Screen = "home" | "config" | "game" | "browse" | "inspect";
type Selection = { zone: "hand" | "board" | "enemy"; playerIndex: 0 | 1; instanceId: string };
/** Board pick in progress: a fight defender (`targetId` still empty) or the
    target of the move's ability / an upgrade's host. `ids` are the legal cards. */
type Pick = { move: GameMove; ids: string[] };
type Toast = {
  message: string;
  kind: "success" | "error";
  /** FEAT-09: botão único do toast (ex.: "Recarregar" na atualização do PWA). */
  action?: { label: string; onClick: () => void };
  /** Sem auto-dismiss: o aviso de atualização fica até o jogador agir. */
  sticky?: boolean;
} | null;

/** FEAT-12a: one step of the undo history — the state a transition left behind,
    whether that transition consumed hidden information, and how many replay
    steps were recorded while that state was live. */
type UndoEntry = { state: GameState; revealed: boolean; step: number };

/** FEAT-12b: one recorded transition of the match. The seed plus this list
    rebuilds every state of the match (createMatch + applyStep), which is what
    the replay viewer walks — the live match is never touched. */
type ReplayStep =
  | { kind: "house"; side: 0 | 1; house: string }
  | { kind: "keep" | "mulligan"; side: 0 | 1 }
  | { kind: "end"; side: 0 | 1 }
  | { kind: "move"; side: 0 | 1; move: GameMove };

function applyStep(state: GameState, step: ReplayStep): GameState {
  if (step.kind === "house") return chooseHouse(state, step.side, step.house);
  if (step.kind === "move") return applyMove(state, step.side, step.move);
  if (step.kind === "end") return endTurn(state, step.side);
  return step.kind === "mulligan" ? mulligan(state, step.side) : keepHand(state, step.side);
}

/** Read-only GameBoard callbacks for the replay viewer. */
const NOOP = () => undefined;

const DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard", "Very hard", "Impossible"];
const STARTER_DECKS: DeckInfo[] = [DEMO_DECK, DEMO_DECK_2];
/** FEAT-12a: how many past states the undo history keeps (memory cap). */
const UNDO_LIMIT = 40;

// T5: hover só existe quando o dispositivo anuncia "(hover: hover)"; em touch o
// toggle hoverZoom some e a inspeção vai por long-press (CardLightbox).
function prefersHover() {
  return typeof window !== "undefined" && window.matchMedia?.("(hover: hover)")?.matches === true;
}

// game.ts is pure and language-agnostic, so the fixed player/deck names it
// creates are localized at render time (score bands and the log alike).
function localizeName(name: string, t: Translator): string {
  if (name === "You") return t("log.you");
  if (name === "The Ember Warden") return t("log.warden");
  if (name === "Player 1") return t("game.player1");
  if (name === "Player 2") return t("game.player2");
  if (name === "Warden's mirror deck") return t("game.mirrorDeck");
  return name;
}

// Translate a structured log entry, localizing the known player/deck names.
function renderLog(entry: LogEntry, t: Translator): string {
  const params: Record<string, string> = { ...entry.params };
  if (params.name) params.name = localizeName(params.name, t);
  if (params.rival) params.rival = localizeName(params.rival, t);
  if (params.house) params.house = houseLabel(params.house, t);
  return t(entry.key, params);
}

/** FEAT-10: the opening-hand micro-phase, before the match really starts. */
const inMulligan = (game: GameState) => game.pendingMulligan === 0 || game.pendingMulligan === 1;

/** FEAT-13: the side currently holding the device. Solo always plays side 0;
    pass-and-play follows the active side (and the mulligan micro-phase, which
    runs side 0 then side 1 before the first turn). */
function humanSideOf(state: GameState, mode: GameMode): 0 | 1 {
  if (mode !== "passAndPlay") return 0;
  return inMulligan(state) ? (state.pendingMulligan as 0 | 1) : state.activePlayer;
}

/** FEAT-13: the two pass-and-play decks — the persisted ids, the Home selection
    as the P1 fallback and a different library deck as the P2 fallback, so the
    two sides never share a deck. */
function resolvePassDecks(savedDecks: LibraryDeck[], fallback: DeckInfo, settings: AppSettings): [DeckInfo, DeckInfo] {
  const p1 = savedDecks.find((item) => item.id === settings.deckP1Id) ?? fallback;
  const p2 =
    savedDecks.find((item) => item.id === settings.deckP2Id && item.id !== p1.id) ??
    savedDecks.find((item) => item.id !== p1.id) ??
    fallback;
  return [p1, p2];
}

/** BUG2-04: rebuilds the DeckInfo a saved match played with, straight from the
    state — a deck removed from the library (or not loaded yet) must not fall
    into the demo deck and steal its title, W/L record and rematch. */
function deckFromState(player: GameState["players"][number], id: string): DeckInfo {
  const cards = [player.deck, player.hand, player.discard, player.board, player.archives ?? []]
    .flat()
    .flatMap((card) => [card.face, ...(card.under ?? []).map((half) => half.face)]);
  return { id, name: player.deckName, houses: player.houses, cards };
}

/** FEAT-05: log keys the type filter knows about (the rest pass every filter). */
type LogType = "play" | "fight" | "reap" | "use" | "forge";

// ---------- Small shared components ----------

// The forge glyph of public/forge-icon.svg, so header and favicon share one mark.
function ForgeMark() {
  return (
    <svg viewBox="20 10 88 100" width="19" height="19" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden="true">
      <path d="M64 15 102 37v44L64 105 26 81V37z" strokeWidth="6" />
      <path d="M64 39v31m-13-17h26M55 43l18 19m0-19L55 62" strokeWidth="7" />
    </svg>
  );
}

type CardTileProps = {
  card: CardInstance;
  size: "hand" | "board" | "preview";
  selected?: boolean;
  dimmed?: boolean;
  disabled?: boolean;
  hoverZoom?: boolean;
  playAnim?: boolean;
  /** Estado da peça (READY/STUNNED/RESTING via t()) — vai só no aria-label (T4). */
  stateLabel?: string;
  /** Dano da criatura via t() — badge visual dentro do tile (T4). */
  damageLabel?: string;
  /** FEAT-04: a carta tem ao menos um movimento legal agora. */
  hinted?: boolean;
  /** T5 — tradutor p/ o CardLightbox do long-press touch. */
  t: Translator;
  /** T7d — recebe a própria carta: o pai passa o handler estável direto
      (sem closure por carta) e o memo do tile funciona. */
  onClick?: (card: CardInstance) => void;
};

// T7d: cloneGame (game.ts:138-153) recria todo CardInstance a cada move e só
// preserva a identidade de `face`; comparar por VALOR (instanceId + campos que
// afetam o render) é o que deixa o memo enxergar cartas cujo estado não mudou.
function sameCardInstance(a: CardInstance, b: CardInstance): boolean {
  return (
    a === b ||
    (a.instanceId === b.instanceId &&
      a.face === b.face &&
      a.damage === b.damage &&
      a.ready === b.ready &&
      a.stunned === b.stunned &&
      (a.amber ?? 0) === (b.amber ?? 0) &&
      (a.attachedTo ?? "") === (b.attachedTo ?? ""))
  );
}

function areCardTilePropsEqual(a: CardTileProps, b: CardTileProps): boolean {
  return (
    a.size === b.size &&
    a.selected === b.selected &&
    a.dimmed === b.dimmed &&
    a.disabled === b.disabled &&
    a.hoverZoom === b.hoverZoom &&
    a.playAnim === b.playAnim &&
    a.stateLabel === b.stateLabel &&
    a.damageLabel === b.damageLabel &&
    a.hinted === b.hinted &&
    a.t === b.t &&
    a.onClick === b.onClick &&
    sameCardInstance(a.card, b.card)
  );
}

const CardTile = memo(function CardTile({
  card,
  size,
  selected = false,
  dimmed = false,
  disabled = false,
  hoverZoom = false,
  playAnim = false,
  stateLabel,
  damageLabel,
  hinted = false,
  t,
  onClick,
}: CardTileProps) {
  const { face } = card;
  // T8: casa e tipo do aria-label passam por t() (houseLabel aceita tradutor opcional).
  const baseLabel = `${face.title}, ${houseLabel(face.house, t)} ${cardTypeLabel(face.type, t)}`;
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const longPressAt = useRef(0);
  return (
    <>
      <button
        className={`card-tile card-tile--${size}${selected ? " is-selected" : ""}${dimmed ? " is-dimmed" : ""}${playAnim ? " card-tile--enter" : ""}${hinted ? " card-tile--hint" : ""}`}
        type="button"
        onClick={() => {
          // T5: o long-press já abriu a inspeção — o click sintético do toque não seleciona.
          if (Date.now() - longPressAt.current < 700) return;
          onClick?.(card);
        }}
        disabled={disabled || !onClick}
        aria-label={stateLabel ? `${baseLabel}, ${stateLabel}` : hinted ? `${baseLabel}, ${t("game.hintPlayable")}` : baseLabel}
      >
        <CardArt
          face={face}
          size={size}
          hoverZoom={hoverZoom}
          onLongPress={() => {
            longPressAt.current = Date.now();
            setLightboxOpen(true);
          }}
        />
        {size !== "preview" && <span className="card-caption">{face.title}</span>}
        {damageLabel && <span className="damage-label">{damageLabel}</span>}
        {/* BUG-08: captured amber used to be inspector-only. */}
        {(card.amber ?? 0) > 0 && (
          <span className="amber-label" role="img" aria-label={t("game.capturedAria", { count: card.amber ?? 0 })}>
            <Gem size={10} strokeWidth={2.2} />
            {card.amber}
          </span>
        )}
      </button>
      <CardLightbox face={lightboxOpen ? face : null} t={t} onClose={() => setLightboxOpen(false)} />
    </>
  );
}, areCardTilePropsEqual);

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle${checked ? " toggle--on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
    </button>
  );
}

// ---------- Language menu ----------

function LanguageMenu({
  language,
  onChange,
  label,
  compact = false,
}: {
  language: Language;
  onChange: (language: Language) => void;
  /** T8: aria-label do gatilho via t() — antes era "Language" fixo. */
  label: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = LANGUAGES.find((item) => item.id === language) ?? LANGUAGES[0];

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="lang-menu" ref={ref}>
      <button
        type="button"
        className={`lang-trigger${compact ? " lang-trigger--compact" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
      >
        <Languages size={14} />
        <span className="lang-flag">{current.flag}</span>
        {!compact && <span className="lang-short">{current.short}</span>}
      </button>
      {open && (
        <div className="lang-dropdown" role="listbox">
          {LANGUAGES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={item.id === language}
              className={`lang-option${item.id === language ? " is-active" : ""}`}
              onClick={() => {
                onChange(item.id);
                setOpen(false);
              }}
            >
              <span className="lang-flag">{item.flag}</span>
              <span>{item.label}</span>
              {item.id === language && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Home screen ----------

const HOME_PAGE_SIZE = 6;

function HomeScreen({
  t,
  language,
  savedDecks,
  selectedDeck,
  onSelectDeck,
  onInspectDeck,
  onToggleFavorite,
  onRemoveDeck,
  onOpenImport,
  onOpenBrowse,
  onContinue,
  onLanguage,
  onOpenTutorial,
}: {
  t: Translator;
  language: Language;
  savedDecks: LibraryDeck[];
  selectedDeck: DeckInfo;
  onSelectDeck: (deck: DeckInfo) => void;
  onInspectDeck: (deck: DeckInfo) => void;
  onToggleFavorite: (deck: LibraryDeck) => void;
  onRemoveDeck: (deck: LibraryDeck) => void;
  onOpenImport: () => void;
  onOpenBrowse: () => void;
  onContinue: () => void;
  onLanguage: (language: Language) => void;
  onOpenTutorial: () => void;
}) {
  const starterIds = new Set(STARTER_DECKS.map((deck) => deck.id));
  const extraSaved = savedDecks.filter((deck) => !starterIds.has(deck.id));
  // FEAT-07: favorites pin their decks ahead of the bundled ones on the first page.
  const favoriteDecks = extraSaved.filter((deck) => deck.favorite);
  const allDecks: LibraryDeck[] = [...favoriteDecks, ...STARTER_DECKS, ...extraSaved.filter((deck) => !deck.favorite)];
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(allDecks.length / HOME_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = allDecks.slice((currentPage - 1) * HOME_PAGE_SIZE, currentPage * HOME_PAGE_SIZE);
  const savedIds = new Set(extraSaved.map((deck) => deck.id));

  return (
    <div className="screen home-screen">
      <div className="home-hero">
        <div className="home-hero-glow" aria-hidden="true" />
        <span className="eyebrow">{t("home.eyebrow")}</span>
        <h1>{t("home.title")}</h1>
        <p>{t("home.subtitle")}</p>
        <div className="home-steps">
          <span className="home-step is-active"><i>1</i>{t("home.step.deck")}</span>
          <ChevronRight size={13} />
          <span className="home-step"><i>2</i>{t("home.step.config")}</span>
          <ChevronRight size={13} />
          <span className="home-step"><i>3</i>{t("home.step.play")}</span>
        </div>
        <button type="button" className="ghost-button tutorial-open" onClick={onOpenTutorial}>
          <CircleHelp size={15} /> {t("tutorial.open")}
        </button>
      </div>

      <section className="home-section">
        <div className="home-section-head">
          <div>
            <h2>{t("home.chooseDeck")}</h2>
            <p>{t("home.chooseDeckSub")}</p>
          </div>
        </div>
        <div className="deck-list-head">
          <span className="deck-group-label">{t("home.yourLibrary")}</span>
          <span className="deck-list-count">{t("home.deckCount", { count: allDecks.length })}</span>
        </div>

        <div className="deck-grid">
          {visible.map((deck, index) => {
            const library = savedIds.has(deck.id);
            return (
              <span className="deck-grid-item" key={deck.id} style={{ animationDelay: `${index * 45}ms` }}>
                <DeckTile
                  deck={deck}
                  t={t}
                  selected={selectedDeck.id === deck.id}
                  favorite={deck.favorite === true}
                  tag={library ? t("deck.savedOffline") : undefined}
                  onSelect={() => onSelectDeck(deck)}
                  onInspect={() => onInspectDeck(deck)}
                  onToggleFavorite={library ? () => onToggleFavorite(deck) : undefined}
                  onRemove={library ? () => onRemoveDeck(deck) : undefined}
                />
              </span>
            );
          })}
        </div>

        {totalPages > 1 && (
          <div className="home-pager">
            <Pagination
              page={currentPage}
              totalPages={totalPages}
              onChange={(next) => { sound.play("click"); setPage(next); }}
              label={t("home.pageLabel")}
              t={t}
              compact
            />
          </div>
        )}

        <div className="home-shortcuts">
          <button type="button" className="import-card" onClick={onOpenBrowse}>
            <span className="import-card-icon"><Swords size={19} /></span>
            <div>
              <strong>{t("home.browseVault")}</strong>
              <span>{t("home.browseVaultSub")}</span>
            </div>
            <ArrowRight size={16} className="import-card-arrow" />
          </button>
          <button type="button" className="import-card" onClick={onOpenImport}>
            <span className="import-card-icon"><BookOpen size={19} /></span>
            <div>
              <strong>{t("home.importDeck")}</strong>
              <span>{t("home.importDeckSub")}</span>
            </div>
            <ArrowRight size={16} className="import-card-arrow" />
          </button>
        </div>
      </section>

      <div className="home-cta-bar">
        <div className="home-cta-deck">
          <HouseMark house={selectedDeck.houses[0] ?? "Logos"} small />
          <span>
            <strong>{selectedDeck.name}</strong>
            <small>{selectedDeck.cards.length} {t("common.cards")} · {t("home.deckReady")}</small>
          </span>
        </div>
        <button type="button" className="cta-button" onClick={onContinue}>
          {t("home.continueSetup")} <ArrowRight size={16} />
        </button>
      </div>

      <div className="home-lang-float">
        <LanguageMenu language={language} onChange={onLanguage} label={t("nav.language")} />
      </div>
    </div>
  );
}

// ---------- Config screen (stepper) ----------

const MODE_CONFIG_STEPS = ["mode", "difficulty", "opponent", "thinking", "experience", "review"] as const;
// FEAT-13: pass-and-play has no AI, so the difficulty/opponent/thinking steps
// (and their settings) leave the wizard; the decks step takes their place.
const PASS_CONFIG_STEPS = ["mode", "decks", "experience", "review"] as const;
type ConfigStep = (typeof MODE_CONFIG_STEPS)[number] | (typeof PASS_CONFIG_STEPS)[number];
const OPPONENT_MODES = ["mirror", "deck", "random"] as const;

/** One review-step deck card (shared by the solo deck, the two 2P decks). */
function ConfigDeckCard({ label, deck, t }: { label: string; deck: DeckInfo; t: Translator }) {
  return (
    <div className="review-card review-card--deck">
      <span className="review-label">{label}</span>
      <div className="review-deck">
        <CardArt face={deck.cards[0]} size="preview" />
        <div>
          <strong>{deck.name}</strong>
          <div className="deck-card-houses">
            {deck.houses.map((house) => <HouseMark key={house} house={house} small />)}
          </div>
          <small>{deck.cards.length} {t("common.cards")}</small>
          <DeckCoverageChip deck={deck} t={t} />
        </div>
      </div>
    </div>
  );
}

function ConfigScreen({
  t,
  settings,
  deck,
  savedDecks,
  hasHover,
  onChange,
  onLanguage,
  onBack,
  onStart,
  onOpenTutorial,
}: {
  t: Translator;
  settings: AppSettings;
  deck: DeckInfo;
  /** FEAT-11: the opponent picker draws from the same library as the Home list. */
  savedDecks: LibraryDeck[];
  /** T5 — sem "(hover: hover)" o toggle hoverZoom não faz sentido e some. */
  hasHover: boolean;
  onChange: (settings: AppSettings) => void;
  onLanguage: (language: Language) => void;
  onBack: () => void;
  onStart: () => void;
  onOpenTutorial: () => void;
}) {
  const [step, setStep] = useState<ConfigStep>("mode");
  const steps: readonly ConfigStep[] = settings.gameMode === "passAndPlay" ? PASS_CONFIG_STEPS : MODE_CONFIG_STEPS;
  const stepIndex = Math.max(0, steps.indexOf(step));
  const activeStep = steps[stepIndex];
  // FEAT-11: the mirror deck never appears in its own picker; an invalid pick
  // falls back to the mirror in launchMatch (a deleted deck must not break it).
  const opponentChoices = savedDecks.filter((item) => item.id !== deck.id);
  const pickedOpponent = opponentChoices.find((item) => item.id === settings.opponentDeckId);
  const opponentLabel =
    settings.opponentMode === "mirror"
      ? deck.name
      : settings.opponentMode === "random"
        ? t("config.opponent.random")
        : (pickedOpponent ?? deck).name;
  // FEAT-13: the two human decks (never the same one twice).
  const [p1Deck, p2Deck] = resolvePassDecks(savedDecks, deck, settings);
  const p2Choices = savedDecks.filter((item) => item.id !== p1Deck.id);

  const chooseMode = (gameMode: GameMode) => {
    sound.play("select");
    setStep("mode");
    onChange({ ...settings, gameMode });
  };

  const pickPlayerDeck = (side: 1 | 2, id: string) => {
    sound.play("click");
    if (side === 2) {
      onChange({ ...settings, deckP2Id: id });
      return;
    }
    // Picking P2's deck for P1 moves P2 to another library deck on the spot.
    const deckP2Id = id === p2Deck.id ? savedDecks.find((item) => item.id !== id)?.id : settings.deckP2Id;
    onChange({ ...settings, deckP1Id: id, deckP2Id });
  };

  const chooseOpponent = (mode: OpponentMode) => {
    sound.play("select");
    const opponentDeckId = mode === "deck" && !pickedOpponent ? opponentChoices[0]?.id : settings.opponentDeckId;
    onChange({ ...settings, opponentMode: mode, opponentDeckId });
  };

  const goNext = () => {
    sound.play("click");
    if (stepIndex < steps.length - 1) setStep(steps[stepIndex + 1]);
    else onStart();
  };
  const goPrev = () => {
    sound.play("click");
    if (stepIndex > 0) setStep(steps[stepIndex - 1]);
    else onBack();
  };

  return (
    <div className="screen config-screen">
      <div className="config-head">
        <div>
          <span className="eyebrow">{t("config.title")}</span>
          <h1>{settings.gameMode === "passAndPlay" ? t("config.subtitle2p") : t("config.subtitle")}</h1>
        </div>
        <button type="button" className="ghost-button tutorial-open" onClick={onOpenTutorial}>
          <CircleHelp size={15} /> {t("tutorial.open")}
        </button>
      </div>

      <div className="config-stepper">
        {steps.map((item, index) => (
          <button
            key={item}
            type="button"
            className={`config-step-pill${item === activeStep ? " is-active" : ""}${index < stepIndex ? " is-done" : ""}`}
            onClick={() => setStep(item)}
          >
            <span className="config-step-num">{index < stepIndex ? <Check size={12} /> : index + 1}</span>
            <span>{t(`config.step.${item}`)}</span>
          </button>
        ))}
      </div>

      <div className="config-body">
        {activeStep === "mode" && (
          <section className="config-panel">
            <div className="config-panel-head">
              <h2>{t("config.mode.title")}</h2>
              <p>{t("config.mode.sub")}</p>
            </div>
            <div className="difficulty-list">
              {(["solo", "passAndPlay"] as const).map((mode, index) => (
                <button
                  type="button"
                  key={mode}
                  className={`difficulty-choice${settings.gameMode === mode ? " is-active" : ""}`}
                  onClick={() => chooseMode(mode)}
                >
                  <span className="difficulty-level">0{index + 1}</span>
                  <span className="difficulty-copy">
                    <strong>{t(`config.mode.${mode}`)}</strong>
                    <small>{t(`config.mode.${mode}Sub`)}</small>
                  </span>
                  <span className="difficulty-indicator">{settings.gameMode === mode && <Check size={13} />}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {activeStep === "difficulty" && (
          <section className="config-panel">
            <div className="config-panel-head">
              <h2>{t("config.difficulty.title")}</h2>
              <p>{t("config.difficulty.sub")}</p>
            </div>
            <div className="difficulty-list">
              {DIFFICULTIES.map((difficulty, index) => (
                <button
                  type="button"
                  key={difficulty}
                  className={`difficulty-choice${settings.difficulty === difficulty ? " is-active" : ""}`}
                  onClick={() => {
                    sound.play("select");
                    onChange({ ...settings, difficulty });
                  }}
                >
                  <span className="difficulty-level">0{index + 1}</span>
                  <span className="difficulty-copy">
                    <strong>{t(`difficulty.${difficulty}`)}</strong>
                    <small>{t(`difficulty.${difficulty}.desc`)}</small>
                  </span>
                  <span className="difficulty-indicator">{settings.difficulty === difficulty && <Check size={13} />}</span>
                </button>
              ))}
            </div>
            <div className="algorithm-note">
              <span className="algorithm-icon"><Activity size={17} /></span>
              <div>
                <strong>{t("config.algo.title")}</strong>
                <span>{t("config.algo.sub")}</span>
              </div>
            </div>
          </section>
        )}

        {activeStep === "opponent" && (
          <section className="config-panel">
            <div className="config-panel-head">
              <h2>{t("config.opponent.title")}</h2>
              <p>{t("config.opponent.sub")}</p>
            </div>
            <div className="difficulty-list">
              {OPPONENT_MODES.map((mode, index) => (
                <button
                  type="button"
                  key={mode}
                  className={`difficulty-choice${settings.opponentMode === mode ? " is-active" : ""}`}
                  onClick={() => chooseOpponent(mode)}
                >
                  <span className="difficulty-level">0{index + 1}</span>
                  <span className="difficulty-copy">
                    <strong>{t(`config.opponent.${mode}`)}</strong>
                    <small>{t(`config.opponent.${mode}Sub`)}</small>
                  </span>
                  <span className="difficulty-indicator">{settings.opponentMode === mode && <Check size={13} />}</span>
                </button>
              ))}
            </div>
            {settings.opponentMode === "deck" && (
              <div className="filter-chips" style={{ marginTop: 12 }} role="group" aria-label={t("config.opponent.pick")}>
                {opponentChoices.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`filter-chip${item.id === settings.opponentDeckId ? " is-active" : ""}`}
                    aria-pressed={item.id === settings.opponentDeckId}
                    onClick={() => { sound.play("click"); onChange({ ...settings, opponentDeckId: item.id }); }}
                  >
                    {item.name}
                  </button>
                ))}
                {!opponentChoices.length && <p className="deck-input-hint">{t("config.opponent.none")}</p>}
              </div>
            )}
          </section>
        )}

        {activeStep === "decks" && (
          <section className="config-panel">
            <div className="config-panel-head">
              <h2>{t("config.decks.title")}</h2>
              <p>{t("config.decks.sub")}</p>
            </div>
            <div style={{ marginTop: 14 }}>
              <span className="section-label">{t("config.decks.p1")}</span>
              <div className="filter-chips" style={{ marginTop: 8 }} role="group" aria-label={t("config.decks.p1")}>
                {savedDecks.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`filter-chip${item.id === p1Deck.id ? " is-active" : ""}`}
                    aria-pressed={item.id === p1Deck.id}
                    onClick={() => pickPlayerDeck(1, item.id)}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <span className="section-label">{t("config.decks.p2")}</span>
              <div className="filter-chips" style={{ marginTop: 8 }} role="group" aria-label={t("config.decks.p2")}>
                {p2Choices.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`filter-chip${item.id === p2Deck.id ? " is-active" : ""}`}
                    aria-pressed={item.id === p2Deck.id}
                    onClick={() => pickPlayerDeck(2, item.id)}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeStep === "thinking" && (
          <section className="config-panel">
            <div className="config-panel-head">
              <h2>{t("config.thinking.title")}</h2>
              <p>{t("config.thinking.sub")}</p>
            </div>
            <div className="depth-display">
              <span className="depth-big">{settings.thinkingDepth}</span>
              <span className="depth-total">/ 6</span>
            </div>
            <input
              aria-label={t("config.thinking.title")}
              type="range"
              min="1"
              max="6"
              value={settings.thinkingDepth}
              className="depth-range"
              style={{ "--range-progress": `${((settings.thinkingDepth - 1) / 5) * 100}%` } as CSSProperties}
              onChange={(event) => onChange({ ...settings, thinkingDepth: Number(event.target.value) })}
            />
            <div className="range-ticks">
              <span>{t("config.thinking.quick")}</span>
              <span>{t("config.thinking.considered")}</span>
              <span>{t("config.thinking.deep")}</span>
            </div>
            <div className="thinking-preview">
              <Cpu size={15} />
              <span>{describeAiThinking({ difficulty: settings.difficulty, thinkingDepth: settings.thinkingDepth })}</span>
            </div>
          </section>
        )}

        {activeStep === "experience" && (
          <section className="config-panel">
            <div className="config-panel-head">
              <h2>{t("config.experience.title")}</h2>
              <p>{t("config.experience.sub")}</p>
            </div>
            <div className="exp-list">
              <div className="exp-row">
                <span className="exp-icon"><Volume2 size={16} /></span>
                <div className="exp-copy"><strong>{t("config.experience.sfx")}</strong><small>{t("config.experience.sfxSub")}</small></div>
                <Toggle checked={settings.sfx} label={t("config.experience.sfx")} onChange={(value) => onChange({ ...settings, sfx: value })} />
              </div>
              <div className="exp-row">
                <span className="exp-icon"><Music size={16} /></span>
                <div className="exp-copy"><strong>{t("config.experience.music")}</strong><small>{t("config.experience.musicSub")}</small></div>
                <Toggle checked={settings.music} label={t("config.experience.music")} onChange={(value) => onChange({ ...settings, music: value })} />
              </div>
              <div className="exp-row">
                <span className="exp-icon"><Wand2 size={16} /></span>
                <div className="exp-copy"><strong>{t("config.experience.animations")}</strong><small>{t("config.experience.animationsSub")}</small></div>
                <Toggle checked={settings.animations} label={t("config.experience.animations")} onChange={(value) => onChange({ ...settings, animations: value })} />
              </div>
              <div className="exp-row">
                <span className="exp-icon"><Eye size={16} /></span>
                <div className="exp-copy"><strong>{t("config.experience.hints")}</strong><small>{t("config.experience.hintsSub")}</small></div>
                <Toggle checked={settings.hints} label={t("config.experience.hints")} onChange={(value) => { if (value) sound.play("sparkle"); onChange({ ...settings, hints: value }); }} />
              </div>
              {hasHover && (
                <div className="exp-row">
                  <span className="exp-icon"><ZoomIn size={16} /></span>
                  <div className="exp-copy"><strong>{t("config.experience.zoom")}</strong><small>{t("config.experience.zoomSub")}</small></div>
                  <Toggle checked={settings.hoverZoom} label={t("config.experience.zoom")} onChange={(value) => onChange({ ...settings, hoverZoom: value })} />
                </div>
              )}
              <div className="exp-row">
                <span className="exp-icon"><Languages size={16} /></span>
                <div className="exp-copy"><strong>{t("config.experience.language")}</strong></div>
                <LanguageMenu language={settings.language} onChange={onLanguage} label={t("nav.language")} />
              </div>
            </div>
          </section>
        )}

        {activeStep === "review" && (
          <section className="config-panel">
            <div className="config-panel-head">
              <h2>{t("config.review.title")}</h2>
              <p>{t("config.review.sub")}</p>
            </div>
            <div className="review-grid">
              {settings.gameMode === "passAndPlay" ? (
                <>
                  <ConfigDeckCard label={t("config.decks.p1")} deck={p1Deck} t={t} />
                  <ConfigDeckCard label={t("config.decks.p2")} deck={p2Deck} t={t} />
                </>
              ) : (
                <ConfigDeckCard label={t("config.review.deck")} deck={deck} t={t} />
              )}
              {settings.gameMode === "solo" && (
                <div className="review-card">
                  <span className="review-label">{t("config.review.opponent")}</span>
                  <ul className="review-list">
                    <li><span>{t("config.step.difficulty")}</span><strong>{t(`difficulty.${settings.difficulty}`)}</strong></li>
                    <li><span>{t("config.step.thinking")}</span><strong>{settings.thinkingDepth} / 6</strong></li>
                    <li><span>{t("config.review.deck")}</span><strong>{opponentLabel}</strong></li>
                  </ul>
                </div>
              )}
              <div className="review-card">
                <span className="review-label">{t("config.review.interface")}</span>
                <ul className="review-list">
                  <li><span>{t("config.experience.sfx")}</span><strong>{settings.sfx ? t("config.on") : t("config.off")}</strong></li>
                  <li><span>{t("config.experience.music")}</span><strong>{settings.music ? t("config.on") : t("config.off")}</strong></li>
                  <li><span>{t("config.experience.animations")}</span><strong>{settings.animations ? t("config.on") : t("config.off")}</strong></li>
                  {hasHover && <li><span>{t("config.experience.zoom")}</span><strong>{settings.hoverZoom ? t("config.on") : t("config.off")}</strong></li>}
                  <li><span>{t("config.experience.language")}</span><strong>{LANGUAGES.find((l) => l.id === settings.language)?.short}</strong></li>
                </ul>
              </div>
            </div>
          </section>
        )}
      </div>

      <div className="config-nav">
        <button type="button" className="ghost-button" onClick={goPrev}>
          <ArrowLeft size={15} /> {t("common.back")}
        </button>
        <button type="button" className="cta-button" onClick={goNext}>
          {activeStep === "review" ? t("home.play") : t("common.next")} <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

// ---------- Game screen pieces ----------

// A key is forged at the start of the turn for the current cost (6 + effects
// such as Lash of Broken Dreams, game.ts keyCost); the meter shows the way there.
function AmberCounter({ amount, cost, t }: { amount: number; cost: number; t: Translator }) {
  const ready = amount >= cost;
  const label = t("game.amberToKey", { amount, cost });
  return (
    <div className={`amber-counter${ready ? " amber-counter--ready" : ""}`} aria-label={label} title={label}>
      <Gem size={18} strokeWidth={1.8} />
      {/* Keyed by value: remounting replays the count-pop animation on change. */}
      <span className="amber-value" key={amount}>{amount}</span>
      <small>{t("game.aember")}</small>
      <span className="amber-meter" aria-hidden="true">
        <i style={{ width: `${(Math.min(amount, cost) / cost) * 100}%` }} />
      </span>
    </div>
  );
}

function KeyCounter({ keys, t }: { keys: number; t: Translator }) {
  return (
    // The pips are the indicator (forged ones filled); "n/3" stays visible so a
    // lone "0" beside three outlines is not ambiguous. Full text in aria-label.
    <div className="key-counter" aria-label={`${keys} / 3 ${t("game.keys")}`}>
      <div className="key-pips">
        {[0, 1, 2].map((index) => (
          <KeyRound key={index} className={index < keys ? "key-pip is-forged" : "key-pip"} size={17} strokeWidth={1.8} />
        ))}
      </div>
      <span>{keys}/3</span>
    </div>
  );
}

type PlayerBandProps = {
  player: GameState["players"][number];
  keyCost: number;
  isAi: boolean;
  active: boolean;
  thinking?: boolean;
  chains: number;
  /** FEAT-13: pass-and-play avatars show the player number instead of "You". */
  avatarLabel?: string;
  t: Translator;
};

// T7d: mesmo racional do CardTile — o objeto `player` muda de identidade a cada
// move (cloneGame); comparar os campos renderizados deixa o band de fora dos
// commits em que o placar do dono não mudou.
function arePlayerBandPropsEqual(a: PlayerBandProps, b: PlayerBandProps): boolean {
  return (
    a.isAi === b.isAi &&
    a.active === b.active &&
    (a.thinking ?? false) === (b.thinking ?? false) &&
    (a.avatarLabel ?? "") === (b.avatarLabel ?? "") &&
    a.t === b.t &&
    a.player.name === b.player.name &&
    a.player.deckName === b.player.deckName &&
    a.player.amber === b.player.amber &&
    a.player.chains === b.player.chains &&
    a.keyCost === b.keyCost &&
    a.player.keys === b.player.keys &&
    a.player.houses.length === b.player.houses.length &&
    a.player.houses.every((house, index) => house === b.player.houses[index])
  );
}

const PlayerBand = memo(function PlayerBand({
  player,
  keyCost,
  isAi,
  active,
  thinking = false,
  chains,
  avatarLabel,
  t,
}: PlayerBandProps) {
  return (
    <div className={`player-band${active ? " player-band--active" : ""}${isAi ? " player-band--ai" : ""}`}>
      <div className={`player-avatar${isAi ? " player-avatar--ai" : ""}`}>
        {isAi ? <Cpu size={18} strokeWidth={1.6} /> : <span>{avatarLabel ?? t("common.you")}</span>}
        {active && <span className="avatar-live-dot" />}
      </div>
      <div className="player-copy">
        <div className="player-name-row">
          <strong>{localizeName(player.name, t)}</strong>
          {/* T4: indicador só-ícone; o texto ACTIVE/THINKING via t() fica no aria-label. */}
          {active && (
            <span className="active-turn-tag" role="img" aria-label={thinking ? t("game.thinkingTag") : t("game.active")}>
              <Zap size={11} strokeWidth={2.4} />
            </span>
          )}
        </div>
        <div className="player-deck-name">
          <span className="player-deck-label">{localizeName(player.deckName, t)}</span>
          <span className="player-house-list">
            {player.houses.map((house) => <HouseIcon key={house} house={house} size="xs" />)}
          </span>
        </div>
      </div>
      <div className="player-resources">
        <KeyCounter keys={player.keys} t={t} />
        <div className="resource-divider" />
        <AmberCounter amount={player.amber} cost={keyCost} t={t} />
        {/* BUG-17: chains were invisible; they shorten the draw step. */}
        {chains > 0 && (
          <div className="resource-divider" />
        )}
        {chains > 0 && (
          <span className="chain-counter" role="img" aria-label={t("game.chainsAria", { count: chains })}>
            <Link2 size={12} strokeWidth={2} />
            <b>{chains}</b>
          </span>
        )}
      </div>
    </div>
  );
}, arePlayerBandPropsEqual);

type BoardLaneProps = {
  cards: CardInstance[];
  owner: 0 | 1;
  /** FEAT-13: the lane owner whose pieces may look usable right now. */
  humanSide: 0 | 1;
  activeHouse: string | null;
  selectedId?: string;
  /** FEAT-04: ids com movimento legal (só a lane do jogador). */
  hintIds?: Set<string> | null;
  /** Cards that may be picked right now (fight defender, ability target, upgrade host). */
  targetIds?: string[];
  settings: AppSettings;
  t: Translator;
  /** Undefined in the replay viewer: the tiles render disabled. */
  onSelect?: (card: CardInstance) => void;
};

// T7d: a lane só re-renderiza quando um input de render muda; `cards` muda de
// identidade a cada move (cloneGame), então a comparação é elemento a elemento
// via sameCardInstance.
function areBoardLanePropsEqual(a: BoardLaneProps, b: BoardLaneProps): boolean {
  if (
    a.owner !== b.owner ||
    a.humanSide !== b.humanSide ||
    a.activeHouse !== b.activeHouse ||
    a.selectedId !== b.selectedId ||
    a.targetIds !== b.targetIds ||
    a.hintIds !== b.hintIds ||
    a.settings !== b.settings ||
    a.t !== b.t ||
    a.onSelect !== b.onSelect
  ) {
    return false;
  }
  if (a.cards === b.cards) return true;
  return a.cards.length === b.cards.length && a.cards.every((card, index) => sameCardInstance(card, b.cards[index]));
}

const BoardLane = memo(function BoardLane({
  cards,
  owner,
  humanSide,
  activeHouse,
  selectedId,
  targetIds,
  hintIds,
  settings,
  t,
  onSelect,
}: BoardLaneProps) {
  // Visual neighbours must equal engine neighbours: creatures render in
  // battleline order, artifacts/upgrades move to their own strip below
  // (BUG-18 — interleaved artificats made "[C1][Artifact][C2]" look
  // non-adjacent when the engine treats them as neighbours).
  const creatures = cards.filter((card) => card.face.type === "Creature");
  const attachments = cards.filter((card) => card.face.type !== "Creature");
  if (!cards.length) {
    return (
      <div className="empty-battleline">
        <span className="empty-orbit"><Shield size={17} strokeWidth={1.3} /></span>
        <span>{t("game.clearLine")}</span>
      </div>
    );
  }

  return (
    <div className={`board-lane${targetIds?.length ? " board-lane--targeting" : ""}`}>
      {creatures.length === 0 && (
        <div className="empty-battleline">
          <span className="empty-orbit"><Shield size={17} strokeWidth={1.3} /></span>
          <span>{t("game.clearLine")}</span>
        </div>
      )}
      {creatures.map((card) => {
        const canUse = owner === humanSide && card.ready && !card.stunned && (!activeHouse || card.face.house === activeHouse);
        // T4: o estado da peça é indicador visual (borda/opacidade, index.css) +
        // aria-label via t(); não existe mais label de texto sob a carta.
        const stateLabel = card.stunned ? t("game.stunned") : card.ready ? t("game.ready") : t("game.resting");
        const stateClass = card.stunned ? " board-piece--stunned" : card.ready ? "" : " board-piece--resting";
        const hinted = Boolean(hintIds?.has(card.instanceId));
        return (
          <div className={`board-piece${canUse ? " board-piece--ready" : ""}${stateClass}`} key={card.instanceId}>
            <CardTile
              card={card}
              size="board"
              selected={selectedId === card.instanceId}
              dimmed={targetIds ? !targetIds.includes(card.instanceId) : false}
              hoverZoom={settings.hoverZoom}
              playAnim={settings.animations}
              stateLabel={stateLabel}
              hinted={hinted}
              t={t}
              damageLabel={card.damage > 0 ? `${card.damage} ${t("game.dmg")}` : undefined}
              onClick={onSelect}
            />
          </div>
        );
      })}
      {attachments.length > 0 && (
        <div className="board-attachments" role="list" aria-label={t("game.attachments")}>
          {attachments.map((card) => {
            const hostTitle = cards.find((item) => item.instanceId === card.attachedTo)?.face.title;
            return (
              <div className="board-piece board-piece--attachment" key={card.instanceId} role="listitem">
                <CardTile
                  card={card}
                  size="board"
                  dimmed={targetIds ? !targetIds.includes(card.instanceId) : false}
                  hoverZoom={settings.hoverZoom}
                  playAnim={settings.animations}
                  t={t}
                  onClick={onSelect}
                />
                {card.attachedTo && hostTitle && (
                  <span className="attachment-host" title={hostTitle}>
                    {hostTitle}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}, areBoardLanePropsEqual);

function GameBoard({
  game,
  selected,
  pick,
  aiThinking,
  settings,
  t,
  forgeFlash,
  onHouse,
  onSelectHand,
  onSelectBoard,
  onEndTurn,
  onRematch,
  onHome,
  onKeepHand,
  onMulligan,
  replay = false,
  canReplay = false,
  onReplay,
  passAndPlay = false,
  humanSide = 0,
  passPending = null,
  onPassConfirm = NOOP,
}: {
  game: GameState;
  selected: Selection | null;
  pick: Pick | null;
  aiThinking: boolean;
  settings: AppSettings;
  t: Translator;
  forgeFlash: boolean;
  /** FEAT-12b: read-only board for the replay viewer — controls disabled and
      the mulligan/winner overlays suppressed. */
  replay?: boolean;
  /** FEAT-12b: available when the match has recorded steps (same session). */
  canReplay?: boolean;
  onReplay?: () => void;
  /** FEAT-13: two-human match — no AI band and a pass screen between turns. */
  passAndPlay?: boolean;
  /** FEAT-13: the side holding the device (0 in solo). */
  humanSide?: 0 | 1;
  /** FEAT-13: side that must confirm the pass before its hand renders. */
  passPending?: 0 | 1 | null;
  onPassConfirm?: () => void;
  onHouse: (house: string) => void;
  onSelectHand: (card: CardInstance) => void;
  onSelectBoard: (owner: 0 | 1, card: CardInstance) => void;
  onEndTurn: () => void;
  onRematch: () => void;
  onHome: () => void;
  onKeepHand: () => void;
  onMulligan: () => void;
}) {
  const enemySide = (1 - humanSide) as 0 | 1;
  const player = game.players[humanSide];
  const enemy = game.players[enemySide];
  const readOnly = replay === true;
  // FEAT-13: while the pass screen is open the next hand is not in the DOM at
  // all — the overlay is the only thing showing, and nobody sees it early.
  const handHidden = passAndPlay && passPending !== null;
  const isHumanTurn = !readOnly && game.activePlayer === humanSide && game.winner === null && !inMulligan(game) && !handHidden;
  // FEAT-04: ids with at least one legal move, only while it is the player's
  // turn with the house chosen; memoised so lane/tile memos keep working.
  const hintIds = useMemo(() => {
    if (readOnly || !settings.hints || game.activePlayer !== humanSide || !game.activeHouse || game.winner !== null || handHidden) return null;
    return new Set(
      getLegalMoves(game, humanSide, game.activeHouse).map((move) => (move.type === "fight" ? move.attackerId : move.instanceId)),
    );
  }, [game, settings.hints, readOnly, humanSide, handHidden]);
  // T7d: closures estáveis por lane — sem identidade estável o memo de
  // BoardLane/CardTile não teria efeito.
  const selectOpponentCard = useCallback((card: CardInstance) => onSelectBoard(enemySide, card), [onSelectBoard, enemySide]);
  const selectPlayerCard = useCallback((card: CardInstance) => onSelectBoard(humanSide, card), [onSelectBoard, humanSide]);
  const winnerRef = useDialogFocus<HTMLDivElement>(game.winner !== null);
  const passRef = useDialogFocus<HTMLDivElement>(handHidden);
  // FEAT-10/13: in pass-and-play both sides decide their own mulligan (the
  // solo board only prompts for side 0 and lets the AI decide side 1).
  const mulliganSide = inMulligan(game) ? (game.pendingMulligan as 0 | 1) : null;
  const mulliganDeciding = mulliganSide !== null && (passAndPlay || mulliganSide === 0);

  return (
    <section className={`game-board${settings.animations ? "" : " no-anim"}${forgeFlash ? " forge-flash" : ""}`} aria-label={t("game.board")}>
      <div className="felt-etching" aria-hidden="true" />
      <div className="board-content">
        <PlayerBand
          player={enemy}
          keyCost={keyCost(game, enemySide)}
          isAi={!passAndPlay}
          active={game.activePlayer === enemySide && game.winner === null}
          thinking={aiThinking}
          chains={enemy.chains}
          avatarLabel={passAndPlay ? String(enemySide + 1) : undefined}
          t={t}
        />

        <section className="battle-zone battle-zone--opponent" aria-label={t("game.opponentLine")}>
          <div className="zone-heading">
            <span>{t("game.opponentLine")}</span>
            <span className="zone-card-count">{enemy.board.length} {t("game.onTable")}</span>
          </div>
          <BoardLane
            cards={enemy.board}
            owner={enemySide}
            humanSide={humanSide}
            activeHouse={null}
            selectedId={selected?.zone === "enemy" ? selected.instanceId : undefined}
            targetIds={pick?.ids}
            settings={settings}
            t={t}
            onSelect={readOnly ? undefined : selectOpponentCard}
          />
        </section>

        <div className={`turn-console${isHumanTurn ? " turn-console--human" : ""}`}>
          <div className="turn-console-copy">
            <div className="round-kicker"><span className="round-dot" /> {t("game.round")} {String(game.turn).padStart(2, "0")}</div>
            <strong>
              {passAndPlay
                ? t("game.turnOf", { name: localizeName(game.players[game.activePlayer].name, t) })
                : game.activePlayer === 0 ? t("game.yourTurn") : aiThinking ? t("game.thinking") : t("game.opponentTurn")}
            </strong>
            <span>{game.activeHouse ? `${houseLabel(game.activeHouse, t)} ${t("game.houseActive")}` : t("game.chooseHouse")}</span>
          </div>
          <div className="house-picker" role="group" aria-label={t("game.chooseHouse")}>
            {player.houses.map((house) => {
              const chosen = game.activeHouse === house;
              return (
                <button
                  key={house}
                  type="button"
                  className={`house-choice${chosen ? " is-chosen" : ""}${game.activeHouse && !chosen ? " is-locked" : ""}`}
                  style={{ "--house-color": houseColor(house) } as CSSProperties}
                  onClick={() => onHouse(house)}
                  disabled={!isHumanTurn || Boolean(game.activeHouse)}
                  aria-pressed={chosen}
                >
                  <HouseMark house={house} small />
                  <span>{houseLabel(house, t)}</span>
                  {chosen && <Check size={13} className="house-check" />}
                </button>
              );
            })}
          </div>
          <button className="end-turn-button" type="button" onClick={onEndTurn} disabled={!isHumanTurn}>
            <span>{t("game.endTurn")}</span>
            <ArrowRight size={15} />
          </button>
        </div>

        {pick && (
          <div className="fight-instruction" role="status">
            {pick.move.type === "fight" ? <><Swords size={15} /> {t("game.chooseFight")}</> : <><Crosshair size={15} /> {t("game.chooseTarget")}</>}
          </div>
        )}

        <section className="battle-zone battle-zone--player" aria-label={t("game.yourLine")}>
          <div className="zone-heading">
            <span>{t("game.yourLine")}</span>
            <span className="zone-card-count">{player.board.length} {t("game.onTable")}</span>
          </div>
          <BoardLane
            cards={player.board}
            owner={humanSide}
            humanSide={humanSide}
            hintIds={hintIds}
            activeHouse={game.activeHouse}
            selectedId={selected?.zone === "board" ? selected.instanceId : undefined}
            targetIds={pick?.ids}
            settings={settings}
            t={t}
            onSelect={readOnly ? undefined : selectPlayerCard}
          />
        </section>

        <PlayerBand
          player={player}
          keyCost={keyCost(game, humanSide)}
          isAi={false}
          active={game.activePlayer === humanSide && game.winner === null}
          chains={player.chains}
          avatarLabel={passAndPlay ? String(humanSide + 1) : undefined}
          t={t}
        />

        <section className="hand-zone" aria-label={t("game.yourHand")}>
          <div className="hand-heading">
            <div>
              <span className="hand-title">{t("game.yourHand")}</span>
              <span className="hand-count">{player.hand.length} {t("common.cards").toUpperCase()}</span>
            </div>
            <span className="deck-count">{player.deck.length} {t("game.inDeck")}</span>
          </div>
          {game.activePlayer === humanSide && !game.activeHouse && game.winner === null && !inMulligan(game) && !handHidden && (
            <div className="hand-prompt"><Zap size={13} /> {t("game.unlockHint")}</div>
          )}
          <div className="hand-track">
            {!handHidden && player.hand.map((card) => {
              const playable = Boolean(game.activeHouse && card.face.house === game.activeHouse);
              return (
                <CardTile
                  key={card.instanceId}
                  card={card}
                  size="hand"
                  selected={selected?.zone === "hand" && selected.instanceId === card.instanceId}
                  dimmed={game.activePlayer === humanSide && Boolean(game.activeHouse) && !playable}
                  hinted={Boolean(hintIds?.has(card.instanceId))}
                  hoverZoom={settings.hoverZoom}
                  playAnim={settings.animations}
                  t={t}
                  onClick={readOnly ? undefined : onSelectHand}
                />
              );
            })}
            {!handHidden && !player.hand.length && <div className="empty-hand">{t("game.handEmpty")}</div>}
          </div>
        </section>
      </div>

      {mulliganSide !== null && !readOnly && !handHidden && (
        <div className="winner-shade mulligan-shade" role="dialog" aria-modal="true" aria-labelledby="mulligan-title">
          <div className="winner-panel">
            <span className="eyebrow">
              {passAndPlay ? localizeName(game.players[mulliganSide].name, t) : mulliganSide === 0 ? t("game.yourHand") : t("rail.warden")}
            </span>
            <h2 id="mulligan-title">{mulliganDeciding ? t("game.mulliganTitle") : t("game.thinking")}</h2>
            {mulliganDeciding && (
              <>
                <p>{t("game.mulliganBody")}</p>
                <div className="winner-actions">
                  <button type="button" className="cta-button mulligan-keep" onClick={onKeepHand}><Check size={15} /> {t("game.mulliganKeep")}</button>
                  <button type="button" className="ghost-button mulligan-take" onClick={onMulligan}><RotateCcw size={15} /> {t("game.mulliganTake")}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* FEAT-13: between turns the hand of the next player stays out of the DOM
          until they confirm on the pass screen. */}
      {handHidden && passPending !== null && (
        <div className="winner-shade pass-shade" role="dialog" aria-modal="true" aria-labelledby="pass-title">
          <div className="winner-panel" ref={passRef}>
            <span className="eyebrow">{t("game.passTitle")}</span>
            <h2 id="pass-title">{localizeName(game.players[passPending].name, t)}</h2>
            <p>{t("game.passBody", { name: localizeName(game.players[passPending].name, t) })}</p>
            <div className="winner-actions">
              <button type="button" className="cta-button pass-confirm" onClick={onPassConfirm}>
                <Eye size={15} /> {t("game.passConfirm", { name: localizeName(game.players[passPending].name, t) })}
              </button>
            </div>
          </div>
        </div>
      )}

      {game.winner !== null && !readOnly && (
        <div className="winner-shade" role="dialog" aria-modal="true" aria-labelledby="winner-title">
          <div className="winner-panel" ref={winnerRef}>
            <div className="winner-emblem"><Crown size={23} /></div>
            <span className="eyebrow">{t("game.matchComplete")}</span>
            <h2 id="winner-title">
              {passAndPlay ? t("game.playerWin", { name: localizeName(game.players[game.winner].name, t) }) : game.winner === 0 ? t("game.youWin") : t("game.aiWin")}
            </h2>
            {!passAndPlay && <p>{game.winner === 0 ? t("game.youWinSub") : t("game.aiWinSub")}</p>}
            {/* FEAT-06: the player's tallies for this match (legacy saves without
                the counters read as 0). Hidden in pass-and-play: a W/L row for
                one of the two local decks would be misleading (FEAT-13). */}
            {!passAndPlay && (
              <ul className="review-list winner-stats">
                {([
                  ["stats.rounds", game.turn],
                  ["stats.amberGained", player.amberGained],
                  ["stats.amberStolen", player.amberStolen],
                  ["stats.amberCaptured", player.amberCaptured],
                  ["stats.creaturesDestroyed", player.creaturesDestroyed],
                  ["stats.cardsPlayed", player.cardsPlayed],
                ] as const).map(([key, value]) => (
                  <li key={key}><span>{t(key)}</span><strong>{value ?? 0}</strong></li>
                ))}
              </ul>
            )}
            <p className="winner-seed">{t("game.seed", { seed: game.seed })}</p>
            <div className="winner-actions">
              <button type="button" className="cta-button" onClick={onRematch}><RotateCcw size={15} /> {t("game.rematch")}</button>
              {canReplay && onReplay && (
                <button type="button" className="ghost-button" onClick={onReplay}><Eye size={15} /> {t("game.replay")}</button>
              )}
              <button type="button" className="ghost-button" onClick={onHome}><Home size={15} /> {t("game.toHome")}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function SelectedCardPanel({
  selection,
  card,
  game,
  pick,
  settings,
  t,
  humanSide,
  onMove,
  onFight,
  onCancelPick,
  onClear,
}: {
  selection: Selection | null;
  card: CardInstance | null;
  game: GameState;
  pick: Pick | null;
  settings: AppSettings;
  t: Translator;
  /** FEAT-13: side whose cards the actions apply to (the active side in 2P). */
  humanSide: 0 | 1;
  onMove: (move: GameMove) => void;
  onFight: () => void;
  onCancelPick: () => void;
  onClear: () => void;
}) {
  const isHumanTurn = game.activePlayer === humanSide && game.winner === null && !inMulligan(game);
  const activeForHouse = Boolean(card && game.activeHouse && card.face.house === game.activeHouse);
  // Legality comes from the engine (house, first-turn rule, Alpha/Omega, taunt…).
  const legal = (move: GameMove) => isHumanTurn && isLegalMove(game, humanSide, move);
  const id = card?.instanceId ?? "";
  const canPlay = legal({ type: "play", instanceId: id });
  const canUse = legal({ type: "use", instanceId: id });
  const printsUse = Boolean(card && /(?:^|[\s/.])(?:Action|Omni):/i.test(card.face.text));
  const canFight = Boolean(card && isHumanTurn && activeForHouse && fightTargets(game, humanSide, card).length);

  return (
    <section className={`inspector-section${selection && card ? " inspector-section--docked" : ""}`} aria-live="polite">
      <div className="section-label-row">
        <span className="section-label">{t("inspector.title")}</span>
        {selection && <button className="quiet-icon-button" type="button" onClick={onClear} aria-label={t("common.close")}><X size={14} /></button>}
      </div>
      {selection && card ? (
        <div className="selected-card-content">
          <div className="selected-card-main">
            <CardArt face={card.face} size="preview" hoverZoom={settings.hoverZoom} />
            <div className="selected-card-heading">
              <HouseMark house={card.face.house} small />
              <span className="card-type-label">{houseLabel(card.face.house, t)} / {t(`type.${card.face.type}`)}</span>
              <h3>{card.face.title}</h3>
              {card.face.traits && <p className="card-traits">{card.face.traits}</p>}
              <div className="selected-card-stats">
                {card.face.amber > 0 && <span><Gem size={12} /> {card.face.amber} {t("inspector.amber")}</span>}
                {card.face.power > 0 && <span><Sword size={12} /> {card.face.power} {t("inspector.power")}</span>}
                {card.face.armor > 0 && <span><Shield size={12} /> {card.face.armor} {t("inspector.armor")}</span>}
                {card.damage > 0 && <span className="damage-stat">{card.damage} {t("inspector.damage")}</span>}
                {(card.amber ?? 0) > 0 && <span><Gem size={12} /> {t("inspector.captured", { amount: card.amber ?? 0 })}</span>}
              </div>
            </div>
          </div>
          <p className="selected-card-text">{card.face.text || t("inspector.noText")}</p>
          <CoverageBadge face={card.face} t={t} />

          <div className="inspector-actions">
            {pick ? (
              <button className="secondary-action" type="button" onClick={onCancelPick}>
                {pick.move.type === "fight" ? t("inspector.cancelFight") : t("inspector.cancelTarget")}
              </button>
            ) : (
              <>
                {selection.zone === "hand" && (
                  <>
                    <button className="primary-action" type="button" disabled={!canPlay} onClick={() => onMove({ type: "play", instanceId: id })}>
                      <Zap size={15} />
                      {canPlay ? t("inspector.play") : !isHumanTurn ? t("inspector.waitTurn") : !game.activeHouse ? t("inspector.chooseHouseFirst") : activeForHouse ? t("inspector.cannotPlay") : t("inspector.offHouse")}
                    </button>
                    {legal({ type: "discard", instanceId: id }) && (
                      <button className="secondary-action" type="button" onClick={() => onMove({ type: "discard", instanceId: id })}>
                        <Trash2 size={15} /> {t("inspector.discard")}
                      </button>
                    )}
                  </>
                )}
                {selection.zone === "board" && card.face.type === "Creature" && (card.stunned ? (
                  <button className="primary-action" type="button" disabled={!legal({ type: "unstun", instanceId: id })} onClick={() => onMove({ type: "unstun", instanceId: id })}>
                    <CircleHelp size={15} /> {t("inspector.unstun")}
                  </button>
                ) : (
                  <>
                    <button className="primary-action" type="button" disabled={!legal({ type: "reap", instanceId: id })} onClick={() => onMove({ type: "reap", instanceId: id })}>
                      <Gem size={15} /> {t("inspector.reap")}
                    </button>
                    <button className="secondary-action" type="button" disabled={!canFight} onClick={onFight}>
                      <Swords size={15} /> {t("inspector.fight")}
                    </button>
                  </>
                ))}
                {selection.zone === "board" && (card.face.type === "Artifact" || (card.face.type === "Creature" && printsUse && !card.stunned)) && (
                  <button className="primary-action" type="button" disabled={!canUse} onClick={() => onMove({ type: "use", instanceId: id })}>
                    <Zap size={15} /> {printsUse ? t("inspector.use") : t("inspector.passive")}
                  </button>
                )}
              </>
            )}
            {selection.zone === "enemy" && <div className="inspector-hint"><Shield size={14} /> {t("inspector.enemyCard")}</div>}
            {selection.zone === "hand" && isHumanTurn && game.activeHouse && !activeForHouse && <div className="inspector-hint"><Shield size={14} /> {t("inspector.onlyHouse", { house: houseLabel(game.activeHouse, t) })}</div>}
            {selection.zone === "board" && !card.ready && card.face.type === "Creature" && <div className="inspector-hint"><Clock3 size={14} /> {t("inspector.resting")}</div>}
            {selection.zone === "board" && card.stunned && <div className="inspector-hint"><CircleHelp size={14} /> {t("inspector.stunned")}</div>}
          </div>
        </div>
      ) : (
        <div className="inspector-empty">
          <span className="inspector-glyph"><Eye size={21} strokeWidth={1.4} /></span>
          <strong>{t("inspector.selectCard")}</strong>
          <p>{t("inspector.selectHint")}</p>
        </div>
      )}
    </section>
  );
}

// ---------- Deck modal ----------

function DeckModal({
  currentDeck,
  deckInput,
  setDeckInput,
  candidate,
  loading,
  error,
  fromCache,
  t,
  onFetch,
  onUseDeck,
  onClose,
}: {
  currentDeck: DeckInfo;
  deckInput: string;
  setDeckInput: (value: string) => void;
  candidate: DeckInfo | null;
  loading: boolean;
  error: string;
  fromCache: boolean;
  t: Translator;
  onFetch: (event: FormEvent<HTMLFormElement>) => void;
  onUseDeck: () => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLElement>();
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-panel deck-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="deck-modal-title">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">{t("deck.eyebrow")}</span>
            <h2 id="deck-modal-title">{t("deck.title")}</h2>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label={t("common.close")}><X size={18} /></button>
        </div>
        <p className="deck-modal-intro">{t("deck.intro")}</p>
        <form className="deck-import-form" onSubmit={onFetch}>
          <label htmlFor="deck-id">{t("deck.inputLabel")}</label>
          <div className="deck-input-row">
            <input id="deck-id" value={deckInput} onChange={(event) => setDeckInput(event.target.value)} placeholder={t("deck.placeholder")} />
            <button type="submit" disabled={loading || !deckInput.trim()}>
              {loading ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={15} />}
              <span>{loading ? t("common.loading") : t("deck.fetch")}</span>
            </button>
          </div>
          <span className="deck-input-hint">{t("deck.hint")}</span>
        </form>
        {error && <div className="form-error" role="alert">{error}</div>}
        {candidate ? (
          <div className="deck-result">
            <CardArt face={candidate.cards[0]} size="preview" />
            <div className="deck-result-copy">
              <div className="deck-result-topline"><span className="result-dot" />{fromCache ? t("deck.savedOffline") : t("deck.masterVault")}</div>
              <h3>{candidate.name}</h3>
              <p>{candidate.cards.length} {t("common.cards")} / {candidate.expansion ? `${t("deck.set")} ${candidate.expansion}` : t("deck.keyforgeDeck")}</p>
              <div className="deck-result-houses">{candidate.houses.map((house) => <HouseMark key={house} house={house} small />)}</div>
              <button className="use-deck-button" type="button" onClick={onUseDeck}>{t("deck.useDeck")} <ArrowRight size={14} /></button>
            </div>
          </div>
        ) : (
          <div className="current-deck-note">
            <span className="note-emblem"><BookOpen size={17} /></span>
            <span><small>{t("deck.activeDeck")}</small><strong>{currentDeck.name}</strong><em>{t("deck.availableOffline", { count: currentDeck.cards.length })}</em></span>
          </div>
        )}
        <div className="api-attribution"><ExternalLink size={12} /> {t("deck.attribution")}</div>
      </section>
    </div>
  );
}

// ---------- Confirm dialog ----------

/** Shared destructive-action dialog (FEAT-07 remove deck, FEAT-15 abandon
    match): same focus contract as the deck modal, Escape/backdrop cancel. */
function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="modal-panel confirm-panel" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{title}</h2>
        <p>{body}</p>
        <div className="confirm-actions">
          <button type="button" className="ghost-button" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className="cta-button cta-button--danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- App ----------

function App() {
  const [language, setLanguage] = useState<Language>(readLanguage);
  const [settings, setSettings] = useState<AppSettings>(() => readSettings(readLanguage()));
  const [hasHover] = useState(prefersHover);
  const t = useMemo(() => createTranslator(language), [language]);

  const [screen, setScreen] = useState<Screen>("home");
  const [selectedDeck, setSelectedDeck] = useState<DeckInfo>(DEMO_DECK);
  // BUG-15: the Vault view state survives browsing into a deck and back.
  const [browseState, setBrowseState] = useState<BrowseState>({ page: 1, search: "", ordering: "-date" });
  // FEAT-01: the interrupted match found at mount, offered on Home.
  const [resumeMatch, setResumeMatch] = useState<SavedMatch | null>(null);
  const [boundaryEpoch, setBoundaryEpoch] = useState(0);
  const [inspectDeck, setInspectDeck] = useState<DeckInfo | null>(null);
  // FEAT-06: local W/L of the deck open in the inspector.
  const [inspectStats, setInspectStats] = useState<DeckStats | null>(null);
  const [savedDecks, setSavedDecks] = useState<LibraryDeck[]>(STARTER_DECKS);
  // FEAT-07: library deck queued for the remove confirmation.
  const [deckToRemove, setDeckToRemove] = useState<LibraryDeck | null>(null);
  // FEAT-15: deck que aguarda a confirmação de abandono da partida em curso
  // (o modo viaja junto: o 2P também confirma antes de substituir a partida).
  const [pendingDeck, setPendingDeck] = useState<{ mode: GameMode; deck: DeckInfo; opponent?: DeckInfo } | null>(null);
  const [currentDeck, setCurrentDeck] = useState<DeckInfo>(DEMO_DECK);
  const [game, setGame] = useState<GameState | null>(null);
  // FEAT-13: the mode the LIVE match was created with (settings.gameMode only
  // drives the config wizard — toggling it must not re-shape a running match).
  const [matchMode, setMatchMode] = useState<GameMode>("solo");
  /** FEAT-13: side that must confirm the pass before its hand renders again. */
  const [passPending, setPassPending] = useState<0 | 1 | null>(null);

  const [selected, setSelected] = useState<Selection | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [forgeFlash, setForgeFlash] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);

  const [deckModalOpen, setDeckModalOpen] = useState(false);
  const [deckInput, setDeckInput] = useState(DEMO_DECK_ID);
  const [deckCandidate, setDeckCandidate] = useState<DeckInfo | null>(null);
  const [deckLoading, setDeckLoading] = useState(false);
  const [deckError, setDeckError] = useState("");
  const [deckFromCache, setDeckFromCache] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [matchVersion, setMatchVersion] = useState(0);
  // FEAT-05: full match log (docked sheet on mobile, inline panel on desktop).
  const [logOpen, setLogOpen] = useState(false);
  const [logSide, setLogSide] = useState<"all" | "you" | "warden">("all");
  const [logType, setLogType] = useState<"all" | LogType>("all");
  // FEAT-09: um service worker novo está instalado e esperando o skipWaiting.
  const [updateReady, setUpdateReady] = useState(false);
  // FEAT-12b: the read-only replay viewer — derived states, never the live one.
  const [replay, setReplay] = useState<{ states: GameState[]; index: number } | null>(null);
  // Tutorial: opens by itself only on the first real visit (always on Home).
  const [tutorialOpen, setTutorialOpen] = useState(isFirstVisit);
  const replayRef = useDialogFocus<HTMLDivElement>(replay !== null);

  const gameRef = useRef<GameState | null>(null);
  const settingsRef = useRef(settings);
  /** FEAT-13: the live match mode, read by the hot callbacks (like gameRef). */
  const matchModeRef = useRef<GameMode>("solo");
  /** FEAT-11: the rival a rematch replays against (random mode does not reroll). */
  const opponentRef = useRef<DeckInfo | null>(null);
  const aiTurnRef = useRef<string | null>(null);
  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const prevKeysRef = useRef({ player: 0, ai: 0 });
  /** FEAT-06: matchVersion already recorded locally (a match ends once). */
  const recordedMatchRef = useRef(-1);
  /** FEAT-12a: undo history — see commitGame below (capped at UNDO_LIMIT). */
  const historyRef = useRef<UndoEntry[]>([]);
  /** FEAT-12b: every transition of the live match, in order (in memory only —
      the save stays the plain GameState, no new persistence format). BUG2-03:
      null after a resume — the steps of the part already played are gone, so a
      replay would rebuild from turn 1 and turn every step into a no-op. */
  const stepsRef = useRef<ReplayStep[] | null>([]);

  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { matchModeRef.current = matchMode; }, [matchMode]);

  // FEAT-12a: the engine is pure and clones, so the state a transition leaves
  // behind stays a valid snapshot. Every commit records it together with
  // whether the transition revealed hidden information (draw/shuffle) and the
  // replay step count at that point; FEAT-12b appends the step itself.
  const commitGame = useCallback((prev: GameState, next: GameState, step?: ReplayStep) => {
    const stack = historyRef.current;
    stack.push({ state: prev, revealed: revealsHiddenInfo(prev, next), step: stepsRef.current?.length ?? 0 });
    if (stack.length > UNDO_LIMIT) stack.shift();
    if (step) stepsRef.current?.push(step);
    gameRef.current = next;
    setGame(next);
  }, []);

  /** FEAT-12a: where undo would land, or null when it cannot — not the player's
      turn, nothing done yet, or a move this turn already revealed hidden
      information (a rewind would let the player re-plan with cards it saw). */
  const undoInfo = useCallback((live: GameState | null) => {
    const stack = historyRef.current;
    if (!live || live.activePlayer !== 0 || live.winner !== null) return null;
    const inTurn = (state: GameState) => state.activePlayer === 0 && state.turn === live.turn && state.activeHouse !== null;
    let index = stack.length - 1;
    while (index >= 0 && inTurn(stack[index].state)) index -= 1;
    const anchor = stack[index + 1];
    if (!anchor || anchor.state === live) return null;
    // BUG2-07: `at` is the anchor's position — undoing truncates the stale
    // branch after it (otherwise the cap shifts a ghost state into stack[0]).
    return { anchor: anchor.state, step: anchor.step, at: index + 1, blocked: stack.slice(index + 1).some((entry) => entry.revealed) };
  }, []);

  const undoLastMove = useCallback(() => {
    // FEAT-13: undo does not exist in pass-and-play — rewinding past an end
    // turn would resurface the other player's hand.
    if (matchModeRef.current !== "solo") return;
    const info = undoInfo(gameRef.current);
    if (!info || info.blocked) return;
    sound.play("click");
    // FEAT-12b: the rewind also rolls the replay list back to the anchor, so a
    // later replay never applies moves the player undid. BUG2-07: the undo
    // history is truncated the same way — keeping the undone branch would let
    // the cap evict the turn-start anchor and rewind into a state that never
    // existed on the current line.
    stepsRef.current?.splice(info.step);
    historyRef.current.splice(info.at + 1);
    gameRef.current = info.anchor;
    setGame(info.anchor);
    setSelected(null);
    setPick(null);
  }, [undoInfo]);

  // Persist settings + language, and drive the audio engine prefs.
  useEffect(() => {
    saveSettings(settings);
    sound.setPrefs({ sfx: settings.sfx, music: settings.music && screen === "game" });
  }, [settings, screen]);

  useEffect(() => {
    saveLanguage(language);
    setSettings((prev) => (prev.language === language ? prev : { ...prev, language }));
  }, [language]);

  // Each screen is a fresh page: without this the new screen opens at the
  // previous one's scroll offset (e.g. config mid-list, board without header).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);

  // The motion switch lives on <html>, not on .app-root: the card zoom and the
  // long-press lightbox are portaled to <body> and must obey it too.
  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", !settings.animations);
  }, [settings.animations]);

  // Tab/window title follows the screen and the language.
  useEffect(() => {
    const titles: Record<Screen, string> = {
      home: t("nav.home"),
      browse: t("nav.browse"),
      config: t("nav.config"),
      game: t("nav.play"),
      inspect: inspectDeck?.name ?? t("nav.home"),
    };
    document.title = `${titles[screen]} · Aember Arena`;
  }, [screen, t, inspectDeck]);

  // Keep <html lang> in sync with the active language (settings.language).
  useEffect(() => {
    document.documentElement.lang = settings.language === "ptBR" ? "pt-BR" : "en";
  }, [settings.language]);

  useEffect(() => {
    void cacheDeck(DEMO_DECK);
    void cacheDeck(DEMO_DECK_2);
    let disposed = false;
    if ("serviceWorker" in navigator) {
      // T7c/T8: caminho relativo — coerente com SHELL_URLS/manifest; não quebra em subpath.
      void navigator.serviceWorker.register("./sw.js").then((registration) => {
        if (disposed) return;
        swRegistrationRef.current = registration;
        // FEAT-09: um worker já esperando (update achado numa sessão anterior)
        // também avisa o jogador na próxima abertura.
        if (registration.waiting && navigator.serviceWorker.controller) setUpdateReady(true);
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // Sem controller é o primeiro install: não há versão antiga a trocar.
            if (installing.state === "installed" && navigator.serviceWorker.controller) setUpdateReady(true);
          });
        });
      }).catch(() => undefined);
    }
    const setNetwork = () => setOnline(navigator.onLine);
    window.addEventListener("online", setNetwork);
    window.addEventListener("offline", setNetwork);
    const unbindAudio = sound.bindUnlock();
    return () => {
      disposed = true;
      window.removeEventListener("online", setNetwork);
      window.removeEventListener("offline", setNetwork);
      unbindAudio();
    };
  }, []);

  // FEAT-01: offer an interrupted match (if any) once at mount.
  useEffect(() => {
    setResumeMatch(loadSavedMatch());
  }, []);

  // Restore every deck cached in IndexedDB, plus the last one the player chose.
  useEffect(() => {
    let disposed = false;
    void listCachedDecks().then((cached) => {
      if (disposed || !cached.length) return;
      setSavedDecks((prev) => {
        const merged = [...prev];
        for (const deck of cached) {
          const index = merged.findIndex((item) => item.id === deck.id);
          if (index >= 0) merged[index] = deck;
          else merged.push(deck);
        }
        return merged;
      });
      try {
        const savedId = localStorage.getItem("aember-arena-last-deck");
        const last = cached.find((deck) => deck.id === savedId);
        if (last) setSelectedDeck(last);
      } catch {
        // The starter deck stays selected.
      }
    });
    return () => { disposed = true; };
  }, []);

  // FEAT-01: the live match is the save file; a finished match clears it.
  // FEAT-13: pass-and-play matches are NOT saved — the save is a solo match
  // slot (one deck, one resumable seat), and a 2P board cannot be handed back
  // to the right player from the Home banner.
  useEffect(() => {
    if (!game || matchMode === "passAndPlay") return;
    if (game.winner === null) void saveMatch({ game, deckId: currentDeck.id });
    else clearSavedMatch();
  }, [game, currentDeck.id, matchMode]);

  useEffect(() => {
    if (!toast || toast.sticky) return;
    const timeout = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  // FEAT-09/BUG2-01: o aviso de atualização nunca aparece com uma partida viva,
  // em nenhuma tela — um reload descartaria o jogo em curso (no 2P nem save).
  // Um toast já visível quando a partida começa sai da tela junto.
  useEffect(() => {
    if (!updateReady) return;
    if (game?.winner === null) {
      setToast(null);
      return;
    }
    setToast({
      message: t("update.title"),
      kind: "success",
      sticky: true,
      action: { label: t("update.reload"), onClick: reloadForUpdate },
    });
  }, [updateReady, game?.winner, t]);

  useEffect(() => {
    if (!deckModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setDeckModalOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deckModalOpen]);

  // Escape dismisses the card inspector (on narrow screens it is a bottom sheet).
  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || deckModalOpen) return;
      setSelected(null);
      setPick(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, deckModalOpen]);

  // FEAT-12b: Escape leaves the read-only replay, like every other overlay.
  useEffect(() => {
    if (!replay) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReplay(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [replay]);

  // Forge flash + win/lose sounds.
  useEffect(() => {
    if (!game) return;
    const nextKeys = { player: game.players[0].keys, ai: game.players[1].keys };
    if (nextKeys.player > prevKeysRef.current.player || nextKeys.ai > prevKeysRef.current.ai) {
      sound.play("forge");
      if (settingsRef.current.animations) {
        setForgeFlash(true);
        window.setTimeout(() => setForgeFlash(false), 700);
      }
    }
    prevKeysRef.current = nextKeys;
    // FEAT-13: in pass-and-play both sides are humans, so either win is a win.
    if (game.winner !== null) sound.play(matchModeRef.current === "passAndPlay" || game.winner === 0 ? "win" : "lose");
  }, [game?.players[0].keys, game?.players[1].keys, game?.winner]);

  // FEAT-06: one local W/L row per finished match (deck + mode + difficulty).
  // cache.ts swallows storage failures, so the record never breaks the table.
  // FEAT-13: never in pass-and-play — one row per local deck would read as W/L
  // vs the Warden when both sides are human.
  useEffect(() => {
    if (!game || game.winner === null || recordedMatchRef.current === matchVersion || matchMode !== "solo") return;
    recordedMatchRef.current = matchVersion;
    const { opponentMode, difficulty } = settingsRef.current;
    void recordMatchResult(currentDeck.id, game.winner === 0, opponentMode, difficulty);
  }, [game, matchVersion, currentDeck.id, matchMode]);

  // AI turn loop. FEAT-13: pass-and-play has no AI — the effect stays dormant.
  useEffect(() => {
    if (!game || screen !== "game" || matchMode === "passAndPlay") return;
    if (game.activePlayer !== 1 || game.winner !== null) {
      if (game.winner !== null || game.activePlayer === 0) setAiThinking(false);
      return;
    }

    const turnKey = `${matchVersion}-${game.turn}-${game.activePlayer}`;
    if (aiTurnRef.current === turnKey) return;
    aiTurnRef.current = turnKey;
    let cancelled = false;
    const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

    const takeAiTurn = async () => {
      setAiThinking(true);
      await wait(520);
      if (cancelled || !gameRef.current) return;

      let next = gameRef.current;
      // Resuming after leaving the board mid-turn: the house was already chosen.
      const house = next.activeHouse ?? chooseAiHouse(next, 1);
      const opening = chooseHouse(next, 1, house);
      sound.play("house");
      commitGame(next, opening, { kind: "house", side: 1, house });
      next = opening;

      // No fixed cap: play until nothing is worth doing (safety cap against a
      // loop the evaluator cannot see an end to, BUG-12 was a hard 7).
      for (let action = 0; action < 40; action += 1) {
        await wait(settingsRef.current.difficulty === "Impossible" ? 460 : 340);
        if (cancelled) return;
        const move = chooseAiMove(next, 1, house, settingsRef.current);
        if (!move) break;
        const applied = applyMove(next, 1, move);
        sound.play(move.type === "fight" ? "fight" : move.type === "reap" ? "reap" : "play");
        commitGame(next, applied, { kind: "move", side: 1, move });
        next = applied;
        if (next.winner !== null) break;
      }

      if (!cancelled && next.winner === null) {
        await wait(260);
        if (cancelled) return;
        const ended = endTurn(next, 1);
        // The Warden handing over is the player's turn starting.
        sound.play("turn");
        commitGame(next, ended, { kind: "end", side: 1 });
        next = ended;
      }
      setAiThinking(false);
    };

    void takeAiTurn();
    return () => {
      cancelled = true;
      // Leaving the board mid-turn cancels the loop; clearing the marker lets
      // the effect resume the same turn from gameRef.current on return (BUG-03).
      aiTurnRef.current = null;
    };
  }, [game?.activePlayer, game?.turn, game?.winner, matchVersion, screen, commitGame, matchMode]);

  // FEAT-10: the Warden decides the mulligan on a short pause, so it reads as
  // an opponent move instead of an instant flip. FEAT-13: side 1 is a human in
  // pass-and-play, so the Warden's pause is skipped there.
  useEffect(() => {
    if (!game || screen !== "game" || game.pendingMulligan !== 1 || matchMode === "passAndPlay") return;
    const timer = window.setTimeout(() => {
      const current = gameRef.current;
      if (!current || current.pendingMulligan !== 1) return;
      const take = shouldMulligan(current, 1);
      commitGame(current, take ? mulligan(current, 1) : keepHand(current, 1), { kind: take ? "mulligan" : "keep", side: 1 });
    }, 620);
    return () => window.clearTimeout(timer);
  }, [game?.pendingMulligan, screen, commitGame, matchMode]);

  const selectedCard = useMemo(() => {
    if (!selected || !game) return null;
    const player = game.players[selected.playerIndex];
    const cards = selected.zone === "hand" ? player.hand : player.board;
    return cards.find((card) => card.instanceId === selected.instanceId) ?? null;
  }, [game, selected]);

  // FEAT-05: the full log grouped by round (latest round first, latest entry
  // first inside it), after the side/type filters. FEAT-13: the filter reads the
  // state's side names, so pass-and-play filters by "Player 1"/"Player 2".
  const logRounds = useMemo(() => {
    if (!game || !logOpen) return [];
    const sideName = { you: game.players[0].name, warden: game.players[1].name };
    const filtered = game.log.filter(
      (entry) =>
        (logSide === "all" || entry.params.name === sideName[logSide]) &&
        (logType === "all" || entry.key === `log.${logType}`),
    );
    const rounds: { turn: number; entries: LogEntry[] }[] = [];
    for (const entry of [...filtered].reverse()) {
      const group = rounds.find((item) => item.turn === entry.turn);
      if (group) group.entries.push(entry);
      else rounds.push({ turn: entry.turn, entries: [entry] });
    }
    return rounds;
  }, [game, logOpen, logSide, logType]);

  // FEAT-12a: computed from the rendered game (gameRef lags one commit behind).
  const undo = game ? undoInfo(game) : null;
  const undoable = undo !== null && !undo.blocked;
  // FEAT-12b: the replay viewer needs the recorded steps (same session); the
  // seed always lives in the state. FEAT-13: neither undo nor replay exists in
  // pass-and-play — a rewind would re-show cards the other player already saw.
  // BUG2-03: a resumed match has no steps for the part already played.
  const canReplay = Boolean(game && matchMode === "solo" && stepsRef.current?.length);
  const passAndPlay = matchMode === "passAndPlay";
  const humanSide: 0 | 1 = game ? humanSideOf(game, matchMode) : 0;

  function showToast(message: string, kind: "success" | "error" = "success") {
    setToast({ message, kind });
  }

  // FEAT-11: substituir uma partida em curso pede confirmação; reiniciar uma
  // partida intocada (mesmo deck, rodada 1) não perde nada e segue direto.
  function startMatch(deck: DeckInfo, opponent?: DeckInfo) {
    const current = gameRef.current;
    if (current && current.winner === null && (currentDeck.id !== deck.id || current.turn > 1)) {
      sound.play("click");
      setPendingDeck({ mode: "solo", deck, opponent });
      return;
    }
    launchMatch(deck, opponent, "solo");
  }

  // FEAT-13: a pass-and-play match confirms the replacement the same way (the
  // second deck rides along in `opponent`).
  function startPassAndPlay(deck1: DeckInfo, deck2: DeckInfo) {
    const current = gameRef.current;
    if (current && current.winner === null && (currentDeck.id !== deck1.id || current.turn > 1)) {
      sound.play("click");
      setPendingDeck({ mode: "passAndPlay", deck: deck1, opponent: deck2 });
      return;
    }
    launchMatch(deck1, deck2, "passAndPlay");
  }

  // FEAT-11: "deck" usa o baralho escolhido nas configurações e "random" sorteia
  // um diferente da biblioteca a cada partida; qualquer escolha inválida (deck
  // removido da biblioteca) cai no espelho.
  function resolveOpponent(deck: DeckInfo): DeckInfo {
    const mode = settingsRef.current.opponentMode;
    if (mode !== "mirror") {
      const pool = savedDecks.filter((item) => item.id !== deck.id);
      const picked = pool.find((item) => item.id === settingsRef.current.opponentDeckId);
      if (mode === "deck" && picked) return picked;
      if (mode === "random" && pool.length) return pool[Math.floor(Math.random() * pool.length)];
    }
    return deck;
  }

  function launchMatch(deck: DeckInfo, opponent: DeckInfo | undefined, mode: GameMode) {
    // FEAT-08: every match gets a fresh random seed, shown on the winner panel
    // so the opening hands can be replayed.
    const seed = Math.floor(Math.random() * 4294967296);
    const rival = opponent ?? resolveOpponent(deck);
    // FEAT-13: a 2P match renames the sides at creation (no AI is coming).
    const next = mode === "passAndPlay" ? createPassAndPlayMatch(deck, rival, { seed }) : createMatch(deck, rival, { seed });
    opponentRef.current = rival;
    // FEAT-12a: a new match starts a fresh undo history.
    historyRef.current = [];
    stepsRef.current = [];
    gameRef.current = next;
    prevKeysRef.current = { player: 0, ai: 0 };
    setCurrentDeck(deck);
    setGame(next);
    setMatchMode(mode);
    setPassPending(null);
    // BUG2-02: uma partida nova nunca deixa o banner apontar para o save antigo.
    setResumeMatch(null);
    if (mode === "passAndPlay") {
      // FEAT-13: 2P matches are never saved; the solo save slot must not
      // resurface on Home pointing at a match that was just replaced.
      clearSavedMatch();
    }
    setSelected(null);
    setPick(null);
    setAiThinking(false);
    setLogOpen(false);
    setMatchVersion((version) => version + 1);
    setScreen("game");
    sound.play("forge");
  }

  // T7d: handlers quentes do board em useCallback — a identidade estável é o que
  // efetiva o memo de GameBoard→BoardLane→CardTile (só leem refs/setters estáveis).
  const performHumanMove = useCallback((move: GameMove) => {
    const prev = gameRef.current;
    if (!prev) return;
    const side = humanSideOf(prev, matchModeRef.current);
    // The player chooses targets the way keyteki prompts: only when there is a
    // real choice left (a fight's second pick is the ability target, BUG-06).
    const choices = "target" in move && move.target ? [] : targetChoices(prev, side, move);
    if (choices.length > 1) {
      sound.play("select");
      setPick({ move, ids: choices });
      return;
    }
    sound.play(move.type === "fight" ? "fight" : move.type === "reap" ? "reap" : "play");
    commitGame(prev, applyMove(prev, side, move), { kind: "move", side, move });
    setSelected(null);
    setPick(null);
  }, [commitGame]);

  const pickBoardCard = useCallback(
    (owner: 0 | 1, card: CardInstance) => {
      const live = gameRef.current;
      if (!live) return;
      const own = owner === humanSideOf(live, matchModeRef.current);
      if (pick) {
        if (pick.ids.includes(card.instanceId)) {
          // A fight pick fills the defender first, then the ability target.
          const applied: GameMove =
            pick.move.type === "fight" && !pick.move.targetId
              ? { ...pick.move, targetId: card.instanceId }
              : ({ ...pick.move, target: card.instanceId } as GameMove);
          performHumanMove(applied);
          return;
        }
        if (!own) return;
        setPick(null);
      }
      sound.play("select");
      setSelected({ zone: own ? "board" : "enemy", playerIndex: owner, instanceId: card.instanceId });
    },
    [pick, performHumanMove],
  );

  const endHumanTurn = useCallback(() => {
    const live = gameRef.current;
    if (!live) return;
    const side = humanSideOf(live, matchModeRef.current);
    sound.play("endTurn");
    const next = endTurn(live, side);
    commitGame(live, next, { kind: "end", side });
    setSelected(null);
    setPick(null);
    // FEAT-13: the other human takes over — the pass screen hides this hand
    // before the next one renders.
    if (matchModeRef.current === "passAndPlay" && next.winner === null) setPassPending(next.activePlayer);
  }, [commitGame]);

  // FEAT-10/13: the opening-hand decision of the side holding the device.
  const decideOpeningHand = useCallback((take: boolean) => {
    const prev = gameRef.current;
    if (!prev) return;
    const side = humanSideOf(prev, matchModeRef.current);
    sound.play(take ? "shuffle" : "click");
    const next = take ? mulligan(prev, side) : keepHand(prev, side);
    commitGame(prev, next, { kind: take ? "mulligan" : "keep", side });
    if (matchModeRef.current === "passAndPlay") {
      // The next decision (or the first turn) belongs to the other human; the
      // inspector must not keep showing a card from the hand just decided.
      setSelected(null);
      setPick(null);
      setPassPending(inMulligan(next) ? (next.pendingMulligan as 0 | 1) : 0);
    }
  }, [commitGame]);

  const keepOpeningHand = useCallback(() => decideOpeningHand(false), [decideOpeningHand]);
  const takeMulligan = useCallback(() => decideOpeningHand(true), [decideOpeningHand]);

  const choosePlayerHouse = useCallback((house: string) => {
    const prev = gameRef.current;
    if (!prev) return;
    const side = humanSideOf(prev, matchModeRef.current);
    sound.play("house");
    // FEAT-12a: the state right after the house choice is the undo anchor — the
    // start of the turn, before any of the player's moves.
    commitGame(prev, chooseHouse(prev, side, house), { kind: "house", side, house });
  }, [commitGame]);

  const selectHandCard = useCallback((card: CardInstance) => {
    const live = gameRef.current;
    if (!live) return;
    sound.play("select");
    // A pending ability target belongs to the card that started it; picking a
    // hand card cancels the pick instead of executing with the old card (BUG-24).
    setPick(null);
    setSelected({ zone: "hand", playerIndex: humanSideOf(live, matchModeRef.current), instanceId: card.instanceId });
  }, []);

  // FEAT-11: the rematch keeps the same rival; without one (a resumed match)
  // launchMatch resolves it again from the settings. FEAT-13: a 2P rematch
  // replays the same two decks.
  function rematch() {
    if (matchMode === "passAndPlay") startPassAndPlay(currentDeck, opponentRef.current ?? currentDeck);
    else startMatch(currentDeck, opponentRef.current ?? undefined);
  }

  // FEAT-12b: rebuilds the match from its seed plus the recorded steps and opens
  // the read-only viewer (the live match and its save are untouched).
  function openReplay() {
    const live = gameRef.current;
    if (!live || matchModeRef.current !== "solo") return;
    const states = [createMatch(currentDeck, opponentRef.current ?? currentDeck, { seed: live.seed })];
    for (const step of stepsRef.current ?? []) states.push(applyStep(states[states.length - 1], step));
    sound.play("select");
    setSelected(null);
    setPick(null);
    setReplay({ states, index: 0 });
  }

  const goHome = useCallback(() => {
    sound.play("click");
    setScreen("home");
  }, []);

  // FEAT-09: libera o worker novo e só recarrega quando ele assumir o controle —
  // recarregar antes disso traria a versão antiga de volta.
  function reloadForUpdate() {
    const waiting = swRegistrationRef.current?.waiting;
    if (!waiting) {
      window.location.reload();
      return;
    }
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
    waiting.postMessage({ type: "SKIP_WAITING" });
  }

  async function updateAppShell() {
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      await registration?.update();
    } catch {
      // The current shell still works if the update check is blocked.
    }
  }

  async function syncCurrentDeck() {
    if (syncing) return;
    setSyncing(true);
    await updateAppShell();
    // Sync the deck the player is looking at — the match deck on the board, the
    // selected deck anywhere else — and never re-point the selection (BUG-05).
    const target = screen === "game" ? currentDeck : selectedDeck;
    try {
      const deck = await fetchKeyforgeDeck(target.id);
      if (screen === "game") {
        setCurrentDeck(deck);
        // A live match reflects the fresh card data (refreshGameFaces had no
        // caller — BUG-21); the log entry comes from the engine itself.
        if (gameRef.current && gameRef.current.winner === null) {
          const next = refreshGameFaces(gameRef.current, deck);
          commitGame(gameRef.current, next);
        }
      } else {
        setSelectedDeck(deck);
      }
      setSavedDecks((prev) => prev.map((item) => (item.id === deck.id ? { ...deck, favorite: item.favorite } : item)));
      showToast(t("toast.synced", { name: deck.name, count: deck.cards.length }));
    } catch (error) {
      const cached = await getCachedDeck(target.id);
      if (cached) showToast(t("toast.usingCache", { name: cached.name }));
      else showToast(vaultErrorText(error, t), "error");
    } finally {
      setSyncing(false);
    }
  }

  async function fetchDeck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDeckLoading(true);
    setDeckError("");
    setDeckCandidate(null);
    setDeckFromCache(false);
    try {
      const result = await loadDeckOrCache(deckInput);
      setDeckCandidate(result.deck);
      setDeckFromCache(result.fromCache);
      sound.play("select");
    } catch (error) {
      setDeckError(vaultErrorText(error, t));
      sound.play("error");
    } finally {
      setDeckLoading(false);
    }
  }

  function useCandidateDeck() {
    if (!deckCandidate) return;
    const deck = deckCandidate;
    setSavedDecks((prev) => {
      const index = prev.findIndex((item) => item.id === deck.id);
      if (index < 0) return [...prev, deck];
      const next = [...prev];
      // FEAT-07: a re-import keeps the favorite flag already in the library row.
      next[index] = { ...deck, favorite: prev[index].favorite };
      return next;
    });
    setSelectedDeck(deck);
    setDeckCandidate(null);
    setDeckModalOpen(false);
    try {
      localStorage.setItem("aember-arena-last-deck", deck.id);
    } catch {
      // Deck is already cached in IndexedDB when available.
    }
    showToast(t("toast.deckReady", { name: deck.name }));
  }

  function openDeckModal() {
    setDeckInput(selectedDeck.id);
    setDeckCandidate(null);
    setDeckError("");
    setDeckFromCache(false);
    setDeckModalOpen(true);
  }

  function openInspector(deck: DeckInfo) {
    sound.play("select");
    setInspectDeck(deck);
    setInspectStats(null);
    void getDeckStats(deck.id).then(setInspectStats);
    setScreen("inspect");
  }

  // Adopt a deck from the vault or inspector without leaving the current screen flow.
  function adoptDeck(deck: DeckInfo) {
    sound.play("select");
    // FEAT-07: re-adopting an already-saved deck keeps its favorite flag.
    const known = savedDecks.find((item) => item.id === deck.id);
    const library: LibraryDeck = known?.favorite ? { ...deck, favorite: true } : deck;
    setSavedDecks((prev) => (prev.some((item) => item.id === deck.id) ? prev.map((item) => (item.id === deck.id ? library : item)) : [...prev, library]));
    setSelectedDeck(library);
    // Adoption is what makes a deck a library deck; vault page precache rows
    // stay saved:false and out of the Home list (BUG-13).
    void cacheDeck(library, { saved: true });
    try {
      localStorage.setItem("aember-arena-last-deck", deck.id);
    } catch {
      // The deck is already cached in IndexedDB when available.
    }
    showToast(t("toast.deckReady", { name: deck.name }));
  }

  // FEAT-07: favorite pins a library deck to the front of the Home list.
  function toggleFavorite(deck: LibraryDeck) {
    const favorite = deck.favorite !== true;
    sound.play(favorite ? "select" : "click");
    setSavedDecks((prev) => prev.map((item) => (item.id === deck.id ? { ...item, favorite } : item)));
    void setDeckFavorite(deck.id, favorite);
  }

  // FEAT-07: confirmed from the dialog; bundled decks never reach this path.
  function removeDeck() {
    if (!deckToRemove) return;
    const deck = deckToRemove;
    setDeckToRemove(null);
    sound.play("click");
    setSavedDecks((prev) => prev.filter((item) => item.id !== deck.id));
    void deleteDeck(deck.id);
    // The selection falls back to a bundled deck; a live match keeps its
    // in-memory faces and only loses the resume lookup for this deck.
    setSelectedDeck((prev) => (prev.id === deck.id ? DEMO_DECK : prev));
    showToast(t("toast.deckRemoved", { name: deck.name }));
  }

  const currentTurnLabel = !game
    ? ""
    : game.winner !== null
      ? t("game.matchComplete")
      : passAndPlay
        ? t("game.turnOf", { name: localizeName(game.players[game.activePlayer].name, t) })
        : game.activePlayer === 0
          ? t("game.yourTurn")
          : t("game.opponentTurn");

  return (
    <div className="app-root">
      <header className="app-header">
        <button
          type="button"
          className="brand-lockup"
          aria-label={t("nav.home")}
          onClick={() => { sound.play("click"); setScreen("home"); }}
        >
          <span className="brand-symbol"><ForgeMark /></span>
          <span className="brand-wordmark"><strong>AEMBER</strong><small>ARENA</small></span>
        </button>

        <nav className="header-nav" aria-label={t("nav.screens")}>
          <button type="button" className={`nav-link${screen === "home" || screen === "inspect" ? " is-active" : ""}`} onClick={() => { sound.play("click"); setScreen("home"); }}>
            <Home size={14} /> <span>{t("nav.home")}</span>
          </button>
          <button type="button" className={`nav-link${screen === "browse" ? " is-active" : ""}`} onClick={() => { sound.play("click"); setScreen("browse"); }}>
            <BookOpen size={14} /> <span>{t("nav.browse")}</span>
          </button>
          <button type="button" className={`nav-link${screen === "config" ? " is-active" : ""}`} onClick={() => { sound.play("click"); setScreen("config"); }}>
            <Settings2 size={14} /> <span>{t("nav.config")}</span>
          </button>
          {game && (
            <button type="button" className={`nav-link${screen === "game" ? " is-active" : ""}`} onClick={() => { sound.play("click"); setScreen("game"); }}>
              <Swords size={14} /> <span>{t("nav.play")}</span>
            </button>
          )}
        </nav>

        <div className="header-actions">
          <span className={`network-state${online ? "" : " network-state--offline"}`} title={online ? t("common.online") : t("common.offline")}>
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span>{online ? t("common.online") : t("common.offline")}</span>
          </span>
          <button
            type="button"
            className="header-icon-button"
            aria-label={settings.sfx ? t("common.mute") : t("common.unmute")}
            onClick={() => { sound.play("click"); setSettings((prev) => ({ ...prev, sfx: !prev.sfx })); }}
          >
            {settings.sfx ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button className="header-button header-button--subtle" type="button" aria-label={t("common.deck")} title={t("common.deck")} onClick={() => { sound.play("click"); openDeckModal(); }}>
            <BookOpen size={15} /><span>{t("common.deck")}</span>
          </button>
          <button className="header-button header-button--sync" type="button" aria-label={syncing ? t("common.syncing") : t("common.sync")} title={t("common.sync")} onClick={() => void syncCurrentDeck()} disabled={syncing}>
            {syncing ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
            <span>{syncing ? t("common.syncing") : t("common.sync")}</span>
          </button>
          <LanguageMenu language={language} onChange={(next) => { setLanguage(next); showToast(t("toast.langChanged")); }} label={t("nav.language")} compact />
        </div>
      </header>

      {toast && (
        <div className={`toast-message toast-message--${toast.kind}`} role="status">
          {toast.kind === "success" ? <Check size={15} /> : <CircleHelp size={15} />}
          <span>{toast.message}</span>
          {toast.action && (
            <button type="button" className="toast-action" onClick={toast.action.onClick}>{toast.action.label}</button>
          )}
          <button type="button" onClick={() => setToast(null)} aria-label={t("common.close")}><X size={14} /></button>
        </div>
      )}

      <main className="app-main">
        <ErrorBoundary
          key={boundaryEpoch}
          onReset={() => {
            setScreen("home");
            setSelected(null);
            setPick(null);
            setBoundaryEpoch((epoch) => epoch + 1);
          }}
          title={t("error.title")}
          body={t("error.body")}
          action={t("error.back")}
        >
        {screen === "home" && resumeMatch && (
          <button
            type="button"
            className="resume-bar"
            onClick={() => {
              sound.play("forge");
              const saved = resumeMatch.game as GameState;
              // FEAT-12a: a resumed match has no in-memory history to undo; its
              // step list stays null so replay stays off (BUG2-03).
              historyRef.current = [];
              stepsRef.current = null;
              gameRef.current = saved;
              prevKeysRef.current = { player: saved.players[0].keys, ai: saved.players[1].keys };
              setGame(saved);
              // BUG2-04: a deck removed from the library (or not loaded yet) is
              // rebuilt from the state instead of falling into the demo deck;
              // the rival comes back too, so the rematch keeps its deck.
              setCurrentDeck(deckFromState(saved.players[0], resumeMatch.deckId));
              opponentRef.current = deckFromState(saved.players[1], "rival");
              setMatchMode("solo");
              setPassPending(null);
              setAiThinking(false);
              setMatchVersion((version) => version + 1);
              setScreen("game");
              setResumeMatch(null);
            }}
          >
            <KeyRound size={15} />
            {t("home.resumeMatch", { round: (resumeMatch.game as GameState).turn })}
          </button>
        )}
        {screen === "home" && canReplay && (
          <button type="button" className="resume-bar" onClick={openReplay}>
            <Eye size={15} /> {t("game.replayLast")}
          </button>
        )}
        {screen === "home" && (
          <HomeScreen
            t={t}
            language={language}
            savedDecks={savedDecks}
            selectedDeck={selectedDeck}
            onSelectDeck={(deck) => { sound.play("select"); setSelectedDeck(deck); }}
            onInspectDeck={openInspector}
            onToggleFavorite={toggleFavorite}
            onRemoveDeck={setDeckToRemove}
            onOpenImport={() => { sound.play("click"); openDeckModal(); }}
            onOpenBrowse={() => { sound.play("click"); setScreen("browse"); }}
            onContinue={() => { sound.play("click"); setScreen("config"); }}
            onLanguage={(next) => { setLanguage(next); showToast(t("toast.langChanged")); }}
            onOpenTutorial={() => { sound.play("click"); setTutorialOpen(true); }}
          />
        )}

        {screen === "browse" && (
          <DeckBrowser
            t={t}
            state={browseState}
            onStateChange={setBrowseState}
            offline={!online}
            onBack={() => setScreen("home")}
            onInspect={openInspector}
            onUseDeck={(deck) => { adoptDeck(deck); setScreen("home"); }}
          />
        )}

        {screen === "inspect" && inspectDeck && (
          <DeckInspector
            deck={inspectDeck}
            t={t}
            selected={selectedDeck.id === inspectDeck.id}
            stats={inspectStats}
            onBack={() => { sound.play("click"); setScreen(savedDecks.some((item) => item.id === inspectDeck.id) ? "home" : "browse"); }}
            onUseDeck={() => { adoptDeck(inspectDeck); setScreen("config"); }}
          />
        )}

        {screen === "config" && (
          <ConfigScreen
            t={t}
            settings={settings}
            deck={selectedDeck}
            savedDecks={savedDecks}
            hasHover={hasHover}
            onChange={setSettings}
            onLanguage={setLanguage}
            onOpenTutorial={() => { sound.play("click"); setTutorialOpen(true); }}
            onBack={() => setScreen("home")}
            onStart={() => {
              if (settings.gameMode !== "passAndPlay") {
                startMatch(selectedDeck);
                return;
              }
              const [deck1, deck2] = resolvePassDecks(savedDecks, selectedDeck, settings);
              startPassAndPlay(deck1, deck2);
            }}
          />
        )}

        {screen === "game" && game && (
          <div className="screen game-screen">
            <div className="workspace">
              <div className="main-column">
                <div className="match-heading">
                  <div>
                    <div className="match-eyebrow"><span>{passAndPlay ? t("game.eyebrow2p") : t("game.eyebrow")}</span><span className="eyebrow-line" /><span>{t("game.table")}</span></div>
                    <h1>{currentDeck.name}</h1>
                  </div>
                  <div className="match-chip">
                    <span className="match-chip-icon"><Radio size={14} /></span>
                    <span><small>{t("game.round")} {String(game.turn).padStart(2, "0")}</small><strong>{currentTurnLabel}</strong></span>
                  </div>
                </div>

                <GameBoard
                  game={game}
                  selected={selected}
                  pick={pick}
                  aiThinking={aiThinking}
                  settings={settings}
                  t={t}
                  forgeFlash={forgeFlash}
                  onHouse={choosePlayerHouse}
                  onSelectHand={selectHandCard}
                  onSelectBoard={pickBoardCard}
                  onEndTurn={endHumanTurn}
                  onRematch={rematch}
                  onHome={goHome}
                  onKeepHand={keepOpeningHand}
                  onMulligan={takeMulligan}
                  canReplay={canReplay}
                  onReplay={openReplay}
                  passAndPlay={passAndPlay}
                  humanSide={humanSide}
                  passPending={passPending}
                  onPassConfirm={() => { sound.play("click"); setPassPending(null); }}
                />
              </div>

              <aside className="command-rail" aria-label={t("rail.controls")}>
                <div className="rail-topline"><span>{t("rail.notes")}</span><span className="table-number">01</span></div>
                <SelectedCardPanel
                  selection={selected}
                  card={selectedCard}
                  game={game}
                  pick={pick}
                  settings={settings}
                  t={t}
                  humanSide={humanSide}
                  onMove={performHumanMove}
                  onFight={() => {
                    const live = gameRef.current;
                    if (!selectedCard || !live) return;
                    sound.play("select");
                    const side = humanSideOf(live, matchModeRef.current);
                    setPick({
                      move: { type: "fight", attackerId: selectedCard.instanceId, targetId: "" },
                      ids: fightTargets(live, side, selectedCard).map((target) => target.instanceId),
                    });
                  }}
                  onCancelPick={() => setPick(null)}
                  onClear={() => { setSelected(null); setPick(null); }}
                />

                {/* FEAT-12a: rewinds the player's moves to the start of the turn.
                    FEAT-13: undo does not exist in pass-and-play. */}
                {!passAndPlay && (
                  <section className="undo-section">
                    <button
                      type="button"
                      className="ghost-button undo-button"
                      onClick={undoLastMove}
                      disabled={!undoable}
                      title={undo?.blocked ? t("game.undoBlocked") : undefined}
                    >
                      <RotateCcw size={15} /> {t("game.undo")}
                    </button>
                  </section>
                )}

                {/* FEAT-13: no Warden in pass-and-play. */}
                {!passAndPlay && (
                  <section className="ai-brief">
                    <span className="ai-avatar"><Cpu size={17} /></span>
                    <div className="ai-brief-copy">
                      <span className="section-label">{t("rail.warden")}</span>
                      <strong>{describeAiThinking({ difficulty: settings.difficulty, thinkingDepth: settings.thinkingDepth })}</strong>
                    </div>
                    <button type="button" onClick={() => { sound.play("click"); setScreen("config"); }} aria-label={t("nav.config")}><Settings2 size={15} /></button>
                  </section>
                )}

                <section className={`log-section${logOpen ? " inspector-section--docked" : ""}`}>
                  <div className="section-label-row">
                    <span className="section-label">{t("rail.matchLog")}</span>
                    {logOpen ? (
                      <button className="quiet-icon-button" type="button" onClick={() => { sound.play("click"); setLogOpen(false); }} aria-label={t("common.close")}><X size={14} /></button>
                    ) : (
                      <>
                        <span className="log-live"><span /> {t("rail.live")}</span>
                        <button type="button" className="filter-chip log-full-button" onClick={() => { sound.play("click"); setSelected(null); setPick(null); setLogOpen(true); }}>{t("log.full")}</button>
                      </>
                    )}
                  </div>
                  {logOpen ? (
                    <>
                      <div className="filter-chips" role="group" aria-label={t("log.filterSide")}>
                        {(["all", "you", "warden"] as const).map((id) => (
                          <button key={id} type="button" className={`filter-chip${logSide === id ? " is-active" : ""}`} aria-pressed={logSide === id} onClick={() => setLogSide(id)}>
                            {id === "all" ? t("log.all") : localizeName(game.players[id === "you" ? 0 : 1].name, t)}
                          </button>
                        ))}
                      </div>
                      <div className="filter-chips" role="group" aria-label={t("log.filterType")}>
                        {(["all", "play", "fight", "reap", "use", "forge"] as const).map((id) => (
                          <button key={id} type="button" className={`filter-chip${logType === id ? " is-active" : ""}`} aria-pressed={logType === id} onClick={() => setLogType(id)}>
                            {id === "all" ? t("log.all") : t(`log.type.${id}`)}
                          </button>
                        ))}
                      </div>
                      <div className="log-groups">
                        {logRounds.map((group) => (
                          <div key={group.turn}>
                            <span className="section-label">{t("game.round")} {String(group.turn).padStart(2, "0")}</span>
                            <div className="match-log">
                              {group.entries.map((entry, index) => (
                                <div className={`log-entry${index === 0 ? " log-entry--latest" : ""}`} key={`${entry.key}-${index}`}>
                                  <span className="log-marker" />
                                  <p>{renderLog(entry, t)}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                        {!logRounds.length && (
                          <div className="log-entry"><span className="log-marker" /><p>{t("log.empty")}</p></div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="match-log">
                      {game.log.slice(-5).reverse().map((entry, index) => (
                        <div className={`log-entry${index === 0 ? " log-entry--latest" : ""}`} key={`${entry.key}-${index}-${game.log.length}`}>
                          <span className="log-marker" />
                          <p>{renderLog(entry, t)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <details className="quick-rules">
                  <summary><span><CircleHelp size={15} /> {t("rail.quickRules")}</span><ChevronRight size={14} className="rules-chevron" /></summary>
                  <div className="rules-copy">
                    <p>{t("rail.rule1")}</p>
                    <p>{t("rail.rule2")}</p>
                    <p>{t("rail.rule3", { cost: keyCost(game, humanSide) })}</p>
                  </div>
                </details>

                <div className="rail-footer">
                  <a href="https://www.keyforgegame.com" target="_blank" rel="noreferrer">
                    <span>{t("rail.dataBy")}</span><ExternalLink size={11} />
                  </a>
                  <span className="offline-ready"><span /> {t("rail.offlineReady")}</span>
                </div>
              </aside>
            </div>
          </div>
        )}

        {/* FEAT-12b: read-only replay of the match, state by state. */}
        {replay && (
          <div className="replay-overlay" ref={replayRef} role="dialog" aria-modal="true" aria-label={t("game.replay")}>
            <GameBoard
              game={replay.states[replay.index]}
              selected={null}
              pick={null}
              aiThinking={false}
              settings={settings}
              t={t}
              forgeFlash={false}
              replay
              onHouse={NOOP}
              onSelectHand={NOOP}
              onSelectBoard={NOOP}
              onEndTurn={NOOP}
              onRematch={NOOP}
              onHome={NOOP}
              onKeepHand={NOOP}
              onMulligan={NOOP}
            />
            <div className="replay-controls">
              <button
                type="button"
                className="ghost-button"
                aria-label={t("game.replayPrev")}
                disabled={replay.index === 0}
                onClick={() => setReplay({ states: replay.states, index: replay.index - 1 })}
              >
                <ArrowLeft size={15} />
              </button>
              <span className="replay-step">{t("game.replayStep", { step: replay.index, total: replay.states.length - 1 })}</span>
              <button
                type="button"
                className="ghost-button"
                aria-label={t("game.replayNext")}
                disabled={replay.index >= replay.states.length - 1}
                onClick={() => setReplay({ states: replay.states, index: replay.index + 1 })}
              >
                <ArrowRight size={15} />
              </button>
              <button type="button" className="ghost-button" onClick={() => { sound.play("click"); setReplay(null); }}>
                <X size={15} /> {t("game.replayExit")}
              </button>
            </div>
          </div>
        )}
        </ErrorBoundary>
      </main>

      <nav className="mobile-tabs" aria-label={t("nav.screens")}>
        <button type="button" className={`mobile-tab${screen === "home" || screen === "inspect" ? " is-active" : ""}`} onClick={() => { sound.play("click"); setScreen("home"); }}>
          <Home size={17} /><span>{t("nav.home")}</span>
        </button>
        <button type="button" className={`mobile-tab${screen === "browse" ? " is-active" : ""}`} onClick={() => { sound.play("click"); setScreen("browse"); }}>
          <BookOpen size={17} /><span>{t("nav.browse")}</span>
        </button>
        <button type="button" className={`mobile-tab${screen === "config" ? " is-active" : ""}`} onClick={() => { sound.play("click"); setScreen("config"); }}>
          <Settings2 size={17} /><span>{t("nav.config")}</span>
        </button>
        <button type="button" className={`mobile-tab${screen === "game" ? " is-active" : ""}`} onClick={() => { sound.play("click"); if (game) setScreen("game"); }} disabled={!game}>
          <Swords size={17} /><span>{t("nav.play")}</span>
        </button>
      </nav>

      {deckToRemove && (
        <ConfirmDialog
          title={t("deck.removeTitle")}
          body={t("deck.removeBody", { name: deckToRemove.name })}
          confirmLabel={t("deck.removeConfirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={removeDeck}
          onCancel={() => setDeckToRemove(null)}
        />
      )}

      {pendingDeck && (
        <ConfirmDialog
          title={t("abandon.title")}
          body={t("abandon.body")}
          confirmLabel={t("abandon.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            const pending = pendingDeck;
            setPendingDeck(null);
            launchMatch(pending.deck, pending.opponent, pending.mode);
          }}
          onCancel={() => setPendingDeck(null)}
        />
      )}

      {/* Never over a match: only Home and Settings open it. */}
      {tutorialOpen && (screen === "home" || screen === "config") && (
        <TutorialWizard
          t={t}
          houses={selectedDeck.houses}
          hintsToggle={<Toggle checked={settings.hints} label={t("config.experience.hints")} onChange={(value) => { if (value) sound.play("sparkle"); setSettings({ ...settings, hints: value }); }} />}
          onOpenVault={() => { markTutorialSeen(); setTutorialOpen(false); setScreen("browse"); }}
          onClose={() => { markTutorialSeen(); setTutorialOpen(false); }}
        />
      )}

      {deckModalOpen && (
        <DeckModal
          currentDeck={selectedDeck}
          deckInput={deckInput}
          setDeckInput={setDeckInput}
          candidate={deckCandidate}
          loading={deckLoading}
          error={deckError}
          fromCache={deckFromCache}
          t={t}
          onFetch={(event) => void fetchDeck(event)}
          onUseDeck={useCandidateDeck}
          onClose={() => setDeckModalOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
