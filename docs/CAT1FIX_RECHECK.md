# Re-checagem de fechamento — correções da onda 1 do catálogo

Escopo: `git log ee50a4a..HEAD` (4 commits: 432cc67, ff306d1, ec06ef0, 7b88cc7).
Evidência: `npm test` → 13 arquivos, **256/256 passam** (`catalog.test.ts`: 31 testes, eram 14); `tsc --noEmit` limpo. Não rodei build/e2e.

## Achados obrigatórios

| # | Achado | Status | Evidência |
|---|--------|--------|-----------|
| 1 | Whitelist de `source` + validação de forma no load | **RESOLVIDO** | `abilities.ts` `storedAbility` confia só em manual/parser/(llm && reviewed === true); `normaliseAbilityOverride` valida cardId, textHash, source (whitelist), DSL (triggers, chaves de Act, `n`/`s` obrigatórios, condições), effects/keywords; `cache.ts` `loadAbilityOverrides` descarta linha malformada com warning e reconstrói só os campos conhecidos. |
| 2 | Precedência manual → script → llm revisado → parser; DSL cobre effects/keywords | **RESOLVIDO** | `abilities.ts` `rulesOf`: manual → `scripts` → stored → parser; `AbilityOverride.effects?/keywords?` e `mergeStored` (coverage "full" só se a linha cobre as três partes e não é `parser`). |
| 3 | `applyAbilityOverride` + merge no boot | **RESOLVIDO** | `abilities.ts` `applyAbilityOverride` (set + memo novo) e `mergeAbilityOverrides` (entrada da sessão vence); `cache.ts` `putAbilityOverride` aplica ao mapa vivo; `App.tsx:2465` usa o merge. |
| 4 | Cursor do sync | **RESOLVIDO** | `keyforgeApi.ts` `syncCatalog`: `written < fresh.length` → break sem avançar nem marcar `known`; página vazia → `page = 1`; `count` ausente → 0 e sem wrap (removido o `\|\| cards.length` de `fetchCardPage`); bônus: sem cartas em disco o cursor recomeça em 1 (cobre a divergência localStorage × IndexedDB). |
| 5 | Specs das lacunas | **RESOLVIDO** | `catalog.test.ts` cobre: cursor persistido/retomado, multi-página, wrap, página vazia, count ausente, falha de escrita, abort no fetch, precedência (script vs parser/llm; manual vence script), source desconhecido/ausente, linha malformada no load, corrida load×apply (merge), memo com a mesma face, parser-sourced real, dsl-only sem "full", migração v3→v4. |

## Regressões introduzidas pelos fixes

Nenhuma bloqueante. `fetchCardPage.count` agora pode ser 0: o único outro consumidor (`DeckBrowser.tsx:73`) usa `fetchDecks`, que mantém seu próprio fallback — sem impacto.

- **[BAIXA]** `putAbilityOverride` aplica o override ao mapa mesmo se a gravação em disco falhar (decisão documentada: "session-only"). Aceitável; só lembrar na onda 2 que o review queue não deve assumir persistência.
- **[BAIXA]** Falha de escrita na 1ª sync com store vazio: o cursor fica em N, mas o próximo sync recomeça em 1 (`known.size === 0`). Benigno (reprocessa do topo).

## Pendências não-obrigatórias da revisão original (continuam abertas, sem bloqueio)

- `parserVersion` na linha (entrada `parser` congelada quando o parser evolui) — MÉDIA, só relevante quando alguém gravar linhas `parser`; tratar no início da onda 2.
- Overrides trocados no meio de uma partida em curso (memo reiniciado) — aplicar só entre partidas; relevante quando a onda 2 escrever overrides.
- textHash de 32 bits e o texto entre parênteses ignorado — INFO.

## VEREDITO: **APROVADO para seguir à onda 2**

Os 5 obrigatórios estão resolvidos, com specs, sem regressão relevante. Levar `parserVersion` e a regra "aplicar overrides entre partidas" como itens de entrada da onda 2.
