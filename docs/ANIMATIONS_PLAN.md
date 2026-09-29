# Plano de Animações "estilo Arena" — Aember Arena (set 2026)

Plano técnico **read-only**: nenhum código foi alterado. Objetivo: tirar a partida do
"seco" atual e chegar ao *feel* do MTG Arena — carta que voa e se apresenta, oponente
com ritmo legível, impacto físico em luta/forja/morte.

**Base lida:** `CLAUDE.md`, `docs/POLISH_REPORT.md`, `git log -40`, `src/App.tsx`,
`src/index.css`, `src/lib/game.ts`, `src/lib/ai.ts`, `src/lib/sound.ts`.

**Referência de linhas:** todas as âncoras `arquivo:linha` apontam para o commit
**`944cde1`** (HEAD). A working copy tem WIP não commitado do tutorial em `src/App.tsx`
(+26 linhas: ~+1 a partir da l.79, ~+11 perto da l.1098, ~+13 a partir da l.2040) —
use `git show 944cde1:src/App.tsx` ou busque pelo símbolo citado.

**Já existe e NÃO é re-proposto:** dica com contorno dourado + ✦ (FEAT-04), log
filtrável (FEAT-05), undo (FEAT-12a), replay (FEAT-12b), mulligan (FEAT-10), stats
(FEAT-06), pass-and-play (FEAT-13), `forge-flash` radial de 700ms, pip de chave com
`key-forge`, `count-pop` do âmbar, `ready-breathe` nas peças prontas, `card-deal` /
`card-arrive` na montagem de tiles, e o toggle global `reduce-motion`.

---

## 0. Restrições que moldam tudo

| Restrição | Consequência no desenho |
|---|---|
| Motor puro, clona a cada move (`game.ts:294` `cloneGame`, `applyMove` em `game.ts:824-898`) — regra 2 do CLAUDE.md | **Nenhum evento novo dentro do `GameState`.** Os efeitos são *derivados* do diff `prev → next`, que o App já tem nas mãos em `commitGame` (`App.tsx:1794-1801`). |
| O estado é commitado **imediatamente** (undo, log, stats, save e replay leem `game`) | Animação é **camada visual sobre um estado já final**. Nunca atrasar o `commitGame`; atrasar apenas a *revelação* do DOM de destino. Undo/log/stats/save ficam intactos por construção. |
| `CardTile`/`BoardLane`/`PlayerBand` memoizados por valor (`App.tsx:224-239`, `1069-1085`, `979-995`) | Destaques transitórios (carta agindo, pouso, dano) **não passam por props**: um diretor de FX imperativo escreve `data-fx="…"` no nó via `[data-iid]`. React não gerencia esse atributo, então re-renders não o apagam e nenhum memo é invalidado. (Não usar `classList.add`: quando o `className` do tile muda — ex. `is-selected` — o React reescreve a string inteira e a classe injetada some.) |
| `.game-board { overflow: hidden }` (`index.css:719`) | Tudo que voa (carta, números, partículas) vive num **portal no `<body>`** com `position: fixed`, como já fazem zoom/lightbox (`CardArt.tsx:207, 260`). |
| Toggle `reduce-motion` é CSS (`index.css:6137-6155`) — **não alcança Web Animations API** | Todo `element.animate()` passa por um guard JS: `motionOn = settings.animations && !matchMedia('(prefers-reduced-motion: reduce)').matches`. Sem isso o voo ignoraria o toggle. |
| Bundle: teto 132 kB gz, **sem folga** (regra 7) | Sem biblioteca de animação; WAAPI + CSS puro. Estimativa: onda 1 ≈ +1,2 kB gz, onda 2 ≈ +1,5 kB, onda 3 ≈ +1,3 kB. **Cada onda exige revisão explícita do teto** (ex.: 132 → 133,5 → 135 → 136,5) com a justificativa no CLAUDE.md, ou compensação equivalente. |
| Sem novas strings sem `t()` (regra 5) | Números flutuantes são `aria-hidden`; a narração acessível reusa as chaves `log.*` já existentes (`i18n.ts:259-261…`). O plano não exige chave nova (opcional: `game.wardenTurn`). |
| Animar só `transform`/`opacity`/`filter` | O `chooseAiMove` é síncrono e pesado (budget de nós em `ai.ts:198-200`); animações de compositor continuam fluidas mesmo com a main thread ocupada. `box-shadow` animado só em elementos pequenos e poucos. |

### Infra comum (base das 3 ondas)

1. **`data-iid` no botão do tile** — `CardTile` (`App.tsx:262-272`) ganha
   `data-iid={card.instanceId}`. É derivado de `card`, já comparado no memo; custo zero.
   Idem `data-side` no `PlayerBand` (`App.tsx:1008`) para achar avatar/âmbar/chaves.
