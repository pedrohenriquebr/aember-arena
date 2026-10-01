# Viabilidade: PROXY/LLM local como backend do pipeline de tradução (CAT-2)

## Resumo executivo
- **GO COMPROVADO (e2e real)**: o serviço `opencode-cli-proxy-service` do dono (Windows service "OpenCodeCliProxy") JÁ É um adaptador OpenAI-compatível em `http://127.0.0.1:47813/v1` — sem API key, com retries/timeout próprios. Teste de ponta a ponta com o prompt real do pipeline: carta "Coward's End" → `mimo-v2.6-flash-free` → **DSL validada pela validação tripla em 35,5s** (`Play: Destroy each undamaged creature` → `{"on":["play"],"acts":[{"k":"destroy","s":{"each":{"type":"Creature","damaged":false}}}`).
- **Caminho imediato sem código novo**: harvest build-time (`npm run harvest -- --llm`) apontando para o proxy — Node, não sofre CORS. Só precisa subir o timeout do cliente (60s → ~180s: cold start do CLI passa de 60s, warm ~35s).
- **Caminho in-game (BYOK na tela de settings)**: depende de o proxy ganhar CORS (hoje o preflight OPTIONS responde 405). Fix pequeno no serviço do dono (middleware aiohttp).
- Modelos testados OK: `mimo-v2.6-flash-free` (default), `nemotron-3-ultra-free`. `deepseek-v4-flash-free` com 502 upstream no momento do teste.

## Opções testadas (evidência)

### a) opencode-cli-proxy-service (O PROXY DO DONO — a resposta certa)
- Windows service "OpenCodeCliProxy" (`C:\Users\HP\.zcode\workspace\default\opencode-cli-proxy\opencode-cli-proxy-service.exe`, auto-start; o listener fica num processo filho, por isso o netstat do PID do serviço não mostrava porta).
- `config.json`: **porta 47813, bind 127.0.0.1, api_key vazia**, `request_timeout` 600s, `max_concurrency` 2, `agent: build`, `argv_prompt_limit` 24000, `dump_requests: true` (dumps em `dumps/`).
- API OpenAI-compatível real: `GET /v1/models` → lista formato OpenAI (mimo-v2.6-flash-free, nemotron-3-ultra-free, nemotron-3.5-lightning-free, muse-spark-1.3/1.2-contributor-free, ling-3.0-flash-fin-free, deepseek-v4-flash-free, mimo-v2-omni/pro-free, space-bunny-free). `POST /v1/chat/completions` → resposta padrão com `choices[0].message.content` (+`reasoning_content`, que o cliente do jogo ignora corretamente).
- Arquitetura interna: spawn de `opencode.exe run --pure --format json -m <model> --thinking` por requisição, com retries (3) e timeout de inatividade 240s — exatamente o "shim" que a análise consideraria construir. Log mostra histórico de sucesso (14,2s com space-bunny-free em 26/sep).
- **Testes do ciclo de viabilidade (01/oct)**: `mimo-v2.6-flash-free` e `nemotron-3-ultra-free` responderam JSON limpo (~30–50s); `deepseek-v4-flash-free` → 502 upstream ("Unexpected server error" do provedor opencode-zen, não do proxy).
- **E2E do pipeline**: carta real "Coward's End" com o `buildMessages` do jogo → HTTP 200 em **35,5s** → `validateDraft` **ok:true** com DSL semanticamente correta.
- **CORS: NÃO há** — `OPTIONS /v1/chat/completions` → 405. Browser in-game é bloqueado no preflight; Node (harvest) não é afetado.
- Custo: zero marginal (modelos free da assinatura OpenCode). Overhead: cada requisição injeta o system prompt do agente `build` (~10k tokens reportados de prompt para um pedido de 19 chars) — não bloqueia, mas soma latência; e o `argv_prompt_limit` de 24000 chars limita prompts via argv (o prompt do jogo cabe com folga).
- Obs.: `deepseek-v4-flash-free` está mapeado no proxy para `opencode-zen/deepseek-v4-flash-free` (provedor com falha no momento); quando voltar, é o candidato de melhor qualidade DSL.

