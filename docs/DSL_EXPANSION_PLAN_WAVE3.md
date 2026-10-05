<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Spec da onda 3 gerada pelo consultor Opus 5.5 (effort low) em 03/out/2026,
     a partir das 77 falhas reais do queue-export (medições no parser v6).
     Implementação: Lote 6 (DSL_VERSION 7) e Lote 7 (DSL_VERSION 8).
     [Atualização] Teto de bundle aposentado — gzip é telemetria. -->

# Spec: expansão da DSL — onda 3 (Lotes 6 e 7)

**Resposta direta:** das 77 linhas (68 títulos distintos), **13 títulos já são cobertos pelo v6 ou nem deveriam estar na fila**, 19 cabem no Lote 6 (sem interação nova), 10 no Lote 7 (interação) e 26 são corte. O pipeline tem três defeitos novos: transporte preso, órfãs do deck demo e chamadas duplicadas por título.

Medi com o parser real sobre `cards-mv.json`, `drafts.json` e `queue-export.json` (scripts temporários apagados; nada do repo foi alterado). Três números a corrigir:

- **Parser hoje:** 1.262 full / 175 partial / 2.307 vanilla (3.744 ids, 1.919 títulos). O CLAUDE.md diz 1.218 + 167.
- **`drafts.json`:** 156 linhas, 107 falhas (60 `unsupported` v6, 24 v4, 13 v1; 6 `reply:`; 3 `llm.timeout`; 1 `dry-run` v4). O export poda 30 zumbis e fica com as 77.
- **`tries` nos timeouts:** as 3 linhas `llm.timeout` que li não têm `tries`; `catalogLlm.ts:951` grava `failureRow(face, key, config.model)` sem ele. O `dry-run` não está entre as 77 do export; é v4 e re-enfileira sozinho.

"Cita" abaixo é medido (títulos não-full que casam o padrão). "Destrava" é estimativa por leitura das listas, não what-if do parser.

## 1. Clusters das 77 linhas

| Cluster | Linhas / títulos | Cartas |
|---|---|---|
| **A. v6 já cobre, zumbi ou script** | 13 / 13 | ver tabela abaixo |
| **B. Lote 6** | 21 / 19 | Haunting Measures, Digital Manipulation, Productive Trash, Nada Tax, Victor Flux, Traumatic Echo, Blast from the Past, Starpatch, Ox Sarbane, Mark of Dis, Call of the Void, Mother, The Howling Pit, Cosmicrux, Frigorific Rod, Dreadbone Decimus, Dissonant Chord, Out of Ideas, Slapdash Enamel |
| **C. Lote 7** | 13 / 10 | Ruby Rackham, Deep Blue Bryn, Skulking Saboteurs, Glittering Horde (cor de chave); Throwing Stars, Ditch the Loot, Cŏnrăd Fisiquĕ, Barrel Roll (`targets[]`); Lethologica (`until`); Auto-Encoder (gatilho de descarte) |
| **D1. Corte: look/reveal/search** | 8 / 7 | Psychic Bug, Lateral Shift, Abyssal Sight, Xeno-Fiend, Xeno-Saurus, Digging Up the Monster, Orbital Bombardment |
| **D2. Corte: carta única** | 22 / 19 | Valdr, Gabos Longarms, Tentacus, Fading Apparition, The Chosen One, Allusions of Grandeur, Collector Worm, Good of the Many, Malina, Tertiate, Thing from the Deep, Technorachnophobia, Red-Hot Armor, Bot Bookton, Against All Flags, Dapper Chapeau, Siphon Maw, Freelancer, Haunting Deck |

### Cluster A — o que o v6 já cobre

| Carta | Situação | Evidência |
|---|---|---|
| Control the Weak, Blinding Light, Veylan Analyst, Sloppy Labwork | Zumbi (demo) | parser full hoje; linhas v1/v4 |
| Ancient Bear | Script | `scripts["ancient bear"]`; nunca deveria ter ido ao LLM |
| The Red Death | Erro do prompt | `effects:[{target:{self:true}, noReady:true, if:{count {p:"discard"} lte 9}}]`. O prompt manda responder `unsupported` para qualquer "unless"; a grafia do 4.2 também não entrou no parser (dá partial) |
| Pip the Pilferer | Erro do modelo | `count {sub:[{p:"keys",opp:true},{p:"keys"}]} gte 1` + `not` |
| Hannibal's Mark | Erro do modelo | `takeControl` + `counter n:3` + `setHouse s:"target" house:"Skyborn"` |
| Banish | Erro do modelo | `archive s:"target"`; `leavePlay` já manda ao arquivo do dono |
| Timequake | Erro do modelo | `returnToDeck {each:{side:"friendly"}} at:"shuffle"` + `draw per:"did"`. Filtro sem `type` casa qualquer carta em jogo; carta sempre vai à zona do dono |
| Ol' Switcheroo (`reply:`) | Formato | `capture` + `takeControl opp:true` |
| Eddy of Dis (`reply:`) | Formato | `move hand→deck opp pick:"random" at:"shuffle"` + `partial` |
| Gegrrŏkŭŭ Sapper (timeout) | Transporte | `takeControl` alvo + `takeControl s:"self" opp:true` + scrap com `did` |