2. **`src/lib/fx.ts` (puro)** — `diffFx(prev, next, move?): FxEvent[]`:
   - `enter` (instanceId saiu da mão / apareceu no board), `leave` (sumiu do board e
     está no discard/mão/deck/arquivo do dono),
   - `damage {id, amount}` (`damage` subiu), `heal`,
   - `amber {side, delta}`, `capture {id, delta}`, `key {side}`, `chains {side, delta}`,
   - `exhaust {id}` (`ready: true → false` sem sair de jogo), `stun {id}`.
   Tudo comparando por `instanceId` — os ids sobrevivem ao clone e à troca de zona
   (`placeCreature` faz `splice` do mesmo objeto clonado, `game.ts:816-822`).
3. **`src/components/FxLayer.tsx`** — portal no `<body>`, `pointer-events: none`,
   `z-index` acima do board e abaixo de modais. Expõe via ref um diretor:
   `fx.run(events, snapshot): Promise<void>` e `fx.cancelAll()`.
4. **Ponto de captura** — novo helper no App, `commitWithFx(prev, next, step, move)`:
   1. `events = diffFx(prev, next, move)`;
   2. **antes** do `setGame`: `snapshot = captureRects(events)` — `getBoundingClientRect`
      dos `[data-iid]` envolvidos (origem na mão, peças que vão morrer) e
      `cloneNode(true)` só das peças que vão sair do board (ninguém mais poderá
      desenhá-las depois do commit);
   3. `commitGame(prev, next, step)` (inalterado);
   4. `useLayoutEffect` no App disparado por `game` — roda **depois** do DOM novo e
      **antes** do paint: esconde os destinos (`data-fx="landing"` → `visibility:
      hidden`), mede os rects de destino e chama `fx.run`.
   `performHumanMove` (`App.tsx:2212-2228`) e o loop da IA (`App.tsx:2058-2061`) trocam
   `commitGame` por `commitWithFx`. `undoLastMove` (`App.tsx:1817-1831`), mulligan e
   `launchMatch` continuam no `commitGame`/`setGame` puro e chamam `fx.cancelAll()`.
5. **Cancelamento** — qualquer commit novo, undo, troca de tela ou `launchMatch` chama
   `cancelAll()`: `anim.finish()` em tudo, remove ghosts, limpa todo `data-fx`. O
   estado já está certo, então "pular" a animação nunca desincroniza nada.
6. **Replay viewer** (`App.tsx:2842`, board `readOnly`) — sem FX na onda 1–2; o diff
   é o mesmo, então habilitar depois é só chamar `diffFx` entre `states[i-1]` e
   `states[i]`.

---

## 1. Seleção com glow

**Problema atual:** `.card-tile.is-selected .card-art` (`index.css:1300-1303`) é uma
borda/sombra dourada — mesma família do contorno de dica `.card-tile--hint`
(`index.css:6253-6268`). Pior: numa peça pronta, `ready-breathe`
(`index.css:4989-4996`) anima `box-shadow` na mesma `.card-art`, e **animação vence a
declaração estática** — a seleção de criatura pronta praticamente some. Bug real,
resolvido de graça por este item.

**Desenho:** aura fria "Æmber-éter" (ciano-branco), cromaticamente oposta ao dourado da
dica. Vive num `::before` do **tile**, não na `.card-art` (que tem `overflow: hidden`,
`index.css:1242`, e cuja `box-shadow` já é disputada). `.card-tile` tem
`container-type: inline-size` → contenção de layout → cria stacking context, então
`z-index: -1` fica atrás da arte e dentro do tile. `::after` continua sendo o ✦ da dica.

```css
:root {
  --sel-core: 160 232 255;   /* rgb ciano-éter */
  --sel-halo: 96 170 255;
}

.card-tile.is-selected::before {
  content: "";
  position: absolute;
  z-index: -1;
  inset: 0 1px auto;               /* largura = largura da .card-art (tile - 2px) */
  aspect-ratio: 0.714;             /* = .card-art (index.css:1243) */
  border-radius: var(--radius-sm);
  pointer-events: none;
  box-shadow:
    0 0 0 2px rgb(var(--sel-core) / 0.95),        /* aro nítido */
    0 0 8px 2px rgb(var(--sel-core) / 0.55),      /* brilho próximo */
    0 0 22px 6px rgb(var(--sel-halo) / 0.35),     /* halo */
    0 0 44px 10px rgb(var(--sel-halo) / 0.14);    /* bloom largo */
  animation: sel-breathe 1.8s ease-in-out infinite;
  will-change: opacity, transform;
}

@keyframes sel-breathe {                /* só opacity/transform: compositor */
  0%, 100% { opacity: 0.78; transform: scale(1); }
  50%      { opacity: 1;    transform: scale(1.025); }
}

.card-tile.is-selected .card-art {
  border-color: rgb(var(--sel-core) / 0.9);
  filter: brightness(1.08) saturate(1.06);  /* stunned mantém o seu: ver abaixo */
}

/* elevação: a mão sobe mais; o board, um pouco */
.card-tile--hand.is-selected  { transform: translateY(-12px) scale(1.06); z-index: 4; }
.card-tile--board.is-selected { transform: translateY(-4px)  scale(1.04); z-index: 4; }

/* seleção + dica: some o contorno dourado, fica o ✦ (não empilhar dois aros) */
.card-tile--hint.is-selected { outline-color: transparent; }

/* entrada da seleção: "acende" em 160ms antes de começar a respirar */
.card-tile.is-selected::before {
  animation: sel-ignite 160ms var(--ease-out) backwards, sel-breathe 1.8s 160ms ease-in-out infinite;
}
@keyframes sel-ignite { from { opacity: 0; transform: scale(0.92); } }

.reduce-motion .card-tile.is-selected::before { animation: none; opacity: 1; }
```

