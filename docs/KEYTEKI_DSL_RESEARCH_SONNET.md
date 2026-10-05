# Pesquisa: como o keyteki registra habilidades × nossa DSL v10 (relatório Sonnet)

Clone raso em `C:/Users/HP/keyteki-research-sonnet` (AGPL, uso autorizado pelo dono). Números abaixo medidos por grep/script Node sobre `server/game/cards`; onde for estimativa, está marcado **(est.)**.

## 1. Onde ficam as cartas e como são registradas

- `server/game/cards/<NN>-<Set>/<NomePascal>.js`, **um arquivo por carta** (2.606 arquivos; `cards/index.js` carrega todos e indexa por `Classe.id`). O texto/stat/keywords vêm de `master-vault-data/packs/*.json` (6.086 linhas de carta, com `text`, `keywords`, `traits`, `house`, `amber`…); o `.js` só traz o **comportamento**.
- Arquivos por set: Core 363 · AoA 198 · WC 292 · MM 250 · DT 274 · WoE 251 · GR 244 · AS 207 · ToC 81 · MoMu 32 · VM25 9 · PV 195 · CC 56 · DM 154.
- 2.584 de 2.606 (99%) têm `setupCardAbilities`; os 22 restantes são vanilla/só keywords (keywords são automáticos a partir do JSON). **Não existe formato declarativo/JSON**: cada carta é uma classe JS imperativa, com closures.
- Mediana 24 linhas/arquivo, p95 47, máx 147.

```js
class Dextre extends Card {
    // Play: Capture 1<A>.
    // Destroyed: Put Dextre on top of your deck.
    setupCardAbilities(ability) {
        this.play({ gameAction: ability.actions.capture() });
        this.destroyed({ gameAction: ability.actions.returnToDeck() });
    }
}
Dextre.id = 'dextre';
```

### Registradores (contagem de chamadas nos arquivos)
`play` 1154 · `persistentEffect` 461 · `reap` 257 · `action` 234 · `reaction` 228 · `fight` 192 · `whileAttached` 145 · `destroyed` 102 · `interrupt` 71 · `fate` 70 · `omni` 65 · `scrap` 59 · `beforeFight` 22 · `prophecyReaction` 17 · `prophecyInterrupt` 4.

`reaction`/`interrupt` têm `when: { onEvento: (event, context) => bool }`. Eventos mais usados: onTurnEnd 60, onCardPlayed 52, onTurnStart 47, onCardDestroyed 34, onUseCard 24, onReap 22, onChooseActiveHouse 22, onForgeKey 17, onRaiseTide 14, onCardDiscarded 13, onCardAttached 11, onCardEntersPlay/LeavesPlay/DamageApplied 10 cada… (~40 eventos distintos; o `when` é **lambda arbitrária**, não filtro declarativo).

## 2. Vocabulário

- **Classes de GameAction**: **101** arquivos em `GameActions/` (≈ 85 concretas + bases: `GameAction`, `CardGameAction`, `PlayerAction`, `SequentialAction`, `ConditionalAction`, `ChooseGameAction`, `JointGameAction`…). `GameActions.js` expõe **138 fábricas** (`ability.actions.X`) — várias são a mesma classe parametrizada (`addPowerCounter`/`addDepthCounter`/`addDoom…` = `AddTokenAction(tipo)`). Usadas de fato nas cartas: **127 nomes distintos**.
- Top por uso: destroy 330 · gainAmber 290 · dealDamage 282 · sequential 207 · capture 202 · discard 170 · steal 162 · archive 149 · draw 134 · cardLastingEffect 134 · makeTokenCreature 127 · exalt 120 · returnToDeck 117 · purge 116 · ready 115 · returnToHand 111 · untilPlayerTurnEnd 105 · conditional 98 · loseAmber 96 · exhaust 84 · addPowerCounter 78 · removeAmber 71 · stun 67 · heal 56 · duringOpponentNextTurn 55 · playCard 45 · use 44 · ward 40 · forgeKey 38 · fight 38 · discardAtRandom 38 · sacrifice 37 · placeAmber 34 · changeEvent 34 · enrage 32 · sequentialForEach 31 · reveal 31 · resolveAbility 25 · gainChains 24 · allocateDamage 23 · fulfillProphecy 22 · search 20 · putIntoPlay 19 · moveToFlank 19 · raiseTide 18 …cauda longa com 1–10 usos (abduct, attach, swap, placeUnder, addTimeCounter, rearrange…).
- **Effects** (`effects.js`, ~96 fábricas; 80 usadas): gainAbility 188 · addKeyword 132 · cardCannot 100 · modifyPower 82 · modifyKeyCost 66 · takeControl 56 · playerCannot 49 · modifyArmor 39 · entersPlayReady 30 · canUse 24 · changeHouse 23 · modifyHandSize 15 · removeKeyword 12 · forgeAmberSource 11 · changeType 10 · skipStep/limitFightDamage/ignores/entersPlayStunned/canPlayNonHouse/canPlayAsUpgrade 9 cada · addTrait 8 · terminalCondition 7…
- **Alvos** (`target:` em 1.640 arquivos): `cardType`, `controller`, `location`, `cardCondition` (lambda), e `mode`: exactly 94 · select (choose-one) 79 · house 39 · upTo 38 · mostStat 37 · unlimited 22 · leastStat 11 · options/card-name/trait/single/minStat/mostHouse/orMore (cauda). `choices:` (84 arquivos) = choose-one; `then:` (627) = "if you do"; `condition:` (729).
- **Estado**: tokens por tipo em `card.tokens` (`amber`, `power`, `damage`, `ward`, `enrage`, `stun`, `depth`, `doom`, `time`…), upgrades via `AttachAction`/`whileAttached`, `lastingEffect`/`cardLastingEffect` com `duration` (`untilPlayerTurnEnd`, `untilPlayerNextTurnStart`, `lastingEffect` = até sair de jogo, ou `until: {onEvento}`), wards como token com consumo, profecias (`fate`/`prophecy*`), maré (`raiseTide`), "gigantic" (carta composta).