As oito órfãs sem título (`[?]`) são cartas do deck demo: o export só poda ids presentes no `--cards`, e o harvest com `--cards` nunca revisita o demo. Valdr, Psychic Bug e Gabos Longarms são cortes reais, só que com veredito v4.

Dissonant Chord é meio caso: o modelo errou ao dizer que "if this damage destroys" não existe (`gone gte 1`), mas "its neighbors after it leaves play" falha de fato, porque `targetNeighbors` lê a posição atual e o alvo já saiu. Entra no 6.8.

## 2. Erros de transporte e formato

Hoje `pendingTranslations` só re-tenta `reply:`; qualquer outra falha com `v` atual é cache eterno. Transporte não é veredito sobre a carta, então a regra passa a ser por classe:

| Classe | Prefixo | Retry | Teto | Depois do teto |
|---|---|---|---|---|
| Veredito | `unsupported:` | só com `v` menor | — | fica na fila de revisão |
| Rascunho inválido | `schema`, `sanity`, `dry-run` | sim, é variância do modelo | 2 | fica na fila com o motivo |
| Formato | `reply:` | sim (já existe) | 3 | idem |
| Transporte | `llm.*` | sempre | 5 | fica visível, com "tentar de novo" manual; nunca é podada |

Regras de execução:

1. **Transporte grava `tries`.** `runTranslation` passa `{ tries: previous + 1 }` ao `failureRow` do `catch`.
2. **Um retry imediato dentro da rodada**, com o dobro do timeout, antes de gravar a linha. Carta longa (Sapper, Haunting Deck) estoura por tamanho do raciocínio, não por provedor fora.
3. **Transporte vai para o fim da fila.** `pendingTranslations` ordena: nunca tentadas, depois formato, depois transporte. Senão as mesmas três cartas ocupam a cabeça de toda rodada de 25.
4. **`tries` zera quando `v` muda.** Hoje `previous` devolve `row.tries` de qualquer versão: uma linha com `tries: 3` no v6 falha uma vez no v7, vira 4 e trava. `previous` deve devolver 0 se `row.v < DSL_VERSION`.
5. **Linha de transporte não vai ao export.** Não há o que revisar.
6. **Export e harvest sempre unem o deck demo ao `--cards`**, e o export poda também `hasScript` e id desconhecido. Resolve as 8 órfãs.
7. **Uma chamada por texto, não por id.** As 77 linhas têm 9 títulos repetidos (mesmo texto, outro set). Agrupar por `textHash + type`, traduzir uma vez e copiar a linha para os ids irmãos. O corpus tem 3.744 ids para 1.919 títulos: corta perto de metade das chamadas.
8. **Prompt:** trocar "Qualified forms (… 'unless') are unsupported" por "`unless <cond>` = `if: not <cond>` no efeito"; acrescentar "uma carta sempre vai à zona do dono" e "filtro sem `type` = qualquer carta em jogo".

Ação imediata, zero DSL: aplicar 1 a 8, apagar as linhas v1/v4 e as `reply:`/`llm.*` do `drafts.json` e re-moer. Resgata o cluster A inteiro.

## 3. LOTE 6 — memória do act, relações e eventos novos (`DSL_VERSION 7`)

Nenhuma escolha nova do jogador; a única UI é o chip de contador nomeado (6.7).

```ts
// abilities.ts
type Trigger = /* … */ | "forge" | "ready" | "enter";
interface Filter { /* … */
  type?: "Creature" | "Artifact" | "Upgrade" | "!Upgrade";
  house?: string;              // + "self" | "target" | "fought" | "moved" | "neighbor" (prefixo ! nega)
  powerMin?: number; powerMax?: number;
  weaker?: boolean;            // poder menor que o da fonte
  target?: boolean;            // a carta é o alvo da ability
  neighborsOfTarget?: boolean;
  fighting?: boolean;          // adversária da fonte na luta em curso
  counters?: boolean | string; // string = contador nomeado presente
}
type Count = /* … */
  | { m: "cards" | "icons" | "power"; house?: string; type?: string }   // cartas movidas pelo act anterior
  | { of: "damage" | "amber" | "power" | "counters"; s: Selection; name?: string };
type Condition = /* … */ | { k: "actor"; opp?: boolean };               // quem causou o evento de jogador
type Act = /* … */
  | { k: "move"; /* … */ pick?: "top" | "bottom" | "random" | "all" | "moved"; house?: string }
  | { k: "counter"; n: number; s: Selection; name?: string }
  | { k: "removeCounter"; s: Selection; n?: number; name?: string }
  | { k: "forceHouse"; house?: "target" | "fought" | "moved"; who?: "owner" | "controller" };
interface Restrict { /* … */ type?: string }                            // + literal "moved"
interface PersistentEffect { /* … */ hand?: number }                    // reusa o `opp` existente
// game.ts
interface CardInstance { /* … */ marks?: Record<string, number> }
interface Ctx { /* … */ moved?: CardInstance[]; wasNeighbors?: CardInstance[]; actor?: Side }
```

`powerMin`/`powerMax` e não `min`/`max`: `forgeKey.min` já existe e o `mentionsKey` do gate casa por nome de chave.

### 6.0 Higiene do pipeline (0 bytes de DSL; resgata 13 títulos)
- **(b) Execução:** os oito itens da seção 2.
- **(e) Riscos:** a cópia por `textHash + type` precisa rodar o dry-run uma vez por tipo; o mesmo texto em Creature e Upgrade valida diferente.

