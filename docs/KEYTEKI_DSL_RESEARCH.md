<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Pesquisa sobre o sistema de abilities do keyteki (AGPL — uso autorizado pelo
     dono) e a viabilidade de converter os registros de carta dele para a nossa
     DSL (v10). Clone analisado: C:/Users/HP/keyteki-research (shallow clone de
     github.com/keyteki/keyteki, out/2026). Gerada em 04/out/2026. -->

# Pesquisa: keyteki → nossa DSL (conversão do corpus de abilities)

## 1. Resumo executivo

| Número | Valor |
|---|---|
| Arquivos de carta no keyteki | **2.606** em 14 pastas de set (`server/game/cards/01-Core` … `14-DM`) |
| Arquivos com abilities EXPLÍCITAS | **2.478** (2.584 têm `setupCardAbilities`; 106 são vazios — só keywords; 22 não têm o método) |
| Cobertura do keyteki sobre o corpus MV (14 sets de deck, ids distintos) | **2.426 / 5.235 = 46%** (carta sem arquivo usa a classe base = vanilla) |
| Classes de action (`server/game/GameActions/`) | **101** arquivos (~90 são ações de fato; o resto são bases/internas), expostas como **~150 helpers** de `ability.actions.*` |
| Helpers distintos usados nas cartas | **127**, num total de **4.408 usos** |
| Usos em helpers 1:1 com a nossa DSL | **~75%** dos 4.408 usos estão nos 20 helpers principais, todos com equivalente direto |
| Registros de trigger (`this.play({` etc.) | **3.036**, em 14 formas de registro |
| Nosso vocabulário (v10) | 15 triggers, **41 acts**, 20+ campos de `PersistentEffect`, `Filter` com 24 campos |
| Nosso pipeline hoje (CLAUDE.md) | full 1.218/3.744 (32,5%) + 167 partial |

**Resposta curta:** o registro keyteki é JS por carta (`setupCardAbilities(ability)` com
`this.play/reap/fight/action/...` + `ability.actions.X()`), mas é altamente padronizado — e a
nossa DSL foi modelada DEPOIS dele (o cabeçalho de `src/lib/abilities.ts` cita
Card.js/CardAbility.js/GameActions como fonte). O mapeamento mecânico é direto para a
maioria do volume. O limite não é sintático: é (a) o keyteki só implementa 46% das cartas
de deck, e (b) ~20% do que ele implementa usa closures JS que pedem padrões manuais.

**VIABILIDADE: ALTA** para o subconjunto que o keyteki implementa (2.426 cartas; ~1.900
com DSL full via conversor script em 2–4 semanas), **BAIXA como caminho único** para o
corpus total (teto 46% — MoMu 6%, VM25 2%, CC 15% não existem lá). O caminho certo é
híbrido: conversor AST keyteki→DSL para o que existe lá, nosso parser de texto/LLM para o
resto, com reconciliação por texto.

---

## 2. Como o keyteki registra habilidades

### 2.1 Estrutura

- Uma classe por carta em `server/game/cards/<NN-SET>/<NomePascalCase>.js`; `cards/index.js` carrega tudo num mapa por `card.id` (kebab-case, igual ao id do Master Vault — ex.: `Anger.id = 'anger'`).
- A habilidade vive de um comentário de cabeçalho (o TEXTO impresso, sincronizado do MV por `server/scripts/json-data-to-card-comments.js`) + o método:

```js
// Anger.js (01-Core) — texto: "Play: Ready and fight with a friendly creature."
setupCardAbilities(ability) {
    this.play({
        target: {
            cardType: 'creature',
            controller: 'self',
            gameAction: ability.actions.sequential([
                ability.actions.ready(),
                ability.actions.fight()
            ])
        },
        effect: 'ready and fight with {0}'   // só log
    });
}
```

- Os métodos de registro estão em `server/game/Card.js` (linhas ~449–660): `play`, `fight`, `reap`, `destroyed` (interrupt de leaves-play), `omni`/`action`, `beforeFight`, `scrap` (react a `onCardDiscarded` da própria carta saindo da mão), `fate`, `prophecyReaction`/`prophecyInterrupt`, `reaction`/`interrupt` genéricos (com `when: { onEvento: (event, context) => ... }`) e `persistentEffect`.

### 2.2 O fallback que define o corpus

`server/game/Deck.js:114`:

