# MECHANICS_REPORT — motor de abilities portado do keyteki

Estado do motor de regras do Aember Arena depois da missão keyteki
(`24917d9 feat(engine)`, `938168d feat(ui)`, `b7a2dfe test(engine)`). Este documento
descreve **o código atual** (`src/lib/abilities.ts`, `keywords.ts`, `cardText.ts`,
`game.ts`, `ai.ts`), a cobertura medida sobre o pool real de cartas, as mudanças de
regra feitas para ficar fiel ao KeyForge e o que ainda falta. Defeitos encontrados
na auditoria estão em [`BUGS_AND_FEATURES.md`](./BUGS_AND_FEATURES.md) (IDs `BUG-xx`
citados abaixo).

---

## 1. Resumo

| Item | Valor |
|---|---|
| Gatilhos de engine | **7** (`play`, `reap`, `fight`, `beforeFight`, `destroyed`, `action`, `omni`) a partir de **9** grafias impressas |
| Tipos de ação (`Act.k`) | **32** (onda 4: +ward, removeWard, enrage, removeEnrage, takeControl, forgeKey, unforgeKey) |
| Padrões de frase reconhecidos | **42** (16 `SIMPLE` + 21 `VERBS` + 3 formas especiais) + 2 formas de condicional |
| Condições (`Condition.k`) | **4** (`amber`, `moreCreatures`, `fewerCreatures`, `not`) — o parser produz 3 |
| Keywords resolvidas pelo motor | **12** (Elusive, Taunt, Skirmish, Poison, Deploy, Alpha, Omega, Assault X, Hazardous X, Splash-attack X, Exalt, Ward) |
| Pool medido | **2.603** cartas jogáveis únicas (15 sets, keyteki-json-data) — última medição na onda 3 (`KF_DATA` ausente nesta máquina) |
| Efeito completo / parcial / vanilla | **134 (5,1%) / 33 (1,3%) / 2.420 (93,0%)** + **16 (0,6%) que derrubam o parser** (BUG-01) — idem, medido na onda 3 |
| Specs vitest | **209** (12 arquivos), todas verdes |

Leitura honesta: o motor novo é **correto no que afirma cobrir** (all-or-nothing por
ability, selo de cobertura visível), mas cobre uma fatia pequena do pool real. Os dois
decks demo são 100% jogáveis; um deck importado do Master Vault tem em média ~2 das
36 cartas com texto simulado. As keywords e as regras de turno/combate valem para
**todas** as cartas, vanilla ou não.

---

## 2. Arquitetura

```
CardFace (Master Vault / demo)
   │
   ▼
rulesOf(face)  ── abilities.ts, memo WeakMap<CardFace, CardRules>
   ├── scripts[title]          (4 entradas: textos-paráfrase dos decks demo → null)
   └── parseCardText(face)     cardText.ts
          ├── normalise()      ícones <A>/<D> → "amber"/"damage", lembretes (…) fora
          ├── PREFIX split     "Play:", "Reap:", "After Fight/After Reap:", "Scrap:"…
          ├── printedKeywords  keywords.ts (array do vault > frases iniciais do texto)
          └── parseAbility     frase a frase; ability só entra se TODAS parsearem
   ▼
CardRules { abilities: Ability[], keywords: Keywords, coverage }
   │
   ├── game.ts  (intérprete puro: fire → run(act) → sweep)
   ├── ai.ts    (poda por moveHasEffect/canResolve — a mesma especificação)
   └── UI       (CoverageBadge no inspetor e no lightbox)
```

### 2.1 `abilities.ts` — modelo declarativo

Abilities são **dados**, no espírito de `Card.js`/`CardAbility.js`/`GameActions/*` do
keyteki, mas sem classes: o mesmo objeto alimenta motor, IA e selo de cobertura.

- `Trigger` — `play | reap | fight | beforeFight | destroyed | action | omni`.
- `Filter` — `type` (Creature/Artifact), `side` (friendly/enemy, relativo ao
  controlador), `damaged`, `flank`, `other`, `ready`, `top` (N mais fortes).
- `Selection` — quem a ação afeta: `self`, `host` (criatura do upgrade), `target`,
  `targetAndNeighbors`, `neighborsOfFought`, `{ each: Filter }`.
- `Act` (25 tipos):
  - numéricos no jogador: `gainAmber`, `loseAmber`, `steal`, `gainChains`, `draw`,
    `discardRandom`, `keyCost` (com `opp` para o oponente);
  - em cartas: `capture`, `damage`, `heal`, `exalt` (Onda 3: âmbar da reserva
    comum no alvo), `destroy`, `purge` (Onda 3: sai de jogo para `purged`),
    `sacrifice` (Onda 3: descarte do dono, sem `Destroyed:`), `stun`, `exhaust`,
    `ready`, `unstun`, `returnToHand`, `returnToDeck`, `archive`, `use`;
  - zonas: `fromDiscard` (opcionalmente só criatura), `archiveTop`;
  - tokens: `makeToken` (Onda 3: face sintética na battleline, nunca no deck).
