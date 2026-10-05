<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Plano da rota keyteki → AST → DSL v12. Escrito em 05/out/2026 sobre o clone
     C:/Users/HP/keyteki-research-sonnet (commit d9b239b, 04/out/2026), os dois
     relatórios de pesquisa e o motor em fbecf50 (DSL_VERSION 12, PARSER_VERSION 14).
     Nada aqui foi implementado. -->

# Plano de conversão keyteki → DSL (rota AST, 3 executores em paralelo)

## 0. O que muda em relação aos dois relatórios

Cruzei `KEYTEKI_DSL_RESEARCH.md` (Opus) com `KEYTEKI_DSL_RESEARCH_SONNET.md` e
re-medi no clone. Três coisas mudam o plano:

**0.1 — O "46% de cobertura" do relatório Opus está errado. O número real é 96%.**
Aquele relatório comparou os ids de cada pack com os arquivos da PASTA do mesmo set.
Reimpressão mora na pasta do set de origem (`01-Core/Anger.js` serve todos os sets),
então a conta puniu todo set com reimpressões (MoMu "6%", VM25 "2%"). Medido por id
distinto contra `master-vault-data/packs/*.json`:

| Medida | Valor |
|---|---|
| Ids distintos nos 15 packs | 2.710 |
| Com arquivo de carta no keyteki | **2.605 (96%)** |
| Sem arquivo | 105 (46 criaturas, 15 ações, 3 artefatos, 2 upgrades; o resto é archon power, token, tide) |
| Por set (com arquivo / ids) | CotA 363/370 · AoA 365/370 · WC 412/415 · MM 410/425 · DT 420/429 · WoE 399/414 · GR 398/398 · AS 327/329 · ToC 315/321 · MoMu 440/455 · VM25 302/305 · PV 368/369 · CC 319/350 · DM 285/285 · MG24 729/783 |
| Linhas do NOSSO corpus (4.809) com arquivo keyteki, casando por título | **4.496 (93%)**, 2.305 títulos de 2.491 |

Consequência: o teto da rota não é "o que o keyteki implementa", é **o que a nossa DSL
expressa**. O farm LLM deixa de ser "a outra metade do corpus" e vira cauda de verdade
(§4.2). A frase do CLAUDE.md "cobrindo 46% do corpus MV" deve ser corrigida quando este
plano for aceito.

**0.2 — Divergências de medição entre os relatórios (re-medidas):**

| Item | Opus | Sonnet | Medido agora | Vale |
|---|---|---|---|---|
| Arquivos / classes / helpers usados | 2.606 / 101 / 127 | 2.606 / 101 / 127 (138 fábricas) | 2.606 / — / 127 (4.408 usos) | convergem |
| Registros | 3.036 (sem `whileAttached`) | lista com `whileAttached` 145 | **3.081** | Sonnet |
| Top-20 helpers | "~75% dos usos" | "~38 nomes ≈ 75–80%" | top-20 = **71,4%**, top-40 = **90,5%**, top-60 = 96,8% | medido |
| Arquivos com `then:` | 480 | 627 | **627** (703 ocorrências) | Sonnet |
| Efeitos distintos usados | 80 | 80 | 80 (1.032 usos) | convergem |
| Camadas de lambda | 604 "estáticos" | A 436 (17%) · B 1.038 (40%) · C 1.067 (41%) · D 65 (2,5%) | não re-medido | usar o do Sonnet (critério explícito) |
| Harland Mindlock | parcial | "1:1, verificar" | v12 tem `takeControl.whileSource` | 1:1 hoje |
| Esforço | 2–4 semanas | 2–3 semanas | — | §6 |

Medições novas que orientam a divisão: arquivos cujas ações cabem TODAS no top-20 =
1.639 (63%), no top-40 = 2.251 (86%), no top-60 = 2.486 (95%). Dos 127 nomes, ~35 são
aliases `add/remove<Xxx>Counter` — uma regra genérica, não 35 entradas.

**0.3 — Os dois relatórios falam de DSL v10; o motor está na v12.** Já fechados pelos
Lotes 11–12 e que os relatórios ainda listam como lacuna: `reveal` público,
`entersPlayReady`, `fightDamageCap` (= `limitFightDamage`), `mayPlay`
(= `canPlayNonHouse`), `Replacement.when` (dano CAUSADO em luta), `heal` sem `n`
(= `fully`), `takeControl.whileSource`. A lista de lacunas reais sai do histograma do
M1 (§4.1), não dos relatórios.

---

## 1. Arquitetura do conversor

