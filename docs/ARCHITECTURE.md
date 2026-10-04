# Arquitetura — Aember Arena

Guia visual de como as peças se encaixam. Gerado a partir do código real (commit `fa129a8`) com apoio do **graphify**.

- Grafo interativo: `graphify-out/graph.html` (abra no navegador; 2.206 nós, 4.321 arestas).
- Relatório: `graphify-out/GRAPH_REPORT.md`. Consultas: `graphify explain "applyMove"`, `graphify path "A" "B"`.
- Os diagramas C4 usam flowcharts com a notação `[Persona]/[Container]/[Component]` (compatível com qualquer renderer Mermaid).

---

## 1. Diagrama de blocos

### 1.1 Visão geral

O app React (`App.tsx`) é o orquestrador: chama o motor puro, lê/grava o catálogo e delega animação ao `FxLayer`. O motor nunca toca em I/O.

```mermaid
flowchart LR
  subgraph UI["App React"]
    APP["App.tsx<br/>(orquestrador)"]
    COMP["components/<br/>CardArt, Deck*, TutorialWizard,<br/>CoverageBadge, HouseIcon, Pagination,<br/>ErrorBoundary, useDialogFocus"]
    SWR["sw.js<br/>(register em App.tsx)"]
    I18N["i18n.ts<br/>en / pt-BR"]
    FX["FxLayer + table-plane<br/>(FX / mesa 3D)"]
  end
  subgraph MOTOR["Motor puro"]
    GAME["game.ts"]
    AI["ai.ts"]
    ABIL["abilities.ts"]
    TXT["cardText.ts<br/>+ keywords.ts"]
  end
  subgraph CAT["Catálogo dinâmico"]
    CACHE["cache.ts<br/>(IndexedDB)"]
    API["keyforgeApi.ts<br/>(sync MV)"]
    VEND["vendored.ts<br/>(generated/approved.json)"]
  end
  APP --> COMP
  APP --> I18N
  APP --> FX
  APP --> GAME
  APP --> AI
  AI --> GAME
  GAME --> ABIL
  ABIL --> TXT
  APP --> CACHE
  APP --> API
  CACHE --> ABIL
  API --> CACHE
  VEND --> ABIL
  APP --> VEND
  APP --> SWR
```

`abilities.ts` só importa tipos de `game.ts` (`import type`), então não há ciclo em runtime; `game.ts` importa `rulesOf` de `abilities.ts`. `vite.config` + `vite-plugin-singlefile` empacotam tudo em um `index.html`; `sw.js` é registrado por `App.tsx` (`./sw.js`, relativo) e faz cache LRU.

### 1.2 Catálogo, LLM, harvest, e2e e infra externa

```mermaid
flowchart LR
  subgraph APPC["No navegador"]
    LLMUI["LlmSettings.tsx<br/>(fila de revisão)"]
    LLM["catalogLlm.ts<br/>(pipeline LLM)"]
    SCHEMA["generated/<br/>dslSchema.ts"]
    CACHE["cache.ts"]
  end
  subgraph NODE["Scripts Node"]
    HARV["ability-harvest.mjs"]
    EXP["catalog-export.mjs"]
    GEN["gen-dsl-schema.mjs"]
    RELAY["llm-cors-relay.mjs"]
  end
  subgraph EXT["Externo"]
    MV[("Master Vault API")]
    IDB[("IndexedDB")]
    PROXY["Proxy do dono :47813"]
    RL["Relay CORS :47814"]
  end
  E2E["e2e/ probes (_3d-*, fx-*, ui),<br/>fit, floor, acceptance"]
  BENCH["bench/ duelos de IA<br/>(RUNBOOK.md)"]
  VITE["vite.config +<br/>vite-plugin-singlefile"]
  LLMUI --> LLM
  LLM --> SCHEMA
  LLM --> CACHE
  CACHE --> IDB
  GEN --> SCHEMA
  EXP --> MV
  HARV --> LLM
  HARV --> PROXY
  LLM --> RL
  RELAY --> RL
  RL --> PROXY
  E2E -.dirige.-> APPC
  VITE -.empacota.-> APPC
```

