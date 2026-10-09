// Motor de temas da v2 (UX_REWRITE_PLAN §1.6.1). Puro e injetável: root e store entram por
// parâmetro, como flag.ts, para o vitest não depender de DOM nem de localStorage.
export const THEMES = ["forja", "aco", "claro", "arcano"] as const;
export type ThemeId = (typeof THEMES)[number];
export const DEFAULT_THEME: ThemeId = "forja";
const KEY = "aember-arena-theme";

/** Cor da barra do navegador/PWA por tema (espelho de --nf-void; o teste compara com o CSS).
 *  Hex aqui é intencional: meta theme-color não aceita var(), então o registro dos temas é isento do lint. */
export const THEME_COLOR: Record<ThemeId, string> = { forja: "#0d0f0c", aco: "#080b10", claro: "#f1ede4", arcano: "#0e0718" };

function safeStore(): Pick<Storage, "getItem" | "setItem"> | null {
  try { return localStorage; } catch { return null; }
}

function isThemeId(value: unknown): value is ThemeId {
  return (THEMES as readonly unknown[]).includes(value);
}

/** Valor fora de THEMES, storage ausente ou storage que lança → tema padrão. */
export function readTheme(store: Pick<Storage, "getItem"> | null = safeStore()): ThemeId {
  try {
    const value = store?.getItem(KEY);
    return isThemeId(value) ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** "forja" remove o atributo: sem data-theme vale o seletor padrão de tokens.css. */
export function applyTheme(id: ThemeId, root: HTMLElement = document.documentElement, store = safeStore()): void {
  if (id === DEFAULT_THEME) delete root.dataset.theme;
  else root.dataset.theme = id;
  root.ownerDocument?.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[id]);
  try { store?.setItem(KEY, id); } catch { /* storage opcional (regra 6) */ }
}