Build-time puro, em `scripts/keyteki/` (versionado; `src/` nunca importa de lá). Roda
com `vite-node` como os outros scripts, para importar `validateDraft`, `textHash`,
`parseCardText` e `DSL_VERSION` de `src/lib`. Parser JS: **`acorn`** (8.18 já está em
`node_modules` como transitiva; promover a devDependency explícita). Babel não compra
nada aqui: os arquivos são CommonJS simples, mediana de 24 linhas.

### 1.1 Pipeline e módulos

```
arquivo .js ──parse──▶ CardIR ──lower──▶ {abilities, effects, partial?} | Unsupported
                                             │
corpus (cards-corpus.json) ──match por id/título──▶ faces ──emit──▶ validateDraft ──▶ linhas
                                                                                       │
                                                         golden (diff × parser) ◀──────┘
```

| Módulo | Faz | Dono |
|---|---|---|
| `lib/parse.mjs` | acorn → `CardIR { id, set, file, headerText, regs[], flags }`. `regs[]` = cada `this.<registro>({...})` com o nó do objeto. `flags`: `customMethods` (58 arquivos), `registrar` (26), `noSetup` (22) | S |
| `lib/ir.mjs` | Tipos JSDoc + helpers de AST (`prop(obj,"x")`, `lit(node)`, `isAction(node)`), classe `Unsupported(code, detail)` | S |
| `lib/lower.mjs` | Registro → `Ability`/`PersistentEffect`: gatilho, `reap:true`/`fight:true` no registro, `optional`, `condition`, `target`/`targets`, `gameAction` (objeto, array, `sequential`), `then`, `effect` (ignorado: é log) | S |
| `lib/engine.mjs` | Motor de padrões de lambda (§1.3) | S |
| `tables/*.mjs` | Tabelas declarativas por família (§1.2) | G (S só a `core`) |
| `patterns/data/*.json` | Padrões de lambda como DADO, um arquivo por família (§1.3) | M, G |
| `patterns/*.mjs` | Padrões que precisam de código (eventos, `then`) | S |
| `lib/emit.mjs` | id keyteki → faces do corpus; `validateDraft(face, parts, source, model)` por grupo `textHash|type` (mesma chave do `groupByText`); grava `scripts/harvest/drafts-keyteki.json` | S |
| `lib/reconcile.mjs` | Cruzamento texto × código (§5.2) e os 3 votos (conversor, parser, rascunho LLM existente) | S |
| `lib/canon.mjs` + `lib/golden.mjs` | Forma canônica da DSL e o Golden Set (§3.4) | S |
| `convert.mjs` | CLI | S |
| `mimo-batch.mjs` | Arnês do mimo: lote de prompts via relay, valida e grava dado (§2.3) | G |
| `SOURCE.json` | `{ repo, commit: "d9b239b…" }` — clone fixado | S |

Scripts npm (todos adicionados por S no primeiro commit, ninguém mais toca em
`package.json`):

```
npm run keyteki:convert -- --src C:/Users/HP/keyteki-research-sonnet [--set 01-Core] [--only anger] [--report]
npm run keyteki:convert -- --dump lambdas|props|reasons      # insumos das lanes G e M
npm run keyteki:golden  -- [--check] [--update]              # --check falha se a catraca cair
npm run keyteki:mimo    -- --task <nome> --in <json> --out <json>
```

### 1.2 Tabela action → union (contrato das entradas)

Este contrato é o que deixa G começar no dia 1 sem esperar o esqueleto. Cada arquivo
exporta um objeto chaveado pelo nome keyteki:

```js
// tables/actions.zones.mjs
export default {
  destroy:         { k: "destroy", sel: "card" },
  gainAmber:       { k: "gainAmber", amount: "n", player: true },
  discardAtRandom: { k: "discardRandom", amount: "n", player: true },
  moveToBottom:    { k: "returnToDeck", sel: "card", fixed: { at: "bottom" } },
  returnToDeck:    { k: "returnToDeck", sel: "card", props: { shuffle: (v) => v === true ? { at: "shuffle" } : null, bottom: (v) => ({ at: v ? "bottom" : "top" }) } },
  search:          { unsupported: "search" },
  abduct:          { fn: "abduct" },          // resolve em tables/custom.<lane>.mjs
};
```

- `sel: "card"` → `Selection` vinda do contexto (alvo da ability, `self` por omissão —
  o default do keyteki para card action é `context.source` — ou `each` via lambda).
- `player: true` → `opp` quando o alvo é `context.player.opponent`.
- `props` declara TODA propriedade keyteki que a entrada entende.
- **Regra de ouro (falha fechada):** propriedade não declarada em `props` e fora da
  lista global de cosméticas (`effect`, `effectArgs`, `message`, `messageArgs`,
  `activePromptTitle`, `effectAlert`, `effectStyle`, `chatMessage`,
  `preferActionPromptMessage`) vira `Unsupported("prop:<nome>")`. Helper sem entrada
  vira `Unsupported("action:<nome>")`. Nunca "ignora e segue".

