<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Spec da onda 2 gerada pelo consultor Opus 5.5 (effort medium) em 02/out/2026,
     medições reais sobre cards-mv.json + drafts.json (backlog de 77 unsupported).
     Implementação: Lote 4 (DSL_VERSION 5) e Lote 5 (DSL_VERSION 6).
     [Atualização] Teto de bundle aposentado — gzip é telemetria. -->

# Spec: expansão da DSL — onda 2 (Lotes 4 e 5)

A resposta curta à pergunta direta: **as ~12 linhas do cluster B são todas veredito velho ou erro do modelo; nenhuma pede DSL nova.** O parser de hoje já dá "full" para 11 delas e a 12ª é carta com script. O resto do backlog cabe em dois lotes: o 4 sem interação nova (só o toggle de Entrench) e o 5 com escolha de casa e memória de turno.

Medi com o parser real sobre `cards-mv.json` e `drafts.json` (scripts temporários já apagados; nada do repo foi alterado). Dois números a corrigir antes de tudo:

- **Parser hoje:** 1.032 full / 206 partial / 2.506 vanilla. O CLAUDE.md diz 952.
- **`drafts.json`:** 101 linhas, 85 falhas: 77 `unsupported`, 5 `reply: not a JSON object`, 1 `schema`, 1 `sanity`, 1 `dry-run`. Treze falhas não têm `v` (pré-Lote 2/3).

## 1. Cluster B — o que o v4 já cobre

| Linha do backlog | Carta | v4 cobre? | Evidência |
|---|---|---|---|
| haunted + Otherwise | Reduce, Reuse | Sim | parser full: `count {p:"discard"} gte 10` + `not` |
| overwhelmed (2×) | Nightmare Urchin, Leftenant Chars | Sim | parser full: `fewerCreatures` + `not` |
| purge random from hand | Impspector | Sim | parser full: `move hand→purged, opp, pick:"random"` |
| watcher "use an artifact" | Veylan Analyst (demo) | Sim | parser full |
| "if you do" (2×) | Permanent Record, Priestess Leilani | Sim | parser full: `act.if did gte 1` (são few-shots) |
| "on a flank" | Jeen Peary | Sim | parser full: `count {c:{self,flank}} gte 1` |
| bottom-of-deck + if you do | Lightbringer Outpost | Sim | parser full: `returnToDeck at:"bottom"` + `pick` |
| archive a card da mão | Sloppy Labwork (demo) | Sim | parser full: `move hand→archives` |
| "the attacked enemy" | Ancient Bear (demo) | Sim | `s:"fought"` existe; a carta tem script (`null`) |
| takes no damage | Snufflegator (demo) | Sim | é o reminder de Skirmish; a carta tem script |
| Enhance-only | Infomorph | Sim | parser full (vazio) |

Fora do cluster B, mais quatro linhas v4 são erro do modelo ou do pipeline, não da DSL:

- **Cleansing Wave** e **Ujkyytr Prime** (`reply:`): a primeira o parser já dá full; a segunda é representável (duas abilities, `targetAndNeighbors`).
- **Virtuous Works** (`dry-run`): carta com script, que vence o rascunho; nunca deveria ter ido ao LLM.
- **Starpatch** (`sanity`): falso positivo. O `sanityProblem` valida a ability concedida (`effects[].abilities`) contra o tipo Upgrade, mas ela pertence à criatura hospedeira.
- **Dissonant Chord**: o segundo motivo ("if this damage destroys" não representável) é falso (`gone gte 1`); só o Fate bloqueia.

Isso aponta quatro defeitos de pipeline, que são o item 4.0:

1. `pendingTranslations` filtra por `parseCardText(...).coverage`, então cartas com script (Ancient Bear, Snufflegator, Virtuous Works) vão ao LLM. Deve ignorar título presente em `scripts`.
2. Falha de carta que o parser passou a cobrir vira linha zumbi: sai da fila de tradução mas continua em `reviewQueue` e no `--export-queue`. Podar no export e na fila.
3. Falha `reply:` com `v` atual nunca é re-tentada (cache eterno por `textHash`). Erro de formato é transitório: re-tentar sempre.
4. O `sanity` de ability concedida em Upgrade deve validar como Creature.

Ação para o cluster B: apagar as 13 linhas sem `v` e as 5 `reply:` do `drafts.json` e re-moer. Zero DSL.

