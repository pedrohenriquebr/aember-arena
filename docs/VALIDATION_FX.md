# Validação final — ANIMAÇÕES (ondas 1-3) + correções de áudio VAL-01..06

Validação **só por leitura de código**. Nenhum código foi alterado; o único artefato
novo é este documento. Alvo: HEAD `c3a8c92`.

- Animações: `27ae45d` (onda 1), `9e3c6b0` (onda 2), `c525727` (onda 3) e os tetos
  `0b4bfa7` / `a568a95` / `8856473`.
- Áudio: `716f7bf` (VAL-01), `a7f9462` (VAL-02), `c105534` (VAL-03), `c2dfceb` (VAL-05),
  `cc09599` (VAL-06). O VAL-04 entrou dentro de `27ae45d`.
- Referências: `docs/ANIMATIONS_PLAN.md` (plano), `docs/VALIDATION_AUDIO.md` (VAL-01..12)
  e `docs/UX_REVIEW.md` §2 #1 (contrato de UX do turno da IA).

As âncoras `arquivo:linha` apontam para o HEAD.

## Gates reexecutados nesta validação

| Gate | Resultado |
|---|---|
| `npm run build` (tsc + vite) | OK |
| `npm test` (vitest) | **127/127** specs, 7 arquivos (inclui `src/lib/fx.test.ts`) |
| `npm run e2e:bundle` | **138,77 kB** gz, dentro do teto de 139,5 kB (folga 0,73 kB) |
| `git diff 506895c HEAD -- src/lib/game.ts src/lib/ai.ts` | vazio: o motor e a IA seguem intocados (regra 2) |

`e2e:smoke`/`capture`/`floor` não foram rodados: esta missão é de leitura. Os commits
declaram esses gates como OK.

---

## VEREDITO

| Frente | Veredito |
|---|---|
| **(a) Animações** | **APROVADO COM RESSALVAS** |
| **(b) Áudio (VAL-01..06)** | **APROVADO COM RESSALVAS** |

A arquitetura segue o plano onde mais importa. O estado é commitado na hora, a
revelação é uma camada por cima, o diretor é imperativo e o portal fica no `<body>`.
Por isso **nenhum cenário de dessincronia de estado foi encontrado**: undo, aceleração e
troca de tela no meio de um voo apenas pulam para o fim.

Os problemas são de **fidelidade visual e de contrato de UX**. O mais grave é um bug de
integração (FX-01): o voo desliga em definitivo as marcas `acting`/`hit` de toda carta
que pousou. Outro é uma lacuna no ponto de maior valor do plano (FX-02): a Ação jogada
pelo Warden não aparece. As listas de "corrigir antes de fechar" estão no fim.

---

## 1. Fidelidade ao plano ANIM

