import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, Play } from "lucide-react";
import { useDialogFocus } from "../../../components/useDialogFocus";
import type { DeckInfo } from "../../../lib/game";
import { LANGUAGES, type Language, type Translator } from "../../../lib/i18n";
import type { OnboardingStep } from "../../lib/onboarding";
import { Button } from "../../primitives/Button";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { cx } from "../../primitives/cx";
import { DeckHero } from "../lobby/DeckHero";

// UX_REWRITE_PLAN §2 S1 / §5 H-23: o primeiro contato. Passo 1 = marca + idioma (aplica na hora);
// passo 2 = escolher o arquétipo (um dos dois starters, já marcado) e jogar a partida guiada.
// Os coachmarks da partida são o H-24; aqui "Jogar partida guiada" só entrega a mesa.

const ARROW_STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export interface OnboardingFlowProps {
  t: Translator;
  language: Language;
  onLanguage: (language: Language) => void;
  starters: DeckInfo[];
  /** Starter já marcado (o deck selecionado do app). */
  selectedId: string;
  step: OnboardingStep;
  onStep: (step: OnboardingStep) => void;
  onPickDeck: (deck: DeckInfo) => void;
  onGuidedPlay: (deck: DeckInfo) => void;
  /** Pular e Escape: encerra sem partida guiada. */
  onSkip: () => void;
}

export function OnboardingFlow({ t, language, onLanguage, starters, selectedId, step, onStep, onPickDeck, onGuidedPlay, onSkip }: OnboardingFlowProps) {
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const skipRef = useRef(onSkip);
  skipRef.current = onSkip;
  const [picked, setPicked] = useState(selectedId);
  const deck = starters.find((item) => item.id === picked) ?? starters[0];

  // O foco acompanha o título a cada passo: o botão que o levou ao passo novo já saiu do DOM.
  useEffect(() => { titleRef.current?.focus(); }, [step]);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") skipRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const choose = (next: DeckInfo) => {
    setPicked(next.id);
    onPickDeck(next);
  };
  // Radiogroup (padrão do ThemePicker): setas trocam e marcam; o foco vai com a marcação.
  const onRadioKey = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    const move = ARROW_STEP[event.key];
    if (!move) return;
    event.preventDefault();
    const next = (index + move + starters.length) % starters.length;
    choose(starters[next]);
    const group = event.currentTarget.parentElement;
    (group?.children[next] as HTMLElement | undefined)?.focus();
  };

  return (
    <div className="nf-onb-shade" data-screen="onboarding" data-onboarding-step={step}>
      <div ref={dialogRef} className="nf-onb" role="dialog" aria-modal="true" aria-labelledby="nf-onb-title">
        <p className="nf-onb-progress">{t("ui.onboarding.progress", { step, total: 2 })}</p>
        <h1 id="nf-onb-title" ref={titleRef} tabIndex={-1} className="nf-onb-title">
          {step === 1 ? t("ui.onboarding.welcomeTitle") : t("ui.onboarding.pickTitle")}
        </h1>
        <p className="nf-onb-body">{step === 1 ? t("ui.onboarding.welcomeBody") : t("ui.onboarding.pickBody")}</p>

        {step === 1 && (
          <>
            <SegmentedControl
              label={t("nav.language")}
              value={language}
              options={LANGUAGES.map((item) => ({ value: item.id, label: `${item.flag} ${item.short}` }))}
              onChange={onLanguage}
            />
            <div className="nf-onb-actions">
              <Button variant="primary" size="lg" onClick={() => onStep(2)}>{t("ui.onboarding.start")}</Button>
              <Button variant="ghost" onClick={onSkip}>{t("ui.onboarding.skip")}</Button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div role="radiogroup" aria-labelledby="nf-onb-title" className="nf-onb-starters">
              {starters.map((starter, index) => {
                const on = starter.id === deck.id;
                return (
                  <div
                    key={starter.id}
                    role="radio"
                    aria-checked={on}
                    tabIndex={on ? 0 : -1}
                    className={cx("nf-onb-starter", on && "is-picked")}
                    onClick={() => choose(starter)}
                    onKeyDown={(event) => onRadioKey(event, index)}
                  >
                    <DeckHero deck={starter} t={t} heading="h2" />
                    {/* O texto diz o estado a quem enxerga; o aria-checked diz ao leitor de tela. */}
                    <span className="nf-onb-state">{on ? t("ui.onboarding.picked") : t("ui.onboarding.pick")}</span>
                  </div>
                );
              })}
            </div>
            <div className="nf-onb-actions">
              <Button variant="primary" size="lg" icon={<Play size={16} />} onClick={() => onGuidedPlay(deck)}>{t("ui.onboarding.play")}</Button>
              <Button variant="secondary" icon={<ArrowLeft size={16} />} onClick={() => onStep(1)}>{t("ui.onboarding.back")}</Button>
              <Button variant="ghost" onClick={onSkip}>{t("ui.onboarding.skip")}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
