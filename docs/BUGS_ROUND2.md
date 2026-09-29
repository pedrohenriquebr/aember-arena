# BUGS_ROUND2 — segunda varredura (interações entre as features novas)

> Missão read-only. Nada aqui foi corrigido. Não repete nenhum item de
> [`BUGS_AND_FEATURES.md`](./BUGS_AND_FEATURES.md) (todos resolvidos). Um resíduo de
> correção do round 1 fica numa seção à parte, no fim.

**Base auditada:** `HEAD` = `944cde1`. Durante a auditoria outra sessão alterou o
working tree (`src/App.tsx` e `src/lib/i18n.ts` modificados, `TutorialWizard.tsx` não
versionado). Por isso **toda linha citada é de `944cde1`**, e os probes rodaram contra um
snapshot `git archive HEAD` fora do repo (`%TEMP%\b2\head`, com junction para
`node_modules`). O tutorial em andamento (WIP não commitado) está fora do escopo.

**Severidade:** alta = crash / progresso perdido / regra violada · média = comportamento
errado visível · baixa = cosmético ou raro.

## Probes (evidência executável)

Os probes ficaram fora do repo (a missão só permite criar este arquivo). O que cada um
faz e a saída real estão abaixo, então dá para recriá-los.

| Probe | Como foi rodado | O que prova |
|---|---|---|
| `engine2.probe.ts` | vitest sobre o snapshot, importando `src/lib/*` do HEAD | BUG2-03, 06, 07, 08, além dos itens "sem defeito" de replay/log |
| `fixtures.probe.ts` | vitest; gera `SavedMatch` artificiais (deck fora da biblioteca, save legado) | alimenta BUG2-04 e BUG2-08 na UI |
| `ui2.probe.mjs` | `vite build --outDir %TEMP%\b2\dist` do snapshot + servidor HTTP local em `127.0.0.1:5291` + Edge headless do sistema (`playwright-core`, como o `e2e/capture.mjs`); API do Vault mockada; service worker **habilitado** no cenário F | BUG2-01, 02, 03, 04, 05, 08, 09, 12 |

Saída do `ui2.probe.mjs` (28/09/2026):

```
A-STALE-RESUME  oldSave=3408860728/turn1/pmnull/houseBrobnar bannerAtBoot=1 newMatchSave=2033977227/turn1/pm0/housenull bannerAfterNewMatch="Resume match · round 1" confirmDialog=0 saveAfterBannerClick=3408860728/turn1/pmnull/houseBrobnar
B-REPLAY-AFTER-RESUME  homeReplayBar=1 steps="Step 0 of 6" first=[ROUND 01 hand=7 console="Choose one house"] last=[ROUND 01 hand=7 console="Choose one house"] visibleChanges=0 | live match: ROUND 02 hand=6
C-RESUME-REMOVED-DECK  heading="Dr. "The Old" Jeffries" playerBandDeck="Removed Library Deck" | stats demo=1W/0L removed=none | rematch heading="Dr. "The Old" Jeffries" band="Dr. "The Old" Jeffries"
D-LEGACY-SAVE  winner stats: Rounds 4 Amber gained NaN Amber stolen 0 Amber captured 0 Creatures destroyed 0 Cards played 0 | Seed: undefined
E-TURN1-NO-CONFIRM  before=713132965/turn1/pmnull/houseBrobnar (mulligan taken + house chosen) confirmDialog=0 after=429573464/turn1/pm0/housenull
F-ICON-PRECACHE  artCache entries=20 types={"opaque":20} storage.usage=140.4MB (caches=140.3MB)
F-CARD-ART  card_front entries by response type after rendering the board: {"opaque":7}
G-2P-HEADING  on Player 2's turn: console="Player 2's turn" heading h1="Dr. "The Old" Jeffries" bands=["Dr. \"The Old\" Jeffries","Shadowmaster Desmares"]
F-PWA-TOAST-2P  toast on Home mid-2P="New version available Reload" navTabs before=4 after reload=3 resumeBar=0 savedMatch=none
```

Saída do `engine2.probe.ts`:

