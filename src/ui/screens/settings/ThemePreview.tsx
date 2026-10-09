/**
 * Miniatura do Lobby feita só de tokens (UX_REWRITE_PLAN §1.6.2): painel, botão, duas linhas,
 * um chip de seleção e a faixa de feltro. Não tem cor própria; herda o data-theme do cartão.
 */
export function ThemePreview() {
  return (
    <span className="u-theme-preview" aria-hidden="true">
      <span className="u-theme-preview-panel">
        <span className="u-theme-preview-line u-theme-preview-line--wide" />
        <span className="u-theme-preview-line" />
        <span className="u-theme-preview-row">
          <span className="u-theme-preview-button" />
          <span className="u-theme-preview-chip" />
        </span>
      </span>
      <span className="u-theme-preview-felt" />
    </span>
  );
}