```js
if (!cards[cardData.id]) {
    return new Card(player, cardData);      // classe base: SEM abilities
}
let cardClass = cards[cardData.id];
return new cardClass(player, cardData);
```

Carta sem arquivo joga com defaults do engine (bonus icons + keywords do tipo), igual ao
nosso "vanilla". Por isso **o número que importa é 2.478 arquivos com abilities** — e não
as 5.881 entradas do MV.

### 2.3 Cobertura por set (ids do nosso `.kfdata-tmp` × arquivos keyteki)

| Set | ids MV | keyteki | % | Set | ids MV | keyteki | % |
|---|---|---|---|---|---|---|---|
| CotA | 370 | 354 | 95% | AS | 329 | 187 | 56% |
| AoA | 370 | 181 | 48% | ToC | 321 | 80 | 24% |
| WC | 415 | 264 | 63% | MoMu | 455 | 30 | 6% |
| MM | 425 | 230 | 54% | VM25 | 305 | 8 | 2% |
| DT | 429 | 247 | 57% | PV | 369 | 182 | 49% |
| WoE | 414 | 230 | 55% | CC | 350 | 55 | 15% |
| GR | 398 | 233 | 58% | DM | 285 | 145 | 50% |

Total: **2.426/5.235 (46%)**. MG24 (Menagerie 2024, 791 entradas) não tem pasta nenhuma:
são reimpressões (resolvem por título para a carta original) + 27 cartas do modo raid
Keyraken (`Legendary Keyraken`, tentáculos etc.), um modo que o keyteki não implementa.

### 2.4 Tokens e non-deck

Tokens de WoE/ToC são o VERSO de cartas do deck (flip): `MakeTokenCreatureAction` copia
`player.tokenCard` via `effects.flipToken()/copyCard(...)` — o arquivo da carta de deck
cobre o token. Prophecy (PV) tem arquivos, mas é o subsistema `Fate:` que já cortamos.
**Não há buraco de tokens/non-deck para conversão** — exceto as 27 de Keyraken, fora do
jogo principal.

### 2.5 Quanto é JS dinâmico (a cauda difícil)

Medição sobre os 2.584 arquivos com `setupCardAbilities`:

| Padrão | Arquivos |
|---|---|
| Só padrões estáticos (sem closure/condição dinâmica) | **604** (piso de conversão trivial) |
| `(context) => ...` (inclui usos cosméticos de `effect`/`effectArgs`, só log) | 1.313 |
| `condition:` (gate da ability inteira) | 729 |
| `then:` (encadeamento "If you do…") | 480 |
| `when:` (observadores de evento) | 365 |
| `cardCondition:` (predicado de alvo) | 329 |
| `EventRegistrar` (memória de turno própria, ex.: Lifeweb) | 26 |

O `effect:`/`effectArgs:` é só log do keyteki — grande parte dos 1.313 é cosmética; a
cauda mecânica real é menor, mas exige reconhecer padrões de closure
(`context.source.powerCounters`, `card.isOnFlank()`, `hasTrait('x')`…).

---

## 3. Vocabulário keyteki (medido no corpus)

### 3.1 Triggers de registro (contagem de usos)

| Registro | Usos | Nosso trigger |
|---|---|---|
| `this.play({` | 1.154 | `play` |
| `this.persistentEffect({` | 461 | `effects[]` (constante) |
| `this.reap({` | 257 | `reap` |
| `this.action({` | 234 | `action` |
| `this.reaction({ when: … })` | 228 | observador (`on` + `of`) |
| `this.fight({` | 192 | `fight` |
| `this.destroyed({` | 102 | `destroyed` |
| `this.interrupt({` | 71 | `beforeFight` / `replace` (quase tudo é dano/leaves-play) |
| `this.fate({` | 70 | corte (Prophecy) |
| `this.omni({` | 65 | `omni` |
| `this.scrap({` | 59 | `scrap` |
| `this.beforeFight({` | 22 | `beforeFight` |
| `this.prophecyReaction/Interrupt` | 21 | corte (Prophecy) |

Total: 3.036 registros. Nossos 15 triggers cobrem todas as formas exceto Fate/Prophecy (e
`reaction when:` genérico vira observador só para os eventos que o nosso `of` sabe olhar).

### 3.2 Eventos observados nos `when:` (top)