## 3. Amostra de 8 cartas (keyteki × nossa DSL v10)

Notação nossa: `Ability { on, if?, of?, target?, target2?, acts[] }` (`src/lib/abilities.ts`).

### 3.1 Simples — Troll (`01-Core/Troll.js`)
```js
this.reap({ gameAction: ability.actions.heal({ amount: 3 }) });
```
```ts
{ on:["reap"], acts:[{ k:"heal", n:3, s:"self" }] }
```
**1:1, trivial.**

### 3.2 Search — Orb of Wonder (`03-WC`) e Bear Flute (`01-Core`)
```js
this.omni({
  gameAction: ability.actions.sacrifice(),
  then: { gameAction: ability.actions.search({ location:['deck'], amount:1, reveal:false }) }
});
```
`SearchAction`: props `amount, location[deck,discard], reveal, cardName, uniqueCardNames, exactly, putIntoArchives` — prompt de escolha entre cartas do deck/descarte, depois embaralha. **Nossa DSL**: não tem `search` (WAVE2 §4 deixou "look/reveal/search" de fora). Aproximação: `{k:"move", n:1, from:"deck", to:"hand", pick: <escolha livre>}` + `shuffle`. Orb ≈ `acts:[{k:"sacrifice",s:"self"},{k:"move",n:1,from:"deck",to:"hand",if:{…did}}]` mas falta "embaralhar o deck" e "buscar por nome" (Bear Flute: `cardName` calculado por lambda, `then` lê `preThenEvents[0].searchedCards`). **Parcial: Orb sim com ~0 lógica nova; Bear Flute pede `search` com `cardName` + condição "encontrou algo".**

### 3.3 Choose-one — Begone (`01-Core/Begone.js`)
```js
this.play({ target: { mode:'select', choices: {
  'Destroy each Dis creature': ability.actions.destroy(ctx => ({ target: ctx.game.creaturesInPlay.filter(c => c.hasHouse('dis')) })),
  'Gain 1 amber': ability.actions.gainAmber()
}}});
```
```ts
{ on:["play"], acts:[
  { k:"destroy", s:{ each:{ house:"Dis", type:"Creature" } }, mode:"a" },
  { k:"gainAmber", n:1, mode:"b" } ] }
```
**1:1 (nosso `mode:"a"|"b"` do Lote 8 §8.4 cobre; limitado a 2 opções — keyteki permite N).** O filtro `creaturesInPlay.filter(...)` vira `{each: Filter}` só se a lambda for reconhecida por padrão.

