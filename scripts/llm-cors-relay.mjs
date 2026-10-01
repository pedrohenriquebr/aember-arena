// SPDX-License-Identifier: AGPL-3.0-only
// Relay CORS mínimo entre o BYOK in-game e o opencode-cli-proxy-service local
// (127.0.0.1:47813), que não responde preflight (OPTIONS → 405). O relay só
// encaminha e acrescenta os headers de CORS — nenhuma lógica de LLM aqui.
//
//   npm run llm-relay
//   → http://127.0.0.1:47814/v1  (Base URL na tela de configurações; API key
//     "local", modelo ex. "mimo-v2.6-flash-free")
//
// Env: LLM_RELAY_PORT (padrão 47814), LLM_RELAY_UPSTREAM (47813),
//   LLM_RELAY_ALLOW_ORIGIN (origens extras separadas por vírgula — ex. túnel https).
//
// Segurança (code review + validação Opus): requisição com Origin fora da allowlist
// → 403 ANTES de encaminhar (POST "simples" sem preflight não pode queimar cota);
// Host tem de ser loopback nesta porta (DNS rebinding); só GET/POST sob /v1/.
// Origin: null é aceito DE PROPÓSITO para o PWA empacotado via file:// — mas um
// <iframe sandbox> de qualquer site também emite null e lê a resposta: o pior caso
// é queimar cota dos modelos free através do relay (não há dado sensível no proxy).
// Abort do cliente destrói o upstream (não queima LLM após o timeout de 180s).
import { createServer, request as httpRequest } from "node:http";

const positive = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const UPSTREAM_PORT = positive(process.env.LLM_RELAY_UPSTREAM) ?? 47813;
const PORT = positive(process.env.LLM_RELAY_PORT) ?? 47814;
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
const ALLOW = new Set([
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
]);
for (const extra of (process.env.LLM_RELAY_ALLOW_ORIGIN ?? "").split(",")) {
  if (extra.trim()) ALLOW.add(extra.trim());
}

const reply = (res, status, body) => {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const host = req.headers.host ?? "";
  if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) {
    return reply(res, 403, { error: { message: "relay: host não permitido", type: "api_error" } });
  }
  const origin = req.headers.origin;
  if (origin && origin !== "null" && !ALLOW.has(origin)) {
    return reply(res, 403, { error: { message: "relay: origem não permitida", type: "api_error" } });
  }
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": req.headers["access-control-request-headers"] ?? "content-type, authorization",
      "Access-Control-Max-Age": "86400",
      ...(req.headers["access-control-request-private-network"] === "true" ? { "Access-Control-Allow-Private-Network": "true" } : {}),
    });
    res.end();
    return;
  }
  if ((req.method !== "GET" && req.method !== "POST") || !req.url?.startsWith("/v1/")) {
    return reply(res, 404, { error: { message: "relay: só GET/POST sob /v1/", type: "api_error" } });
  }
  const headers = { ...req.headers, host: `127.0.0.1:${UPSTREAM_PORT}` };
  delete headers.origin;
  delete headers.cookie;
  for (const hop of HOP_BY_HOP) delete headers[hop];
  const upstream = httpRequest({ host: "127.0.0.1", port: UPSTREAM_PORT, path: req.url, method: req.method, headers }, (up) => {
    const responseHeaders = { ...up.headers };
    for (const hop of HOP_BY_HOP) delete responseHeaders[hop];
    delete responseHeaders.vary; // o Vary: Origin do relay prevalece
    res.writeHead(up.statusCode ?? 502, responseHeaders);
    up.pipe(res);
    up.on("error", () => res.destroy());
  });
  upstream.on("error", () => reply(res, 502, { error: { message: `relay: upstream 127.0.0.1:${UPSTREAM_PORT} indisponível`, type: "api_error" } }));
  req.on("error", () => upstream.destroy());
  req.pipe(upstream);
  // Cliente abortou (timeout do jogo) → mata o request em curso no proxy.
  res.on("close", () => {
    if (!res.writableEnded) upstream.destroy();
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`llm-relay em http://127.0.0.1:${PORT}/v1 → 127.0.0.1:${UPSTREAM_PORT}`);
});