### 6.1 `Filter.powerMin/powerMax/weaker` (15 títulos citam; ~9 destravam)
O achado da medição: "creature with power N or lower/higher" não tem campo.
- **(b) Execução:** três linhas em `matches`, lendo `effectivePower`.
- **(c) Grafias:** `creature with power N or (lower|less|higher|more)`; `creature with lower power than ~`.
- **(d) Few-shot:** `Play: Destroy each creature with power 3 or lower.` → `[{"k":"destroy","s":{"each":{"type":"Creature","powerMax":3}}}]`
- **(e) Riscos:** os três campos entram em `readsPower`. Efeito de poder cujo `target` filtra por poder é recursão infinita, e Grump Buggy (keyCost `per` com filtro de poder) fica fora por isso.
- Destrava: Oubliette, Crushing Charge, The Harder They Come, Earthshaker, Warriors' Refrain, The Spirit's Way, Regrettable Meteor, Mogg (partial), Dreadbone Decimus.

### 6.2 Gatilho `forge`, observadores `ready`/`enter`, `Filter.fighting` (25 títulos citam; ~18 destravam)
- **(b) Execução:**
  - `forge` é evento de jogador, como `house`: `forge()` dispara em cada carta em jogo dos dois lados com `ctx.actor` = quem forjou. `{k:"actor"}` é "fui eu"; `opp:true` é "foi o oponente". O `chooseHouse` passa a gravar `actor` também.
  - `ready` e `enter` são só de observador (`of` obrigatório; o gate rejeita sem). `ready` dispara no act `ready` e no ready step. `enter` dispara no play de criatura e no `makeToken`, que hoje não acorda ninguém.
  - `fighting`: `fight()` guarda o par atacante/defensor num valor transiente de módulo, com salvar/restaurar em `try/finally` (um `use via:"fight"` aninha lutas). `matches` casa quando a carta é a adversária da fonte.
- **(c) Grafias:** `after (you|your opponent|a player) forges? a key`; `after a key is forged`; `after a player readies a creature`; `after (a|another) [friendly] [<traço>] creature enters play`; `after an enemy creature is destroyed fighting ~`.
- **(d) Few-shots:**
  - `After an enemy creature is destroyed fighting ~, gain 1<A>.` → `{"on":["destroyed"],"of":{"type":"Creature","side":"enemy","fighting":true},"acts":[{"k":"gainAmber","n":1}]}`
  - `After your opponent forges a key, destroy ~ and ward each friendly creature.` → `{"on":["forge"],"if":{"k":"actor","opp":true},"acts":[{"k":"destroy","s":"self"},{"k":"ward","s":{"each":{"type":"Creature","side":"friendly"}}}]}`
  - `After a player readies a creature, deal 1<D> to it.` → `{"on":["ready"],"of":{"type":"Creature"},"acts":[{"k":"damage","n":1,"s":"event"}]}`
  - `After a friendly Cat creature enters play, ward it.` → `{"on":["enter"],"of":{"type":"Creature","side":"friendly","trait":"Cat"},"acts":[{"k":"ward","s":"event"}]}`
- **(e) Riscos e guarda:**
  - Os três eventos passam por `fireObservers` e herdam `OBSERVER_DEPTH`/`OBSERVER_BUDGET`. `forge` passa por `fire` e gasta `FIRE_BUDGET`.
  - O gate rejeita os laços diretos: `ready`/`use` em ability `on:["ready"]`, `forgeKey` em `on:["forge"]`, `makeToken` em `on:["enter"]`. O orçamento é a segunda linha.
  - No ready step, disparar depois do laço inteiro, sobre a lista das realmente preparadas. O `endTurn` já chama `resetAbilityBudgets`.
  - Quando as duas morrem na luta: confirmar no keyteki se "destroyed fighting" dispara com a observadora também morrendo, antes de fixar o teste.
  - Ficam fora: Nizak e Overlord Greking (agem sobre a carta que saiu), Ogopogo ("attacks and destroys" só vale atacando), Relativity Imp, Interdimensional Graft, Elenya (Treachery).
- Destrava: Eunoia, Chonkers (parcialmente: "double" não), Brain Eater, Grommid, Mugwump, Jarl Svend, Gravelguts, Francus, Hapsis; Strange Gizmo, Forge Compiler, The Quiet Anvil, Universal Keylock, Cyn Dynasty; Cosmicrux; Mercy, Berinon, Agamignus e Lambent Mycelium (partial).

### 6.3 Casa relacional (26 títulos citam "shares a house"; ~12 destravam)
- **(b) Execução:** `houseMatches` resolve o literal contra `houseOf` da fonte, do alvo, do defensor, de `ctx.moved[0]` ou de pelo menos um vizinho da própria carta. `everyMatch` e `countOf` passam o `Ctx` (hoje `matches` só recebe `source`). `forceHouse` com `house` grava a casa da carta de referência; `who` troca o oponente pelo dono ou controlador capturado.
- **(c) Grafias:** `that shares a house with (it|this creature|the discarded card|the destroyed creature)`; `that (shares|does not share) a house with (at least )?(1|one) of its neighbors`; `each of its neighbors that shares a house with it`.
- **(d) Few-shots:**
  - `Play: Discard the bottom card of your opponent's deck. Deal 2<D> to each enemy creature that shares a house with the discarded card.` → `[{"k":"move","n":1,"from":"deck","to":"discard","opp":true,"pick":"bottom"},{"k":"damage","n":2,"s":{"each":{"type":"Creature","side":"enemy","house":"moved"}}}]`
  - `Play: Destroy each creature that does not share a house with at least 1 of its neighbors.` → `[{"k":"destroy","s":{"each":{"type":"Creature","house":"!neighbor"}}}]`
  - `Play: Deal 2<D> to a creature. If it is not destroyed, its controller must choose that creature's house as their active house on their next turn.` → `[{"k":"damage","n":2,"s":"target"},{"k":"forceHouse","house":"target","who":"controller","if":{"k":"count","of":"gone","op":"eq","n":0}}]`
