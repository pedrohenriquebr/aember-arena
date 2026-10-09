import type { ReactNode } from "react";
import { cx } from "./cx";

export type ChipTone = "neutral" | "amber" | "ether" | "ember" | "verdant";

/** Rótulo curto (casa, estado, contagem). A cor reforça; o texto carrega a informação. */
export function Chip({ tone = "neutral", icon, children, className }: {
  tone?: ChipTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return <span className={cx("nf-chip", `nf-chip--${tone}`, className)}>{icon}{children}</span>;
}
