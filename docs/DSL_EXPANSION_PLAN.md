<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Spec gerada pelo consultor Opus 5.5 (effort medium) em 02/out/2026, com medições
     reais do parser sobre scripts/harvest/cards-mv.json (3.744 ids, 2.196 textos únicos).
     Implementação em lotes — ver final do documento. Teto de bundle: Lote 1 cabe em 157;
     Lotes 2/3 pedem chore de teto (mecanismo CLAUDE.md §7) medido a cada commit. -->

# Spec: expansão da DSL de abilities (3 lotes)

A maior alavanca não é DSL nova: é o `normalise()`. O texto do Master Vault traz Æmber e dano como glifos privados (U+F360, U+F361), aspas curvas e prefixos `Play/After Reap:`, e o parser não lê nenhum deles. Só isso leva o parser de 177 para 306 cartas "full", com engine ≈ 0 bytes.

## O que medi

Rodei o parser real sobre `scripts/harvest/cards-mv.json` (3.744 ids, 2.196 textos únicos) com reescritas "what-if". Os scripts temporários já foram apagados.

| Etapa (cumulativa) | Cartas full | Ganho |
|---|---|---|
| Hoje | 177 | n/a |
| Normalização (glifos, aspas, prefixos, linha `Enhance`) | 306 | +129 |
| Grafias novas sobre a DSL existente | 314 | +8 |
| Filtro por casa / traço | 344 | +30 |
| `for each` (quantidade dinâmica) | 414 | +70 |
| Condições novas + `Otherwise` | 443 | +29 |
| `Scrap:` | 453 | +10 |
| Acts de zona do jogador | 499 | +46 |
| Verbos de mesa (fundo/embaralhar, ready-and-fight, contadores, splash) | 559 | +60 |

- **Estes números são piso:** sobram 1.629 formas de sentença, 1.366 delas únicas. A cauda é do LLM, então a DSL precisa de primitivas ortogonais, não de mais regex.
- **Overwhelmed** é "o oponente tem mais criaturas" — já existe como `fewerCreatures`; vira só um alias no parser.
- **Haunted** é "10+ cartas no descarte" (reminder impresso na carta).
- **"Takes no damage in return"** é o reminder de Skirmish: o prompt manda `face.text` cru e o modelo se confunde. É higiene do prompt, não feature.

## Dois alertas antes de codar

- **Teto de bundle:** o HEAD tem 0,69 kB de folga (156,31 de 157). Só o Lote 1 cabe; os Lotes 2 e 3 pedem revisão de teto (decisão sua). As estimativas de bytes abaixo são minhas, não medidas — medir com `e2e:bundle` a cada commit.
- **Working tree com mudanças que não são minhas:** `App.tsx` e `LlmSettings.tsx` agora importam `catalogLlm`, e o `dist/index.html` das 19:40 dá 165,64 kB (gzip do Node). Se isso for commitado, `FEW_SHOTS` e `DSL_SCHEMA` passam a contar no teto, e cada few-shot abaixo custa bundle.

## Contrato de versionamento (vale para os 3 lotes)

Sim, precisa de campo de versão. Hoje o gate rejeita `k` desconhecido, mas `target`/`each` só passam por `isRecord`. Um campo novo que estreita (ex.: `house`) seria ignorado em silêncio por um engine antigo, e "destroy each Mars creature" viraria "destroy each creature".

```ts
// abilities.ts
export const DSL_VERSION = 2;                 // 1 = implícito (linhas sem `v`)
export interface AbilityOverride { /* … */ v?: number }
```

1. A DSL só cresce por `k` novo, campo opcional novo ou literal novo. Nunca renomear, nunca mudar o significado de campo ausente.
2. `normaliseAbilityOverride` rejeita linha com `v > DSL_VERSION` e copia `v`. `draftRow` e `failureRow` gravam `v: DSL_VERSION`.
3. O gate valida chaves de `Filter`, `Count` e `Condition` por whitelist: chave desconhecida descarta a linha.
4. `pendingTranslations` re-enfileira falhas com `(row.v ?? 1) < DSL_VERSION`. Hoje o cache por `textHash` é eterno, e os 42 "unsupported" nunca seriam re-tentados.
5. Cada lote sobe `DSL_VERSION` e `PARSER_VERSION` em 1.
6. O `textHash` não pode mudar (ver 1.1), senão as linhas do IndexedDB morrem.