| Requisito do plano | Estado | Evidência |
|---|---|---|
| `diffFx` puro e determinístico, comparando por `instanceId` | ✅ | `src/lib/fx.ts:31-54`. Os lados vão na ordem 0→1 e, dentro de cada lado, na ordem do board. Spec de determinismo em `fx.test.ts` |
| Nenhum evento dentro do `GameState` | ✅ | `fx.ts:1-4`. `game.ts`/`ai.ts` sem diff desde `506895c` |
| Diretor imperativo via `data-fx`, sem props nem memos | ✅ | `data-iid` no botão (`App.tsx:303`), `data-side` no band (`App.tsx:1086`). As marcas são escritas por `FxLayer.tsx:84,128,188`. O único estado React novo é `aiPhase`, previsto em §3 (`App.tsx:1836`) |
| Portal no `<body>`, `pointer-events: none` | ✅ | `FxLayer.tsx:266`, `index.css:5083-5088` (z 55) |
| Captura **antes** do commit e revelação no `useLayoutEffect([game])` antes do paint | ✅ | `App.tsx:1941,1952` (captura), `1981` (commit), `1992-2002` (layout effect). O prefixo síncrono do `reveal` esconde o destino no mesmo frame (`FxLayer.tsx:122-138`) |
| Guard de movimento em **todo** `element.animate` | ✅ por construção | **Não existe** `element.animate` no código (grep vazio): a coreografia é CSS. O gate JS é `motionEnabled` (`fx.ts:107-109`), usado em `App.tsx:1935` (sem plano, nada voa) e `App.tsx:2317`. Os `@keyframes` do portal caem no override global `.reduce-motion *` / `@media (prefers-reduced-motion)` (`index.css:6456-6473`), que alcança o portal porque a classe fica no `<html>` |
| `cancelAll` em commit novo / undo / troca de tela / `launchMatch` | ✅ | `commitGame` → `cancelFx` (`App.tsx:1914`), undo (`App.tsx:2037`), tela (`App.tsx:2009`), `launchMatch` (`App.tsx:2466`). Scroll/resize também cancelam (`FxLayer.tsx:118-120`, mas veja FX-05) |
| Loop da IA: cálculo antes da espera, PRE por tipo, `aiPhase`, toque acelera, opção rápida | ✅ parcial | `AI_PRE` idêntico à tabela do plano (`App.tsx:143`). O `chooseAiMove` roda antes do PRE (`App.tsx:2307-2311`). Toque: `App.tsx:2278-2284`. Rápida: `App.tsx:2267,2276`. **Faltam:** piso 0,7 para alto impacto, corte por `elapsed > 8000`, `tempo = 0` com `document.hidden`, e o `GAP` não desconta o cálculo (o `chooseAiMove` roda **depois** do `AI_GAP`, `App.tsx:2324→2307`) |
| Spotlight `acting` + `targeted` + linha de mira | ⚠️ parcial | `acting` existe (`FxLayer.tsx:80-85`, `index.css:5180-5189`). **`targeted` e a linha de mira não foram feitos.** A aura quente virou pulso de opacidade |
| Ticker de log + `aria-live` no `turn-console` | ❌ | `App.tsx:1375-1383` não tem `aria-live`. Veja FX-04 |
| §4.1 forja: glow no lado + shake, shake desligado em reduce | ✅ parcial | `FxLayer.tsx:88-96`, `index.css:5045-5068`. O dreno de gemas não foi feito. Veja FX-09 (2P) |
| §4.2 números de dano / "+N Æ" | ✅ parcial | `FxLayer.tsx:185-213`. Veja FX-06 e FX-07 |
| §4.3 morte com dissolve (clone do `.board-piece`) | ✅ parcial | `FxLayer.tsx:50-57,175-181`. **Sem FLIP das vizinhas** (FX-10) e sem fagulhas |
| §4.4 chains | ✅ parcial | `FxLayer.tsx:216-231`. Faltam o marcador `−1 ⛓` na compra e o elo partido |
| §4.5 investida da luta | ❌ | Não implementada: a luta mostra só `acting` → `hit`/números |
| FX no replay viewer (onda 3) | ❌ | O replay continua sem FX. Era baixo valor; pode ficar como pendência declarada |
| FEAT-01 (save/resume) | ✅ intacto | O commit é imediato e `saveMatch` lê `game` (`App.tsx:2162`) |
| FEAT-05 (log) | ✅ intacto | `commitGame` inalterado. O log vem do motor |
| FEAT-06 (stats) | ✅ intacto | `App.tsx:2243-2249` inalterado. A vitória nasce do estado, não da animação |
| FEAT-12 (undo/replay) | ✅ intacto | `commitWithFx` repassa o `step` a `commitGame` (`App.tsx:1981`). O undo cancela antes de `setGame(anchor)` (`App.tsx:2037-2050`) |

O `diffFx` emite `enter` e `key`, mas o App não consome nenhum dos dois. O voo usa
`move.instanceId` (`App.tsx:1940`) e a forja usa o efeito de chaves (`App.tsx:2220-2233`).
Só os testes os leem. Não é bug, são bytes ociosos.

---

## 2. Animações — achados

