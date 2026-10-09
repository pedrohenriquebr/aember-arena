import { BookOpen, Settings2, Swords, Volume2, VolumeX } from "lucide-react";
import type { ReactNode } from "react";
import type { Translator } from "../../lib/i18n";
import { Button } from "../primitives/Button";
import type { ShellDestination } from "./shellNav";

type Props = {
  t: Translator;
  active: ShellDestination;
  /** Com uma partida em memória, "Jogar" vira "Continuar" (a mesma aba, outro rótulo). */
  hasGame: boolean;
  online: boolean;
  sfx: boolean;
  /** A marca e o seletor de idioma são do App (ForgeMark/LanguageMenu): entram como slots. */
  brandMark: ReactNode;
  languageMenu: ReactNode;
  onBrand: () => void;
  onPlay: () => void;
  onDecks: () => void;
  onSettings: () => void;
  onToggleSfx: () => void;
};

/**
 * Casca do lobby da v2 (UX_REWRITE_PLAN §5 H-07). A ordem do DOM é marca → destinos → ações,
 * então o Tab percorre nessa ordem em qualquer viewport (o CSS só reposiciona).
 */
export function LobbyShell({ t, active, hasGame, online, sfx, brandMark, languageMenu, onBrand, onPlay, onDecks, onSettings, onToggleSfx }: Props) {
  const tab = (id: ShellDestination, label: string, icon: ReactNode, onClick: () => void) => (
    <button type="button" className="nf-shell-tab" aria-current={active === id ? "page" : undefined} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <header className="nf-shell" data-screen="shell">
      <button type="button" className="nf-shell-brand brand-lockup" aria-label={t("nav.home")} onClick={onBrand}>
        <span className="brand-symbol">{brandMark}</span>
        <span className="brand-wordmark"><strong>AEMBER</strong><small>ARENA</small></span>
      </button>

      <nav className="nf-shell-nav" aria-label={t("nav.screens")}>
        {tab("play", hasGame ? t("ui.shell.continue") : t("nav.play"), <Swords size={16} />, onPlay)}
        {tab("decks", t("ui.shell.decks"), <BookOpen size={16} />, onDecks)}
        {tab("settings", t("nav.config"), <Settings2 size={16} />, onSettings)}
      </nav>

      <div className="nf-shell-actions">
        {/* Rede é um ponto: cheio = online, anel = offline (a forma também diz, não só a cor). */}
        <span
          role="img"
          className={`nf-shell-net${online ? "" : " nf-shell-net--off"}`}
          aria-label={online ? t("common.online") : t("common.offline")}
          title={online ? t("common.online") : t("common.offline")}
        />
        <Button
          variant="ghost"
          icon={sfx ? <Volume2 size={16} /> : <VolumeX size={16} />}
          aria-label={sfx ? t("common.mute") : t("common.unmute")}
          onClick={onToggleSfx}
        />
        {languageMenu}
      </div>
    </header>
  );
}
