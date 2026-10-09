/** Junta classes ignorando os vazios; sem dependência (a v2 não puxa clsx). */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
