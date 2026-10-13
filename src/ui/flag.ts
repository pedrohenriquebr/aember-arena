const KEY = "aember-arena-ui";
export type UiVersion = "1" | "2";

/**
 * ?ui=2 / ?ui=1 vence e persiste; sem param lê o storage. Padrão "2" desde o cutover (H-29).
 * "1" é o escape de uma versão: H-30 remove a v1 e este ramo junto.
 */
export function readUiFlag(search = typeof location !== "undefined" ? location.search : "",
  store: Pick<Storage, "getItem" | "setItem"> | null = safeStore()): UiVersion {
  const q = new URLSearchParams(search).get("ui");
  if (q === "1" || q === "2") { try { store?.setItem(KEY, q); } catch { /* storage opcional (regra 6) */ } return q; }
  try { return store?.getItem(KEY) === "1" ? "1" : "2"; } catch { return "2"; }
}

function safeStore() { try { return localStorage; } catch { return null; } }
