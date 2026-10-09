import { TriangleAlert } from "lucide-react";
import type { Translator } from "../../../lib/i18n";
import type { RunProgress } from "../../../lib/catalogLlm";
import type { LlmConfig } from "../../../lib/settings";
import { LlmSettings } from "../../../components/LlmSettings";

/**
 * Aba Laboratório (UX_REWRITE_PLAN §2 S7, §5 H-20): o <LlmSettings> entra INALTERADO
 * (BYOK + fila de tradução/revisão) sob o aviso de que é coisa avançada.
 */
export function LabTab({ t, llm, onLlmChange, catalogCount, llmRun, onLlmTranslate, onLlmCancel }: {
  t: Translator;
  llm: LlmConfig;
  onLlmChange: (next: LlmConfig) => void;
  catalogCount: number;
  llmRun: RunProgress | null;
  onLlmTranslate: () => void;
  onLlmCancel: () => void;
}) {
  return (
    <div className="u-settings-list">
      <p className="u-settings-note u-settings-note--warn">
        <TriangleAlert size={14} aria-hidden="true" /> {t("ui.settings.lab.advanced")}
      </p>
      <LlmSettings
        config={llm}
        onChange={onLlmChange}
        catalogCount={catalogCount}
        run={llmRun}
        onTranslate={onLlmTranslate}
        onCancel={onLlmCancel}
        t={t}
      />
    </div>
  );
}