Arquivos de tabela (disjuntos por dono — é a mitigação da colisão, §3.2):

| Arquivo | Conteúdo | Nomes | Dono |
|---|---|---|---|
| `tables/actions.core.mjs` | Fluxo e estrutura: `sequential`, `conditional`, `sequentialForEach`, `chooseAction`, `jointAction`, `cardLastingEffect`, `lastingEffect`, `untilPlayerTurnEnd`, `duringOpponentNextTurn`, `untilPlayerNextTurn*`, mais `destroy`, `gainAmber`, `dealDamage`, `capture`, `steal`, `draw`, `loseAmber`, `use`, `fight`, `reap`, `resolveAbility` | ~22 | S |
| `tables/actions.zones.mjs` | `discard`, `archive`, `returnToDeck`, `returnToHand`, `purge`, `moveCard`, `moveToBottom`, `putIntoArchives`, `discardAtRandom`, `discardTopOfDeck`, `discardEntireLocation`, `purgeAtRandom`, `archiveAtRandom`, `shuffleDeck`, `reveal`, `search`, `playCard`, `putIntoPlay`, `placeUnder`, `swap*`, `rearrange*` | ~28 | G |
| `tables/actions.tokens.mjs` | `ready`, `exhaust`, `stun`, `removeStun`, `heal`, `removeDamage`, `ward`/`removeWard*`, `enrage`, `exalt`, `placeAmber`, `removeAmber`, `returnAmber`, `transferAmber`, `makeTokenCreature`, `sacrifice`, `forgeKey`, `unforgeKey`, `gainChains`, `moveToFlank`, `changeActiveHouse`, regra genérica `/^(add|remove|clear)(\w+)(Counter|Token)s?$/` | ~30 + ~35 aliases | G |
| `tables/actions.cut.mjs` | Só `{unsupported}` com motivo: Tide, Prophecy, `mulligan`, `graft`, `gainsTextBox`, `attach`/`moveUpgrade*`, `allocate*`, `changeEvent` | ~15 | G (rascunho do M) |
| `tables/effects.mjs` | Os 80 `ability.effects.*` → campos de `PersistentEffect` | 80 | G |
| `tables/targets.mjs` | `cardType`, `controller`, `location`, `mode` (14 modos), `numCards`, `cardStat`, `optional`, `dependsOn` → `Filter`/`Selection`/`target2` | — | G |
| `tables/events.mjs` | Os 39 `onXxx` de `when:` → `on` + papel do `event.card` | 39 | S |
| `tables/index.mjs` | Descobre os arquivos por nome (`readdirSync`) e junta; **chave duplicada lança**. Escrito uma vez, ninguém edita depois | — | S |

### 1.3 Padrões de lambda

A lambda é normalizada (parâmetros renomeados para `$card`/`$ctx`/`$event`, impressão
canônica) e casada contra gabaritos com furos. O combinador de `&&` funde filtros; `!`
só onde a DSL tem negação (`house`, `trait`); `||` é `Unsupported("or")` (a DSL não tem
disjunção). Identificador fora do gabarito = sem casamento = `Unsupported("lambda")`.

Padrão simples é DADO (um JSON por família, sem conflito de merge):

```json
{ "id": "f.house", "slot": "cardCondition", "when": "$card.hasHouse('$1')", "emit": { "house": "$1:House" } }
```

Padrão que depende do gatilho (`when:` de evento, `preThenEvents`) é código em
`patterns/*.mjs`. Interface única: `match(slot, node, env) → fragmento DSL | Unsupported`.

Famílias (arquivos que tocam cada uma, medido): `creaturesInPlay`/`cardsInPlay` 527 ·
`event.*` 409 · zonas do jogador 326 · casa 323 · tokens/âmbar 268 · `preThenEvent*` 226 ·
vizinhos 196 · traço 135 · `isHaunted` 84 · poder 103 · chaves 100 · flanco 90 · Tide 83 (corte).

### 1.4 Saída

Linha no formato do pipeline (`AbilityOverride`), uma por face:

```json
{ "cardId": "<id MV>", "dsl": [...], "effects": [...], "keywords": {...}, "textHash": "c19533a7",
  "source": "keyteki", "reviewed": false, "generatedAt": 0, "v": 12, "model": "keyteki-ast@d9b239b" }
```