`onTurnEnd` 62 · `onCardPlayed` 52 · `onTurnStart` 47 · `onCardDestroyed` 34 ·
`onUseCard` 24 · `onReap` 23 · `onChooseActiveHouse` 22 · `onForgeKey` 17 ·
`onRaiseTide` 14 (Tide, corte) · `onCardDiscarded` 13 · `onDamageApplied` 10 ·
`onCardLeavesPlay` 10 · `onCardEntersPlay` 10 · `onFight` 6 · `onCardsReadied` 5 ·
`onDrawCards` 3 · resto 1–2.

Mapeia bem para os nossos observadores: `startOfTurn`/`endOfTurn`, `enter`, `ready`,
`discard`, `forge`, `house` + `on:["reap"|"fight"|"destroyed"] com `of`. Ficam fora
`onRaiseTide` (Tide), `onDamageApplied` como interrupção genérica (só cobrimos
`replace.redirect/prevent`) e eventos de zona profunda.

### 3.3 Ações: 101 classes, 127 helpers usados

Top-20 helpers (**75% dos 4.408 usos**) — todos com equivalente direto ou estrutural na
nossa DSL:

| Helper keyteki | Usos | Nossa DSL |
|---|---|---|
| `destroy` | 330 | `{k:"destroy"}` |
| `gainAmber` | 290 | `{k:"gainAmber",n}` |
| `dealDamage` | 282 | `{k:"damage",n,s}` |
| `sequential` | 207 | lista `acts[]` (o nosso motor já é sequencial) |
| `capture` | 202 | `{k:"capture",n,s}` |
| `discard` | 170 | `{k:"move",from:"hand",to:"discard"}` |
| `steal` | 162 | `{k:"steal",n}` |
| `archive` | 149 | `{k:"archive",s}` |
| `draw` | 134 | `{k:"draw",n}` |
| `cardLastingEffect` | 134 | `{k:"lasting",e:{…}}` |
| `makeTokenCreature` | 127 | `{k:"makeToken",n}` |
| `exalt` | 120 | `{k:"exalt",n,s}` |
| `returnToDeck` | 117 | `{k:"returnToDeck",s,at}` |
| `purge` | 116 | `{k:"purge",s}` |
| `ready` | 115 | `{k:"ready",s}` |
| `returnToHand` | 111 | `{k:"returnToHand",s}` |
| `untilPlayerTurnEnd` | 105 | `{k:"lasting",e:{…,duration:"turn"}}` |
| `conditional` | 98 | `act.if` / `mode:"a"|"b"` |
| `loseAmber` | 96 | `{k:"loseAmber",n}` |
| `exhaust` | 84 | `{k:"exhaust",s}` |

Cauda 1:1 também direta: `addPowerCounter` 78 → `counter` · `stun` 67 · `heal` 56 ·
`duringOpponentNextTurn` 55 → `lasting duration:"next"` · `use` 44 · `ward` 40 ·
`forgeKey` 38 · `fight` 38 → `use via:"fight"` · `discardAtRandom` 38 → `discardRandom` ·
`sacrifice` 37 · `enrage` 32 · `reveal` 31 (ver §6) · `gainChains` 24 ·
`moveToFlank` 19 → `toFlank` · `putIntoArchives` 17 → `archive` ·
`moveCard` 18 → `move` · `removePowerCounter` 14 · `moveToBottom` 14 →
`returnToDeck at:"bottom"` · `returnAmber` 14 → `moveAmber to:"supply"` ·
`transferAmber` 11 → `moveAmber to:"target2"` · `discardTopOfDeck` →
`move deck→discard pick:"top"` · `randomDiscard/Archive/Purge` → `move pick:"random"` ·
`discardEntireLocation` 10 → `move pick:"all"` · `removeStun` → `unstun` ·
`removeWard` · `changeActiveHouse` → `forceHouse` · **~25 aliases `addXxxCounter`** →
`counter name` / `removeCounter name`.

Cauda parcial ou sem equivalente: `allocateDamage` 23 + `changeEvent` 34 (splash/
redistribuição; só splash de vizinhos cobrimos) · `placeAmber` 34 · `playCard` 45 +
`putIntoPlay` 19 (jogar carta de zona — corte nosso) · `search` 20 (corte) ·
`placeUnder` 12 · `resolveAbility` 25 (≈ `use`, parcial) · `abduct` 10 (captura+controle) ·
`raiseTide` 18 / `resetTide` (Tide — corte) · `moveOnBattleline` 10 ·
`fulfillProphecy` 22 + `activate/flip/deactivateProphecy` (Prophecy — corte) ·
`attach/moveUpgrade` 3 · `swap`/`swapDiscardWithHand` · `rearrange*` · `mulligan` ·
`gainsTextBox` · `resolveBonusIcons` 8 · `randomPlayCard`.

### 3.4 Efeitos (`ability.effects.*`, 80 helpers distintos usados)

1:1: `modifyPower` 82 → `power` · `modifyArmor` 39 → `armor` · `addKeyword` 132 →
`keywords` · `gainAbility` 188 → `effects[].abilities` · `playerCannot` 49 → `restrict` ·
`modifyKeyCost` 66 → `keyCost` · `modifyHandSize` 15 → `hand` · `addTrait` 8 → `traits` ·
`changeHouse` 23 → `house`.

Parciais/sem: `cardCannot` 100 (ex.: `dealFightDamage` de Shadow Self não tem campo) ·
`takeControl` 56 como efeito DURADOURO (nosso `takeControl` é act one-shot — ver Harland)
· `entersPlayReady/entersPlayStunned` · `changeType` · `removeKeyword` · `skipStep` ·
`limitFightDamage` · `forgeAmberSource` · `canUse/canPlayNonHouse/canPlayAsUpgrade` ·
`ignores`.

---

## 4. As 8 amostras lado a lado

Todas existem no nosso dataset (`.kfdata-tmp/packs`). Código real do keyteki ao lado da
linha que o conversor deveria emitir na nossa DSL v10.

### 4.1 SIMPLES — Anger (CotA) — 1:1

keyteki (`01-Core/Anger.js`): `this.play({ target: { cardType:'creature', controller:'self', gameAction: ability.actions.sequential([ability.actions.ready(), ability.actions.fight()]) } })`

```json
{"on":["play"],"target":{"type":"Creature","side":"friendly"},
 "acts":[{"k":"ready","s":"target"},{"k":"use","s":"target","via":"fight"}]}