Para recuperar bytes, trocar `ACT_KEYS`, `NUMERIC_ACTS` e `SELECTED_ACTS` por uma tabela `const ACTS: Record<string,string> = { gainAmber: "n", capture: "ns", destroy: "s", archiveTop: "", … }`. Usar `Object.hasOwn`, porque `ACTS["constructor"]` não é `undefined`.

---

## LOTE 1 — texto legível + versão (teto 157 mantido; ~+0,3 kB)

### 1.1 `normalise` em três passos, hash congelado
- **(a) Forma:** nenhuma mudança na DSL.
- **(b) Execução:** `normalise = post(legacy(pre(t)))` e `textHash` continua sobre `legacy(t)`, o corpo atual.
  - `pre`: U+F360 → `<A>`, U+F361 → `<D>`, `“”` → `"`, U+2011/U+2013 → `-`, remove U+FEFF, remove `/(^|[.\n]\s*)enhance\b[^.:]*\./gi`, e por fim os demais `[\uF300-\uF5FF]`.
  - `post`: `<a>` → `amber`, `<d>` → `damage` (glifo sem número antes).
- **(c) Grafias:** `Steal 1.`, `Deal 3 to a creature`, `Enhance .`, `gains, “After Reap: Gain 1.”`.
- **(e) Riscos:** `Enhance` é instrução de montagem de deck; os ícones chegam por `bonusIcons`, então descartar a sentença é exato. Ancorar a regex em início de sentença para não comer títulos.

### 1.2 Prefixos e aspas
- **(b) Execução:**
  - `PREFIX`: a cauda vira `(?:\/(?:after )?(?:play|reap|fight|destroyed))*`.
  - `fate` entra em `PREFIX` só para segmentar. Hoje `Fate:` vaza para a ability anterior e derruba o `Play:` inteiro; com isso a carta fica partial com o Play funcionando.
  - `QUOTED_ABILITY`: delimitador `"` aceita `'` interno (`its owner's`); o cabeçalho ganha `at the`.
- **(e) Riscos:** nenhum além de subir `PARSER_VERSION`.

### 1.3 Grafias novas para a DSL que já existe
- **(c) Grafias:**
  - `(a|an|each) (friendly|enemy)? flank creature` e `each enemy creature not on a flank`.
  - `your opponent gains N amber` → `gainAmber opp`; `your opponent draws …` → `draw opp`; `each player gains N` → dois acts.
  - `return <obj> to your hand`.
  - `you are overwhelmed` → `{k:"fewerCreatures"}`.
  - `Otherwise,? X` → duas abilities com o mesmo `on`, a segunda com `if: {k:"not", c}`.
- **(b) Execução:** `fire()` avalia os `if` de todas as abilities antes de rodar a primeira. Sem isso, "steal 2" pode mudar a condição e disparar também o ramo `Otherwise`. É a única mudança de engine do lote.
- **(d) Few-shots:**
```json
{"type":"Creature","text":"After Reap: If you are overwhelmed, steal 2<A>. Otherwise, steal 1<A>.",
 "answer":{"abilities":[{"on":["reap"],"acts":[{"k":"steal","n":2}],"if":{"k":"fewerCreatures"}},
  {"on":["reap"],"acts":[{"k":"steal","n":1}],"if":{"k":"not","c":{"k":"fewerCreatures"}}}],"effects":[],"keywords":{}}}
{"type":"Action","text":"Play: Deal 2<D> to each enemy flank creature. Each player gains 1<A>.",
 "answer":{"abilities":[{"on":["play"],"acts":[{"k":"damage","n":2,"s":{"each":{"type":"Creature","side":"enemy","flank":true}}},
  {"k":"gainAmber","n":1},{"k":"gainAmber","n":1,"opp":true}]}],"effects":[],"keywords":{}}}
```
- **(e) Riscos:** o snapshot muda a ordem de avaliação de cartas com duas abilities no mesmo gatilho. É raro; cobrir com um spec.