- **Durações:** acender 160ms `--ease-out`; respiração 1,8s (mais rápida que o
  `ready-breathe` de 2,6s → as duas não entram em fase e a selecionada se destaca);
  elevação usa a transição existente de 170ms do `.card-tile` (`index.css:1196`).
- **Peça atordoada:** `.board-piece--stunned … .card-art` já usa `filter`
  (`index.css:1420-1423`). A regra de seleção precisa de especificidade menor ou uma
  combinação explícita (`.board-piece--stunned .card-tile.is-selected .card-art {
  filter: saturate(0.6) brightness(1) }`).
- **Memo:** zero impacto. `selected` já é prop do `CardTile` e já está no comparador
  (`App.tsx:227`); `selectedId` já está no comparador da lane (`App.tsx:1074`). Só a
  carta que ganhou e a que perdeu a seleção re-renderizam — exatamente como hoje.
- **Mobile:** a elevação de −12px da mão não pode cortar dentro de `.hand-track`
  (`index.css:1841`, scroller horizontal): dar `padding-top: 14px` ao track no mobile
  ou limitar a −8px abaixo de 701px.
- **Esforço:** S (só CSS). **Risco:** baixo — conferir `e2e:capture` (glow não pode
  empurrar layout; `box-shadow` não afeta layout).

---

## 2. Jogar carta estilo Arena

### Coreografia (humano)

| Etapa | O que acontece | Duração | Easing |
|---|---|---|---|
| A. Lift | ghost nasce no rect da mão, sobe 18px, `scale 1.08`, glow ciano da §1 | 90ms | `cubic-bezier(0.2, 0.8, 0.2, 1)` (`--ease-out`) |
| B. Present | voa ao centro do viewport, `scale` até **S = max(1.6, 150/w)** (82px→1,83×, 103px→1,6×), leve `rotate(-2deg → 0)` | 170ms | `cubic-bezier(0.16, 1, 0.3, 1)` (expo-out: chega rápido e freia) |
| C. Hold | parado no centro, backdrop do board escurece 0 → 0.28 | 140ms | — |
| D. Slam | encolhe e desliza ao **slot exato**, termina com `scale 1.06 → 1` | 200ms | `cubic-bezier(0.55, 0, 0.75, 0.25)` até 92%, depois `cubic-bezier(0.2, 1.6, 0.4, 1)` no assentamento |
| E. Land | ghost some (opacity 1 → 0 em 60ms) e o tile real aparece; onda de poeira (anel 0 → 1.4, opacity 0.5 → 0) + `sound.play("play")` | 90ms | ease-out |

**Total humano ≈ 600-690ms**, na janela Arena (500-700). **IA:** a mesma sequência com
hold de **420ms** (≈ 950ms) — o jogador precisa *ler* a carta do oponente; é o ponto de
maior valor de todo o plano.

Tipos de carta:
- **Criatura:** destino = `[data-iid]` do próprio id no board novo. Como o
  `placeCreature` (`game.ts:816-822`) já aplicou `flank`/`deploy`/`slot`, o rect do DOM
  pós-commit **é** o slot exato — não é preciso recomputar a lógica de slot na UI.
  Gigantic: a segunda metade some da mão com fade de 120ms (ela vai `under`,
  `game.ts:851-862`).
- **Artefato:** destino = tile na faixa `.board-attachments` (`App.tsx:1147-1171`).
- **Upgrade:** destino = tile do upgrade na faixa; após pousar, pulso de 240ms no host
  (`attachedTo`, `game.ts:868`) via `data-fx="host"`.
- **Ação:** não tem slot — hold estendido (**humano 260ms, IA 600ms**), depois
  `dissolve` no centro (scale 1.6 → 1.9, `opacity → 0`, `filter: blur(0 → 4px)
  brightness(1.6)`, 260ms) — o efeito (dano/âmbar/etc. da §4) dispara no meio do
  dissolve. O card foi para o discard (`game.ts:874`), que não tem UI → não voar a lugar
  nenhum.
