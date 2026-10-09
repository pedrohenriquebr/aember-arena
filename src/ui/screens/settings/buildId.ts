/**
 * BUILD_ID vive no sw.js (scripts/inject-sw-version.mjs troca `__BUILD_ID__` no build).
 * A página lê o próprio worker servido — mesma origem, sem API nova nem dependência.
 * Em dev o placeholder continua no lugar; aí (e em qualquer falha) a linha mostra "dev".
 */
export async function readBuildId(fetcher: typeof fetch = fetch): Promise<string> {
  try {
    const response = await fetcher("./sw.js");
    const source = await response.text();
    const match = /self\.BUILD_ID = "([^"]+)"/.exec(source);
    const id = match?.[1] ?? "";
    return !id || id === "__BUILD_ID__" ? "dev" : id;
  } catch {
    return "dev";
  }
}
