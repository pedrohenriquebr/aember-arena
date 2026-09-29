# Plano — Catálogo dinâmico + pipeline de abilities por IA (2026-09-29)

Objetivo: fechar a lacuna "importei um deck real e metade das cartas é vanilla".
Duas metades que se encontram no selo de cobertura:

1. **Catálogo completo no disco** — sync incremental do Master Vault (cartas,
   metadados, artes) para IndexedDB. Depois do primeiro sync, nada volta à API.
2. **Pipeline de abilities por IA** — toda carta `partial`/`vanilla` entra numa
   fila que produz o script de gatilhos (DSL do motor) na ordem do texto,
   validado antes de valer, e armazenado para sempre.

Este doc é a especificação. Implementação em ondas (§7); nenhum código muda até
a onda 1 ser aprovada.

---

## 1. Arquitetura

```
[Sync] Master Vault API (paginado) ──► IndexedDB
                                        ├─ cards        (catálogo completo)
                                        ├─ decks        (já existe)
                                        ├─ artBlobs     (artes como Blob)
                                        ├─ stats        (já existe, FEAT-06)
                                        └─ abilities    (DSL por carta)
                                                 ▲
[Pipeline de cobertura] carta partial/vanilla    │
        │                                        │
        ├── Camada 1: parser determinístico (cardText.ts) — grátis
        ├── Camada 2: LLM gera Ability JSON (schema do motor)
        │     └─ valida: schema → dry-run no motor → aprova/reprova
        └── Camada 3: fila de revisão manual (UI)
                                 │
                    store `abilities` (fonte da verdade)
                                 ▼
        motor lê `abilities` ANTES do parser ──► selo de cobertura honesto
```

**Princípio inegociável (já do projeto):** nunca meio-resolver. Ability que não
passa na validação tripla não vale — a carta segue vanilla e aparece na fila.

## 2. Stores IndexedDB (DB v4)

| Store | Chave | Conteúdo | Origem |
|---|---|---|---|
| `cards` (existe, write-only hoje — BUG auditado) | `id` | face completa + `textHash` + `syncedAt` | sync do catálogo |
| `artBlobs` (novo) | `cardId` | `Blob` da arte + `fetchedAt` | sync (on demand ou pacote) |
| `abilities` (novo) | `cardId` | `{ dsl: Ability[], textHash, source: "parser"\|"llm"\|"manual", reviewed, generatedAt, model? }` | pipeline |
| `decks`/`stats` | — | intactos | — |

Migração DB v3 → v4: criar os stores novos; nada migrado (catálogo nasce do
primeiro sync). Erros de storage continuam engolidos (invariante) — sem catálogo
o jogo funciona como hoje (API sob demanda + parser).

## 3. Sync incremental do catálogo

- **Fonte:** Master Vault API, paginação existente de `keyforgeApi.ts`
  (`fetchDeckPage` vira `fetchCardPage` com o mesmo wrapper de timeout/erro).
- **Incremental:** página por página com cursor; `textHash` (djb2/FNV do texto)
  decide re-processar ou pular no pipeline de abilities. Cartas não mudam —
  re-sync só entra cartas novas.
- **Artes:** `artBlobs` por demanda (carta vista) + botão "Baixar pacote de
  artes" com progresso e cancelamento. ⚠️ O S3 **não manda CORS** (BUG2-05):
  arte via `<img>` NÃO vira Blob — alternatives na ordem: (a) buscar via
  `fetch` + `no-cors` não dá acesso ao corpo → (b) **proxy local no SW**
  (`/art-proxy?url=…` que busca server-side não existe aqui) → (c) realista:
  artes de catálogo ficam no cache do SW (online-first) e **Blob só para os
  decks salvos** (importados por UUID, que o usuário escolheu ter offline).
  Decisão final na onda 2 com medição real de quota.
- **Imagens das casas**: 18 emblemas já precacheados no SW (FEAT casas); os
  pesados (Star Alliance/Saurian 2,3 MB) entram no BUG2-14 (otimizar/replace).

## 4. Pipeline de abilities (o coração)

### Camada 1 — parser determinístico (existe)
`cardText.ts` cobre a gramática padrão. Carta `full` aqui **não entra na fila**.

### Camada 2 — LLM (só para `partial`/`vanilla`)
- **Entrada do prompt:** texto da carta + o schema TypeScript de `Ability`/
  `Act`/`Filter`/`Condition` (gerado do próprio código, `abilities.ts`) +
  5-8 exemplos few-shot (pares texto→DSL já validados, ex. Coward's End,
  Hysteria, Tremor, Screechbomb) + a regra de ouro: "cada sentença precisa ser
  representável; senão, responda `unsupported`".
