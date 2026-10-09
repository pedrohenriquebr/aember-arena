import type { ReactNode } from "react";

/** Vazio com caminho para agir: título, uma linha de contexto e (opcional) um botão. */
export function EmptyState({ icon, title, body, action }: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="nf-empty">
      {icon ? <span className="nf-empty-icon" aria-hidden="true">{icon}</span> : null}
      <h3 className="nf-empty-title">{title}</h3>
      {body ? <p className="nf-empty-body">{body}</p> : null}
      {action ? <div className="nf-empty-action">{action}</div> : null}
    </div>
  );
}
