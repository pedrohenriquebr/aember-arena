import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cpu,
  Crown,
  ExternalLink,
  Eye,
  Gem,
  Home,
  KeyRound,
  Languages,
  LoaderCircle,
  Music,
  Radio,
  RefreshCw,
  RotateCcw,
  Settings2,
  Shield,
  Sparkles,
  Sword,
  Swords,
  Volume2,
  VolumeX,
  Wand2,
  Wifi,
  WifiOff,
  X,
  Zap,
  ZoomIn,
} from "lucide-react";
import { chooseAiHouse, chooseAiMove, describeAiThinking, type Difficulty } from "./lib/ai";
import { cacheDeck, getCachedDeck, listCachedDecks } from "./lib/cache";
import { DEMO_DECK, DEMO_DECK_ID } from "./lib/demoDeck";
import { DEMO_DECK_2 } from "./lib/demoDeck2";
import {
  applyMove,
  chooseHouse,
  createMatch,
  endTurn,
  type CardInstance,
  type DeckInfo,
  type GameMove,
  type GameState,
  type LogEntry,
} from "./lib/game";
import { fetchKeyforgeDeck, loadDeckOrCache } from "./lib/keyforgeApi";
import { createTranslator, LANGUAGES, readLanguage, saveLanguage, type Language, type Translator } from "./lib/i18n";
import { readSettings, saveSettings, type AppSettings } from "./lib/settings";
import { sound } from "./lib/sound";
import { CardArt, CardLightbox, houseColor, houseLabel } from "./components/CardArt";
import { DeckTile, HouseMark } from "./components/DeckTile";
import { HouseIcon } from "./components/HouseIcon";
import { DeckBrowser } from "./components/DeckBrowser";
import { DeckInspector } from "./components/DeckInspector";
import { Pagination } from "./components/Pagination";

type Screen = "home" | "config" | "game" | "browse" | "inspect";
type Selection = { zone: "hand" | "board" | "enemy"; playerIndex: 0 | 1; instanceId: string };
type Toast = { message: string; kind: "success" | "error" } | null;

const DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard", "Very hard", "Impossible"];
const STARTER_DECKS: DeckInfo[] = [DEMO_DECK, DEMO_DECK_2];

// T5: hover só existe quando o dispositivo anuncia "(hover: hover)"; em touch o
// toggle hoverZoom some e a inspeção vai por long-press (CardLightbox).
function prefersHover() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: hover)").matches;
}

// Translate a structured log entry, localizing the two known player names.
function renderLog(entry: LogEntry, t: Translator): string {
  const localizeName = (name: string) =>
    name === "You" ? t("log.you") : name === "The Ember Warden" ? t("log.warden") : name;
  const params: Record<string, string> = { ...entry.params };
  if (params.name) params.name = localizeName(params.name);
  if (params.rival) params.rival = localizeName(params.rival);
  if (params.house) params.house = houseLabel(params.house, t);
  return t(entry.key, params);
}