- **Descarte da mão** (`move.type === "discard"`, `game.ts:842`): sem present; cai
  em direção ao contador de deck com `translateY(+40px) rotate(8deg)`, opacity → 0, 260ms.

### Orquestração técnica (FLIP com ghost)

1. **Origem** — em `commitWithFx` (infra §0.4), antes do `setGame`:
   `from = document.querySelector('[data-iid="' + move.instanceId + '"]').getBoundingClientRect()`
   e `ghostSource = el.querySelector('.card-art').cloneNode(true)`. Para a **IA** a mão
   não está no DOM: origem = rect do avatar do `PlayerBand` inimigo (`App.tsx:1009`),
   ghost nasce com `scale 0.5, opacity 0` e é construído a partir do `face` (mesmo
   `CardArt` renderizado no portal).
2. **Commit** — `commitGame` roda normalmente. Undo/log/stats/save/replay já têm o
   estado final neste instante.
3. **Esconder destino** — `useLayoutEffect([game])` no App, **antes do paint**: acha o
   `[data-iid]` novo no board e seta `data-fx="landing"`:
   ```css
   [data-fx="landing"] { visibility: hidden; }
   [data-fx="landing"], [data-fx="landing"] * { animation: none !important; }
   ```
   O segundo seletor anula `card-arrive` (`index.css:1171`) e `card-deal`
   (`index.css:4944-4957`), que disparariam no remount (a `key` muda de pai: mão → lane).
4. **Destino** — no mesmo layout effect: `to = destino.getBoundingClientRect()`. Se o
   destino não existir (ex.: criatura morreu no próprio "Play:"), o ghost faz o
   dissolve da carta de Ação.
5. **Animar** — ghost `position: fixed; left: from.left; top: from.top; width:
   from.width` no `FxLayer`; **um único** `ghost.animate(keyframes, { duration: total,
   easing: "linear", fill: "forwards" })` com keyframes com `offset` e `easing` por
   trecho (A-B-C-D), só `transform` e `opacity`. Pontos intermediários:
   `center = (innerWidth/2 - from.cx, innerHeight/2 - from.cy)`, `slot = (to.cx -
   from.cx, to.cy - from.cy)`, escala final `to.width / from.width` (board 68 / mão 82
   = 0,83 no mobile; 88/103 no desktop).
6. **Pousar** — `anim.finished.then(...)`: remove `data-fx` do destino, remove ghost,
   dispara a onda de poeira. `fx.run` resolve a Promise aqui — o loop da IA a aguarda
   (§3).
7. **Scroll/resize** — os rects são de viewport; se houver `scroll`/`resize` durante o
   voo, `cancelAll()` (pula para o fim). Em mobile a mão está abaixo da dobra
   (`POLISH_REPORT` P1-3): **não** rolar a página; o ghost cruza a viewport e o slot
   pode estar fora dela — se `to` estiver fora do viewport, a etapa D termina num ponto
   clampado na borda + fade (o jogador vê "entrou lá em cima").

### Convivência com o resto

- **Input durante o voo:** não bloquear. Um novo `commitWithFx` chama `cancelAll()`
  primeiro → o voo anterior salta para o fim. Jogador rápido nunca espera animação.
- **Undo** durante o voo: `cancelAll()` e o estado ancorado renderiza normal.
- **Inspetor/bottom sheet:** `setSelected(null)` já ocorre em `performHumanMove`
  (`App.tsx:2226`) — o sheet fecha enquanto a carta sobe; bom.
- **Pass-and-play:** funciona igual (a mão de quem joga está no DOM).
- **`reduce-motion` / `settings.animations` OFF:** `commitWithFx` pula a infra toda
  (nem esconde destino); estado aparece instantâneo como hoje. Opcional: um flash de
  borda de 1 frame no destino (`data-fx="landed"`, sem movimento).
- **Esforço:** M. **Risco:** médio — (a) destino não encontrado (tratado no passo 4);
  (b) ordem de `useLayoutEffect` (usar o do App, que roda após os filhos); (c) iOS
  Safari com `container-type` no clone — o ghost precisa de largura explícita.

---

## 3. Ritmo do turno da IA à la Arena

### Hoje (`App.tsx:2024-2083`)

`setAiThinking(true)` → `wait(520)` → escolhe casa → loop: `wait(340 | 460 Impossible)`
→ **calcula** `chooseAiMove` (síncrono, até ~2k nós) → commit → … → `wait(260)` →
`endTurn`. Problemas: (1) todo move tem o mesmo peso — uma luta mortal e um "use" de
artefato passam no mesmo 340ms; (2) o cálculo acontece **depois** da espera, somando
latência variável; (3) nada na UI diz *qual* carta agiu — só o log e o som; (4)
"Warden is thinking" (`App.tsx:1295`, `i18n.ts:120`) fica no console o turno inteiro,
mesmo quando a IA está claramente *agindo*.