### FX-01 — A animação `none` inline do destino anula `acting` e `hit` para sempre naquela carta
**Severidade:** média-alta (anula metade da onda 2 e da onda 3 na prática)
**Evidência:** `FxLayer.tsx:134-135` grava `destTile.style.animation = "none"` no **botão**
`[data-iid]` da carta que pousou. O próprio comentário diz que a marca "fica inline (não
volta ao remover a marca)". As marcas posteriores vivem nesse mesmo botão:
`[data-fx="acting"] { animation: fx-pulse … }` (`index.css:5180-5184`) e
`[data-fx="hit"] { animation: fx-hit … }` (`index.css:5245-5247`). O estilo inline vence
a folha de estilo, e o React não reescreve `style` porque o `CardTile` não passa essa prop
(`App.tsx:299-304`).
**Cenário:** com animações ON, o Warden joga Troll (voo), e no turno seguinte Troll luta.
O `spot` aplica `acting`: o lift estático aparece, mas o **pulso não**. O defensor que também
entrou por voo leva dano e **não treme nem pisca**. Como toda criatura entra em jogo por um
`play`, o `hit` e o pulso só funcionam em peças montadas sem voo (animações OFF na hora da
jogada, ou depois de um remount por troca de tela). As probes de `c525727` provavelmente
usam board pré-montado, por isso não pegaram o caso.
**Correção:** não deixar `animation` inline permanente. Por exemplo, marcar o destino com
um atributo persistente que o React não gerencia (`data-landed`) e suprimir só as entradas:
`.board-piece[data-landed], .card-tile--enter[data-landed]:not([data-fx]) { animation: none }`.
Assim `[data-fx="acting"|"hit"]` voltam a valer.

### FX-02 — A carta de **Ação** jogada pelo Warden não aparece (sem ghost, sem legenda, sem pouso)
**Severidade:** alta para o contrato de UX #1 ("a carta jogada aparece grande com a legenda").
O plano chama isso de "ponto de maior valor".
**Evidência:** para o Warden, `captureFx` cai no avatar e devolve `node: cloneEl(art=null)`
= `null` (`FxLayer.tsx:40-44`). A Ação vai para o discard, então `destTile` é `null`
(`FxLayer.tsx:125`). Com isso, `content = plan.from?.node ?? cloneEl(destArt)` = `null`
(`FxLayer.tsx:158`), o ghost não nasce e a legenda (`FxLayer.tsx:164-169`) nunca é anexada.
Sobra só `step(ACTION_MS)` com `actorId` apontando para uma carta que não está no DOM
(`FxLayer.tsx:240-241`).
**Cenário:** o Warden joga "Coward's End". O jogador ouve o whoosh, vê criaturas
desvanecendo e nenhuma carta. O "Warden jogou X" não aparece.
**Correção:** para `side === 1` sem `node`, construir o conteúdo do ghost a partir do
`face` (o plano §2.1 já prevê "mesmo `CardArt` renderizado no portal"). Uma alternativa
barata: um `<img>` com a URL da arte da `face` mais a legenda.

### FX-03 — Pass-and-play: o Jogador 2 é tratado como o Warden
**Severidade:** média (texto errado + ritmo errado no 2P, FEAT-13)
**Evidência:** `commitWithFx` usa o **lado do motor** para decidir o que é "da IA".
- Legenda: `side === 1 && flight ? t("log.play", { name: t("log.warden"), … })`
  (`App.tsx:1964`). No 2P, cada jogada do Jogador 2 ganha a legenda "O Ember Warden jogou X".
- Hold: `side === 1 ? (flight ? 420 : 600)` (`App.tsx:1956`). Um humano espera o hold de
  leitura da IA.
- Aceleração: `rush = side === 1 && (rushRef.current || aiSpeed === "fast")`
  (`App.tsx:1932`). O `rushRef` só é zerado quando o loop da IA começa (`App.tsx:2283`),
  e esse effect fica dormente no 2P (`App.tsx:2256`). Um toque no último turno do Warden
  de uma partida solo deixa `rushRef = true` na partida 2P seguinte. E `aiSpeed: "fast"`
  compacta as jogadas do Jogador 2.
**Correção:** trocar `side === 1` por `const ai = side === 1 && matchModeRef.current === "solo"`
nas três expressões, e zerar `rushRef` em `launchMatch`.

### FX-04 — Nada do turno do Warden é anunciado a leitores de tela
**Severidade:** média (acessibilidade; o plano §3 exigia isso)
**Evidência:** o portal inteiro é `aria-hidden="true"` (`FxLayer.tsx:266`). Isso está
certo para os números flutuantes, mas a legenda da jogada (`FxLayer.tsx:164-169`) e o
banner "Seu turno" (`FxLayer.tsx:99-107`) também ficam lá dentro. O `turn-console`
(`App.tsx:1375-1383`) não tem `aria-live`, e o resumo `aiSummary` (`App.tsx:1383`,
`2337`) troca de texto sem região viva. O único `aria-live` do board é o do inspetor
(`App.tsx:1597`).
**Cenário:** com NVDA/VoiceOver, o turno inteiro da IA passa em silêncio. O resumo só é
lido se o usuário navegar até ele.
**Correção:** `aria-live="polite"` no `<span>` do resumo (ou no `.turn-console-copy`) e
narração da última entrada de log da IA ali, com as chaves `log.*` existentes, como o
plano desenhou. Não precisa de string nova.