```
P-AI-RNG decisions=4320 randomRate=0.385 turns(>=2 decisions)=1014 allRandom=374 noneRandom=604 mixed=36
P-AI-RNG2 aiRoll=0.647139 engineNextRoll=0.647139 (same index rngCalls+1)
P-LEGACY pendingMulligan=undefined cardsPlayed=NaN amberGained=NaN rngCalls=undefined
P-LEGACY rolls with seed/rngCalls undefined: 0,0,0,0,0
P-REPLAY-RESUME postResumeSteps=51 noopSteps=51 finalTurn=1
P-REPLAY-FULL steps=102 noopSteps=0
P-LOG matches=30 maxLogEntries=185 lostMatchStart=0 maxTurn=18 maxSteps=179 maxStateJSON=45145B replayStatesJSON(seed1)=4539955B
P-UNDO-STALE historyLen=40 anchorIsTurnStart=false anchorAmber=1 turnStartAmber=0 anchorStep=2 stepsLen=2
```

Os 112 testes existentes (`src/**/*.test.ts`) passam no snapshot.

## Índice

| ID | Sev. | Área | Título |
|---|---|---|---|
| [BUG2-01](#bug2-01) | alta | PWA × 2P | "Recarregar" do toast de atualização apaga a partida 2P (e o toast segue a partida) |
| [BUG2-02](#bug2-02) | alta | resume × FEAT-15 | O banner "Retomar partida" sobrevive a uma partida nova e a substitui sem confirmação |
| [BUG2-03](#bug2-03) | média | replay × resume | O replay de uma partida retomada aplica os passos pós-retomada ao turno 1 (100% no-op) |
| [BUG2-04](#bug2-04) | média | resume × favoritos/remoção | Retomar partida de deck removido: o DEMO_DECK assume o título, o W/L e a revanche |
| [BUG2-05](#bug2-05) | média | service worker | A correção do BUG-25 não funciona: S3 sem CORS, toda arte e os 18 emblemas ficam opacos (140 MB por 20 entradas) |
| [BUG2-06](#bug2-06) | média | IA × seed | A aleatoriedade da IA fica travada por `rngCalls`: turno inteiro aleatório ou nenhum |
| [BUG2-07](#bug2-07) | média | undo | A pilha de undo não é truncada: depois do teto, "Desfazer" cai num estado fantasma de um ramo desfeito |
| [BUG2-08](#bug2-08) | baixa | save legado | Saves de antes da FEAT-06/08 dão "NaN" nas estatísticas, "Seed: undefined" e RNG sempre 0 |
| [BUG2-09](#bug2-09) | baixa | FEAT-15 | A heurística "partida intocada" descarta o turno 1 inteiro (mulligan, casa, jogadas, turno da IA) sem confirmar |
| [BUG2-10](#bug2-10) | baixa | sync × undo/replay | O Sync no meio da partida não entra no replay e o undo reverte as faces, mas não o `currentDeck` |
| [BUG2-11](#bug2-11) | baixa | stats | O W/L grava a dificuldade/o oponente do fim da partida, não os que valeram na partida |
| [BUG2-12](#bug2-12) | baixa | 2P | O título da mesa mostra sempre o deck do Jogador 1, também no turno do Jogador 2 |
| [BUG2-13](#bug2-13) | baixa | PWA | Fechar o toast de atualização não o dispensa: ele volta a cada troca de tela |
| [BUG2-14](#bug2-14) | baixa | casas | Emblemas de Star Alliance e Saurian têm 2,3 MB cada (ícone de 20–34 px) |
| [BUG2-15](#bug2-15) | baixa | casas | Fallback offline sem distinção: Redemption e Rebels mostram o mesmo "RE" |

---

<a id="bug2-01"></a>
### BUG2-01 — "Recarregar" do toast de atualização apaga a partida 2P
- **Severidade:** alta (progresso perdido).
- **Evidência:** o toast só é suprimido quando `screen === "game" && game?.winner === null`
  (`src/App.tsx:1957-1966`). Partidas 2P nunca são salvas (`App.tsx:1944`, e
  `launchMatch` ainda apaga o save solo em `App.tsx:2195-2200`). Então, com uma partida
  2P viva em qualquer tela fora do board, o toast oferece "Recarregar", e
  `reloadForUpdate` (`App.tsx:2336-2344`) recarrega a página e perde a partida. O toast
  também é `sticky` e não é limpo ao entrar no board: aparece na Home e continua visível
  dentro da partida, solo ou 2P. No solo, o save do FEAT-01 salva o estado, mas o
  histórico de undo e a lista de replay (só em memória) se perdem.
- **Repro:** probe `F-PWA-TOAST-2P`: partida 2P (mulligans, P1 escolhe casa e passa) →
  Home → nova versão do `sw.js` publicada → toast "New version available · Reload" →
  Reload → a aba Play some (4 → 3 abas), sem banner de retomar e `savedMatch=none`.
- **Correção sugerida:** suprimir e esconder o toast enquanto houver partida viva
  (`game && game.winner === null`) em qualquer tela, ou pelo menos quando
  `matchMode === "passAndPlay"`.

<a id="bug2-02"></a>
### BUG2-02 — O banner "Retomar partida" sobrevive a uma partida nova e a substitui sem confirmação
- **Severidade:** alta (progresso perdido; contorna a FEAT-15).
- **Evidência:** `resumeMatch` é lido uma vez no mount (`App.tsx:1910-1912`) e só é
  zerado ao clicar no banner (`App.tsx:2592`) ou ao iniciar um 2P (`App.tsx:2198`).
  `launchMatch` solo não limpa o banner (`App.tsx:2178-2208`). O `onClick` do banner
  (`App.tsx:2576-2593`) troca `game` direto, sem olhar `gameRef.current` nem abrir o
  `ConfirmDialog`. O save gravado da partida nova é sobrescrito na hora pelo estado
  antigo (efeito `App.tsx:1943-1947`). Efeito colateral: a revanche da partida
  ressuscitada usa o `opponentRef` da partida nova (a retomada não o redefine).
- **Repro:** probe `A-STALE-RESUME`: jogar até escolher a casa → recarregar (banner
  aparece) → ignorar e iniciar uma partida nova pela Configuração (save passa de
  `3408860728` para `2033977227`) → Home: o banner "Resume match · round 1" continua
  lá → clicar nele: `confirmDialog=0` e o save volta a `3408860728`, a partida nova
  some.
- **Correção sugerida:** `setResumeMatch(null)` em todo `launchMatch`, e o clique no
  banner passar pelo mesmo `ConfirmDialog` da FEAT-15 quando há partida viva.

<a id="bug2-03"></a>
### BUG2-03 — O replay de uma partida retomada aplica os passos pós-retomada ao turno 1
- **Severidade:** média (errado e visível; o jogador vê um "replay" que não anda).
- **Evidência:** a retomada zera `stepsRef` (`App.tsx:2582`), mas as jogadas seguintes
  voltam a empilhar passos. `canReplay` só exige `stepsRef.current.length > 0`
  (`App.tsx:2132`), e `openReplay` reconstrói a partir de `createMatch(seed)` (turno 1,
  `pendingMulligan: 0`) e aplica esses passos (`App.tsx:2318-2327`). Como o motor recusa
  em silêncio as jogadas ilegais (`applyMove`/`chooseHouse`/`endTurn` devolvem o clone
  intacto, `game.ts:826`, `904`, `915`), todo passo vira no-op. O botão aparece na Home
  ("Replay last match", `App.tsx:2599-2603`) e no painel de vitória (`App.tsx:1460`).
  O rival também sai errado: `opponentRef` não é restaurado na retomada.
- **Repro:** probe `B-REPLAY-AFTER-RESUME`: retomar → encerrar o turno → IA joga (a
  partida viva está na rodada 02, mão 6) → Home → "Replay last match" → 6 passos e
  `visibleChanges=0`: todos mostram "ROUND 01 · hand=7 · Choose one house". Engine:
  `P-REPLAY-RESUME postResumeSteps=51 noopSteps=51`, contra `P-REPLAY-FULL noopSteps=0`.
- **Correção sugerida:** marcar a partida retomada como "sem replay" (ex.: `replayable=false`
  até a próxima `launchMatch`) em vez de testar só `stepsRef.length`.

<a id="bug2-04"></a>
### BUG2-04 — Retomar partida de deck removido: o DEMO_DECK assume o título, o W/L e a revanche
- **Severidade:** média (W/L gravado no deck errado; revanche com outro deck).
- **Evidência:** a retomada resolve o deck por
  `savedDecks.find(id) ?? DEMO_DECK` (`App.tsx:2586`). Um deck removido pela FEAT-07
  (`removeDeck`, `App.tsx:2471-2482`, cujo comentário assume que "só perde o lookup")
  ou ainda não carregado do IndexedDB (o banner aparece antes de `listCachedDecks`
  resolver, `App.tsx:1915-1937`) cai no DEMO_DECK. Daí em diante tudo usa o deck errado:
  o título (`App.tsx:2672`), `recordMatchResult(currentDeck.id, …)` (`App.tsx:2021`), a
  revanche (`App.tsx:2313`), o replay (`App.tsx:2321`) e o Sync na mesa, que busca o
  DEMO_DECK e `refreshGameFaces` renomeia o `deckName` do jogador (`App.tsx:2361-2370`).
- **Repro:** probe `C-RESUME-REMOVED-DECK` (save de "Removed Library Deck" fora da
  biblioteca): título "Dr. "The Old" Jeffries" com a faixa do jogador dizendo "Removed
  Library Deck". Na vitória, o IndexedDB tem `stats demo=1W/0L removed=none`. A revanche
  começa com o DEMO_DECK.
- **Correção sugerida:** gravar o `DeckInfo` do jogador (e do rival) no `SavedMatch`, ou
  reconstruí-lo de `game.players[0]` (`deckName` + faces), em vez de cair no DEMO_DECK.

<a id="bug2-05"></a>
### BUG2-05 — A correção do BUG-25 não funciona: S3 sem CORS, toda arte fica opaca
- **Severidade:** média (cota: 20 entradas ocupam 140 MB; o teto LRU de 300 vira ~2 GB
  contabilizados, então `pruneOldestArt` entra em ciclo e emblemas/artes offline são
  despejados).
- **Evidência:**
  1. `sw.js:189-197` tenta `mode: "cors"` com base no comentário "The S3/CDN art hosts
     send Access-Control-Allow-Origin: \*". Isso é falso: `curl -H "Origin: …"` em
     `mastervault-storage-prod.s3.amazonaws.com/media/card_front/en/341_007_…png` e em
     `/media/houses/Brobnar_RTivg44.png` responde `200` **sem** nenhum cabeçalho
     `Access-Control-*`, e o preflight `OPTIONS` dá `403`. O `fetch` CORS rejeita e cai
     no `fetch(request)` no-cors, que é opaco. O custo é uma requisição extra por arte
     não cacheada.
  2. `precacheHouseIcons` busca os 18 emblemas com `mode: "no-cors"` (`sw.js:42-43`),
     todos opacos já no install.
  3. `response.ok || response.type === "opaque"` (`sw.js:43`, `sw.js:198`) também
     grava respostas opacas de **erro** (403/5xx transitório), que são servidas
     cache-first para sempre (`sw.js:182-187`).
- **Repro:** probe `F-ICON-PRECACHE`: depois do install, `artCache entries=20
  types={"opaque":20}` e `storage.usage=140.4MB (caches=140.3MB)`. `F-CARD-ART`:
  depois de renderizar o board, `card_front … {"opaque":7}`, ou seja, nenhuma arte
  passou pelo caminho CORS.
- **Correção sugerida:** tirar a tentativa CORS (ou só usá-la em hosts que comprovadamente
  enviam ACAO), limitar as entradas opacas a um teto baixo e separado (ex.: 40) e nunca
  gravar respostas opacas vindas do fallback de erro.

<a id="bug2-06"></a>
### BUG2-06 — A aleatoriedade da IA fica travada por `rngCalls`: turno inteiro aleatório ou nenhum
- **Severidade:** média (as dificuldades Easy/Medium/Hard se comportam diferente do
  perfil; é visível em Easy).
- **Evidência:** `chooseAiMove` sorteia a partir de `state.rngCalls` sem avançá-lo
  (`src/lib/ai.ts:190-192`, cursor local para ficar pura). Entre jogadas da IA que não
  consomem RNG (jogar criatura, colher, lutar), `rngCalls` não muda, então o primeiro
  sorteio (`roll() < randomRate`, `ai.ts:192`) é **o mesmo** em todas as decisões do
  turno. O `randomRate` de 38% do Easy (por decisão) vira "38% dos turnos inteiramente
  aleatórios, 62% sem nenhuma aleatoriedade". O ruído `(roll() - 0.5) * noise`
  (`ai.ts:211`) também repete a mesma sequência por posição de candidato em cada
  decisão. E o sorteio da IA usa o mesmo índice `rngCalls + 1` que o próximo sorteio
  real do motor (`game.ts:151-154`), então a decisão "jogar aleatório" fica
  correlacionada com o próximo embaralhamento/descarte aleatório.
- **Repro:** `P-AI-RNG` (40 partidas IA×IA em Easy): 1014 turnos com ≥2 decisões, sendo
  374 totalmente aleatórios, 604 sem nenhum aleatório e só **36 mistos**. Com sorteios
  independentes a 38%, a grande maioria dos turnos seria mista. `P-AI-RNG2`:
  `aiRoll=0.647139 engineNextRoll=0.647139`.
- **Correção sugerida:** derivar o fluxo da IA de uma chave que muda por decisão (ex.:
  `seededValue(seed ^ SALT_AI, rngCalls * 1024 + acted * 32 + k)`), separada do fluxo
  do motor.

<a id="bug2-07"></a>
### BUG2-07 — A pilha de undo não é truncada: depois do teto, "Desfazer" cai num estado fantasma
- **Severidade:** média (estado de jogo que nunca existiu na linha atual; raro).
- **Evidência:** `undoLastMove` rebobina `game` e `stepsRef`, mas deixa em `historyRef`
  as entradas do ramo desfeito (`App.tsx:1817-1831`). `commitGame` só corta pela cabeça
  quando passa de `UNDO_LIMIT = 40` (`App.tsx:1797`, `121`). Quando o ciclo
  jogar/desfazer enche a pilha, o `shift` descarta a âncora real do turno e `undoInfo`
  toma `stack[0]` como âncora (`App.tsx:1810-1814`). Esse `stack[0]` pode ser um estado
  intermediário de um ramo já desfeito, com um `step` que já não corresponde a
  `stepsRef`.
- **Repro:** `P-UNDO-STALE` (réplica literal de `commitGame`/`undoInfo`/`undoLastMove`):
  3 criaturas prontas, casa escolhida, 26 ciclos de "colher A, colher B, desfazer",
  depois colher C. O Desfazer aponta para um estado com a colheita de A aplicada
  (`anchorIsTurnStart=false anchorAmber=1`, contra 0 no início do turno) e
  `anchorStep=2`. O jogador recupera C pronta **e** mantém o âmbar de A.
- **Correção sugerida:** em `undoLastMove`, truncar `historyRef` até a âncora
  (`stack.splice(anchorIndex)`), como já é feito com `stepsRef`.

<a id="bug2-08"></a>
### BUG2-08 — Saves de antes da FEAT-06/08 dão "NaN", "Seed: undefined" e RNG sempre 0
- **Severidade:** baixa (só afeta saves gravados entre `85f212a` e `4f3ff08`/`dfde2f5`).
- **Evidência:** `loadSavedMatch` não normaliza o estado (`src/lib/cache.ts:248-257`).
  Sem `seed`/`rngCalls`, `roll` produz `NaN` (`game.ts:151-154`) e
  `seededValue(undefined, NaN)` devolve **0** sempre: todo reembaralhamento vira a mesma
  permutação e `discardRandom` descarta sempre o índice 0. Com `rngCalls` = `NaN`,
  `revealsHiddenInfo` dá `true` (`NaN !== NaN`, `game.ts:956`), e o undo fica
  bloqueado para sempre depois do primeiro sorteio. Sem os contadores, `tally` produz
  `undefined + n = NaN` (`game.ts:317-319`), e o painel só protege `undefined`
  (`value ?? 0`, `App.tsx:1453`). O seed sai como "undefined" (`App.tsx:1457`).
- **Repro:** probe `D-LEGACY-SAVE` (save sem `seed/rngCalls/pendingMulligan` nem
  contadores): colher e vencer → "Amber gained **NaN**" e "Seed: **undefined**".
  `P-LEGACY`: `rolls … 0,0,0,0,0`.
- **Correção sugerida:** normalizar no `loadSavedMatch`/retomada: `seed ??= random`,
  `rngCalls ??= 0`, `pendingMulligan ??= null`, contadores `??= 0`.

<a id="bug2-09"></a>
### BUG2-09 — A heurística "partida intocada" descarta o turno 1 inteiro sem confirmar
- **Severidade:** baixa.
- **Evidência:** `startMatch`/`startPassAndPlay` só pedem confirmação se o deck mudou
  ou `current.turn > 1` (`App.tsx:2144`, `2156`). Como `turn` só avança quando o lado 0
  volta a jogar (`game.ts:933`), todo o turno 1 conta como "intocado": mulligan,
  escolha de casa, a carta jogada e o turno inteiro da IA. No 2P, trocar o deck do
  Jogador 2 ou o modo (solo ↔ 2P) também não entra na comparação.
- **Repro:** probe `E-TURN1-NO-CONFIRM`: iniciar → Mulligan → escolher casa →
  Configuração → Jogar: `confirmDialog=0`, e o save volta a `pm0/housenull` com seed
  nova.
- **Correção sugerida:** considerar intocada só a partida com `rngCalls`/`log` iguais ao
  estado criado (ex.: `log.length === 1 && pendingMulligan === 0`) e comparar deck2/modo.

<a id="bug2-10"></a>
### BUG2-10 — O Sync no meio da partida não entra no replay e o undo o desfaz pela metade
- **Severidade:** baixa.
- **Evidência:** o Sync na mesa faz `setCurrentDeck(deck)` e
  `commitGame(prev, refreshGameFaces(...))` **sem** `ReplayStep` (`App.tsx:2364-2371`).
  (1) O replay recria a partida com o `currentDeck` já sincronizado desde o turno 1
  (`App.tsx:2321`) e não mostra a entrada `log.synced`. Faces com texto/abilities
  diferentes mudam o resultado dos passos. (2) Se o Sync ocorre no meio do turno do
  jogador, o Desfazer volta a um estado anterior ao Sync: as faces e o `deckName`
  antigos voltam e o `log.synced` some, mas `currentDeck` (título, revanche, W/L) fica
  com o deck novo.
- **Repro (por código; não executado no probe):** partida → escolher casa → jogar uma
  carta → Sync (deck com texto alterado no Vault) → Desfazer: o inspetor volta ao texto antigo e o título mostra o nome novo.
- **Correção sugerida:** tratar o Sync como passo (`{kind: "sync", deck}`) e como
  âncora de undo (`revealed: true`), ou bloquear o Sync durante o turno do jogador.

<a id="bug2-11"></a>
### BUG2-11 — O W/L grava a dificuldade/o oponente do fim da partida
- **Severidade:** baixa.
- **Evidência:** `recordMatchResult` lê `settingsRef.current` no momento da vitória
  (`App.tsx:2020-2021`). A Configuração fica acessível no meio da partida (engrenagem do
  rail, `App.tsx:2754`), e uma partida retomada nunca guardou as configurações com que
  foi criada. Com `opponentMode: "deck"` apontando para um deck removido ou igual ao
  do jogador, `resolveOpponent` cai no espelho (`App.tsx:2167-2176`), mas o registro
  grava `lastOpponentMode: "deck"`.
- **Repro (por código; não executado no probe):** partida em Easy → engrenagem →
  Impossible → vencer → o registro entra em
  `byDifficulty.Impossible`.
- **Correção sugerida:** congelar `{difficulty, opponentMode efetivo}` no início da
  partida (junto do `SavedMatch`) e gravar esse valor.

<a id="bug2-12"></a>
### BUG2-12 — 2P: o título da mesa mostra sempre o deck do Jogador 1
- **Severidade:** baixa (cosmético).
- **Evidência:** `<h1>{currentDeck.name}</h1>` (`App.tsx:2672`); no 2P, `currentDeck` é
  o deck do Jogador 1 (`launchMatch`, `App.tsx:2191`), mesmo com o board girando para o
  lado ativo (`humanSideOf`, `App.tsx:155-158`).
- **Repro:** probe `G-2P-HEADING`: no turno do Jogador 2, o console diz "Player 2's
  turn", o h1 diz "Dr. "The Old" Jeffries" (deck do P1) e a faixa inferior do board
  mostra o deck do P2.
- **Correção sugerida:** no 2P, usar `game.players[humanSide].deckName` (localizado) no
  título.

<a id="bug2-13"></a>
### BUG2-13 — Fechar o toast de atualização não o dispensa
- **Severidade:** baixa.
- **Evidência:** o X do toast só faz `setToast(null)` (`App.tsx:2555`), e `updateReady`
  continua `true`. O efeito da FEAT-09 depende de `screen` (`App.tsx:1957-1966`), então
  o toast volta a cada navegação até o jogador recarregar.
- **Repro (por código; não executado no probe):** receber uma versão nova → fechar o toast → trocar de aba (Vault, Home…) →
  o toast reaparece.
- **Correção sugerida:** um estado `updateDismissed` (por sessão) setado pelo X.

<a id="bug2-14"></a>
### BUG2-14 — Emblemas de Star Alliance e Saurian têm 2,3 MB cada
- **Severidade:** baixa (tráfego/cota).
- **Evidência:** `houses.ts:92` e `houses.ts:99` apontam para `Star_Alliance.png`
  (**2.351.137 bytes**) e `Saurian.png` (**2.358.172 bytes**), contra ~6 KB dos
  emblemas originais e 12–70 KB das outras casas novas (`curl -w %{size_download}`
  nas 18 URLs, todas 200). São baixados no install do SW (`sw.js:15-49`) e renderizados
  em 20–34 px (`HouseIcon.tsx:6`).
- **Repro:** abrir o app online pela primeira vez: o install baixa ~4,7 MB só desses
  dois ícones.
- **Correção sugerida:** servir uma versão reduzida (~64 px, como já se faz com
  `Ekwidon200.png`) ou embutir um PNG/SVG pequeno no bundle.

<a id="bug2-15"></a>
### BUG2-15 — Fallback offline sem distinção: Redemption e Rebels mostram o mesmo "RE"
- **Severidade:** baixa (raro: só quando o emblema falha e só com a facção Rebels).
- **Evidência:** as casas novas não têm `glyph`, então o fallback é `short`
  (`HouseIcon.tsx:42-47`). `Redemption` e `Rebels` têm os dois `short: "RE"`
  (`houses.ts:135`, `156`). `Saurian`/`Sanctum` ("SA", `houses.ts:100`/`61`) e
  `Unfathomable`/`Untamed` ("UN", `houses.ts:107`/`81`) repetem as siglas, mas Sanctum
  e Untamed têm glyph e continuam distinguíveis. Com o BUG2-05 despejando entradas,
  o fallback fica mais provável.
- **Correção sugerida:** siglas únicas (ex.: "RD"/"RB", "SR", "UF").

---

## Investigado, sem defeito

- **undo × log × stats (FEAT-12a × 05 × 06):** o log e os contadores vivem no
  `GameState`, então o Desfazer os reverte junto (a jogada desfeita some do log).
  `recordMatchResult` só roda com vencedor (`App.tsx:2018`), e `undoInfo` recusa estado
  com vencedor (`App.tsx:1808`). O único defeito da pilha é o BUG2-07.
- **undo × mulligan/2P:** a âncora exige `activeHouse !== null` (`App.tsx:1809`), então
  estados de mulligan nunca viram âncora. `undoInfo` fixa o lado 0, mas só existe no
  solo: guarda em `App.tsx:1820` e botão oculto em `App.tsx:2732`.
- **replay × seed (FEAT-08 × 12b):** a lista completa refaz a partida exata
  (`P-REPLAY-FULL steps=102 noopSteps=0`). A IA não consome o RNG do estado (cursor
  local, `ai.ts:190`), então partida real e replay consomem o RNG na mesma ordem. Os
  no-ops existem só no caminho da retomada (BUG2-03).
- **mulligan:** a IA não decide no 2P (`App.tsx:2089`). Não há overlay duplo: o de
  mulligan some enquanto a tela de passe está aberta (`App.tsx:1394`). Save sem
  `pendingMulligan` → `undefined` → tratado como "sem mulligan pendente" (`inMulligan`,
  `App.tsx:150`); o probe D jogou normalmente.
- **2P, mão oculta:** com o passe pendente, a mão do próximo jogador nem entra no DOM
  (`App.tsx:1372`). A seleção é limpa ao passar o turno e na decisão do mulligan
  (`App.tsx:2261`, `2279`). Undo/replay ficam desligados, e o log só traz informação
  pública. A mão do lado ativo só fica visível depois do fim da partida (sem tela de
  passe quando há vencedor), o que é aceitável.
- **2P, save/stats/undo desligados de fato:** `App.tsx:1944`, `2018`, `1820`/`2732`,
  `2132`. O probe F confirmou `savedMatch=none` durante a partida 2P. `localizeName`
  cobre "Player 1/2" (`App.tsx:134-135`) nas faixas, no log, no passe e na vitória.
- **FEAT-11, deck do oponente removido/offline:** `resolveOpponent` lê a biblioteca em
  memória (vinda do IndexedDB, funciona offline) e cai no espelho de propósito. A
  revisão mostra o mesmo deck do fallback (`App.tsx:594`). O efeito colateral nos
  stats está no BUG2-11.
- **Casas "assumindo 7":** `HOUSE_ORDER`/`HOUSE_ICON_URLS` (`houses.ts:167-169`) não
  têm consumidor (export morto, removido pelo tree-shaking). `houseInfo` tem fallback
  genérico. As 7 casas novas têm chave `house.*` em en/pt-BR, e as 4 facções caem em
  `namePt`. As 18 URLs de emblema respondem 200. `DeckBrowser.tsx:215` lista 7 casas,
  mas é decorativo (`aria-hidden`).
- **Log de 400 × memória/render:** em 30 partidas IA×IA (Medium), o máximo foi 185
  entradas, e o `log.matchStart` nunca foi descartado. O agrupamento/filtro só roda com
  o painel aberto (`useMemo` com `logOpen`, `App.tsx:2109-2124`), e o rail usa
  `slice(-5)`. Estado serializado ≤ 45 KB por save, e o replay inteiro ≈ 4,5 MB de
  JSON equivalente.
- **Toast depois do reload:** sem worker em `waiting`, o toast não reaparece
  (`App.tsx:1884`).
- **i18n (HEAD):** 355 chaves em tupla `[en, pt-BR]` (paridade estrutural), nenhum
  placeholder divergente, nenhuma chave usada sem definição. As chaves `tutorial.*`
  existem só no WIP não commitado.
- **Round 1, "verificado sem defeito" (re-checado em `944cde1`):** stunned
  (`game.ts:763-767`), exausta, upgrade sem criaturas (`game.ts:676`), ability com
  alvo e campo vazio pulada (`game.ts:616`), deck/descarte vazios (`game.ts:197-207`),
  chains (`game.ts:211-215`), condição nunca satisfeita, vitória/revanche
  (`prevKeysRef` resetado em `App.tsx:2190`) e o offline continuam valendo. A revanche
  só falha após retomada, pelos BUG2-02 e BUG2-04.
- **Orçamento:** o build do HEAD mede `gzipKB=130.73` pela métrica do gate (≤ 132).

## Resíduo de correção do round 1 (não é item novo)

- **BUG-22, parcial:** o inspetor da mesa (`App.tsx:1520`) e o `DeckInspector`
  (`DeckInspector.tsx:116`, `173`) ainda usam `t(\`type.${…}\`)` sem o
  `cardTypeLabel`. Com o filtro em `normaliseCard` (`keyforgeApi.ts:55-57`) isso só
  aparece para decks gravados no IndexedDB **antes** da correção (as linhas em cache não
  são renormalizadas): o rótulo sai "type.Token Creature" e o motor ainda descarta a
  carta como Action. Correção: usar `cardTypeLabel` nos três pontos e filtrar os tipos
  também em `listCachedDecks`.

## Ranking por severidade

1. **Alta:** BUG2-01 (toast PWA apaga partida 2P), BUG2-02 (banner de retomada
   substitui partida viva sem confirmar).
2. **Média:** BUG2-03 (replay pós-retomada 100% no-op), BUG2-04 (deck removido → DEMO
   no título/W/L/revanche), BUG2-05 (S3 sem CORS, arte opaca, 140 MB), BUG2-06 (RNG da
   IA travado por turno), BUG2-07 (undo cai em estado fantasma após o teto).
3. **Baixa:** BUG2-08 (save legado: NaN/Seed undefined/RNG 0), BUG2-09 (turno 1 sem
   confirmação), BUG2-10 (Sync × undo/replay), BUG2-11 (W/L com as configurações do
   fim), BUG2-12 (título 2P), BUG2-13 (toast que não dispensa), BUG2-14 (emblemas de
   2,3 MB), BUG2-15 (sigla "RE" duplicada).