`model` carrega a proveniência (commit fixado). O conversor é determinístico:
`drafts-keyteki.json` se REGENERA, nunca se edita à mão. Sem conversão não se emite
linha de falha na fila — o motivo vai para `scripts/harvest/kt-report.json` (§4.3).

---

## 2. Divisão paralela

Resposta às três sugestões de corte:

1. **Tabela em blocos de ~30 por executor: não.** O uso é concentrado demais (top-20 =
   71%, nomes 41–127 = 9,5% dos usos) e um quarto dos nomes é a mesma regra de
   contador. Corta-se por FAMÍLIA em arquivos separados (§1.2): S fica com o núcleo
   estrutural, que só faz sentido junto do `lower.mjs`; G com as famílias mecânicas;
   M pré-classifica a cauda.
2. **Padrões de lambda por família: sim**, com um critério a mais — predicado LOCAL
   sobre a carta (casa, traço, flanco, poder, tokens) é dado e paraleliza; padrão
   CONTEXTUAL (evento, `then`) depende do gatilho e fica com quem escreveu o `lower`.
3. **Golden Set como validação compartilhada: sim, como árbitro de REGRESSÃO.** Ele só
   cobre o que o parser já lê `full` (~1.800 linhas, enviesado para carta simples), então
   não prova a camada C. Complementos obrigatórios: falha fechada, cruzamento com o
   texto, marca de evidência e revisão por amostra (§4.3, §5.1).

### 2.1 Lane S — Sonnet 5.5 (`claude` CLI, effort medium) — núcleo e semântica

- **Por quê:** é a lane que define as interfaces e onde erro de semântica custa mais
  (defaults do keyteki, `then`, eventos). Histórico do repo: os lotes de parser/DSL
  mais delicados saíram com Sonnet medium.
- **Escopo:** `lib/*`, `convert.mjs`, `tables/index.mjs`, `tables/actions.core.mjs`,
  `tables/events.mjs`, `patterns/events.mjs`, `patterns/then.mjs`, `SOURCE.json`,
  scripts em `package.json`.
- **Depende de:** nada. É o caminho crítico do M1.
- **Entregável verificável:** `npm run keyteki:convert -- --report` percorre os 2.606
  arquivos com 0 exceções; todo registro vira DSL ou `Unsupported(código)`;
  `--dump lambdas|props|reasons` gravam os insumos de G e M; `keyteki:golden --update`
  cria a catraca; testes em `scripts/keyteki/**/*.test.mjs` (o vitest já os descobre,
  não há `include` customizado).

### 2.2 Lane G — Grok 4.7 (`cursor-agent` CLI) — tabelas e famílias mecânicas

- **Por quê:** volume alto de mapeamento com contrato fechado (§1.2), verificável por
  fixture; já executou lotes de DSL (Lote 12). Sobre "sem shell seguro": não verifiquei
  o sandbox do `cursor-agent` — o plano assume que NÃO há e isola por desenho: worktree
  próprio fora do OneDrive, escopo só em arquivos de dado/tabela, e os únicos comandos
  que a lane precisa são `npx vitest run scripts/keyteki` e `npm run keyteki:convert`.
- **Escopo, em ordem:**
  1. **F0** (branch própria, §3.1): literal `"keyteki"` em `src/lib` (§4.3). ~40 linhas + specs.
  2. **G0:** `mimo-batch.mjs` (reusa `callProvider` do `catalogLlm` e o relay `npm run relay:go`, porta 47815).
  3. `tables/actions.zones.mjs`, `actions.tokens.mjs`, `actions.cut.mjs`, `effects.mjs`, `targets.mjs`, `tables/custom.g.mjs`.
  4. M2: `patterns/data/counts.json` e `conditions.json` (`player.amber`, `hand.length`, `isHaunted`, `getForgedKeys`, contagens de `creaturesInPlay`).
- **Depende de:** só do contrato do §1.2 para escrever; do esqueleto de S para rodar
  ponta a ponta (a partir do dia 2). Antes disso valida por teste unitário da entrada.
- **Entregável verificável:** cada entrada com 1 fixture (trecho real de carta keyteki →
  DSL esperada); `--dump reasons` sem nenhum `action:<nome>` nem `effect:<nome>` não
  classificado (todo nome dos 127 + 80 tem entrada, nem que seja `{unsupported}`).

### 2.3 Lane M — mimo-v2.6-pro (OpenCode Go, API direta) — dado em lote

- **Por quê:** via API não há agente nem sistema de arquivos; serve para tarefa de
  função pura, em lote, cuja saída um script valida. Custo baixo, paraleliza
  (`concurrency 2`, o teto do proxy).