### FX-05 — Qualquer `scroll` da página (inclusive clamp automático) cancela o voo
**Severidade:** média (plausível; derivado do código, não reproduzido em runtime)
**Evidência:** `window.addEventListener("scroll", onViewport, { capture: true })`
(`FxLayer.tsx:119`). Em captura, o `window` recebe o `scroll` de **qualquer** elemento
rolável, mesmo sem bubbling: `.hand-track` horizontal, o painel de log e o documento.
**Cenário:** no mobile, com a mão rolada até o fim, o jogador joga a última carta. O
conteúdo do `.hand-track` encolhe, o `scrollLeft` é clampado e o browser dispara `scroll`
no frame seguinte. O `cancelAll()` mata o voo recém-iniciado e a carta aparece seca no
slot. O mesmo vale para o documento quando a página encolhe com o usuário no fim dela, e
para o `resize` da barra de endereço do iOS.
**Correção:** reagir só ao scroll do documento (`event.target === document`) e com um
limiar (por exemplo, `|Δ scrollY| > 8px`). Scroll interno de scrollers não invalida os
rects do ghost, que é `position: fixed`.

### FX-06 — "+N Æ" some quando o outro lado também muda de âmbar (roubo do Warden)
**Severidade:** baixa-média (é justamente o dano que o jogador "precisa ver")
**Evidência:** `events.find((e) => e.kind === "amber")` pega o **primeiro** evento de âmbar,
e só depois checa `delta > 0` (`App.tsx:1943-1944`). O `diffFx` emite o lado 0 antes do
lado 1 (`fx.ts:33,43-44`).
**Cenário:** o Warden rouba 1. O lado 0 tem `-1` e vem primeiro, então `gained` fica
`undefined` e nenhum número voa. O mesmo acontece em "ganhe 1 e o oponente perde 1".
**Correção:** `events.find((e) => e.kind === "amber" && e.delta > 0)`. Ideal: um número
por lado, com o negativo no band que perdeu.

### FX-07 — O golpe letal não mostra número de dano
**Severidade:** baixa
**Evidência:** o evento `damage` só é emitido para quem continua no board de `next`
(`fx.ts:48-51`). A criatura que morre sai do board e cai só no `leave` (dissolve).
**Cenário:** numa luta 5×3, o defensor morre sem "-5", e o atacante sobrevivente mostra
"-3". O número mais importante da luta some.
**Correção:** para `leave` de criatura que levou dano ou morreu em luta, emitir o número
sobre o clone (o rect já está em `plan.gone`).