- `Condition` — `amber` (eu/oponente, `eq`/`gte`), `moreCreatures`, `fewerCreatures`,
  `not` (suportado pelo motor, nunca gerado pelo parser).
- `Ability` — `{ on: Trigger[], if?, target?, acts[] }`: **um** alvo escolhido por
  ability, **uma** condição que gateia a ability inteira.
- `scripts` — tabela por título (estilo `server/game/cards/<set>/<Card>.js`) para os 4
  textos dos decks demo que são prosa de lembrete (Dust Pixie, Virtuous Works,
  Snufflegator, Ancient Bear): `null` = só ícones/keywords, cobertura `full`.

### 2.2 `keywords.ts`

- `ENGINE_KEYWORDS`: as 12 keywords que `game.ts` resolve sozinho.
- `readKeyword("assault:2" | "Assault 2" | "Elusive")` → `[nome, valor]` (valor 1 por
  padrão; hífens/travessões normalizados para `splash-attack`).
- `printedKeywords(face, header)`: usa o array `keywords` do vault quando existe e
  **não é vazio**; senão lê as frases iniciais do `card_text` ("Elusive. Skirmish.").
  Frases de keyword não contam como "não entendidas" para a cobertura.

### 2.3 `cardText.ts` — parser de `card_text`

Sem NLP: gramática fixa.

1. **`normalise`**: `\u000b`→`\n`, remove parênteses (texto de lembrete), `3<A>`/`3A`
   → `3 amber`, `2<D>`/`2D` → `2 damage`, `Æmber`→`amber`, aspas curvas → retas,
   minúsculas, espaços colapsados.
2. **Segmentação por `PREFIX`**: reconhece `play|reap|fight|destroyed|omni|action|scrap|interrupt|after …|before …`
   e combinações com `/`. O que vem antes do primeiro prefixo é o *header*
   (keywords + texto constante).
3. **`TRIGGERS`** (9 grafias → 7 gatilhos): `play`, `reap`, `fight`, `after fight`→`fight`,
   `after reap`→`reap`, `before fight`→`beforeFight`, `destroyed`, `action`, `omni`.
   Prefixos sem gatilho de engine (`Scrap:`, `Interrupt:`, `After you …:`) são
   reconhecidos só para **não vazarem** para a ability anterior — contam como não
   entendidos.
4. **Frases** (`body.split(/\.\s*/)`), cada uma precisa casar com:
   - `SIMPLE` (16): gain/lose/steal N amber, opponent loses N, gain N chains, draw N,
     opponent discards N random, keys cost +N during opponent's next turn, archive top
     card, make/create (a|N) token creature(s), return a card / a creature from discard
     to hand, `forge (a|another) key at current|no cost|+N cost`, `unforge an
     opponent's key`;
   - `VERBS` (21) + objeto: destroy, sacrifice, purge, exalt (… twice), deal N (damage)
     to, stun, exhaust, ready, unstun, heal N damage from, fully heal, return … to
     owner's hand, put … on top of your deck, archive, use, *X* captures N, ward X,
     remove ward from X, enrage X, remove enrage from X, take/gain control of X;
   - especiais (3): `capture N amber` (criatura/upgrade), `choose a friendly creature to
     capture N`, `stun and exhaust X`;
   - condicional: `If <cond>, <frase>`, `<frase> if you control more creatures…` e
     `If you do, <frase>` (o `then` do keyteki; ver §2.7).
5. **`parseObject`**: `this card/this creature/itself/it` (→ `host` em upgrade), `a
   creature and each of its neighbors`, `each neighbor of the creature this card
   fights`, `the N most powerful creatures`, e
   `(a|an|each)( other)?( friendly|enemy)?( damaged|undamaged|ready)? (creature|artifact)s?( on a flank| that is not on a flank)?`.
6. **All-or-nothing**: uma frase não entendida descarta a ability inteira; um segundo
   alvo ou uma condição que não esteja na primeira frase também descarta (não dá para
   expressar com um `if`/`target` por ability). O nome da própria carta vira `this
   card` antes do parse.
7. **Cobertura**: `full` se nada ficou sem entender (inclui cartas só com keywords),
   `vanilla` se nenhuma ability entrou, `partial` caso contrário. O motor **nunca**
   meio-resolve uma ability. O header também aceita a gramática persistente (§2.5):
   uma frase constante entendida conta como entendida e vira `effects[]` no
   `CardRules`, sem passar pelo `Trigger`.

### 2.4 `game.ts` — intérprete

API pura (`applyMove`, `chooseHouse`, `endTurn` clonam e devolvem estado novo);
helpers só mutam o clone privado.

- **`fire(state, me, source, trigger, {fought, choice})`**: para cada ability com o
  gatilho, checa `if` (`holds`), resolve o alvo (`everyMatch` + escolha do jogador
  via `move.target`, senão `autoPick`), executa `acts` em ordem.
- **`autoPick`** (auto-target estilo keyteki): efeito nocivo → inimigo mais forte, senão
  o aliado mais fraco (alvo é obrigatório); efeito benéfico → aliado mais forte.
