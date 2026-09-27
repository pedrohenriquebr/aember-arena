import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Translator } from "../lib/i18n";

// Compact page window: first, last, and a sliding neighbourhood around the current page.
export function pageWindow(current: number, total: number, span = 1): number[] {
  if (total <= 1) return total === 1 ? [1] : [];
  const pages = new Set<number>([1, total, current]);
  for (let offset = 1; offset <= span; offset += 1) {
    if (current - offset > 1) pages.add(current - offset);
    if (current + offset < total) pages.add(current + offset);
  }
  if (current <= 3) [2, 3, 4].forEach((page) => page < total && pages.add(page));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((page) => page > 1 && pages.add(page));
  return [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
}

export function Pagination({
  page,
  totalPages,
  onChange,
  label,
  t,
  compact = false,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  label?: string;
  t: Translator;
  compact?: boolean;
}) {
  if (totalPages <= 1) return null;
  const pages = pageWindow(page, totalPages, compact ? 0 : 1);
  let lastRendered = 0;

  return (
    <nav className={`pager${compact ? " pager--compact" : ""}`} aria-label={label ?? t("pager.label")}>
      <button
        type="button"
        className="pager-arrow"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        aria-label={t("pager.prev")}
      >
        <ChevronLeft size={15} />
      </button>

      <div className="pager-pages">
        {pages.map((item) => {
          // Boolean: `0 && …` would render a literal "0" before the first page.
          const gap = lastRendered > 0 && item - lastRendered > 1;
          lastRendered = item;
          return (
            <span key={item} className="pager-slot">
              {gap && <span className="pager-gap">…</span>}
              <button
                type="button"
                className={`pager-num${item === page ? " is-current" : ""}`}
                onClick={() => onChange(item)}
                aria-current={item === page ? "page" : undefined}
              >
                {item}
              </button>
            </span>
          );
        })}
      </div>

      <button
        type="button"
        className="pager-arrow"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        aria-label={t("pager.next")}
      >
        <ChevronRight size={15} />
      </button>
    </nav>
  );
}