**Fluxo:** o navegador não fala direto com o proxy local (ele não responde preflight CORS), então passa pelo relay `:47814`, que repassa a `:47813`. O harvest roda em Node e reutiliza o mesmo `catalogLlm.ts` do app. O e2e (Playwright sobre Edge/Chrome) só dirige o app.

---

## 2. Diagramas de sequência

### 2a. Uma jogada do humano até o motor

```mermaid
sequenceDiagram
  actor J as Jogador
  participant UI as App.tsx
  participant G as game.ts
  participant FXL as FxLayer
  J->>UI: clica na carta / ação
  UI->>G: isLegalMove(state, side, move)
  G-->>UI: legal? (botão habilitado)
  UI->>G: targetChoices / pendingPrompt
  G-->>UI: alvos / casas / prompt
  J->>UI: escolhe alvo
  UI->>G: applyMove(prev, side, move)
  Note over G: cloneGame + zera orçamentos<br/>resolveMove (play/reap/fight/use)
  G->>G: fire(trigger) → fireOwn
  G->>G: fireObservers(evento)
  G->>G: record(log) e checa 3 chaves
  G-->>UI: novo GameState
  UI->>FXL: commitWithFx (captureFx antes do commit)
  FXL-->>J: voo, impacto, som
```

**Fluxo:** a UI só habilita o que `isLegalMove` aprova e coleta alvos pelos helpers do motor. `applyMove` clona o estado (nunca muta o original), resolve o movimento e dispara as habilidades. `commitWithFx` mede o DOM antes do commit para animar a transição.

### 2b. Pipeline de tradução (texto → DSL aprovada)

```mermaid
sequenceDiagram
  actor D as Dono
  participant H as ability-harvest.mjs
  participant L as catalogLlm.ts
  participant P as Proxy local :47813
  participant F as drafts.json
  participant A as App (LlmSettings)
  participant E as abilities.ts
  D->>H: npm run harvest -- --llm
  H->>L: pendingTranslations(cards)
  L-->>H: faces sem DSL confiável
  H->>L: runTranslation(pool)
  L->>P: callProvider (chat completions)
  P-->>L: JSON da DSL
  Note over L: validação tripla:<br/>schema → sanityProblem → dryRunProblem
  L-->>H: save(row) ou failureRow
  H->>F: grava rascunhos (serializado)
  D->>H: --export-queue
  H->>F: lê, exportableRows
  H-->>D: queue-export.json
  D->>A: importa (validateQueueRows)
  A->>A: fila de revisão (reviewQueue)
  D->>A: Aprovar
  A->>E: putAbilityOverride → applyAbilityOverride
  Note over E: reviewed: true → rulesOf lê na hora
```

**Fluxo:** o harvest filtra o que falta, traduz em paralelo, valida cada rascunho 3 vezes e persiste em `drafts.json`. O export vira um arquivo importável; no app o dono revisa e aprova. Aprovar grava no IndexedDB e atualiza o mapa vivo do motor (sem recarregar).

### 2c. Importar deck do Master Vault e sincronizar catálogo

```mermaid
sequenceDiagram
  actor J as Jogador
  participant UI as App.tsx
  participant K as keyforgeApi.ts
  participant MV as Master Vault
  participant C as cache.ts
  J->>UI: cola link ou UUID do deck
  UI->>K: fetchKeyforgeDeck / loadDeckOrCache
  K->>MV: GET deck
  MV-->>K: deck + cartas
  K->>C: grava deck (IndexedDB, fallback localStorage)
  K-->>UI: DeckInfo (ou VaultError → vaultErrorText)
  J->>UI: Sync do catálogo
  UI->>K: syncCatalog (paginado, cursor persistido)
  K->>MV: fetchCardPage
  K->>C: só cartas novas ou com textHash mudado
  Note over C: overrides só valem entre partidas
```

**Fluxo:** falha de rede cai no cache; o sync é incremental e cancelável.

### 2d. Desfazer (undo)

```mermaid
sequenceDiagram
  actor J as Jogador
  participant UI as App.tsx
  participant H as pilha de undo
  J->>UI: Desfazer
  UI->>UI: undoInfo (pass-and-play: indisponível)
  UI->>H: volta ao último ponto do jogador
  H-->>UI: GameState anterior + deck do momento
```