### 1.4 Pipeline LLM
- **Texto limpo no prompt:** `cardPrompt` envia o texto sem parênteses, sem a linha Enhance e com glifos como `<A>`/`<D>`.
- **Regras novas no system:** "Ignore Enhance", "overwhelmed = fewerCreatures".
- **Schema:** `scripts/gen-dsl-schema.mjs` tem `SCHEMA_TYPES` fixo. No Lote 2, somar `Count` e `Zone`, senão o prompt cita tipos que não mostra.
- **Dry-run com dois cenários:** o atual, e um "rico".
  - Estado do rico: mãos com 3 dummies (um de outra casa), arquivos com 2, meu descarte com 11, oponente com 3 criaturas contra 2, uma criatura danificada por lado.
  - Dummies do rico: recebem as casas e traços citados nos filtros do rascunho.
- **Invariante novo em `brokenState`:** `instanceId` único entre todas as zonas e contagem de cartas não-token conservada.

---

## LOTE 2 — quantidades, condições, zonas (estimativa +1,5 a 1,9 kB; teto sugerido 159)

```ts
export type Trigger = /* … */ | "scrap";
export type Zone = "hand" | "deck" | "discard" | "archives" | "purged";
export type Count =
  | "did" | "gone"
  | { c: Filter }
  | { p: Zone | "keys" | "amber" | "plays"; opp?: boolean }
  | { of: "damage" | "amber" | "power"; s: Selection };
interface Filter { /* … */ house?: string; trait?: string; exhausted?: boolean }
type Selection = /* … */ | "fought" | { pick: Filter; n?: number };
type Act = ( /* … */
  | { k: "returnToDeck"; s: Selection; at?: "bottom" | "shuffle" }   // sai do grupo
  | { k: "move"; n: number; from: Zone; to: Zone; opp?: boolean;
      pick?: "top" | "random" | "all"; at?: "bottom" | "shuffle"; type?: string }
) & { optional?: boolean; if?: Condition; per?: Count };
type Condition = /* … */ | { k: "count"; of: Count; op: "eq" | "gte" | "lte"; n: number };
interface PersistentEffect { /* … */ if?: Condition; per?: Count; keyCost?: number; opp?: boolean }
```

### 2.1 `per` — "for each" (+70, a maior do lote)
- **(b) Execução:** `amount = act.n * (act.per ? count(ctx, act.per) : 1)`. O `n` continua numérico, então o gate e o check "número está no texto" não mudam.
  - `"did"`: quantas coisas o act anterior da mesma ability fez. Com seleção, conta cartas que saíram ou cuja assinatura `[controller, damage, ready, stunned, amber, warded, enraged]` mudou. Sem seleção, é o maior delta absoluto de `[amber, keys, chains, hand, deck, discard, archives, purged]` dos dois jogadores.
  - `"gone"`: cartas selecionadas que saíram de jogo. Ambos são medidos depois do `sweep`; act pulado zera os dois.
  - `{c}`: `everyMatch(...).length`.
  - `{p}`: tamanho da zona ou contador. `plays` é `state.plays` e inclui a carta sendo jogada.
  - `{of,s}`: soma do stat nas cartas selecionadas.
- **(c) Grafias:** `… for each creature (destroyed|healed) this way` e `card discarded this way`; `each of ~'s <House> neighbors`; `card in your (archives|hand)`; `forged key your opponent has`; `amber on (it|~)`; `damage on ~`; `friendly [ready] <House> creature`.
- **(d) Few-shot:** `Play: Heal 1 damage from each creature. Gain 1<A> for each creature healed this way.` → `[{"k":"heal","n":1,"s":{"each":{"type":"Creature"}}},{"k":"gainAmber","n":1,"per":"did"}]`
- **(e) Riscos:** `did` conta ward consumido como mudança; "destroyed this way" deve usar `"gone"`. Um draw que reembaralha infla o delta (não achei carta que conte "drawn this way").

### 2.2 `count` + `act.if` — "If you do", haunted, "on a flank", "exactly one card"
- **(b) Execução:**
  - Em `run()`: `if (act.if && !holds(act.if, ctx)) { zera did/gone; return }`.
  - `conditionHolds(cond, state, me, source?)` ganha o 4º parâmetro; atualizar a chamada em `ai.ts:226`.
  - Parser: condição em sentença única continua `ability.if` (preserva a poda da IA e o few-shot 4); nos demais casos vira `act.if`.
  - "If you do" deixa de ser incondicional (era desvio documentado no MECHANICS_REPORT §6).