- **(e) Riscos:** a guarda do `houseOf` já rejeita efeito `house` cujo `target` filtra por `house`; os cinco literais novos entram na mesma lista. A casa do alvo precisa ser capturada no início da ability, como o `who`: depois de destruído, `houseAs` foi zerado.
- Destrava: Starpatch, Ox Sarbane, Mark of Dis, Snag, Rumor-sower, Root Access, Dirge of the Deep, Dive Deep, Infinity Strop, Essence Scale, Grand Melee, Groupthink Tank, Bad Chemistry, Technobabble, Dragnet, Taxing Journey.

### 6.4 `ctx.moved` — a carta "discarded/purged/archived this way" (68 títulos citam "this way"; ~13 destravam)
- **(b) Execução:** todo act que tira carta de uma zona ou do board grava `ctx.moved`, junto do `did`. `{m:"cards"}` conta as que casam `house`/`type`; `"icons"` soma `face.amber` + `bonusIcons`; `"power"` soma o poder impresso. `move` com `pick:"moved"` pega até `n` das movidas que ainda estão em `from`. `restrict.type:"moved"` vira o tipo literal quando o `lasting` é gravado.
- **(c) Grafias:** `for each bonus icon on the discarded card`; `put (a|each) [non-]<casa> card discarded this way into your hand`; `if it is (not )?a <casa> card`; `cards of the purged card's type`; `equal to the archived creature's power`.
- **(d) Few-shots:**
  - `Play: Discard the top 6 cards of your deck. You may put a non-Geistoid card discarded this way into your hand.` → `[{"k":"move","n":6,"from":"deck","to":"discard","pick":"top"},{"k":"move","n":1,"from":"discard","to":"hand","pick":"moved","house":"!Geistoid","optional":true}]`
  - `Play: Your opponent discards a random card from their hand. For each bonus icon on the discarded card, they lose 1<A>.` → `[{"k":"discardRandom","n":1,"opp":true},{"k":"loseAmber","n":1,"opp":true,"per":{"m":"icons"}}]`
  - `After Reap: Purge a card from your discard pile. If you do, until the start of your next turn, your opponent cannot play cards of the purged card's type.` → `[{"k":"move","n":1,"from":"discard","to":"purged"},{"k":"lasting","e":{"target":{},"restrict":{"who":"opponent","action":"play","type":"moved"},"duration":"next"},"if":{"k":"count","of":"did","op":"gte","n":1}}]`
- **(e) Riscos:** com `pick:"moved"` e `n` menor que as movidas, quem escolhe é o engine (maior âmbar + ícones). É o mesmo precedente do descarte da mão, mas em Haunting Measures a escolha pesa; a escolha de verdade espera o `targets[]` do Lote 7. Ícone específico (Infurnace, Outnegotiate) e "resolve its bonus icons" ficam fora.
- Destrava: Haunting Measures, Digital Manipulation, Productive Trash, Nada Tax, Mindfire, Victor Flux, Traumatic Echo, Blast from the Past, Break of Dawn, Junk Restoration, Hallowed Eve Festival, Fetchdrones, Sibyl Waimare não (pede turno do oponente).

### 6.5 `hand` — tamanho do refill (17 títulos citam; ~10 destravam)
- **(b) Execução:** `refill` recebe o estado e soma os efeitos `hand` do lado (`opp` aponta para o outro), com piso 0. "Each player" são dois efeitos, como no `keyCost`.
- **(c) Grafias:** `during (your|their) "draw cards" step, (you|your opponent|each player) refills? (your|their) hand to N (additional|less) cards?`, nas duas ordens.
- **(d) Few-shot:** `During their "draw cards" step, your opponent refills their hand to 1 less card.` → `effects:[{"target":{},"hand":-1,"opp":true}]`
- **(e) Riscos:** o `if` do efeito é lido no draw step, depois do ready. Forbidden Tome ("each haunted player") e Zenzizenzizenzic (centro) ficam fora.
- Destrava: Mother, Daughter, The Howling Pit, Anvil Crawler, Ven Omawk, Succubus, Æmbitrage, Covetous Idol, Streke, Fathom Reaver.