- **Escopo (sempre pelo arnês `keyteki:mimo`, quem roda é o dono/integrador):**
  1. **M-a (dia 1):** para cada helper da cauda (posições 41–127) e cada efeito, ler o
     fonte da classe em `GameActions/` + os tipos de `abilities.ts` e propor a entrada de
     tabela ou o motivo de corte → `scripts/harvest/kt-proposals.json` (insumo de G, não
     entra no repo).
  2. **M-b (M2):** a partir de `--dump lambdas` (lambdas normalizadas, agrupadas e
     contadas), gerar `patterns/data/filters.json` — predicados locais: `hasHouse` 407
     chamadas, `hasTrait` 185, `isOnFlank` 106, `hasToken` 82, comparações de poder,
     tipo, exausta.
  3. **M-c (M3–M4):** triagem — rotular cada grupo de `Unsupported` (lacuna de DSL com
     campo sugerido / corte / bug do conversor) e arbitrar divergência texto × código
     (§5.2), sempre como PARECER para o dono, nunca como aprovação.
- **Depende de:** G0 (arnês) para tudo; `--dump lambdas` de S para M-b.
- **Entregável verificável (o arnês rejeita o resto):** todo gabarito casa ≥ 1 lambda
  real do dump; o `emit` passa na porta de forma (`normaliseAbilityOverride` sobre uma
  linha sintética); a catraca do golden não cai. Padrão sem nenhuma carta do golden
  que o exercite entra marcado `evidence: 0` (§4.3).

### 2.4 Lane E — motor (uma por vez, serial)

`src/lib/abilities.ts`, `game.ts`, `catalogLlm.ts` e `generated/dslSchema.ts` são
monolíticos: **só uma lane mexe em `src/lib` de cada vez**, no fluxo normal de lote
(specs `dslNN.test.ts`, `npm run gen:schema`, review). Executor por lote conforme o
histórico (Grok low ou Sonnet medium + review Opus). O conteúdo de cada lote sai do
histograma (§4.1).

### 2.5 Sequencial × paralelo

```
D1  S: parse + dump ─────────────┐        G: F0 → G0 ───────┐      M: (espera G0) → M-a
D2  S: lower + emit + golden     ├─ dump ▶ G: tabelas ◀─────┴─ propostas M-a
D3  S: core/events  ── M1 ───────┘        G: tabelas          M: M-b (filtros)
M2  S: patterns events/then               G: counts/conditions M: M-b → M-c     E: lote v13
```

Sequencial de verdade: `parse.mjs` → todo o resto roda; G0 → lane M; F0 → importar
linhas no app. Tudo mais é paralelo por arquivos disjuntos.

---

## 3. Branch e merge

### 3.1 Branches e worktrees

Tronco de integração próprio, lanes curtas, arquivos disjuntos:

| Branch | Base | Quem | Toca |
|---|---|---|---|
| `kt/main` | `main` (fbecf50) | integrador (dono/Opus) | merges + `golden/ratchet.json` |
| `kt/s-core` | `kt/main` | Sonnet | §2.1 |
| `kt/g-tables` | `kt/main` | Grok | §2.2 itens 2–4 |
| `kt/m-data` | `kt/main` | arnês do mimo | `patterns/data/filters.json` |
| `kt/e-source` (F0), depois `kt/e-dsl13`, `-dsl14` | **`main`** | lane E | `src/lib/**` |

A lane E sai de `main` e volta para `main` como qualquer lote; `kt/main` puxa `main`.
Assim o motor não fica refém da integração do conversor, e o trabalho de grafias do
parser que continua em `main` não colide com as lanes do conversor.

```bash
git branch kt/main main
git worktree add C:/Users/HP/kf-wt/s -b kt/s-core  kt/main
git worktree add C:/Users/HP/kf-wt/g -b kt/g-tables kt/main
git worktree add C:/Users/HP/kf-wt/m -b kt/m-data   kt/main
git worktree add C:/Users/HP/kf-wt/e -b kt/e-source main
# em cada worktree: npm ci   (fora do OneDrive de propósito: node_modules + sync)
```

### 3.2 Onde colide e como mitigar

| Ponto | Mitigação |
|---|---|
| Tabela central | Não existe: uma tabela por família/dono, `tables/index.mjs` descobre por nome e lança em chave duplicada |
| Padrões de lambda | Um JSON por família; código só em `patterns/*.mjs` (S) |
| `package.json` | S adiciona os 3 scripts e `acorn` no primeiro commit; depois ninguém toca |
| `golden/ratchet.json` | Só o integrador grava (`--update` depois de cada merge). Lane que commitar esse arquivo tem o merge recusado |
| `src/lib/**` | Só a lane E, uma por vez, via `main` |
| `DSL_VERSION` | Só a lane E sobe (v13, v14…). Commits de grafia em `main` sobem só `PARSER_VERSION`, como o fbecf50 |
| `scripts/harvest/**` | Gitignored: dumps, propostas, drafts e relatórios nunca entram em merge |

