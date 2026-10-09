/** Destinos do shell do lobby (UX_REWRITE_PLAN §3.1): Jogar · Decks · Ajustes. */
export type ShellDestination = "play" | "decks" | "settings";

/**
 * Qual destino acende para cada tela do App. A partida é "Jogar" (o botão vira
 * "Continuar"); o inspetor mostra um deck, então pertence a "Decks".
 */
export function destinationOf(screen: string): ShellDestination {
  if (screen === "browse" || screen === "inspect") return "decks";
  if (screen === "config" || screen === "settings") return "settings";
  return "play";
}