**Fluxo:** `commitGame` empilha cada transição (limite `UNDO_LIMIT` = 40); como o Sync pode trocar faces no meio do turno, cada entrada guarda também o deck.

---

## 3. C4

### C1 — Contexto

```mermaid
flowchart TB
  P["[Persona]<br/>Jogador"]
  D["[Persona]<br/>Dono / mantenedor"]
  S["[Sistema]<br/>Aember Arena (PWA)"]
  MV["[Externo]<br/>Master Vault API"]
  PX["[Externo]<br/>Proxy local do dono"]
  LLM["[Externo]<br/>Provedor LLM"]
  P -->|joga solo offline| S
  D -->|revisa traduções| S
  S -->|importa decks e cartas| MV
  S -->|pede rascunhos de DSL| PX
  PX -->|encaminha| LLM
```

**Fluxo:** o jogador usa o PWA offline; a rede só entra para importar decks/cartas e, opcionalmente, traduzir texto de carta em DSL via LLM.

### C2 — Containers

```mermaid
flowchart TB
  subgraph PWA["[Container] PWA single-file"]
    BUNDLE["index.html<br/>(JS+CSS inline)"]
    SW["sw.js<br/>(service worker)"]
  end
  IDB[("[Container] IndexedDB<br/>decks, cards, stats, abilities")]
  subgraph NODE["[Container] Scripts Node"]
    EXPN["catalog-export"]
    HARV["ability-harvest"]
    RELAY["llm-cors-relay"]
  end
  E2E["[Container] e2e harness<br/>Playwright"]
  MV["[Externo] Master Vault"]
  BUNDLE --> IDB
  BUNDLE --> MV
  SW -.cache LRU.-> BUNDLE
  BUNDLE --> RELAY
  EXPN --> MV
  EXPN -->|cards-mv.json| HARV
  HARV -->|drafts.json / queue-export.json| BUNDLE
  E2E -->|dirige| BUNDLE
```

Probes (`e2e/probes/*`) e `bench/` (duelos de IA, `RUNBOOK.md`) ficam fora do bundle e só rodam em dev.

**Fluxo:** o bundle é autossuficiente (roda de `file://`). Estado persistente fica no IndexedDB (com fallback localStorage). Os scripts Node alimentam o app por arquivos, não por rede.

### C3 — Componentes (dentro do PWA)

```mermaid
flowchart LR
  subgraph PWA["PWA"]
    UI["[Component] App.tsx + components/"]
    MOT["[Component] Motor<br/>game, ai, abilities, cardText"]
    CATC["[Component] Catálogo<br/>cache, keyforgeApi, catalogLlm"]
    I18["[Component] i18n.ts"]
    FXC["[Component] FxLayer + fx.ts"]
    SND["[Component] sound.ts"]
  end
  UI --> MOT
  UI --> CATC
  UI --> I18
  UI --> FXC
  UI --> SND
  CATC -->|mergeAbilityOverrides| MOT
  FXC -->|diff de estados| MOT
```

### C3 — Componentes (dentro dos scripts)

```mermaid
flowchart LR
  subgraph NODE["Scripts Node"]
    EXP["[Component] catalog-export.mjs<br/>pagina o MV → cards-mv.json"]
    HARV["[Component] ability-harvest.mjs<br/>measure / harvestLlm / vendor / export-queue"]
    GEN["[Component] gen-dsl-schema.mjs"]
    RELAY["[Component] llm-cors-relay.mjs<br/>:47814 → :47813"]
  end
  CARDS["cards-mv.json"]
  DR["drafts.json"]
  Q["queue-export.json"]
  AP["generated/approved.json"]
  EXP --> CARDS
  CARDS --> HARV
  HARV --> DR
  DR --> Q
  DR -->|--vendor: só reviewed| AP
```

**Fluxo:** `catalog-export` baixa as cartas; `harvest` mede cobertura da gramática, gera rascunhos e exporta a fila. `--vendor` copia para `approved.json` só o que o dono aprovou.

### C4 — Código

#### rulesOf → regras efetivas de uma carta