### 3.3 Cadência

Merge **diário** em `kt/main`, ordem fixa S → G → M, com o portão depois de CADA merge:

```bash
git switch kt/main && git merge --no-ff main           # traz motor/parser do dia
git merge --no-ff kt/s-core
npm run typecheck && npx vitest run && npm run keyteki:golden -- --check
#   falhou? git reset --hard ORIG_HEAD   (sem remote: nada foi publicado)
#   passou? repete para kt/g-tables e kt/m-data, depois:
npm run keyteki:golden -- --update && git commit -am "chore(keyteki): catraca do golden"
```

Na manhã seguinte cada lane faz `git rebase kt/main`. `kt/main` → `main` **por marco**
(M1…M4), `git merge --no-ff kt/main` depois de `npm run build` + `npm test`. Como o
conversor fica fora do bundle, esse merge só carrega risco quando traz dados
vendorizados (M3/M4).

### 3.4 Golden Set como árbitro

Elegíveis: faces com `parseCardText(face).coverage === "full"` E arquivo keyteki.
`canon.mjs` normaliza (ordem de chaves, defaults omitidos) e compara:

- **AGREE** — iguais. Entram na catraca: o número só pode subir. Merge que derruba = recusado.
- **DIFF** — diferentes. Vão para `scripts/harvest/kt-diff.json` e são triados em três
  baldes: bug do conversor, bug do PARSER (ganho colateral: o conversor audita as 1.800
  atuais), ou formas equivalentes (entram em `golden/equiv.json`, revisado por humano).
- **Só-conversor** — o parser não lê `full`. Fora do golden; valem o portão triplo
  (`validateDraft`), o cruzamento com o texto e a fila de revisão.

`golden/ratchet.json` guarda `{ agree, diff, diffTriaged, full, partial, unsupportedByReason }`.

---

## 4. Impactos

### 4.1 Motor (v12 → v13+)

O conversor **nunca espera o motor**: o que a DSL não expressa vira `Unsupported` com
código, e o histograma de `--dump reasons` (cartas destravadas por campo) É o backlog
da v13+. Candidatos pelo que já está medido (usos no keyteki; a ordem final sai do M1):

| Lacuna | Evidência | Tamanho |
|---|---|---|
| Duração "até o início/fim do MEU próximo turno" e `until` por evento | `untilPlayerNextTurnStart` 8, `…End` 3, `lastingEffect` 11, `until:` 11 | pequeno (menor do que os ~170 que o relatório Sonnet cita: 160 desses já são `turn`/`next`) |
| Modos de alvo como dado | `mode: house` 39, `select` 79 (hoje só 2 opções), `unlimited` 22, `card-name` 4, `trait` 2 | médio |
| `cardCannot` | 100 usos, argumento não medido — M1 precisa do `--dump props` por argumento | ? |
| Entrada em jogo | `entersPlayStunned` 9, `entersPlayEnraged` 5 | pequeno (espelho de `entersPlayReady`) |
| Estatística fixa / texto | `removeKeyword` 12, `changeType` 10, `setPower`/`setArmor` 6+6, `blank` 6 | pequeno a médio |
| Substituição genérica de evento | `changeEvent` 34, `allocateDamage` 23, `allocateCapture` 13 | grande |
| Jogar carta de zona | `playCard` 45, `putIntoPlay` 19, `sequentialPutIntoPlay` 6 | grande (corte 🔴 do WAVE4) |
| `search` | 20 | grande (corte 🔴) |
| Tide / Prophecy | 83 arquivos / 91 registros + `fulfillProphecy` 22 | subsistemas — corte mantido |

Regra de fluxo: lote de motor entra em `main`; só depois o dono da tabela troca a
entrada de `{unsupported}` para o mapeamento (diff de uma linha) e a linha regenera
com o `v` novo.

### 4.2 Farm LLM

Com a cobertura corrigida, o farm fica para: (a) as 105 cartas sem arquivo keyteki
(66 jogáveis); (b) o que o conversor devolve `Unsupported` mas o TEXTO talvez caiba na
DSL; (c) terceiro voto. Recomendo **pausar o farm em massa sobre cartas que têm arquivo
keyteki até o M3** — cada rascunho LLM dessas cartas é quota gasta e uma linha de
revisão que o conversor vai substituir. Os rascunhos que já existem em `drafts.json`
não se perdem: viram voto (conversor = rascunho LLM → confiança maior). Precedência
quando há mais de uma fonte: `manual` > aprovada > `keyteki` > `llm` > parser.