```

O par `sequential(ready, fight)` do keyteki É literalmente o nosso par
`ready` + `use via:"fight"` — os dois motores foram desenhados para isso.

### 4.2 SEARCH — Bear Flute (CotA) — PARCIAL (search é corte)

keyteki: alvo "Ancient Bear em jogo" + `heal({fully:true})` + `search({cardName})` no deck
e descarte + `then: returnToDeck(shuffle)` do descarte. A `search` lê `cardName` dinâmico
e zonais ocultos.

```json
{"on":["action"],"target":{"type":"Creature","trait":"Ancient Bear"},
 "acts":[{"k":"heal","n":999,"s":"target"}],"__partial":"search e fully-heal fora da DSL"}
```

3 sentenças, 1 conversível. A carta fica `partial` com motivo — nunca `full` errado.

### 4.3 CHOOSE-ONE / COMPOSTA — Blank Check (DM) — PARCIAL (3 de 4)

keyteki: dois `conditional` + `chooseAction` ("quem embaralha primeiro") +
`discardTopOfDeck(5)` + `playCard(top do deck do oponente)`.

```json
{"on":["play"],"acts":[
 {"k":"move","n":1,"from":"discard","to":"deck","pick":"all","at":"shuffle"},
 {"k":"move","n":1,"from":"archives","to":"deck","pick":"all","at":"shuffle"},
 {"k":"move","n":1,"from":"discard","to":"deck","pick":"all","at":"shuffle","opp":true},
 {"k":"move","n":1,"from":"archives","to":"deck","pick":"all","at":"shuffle","opp":true},
 {"k":"move","n":5,"from":"deck","to":"discard","opp":true,"pick":"top"}],
 "__partial":"play-card-from-zone é corte; ordem 'quem primeiro' é cosmética aqui"}
```

A escolha de ordem do keyteki (`chooseAction`) existe na nossa DSL como `mode:"a"|"b"`,
mas aqui as duas ordens têm o mesmo efeito líquido — o conversor emite a sequência.

### 4.4 REDIRECT — Shadow Self (CotA) — PARCIAL (1 de 2 efeitos)

keyteki: `persistentEffect({ effect: ability.effects.cardCannot('dealFightDamage') })` +
`interrupt({ when: onDamageApplied …, gameAction: ability.actions.changeEvent(...) })`
(redireciona dano de vizinhos não-Specter para si).

```json
{"abilities":[],"keywords":{},"effects":[
 {"target":{"neighborsOfSource":true,"trait":"!Specter"},"replace":{"on":"damage","redirect":true}}],
 "__partial":"cardCannot('dealFightDamage') não tem campo na DSL"}