// ---------- Small shared components ----------

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
      a.stunned === b.stunned)
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
  t,
  onClick,
}: CardTileProps) {
  const { face } = card;
  // T8: casa e tipo do aria-label passam por t() (houseLabel aceita tradutor opcional).
  const baseLabel = `${face.title}, ${houseLabel(face.house, t)} ${t(`type.${face.type}`)}`;
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const longPressAt = useRef(0);
  return (
    <>
      <button
        className={`card-tile card-tile--${size}${selected ? " is-selected" : ""}${dimmed ? " is-dimmed" : ""}${playAnim ? " card-tile--enter" : ""}`}
        type="button"
        onClick={() => {
          // T5: o long-press já abriu a inspeção — o click sintético do toque não seleciona.
          if (Date.now() - longPressAt.current < 700) return;
          onClick?.(card);
        }}
        disabled={disabled || !onClick}
        aria-label={stateLabel ? `${baseLabel}, ${stateLabel}` : baseLabel}
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
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
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
  onOpenImport,
  onOpenBrowse,
  onContinue,
  onLanguage,
}: {
  t: Translator;
  language: Language;
  savedDecks: DeckInfo[];
  selectedDeck: DeckInfo;
  onSelectDeck: (deck: DeckInfo) => void;
  onInspectDeck: (deck: DeckInfo) => void;
  onOpenImport: () => void;
  onOpenBrowse: () => void;
  onContinue: () => void;
  onLanguage: (language: Language) => void;
}) {
  const starterIds = new Set(STARTER_DECKS.map((deck) => deck.id));
  const extraSaved = savedDecks.filter((deck) => !starterIds.has(deck.id));
  const allDecks = [...STARTER_DECKS, ...extraSaved];
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
          {visible.map((deck, index) => (
            <span className="deck-grid-item" key={deck.id} style={{ animationDelay: `${index * 45}ms` }}>
              <DeckTile
                deck={deck}
                t={t}
                selected={selectedDeck.id === deck.id}
                tag={savedIds.has(deck.id) ? t("deck.savedOffline") : undefined}
                onSelect={() => onSelectDeck(deck)}
                onInspect={() => onInspectDeck(deck)}
              />
            </span>
          ))}
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

const CONFIG_STEPS = ["difficulty", "thinking", "experience", "review"] as const;
type ConfigStep = (typeof CONFIG_STEPS)[number];

function ConfigScreen({
  t,
  settings,
  deck,
  hasHover,
  onChange,
  onLanguage,
  onBack,
  onStart,
}: {
  t: Translator;
  settings: AppSettings;
  deck: DeckInfo;
  /** T5 — sem "(hover: hover)" o toggle hoverZoom não faz sentido e some. */
  hasHover: boolean;
  onChange: (settings: AppSettings) => void;
  onLanguage: (language: Language) => void;
  onBack: () => void;
  onStart: () => void;
}) {
  const [step, setStep] = useState<ConfigStep>("difficulty");
  const stepIndex = CONFIG_STEPS.indexOf(step);

  const goNext = () => {
    sound.play("click");
    if (stepIndex < CONFIG_STEPS.length - 1) setStep(CONFIG_STEPS[stepIndex + 1]);
    else onStart();
  };
  const goPrev = () => {
    sound.play("click");
    if (stepIndex > 0) setStep(CONFIG_STEPS[stepIndex - 1]);
    else onBack();
  };

  return (
    <div className="screen config-screen">
      <div className="config-head">
        <div>
          <span className="eyebrow">{t("config.title")}</span>
          <h1>{t("config.subtitle")}</h1>
        </div>
      </div>

      <div className="config-stepper">
        {CONFIG_STEPS.map((item, index) => (
          <button
            key={item}
            type="button"
            className={`config-step-pill${item === step ? " is-active" : ""}${index < stepIndex ? " is-done" : ""}`}
            onClick={() => setStep(item)}
          >
            <span className="config-step-num">{index < stepIndex ? <Check size={12} /> : index + 1}</span>
            <span>{t(`config.step.${item}`)}</span>
          </button>
        ))}
      </div>

      <div className="config-body">
        {step === "difficulty" && (
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

        {step === "thinking" && (
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

        {step === "experience" && (
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

        {step === "review" && (
          <section className="config-panel">
            <div className="config-panel-head">
              <h2>{t("config.review.title")}</h2>
              <p>{t("config.review.sub")}</p>
            </div>
            <div className="review-grid">
              <div className="review-card review-card--deck">
                <span className="review-label">{t("config.review.deck")}</span>
                <div className="review-deck">
                  <CardArt face={deck.cards[0]} size="preview" />
                  <div>
                    <strong>{deck.name}</strong>
                    <div className="deck-card-houses">
                      {deck.houses.map((house) => <HouseMark key={house} house={house} small />)}
                    </div>
                    <small>{deck.cards.length} {t("common.cards")}</small>
                  </div>
                </div>
              </div>
              <div className="review-card">
                <span className="review-label">{t("config.review.opponent")}</span>
                <ul className="review-list">
                  <li><span>{t("config.step.difficulty")}</span><strong>{t(`difficulty.${settings.difficulty}`)}</strong></li>
                  <li><span>{t("config.step.thinking")}</span><strong>{settings.thinkingDepth} / 6</strong></li>
                </ul>
              </div>
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
          {step === "review" ? t("home.play") : t("common.next")} <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

// ---------- Game screen pieces ----------

function AmberCounter({ amount, t }: { amount: number; t: Translator }) {
  return (
    <div className="amber-counter" aria-label={`${amount} ${t("inspector.amber")}`}>
      <Gem size={18} strokeWidth={1.8} />
      <span>{amount}</span>
      <small>{t("game.aember")}</small>
    </div>
  );
}

function KeyCounter({ keys, t }: { keys: number; t: Translator }) {
  return (
    // T4: os pips são o indicador (forjadas preenchidas); o texto "/ 3 KEYS"
    // saiu do DOM e vive no aria-label abaixo via t().
    <div className="key-counter" aria-label={`${keys} / 3 ${t("game.keys")}`}>
      <div className="key-pips">
        {[0, 1, 2].map((index) => (
          <KeyRound key={index} className={index < keys ? "key-pip is-forged" : "key-pip"} size={17} strokeWidth={1.8} />
        ))}
      </div>
      <span>{keys}</span>
    </div>
  );
}

type PlayerBandProps = {
  player: GameState["players"][number];
  isAi: boolean;
  active: boolean;
  thinking?: boolean;
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
    a.t === b.t &&
    a.player.name === b.player.name &&
    a.player.deckName === b.player.deckName &&
    a.player.amber === b.player.amber &&
    a.player.keys === b.player.keys &&
    a.player.houses.length === b.player.houses.length &&
    a.player.houses.every((house, index) => house === b.player.houses[index])
  );
}

const PlayerBand = memo(function PlayerBand({
  player,
  isAi,
  active,
  thinking = false,
  t,
}: PlayerBandProps) {
  return (
    <div className={`player-band${active ? " player-band--active" : ""}${isAi ? " player-band--ai" : ""}`}>
      <div className={`player-avatar${isAi ? " player-avatar--ai" : ""}`}>
        {isAi ? <Cpu size={18} strokeWidth={1.6} /> : <span>{t("common.you")}</span>}
        {active && <span className="avatar-live-dot" />}
      </div>
      <div className="player-copy">
        <div className="player-name-row">
          <strong>{player.name}</strong>
          {/* T4: indicador só-ícone; o texto ACTIVE/THINKING via t() fica no aria-label. */}
          {active && (
            <span className="active-turn-tag" role="img" aria-label={thinking ? t("game.thinkingTag") : t("game.active")}>
              <Zap size={11} strokeWidth={2.4} />
            </span>
          )}
        </div>
        <div className="player-deck-name">
          <span className="player-deck-label">{player.deckName}</span>
          <span className="player-house-list">
            {player.houses.map((house) => <HouseIcon key={house} house={house} size="xs" />)}
          </span>
        </div>
      </div>
      <div className="player-resources">
        <KeyCounter keys={player.keys} t={t} />
        <div className="resource-divider" />
        <AmberCounter amount={player.amber} t={t} />
      </div>
    </div>
  );
}, arePlayerBandPropsEqual);

type BoardLaneProps = {
  cards: CardInstance[];
  owner: 0 | 1;
  activeHouse: string | null;
  selectedId?: string;
  fightMode?: boolean;
  settings: AppSettings;
  t: Translator;
  onSelect: (card: CardInstance) => void;
};

// T7d: a lane só re-renderiza quando um input de render muda; `cards` muda de
// identidade a cada move (cloneGame), então a comparação é elemento a elemento
// via sameCardInstance.
function areBoardLanePropsEqual(a: BoardLaneProps, b: BoardLaneProps): boolean {
  if (
    a.owner !== b.owner ||
    a.activeHouse !== b.activeHouse ||
    a.selectedId !== b.selectedId ||
    a.fightMode !== b.fightMode ||
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
  activeHouse,
  selectedId,
  fightMode,
  settings,
  t,
  onSelect,
}: BoardLaneProps) {
  if (!cards.length) {
    return (
      <div className="empty-battleline">
        <span className="empty-orbit"><Shield size={17} strokeWidth={1.3} /></span>
        <span>{t("game.clearLine")}</span>
      </div>
    );
  }

  return (
    <div className={`board-lane${fightMode && owner === 1 ? " board-lane--targeting" : ""}`}>
      {cards.map((card) => {
        const canUse = owner === 0 && card.ready && !card.stunned && (!activeHouse || card.face.house === activeHouse);
        // T4: o estado da peça é indicador visual (borda/opacidade, index.css) +
        // aria-label via t(); não existe mais label de texto sob a carta.
        const stateLabel = card.stunned ? t("game.stunned") : card.ready ? t("game.ready") : t("game.resting");
        const stateClass = card.stunned ? " board-piece--stunned" : card.ready ? "" : " board-piece--resting";
        return (
          <div className={`board-piece${canUse ? " board-piece--ready" : ""}${stateClass}`} key={card.instanceId}>
            <CardTile
              card={card}
              size="board"
              selected={selectedId === card.instanceId}
              dimmed={fightMode && owner === 1 ? card.face.type !== "Creature" : false}
              hoverZoom={settings.hoverZoom}
              playAnim={settings.animations}
              stateLabel={stateLabel}
              t={t}
              damageLabel={card.damage > 0 ? `${card.damage} ${t("game.dmg")}` : undefined}
              onClick={onSelect}
            />
          </div>
        );
      })}
    </div>
  );
}, areBoardLanePropsEqual);

function GameBoard({
  game,
  selected,
  fightMode,
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
}: {
  game: GameState;
  selected: Selection | null;
  fightMode: boolean;
  aiThinking: boolean;
  settings: AppSettings;
  t: Translator;
  forgeFlash: boolean;
  onHouse: (house: string) => void;
  onSelectHand: (card: CardInstance) => void;
  onSelectBoard: (owner: 0 | 1, card: CardInstance) => void;
  onEndTurn: () => void;
  onRematch: () => void;
  onHome: () => void;
}) {
  const player = game.players[0];
  const ai = game.players[1];
  const isHumanTurn = game.activePlayer === 0 && game.winner === null;
  // T7d: closures estáveis por lane — sem identidade estável o memo de
  // BoardLane/CardTile não teria efeito.
  const selectOpponentCard = useCallback((card: CardInstance) => onSelectBoard(1, card), [onSelectBoard]);
  const selectPlayerCard = useCallback((card: CardInstance) => onSelectBoard(0, card), [onSelectBoard]);

  return (
    <section className={`game-board${settings.animations ? "" : " no-anim"}${forgeFlash ? " forge-flash" : ""}`} aria-label={t("game.board")}>
      <div className="felt-etching" aria-hidden="true" />
      <div className="board-content">
        <PlayerBand player={ai} isAi active={game.activePlayer === 1 && game.winner === null} thinking={aiThinking} t={t} />

        <section className="battle-zone battle-zone--opponent" aria-label={t("game.opponentLine")}>
          <div className="zone-heading">
            <span>{t("game.opponentLine")}</span>
            <span className="zone-card-count">{ai.board.length} {t("game.onTable")}</span>
          </div>
          <BoardLane
            cards={ai.board}
            owner={1}
            activeHouse={null}
            selectedId={selected?.zone === "enemy" ? selected.instanceId : undefined}
            fightMode={fightMode}
            settings={settings}
            t={t}
            onSelect={selectOpponentCard}
          />
        </section>

        <div className={`turn-console${isHumanTurn ? " turn-console--human" : ""}`}>
          <div className="turn-console-copy">
            <div className="round-kicker"><span className="round-dot" /> {t("game.round")} {String(game.turn).padStart(2, "0")}</div>
            <strong>{game.activePlayer === 0 ? t("game.yourTurn") : aiThinking ? t("game.thinking") : t("game.opponentTurn")}</strong>
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

        {fightMode && (
          <div className="fight-instruction" role="status">
            <Swords size={15} /> {t("game.chooseFight")}
          </div>
        )}

        <section className="battle-zone battle-zone--player" aria-label={t("game.yourLine")}>
          <div className="zone-heading">
            <span>{t("game.yourLine")}</span>
            <span className="zone-card-count">{player.board.length} {t("game.onTable")}</span>
          </div>
          <BoardLane
            cards={player.board}
            owner={0}
            activeHouse={game.activeHouse}
            selectedId={selected?.zone === "board" ? selected.instanceId : undefined}
            settings={settings}
            t={t}
            onSelect={selectPlayerCard}
          />
        </section>

        <PlayerBand player={player} isAi={false} active={game.activePlayer === 0 && game.winner === null} t={t} />

        <section className="hand-zone" aria-label={t("game.yourHand")}>
          <div className="hand-heading">
            <div>
              <span className="hand-title">{t("game.yourHand")}</span>
              <span className="hand-count">{player.hand.length} {t("common.cards").toUpperCase()}</span>
            </div>
            <span className="deck-count">{player.deck.length} {t("game.inDeck")}</span>
          </div>
          {game.activePlayer === 0 && !game.activeHouse && game.winner === null && (
            <div className="hand-prompt"><Zap size={13} /> {t("game.unlockHint")}</div>
          )}
          <div className="hand-track">
            {player.hand.map((card) => {
              const playable = Boolean(game.activeHouse && (card.face.house === game.activeHouse || card.face.isMaverick));
              return (
                <CardTile
                  key={card.instanceId}
                  card={card}
                  size="hand"
                  selected={selected?.zone === "hand" && selected.instanceId === card.instanceId}
                  dimmed={game.activePlayer === 0 && Boolean(game.activeHouse) && !playable}
                  hoverZoom={settings.hoverZoom}
                  playAnim={settings.animations}
                  t={t}
                  onClick={onSelectHand}
                />
              );
            })}
            {!player.hand.length && <div className="empty-hand">{t("game.handEmpty")}</div>}
          </div>
        </section>
      </div>

      {game.winner !== null && (
        <div className="winner-shade" role="dialog" aria-modal="true" aria-labelledby="winner-title">
          <div className="winner-panel">
            <div className="winner-emblem"><Crown size={23} /></div>
            <span className="eyebrow">{t("game.matchComplete")}</span>
            <h2 id="winner-title">{game.winner === 0 ? t("game.youWin") : t("game.aiWin")}</h2>
            <p>{game.winner === 0 ? t("game.youWinSub") : t("game.aiWinSub")}</p>
            <div className="winner-actions">
              <button type="button" className="cta-button" onClick={onRematch}><RotateCcw size={15} /> {t("game.rematch")}</button>
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
  fightMode,
  settings,
  t,
  onPlay,
  onReap,
  onFight,
  onUse,
  onCancelFight,
  onClear,
}: {
  selection: Selection | null;
  card: CardInstance | null;
  game: GameState;
  fightMode: boolean;
  settings: AppSettings;
  t: Translator;
  onPlay: () => void;
  onReap: () => void;
  onFight: () => void;
  onUse: () => void;
  onCancelFight: () => void;
  onClear: () => void;
}) {
  const isHumanTurn = game.activePlayer === 0 && game.winner === null;
  const activeForHouse = Boolean(card && game.activeHouse && (card.face.house === game.activeHouse || card.face.isMaverick));
  const canUseCard = Boolean(card && isHumanTurn && activeForHouse);
  const canActivateArtifact = Boolean(card && /(?:Action|Omni):/i.test(card.face.text));

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
              </div>
            </div>
          </div>
          <p className="selected-card-text">{card.face.text || t("inspector.noText")}</p>

          <div className="inspector-actions">
            {selection.zone === "hand" && (
              <button className="primary-action" type="button" disabled={!canUseCard} onClick={onPlay}>
                <Zap size={15} />
                {canUseCard ? t("inspector.play") : !isHumanTurn ? t("inspector.waitTurn") : !game.activeHouse ? t("inspector.chooseHouseFirst") : t("inspector.offHouse")}
              </button>
            )}
            {selection.zone === "board" && card.face.type === "Creature" && (
              <>
                <button className="primary-action" type="button" disabled={!canUseCard || !card.ready || card.stunned} onClick={onReap}>
                  <Gem size={15} /> {t("inspector.reap")}
                </button>
                {fightMode ? (
                  <button className="secondary-action" type="button" onClick={onCancelFight}>{t("inspector.cancelFight")}</button>
                ) : (
                  <button className="secondary-action" type="button" disabled={!canUseCard || !card.ready || card.stunned} onClick={onFight}>
                    <Swords size={15} /> {t("inspector.fight")}
                  </button>
                )}
              </>
            )}
            {selection.zone === "board" && card.face.type === "Artifact" && (
              <button className="primary-action" type="button" disabled={!canUseCard || !card.ready || card.stunned || !canActivateArtifact} onClick={onUse}>
                <Zap size={15} /> {canActivateArtifact ? t("inspector.use") : t("inspector.passive")}
              </button>
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
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-panel deck-modal" role="dialog" aria-modal="true" aria-labelledby="deck-modal-title">
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

// ---------- App ----------

function App() {
  const [language, setLanguage] = useState<Language>(readLanguage);
  const [settings, setSettings] = useState<AppSettings>(() => readSettings(readLanguage()));
  const [hasHover] = useState(prefersHover);
  const t = useMemo(() => createTranslator(language), [language]);

  const [screen, setScreen] = useState<Screen>("home");
  const [selectedDeck, setSelectedDeck] = useState<DeckInfo>(DEMO_DECK);
  const [inspectDeck, setInspectDeck] = useState<DeckInfo | null>(null);
  const [savedDecks, setSavedDecks] = useState<DeckInfo[]>(STARTER_DECKS);
  const [currentDeck, setCurrentDeck] = useState<DeckInfo>(DEMO_DECK);
  const [game, setGame] = useState<GameState | null>(null);

  const [selected, setSelected] = useState<Selection | null>(null);
  const [fightMode, setFightMode] = useState(false);
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

  const gameRef = useRef<GameState | null>(null);
  const settingsRef = useRef(settings);
  const aiTurnRef = useRef("");
  const prevKeysRef = useRef({ player: 0, ai: 0 });

  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

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

  // Keep <html lang> in sync with the active language (settings.language).
  useEffect(() => {
    document.documentElement.lang = settings.language === "ptBR" ? "pt-BR" : "en";
  }, [settings.language]);

  useEffect(() => {
    void cacheDeck(DEMO_DECK);
    void cacheDeck(DEMO_DECK_2);
    if ("serviceWorker" in navigator) {
      // T7c/T8: caminho relativo — coerente com SHELL_URLS/manifest; não quebra em subpath.
      navigator.serviceWorker.register("./sw.js").catch(() => undefined);
    }
    const setNetwork = () => setOnline(navigator.onLine);
    window.addEventListener("online", setNetwork);
    window.addEventListener("offline", setNetwork);
    // Unlock audio on the first gesture.
    const unlock = () => sound.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => {
      window.removeEventListener("online", setNetwork);
      window.removeEventListener("offline", setNetwork);
      window.removeEventListener("pointerdown", unlock);
    };
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

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

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
      setFightMode(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, deckModalOpen]);

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
    if (game.winner === 0) sound.play("win");
    else if (game.winner === 1) sound.play("lose");
  }, [game?.players[0].keys, game?.players[1].keys, game?.winner]);

  // AI turn loop.
  useEffect(() => {
    if (!game || screen !== "game") return;
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
      const house = chooseAiHouse(next, 1);
      next = chooseHouse(next, 1, house);
      sound.play("house");
      gameRef.current = next;
      setGame(next);

      for (let action = 0; action < 7; action += 1) {
        await wait(settingsRef.current.difficulty === "Impossible" ? 460 : 340);
        if (cancelled) return;
        const move = chooseAiMove(next, 1, house, settingsRef.current);
        if (!move) break;
        next = applyMove(next, 1, move);
        sound.play(move.type === "fight" ? "fight" : move.type === "reap" ? "reap" : "play");
        gameRef.current = next;
        setGame(next);
        if (next.winner !== null) break;
      }

      if (!cancelled && next.winner === null) {
        await wait(260);
        if (cancelled) return;
        next = endTurn(next, 1);
        sound.play("endTurn");
        gameRef.current = next;
        setGame(next);
      }
      setAiThinking(false);
    };

    void takeAiTurn();
    return () => { cancelled = true; };
  }, [game?.activePlayer, game?.turn, game?.winner, matchVersion, screen]);

  const selectedCard = useMemo(() => {
    if (!selected || !game) return null;
    const player = game.players[selected.playerIndex];
    const cards = selected.zone === "hand" ? player.hand : player.board;
    return cards.find((card) => card.instanceId === selected.instanceId) ?? null;
  }, [game, selected]);

  function showToast(message: string, kind: "success" | "error" = "success") {
    setToast({ message, kind });
  }

  function startMatch(deck: DeckInfo) {
    const next = createMatch(deck, deck);
    gameRef.current = next;
    prevKeysRef.current = { player: 0, ai: 0 };
    setCurrentDeck(deck);
    setGame(next);
    setSelected(null);
    setFightMode(false);
    setAiThinking(false);
    setMatchVersion((version) => version + 1);
    setScreen("game");
    sound.play("forge");
  }

  // T7d: handlers quentes do board em useCallback — a identidade estável é o que
  // efetiva o memo de GameBoard→BoardLane→CardTile (só leem refs/setters estáveis).
  const performHumanMove = useCallback((move: GameMove) => {
    if (!gameRef.current) return;
    sound.play(move.type === "fight" ? "fight" : move.type === "reap" ? "reap" : move.type === "use" ? "play" : "play");
    const next = applyMove(gameRef.current, 0, move);
    gameRef.current = next;
    setGame(next);
    setSelected(null);
    setFightMode(false);
  }, []);

  const pickBoardCard = useCallback(
    (owner: 0 | 1, card: CardInstance) => {
      if (owner === 1 && fightMode && selected?.zone === "board" && selected.playerIndex === 0) {
        if (card.face.type === "Creature") performHumanMove({ type: "fight", attackerId: selected.instanceId, targetId: card.instanceId });
        return;
      }
      sound.play("select");
      setSelected({ zone: owner === 0 ? "board" : "enemy", playerIndex: owner, instanceId: card.instanceId });
    },
    [fightMode, selected, performHumanMove],
  );

  const endHumanTurn = useCallback(() => {
    if (!gameRef.current) return;
    sound.play("endTurn");
    const next = endTurn(gameRef.current, 0);
    gameRef.current = next;
    setGame(next);
    setSelected(null);
    setFightMode(false);
  }, []);

  const choosePlayerHouse = useCallback((house: string) => {
    if (!gameRef.current) return;
    sound.play("house");
    const next = chooseHouse(gameRef.current, 0, house);
    gameRef.current = next;
    setGame(next);
  }, []);

  const selectHandCard = useCallback((card: CardInstance) => {
    sound.play("select");
    setSelected({ zone: "hand", playerIndex: 0, instanceId: card.instanceId });
  }, []);

  const rematch = useCallback(() => startMatch(currentDeck), [currentDeck]);

  const goHome = useCallback(() => {
    sound.play("click");
    setScreen("home");
  }, []);

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
    try {
      const deck = await fetchKeyforgeDeck(currentDeck.id);
      setCurrentDeck(deck);
      setSelectedDeck(deck);
      setSavedDecks((prev) => prev.map((item) => (item.id === deck.id ? deck : item)));
      showToast(t("toast.synced", { name: deck.name, count: deck.cards.length }));
    } catch (error) {
      const cached = await getCachedDeck(currentDeck.id);
      if (cached) showToast(t("toast.usingCache", { name: cached.name }));
      else showToast(error instanceof Error ? error.message : t("toast.syncFailed"), "error");
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
      setDeckError(error instanceof Error ? error.message : t("toast.syncFailed"));
      sound.play("error");
    } finally {
      setDeckLoading(false);
    }
  }

  function useCandidateDeck() {
    if (!deckCandidate) return;
    const deck = deckCandidate;
    setSavedDecks((prev) => (prev.some((item) => item.id === deck.id) ? prev.map((item) => (item.id === deck.id ? deck : item)) : [...prev, deck]));
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
    setScreen("inspect");
  }

  // Adopt a deck from the vault or inspector without leaving the current screen flow.
  function adoptDeck(deck: DeckInfo) {
    sound.play("select");
    setSavedDecks((prev) => (prev.some((item) => item.id === deck.id) ? prev.map((item) => (item.id === deck.id ? deck : item)) : [...prev, deck]));
    setSelectedDeck(deck);
    try {
      localStorage.setItem("aember-arena-last-deck", deck.id);
    } catch {
      // The deck is already cached in IndexedDB when available.
    }
    showToast(t("toast.deckReady", { name: deck.name }));
  }

  const currentTurnLabel = !game
    ? ""
    : game.winner !== null
      ? t("game.matchComplete")
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
          <span className="brand-symbol"><Sparkles size={19} strokeWidth={1.8} /></span>
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
          <button type="button" onClick={() => setToast(null)} aria-label={t("common.close")}><X size={14} /></button>
        </div>
      )}

      <main className="app-main">
        {screen === "home" && (
          <HomeScreen
            t={t}
            language={language}
            savedDecks={savedDecks}
            selectedDeck={selectedDeck}
            onSelectDeck={(deck) => { sound.play("select"); setSelectedDeck(deck); }}
            onInspectDeck={openInspector}
            onOpenImport={() => { sound.play("click"); openDeckModal(); }}
            onOpenBrowse={() => { sound.play("click"); setScreen("browse"); }}
            onContinue={() => { sound.play("click"); setScreen("config"); }}
            onLanguage={(next) => { setLanguage(next); showToast(t("toast.langChanged")); }}
          />
        )}

        {screen === "browse" && (
          <DeckBrowser
            t={t}
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
            onBack={() => { sound.play("click"); setScreen(savedDecks.some((item) => item.id === inspectDeck.id) ? "home" : "browse"); }}
            onUseDeck={() => { adoptDeck(inspectDeck); setScreen("config"); }}
          />
        )}

        {screen === "config" && (
          <ConfigScreen
            t={t}
            settings={settings}
            deck={selectedDeck}
            hasHover={hasHover}
            onChange={setSettings}
            onLanguage={setLanguage}
            onBack={() => setScreen("home")}
            onStart={() => startMatch(selectedDeck)}
          />
        )}

        {screen === "game" && game && (
          <div className="screen game-screen">
            <div className="workspace">
              <div className="main-column">
                <div className="match-heading">
                  <div>
                    <div className="match-eyebrow"><span>{t("game.eyebrow")}</span><span className="eyebrow-line" /><span>{t("game.table")}</span></div>
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
                  fightMode={fightMode}
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
                />
              </div>

              <aside className="command-rail" aria-label={t("rail.controls")}>
                <div className="rail-topline"><span>{t("rail.notes")}</span><span className="table-number">01</span></div>
                <SelectedCardPanel
                  selection={selected}
                  card={selectedCard}
                  game={game}
                  fightMode={fightMode}
                  settings={settings}
                  t={t}
                  onPlay={() => selectedCard && performHumanMove({ type: "play", instanceId: selectedCard.instanceId })}
                  onReap={() => selectedCard && performHumanMove({ type: "reap", instanceId: selectedCard.instanceId })}
                  onFight={() => { sound.play("select"); setFightMode(true); }}
                  onUse={() => selectedCard && performHumanMove({ type: "use", instanceId: selectedCard.instanceId })}
                  onCancelFight={() => setFightMode(false)}
                  onClear={() => { setSelected(null); setFightMode(false); }}
                />

                <section className="ai-brief">
                  <span className="ai-avatar"><Cpu size={17} /></span>
                  <div className="ai-brief-copy">
                    <span className="section-label">{t("rail.warden")}</span>
                    <strong>{describeAiThinking({ difficulty: settings.difficulty, thinkingDepth: settings.thinkingDepth })}</strong>
                  </div>
                  <button type="button" onClick={() => { sound.play("click"); setScreen("config"); }} aria-label={t("nav.config")}><Settings2 size={15} /></button>
                </section>

                <section className="log-section">
                  <div className="section-label-row">
                    <span className="section-label">{t("rail.matchLog")}</span>
                    <span className="log-live"><span /> {t("rail.live")}</span>
                  </div>
                  <div className="match-log">
                    {game.log.slice(-5).reverse().map((entry, index) => (
                      <div className={`log-entry${index === 0 ? " log-entry--latest" : ""}`} key={`${entry.key}-${index}-${game.log.length}`}>
                        <span className="log-marker" />
                        <p>{renderLog(entry, t)}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <details className="quick-rules">
                  <summary><span><CircleHelp size={15} /> {t("rail.quickRules")}</span><ChevronRight size={14} className="rules-chevron" /></summary>
                  <div className="rules-copy">
                    <p>{t("rail.rule1")}</p>
                    <p>{t("rail.rule2")}</p>
                    <p>{t("rail.rule3")}</p>
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