## 2. LOTE 4 — passo de ready, âmbar em carta, jogador dinâmico (`DSL_VERSION 5`)

Ordenado por cartas por byte. "Cita" é medido (ids / títulos entre as não-full); o desbloqueio real é menor e só o medi onde havia what-if.

```ts
// keywords.ts
ENGINE_KEYWORDS: + "entrench"
// game.ts
interface CardInstance { /* … */ hold?: boolean }           // Entrench: fica exausta no ready
export function setHold(current: GameState, side: Side, instanceId: string, hold: boolean): GameState
// abilities.ts
interface Filter { /* … */ least?: number; counters?: boolean; amber?: boolean }
type Count = /* … */ | { of: "damage" | "amber" | "power" | "counters"; s: Selection };
type Condition = /* … */ | { k: "myTurn" };
type Act = ( /* … */
  | { k: "gainAmber" | "loseAmber" | "draw" | "gainChains"; n: number; opp?: boolean; who?: "owner" | "controller" }
  | { k: "capture"; n: number; s: Selection; own?: boolean }
  | { k: "takeControl"; s: Selection; opp?: boolean }                    // sai do grupo ward/enrage
  | { k: "returnToDeck"; s: Selection; at?: "top" | "bottom" | "shuffle" }
  | { k: "move"; /* … */ pick?: "top" | "bottom" | "random" | "all"; at?: "top" | "bottom" | "shuffle" }
  | { k: "moveAmber"; s: Selection; n?: number; to: "pool" | "supply"; opp?: boolean }
  | { k: "removeCounter"; s: Selection; n?: number }
) & { optional?: boolean; if?: Condition; per?: Count };
interface PersistentEffect { /* … */ noReady?: true | "step" }
interface AbilityOverride { /* … */ partial?: boolean }
```

### 4.0 Higiene do pipeline (0 bytes de DSL; resgata 18 linhas)
- **(b) Execução:** os quatro consertos da seção 1.
- **(e) Riscos:** re-tentar `reply:` sem limite queima chamadas em modelo ruim; contar tentativas na linha (`tries`) e parar em 3.

### 4.1 `partial` — Fate deixa de matar a carta inteira (88 ids / 66 títulos citam)
Hoje o few-shot manda responder `unsupported` para qualquer carta com `Fate:`, e a carta fica vanilla: o `Play:` morre junto. O what-if "Fate removido" dá +25 ids / 21 títulos só no parser.
- **(a) Forma:** a resposta do modelo ganha `"partial": true`; a linha grava `partial`.
- **(b) Execução:** `mergeStored` devolve `coverage: "partial"` quando `stored.partial`. A regra de ouro ganha uma única exceção: a sentença `Fate:` pode ser omitida, e então `partial` é obrigatório.
- **(d) Few-shot:** troca o atual de Fate: `Play: Gain 1<A>. Fate: Archive a card.` → `{"abilities":[{"on":["play"],"acts":[{"k":"gainAmber","n":1}]}],"effects":[],"keywords":{},"partial":true}`
- **(e) Riscos:** o `sanity` precisa recusar `partial` em texto sem `Fate:`, senão o modelo usa a saída para pular sentença difícil.

### 4.2 Entrench + `noReady` (35 ids / 16 títulos; what-if medido: +24 ids / 11 títulos)
**A regra:** no seu passo "ready cards", para cada criatura amiga exausta com Entrench, você pode deixá-la exausta em vez de prepará-la. A escolha é por carta. Todas as 16 impressões pagam por estar exaustas ("While ~ is exhausted…", "if ~ is exhausted…").

- **(b) Execução:**
  - `"entrench"` em `ENGINE_KEYWORDS`: o parser, o gate e a lista do prompt herdam sozinhos.
  - `hold` é a preferência do controlador, alternada por `setHold` (função pura, fora do `GameMove`: não conta em `acted`/Alpha nem entra na busca da IA). `leavePlay` zera.
  - `endTurn`: a linha `card.ready = true` vira `if (canReady(state, card, true)) card.ready = true`. `canReady` nega quando `hold && keyword(state, card, "entrench")` ou quando um efeito `noReady` atinge a carta.
  - O act `ready` consulta `canReady(state, card, false)`: `noReady: true` bloqueia sempre, `"step"` só no passo. Entrench não bloqueia ready por efeito.
  - IA: antes do `endTurn`, `hold = true` em toda criatura Entrench exausta (16/16 impressões pagam por isso).
  - UI: toggle no inspetor da carta (bottom sheet abaixo de 1041px), estado como classe na peça + `aria-label` via `t()`. Nada novo entre `.table-plane` e `.board-piece`.
