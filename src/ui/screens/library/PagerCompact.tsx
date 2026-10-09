import { ChevronLeft, ChevronRight } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import type { Translator } from "../../../lib/i18n";
import { Button } from "../../primitives/Button";

/**
 * Paginação compacta do Vault (UX_REWRITE_PLAN §2 S4): Anterior, Próxima e "ir para a página".
 * Não lista números: com 5000 páginas a lista numerada pesava no DOM e no toque.
 */
export function PagerCompact({ t, page, totalPages, onChange }: {
  t: Translator;
  page: number;
  totalPages: number;
  onChange: (next: number) => void;
}) {
  const [jump, setJump] = useState("");
  const inputId = useId();
  const go = (target: number) => {
    const clamped = Math.min(Math.max(1, Math.round(target)), totalPages);
    if (clamped !== page) onChange(clamped);
  };
  const submitJump = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = Number(jump);
    if (Number.isFinite(target) && jump.trim() !== "") go(target);
    setJump("");
  };
  const total = totalPages.toLocaleString(t("meta.locale"));

  return (
    <nav className="nf-pager" aria-label={t("ui.library.pagerLabel")}>
      <Button variant="secondary" icon={<ChevronLeft size={16} />} aria-label={t("ui.library.prev")} disabled={page <= 1} onClick={() => go(page - 1)} />
      <span className="nf-pager-status" aria-live="polite">{t("ui.library.pageOf", { page, total })}</span>
      <Button variant="secondary" icon={<ChevronRight size={16} />} aria-label={t("ui.library.next")} disabled={page >= totalPages} onClick={() => go(page + 1)} />
      <form className="nf-pager-jump" onSubmit={submitJump}>
        <label htmlFor={inputId}>{t("ui.library.goTo")}</label>
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={1}
          max={totalPages}
          value={jump}
          onChange={(event) => setJump(event.target.value)}
        />
        <Button type="submit" variant="ghost">{t("ui.library.goToGo")}</Button>
      </form>
    </nav>
  );
}