### b) OpenCode CLI puro (`opencode serve` / `opencode run`)
- `opencode --help` lista `serve` (headless), `web`, `attach`, `run`, `models`. `opencode serve --help`: `--port` (padrão 0), `--hostname` (127.0.0.1), `--cors <domínio>`.
- O serviço "opencode-cli-proxy-servic" (PID 6340) não tem porta; irrelevante: o `serve` sobe HTTP sozinho.
- Subi `opencode serve --port 4096 --cors http://localhost:5173 --cors http://localhost:4173` → `opencode server listening on http://127.0.0.1:4096`, aviso `OPENCODE_SERVER_PASSWORD is not set; server is unsecured` (auth = Basic opcional via essa variável).
- `GET /v1/models` e `POST /v1/chat/completions` → **200 text/html** (fallback da SPA web, não é API OpenAI).
- `GET /config/providers` → provedores `openai` (79 modelos), `google` (38), `opencode` (80), `opencode-go` (29). `opencode models` lista claude-*, deepseek-v4-*, gemini-3.x, glm-5.x etc.
- CORS: preflight `OPTIONS /session` com Origin `http://localhost:5173` → 204, `Access-Control-Allow-Origin` = origem liberada, `Allow-Headers` ecoa `content-type,authorization`. **CORS: sim** (só para origens passadas em `--cors`).
- Chat mínimo: `POST /session` ok (id criado); `POST /session/:id/message` com `opencode/big-pickle` → **sem resposta em 120s**. `opencode run -m opencode/nemotron-3-ultra-free "Reply with just: OK"` na primeira bateria → sem resposta em 60s. **Cross-check posterior do orquestrador (rerun a partir de `/tmp`, fora de projeto git): a MESMA chamada respondeu `OK` em ~17s** — a falha anterior foi falsa negativa (overhead de snapshot git + init de projeto dentro do repo; logs mostraram `failed to add snapshot files` e init de 12 passos antes do stream). Conclusão: o CLI standalone TEM auth válida e o modelo responde; execuções devem usar cwd neutro (ex. `%TEMP%`).
- O `opencode.json` ainda injeta um prompt "ZCODE-PROXY" nos agentes `build`/`plan`, que polui uma tradução para JSON estrito — o shim deve usar um agente/prompt limpo (ex. `opencode run` com agente `plan` remapeado ou config dedicada via `--config`).
- Servidor encerrado ao final.

### c) AnythingLLM
- Instalado em `%LOCALAPPDATA%\Programs\AnythingLLM`, config em `%APPDATA%\anythingllm-desktop` (`config.json`), não está rodando. Não subi (exigiria setup manual).
- A API dev do app (`/api/v1`, porta 3001) usa chave gerada nas configurações do app e é voltada a workspaces/RAG; o endpoint `/api/v1/openai/chat/completions` existe mas passa pelo workspace (prompt/histórico do workspace). Não verificado nesta máquina. Falta: abrir o app, configurar provedor LLM, gerar API key, habilitar CORS/dev API.

### d) LiteLLM
- Instalado via pip (1.86.0 segundo `pip show`; o `litellm --version` direto falhou com traceback de Python — **precisa de conserto/checagem do ambiente**).
- Gateway sem backend próprio. Variáveis `OPENAI_/ANTHROPIC_/LITELLM_/OPENROUTER_*` no ambiente: nenhuma encontrada; sem `~/.litellm*`. Porta 4000 não responde.
- Serve `/v1/chat/completions` com CORS configurável; seria útil só com backend (Ollama local ou chave remota).

## O que o jogo precisa (código)
- `src/lib/catalogLlm.ts` `callProvider`: `POST {baseUrl sem barra final}/chat/completions`, headers `Content-Type: application/json` + `Authorization: Bearer <apiKey>`, corpo `{model, messages, temperature: 0}` (sem `response_format`), resposta lida em `choices[0].message.content` (string). Timeout 60s (`LLM_TIMEOUT_MS`), limite 25 cartas/rodada.
- `llmReady` (`settings.ts`) exige **apiKey, baseUrl e model não vazios** — um endpoint local sem auth ainda precisa de uma chave qualquer (ex.: `local`).
- Sem tratamento de CORS no cliente (só o header `anthropic-dangerous-direct-browser-access` para api.anthropic.com): o servidor local tem de enviar `Access-Control-Allow-Origin` e aceitar o preflight com `authorization`.
- Prompt: system com schema DSL + 5 few-shots + carta; exige JSON puro. Passa por validação tripla (schema, dry-run, sanidade). Falhas viram `llm.*`.
- Mixed content: `http://127.0.0.1` a partir de página https é permitido por navegadores modernos (loopback confiável), mas `file://` tem origem `null` (CORS precisa liberar `null`/`*`).
- Alternativa sem CORS: o harvest build-time (`scripts/ability-harvest.mjs`) roda em Node com `HARVEST_LLM_KEY`/`HARVEST_LLM_BASE`/`HARVEST_LLM_MODEL` — **não sofre CORS** e é o melhor ponto de encaixe de um proxy local.