```mermaid
flowchart TB
  R["rulesOf(face)<br/>memo WeakMap"] --> PC["parseCardText(face)"]
  R --> SA["storedAbility(face)<br/>whitelist + textHash"]
  SA --> M{"source?"}
  M -->|manual| MS["mergeStored"]
  M -->|script por título| SC["scripts[title]<br/>coverage full"]
  M -->|llm revisado / parser| MS
  M -->|nenhum| PC
  PC --> OUT["CardRules"]
  MS --> OUT
  SC --> OUT
```

**Fluxo:** a ordem de precedência é: entrada `manual` → script escrito à mão → `llm` revisado ou `parser` congelado → parser ao vivo. Linhas com `textHash` diferente ou `llm` não revisado nunca chegam à mesa.

#### fire / fireObservers e orçamentos

```mermaid
flowchart TB
  F["fire(state, source, trigger)"] --> FB{"fireBudget > 0?<br/>(64 por movimento)"}
  FB -->|não| STOP["retorna"]
  FB -->|sim| FO["fireOwn<br/>habilidades da própria carta"]
  FO --> OBS["fireObservers(event, trigger)"]
  OBS --> OB{"observerDepth < 8 e<br/>observerBudget > 0 (100)?"}
  OB -->|não| STOP
  OB -->|sim| LOOP["varre board dos 2 lados:<br/>ability.of + on + if"]
  LOOP --> ACT["autoPick alvo → executa acts"]
  ACT -.reaction em cadeia.-> F
```

**Fluxo:** `applyMove` zera os orçamentos a cada movimento (`resetAbilityBudgets`). Os limites impedem laços de observadores e de "ready and use via reap".

#### runTranslation — pool e validação tripla

```mermaid
flowchart TB
  RT["runTranslation(faces, cfg)"] --> G["groupByText + limit"]
  G --> W["N workers (concurrency)"]
  W --> TC["translateCard"]
  TC --> CP["callProvider"]
  CP -->|erro transporte| RETRY["retry com 2× timeout<br/>3 seguidas = para"]
  CP --> VD["validateDraft"]
  VD --> V1["1 draftRow: schema"]
  V1 --> V2["2 sanityProblem"]
  V2 --> V3["3 dryRunProblem<br/>(simula no motor)"]
  V3 --> ROW["row ok ou failureRow"]
  ROW --> SV["saveChain<br/>(saves serializados)"]
```

#### chooseAiMove — decisão da IA

```mermaid
flowchart TB
  CH["chooseAiMove(state, aiIndex, house, settings)"] --> CM["candidateMoves"]
  CM --> RR{"roll menor que randomRate?"}
  RR -->|sim| RND["jogada aleatória semeada"]
  RR -->|não| SIM["applyMove em cópia (SIM)<br/>+ search com orçamento de nós"]
  SIM --> EV["evaluatePosition / replyValue"]
  EV --> PICK["melhor valor; null se pior que parar"]
```

**Fluxo:** a IA usa só funções puras de `game.ts` (`applyMove`, `keyCost`, `houseOf`, efeitos persistentes), então vê as mesmas regras do jogador. O RNG vem da semente da partida.

#### Núcleo auxiliar: houseOf e keyCost

`houseOf(state, card)` resolve a casa efetiva (casa concedida, com guarda própria anti-laço) e `keyCost(state, side)` o custo da chave com efeitos persistentes (`forgeKey.less`, guarda anti-recursão). `isLegalMove`, `applyMove` e a IA os leem.

**Fluxo (runTranslation):** textos idênticos viram uma chamada só. Os workers buscam em paralelo, mas os `save` passam por uma cadeia de promessas (o `drafts.json` é reescrito inteiro). A cadeia é descarregada mesmo em abort, então nada já traduzido se perde.

---

## Notas do graphify

- **God nodes:** `App()` (97 arestas), `applyMove()` (51), `run()` (44), `textHash()` (33), `endTurn()` (31), `rulesOf()` (24).
- **Ciclos de import:** nenhum detectado.
- **Nós isolados:** 927 com ≤1 conexão (constantes e helpers de testes/probes, em sua maioria).
- Caminho `App → chooseAiMove → abilitiesOf → rulesOf` mostra que a IA consulta o mesmo motor de regras que o jogador.
- `harvestLlm()` chama `runTranslation()` direto: o Node reaproveita o pipeline do app.