### 6.6 Contadores nomeados (16 títulos, um nome cada; ~7 destravam)
- **(b) Execução:** `name` ausente continua sendo o +1 power (`card.counters`). Com `name`, o valor vive em `card.marks[name]`, não mexe em poder e `leavePlay` zera. `Filter.counters: "corrosion"` é presença daquele nome.
- **(d) Few-shot:** `At the end of your turn, put a scheme counter on ~. Action: Remove each scheme counter from ~. Steal 1<A> for each scheme counter removed this way.` → `[{"on":["endOfTurn"],"acts":[{"k":"counter","n":1,"s":"self","name":"scheme"}]},{"on":["action"],"acts":[{"k":"removeCounter","s":"self","name":"scheme"},{"k":"steal","n":1,"per":"did"}]}]`
- **(e) Riscos:** precisa de indicador na peça (reusar o chip do +1, `aria-label` via `t()` com o nome como dado). Toca a peça: rodar `e2e:floor`, `e2e:floor:3d` e `_3d-chain`.
- Destrava: Mastermindy, Eclectic Ambrosius, The Æmber Road, Disruption Field, Slapdash Enamel, The Big One, Vineapple Tree (com o 6.2).

### 6.7 Miudezas de alto retorno por byte (~10 títulos)
- **`type:"Upgrade"` e `"!Upgrade"`:** "a creature or artifact" = `!Upgrade`. Frigorific Rod, Vezyma Thinkdrone, Wipe Clear.
- **`Filter.target`:** "if it was already exhausted". Few-shot de Call of the Void: `[{"k":"destroy","s":"target","if":{"k":"count","of":{"c":{"target":true,"exhausted":true}},"op":"gte","n":1}},{"k":"loseAmber","n":1,"who":"controller","if":{"k":"count","of":"gone","op":"gte","n":1}},{"k":"exhaust","s":"target"}]`
- **`wasNeighbors`:** `targetNeighbors` usa os vizinhos capturados no início quando o alvo já saiu. Dissonant Chord (partial), Indignant Tone, Pain Reaction.
- **Action que se move:** o `purgeSelf` vira um destino genérico (`archive`/`returnToDeck`/`returnToHand` com `s:"self"` numa Action). Out of Ideas, Teamwork, Initiation.

## 4. LOTE 7 — interação (`DSL_VERSION 8`)

```ts
type GameMove = /* … */ & { targets?: string[]; flank?: "left" | "right" };
interface GamePlayer { /* … */ keyColors?: KeyColor[]; keyOrder?: KeyColor[] }   // KeyColor = "red" | "yellow" | "blue"
interface Ability { /* … */ target2?: Filter }
type Selection = /* … */ | "target2" | { pick: Filter; n?: number; upTo?: boolean };
type Condition = /* … */ | { k: "key"; color: KeyColor; opp?: boolean; any?: boolean };
type Count = /* … */ | { p: "keyColors" };
type Act = /* … */
  | { k: "moveAmber"; /* … */ to: "pool" | "supply" | "target2" }
  | { k: "toFlank"; s: Selection }
  | { k: "move"; /* … */ until?: { house?: string; type?: string } };
```

### 7.1 `GameMove.targets[]` (30 títulos "up to", 20 "any number", 11 "one to another", 15 flank)
- **(b) Execução:** `{pick, upTo}` consome a fila `targets` do movimento em vez do `autoPick`; fila vazia é zero alvos. `target2` é o segundo alvo escolhido. `toFlank` lê `move.flank`.
- **(d) Few-shots:** `Play: Deal 1<D> to up to three creatures. Gain 1<A> for each creature destroyed this way.` → `[{"k":"damage","n":1,"s":{"pick":{"type":"Creature"},"n":3,"upTo":true}},{"k":"gainAmber","n":1,"per":"gone"}]`; `Play: Move all <A> from one creature to another creature.` → `target:{"type":"Creature","amber":true}, target2:{"type":"Creature"}, acts:[{"k":"moveAmber","s":"target","to":"target2"}]`
- **(e) Riscos:** `getLegalMoves` não pode enumerar subconjuntos. Para a IA, gerar só três variantes (nenhum, o melhor, todos os que a heurística aprova); o humano monta a fila na UI de multi-seleção. Mover contadores (Cŏnrăd) usa `counter per:"did"` em `target2`.

### 7.2 Cor de chave (14 títulos, quase todos limpos; ~10 destravam)
- **(b) Execução:** `forge()` empurra a próxima cor de `keyOrder` em `keyColors`. `keyOrder` é preferência do jogador, alternada no HUD das chaves por função pura fora do `GameMove`, como o `setHold`. `{k:"key", color, any}` lê "a red key is forged" (qualquer lado) ou "your red key".
- **(d) Few-shot:** `After Fight: Steal 1<A>. If a blue key is forged, ward ~.` → `[{"k":"steal","n":1},{"k":"ward","s":"self","if":{"k":"key","color":"blue","any":true}}]`
- **(e) Riscos:** a IA precisa de uma ordem padrão que olhe as próprias cartas; ordem fixa é exata nas regras mas joga mal.

### 7.3 `move.until`, gatilho de descarte, turno do oponente (~6 títulos)
- `until`: descarta do topo até casar ou acabar o deck. Lethologica, Sound the Horns, Belcher.
- Gatilho `discard` (da mão) e `{p:"discards"}`: Auto-Encoder, Giant Sloth, Earthbind.
- `oppStartOfTurn`/`oppEndOfTurn`: só Sibyl Waimare sai limpa hoje; entra se sobrar fôlego.

## 5. Cortes

