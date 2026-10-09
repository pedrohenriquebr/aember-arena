const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Id do deck no Master Vault tirado de um UUID puro ou de um link (a página deck-details traz o
 * UUID no caminho). Null se não há UUID. Puro, sem rede: a folha de importação usa para detectar
 * o que foi colado antes de qualquer chamada.
 */
export function parseDeckId(input: string): string | null {
  const id = input.trim().match(UUID_PATTERN)?.[0];
  return id ? id.toLowerCase() : null;
}
