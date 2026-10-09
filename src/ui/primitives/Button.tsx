import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

type Common = {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};
// Botão só-ícone TEM de ter aria-label: sem ele o tipo não fecha (UX_REWRITE_PLAN §5 H-05),
// assim nenhum leitor de tela recebe um botão mudo.
type WithText = Common & { children: ReactNode; icon?: ReactNode; "aria-label"?: string };
type IconOnly = Common & { icon: ReactNode; children?: never; "aria-label": string };

export type ButtonProps = (WithText | IconOnly) & ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * primary = latão com texto escuro: um por tela (o kit mostra a regra). sm = densidade
 * de 36px marcada com data-dense; md e lg ficam em 44px+ para o toque.
 */
export function Button({ variant = "secondary", size = "md", icon, children, className, ...rest }: ButtonProps) {
  const iconOnly = !children;
  return (
    <button
      type="button"
      data-dense={size === "sm" ? "" : undefined}
      {...rest}
      className={cx("nf-btn", `nf-btn--${variant}`, `nf-btn--${size}`, iconOnly && "nf-btn--icon", className)}
    >
      {icon}
      {children}
    </button>
  );
}