### FX-08 — Reduced-motion: a batida continua, mas a legenda e o banner somem
**Severidade:** média (contrato UX #1.6: "as batidas continuam… com destaque estático")
**Evidência:**
- Sem movimento não nasce plano (`App.tsx:1935`), e a legenda "Warden jogou X" só existe
  dentro do ghost (`FxLayer.tsx:164`). Com reduced-motion o jogador tem a pausa
  (`App.tsx:2317`) e o `acting` estático, mas **nada nomeia a carta**.
- O banner "Seu turno" é chamado fora do guard (`App.tsx:2338`, e o comentário em
  `FxLayer.tsx:98` diz que ele vale no reduce). Porém `.fx-banner` anima com `forwards`
  até `opacity: 0` (`index.css:5294-5301`), e o override global força 0,01 ms
  (`index.css:6456-6473`). Resultado: o banner é invisível em reduce/animações OFF. O
  glow da forja tem o mesmo destino (`forge-glow … both`, `index.css:5053`).
- UX §3: "Jogar carta — sem animação: um flash de pouso no slot" (e plano §2,
  `data-fx="landed"`). Não foi feito.
**Correção:** renderizar a legenda fora do ghost quando não há plano (um nó estático por
~`AI_HOLD`). No banner e no glow, usar keyframes cujo estado final seja visível, ou um
`.reduce-motion .fx-banner { animation: none; }` com remoção por timer (o timer de 900 ms
já existe).

### FX-09 — No 2P, o glow da forja nasce no lado errado da tela
**Severidade:** baixa
**Evidência:** `--forge-y` é decidido pelo lado do motor: `side === 1 ? "8%" : "88%"`
(`FxLayer.tsx:91`). No 2P o board gira para o lado ativo (`humanSide`, `App.tsx:1313-1314`,
`2404`). A forja do Jogador 2 acontece no `endTurn` do Jogador 1 (`game.ts:932-942`), quando
o Jogador 2 já está embaixo.
**Correção:** calcular pela posição real do band (`[data-side] .key-pip` →
`getBoundingClientRect().top` relativo ao board), ou receber `side === humanSide`.

### FX-10 — Morte: o clone desvanece por cima da vizinha que já deslizou (sem FLIP)
**Severidade:** baixa
**Evidência:** o comentário em `FxLayer.tsx:47-49` diz que "sem ele … as vizinhas
saltam". Só que o clone apenas cobre o rect antigo, e as sobreviventes são reposicionadas
pelo layout no mesmo commit. O FLIP das vizinhas do plano §4.3 não foi implementado.
**Cenário:** ao destruir a criatura do meio da lane, a da direita salta para o lugar dela e
o clone de 480 ms desvanece **em cima** dela.
**Correção:** o FLIP do plano (rects das sobreviventes no snapshot e `translateX(old-new)
→ 0` em 240 ms). No mínimo, `z-index` e opacidade do clone abaixo da peça viva.

### FX-11 — Última chave no `endTurn` do Warden: banner "Seu turno" + som `turn` sobre a vitória
**Severidade:** baixa
**Evidência:** o loop checa `next.winner === null` **antes** do `endTurn` (`App.tsx:2328`),
mas a forja da 3ª chave do jogador acontece **dentro** dele (`game.ts:939-942`). Mesmo com
`ended.winner === 0`, o código toca `turn` (`App.tsx:2333`), grava o resumo (`2337`) e
mostra o banner (`2338`) junto com o `win` do effect (`App.tsx:2236`).
**Correção:** `if (ended.winner === null) { sound.play("turn"); …banner }`.

### FX-12 — Transição ghost → tile real fica fora de sincronia sob carga
**Severidade:** baixa (visível em celular fraco)
**Evidência:** o `fx-slam` leva o ghost a `opacity: 0` entre 92 % e 100 %
(`index.css:5149-5157`, `forwards`). O tile real só reaparece quando o `setTimeout` do
`step(SLAM_MS)` resolve e o `finally` tira `data-fx="landing"` (`FxLayer.tsx:239,
246-249`). Se o timer atrasa (main thread ocupada), o slot fica **vazio** por alguns
frames. O plano §2-E previa o crossfade de 60 ms com o tile já visível.
**Correção:** remover `landing` no **início** do trecho final (~92 % do slam, via
`animationend`/timer mais curto) e deixar o fade do ghost cobrir a troca.

### Dessincronia — cenários pedidos

| Cenário | Resultado | Evidência |
|---|---|---|
| **Undo durante o voo** do jogador | ✅ Seguro. `cancelFx` antes do `setGame(anchor)`: o timer é limpo, o `wake` resolve o await, os nós do portal são removidos e as marcas `data-fx` também. O `alive()` falso impede o `onSlam` (sem thump fantasma). O tile de destino desmonta com o anchor | `App.tsx:2037`, `FxLayer.tsx:67-77,235` |
| **Aceleração da IA durante o próprio voo** | ✅ Sem dessincronia. O `pointerdown` chama `cancelFx()`, que corta o voo (o estado já é final) e resolve a Promise aguardada. O loop segue com `tempo = 0,45`. **Efeito colateral:** o `land` daquela jogada não soa (só houve o whoosh) | `App.tsx:2278-2282`, `2314` |
| **Pass-and-play trocando o lado no meio** | ✅ Sem dessincronia de estado. O `endTurn` passa por `commitGame` → `cancelFx` (`App.tsx:1914`), e o board só gira depois. ⚠️ Mas veja FX-03 (legenda/hold/rush) e FX-09 (glow) | — |
| Jogador rápido (2 jogadas em < 670 ms) | ✅ O novo commit cancela o voo anterior, que salta para o fim | `App.tsx:1914`, `FxLayer.tsx:258` |
| Loop da IA cancelado (troca de tela) no meio do await | ✅ `cancelFx` na troca de tela resolve a Promise, e o `if (cancelled) return` vem depois de cada await (`App.tsx:2289,2302,2312,2315,2318,2325,2330`). O `aiTurnRef` é limpo para retomar (BUG-03) | `App.tsx:2344-2351` |
| Promise do `commitWithFx` que nunca resolve | ✅ Não encontrado. Sem diretor ele resolve na hora (`App.tsx:1997-1999`). O plano pendente é resolvido por `cancelFx` (`App.tsx:1906`). O `run().then(resolve, resolve)` cobre rejeição | `App.tsx:2001` |

### Performance

- **Compositor:** voo, pulso, números e banner animam só `transform`/`opacity`. O
  `chooseAiMove` pesado roda **depois** que a Promise resolve (`App.tsx:2314→2307`), então
  não disputa frame com o voo. ✅
- **`filter` animado** em `fx-gone` (blur + brightness + grayscale, `index.css:5121-5125`)
  e em `fx-dissolve` (`5160-5166`): não é compositor-only na maioria dos GPUs móveis. Um
  board wipe clona **todas** as peças (`captureGone`, `FxLayer.tsx:50-57`), cada clone com
  a `CardArt` inteira e o `<img>`, e desfoca todas ao mesmo tempo. Em celular fraco isso
  pode travar ~480 ms. **Recomendação:** acima de ~4 clones, ou `< 701px`, trocar o blur
  por `opacity`/`scale`.
- **Vazamento de nós:** nenhum encontrado. Todo nó do run vai para `run.nodes` e é
  removido no `finally` ou no `cancelAll` (`FxLayer.tsx:74,246-253`). Os listeners de
  scroll/resize saem no `finally` (`244-245`). O banner e o `is-hit` se autolimpam por
  timer (`106`, `229`). Três pontas soltas, todas baixas: (1) `spotRef` (`acting`) fica fora
  do `cancelAll` e depende do `spot()` do loop (`App.tsx:2319`); (2) o timer do
  `forge-flash` e o do banner não são cancelados em undo/troca de tela; (3) o `-N` (700 ms,
  `index.css:5235`) é removido em `ACTION_MS = 620` (`FxLayer.tsx:23`), cortado a ~89 % já
  quase transparente.
- **Layout forçado:** o layout effect faz N× `getBoundingClientRect` e um `offsetWidth`
  (`FxLayer.tsx:93,227`) por revelação, uma vez por commit. Aceitável.

### Acessibilidade

- ✅ Números, elos, ghost e clones ficam no host `aria-hidden` (`FxLayer.tsx:266`). A
  informação real continua no badge de dano (`App.tsx` `damageLabel`), no contador e no log.
- ✅ Reduced-motion "de verdade": sem plano não há voo (`App.tsx:1935`). O CSS do portal
  cai no override global. O shake da forja tem override explícito (`index.css:5059-5062`).
  O `acting` estático (lift sem transição) é destaque, não movimento, como pede UX #1.6.
- ❌ Narração do turno da IA (FX-04) e legenda/banner sem movimento (FX-08).
- ✅ O override de seleção do `ready-breathe` foi resolvido como o plano propôs
  (`index.css:1300-1338`): aura no `::before` do tile, brilho no tile e não na
  `.card-art` (o stunned ganha).

---

## 3. VAL-01..06 — resolvidos?

| VAL | Veredito | Evidência |
|---|---|---|
| **VAL-01** fade da música sem âncora | ✅ **Resolvido** | Start: `setValueAtTime(0, now)` + rampa (`sound.ts:338-339`). Stop: `cancelScheduledValues(now)` + `setValueAtTime(gain.value, now)` + rampa a 0 (`sound.ts:364-368`). O `gain.value` é lido na mesma task JS, depois do cancel, e ainda reflete o último quantum computado, então a rampa parte do valor audível. Parar durante o fade-in também fica correto: o evento `t0+2` é cancelado e a rampa não volta a subir. Risco residual informativo: engines que não atualizam `.value` durante automação antecipariam o valor; `cancelAndHoldAtTime` seria o ideal onde existe |
| **VAL-02** timer do stop anula o gain novo | ✅ **Resolvido** | `const gain = this.musicGain` capturado antes do timer. Dentro dele, `gain?.disconnect(); if (this.musicGain === gain) this.musicGain = null` (`sound.ts:378-388`). Nas sequências stop→start→stop em < 700 ms, cada timer só toca os próprios nós (`nodesToStop`) e o próprio gain |
| **VAL-03** forja + vitória no mesmo frame | ✅ **Resolvido** | `if (game.winner === null) sound.play("forge")` (`App.tsx:2229`). O flash visual segue nos dois casos (`2230-2232`). Resta a sobreposição `turn` + `win` do FX-11 (2 vozes suaves, não embola a fanfarra) |
| **VAL-04** pouso fora do voo | ✅ **Resolvido como especificado**, com 2 ressalvas (seção 4) | O timbre foi dividido: `play` = whoosh e `land` = thump + slap (`27ae45d:src/lib/sound.ts`, `sound.ts` PALETTE). `sound.play(name, delayS)` desloca todas as vozes (`sound.ts:326`). O disparo vem do diretor no início do slam (`FxLayer.tsx:233-238` → `App.tsx:1966`) |
| **VAL-05** kick gasto em `pointerdown` de toque | ⚠️ **Parcial** | O gate `if (navigator.userActivation && !navigator.userActivation.isActive) return;` (`sound.ts:239`) resolve Chromium, Firefox e WebKit ≥ 16.4. Mas o kick existe **justamente** para o WebKit antigo, e `navigator.userActivation` só chegou no Safari 16.4. No iOS 13–16.3 a condição é falsa, o `pointerdown` de toque continua gastando o kick (`kicked = true`, `sound.ts:245`) e o retry nunca acontece. O "interrupted" do iOS também não rearma o kick. **Completar com a outra metade da recomendação original:** `context.onstatechange = () => { if (context.state !== "running") this.kicked = false; }` |
| **VAL-06** vozes acumulando com contexto suspenso | ✅ **Resolvido** (com nota) | `if (context.state !== "running" && !navigator.userActivation?.isActive) return;` (`sound.ts:320`), antes do throttle. Fora de gesto nada é enfileirado, então não há rajada fantasma. Nota: sem `userActivation` (iOS < 16.4), `!undefined` é `true` e o **primeiro** toque que retoma o contexto fica mudo (o `resume()` é assíncrono). É um preço aceitável e melhor que a rajada. A parte "menor" (incrementar `voices` só depois de `start()`, `sound.ts:299-303`) **não foi feita**: se `start()` lançar, o contador vaza uma vaga. Baixa |

Fora do escopo destes commits e **ainda abertos** (sem regressão, só registro): VAL-07
(mulligan do Warden mudo; `onPassConfirm` com `click`, `App.tsx:2363`, `3010`), VAL-08
(`discard`/`unstun`/`use` soam como `play`+`land`, `App.tsx:1974-1977`), VAL-09 (toggle
de SFX sem retorno ao ligar, `App.tsx:2827`), VAL-10/11 (τ e comentários).

---

## 4. VAL-04 na integração real

| Pergunta | Resposta | Evidência |
|---|---|---|
| O whoosh (`play`) dispara no início do voo? | ✅ Sim. Toca no `commitWithFx` antes do `commitGame`, e o ghost nasce no layout effect do mesmo render (≤ 1 frame) | `App.tsx:1975`, `1981`, `1992-2001` |
| O `land` dispara no início do SLAM? | ✅ Sim, **no início literal**: `step(PRESENT_MS + hold)` → `onSlam()`, e o CSS começa o `fx-slam` com `animation-delay: calc(260ms + var(--fx-hold))` sobre o mesmo `hold` | `FxLayer.tsx:149-151,234-238`, `index.css:5105-5106` |
| …e isso coincide com o contato visual? | ⚠️ **Não.** O `fx-slam` usa ease-in (`cubic-bezier(0.55,0,0.75,0.25)`) e a carta só chega ao slot aos **92 %** de 270 ms, ≈ **250 ms depois** do thump. A minha especificação de VAL-04 dizia "no início do SLAM", e ela foi cumprida à letra, mas o impacto audiovisual acontece no fim do trecho. **Ajuste:** `onSlam: () => sound.play("land", 0.24)` (ou disparar em `PRESENT+hold+0,92·SLAM`) | `index.css:5149-5157` |
| A velocidade rápida da IA escala o hold? | ✅ Sim, para `aiSpeed: "fast"` e para o toque antes do commit: `holdMs × 0,45` (420 → 189 ms; Ação 600 → 270 ms). O mesmo `hold` alimenta o timer JS e a `--fx-hold` do CSS, então o `land` continua no ponto certo. ⚠️ A **curva de degradação** (`tempo()` < 1 depois da 4ª ação, `App.tsx:2276`) encolhe só as batidas, não o hold do voo, que fica 420 até o fim do turno. ⚠️ Os trechos de viagem (260 + 270 ms) nunca escalam: o plano permitia até 0,7 | `App.tsx:1932,1956` |
| Toque **durante** o voo | Corta o voo inteiro (`cancelFx`). O `land` daquela carta não soa | `App.tsx:2281`, `FxLayer.tsx:235` |
| Reduced-motion mantém o som antigo (play + land em 0,15 s)? | ✅ Sim, e bit a bit. Sem plano, `flight` é `undefined`, então toca `play` e depois `land` com `delayS = 0.15`, que soma 0,15 ao `at` de cada voz. O `play` antigo tinha o thump e o slap com `at: 0.15` e o `land` novo tem `at` 0, então o resultado é idêntico. Vale também para `use`/`unstun`/`discard` com movimento ON (sem `flight`) | `App.tsx:1974-1977`, `sound.ts:326`, diff de `27ae45d:src/lib/sound.ts` |
| Casos sem pouso | ⚠️ **Ação do Warden:** há `flight` mas não há ghost (FX-02), então o `onSlam` nunca roda e o `land` **nunca soa**. Só o whoosh. **Ação do jogador:** o `land` (thump) soa no início do *dissolve* no centro, e não há mesa onde pousar. Semanticamente é discutível; sugiro não chamar `onSlam` quando `!to` | `App.tsx:1976`, `FxLayer.tsx:158,238-239` |

---

## 5. Veredito final e o que corrigir antes de fechar

### (a) Animações — **APROVADO COM RESSALVAS**

A infraestrutura (diff puro, captura pré-commit, layout effect, diretor imperativo,
portal, cancelamento) está correta e **não desincroniza estado em nenhum cenário
analisado**. As regras 1, 2, 7 e 8 foram respeitadas, e FEAT-01/05/06/12 seguem intactos.

Corrigir antes de considerar fechado:
1. **FX-01**: animação inline permanente no tile pousado anula `acting`/`hit` (`FxLayer.tsx:134-135`).
2. **FX-02**: a Ação do Warden precisa de ghost + legenda (`FxLayer.tsx:40-44,158`).
3. **FX-03**: no 2P o Jogador 2 recebe legenda do Warden, hold de IA e rush herdado (`App.tsx:1932,1956,1964`).
4. **FX-04**: `aria-live` para a narração do turno da IA (`App.tsx:1375-1383`).
5. **FX-08**: legenda e banner visíveis em reduced-motion (`App.tsx:1935`, `index.css:5294-5301`).
6. **FX-05**: scroll em captura cancela voos por clamp de scroller interno (`FxLayer.tsx:119`).

Recomendado (não bloqueia): FX-06 (âmbar do roubo), FX-07 (número letal), FX-09 (glow
2P), FX-10 (FLIP), FX-11 (banner na vitória), FX-12 (crossfade), blur em board wipe no
mobile, e os itens do plano não implementados (`targeted` + mira, investida §4.5, piso 0,7
para alto impacto, `document.hidden`, FX no replay). Estes últimos devem ser listados
como **pendências declaradas** no `CLAUDE.md`/handoff, não como feitos.

### (b) Áudio — **APROVADO COM RESSALVAS**

VAL-01, VAL-02, VAL-03 e VAL-06 estão resolvidos. VAL-04 foi resolvido como especificado,
e o reduced-motion reproduz o timbre antigo com exatidão.

Corrigir antes de considerar fechado:
1. **VAL-04b**: atrasar o `land` para o contato (`sound.play("land", 0.24)` em `App.tsx:1966`).
2. **VAL-04c**: a Ação do Warden fica sem pouso, some junto com FX-02. Na Ação do jogador, não disparar `land` no dissolve (`FxLayer.tsx:238`).
3. **VAL-05**: completar com o rearme do `kicked` em `onstatechange` (`sound.ts:231-249`), senão o fix não alcança o WebKit antigo, que é o alvo do kick.

Oportunistas: incrementar `voices` depois do `start()` (VAL-06 menor), `turn` fora da
vitória (FX-11), e VAL-07..11 do relatório anterior.

---

Nenhum código foi alterado nesta validação. O `dist/` gerado pelo build para medir o
bundle é ignorado pelo git.
