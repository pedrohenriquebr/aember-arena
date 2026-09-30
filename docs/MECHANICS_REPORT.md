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
| Tipos de ação (`Act.k`) | **21** |
| Padrões de frase reconhecidos | **28** (11 `SIMPLE` + 14 `VERBS` + 3 formas especiais) + 2 formas de condicional |
| Condições (`Condition.k`) | **4** (`amber`, `moreCreatures`, `fewerCreatures`, `not`) — o parser produz 3 |
| Keywords resolvidas pelo motor | **10** (Elusive, Taunt, Skirmish, Poison, Deploy, Alpha, Omega, Assault X, Hazardous X, Splash-attack X) |
| Pool medido | **2.603** cartas jogáveis únicas (15 sets, keyteki-json-data) |
| Efeito completo / parcial / vanilla | **134 (5,1%) / 33 (1,3%) / 2.420 (93,0%)** + **16 (0,6%) que derrubam o parser** (BUG-01) |
| Specs vitest | **77** (5 arquivos), todas verdes |

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
- `Act` (21 tipos):
  - numéricos no jogador: `gainAmber`, `loseAmber`, `steal`, `gainChains`, `draw`,
    `discardRandom`, `keyCost` (com `opp` para o oponente);
  - em cartas: `capture`, `damage`, `heal`, `destroy`, `stun`, `exhaust`, `ready`,
    `unstun`, `returnToHand`, `returnToDeck`, `archive`, `use`;
  - zonas: `fromDiscard` (opcionalmente só criatura), `archiveTop`.
- `Condition` — `amber` (eu/oponente, `eq`/`gte`), `moreCreatures`, `fewerCreatures`,
  `not` (suportado pelo motor, nunca gerado pelo parser).
- `Ability` — `{ on: Trigger[], if?, target?, acts[] }`: **um** alvo escolhido por
  ability, **uma** condição que gateia a ability inteira.
- `scripts` — tabela por título (estilo `server/game/cards/<set>/<Card>.js`) para os 4
  textos dos decks demo que são prosa de lembrete (Dust Pixie, Virtuous Works,
  Snufflegator, Ancient Bear): `null` = só ícones/keywords, cobertura `full`.

### 2.2 `keywords.ts`

- `ENGINE_KEYWORDS`: as 10 keywords que `game.ts` resolve sozinho.
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
   - `SIMPLE` (11): gain/lose/steal N amber, opponent loses N, gain N chains, draw N,
     opponent discards N random, keys cost +N during opponent's next turn, archive top
     card, return a card / a creature from discard to hand;
   - `VERBS` (14) + objeto: destroy, sacrifice, deal N (damage) to, stun, exhaust,
     ready, unstun, heal N damage from, fully heal, return … to owner's hand, put … on
     top of your deck, archive, use, *X* captures N;
   - especiais (3): `capture N amber` (criatura/upgrade), `choose a friendly creature to
     capture N`, `stun and exhaust X`;
   - condicional: `If <cond>, <frase>` e `<frase> if you control more creatures…`.
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
  contadores de poder, "instead", tokens, ward/enrage.

### 2.6 `ai.ts`

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
| Escolha de alvo | sempre automática | jogador escolhe quando há >1 alvo legal (`targetChoices`); IA busca cada alvo (`getLegalMoves` expandido) |
| IA | heurística de uma camada | busca com orçamento + camada de resposta do oponente (Hard+), poda pela especificação do motor, pode parar |

Invariantes preservadas: `game.ts`/`ai.ts` puros (clonam, nunca mutam a entrada),
`houseColor`/`houseLabel` intactos, decks demo 100% `full`, strings de log via chaves
i18n.

---

## 5. Testes (151 specs)