```

O redirect mapeia 1:1 no nosso `Replacement.redirect` (dano vai para a fonte do efeito);
o "não causa dano em luta" não é representável (`attackBonus` não aceita 0).

### 4.5 TRAIT — The Mist (PV) — 1:1

keyteki: `this.omni({ gameAction: [ability.actions.destroy(), ability.actions.untilPlayerTurnEnd({ targetController:'any', effect: ability.effects.addTrait('mutant') })] })`

```json
{"on":["omni"],"acts":[
 {"k":"destroy","s":"self"},
 {"k":"lasting","e":{"target":{},"traits":"Mutant"},"duration":"turn"}]}
```

Conversão exata: omni → destroy self → efeito duradouro de traço para todo mundo.

### 4.6 COUNTER — Chonkers (MM) — 1:1 (com truque de `per`)

keyteki: `this.reaction({ when: onCardDestroyed destroyedFighting …, gameAction:
addPowerCounter({ amount: context.source.powerCounters }) })` + `this.play({ addPowerCounter 1 })`.

```json
{"abilities":[
 {"on":["destroyed"],"of":{"type":"Creature","side":"enemy","fighting":true},
  "acts":[{"k":"counter","n":1,"s":"self","per":{"of":"counters","s":"self"}}]},
 {"on":["play"],"acts":[{"k":"counter","n":1,"s":"self"}]}],
 "keywords":{"skirmish":1}}
```

" Dobrar" = `n × per` com `per = contadores atuais` — exato com a DSL v10. O gatilho
`destroyedFighting` do keyteki vira o observador `of:{fighting:true}` do Lote 6.

### 4.7 REVEAL — Zyzzix the Many (CotA) — 1:1 (reveal→mover da mão)

keyteki: `this.fight({ reap:true, target: {optional, hand, creature}, gameAction: reveal,
then: [archive(target), addPowerCounter(3)] })`.

```json
{"on":["fight","reap"],"acts":[
 {"k":"move","n":1,"from":"hand","to":"archives","optional":true},
 {"k":"counter","n":3,"s":"self","if":{"k":"count","of":"did","op":"gte","n":1}}]}
```

O `then:` do keyteki vira o segundo act com `if: did gte 1`; o `reveal` vira o próprio
movimento mão→arquivo (a informação é do próprio jogador; nada a simular).

### 4.8 COMPLEXA — Harland Mindlock (CotA) — PARCIAL (controle sem prazo)

keyteki: `this.play({ target: { enemy flank creature }, gameAction:
cardLastingEffect({ until: onCardLeavesPlay de Harland, effect: takeControl }) })`.

```json
{"on":["play"],"target":{"type":"Creature","side":"enemy","flank":true},
 "acts":[{"k":"takeControl","s":"target"}],
 "__partial":"nosso takeControl é permanente; keyteki devolve quando Harland sai"}
