# Review de código — ondas 1-4 de mecânicas (58ecd18..HEAD)

Escopo: `src/lib/game.ts`, `abilities.ts`, `cardText.ts`, `keywords.ts`, `keyforgeApi.ts`
(+ specs `*.test.ts` e os pontos de contato em `App.tsx`). Referência de semântica:
keyteki em `/tmp/keyteki` (AGPL, consulta autorizada) — `Card.js`, `DealDamageAction`,
`DestroyAction`, `ExaltAction`, `PurgeAction`, `game.takeControl`, `ForgeAction`,
`cards/01-Core/EmberImp.js`. Somente leitura: nenhum código foi alterado.

**Evidência de execução:** `npm test` → 12 arquivos, **210 testes passando** (0 falhas).
Sondas adicionais (parser rodado via `vite-node`, arquivo temporário removido):

```
Reap: You may destroy a creature. If you do, gain 2A.
 => acts: [ {destroy, optional:true}, {gainAmber 2} ]   // ability.optional NÃO é setado
```

Ressalva de método: a leitura de keyteki foi dirigida (arquivos acima), não uma varredura
de todas as cartas; onde a dúvida é de regra oficial e não do código de keyteki, está dito.

---

## 1. Corretude de regras por mecânica

| Mecânica | Veredito | Observação |
|---|---|---|
| **Ward (dano)** | ✅ fiel | `dealDamage` cancela a instância inteira antes da armadura (`game.ts:764-787`), igual `unwardAndCancel` (`DealDamageAction.js:91,140`). Redirect (Shadow Self) roda antes do ward do vizinho: coerente. |
| **Ward (destroy)** | ✅ fiel | `destroy()` consome o token e cancela (`game.ts:691-700`). |
| **Ward (demais saídas de jogo)** | ❌ **infiel** | keyteki intercepta `onCardDestroyed`, `onCardPurged` **e `onCardLeavesPlay`** (`Card.js:351-380`). Aqui `purge`, `returnToHand`, `returnToDeck` e `archive` chamam `leavePlay` direto (`game.ts:883, 957, 960, 963`) e ignoram o ward. Ver MX-01. |
| **Ward + sweep** | ⚠️ aceitável | `sweep` destrói de novo na passada seguinte (`game.ts:793-801`); só é alcançável se o ward entrar depois do dano letal ou o poder cair — caso raro, mas difere de keyteki (que cancela e deixa `moribund=false`; a criatura continua com dano letal e é re-checada, então converge igual). Sem ação. |
| **Enrage** | ✅ fiel | Só-luta "if able": fecha reap e use quando há alvo legal (`game.ts:1203-1215`), espelha `getLegalActions` (`Card.js:1317`). Token sai ao lutar (`fight`, `game.ts:1037`). Sem alvo → uso normal. |
| **Exalt** | ✅ fiel | Validado contra `ExaltAction.js` (`addToken('amber')`) e `docs/keywords.md:68` ("comporta-se como âmbar capturado"). O contador **não trava uso** — correto: o exalt de keyteki é só o token de âmbar. Volta ao oponente ao sair de jogo (`Card.js:751`) = `leavePlay` (`game.ts:653`). Spec de `zones.test.ts:150-163` cobre. |
| **Purge** | ✅ fiel | Zona própria `purged`, nunca reembaralha (`zones.test.ts:47`); âmbar capturado vai ao oponente do controlador, como em `leavePlay`. Só a lacuna do ward acima. |
| **Sacrifice** | ❌ **infiel** | Comentário em `game.ts:719-723` afirma "não é destruição, Destroyed: fica mudo". Em keyteki `sacrifice` é o **mesmo `DestroyAction`** (`DestroyAction.js:5-8`: `isSacrifice` só muda o nome/mensagem) → levanta `onCardDestroyed`, e as habilidades Destroyed: **disparam**. A onda 3 **regrediu** o comportamento antigo (`sacrifice → destroy`). Spec `zones.test.ts:65,75` fixa o comportamento errado. Ver MX-02. (Nota: o doc de keyteki diz "bypass destruction prevention", mas o código mantém o ward como interrupt; o engine cancela no ward — consistente com o código, não com o doc.) |
| **Tokens** | ✅/⚠️ | Nascem exaustos na flanco direita, nunca em deck (`leavePlay` retorna antes do push, `game.ts:676-679`). Face sintetizada de 1 de poder com a casa da fonte. Dois problemas de integração em §2. |
| **Take control** | ⚠️ | Move de battleline a battleline e dono derivado de `controlledBy` (`game.ts:912-930`) = `game.takeControl`. Desvio: keyteki **pergunta** o flanco (`game.js:1213-1229`), aqui é sempre esquerdo — documentado. Bugs de integração em §2. |
| **Forja fora do passo** | ✅ fiel | `forge()` (`game.ts:534-548`) paga do pool do próprio jogador; `free` = custo 0 (`ForgeAction.getModifier`), `mod` soma; teto de 3 chaves. Sem custo não mexe em âmbar. |
| **"Instead"** | ⚠️ | Destroy→arquivo/mão/purge sem `Destroyed:` nem crédito de kill (`game.ts:700-704`). Plausível (evento cancelado), mas **não verifiquei** contra uma carta real do keyteki de "archive it instead" (a busca em `cards/` não achou exemplo direto); tratar como suposição. Redirect ignora a exceção de traço (documentado). |
| **`cannot play more than N`** | ✅ fiel | O limite conta **jogadas**, não descartes (`state.plays`, `game.ts:1321`; `persistent.test.ts:139`). Bate com Ember Imp (`game.cardsPlayed.length > 1`, só jogadas). |