| Item | Decisão | Por quê |
|---|---|---|
| Look / reveal / search (23 + 39 + 11 títulos) | Continua fora | Nada mudou: informação oculta, log que vaza no pass-and-play. Dos 39 de reveal, só 15 não têm outro bloqueio. |
| "Any number" / "up to N" / dois alvos | Sim, precisa de `targets[]` | É o 7.1. Sem a fila, `autoPick` no máximo transforma "destroy any number of friendly creatures" em suicídio. |
| Escolha de jogador ("a player's deck", "a discard pile": 26 títulos) | Fora | Siphon Maw, Haunting Deck. Pede `GameMove.who`; candidato ao lote 8. |
| Jogar carta de zona (16 títulos) | Fora | Bot Bookton, Wild Wormhole. Um play aninhado precisa de alvo e casa próprios. |
| "Choose one" / swap / mover upgrade | Fora | Modos pedem variante de movimento; Dapper Chapeau e Refit pedem reanexar. |
| Fate / Prophecy, Tide, Treachery, Invulnerable | Fora | Sem mudança; `partial` segue cobrindo o resto da carta. |
| Substituições fora de destroy/damage | Fora | Fading Apparition, The Chosen One, Collector Worm: uma carta cada. |
| Restrição com limiar dinâmico ou carta nomeada | Fora | Malina, Thing from the Deep, Tentacus, Allusions of Grandeur. |
| Frações e agrupamento | Fora | Tertiate, Technorachnophobia, Good of the Many, Against All Flags, Red-Hot Armor. |
| Freelancer | Fora | Sairia com `oppStartOfTurn`, mas depende de quem é o `me` de ability de upgrade após troca de controle; não verifiquei. |

Para cada lote: `npm run build`, `npm test`, `npm run gen:schema`, `e2e:smoke` e `e2e:bundle` (telemetria). O 6.6 e o Lote 7 tocam peça e HUD: rodar também `e2e:floor`, `e2e:floor:3d`, `_3d-chain` e `_3d-hit`.

LOTE 6: higiene do pipeline (retry por classe com `tries`, transporte no fim da fila, órfãs do demo, uma chamada por `textHash + type`, prompt de "unless"/zona do dono), `powerMin`/`powerMax`/`weaker`, gatilho `forge` + observadores `ready`/`enter` + `Filter.fighting` + `actor`, casa relacional (`self`/`target`/`fought`/`moved`/`neighbor`) + `forceHouse.house/who`, `ctx.moved` (`Count.m`, `pick:"moved"`, `move.house`, `restrict.type:"moved"`), `effect.hand`, contadores nomeados (`marks`), `type:"Upgrade"`/`"!Upgrade"`, `Filter.target`/`neighborsOfTarget`, `wasNeighbors`, Action que se move — DSL_VERSION 7
LOTE 7: `GameMove.targets[]` + `upTo` + `target2` + `toFlank`, cor de chave (`keyColors`/`keyOrder` + `{k:"key"}`), `move.until`, gatilho `discard` (`{p:"discards"}` ficou fora, ver §8), `oppStartOfTurn`/`oppEndOfTurn` — DSL_VERSION 8
## 8. Lote 7 — como ficou (DSL_VERSION 8, PARSER_VERSION 8)

Cobertura: cor de chave (Ruby Rackham, Deep Blue Bryn, Skulking Saboteurs, Glittering Horde), `targets[]` (Throwing Stars, Ditch the Loot, Cŏnrăd Fisiquĕ, Barrel Roll), `move.until` (Lethologica) e gatilho `discard` (Auto-Encoder). Specs em `src/lib/dsl8.test.ts`.

Desvios do desenho da seção 4:
- **Cor de chave:** `forge()` grava `keyColors` na ordem de `keyOrder`; sem ordem, a padrão é a cor mais citada no texto do próprio deck (red, yellow, blue no empate). `setKeyOrder` existe (pura, fora do GameMove), mas **o seletor no HUD das chaves não foi feito**. `unforgeKey` devolve a última cor forjada. Saves sem `keyColors` são completados a partir de `keys` (`forgedKeyColors`). `Count {p:"keyColors"}` leva `opp`/`any` (Glittering Horde = `any`, união dos dois lados).
- **`targets[]`:** a fila vale para `target2` (primeiro item) e depois para `{pick, upTo}`. `target2` nunca é a mesma carta de `target`. Fila vazia/ausente = zero cartas em `upTo` (o motor nunca adivinha um subconjunto para o humano). A IA recebe **duas** variantes (nenhuma e a melhor), não três: o teto `n` já faz "melhor" = "todos os que a heurística aprova". Verbo nocivo só mira inimigos, benéfico só amigos; "any number" nocivo sobre o próprio lado fica só com a variante vazia (a IA não joga o act). UI: `pendingPrompt` devolve a próxima pergunta (`target2`, `targets`, `flank`); o App reaproveita o `pick` (clique para alternar + "Confirmar"; flanco por dois botões). `target2` + `upTo` na mesma ability: o motor aceita a fila, a UI só pergunta o `target2`.
- **`until`:** só `deck → discard`, uma carta por vez, a carta que casa fica no descarte; teto `UNTIL_LIMIT = 200`; `n` é ignorado.
- **`discard`:** observador puro (exige `of`; `of:{}` basta). A carta descartada não controla nada, então "da sua mão" é `if:{k:"actor"}` (`opp:true` para a do oponente, sem `if` para qualquer mão). Só descarte de MÃO dispara (move hand→discard, `discardRandom`, o movimento `discard`); mill não. A fonte nunca observa a si mesma. Herda `OBSERVER_DEPTH/BUDGET`. O gate rejeita `discardRandom` e `move hand→discard` dentro de uma ability `discard`.
- **Skulking Saboteurs:** com 2+ condicionais independentes numa ability, nenhuma vira `ability.if` (cada uma guarda só os próprios acts). Limite conhecido: o `target` (criatura inimiga) segue obrigatório para a ability toda.
- **Fora:** `oppStartOfTurn`/`oppEndOfTurn` (a seção 7.3 os marcava "se sobrar fôlego").
- **Fora (declarado):** `{p:"discards"}` (Giant Sloth, Earthbind) — o gatilho `discard` dispara por ocorrência, mas não há contador de cartas descartadas no estado; contar exigiria novo campo em `GameState`/saves. Fica para o lote seguinte; as duas cartas seguem fora do `full`.
- **Guarda de auto-observação:** só o gatilho `discard` ignora `watcher === event` (a carta descartada já saiu de jogo). Reap/fight/ready seguem se auto-observando ("Each time a friendly creature reaps" vale para a própria); specs em `dsl8.test.ts`.
- **Limitação conhecida da IA:** a IA só ganha variantes para "até N" (nenhuma/melhor). Ela nunca escolhe flanco (`toFlank`: Barrel Roll vai sempre à esquerda) nem `target2` (auto-pick). O humano escolhe de verdade; a IA aproxima.