### Novo loop (mesmo effect, mesma estrutura de cancelamento/`aiTurnRef`)

```
beat(ms)  = wait(ms * tempo)                        // tempo ∈ [0.45, 1]
takeAiTurn:
  thinking(ON)                ; beat(THINK_OPEN[difficulty])
  house = choose…             ; commitWithFx(house)  ; await fx (banner de casa)
  thinking(OFF)
  move = chooseAiMove(next)                             // calcula ANTES de esperar
  while move:
      await beat(PRE[move.kind])                        // spotlight da carta
      applied = applyMove(next, 1, move)
      await commitWithFx(next, applied, …)              // Promise do diretor (§2/§4)
      next = applied ; if winner break
      t0 = now ; move = chooseAiMove(next)              // compositor segue animando
      await beat(max(0, GAP - (now - t0)))              // stagger já descontado o cálculo
  await beat(END_PRE) ; commitWithFx(endTurn)           ; banner "Seu turno"
```

### Tabela de pacing (tempo = 1, em ms)

| Tipo (`GameMove.type`) | PRE (spotlight) | FX (aguardado) | Total típico |
|---|---|---|---|
| abertura: pensar (`THINK_OPEN`) | Easy 250 · Medium 350 · Hard 450 · Very hard 550 · Impossible 650 | — | — |
| escolher casa | — | chip da casa "carimba" no console 450 | 450 |
| `play` criatura/artefato/upgrade | 120 | voo IA com hold 420 ≈ 950 | ~1070 |
| `play` ação | 120 | voo + hold 600 + dissolve + efeitos ≈ 1250 | ~1370 |
| `fight` | 260 (atacante acende, alvo marcado) | investida + impacto + números + morte ≈ 900-1300 | ~1200-1550 |
| `reap` | 200 | exaurir + âmbar voa até o contador ≈ 700 | ~900 |
| `use` (artefato/Action/Omni) | 200 | pulso + anel + efeitos ≈ 650 | ~850 |
| `unstun` | 160 | "sacode" o stun fora 380 | ~540 |
| `discard` | 80 | queda 260 | ~340 |
| stagger entre ações (`GAP`) | — | — | 220 |
| fim de turno (`END_PRE` + banner) | 300 | banner "Seu turno" 700 (não bloqueia input após 350) | 1000 |

A diferença de peso é o ponto: a luta "respira" 3× mais que um discard, como no Arena.

### Alvo de duração e degradação graciosa

- **Alvo:** turno típico de 3-4 ações = **4-6s**; teto percebido **~8s**.
- **Curva de tempo** (recalculada antes de cada ação):
  `tempo = 1` nas 4 primeiras ações e enquanto `elapsed < 5000`; depois
  `tempo = max(0.45, 1 - 0.1 * (acoes - 4))`, e **forçado 0.45** se `elapsed > 8000`.
  Ações de alto impacto (luta com morte, forja, ação que muda âmbar ≥ 2) nunca descem
  abaixo de 0.7 — o jogador precisa ver o que o machucou.
- **Holds** do voo escalam com `tempo`; os trechos de viagem (B/D) escalam no máximo até
  0.7 (abaixo disso o movimento vira teleporte).
- **Acelerar por toque:** um toque/click no board durante o turno da IA seta
  `tempo = 0.45` até o fim do turno (sem pular estado nem ações; só compacta). Não
  exige i18n (o aria da região já narra).
- **Aba em background** (`document.hidden`): `tempo = 0` → só commits, como a IA de
  hoje sem os waits; ao voltar, retoma com `tempo = 1`.
- O safety cap de 40 ações (`App.tsx:2053`) permanece.

### Sinalizar a carta que age (os moves já trazem o id)

Os moves da IA **já identificam a carta**: `instanceId` / `attackerId` / `targetId`
(`game.ts:120-126`). O que falta é o canal até a UI — e ele é o diretor de FX, não
props:

- **PRE:** `data-fx="acting"` no `[data-iid]` do agente e `data-fx="targeted"` no
  alvo (`targetId` da luta, `target` da habilidade):
  ```css
  [data-fx="acting"] { transform: translateY(6px) scale(1.12); z-index: 5;
                       transition: transform 180ms var(--ease-out); }
  [data-fx="acting"]::before { /* aura QUENTE, oposta à da seleção humana */
    content: ""; position: absolute; z-index: -1; inset: 0 1px auto; aspect-ratio: 0.714;
    border-radius: var(--radius-sm);
    box-shadow: 0 0 0 2px rgb(255 150 90 / 0.95), 0 0 14px 3px rgb(255 120 60 / 0.5),
                0 0 34px 8px rgb(220 70 40 / 0.25);
    animation: sel-ignite 160ms var(--ease-out) backwards; }
  [data-fx="targeted"] .card-art { outline: 2px dashed rgb(255 120 60 / 0.9);
                                   outline-offset: 3px; }
  ```
  (A lane inimiga está no topo: o agente "desce" 6px em direção ao jogador.)
