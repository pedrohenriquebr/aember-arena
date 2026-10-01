# Revisão de código — Onda 1 do catálogo dinâmico

Escopo: `git log 36aa70c..HEAD` (DB v4, textHash, sync incremental, `rulesOf` com overrides, chip, seção Catálogo, `catalog.test.ts`). Referência: `docs/DYNAMIC_CATALOG_PLAN.md` §2-§6.
Evidência: `npm test` → 13 arquivos, **239/239 passam** (inclui os 14 de `catalog.test.ts`). Não rodei `build`/e2e (revisão de código; a medição de bundle 153,80 kB vem do commit, não verificada aqui).

## VEREDITO: APROVADO COM RESSALVAS

O desenho está correto e o código é limpo (motor puro, `GameState` intocado, storage engolido, overrides são JSON puro). Mas há 4 falhas que a onda 2 herdaria ao escrever neste store — são as correções obrigatórias abaixo.

---

## 1. Corretude

**Política de confiança — implementada como o plano pede, com 2 furos.**
- `src/lib/abilities.ts:195-200`: hash diferente → `null`; `llm && !reviewed` → `null`; manual/parser/llm-reviewed valem. OK.
- **[ALTA] Whitelist de `source` ausente.** `abilities.ts:198` só bloqueia `source === "llm"`. Linha com `source` ausente/desconhecido (store corrompido, versão futura) é *confiada*. Deve ser o inverso: confiar só em `manual | parser | (llm && reviewed)`. Idem `cache.ts:434`, que valida só `cardId` e `Array.isArray(dsl)` — sem checar `textHash`/`source`/forma dos elementos do DSL (camadas 2-3 do §4 são da onda 2, mas o *carregamento* deveria rejeitar linha malformada, senão uma linha ruim derruba o motor na hora de interpretar).
- **[ALTA] Override `parser` vence os `scripts` escritos à mão** (`abilities.ts:212-215`: `if (stored)` vem antes de `title in scripts`). Uma entrada `source:"parser"` congelaria a saída do parser sobre cartas com script curado (ex.: "ancient bear"), regredindo-as. Ordem correta: `manual` → script → (`llm` reviewed) → parser; entrada `parser` nunca deve preceder script.
- **[MÉDIA] DSL armazenado não substitui `effects`/`keywords`.** `abilities.ts:213` faz `{ ...parsed, abilities: stored.dsl }`: os `effects` persistentes e `keywords` continuam vindo do parser. Um DSL manual/revisado que corrige uma carta de efeito constante é ignorado nessa parte, e `coverage: "full"` mente. A linha `AbilityOverride` precisa carregar `effects`/`keywords` (ou o contrato precisa declarar que cobre só `abilities`).
- **[MÉDIA] Entrada `parser` fica congelada** com hash igual mesmo após o parser evoluir (o motor está em ondas). Falta `parserVersion` na linha, invalidando entradas `parser` de versão antiga.

**Sync incremental** (`keyforgeApi.ts:355-395`):
- Cursor persistido (`readCatalogCursor`/`saveCatalogCursor`, no `finally`) — OK; em erro/cancelamento grava a página *não concluída*, correto (reprocessa).
- Cancelar entre páginas mantém o gravado — OK (cada página é uma transação).
- textHash mudou → reescreve (`known.get(id) !== textHash`, linha ~380) — OK; linhas pré-v4 sem hash (`""`) são regravadas — OK.
- Página vazia = fim — OK, **mas** `keyforgeApi.ts:379` dá `break` sem resetar o cursor: se o Vault encolher/reordenar e a página `N` ficar vazia, **todo sync futuro retorna 0 páginas para sempre**. Resetar para 1 na página vazia.
- **[MÉDIA] Falha de escrita avança o cursor.** `putCatalogCards` devolve 0 em erro engolido (`cache.ts:378`), mas `keyforgeApi.ts:381-386` marca as cartas como `known` e avança a página — cartas perdidas até o wrap (que, com milhões de decks, nunca ocorre na prática). Só avançar/`known.set` se a escrita retornou `fresh.length`.
- **[MÉDIA] Cursor em localStorage × cards em IndexedDB divergem.** Se o usuário limpar um dos dois, o sync retoma na página N sem as anteriores. Gravar o cursor junto ao store (ou zerá-lo quando `countCatalogCards()==0`).
- **[BAIXA] `lastPage` com `count` ausente** (`keyforgeApi.ts:310,385`): o fallback `|| cards.length` conta *cartas únicas* da página, não decks → wrap prematuro para a página 1. Se `count` faltar, não aplicar wrap.
- **[INFO/risco §6]** 20 páginas × 10 decks = 200 decks por sync, ordenados `-date` e sujeitos a deriva de offset; cobrir 2.600+ cartas exige muitos syncs. Não é bug, mas o chip "N cartas" vai crescer devagar — vale expectativa no copy.

**textHash** (`cardText.ts:58-70`): estável — normaliza antes do FNV-1a, 32 bits; teste cobre espaço/caixa/reminder. Ressalvas: (a) `normalise` apaga todo `(...)`, então mudança *só* dentro de parênteses não invalida (aceitável; documentar); (b) 32 bits: colisão ~irrelevante para ~3k cartas, mas é o único guarda de staleness — considerar 53-bit/dois FNV antes da onda 2 (custo: poucos bytes).

## 2. Bugs