- **Saída:** JSON estrito. **Validação tripla obrigatória:**
  1. schema (parse tipado da Ability);
  2. dry-run no motor: partida sintética (testkit) com a carta em jogo —
     aplica, nada crasha, `canResolve` coerente, sem `NaN`/undefined;
  3. sanidade semântica: gatilhos citam keywords existentes, filtros têm tipo
     válido, efeitos destrutivos têm alvo possível.
- **Reprovou?** volta para a fila como `vanilla` + motivo registrado.
- **Provedores (BYOK — o usuário cola a chave em Configurações):**
  OpenAI/Anthropic/OpenRouter/genérico OpenAI-compatible (base URL configurável).
  Modelo pequeno e barato basta (a tarefa é tradução para DSL, não raciocínio).
- **Custo:** uma chamada por carta, cache eterno por `textHash`. Catálogo de
  ~5.000 cartas × ~1.500 tokens = ordem de poucos dólares, uma vez.

### Camada 3 — revisão manual
Fila na UI: carta + texto + DSL gerada + preview do efeito em partida sintética
(botão "testar em partida de teste"). Aprovar = `reviewed: true` (o selo de
cobertura só mostra "efeito completo" para `reviewed` quando `source: "llm"`).

### Modo build-time (opcional, sem BYOK)
Script Node (`scripts/ability-harvest.mjs`) roda o mesmo pipeline offline para o
catálogo inteiro e commita o resultado como dados (`src/lib/generated/*.json`).
O bundle cresce ~0,3 kB por carta — **não commitar tudo**: commitar só as
camadas 2/3 aprovadas dos decks demo + curadoria; o resto é runtime.

## 5. UI

- **Configurações:** seção "Catálogo" — botões "Sincronizar catálogo"
  (progresso: n/total), "Baixar artes dos decks salvos", campo de chave LLM
  (BYOK, `password`, com link de onde criar) + modelo/base URL.
- **Home/Vault:** chip "catálogo: N cartas em disco" e "fila de abilities: M".
- **Fila de revisão:** tela própria (lista de `source: "llm"` não revisadas),
  fluxo aprovar/editar/rejeitar.
- **Cobertura:** o selo existente passa a refletir o store `abilities`
  (FEAT-14 chip por deck já leitura pronta).
- Tudo via i18n (tuplas en+pt) e piso tipográfico.

## 6. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| LLM alucina efeito | validação tripla (§4); nunca meio-resolver; `reviewed` obrigatório para o selo |
| Quota de storage (artes em Blob) | artes de catálogo não vão para Blob (§3); Blob só decks salvos; `navigator.storage.estimate()` na UI |
| API do MV muda/bloqueia | sync é incremental e opcional; catálogo uma vez sincronizado vive para sempre |
| IP FFG (texto/arte em disco) | uso pessoal local, projeto de fã AGPL já com disclaimer; nada do catálogo é redistribuído no bundle |
| Custo de LLM fora de controle | teto configurável de gasto por sessão; fila processa N por vez; BYOK é do usuário |
| Offline primeiro | TUDO funciona sem sync; o sync só **adiciona** |

## 7. Ondas de implementação

| Onda | Escopo | Esforço |
|---|---|---|
| **1** | DB v4 (`cards` lido + `abilities` store) + sync incremental do catálogo + motor lê store antes do parser + chip de catálogo | M |
| **2** | Pipeline camada 2: BYOK em Configurações, prompt+schema, validação tripla, fila de revisão UI, selo `reviewed` | G |
| **3** | Artes em Blob para decks salvos + "baixar pacote" + build-time harvest opcional | M |
| **4** | (opcional) WebLLM local via WebGPU como provedor sem chave — download pesado, feature experimental | G |

Cada onda: gates padrão (build + 112+ specs + bundle ≤ teto + floor + smoke) e
uma onda nova de specs (vitest) para o pipeline (parser→store, validação tripla,
sync incremental com fixture da API).

## 8. Critérios de aceite do conjunto

1. Importar um deck real com N cartas: catálogo em disco sobrevive a reload e a
   modo avião; zero chamadas à API após o sync.
2. Carta fora da gramática do parser entra na fila e sai com DSL validada (BYOK)
   ou `vanilla`+motivo — nunca meio-resolvida.
3. Selo de cobertura reflete a fonte real (parser/llm-revisado/vanilla) em todas
   as telas que já o exibem.
4. Nada do catálogo/arte entra no bundle; single-file intacto; offline-first
   preservado em todos os cenários.
