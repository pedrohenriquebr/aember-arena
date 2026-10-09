import type { ReactNode } from "react";
import { cx } from "./cx";

/** Linha de ajuste: rótulo e descrição à esquerda, controle à direita; empilha no celular. */
export function SettingRow({ title, description, control }: {
  title: ReactNode;
  description?: ReactNode;
  control: ReactNode;
}) {
  return (
    <div className="nf-setting">
      <div className="nf-setting-text">
        <span className="nf-setting-title">{title}</span>
        {description ? <span className="nf-setting-desc">{description}</span> : null}
      </div>
      <div className="nf-setting-control">{control}</div>
    </div>
  );
}

/**
 * Interruptor liga/desliga (role=switch). Sem texto visível, por isso o aria-label é obrigatório;
 * o estado vai para o knob (posição), não só para a cor.
 */
export function Switch({ checked, onChange, label, disabled, className }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cx("nf-switch", checked && "is-on", className)}
      onClick={() => onChange(!checked)}
    >
      <span className="nf-switch-track" aria-hidden="true">
        <span className="nf-switch-knob" />
      </span>
    </button>
  );
}