### 3.4 Redirect — Gabos Longarms (`01-Core`) e Shadow Self
```js
this.beforeFight({ target: { cardType:'creature',
  gameAction: ability.actions.changeEvent(ctx => ({ event: ctx.event, attackerTarget: ctx.target })) } });
```
Shadow Self: `interrupt({ when:{ onDamageApplied:(e,ctx)=> ctx.source.neighbors.includes(e.card) && !e.card.hasTrait('specter') && e.amount>0 }, gameAction: changeEvent(ctx=>({event:ctx.event, card:ctx.source})) })`.
```ts
// Gabos (já existe, Lote 9): beforeFight + lasting.replace.redirect:"chosen"
{ on:["beforeFight"], target:{type:"Creature"}, acts:[{ k:"lasting", e:{ target:{self:true}, replace:{ on:"damage", redirect:"chosen" }, duration:"turn" } }] }
// Shadow Self: PersistentEffect { target:{ neighborsOfSource:true, trait:"!Specter" }, replace:{ on:"damage", redirect:true } }
```
**Mapeia 1:1 por padrão-nome (`changeEvent`+`event`/`card`/`attackerTarget`), mas `changeEvent` é um "mutador de evento" genérico (amount:0, card:, target:, replace…) — nós só temos 3 variantes (`redirect`, `prevent`, `to`).** Ether Spider (`changeEvent amount:0` + `then` que emite `onCapture` manual) fica **sem equivalente** (substituir ganho de âmbar do oponente por captura).

### 3.5 Trait — Mutation of Cunning (`04-MM`) e The Mist (`12-PV`)
```js
target: { cardType:'creature', gameAction: ability.actions.cardLastingEffect({
  duration:'untilPlayerNextTurnStart',
  effect:[ ability.effects.addKeyword({ elusive:1 }), ability.effects.addTrait('mutant') ] }) }
```
The Mist: `omni: [destroy(), untilPlayerTurnEnd({ targetController:'any', effect: addTrait('mutant') })]`.
```ts
// Mutation: ainda sem "until next turn start do SEU turno" (nossa duration:"next" é só do oponente — armadilha documentada)
{ on:["play"], target:{type:"Creature"}, acts:[{ k:"lasting", e:{ target:{target:true}, keywords:{elusive:1}, traits:"Mutant", duration:"next" /*⚠ semântica */ } }] }
// The Mist
{ on:["omni"], acts:[{k:"destroy",s:"self"},{ k:"lasting", e:{ target:{type:"Creature"}, traits:"Mutant", duration:"turn" } }] }
```
**1:1 para The Mist (traits do Lote 8 §8.6 existem); Mutation pede `duration:"mine"` (até o início do seu próximo turno) — pequena lógica nova.**

### 3.6 Counter — Eater of the Dead (`01-Core`)
```js
this.fight({ reap:true, target:{ cardType:'creature', location:'discard', gameAction: ability.actions.purge({ location:'discard' }) },
  then: ctx => ({ gameAction: ability.actions.addPowerCounter({ target: ctx.source }) }) });
```
```ts
{ on:["fight","reap"], acts:[
  { k:"move", n:1, from:"discard", to:"purged", type:"Creature" },
  { k:"counter", n:1, s:"self", if:{ k:"count", of:"did", op:"gte", n:1 } } ] }
```
**1:1 (`move from discard to purged` + `counter` + `if did`).**

### 3.7 Reveal — Deep Probe (`01-Core`) e Book of Leq (`03-WC`)
```js
this.play({ condition: ctx => ctx.player.opponent && ctx.player.opponent.hand.length > 0,
  target: { mode:'house' },
  gameAction: ability.actions.discard(ctx => ({ target: ctx.player.opponent.hand.filter(c => c.type==='creature' && c.hasHouse(ctx.house)) })) });
```
```ts
{ on:["play"], acts:[
  { k:"peek", from:"hand", opp:true },                       // reveal = peek privado hoje (Lote 10); NÃO é público
  { k:"move", n:0, from:"hand", to:"discard", opp:true, pick:"all", type:"Creature", house:/*escolhida*/ } ] }
```
**Parcial:** `mode:'house'` (escolha de casa como alvo livre) e `reveal` **público** (o oponente vê) não existem; nosso `peek` é só-privado. Book of Leq (revela topo, `conditional` na casa da carta revelada, `changeActiveHouse` com a casa lida, ou pula ready+draw + `postHandler` imperativo) = **sem equivalente**.

