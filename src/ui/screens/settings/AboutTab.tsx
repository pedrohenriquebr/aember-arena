import { useEffect, useState } from "react";
import { ExternalLink, RotateCcw } from "lucide-react";
import type { Translator } from "../../../lib/i18n";
import { Button } from "../../primitives/Button";
import { readBuildId } from "./buildId";

/**
 * Aba Sobre (UX_REWRITE_PLAN §2 S7, §5 H-20): versão/BUILD_ID, licença AGPL-3.0,
 * créditos (Master Vault, keyteki) e "Rever tutorial" — o conteúdo que morava no
 * rail-footer da mesa (FASE 2: "conteúdo → Ajustes › Sobre").
 */
export function AboutTab({ t, onOpenTutorial }: { t: Translator; onOpenTutorial: () => void }) {
  const [buildId, setBuildId] = useState("…");
  useEffect(() => { void readBuildId().then(setBuildId); }, []);

  return (
    <div className="u-settings-list">
      <section className="u-settings-card" aria-labelledby="u-about-title">
        <h2 className="nf-setting-title" id="u-about-title">{t("ui.settings.tab.about")}</h2>
        <div className="u-settings-status">
          <span className="nf-setting-desc">{t("ui.settings.data.build")}</span>
          <code className="u-build-id">{buildId}</code>
        </div>
        <p className="u-settings-note">
          <a className="u-about-link" href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer">
            <ExternalLink size={13} aria-hidden="true" /> {t("ui.settings.about.license")}
          </a>
        </p>
        <p className="u-settings-note">{t("ui.settings.about.credits")}</p>
        <div className="u-settings-actions">
          <a className="u-about-link" href="https://www.keyforgegame.com" target="_blank" rel="noreferrer">
            <ExternalLink size={13} aria-hidden="true" /> {t("rail.dataBy")}
          </a>
          <a className="u-about-link" href="https://github.com/keyteki/keyteki" target="_blank" rel="noreferrer">
            <ExternalLink size={13} aria-hidden="true" /> {t("ui.settings.about.keyteki")}
          </a>
          {/* AGPL-3.0 §13: quem usa o app pela rede precisa de um caminho para o
              código-fonte correspondente (o bundle minificado não carrega o notice). */}
          <a className="u-about-link" href="https://github.com/pedrohenriquebr/aember-arena" target="_blank" rel="noreferrer">
            <ExternalLink size={13} aria-hidden="true" /> {t("ui.settings.about.source")}
          </a>
        </div>
        <p className="u-settings-note">{t("ui.disclaimer")}</p>
        <p className="u-settings-note">{t("ui.settings.about.privacy")}</p>
        <div className="u-settings-actions">
          <Button variant="primary" icon={<RotateCcw size={15} />} onClick={onOpenTutorial}>{t("tutorial.open")}</Button>
        </div>
      </section>
    </div>
  );
}