- **`run(act)`** + **`sweep`** após cada ação: destrói criaturas com dano ≥ poder ou
  envenenadas; `dying` evita dupla destruição enquanto `Destroyed:` resolve.
- **`destroy`** dispara `destroyed` ainda em jogo e só então `leavePlay` (âmbar
  capturado volta ao oponente, upgrades anexados vão ao descarte, estado zerado).
- **Legalidade única** (`baseMoves`): usada por `getLegalMoves` (UI/IA, expandido por
  alvo), `isLegalMove` (guarda de `applyMove`) e `targetChoices` (prompt da UI).
- **`moveHasEffect` / `canResolve`**: a IA poda jogadas cujo texto não pode resolver
  (condição falsa, nenhum alvo), com fallback para `play` se nada sobrar.

### 2.5 Efeitos persistentes (onda 1, `docs/ROADMAP_REVIEW.md` §3)

Camada que destrava as ~1.000 cartas de texto constante. Efeitos de texto constante
**não são armazenados**: `activeEffects(state, side)` deriva a lista do board a cada
consulta (o motor clona o estado a cada move), lendo `rulesOf(face).effects` de cada
carta em jogo — o selo de cobertura e o inspetor acompanham via `rulesOf`, sem código
próprio. `GameState.lasting` guarda só as cópias disparadas com duração (dado JSON-safe).

- **Gramática persistente** (`cardText.ts`, header e corpos de efeito):
  - `<sujeito> gets ±N power|armor [and ±N …] [while it is on a flank]` — sujeitos:
    `this creature`/`this card` (self, `host` em upgrade), `each [other] friendly|enemy
    [flank] creature(s)` / `artifact(s)`, `each of <carta>'s neighbors`;
  - `<sujeito> gains <keyword>` (as 10 do motor) e `gains '<ability citada>'`: o texto
    entre aspas é mascarado antes do scan de prefixos (um `Reap:` interno não parte a
    frase) e re-parseado pelo MESMO parser; a ability concedida dispara pelo mesmo `fire`;
  - `(you|your opponent) cannot play|use|fight …` — `more than N cards each turn`
    (orçamento), `action|creature|artifact|upgrade cards`, `any cards`,
    `creatures to fight`;
  - duração no fim (ou início) da frase: `for the remainder of the turn`, `on their
    next turn`/`during their next turn`; `each turn` é constante.
- **Leitura efetiva** (`game.ts`): `effectivePower`, `effectiveArmor`,
  `keyword(state, card, name)` e `abilitiesOf` somam/agregam os modificadores ativos;
  luta, dano, armadura, morte por poder, `autoPick`, o filtro `top` e a avaliação da IA
  usam esses valores em vez de `face.power`/`face.armor` impressos.
- **Proibições**: `canPlay`, `canUseCard`, `fightTargets` e `baseMoves` consultam o
  `Restrict` ativo; o teto de jogadas usa `GameState.plays` (só cartas jogadas —
  descarte não conta, como no keyteki).
- **Duração**: cada efeito disparado vira dado puro em `GameState.lasting` com o stamp
  `turn × 2 + activePlayer` em que expira (`endTurn` poda); "remainder" morre no fim do
  turno, "next turn" vale só no turno seguinte do oponente (keyteki
  `untilPlayerTurnEnd` / `duringOpponentNextTurn`).
- **Fora da onda** (documentado no `GAME_ROADMAP`): `bonusFightDamage` (Valdr),
  contadores de poder, "instead", wards/enrage. Tokens saíram da lista na onda 3.

### 2.6 Verbos de zona e tokens (onda 3, `docs/ROADMAP_REVIEW.md` §3)

Fecha o grupo "verbos de zona": quatro tipos de ação novos, todos dados puros
(JSON-safe) e sem UI própria.

- **Purge** (`purged`): novo destino de `leavePlay` — a carta sai de jogo para
  `GamePlayer.purged` e **não** entra em descarte/mão/deck/arquivos; como só o
  descarte é reembaralhado (`draw`), o purgado nunca volta. Não é destruição:
  não dispara `Destroyed:` nem credita abate (keyteki `PurgeAction`, zona própria).
  Âmbar capturado na criatura volta ao oponente, como em qualquer saída de jogo.
- **Sacrifice**: verbo próprio (`Act.k = "sacrifice"`) separado de `destroy`.
  Vai direto ao descarte do dono **sem** a janela de `Destroyed:` (keyteki usa o
  mesmo `DestroyAction` com `isSacrifice`; aqui a semântica de regra exposta é
  "sacrificada ≠ destruída"). O BUG-10 ("Sacrifice X. Destroy um artefato.") foi
  reancorado no novo verbo.
- **Tokens** (`makeToken`): "Make/Create (a|N) token creature(s)" cria a
  instância direto na battleline, exausta, com face sintética (título
  `Token Creature`, casa da carta de origem, poder 1, traits `Token`) e
  `isToken: true` na instância. Token não é carta de deck: sai de jogo sem
  entrar em nenhuma zona (não pode ser comprado nem reembaralhado) e o abate em
  luta continua contando (FEAT-06). `GameState.tokenSerial` dá ids determinísticos.