- **(c) Grafias:**
  - `if you do` → `{k:"count",of:"did",op:"gte",n:1}`
  - `if this damage destroys that creature` → `gone gte 1`; `if it is not destroyed` → `gone eq 0`
  - `if you are haunted` → `{p:"discard"} gte 10`
  - `if ~ is on a flank` → `{c:{self:true,flank:true}} gte 1`
  - `if there are no enemy creatures` → `{c:{…}} eq 0`
- **(d) Few-shots:**
  - `Play: Exhaust a friendly creature. If you do, steal 2<A>.` → `acts:[{"k":"exhaust","s":"target"},{"k":"steal","n":2,"if":{"k":"count","of":"did","op":"gte","n":1}}], target:{"type":"Creature","side":"friendly"}`
  - `Play: If you are haunted, deal 5<D> to a creature. Otherwise, return a creature to its owner's hand.` → duas abilities, `if` = `{"k":"count","of":{"p":"discard"},"op":"gte","n":10}` e seu `not`.
- **(e) Riscos:** o 10 de haunted não está no texto; o check de número só olha acts, então passa, mas precisa de uma regra no system. Cortados: "even amount", "more amber than you", "healed 3".

### 2.3 `Filter.house` / `trait` / `exhausted` (+30 no parser; muito mais via LLM)
- **(b) Execução:** um helper serve casa e traço: prefixo `!` nega, `house: "active"` lê `state.activeHouse`, traços vêm de `face.traits` separados por `•`. `exhausted: true` é `!card.ready`; não mexer no `ready` existente.
- **(c) Grafias:** `each [friendly|enemy] <House> [flank] creature`, `non-<House> creature`, `<Trait> creature`, `non-<Trait> creature`, `each exhausted creature`.
- **(d) Few-shots:** `Play: Destroy each non-Mars creature.` → `{"k":"destroy","s":{"each":{"type":"Creature","house":"!Mars"}}}`; `Each friendly Knight creature gets +1 power.` → `effects:[{"target":{"type":"Creature","side":"friendly","trait":"Knight"},"power":1}]`
- **(e) Riscos:** o parser precisa de lista fechada de casas; traço só com `creature` explícito depois. "A creature of that house" depende de escolha de casa (cortado).

### 2.4 `PersistentEffect.if` / `per` / `keyCost` (56 cartas citam custo de chave)
- **(b) Execução:** `effectHits` exige `!effect.if || holds(effect.if, state, owner.side, owner.source)`; `power` e `armor` multiplicam por `per`. `keyCost(state, side)` soma os efeitos ativos cujo lado (`opp` → o outro) é `side`.
- **(c) Grafias:** `your opponent's keys cost +N`, `keys cost +N` (dois efeitos), `… for each <count>`, `while you are haunted, ~ gets +N power`, `while ~ is exhausted, …`, `if you are overwhelmed, ~ gains <keyword>`.
- **(d) Few-shot:** `Your opponent's keys cost +1<A> for each card in your archives.` → `effects:[{"target":{},"keyCost":1,"opp":true,"per":{"p":"archives"}}]`
- **(e) Riscos:** recursão infinita. `effect.if`/`per` com `top` ou `of:"power"` chama `effectivePower`, que chama `allEffects`. O gate tem de rejeitar essas duas formas dentro de efeitos.

### 2.5 `{pick}` e `"fought"` — segundo alvo e seleção contada
- **(b) Execução:** `{pick:F,n}` são até `n` (default 1) cartas distintas, escolhidas por `autoPick` repetido com `HARMFUL.has(act.k)`. `"fought"` é `ctx.fought`.
- **(c) Grafias:** segunda sentença com `a/an … creature` quando a ability já tem `target`; `<verbo> N (friendly|enemy) creatures`; `the creature ~ fights`.
- **(d) Few-shot:** `After Reap: Exhaust an enemy creature. If you do, ready a non-Priest creature.` → `acts:[{"k":"exhaust","s":"target"},{"k":"ready","s":{"pick":{"type":"Creature","trait":"!Priest"}},"if":{…did…}}]`
- **(e) Riscos:** o jogador escolhe só o primeiro alvo; os demais o engine escolhe, como já faz nos bonus icons. Prompt real fica para `GameMove.targets[]`, sem mudar a DSL. "Up to N" e "any number" ficam fora.

