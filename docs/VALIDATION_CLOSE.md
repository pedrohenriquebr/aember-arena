# Re-checagem de fechamento — FX e áudio

Confere os itens obrigatórios de `docs/VALIDATION_FX.md` §5 contra
`0c08a50..HEAD` (8 commits de fix). A conferência foi feita lendo o código. Nenhum código
foi alterado.

## Gates

| Gate | Resultado |
|---|---|
| `npm test` | ✅ 7 arquivos, **127/127** passando |
| `npm run build` | ✅ tipos + bundle OK |
| `npm run e2e:bundle` | ✅ **139,26 kB** gzip (teto 139,5, folga de 0,24 kB) |

## Itens

| # | Item | Estado | Evidência |
|---|---|---|---|
| 1 | **FX-01**: a animação do destino anulava `acting`/`hit` | ✅ RESOLVIDO | O `style.animation = "none"` inline saiu. No lugar entrou o atributo persistente `data-landed` (`FxLayer.tsx:178-179`). A supressão está na folha com `:not([data-fx="acting"]):not([data-fx="hit"])` (`index.css:5189-5192`). As marcas caem no `.card-tile` (`data-iid`, `App.tsx:303`), então com a marca presente a regra não casa e `fx-pulse`/`fx-hit` (`index.css:5199`, `5264`) voltam a valer. Quando a marca sai, a regra `none` volta e o `card-deal` não é replayado |
| 2 | **FX-02**: a Ação do Warden não tinha ghost nem legenda | ✅ RESOLVIDO | `FxPlan.face` (`fx.ts:74`) é preenchido só quando a origem não tem clone (`App.tsx:1975`), e `faceEl` desenha arte ou fallback (`FxLayer.tsx:41-64`). O conteúdo vem de `from.node ?? cloneEl(destArt) ?? faceEl(face)` (`FxLayer.tsx:202`). Sem `to`, o ghost é `--action` e dissolve. A legenda sai de `playCaption` (`App.tsx:1950`), que usa a carta da mão em `prev`, independente de slot |
| 3 | **FX-03**: no 2P, o Jogador 2 era tratado como o Warden | ✅ RESOLVIDO | `ai = side === 1 && matchModeRef.current === "solo"` (`App.tsx:1940`) controla o rush (`:1943`), a legenda (`:1950`) e o hold (`holdMs`, `:1978`). O `rushRef` é zerado ao iniciar uma partida (`App.tsx:2505`) e só é ligado no loop da IA solo |
| 4 | **FX-04**: o turno da IA não era anunciado | ✅ RESOLVIDO | `<span className="sr-only" aria-live="polite">` no turn-console (`App.tsx:1388-1389`). A narração é o resumo mais a última linha do Warden no log (`App.tsx:1342-1343`) e não entra no 2P. `.sr-only` (`index.css:1651-1659`). O span visível continua sendo o `:last-child` (`index.css:1644`) |
| 5 | **FX-05**: o scroll de um scroller interno cancelava o voo | ✅ RESOLVIDO | Só um evento cujo alvo é `document`/`documentElement` conta, e só cancela se o deslocamento passar de 8px desde o início (`FxLayer.tsx:156-160`). `resize` continua cancelando (`:161`). Os listeners saem no `finally` (`:289-290`) |
| 6 | **FX-08**: legenda e banner sumiam em reduced-motion | ✅ RESOLVIDO | Sem movimento, a legenda vai para `fxRef.caption()` (`App.tsx:1991-1993`), que usa `flash()` com timer de 900ms (`FxLayer.tsx:128-142`), fixa via `.fx-caption--static` (`index.css:5325-5329`). O banner continua sendo chamado sem guard (`App.tsx:2363`). O `animation: none` para `.reduce-motion` e para `@media (prefers-reduced-motion)` (`index.css:5336-5346`) zera o `animation-name`, então o `animation-duration !important` global não o apaga. O glow da forja recebeu o mesmo tratamento |
| 7 | **VAL-04b**: o `land` soava antes do contato | ✅ RESOLVIDO | `onSlam: () => sound.play("land", 0.24)` (`App.tsx:1988`). `delayS` desloca todas as vozes (`sound.ts:338`). O caminho sem voo segue com `land` a 0,15 (`App.tsx:2001`) |
| 8 | **VAL-04c**: `land` tocava sobre o dissolve | ✅ RESOLVIDO | `if (to) plan.onSlam?.()` (`FxLayer.tsx:283`). O dissolve (Ação do jogador ou do Warden) não toca pouso, só o whoosh |
| 9 | **VAL-05**: rearme do `kicked` | ✅ RESOLVIDO | `context.onstatechange = () => { if (context.state !== "running") this.kicked = false; }` fica na criação do contexto (`sound.ts:197-204`), exatamente como foi prescrito |

## Regressões e notas dos commits de fix

Nenhuma regressão bloqueante. Notas:

- **Higiene de commits (informativo):** o VAL-04b não tem commit próprio e foi junto em
  `ad68671` (FX-02). O `b8b8a64` citado no pedido não está em nenhum branch: foi reescrito
  como `7770fd4`, com a mesma mensagem.
- **FX-04, ruído leve (baixa):** o primeiro lance do jogador zera o `aiSummary`
  (`App.tsx:2542`/`2612`). Com isso o texto da região viva muda para "só a última linha
  do Warden", e o leitor de tela **repete** a última jogada do Warden. Não bloqueia.
  Sugestão: congelar a narração fora do turno da IA.
- **VAL-05, residual (baixa, só em device):** o `onstatechange` rearma quando o contexto
  **sai** de `running` (interrupção). Ele não cobre um kick gasto num `pointerdown` de
  toque enquanto o contexto nunca saiu de `suspended`, que é o caso do iOS < 16.4. Esse
  caso é mitigado pelo `resume()` em todo gesto (`sound.ts:235-236`, `touchend`
  vinculado em `:265-267`). Só dá para verificar em hardware.
- **Pré-existente, não introduzido pelos fixes (baixa):** num tile **sem**
  `data-landed` que tem `card-tile--enter`, a remoção de `acting`/`hit` devolve
  `card-deal` e replaya a entrada. Isso acontece, por exemplo, com uma criatura que já
  estava no board de uma partida retomada. Os tiles que pousaram via voo estão imunes
  pelo FX-01.
- **Pendência declarada, fora da lista obrigatória:** o "flash de pouso no slot" sem
  movimento (UX §3), citado na evidência do FX-08, não foi feito. A correção pedida
  (legenda + banner) foi entregue.

## Veredito final

- **(a) Animações: APROVADO.** FX-01, 02, 03, 04, 05 e 08 estão resolvidos no código,
  sem regressão bloqueante. Os recomendados FX-06/07/09/10/11/12 continuam como
  pendências não bloqueantes, conforme a §5 original.
- **(b) Áudio: APROVADO.** VAL-04b, VAL-04c e VAL-05 estão resolvidos, e VAL-01/02/03/06
  seguem intactos.

**PRONTO PARA FECHAR.**
