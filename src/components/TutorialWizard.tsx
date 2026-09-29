import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Gem, KeyRound, RotateCcw, Search, Swords, X, Zap } from "lucide-react";
import type { Translator } from "../lib/i18n";
import { HouseMark } from "./DeckTile";
import { useDialogFocus } from "./useDialogFocus";

const SEEN_KEY = "aember-arena-tutorial-seen";
const STEPS = ["welcome", "houses", "board", "actions", "mulligan", "research", "ready"] as const;
const WIKI_URL = "https://archonarcana.com/";
// The Inspector's filter chips; the gold "ghost" state marks the cited element.
const chip = (lit: unknown) => (lit ? "filter-chip filter-chip--ghost is-active" : "filter-chip");

/** First real visit: no tutorial flag and no saved settings. Existing players
    (and the seeded e2e profiles) already have settings, so they are not
    ambushed by the wizard; they can still open it from Home or Settings. */
export function isFirstVisit(): boolean {
  try {
    return !localStorage.getItem(SEEN_KEY) && !localStorage.getItem("aember-arena-settings");
  } catch {
    return false;
  }
}

export function markTutorialSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Without storage the wizard simply may show again next visit.
  }
}

export function TutorialWizard({
  t,
  houses,
  hintsToggle,
  onOpenVault,
  onClose,
}: {
  t: Translator;
  /** Houses of the selected deck, so the houses step shows the player's own. */
  houses: string[];
  /** The Settings hints switch, reused as-is (FEAT-04). */
  hintsToggle: ReactNode;
  onOpenVault: () => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const step = STEPS[index];
  const last = index === STEPS.length - 1;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [title, ...lines] = t(`tutorial.${step}`).split("|");
  const progress = t("game.replayStep", { step: index + 1, total: STEPS.length });
  const keys = [0, 1, 2].map((key) => <span key={key} className={chip(last || !key)}><KeyRound size={16} /></span>);
  // Miniature of the board element each step talks about, the cited one lit
  // (no coupling to the live DOM, which sits behind the backdrop).
  const visual: Record<(typeof STEPS)[number], ReactNode> = {
    welcome: [<span key="a" className={chip(1)}><Gem size={14} /> 6</span>, ...keys],
    houses: houses.slice(0, 3).map((house, item) => <span key={house} className={chip(!item)}><HouseMark house={house} small /></span>),
    board: [0, 1, 2, 3].map((slot) => <span key={slot} className={chip(slot % 3 === 0)}>{slot % 3 ? "·" : t("tutorial.flank")}</span>),
    actions: [
      <span key="r" className={chip(1)}><Gem size={14} /> {t("log.type.reap")}</span>,
      <span key="f" className={chip(0)}><Swords size={14} /> {t("log.type.fight")}</span>,
      <span key="u" className={chip(0)}><Zap size={14} /> {t("log.type.use")}</span>,
    ],
    mulligan: <span className={chip(1)}><RotateCcw size={14} /> {t("game.mulliganTake")}</span>,
    research: <span className={chip(1)}><Search size={14} /> Master Vault</span>,
    ready: keys,
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      else if (event.key === "ArrowRight") setIndex((value) => Math.min(STEPS.length - 1, value + 1));
      else if (event.key === "ArrowLeft") setIndex((value) => Math.max(0, value - 1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-panel confirm-panel" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
        <div className="modal-heading">
          <span className="eyebrow">{progress}</span>
          <button className="modal-close" type="button" onClick={onClose} aria-label={t("tutorial.skip")}><X size={18} /></button>
        </div>
        <div className="tutorial-progress" role="progressbar" aria-label={progress} aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={index + 1}>
          <span style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
        </div>

        <div className="tutorial-body" key={step}>
          <div className="tutorial-visual" aria-hidden="true">{visual[step]}</div>
          <h2 id="tutorial-title">{title}</h2>
          {lines.map((line) => <p key={line}>{line}</p>)}
          {step === "mulligan" && (
            <div className="exp-row">
              <div className="exp-copy"><small>{t("config.experience.hintsSub")}</small></div>
              {hintsToggle}
            </div>
          )}
          {step === "research" && (
            <div className="confirm-actions">
              <button type="button" className="ghost-button" onClick={onOpenVault}>
                <Search size={15} /> {t("home.browseVault")}
              </button>
              <a className="ghost-button" href={WIKI_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={15} /> Archon Arcana
              </a>
            </div>
          )}
        </div>

        <div className="confirm-actions">
          <button type="button" className="ghost-button" onClick={() => setIndex(index - 1)} disabled={!index} aria-label={t("common.back")}>
            <ChevronLeft size={16} />
          </button>
          {/* One element for Next and Finish, so keyboard focus survives the last step. */}
          <button type="button" className="cta-button" onClick={last ? onClose : () => setIndex(index + 1)}>
            {last ? t("tutorial.finish") : t("common.next")} {last ? <KeyRound size={15} /> : <ChevronRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