### 2.6 `move` e `returnToDeck.at` (+46 e parte dos +60)
- **(b) Execução:** um act cobre discardTop, descartar ou arquivar da mão, purgar aleatório da mão, purgar ou arquivar do descarte, e embaralhar o descarte no deck.
  - Seleção: `top` é o fim do array; `random` usa `roll`; `all` ignora `n`.
  - Sem `pick`, é escolha do controlador: da mão, a primeira carta fora da casa ativa; nas outras zonas, a do topo.
  - Destino: `at:"bottom"` usa `unshift`; `"shuffle"` chama `shuffle(dest, state)`.
  - `returnToDeck.at` reposiciona depois do `leaveByEffect`.
- **(c) Grafias:**
  - `discard the top [N] card(s) of your [opponent's] deck`
  - `archive a card`; `discard (a|N) card(s) [from your hand]`; `discard your hand`
  - `your opponent purges a random card from their hand`
  - `purge a [creature|card] from your discard pile`
  - `shuffle your discard pile into your deck`
  - `put X on the bottom of its owner's deck`; `shuffle X into its owner's deck`
- **(d) Few-shots:** `Destroyed: Your opponent purges a random card from their hand.` → `{"k":"move","n":1,"from":"hand","to":"purged","opp":true,"pick":"random"}`; `Action: Put a friendly creature on the bottom of its owner's deck.` → `{"k":"returnToDeck","s":"target","at":"bottom"}`
- **(e) Riscos:** escolha em zona oculta é automática (fidelidade do engine, não da DSL). "A discard pile" de qualquer jogador é `unsupported`. O invariante de conservação do 1.4 pega carta duplicada ou perdida.

### 2.7 Gatilho `scrap` (52 cartas)
- **(b) Execução:** um helper `toDiscard` é usado pelo move `discard`, pelo `move` mão→descarte e pelo `discardRandom`. Se o lado é o jogador ativo, chama `fire(card, "scrap")`.
  - `triggersFor(discard)` devolve `["scrap"]`.
  - `moveHasEffect(discard)` passa a consultar `canResolve` (hoje é sempre `false`).
  - O discard ganha variante `decline`.
  - No pipeline: liberar `scrap` para Action/Upgrade em `sanityProblem`, somar a `TRIGGER_WORDS` e parar de pular `discard` no `exercise`.
- **(d) Few-shot:** `Scrap: Archive a card.` → `{"on":["scrap"],"acts":[{"k":"move","n":1,"from":"hand","to":"archives"}]}`
- **(e) Riscos:** a fonte já está no descarte, então `s:"self"` devolve vazio (correto). A IA passa a descartar por valor; revisar o `e2e:smoke`.

---

## LOTE 3 — ações compostas e observadores (estimativa +0,8 a 1,1 kB; teto sugerido 160)

```ts
type Selection = /* … */ | "event" | "targetNeighbors";
| { k: "use"; s: Selection; via?: "fight" | "reap" }     // sai do grupo
| { k: "counter"; n: number; s: Selection }
interface Ability { /* … */ of?: Filter }
// keywords.ts: + "versatile";  CardInstance: counters?: number
```

### 3.1 `use.via` — "Ready and fight/reap with" (24 cartas)
- **(b) Execução:** `via:"fight"` pega `autoPick(fightTargets(...), harmful)`, chama `fight(...)` e grava `ctx.fought`. O parser não força `target.ready` quando há `ready` antes.
- **(d) Few-shot:** `Play: Ready and fight with a friendly creature.` → `acts:[{"k":"ready","s":"target"},{"k":"use","s":"target","via":"fight"}]`
- **(e) Riscos:** laço infinito com `Fight: ready and fight with ~`. O `sanityProblem` rejeita `use` com `s:"self"` em fight/beforeFight; o dry-run pega o resto como crash.

### 3.2 Observadores: `Ability.of` + `"event"` (cerca de 75 cartas citam eventos suportados)
- **(b) Execução:** o laço principal de `fire()` pula abilities com `of`. Depois, para cada carta em jogo dos dois lados (só abilities impressas), dispara as que têm `of`, o gatilho certo e `matches(state, lado, carta, source, of)`. Roda com `me` = lado do observador, `event` = source, alvo por `autoPick`, sem decline.
- **(c) Grafias:** `after/each time (a|an) [friendly|enemy] creature (reaps|fights|is destroyed)`; `after your opponent plays a creature`; `each time you use an artifact` → `on:["action","omni"]`.
- **(d) Few-shot:** `After an enemy creature reaps, stun it.` → `{"on":["reap"],"of":{"type":"Creature","side":"enemy"},"acts":[{"k":"stun","s":"event"}]}`. Substitui o few-shot `unsupported` atual por um de `Fate:`.
- **(e) Riscos:** só eventos de carta em jogo (`of.type` Creature ou Artifact). "Readies", "forges a key", "is stolen" e "is discarded" continuam fora. `TRIGGER_WORDS` precisa aceitar `reaps`/`fights`.