## 9. Lote 8 (DSL_VERSION 9) — correções da review

- **`{gone: Filter}` com `side`:** a carta morta não tem controlador, então o lado é gravado no snapshot do act ANTES de sair de jogo (`Snapshot.cards[].side` → `goneCards[].side`) e o `side` do filtro é comparado com esse lado guardado; os demais campos do filtro continuam via `matches`. Mesa 2 aliadas + 3 inimigas destruídas: friendly=2, enemy=3 (spec em `dsl9.test.ts`). Campos que dependem de estar em jogo (flank, damaged...) seguem sem sentido num `gone` e não foram tratados.
- **Gabos:** `dealDamage` aplica o `fightRedirect` ANTES do "cannot be dealt damage"; quem pode ser imune é o destino. O gate só aceita `redirect:"chosen"` em `beforeFight` (em `fight` ele seria gravado depois do dano e zerado no fim: inerte), e a exigência de `duration` no `lasting` isenta esse redirect (vive o tempo da luta).
- **Few-shots × gate:** nova spec roda TODOS os few-shots por `validateDraft`. Ela pegou, além do Gabos, dois few-shots antigos que o gate rejeitava: o gatilho `discard` (faltava em `TRIGGER_WORDS`) e `forceHouse` com "choose that creature's house" (regex do gate aceitava só "choose a house"). Ambos corrigidos.
- **Contagem:** são 9 few-shots novos (não 10), um por carta.
- **Regex afrouxadas fora das 9 mecânicas** (necessárias para os textos reais; mudam parses antigos, e o bump de `PARSER_VERSION` já invalida os congelados): `captures N` sem âmbar, `exalt N times`, `on it/them`, `reduced by 1` sem âmbar.
- `dsl8.test.ts`: `DSL_VERSION >= 8` é piso proposital (bumps posteriores preservam os literais do lote 7).

## 10. Lote 10 (DSL_VERSION 10, PARSER_VERSION 10) — `peek` e `attackBonus`

Os textos reais do corpus diferem dos do pedido: Psychic Bug é "Play/Reap: Look at your opponent's hand." (não há "reveals their hand" no Psychic Bug) e Valdr é "Valdr deals +2 while attacking an enemy creature on the flank." (também na grafia `+2<D> … enemy flank creature`).

**`peek`** — `{ k:"peek", from:"hand"|"deck", n?:number, opp?:boolean }`.
- Desvio do pedido: o act NÃO leva `s: Selection` (Selection só aponta cartas da mesa); segue o desenho zonal do `move` (`from` + `opp`). `n` é a profundidade do deck (default 1, o topo primeiro); a mão é mostrada inteira.
- Motor: grava `GameState.peek = { side, owner, from, faces[] }` (JSON puro, `side` = quem olha). `applyMove` apaga o `peek` anterior depois da checagem de legalidade, então ele vive até o próximo movimento. O log recebe SÓ `log.peek {name, n}` ("olhou N carta(s)") — nunca identidades; nada é movido ou embaralhado. Mão/deck vazios: loga `n = 0` e não abre nada.
- UI: `PeekDialog` (App.tsx) abre um modal privado ("Olhando as cartas") com as cartas em `CardArt`; fecha no clique/Esc/backdrop (o descarte é local: o objeto `peek` é guardado como "visto"). Só abre para o humano que olhou (`peek.side === humanSide` no solo; `passAndPlay` abre para o jogador ativo, que é quem segura o aparelho).
- Pass-and-play (limitação documentada, escolha simples): como o log só tem a contagem e o `peek` é apagado no movimento seguinte, o outro jogador não vê nada pelo log; o único vazamento possível é fisicamente olhar a tela enquanto o ativo está com o modal aberto — igual a qualquer mão aberta no aparelho. A tela de "passe o aparelho" só aparece depois do fim do turno, que é um movimento (o `peek` já foi trocado).
- Parser: só as formas TERMINAIS (a frase "Look at …" sozinha): `look at your opponent's hand`, `look at the top (card|N cards) of (your|your opponent's) deck`. Frases que agem sobre o que foi visto ("… and put them back", "… choose a card from it", "You may discard that card") ficam como sentença não suportada ao lado — a carta vira `partial`/`vanilla`, nunca `full` errado.
- Few-shot: Psychic Bug → `{"on":["play","reap"],"acts":[{"k":"peek","from":"hand","opp":true}]}`.