- **(c) Grafias:**
  - `Entrench.` como sentença de keyword.
  - `at the (start|end) of your turn, if ~ is exhausted, X` → `ability.if` (hoje só `this creature is exhausted` casa; vale +5 ids).
  - `~ cannot ready` / `this creature cannot ready` → `noReady: true`; `unless you are haunted` → `if: not haunted`.
  - `does not ready during your "ready cards" step` → `noReady: "step"`.
- **(d) Few-shots:**
  - `Entrench. At the start of your turn, if ~ is exhausted, destroy an enemy creature.` → `{"abilities":[{"on":["startOfTurn"],"acts":[{"k":"destroy","s":"target"}],"target":{"type":"Creature","side":"enemy"},"if":{"k":"count","of":{"c":{"self":true,"exhausted":true}},"op":"gte","n":1}}],"effects":[],"keywords":{"entrench":1}}`
  - `This creature cannot ready.` (Upgrade) → `effects:[{"target":{"host":true},"noReady":true}]`
- **(e) Riscos:**
  - `hold` fica ligado depois que a criatura é preparada por efeito e usada de novo; o indicador precisa ser visível.
  - `endOfTurn` dispara depois do ready, então "At the end of your turn, if Caspart is exhausted" só funciona com `hold`. O dry-run deve rodar `endTurn` com `hold` nos dois valores.
  - Ficam fora 4 das 16: Fading Apparition (redirect de reap), Malina (comparação de poder) e The Watch (`noSteal`, Lote 5) são cortes; Paranormal Palisade ("gets +4 armor and gains taunt") é só grafia composta e entra pelo LLM.
  - `noReady` cobre 6 dos 7 títulos de "cannot ready" (Brackish Shoreline não).

### 4.3 Só prompt: três regras novas (0 bytes de engine)
- **"If <cond>, repeat the preceding effect"** (40 ids / 26 títulos citam "repeat") = os mesmos acts duplicados com `if` no act; o alvo repetido vira `{pick}`. É exato: a repetição acontece uma vez e a condição é lida depois do primeiro efeito, que é quando `act.if` avalia. "Repeat this effect" (laço) continua `unsupported`.
- **"May be used as if it belonged to the active house"** = keyword `versatile` concedida. Vale também para "may be played as if…" — confirmar que o reminder de Versatile cobre os dois antes de escrever a regra.
- **"The creature ~ fights" / "the attacked enemy"** = `s:"fought"`.
- **(d) Few-shot:** `After Reap: Deal 2<D> to an enemy creature. If that creature has <A> on it, repeat the preceding effect.` → `acts:[{"k":"damage","n":2,"s":"target"},{"k":"damage","n":2,"s":{"pick":{"type":"Creature","side":"enemy"}},"if":{"k":"count","of":{"of":"amber","s":"target"},"op":"gte","n":1}}]`

### 4.4 `capture.own` + `Filter.least` (33 ids / 18 títulos e 25 ids / 12 títulos citam)
- **(b) Execução:** `own` tira o âmbar do pool do controlador da criatura, não do oponente dele. `least: n` é o espelho de `top` (ordena crescente).
- **(c) Grafias:** `X captures N<A> from its own side`; `the least powerful [enemy|friendly] creature`.
- **(d) Few-shot:** `After Reap: The least powerful enemy creature captures 1<A> from its own side.` → `[{"k":"capture","n":1,"own":true,"s":{"each":{"type":"Creature","side":"enemy","least":1}}}]`
- **(e) Riscos:** `least` lê `effectivePower`; entra em `readsPower` (proibido em `if`/`per` de efeito). Empate é desempatado pelo engine, como já acontece com `top`.