### Outros desvios de regra
- **Poder 0 sem dano não morre.** `sweep` exige `card.damage > 0` (`game.ts:797`); keyteki destrói com `power <= 0` (`game.js:~1432`). Com efeitos de `-N power` (onda 1) a criatura fica viva a 0 de poder. MX-03.
- **"If you do"** é tratado como frase incondicional (`cardText.ts:167`), o que está documentado; mas com a variante **decline** o efeito dependente ainda roda — ver MX-04.
- **Duração `"next"`** (`until = stamp + 2`, `game.ts:989-993`) só está correta para "o turno do **oponente**" (o uso real). Um texto "no **seu** próximo turno" seria expirado no início desse turno, pois o prune usa `until > stamp`. Hoje o parser só gera `next` para "on/during their next turn" — OK, mas é armadilha (MX-08).

---

## 2. Bugs de integração

1. **Tokens vazam para o `DeckInfo` retomado** — `deckFromState` (`App.tsx:230-234`) varre `board` e inclui a face sintética `Token Creature` (`id: token-N`, `image: ""`) como carta do deck. Ao retomar/recriar o DeckInfo de uma partida salva com token em jogo, o deck ganha cartas fantasma (contagem, `summarizeDeck`, W/L e rematch). MX-05.
2. **Crédito de kill com controle trocado** — `credit()` (`game.ts:1044-1048`) procura o atacante/defensor no `discard` do **controlador**, mas uma carta roubada morre no descarte do **dono** (`leavePlay`, `game.ts:648-650`). Criatura roubada que morre em luta não conta `creaturesDestroyed`. MX-06.
3. **Halves Gigantic sob criatura roubada** vão para o descarte do controlador (`game.ts:661`: `player.discard.push(half)`), não do dono — inconsistente com o resto de `leavePlay` (usa `owner`). MX-07.
4. **Undo/replay/seed — OK.** Efeitos persistentes são derivados do board a cada consulta (`activeEffects`, `game.ts:198-208`) e `lasting` é dado puro clonado em `cloneGame`; a pilha de undo guarda `GameState` completo, então não há cache de efeito para dessincronizar. `takeArchives` virou move (entra no replay, `App.tsx` ~2845) e `chooseHouse` não entrega mais o arquivo — replays antigos gravados sem `takeArchives` perderiam a pilha (aceitável; saves antigos passam por `normalizeSavedState`, `game.ts:1446-1451`, que preenche `plays`, `lasting`, `purged`). O fogo de `startOfTurn`/`endOfTurn` usa `deterministic:false` mas todo sorteio sai do PRNG semeado (`discardRandom` usa `roll(state)`), logo replay é estável. **Sem spec de undo/replay cruzando os novos efeitos** (ver §4).
5. **Purged × save/retomar (FEAT-01)** — `purged` é array de `CardInstance` (JSON-safe), clonado (`game.ts:344`) e preenchido em `normalizeSavedState`; `deckFromState` também o inclui (`App.tsx:231`). OK.
6. **Enhanced × `summarizeDeck`** — `printedAmber` soma os ícones de âmbar (`game.ts:1503`), mas capture/damage/draw não entram no resumo (correto: não são âmbar). `readBonusIcons` (`keyforgeApi.ts:48-62`) soma `amber + count("amber")`, igual à composição de `Card.bonusIcons` do keyteki (`Card.js:265-279`: impresso + enhancements). Enhancements `discard`, `power` e de casa são ignorados (documentado). A regra "ícone `amber` do payload é adicional" é suposição sobre o Master Vault; sem fixture real no repo.
7. **Tokens × Gigantic/under** — token nunca tem `under`; `leavePlay` zera `under` antes do `isToken` retornar. Sem problema.

