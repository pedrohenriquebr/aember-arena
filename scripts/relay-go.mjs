// SPDX-License-Identifier: AGPL-3.0-only
// Lança o relay apontando para o OpenCode Go (tier da assinatura do dono):
// a chave vem do auth.json do opencode CLI — nada de segredo em argumento.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
process.env.LLM_RELAY_PORT = process.env.LLM_RELAY_PORT ?? "47815";
process.env.LLM_RELAY_UPSTREAM_URL = process.env.LLM_RELAY_UPSTREAM_URL ?? "https://opencode.ai/zen/go/v1";
process.env.LLM_RELAY_AUTH_ENTRY = process.env.LLM_RELAY_AUTH_ENTRY ?? "opencode";
process.env.LLM_RELAY_SESSION = process.env.LLM_RELAY_SESSION ?? "aember-arena-game";
if (!process.env.LLM_RELAY_AUTH) {
  try {
    const auth = JSON.parse(readFileSync(`${homedir()}/.local/share/opencode/auth.json`, "utf8"));
    process.env.LLM_RELAY_AUTH = auth[process.env.LLM_RELAY_AUTH_ENTRY]?.key;
  } catch { /* sem auth.json: o relay sobe e devolve 502 nas chamadas */ }
}
await import("./llm-cors-relay.mjs");