### 3.8 Complexa — Cyber-Clone (`04-MM`) / Lifeweb (`01-Core`) / Harland Mindlock
- **Cyber-Clone**: `sequential([ purge(ctx => { ctx.event.targetClone = target.getBottomCard().createSnapshot(); … }), cardLastingEffect(ctx => { …monta array de efeitos a partir do snapshot: modifyPower, modifyArmor, addTrait×N, addKeyword×N… }) ])` — **sem equivalente** (efeitos computados a partir de um snapshot dinâmico).
- **Lifeweb**: `this.creaturesPlayed[uuid]=[]` + `EventRegistrar` em `onCardPlayed/onCardAttached/onTurnStart` + `condition: ≥3 criaturas jogadas pelo oponente no turno anterior` — o JS guarda **estado privado por carta**. Nossa DSL: `Count {p:"plays", opp:true}` + `Condition count gte 3` existe para "jogadas neste turno"; "no turno **anterior**" é lógica nova (histórico por turno). **Pede estado novo.**
- **Harland Mindlock**: `target {creature, controller:'opponent', cardCondition: c=>c.isOnFlank()}`, `cardLastingEffect({ until:{onCardLeavesPlay: e=>e.card===ctx.source}, effect: takeControl(ctx.player) })` → `{ on:["play"], target:{type:"Creature", side:"enemy", flank:true}, acts:[{k:"takeControl", s:"target"}] }` com "até X sair": **já suportado** como takeControl "até sair de jogo" (verificar `until` no engine). **1:1.**

## 4. Viabilidade de conversão (conversor script, sem LLM)

### Composição do corpus keyteki (heurística sobre o texto dos 2.606 .js)
| Camada | Critério | Arquivos | % |
|---|---|---|---|
| A | zero lambdas (`=>`): `gameAction`/`effect` puros | 436 | 17% |
| B | lambdas triviais (só `cardCondition: c => c.hasHouse(..)`, `ctx => ({ target: ctx.source })`) | 1.038 | 40% |
| C | lambdas sobre `context.game`, `player.deck/hand`, `event.*`, `.filter/.some` | 1.067 | 41% |
| D | estado privado/`EventRegistrar`/métodos extras/`new Event` | 65 | 2,5% |

(58 arquivos têm métodos custom além do `setupCardAbilities`; 1.906 usam `context.` em algum ponto.)

### Mapeamento das classes de action para nossas unions **(est., ponderado por uso)**
- **1:1 direto** (~38 dos 127 nomes, mas ≈ **75–80% das ocorrências**): destroy, gainAmber, loseAmber/removeAmber, dealDamage, heal, capture, steal, discard, archive/putIntoArchives, draw, cardLastingEffect/untilPlayerTurnEnd/duringOpponentNextTurn (→ `lasting`), makeTokenCreature, exalt, returnToDeck/moveToBottom, purge, ready, exhaust, returnToHand, stun, addPowerCounter/removePowerCounter, ward/enrage, forgeKey/unforgeKey, use/fight/reap, sacrifice, discardAtRandom, gainChains, moveToFlank, putIntoPlay (parcial), transferAmber/returnAmber (→ `moveAmber`), sequential (→ `acts[]`), conditional (→ `act.if`), sequentialForEach (→ `per`), takeControl.
- **Pede lógica nova** (~25 nomes, ≈ 12–15% das ocorrências): `search` (+cardName, uniqueCardNames, shuffle), `reveal` público, `playCard`/`randomPlayCard`, `resolveAbility`, `changeActiveHouse` com casa lida, `allocateDamage/allocateCapture` (distribuir N entre alvos), `placeUnder`, `abduct`, `attach`/mover upgrade, `swap`, choose-one com N opções, `mode:'house'`/`'card-name'` como alvo, `until:{onEvento}` genérico, `duration` "até o início do SEU próximo turno", `changeEvent` genérico.
- **Sem equivalente / fora de escopo** (~64 nomes de cauda, ≈ 5–8% das ocorrências): Tide (`raiseTide`, `resetTide`), Prophecy (`fulfill/activate/flipProphecy`), contadores `doom/time/depth/disruption`, `rearrangeBattlelineAction`, `mulligan`, gigantic, `blank`, `topCardOfDeckVisible`, `skipStep` fora de ready/draw, `anotherTurn`, interrupts de evento com `postHandler`.

### Estimativa de cobertura de um conversor
Um conversor que **parseia o JS com AST (acorn/@babel/parser)** e mapeia `this.<registrador>({...})` + `ability.actions.*`/`effects.*` por tabela cobre ≈ **A (17%) + B (40%) ≈ 55–60%** do corpus keyteki com mapeamento por tabela e reconhecimento de poucos padrões de lambda (`cardCondition` com `hasHouse/hasTrait/isOnFlank/power </>`, `context.player.opponent`, `controller:'self'|'opponent'`). Chegar a **80%+** exige uma biblioteca de **~40–60 padrões de lambda** da camada C (`creaturesInPlay.filter(...)`, `deck[0]`, `event.card`, `getNeighbors`, contagens) — cada um vira um `Filter`/`Count`/`Condition` nosso. Esforço **(est.)**:
- Esqueleto (AST + tabela de actions/registradores/triggers → Ability): **3–4 dias**.
- Biblioteca de padrões de lambda (≥80%): **+6–10 dias**, iterando com diff contra o parser atual (cartas em que os dois concordam = golden set).
- Cauda D e semânticas ausentes: **não converter** — marcar `partial`/`unsupported` e cair para o fluxo atual (parser de texto + LLM).
- Validação: reaproveitar o gate triplo existente e comparar com `textHash` do MV (o texto da carta vem no `master-vault-data`, que já usamos). **Conversor ≈ 2–3 semanas para ~80% do que o keyteki implementa**; mas nosso *teto* é limitado pela DSL (≈ 75–80% das ocorrências de action cabem hoje), então a cobertura final efetiva ≈ **60–70% do corpus**, contra os 32,5% atuais do parser de texto.