### 4.3 Revisão do dono

**A UI hoje NÃO aceita `source: "keyteki"`** — quatro pontos barram:

| Onde | O que faz hoje |
|---|---|
| `abilities.ts:688` `OVERRIDE_SOURCES` | a porta de forma descarta a linha |
| `abilities.ts:523` `storedAbility` | só confia em `manual`/`parser`/`llm` revisada |
| `catalogLlm.ts:1329/1338` `reviewQueue`/`approvedFailures` | filtram `source === "llm"` |
| `catalogLlm.ts:1373` `validateQueueRows` | rejeita com motivo `"source"` |

É o **F0**: aceitar `"keyteki"` nos quatro (confiável só com `reviewed: true`, como
`llm`), rótulo i18n en + pt-BR e um filtro de origem na fila. Atalho sem tocar no app,
se F0 atrasar: emitir `source: "llm"` com `model: "keyteki-ast@…"` — funciona hoje,
mas mistura as origens na fila; não recomendo como estado final.

Volume: são milhares de linhas, revisão uma a uma não fecha. Proposta de faixas:

| Faixa | Critério | Tratamento |
|---|---|---|
| T1 | conversor ≡ parser `full` | nenhuma linha emitida (o parser já entrega) |
| T2 | conversor `full`, todo padrão com evidência no golden, texto reconcilia | aprovação em LOTE por assinatura: revisa 3 amostras da assinatura, aprova as N |
| T3 | padrão `evidence: 0`, aviso de reconciliação, voto LLM contrário, ou `partial` | revisão individual na fila |
| T4 | `Unsupported` | só no relatório, fora da fila |

Assinatura = hash da DSL canônica com números, casas e traços abstraídos.
**Decisão em aberto para o dono:** aceitar aprovação em lote por amostra (T2). Sem
ela o M3 produz rascunhos mais rápido do que dá para aprovar.

### 4.4 Bundle

O conversor custa zero (fica em `scripts/`). **Os dados não custam zero:**
`approved.json` é importado estaticamente por `vendored.ts` e hoje tem 10 linhas.
Com ~3.000 linhas chaveadas por `cardId` (UUID de 36 caracteres, que não comprime), a
estimativa é da ordem de **+80 a +130 kB gz** sobre os ~167 atuais — estimativa de
ordem de grandeza, não medida. O teto está aposentado, então não bloqueia, mas quase
dobra o `index.html`. Mitigação a decidir no M3: vendorizar por `textHash|type` em vez
de `cardId` (o mesmo texto serve ~2 ids em média: 4.496 linhas para 2.305 títulos) e
expandir no boot. Medir com `npm run e2e:bundle` antes de decidir.

---

## 5. Riscos

### 5.1 Divergência semântica silenciosa (o maior)

Carta que converte, passa no portão triplo e joga ERRADO. Fontes concretas:

- **Defaults que diferem entre os motores:** alvo por omissão (card action →
  `context.source`; player action → `context.player`), `controller` omitido = qualquer
  lado, `returnToDeck` (topo vs `shuffle`, 41 usos da prop), `duration: "next"` (a
  armadilha já documentada em `PersistentEffect.duration`).
- **`then`:** só resolve se os eventos anteriores não foram cancelados, EXCETO com
  `alwaysTriggers` (282 ocorrências; `ThenAbility.js:117`). Sem → `act.if did ≥ 1`;
  com → sem `if`. `then` em forma de função não é inspecionável → `Unsupported`.
- **Lambda quase igual a um gabarito** (um `&&` a mais, um `!`).
- **Código fora do `setupCardAbilities`:** 58 arquivos com métodos próprios, 26 com
  `EventRegistrar` → o arquivo inteiro é `Unsupported("custom")`.

Mitigações, em camadas: falha fechada (§1.2); fixture por entrada de tabela; golden
como catraca; marca `evidence: 0`; `partial` só quando o que sobra de fora é um
REGISTRO inteiro (nunca um act ou condição dentro de uma ability — isso torna a
ability inteira `Unsupported`), e toda `partial` cai em T3, porque a cláusula omitida
pode ser justamente o custo da carta. Opcional no M4: o keyteki tem 2.672 specs por
carta (`test/server/cards/**`) que servem de leitura de apoio na revisão por amostra.

### 5.2 Texto que diverge do comportamento keyteki

Implementação legada, errata, ruling embutido no código. Cruzamento em
`reconcile.mjs`: (a) o comentário de cabeçalho do arquivo, normalizado, tem de bater o
`textHash` da face — senão `text-drift`; (b) um título com 2+ textos distintos no
corpus (errata entre sets): só a face cujo texto bate o cabeçalho recebe a linha, as
outras ficam `text-variant`; (c) contagem de cláusulas com gatilho no texto ×
abilities emitidas; (d) os três votos. Qualquer aviso → T3. Quando código e texto
divergem, ninguém vence sozinho: o humano decide.

