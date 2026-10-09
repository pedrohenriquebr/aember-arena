import type { ReactNode } from "react";
import { cx } from "./cx";

/** Número em destaque com rótulo: o valor é texto, a cor só o acompanha. */
export function StatBlock({ label, value, hint, tone = "plain" }: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "plain" | "amber" | "ether" | "ember" | "verdant";
}) {
  return (
    <div className={cx("nf-stat", `nf-stat--${tone}`)}>
      <span className="nf-stat-label">{label}</span>
      <strong className="nf-stat-value">{value}</strong>
      {hint ? <span className="nf-stat-hint">{hint}</span> : null}
    </div>
  );
}
