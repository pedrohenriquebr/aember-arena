<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Lote 11 da DSL (DSL_VERSION 11, PARSER_VERSION 11) — as mecânicas dos decks do dono

Fonte: 16 `unsupported` / 59 cartas únicas dos decks do dono (`docs/WAVE4_BACKLOG.md`, achados do farm v10).
Todas as cartas foram lidas pelo TEXTO IMPRESSO real do corpus (`scripts/harvest/*.json`), não pelo
enunciado do pedido — em vários casos o texto real é diferente (ver "Desvios"). Specs: `src/lib/dsl11.test.ts`.

Corpus (4.809 cartas): `full` 1.706 → **1.800** no parser deste lote, 0 crashes, **0 cartas rebaixadas**;
as únicas cartas cujo resultado mudou sem mudar de cobertura são os três efeitos colaterais abaixo.

## Status por grupo

| | Cartas | Forma na DSL | Semântica (`game.ts`) | Status |
|---|---|---|---|---|
| A | Duskwitch, Retrotechnician Le | `PersistentEffect.entersPlayReady: true` (+ `if` como condição) | `entersReady()` após `placeCreature` e em `makeToken`; o efeito vale para o próprio card e para os "friendly creatures" | feito (Le fica *partial*: "play a creature from your discard pile" é outra mecânica) |
| B | Helper Bot, Remote Access | `PersistentEffect.mayPlay: true \| N` (lasting, filtro de casa `!Logos`); `use { asYours: true }` | `playPermission()` abre o PLAY (nunca o descarte) fora da casa; o `N` é gasto da cópia lasting; `use` resolve Action/Omni do artefato do oponente com o lado de quem usa | feito |
| C | Seismo-entangler | `Restrict.action: "reap"`; o filtro do efeito (`target`) diz QUAIS criaturas | `restricted(…, "reap", card)` em `baseMoves` e no `use via reap`; "during your opponent's next turn" → `duration:"next"` | feito (`"artifact"` NÃO foi adicionado: já é `use` + `type:"Artifact"`) |
| D | Tantadlin, Lollop | `PersistentEffect.fightDamageCap: N`; `Replacement.when: "attacking" \| "defending"` (+ `prevent`) | `fightBody`: o corte `min(poder + attackBonus, cap)` só do ATACANTE; `dealsNoDamage()` cancela o pacote no emissor, antes de qualquer redirect (Gabos não tem o que redirecionar) | feito |
| E | The Warchest, Cybergiant Rig, Redeem | `Count { slain: Filter }`, `Count "healed"`, `heal` sem `n` | `GameState.fightDeaths` (snapshots + lado, zerado no `endTurn`); `Ctx.healed` = total curado pelo ato anterior | feito; Redeem já estava coberto (Lote 9 `gone` com filtro — I) |
| F | First Blood | `damage { divide: true, s: {pick, n:99, upTo:true}, per }` | um POOL (n × per) dividido; fila do jogador = divisão igual (o 1º leva o resto); sem fila (IA) = alocação gulosa no lado inimigo | feito (divisão livre = futuro `targets[]` com multiconjunto) |
| G | Z.Y.X. Researcher, Panpaca (Anga/Jaga) | dois `move` com `mode:"a"/"b"`; `Filter.leftOf / rightOf` | o mecanismo de `mode` do Lote 8 já servia; `beside()` = mesma battleline, índice menor/maior que a fonte | feito |
| H | Beam of Forgetting, Survey | `reveal { from, opp?, n?, pick? }`; `move.pick: "revealed"`; `peek` também grava as cartas | `Ctx.revealed`; `reveal` nomeia as cartas no log (`log.reveal`), `peek` segue só com a contagem | feito |
| I | Redeem the Crucible | `gone { trait }` (Lote 9) | — | já coberto; spec de regressão |
| J | Animating Force | — | — | **cortado**: três mecânicas (anexar a artefato, tomar controle, virar criatura 4/versatile); 1 carta |

## Desvios do pedido (e porquê)

- **`s:"revealed"` virou `move.pick:"revealed"`**: as cartas reveladas estão em zonas (mão/baralho), não na mesa;
  `s:` seleciona cartas em jogo. O padrão é o de `pick:"moved"`. O `from`/`opp` do `move` é copiado do
  `peek`/`reveal` imediatamente anterior pelo parser (órfão = não representável).
- **"Discard 1 of them" (Survey) é escolha do engine**: descarta a carta mais barata (menor âmbar + ícones). A escolha
  real do jogador espera a fila `targets[]` para zonas ocultas (mesmo corte do restante dos moves de zona).
- **`did` do heal continua contando CARTAS**: somar o total quebraria "for each creature healed this way". O total
  vive no `Count "healed"` novo (só lê o ato imediatamente anterior).
- **`heal` sem `n` = cura tudo** (era `n:99`, que o `sanityProblem` do pipeline LLM rejeitaria por `n > 20`). Linhas
  antigas com `n:99` continuam funcionando.
- **`entersPlayReady: true`** (não `true | Condition`): a condição é o `if` do próprio efeito, igual aos demais.
- **`mayPlay: true | N`**: Helper Bot diz "one" — um booleano deixaria jogar quantas quisesse. `N` é consumido da cópia
  lasting guardada (uma cópia impressa é dado compartilhado e nunca é consumida).
- **Cap de luta só do atacante** (como pede o brief). Lollop cobre o papel de defensor com `when:"defending"`.
- **The Warchest**: `Count { slain }` (novo) em vez de `gone + during`, porque `gone` lê o ato anterior e aqui não há ato.
- **Remote Access/Helper Bot/Duskwitch** têm o texto real diferente do enunciado ("one non-Logos card", "Friendly creatures
  enter play ready") — o parser cobre as duas grafias de cada uma.

## Efeitos colaterais conscientes no parser (revisados no corpus todo)

1. `Fully heal X` → `heal` sem `n` (ex.: Kaipo, Bosch, Duma, Seraphic Armor).
2. **Grants entre aspas de um Upgrade** ("This creature gains, 'Reap: capture 1'") agora leem "this creature" como a FONTE
   (a criatura que recebe), não como o `host` da própria upgrade — antes o ato `host` não achava nada na criatura
   hospedeira. Afeta Wild Spirit, Force Field, Void Shields, Observ-u-Max, Atomic Destabilizer… (spec: `dsl11.test.ts`).
3. Terrordactyl ("only deals 4 when fighting") ganha o `fightDamageCap` (a carta continua *partial* por "enters play stunned").
4. Armadilha evitada: "Keys cost +N during your opponent's next turn" continua sendo o ato `keyCost` (só o oponente);
   o "during your opponent's next turn" do Lote 11 só é lido junto de "cannot reap".

## Orçamentos e guardas

Nada novo é lido dentro de `effectivePower`: `entersPlayReady`, `mayPlay`, `fightDamageCap`, `replace.when` e `leftOf/rightOf`
são consultados em evento (jogar, lutar, legalidade), então o `readsPower` do gate não muda. `divide` não gera variantes de
fila para a IA (`queueVariants`), que usa a alocação do engine. `use` agora exaure o cartão no caminho de Action/Omni do ato
(antes só reap/fight exauriam) e um artefato usa o Omni quando não tem Action.