---

## 3. Pureza e JSON-safety

- `GameState` segue 100% serializável: `lasting` (objetos planos), `tokenSerial` (número), `warded/enraged` (0/1), `controlledBy` (0/1), `purged` (array), `bonusIcons` (objeto). Spec `persistent.test.ts:191` e `setstate.test.ts:88` fazem round-trip JSON.
- `activeEffects` é determinístico: itera `board` em ordem e `lasting`, sem `Math.random`/`Date` (grep em `game.ts`/`ai.ts`/`cardText.ts`: só `createMatch` e `normalizeSavedState` usam `Math.random`, para semear — pré-existente e fora do cálculo de efeitos). `rulesOf` memoiza por identidade de `face` (`WeakMap`/`Map`), conteúdo puro.
- **Clones:** `cloneGame` copia `lasting` **rasamente** (`game.ts:346`, `[...state.lasting]`). Seguro hoje, pois os objetos de `lasting` nunca são mutados depois de criados (`run` cria novo, `endTurn` só filtra). Se alguém passar a mutar `until` in-place, contamina o undo. Sugerir `map(e => ({...e}))` por robustez (MX-09, baixa).
- `dealDamage`, `destroy`, `leavePlay` **mutam** a cópia privada; nenhuma exportada muta o argumento (`forgeKey` clona, `game.ts:551-555`). `dying` é um `WeakSet` de módulo: estado global transitório, mas esvaziado em `destroy` (`game.ts:713-714`); uma exceção entre `add` e `delete` deixaria a carta "morrendo" para sempre naquela instância (sem caminho persistente, já que o clone troca a identidade).

---

## 4. Specs

Contagem real: os arquivos novos somam **63** testes (`persistent` 16, `reactions` 11, `setstate` 25, `zones` 11), não 22. Em geral testam **comportamento** (estado final, legalidade, AI escolhendo a variante) e não detalhes internos — bom padrão, inclusive o round-trip JSON e "lido do board, não do save".

Problemas:
- **`zones.test.ts:65,75` fixam a regra errada** do sacrifice (Destroyed: mudo).
- Specs de ward cobrem dano e `destroy` (`setstate.test.ts:43-78`), **nenhum** cobre ward × `returnToHand/archive/purge`.
- Sem spec para: (a) "You may … If you do" recusado (MX-04); (b) poder efetivo 0 sem dano (MX-03); (c) take control × `creaturesDestroyed` (MX-06); (d) `deckFromState` com token em jogo (MX-05); (e) **undo e replay atravessando** efeito persistente/lasting/token/takeArchives; (f) saves antigos sem `plays/lasting/purged` via `normalizeSavedState`; (g) `forge` chamado por efeito de início de turno que já leva a 3 chaves; (h) `lasting` "next" expirando exatamente no fim do turno do oponente (há teste do Scrambler Storm, mas só uma direção); (i) ordem do `takeControl` com `under` (Gigantic).
- `readBonusIcons` tem fixture sintética; falta um payload real do Master Vault com `enhancements`.

---

## 5. Veredito por onda