### Detalhe jurídico/técnico
Código AGPL: uma tabela de mapeamento + dados DSL gerados é derivação — nosso projeto já é `AGPL-3.0-only` (header de `abilities.ts`), então consistente; a DSL gerada deve manter a atribuição ao keyteki.

## 5. Onde o keyteki é mais rico (candidatos à v11) — top 5
1. **Eventos intercept/replace genéricos (`interrupt` + `changeEvent`)**: qualquer evento (`onModifyAmber`, `onDamageApplied`, `onCardLeavesPlay`, `onCardDestroyed`…) pode ser cancelado/mutado antes de resolver. Nosso `Replacement` cobre só `destroy→zona`, `damage→redirect/prevent`. Generalizar para `{on:"gainAmber"|"steal"|…, set/amount/target}` destravaria Ether Spider, Armageddon Cloak, Evasion Sigil e dezenas de "instead".
2. **Alvos como `mode` (`select`/`house`/`card-name`/`trait`/`upTo`/`unlimited`/`mostStat`/`leastStat`) + N opções em choose-one**: escolher casa/nome/traço como *dado* usado depois por `filter`s (Deep Probe, Mimicry). Nós temos escolha de casa só como side-effect (`setHouse/forceHouse`) e choose-one de 2.
3. **`search` e `reveal` públicos** (filtro por nome/único, `exactly`, `putIntoArchives`, embaralha) — pendência #1 do WAVE2 §4; ~50 cartas diretas (20 `search`, 31 `reveal`).
4. **Duração e `until` por evento** (`untilPlayerTurnEnd`, `untilPlayerNextTurnStart`, `until:{onCardLeavesPlay}`, `lastingAbilityTrigger`): hoje nosso `duration` é `turn|next` (só "próximo turno do oponente"). Um `until` declarativo (`turnEnd` | `myNextTurnStart` | `oppNextTurnEnd` | `leaves:<ref>`) é pequeno e cobre ~170 usos.
5. **Composição de efeitos por snapshot/valor computado** (`gainAbility` 188×, `modifyPower` com lambda, Cyber-Clone, `allocateDamage/Capture`): `gainAbility` com ability citada já temos (parser), mas **valores derivados de uma carta referenciada** ("power igual ao da purgada") e **alocação de N entre alvos** ainda não. (Menções menores: Tide/Prophecy como subsistemas completos, `playCard`/`resolveAbility`.)

## 6. Onde a nossa é mais rica / diferente
- **Declarativa e serializável**: `Ability` é JSON puro (guarda no IndexedDB, versionada por `DSL_VERSION`, validada por schema triplo, auditável pela IA e pela UI de revisão). No keyteki o comportamento é *código arbitrário* — não dá para o motor/IA podar jogadas ou mostrar "cobertura".
- **Contagens/condições nomeadas** (`Count`: `did`/`gone`/`c`/`p`/`of`/`sub`/`div`, `Condition`), orçamento anti-laço de observadores, `partial` explícito e cobertura medida por carta.
- **IA/search friendly**: motor puro, `decline`/`optional` como variante de movimento, `peek` privado com log sem identidades.
- **Mais enxuta**: ~15 unions vs ~100 classes; o custo é a cauda longa.

## 7. Veredito

**VIABILIDADE: MÉDIA-ALTA (marcar como MÉDIA para planejar).** Caminho: construir um conversor **AST-based** (acorn) keyteki→DSL v10 restrito às camadas A+B (≈ 55–60%) com tabela action→union e ~40 padrões de lambda, usando o diff contra o parser atual como golden set e marcando o resto `partial`; em paralelo, abrir uma **v11 pequena** com (1) `search`/`reveal` público, (2) `mode` de alvo `house/name/trait` e choose-one N-ário, (3) `until` declarativo e (4) `Replacement` genérico de evento — o que sobe o teto de ~60–70% para ~80%.