- **Exalt** (`exalt`): contador de âmbar colocado na criatura **vindo da reserva
  comum** (keyteki `ExaltAction`; `docs/keywords.md` §Exalt). Comporta-se como
  âmbar capturado: volta ao oponente quando a criatura sai de jogo. A keyword
  impressa é reconhecida para cobertura, mas o motor só resolve o verbo
  ("Exalt <carta> [twice]") — não há cláusula de "não pode ser usada".

### 2.7 Estado de set (onda 4, `docs/ROADMAP_REVIEW.md` §3)

Tokens e mecânicas que dependem do conjunto (WoE+), todas em dados primitivos da
instância (JSON-safe) e sem UI própria.

- **Ward** (39 cartas): keyword nova no `ENGINE_KEYWORDS` (reconhecida para cobertura,
  como `exalt`) + `CardInstance.warded`. O token **não empilha** (`Card.ward()` do
  keyteki é no-op se já houver ward). O primeiro `destroy`/`sacrifice` consome o token
  e a destruição é cancelada — sem `Destroyed:`, sem crédito de abate — e o primeiro
  **dano** consome o token e é cancelado **inteiro** (não só o letal), antes da
  armadura e do veneno (`DealDamageAction.unwardAndCancel`, que cancela o evento de
  dano). Uma criatura warded com dano letal **já existente** morre no `sweep`
  seguinte: o keyteki reavalia o game state depois de cancelar a destruição. Ações
  `ward`/`removeWard` na gramática. **Fora do escopo:** o interrupt do keyteki também
  cancela `onCardPurged`/`onCardLeavesPlay` (purge, volta para a mão…), que a onda
  não cobre.
- **Enrage** (32 cartas): `CardInstance.enraged` + ações `enrage`/`removeEnrage`. Uma
  criatura enraivecida que **pode** lutar só luta (`effects.mustFightIfAble` em
  `Card.getLegalActions`: reap e Action/Omni ficam fechados; o unstun continua, como
  no keyteki, porque uma criatura atordoada não pode lutar). Sem alvo legal de luta,
  ela é usada normalmente ("if able"). O token sai quando ela luta
  (`ResolveFightAction` → `unenrage`).
- **Enhanced / ícones de bônus** (86 cartas): `CardFace.bonusIcons`
  `{ amber, capture?, damage?, draw? }` — o `amber` é o total impresso (o array
  `enhancements` do Master Vault pode somar ícones de âmbar) e substitui `amber`
  quando existe. `normaliseCard` lê `enhancements` (o array do keyteki: `amber`,
  `capture`, `damage`, `draw`, `discard`, `power` ou casa). No play o motor aplica os
  ícones extras (`ResolveBonusIconsAction`): capture 1 âmbar num aliado escolhido
  automaticamente, 1 dano num alvo automático e 1 compra por ícone. **Fora do
  escopo:** `discard`, `power` e enhancements de casa (a cura "any icon" de cartas
  como Amphora Captura também).
- **Take control** (48 cartas): `CardInstance.controlledBy`. Fiel ao keyteki, a carta
  **muda de battleline** (`game.takeControl`/`finalizeTakeControl` tira a carta de
  `cardsInPlay` do controlador e a insere na do novo controlador), no **flanco
  esquerdo** — o keyteki pergunta o flanco; aqui vale o default do prompt automático.
  Ao sair de jogo ela vai para a **pilha do dono**, não a do controlador
  (`player.moveCard`: `card.owner.moveCard(...)`), e o marcador é limpo quando o dono
  retoma o controle. Âmbar capturado continua voltando ao oponente de quem controla.
  A IA respeita a troca de graça: a legalidade (`fightTargets`) só enxerga a
  battleline do oponente, então ninguém luta contra a própria criatura. **Fora do
  escopo:** "While under your control it belongs to house X" e efeitos que fixam o
  flanco/posição (`takeControlOn…`).
- **Forjar/desforjar fora do passo de chave** (64 cartas): `forge()` é o núcleo único
  do passo de chave e das ações `forgeKey` (`at current cost`, `at no cost`, `at +N
  cost`) e `unforgeKey` (sempre a chave do oponente, como todo texto impresso);
  `forgeKey()` puro é exportado para efeitos. Forjar fora de fase paga do pool e pode
  vencer (3ª chave), como em `player.forgeKey`.
