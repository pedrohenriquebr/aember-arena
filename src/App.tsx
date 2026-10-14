import { createPortal } from "react-dom";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  Anchor,
  Archive,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Box,
  PanelRight,
  Check,
  ChevronRight,
  CircleHelp,
  Crosshair,
  Clock3,
  Copy,
  Cpu,
  Crown,
  ExternalLink,
  Eye,
  EyeOff,
  Gem,
  Home,
  KeyRound,
  Languages,
  Layers,
  Link2,
  LoaderCircle,
  Menu,
  Music,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Settings2,
  Shield,
  Sword,
  Swords,
  Volume2,
  VolumeX,
  Hand,
  Trash2,
  Wand2,
  Wifi,
  WifiOff,
  X,
  Zap,
  ZapOff,
  ZoomIn,
} from "lucide-react";
import { chooseAiHouse, chooseAiMove, describeAiThinking, holdEntrench, shouldMulligan, shouldTakeArchives, type Difficulty } from "./lib/ai";
import { vendoredOverrides } from "./lib/vendored";
import { flushAbilityOverrides, holdAbilityOverrides, mergeAbilityOverrides, rulesOf } from "./lib/abilities";
import { cacheDeck, clearSavedMatch, countCatalogCards, deleteDeck, getCachedDeck, getDeckStats, listCatalogCards, listCachedDecks, loadAbilityOverrides, loadSavedMatch, putAbilityOverride, recordMatchResult, saveMatch, setDeckFavorite, type DeckStats, type LibraryDeck, type SavedMatch } from "./lib/cache";
import { LLM_RUN_LIMIT, pendingTranslations, runTranslation, translationTries, type RunProgress } from "./lib/catalogLlm";
import { DEMO_DECK, DEMO_DECK_ID } from "./lib/demoDeck";
import { DEMO_DECK_2 } from "./lib/demoDeck2";
import {
  applyMove,
  chooseHouse,
  createMatch,
  createPassAndPlayMatch,
  deckFromState,
  displayType,
  isCreatureCard,
  endTurn,
  fightTargets,
  getLegalMoves,
  houseChoices,
  pendingPrompt,
  houseOf,
  playPermission,
  housesFor,
  isLegalMove,
  keepHand,
  keyCost,
  keyword,
  mulligan,
  revealsHiddenInfo,
  setHold,
  targetChoices,
  type CardInstance,
  type DeckInfo,
  type GameMove,
  type GameState,
  type LogEntry,
  refreshGameFaces,
} from "./lib/game";
import { partitionLane } from "./lib/laneLayout";
import { fetchKeyforgeDeck, loadDeckOrCache, syncCatalog, vaultErrorText, type CatalogProgress } from "./lib/keyforgeApi";
import { createTranslator, LANGUAGES, readLanguage, saveLanguage, type Language, type Translator,
  cardTypeLabel,} from "./lib/i18n";
import { canOpenPile, sortPile, type PileKind } from "./lib/piles";
import { aiHoldScale, AI_DELAY_MAX, AI_DELAY_MIN, clampAiDelay, drawDeck, llmReady, readLlmConfig, readSettings, saveLlmConfig, saveSettings, type AppSettings, type LlmConfig, type GameMode, type OpponentMode } from "./lib/settings";
import { sound } from "./lib/sound";
import { cardJitter, diffFx, motionEnabled, type FxDirector, type FxPlan } from "./lib/fx";
import { CardArt, CardLightbox, houseColor, houseLabel } from "./components/CardArt";
import { CoverageBadge, DeckCoverageChip } from "./components/CoverageBadge";
import { DeckTile, HouseMark } from "./components/DeckTile";
import { LlmSettings } from "./components/LlmSettings";
import { HouseIcon } from "./components/HouseIcon";
import { DeckBrowser, type BrowseState } from "./components/DeckBrowser";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DeckInspector } from "./components/DeckInspector";
import { FxLayer, captureFx, captureGone, captureLunge } from "./components/FxLayer";
import { Pagination } from "./components/Pagination";
import { useHandDrag } from "./components/useHandDrag";
import { useDialogFocus } from "./components/useDialogFocus";
import { isFirstVisit, markTutorialSeen, TutorialWizard } from "./components/TutorialWizard";
import { readUiFlag } from "./ui/flag";
import { LobbyScreen } from "./ui/screens/lobby/LobbyScreen";
import { ResultScreen } from "./ui/screens/result/ResultScreen";
import { OnboardingFlow } from "./ui/screens/onboarding/OnboardingFlow";
import { clearOnboarding, saveOnboardingStep, startOnboarding, type OnboardingStep } from "./ui/lib/onboarding";
import { advanceCoach, readCoach, skipCoach, writeCoach, type CoachSnapshot, type CoachStep } from "./ui/lib/coach";
import { Coachmark } from "./ui/shell/Coachmark";
import { LibraryScreen, type LibraryTab } from "./ui/screens/library/LibraryScreen";
import { ImportSheet } from "./ui/screens/import/ImportSheet";
import { DeckDetail } from "./ui/screens/deck/DeckDetail";
import type { LibrarySort } from "./ui/lib/library";
import { resumeInfoOf } from "./ui/lib/resume";
import { resolvePassDecks } from "./ui/lib/passDecks";
import { presetOf, applyPreset } from "./ui/lib/presets";
import { MatchSheet } from "./ui/screens/MatchSheet";
import { KitScreen } from "./ui/screens/KitScreen";
import { LobbyShell } from "./ui/shell/LobbyShell";
import { TableMenu } from "./ui/shell/TableMenu";
import { ZonesSheet } from "./ui/screens/zones/ZonesSheet";
import { destinationOf } from "./ui/shell/shellNav";
import { SettingsScreen } from "./ui/screens/settings/SettingsScreen";

const RANDOM_RIVAL_KEY = "aember-arena-random-rival";

function readRandomRivalId(): string | undefined {
  try {
    return localStorage.getItem(RANDOM_RIVAL_KEY) || undefined;
  } catch {
    return undefined;
  }
}

function writeRandomRivalId(id: string | undefined): void {
  try {
    if (id) localStorage.setItem(RANDOM_RIVAL_KEY, id);
    else localStorage.removeItem(RANDOM_RIVAL_KEY);
  } catch {
    // O sorteio só deixa de sobreviver ao reload; a partida segue jogável.
  }
}

// "settings" é a rota da v2 para Ajustes (H-07); renderiza a mesma ConfigScreen de "config".
type Screen = "home" | "config" | "settings" | "game" | "browse" | "inspect";
type Selection = { zone: "hand" | "board" | "enemy"; playerIndex: 0 | 1; instanceId: string };
/** Board pick in progress: a fight defender (`targetId` still empty) or the
    target of the move's ability / an upgrade's host. `ids` are the legal cards. */
type Pick = {
  move: GameMove;
  ids: string[];
  /** The move's card asks "Choose a house" (Lote 5 §5.1): the picker offers these first. */
  houses?: string[];
  /** Lote 7 §7.1: a later question of the move — a second card, 0..max cards, or a flank. */
  kind?: "target2" | "targets" | "flank" | "mode";
  chosen?: string[];
  max?: number;
  /** Lote 8: a "mode" question offers two zones (own/opponent's) or the two printed options. */
  modeChoice?: "side" | "option";
};
type Toast = {
  message: string;
  kind: "success" | "error";
  /** FEAT-09: botão único do toast (ex.: "Recarregar" na atualização do PWA). */
  action?: { label: string; onClick: () => void };
  /** Sem auto-dismiss: o aviso de atualização fica até o jogador agir. */
  sticky?: boolean;
  /** BUG2-13: efeito lateral do X (ex.: dispensar o aviso de atualização de vez). */
  onDismiss?: () => void;
} | null;

/** FEAT-12a: one step of the undo history — the state a transition left behind,
    whether that transition consumed hidden information, how many replay
    steps were recorded while that state was live, and the deck that was live
    with it (BUG2-10: o Sync troca as faces e o undo precisa devolver o deck). */
type UndoEntry = { state: GameState; revealed: boolean; step: number; deck: DeckInfo };

/** BUG2-11: setup congelado no início da partida — o W/L grava a dificuldade e
    o modo de oponente que valeram, não os que estiverem nas settings ao fim. */
type MatchSetup = { difficulty: Difficulty; opponentMode: OpponentMode };

/** FEAT-12b: one recorded transition of the match. The seed plus this list
    rebuilds every state of the match (createMatch + applyStep), which is what
    the replay viewer walks — the live match is never touched. BUG2-10: o Sync
    na mesa também vira passo; o replay posterior é PARCIAL — a reconstrução
    usa o currentDeck já sincronizado desde o turno 1, então os passos
    anteriores rodam com as faces novas (só a entrada do log é reproduzida). */
type ReplayStep =
  | { kind: "house"; side: 0 | 1; house: string }
  | { kind: "keep" | "mulligan"; side: 0 | 1 }
  | { kind: "end"; side: 0 | 1 }
  | { kind: "move"; side: 0 | 1; move: GameMove }
  | { kind: "sync"; deck: string };

function applyStep(state: GameState, step: ReplayStep): GameState {
  if (step.kind === "house") return chooseHouse(state, step.side, step.house);
  if (step.kind === "move") return applyMove(state, step.side, step.move);
  if (step.kind === "end") return endTurn(state, step.side);
  if (step.kind === "sync") return { ...state, log: [...state.log, { key: "log.synced", params: { deck: step.deck }, turn: state.turn }] };
  return step.kind === "mulligan" ? mulligan(state, step.side) : keepHand(state, step.side);
}

/** Read-only GameBoard callbacks for the replay viewer. */
const NOOP = () => undefined;

const DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard", "Very hard", "Impossible"];
const STARTER_DECKS: DeckInfo[] = [DEMO_DECK, DEMO_DECK_2];
// UX_REWRITE_PLAN §5 H-12: os iniciais não ganham etiqueta de "salvo" nem remover (mesmo critério da Home v1).
const STARTER_IDS: ReadonlySet<string> = new Set(STARTER_DECKS.map((deck) => deck.id));
/** FEAT-12a: how many past states the undo history keeps (memory cap). */
const UNDO_LIMIT = 40;

// ---------- Ritmo do turno da IA (onda 2, plano §3) ----------
// PRE = destaque antes de resolver; os totais caem na janela 700-900ms pedida
// pelo UX review (#1) somando PRE + FX (voo/animação) + GAP.
/** Abertura: a dificuldade define quanto o Warden "pensa" antes de agir. */
const aiThinkMs = (difficulty: Difficulty) => 250 + DIFFICULTIES.indexOf(difficulty) * 100;
const AI_PRE: Record<GameMove["type"], number> = { play: 120, fight: 260, reap: 200, use: 200, unstun: 160, discard: 80, takeArchives: 120 };
const AI_HOUSE_MS = 450;
/** FIT-08: 400ms ≈ PRE médio (180) + GAP (220) de antes; k escala só as pausas. */
const delayK = (delayMs: number) => delayMs / 400;
const delaySeconds = (delayMs: number, language: string) =>
  (delayMs / 1000).toLocaleString(language === "ptBR" ? "pt-BR" : "en", { maximumFractionDigits: 1 });
/** Pausa que substitui o voo quando as animações estão desligadas. */
const AI_HOLD = 520;
const AI_GAP = 220;
const AI_END_MS = 300;

// T5: hover só existe quando o dispositivo anuncia "(hover: hover)"; em touch o
// toggle hoverZoom some e a inspeção vai por long-press (CardLightbox).
function prefersHover() {
  return typeof window !== "undefined" && window.matchMedia?.("(hover: hover)")?.matches === true;
}

/** FIT-02: perfil compacto do palco (celular ou altura < 760px) — sem faixa de
    título; o atalho da visão da mesa muda para o turn-console. Espelha os @media
    dos tokens de altura no index.css. */
const COMPACT_STAGE = "(max-width: 700px), (max-height: 759px)";
function useMedia(media: string) {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia?.(media);
      query?.addEventListener("change", notify);
      return () => query?.removeEventListener("change", notify);
    },
    () => window.matchMedia?.(media)?.matches === true,
    () => false,
  );
}

const useCompactStage = () => useMedia(COMPACT_STAGE);

/** H3D-09 (VIEW3D_PLAN §3): hardware fraco (<= 2 núcleos) troca o 3D real pelo
    perfil 2.5D — a mesa inclinada vira só cenário e as cartas ficam planas. Sem
    UA sniffing; a detecção é uma só, no primeiro import. */