- Uma **linha de mira** SVG no `FxLayer` do atacante ao alvo (stroke 2px, dash
  animado 300ms) na luta.
- Para **cartas da mão da IA** (play), o spotlight é o avatar do `PlayerBand` inimigo
  pulsando 120ms antes do ghost nascer dele.
- **Acessibilidade:** a região `turn-console` recebe `aria-live="polite"` e mostra a
  última entrada de log da IA traduzida — `t(entry.key, entry.params)` com as chaves
  `log.play`/`log.fight`/`log.reap`/`log.use` que já existem (`i18n.ts:259-261…`).
  Nenhuma string nova.

### E o "Warden is thinking"?

- Só aparece nos momentos em que a IA de fato pensa: a abertura (`THINK_OPEN`) e, se um
  `chooseAiMove` passar de 150ms (medido), durante o resto dele.
- Durante as ações, o `<strong>` do console (`App.tsx:1292-1296`) vira um **ticker**
  com a linha de log atual ("Warden jogou Troll."), trocada com fade/slide de 160ms.
- O `active-turn-tag` do band (`App.tsx:1017-1021`) ganha estado visual por fase:
  pensando = anel girando lento (reusa `.spin`, que sobrevive ao reduce-motion por ser
  indicador de estado, `index.css:~6157`); agindo = pulso quente 1× por ação.
- O `aria-label` continua `game.thinkingTag` / `game.active` (`App.tsx:1018`).
- Mudança de estado: `aiThinking: boolean` (`App.tsx:1746`) vira
  `aiPhase: "idle" | "thinking" | "acting"`; `arePlayerBandPropsEqual` compara o novo
  valor (`App.tsx:983`).

**Esforço:** M. **Risco:** médio-baixo — a estrutura de cancelamento (`cancelled`,
`aiTurnRef`, BUG-03) é preservada; o novo risco é esquecer um `if (cancelled) return`
depois de cada `await fx`.

---

## 4. Efeitos extras que valem a pena

Todos consomem os `FxEvent` do `diffFx` (§0.2) — **nenhum exige mudar o motor** até a
onda 3.

### 4.1 Forja de chave — screen glow + shake sutil

- **Hoje:** effect em `App.tsx:1997-2011` seta `forgeFlash` 700ms →
  `.game-board.forge-flash::before` radial central (`index.css:4959-4973`); pip anima
  `key-forge` (`index.css:1007-1014`).
- **Proposta (sequência de 900ms):**
  1. 0-260ms — **dreno de âmbar:** 6 gemas (`<i>` no FxLayer, 8px) saem do
     `.amber-counter` do lado que forjou e convergem ao próximo `.key-pip`
     (`translate` em arco com `offset` intermediário +/-24px em Y, stagger 25ms,
     `cubic-bezier(0.5, 0, 0.9, 0.5)`);
  2. 260ms — **impacto:** o glow atual passa a nascer **no band de quem forjou**
     (`radial-gradient(ellipse at 50% var(--forge-y), …)` com `--forge-y` = 8% para a
     IA, 88% para o jogador) e fica mais forte (alpha 0.5 → 0.65); o pip já anima;
  3. 260-540ms — **shake** do `.board-content` (não do `.game-board`, que tem borda e
     `overflow: hidden`):
     `@keyframes forge-shake { 0%{transform:translate(0)} 20%{translate(-3px,1px)}
     40%{translate(3px,-2px)} 60%{translate(-2px,2px)} 80%{translate(1px,-1px)}
     100%{translate(0)} }` 280ms `linear`. Amplitude máx 3px (mobile 2px). **Desligado
     em reduce-motion** (vestibular) mesmo que o resto do glow fique como fade simples.
  4. `sound.play("forge")` no impacto (hoje toca no commit).
- A forja acontece dentro do `endTurn` do *outro* lado (`game.ts:935-945`) — o diff
  detecta `keys` subindo. Na sequência da IA, a forja do jogador toca **depois** do
  banner "Seu turno" começar (senão fica soterrada).
- **Onde:** `diffFx` (`key`), `FxLayer`, CSS perto de `index.css:4959`. O effect de
  `App.tsx:1997-2011` fica só com o som de vitória/derrota.
- **Esforço:** S-M. **Risco:** baixo.

### 4.2 Números flutuantes de dano / âmbar