- **"Instead"** (~95 cartas, subconjunto suportado): `PersistentEffect.replace`,
  consultado por `destroy`/`sacrifice`/`dealDamage` antes do comportamento padrão.
  Formas suportadas:
  `If this creature would be destroyed, archive/hand/deck/purge it instead.`
  (destroy → outra zona, sem `Destroyed:`);
  `When a creature would enter a discard pile from play, it is purged instead.`
  (Annihilation Ritual, efeito de board que vale para qualquer criatura);
  `Damage dealt to [non-<trait>] neighbors is dealt to this creature instead.`
  (Shadow Self: o dano vai para a fonte do efeito, com armor/ward dela; o alvo
  original não gasta ward). **Fora do escopo:** os "instead" condicionais ("If the
  tide is high, X instead"), a exceção de trait do redirect (o filtro não tem trait) e
  substituições de âmbar/compra.
- **Gramática nova:** `if you do, X` (o `then` do keyteki; como o motor resolve os
  atos de uma ability em ordem e sem resultado por ato, a continuação resolve sempre —
  uma primeira cláusula que não fez nada ainda deixa a segunda acontecer),
  `each of this card's neighbors`, `take/gain control of X`, `ward/enrage X` e
  `remove ward|enrage from X`. **Fora do escopo:** alvo contado ("Ward 2 friendly
  creatures") precisa de escolha múltipla no move, que não existe.

### 2.8 `ai.ts`

Busca em profundidade limitada (1–6 plies por dificuldade + `thinkingDepth`), orçamento
de nós (`700 + 250·depth`), ordenação por avaliação, `branchLimit` por perfil, camada
de resposta do oponente (`reply`) em Hard+, e "parar" sempre é opção (não força jogada
ruim). A avaliação ainda é heurística de board/âmbar/chaves — não lê as `conditions`
do motor (ver FEAT-03).

---

## 3. Cobertura alcançada

### 3.1 Metodologia

- Fonte: `keyteki-json-data` (um JSON por set: AoA, AS, CC, CotA, DM, DT, GR, MG2024,
  MM, MoMu, PV, ToC, VM25, WC, WoE), deduplicado pelo `id` (slug) → **2.603** cartas
  jogáveis únicas (Action/Creature/Artifact/Upgrade). O texto do keyteki é o mesmo
  `card_text` do Master Vault com pequenas variações de ícone (`2<D>`, `2D`, `2`), todas
  cobertas por `normalise`.
- Reproduzir: `KF_DATA=<pasta com os JSON> npx vitest run --config e2e/probes/vitest.config.ts coverage`
  (`e2e/probes/coverage.probe.ts`; pulado sem `KF_DATA` — os dados não são vendorizados).
- Números abaixo medidos em 2026-09-28 sobre `HEAD` (`5f16eb5`).

### 3.2 Totais

| Cobertura | Cartas | % |
|---|---:|---:|
| `full` | 134 | 5,1% |
| — com ≥1 ability simulada | 107 | |
| — só keywords (ex.: "Taunt.") | 27 | |
| `partial` | 33 | 1,3% |
| `vanilla` | 2.420 | 93,0% |
| **parser lança exceção** (BUG-01) | 16 | 0,6% |

Cartas com ≥1 ability simulada: **140** (107 full + 33 partial), somando **143**
abilities.

> Nota (2026-09-30): a onda 1 de efeitos persistentes (§2.5) roda por cima desta
> medição, mas o pool **não foi re-medido** (`KF_DATA` ausente nesta máquina). Nos
> decks demo, Bulwark, Grey Monk, Staunch Knight, Ember Imp e Scrambler Storm saíram
> de `partial`/`vanilla` para `full` (58 cartas distintas: 35/2/21 → **40/1/17**).
>
> Nota (2026-09-30, onda 3): purge/sacrifice/tokens/exalt (§2.6) também rodam por
> cima da tabela; a estimativa no proxy keyteki está no §3.5. O snapshot dos decks
> demo segue **40 full / 1 partial / 17 vanilla** (nenhuma carta demo usa os verbos
> novos).

### 3.3 Por tipo

| Tipo | full | partial | vanilla |
|---|---:|---:|---:|
| Creature | 87 | 27 | 1.199 |
| Action | 27 | 1 | 774 |
| Artifact | 20 | 3 | 304 |
| Upgrade | 0 | 2 | 143 |

Por set (atribuição ao primeiro pack em ordem alfabética quando há reimpressão, logo
indicativo): CotA 45 full / 6 partial, AoA 44 / 5, DT 10 / 1, MG2024 9 / 1, WC 8 / 2,
MM 6 / 4 — os sets de 2019 concentram a cobertura porque a gramática foi escrita a
partir dos specs `01-Core` do keyteki; sets recentes (GR, ToC, VM25, MoMu) têm 0–1.

### 3.4 Uso de gatilhos e ações no pool

Gatilhos: `play` 59 · `reap` 28 · `action` 21 · `fight` 20 · `omni` 9 · `destroyed` 7 ·
`beforeFight` 5.

Ações: `destroy` 24 · `damage` 22 · `steal` 16 · `capture` 14 · `stun` 11 · `draw` 9 ·
`discardRandom` 9 · `gainAmber` 8 · `fromDiscard` 7 · `returnToHand` 6 · `archiveTop` 5 ·
`exhaust` 5 · `loseAmber` 4 · `gainChains` 4 · `heal` 4 · `archive` 3 · `ready` 2 ·
`keyCost`/`use`/`returnToDeck`/`unstun` 1 cada.

### 3.5 Por que 93% é vanilla

Das 2.453 cartas não-`full`:

- **1.000** têm texto constante no header (efeitos estáticos: "Each friendly creature
  gets +1 power", "This creature gains…", "You cannot…"); **493** têm *só* isso — nenhum
  gatilho sem suporte, só não há modelo de efeito persistente.
- **1.942** têm ao menos uma ability com gatilho suportado cujo corpo não parseia. Os
  primeiros tokens mais comuns dos corpos rejeitados: `if` 170 (condições fora das 3
  formas), `destroy` 144 / `deal` 134 (objetos fora da gramática: traits, "for each",
  "that creature"), `you` 132 ("you may…"), `choose` 124, `discard` 94, `put` 82, `for`
  75 ("for each…"), `make` 73 (tokens), `move` 71, `steal` 65, `gain` 64, `each` 56,
  `capture` 54, `ready` 49, `return` 47, `purge` 45, `archive` 41, `exalt` 39.
- **60** usam gatilho sem suporte: `Scrap:` 59, `After you …:` 1.

**Onda 3 (30/09):** `make`/`purge`/`exalt` saíram dos primeiros tokens rejeitados
(`sacrifice` deixou de ser alias de `destroy`), mas o pool não foi re-medido
(`KF_DATA` ausente). Medição proxy equivalente — as 2.607 classes keyteki do
parágrafo anterior, com os comentários impressos de cada arquivo passados pelo
**parser real**, arquivo a arquivo:

| Mecânica | Classes que usam (proxy) | Com frase que o parser agora entende |
|---|---:|---:|
| `make`/`create … token creature` | 112 (o pool fala 124 cartas) | **34** (30%) |
| `exalt <objeto> [twice]` | 106 | **17** (16%) |
| `sacrifice <objeto>` | 27 (o pool fala 36) | **9** (33%) |
| `purge <objeto de mesa>` | 117 (o pool fala 119) | **1** (<1%) |

O purge é o caso extremo: o destino `purged` está fechado no motor, mas o alvo
real quase sempre vem de **outra zona** ("purge a card from your discard pile",
"purge a card from your hand", 16+ ocorrências) ou com condição de poder/trait
("a creature with power 3 or lower", "each friendly Shadows creature"). A
cobertura de purge no pool só cresce quando o parser aprender a escolher a zona
de origem e traits (§6.4). Os números de `make`/`exalt`/`sacrifice` são menores
que os tokens brutos acima porque o parser é all-or-nothing por ability: a frase
principal entende, mas a segunda frase (condição/"for each") derruba a ability
inteira.

---

## 4. Mudanças de regras para fidelidade ao KeyForge

Comparação do motor anterior (`24917d9^:src/lib/game.ts`, 502 linhas, efeitos em
`if/else` por título) com o atual.

| Regra | Antes | Agora (fonte keyteki) |
|---|---|---|
| Efeitos de carta | tabela `if/else` por título (~20 cartas) | abilities declarativas parseadas do `card_text` + selo de cobertura |
| Armadura | somada ao poder como vida permanente (`damage ≥ power + armor`) | absorve dano **uma vez por turno**, reseta no fim do turno (`DealDamageAction`/`armorUsed`) |
| Mão inicial | 6 e 6 | 1º jogador abre com **7**, o 2º com 6 (`setupphase`) |
| 1º turno | sem restrição | 1º jogador só joga **ou** descarta **uma** carta |
| Compra | completa até 6, ignora chains | até 6 **menos a penalidade de chains** (1–6→1, 7–12→2…), perde 1 chain ao comprar (`DrawAction`) |
| Ordem do fim de turno | readiness no início do turno de quem joga | **ready → draw** no fim do turno de quem terminou (`ReadyPhase` + `DrawPhase`) |
| Stun | removido automaticamente no início do turno | permanece até a criatura ser **usada**; o uso só remove o stun (`RemoveStunAction`) |
| Custo da chave | fixo 6 | **6 + modificadores** (Lash of Broken Dreams +3 no próximo turno do oponente), forja obrigatória na etapa de chave |
| Alvos de luta | qualquer criatura inimiga | respeita **Taunt** (vizinhos de taunt protegidos) |
| Keywords | nenhuma | 10 keywords resolvidas (§2.2), inclusive Assault/Hazardous antes do dano, Elusive 1×/turno, Skirmish, Poison, Splash-attack, Deploy em slot, Alpha/Omega |
| Mavericks | jogáveis com **qualquer** casa ativa | só com a casa impressa no maverick (a casa em `face.house`) |
| Capturas | não existiam | âmbar fica na criatura e volta ao oponente quando ela sai de jogo |
| Arquivos | não existiam | `archives` por jogador, recolhidos por opção (`takeArchives`, regra do "may") |
| Upgrades | iam para o board soltos | anexados a um hospedeiro, descartados quando ele sai (ver BUG-04 para o caso do hospedeiro inimigo) |
| Descarte | não existia | jogada `discard` da mão (casa ativa) |
| Purge (onda 3) | não existia | destino `purged` próprio: a carta sai do jogo e não volta no reembaralhamento (keyteki `PurgeAction`) |
| Sacrifice (onda 3) | alias de `destroy` (disparava `Destroyed:`) | verbo próprio: descarte do dono **sem** `Destroyed:` e sem crédito de abate (keyteki `DestroyAction` com `isSacrifice`) |
| Tokens (onda 3) | não existiam | "Make a token creature" cria a instância direto na battleline (face sintética, `isToken`); morre sem entrar em zona nenhuma (keyteki `MakeTokenCreatureAction`) |
| Exalt (onda 3) | não existia | âmbar da reserva comum colocado no alvo; comporta-se como capturado ao sair de jogo (keyteki `ExaltAction`, `docs/keywords.md` §Exalt) |
| Ward (onda 4) | não existia | token que não empilha: o primeiro destroy/dano consome e é prevenido (keyteki `WardAction`, `DealDamageAction.unwardAndCancel`) |
| Enrage (onda 4) | não existia | token que força a luta no uso enquanto houver alvo legal; sai quando a criatura luta (keyteki `effects.mustFightIfAble`, `ResolveFightAction`) |
| Ícones de bônus (onda 4) | só `amber` impresso | `bonusIcons` lidos de `enhancements` do Master Vault e resolvidos no play (capture/damage/draw além do âmbar; keyteki `ResolveBonusIconsAction`) |
| Take control (onda 4) | não existia | a carta muda de battleline (flanco esquerdo) e volta à pilha do **dono** ao sair de jogo (keyteki `game.takeControl`/`player.moveCard`) |
| Forja fora de fase (onda 4) | só o passo de chave | `forgeKey`/`unforgeKey` pagam/tiram a chave fora do passo, inclusive "at no cost"/"+N cost" (keyteki `ForgeAction`/`UnforgeAction`) |
| "Instead" (onda 4) | não existia | destroy → archive/hand/deck/purge e dano redirecionado (keyteki `DestroyAction`/`DealDamageAction` replacements; ver §2.7) |
| Escolha de alvo | sempre automática | jogador escolhe quando há >1 alvo legal (`targetChoices`); IA busca cada alvo (`getLegalMoves` expandido) |
| IA | heurística de uma camada | busca com orçamento + camada de resposta do oponente (Hard+), poda pela especificação do motor, pode parar |

Invariantes preservadas: `game.ts`/`ai.ts` puros (clonam, nunca mutam a entrada),
`houseColor`/`houseLabel` intactos, decks demo 100% `full`, strings de log via chaves
i18n.

---

## 5. Testes (209 specs)

| Arquivo | Specs | Conteúdo |
|---|---:|---|
| `rules.test.ts` | 48 | keywords de luta (Elusive 1×/turno e reset, Taunt, Assault, Hazardous, Skirmish, Poison vs armadura, Splash-attack, array do vault), armadura por turno, Alpha/Omega/Deploy, turno (7 cartas e 1 jogada no turno 1, ready/stun, compra com chains, forja no custo atual, Lash, vitória na 3ª chave, arquivos opcionais, mavericks, jogada ilegal), abilities e alvos (captura, alvo escolhido, expansão por alvo, Dominator Bauble, Research Smoko, upgrade no hospedeiro, condição como poda da IA), mulligan/log/tallies/FEAT-12 |
| `cardText.test.ts` | 38 | prefixos de gatilho, normalização (glifos A/Æ/D, nome próprio → `this card`), condições antes/depois do efeito, all-or-nothing, gramática persistente (stats, grants, proibições, duração, ability citada) e das ondas 3 (purge/sacrifice/exalt como verbos separados, tokens make/create) e 4 (`if you do`, ward/enrage/take control), cobertura dos decks demo |
| `setstate.test.ts` | 24 | onda 4: ward (dano cancelado inteiro, destroy em wipe, vizinhos do Old Egad, JSON-safe, keyword), enrage (luta forçada e token removido, "hits the other side", "if able"), enhanced (capture/damage/draw no play, `enhancements` do payload), take control (muda de battleline, ninguém luta contra o que controla, volta pro dono, dono retoma), forja/desforja fora de fase (Key Charge com "may", no cost + vitória, +N, unforge, `forgeKey()` puro) e "instead" (Shadow Self, Annihilation Ritual, destroy → archive) |
| `persistent.test.ts` | 16 | Bulwark, Grey Monk, Staunch Knight, Ember Imp e Scrambler Storm portados do keyteki 01-Core + poder/armadura efetivos na luta e na morte, Taunt concedida, duração, gainAbility, update no host, JSON-safe, arquivos opcionais |
| `zones.test.ts` | 11 | onda 3: purge (sai do jogo, não volta no reembaralhamento, `Destroyed:` silencioso), sacrifice (descarte do dono sem `Destroyed:`, âmbar capturado volta), tokens (nasce na mesa com a casa da fonte, morre fora das zonas, JSON-safe) e exalt (reserva comum, "twice", âmbar ao oponente na saída, não bloqueia uso, keyword reconhecida) |
| `reactions.test.ts` | 11 | onda 2: "You may" opcional com variante decline, reações `After X:`/`Each time X:` e gatilhos de fase |
| `cards.test.ts` | 19 | cartas antes codificadas no `if/else` (specs portados do keyteki 01-Core) |
| `match.test.ts` | 16 | partidas IA × IA com os 2 decks demo, mãos iniciais e conservação de cartas por zona, seeds, save antigo, pass-and-play |
| `ai.test.ts` | 11 | não limpa o próprio board à toa, prefere ability que resolve, só propõe jogadas legais (Taunt impressa e concedida), mulligan, arquivos opcionais |
| `fx.test.ts` / `settings.test.ts` / `houses.test.ts` | 12 / 2 / 1 | diff de FX e diretor, settings, cores/casas |

Probes da auditoria (fora do `npm test`): `e2e/probes/` — ver `BUGS_AND_FEATURES.md`.

---

## 6. Pendências (por impacto)

1. **BUG-01 — "Fully heal" derruba o parser** (16 cartas; tela branca ao importar um
   deck que tenha qualquer uma delas). Primeira coisa a corrigir.
2. **Efeitos constantes/persistentes** — **feito na onda 1** (§2.5): stats, grants,
   proibições e duração. Continua fora a cauda de efeitos: `bonusFightDamage`
   (Valdr) e contadores de poder.
3. **Gatilhos reativos**: `After …`/`Each time …`/início e fim de turno **fechados na
   onda 2**; seguem sem suporte `Scrap:` (59 — precisa de descarte como custo),
   `Interrupt:` e watchers globais ("each time you …"), que pedem um barramento de
   eventos em vez do `fire` preso à fonte.
4. **Gramática**: `if` além das 3 formas (170), `for each`, traits ("a Mars
   creature" — hoje também limita purge/sacrifice/exalt a objetos sem trait),
   referências anafóricas ("that creature", "it" apontando para o alvo), `choose`
   genérico, `put`/`move` de zonas, **seleção da zona de origem**
   (`purge`/`discard`/`search` de descarte/mão/deck — a onda 3 fechou só o alvo de
   mesa: o destino `purged` existe, mas 116 dos 117 arquivos proxy de purge miram
   outra zona) e **alvo contado** ("Ward 2 friendly creatures", "Destroy 2
   creatures" — precisa de escolha múltipla no move, que não existe). Counters
   `ward`/`enrage` e tokens (`make a token creature`) e `exalt` **saíram da lista
   nas ondas 3/4**; `+1 power counter` continua fora. A onda 4 também fechou
   `if you do, …` (o `then` do keyteki), `take/gain control of X`, `ward/enrage X`
   e `remove ward|enrage from X`.
5. **Fidelidade de regras já identificada** (detalhes em BUGS_AND_FEATURES):
   escolha da casa não é pré-requisito para jogar (BUG-02); alvo de `Fight:`/`Before
   Fight:` sempre automático (BUG-06); `Use a creature` só colhe (BUG-11); criaturas
   Gigantic jogadas como duas criaturas independentes (BUG-23); arquivar criatura
   inimiga vai para os arquivos do dono (deveria ir para os do jogador que arquiva e
   voltar à mão do dono); `fromDiscard` sempre pega a última carta (sem escolha);
   recolher os arquivos é obrigatório (é opcional no jogo real); sem mulligan
   (FEAT-10). **Ícones de bônus de cartas *enhanced* fecharam na onda 4** (só
   `discard`/`power`/enhancements de casa ficam fora; a seleção manual do alvo do
   ícone é automática, como todo auto-target do motor).
6. **Condição `not`** é suportada mas nunca produzida; o parser poderia gerar `not`
   para "if … does not …" sem custo no motor.
7. **Medição contínua**: transformar `coverage.probe.ts` em relatório gerado (ex.:
   `npm run coverage:cards`) para acompanhar cada extensão da gramática.

### 6.1 Fechado na onda 4 (estado de set, §2.7)

- **Ward** (39 cartas) e **Enrage** (32): tokens na instância, destruição/dano
  prevenidos e luta forçada na legalidade (§2.7). Fica fora o interrupt de
  `onCardPurged`/`onCardLeavesPlay` do keyteki (ward contra purge/volta para a mão).
- **Enhanced/ícones impressos** (86): `bonusIcons` + `enhancements` do Master Vault,
  resolvidos no play.
- **Take control** (48): `controlledBy` com a carta mudando de battleline e voltando
  à pilha do dono; fora do escopo as cláusulas de casa ("belongs to house X") e a
  escolha de flanco/posição.
- **Forjar/desforjar fora do passo de chave** (64): `forge()` compartilhado +
  `forgeKey()` exportado; `forgeKey`/`unforgeKey` na gramática.
- **"Instead"** (~95, subconjunto): destroy → archive/hand/deck/purge, discard →
  purge (Annihilation Ritual) e dano redirecionado (Shadow Self). Os "instead"
  condicionais ("If the tide is high, X instead") **não** são substituições e seguem
  de fora, assim como âmbar/compra substituídos.
- **Não coberto da onda 4**: Tide (83), Haunted (85), contadores de poder (+1 power
  counter) e seleção de zona de origem.