- **[ALTA] `putAbilityOverride` não atualiza o mapa em memória** (`cache.ts:410`, `abilities.ts:182`). Só existe `setAbilityOverrides(mapaInteiro)`. A onda 2, ao aprovar/gerar um DSL, grava no disco e `rulesOf` não enxerga até o próximo boot. Falta um `applyAbilityOverride(record)` que faça `map.set` + invalidar o memo.
- **[ALTA] Corrida boot × escrita.** `App.tsx:2464`: `loadAbilityOverrides().then(setAbilityOverrides)` *substitui* o mapa. Qualquer override gravado/aplicado entre o início do `getAll` e o `.then` é perdido da memória. Corrigir fazendo merge (carregado nunca sobrescreve chave já aplicada na sessão) — junto com o item anterior.
- **Memo**: `setAbilityOverrides` troca o `WeakMap` (`abilities.ts:182-185`) → override tardio *é* visto, sem cache velho. OK. Porém a troca ocorre **no meio de uma partida em curso** se o boot terminar depois de retomar um save: regras de uma carta podem mudar entre dois lances (determinismo da IA/replay). Aceitável na onda 1 (store vazio), mas deve ser regra: aplicar overrides só entre partidas, ou congelar por partida.
- **Chip**: `countCatalogCards` (`cache.ts:394`) conta todas as linhas de `cards`, inclusive o precache de decks (que agora carrega `textHash`, `cache.ts:121-125`). É coerente com "N cartas em disco" e com o texto do chip; só não é "cartas sincronizadas" — o `added` do toast e o chip podem parecer discrepantes na primeira execução. Documentar, não bloqueia.
- **Migração v3→v4** (`cache.ts:58-63`): só cria `abilities`; `cards` já existia desde v1; linhas antigas sem `textHash` são tratadas (`row.textHash ?? ""`). Segura. **Não testada** (o fake não modela `onupgradeneeded`).
- `App.tsx` `useEffect` sob StrictMode: o `disposed` descarta a 1ª execução e a 2ª aplica — OK.

## 3. Pureza / JSON-safety

- `AbilityOverride` (`abilities.ts`) é dado puro; `dsl: Ability[]` serializa via structured clone. OK. `rulesOf` devolve `stored.dsl` **por referência** (`abilities.ts:213`) — se alguém mutar o resultado, corrompe o mapa; baixo risco, motor não muta.
- `game.ts`/`ai.ts` intocados (diff não os inclui). `GameState` intocado. Invariante 2 preservado.
- Storage engolido de propósito em todas as funções novas (`cache.ts:355-436`) — OK (invariante 6).
- `withTimeout` trocou `window.setTimeout` por `setTimeout` e remove o listener no `clear` (`keyforgeApi.ts:163-180`) — sem vazamento.

## 4. Specs (14 novos)

Bons (comportamento): trust de `llm` não revisado → revisado; hash divergente → parser; `coverageCounts`; sync escreve uma vez e pula na 2ª; texto mudado reescreve; vazio = fim; store indisponível = vazio.

Fracos / lacunas:
- **Cancelar**: o teste aborta *dentro de `onProgress`* (`catalog.test.ts` "stops on cancel"), ou seja, só cobre o checagem no topo do loop; não cobre abort **durante** o `fetch` (o caminho `catch` + `describeFailure`).
- **Sem spec do cursor**: persistência, retomada, wrap no fim, página vazia sem reset, `count` ausente, localStorage indisponível. É o núcleo do §3 e está 100% descoberto.
- Sync de várias páginas (só `pages: 1` e o caso cancel).
- Falha de escrita avançando cursor (bug acima) e erro HTTP no meio da corrida (cursor preservado, `added` parcial).
- Precedência script × override (bug acima); `source` desconhecido; linha malformada em `loadAbilityOverrides`.
- Corrida `load` × `apply`; memo invalidado por override tardio *com a mesma face já consultada* (o teste "ignora llm" chama `rulesOf` antes do `set`, cobre parcialmente).
- "parser-sourced" usa um `ability` stub, não a saída real do parser — não detecta congelamento por versão.
- Migração v3→v4 e chip (nenhum teste de UI).
- `textHash`: só 2 casos; faltam `æ/aember`, `1A` vs `1 amber`, `undefined`.

## 5. Correções obrigatórias antes da onda 2

1. `source` por whitelist em `storedAbility` e validação de forma em `loadAbilityOverrides` (`abilities.ts:198`, `cache.ts:434`).
2. Precedência: `parser` nunca vence `scripts` (`abilities.ts:212`); decidir se o DSL cobre `effects`/`keywords` e refletir em `coverage`.
3. `applyAbilityOverride()` (memória + invalida memo) chamada por `putAbilityOverride`, e **merge** no boot em vez de substituição (`App.tsx:2464`).
4. Sync: resetar cursor em página vazia; não avançar cursor/`known` se a escrita falhou; não aplicar wrap com `count` ausente; cursor coerente com o store (`keyforgeApi.ts:379-386`).
5. Specs: cursor (persistir/retomar/wrap/vazio), multi-página, abort durante fetch, precedência script × override, linha malformada, corrida load × apply.
6. Recomendado: `parserVersion` nas entradas `parser`; política "overrides só entre partidas".

Itens 1-4 são bloqueantes para a onda 2 (ela escreve neste store e depende de 1, 2 e 3 para que a revisão humana tenha efeito e não seja sobrescrita/congelada).