### 4.5 `at:"top"` e `pick:"bottom"` (37 ids / 15 títulos citam; what-if medido: +10 ids / 3 títulos)
- **(b) Execução:** o topo do deck é o fim do array, e `returnToDeck` sem `at` já faz `push`. `"top"` é o literal explícito do comportamento atual; nenhum campo ausente muda de sentido. `pick:"bottom"` lê o início do array.
- **(c) Grafias:** `put X on top of its owner's deck`; `puts a random card from their hand on top of their deck`; `discard the bottom N cards of your deck`.
- **(d) Few-shot:** `Play: Put an enemy creature on top of its owner's deck.` → `[{"k":"returnToDeck","s":"target","at":"top"}]`
- **(e) Riscos:** "in any order" e "in a random order" continuam fora.

### 4.6 `who` — dono/controlador dinâmico (34 ids / 14 títulos)
- **(b) Execução:** `fire` e `fireObservers` gravam no contexto o dono e o controlador de `target ?? event ?? fought` quando a ability começa. É obrigatório capturar antes: depois de "Destroy a creature" a carta já saiu e `controllerOf` devolve `undefined`. Sem carta de referência, o act é pulado.
- **(c) Grafias:** `its (owner|controller) (gains|loses) N<A>`; `its owner draws`.
- **(d) Few-shot:** `Play: Destroy a creature. Its controller gains 1<A>.` → `acts:[{"k":"destroy","s":"target"},{"k":"gainAmber","n":1,"who":"controller"}]`
- **(e) Riscos:** `who` e `opp` juntos são inválidos; o gate rejeita. Rigged Lottery (dono de cada carta descartada) e Call of the Void ficam fora.

### 4.7 `takeControl.opp` — "give control" (24 ids / 12 títulos citam; ~4 destravam)
- **(b) Execução:** o destino vira `act.opp ? other(me) : me`.
- **(d) Few-shot:** `Play: Give control of a friendly creature to your opponent.` → `[{"k":"takeControl","s":"target","opp":true}]`
- **(e) Riscos:** `takeControl` não está em `HARMFUL`; com `opp` o `autoPick` precisa escolher a criatura amiga mais fraca.

### 4.8 Condition `myTurn` (10 ids / 5 títulos)
- **(b) Execução:** `state.activePlayer === me`.
- **(c) Grafias:** `if it is not your turn` → `not myTurn`; `while it is not your turn` em efeito.
- **(d) Few-shot:** `Destroyed: If it is not your turn, gain 2<A>.` → `{"on":["destroyed"],"acts":[{"k":"gainAmber","n":2}],"if":{"k":"not","c":{"k":"myTurn"}}}`

### 4.9 `moveAmber` + `Filter.amber` (57 ids / 25 títulos citam "common supply")
- **(b) Execução:** tira `n` âmbar (ausente = todo) de cada carta selecionada; `to:"pool"` soma ao pool de quem resolve (`opp` → o outro), `"supply"` some. `did` passa a ser o total de âmbar movido, gravado pelo próprio act.
- **(c) Grafias:** `move N<A> from X to your pool`; `(move|return) (N|each|all) <A> from X to the common supply`; `creature with <A> on it`.
- **(d) Few-shot:** `After Reap: Return 1<A> from ~ to the common supply.` → `[{"k":"moveAmber","n":1,"s":"self","to":"supply"}]`
- **(e) Riscos:** criatura para criatura (Ditch the Loot) pede dois alvos escolhidos: cortado. Âmbar em artefato (Uncharted Lands) também: `exalt` filtra criatura e o `leavePlay` entrega o âmbar ao oponente, o que está errado para artefato.

### 4.10 Contadores, segunda passada (cerca de 8 títulos)
- **(b) Execução:** `removeCounter` tira `n` (ausente = todos) e grava `did` = contadores removidos. `{of:"counters", s}` soma `card.counters`. `Filter.counters` é `(card.counters ?? 0) > 0 === valor`.
- **(c) Grafias:** `remove each +1 power counter from X`; `for each +1 power counter on X`; `creature with (no|a) +1 power counter(s) on it`; `if one or more counters are removed this way` → `did gte 1`.
- **(d) Few-shot:** `After Reap: You may remove each +1 power counter from a creature. If one or more counters are removed this way, archive a card.` → `acts:[{"k":"removeCounter","s":"target","optional":true},{"k":"move","n":1,"from":"hand","to":"archives","if":{"k":"count","of":"did","op":"gte","n":1}}]`
- **(e) Riscos:** mover contadores entre criaturas (Cŏnrăd) e "up to three" / "any number" (Æmbermancy, Transmutation) ficam fora; ver cortes.