**`attackBonus`** — `PersistentEffect { attackBonus?: number; whenAttacking?: Filter }`.
- Desvio do pedido: `whenAttacking` é um **Filter** do defensor (não uma `Condition` de contagem): Valdr = `{ target:{self:true}, attackBonus:2, whenAttacking:{ type:"Creature", side:"enemy", flank:true } }`. `side` é relativo ao lado do efeito; sem `whenAttacking` o bônus vale contra qualquer defensor.
- Motor: `attackBonusAgainst(state, attacker, defender)` (exportada) soma os efeitos ativos que acertam o atacante e cujo filtro casa com o defensor. É lida SÓ no passo de dano da luta (`fightBody`, junto de `effectivePower(attacker)`), depois do teste de Elusive — Elusive continua cancelando o dano inteiro (o bônus não passa por `beforeFight`). Nunca entra em `effectivePower` (o poder exibido e o dano devolvido por quem defende não mudam); a IA o enxerga porque simula `applyMove`.
- Recursão: o bônus é lido fora de `allEffects → effectivePower`, então um filtro de defensor que lê poder (`most`, `powerMin`…) não recursiona; o gate (`validAttackBonus`) exige `attackBonus` finito ≠ 0, `whenAttacking` só junto dele e com os campos fechados de `Filter`; vale também no `lasting`. Não há `readsPower` aplicável porque nada é guardado em `effectivePower`.
- Few-shot: `~ deals +2<D> while attacking an enemy creature on the flank.` (a regex também aceita `~`).

Testes: `dsl10.test.ts` (18 specs). Efeito colateral nos specs antigos: o fixture "Look at the top card of your deck" (usado como texto não suportado) virou "… and name it."; `fx.test` usa Tocsin como atacante (Valdr agora tem bônus); o snapshot do starter sobe de 49→51 full (Psychic Bug, Valdr).

## 12. Lote 12 (DSL_VERSION 12, PARSER_VERSION 12) — casas distintas e Animating Force

**`Count { housesOf: "moved" }`** — Rogue Operation: "Steal 1A for each house represented among the discarded cards."
- A seleção `"moved"` é simbólica: não é uma carta da mesa. `countOf` lê `scope.moved` (o Lote 6 grava esse snapshot no `move` que descartou o topo do deck) e devolve `new Set` das `face.house` impressas, ignorando vazio e `"all"`. Outras seleções passam por `select`.
- O fallthrough antigo de `countOf` assumia `{of, s}`. Com a variante nova ele discrimina `"housesOf"` e só soma `{of}` quando `"of" in spec`.
- Grafia: `houses represented among the discarded cards` → `per: { housesOf: "moved" }`.

**Animating Force** — três mecanismos, a forma mínima:
- **Host artefato:** `PersistentEffect.hosts?: "Artifact"` no efeito constante da própria carta (`target: { self: true }`). `canPlay` / `targetChoices` / o play só oferecem artefatos ainda não materializados. Não é um bônus de poder.
- **Controle enquanto a fonte está em jogo:** `takeControl.whileSource?: true` grava `CardInstance.boundTo` (instance id da upgrade). `leavePlay` da fonte devolve a carta ao dono e zera `controlledBy`. Não é `PersistentEffect.control`: controle é uma mudança de zona, não uma estatística relida a cada consulta.
- **Criatura 4 / versatile:** `Act { k: "materialize", s, power, keyword?: "versatile" }` no MESMO card (`asCreature`), sem token e sem mutar `face` (a face é compartilhada). O poder impresso do artefato fica de lado enquanto `asCreature` existe; `versatile` entra em `keyword()`. O flanco default é o esquerdo, o mesmo do `takeControl`. `boundTo` também é gravado aqui, então a forma de criatura acaba no mesmo `leavePlay` da fonte.
- Trade-off: a carta é uma. Não há cópia-token, então âmbar, id e upgrades anexados continuam no artefato. Quando a upgrade sai, o artefato volta a ser artefato no board do dono (não fica criatura).
- Grafia única, antes do split em "and": "take control of this artifact and put it on a flank … with N power and versatile". "Scrap: Gain 1" já era `gainAmber`.

**Review do lote (fechado):**
- **Tipo visível.** `displayType` / `isCreatureCard` devolvem `"Creature"` enquanto `asCreature` está ativo. Filtros (`matches`, restrições, contagem `m`), a battleline, os botões do inspetor e o placar da IA leem esse tipo. "Destroy a creature" atinge o artefato materializado; "Destroy an artifact" não.
- **Estado limpo.** `releaseBound` zera `damage`, `stunned`, `warded` e `enraged` e deixa `ready` verdadeiro. Uma segunda Animating Force não reanima o artefato já ferido.
- **`moved` só em `housesOf`.** Não é uma `Selection`: `s:"moved"` no gate é rejeitado (não devolve cartas do descarte para um ato de mesa). `countOf` lê `scope.moved` direto. `hosts` e chaves extras de `materialize` no ato ou na ability também são rejeitados — `hosts` só existe no efeito.

