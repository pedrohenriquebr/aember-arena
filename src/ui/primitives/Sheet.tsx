import { X } from "lucide-react";
import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../../components/useDialogFocus";
import type { Translator } from "../../lib/i18n";
import { Button } from "./Button";

/**
 * Folha modal (UX_REWRITE_PLAN §5 H-06): bottom-sheet abaixo de 701px, diálogo centrado acima.
 * O foco entra no diálogo e volta ao gatilho ao fechar (useDialogFocus); Esc, o fundo e o X
 * fecham. Vai para document.body para escapar do overflow/transform de quem a chama.
 */
export function Sheet({ open, onClose, title, children, footer, t }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Só o rótulo do X vem de fora: a folha não lê o idioma por conta própria. */
  t: Translator;
}) {
  const titleId = useId();
  const dialogRef = useDialogFocus<HTMLDivElement>(open);

  useEffect(() => {
    if (!open) return;
    // A trava guarda o valor anterior: uma folha sobre outra (ou um overflow já travado) não o perde.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="nf-sheet-layer">
      <div className="nf-sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="nf-sheet" tabIndex={-1}>
        <header className="nf-sheet-head">
          <h2 id={titleId} className="nf-sheet-title">{title}</h2>
          <Button variant="ghost" icon={<X size={20} />} aria-label={t("ui.sheet.close")} onClick={onClose} />
        </header>
        <div className="nf-sheet-body">{children}</div>
        {footer ? <footer className="nf-sheet-foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