## 3. LOTE 5 — escolha de casa e memória de turno (`DSL_VERSION 6`)

Tudo aqui mexe em `GameMove`, `GameState` ou UI. O argumento de prioridade é o deck demo: Blinding Light, Control the Weak e Key Hammer são cartas que todo jogador novo vê e hoje estão vanilla.

```ts
type GameMove = /* play | reap | fight | use | discard */ & { house?: string };
interface GamePlayer { /* … */ forgedAt?: number; mustChoose?: string }
interface CardInstance { /* … */ houseAs?: string }
type Trigger = /* … */ | "house";
interface Filter { /* … */ house?: string }                 // + literal "chosen"
type Count = /* … */ | { sub: [Count, Count | number] };
type Condition = /* … */
  | { k: "count"; of: Count; op: "eq" | "gte" | "lte" | "even" | "odd"; n: number }
  | { k: "forged"; opp?: boolean };
type Act = /* … */
  | { k: "forgeKey"; n: number; free?: boolean; mod?: number; less?: Count; min?: number }
  | { k: "setHouse"; s: Selection; house: string }
  | { k: "forceHouse" };
interface Replacement { /* … */ prevent?: boolean }
interface PersistentEffect { /* … */ house?: string; noSteal?: boolean }
```

### 5.1 "Choose a house" (59 ids / 26 títulos; ~10 destravam limpo)
- **(b) Execução:** `move.house` é a casa escolhida; `house:"chosen"` lê do contexto. `getLegalMoves` gera uma variante por casa presente em jogo, só para cartas cujo DSL cita `"chosen"`. A UI reusa o seletor de casa ativa. `forceHouse` grava `mustChoose` no oponente; `chooseHouse` o respeita e limpa.
- **(d) Few-shot:** `Play: Choose a house. Stun each creature of that house.` → `[{"k":"stun","s":{"each":{"type":"Creature","house":"chosen"}}}]`
- **(e) Riscos:** multiplica o ramo da IA por até 7 nessas cartas. "Reveal/discard pile of that house" continua fora.

### 5.2 Gatilho `house` (15 ids / 10 títulos)
- **(b) Execução:** `chooseHouse` dispara `"house"` em cada carta em jogo dos dois lados, com `me` = controlador. "After you choose" usa `if: myTurn`; "choose Dis" usa `count {c:{self:true, house:"active"}}`.
- **(d) Few-shot:** `After a player chooses an active house, destroy each artifact of that house.` → `{"on":["house"],"acts":[{"k":"destroy","s":{"each":{"type":"Artifact","house":"active"}}}]}`
- **(e) Riscos:** Relentless Creeper dispara do descarte: fora.

### 5.3 Casa concedida (39 ids / 20 títulos citam; ~6 destravam)
- **(b) Execução:** `houseOf(state, card) = card.houseAs ?? efeito.house ?? face.house`, lido por `houseAllows` e `houseMatches`. `setHouse` grava `houseAs` e `leavePlay` zera ("while under your control"). `effect.house: "all"` é o Experimental Therapy (demo).
- **(e) Riscos:** recursão. Um efeito `house` cujo `target` filtra por `house` chama a si mesmo; o gate rejeita, como faz com `readsPower`.

### 5.4 `forged`, `forgeKey.less`, purgar a própria Action (6 ids / 4 títulos e 26 ids / 12 títulos de "reduced by")
- **(b) Execução:** `forge()` grava `forgedAt = turnStamp`; `{k:"forged", opp}` é "forjou no turno anterior dele". `less` subtrai do custo e `min` é o piso. `purge` com `s:"self"` numa carta fora de jogo marca a fonte, e o `applyMove` a manda para `purged` em vez do descarte.
- **(d) Few-shot:** `Play: Forge a key at +8<A> current cost, reduced by 1<A> for each <A> in your opponent's pool. If you do, purge ~.` → `[{"k":"forgeKey","n":1,"mod":8,"less":{"p":"amber","opp":true}},{"k":"purge","s":"self","if":{"k":"count","of":"did","op":"gte","n":1}}]`
- **(e) Riscos:** cor de chave (40 ids / 14 títulos) continua fora: pede identidade das três chaves e escolha de qual forjar.