- **Dano:** para cada `damage {id, amount}`, um `<b>` no FxLayer centrado no rect do
  tile: `−3` em `#ff8a6a`, fonte `var(--fs-xl)` 800, `text-shadow: 0 2px 0 #3a120a, 0
  0 10px rgb(255 90 60 / 0.6)`. Anima 700ms: `0% scale(0.4) translateY(0) opacity 0`
  → `15% scale(1.25) opacity 1` (`cubic-bezier(0.2,1.6,0.4,1)`) → `100%
  translateY(-34px) scale(1) opacity 0` (ease-in). Tile recebe `data-fx="hit"` 180ms:
  `translateX` ±4px + `filter: brightness(1.8) saturate(0.4)` no 1º frame.
  Armadura absorvida (dano 0, `game.ts:475-484`): número cinza "0" com escudo — opcional.
- **Âmbar:** `+2 ◆` dourado sobe do **card que gerou** (reap: a criatura; play: o
  ghost) e **voa até o `.amber-counter`** do band (400ms, arco), onde o `count-pop` já
  existente (`index.css:1072-1079`) completa o efeito. Roubo (`steal`,
  `game.ts:515`): gema viaja de um band ao outro. Captura: de band para o tile
  (`.amber-label`, `App.tsx:285-290`).
- **Heal:** `+2` verde, mesmo motor.
- **Agrupamento:** vários eventos no mesmo tile somam; vários tiles (splash, sweep)
  disparam com stagger 40ms.
- `aria-hidden="true"` sempre; texto numérico não é informativo exclusivo (o badge de
  dano no tile, `App.tsx:283`, e o log já informam) → não viola o piso de 11px mesmo
  sendo transitório, e o número usa ≥ `--fs-lg` de qualquer forma.
- **Esforço:** M. **Risco:** baixo (puramente aditivo).

### 4.3 Morte de criatura — dissolve com escala

- **Problema:** `leavePlay` (`game.ts:435-458`) remove a peça do state; o React
  desmonta o tile no mesmo commit → hoje a criatura simplesmente some e as vizinhas
  saltam.
- **Solução:** o `snapshot` do `commitWithFx` já clona (`cloneNode(true)`) as peças que
  o diff marca como `leave` e guarda seus rects. No layout effect, o clone é posto no
  FxLayer no rect antigo e anima 480ms:
  `0% → 20%`: `filter: brightness(2.2) saturate(0)` (flash branco, 90ms);
  `20% → 100%`: `scale(1 → 0.72) rotate(0 → -6deg) translateY(0 → 10px)`, `opacity 1 →
  0`, `filter: blur(0 → 3px) grayscale(1)`, `cubic-bezier(0.4, 0, 1, 1)`. Ao mesmo
  tempo 10 fagulhas (quadrados 3px cor da casa, `--house-color`) sobem 30-60px e somem
  em 520ms.
- **Vizinhas (FLIP):** o `snapshot` também guarda os rects das **sobreviventes** da
  lane; após o commit, cada uma recebe `transform: translateX(old - new)` e anima para
  0 em 240ms `--ease-out`, **depois** de 200ms (espera o dissolve começar).
- Destino não-discard (`hand` por bounce, `deck`, `archives`): em vez do dissolve,
  voa encolhendo para o band do dono (320ms) — mesmo motor do voo de §2 invertido.
- **Esforço:** M. **Risco:** médio — o clone carrega o `container-type` e as
  larguras explícitas do tile (ok), mas não o contexto do `.board-piece` (bordas de
  estado): clonar o `.board-piece`, não só o botão.

### 4.4 Chains com feedback

KeyForge "chains" são a penalidade de compra (`refill`, `game.ts:209-214`). Hoje só há
o contador (`App.tsx:1035-1043`), sem momento.

- **Ganhar chains** (`chains {side, delta > 0}`, efeito `chains` em `game.ts:523`):
  elo desenhado no FxLayer cai do topo até o `.chain-counter` (360ms,
  `cubic-bezier(0.5, 0, 0.9, 0.5)`), contador faz `count-pop` + shake horizontal de 3
  ciclos ±2px (240ms); tint frio de 140ms no band. Som: reusar `"error"` baixo ou um
  novo `"chain"` (onda 3).
- **Chains reduzindo a compra no fim de turno:** o diff do `endTurn` sabe quantas
  cartas foram compradas vs. `HAND_SIZE`. Se `floor((chains+5)/6) > 0`, mostrar sobre
  o `.deck-count` (`App.tsx:1366`) um marcador `−1 ⛓` que pisca 2× (600ms) — ensina a
  regra sem texto novo.
- **Chains diminuindo** (−1 por compra): elo se parte (duas metades giram ±20deg e
  caem, 420ms).
- **Esforço:** S. **Risco:** baixo.