| Onda | Veredito | Motivo |
|---|---|---|
| **1** — efeitos persistentes derivados | **APROVADO COM RESSALVAS** | Arquitetura sólida (derivado, puro, determinístico). Ressalva: MX-03 (poder 0) e o armadilha de duração (MX-08). |
| **2** — "you may", reações, fase | **APROVADO COM RESSALVAS** | Variante `decline` bem modelada. MX-04 (efeito dependente de "If you do" roda mesmo recusado) precisa ser corrigido antes de confiar na recusa. |
| **3** — purge, sacrifice, tokens, exalt | **APROVADO COM RESSALVAS** | Purge/exalt/tokens fiéis. Sacrifice regrediu (MX-02, alta) e tokens vazam para o DeckInfo (MX-05). |
| **4** — ward, enrage, enhanced, take control, forja, instead | **APROVADO COM RESSALVAS** | Forja, enrage, enhanced corretos. Ward incompleto (MX-01) e crédito/dono com controle trocado (MX-06/07). |

Nenhuma onda reprovada: os 210 testes passam e nenhum achado quebra o jogo, mas MX-01, 02 e 04 são desvios de regra visíveis ao jogador.

---

## Correções obrigatórias (MX)

| ID | Sev. | Evidência | Correção sugerida |
|---|---|---|---|
| **MX-01** | Alta | `game.ts:883-890, 957-966`: `purge`/`returnToHand`/`returnToDeck`/`archive` → `leavePlay` sem checar `warded`; keyteki `Card.js:351-380` intercepta `onCardPurged`/`onCardLeavesPlay`. | Checar `card.warded` (consumir e retornar) no início desses casos ou num wrapper `leaveByEffect`. Criaturas apenas. Spec por destino. |
| **MX-02** | Alta | `game.ts:719-731` (`sacrifice` pula `fire("destroyed")`); keyteki `DestroyAction.js:5-8` trata sacrifice como destroy. Spec `zones.test.ts:65,75` fixa o erro. | `sacrifice` = `destroy` (Destroyed: dispara; crédito de kill só se `by` ≠ dono, pois sacrificar o próprio não é kill). Atualizar comentário e os dois specs. |
| **MX-03** | Média | `game.ts:797`: `card.damage > 0 &&` impede morte por poder efetivo ≤ 0; keyteki destrói `power <= 0`. | Condição `effectivePower(state, card) <= 0 \|\| (damage > 0 && damage >= power)` para criaturas. Spec com `-N power`. |
| **MX-04** | Média | `cardText.ts:167` + `:230`: no probe, `destroy` fica `optional` mas `gainAmber 2` ("If you do") não; `ability.optional` não é setado → recusar ainda dá o ganho. | Propagar `optional` do clause anterior ao "If you do" (mesma ability), ou marcar as duas como opcionais. Spec recusando. |
| **MX-05** | Média | `App.tsx:230-234`: `deckFromState` inclui `board` com tokens. | Filtrar `card.isToken` (e faces de token) ao reconstruir o DeckInfo. Spec. |
| **MX-06** | Baixa | `game.ts:1044-1048`: `credit()` olha `discard` do controlador. | Usar `ownerOf` (capturar antes da luta) ou marcar a saída em `leavePlay`. Spec de take control + luta. |
| **MX-07** | Baixa | `game.ts:661`: halves sob criatura roubada vão a `player.discard`. | `owner.discard.push(half)`. |
| **MX-08** | Baixa | `game.ts:989-993`: `duration:"next"` = `stamp+2`, só vale para o turno do oponente. | Documentar no tipo `PersistentEffect.duration` ou ramificar por `who`. |
| **MX-09** | Baixa | `game.ts:346`: `lasting` clonado raso. | Clonar cada item. |
| **MX-10** | Baixa | §4: lacunas de spec (undo/replay cruzando efeitos, saves antigos, payload real de enhancements). | Adicionar os specs listados em §4. |

Incertezas assumidas: (i) regra oficial de Sacrifice é inferida do código/doc de keyteki, não do glossário impresso; (ii) "instead" sem Destroyed: não foi confirmado com carta real; (iii) semântica do campo `enhancements` no Master Vault.