const LITE_TABLE = typeof navigator !== "undefined" && (navigator.hardwareConcurrency || 8) <= 2;

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
  /** QA 07/out: a carta é alvo legal da seleção em curso (anel + tooltip + clique
      que escolhe o alvo, nunca o inspetor). */
  targetable?: boolean;
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
      (a.hold ?? false) === (b.hold ?? false) &&
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
    a.targetable === b.targetable &&
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
  targetable = false,
  t,
  onClick,
}: CardTileProps) {
  const { face } = card;
  // T8: casa e tipo do aria-label passam por t() (houseLabel aceita tradutor opcional).
  const baseLabel = `${face.title}, ${houseLabel(face.house, t)} ${cardTypeLabel(face.type, t)}`;
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const longPressAt = useRef(0);
  // QA 07/out: o alvo elegível se anuncia (tooltip + aria) — o clique nele escolhe
  // o alvo, nunca abre o inspetor.
  const targetNote = targetable ? `, ${t("game.chooseAsTarget")}` : "";
  return (
    <>
      <button
        className={`card-tile card-tile--${size}${selected ? " is-selected" : ""}${dimmed ? " is-dimmed" : ""}${playAnim ? " card-tile--enter" : ""}${hinted ? " card-tile--hint" : ""}${targetable ? " is-targetable" : ""}`}
        type="button"
        /* O diretor de FX acha a carta por aqui (destaque imperativo, sem prop). */
        data-iid={card.instanceId}
        title={targetable ? t("game.chooseAsTarget") : undefined}
        onClick={() => {
          // T5: o long-press já abriu a inspeção — o click sintético do toque não seleciona.
          if (Date.now() - longPressAt.current < 700) return;
          onClick?.(card);
        }}
        disabled={disabled || !onClick}
        aria-label={`${stateLabel ? `${baseLabel}, ${stateLabel}` : hinted ? `${baseLabel}, ${t("game.hintPlayable")}` : baseLabel}${targetNote}`}
      >
        <CardArt
          face={face}
          size={size}
          hoverZoom={hoverZoom && !selected}
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
  catalogCount,
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
  /** DB v4: cards in the local catalog (chip, plano §5). */
  catalogCount: number;
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
        {/* Fase D: camadas de profundidade do hero (parallax leve + poeira de
            Æmber). Decorativas e escondidas no reduce-motion — a informação da
            tela não vive aqui. */}
        <div className="home-hero-glow" aria-hidden="true" />
        <div className="home-hero-haze" aria-hidden="true" />
        <div className="home-amber-dust" aria-hidden="true">
          {Array.from({ length: 10 }, (_, index) => (
            <i key={index} />
          ))}
        </div>
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
          <span className="deck-list-meta">
            {/* DB v4 (plano §5): the catalog chip only shows when there is one. */}
            {catalogCount > 0 && <span className="meta-chip">{t("catalog.chip", { count: catalogCount.toLocaleString(t("meta.locale")) })}</span>}
            <span className="deck-list-count">{t("home.deckCount", { count: allDecks.length })}</span>
          </span>
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

// DB v4 (plano §5): o catálogo entra como card do passo Review — um 7º pill no
// stepper não cabe com rótulo no desktop (o container tem ~693px e ficava
// clipado), e o review é onde o setup do catálogo faz sentido.
const MODE_CONFIG_STEPS = ["mode", "difficulty", "opponent", "thinking", "experience", "review"] as const;
// FEAT-13: pass-and-play has no AI, so the difficulty/opponent/thinking steps
// (and their settings) leave the wizard; the decks step takes their place.
const PASS_CONFIG_STEPS = ["mode", "decks", "experience", "review"] as const;
type ConfigStep = (typeof MODE_CONFIG_STEPS)[number] | (typeof PASS_CONFIG_STEPS)[number];
const OPPONENT_MODES = ["mirror", "deck", "random"] as const;

type ReviewSide =
  | { kind: "deck"; key: string; role: string; deck: DeckInfo; badge?: string; note?: string }
  | { kind: "pending"; key: string; role: string; title: string; note: string };

/** Deck order, one group per house. A house missing from `deck.houses` still shows. */
function cardsByHouse(deck: DeckInfo): { house: string; cards: DeckInfo["cards"] }[] {
  const order = deck.houses?.length ? [...deck.houses] : [];
  for (const card of deck.cards) {
    if (!order.includes(card.house)) order.push(card.house);
  }
  return order
    .map((house) => ({ house, cards: deck.cards.filter((card) => card.house === house) }))
    .filter((group) => group.cards.length > 0);
}

/** Inline card list: DeckInspector is its own screen and would drop the wizard step. */
function ReviewHouseList({ deck, t, id }: { deck: DeckInfo; t: Translator; id: string }) {
  const [face, setFace] = useState<DeckInfo["cards"][number] | null>(null);
  const groups = cardsByHouse(deck);
  return (
    <div id={id} className="review-houses" role="region" aria-label={t("config.review.cardsByHouse", { name: deck.name })}>
      {groups.map((group) => (
        <div key={group.house}>
          <div className="review-house-head">
            <span aria-hidden="true"><HouseMark house={group.house} small /></span>
            <span className="review-house-name">{houseLabel(group.house, t)}</span>
            <small>{group.cards.length}</small>
          </div>
          <ul className="review-house-list">
            {group.cards.map((card, index) => (
              <li key={`${card.id}-${index}`}>
                <button
                  type="button"
                  className="review-card-row"
                  onClick={() => { sound.play("select"); setFace(card); }}
                  aria-label={`${card.title}, ${houseLabel(card.house, t)}, ${cardTypeLabel(card.type, t)}`}
                >
                  <strong>{card.title}</strong>
                  <small>{cardTypeLabel(card.type, t)}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <CardLightbox face={face} t={t} onClose={() => setFace(null)} />
    </div>
  );
}

function ReviewMatchDecks({ single, sides, t }: { single: boolean; sides: ReviewSide[]; t: Translator }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const toggle = (key: string) => {
    sound.play("click");
    setOpenKey((current) => (current === key ? null : key));
  };
  return (
    <section className="review-card review-card--deck" aria-labelledby="review-decks-heading">
      <h3 className="review-label" id="review-decks-heading">{t("config.review.decks")}</h3>
      <div className={`review-sides${single ? " review-sides--single" : ""}`}>
        {sides.map((side) => {
          const open = side.kind === "deck" && openKey === side.key;
          const panelId = `review-cards-${side.key}`;
          return (
            <article key={side.key} className={`review-side${side.key === "rival" ? " review-side--rival" : ""}`}>
              <div className="review-side-role">
                <span className="review-label">{side.role}</span>
                {side.kind === "deck" && side.badge && <span className="review-badge">{side.badge}</span>}
              </div>
              {side.kind === "deck" ? (
                <div className="review-deck">
                  {side.deck.cards[0] && <CardArt face={side.deck.cards[0]} size="preview" />}
                  <div>
                    <strong className="review-deck-name">{side.deck.name}</strong>
                    <div className="deck-card-houses">
                      {(side.deck.houses ?? []).map((house) => <HouseMark key={house} house={house} small />)}
                    </div>
                    <small>{side.deck.cards.length} {t("common.cards")}</small>
                    <DeckCoverageChip deck={side.deck} t={t} />
                  </div>
                </div>
              ) : (
                <div className="review-pending">
                  <span className="review-pending-icon" aria-hidden="true">
                    <Copy size={22} />
                  </span>
                  <div>
                    <strong>{side.title}</strong>
                    <p className="review-note">{side.note}</p>
                  </div>
                </div>
              )}
              {side.kind === "deck" && side.note && <p className="review-note">{side.note}</p>}
              {side.kind === "deck" && (
                <button
                  type="button"
                  className="ghost-button"
                  aria-expanded={open}
                  aria-controls={panelId}
                  aria-label={t(open ? "config.review.hideAria" : "config.review.inspectAria", { name: side.deck.name })}
                  onClick={() => toggle(side.key)}
                >
                  <Eye size={15} /> {open ? t("config.review.hide") : t("config.review.inspect")}
                </button>
              )}
              {open && side.kind === "deck" && <ReviewHouseList id={panelId} deck={side.deck} t={t} />}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function buildReviewSides(
  t: Translator,
  settings: AppSettings,
  deck: DeckInfo,
  pickedOpponent: DeckInfo | undefined,
  randomRival: DeckInfo | undefined,
  p1Deck: DeckInfo,
  p2Deck: DeckInfo,
): { single: boolean; sides: ReviewSide[] } {
  if (settings.gameMode === "passAndPlay") {
    return {
      single: false,
      sides: [
        { kind: "deck", key: "p1", role: t("game.player1"), deck: p1Deck },
        { kind: "deck", key: "p2", role: t("game.player2"), deck: p2Deck },
      ],
    };
  }
  const you: ReviewSide = { kind: "deck", key: "you", role: t("common.you"), deck };
  if (settings.opponentMode === "mirror") {
    return {
      single: true,
      sides: [{ kind: "deck", key: "you", role: t("config.review.sharedRole"), deck, badge: t("config.review.mirrorBadge"), note: t("config.review.mirrorNote") }],
    };
  }
  // O sorteio já aconteceu (App): a revisão mostra o MESMO baralho que a partida vai usar.
  if (settings.opponentMode === "random" && randomRival) {
    return {
      single: false,
      sides: [
        you,
        { kind: "deck", key: "rival", role: t("log.warden"), deck: randomRival, badge: t("config.review.randomBadge"), note: t("config.review.randomNote") },
      ],
    };
  }
  if (settings.opponentMode === "deck" && pickedOpponent) {
    return {
      single: false,
      sides: [
        you,
        { kind: "deck", key: "rival", role: t("log.warden"), deck: pickedOpponent },
      ],
    };
  }
  return {
    single: false,
    sides: [
      you,
      {
        kind: "pending",
        key: "rival",
        role: t("log.warden"),
        title: t("config.review.mirrorBadge"),
        note: t("config.opponent.none"),
      },
    ],
  };
}

function ConfigScreen({
  t,
  settings,
  deck,
  savedDecks,
  randomRival,
  hasHover,
  catalogCount,
  catalogSync,
  onSyncCatalog,
  onCancelCatalog,
  llm,
  onLlmChange,
  llmRun,
  onLlmTranslate,
  onLlmTranslateDeck,
  onLlmCancel,
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
  /** Modo aleatório: o baralho já sorteado para o Warden (dono: App). */
  randomRival: DeckInfo | undefined;
  /** T5 — sem "(hover: hover)" o toggle hoverZoom não faz sentido e some. */
  hasHover: boolean;
  /** DB v4: catálogo em disco + sync em curso (n/total) para o passo Catálogo. */
  catalogCount: number;
  catalogSync: CatalogProgress | null;
  onSyncCatalog: () => void;
  onCancelCatalog: () => void;
  /** BYOK do pipeline de abilities (settings.readLlmConfig). */
  llm: LlmConfig;
  onLlmChange: (next: LlmConfig) => void;
  /** Onda 2: rodada de tradução em andamento (dona: App) + disparo/cancelar. */
  llmRun: RunProgress | null;
  onLlmTranslate: () => void;
  onLlmTranslateDeck: (faces: DeckInfo["cards"]) => void;
  onLlmCancel: () => void;
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
  // FEAT-13: the two human decks (never the same one twice).
  const [p1Deck, p2Deck] = resolvePassDecks(savedDecks, deck, settings);
  const review = buildReviewSides(t, settings, deck, pickedOpponent, randomRival, p1Deck, p2Deck);
  const p2Choices = savedDecks.filter((item) => item.id !== p1Deck.id);
  // União dos decks da partida (sem duplicar cartas); "random" entra com o baralho já sorteado.
  const matchDecks = settings.gameMode === "passAndPlay" ? [p1Deck, p2Deck] : settings.opponentMode === "mirror" ? [deck] : settings.opponentMode === "random" ? [deck, randomRival ?? deck] : [deck, pickedOpponent ?? deck];
  const matchFaces = [...new Map(matchDecks.flatMap((item) => item.cards).map((face) => [face.id, face])).values()];

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
              <div className="filter-chips chips-offset" role="group" aria-label={t("config.opponent.pick")}>
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
            <div className="deck-pick">
              <span className="section-label">{t("config.decks.p1")}</span>
              <div className="filter-chips" role="group" aria-label={t("config.decks.p1")}>
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
            <div className="deck-pick">
              <span className="section-label">{t("config.decks.p2")}</span>
              <div className="filter-chips" role="group" aria-label={t("config.decks.p2")}>
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
              {/* H3D-01: a visão da mesa (2D padrão / 3D) mora junto do movimento. */}
              <div className="exp-row">
                <span className="exp-icon"><Box size={16} /></span>
                <div className="exp-copy"><strong>{t("config.experience.view3d")}</strong><small>{t("config.experience.view3dSub")}</small></div>
                <Toggle checked={settings.tableView === "3d"} label={t("config.experience.view3d")} onChange={(value) => onChange({ ...settings, tableView: value ? "3d" : "2d" })} />
              </div>
              {settings.gameMode === "solo" && (
                <div className="exp-row">
                  <span className="exp-icon"><Clock3 size={16} /></span>
                  <div className="exp-copy"><strong>{t("config.experience.speed")}</strong><small>{t("config.experience.speedSub")}</small></div>
                  <div className="speed-control">
                    <input
                      type="range"
                      min={AI_DELAY_MIN}
                      max={AI_DELAY_MAX}
                      step={100}
                      value={settings.aiDelayMs}
                      aria-label={t("config.experience.speed")}
                      aria-valuetext={t("config.speed.value", { s: delaySeconds(settings.aiDelayMs, settings.language) })}
                      onChange={(event) => onChange({ ...settings, aiDelayMs: clampAiDelay(Number(event.target.value)) })}
                    />
                    <output>{t("config.speed.value", { s: delaySeconds(settings.aiDelayMs, settings.language) })}</output>
                    <div className="filter-chips" role="group" aria-label={t("config.experience.speed")}>
                      {([["fast", 400], ["normal", 1200], ["slow", 2400]] as const).map(([id, ms]) => (
                        <button
                          key={id}
                          type="button"
                          className={`filter-chip${settings.aiDelayMs === ms ? " is-active" : ""}`}
                          aria-pressed={settings.aiDelayMs === ms}
                          onClick={() => onChange({ ...settings, aiDelayMs: ms })}
                        >
                          {t(`config.speed.${id}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
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
              <ReviewMatchDecks single={review.single} sides={review.sides} t={t} />
              <div className="review-card review-card--wide">
                <div className="review-translate">
                  <div>
                    <span className="review-label">{t("config.review.translateDecks")}</span>
                    <small>{t("config.review.translateDecksHint")}</small>
                  </div>
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={!!llmRun || !llmReady(llm)}
                    aria-label={llmRun ? `${t("config.review.translateDecks")} ${llmRun.done}/${llmRun.total}` : t("config.review.translateDecks")}
                    onClick={() => onLlmTranslateDeck(matchFaces)}
                  >
                    {llmRun ? `${llmRun.done}/${llmRun.total}` : t("config.review.translateAction")}
                  </button>
                </div>
              </div>
              {settings.gameMode === "solo" && (
                <div className="review-card">
                  <span className="review-label">{t("config.review.opponent")}</span>
                  <ul className="review-list">
                    <li><span>{t("config.step.difficulty")}</span><strong>{t(`difficulty.${settings.difficulty}`)}</strong></li>
                    <li><span>{t("config.step.thinking")}</span><strong>{settings.thinkingDepth} / 6</strong></li>
                  </ul>
                </div>
              )}
              <div className="review-card">
                <span className="review-label">{t("config.review.interface")}</span>
                <ul className="review-list">
                  <li><span>{t("config.experience.sfx")}</span><strong>{settings.sfx ? t("config.on") : t("config.off")}</strong></li>
                  <li><span>{t("config.experience.music")}</span><strong>{settings.music ? t("config.on") : t("config.off")}</strong></li>
                  <li><span>{t("config.experience.animations")}</span><strong>{settings.animations ? t("config.on") : t("config.off")}</strong></li>
                  <li><span>{t("config.experience.view3d")}</span><strong>{settings.tableView === "3d" ? t("config.on") : t("config.off")}</strong></li>
                  {hasHover && <li><span>{t("config.experience.zoom")}</span><strong>{settings.hoverZoom ? t("config.on") : t("config.off")}</strong></li>}
                  {settings.gameMode === "solo" && <li><span>{t("config.experience.speed")}</span><strong>{t("config.speed.value", { s: delaySeconds(settings.aiDelayMs, settings.language) })}</strong></li>}
                  <li><span>{t("config.experience.language")}</span><strong>{LANGUAGES.find((l) => l.id === settings.language)?.short}</strong></li>
                </ul>
              </div>
              {/* DB v4 (plano §5): seção Catálogo — chip com o que está em disco,
                  sync incremental (n/total) e cancelamento. */}
              <div className="review-card">
                <span className="review-label">{t("config.catalog.title")}</span>
                <p className="deck-input-hint">{t("config.catalog.hint")}</p>
                <div className="catalog-row">
                  <span className="meta-chip">{t("catalog.chip", { count: catalogCount.toLocaleString(t("meta.locale")) })}</span>
                  <button type="button" className="ghost-button" onClick={onSyncCatalog} disabled={catalogSync !== null}>
                    {catalogSync ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
                    {catalogSync ? t("config.catalog.syncing", { done: catalogSync.done, total: catalogSync.total }) : t("config.catalog.sync")}
                  </button>
                  {catalogSync && (
                    <button type="button" className="ghost-button" onClick={onCancelCatalog}>
                      <X size={15} /> {t("common.cancel")}
                    </button>
                  )}
                </div>
              </div>
              <div className="review-card">
                <span className="review-label">{t("config.llm.title")}</span>
                <LlmSettings config={llm} onChange={onLlmChange} catalogCount={catalogCount} run={llmRun} onTranslate={onLlmTranslate} onCancel={onLlmCancel} t={t} />
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
  /** Onda 2: o Warden está pensando (aria do tag). */
  thinking?: boolean;
  /** Casa escolhida pelo dono do band (selo no placar durante o turno). */
  house?: string | null;
  chains: number;
  /** Lado dono do band: ancora o diretor de FX (âmbar/chaves/avatar). */
  side: 0 | 1;
  /** FEAT-13: pass-and-play avatars show the player number instead of "You". */
  avatarLabel?: string;
  /** FIT-04: a barra do jogador absorve o título da mão (contagens + dica). */
  handCount?: number;
  deckCount?: number;
  hint?: boolean;
  /** H3D-19: cartas na mão do oponente (pública no KeyForge) — dorsos no band do 3D. */
  backs?: number;
  /** Zonas laterais: contagens vivas das pilhas (chips dentro da banda — FIT). */
  discardCount: number;
  archiveCount: number;
  /** Lado do espectador (dono do device): decide quem abre o arquivo (virado). */
  viewerSide: 0 | 1;
  onOpenPile: (kind: PileKind, side: 0 | 1) => void;
  t: Translator;
};

// T7d: mesmo racional do CardTile — o objeto `player` muda de identidade a cada
// move (cloneGame); comparar os campos renderizados deixa o band de fora dos
// commits em que o placar do dono não mudou.
function arePlayerBandPropsEqual(a: PlayerBandProps, b: PlayerBandProps): boolean {
  return (
    a.isAi === b.isAi &&
    a.active === b.active &&
    a.side === b.side &&
    (a.thinking ?? false) === (b.thinking ?? false) &&
    (a.house ?? "") === (b.house ?? "") &&
    (a.avatarLabel ?? "") === (b.avatarLabel ?? "") &&
    a.handCount === b.handCount &&
    a.backs === b.backs &&
    a.deckCount === b.deckCount &&
    (a.hint ?? false) === (b.hint ?? false) &&
    a.discardCount === b.discardCount &&
    a.archiveCount === b.archiveCount &&
    a.viewerSide === b.viewerSide &&
    a.onOpenPile === b.onOpenPile &&
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
  house,
  chains,
  side,
  avatarLabel,
  handCount,
  deckCount,
  hint = false,
  backs,
  discardCount,
  archiveCount,
  viewerSide,
  onOpenPile,
  t,
}: PlayerBandProps) {
  const ownerName = localizeName(player.name, t);
  // Regras oficiais: descarte é público (abre nos dois lados); arquivo é virado —
  // só o dono abre o seu, o do oponente mostra só a contagem (sem ação).
  const ownArchive = canOpenPile("archives", side, viewerSide);
  return (
    <div className={`player-band${active ? " player-band--active" : ""}${isAi ? " player-band--ai" : ""}${thinking ? " player-band--thinking" : ""}`} data-side={side}>
      <div className={`player-avatar${isAi ? " player-avatar--ai" : ""}`}>
        {isAi ? <Cpu size={18} strokeWidth={1.6} /> : <span>{avatarLabel ?? t("common.you")}</span>}
        {active && <span className="avatar-live-dot" />}
      </div>
      {/* H3D-19: dorsos da mão do oponente — `display: none` fora do 3D >= 701px. */}
      {backs !== undefined && (
        <span className="hand-backs" role="img" aria-label={t("game.opponentHand", { count: backs })}>
          {Array.from({ length: Math.min(backs, 7) }, (_, i) => <i key={i} />)}
          {backs > 7 && <b>+{backs - 7}</b>}
        </span>
      )}
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
        {house && (
          <span className="filter-chip">
            <HouseMark house={house} small />{houseLabel(house, t)}
          </span>
        )}
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
      {/* Zonas laterais (FIT: os chips moram DENTRO da banda — nenhum pixel de
          altura nova). Descarte é público e abre nos dois lados; arquivo é virado:
          só o dono abre o seu, o do oponente mostra só a contagem (sem ação). */}
      <div className="pile-chips" role="group" aria-label={t("game.piles")}>
        <button
          type="button"
          className="pile-chip"
          data-pile="discard"
          data-side={side}
          onClick={() => onOpenPile("discard", side)}
          aria-haspopup="dialog"
          aria-label={side === viewerSide ? t("game.pileDiscardAriaYou", { count: discardCount }) : t("game.pileDiscardAria", { name: ownerName, count: discardCount })}
          title={side === viewerSide ? t("game.pileDiscardAriaYou", { count: discardCount }) : t("game.pileDiscardAria", { name: ownerName, count: discardCount })}
        >
          <Layers size={20} strokeWidth={2} />
          <b>{discardCount}</b>
          <span className="pile-chip-label">{t("game.pileDiscard")}</span>
        </button>
        {ownArchive ? (
          <button
            type="button"
            className="pile-chip"
            data-pile="archive"
            data-side={side}
            onClick={() => onOpenPile("archives", side)}
            aria-haspopup="dialog"
            aria-label={t("game.pileArchiveAria", { count: archiveCount })}
            title={t("game.pileArchiveAria", { count: archiveCount })}
          >
            <Archive size={20} strokeWidth={2} />
            <b>{archiveCount}</b>
            <span className="pile-chip-label">{t("game.pileArchive")}</span>
          </button>
        ) : (
          <span
            className="pile-chip pile-chip--hidden"
            data-pile="archive"
            data-side={side}
            role="img"
            aria-label={t("game.pileArchiveHiddenAria", { name: ownerName, count: archiveCount })}
            title={t("game.pileArchiveHidden")}
          >
            <EyeOff size={20} strokeWidth={2} />
            <b>{archiveCount}</b>
            <span className="pile-chip-label">{t("game.pileArchive")}</span>
          </span>
        )}
      </div>
      {handCount !== undefined && (
        <div className="hand-bar-info">
          <span className="hand-title">{t("game.yourHand")}</span>
          <span className="hand-count">{handCount} {t("common.cards").toUpperCase()}</span>
          {hint ? (
            <span className="hand-prompt"><Zap size={13} /><span>{t("game.unlockHint")}</span></span>
          ) : (
            <span className="deck-count">{deckCount} {t("game.inDeck")}</span>
          )}
        </div>
      )}
    </div>
  );
}, arePlayerBandPropsEqual);

type BoardLaneProps = {
  cards: CardInstance[];
  /** Board da lane oposta: upgrades cruzados (QA-02) vivem lá e se desenham aqui. */
  otherCards: CardInstance[];
  owner: 0 | 1;
  /** FEAT-13: the lane owner whose pieces may look usable right now. */
  humanSide: 0 | 1;
  activeHouse: string | null;
  /** "|id|id|" of the cards whose effective house (houseOf, "all" included) is the active one. */
  houseKey?: string;
  selectedId?: string;
  /** FEAT-04: ids com movimento legal (só a lane do jogador). */
  hintIds?: Set<string> | null;
  /** Cards that may be picked right now (fight defender, ability target, upgrade host). */
  targetIds?: string[];
  settings: AppSettings;
  t: Translator;
  /** UX_REWRITE_PLAN §5 H-27: estado vazio da fileira com a hierarquia da v2. */
  ui2?: boolean;
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
    a.houseKey !== b.houseKey ||
    a.selectedId !== b.selectedId ||
    a.targetIds !== b.targetIds ||
    a.hintIds !== b.hintIds ||
    a.settings !== b.settings ||
    a.t !== b.t ||
    a.ui2 !== b.ui2 ||
    a.onSelect !== b.onSelect
  ) {
    return false;
  }
  return sameCards(a.cards, b.cards) && sameCards(a.otherCards, b.otherCards);
}

function sameCards(a: CardInstance[], b: CardInstance[]): boolean {
  return a === b || (a.length === b.length && a.every((card, index) => sameCardInstance(card, b[index])));
}

// H3D-16: pose orgânica por carta (inerte no 2D); o upgrade usa o id do hospedeiro.
function jitterVars(id: string) {
  const { rot, dy } = cardJitter(id);
  return { "--jr": `${rot}deg`, "--jy": `${dy}px` };
}

// QA 07/out: a linha que diz o que a CASA ESCOLHIDA faz — vive ancorada aos
// emblemas do pill. Só para os efeitos que agem sobre as criaturas dessa casa
// ("Choose a house. Stun each creature of that house."); fora deles o prompt
// genérico basta.
const HOUSE_EFFECT_ACTS: Record<string, string> = {
  stun: "game.houseChoiceEffect.stun",
  exhaust: "game.houseChoiceEffect.exhaust",
  destroy: "game.houseChoiceEffect.destroy",
};

function housePickEffect(move: GameMove, game: GameState, t: Translator): string | undefined {
  const id = "instanceId" in move ? move.instanceId : move.type === "fight" ? move.attackerId : undefined;
  if (!id) return undefined;
  const source = game.players
    .flatMap((player) => [...player.hand, ...player.board, ...player.archives, ...player.discard])
    .find((card) => card.instanceId === id);
  if (!source) return undefined;
  for (const ability of rulesOf(source.face).abilities) {
    for (const act of ability.acts) {
      const selection = "s" in act ? act.s : undefined;
      if (selection && typeof selection === "object" && "each" in selection && selection.each.house === "chosen") {
        const key = HOUSE_EFFECT_ACTS[act.k];
        if (key) return t(key);
      }
    }
  }
  return undefined;
}

const BoardLane = memo(function BoardLane({
  cards,
  otherCards,
  owner,
  humanSide,
  activeHouse,
  houseKey,
  selectedId,
  targetIds,
  hintIds,
  settings,
  t,
  ui2 = false,
  onSelect,
}: BoardLaneProps) {
  // Visual neighbours must equal engine neighbours: creatures render in
  // battleline order, artifacts/upgrades move to their own strip below
  // (BUG-18 — interleaved artificats made "[C1][Artifact][C2]" look
  // non-adjacent when the engine treats them as neighbours).
  // H3D-17: upgrade com hospedeiro visível vira tira presa à criatura (--col/--up);
  // o órfão cai no comportamento de artefato. QA-02: o upgrade jogado no hospedeiro
  // do adversário mora no board de quem jogou, mas aparece na lane do hospedeiro.
  const { creatures, attachments, upgrades, artifacts, hostCol, upgradeRank } = partitionLane(cards, otherCards);
  const perHost = new Map<string, number>();
  for (const card of upgrades) perHost.set(card.attachedTo as string, (perHost.get(card.attachedTo as string) ?? 0) + 1);
  if (!cards.length) {
    return (
      <div className={ui2 ? "empty-battleline nf-empty-line" : "empty-battleline"}>
        <span className="empty-orbit"><Shield size={ui2 ? 20 : 17} strokeWidth={1.3} /></span>
        <span>{t("game.clearLine")}</span>
      </div>
    );
  }

  return (
    <div
      className={`board-lane${targetIds?.length ? " board-lane--targeting" : ""}${upgrades.length ? " board-lane--upgrades" : ""}`}
      /* H3D-04: --n dimensiona as cartas no 3D (clamp da lane sem scroll). O
         comparador do memo já olha `cards`, então a lane re-renderiza quando a
         contagem de criaturas muda (--nc = criaturas + anexos, do palco 2D) — nenhuma prop nova desce para o CardTile. */
      style={{ "--n": Math.max(1, creatures.length), "--nc": Math.max(1, creatures.length + attachments.length), "--na": artifacts.length, "--nu": Math.max(0, ...perHost.values()) } as CSSProperties}
    >
      {creatures.length === 0 && (
        <div className={ui2 ? "empty-battleline nf-empty-line" : "empty-battleline"}>
          <span className="empty-orbit"><Shield size={ui2 ? 20 : 17} strokeWidth={1.3} /></span>
          <span>{t("game.clearLine")}</span>
        </div>
      )}
      {/* H3D-15: --col/--acol posicionam as peças na grade do 3D (criaturas numa
          fileira, artefatos/upgrades na fileira externa); inertes no 2D. */}
      {creatures.map((card, index) => {
        const canUse = owner === humanSide && card.ready && !card.stunned && (!activeHouse || Boolean(houseKey?.includes(`|${card.instanceId}|`)));
        // T4: o estado da peça é indicador visual (borda/opacidade, index.css) +
        // aria-label via t(); não existe mais label de texto sob a carta.
        const stateLabel = card.stunned ? t("game.stunned") : card.ready ? t("game.ready") : t("game.resting");
        const stateClass = card.stunned ? " board-piece--stunned" : card.ready ? "" : " board-piece--resting";
        const hinted = Boolean(hintIds?.has(card.instanceId));
        // Entrench (§4.2): o hold é indicador visual (classe na peça + fita com
        // aria-label) — a escolha em si vive no inspetor.
        const holdClass = card.hold ? " board-piece--hold" : "";
        return (
          <div className={`board-piece${canUse ? " board-piece--ready" : ""}${stateClass}${holdClass}`} key={card.instanceId} style={{ "--col": index + 1, ...jitterVars(card.instanceId) } as CSSProperties}>
            <CardTile
              card={card}
              size="board"
              selected={selectedId === card.instanceId}
              dimmed={targetIds ? !targetIds.includes(card.instanceId) : false}
              hoverZoom={settings.hoverZoom}
              playAnim={settings.animations}
              stateLabel={stateLabel}
              hinted={hinted}
              targetable={Boolean(targetIds?.includes(card.instanceId))}
              t={t}
              damageLabel={card.damage > 0 ? `${card.damage} ${t("game.dmg")}` : undefined}
              onClick={onSelect}
            />
            {/* VA-07: "já usada" precisa de um sinal forte além do escurecimento. */}
            {!card.ready && !card.stunned && (
              <span className="rest-badge" role="img" aria-label={t("game.resting")}>
                <RotateCw size={12} strokeWidth={2.4} />
              </span>
            )}
            {/* QA 07/out: badge de atordoada — sem ele o estado só aparecia na
                borda dessaturada (o 3D/lite mantém a ficha do H3D-18 no ::after). */}
            {card.stunned && (
              <span className="stun-badge" role="img" aria-label={t("game.stunned")}>
                <ZapOff size={13} strokeWidth={2.4} />
              </span>
            )}
            {/* Entrench: fica exausta no próximo ready step (escolha do dono). */}
            {card.hold && (
              <span className="hold-badge" role="img" aria-label={t("game.entrenched")}>
                <Anchor size={12} strokeWidth={2.4} />
              </span>
            )}
            {card.marks && Object.entries(card.marks).map(([name, n]) => (
              <span className="mark-badge" key={name} role="img" aria-label={t("game.mark", { name, n })}>
                {n}
              </span>
            ))}
          </div>
        );
      })}
      {attachments.length > 0 && (
        <div className="board-attachments" role="list" aria-label={t("game.attachments")}>
          {attachments.map((card) => {
            const host = creatures.find((item) => item.instanceId === card.attachedTo);
            const hostTitle = host?.face.title;
            const up = upgradeRank.get(card.instanceId);
            const place = up
              ? ({ "--col": hostCol.get(card.attachedTo as string), "--up": up } as CSSProperties)
              : ({ "--acol": artifacts.indexOf(card) + 1 } as CSSProperties);
            return (
              <div className={`board-piece board-piece--attachment ${up ? "board-piece--upgrade" : "board-piece--artifact"}`} key={card.instanceId} role="listitem" style={{ ...place, ...jitterVars(host?.instanceId ?? card.instanceId) }}>
                <CardTile
                  card={card}
                  size="board"
                  dimmed={targetIds ? !targetIds.includes(card.instanceId) : false}
                  hoverZoom={settings.hoverZoom}
                  playAnim={settings.animations}
                  targetable={Boolean(targetIds?.includes(card.instanceId))}
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
  winnerPanel = true,
  coachAnchors = false,
  ui2 = false,
  selected,
  pick,
  aiPhase,
  aiSummary,
  settings,
  t,
  onHouse,
  onPickHouse = NOOP,
  onConfirmPick = NOOP,
  onPickFlank = NOOP,
  onPickMode = NOOP,
  onCancelPick = NOOP,
  onSelectHand,
  onPlayHand = NOOP,
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
  viewSwitching = false,
  consoleExtra,
  archivesAction,
  consoleSlot = null,
}: {
  /** Rail dockado: o turn-console é portado para o topo da coluna direita. */
  consoleSlot?: HTMLElement | null;
  game: GameState;
  selected: Selection | null;
  pick: Pick | null;
  aiPhase: "idle" | "thinking" | "acting";
  /** Onda 2: resumo do turno da IA (substitui a linha da casa até o jogador agir). */
  aiSummary: string | null;
  settings: AppSettings;
  t: Translator;
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
  /** H3D-10: troca de visão em curso — liga o fade e o will-change. */
  viewSwitching?: boolean;
  /** FIT-02: controle extra no fim do turn-console (o atalho 3D no perfil compacto). */
  consoleExtra?: ReactNode;
  /** Archives: pegar as cartas arquivadas e opcional ("may") — a acao so entra
      no console enquanto o move e legal (docs/ROADMAP_REVIEW.md §1.2). */
  archivesAction?: ReactNode;
  onHouse: (house: string) => void;
  /** Lote 5: the house answering the pending move's "Choose a house". */
  onPickHouse?: (house: string) => void;
  /** Lote 7: confirms the cards of an "up to N" pick (possibly none). */
  onConfirmPick?: () => void;
  onPickFlank?: (flank: "left" | "right") => void;
  /** Lote 8: the answer to a "Choose one:" / "a player's deck" prompt. */
  onPickMode?: (mode: "a" | "b") => void;
  /** QA 07/out: aborta a escolha pendente (banner/pill) sem jogar. */
  onCancelPick?: () => void;
  onSelectHand: (card: CardInstance) => void;
  /** Drag-to-play: soltar sobre a battleline = o mesmo move do botão Play. */
  onPlayHand?: (card: CardInstance) => void;
  onSelectBoard: (owner: 0 | 1, card: CardInstance) => void;
  onEndTurn: () => void;
  onRematch: () => void;
  onHome: () => void;
  /** UX_REWRITE_PLAN §5 H-22: a v2 mostra o fim de partida pelo ResultScreen (App); sem ela, o painel daqui. */
  winnerPanel?: boolean;
  /** UX_REWRITE_PLAN §5 H-24: data-coach nos três pontos que a dica ancora (só com a v2). */
  coachAnchors?: boolean;
  /** UX_REWRITE_PLAN §5 H-26: pilhas como ZonesSheet por abas (só com a v2); v1 segue no PileDialog. */
  ui2?: boolean;
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
      getLegalMoves(game, humanSide, game.activeHouse)
        .filter((move) => move.type !== "takeArchives")
        .map((move) => (move.type === "fight" ? move.attackerId : move.instanceId)),
    );
  }, [game, settings.hints, readOnly, humanSide, handHidden]);
  // Drag-to-play: só carta com play legal arrasta (a regra é do motor); o drop
  // chama o mesmo caminho do botão Play, então alvos/flanco abrem depois dele.
  const handDrag = useHandDrag({
    canDrag: (iid) => isHumanTurn && !pick && isLegalMove(game, humanSide, { type: "play", instanceId: iid }),
    faceOf: (iid) => player.hand.find((card) => card.instanceId === iid)?.face,
    onDrop: (iid) => { const card = player.hand.find((item) => item.instanceId === iid); if (card) onPlayHand(card); },
    animate: settings.animations && !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
  // T7d: closures estáveis por lane — sem identidade estável o memo de
  // BoardLane/CardTile não teria efeito.
  const selectOpponentCard = useCallback((card: CardInstance) => onSelectBoard(enemySide, card), [onSelectBoard, enemySide]);
  const selectPlayerCard = useCallback((card: CardInstance) => onSelectBoard(humanSide, card), [onSelectBoard, humanSide]);
  const winnerRef = useDialogFocus<HTMLDivElement>(game.winner !== null);
  const passRef = useDialogFocus<HTMLDivElement>(handHidden);
  // Lote 10 §10.1: "Look at …" opens a private modal for the acting human (solo: side 0 only; pass-and-play:
  // the active player, who is the one holding the device). The log carries just the count. The object identity
  // survives the state clones, so a dismissed peek stays dismissed until the next move replaces it.
  // The UI owns the window: the modal captures the faces and stays open until the human closes it, even when the
  // engine drops `game.peek` on someone else's move (a reaction peek in the AI's turn). A signature in sessionStorage
  // keeps a reload from reopening a look already shown. Pass-and-play only opens it for the owner of the look (the
  // active player); a reaction peek in the other player's turn is never shown there — one shared device cannot
  // hide it from whoever holds it at that moment.
  const [openPeek, setOpenPeek] = useState<GameState["peek"]>(undefined);
  const seenPeek = useRef<GameState["peek"]>(undefined);
  useEffect(() => {
    const incoming = game.peek;
    if (!incoming || incoming === seenPeek.current || readOnly || handHidden) return;
    if (passAndPlay ? game.activePlayer !== incoming.side : incoming.side !== humanSide) return;
    seenPeek.current = incoming;
    const sign = `peek:${game.seed}:${game.turn}:${game.log.length}:${incoming.side}:${incoming.faces.map((face) => face.id).join(",")}`;
    try {
      if (sessionStorage.getItem("aember.peekSeen") === sign) return;
      sessionStorage.setItem("aember.peekSeen", sign);
    } catch { /* storage is best-effort: worst case the modal reopens after a reload */ }
    setOpenPeek(incoming);
  }, [game, readOnly, handHidden, passAndPlay, humanSide]);
  const peek = !readOnly && !handHidden ? openPeek ?? null : null;
  // Zonas laterais: o overlay de pilha é navegação da UI (sem efeito de jogo) e
  // lê o estado vivo — as cartas mudam junto com a partida enquanto ele está
  // aberto. Descarte é público; o arquivo só abre para o dono (canOpenPile).
  const [pile, setPile] = useState<{ kind: PileKind; side: 0 | 1 } | null>(null);
  const openPile = useCallback((kind: PileKind, side: 0 | 1) => {
    sound.play("click");
    setPile({ kind, side });
  }, []);
  // A pilha não fica aberta por cima da pass screen (a mão do próximo lado some
  // até ele confirmar) nem do vencedor.
  useEffect(() => {
    if (game.winner !== null || handHidden) setPile(null);
  }, [game.winner, handHidden]);
  // FEAT-10/13: in pass-and-play both sides decide their own mulligan (the
  // solo board only prompts for side 0 and lets the AI decide side 1).
  const mulliganSide = inMulligan(game) ? (game.pendingMulligan as 0 | 1) : null;
  const mulliganDeciding = mulliganSide !== null && (passAndPlay || mulliganSide === 0);
  // FX-04: a narração do turno da IA (plano §3) — o resumo do fim do turno e a
  // última linha do Warden no log alimentam a região viva do console; o portal
  // dos FX é aria-hidden, então sem isto o turno inteiro passa em silêncio.
  const lastAiLog = passAndPlay ? undefined : game.log.filter((entry) => entry.params.name === enemy.name).pop();
  const narration = [aiSummary, lastAiLog && renderLog(lastAiLog, t)].filter(Boolean).join(" ");
  // H3D-01/02: a visão é uma classe no board (não é memo) — nenhuma prop nova
  // desce para BoardLane/CardTile ao alternar, então nenhum tile re-renderiza.
  // H3D-09: no hardware fraco a classe é `--lite` (2.5D, mesa só de cenário) —
  // o _table-plane_ do 3D real exige `--3d`, então um nunca vem com o outro.
  const view3d = settings.tableView === "3d";
  const tableClass = view3d ? (LITE_TABLE ? " game-board--lite" : " game-board--3d") : "";
  // QA 07/out: o que a casa escolhida no pill vai fazer (a carta que pede a casa
  // lê a escolha em "each creature of that house").
  const houseEffect = pick?.houses ? housePickEffect(pick.move, game, t) : undefined;

  return (
    <section
      className={`game-board game-board--stage${settings.animations ? "" : " no-anim"}${tableClass}${consoleSlot ? " game-board--console-docked" : ""}${viewSwitching ? " game-board--switching" : ""}`}
      data-view={view3d ? "3d" : undefined}
      // H3D-21: a cor do tapete segue a casa do turno e a metade de quem joga.
      // --turn-house também tinge o anel/glow da casa ativa no pill (2D e 3D).
      style={{ "--turn-house": game.activeHouse ? houseColor(game.activeHouse) : "transparent", "--turn-y": game.activePlayer === humanSide ? "72%" : "28%" } as CSSProperties}
      aria-label={t("game.board")}
    >
      <div className="felt-etching" aria-hidden="true" />
      <div className="board-content">
        <PlayerBand
          player={enemy}
          keyCost={keyCost(game, enemySide)}
          isAi={!passAndPlay}
          active={game.activePlayer === enemySide && game.winner === null}
          thinking={aiPhase === "thinking"}
          house={game.activePlayer === enemySide ? game.activeHouse : null}
          chains={enemy.chains}
          side={enemySide}
          avatarLabel={passAndPlay ? String(enemySide + 1) : undefined}
          backs={enemy.hand.length}
          discardCount={enemy.discard.length}
          archiveCount={enemy.archives.length}
          viewerSide={humanSide}
          onOpenPile={openPile}
          t={t}
        />

        {/* Seletor de casas como pill flutuante sobre a mesa (fora do table-plane:
            no 3D o plano inclina e o pill é HUD, irmão das bandas). Só os 3
            emblemas lado a lado (44px cada); hover expande com o nome; a casa
            ativa ganha anel/glow. Clique = mesma ação dos botões antigos.
            QA 07/out: quando a carta pede casa, o PROMPT se integra ao pill (o
            texto fica ancorado aos emblemas, que pulsam) em vez de flutuar no
            meio da mesa sem apontar onde clicar. */}
        <div className={`house-pill${pick?.houses ? " house-pill--asking" : ""}`}>
          {pick?.houses && (
            <div className="house-pill-prompt" role="status">
              <Crosshair size={13} />
              <span className="house-pill-ask">{t("game.chooseMoveHouse")}</span>
              <button type="button" className="pick-cancel" onClick={onCancelPick} aria-label={t("game.cancelPick")} title={t("game.cancelPick")}>
                <X size={12} />
              </button>
              {houseEffect && <span className="house-pill-effect">{houseEffect}</span>}
            </div>
          )}
          <div className="house-picker" role="group" data-coach={coachAnchors ? "pickHouse" : undefined} aria-label={pick?.houses ? t("game.chooseMoveHouse") : t("game.chooseHouse")}>
            {(pick?.houses ?? player.houses).map((house) => {
              const chosen = !pick?.houses && game.activeHouse === house;
              return (
                <button
                  key={house}
                  type="button"
                  className={`house-choice${chosen ? " is-chosen" : ""}${game.activeHouse && !chosen && !pick?.houses ? " is-locked" : ""}`}
                  style={{ "--house-color": houseColor(house) } as CSSProperties}
                  onClick={() => (pick?.houses ? onPickHouse(house) : onHouse(house))}
                  disabled={pick?.houses ? !isHumanTurn : !isHumanTurn || Boolean(game.activeHouse) || !housesFor(game, humanSide).includes(house)}
                  aria-pressed={chosen}
                  aria-label={houseLabel(house, t)}
                  title={houseLabel(house, t)}
                >
                  <HouseIcon house={house} size="lg" />
                  <span className="house-choice-name">{houseLabel(house, t)}</span>
                  {chosen && <Check size={13} className="house-check" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* H3D-02: no 2D o wrapper é `display: contents` — não existe para
            layout nem para a árvore de acessibilidade. No 3D ele é o plano da
            mesa (perspectiva + preserve-3d); fora dele ficam os HUDs. */}
        <div className="table-plane">
          <section className="battle-zone battle-zone--opponent" aria-label={t("game.opponentLine")}>
            <div className="zone-heading">
              <span>{t("game.opponentLine")}</span>
              <span className="zone-card-count">{enemy.board.length} {t("game.onTable")}</span>
            </div>
            <BoardLane
              cards={enemy.board}
              otherCards={player.board}
              owner={enemySide}
              humanSide={humanSide}
              activeHouse={null}
              selectedId={selected?.zone === "enemy" ? selected.instanceId : undefined}
              targetIds={pick?.ids}
              settings={settings}
              t={t}
              ui2={ui2}
              onSelect={readOnly ? undefined : selectOpponentCard}
            />
          </section>

          {(() => {
            const consoleNode = (
          <div className={`turn-console${isHumanTurn ? " turn-console--human" : ""}`}>
            {/* UMA linha discreta: "ROUND 01 · Your turn" — o seletor de casas é
                o pill flutuante sobre a mesa (house-pill, irmão do table-plane);
                o resumo do Warden (aiSummary) continua vivo como sufixo da linha. */}
            <div className="turn-console-copy">
              <div className="turn-line">
                <div className="round-kicker"><span className="round-dot" /> {t("game.round")} {String(game.turn).padStart(2, "0")}</div>
                <span className="turn-sep" aria-hidden="true">·</span>
                <strong>
                  {passAndPlay
                    ? t("game.turnOf", { name: localizeName(game.players[game.activePlayer].name, t) })
                    : game.activePlayer === 0 ? t("game.yourTurn") : aiPhase === "thinking" ? t("game.thinking") : t("game.opponentTurn")}
                </strong>
                {aiSummary && <span className="turn-line-summary">{aiSummary}</span>}
              </div>
              {/* FX-04: região viva do turno — a linha visível é a narrativa curta. */}
              <span className="sr-only" aria-live="polite">{narration}</span>
            </div>
            <button className="end-turn-button" type="button" onClick={onEndTurn} disabled={!isHumanTurn} data-coach={coachAnchors ? "endTurn" : undefined} aria-label={t("game.endTurn")} title={t("game.endTurn")}>
              <span>{t("game.endTurn")}</span>
              <ArrowRight size={15} />
            </button>
            {archivesAction}
            {consoleExtra}
          </div>
            );
            return consoleSlot ? createPortal(consoleNode, consoleSlot) : consoleNode;
          })()}

          <section className="battle-zone battle-zone--player" aria-label={t("game.yourLine")}>
            <div className="zone-heading">
              <span>{t("game.yourLine")}</span>
              <span className="zone-card-count">{player.board.length} {t("game.onTable")}</span>
            </div>
            {/* QA 07/out: a escolha de CASA mora no pill (prompt ancorado aos
                emblemas); a de ALVO ganha o rótulo "Escolha um alvo" e um cancel —
                enquanto a seleção vive, o clique fora dos elegíveis não faz nada. */}
            {pick && !pick.houses && (
              <div className={`fight-instruction${pick.ids.length ? " fight-instruction--target" : ""}`} role="status">
                {pick.kind === "flank" ? (
                  <>
                    <Crosshair size={15} /> {t("game.chooseFlank")}
                    <button type="button" className="filter-chip" onClick={() => onPickFlank("left")}>{t("game.flankLeft")}</button>
                    <button type="button" className="filter-chip" onClick={() => onPickFlank("right")}>{t("game.flankRight")}</button>
                  </>
                ) : pick.kind === "mode" ? (
                  <>
                    <Crosshair size={15} /> {t("game.chooseMode")}
                    <button type="button" className="filter-chip" onClick={() => onPickMode("a")}>{t(pick.modeChoice === "side" ? "game.modeOwnDeck" : "game.modeOption1")}</button>
                    <button type="button" className="filter-chip" onClick={() => onPickMode("b")}>{t(pick.modeChoice === "side" ? "game.modeOppDeck" : "game.modeOption2")}</button>
                  </>
                ) : pick.kind === "targets" ? (
                  <>
                    <Crosshair size={15} /> <span className="pick-tag">{t("game.chooseTargetBanner")}</span>
                    <span className="pick-sep" aria-hidden="true">·</span>
                    {t("game.chooseUpTo", { chosen: pick.chosen?.length ?? 0, max: pick.max ?? 0 })}
                    <button type="button" className="filter-chip" onClick={onConfirmPick}>{t("game.confirmPick")}</button>
                  </>
                ) : pick.kind === "target2" ? (
                  <><Crosshair size={15} /> <span className="pick-tag">{t("game.chooseTargetBanner")}</span><span className="pick-sep" aria-hidden="true">·</span>{t("game.chooseTarget2")}</>
                ) : pick.move.type === "fight" ? (
                  <><Swords size={15} /> <span className="pick-tag">{t("game.chooseTargetBanner")}</span><span className="pick-sep" aria-hidden="true">·</span>{t("game.chooseFight")}</>
                ) : (
                  <><Crosshair size={15} /> <span className="pick-tag">{t("game.chooseTargetBanner")}</span><span className="pick-sep" aria-hidden="true">·</span>{t("game.chooseTarget")}</>
                )}
                <button type="button" className="pick-cancel" onClick={onCancelPick} aria-label={t("game.cancelPick")} title={t("game.cancelPick")}>
                  <X size={12} />
                </button>
              </div>
            )}
            <BoardLane
              cards={player.board}
              otherCards={enemy.board}
              owner={humanSide}
              humanSide={humanSide}
              hintIds={hintIds}
              activeHouse={game.activeHouse}
              houseKey={`|${player.board.filter((card) => houseOf(game, card) === "all" || houseOf(game, card) === game.activeHouse).map((card) => card.instanceId).join("|")}|`}
              selectedId={selected?.zone === "board" ? selected.instanceId : undefined}
              targetIds={pick?.ids}
              settings={settings}
              t={t}
              ui2={ui2}
              onSelect={readOnly ? undefined : selectPlayerCard}
            />
          </section>
        </div>

        <PlayerBand
          player={player}
          keyCost={keyCost(game, humanSide)}
          isAi={false}
          active={game.activePlayer === humanSide && game.winner === null}
          house={game.activePlayer === humanSide ? game.activeHouse : null}
          chains={player.chains}
          side={humanSide}
          avatarLabel={passAndPlay ? String(humanSide + 1) : undefined}
          handCount={player.hand.length}
          deckCount={player.deck.length}
          hint={game.activePlayer === humanSide && !game.activeHouse && game.winner === null && !inMulligan(game) && !handHidden}
          discardCount={player.discard.length}
          archiveCount={player.archives.length}
          viewerSide={humanSide}
          onOpenPile={openPile}
          t={t}
        />

        <section className="hand-zone" aria-label={t("game.yourHand")}>
          <div
            className="hand-track"
            data-coach={coachAnchors ? "playCard" : undefined}
            /* H3D-06: --n abre o leque no 3D (rotação/arco por carta); no 2D é
               inerte. O GameBoard não é memo — nenhuma prop desce para a mão. */
            style={{ "--n": Math.max(1, player.hand.length) } as CSSProperties}
            {...handDrag.handlers}
          >
            {!handHidden && player.hand.map((card) => {
              const playable = Boolean(game.activeHouse && (houseOf(game, card) === game.activeHouse || playPermission(game, game.activePlayer, card)));
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
            {!handHidden && !player.hand.length && (ui2 ? (
              <div className="empty-hand nf-empty-hand">
                <Hand size={18} strokeWidth={1.5} aria-hidden="true" />
                <span>{t("ui.table.handEmpty")}</span>
              </div>
            ) : <div className="empty-hand">{t("game.handEmpty")}</div>)}
          </div>
          {handDrag.ghost}
        </section>
      </div>

      {peek && <PeekDialog peek={peek} t={t} onClose={() => setOpenPeek(undefined)} />}

      {/* H-26: com a v2 as pilhas são uma Sheet por abas; o PileDialog segue só na v1 (sai com H-30). */}
      {pile && ui2 && (
        <ZonesSheet
          key={`${pile.kind}-${pile.side}`}
          t={t}
          initial={pile.kind === "archives" ? "archives" : pile.side === humanSide ? "discardYou" : "discardOpp"}
          players={game.players}
          names={[localizeName(game.players[0].name, t), localizeName(game.players[1].name, t)]}
          viewerSide={humanSide}
          onClose={() => setPile(null)}
        />
      )}
      {pile && !ui2 && (
        <PileDialog
          kind={pile.kind}
          owner={game.players[pile.side]}
          cards={pile.kind === "discard" ? game.players[pile.side].discard : game.players[pile.side].archives}
          t={t}
          onClose={() => setPile(null)}
        />
      )}

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

      {winnerPanel && game.winner !== null && !readOnly && (
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
  onToggleHold,
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
  /** Entrench (Lote 4 §4.2): alterna o hold da criatura selecionada. */
  onToggleHold: (card: CardInstance) => void;
  /** `decline` starts the fight pick resolving it without its "You may" clauses. */
  onFight: (decline?: boolean) => void;
  onCancelPick: () => void;
  onClear: () => void;
}) {
  const isHumanTurn = game.activePlayer === humanSide && game.winner === null && !inMulligan(game);
  const activeForHouse = Boolean(card && game.activeHouse && (houseOf(game, card) === "all" || houseOf(game, card) === game.activeHouse));
  // Legality comes from the engine (house, first-turn rule, Alpha/Omega, taunt…).
  const legal = (move: GameMove) => isHumanTurn && isLegalMove(game, humanSide, move);
  const id = card?.instanceId ?? "";
  const canPlay = legal({ type: "play", instanceId: id });
  const canUse = legal({ type: "use", instanceId: id });
  const printsUse = Boolean(card && /(?:^|[\s/.])(?:Action|Omni):/i.test(card.face.text));
  const fightChoices = card ? fightTargets(game, humanSide, card) : [];
  const canFight = Boolean(card && isHumanTurn && activeForHouse && fightChoices.length);
  // Onda 2, "You may": o botão de recusa só aparece quando o motor expõe a
  // variante declinada (a carta imprime a cláusula) — a legalidade é a regra.
  const canDeclinePlay = legal({ type: "play", instanceId: id, decline: true });
  const canDeclineReap = legal({ type: "reap", instanceId: id, decline: true });
  const canDeclineUse = legal({ type: "use", instanceId: id, decline: true });
  const canDeclineFight = canFight && fightChoices.some((target) => legal({ type: "fight", attackerId: id, targetId: target.instanceId, decline: true }));
  const declineLabel = t("inspector.withoutEffect");

  return (
    <section className={`inspector-section${selection && card ? " inspector-section--docked" : ""}${pick ? " inspector-section--yield" : ""}`} aria-live="polite">
      <div className="section-label-row">
        <span className="section-label">{t("inspector.title")}</span>
        {selection && <button className="quiet-icon-button" type="button" onClick={onClear} aria-label={t("common.close")}><X size={14} /></button>}
      </div>
      {selection && card ? (
        <div className="selected-card-content" key={id}>
          <div className="selected-card-main">
            <CardArt face={card.face} size="preview" hoverZoom={settings.hoverZoom} />
            <div className="selected-card-heading">
              <HouseMark house={card.face.house} small />
              <span className="card-type-label">{houseLabel(card.face.house, t)} / {t(`type.${displayType(card)}`)}</span>
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
                    {canDeclinePlay && (
                      <button className="secondary-action" type="button" title={declineLabel} onClick={() => onMove({ type: "play", instanceId: id, decline: true })}>
                        {declineLabel}
                      </button>
                    )}
                    {legal({ type: "discard", instanceId: id }) && (
                      <button className="secondary-action" type="button" onClick={() => onMove({ type: "discard", instanceId: id })}>
                        <Trash2 size={15} /> {t("inspector.discard")}
                      </button>
                    )}
                  </>
                )}
                {selection.zone === "board" && isCreatureCard(card) && (card.stunned ? (
                  <button className="primary-action" type="button" disabled={!legal({ type: "unstun", instanceId: id })} onClick={() => onMove({ type: "unstun", instanceId: id })}>
                    <CircleHelp size={15} /> {t("inspector.unstun")}
                  </button>
                ) : (
                  <>
                    <button className="primary-action" type="button" disabled={!legal({ type: "reap", instanceId: id })} onClick={() => onMove({ type: "reap", instanceId: id })}>
                      <Gem size={15} /> {t("inspector.reap")}
                    </button>
                    {canDeclineReap && (
                      <button className="secondary-action" type="button" title={declineLabel} onClick={() => onMove({ type: "reap", instanceId: id, decline: true })}>
                        {declineLabel}
                      </button>
                    )}
                    <button className="secondary-action" type="button" disabled={!canFight} onClick={() => onFight()}>
                      <Swords size={15} /> {t("inspector.fight")}
                    </button>
                    {canDeclineFight && (
                      <button className="secondary-action" type="button" title={declineLabel} onClick={() => onFight(true)}>
                        {declineLabel}
                      </button>
                    )}
                  </>
                ))}
                {selection.zone === "board" && (displayType(card) === "Artifact" || (isCreatureCard(card) && printsUse && !card.stunned)) && (
                  <>
                    <button className="primary-action" type="button" disabled={!canUse} onClick={() => onMove({ type: "use", instanceId: id })}>
                      <Zap size={15} /> {printsUse ? t("inspector.use") : t("inspector.passive")}
                    </button>
                    {canDeclineUse && (
                      <button className="secondary-action" type="button" title={declineLabel} onClick={() => onMove({ type: "use", instanceId: id, decline: true })}>
                        {declineLabel}
                      </button>
                    )}
                  </>
                )}
                {/* Entrench (§4.2): a escolha de ficar exausta no ready step é do
                    controlador, por carta — o toggle vive no inspetor. */}
                {selection.zone === "board" && isCreatureCard(card) && keyword(game, card, "entrench") > 0 && (
                  <button
                    className="secondary-action"
                    type="button"
                    aria-pressed={card.hold === true}
                    title={t("inspector.entrenchHint")}
                    onClick={() => onToggleHold(card)}
                  >
                    <Anchor size={15} /> {card.hold ? t("inspector.holdRelease") : t("inspector.holdKeep")}
                  </button>
                )}
              </>
            )}
            {selection.zone === "enemy" && <div className="inspector-hint"><Shield size={14} /> {t("inspector.enemyCard")}</div>}
            {selection.zone === "hand" && isHumanTurn && game.activeHouse && !activeForHouse && <div className="inspector-hint"><Shield size={14} /> {t("inspector.onlyHouse", { house: houseLabel(game.activeHouse, t) })}</div>}
            {selection.zone === "board" && !card.ready && isCreatureCard(card) && <div className="inspector-hint"><Clock3 size={14} /> {t("inspector.resting")}</div>}
            {selection.zone === "board" && card.stunned && <div className="inspector-hint"><CircleHelp size={14} /> {t("inspector.stunned")}</div>}
            {selection.zone === "board" && card.hold && <div className="inspector-hint"><Anchor size={14} /> {t("inspector.entrenchHint")}</div>}
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

// ---------- Peek dialog ----------

/** Private view of the cards a "Look at …" showed (Lote 10 §10.1): closes on click/Escape, no game effect. */
function PeekDialog({ peek, t, onClose }: { peek: NonNullable<GameState["peek"]>; t: (key: string) => string; onClose: () => void }) {
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-panel peek-panel" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="peek-title">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">{t(peek.from === "hand" ? "peek.hand" : "peek.deck")}</span>
            <h2 id="peek-title">{t("peek.title")}</h2>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label={t("common.close")}><X size={18} /></button>
        </div>
        <div className="peek-cards">
          {peek.faces.map((face, index) => (
            <CardArt key={`${face.id}-${index}`} face={face} size="hand" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Pile overlay (zonas laterais) ----------

/** Leitura das pilhas da mesa: o descarte (público) e o arquivo do próprio lado
    abrem face-up, ordenados por título no mesmo grid do inspetor. O arquivo
    virado do oponente nunca chega aqui — o chip dele não abre (canOpenPile).
    Fecha com X, Esc e clique no backdrop; o foco segue o contrato dos modais
    (useDialogFocus) e o conteúdo segue o estado vivo da partida. */
function PileDialog({
  kind,
  owner,
  cards,
  t,
  onClose,
}: {
  kind: PileKind;
  owner: GameState["players"][number];
  cards: CardInstance[];
  t: Translator;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const sorted = useMemo(() => sortPile(cards), [cards]);
  // Portal no body como o CardLightbox: dentro do board o backdrop empilha dentro
  // do stacking do palco e o rail (console) cobre o canto do painel no desktop.
  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-panel pile-panel" data-pile={kind} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="pile-title">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">{localizeName(owner.name, t)}</span>
            <h2 id="pile-title">{t(kind === "discard" ? "game.pileTitleDiscard" : "game.pileTitleArchive")}</h2>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label={t("common.close")}><X size={18} /></button>
        </div>
        <div className="pile-count-row">
          <span className="meta-chip">
            {kind === "discard" ? <Layers size={12} /> : <Archive size={12} />}
            {cards.length} {t("common.cards")}
          </span>
        </div>
        {sorted.length ? (
          <div className="card-grid pile-grid">
            {sorted.map((item, index) => (
              <div
                key={item.instanceId}
                className="card-cell pile-card"
                style={{ "--house-color": houseColor(item.face.house), animationDelay: `${Math.min(index, 11) * 26}ms` } as CSSProperties}
              >
                <CardArt face={item.face} size="hand" hoverZoom />
                <span className="card-cell-caption">
                  <strong>{item.face.title}</strong>
                  <small>
                    {cardTypeLabel(item.face.type, t)}
                    {item.face.power > 0 ? ` · ${item.face.power}` : item.face.amber ? ` · ${item.face.amber}A` : ""}
                  </small>
                </span>
                {item.face.isMaverick && <span className="maverick-flag">MV</span>}
              </div>
            ))}
          </div>
        ) : (
          <div className="card-grid-empty">
            {kind === "discard" ? <Layers size={20} strokeWidth={1.5} /> : <Archive size={20} strokeWidth={1.5} />}
            <p>{t(kind === "discard" ? "game.pileEmptyDiscard" : "game.pileEmptyArchive")}</p>
          </div>
        )}
      </div>
    </div>,
    document.body,
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

// ---------- Crash probe (H-27, só dev) ----------

/** Lança de propósito para provar a fronteira de erro (`?ui=2&crash=1`). Nunca no build. */
function CrashProbe(): null {
  throw new Error("aember-arena: crash probe (?ui=2&crash=1)");
}

// ---------- App ----------

// Navigation pointer, not a setting: sessionStorage survives a reload but not a new session.
const INSPECT_KEY = "aember.review.inspect";
function readInspectPointer(): string | null {
  try {
    return sessionStorage.getItem(INSPECT_KEY);
  } catch {
    return null;
  }
}
function writeInspectPointer(id: string | null) {
  try {
    if (id) sessionStorage.setItem(INSPECT_KEY, id);
    else sessionStorage.removeItem(INSPECT_KEY);
  } catch {
    // Storage is optional; the match stays playable.
  }
}

function App() {
  const [language, setLanguage] = useState<Language>(readLanguage);
  const [settings, setSettings] = useState<AppSettings>(() => readSettings(readLanguage()));
  const [hasHover] = useState(prefersHover);
  const t = useMemo(() => createTranslator(language), [language]);
  // H-01: a flag da v2 é lida uma vez; os lotes H-07+ passam a consumi-la.
  const ui2 = useMemo(readUiFlag, []);
  // UX_REWRITE_PLAN §2 S2: ?state=loading|empty força os estados C/V do Lobby (gate e2e:ui2). Só com a v2.
  const uiState = ui2 === "2" ? new URLSearchParams(window.location.search).get("state") : null;
  // H-13: a MatchSheet (S3) aberta pela linha "contra …" do Lobby.
  const [matchSheetOpen, setMatchSheetOpen] = useState(false);

  // H-18: ?ui=2&screen=settings abre Ajustes direto (gate e2e:ui2); sem a v2 a rota não existe.
  // H-28: ?ui=2&screen=browse abre a Biblioteca direto, para o gate medir a entrada dela.
  const [screen, setScreen] = useState<Screen>(() => {
    const requested = ui2 === "2" ? new URLSearchParams(window.location.search).get("screen") : null;
    return requested === "settings" || requested === "browse" ? requested : "home";
  });
  const [selectedDeck, setSelectedDeck] = useState<DeckInfo>(DEMO_DECK);
  // BUG-15: the Vault view state survives browsing into a deck and back.
  const [browseState, setBrowseState] = useState<BrowseState>({ page: 1, search: "", ordering: "-date" });
  // UX_REWRITE_PLAN §5 H-15: aba e ordem da biblioteca (v2) vivem aqui para sobreviver ao Detalhe.
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("mine");
  const [librarySort, setLibrarySort] = useState<LibrarySort>("shelf");
  // UX_REWRITE_PLAN §5 H-16: de onde o Detalhe (v2) foi aberto; o "voltar" devolve para lá.
  const [inspectOrigin, setInspectOrigin] = useState<"home" | "browse">("home");
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
  // Modo aleatório: o sorteio do Warden acontece ANTES da partida (a revisão mostra
  // e inspeciona o baralho); launchMatch consome este id e o limpa para a próxima.
  // O sorteio sobrevive a reload/restart (localStorage, como as outras configs); só vale com a biblioteca carregada.
  const [randomRivalId, setRandomRivalId] = useState<string | undefined>(readRandomRivalId);
  const [libraryReady, setLibraryReady] = useState(false);
  const [currentDeck, setCurrentDeck] = useState<DeckInfo>(DEMO_DECK);
  const [game, setGame] = useState<GameState | null>(null);
  // FEAT-13: the mode the LIVE match was created with (settings.gameMode only
  // drives the config wizard — toggling it must not re-shape a running match).
  const [matchMode, setMatchMode] = useState<GameMode>("solo");
  /** FEAT-13: side that must confirm the pass before its hand renders again. */
  const [passPending, setPassPending] = useState<0 | 1 | null>(null);
  /** H3D-10: a troca 2D ↔ 3D está em curso (fade de 420ms + will-change). */
  const [viewSwitching, setViewSwitching] = useState(false);

  const [selected, setSelected] = useState<Selection | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  /** Onda 2 (plano §3): fase do turno da IA — pensando, agindo ou fora de cena.
      "acting" existe para o placar contar a história sem o jogador abrir o log. */
  const [aiPhase, setAiPhase] = useState<"idle" | "thinking" | "acting">("idle");
  /** Resumo do turno do Warden na faixa do round, até a primeira ação do jogador. */
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  /** DB v4 (plano §5): cards in the local catalog and the running sync, or null. */
  const [catalogCount, setCatalogCount] = useState(0);
  const [catalogSync, setCatalogSync] = useState<CatalogProgress | null>(null);
  /** Onda 2 (plano §4): rodada de tradução LLM em curso, ou null. */
  const [llmRun, setLlmRun] = useState<RunProgress | null>(null);
  const [llm, setLlm] = useState<LlmConfig>(readLlmConfig);

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
  // BUG2-13: o X do toast dispensa a atualização pela sessão (sem isso o toast
  // voltava a cada troca de tela); um worker novo zera o dismiss.
  const [updateDismissed, setUpdateDismissed] = useState(false);
  // FEAT-12b: the read-only replay viewer — derived states, never the live one.
  const [replay, setReplay] = useState<{ states: GameState[]; index: number } | null>(null);
  // Tutorial: opens by itself only on the first real visit (always on Home).
  // UX_REWRITE_PLAN §5 H-23: com a v2 o primeiro contato é o OnboardingFlow (S1); o TutorialWizard abre só pelo botão.
  const [tutorialOpen, setTutorialOpen] = useState(() => ui2 !== "2" && isFirstVisit());
  const [onboarding, setOnboarding] = useState<OnboardingStep | null>(() => (ui2 === "2" ? startOnboarding(isFirstVisit()) : null));
  // UX_REWRITE_PLAN §5 H-24: dicas da partida guiada (v2). "done" = nada a mostrar; o passo vive no storage.
  const [coach, setCoach] = useState<CoachStep>(() => (ui2 === "2" ? readCoach() : "done"));
  const coachRef = useRef<CoachStep>(coach);
  const coachPrevRef = useRef<CoachSnapshot | null>(null);
  const replayRef = useDialogFocus<HTMLDivElement>(replay !== null);

  const gameRef = useRef<GameState | null>(null);
  const settingsRef = useRef(settings);
  /** BUG2-10: espelho do currentDeck para o commit registrar com que deck cada
      estado da pilha de undo vivia (o Sync troca o deck no meio do turno). */
  const currentDeckRef = useRef(currentDeck);
  /** FEAT-13: the live match mode, read by the hot callbacks (like gameRef). */
  const matchModeRef = useRef<GameMode>("solo");
  /** FEAT-11: the rival a rematch replays against (random mode does not reroll). */
  const opponentRef = useRef<DeckInfo | null>(null);
  const randomPool = settings.opponentMode === "random" ? savedDecks.filter((item) => item.id !== selectedDeck.id) : [];
  const randomRival = randomPool.find((item) => item.id === randomRivalId);
  const randomPoolKey = randomPool.map((item) => item.id).join("|");
  useEffect(() => {
    // Antes da biblioteca (IndexedDB) chegar o pool só tem os starters: sortear agora descartaria um rival persistido.
    if (!libraryReady || randomRival || !randomPool.length) return;
    // Não repete o rival da partida anterior quando há alternativa.
    const fresh = randomPool.filter((item) => item.id !== opponentRef.current?.id);
    setRandomRivalId(drawDeck(fresh.length ? fresh : randomPool)?.id);
    // randomPoolKey resume o pool (o array é novo a cada render).
  }, [libraryReady, randomRival, randomPoolKey]);
  // Persiste o sorteio; trocar de modo (ou sair da biblioteca, que re-sorteia acima) o limpa.
  useEffect(() => {
    writeRandomRivalId(randomRivalId);
  }, [randomRivalId]);
  useEffect(() => {
    if (settings.opponentMode !== "random") setRandomRivalId(undefined);
  }, [settings.opponentMode]);
  /** BUG2-11: configuração que valeu na partida viva (ver MatchSetup). */
  const matchSetupRef = useRef<MatchSetup | null>(null);
  const aiTurnRef = useRef<string | null>(null);
  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);
  /** DB v4: o sync em curso, para o botão Cancelar abortar entre páginas. */
  const catalogAbortRef = useRef<AbortController | null>(null);
  /** Onda 2: a rodada LLM em curso, para o Cancelar abortar entre cartas. */
  const llmAbortRef = useRef<AbortController | null>(null);
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
  /** Onda 1: diretor de FX (portal) + o plano capturado no commit à espera do
      layout effect que roda a revelação depois do DOM novo e antes do paint. */
  const fxRef = useRef<FxDirector | null>(null);
  const fxPlanRef = useRef<{ plan: FxPlan; resolve: () => void } | null>(null);
  /** Onda 2: o jogador tocou no board durante o turno da IA — compacta o resto. */
  const rushRef = useRef(false);

  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  // UX_REWRITE_PLAN §5 H-12: recorde V/D do deck do hero (só a v2 lê; a v1 segue sem essa leitura).
  const [deckRecord, setDeckRecord] = useState<DeckStats | null>(null);
  /** UX_REWRITE_PLAN §5 H-22: recorde lido DEPOIS de gravar a partida (versão da partida junto, para não mostrar o de outra). */
  const [matchRecord, setMatchRecord] = useState<{ version: number; stats: DeckStats } | null>(null);
  const winnerOfLive = game?.winner ?? null;
  // A volta ao Lobby (screen) relê o recorde: a gravação do fim de partida pode ter corrido depois da leitura antiga.
  useEffect(() => {
    if (ui2 !== "2") return;
    let disposed = false;
    setDeckRecord(null);
    void getDeckStats(selectedDeck.id).then((stats) => { if (!disposed) setDeckRecord(stats); });
    return () => { disposed = true; };
  }, [ui2, selectedDeck.id, winnerOfLive, screen]);
  useEffect(() => { currentDeckRef.current = currentDeck; }, [currentDeck]);
  useEffect(() => { matchModeRef.current = matchMode; }, [matchMode]);

  /** Pula toda revelação em curso e limpa os data-fx. O estado commitado já é o
      final, então cancelar nunca dessincroniza nada (plano §0.5). */
  const cancelFx = useCallback(() => {
    const pending = fxPlanRef.current;
    fxPlanRef.current = null;
    fxRef.current?.cancelAll();
    pending?.resolve();
  }, []);

  /** H3D-01: troca a visão da mesa (2D ↔ 3D) sem recarregar. Nobre das
      revelações em curso: os rects de viewport foram medidos no modo antigo e
      deixam de valer (mesmo contrato de scroll/resize, VIEW3D_PLAN §2.8.6). O
      foco fica no botão — o nó é o mesmo, quem troca é a classe do board. */
  const toggleTableView = useCallback(() => {
    cancelFx();
    setViewSwitching(true);
    setSettings((prev) => ({ ...prev, tableView: prev.tableView === "3d" ? "2d" : "3d" }));
  }, [cancelFx]);

  // H3D-10: a classe da transição vive 420ms (o fade do board-content) e sai no
  // animationend — é ela que carrega o will-change do plano, então em repouso
  // nada fica promovido. O timeout cobre os motores que não emitem o evento.
  useEffect(() => {
    if (!viewSwitching) return;
    const board = document.querySelector<HTMLElement>(".game-board");
    const done = () => setViewSwitching(false);
    const onEnd = (event: AnimationEvent) => {
      if (event.animationName === "view-fade") done();
    };
    board?.addEventListener("animationend", onEnd);
    const timer = window.setTimeout(done, 500);
    return () => {
      window.clearTimeout(timer);
      board?.removeEventListener("animationend", onEnd);
    };
  }, [viewSwitching]);

  // H3D-12 (VIEW3D_PLAN §2.9/§4): parallax sutil da câmera. UM listener de
  // pointermove passivo no board + rAF com lerp de 0,12/frame; escreve só duas
  // custom properties no plano (zero commit do React — nenhum CardTile vê o
  // movimento). Só com 3D real, mouse ("hover: hover" descarta toque) e
  // movimento ligado; o ponteiro fora do board volta ao neutro, e o cleanup
  // devolve o plano ao repouso (trocar de tela/modo não deixa câmera torta).
  useEffect(() => {
    if (screen !== "game" || settings.tableView !== "3d" || LITE_TABLE) return;
    if (!motionEnabled(settings.animations) || !prefersHover()) return;
    const board = document.querySelector<HTMLElement>(".game-board--3d");
    const plane = board?.querySelector<HTMLElement>(".table-plane");
    if (!board || !plane) return;
    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let frame = 0;
    const step = () => {
      x += (targetX - x) * 0.12;
      y += (targetY - y) * 0.12;
      const settled = Math.abs(targetX - x) < 0.002 && Math.abs(targetY - y) < 0.002;
      if (settled) {
        x = targetX;
        y = targetY;
      }
      plane.style.setProperty("--cam-x", x.toFixed(3));
      plane.style.setProperty("--cam-y", y.toFixed(3));
      frame = settled ? 0 : window.requestAnimationFrame(step);
    };
    const wake = () => {
      if (!frame) frame = window.requestAnimationFrame(step);
    };
    const onMove = (event: PointerEvent) => {
      const rect = board.getBoundingClientRect();
      // -1..1 nas duas bordas; o clamp protege o arrasto para fora do board.
      targetX = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
      targetY = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1));
      wake();
    };
    const onLeave = () => {
      targetX = 0;
      targetY = 0;
      wake();
    };
    board.addEventListener("pointermove", onMove, { passive: true });
    board.addEventListener("pointerleave", onLeave);
    return () => {
      board.removeEventListener("pointermove", onMove);
      board.removeEventListener("pointerleave", onLeave);
      if (frame) window.cancelAnimationFrame(frame);
      plane.style.removeProperty("--cam-x");
      plane.style.removeProperty("--cam-y");
    };
  }, [screen, settings.tableView, settings.animations]);

  // Fase D (UX_ARENA_PLAN §4 · UX-02/03): parallax leve do hero do home. Mesmo
  // desenho da câmera 3D de cima (H3D-12): UM pointermove passivo + rAF com
  // lerp, escrevendo só `--px`/`--py` no `.home-hero` — zero commit do React,
  // nenhum tile re-renderiza. O CSS só lê as duas variáveis e move as camadas
  // por multiplicador de profundidade. Só com mouse ("hover: hover" descarta
  // toque) e movimento ligado; o ponteiro fora do hero volta ao neutro e o
  // cleanup devolve o repouso (trocar de tela não deixa o fundo torto).
  useEffect(() => {
    if (screen !== "home") return;
    if (!motionEnabled(settings.animations) || !prefersHover()) return;
    const hero = document.querySelector<HTMLElement>(".home-hero");
    if (!hero) return;
    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let frame = 0;
    const step = () => {
      x += (targetX - x) * 0.1;
      y += (targetY - y) * 0.1;
      const settled = Math.abs(targetX - x) < 0.002 && Math.abs(targetY - y) < 0.002;
      if (settled) {
        x = targetX;
        y = targetY;
      }
      hero.style.setProperty("--px", x.toFixed(3));
      hero.style.setProperty("--py", y.toFixed(3));
      frame = settled ? 0 : window.requestAnimationFrame(step);
    };
    const wake = () => {
      if (!frame) frame = window.requestAnimationFrame(step);
    };
    const onMove = (event: PointerEvent) => {
      const rect = hero.getBoundingClientRect();
      targetX = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
      targetY = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1));
      wake();
    };
    const onLeave = () => {
      targetX = 0;
      targetY = 0;
      wake();
    };
    hero.addEventListener("pointermove", onMove, { passive: true });
    hero.addEventListener("pointerleave", onLeave);
    return () => {
      hero.removeEventListener("pointermove", onMove);
      hero.removeEventListener("pointerleave", onLeave);
      if (frame) window.cancelAnimationFrame(frame);
      hero.style.removeProperty("--px");
      hero.style.removeProperty("--py");
    };
  }, [screen, settings.animations]);

  // FEAT-12a: the engine is pure and clones, so the state a transition leaves
  // behind stays a valid snapshot. Every commit records it together with
  // whether the transition revealed hidden information (draw/shuffle) and the
  // replay step count at that point; FEAT-12b appends the step itself.
  const commitGame = useCallback((prev: GameState, next: GameState, step?: ReplayStep) => {
    cancelFx();
    const stack = historyRef.current;
    stack.push({ state: prev, revealed: revealsHiddenInfo(prev, next), step: stepsRef.current?.length ?? 0, deck: currentDeckRef.current });
    if (stack.length > UNDO_LIMIT) stack.shift();
    if (step) stepsRef.current?.push(step);
    gameRef.current = next;
    setGame(next);
  }, [cancelFx]);

  /** Commit com revelação (plano §0.4): captura os rects/clones ANTES do
      setGame, commita na hora (undo/log/stats/save leem o estado final) e
      devolve a Promise do diretor — o loop da IA a espera para dar ritmo. */
  const commitWithFx = useCallback(
    (prev: GameState, next: GameState, step: ReplayStep | undefined, move: GameMove | undefined, side: 0 | 1): Promise<void> => {
      let plan: FxPlan | null = null;
      let flight: string | undefined;
      // FX-03: "da IA" é o lado 1 do modo SOLO — no pass-and-play os dois lados
      // são humanos, então nada do palco da IA (legenda, hold de leitura, rush)
      // se aplica: as jogadas do Jogador 2 seguem o ritmo natural dele.
      const ai = side === 1 && matchModeRef.current === "solo";
      // Turno do Warden acelerado (opção rápida ou toque): o hold do voo encolhe
      // junto com as batidas, senão a carta continuaria 420ms parada no centro.
      const rush = ai && rushRef.current;
      if (move) {
        // A carta jogada sai da mão no commit: título para a legenda e face para
        // o ghost sem clone (FX-02) — o Warden joga da mão, fora do DOM.
        const played = move.type === "play" ? prev.players[side].hand.find((card) => card.instanceId === move.instanceId) : undefined;
        // A jogada do Warden leva legenda (UX review #1); legenda é informação,
        // então vale também sem movimento (FX-08).
        const playCaption = ai && played ? t("log.play", { name: t("log.warden"), card: played.face.title }) : undefined;
        // Guard de movimento (plano §0): sem isto o voo ignoraria o toggle.
        if (motionEnabled(settingsRef.current.animations)) {
          const events = diffFx(prev, next);
          // Uma carta jogada entra no board com o próprio instanceId: ele é o
          // destino exato do voo (o byIid do diretor devolve null para Ação,
          // que vai para o discard — aí o ghost dissolve no centro).
          flight = move.type === "play" ? move.instanceId : undefined;
          // A origem do voo (rect + clone) é medida ANTES do commit: a mão some nele.
          const source = flight ? captureFx(flight, side) : undefined;
          const gone = captureGone(events.filter((event) => event.kind === "leave").map((event) => event.id));
          // "+N Æ" (colheita/bônus): o número voa do card que gerou ao placar.
          const amberEvent = events.find((event) => event.kind === "amber");
          const gained = amberEvent?.kind === "amber" && amberEvent.delta > 0 ? amberEvent : undefined;
          const chainEvent = events.find((event) => event.kind === "chains");
          const chains = chainEvent?.kind === "chains" && chainEvent.delta > 0 ? chainEvent : undefined;
          // O evento de dano já tem o formato que o diretor usa ({ id, amount }).
          const hits = events.filter((event) => event.kind === "damage") as { id: string; amount: number }[];
          // H3D-20: só no 3D real (o 2D e o 2.5D não ganham animação nova).
          const lunge = move.type === "fight" ? captureLunge(move.attackerId, move.targetId) : undefined;
          const actor = move.type === "fight" ? move.attackerId : "instanceId" in move ? move.instanceId : undefined;
          if (flight || gone.length || gained || chains || hits.length || lunge) {
            plan = {
              from: source,
              destId: flight,
              // O Warden joga da mão (fora do DOM): sem clone capturado, a face
              // desenha o ghost — é o que faz a Ação dele aparecer (FX-02).
              face: source && !source.node ? played?.face : undefined,
              // Sem slot (Ação) a carta fica mais tempo no centro; o Warden, mais
              // ainda — é a jogada que o jogador precisa ler.
              holdMs: Math.round((ai ? (flight ? 420 : 600) : flight ? 140 : 260) * (rush ? 0.45 : ai ? aiHoldScale(settingsRef.current.aiDelayMs) : 1)),
              gone,
              actorId: actor,
              amber: gained ? { side: gained.side, delta: gained.delta } : undefined,
              chains: chains ? { side: chains.side, delta: chains.delta } : undefined,
              hits,
              lunge,
              // A jogada do Warden leva legenda: o jogador sabe o que entrou na
              // mesa sem caçar a linha no log (UX review #1).
              caption: flight ? playCaption : undefined,
              // VAL-04: o thump do pouso acompanha o slam do voo, não o commit.
              onSlam: () => sound.play("land", 0.24),
            };
          }
        } else if (playCaption) {
          // Sem voo o ghost não nasce: a legenda estática do diretor a mantém.
          fxRef.current?.caption(playCaption);
        }
        // Som da jogada (VAL-04): com voo o `play` é só o whoosh e o pouso vira
        // o `land` no slam; sem voo o par whoosh+thump toca como sempre tocou.
        if (move.type === "fight") sound.play("fight");
        else if (move.type === "reap") sound.play("reap");
        else {
          sound.play("play");
          if (!flight) sound.play("land", 0.15);
        }
      }
      // O commit primeiro: ele cancela a revelação anterior (e zeraria o plano
      // recém-armado). O layout effect roda no render do setGame, depois daqui.
      commitGame(prev, next, step);
      if (!plan) return Promise.resolve();
      return new Promise<void>((resolve) => {
        fxPlanRef.current = { plan, resolve };
      });
    },
    [commitGame, t],
  );

  // A revelação roda aqui: o DOM novo já está montado e o paint ainda não
  // aconteceu — o diretor esconde o destino, mede e anima sem flash.
  useLayoutEffect(() => {
    const pending = fxPlanRef.current;
    fxPlanRef.current = null;
    if (!pending) return;
    const fx = fxRef.current;
    if (!fx) {
      pending.resolve();
      return;
    }
    void fx.run(pending.plan).then(pending.resolve, pending.resolve);
  }, [game]);

  // Each screen is a fresh page: without this the new screen opens at the
  // previous one's scroll offset (e.g. config mid-list, board without header).
  // Trocar de tela também derruba qualquer voo pendente (plano §0.5).
  useEffect(() => {
    window.scrollTo(0, 0);
    cancelFx();
  }, [screen, cancelFx]);

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
    // BUG2-10: the deck live with that state comes back too.
    return { anchor: anchor.state, step: anchor.step, at: index + 1, deck: anchor.deck, blocked: stack.slice(index + 1).some((entry) => entry.revealed) };
  }, []);

  const undoLastMove = useCallback(() => {
    // FEAT-13: undo does not exist in pass-and-play — rewinding past an end
    // turn would resurface the other player's hand.
    if (matchModeRef.current !== "solo") return;
    const info = undoInfo(gameRef.current);
    if (!info || info.blocked) return;
    sound.play("click");
    // O estado ancorado já é final: qualquer voo em curso é descartado.
    cancelFx();
    // FEAT-12b: the rewind also rolls the replay list back to the anchor, so a
    // later replay never applies moves the player undid. BUG2-07: the undo
    // history is truncated the same way — keeping the undone branch would let
    // the cap evict the turn-start anchor and rewind into a state that never
    // existed on the current line.
    stepsRef.current?.splice(info.step);
    historyRef.current.splice(info.at + 1);
    // BUG2-10: o deck volta junto — sem isso o undo devolvia as faces antigas
    // mas o título/revanche/W-L ficavam no deck sincronizado.
    currentDeckRef.current = info.deck;
    setCurrentDeck(info.deck);
    gameRef.current = info.anchor;
    setGame(info.anchor);
    setSelected(null);
    setPick(null);
  }, [undoInfo, cancelFx]);

  // Persist settings + language, and drive the audio engine prefs.
  useEffect(() => {
    saveSettings(settings);
    sound.setPrefs({ sfx: settings.sfx, music: settings.music && screen === "game" });
  }, [settings, screen]);

  useEffect(() => { saveLlmConfig(llm); }, [llm]);

  useEffect(() => {
    saveLanguage(language);
    setSettings((prev) => (prev.language === language ? prev : { ...prev, language }));
  }, [language]);

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
      settings: t("nav.config"),
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
    // ESCAPE HATCH (?swreset=1): cura manual de SW envenenado — produção E dev.
    // O dono abre o app com ?swreset=1 na URL (ex.: localhost:4173/?swreset=1):
    // desregistra TODOS os service workers, apaga TODOS os caches aember-arena-*,
    // tira o parâmetro da URL (history.replaceState) e recarrega UMA vez. A flag
    // "swreset-done" no sessionStorage evita loop caso o parâmetro persista; o
    // passe seguinte (sem o parâmetro) zera a flag e registra o worker limpo do
    // zero. Como usar: ver README ("PWA: atualização e recuperação").
    const swreset = new URLSearchParams(window.location.search).get("swreset") === "1";
    if (swreset) {
      void (async () => {
        try {
          const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
          await Promise.all(registrations.map((registration) => registration.unregister()));
          const keys = await caches.keys();
          await Promise.all(keys.filter((key) => key.startsWith("aember-arena-")).map((key) => caches.delete(key)));
        } catch {
          // Sem SW/caches o reload abaixo já devolve o app à rede.
        }
        const url = new URL(window.location.href);
        url.searchParams.delete("swreset");
        window.history.replaceState(null, "", url.pathname + url.search + url.hash);
        if (!sessionStorage.getItem("swreset-done")) {
          sessionStorage.setItem("swreset-done", "1");
          window.location.reload();
        } else {
          sessionStorage.removeItem("swreset-done");
        }
      })();
    } else {
      // Resíduo de um reset anterior: zera a flag para o PRÓXIMO ?swreset=1 recarregar.
      sessionStorage.removeItem("swreset-done");
    }
    // No passe do reset nada é registrado: o reload acima re-entra sem o parâmetro.
    if (!swreset && "serviceWorker" in navigator) {
      if (import.meta.env.DEV) {
        // Dev NÃO registra SW (e limpa o legado): módulos de dev não têm hash no
        // nome, então o stale-while-revalidate do worker serve módulo velho para
        // sempre — o jogo nunca "pega" a mudança de código (o index.html vem
        // fresco da rede, mas o JS vem do cache). Um SW de sessão anterior é
        // desregistrado, os caches aember-arena-* morrem e a página recarrega
        // uma vez; o sessionStorage evita o loop. Produção segue com o FEAT-09.
        void (async () => {
          try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            if (!registrations.length) return;
            await Promise.all(registrations.map((registration) => registration.unregister()));
            const keys = await caches.keys();
            await Promise.all(keys.filter((key) => key.startsWith("aember-arena-")).map((key) => caches.delete(key)));
            if (!sessionStorage.getItem("sw-dev-cleanup")) {
              sessionStorage.setItem("sw-dev-cleanup", "1");
              window.location.reload();
            } else {
              sessionStorage.removeItem("sw-dev-cleanup");
            }
          } catch {
            // Dev segue sem SW; o app funciona direto da rede.
          }
        })();
      } else {
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
              if (installing.state === "installed" && navigator.serviceWorker.controller) {
                setUpdateDismissed(false);
                setUpdateReady(true);
              }
            });
          });
        }).catch(() => undefined);
      }
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

  // DB v4 (plano §2/§3): rulesOf é síncrono, então o store `abilities` sobe para
  // um mapa em memória no boot. MERGE, não troca: um override gravado entre o
  // getAll() e este callback não pode ser perdido (a entrada da sessão vence).
  // O mesmo efeito lê a contagem do catálogo para o chip da Home/Vault.
  useEffect(() => {
    let disposed = false;
    void loadAbilityOverrides().then((overrides) => { if (disposed) return; mergeAbilityOverrides(overrides); mergeAbilityOverrides(vendoredOverrides()); });
    void countCatalogCards().then((count) => { if (!disposed) setCatalogCount(count); });
    return () => { disposed = true; };
  }, []);

  // Overrides só valem ENTRE partidas (plano §4 / recheck da onda 1): com uma
  // partida em curso o abilities.ts segura as escritas e este efeito as libera
  // na vitória; launch/retomada liberam antes de criar o estado.
  const matchLive = game !== null && game.winner === null;
  useEffect(() => {
    holdAbilityOverrides(matchLive);
    if (!matchLive) flushAbilityOverrides();
  }, [matchLive]);

  // Restore every deck cached in IndexedDB, plus the last one the player chose.
  useEffect(() => {
    let disposed = false;
    // Reload keeps the deck under inspection; the pointer is per-tab on purpose.
    const inspectId = readInspectPointer();
    if (inspectId) {
      void getCachedDeck(inspectId).then((deck) => {
        if (disposed) return;
        if (!deck) {
          writeInspectPointer(null);
          return;
        }
        setInspectDeck(deck);
        void getDeckStats(deck.id).then((stats) => { if (!disposed) setInspectStats(stats); });
        setScreen("inspect");
      });
    }
    void listCachedDecks().then((cached) => {
      if (disposed) return;
      setLibraryReady(true);
      if (!cached.length) return;
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
    if (!updateReady || updateDismissed) return;
    if (game?.winner === null) {
      setToast(null);
      return;
    }
    setToast({
      message: t("update.title"),
      kind: "success",
      sticky: true,
      onDismiss: () => setUpdateDismissed(true),
      action: { label: t("update.reload"), onClick: reloadForUpdate },
    });
  }, [updateReady, game?.winner, t, updateDismissed]);

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
      // VAL-03: a 3ª chave também decide o vencedor (game.ts:897), então forja e
      // stinger cairiam no mesmo frame: as duas fanfarras de metais embolam e as
      // últimas camadas do `win` eram descartadas no teto de 32 vozes. Quando há
      // vencedor só o stinger soa (a vitória nasce da forja); o flash visual da
      // forja continua nos dois casos.
      if (game.winner === null) sound.play("forge");
      if (settingsRef.current.animations) {
        fxRef.current?.forge(nextKeys.player > prevKeysRef.current.player ? 0 : 1);
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
    // BUG2-11: as configurações congeladas no início da partida, não as atuais.
    const { opponentMode, difficulty } = matchSetupRef.current ?? settingsRef.current;
    // H-22: o recorde da S9 sai depois da gravação (sem corrida); a v1 não usa o valor.
    void recordMatchResult(currentDeck.id, game.winner === 0, opponentMode, difficulty)
      .then(() => getDeckStats(currentDeck.id))
      .then((stats) => { if (stats) setMatchRecord({ version: matchVersion, stats }); });
  }, [game, matchVersion, currentDeck.id, matchMode]);

  // UX_REWRITE_PLAN §5 H-24: a máquina das dicas avança por transição observada do jogador (casa, carta,
  // troca de vez). A primeira observação de cada partida só guarda o ponto de partida.
  useEffect(() => {
    if (ui2 !== "2" || !game || game.winner !== null || replay || screen !== "game" || matchMode !== "solo") {
      coachPrevRef.current = null;
      return;
    }
    const next: CoachSnapshot = { activeHouse: game.activeHouse, cardsPlayed: game.players[0].cardsPlayed, yourTurn: game.activePlayer === 0 };
    const prev = coachPrevRef.current;
    coachPrevRef.current = next;
    if (!prev || coachRef.current === "done") return;
    const advanced = advanceCoach(coachRef.current, prev, next);
    if (advanced === coachRef.current) return;
    coachRef.current = advanced;
    writeCoach(advanced);
    setCoach(advanced);
  }, [ui2, game, replay, screen, matchMode]);

  // AI turn loop. FEAT-13: pass-and-play has no AI — the effect stays dormant.
  // Onda 2 (plano §3): cada ação vira uma BATIDA legível, com o cálculo feito
  // antes da espera, degradação graciosa por tempo e toque para acelerar. As
  // batidas são tempo, não movimento: valem igual no reduce-motion (UX #1.6).
  useEffect(() => {
    if (!game || screen !== "game" || matchMode === "passAndPlay") return;
    if (game.activePlayer !== 1 || game.winner !== null) {
      if (game.winner !== null || game.activePlayer === 0) setAiPhase("idle");
      return;
    }

    const turnKey = `${matchVersion}-${game.turn}-${game.activePlayer}`;
    if (aiTurnRef.current === turnKey) return;
    aiTurnRef.current = turnKey;
    let cancelled = false;
    let actions = 0;
    const delayMs = settingsRef.current.aiDelayMs;
    const k = delayK(delayMs);
    // A batida em curso é cancelável: o toque no board corta a espera agora.
    let wake: (() => void) | null = null;
    const sleep = (ms: number) => new Promise<void>((resolve) => {
      wake = resolve;
      window.setTimeout(resolve, ms);
    });
    /** Curva do plano §3: 1 nas 5 primeiras ações, -0.1 por ação até o piso — 0.75
        para quem pediu devagar (> 700ms), 0.45 no resto; o toque no board compacta
        na hora. `think` (pensar) escala no máx. 2x, as demais batidas por k. */
    const floor = delayMs > 700 ? 0.75 : 0.45;
    const tempo = () => (rushRef.current ? 0.45 : Math.max(floor, 1 - 0.1 * Math.max(0, actions - 5)));
    const beat = (ms: number, scale = k) => sleep(Math.round(ms * scale * tempo()));
    const rush = () => {
      rushRef.current = true;
      wake?.();
      cancelFx();
    };
    rushRef.current = false;
    // Só o toque no board acelera: rail, drawer, header e scrollbar não.
    const boardNode = document.querySelector(".game-screen .game-board");
    boardNode?.addEventListener("pointerdown", rush);

    const takeAiTurn = async () => {
      setAiPhase("thinking");
      await beat(aiThinkMs(settingsRef.current.difficulty), Math.min(k, 2));
      if (cancelled || !gameRef.current) return;

      let next = gameRef.current;
      // Resuming after leaving the board mid-turn: the house was already chosen.
      const house = next.activeHouse ?? chooseAiHouse(next, 1);
      const opening = chooseHouse(next, 1, house);
      sound.play("house");
      setAiPhase("acting");
      commitWithFx(next, opening, { kind: "house", side: 1, house }, undefined, 1);
      next = opening;
      // Archives sao opcionais: a heuristica decide depois da escolha da casa.
      if (shouldTakeArchives(next, 1) && isLegalMove(next, 1, { type: "takeArchives" })) {
        const taken = applyMove(next, 1, { type: "takeArchives" });
        commitGame(next, taken, { kind: "move", side: 1, move: { type: "takeArchives" } });
        next = taken;
      }
      const amberStart = next.players[1].amber;
      let plays = 0;
      await beat(AI_HOUSE_MS);
      if (cancelled) return;

      // No fixed cap: play until nothing is worth doing (safety cap against a
      // loop the evaluator cannot see an end to, BUG-12 was a hard 7).
      for (let action = 0; action < 40; action += 1) {
        const move = chooseAiMove(next, 1, house, settingsRef.current);
        if (!move) break;
        // PRE: quem vai agir acende antes de resolver (marca + pulso, plano §3).
        fxRef.current?.spot(move.type === "fight" ? move.attackerId : "instanceId" in move ? move.instanceId : undefined);
        await beat(AI_PRE[move.type]);
        if (cancelled) return;
        const applied = applyMove(next, 1, move);
        await commitWithFx(next, applied, { kind: "move", side: 1, move }, move, 1);
        if (cancelled) return;
        // Sem animação não houve voo: a batida vira pausa (mesmo ritmo).
        if (!motionEnabled(settingsRef.current.animations)) await beat(AI_HOLD);
        if (cancelled) return;
        fxRef.current?.spot();
        next = applied;
        actions += 1;
        if (move.type === "play") plays += 1;
        if (next.winner !== null) break;
        await beat(AI_GAP);
        if (cancelled) return;
      }

      if (!cancelled && next.winner === null) {
        await beat(AI_END_MS);
        if (cancelled) return;
        // Entrench (§4.2): o Warden segura toda criatura Entrench exausta antes
        // do ready step (16/16 impressões pagam por isso).
        const ended = endTurn(holdEntrench(next, 1), 1);
        // The Warden handing over is the player's turn starting.
        sound.play("turn");
        commitGame(next, ended, { kind: "end", side: 1 });
        // Resumo + banner: o jogador entende o turno sem abrir o log, e o resumo
        // fica na faixa do round até a primeira ação dele.
        setAiSummary(t("game.aiSummary", { cards: plays, amber: Math.max(0, ended.players[1].amber - amberStart), house: houseLabel(house, t) }));
        fxRef.current?.banner(t("game.yourTurn"));
      }
      setAiPhase("idle");
    };

    void takeAiTurn();
    return () => {
      cancelled = true;
      boardNode?.removeEventListener("pointerdown", rush);
      // Leaving the board mid-turn cancels the loop; clearing the marker lets
      // the effect resume the same turn from gameRef.current on return (BUG-03).
      aiTurnRef.current = null;
      setAiPhase("idle");
    };
  }, [game?.activePlayer, game?.turn, game?.winner, matchVersion, screen, commitWithFx, matchMode, cancelFx, t]);

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
  // BUG2-09: "intocada" é o estado que createMatch acabou de criar — o turno 1
  // dura até a IA devolver a vez (o `turn` só sobe quando o lado 0 volta), então
  // o que marca progresso é ter saído do mulligan (pendingMulligan 0) ou já ter
  // agido/jogado.
  function untouchedMatch(state: GameState): boolean {
    return state.turn === 1 && state.pendingMulligan === 0 && state.acted === 0 && state.played === 0;
  }

  function startMatch(deck: DeckInfo, opponent?: DeckInfo) {
    const current = gameRef.current;
    if (current && current.winner === null && (matchModeRef.current !== "solo" || !untouchedMatch(current) || currentDeck.id !== deck.id)) {
      sound.play("click");
      setPendingDeck({ mode: "solo", deck, opponent });
      return;
    }
    launchMatch(deck, opponent, "solo");
  }

  // FEAT-13: a pass-and-play match confirms the replacement the same way (the
  // second deck rides along in `opponent`). BUG2-09: o rival do 2P e o modo
  // também contam — trocar o deck do Jogador 2 reinicia o confronto.
  function startPassAndPlay(deck1: DeckInfo, deck2: DeckInfo) {
    const current = gameRef.current;
    if (
      current &&
      current.winner === null &&
      (matchModeRef.current !== "passAndPlay" || !untouchedMatch(current) || currentDeck.id !== deck1.id || opponentRef.current?.id !== deck2.id)
    ) {
      sound.play("click");
      setPendingDeck({ mode: "passAndPlay", deck: deck1, opponent: deck2 });
      return;
    }
    launchMatch(deck1, deck2, "passAndPlay");
  }

  // UX_REWRITE_PLAN §5 H-14: retoma a partida salva (a mesma ação do resume-bar da v1).
  function resumeSavedMatch() {
    if (!resumeMatch) return;
    sound.play("forge");
    const saved = resumeMatch.game as GameState;
    // BUG2-11: a partida retomada não guardou o setup; o estado ainda
    // prova o espelho pelo deck renomeado do Warden, o resto vem das
    // settings no momento da retomada.
    matchSetupRef.current = {
      difficulty: settingsRef.current.difficulty,
      opponentMode: saved.players[1].deckName === "Warden's mirror deck" ? "mirror" : settingsRef.current.opponentMode === "mirror" ? "deck" : settingsRef.current.opponentMode,
    };
    // FEAT-12a: a resumed match has no in-memory history to undo; its
    // step list stays null so replay stays off (BUG2-03).
    flushAbilityOverrides();
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
    setAiPhase("idle");
    setAiSummary(null);
    setMatchVersion((version) => version + 1);
    setScreen("game");
    setResumeMatch(null);
  }

  // UX_REWRITE_PLAN §5 H-14: "Jogar" (aba e Continuar). Com partida viva ou salva, continua;
  // sem ela, a aba só leva ao Lobby (o Jogar do Lobby é playDeck).
  function continueMatch() {
    if (resumeMatch) resumeSavedMatch();
    else if (game && game.winner === null) setScreen("game");
    else setScreen("home");
  }

  // UX_REWRITE_PLAN §5 H-14: Jogar com um deck, com as settings atuais. Usa só os caminhos
  // que o v1 já tem (startMatch / startPassAndPlay), e pede o abandono quando há save.
  // Em pass-and-play o deck escolhido é o Jogador 1 e o outro lado sai de resolvePassDecks.
  function playDeck(deck: DeckInfo) {
    setSelectedDeck(deck);
    if (settings.gameMode === "passAndPlay") {
      const [deck1, deck2] = resolvePassDecks(savedDecks, deck, { ...settings, deckP1Id: deck.id });
      setSettings((prev) => ({ ...prev, deckP1Id: deck1.id, deckP2Id: deck2.id }));
      if (resumeMatch) setPendingDeck({ mode: "passAndPlay", deck: deck1, opponent: deck2 });
      else startPassAndPlay(deck1, deck2);
      return;
    }
    // Um save que ainda não foi retomado é partida viva: trocá-lo pede confirmação.
    if (resumeMatch) {
      sound.play("click");
      setPendingDeck({ mode: "solo", deck });
      return;
    }
    startMatch(deck);
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
      // O baralho já sorteado na revisão; sem ele (deck trocado/removido) sorteia aqui.
      if (mode === "random") return pool.find((item) => item.id === randomRivalId) ?? drawDeck(pool) ?? deck;
    }
    return deck;
  }

  function launchMatch(deck: DeckInfo, opponent: DeckInfo | undefined, mode: GameMode) {
    // FEAT-08: every match gets a fresh random seed, shown on the winner panel
    // so the opening hands can be replayed.
    const seed = Math.floor(Math.random() * 4294967296);
    const rival = opponent ?? resolveOpponent(deck);
    // "Um baralho diferente a cada partida": o sorteio consumido não vale para a seguinte.
    if (mode === "solo") setRandomRivalId(undefined);
    cancelFx();
    // BUG2-11: registra a configuração com que a partida nasce; o modo efetivo
    // vira "mirror" quando o deck pedido caiu no espelho (removido/igual).
    matchSetupRef.current = { difficulty: settingsRef.current.difficulty, opponentMode: rival === deck ? "mirror" : settingsRef.current.opponentMode };
    // FEAT-13: a 2P match renames the sides at creation (no AI is coming).
    flushAbilityOverrides();
    const next = mode === "passAndPlay" ? createPassAndPlayMatch(deck, rival, { seed }) : createMatch(deck, rival, { seed });
    opponentRef.current = rival;
    // FEAT-12a: a new match starts a fresh undo history.
    historyRef.current = [];
    stepsRef.current = [];
    gameRef.current = next;
    prevKeysRef.current = { player: 0, ai: 0 };
    // FX-03: um toque acelerando o último turno do Warden não pode vazar o rush
    // para a partida seguinte (no 2P ele compactaria as batidas dos humanos).
    rushRef.current = false;
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
    setAiPhase("idle");
    setAiSummary(null);
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
    // "Choose a house" comes first (Lote 5 §5.1): the console picker offers the
    // houses and the move resumes here with `house` set.
    const houses = houseChoices(prev, side, move);
    if (houses.length) {
      sound.play("select");
      setPick({ move, ids: [], houses });
      return;
    }
    const choices = "target" in move && move.target ? [] : targetChoices(prev, side, move);
    if (choices.length > 1) {
      sound.play("select");
      setPick({ move, ids: choices });
      return;
    }
    // Lote 7: the second card, the "up to N" cards and the flank come after the first target.
    const prompt = pendingPrompt(prev, side, move);
    if (prompt) {
      sound.play("select");
      setPick({ move, ids: prompt.ids, kind: prompt.kind, max: prompt.max, chosen: [], modeChoice: prompt.choice });
      return;
    }
    // O resumo do turno do Warden morre na primeira ação do jogador.
    setAiSummary(null);
    // O som da jogada sai de dentro do commitWithFx (VAL-04: o pouso acompanha o voo).
    void commitWithFx(prev, applyMove(prev, side, move), { kind: "move", side, move }, move, side);
    setSelected(null);
    setPick(null);
  }, [commitWithFx]);

  const pickBoardCard = useCallback(
    (owner: 0 | 1, card: CardInstance) => {
      const live = gameRef.current;
      if (!live) return;
      const own = owner === humanSideOf(live, matchModeRef.current);
      if (pick) {
        if (pick.ids.includes(card.instanceId) && pick.kind === "target2") {
          performHumanMove({ ...pick.move, targets: [card.instanceId] });
          return;
        }
        if (pick.ids.includes(card.instanceId) && pick.kind === "targets") {
          const chosen = pick.chosen?.includes(card.instanceId) ? pick.chosen.filter((id) => id !== card.instanceId) : [...(pick.chosen ?? []), card.instanceId];
          if (pick.max !== undefined && chosen.length >= pick.max) performHumanMove({ ...pick.move, targets: chosen });
          else {
            sound.play("select");
            setPick({ ...pick, chosen });
          }
          return;
        }
        if (pick.ids.includes(card.instanceId)) {
          // A fight pick fills the defender first, then the ability target.
          const applied: GameMove =
            pick.move.type === "fight" && !pick.move.targetId
              ? { ...pick.move, targetId: card.instanceId }
              : ({ ...pick.move, target: card.instanceId } as GameMove);
          performHumanMove(applied);
          return;
        }
        // QA 07/out: com a escolha pendente, o clique numa carta FORA dos
        // elegíveis não abre o inspetor nem cancela a jogada (era o "o efeito não
        // faz nada" do QA: o pick morria em silêncio). O cancelamento vive no
        // banner/pill e no inspetor.
        return;
      }
      sound.play("select");
      setSelected({ zone: own ? "board" : "enemy", playerIndex: owner, instanceId: card.instanceId });
    },
    [pick, performHumanMove],
  );

  const pickMoveHouse = useCallback(
    (house: string) => {
      if (pick?.houses) performHumanMove({ ...pick.move, house } as GameMove);
    },
    [pick, performHumanMove],
  );

  const confirmPick = useCallback(() => {
    if (pick?.kind === "targets") performHumanMove({ ...pick.move, targets: pick.chosen ?? [] });
  }, [pick, performHumanMove]);

  const pickMode = useCallback(
    (mode: "a" | "b") => {
      if (pick?.kind === "mode") performHumanMove({ ...pick.move, mode } as GameMove);
    },
    [pick, performHumanMove],
  );

  const pickFlank = useCallback(
    (flank: "left" | "right") => {
      if (pick?.kind === "flank") performHumanMove({ ...pick.move, flank });
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

  /** Entrench (Lote 4 §4.2): alterna o hold de uma criatura do lado humano.
      Fora do GameMove de propósito — não gasta `acted`/Alpha; o undo cobre a
      mudança porque o estado anterior entra na pilha. */
  const toggleHoldCard = useCallback(
    (card: CardInstance) => {
      const live = gameRef.current;
      if (!live) return;
      const side = humanSideOf(live, matchModeRef.current);
      if (!live.players[side].board.includes(card)) return;
      sound.play("click");
      commitGame(live, setHold(live, side, card.instanceId, card.hold !== true));
    },
    [commitGame],
  );

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
    setAiSummary(null);
    // FEAT-12a: the state right after the house choice is the undo anchor — the
    // start of the turn, before any of the player's moves.
    commitGame(prev, chooseHouse(prev, side, house), { kind: "house", side, house });
  }, [commitGame]);

  // Archives: pegar e opcional ("may") — o botao do console so aparece quando o
  // move e legal, e o mesmo move entra no replay.
  const takeArchivesNow = useCallback(() => {
    const prev = gameRef.current;
    if (!prev) return;
    const side = humanSideOf(prev, matchModeRef.current);
    sound.play("click");
    commitGame(prev, applyMove(prev, side, { type: "takeArchives" }), { kind: "move", side, move: { type: "takeArchives" } });
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

  // UX_REWRITE_PLAN §5 H-23: o onboarding acaba quando o jogador joga guiado ou pula; não volta.
  function finishOnboarding() {
    markTutorialSeen();
    clearOnboarding();
    setOnboarding(null);
  }

  // UX_REWRITE_PLAN §5 H-24: "Pular dicas" encerra de qualquer passo e não volta (storage "done").
  function dismissCoach() {
    coachRef.current = skipCoach();
    writeCoach(coachRef.current);
    setCoach(coachRef.current);
  }

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

  async function syncCurrentDeck(inspected?: DeckInfo) {
    if (syncing) return;
    setSyncing(true);
    await updateAppShell();
    // Sync the deck the player is looking at — the match deck on the board, the
    // selected deck anywhere else — and never re-point the selection (BUG-05).
    // H-16: o Detalhe passa o deck que está aberto (pode não ser o selecionado).
    const target = inspected ?? (screen === "game" ? currentDeck : selectedDeck);
    try {
      const deck = await fetchKeyforgeDeck(target.id);
      if (inspected) setInspectDeck(deck);
      if (screen === "game") {
        setCurrentDeck(deck);
        // A live match reflects the fresh card data (refreshGameFaces had no
        // caller — BUG-21); the log entry comes from the engine itself.
        if (gameRef.current && gameRef.current.winner === null) {
          const next = refreshGameFaces(gameRef.current, deck);
          // BUG2-10: o Sync entra como passo do replay (o undo reverte o deck
          // pela ref paralela; aqui a ref ainda aponta o deck antigo).
          commitGame(gameRef.current, next, { kind: "sync", deck: deck.name });
        }
      } else if (target.id === selectedDeck.id) {
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

  /** DB v4 (plano §3/§5): sync incremental do catálogo, com progresso n/total e
      cancelamento entre páginas — o que já entrou no disco fica. */
  async function syncCatalogNow() {
    if (catalogSync) return;
    const controller = new AbortController();
    catalogAbortRef.current = controller;
    setCatalogSync({ done: 0, total: 0, cards: catalogCount });
    try {
      const summary = await syncCatalog({
        signal: controller.signal,
        onProgress: (progress) => setCatalogSync(progress),
      });
      setCatalogCount(summary.cards);
      showToast(
        summary.cancelled
          ? t("toast.catalogCancelled", { count: summary.added })
          : t("toast.catalogSynced", { count: summary.added }),
      );
    } catch (error) {
      showToast(vaultErrorText(error, t), "error");
    } finally {
      catalogAbortRef.current = null;
      setCatalogSync(null);
    }
  }

  /** Onda 2 (plano §4): dispara a fila de tradução LLM em background — uma
      carta por vez, cada resposta gravada na hora; o Cancelar aborta entre
      cartas. `known` vem do store (rascunhos e falhas contam: cache eterno por
      textHash). Nunca bloqueia a UI. */
  async function translateNow(faces?: DeckInfo["cards"]) {
    if (llmRun || !llmReady(llm)) return;
    const controller = new AbortController();
    llmAbortRef.current = controller;
    setLlmRun({ done: 0, total: 0, drafted: 0, failed: 0 });
    try {
      // Sem `faces` = catálogo inteiro; com `faces` = só as cartas dadas (os decks da partida).
      const [cards, overrides] = await Promise.all([faces ?? listCatalogCards(), loadAbilityOverrides()]);
      const progress = await runTranslation(pendingTranslations(cards, (id) => overrides.get(id)), llm, {
        limit: LLM_RUN_LIMIT,
        // 2 em paralelo = max_concurrency do proxy local do dono (metade do tempo por rodada).
        concurrency: 2,
        // `reply:` re-tentado: a tentativa anterior conta (§4.0).
        previous: (id) => translationTries(overrides.get(id)),
        save: putAbilityOverride,
        onProgress: setLlmRun,
        signal: controller.signal,
      });
      if (progress.total && !controller.signal.aborted) showToast(t("toast.llmDone", { drafted: progress.drafted, failed: progress.failed }), progress.drafted ? "success" : "error");
    } catch (error) {
      showToast(vaultErrorText(error, t), "error");
    } finally {
      llmAbortRef.current = null;
      setLlmRun(null);
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

  // H-17: playAfter = "Adicionar e jogar" (a folha v2); o v1 chama sem ele e só guarda.
  function useCandidateDeck(playAfter = false) {
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
    // Importing by id only precached (saved:false) and the deck vanished from
    // the library on reload; using it is what makes it a library deck.
    void cacheDeck(deck, { saved: true });
    setSelectedDeck(deck);
    setDeckCandidate(null);
    setDeckModalOpen(false);
    try {
      localStorage.setItem("aember-arena-last-deck", deck.id);
    } catch {
      // Deck is already cached in IndexedDB when available.
    }
    showToast(t("toast.deckReady", { name: deck.name }));
    if (playAfter) playDeck(deck);
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
    // H-16: o "voltar" do Detalhe devolve à tela de onde se veio (Lobby ou Decks).
    setInspectOrigin(screen === "browse" ? "browse" : "home");
    setScreen("inspect");
    writeInspectPointer(deck.id);
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
    if (readInspectPointer() === deck.id) writeInspectPointer(null);
    // The selection falls back to a bundled deck; a live match keeps its
    // in-memory faces and only loses the resume lookup for this deck.
    setSelectedDeck((prev) => (prev.id === deck.id ? DEMO_DECK : prev));
    showToast(t("toast.deckRemoved", { name: deck.name }));
  }

  const compactStage = useCompactStage();
  // FIT-05: abaixo de 1041px o rail é um drawer (o botão vive no console do board).
  const drawerMode = !useMedia("(min-width: 1041px)");
  const [railOpenRaw, setRailOpen] = useState(false);
  const drawerOpen = drawerMode && railOpenRaw && screen === "game";
  const railRef = useDialogFocus<HTMLElement>(drawerOpen);
  const [railConsoleSlot, setRailConsoleSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setRailOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);
  // No 2P o drawer nunca fica aberto por cima da mão do outro lado.
  useEffect(() => setRailOpen(false), [humanSide]);
  // H-09: o ☰ da casca de mesa abre o TableMenu (que agora leva a saída para o lobby e a visão 3D).
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const tableMenuTrigger = (
    <button
      type="button"
      className="view-toggle table-menu-trigger"
      aria-label={t("ui.table.menu")}
      aria-haspopup="dialog"
      aria-expanded={tableMenuOpen}
      onClick={() => { sound.play("click"); setTableMenuOpen(true); }}
    >
      <Menu size={16} />
    </button>
  );
  // H3D-01: atalho da visão da mesa — alterna sem sair da partida. 44px (regra 9),
  // estado no aria-pressed. Um nó só: na faixa de título ou, no perfil compacto, no console.
  const viewToggle = (
    <button
      type="button"
      className="view-toggle"
      aria-pressed={settings.tableView === "3d"}
      aria-label={t("game.view3dToggle")}
      onClick={toggleTableView}
    >
      <Box size={16} />
    </button>
  );

  // UX_REWRITE_PLAN §5 H-12/H-14: a partida viva (em memória ou salva) é o estado do botão Jogar.
  const resumeGame = resumeMatch ? (resumeMatch.game as GameState) : game && game.winner === null ? game : null;
  const resumeInfo = resumeGame ? resumeInfoOf(resumeGame, !resumeMatch && matchMode === "passAndPlay") : null;
  const pickedOpponent = settings.opponentDeckId ? savedDecks.find((item) => item.id === settings.opponentDeckId && item.id !== selectedDeck.id) : undefined;
  // No 2P a linha mostra o Jogador 2 (o solo não tem oponente de deck nesse modo).
  const passPair = settings.gameMode === "passAndPlay" ? resolvePassDecks(savedDecks, selectedDeck, settings) : null;
  const opponentLabel = passPair ? passPair[1].name : settings.opponentMode === "deck" && pickedOpponent
    ? pickedOpponent.name
    : settings.opponentMode === "random" ? (randomRival?.name ?? t("ui.match.random")) : t("ui.match.mirror");
  // H-07: com a v2, as telas que não são a partida trocam header/tab bar pela casca do lobby.
  const lobbyShell = ui2 === "2" && screen !== "game";
  // H-08: na partida a casca some (header e tab bar) e o palco recebe os pixels (tableShell.css).
  const tableShell = ui2 === "2" && screen === "game";
  // H-09: no desktop, Esc abre o ☰ quando nada mais pede a tecla. Com o menu aberto, a Sheet fecha.
  useEffect(() => {
    if (!tableShell || drawerMode || tableMenuOpen || exitConfirmOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || selected || pick || replay || document.querySelector('[aria-modal="true"]')) return;
      setTableMenuOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tableShell, drawerMode, tableMenuOpen, exitConfirmOpen, selected, pick, replay]);

  // H-05: a galeria de primitivas só existe com ?ui=2&screen=_kit; sem a flag o App é o de hoje.
  if (ui2 === "2" && new URLSearchParams(window.location.search).get("screen") === "_kit") {
    return <KitScreen t={t} />;
  }

  return (
    <div className="app-root" data-shell={tableShell ? "table" : undefined}>
      {lobbyShell && (
        <LobbyShell
          t={t}
          active={destinationOf(screen)}
          hasGame={resumeGame !== null}
          online={online}
          sfx={settings.sfx}
          brandMark={<ForgeMark />}
          languageMenu={<LanguageMenu language={language} onChange={(next) => { setLanguage(next); showToast(t("toast.langChanged")); }} label={t("nav.language")} compact />}
          onBrand={goHome}
          onPlay={() => { sound.play("click"); continueMatch(); }}
          onDecks={() => { sound.play("click"); setScreen("browse"); }}
          onSettings={() => { sound.play("click"); setScreen("settings"); }}
          onToggleSfx={() => { sound.play("click"); setSettings((prev) => ({ ...prev, sfx: !prev.sfx })); }}
        />
      )}
      {!lobbyShell && (
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
      )}

      {toast && (
        <div className={`toast-message toast-message--${toast.kind}`} role="status">
          {toast.kind === "success" ? <Check size={15} /> : <CircleHelp size={15} />}
          <span>{toast.message}</span>
          {toast.action && (
            <button type="button" className="toast-action" onClick={toast.action.onClick}>{toast.action.label}</button>
          )}
          <button type="button" onClick={() => { toast.onDismiss?.(); setToast(null); }} aria-label={t("common.close")}><X size={14} /></button>
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
          ui2={ui2 === "2"}
          title={t("error.title")}
          body={ui2 === "2" ? t("ui.error.body") : t("error.body")}
          action={ui2 === "2" ? t("ui.error.back") : t("error.back")}
        >
        {/* H-27 gate (?ui=2&crash=1, só em dev): o filho lança UMA vez — o reset remonta a
            fronteira e o probe sai, para provar o fallback sem apagar aember-arena-match. */}
        {import.meta.env.DEV && ui2 === "2" && boundaryEpoch === 0 && new URLSearchParams(window.location.search).get("crash") === "1" && <CrashProbe />}
        {screen === "home" && ui2 !== "2" && resumeMatch && (
          <button
            type="button"
            className="resume-bar"
            onClick={() => {
              resumeSavedMatch();
            }}
          >
            <KeyRound size={15} />
            {t("home.resumeMatch", { round: (resumeMatch.game as GameState).turn })}
          </button>
        )}
        {screen === "home" && ui2 !== "2" && canReplay && (
          <button type="button" className="resume-bar" onClick={openReplay}>
            <Eye size={15} /> {t("game.replayLast")}
          </button>
        )}
        {screen === "home" && ui2 === "2" && (
          <LobbyScreen
            t={t}
            selectedDeck={selectedDeck}
            savedDecks={uiState === "empty" ? STARTER_DECKS : savedDecks}
            starterIds={STARTER_IDS}
            resume={resumeInfo}
            lastRecord={deckRecord}
            opponentLabel={opponentLabel}
            canReplay={canReplay}
            loading={uiState === "loading"}
            onPlay={playDeck}
            onContinue={continueMatch}
            strength={presetOf(settings)}
            onStrength={(preset) => { sound.play("click"); setSettings((prev) => applyPreset(prev, preset)); }}
            onOpenMatchSheet={() => { sound.play("click"); setMatchSheetOpen(true); }}
            onSelectDeck={(deck) => { sound.play("select"); setSelectedDeck(deck); }}
            onInspect={openInspector}
            onImport={() => { sound.play("click"); openDeckModal(); }}
            onExplore={() => { sound.play("click"); setLibraryTab("vault"); setScreen("browse"); }}
            onToggleFavorite={toggleFavorite}
            onRemoveDeck={setDeckToRemove}
            onReplay={openReplay}
          />
        )}
        {screen === "home" && ui2 !== "2" && (
          <HomeScreen
            t={t}
            language={language}
            savedDecks={savedDecks}
            selectedDeck={selectedDeck}
            catalogCount={catalogCount}
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

        {screen === "browse" && ui2 === "2" && (
          <LibraryScreen
            t={t}
            savedDecks={savedDecks}
            starterIds={STARTER_IDS}
            selectedId={selectedDeck.id}
            tab={libraryTab}
            onTab={setLibraryTab}
            sort={librarySort}
            onSort={setLibrarySort}
            browse={browseState}
            onBrowse={setBrowseState}
            offline={!online}
            onInspect={openInspector}
            onPlay={playDeck}
            onToggleFavorite={toggleFavorite}
            onRemoveDeck={setDeckToRemove}
            onImport={() => { sound.play("click"); openDeckModal(); }}
          />
        )}

        {screen === "browse" && ui2 !== "2" && (
          <DeckBrowser
            t={t}
            state={browseState}
            onStateChange={setBrowseState}
            offline={!online}
            catalogCount={catalogCount}
            onBack={() => setScreen("home")}
            onInspect={openInspector}
            onUseDeck={(deck) => { adoptDeck(deck); setScreen("home"); }}
          />
        )}

        {screen === "inspect" && inspectDeck && ui2 === "2" && (
          <DeckDetail
            key={inspectDeck.id}
            t={t}
            deck={inspectDeck}
            selected={selectedDeck.id === inspectDeck.id}
            stats={inspectStats}
            syncing={syncing}
            onBack={() => { sound.play("click"); writeInspectPointer(null); setScreen(inspectOrigin); }}
            onPlay={(deck) => { if (!savedDecks.some((item) => item.id === deck.id)) adoptDeck(deck); playDeck(deck); }}
            onSync={() => void syncCurrentDeck(inspectDeck)}
          />
        )}

        {screen === "inspect" && inspectDeck && ui2 !== "2" && (
          <DeckInspector
            deck={inspectDeck}
            t={t}
            selected={selectedDeck.id === inspectDeck.id}
            stats={inspectStats}
            onBack={() => { sound.play("click"); writeInspectPointer(null); setScreen(savedDecks.some((item) => item.id === inspectDeck.id) ? "home" : "browse"); }}
            onUseDeck={() => { adoptDeck(inspectDeck); setScreen("config"); }}
          />
        )}

        {/* H-18: com a v2, Ajustes é a central nova (S7); a v1 segue com a ConfigScreen de sempre. */}
        {screen === "settings" && ui2 === "2" && (
          <SettingsScreen
            t={t}
            settings={settings}
            onChange={setSettings}
            hasHover={hasHover}
            languageMenu={<LanguageMenu language={language} onChange={setLanguage} label={t("nav.language")} />}
            formatDelay={(ms) => delaySeconds(ms, settings.language)}
            online={online}
            catalogCount={catalogCount}
            catalogSync={catalogSync}
            onSyncCatalog={() => { sound.play("click"); void syncCatalogNow(); }}
            onCancelCatalog={() => { sound.play("click"); catalogAbortRef.current?.abort(); }}
            onSyncDeck={() => { sound.play("click"); void syncCurrentDeck(); }}
            deckSyncing={syncing}
            updateReady={updateReady}
            onReloadUpdate={reloadForUpdate}
            llm={llm}
            onLlmChange={setLlm}
            llmRun={llmRun}
            onLlmTranslate={() => { sound.play("click"); void translateNow(); }}
            onLlmCancel={() => { sound.play("click"); llmAbortRef.current?.abort(); }}
            onOpenTutorial={() => { sound.play("click"); setTutorialOpen(true); }}
          />
        )}

        {(screen === "config" || (screen === "settings" && ui2 !== "2")) && (
          <ConfigScreen
            t={t}
            settings={settings}
            deck={selectedDeck}
            savedDecks={savedDecks}
            randomRival={randomRival}
            hasHover={hasHover}
            catalogCount={catalogCount}
            catalogSync={catalogSync}
            onSyncCatalog={() => { sound.play("click"); void syncCatalogNow(); }}
            onCancelCatalog={() => { sound.play("click"); catalogAbortRef.current?.abort(); }}
            llm={llm}
            onLlmChange={setLlm}
            llmRun={llmRun}
            onLlmTranslate={() => { sound.play("click"); void translateNow(); }}
            onLlmTranslateDeck={(faces) => { sound.play("click"); void translateNow(faces); }}
            onLlmCancel={() => { sound.play("click"); llmAbortRef.current?.abort(); }}
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
                    {/* BUG2-12: no 2P o título acompanha o lado ativo (o board gira junto). */}
                    <h1>{passAndPlay ? localizeName(game.players[humanSide].deckName, t) : currentDeck.name}</h1>
                  </div>
                  {/* H-08: no table shell o heading está oculto; o toggle migra para o console. */}
                  {!compactStage && !tableShell && <div className="match-actions">{viewToggle}</div>}
                </div>

                <GameBoard
                  game={game}
                  selected={selected}
                  pick={pick}
                  aiPhase={aiPhase}
                  aiSummary={aiSummary}
                  settings={settings}
                  t={t}
                  onHouse={choosePlayerHouse}
                  onPickHouse={pickMoveHouse}
                  onConfirmPick={confirmPick}
                  onPickFlank={pickFlank}
                  onPickMode={pickMode}
                  onCancelPick={() => setPick(null)}
                  onSelectHand={selectHandCard}
                  onPlayHand={(card) => performHumanMove({ type: "play", instanceId: card.instanceId })}
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
                  winnerPanel={ui2 !== "2"}
                  coachAnchors={ui2 === "2"}
                  ui2={ui2 === "2"}
                  onPassConfirm={() => { sound.play("click"); setPassPending(null); }}
                  viewSwitching={viewSwitching}
                  archivesAction={isLegalMove(game, humanSide, { type: "takeArchives" }) ? (
                    <button
                      type="button"
                      className="view-toggle archives-action"
                      onClick={takeArchivesNow}
                      aria-label={t("game.takeArchives", { count: game.players[humanSide].archives.length })}
                      title={t("game.takeArchives", { count: game.players[humanSide].archives.length })}
                    >
                      <BookOpen size={16} />
                      <span className="archives-count">{game.players[humanSide].archives.length}</span>
                    </button>
                  ) : undefined}
                  consoleSlot={drawerMode ? null : railConsoleSlot}
                  consoleExtra={tableShell ? (
                    <>
                      {/* H-09: no celular o console tem Undo + ☰ (as notas e a visão 3D estão no menu). */}
                      {drawerMode && !passAndPlay && (
                        <button type="button" className="view-toggle" aria-label={t("game.undo")} title={undo?.blocked ? t("game.undoBlocked") : t("game.undo")} onClick={undoLastMove} disabled={!undoable}>
                          <RotateCcw size={16} />
                        </button>
                      )}
                      {tableMenuTrigger}
                    </>
                  ) : compactStage || drawerMode ? (
                    <>
                      {compactStage && viewToggle}
                      {drawerMode && !passAndPlay && (
                        <button type="button" className="view-toggle" aria-label={t("game.undo")} title={undo?.blocked ? t("game.undoBlocked") : t("game.undo")} onClick={undoLastMove} disabled={!undoable}>
                          <RotateCcw size={16} />
                        </button>
                      )}
                      {drawerMode && (
                        <button type="button" className="view-toggle" aria-label={t("rail.open")} aria-expanded={drawerOpen} aria-controls="command-rail" onClick={() => { sound.play("click"); setRailOpen(true); }}>
                          <PanelRight size={16} />
                        </button>
                      )}
                    </>
                  ) : undefined}
                />
              </div>

              {drawerOpen && <button type="button" className="rail-backdrop" tabIndex={-1} aria-label={t("rail.close")} onClick={() => setRailOpen(false)} />}
              <aside
                id="command-rail"
                ref={railRef}
                className={`command-rail${drawerMode ? " command-rail--drawer" : ""}${drawerOpen ? " is-open" : ""}`}
                aria-label={t("rail.controls")}
                role={drawerOpen ? "dialog" : undefined}
                aria-modal={drawerOpen ? true : undefined}
              >
                <div className="rail-console-slot" ref={setRailConsoleSlot} />
                <div className="rail-topline">
                  <span>{t("rail.notes")}</span>
                  {drawerOpen ? (
                    <button type="button" className="quiet-icon-button rail-close" onClick={() => setRailOpen(false)} aria-label={t("rail.close")}><X size={14} /></button>
                  ) : (
                    <span className="table-number">01</span>
                  )}
                </div>
                <SelectedCardPanel
                  selection={selected}
                  card={selectedCard}
                  game={game}
                  pick={pick}
                  settings={settings}
                  t={t}
                  humanSide={humanSide}
                  onMove={performHumanMove}
                  onToggleHold={toggleHoldCard}
                  onFight={(decline) => {
                    const live = gameRef.current;
                    if (!selectedCard || !live) return;
                    sound.play("select");
                    const side = humanSideOf(live, matchModeRef.current);
                    setPick({
                      move: { type: "fight", attackerId: selectedCard.instanceId, targetId: "", decline },
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
                      {/* H-10: na casca de mesa do desktop o log inteiro cabe no espaço que sobra e rola por dentro. */}
                      {(tableShell && !drawerMode ? game.log : game.log.slice(-5)).slice().reverse().map((entry, index) => (
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
              ui2={ui2 === "2"}
              selected={null}
              pick={null}
              aiPhase="idle"
              aiSummary={null}
              settings={settings}
              t={t}
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

      {!lobbyShell && (
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
      )}

      {tableShell && game && (
        <TableMenu
          t={t}
          open={tableMenuOpen}
          onClose={() => setTableMenuOpen(false)}
          view3d={settings.tableView === "3d"}
          onToggleView={toggleTableView}
          sfx={settings.sfx}
          onToggleSfx={() => { sound.play("click"); setSettings((prev) => ({ ...prev, sfx: !prev.sfx })); }}
          music={settings.music}
          onToggleMusic={() => setSettings((prev) => ({ ...prev, music: !prev.music }))}
          aiDelayMs={passAndPlay ? undefined : settings.aiDelayMs}
          onAiDelay={(ms) => setSettings((prev) => ({ ...prev, aiDelayMs: ms }))}
          // Sem o rail-drawer (desktop) as notas já estão ao lado da mesa: a ação some.
          onOpenNotes={drawerMode ? () => setRailOpen(true) : undefined}
          onOpenLog={() => { setSelected(null); setPick(null); setLogOpen(true); if (drawerMode) setRailOpen(true); }}
          rules={(
            <>
              <p>{t("rail.rule1")}</p>
              <p>{t("rail.rule2")}</p>
              <p>{t("rail.rule3", { cost: keyCost(game, humanSide) })}</p>
            </>
          )}
          onTutorial={() => setTutorialOpen(true)}
          onExit={() => setExitConfirmOpen(true)}
        />
      )}

      {exitConfirmOpen && (
        <ConfirmDialog
          title={t("ui.table.exitTitle")}
          body={t("ui.table.exitBody")}
          confirmLabel={t("ui.table.exitConfirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => { setExitConfirmOpen(false); goHome(); }}
          onCancel={() => setExitConfirmOpen(false)}
        />
      )}

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

      {/* UX_REWRITE_PLAN §5 H-24: balão ancorado em data-coach; portal fixo, fora do fluxo (folga zero). */}
      {ui2 === "2" && coach !== "done" && screen === "game" && game && game.winner === null && !replay && (
        <Coachmark t={t} step={coach} onSkip={dismissCoach} />
      )}

      {/* UX_REWRITE_PLAN §5 H-22: o fim de partida da v2 (S9) é um portal no body — o palco 3D tem
          transform e um fixed dentro dele ficaria preso ao plano. */}
      {ui2 === "2" && screen === "game" && game && game.winner !== null && !replay && createPortal(
        <ResultScreen
          t={t}
          game={game}
          sideNames={[localizeName(game.players[0].name, t), localizeName(game.players[1].name, t)]}
          passAndPlay={passAndPlay}
          animate={settings.animations}
          record={matchRecord?.version === matchVersion ? matchRecord.stats : null}
          canReplay={canReplay}
          onRematch={rematch}
          onChooseDeck={() => { sound.play("click"); setLibraryTab("mine"); setScreen("browse"); }}
          onReplay={openReplay}
          onLobby={goHome}
        />,
        document.body,
      )}

      {ui2 === "2" && (
        <MatchSheet
          open={matchSheetOpen}
          t={t}
          onClose={() => setMatchSheetOpen(false)}
          deck={selectedDeck}
          savedDecks={savedDecks}
          settings={settings}
          randomRival={randomRival}
          opponentLabel={opponentLabel}
          onChange={setSettings}
          onPlay={(deck) => { setMatchSheetOpen(false); playDeck(deck); }}
        />
      )}

      {/* UX_REWRITE_PLAN §5 H-23: primeira visita (v2). Pular, Escape e "Jogar partida guiada" encerram; só o Home abre. */}
      {ui2 === "2" && onboarding !== null && screen === "home" && (
        <OnboardingFlow
          t={t}
          language={language}
          onLanguage={setLanguage}
          starters={STARTER_DECKS}
          selectedId={selectedDeck.id}
          step={onboarding}
          onStep={(next) => { saveOnboardingStep(next); setOnboarding(next); }}
          onPickDeck={setSelectedDeck}
          onGuidedPlay={(deck) => {
            finishOnboarding();
            setSettings((prev) => ({ ...prev, hints: true }));
            // H-24: a partida guiada começa no passo 1 das dicas.
            writeCoach("pickHouse");
            coachRef.current = "pickHouse";
            setCoach("pickHouse");
            playDeck(deck);
          }}
          onSkip={finishOnboarding}
        />
      )}

      {/* Never over a match: only Home and Settings open it. */}
      {tutorialOpen && (screen === "home" || screen === "config" || screen === "settings") && (
        <TutorialWizard
          t={t}
          houses={selectedDeck.houses}
          hintsToggle={<Toggle checked={settings.hints} label={t("config.experience.hints")} onChange={(value) => { if (value) sound.play("sparkle"); setSettings({ ...settings, hints: value }); }} />}
          onOpenVault={() => { markTutorialSeen(); setTutorialOpen(false); setScreen("browse"); }}
          onClose={() => { markTutorialSeen(); setTutorialOpen(false); }}
        />
      )}

      {deckModalOpen && ui2 === "2" && (
        <ImportSheet
          t={t}
          deckInput={deckInput}
          setDeckInput={setDeckInput}
          candidate={deckCandidate}
          loading={deckLoading}
          error={deckError}
          fromCache={deckFromCache}
          onFetch={(event) => void fetchDeck(event)}
          onAdd={() => useCandidateDeck(false)}
          onAddAndPlay={() => useCandidateDeck(true)}
          onClose={() => setDeckModalOpen(false)}
        />
      )}

      {deckModalOpen && ui2 !== "2" && (
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
          onUseDeck={() => useCandidateDeck(false)}
          onClose={() => setDeckModalOpen(false)}
        />
      )}

      {/* Onda 1: o portal onde a carta e os efeitos voam (fora do board, que
          tem overflow: hidden). O React só desenha o host vazio. */}
      <FxLayer ref={fxRef} />
    </div>
  );
}

export default App;
