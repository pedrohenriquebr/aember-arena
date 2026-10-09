// UX_REWRITE_PLAN §2 S1 / §5 H-23: o passo do onboarding fica no storage para o reload retomar
// onde o jogador parou. Storage que falha não quebra nada (regra 6): a primeira visita ainda
// abre o passo 1, só que sem memória para o reload.

export const ONBOARDING_KEY = "aember-arena-onboarding";
export type OnboardingStep = 1 | 2;

/**
 * Passo a abrir agora. Com passo gravado, retoma ele (reload no passo 2 volta ao 2). Sem
 * gravação, só a primeira visita abre o passo 1 — e o grava, para o próximo reload.
 * Quem já tem settings não é a primeira visita (isFirstVisit), então não é emboscado.
 */
export function startOnboarding(firstVisit: boolean): OnboardingStep | null {
  try {
    const saved = localStorage.getItem(ONBOARDING_KEY);
    if (saved === "1" || saved === "2") return saved === "2" ? 2 : 1;
    if (!firstVisit) return null;
    localStorage.setItem(ONBOARDING_KEY, "1");
    return 1;
  } catch {
    // Sem storage a primeira visita ainda vê o onboarding; o reload não tem memória.
    return firstVisit ? 1 : null;
  }
}

export function saveOnboardingStep(step: OnboardingStep): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, String(step));
  } catch {
    // O passo segue na memória da sessão.
  }
}

/** Encerrado (jogou guiado ou pulou): sai do storage e não volta. */
export function clearOnboarding(): void {
  try {
    localStorage.removeItem(ONBOARDING_KEY);
  } catch {
    // Sem storage o onboarding só volta se o storage voltar a ler "1"/"2" — nada a apagar.
  }
}