| Arquivo | Specs | Conteúdo |
|---|---:|---|
| `rules.test.ts` | 48 | keywords de luta (Elusive 1×/turno e reset, Taunt, Assault, Hazardous, Skirmish, Poison vs armadura, Splash-attack, array do vault), armadura por turno, Alpha/Omega/Deploy, turno (7 cartas e 1 jogada no turno 1, ready/stun, compra com chains, forja no custo atual, Lash, vitória na 3ª chave, arquivos opcionais, mavericks, jogada ilegal), abilities e alvos (captura, alvo escolhido, expansão por alvo, Dominator Bauble, Research Smoko, upgrade no hospedeiro, condição como poda da IA), mulligan/log/tallies/FEAT-12 |
| `cardText.test.ts` | 26 | prefixos de gatilho, normalização (glifos A/Æ/D, nome próprio → `this card`), condições antes/depois do efeito, all-or-nothing, gramática persistente (stats, grants, proibições, duração, ability citada), cobertura dos decks demo |
| `persistent.test.ts` | 16 | Bulwark, Grey Monk, Staunch Knight, Ember Imp e Scrambler Storm portados do keyteki 01-Core + poder/armadura efetivos na luta e na morte, Taunt concedida, duração, gainAbility, update no host, JSON-safe, arquivos opcionais |
| `cards.test.ts` | 19 | cartas antes codificadas no `if/else` (specs portados do keyteki 01-Core) |
| `match.test.ts` | 16 | partidas IA × IA com os 2 decks demo, mãos iniciais e conservação de cartas por zona, seeds, save antigo, pass-and-play |
| `ai.test.ts` | 11 | não limpa o próprio board à toa, prefere ability que resolve, só propõe jogadas legais (Taunt impressa e concedida), mulligan, arquivos opcionais |
| `fx.test.ts` / `settings.test.ts` / `houses.test.ts` | 12 / 2 / 1 | diff de FX e diretor, settings, cores/casas |

Probes da auditoria (fora do `npm test`): `e2e/probes/` — ver `BUGS_AND_FEATURES.md`.

---

## 6. Pendências (por impacto)

1. **BUG-01 — "Fully heal" derruba o parser** (16 cartas; tela branca ao importar um
   deck que tenha qualquer uma delas). Primeira coisa a corrigir.
2. **Efeitos constantes/persistentes** (1.000 cartas com texto estático; 493 só com
   isso): modificadores de poder/armadura, "gains …", "cannot …", duração "for the
   remainder of the turn". Exige uma camada de efeitos contínuos (keyteki
   `persistentEffect`/`lastingEffect`) recalculada em `keyword()`/poder efetivo.
3. **Gatilhos reativos**: `Scrap:` (59), `Interrupt:`, "After a creature is destroyed…",
   "each time…", "at the start/end of your turn" — hoje não há fila de eventos, só
   `fire` no próprio card.
4. **Gramática**: `if` além das 3 formas (170), `you may` (opcional), `for each`,
   traits ("a Mars creature"), referências anafóricas ("that creature", "it" apontando
   para o alvo), `choose` genérico, `put`/`move`/`purge`/`discard` de zonas, tokens
   (`make a token creature`), counters (`exalt`, `ward`, `enrage`, `+1 power counter`).
5. **Fidelidade de regras já identificada** (detalhes em BUGS_AND_FEATURES):
   escolha da casa não é pré-requisito para jogar (BUG-02); alvo de `Fight:`/`Before
   Fight:` sempre automático (BUG-06); `Use a creature` só colhe (BUG-11); criaturas
   Gigantic jogadas como duas criaturas independentes (BUG-23); arquivar criatura
   inimiga vai para os arquivos do dono (deveria ir para os do jogador que arquiva e
   voltar à mão do dono); `fromDiscard` sempre pega a última carta (sem escolha);
   recolher os arquivos é obrigatório (é opcional no jogo real); sem mulligan
   (FEAT-10); ícones de bônus de cartas *enhanced* do Master Vault ignorados.
6. **Condição `not`** é suportada mas nunca produzida; o parser poderia gerar `not`
   para "if … does not …" sem custo no motor.
7. **Medição contínua**: transformar `coverage.probe.ts` em relatório gerado (ex.:
   `npm run coverage:cards`) para acompanhar cada extensão da gramática.