### 5.3 Licença

O projeto já é `AGPL-3.0-only` e `abilities.ts` já declara a derivação; as linhas
geradas são derivadas do keyteki. Fazer: cabeçalho SPDX + copyright "keyteki
contributors" em todo arquivo de `scripts/keyteki/`; proveniência por linha
(`model: "keyteki-ast@<commit>"`); atribuição no cabeçalho de `vendored.ts` (JSON não
aceita comentário) e uma linha de créditos/licença visível no app, já que o artefato
distribuído é o `index.html`. É a minha leitura, não parecer jurídico — a obrigação de
oferecer o código-fonte a quem recebe o app já existe hoje.

### 5.4 Teto da DSL

A cauda (nomes 41–127) é 9,5% dos usos e boa parte é contador genérico; o teto real
são Prophecy, Tide, jogar carta de zona, `search`, substituição genérica de evento e
os arquivos com código próprio (58 com métodos extras, 26 com `EventRegistrar`; os
dois grupos podem se sobrepor). Sem os lotes de motor, a expectativa é ~70–80% dos
2.478 arquivos com abilities em `full` e o resto em `partial`/corte com motivo
(estimativa herdada dos relatórios; o M1 dá o primeiro número real).

### 5.5 Operacionais

Três executores no mesmo repo (mitigado por worktrees e arquivos disjuntos); OneDrive
sincronizando `node_modules` (worktrees fora dele); quota/timeout do tier Go
(concorrência 2, arnês retomável); linha do conversor pisando decisão do dono (o
`validateQueueRows` já protege `manual`/aprovada — manter a regra para `keyteki`);
clone fixado ficando velho (re-rodar é barato: muda `SOURCE.json`, regenera, golden
arbitra).

---

## 6. Cronograma

Dias são estimativa de calendário com o dono integrando uma vez por dia; o gargalo é a
integração e a revisão, não a velocidade dos executores.

| Marco | Dias | Sonnet (S) | Grok (G) | mimo (M) | Critério de saída |
|---|---|---|---|---|---|
| **M1 — esqueleto** | 1–3 | `parse`, `ir`, `lower`, `emit`, `canon`, `golden`, CLI, `actions.core`, `events`, dumps | F0 → G0 → `actions.zones`, `actions.tokens`, `actions.cut` | M-a: propostas da cauda e dos 80 efeitos | 2.606 arquivos, 0 exceções; todo helper/efeito classificado; ≥ 600 arquivos `full` (camada A + triviais); catraca criada; histograma de motivos publicado; F0 em `main` |
| **M2 — biblioteca de padrões** | 4–9 | `patterns/events`, `patterns/then`, `reconcile` | `effects`, `targets`, `counts.json`, `conditions.json` | M-b: `filters.json`; começa M-c | ≥ 55% dos arquivos `full` (~1.430); DIFF do golden 100% triado; lote v13 do motor escolhido pelo histograma e despachado (lane E) |
| **M3 — golden 80%** | 10–14 | fecha DIFFs de semântica, assinaturas e faixas T1–T4, `--export-queue` das linhas keyteki | flip das entradas destravadas pela v13; fixtures que faltam | M-c: triagem de `Unsupported` e pareceres texto × código | ≥ 80% das elegíveis do golden em AGREE (ou equivalência revisada), 0 DIFF sem triagem; ≥ 70% dos arquivos `full`; primeira leva T2 aprovada por amostra e vendorizada; bundle medido |
| **M4 — cauda partial** | 15–19 | regra de `partial` por registro, relatório final, atualização de `MECHANICS_REPORT.md`/CLAUDE.md | lote v14 do motor (se o histograma justificar) + flips | farm LLM retomado só na cauda: 66 cartas sem arquivo + `Unsupported` que o texto pode cobrir | 100% dos arquivos com veredito (`full`/`partial`/corte com motivo); fila T3 exportada; `kt/main` → `main`; cobertura do corpus re-medida com `npm run harvest` |

## 7. Decisões que dependem do dono

1. Aprovação em lote por amostra para a faixa T2 (§4.3) — recomendo sim.
2. Vendorizar por `textHash|type` em vez de `cardId` (§4.4) — decidir com o número do M3.
3. Pausar o farm LLM em cartas com arquivo keyteki até o M3 (§4.2) — recomendo sim.
4. Corrigir no CLAUDE.md o "46% do corpus MV" (§0.1).
