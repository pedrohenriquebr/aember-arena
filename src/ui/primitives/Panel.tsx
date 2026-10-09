import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/** Superfície de conteúdo: s1 é o chão, s2/s3 sobem um degrau de elevação (UX_REWRITE_PLAN §1.4). */
export function Panel({ as: Tag = "div", tone = "s1", children, className, ...rest }: {
  as?: "div" | "section" | "article";
  tone?: "s1" | "s2" | "s3";
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return <Tag {...rest} className={cx("nf-panel", `nf-panel--${tone}`, className)}>{children}</Tag>;
}