### 5.5 Aritmética de contagem (22 ids / 6 títulos)
- **(b) Execução:** `sub` é `max(0, a − b)`; `even`/`odd` ignoram `n`.
- **(d) Few-shots:** `Play: Steal all but 6 of your opponent's <A>.` → `{"k":"steal","n":1,"per":{"sub":[{"p":"amber","opp":true},6]}}`; `Action: If your opponent has an even amount of <A>, steal 1<A>.` → `if:{"k":"count","of":{"p":"amber","opp":true},"op":"even","n":0}`

### 5.6 Imunidades (72 ids / 41 títulos citam "cannot be …"; poucos são limpos)
- **(b) Execução:** `replace:{on:"damage", prevent:true}` cancela o dano; `noSteal` zera o `steal` contra o lado do efeito.
- **(c) Grafias:** `friendly creatures cannot be dealt damage [duração]`; `your <A> cannot be stolen`.
- **(e) Riscos:** só as formas sem qualificador; "by Mutant creatures" e "unless" ficam fora.

## 4. Cortes

| Item | Decisão | Por quê |
|---|---|---|
| Fate / Prophecy (88 ids / 66 títulos) | Continua fora | É um subsistema inteiro (cartas de profecia fora do deck). O 4.1 tira o prejuízo: o resto da carta passa a jogar, marcado partial. |
| "Any number" / "up to N" (42 ids / 20 títulos e 50 ids / 27 títulos) | Sim, precisa de `GameMove.targets[]` | O engine é barato (fila de escolhas consumida pelo `{pick}`). O caro é a UI de multi-seleção e a IA: com `autoPick` no máximo, "destroy any number of friendly creatures" vira suicídio. É um lote próprio (6), de interação. |
| Look / reveal / search (51 + 74 + 26 ids) | Fora | Só informação, ou escolha em zona oculta. "Look at hand" (Psychic Bug, demo) pediria um `peek` visível só a um lado, e o log vaza no pass-and-play. |
| Referência à carta movida ("discarded this way": casa, tipo, ícones) | Fora | Pede `ctx.moved` mais contagens sobre cartas fora de jogo; `did`/`gone` já cobrem o caso de contagem. Candidato ao lote 6. |
| Mover contadores ou âmbar entre duas criaturas | Fora | Dois alvos escolhidos: espera `targets[]`. |
| Mover para flank (Barrel Roll) | Fora | Escolha de qual flank; baixo volume limpo. |
| "While attacking" (Valdr), "already exhausted", "lower power than X" | Fora | 1 carta cada. Valdr via `beforeFight` não é exato (bate em Elusive). |
| Substituir ready/draw step (The Chosen One, Mother) | Fora | 1 carta cada, texto único. |
| Tide, Treachery, Invulnerable | Fora | Sem mudança desde o plano anterior. |
| Custo de âmbar para usar (Tentacus), redirect escolhido (Gabos) | Fora | 1 carta cada. |

Para cada lote: `npm run build`, `npm test`, `npm run gen:schema`, `e2e:smoke` e `e2e:bundle` (telemetria). O 4.2 toca a peça e o inspetor: rodar também `e2e:floor`, `e2e:floor:3d` e `_3d-chain`.

LOTE 4: higiene do pipeline (scripts fora da fila, zumbis, retry de `reply:`, sanity de ability concedida), `partial` para Fate, Entrench (`hold` + `setHold`) e `noReady` no mesmo gancho do ready step, regras de prompt (repeat = duplicar com `if`, versatile, `fought`), `capture.own` + `Filter.least`, `at:"top"`/`pick:"bottom"`, `who` owner/controller, `takeControl.opp`, `myTurn`, `moveAmber` + `Filter.amber`, `removeCounter` + `of:"counters"` + `Filter.counters` — DSL_VERSION 5
LOTE 5: `GameMove.house` + `house:"chosen"` + `forceHouse`, gatilho `house`, casa concedida (`setHouse`/`effect.house`), `forged` + `forgeKey.less/min` + purge da própria Action, `Count.sub` + `even`/`odd`, `replace.prevent` + `noSteal` — DSL_VERSION 6

Sources:
- [Draconian Measures Rules](https://keyforging.com/draconian-measures-rules/) (a página devolveu 403 ao fetch direto; a regra de Entrench veio do resumo da busca e bate com os 16 textos do corpus)
- [Meet House Ouboros](https://keyforging.com/meet-house-ouboros/)