### 4.5 Luta (é o que mais pesa no turno da IA)

Investida: o atacante (já `acting`) faz `translate` até 55% do caminho ao defensor em
160ms `cubic-bezier(0.5, 0, 0.9, 0.4)`, volta em 200ms `--ease-out`; no pico: `hit`
nos dois, números de dano (§4.2), `sound.play("fight")` movido para o impacto, e, se
houver morte, dissolve (§4.3) logo após o retorno. Implementado como WAAPI no próprio
nó `[data-iid]` (transform imperativo; o React não controla `style.transform` do tile,
e o `animate()` com `fill: "none"` não deixa resíduo). **Esforço:** M.

### 4.6 Opcionais de menor valor (não prioritários)

- Banner "Seu turno" (chave `game.yourTurn` existente): faixa central 700ms, `scale
  0.9 → 1`, `letter-spacing 0.3em → 0.12em`. **S**.
- Reap com "exaurir" de verdade (tilt −8deg permanente enquanto `!ready`):
  mexe em layout visual de estado já documentado em T4 → só depois de revisar
  `e2e:capture`. **S**, risco de regressão visual.
- SFX novos sintetizados (`"whoosh"` ruído filtrado 200ms no present, `"shatter"` na
  morte) em `sound.ts` — respeita a regra 8. **S**, ~+0,3 kB gz.

---

## Fechamento — 3 ondas

### Onda 1 — "a carta tem peso" (maior retorno por kB)

| Item | Exige |
|---|---|
| §1 Glow de seleção (+ fix do conflito com `ready-breathe`) | só CSS |
| Infra §0: `data-iid`, `lib/fx.ts` (`diffFx` só com `enter`/`leave`), `FxLayer` portal, `commitWithFx`, `useLayoutEffect([game])`, `cancelAll` | 1 ref para o diretor (`fxRef`), 1 helper no App, guard `motionOn` |
| §2 Jogar carta (humano + IA) | ghost WAAPI; troca de `commitGame` → `commitWithFx` em `performHumanMove` e no loop da IA |

Gates: `build`, `e2e:smoke` (partida ainda anda), `e2e:capture` (glow), `e2e:bundle`
com teto revisado. Teste manual: undo no meio do voo; toggle de animações OFF; 360px
com a mão abaixo da dobra.

### Onda 2 — "o oponente tem ritmo"

| Item | Exige |
|---|---|
| §3 pacing por tipo, `tempo` adaptativo, cálculo antes da espera, toque acelera | reescrever o corpo de `takeAiTurn` (`App.tsx:2038-2074`), mesma estrutura de cancelamento |
| Spotlight `acting`/`targeted` + linha de mira | `data-fx` imperativo, CSS novo |
| `aiThinking` → `aiPhase`; ticker de log no console com `aria-live` | 1 state, comparador do `PlayerBand` |
| §4.5 luta + §4.2 números | `diffFx` ganha `damage`/`amber`/`exhaust`; `fx.run` devolve Promise aguardada pelo loop |

Nenhum evento novo do motor. Gates: `e2e:smoke` (o smoke passa 2 turnos — **o timeout
precisa acomodar ~6s por turno da IA** ou o smoke seta `tempo = 0` via flag de teste).

### Onda 3 — "consequência visível"

| Item | Exige |
|---|---|
| §4.3 morte com dissolve + FLIP das vizinhas | `snapshot` clona peças `leave` e rects das sobreviventes |
| §4.1 forja completa (dreno, glow localizado, shake) | substitui `forgeFlash` state por evento `key` |
| §4.4 chains | eventos `chains`, marcador no `deck-count` |
| SFX `whoosh`/`shatter`/`chain`, banner de turno | `sound.ts` |
| FX no replay viewer | chamar `diffFx(states[i-1], states[i])` |

**Único ponto em que um evento do motor pode valer a pena:** a *ordem* de efeitos
dentro de um mesmo move (ex.: "Play: dê 3 de dano e roube 1" — o diff entrega os dois
simultâneos). Se a sequência importar, adicionar `applyMoveTraced(state, side, move):
{ state, trace: FxEvent[] }` como **função irmã pura** que coleta o trace num array
local passado adiante (sem tocar `GameState`, sem mudar o save, sem mudar
`applyMove`). Só fazer se, depois da onda 3, a simultaneidade ainda parecer confusa.

### Orçamento resumido

| Onda | kB gz estimado | Duração percebida por turno da IA |
|---|---|---|
| 1 | +1,2 | ~2,5s → ~4s (voos da IA) |
| 2 | +1,5 | ~4-6s (alvo), teto ~8s com degradação |
| 3 | +1,3 | sem mudança de ritmo; mais leitura por segundo |

Cada onda pede revisão explícita do teto de bundle no CLAUDE.md (regra 7), com esta
tabela como justificativa.