### 3.3 Contadores +1 de poder (49 cartas)
- **(b) Execução:** `card.counters += n`; `effectivePower` soma; `leavePlay` zera; entra na assinatura do `did`.
- **(c) Grafias:** `give X (a|two|three|N) +1 power counter(s)`, `put … on X`.
- **(d) Few-shot:** `Play: Give a creature two +1 power counters.` → `{"k":"counter","n":2,"s":"target"}`
- **(e) Riscos:** remoção e "for each counter" ficam fora.

### 3.4 Splash (11 cartas)
- **(b) Execução:** `"targetNeighbors"` são os vizinhos do alvo. O parser emite os vizinhos antes do alvo, porque se o alvo morre primeiro perde os vizinhos.
- **(d) Few-shot:** `Play: Deal 3<D> to a creature, with 1<D> splash.` → `[{"k":"damage","n":1,"s":"targetNeighbors"},{"k":"damage","n":3,"s":"target"}]`
- **(e) Riscos:** é a única exceção a "manter a ordem do texto"; dizer isso no system.

### 3.5 Keyword `versatile` (10 cartas)
- **(b) Execução:** `houseAllows` passa a aceitar `keyword(state, card, "versatile") > 0`. Concessões como "Each friendly Geistoid creature gains versatile" funcionam via 2.3.
- **(e) Riscos:** `houseAllows` hoje é função pura da face; conferir todos os pontos de chamada.

---

## Cortes

| Item | Por que não vale |
|---|---|
| `Fate:` (66) | Só dispara com Prophecy, um subsistema inteiro fora do deck. Fica segmentado e inerte. |
| Entrench (16), Tide (34) | Pedem escolha no passo de ready ou estado global, mais UI e IA. |
| Treachery (10), Invulnerable (4) | Baixo volume; a resolução do `Play:` sob controle inimigo é ambígua. |
| "Choose a house" / forçar casa (31) | Exige parâmetro de casa no `GameMove` e UI. |
| lookAtHand / reveal (41) | Só informação; nada a simular contra a IA. |
| Custo de âmbar no uso, redirect "instead" para criatura escolhida, "while attacking… on the flank" | 1 a 3 cartas cada. |
| "Forged a key last turn", cor de chave | Exigem memória de turno no `GameState`. |
| "Belongs to all houses", draw-step (Mother) | 1 a 3 cartas; o primeiro só seria aproximado por `versatile`. |
| "Up to N" / "any number" (62) | Escolha real de N alvos; esperar `GameMove.targets[]`. |

Para cada lote: `npm run build`, `npm test`, `npm run gen:schema`, `e2e:smoke` e `e2e:bundle`. Parar se passar do teto do lote.

LOTE 1: normalise em 3 passos com hash congelado, prefixos/aspas, grafias sobre a DSL atual (flank, opp/each player, overwhelmed, Otherwise + snapshot no fire), DSL_VERSION + gate em tabela + whitelists + retry de falhas, higiene do prompt e dry-run rico — 177→314 full, cabe em 157 | LOTE 2: `per`/Count, Condition `count` + `act.if` (did/gone, haunted), Filter house/trait/exhausted, PersistentEffect if/per/keyCost, Selection pick/fought, act `move` + `returnToDeck.at`, gatilho `scrap` — ~500 full no parser, pede teto ~159 | LOTE 3: `use.via` (ready and fight), observadores `Ability.of` + `"event"`, contadores +1, splash `targetNeighbors`, keyword versatile — ~560 full, pede teto ~160

Sources:
- [KeyForge Master Rulebook v18-3](https://keyforging.com/wp-content/uploads/2026/02/KeyForge-Master-Rulebook-v18-3.pdf)
- [Draconian Measures Rules](https://keyforging.com/draconian-measures-rules/)