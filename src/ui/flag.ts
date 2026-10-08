const KEY = "aember-arena-ui";
export type UiVersion = "1" | "2";

/** ?ui=2 / ?ui=1 vence e persiste; sem param lê o storage; padrão "1" até o cutover (H-29). */
export function readUiFlag(search = typeof location !== "undefined" ? location.search : "",
  store: Pick<Storage, "getItem" | "setItem"> | null = safeStore()): UiVersion {
  const q = new URLSearchParams(search).get("ui");
  if (q === "1" || q === "2") { try { store?.setItem(KEY, q); } catch { /* storage opcional (regra 6) */ } return q; }
  try { return store?.getItem(KEY) === "2" ? "2" : "1"; } catch { return "1"; }
}

function safeStore() { try { return localStorage; } catch { return null; } }