```

O shape casa (alvo, flank, takeControl), mas a nossa DSL não tem `takeControl` DURADOURO
em `PersistentEffect` — a carta jogaria "errado" na devolução. É o caso-canário para um
pequeno campo novo (`PersistentEffect.control?: true` com `until`).

---

## 5. Mapeamento mecânico keyteki → DSL v10

| Bucket | Classes (das ~90 reais) | Usos dos helpers | Exemplos |
|---|---|---|---|
| **1:1 direto** | ~50 | ~75% dos 4.408 | destroy, gainAmber, dealDamage, steal, capture, draw, exalt, stun, ready, exhaust, ward/enrage, counters (todos os aliases), forgeKey, returnTo*, moveToFlank/Bottom, discard*, makeToken, sacrifice, gainChains, sequential→acts[], conditional→if/mode, lasting*→lasting, chooseAction→mode |
| **Parcial (padrão novo de conversor ou campo faltante)** | ~25 | ~15% | allocateDamage/changeEvent (splash), placeAmber, reveal, resolveAbility→use, abduct (2 acts), cardCannot('dealFightDamage'), takeControl duradouro, entersPlayReady/Stunned, discardRandomCardsToAmount |
| **Sem equivalente (subsistema/corte)** | ~15 | ~10% | Prophecy inteiro (fate 70 + prophecy 21 + fulfill/activate/flip/deactivate), Tide (raiseTide/resetTide + `onRaiseTide`), search, playCard/putIntoPlay, attach/moveUpgrade, swap, rearrange*/moveOnBattleline, placeUnder, mulligan, gainsTextBox |

Além disso, ~26 cartas com `EventRegistrar` (memória de turno própria, ex.: Lifeweb —
"jogou 3+ criaturas no turno passado") e predicate closures longas nunca convertem por
script; ficam para o parser de texto/LLM ou para `scripts` manuais.

## 6. Viabilidade de conversão (conversor script, sem LLM)

**Teto matemático:** o keyteki só implementa **46%** das 5.235 cartas de deck dos 14 sets
(2.426). Nenhum conversor keyteki→DSL passa disso para o corpus total. Dentro do
subconjunto implementado, a análise de usos diz que **~75% do volume de ações cai em
helpers 1:1**, e os triggers mapeiam 1:1 exceto Prophecy/Tide.

**Plano em 3 fases (estimativa de esforço):**

1. **Fase 1 — AST walker + top-20 (2–3 dias).** Node + `acorn`/babel; reconhece
   `this.<trigger>({...})` com propriedades literais (`target: {cardType, controller,
   location, flawless…}`) e `gameAction` com os 20 helpers principais; emite `Ability` v10.
   Cobre as 604 cartas estritamente estáticas + as abilities simples das complexas.
   Estimativa: **~45% das 3.036 abilities registradas**.
2. **Fase 2 — padrões de closure e encadeamento (1 semana).** `then:` de 1 nível →
   `act.if did/gte`; `cardLastingEffect` com `effect:[modifyPower, addTrait, changeHouse,
   gainAbility…]` → `lasting`; counters nomeados por alias; `(context)=>` comuns
   (`context.source.powerCounters`, `context.target.traits.length`, `isOnFlank`,
   `hasTrait`, `hasHouse`, comparação de power/amber); observadores `when:` para os 12
   eventos comuns → `on`+`of`. Estimativa: **~65–70% das abilities**.
3. **Fase 3 — cauda, cortes declarados e fixtures (1–2 semanas).** Marcar `partial` com
   motivo para search/play-from-zone/Prophecy/Tide/redirects exóticos; validar cada carta
   no nosso dry-run (`withTrialOverride`) e cruzar com o texto impresso (que já vem no
   comentário do arquivo) — concordância com o nosso parser = confiança; divergência =
   fila de revisão. Resultado: **~75–80% das 2.426 cartas implementadas com DSL full
   (~1.900–1.950), o resto partial documentado**.

**Resposta à pergunta (c):** um conversor script que gere "80%+ do corpus" é viável PARA O
QUE O KEYTEKI TEM (80% de 2.426 ≈ 1.950 cartas full) com 2–4 semanas de trabalho
(1.500–2.500 linhas de Node), e é impossível só com conversão para os 54% que o keyteki
não implementou (MoMu 6%, VM25 2%, CC 15%, ToC 24%) — aí o caminho segue sendo o nosso
parser de texto + LLM (hoje: 1.218 full). Combinados, os dois cobririam algo como
2.800–3.200 cartas full do corpus, cada uma pela fonte certa.

**Cuidados:**
- **Ground truth não é o texto, é o código** — e o código às vezes DIVERGE do texto
  impresso (bug do keyteki ou simplificação). O cross-check com o comentário/texto MV é
  obrigatório; divergência → fila de revisão, não silêncio.
- **Licença:** a saída deriva de código AGPL-3.0-only; manter o cabeçalho SPDX (prática
  atual do repo — `abilities.ts` já declara a derivação).
- **Ingestão:** `AbilityOverride.source` hoje aceita `parser|llm|manual`; o feed do
  conversor pede um quarto literal (ex.: `keyteki`, confiável como `manual` e revisável
  pela mesma fila) — mudança pequena em `src/lib`, fora do escopo desta pesquisa.
- **3 lacunas de expressividade** que valeriam campos pequenos de DSL e destravariam
  fatia relevante da cauda: `takeControl` duradouro (Harland e ~56 usos de
  `effects.takeControl`), "cannot deal fight damage" (Shadow Self e amigos), splash/
  `allocateDamage` além de vizinhos.

**Caminho que eu escolheria:** conversor AST nas 3 fases, alimentando rows
`source:"keyteki"` (confiáveis), priorizando CotA/WC/MM/DT/WoE/GR/AS (cobertura 48–95%),
com reconciliação por texto contra o nosso parser e revisão humana só nas divergências;
o que o keyteki não tem continua no pipeline LLM atual.