## Veredito por opção
| Opção | Endpoint | Auth | Modelos | CORS | Custo | Veredito |
|---|---|---|---|---|---|---|
| **opencode-cli-proxy-service (dono)** | `http://127.0.0.1:47813/v1` | nenhuma | 10 free (mimo, nemotron, deepseek…) | **não (405)** | zero marginal | **GO — e2e validado** (harvest hoje; in-game após CORS) |
| OpenCode serve puro | `http://127.0.0.1:4096` (API de sessão, não OpenAI) | opcional (`OPENCODE_SERVER_PASSWORD`, Basic) | ~80 `opencode/*` | sim (`--cors`) | assinatura | NO-GO direto (formato incompatível) |
| AnythingLLM | `http://localhost:3001/api/v1/openai/chat/completions` (não verificado) | Bearer gerada no app | os do provedor configurado | não verificado | depende do backend | Pendente (setup manual) |
| LiteLLM | `http://localhost:4000/v1/chat/completions` | master key opcional | o que for roteado | sim (configurável) | depende do backend | GO condicional (precisa backend) |

Qualidade: o prompt tem schema grande + JSON estrito; modelos pequenos/free (nemotron, big-pickle) tendem a quebrar o schema — a validação tripla os rejeita (carta fica vanilla), custo é tempo, não corretude. Preferir modelo médio (ex. `deepseek-v4-flash`, `gemini-3.x-flash`, `claude-haiku-4-5`) e `unsupported` quando em dúvida.

## Config recomendada (funciona hoje, validada e2e)
- **Relay CORS incluído no repo** (`npm run llm-relay` → `http://127.0.0.1:47814/v1` → upstream 47813): habilita o caminho in-game (BYOK na tela de configurações) sem tocar no serviço do dono. Base URL `http://127.0.0.1:47814/v1`, API key `local`, modelo `mimo-v2.6-flash-free` ou `nemotron-3-ultra-free`. Allowlist de origem (5173/4173), 403 antes de encaminhar, Host loopback obrigatório, strip de hop-by-hop/cookie, abort do cliente derruba o upstream. Tradeoff consciente: `Origin: null` é aceito para o PWA `file://` — um `<iframe sandbox>` de terceiro também emite `null` e pode queimar cota free (o proxy não guarda dado sensível). Quando o serviço ganhar CORS nativo, o relay fica redundante.
- **Lote build-time (fluxo real, PowerShell-safe)**:
  ```
  $env:HARVEST_LLM_KEY="local"; $env:HARVEST_LLM_BASE="http://127.0.0.1:47813/v1"; $env:HARVEST_LLM_MODEL="mimo-v2.6-flash-free"
  npm run harvest:cards                                                  # exporta o catálogo do Vault (3744 cartas)
  npm run harvest -- --cards scripts/harvest/cards-mv.json --llm --limit 25   # 25 cartas ≈ 17 min
  ```
  `LLM_TIMEOUT_MS` já está em 180s (cold start do CLI local; warm ~35s). Rascunhos em `scripts/harvest/drafts.json` para a fila de revisão do app; `npm run harvest -- --vendor` grava só os `reviewed: true` em `src/lib/generated/approved.json`.
  **Cache**: falhas ficam presas por `textHash` — após expandir a DSL, limpe `drafts.json` (ou as linhas) para reprocessar.
- **Plano B (modelo realmente local/offline, outro dia)**: LiteLLM (`:4000`, precisa de backend) ou Ollama (`:11434/v1`, modelo ≥7B com JSON confiável, `OLLAMA_ORIGINS`).

## Riscos e próximos passos
1. **Timeout do cliente (60s) é apertado** para o proxy (cold start >60s, warm ~35s) — subir `LLM_TIMEOUT_MS` para ~180000 na missão de integração (afeta só o pipeline, não gameplay).
2. **CORS ausente no serviço** — para o caminho in-game o dono precisa adicionar handler OPTIONS + ACAO no `opencode-cli-proxy-service` (é serviço dele, mudança de ~10 linhas em aiohttp). Enquanto isso, o harvest já entrega o lote.
3. **Qualidade DSL por modelo**: mimo-v2.6-flash-free acertou a carta do e2e, mas cartas complexas (reações encadeadas, "instead", exalt) podem exigir modelo maior — a validação tripla rejeita o que quebrar (carta fica vanilla, sem risco de corretude). Rodar um lote maior e medir taxa de aprovação por modelo antes de fechar o provedor.
4. `deepseek-v4-flash-free` com 502 upstream no momento do teste (provedor opencode-zen) — retestar antes de lote grande.
5. Rate limit/ToS: modelos free da assinatura em lote automatizado — manter `--limit` moderado por rodada (o proxy já limita `max_concurrency: 2`).
6. Latência ~35s/carta → lote de 119 cartas ≈ 70–80 min em background; aceitável para build-time, não para sessão de jogo ao vivo.
