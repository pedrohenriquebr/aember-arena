# Arena TCG Live — plano de implementação da terceira visão da mesa

> Branch `arena-tcg-live`. Referência visual: `docs/advisor/refs/pokemon-live-mobile.png`
> (Pokémon TCG Live, celular). Executor-alvo: Haiku 5.5 high, **lote a lote, sem decisão de
> desenho** — todo valor, seletor, chave e gate está escrito aqui. Onde o dono precisa escolher,
> o lote diz **DECISÃO Dn** e aponta para a §8 (são duas).
>
> Lei: o §5.0 do `docs/UX_REWRITE_PLAN.md` vale integralmente (baseline antes, nunca regredir,
> parar e reportar após 2 tentativas, nunca afrouxar um gate). Este plano só acrescenta regras.

---

## 0. Nome, escopo, o que NÃO muda

- **Nome no código: `tcg`.** "Arena" já é o nome do layout MTG Arena da mesa 3D (H3D-13..15:
  `npm run e2e:arena`, `e2e/probes/_3d-arena.mjs`, comentários "Mesa estilo MTG Arena" no
  `index.css`). Para não colidir: `tableView: "tcg"`, classe `.game-board--tcg`, tokens
  `--nf-tcg-*`, probes `_tcg-*.mjs`, scripts `e2e:*:tcg`. O usuário vê **"Layout Arena"**
  (chaves `ui.arena.*`, como pedido).
- **Terceira visão, aditiva.** Os modos 2D e 3D (mesa única, 58510c5) e a v1 (`?ui=1`) não mudam
  1px. Padrão continua `"2d"`. A variante só existe com a v2 (`ui2`), só quando o jogador liga.
- **Plana.** Nada de `perspective`/`preserve-3d`/tilt. Nenhuma regra do H3D se aplica.
- **Mesmo DOM.** A variante é CSS sobre o DOM atual do `GameBoard` + 4 ganchos de marcação sem
  efeito visual (lote 02) + 1 componente novo (a dica, lote 09). Nenhum nó é movido no JSX.
- **Motor e contratos congelados** (§1.2). `index.css` não ganha nem perde nenhuma linha nesta
  branch: todo CSS novo mora em `src/ui/table/tcg.css` (lintado pelo `lint:ui2`).

---

## 1. Revisão do frontend (insumo do plano)

### 1.1 Achados

| # | Classe | Achado | Consequência no plano |
|---|---|---|---|
| A1 | **bloqueia** | O FIT (`e2e/fit.mjs`, MEASURE) e o ui2 (`e2e/ui2.mjs`, TABLE_MEASURE) medem o palco somando a altura de `.player-band`, `.battle-zone`, `.turn-console`, `.hand-zone`; o ui2 exige soma == viewport ±1. Qualquer re-layout que tire banda/console do fluxo (o que o layout TCG exige: bandejas laterais) zera essas parcelas e torna a conta vazia. | Lote 03 cria uma **medição própria da variante** (soma das trilhas do grid do `.board-content` + checagem de sobreposição entre peças) — é um check a mais, nada é afrouxado. As medições 2D/3D ficam byte-a-byte. |
| A2 | **bloqueia** | Colisão de nome "arena" (ver §0). | Id `tcg` no código. |
| A3 | risco | O `turn-console` é **portado para o rail** no desktop (`consoleSlot`, App.tsx:4730, `drawerMode ? null : railConsoleSlot`). Na variante a pílula END TURN sairia da mesa ≥1041px. | Na variante `consoleSlot = null` sempre (lote 01). O rail continua (notas/log/inspetor); o `.rail-console-slot:empty` já some. |
| A4 | risco | `GameBoard` é compartilhado por v1, v2 e replay, e `settings` é lido pelas duas UIs. Um `tableView:"tcg"` gravado vazaria para a v1. | A classe só entra com `ui2 && tableView === "tcg"` **dentro** do `GameBoard`; na v1 o valor lê como 2D (nenhum `=== "3d"` casa). |
| A5 | risco | Contrato DOM implícito: `useHandDrag` solta sobre `.battle-zone--player` (rect) e acha a carta por `[data-iid]`; o `FxLayer` ancora em `[data-iid]`, `.board-piece`, `.card-art`, `[data-side] .amber-counter`, `[data-side] .chain-counter`, `[data-side] .player-avatar`, `[data-side] .hand-backs i:last-of-type` (se visível), `.game-board`. | Re-layout só por CSS (grid + `display: contents`) preserva tudo; **renomear/reparentar é proibido** (§1.2). Na variante os dorsos do oponente ficam visíveis → o voo da carta da IA nasce deles (ganho grátis). |
| A6 | oportunidade | O DOM do board já é "achatável": no 2D o `.table-plane` é `display: contents` e as zonas/console são filhos diretos do grid. Com `display: contents` também em `.player-band` e `.turn-console`, **cada pedaço** (avatar, pilhas, placar, END TURN, ☰) vira item do grid e vai para uma área nomeada — exatamente o truque do H3D (mesmo DOM, CSS escopado). | Base do lote 03. |
| A7 | oportunidade | O leque da mão do 3D (H3D-06: `--i`/`--n`/`--d`, `sibling-index()`, ergue no foco/seleção, tarja) e o corte da mão pela borda do board (`.game-board{overflow:hidden}`, H3D-14) são reaproveitáveis; o `Coachmark` ancora em `data-coach` que existem na variante (`house-picker`, `hand-track`, `end-turn-button`). | Lotes 07 e 09 copiam o padrão com tokens próprios. |
| A8 | risco | `.pile-chip` mede **40px** de altura (`index.css:7922`) — abaixo da regra 9 (44). No celular a `.end-turn-button > span` é escondida (só ícone). `.fight-instruction` é `nowrap` absoluto centralizado — numa zona estreita estoura na horizontal (o FIT reprova `scrollWidth`). | Corrigidos **no escopo** da variante (lotes 03/04/06). O 2D fica como está (fora do escopo). |
| A9 | risco | `index.css` tem ~9,6k linhas sem lint (hex/rgba/px literais). Especificidade: a maioria das regras do palco é `.game-board--stage X` (0,2,0). | Todo seletor novo começa por **`.game-board.game-board--tcg`** (0,2,0 + descendente) e o arquivo carrega depois do `index.css` (main.tsx). |
| A10 | risco (provável) | `e2e/probes/_hand-drag.mjs` ainda entra pela home da v1 (`.home-screen`, nav da v1); após o H-29 a v2 é o padrão — é provável que esteja obsoleto. Não verificado nesta revisão. | O drag da variante ganha probe próprio (`_tcg-hit.mjs`) entrando pelo lobby, como `_mesa-unica-shots.mjs`. Não consertar o `_hand-drag` nesta branch. |
| A11 | risco | O `_2d-freeze.mjs` congela a **v1** (`?ui=1`). Não existe freeze determinístico da mesa da **v2** (a arte vem do S3 pela rede). | Lote 02: `_tcg-shots.mjs --freeze` aborta toda requisição fora do localhost (arte cai no fallback tipográfico, determinístico) e vira o freeze 2D/3D da v2 via `_png-diff.mjs`. |

### 1.2 O que congelar nesta branch (e por quê)

| Congelado | Por quê |
|---|---|
| `src/lib/game.ts`, `ai.ts`, `abilities.ts`, `dsl*`, `fx.ts`, `piles.ts`, `public/sw.js` | Guardrail. A dica (lote 09) só **chama** `getLegalMoves` (já importado no App). |
| `src/components/useHandDrag.tsx`, `src/components/FxLayer.tsx` | Contrato de arraste e diretor de FX (A5). Lidos, nunca editados. |
| Marcação de `CardTile`, `BoardLane` e os comparadores de memo (`areCardTilePropsEqual`, `areBoardLanePropsEqual`) | Performance (T7d) e âncoras do FX. A variante não passa prop nova para eles. |
| `src/index.css` | 2D/3D pixel-idênticos por construção: nenhuma linha muda. |
| `Coachmark.tsx`, `coach.ts`, `coach.css` | A dica nova convive (lote 09), não altera a máquina. |
| Checks existentes de `fit.mjs`, `ui2.mjs`, `capture.mjs`, `_3d-*.mjs` | Só **adições** (ramo `tcg`). Uma linha de check 2D/3D alterada = lote reprovado. |
| Ordem do interruptor 3D no ☰ e nos Ajustes | `ui2.mjs:804` e `_3d-fx.mjs:303` clicam o **primeiro** `[role=switch]` do ☰ e esperam o 3D. O interruptor novo entra **depois** dele. |

---

## 2. Anatomia da variante

### 2.1 Mapeamento Pokémon → KeyForge (fechado)

| Pokémon TCG Live | KeyForge (variante `tcg`) | Elemento existente |
|---|---|---|
| Ativa do oponente, topo-centro, grande | Battleline do oponente, bloco central superior, cartas grandes | `.battle-zone--opponent` |
| Ativa do jogador, abaixo do meio | Sua battleline, bloco central inferior | `.battle-zone--player` |
| Bench do oponente (tira esquerda, topo) | Pilhas do oponente: descarte + arquivo (virado) | `.player-band[data-seat=top] .pile-chips` |
| Bench do jogador (esquerda, baixo) | Suas pilhas + "Pegar arquivos" | `[data-seat=bottom] .pile-chips`, `.archives-action` |
| Placar 3/3 vermelho/azul ladeando o meio, à direita | Placar (chaves + Æmber + correntes): oponente acima do meio (tinta ember), você abaixo (tinta ether) | `.player-resources` (das duas bandas) |
| Deck/prêmios à direita, embaixo | Mão/baralho: "5 cartas · 30 no baralho" | `.hand-bar-info` |
| Cronômetro no meio | Linha do turno: "RODADA 03 · Seu turno" + resumo do Warden | `.turn-console-copy` |
| TERMINAR TURNO, pílula grande | END TURN pílula grande, anel na cor da casa ativa | `.end-turn-button` |
| Engrenagem no canto superior direito | ☰ (TableMenu) + Desfazer | `.table-menu-trigger`, `.console-undo` |
| Balão de dica acima da mão | Dica contextual do turno (nova), invertida, sobre a base da sua zona | `.nf-tcg-tip` (lote 09) |
| Mão espiando na borda inferior | Mão em leque cortada pela borda do board | `.hand-zone` / `.hand-track` |
| Playmat ilustrado plano | Mat plano por tema: metades tingidas, anel da forja no meio, giz pontilhado | `.game-board` + `.felt-etching` |
| — (não existe no Pokémon) | Seletor de casa: faixa do jogador, centro | `.house-pill` |
| — | Avatar + nome + dorsos da mão do oponente: faixa do topo | `[data-seat=top] .player-avatar/.player-copy/.hand-backs` |

### 2.2 O grid (todos os viewports — muda só o valor dos tokens)

`.board-content` da variante: 4 colunas × 6 linhas, áreas nomeadas.

```
colunas:  [tray]            [1fr]          [end-w]          [tray]
        ┌────────────────┬──────────────┬────────────────┬──────────┐
strip   │ o-av           │ o-id         │ o-undo         │ o-menu   │  avatar · nome+dorsos · ↶ · ☰
        ├────────────────┼──────────────┴────────────────┼──────────┤
1fr     │ o-pile         │ o-zone                        │ o-res    │  pilhas · LINHA DO OPONENTE · placar(↓)
        ├────────────────┴──────────────┬────────────────┴──────────┤
mid     │ turn                          │ end                       │  RODADA 03 · Seu turno · [ END TURN ]
        ├────────────────┬──────────────┴────────────────┬──────────┤
1fr     │ p-pile         │ p-zone                        │ p-res    │  pilhas+arquivos · SUA LINHA · placar(↑)+mão/baralho(↓)
        ├────────────────┼───────────────────────────────┴──────────┤
seat    │ p-av           │ house                                    │  avatar · [casa][casa][casa]
        ├────────────────┴──────────────────────────────────────────┤
peek    │ hand                                                      │  leque cortado pela borda
        └───────────────────────────────────────────────────────────┘
```

```css
grid-template-columns: var(--nf-tcg-tray-w) minmax(0, 1fr) var(--nf-tcg-end-w) var(--nf-tcg-tray-w);
grid-template-rows: var(--nf-tcg-strip-h) minmax(0, 1fr) var(--nf-tcg-mid-h) minmax(0, 1fr) var(--nf-tcg-seat-h) var(--nf-tcg-peek-h);
grid-template-areas:
  "o-av   o-id   o-undo o-menu"
  "o-pile o-zone o-zone o-res"
  "turn   turn   end    end"
  "p-pile p-zone p-zone p-res"
  "p-av   house  house  house"
  "hand   hand   hand   hand";
```

Por que a coluna 3 é **fixa** (`--nf-tcg-end-w`) e não `auto`: um track `auto` cresceria até o
max-content do item mais largo que o atravessa (o texto da mão/baralho, o nome do deck) e
empurraria a battleline — o layout tem de ser determinístico por token.

### 2.3 Elemento → área (tabela canônica; o lote 03 implementa exatamente isto)

| Elemento (seletor sob `.game-board.game-board--tcg`) | `grid-area` | `justify-self` | `align-self` |
|---|---|---|---|
| `.player-band[data-seat="top"] .player-avatar` | `o-av` | center | center |
| `.player-band[data-seat="top"] .player-copy` | `o-id` | start | center |
| `.player-band[data-seat="top"] .hand-backs` | `o-id` | end | center |
| `.player-band[data-seat="top"] .pile-chips` | `o-pile` | center | start |
| `.player-band[data-seat="top"] .player-resources` | `o-res` | center | end |
| `.console-undo` | `o-undo` | end | center |
| `.table-menu-trigger` | `o-menu` | center | center |
| `.battle-zone--opponent` | `o-zone` | stretch | stretch |
| `.turn-console-copy` | `turn` | start | center |
| `.end-turn-button` | `end` | end | center |
| `.battle-zone--player` | `p-zone` | stretch | stretch |
| `.nf-tcg-tip` (lote 09) | `p-zone` | center | end |
| `.player-band[data-seat="bottom"] .pile-chips` | `p-pile` | center | end |
| `.archives-action` | `p-pile` | center | start |
| `.player-band[data-seat="bottom"] .player-resources` | `p-res` | center | start |
| `.player-band[data-seat="bottom"] .hand-bar-info` | `p-res` | center | end |
| `.player-band[data-seat="bottom"] .player-avatar` | `p-av` | center | center |
| `.player-band[data-seat="bottom"] .player-copy` | — (`display: none`; o avatar diz "Você"/"1"/"2" e a linha do turno diz de quem é a vez) | | |
| `.house-pill` (fora de `--asking`) | `house` | center | center |
| `.house-pill.house-pill--asking` | `auto` + `position: absolute` (overlay acima da faixa, §lote 03) | | |
| `.hand-zone` | `hand` | stretch | stretch |
| `.zone-heading` | — (`display: none`; a `<section>` já tem `aria-label`) | | |

`display: contents` em: `.player-band`, `.turn-console` (o `.table-plane` já é `contents` no 2D).

### 2.4 Tokens de geometria (novos, em `src/ui/tokens.css`, bloco 4)

Valores escolhidos para que **cada** viewport do FIT feche a conta com folga zero e cartas de
battleline maiores que no 2D. Ordem dos `@media` importa (o de altura baixa vem por último).

| Token | ≤700 (celular) | ≥701 | ≥1041 | ≥701 e ≤759 alt. | ≤600 alt. (paisagem) |
|---|---|---|---|---|---|
| `--nf-tcg-tray-w` | 56px | 88px | 104px | — | — |
| `--nf-tcg-end-w` | 120px | 152px | 168px | — | — |
| `--nf-tcg-strip-h` | 48px | 52px | — | 46px | 44px |
| `--nf-tcg-mid-h` | 60px | 64px | — | 56px | 52px |
| `--nf-tcg-seat-h` | 52px | 56px | — | 52px | 52px |
| `--nf-tcg-peek-h` (D1-A) | 92px | 112px | 124px | 96px | 72px |
| `--nf-tcg-peek-h` (D1-B) | 112px | 136px | 152px | 124px | 92px |
| `--nf-tcg-hand-w` | 72px | 92px | 104px | 84px | 60px |
| `--nf-tcg-board-min` | 64px | 72px | — | — | 52px |
| `--nf-tcg-board-max` | 132px | 150px | 168px | — | — |
| `--nf-tcg-end-h` | 52px | 56px | — | — | 52px |
| `--nf-tcg-backs-w` | 48px | 72px | — | — | — |

Fixos (todas as larguras): `--nf-tcg-board-chrome: 26px` (legenda + respiro da lane),
`--nf-tcg-hit: 44px` (alvo mínimo), `--nf-tcg-back-w: 10px`, `--nf-tcg-back-h: 14px`,
`--nf-tcg-fan-deg: 3deg`, `--nf-tcg-fan-drop: 2px`, `--nf-tcg-fan-drop-max: 6px`,
`--nf-tcg-tip-w: 22rem`, `--nf-tcg-ring: 22vmin`, `--nf-tcg-ring-w: 2px`, `--nf-tcg-chalk: 22px`.

Conta de referência (D1-A; o palco na casca de mesa mede `100dvh − 12px − safe-area`):

| Viewport | Palco | Trilhas fixas | Cada zona | Largura do centro (col 2+3) | Carta máx. (1–2 criaturas) |
|---|---|---|---|---|---|
| 390×844 | 832 | 48+60+52+92 = 252 | 290 | 278 | 123px (2D hoje: ≤76) |
| 360×844 | 832 | 252 | 290 | 248 | 108px |
| 768×1024 | 1012 | 52+64+56+112 = 284 | 364 | 592 | 150px (teto) |
| 1440×900 (rail aberto) | 888 | 52+64+56+124 = 296 | 296 | ≈ largura da coluna − 208 | 168px (teto) |
| 1296×668 | 656 | 46+56+52+96 = 250 | 203 | ≈ coluna − 208 | ≈125px |
| 844×390 (paisagem, fora do FIT) | 520 (min-height do palco; rola) | 44+52+52+72 = 220 | 150 | 636 | ≈77px |

---

## 3. Coexistência — flag, setting, classes

1. **Setting**: `TableView = "2d" | "3d" | "tcg"` (`src/lib/settings.ts`). `readSettings` aceita
   `"tcg"`; qualquer outro valor desconhecido continua caindo no padrão `"2d"`. Padrão: `"2d"`.
2. **Flag**: a variante só existe com a v2. No `GameBoard`:
   `const tcg = ui2 && settings.tableView === "tcg";` (a prop `ui2` já existe). Na v1 um `"tcg"`
   gravado renderiza o 2D (nenhum `=== "3d"` casa) — e o replay da v2 herda a variante (recebe `ui2`).
3. **Classe**: `game-board--tcg` no `<section class="game-board game-board--stage …">`, e
   `data-view="tcg"`. Nunca coexiste com `--3d`/`--lite` (o ternário garante).
4. **Interruptores** (mutuamente exclusivos por construção do enum):
   - Ajustes › Interface: nova linha "Layout Arena" logo **abaixo** da "Mesa 3D". Ligado →
     `"tcg"`; desligado → `"2d"`. Ligar a "Mesa 3D" com a Arena ativa → `"3d"` (a Arena desliga).
   - ☰ da mesa (TableMenu): nova linha "Layout Arena" logo **abaixo** de "Mesa 3D" (o 3D segue
     sendo o primeiro `[role=switch]`). O 3D usa o `toggleTableView` de hoje (de `"tcg"` vai a
     `"3d"`); a Arena usa o `toggleTcg` novo.
5. **Console**: com a variante, `consoleSlot={null}` (A3).
6. **FIT 3D, `_3d-*` e `e2e:arena`** semeiam `tableView:"3d"`; nada da variante casa sem
   `.game-board--tcg` → caminho deles intocado (R6).

---

## 4. Protocolo próprio (além do §5.0)

1. **Antes de cada lote**: `git status` limpo; ler este plano até o fim do lote; conferir que o
   lote anterior está commitado (o orquestrador comita).
2. **Seletor**: todo seletor de `src/ui/table/tcg.css` começa por `.game-board.game-board--tcg`
   (ou `.nf-tcg-*`, só para o componente da dica). Nenhum seletor sem esse escopo.
3. **Valores**: cor só `var(--nf-*)`/`color-mix(... var(--nf-*) ...)`; espaço só `var(--space-*)`;
   geometria só `var(--nf-tcg-*)`; raio `var(--radius-*)`; fonte `var(--fs-*)`/`var(--fw-*)`;
   movimento `var(--dur-*)`/`var(--ease-*)`. Literais permitidos: `0`, `1px`/`2px` de hairline,
   números puros (`0.714`, `1.05`), `%`, `deg` dentro de token.
4. **Depois, sempre**: `npm run typecheck` · `npx vitest run` (≥ baseline) · `npm run lint:ui2` ·
   `node e2e/fit.mjs` e `node e2e/fit.mjs --view 3d` com as linhas `faixas:` **idênticas** às do
   `00-baseline` · o gate próprio do lote.
5. **Capturas**: cada lote que muda pixel da variante grava
   `node e2e/probes/_tcg-shots.mjs docs/advisor/arena-tcg-live/NN` (24 PNGs + `report.json`).
6. **Parar e reportar** (não afrouxar): qualquer check 2D/3D existente falhando; qualquer conflito
   entre este plano e um gate.

---

## 5. Lotes

Tamanhos como no UX_REWRITE_PLAN (S/M/L). Commit sugerido: `feat(ui2): H-ATL-NN - descrição`.

---

### H-ATL-00 · Baseline · **S** · dep.: —

- **Objetivo**: números e imagens de antes. Sem código de produto.
- **Arquivos novos**: `docs/advisor/arena-tcg-live/00-baseline/BASELINE.md` + saídas abaixo.
- **Passos** (cada saída redirecionada para um `.txt` na pasta):
  1. `npx vitest run` → anotar o total (`vitest.txt`).
  2. `npm run typecheck`, `npm run lint:ui2` (devem passar).
  3. `node e2e/fit.mjs > fit-2d.txt`, `node e2e/fit.mjs --view 3d > fit-3d.txt`,
     `node e2e/fit.mjs --coach > fit-coach.txt`.
  4. `npm run e2e:floor`, `npm run e2e:floor:3d`, `npm run e2e:arena`, `npm run e2e:ui2`,
     `npm run e2e:journey`.
  5. `node e2e/shots/_2d-freeze.mjs --tag antes` e `--tag antes --view 3d` (freeze da v1).
  6. `node e2e/probes/_mesa-unica-shots.mjs docs/advisor/arena-tcg-live/00-baseline/mesa-3d`.
- **BASELINE.md**: tabela gate → resultado (OK/FAIL + total). Se algum gate **já** falha no
  baseline: registrar como pré-existente e **parar** (o dono decide antes do lote 01).
- **Aceite**: arquivo existe; todos os gates acima OK (ou pré-existentes reportados).

---

### H-ATL-01 · Setting `tcg` + interruptores + classe (sem CSS) · **M** · dep.: 00

- **Objetivo**: ligar/desligar a variante; a mesa ganha a classe, ainda com cara de 2D.
- **Arquivos tocados**:
  1. `src/lib/settings.ts`
     - `export type TableView = "2d" | "3d" | "tcg";` e atualizar o comentário do tipo (H-ATL-01:
       "tcg" = Layout Arena, só com a v2).
     - `readSettings`: `tableView: parsed.tableView === "3d" || parsed.tableView === "tcg" ? parsed.tableView : base.tableView,`
  2. `src/lib/settings.test.ts` — 2 casos: `"tcg"` sobrevive a `saveSettings`→`readSettings`;
     `"foo"` lê `"2d"`.
  3. `src/App.tsx`
     - No `GameBoard` (hoje App.tsx:1971-1972), trocar por:
       ```ts
       const view3d = settings.tableView === "3d";
       // H-ATL-01: a terceira visão (Layout Arena) é só da v2 — na v1 um "tcg" gravado lê como 2D.
       const tcg = ui2 && settings.tableView === "tcg";
       const tableClass = view3d ? (LITE_TABLE ? " game-board--lite" : " game-board--3d") : tcg ? " game-board--tcg" : "";
       ```
       e `data-view={view3d ? "3d" : tcg ? "tcg" : undefined}`.
     - Logo abaixo de `toggleTableView` (App.tsx:2931), novo callback:
       ```ts
       /** H-ATL-01: liga/desliga o Layout Arena (sai sempre para o 2D). Mesmo contrato de FX do 3D. */
       const toggleTcg = useCallback(() => {
         cancelFx();
         setViewSwitching(true);
         setSettings((prev) => ({ ...prev, tableView: prev.tableView === "tcg" ? "2d" : "tcg" }));
       }, [cancelFx]);
       ```
     - `consoleSlot` (App.tsx:4730): `consoleSlot={drawerMode || (ui2 === "2" && settings.tableView === "tcg") ? null : railConsoleSlot}`.
     - `<TableMenu …>` (App.tsx:4978): passar `tcg={settings.tableView === "tcg"}` e `onToggleTcg={toggleTcg}`.
  4. `src/ui/shell/TableMenu.tsx` — props `tcg: boolean; onToggleTcg: () => void;` e, **logo
     depois** do `SettingRow` do 3D:
     ```tsx
     <SettingRow
       title={t("ui.table.arena")}
       control={<Switch checked={tcg} onChange={onToggleTcg} label={t("ui.table.arena")} />}
     />
     ```
  5. `src/ui/screens/settings/InterfaceTab.tsx` — **logo depois** do `SettingRow` da Mesa 3D:
     ```tsx
     <SettingRow
       title={t("ui.arena.layout")}
       description={t("ui.arena.layoutSub")}
       control={
         <Switch
           checked={settings.tableView === "tcg"}
           label={t("ui.arena.layout")}
           onChange={(value) => onChange({ ...settings, tableView: value ? "tcg" : "2d" })}
         />
       }
     />
     ```
  6. `src/lib/i18n.ts` — junto do grupo `ui.table.*` e num bloco `ui.arena.*` após `ui.coach.*`:
     | Chave | en | pt-BR |
     |---|---|---|
     | `ui.table.arena` | Arena layout | Layout Arena |
     | `ui.arena.layout` | Arena layout | Layout Arena |
     | `ui.arena.layoutSub` | Flat table: big cards in the center, piles and score on the edges. Beta. | Mesa plana: cartas grandes no centro, pilhas e placar nas bordas. Beta. |
- **Gate**: protocolo §4.4 + `node e2e/shots/_2d-freeze.mjs --tag depois` (e `--view 3d`) vs
  `antes` com `_png-diff.mjs` = 0 px; `npm run e2e:ui2` (o fluxo do ☰ ainda acha o 3D como
  primeiro switch); `npm run e2e:journey`; `npx vitest run` (i18nUsage cobre as 3 chaves).
- **Aceite**: no navegador (`?ui=2`), ligar "Layout Arena" nos Ajustes → a mesa tem
  `.game-board--tcg`, `data-view="tcg"`, **não** tem `--3d`; ≥1041px o END TURN fica na mesa
  (não no rail). Ligar "Mesa 3D" com a Arena ativa → `--3d` e a Arena desligada.

---

### H-ATL-02 · Ganchos de marcação + probes de captura e de toque (esqueleto) · **M** · dep.: 01

- **Objetivo**: os 3 ganchos sem efeito visual e as ferramentas que provam os lotes seguintes.
- **Arquivos tocados (ganchos)** — `src/App.tsx`:
  1. `PlayerBand`: nova prop obrigatória `seat: "top" | "bottom"`; no `<div className="player-band…">`
     adicionar `data-seat={seat}`; incluir `a.seat === b.seat &&` no `arePlayerBandPropsEqual`.
     Passar `seat="top"` no band do oponente (App.tsx:1988) e `seat="bottom"` no do jogador (:2162).
     *Por quê*: `isAi` não distingue os lados no pass-and-play; o lado de cima é sempre o `enemy`.
  2. No chip da casa do `PlayerBand` (App.tsx:1494-1496): envolver o rótulo —
     `<HouseMark house={house} small /><span className="filter-chip-label">{houseLabel(house, t)}</span>`.
     *Por quê*: a bandeja de 56px precisa esconder só o texto (fica para leitor de tela). Nenhuma
     regra existente mira `.filter-chip span` (verificado).
  3. No Desfazer do ramo `tableShell` (App.tsx:4735): `className="view-toggle console-undo"`.
- **Arquivos novos (ferramentas)**:
  1. `e2e/probes/_tcg-shots.mjs` — cópia de `_mesa-unica-shots.mjs` com:
     - `PORT = 5233`; saída padrão `docs/advisor/arena-tcg-live/tmp`.
     - flags: `--view tcg|2d|3d` (padrão `tcg`, vai para o `tableView` do SEED), `--freeze`
       (registra `context.route("**/*", r => new URL(r.request().url()).hostname === "127.0.0.1" ? r.continue() : r.abort())`
       → toda arte cai no fallback tipográfico, saída determinística), `--lang en|ptBR` (padrão en).
     - dois fixtures por tema×viewport: `leve` = `{ player: {cr:2, art:1, up:0}, opp: {cr:2, art:0, up:0} }`
       e `cheia` = o `SPEC` atual (6/1/1 cada lado). Nome: `${theme}-${w}x${h}-${spec}.png` (24 PNGs).
     - grava `report.json`: por tiro, `{ file, view, cardW: [min,max] das .battle-zone .card-tile--board, tracks: getComputedStyle(.board-content).gridTemplateRows, docScroll, innerHeight }`.
     - viewports 1440×900, 768×1024, 390×844; temas forja/aco/claro/arcano (iguais ao modelo).
  2. `e2e/probes/_tcg-hit.mjs` — esqueleto com o mesmo `startServer`/`launch` do modelo, porta 5235,
     `check(name, ok, extra)` e `exit(bad ? 1 : 0)`. Seções por lote (`L03`…`L09`) ativadas por
     `--upto NN` (padrão: a maior implementada). Neste lote só a seção `L02`: abre a partida com
     `tableView:"tcg"` em 390×844 e checa `.game-board--tcg` presente, `.game-board--3d` ausente,
     `[data-seat="top"]` e `[data-seat="bottom"]` presentes, `.console-undo` presente.
  3. `package.json` — scripts: `"e2e:tcg:shots": "node e2e/probes/_tcg-shots.mjs"`,
     `"e2e:tcg:hit": "node e2e/probes/_tcg-hit.mjs"`.
- **Baseline da v2** (fica para todos os lotes): `node e2e/probes/_tcg-shots.mjs docs/advisor/arena-tcg-live/02-v2-2d --view 2d --freeze`
  e `… 02-v2-3d --view 3d --freeze`. A partir daqui, **todo** lote roda de novo esses dois para
  uma pasta `tmp-2d`/`tmp-3d` e compara com `_png-diff.mjs` (sintaxe no cabeçalho do script): 0 px.
- **Gate**: §4.4 + freeze v1 (0 px) + freeze v2 (este lote gera a referência; rodar duas vezes
  seguidas e comparar entre si = 0 px, prova de determinismo) + `npm run e2e:tcg:hit`.
- **Aceite**: os 3 ganchos no DOM; nenhum pixel mudou nas duas versões; probes rodam.

---

### H-ATL-03 · O grid da variante + medição própria no FIT/ui2 · **L** · dep.: 02

- **Objetivo**: cada peça na sua área (§2.2/§2.3), sem polimento. O FIT e o ui2 passam a medir a
  variante com regras próprias.
- **Arquivos novos**:
  1. `src/ui/table/tcg.css` (importar em `src/main.tsx` **depois** de `./ui/screens/zones/zones.css`):
     ```css
     /* Layout Arena (docs/ARENA_TCG_LIVE_PLAN.md): a terceira visão da mesa, plana. Mesmo DOM do
        2D; bandas e console viram `display: contents` e cada peça vai para uma área do grid. Sem
        .game-board--tcg nada aqui casa — o 2D e o 3D não mudam. */

     .game-board.game-board--tcg .board-content {
       grid-template-columns: var(--nf-tcg-tray-w) minmax(0, 1fr) var(--nf-tcg-end-w) var(--nf-tcg-tray-w);
       grid-template-rows: var(--nf-tcg-strip-h) minmax(0, 1fr) var(--nf-tcg-mid-h) minmax(0, 1fr) var(--nf-tcg-seat-h) var(--nf-tcg-peek-h);
       grid-template-areas:
         "o-av   o-id   o-undo o-menu"
         "o-pile o-zone o-zone o-res"
         "turn   turn   end    end"
         "p-pile p-zone p-zone p-res"
         "p-av   house  house  house"
         "hand   hand   hand   hand";
     }

     /* As caixas somem; os filhos viram itens do grid (o FX e o drag acham tudo pelo DOM, que não mudou). */
     .game-board.game-board--tcg :is(.player-band, .turn-console) {
       display: contents;
     }

     .game-board.game-board--tcg .zone-heading,
     .game-board.game-board--tcg .player-band[data-seat="bottom"] .player-copy {
       display: none;
     }

     .game-board.game-board--tcg .player-band[data-seat="top"] .player-avatar { grid-area: o-av; justify-self: center; align-self: center; }
     .game-board.game-board--tcg .player-band[data-seat="top"] .player-copy { grid-area: o-id; justify-self: start; align-self: center; min-width: 0; max-width: calc(100% - var(--nf-tcg-backs-w)); padding-inline-start: var(--space-2); }
     .game-board.game-board--tcg .player-band[data-seat="top"] .hand-backs { grid-area: o-id; justify-self: end; align-self: center; }
     .game-board.game-board--tcg .player-band[data-seat="top"] .pile-chips { grid-area: o-pile; justify-self: center; align-self: start; }
     .game-board.game-board--tcg .player-band[data-seat="top"] .player-resources { grid-area: o-res; justify-self: center; align-self: end; }
     .game-board.game-board--tcg .console-undo { grid-area: o-undo; justify-self: end; align-self: center; }
     .game-board.game-board--tcg .table-menu-trigger { grid-area: o-menu; justify-self: center; align-self: center; }
     .game-board.game-board--tcg .battle-zone--opponent { grid-area: o-zone; }
     .game-board.game-board--tcg .turn-console-copy { grid-area: turn; justify-self: start; align-self: center; min-width: 0; max-width: 100%; padding-inline: var(--space-3); }
     .game-board.game-board--tcg .end-turn-button { grid-area: end; justify-self: end; align-self: center; margin-inline-end: var(--space-2); }
     .game-board.game-board--tcg .battle-zone--player { grid-area: p-zone; }
     .game-board.game-board--tcg .player-band[data-seat="bottom"] .pile-chips { grid-area: p-pile; justify-self: center; align-self: end; }
     .game-board.game-board--tcg .archives-action { grid-area: p-pile; justify-self: center; align-self: start; }
     .game-board.game-board--tcg .player-band[data-seat="bottom"] .player-resources { grid-area: p-res; justify-self: center; align-self: start; }
     .game-board.game-board--tcg .player-band[data-seat="bottom"] .hand-bar-info { grid-area: p-res; justify-self: center; align-self: end; }
     .game-board.game-board--tcg .player-band[data-seat="bottom"] .player-avatar { grid-area: p-av; justify-self: center; align-self: center; }
     .game-board.game-board--tcg .hand-zone { grid-area: hand; }

     /* O pill é item do grid; os insets do palco (absolute) deixam de valer. */
     .game-board.game-board--tcg .house-pill {
       position: static;
       grid-area: house;
       justify-self: center;
       align-self: center;
     }
     /* Pedido de casa: o prompt + emblemas não cabem na faixa — vira overlay logo acima dela. */
     .game-board.game-board--tcg .house-pill.house-pill--asking {
       position: absolute;
       grid-area: auto;
       z-index: 4;
       inset: auto var(--space-2) calc(var(--nf-tcg-peek-h) + var(--nf-tcg-seat-h) + var(--space-2)) var(--space-2);
       justify-self: auto;
       align-items: center;
     }

     /* Bandejas: tudo empilha e nada passa da coluna (o texto quebra em vez de vazar). */
     .game-board.game-board--tcg :is(.pile-chips, .player-resources, .hand-bar-info) {
       display: flex;
       flex-direction: column;
       align-items: center;
       gap: var(--space-1);
       min-width: 0;
       max-width: 100%;
       text-align: center;
       overflow-wrap: anywhere;
     }
     .game-board.game-board--tcg .resource-divider,
     .game-board.game-board--tcg .hand-title {
       display: none;
     }
     .game-board.game-board--tcg .pile-chip {
       min-width: var(--nf-tcg-hit);
       min-height: var(--nf-tcg-hit);
       justify-content: center;
     }
     .game-board.game-board--tcg .pile-chip-label {
       display: none; /* o aria-label do botão já diz "Descarte de X: N" */
     }
     .game-board.game-board--tcg .key-pips {
       flex-direction: column;
     }
     .game-board.game-board--tcg .amber-counter {
       flex-direction: column;
     }
     /* No celular a bandeja tem 56px: o nome da casa fica só para o leitor de tela. */
     .game-board.game-board--tcg .player-resources .filter-chip-label {
       position: absolute;
       width: 1px;
       height: 1px;
       overflow: hidden;
       clip-path: inset(50%);
       white-space: nowrap;
     }
     @media (min-width: 701px) {
       .game-board.game-board--tcg .key-pips { flex-direction: row; }
       .game-board.game-board--tcg .player-resources .filter-chip-label { position: static; width: auto; height: auto; overflow: visible; clip-path: none; white-space: normal; }
     }

     /* A instrução de alvo vive no topo da sua zona, que aqui é estreita: quebra em vez de estourar. */
     .game-board.game-board--tcg .fight-instruction {
       max-width: calc(100% - var(--space-4));
       flex-wrap: wrap;
       justify-content: center;
       white-space: normal;
     }
     ```
  2. `src/ui/tokens.css` — bloco **4** ao fim (valores da §2.4, D1-A até o dono decidir):
     ```css
     /* 4) MESA TCG (H-ATL, docs/ARENA_TCG_LIVE_PLAN.md §2.4) — geometria da variante; só é lida
        sob .game-board--tcg. A ordem dos @media importa: a altura baixa vem por último. */
     :root {
       --nf-tcg-tray-w: 56px; --nf-tcg-end-w: 120px;
       --nf-tcg-strip-h: 48px; --nf-tcg-mid-h: 60px; --nf-tcg-seat-h: 52px; --nf-tcg-peek-h: 92px;
       --nf-tcg-hand-w: 72px; --nf-tcg-board-min: 64px; --nf-tcg-board-max: 132px; --nf-tcg-board-chrome: 26px;
       --nf-tcg-end-h: 52px; --nf-tcg-hit: 44px; --nf-tcg-backs-w: 48px; --nf-tcg-back-w: 10px; --nf-tcg-back-h: 14px;
       --nf-tcg-fan-deg: 3deg; --nf-tcg-fan-drop: 2px; --nf-tcg-fan-drop-max: 6px;
       --nf-tcg-tip-w: 22rem; --nf-tcg-ring: 22vmin; --nf-tcg-ring-w: 2px; --nf-tcg-chalk: 22px;
     }
     @media (min-width: 701px) {
       :root {
         --nf-tcg-tray-w: 88px; --nf-tcg-end-w: 152px; --nf-tcg-strip-h: 52px; --nf-tcg-mid-h: 64px;
         --nf-tcg-seat-h: 56px; --nf-tcg-peek-h: 112px; --nf-tcg-hand-w: 92px; --nf-tcg-board-min: 72px;
         --nf-tcg-board-max: 150px; --nf-tcg-end-h: 56px; --nf-tcg-backs-w: 72px;
       }
     }
     @media (min-width: 1041px) {
       :root { --nf-tcg-tray-w: 104px; --nf-tcg-end-w: 168px; --nf-tcg-peek-h: 124px; --nf-tcg-hand-w: 104px; --nf-tcg-board-max: 168px; }
     }
     @media (min-width: 701px) and (max-height: 759px) {
       :root { --nf-tcg-strip-h: 46px; --nf-tcg-mid-h: 56px; --nf-tcg-seat-h: 52px; --nf-tcg-peek-h: 96px; --nf-tcg-hand-w: 84px; }
     }
     @media (max-height: 600px) {
       :root { --nf-tcg-strip-h: 44px; --nf-tcg-mid-h: 52px; --nf-tcg-seat-h: 52px; --nf-tcg-peek-h: 72px; --nf-tcg-hand-w: 60px; --nf-tcg-board-min: 52px; --nf-tcg-end-h: 52px; }
     }
     ```
- **Arquivos tocados (harness — só adições)**:
  1. `e2e/fit.mjs`
     - Ler `--view` como string: `const VIEW = process.argv.includes("--view") ? process.argv[process.argv.indexOf("--view") + 1] : "2d";`
       `const VIEW3D = VIEW === "3d";` (o resto do uso de `VIEW3D` não muda). No `SEED`, trocar o
       trecho do 3D por `${VIEW !== "2d" ? \` tableView: "${VIEW}",\` : ""}`.
     - No `MEASURE`: `const isTcg = Boolean(document.querySelector(".game-board--tcg"));`. Com
       `isTcg`, `rows` vira `{ header, screenPadding, title, boardBorder, tracks, tabs }` onde
       `tracks = getComputedStyle(document.querySelector(".game-board .board-content")).gridTemplateRows.split(" ").reduce((a, v) => a + (parseFloat(v) || 0), 0)`.
       Devolver também `isTcg` e `clash`: lista de pares que se sobrepõem (interseção > 1px²)
       entre os retângulos visíveis de: `.battle-zone--opponent`, `.battle-zone--player`,
       `[data-seat=top] .player-avatar`, `[data-seat=top] .player-copy`, `[data-seat=top] .pile-chips`,
       `[data-seat=top] .player-resources`, `.turn-console-copy`, `.end-turn-button`,
       `[data-seat=bottom] .pile-chips`, `[data-seat=bottom] .player-resources`,
       `[data-seat=bottom] .hand-bar-info`, `[data-seat=bottom] .player-avatar`, `.house-pill`,
       `.table-menu-trigger`, `.console-undo` — e `outside`: os que saem do retângulo do `.game-board` (±1px).
     - No `report`: com `m.isTcg`, (a) o documento não pode rolar em **nenhuma** largura
       (`m.docScroll > m.innerHeight + 1` reprova também < 701); (b) `clash`/`outside` não vazios
       reprovam; (c) mão: regra da **DECISÃO D1** (A: cada carta ≥70% visível dentro do board,
       a mesma conta do ramo `is3d`; B: 100% visível, a conta do 2D). O `spill` das peças (já
       existente para não-3D) segue valendo.
     - `package.json`: `"e2e:fit:tcg": "node e2e/fit.mjs --view tcg"`.
  2. `e2e/ui2.mjs` — `TABLE_VIEWS` vira `["2d", "3d", "tcg"]`; no `TABLE_MEASURE`, com
     `.game-board--tcg` presente, `rows = { mainPadding, screenPadding, boardBorder, tracks }`
     (mesma soma de trilhas acima). A tolerância (±1) e os demais critérios do fluxo de mesa são
     os mesmos do 2D; a mão segue a D1.
  3. `e2e/capture.mjs` — aceitar `--view tcg` (a validação hoje aceita só 2d/3d; o piso usado é o
     do 2D, sem projeção). `package.json`: `"e2e:floor:tcg": "node e2e/capture.mjs --floor-only --view tcg"`.
  4. `e2e/probes/_tcg-hit.mjs` — seção `L03` em 360×844, 390×844, 768×1024, 1440×900: nenhum
     `.board-piece` fora da sua `.battle-zone`; `.fight-instruction` (forçar com
     `document.querySelector(".battle-zone--player")` + checar só o CSS computado:
     `white-space === "normal"`) ; `elementFromPoint` no centro de cada `.pile-chip`,
     `.end-turn-button`, `.table-menu-trigger` e `.house-choice` devolve o próprio elemento (nada cobre).
- **Gate**: §4.4 + `npm run e2e:fit:tcg` (vazia e 8×8+artefato, 7 viewports) + `npm run e2e:ui2`
  (2D/3D inalterados + tcg passando) + `npm run e2e:floor:tcg` + `npm run e2e:tcg:hit -- --upto 03`
  + freeze v1 e v2 = 0 px + `e2e:tcg:shots` para `docs/advisor/arena-tcg-live/03`.
- **Aceite**: FIT tcg OK nos 7 viewports com `soma = viewport ±1`; zero `clash`/`outside`;
  as capturas mostram a anatomia da §2.2 (mesmo que crua).

---

### H-ATL-04 · Bandejas e faixas (placar tingido, pilhas, dorsos, mão/baralho) · **M** · dep.: 03

- **Objetivo**: o mobiliário de borda com a leitura do Pokémon: placar do oponente (ember) acima
  do meio, o seu (ether) abaixo; pilhas como fichas; dorsos do Warden na faixa do topo.
- **Arquivo tocado**: `src/ui/table/tcg.css` (anexar):
  ```css
  /* Cor do lado: herdada pelos filhos (custom property atravessa display: contents). */
  .game-board.game-board--tcg .player-band[data-seat="top"] { --tcg-seat: var(--nf-ember); }
  .game-board.game-board--tcg .player-band[data-seat="bottom"] { --tcg-seat: var(--nf-ether); }

  .game-board.game-board--tcg .player-resources {
    padding: var(--space-2) var(--space-1);
    border: 1px solid color-mix(in srgb, var(--tcg-seat) 55%, transparent);
    border-radius: var(--radius-lg);
    color: var(--nf-text);
    background: color-mix(in srgb, var(--tcg-seat) 14%, var(--nf-s2));
    box-shadow: var(--nf-elev-1);
  }
  .game-board.game-board--tcg .amber-value { font-size: var(--fs-xl); line-height: 1; }
  .game-board.game-board--tcg .amber-counter small { font-size: var(--fs-3xs); letter-spacing: 0.12em; text-transform: uppercase; }

  .game-board.game-board--tcg .pile-chips .pile-chip {
    flex-direction: column;
    gap: 0;
    height: auto;
    padding: var(--space-1);
    border-radius: var(--radius-md);
  }

  .game-board.game-board--tcg .hand-bar-info {
    padding: var(--space-1);
    border-radius: var(--radius-md);
    color: var(--nf-text-2);
    background: color-mix(in srgb, var(--nf-s2) 80%, transparent);
    font-size: var(--fs-2xs);
  }

  /* Vez: o avatar de quem joga ganha anel na cor da casa + o ponto "ao vivo" que já existe
     (estado nunca só por cor). */
  .game-board.game-board--tcg .player-band--active .player-avatar {
    box-shadow: 0 0 0 var(--space-1) color-mix(in srgb, var(--turn-house) 70%, transparent);
  }

  /* Dorsos da mão do Warden (públicos no KeyForge): leque raso na faixa do topo; o voo da
     carta jogada pela IA nasce do último (FxLayer, sem mudança). */
  .game-board.game-board--tcg .hand-backs {
    display: inline-flex;
    align-items: center;
    padding-inline-start: calc(var(--nf-tcg-back-w) / 2);
    margin-inline-end: var(--space-2);
  }
  .game-board.game-board--tcg .hand-backs i {
    display: block;
    width: var(--nf-tcg-back-w);
    height: var(--nf-tcg-back-h);
    margin-inline-start: calc(var(--nf-tcg-back-w) / -2);
    border: 1px solid var(--nf-line-strong);
    border-radius: var(--radius-sm);
    background: linear-gradient(160deg, var(--nf-accent-deep), var(--nf-s3));
  }
  .game-board.game-board--tcg .hand-backs b {
    margin-inline-start: var(--space-1);
    color: var(--nf-text-2);
    font-size: var(--fs-2xs);
  }
  .game-board.game-board--tcg .player-copy strong { font-size: var(--fs-sm); }
  .game-board.game-board--tcg .player-deck-name { font-size: var(--fs-2xs); }
  ```
  Se algum seletor-filho acima (`.amber-value`, `.amber-counter small`, `.player-copy strong`)
  não existir no DOM: **parar e reportar** (não inventar classe).
- **Gate**: §4.4 + `e2e:fit:tcg` + `e2e:floor:tcg` + `e2e:ui2` + `e2e:tcg:hit --upto 04`
  (seção L04: `.player-resources` do topo tem `bottom` ≤ topo do `.end-turn-button`; a de baixo
  tem `top` ≥ base do `.end-turn-button`; cada `.pile-chip` ≥ 44×44; `.hand-backs` visível com
  `offsetWidth > 0` só no topo) + freezes 0 px + `e2e:tcg:shots` → `…/04`.
- **Aceite (dono, nas capturas)**: o placar do oponente e o seu ladeiam a linha do meio, com
  cores diferentes **e** posições diferentes; pilhas legíveis como fichas nos 4 temas.

---

### H-ATL-05 · Cartas protagonistas no centro · **S** · dep.: 04

- **Objetivo**: criaturas grandes (o eixo central manda).
- **Arquivo tocado**: `src/ui/table/tcg.css`:
  ```css
  /* A zona continua container de tamanho (FIT-03); só os tokens são da variante. */
  .game-board.game-board--tcg .battle-zone {
    padding: var(--space-2) var(--space-1);
  }
  .game-board.game-board--tcg .card-tile--board {
    width: clamp(
      var(--nf-tcg-board-min),
      min(
        calc((100cqh - var(--nf-tcg-board-chrome)) * 0.714),
        calc((100cqw - var(--space-5) - (var(--nc, 1) - 1) * var(--space-2)) / var(--nc, 1))
      ),
      var(--nf-tcg-board-max)
    );
  }
  /* Lane cheia rola de lado com encaixe; `safe center` nunca esconde a primeira carta. */
  .game-board.game-board--tcg .board-lane {
    justify-content: safe center;
    gap: var(--space-2);
    scroll-snap-type: x proximity;
  }
  .game-board.game-board--tcg .board-lane > .board-piece {
    scroll-snap-align: center;
  }
  ```
- **Gate**: §4.4 + `e2e:fit:tcg` (o `spill` e o `cartaBoard` impressos) + `e2e:tcg:shots` → `…/05`.
  Critério objetivo, lido do `report.json` do fixture `leve` comparado ao do
  `02-v2-2d/report.json` (mesmo fixture, 2D): **largura mínima das cartas de battleline ≥ 1,4×
  a do 2D em 390×844 e 768×1024, e ≥ 1,2× em 1440×900**. Fixture `cheia`: nenhuma carta abaixo
  de `--nf-tcg-board-min` e a primeira peça de cada lane visível (`scrollLeft === 0` mostra a
  borda esquerda da 1ª peça dentro da zona).
- **Aceite**: critério acima + o dono vê, nas capturas `leve`, a battleline como protagonista.

---

### H-ATL-06 · Linha do meio: END TURN pílula + turno + ☰ no canto · **S** · dep.: 05

- **Arquivo tocado**: `src/ui/table/tcg.css`:
  ```css
  .game-board.game-board--tcg .end-turn-button {
    min-width: var(--nf-tcg-hit);
    min-height: var(--nf-tcg-end-h);
    max-width: 100%;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border: 2px solid var(--nf-accent-hi);
    border-radius: var(--radius-pill);
    font-size: var(--fs-sm);
    font-weight: var(--fw-bold);
    letter-spacing: 0.06em;
    line-height: 1.05;
    text-transform: uppercase;
    /* A casa do turno tinge o anel (o rótulo diz o estado; a cor só acompanha). */
    box-shadow: 0 0 0 var(--space-1) color-mix(in srgb, var(--turn-house) 70%, transparent), var(--nf-elev-2);
  }
  /* No celular o 2D mostra só o ícone; aqui o rótulo é o botão (2 linhas no pt: TERMINAR / TURNO). */
  .game-board.game-board--tcg .end-turn-button > span {
    display: inline;
    max-width: 8ch;
    text-align: center;
    text-wrap: balance;
  }
  .game-board.game-board--tcg .end-turn-button:disabled {
    border-color: var(--nf-line-strong);
    color: var(--nf-text-3);
    background: var(--nf-s3);
    box-shadow: none;
    cursor: default;
  }
  .game-board.game-board--tcg .end-turn-button:focus-visible {
    outline: 2px solid var(--nf-accent-hi);
    outline-offset: var(--space-1);
  }

  .game-board.game-board--tcg .turn-console-copy {
    color: var(--nf-text);
    font-size: var(--fs-2xs);
  }
  .game-board.game-board--tcg .turn-line {
    flex-wrap: wrap;
    row-gap: 0;
  }
  .game-board.game-board--tcg .turn-line-summary {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
  ```
  Se `.turn-line` / `.turn-line-summary` / `.round-kicker` tiverem regras do 2D que os tiram de
  linha (nowrap/ellipsis): sobrescrever **só** `white-space: normal` aqui; nada mais.
- **Gate**: §4.4 + `e2e:fit:tcg` + `e2e:floor:tcg` + `e2e:ui2` + `e2e:tcg:hit --upto 06` (seção L06:
  pílula ≥ 44 de largura e ≥ `--nf-tcg-end-h` de altura, dentro do viewport, centro não coberto;
  com `language:"ptBR"` o rótulo cabe na área `end` sem `scrollWidth > clientWidth` no botão;
  clicar encerra o turno → o botão fica `disabled`) + freezes 0 px + shots → `…/06`.
- **Aceite**: pílula legível e grande nos 4 temas, desabilitada visivelmente na vez do Warden
  (cinza **e** sem anel) e com anel da casa na sua vez.

---

### H-ATL-07 · Mão em leque espiando (drag-to-play intacto) · **M** · dep.: 06 · **DECISÃO D1**

- **Objetivo**: a mão é um leque baixo, cortado pela borda do board (D1-A) ou inteiro (D1-B);
  toque seleciona e ergue; arrastar para cima joga — o `useHandDrag` não muda.
- **Antes**: aplicar em `tokens.css` os valores de `--nf-tcg-peek-h` da opção escolhida (§2.4).
- **Arquivo tocado**: `src/ui/table/tcg.css`:
  ```css
  /* O leque ocupa a largura da faixa; a sobreposição sai da conta (n cartas cabem sempre). */
  .game-board.game-board--tcg .hand-zone {
    container-type: inline-size;
    padding: 0;
  }
  .game-board.game-board--tcg .hand-track {
    justify-content: center;
    align-items: flex-start;
    flex-wrap: nowrap;
    gap: 0;
    overflow: visible;
    padding: var(--space-2) var(--space-3) 0;
    scroll-snap-type: none;
  }
  .game-board.game-board--tcg .hand-track > .card-tile--hand {
    --d: calc(var(--i, 0) - (var(--n, 1) - 1) / 2);
    --ov: max(0px, (var(--n, 1) * var(--nf-tcg-hand-w) - (100cqw - 2 * var(--space-3))) / max(1, var(--n, 1) - 1));
    position: relative;
    flex: 0 0 auto;
    width: var(--nf-tcg-hand-w);
    margin-inline: calc(var(--ov) / -2);
    transform-origin: 50% 130%;
    rotate: calc(var(--d) * var(--nf-tcg-fan-deg));
    translate: 0 min(calc(var(--d) * var(--d) * var(--nf-tcg-fan-drop)), var(--nf-tcg-fan-drop-max));
    transition: rotate var(--dur-base) var(--ease-out), translate var(--dur-base) var(--ease-out), scale var(--dur-base) var(--ease-out);
  }
  .game-board.game-board--tcg .hand-track > .card-tile--hand > .card-art { width: 100%; }
  /* O nome está na arte e no aria-label do botão; a legenda sairia pela borda. */
  .game-board.game-board--tcg .hand-track > .card-tile--hand .card-caption { display: none; }

  .game-board.game-board--tcg .hand-track > .card-tile--hand:nth-child(1) { --i: 0; }
  /* … uma regra por posição até :nth-child(12) { --i: 11; } — mesmo padrão do H3D-06 */

  /* Seleção e foco erguem (informação: vale no reduce-motion). O transform da onda 1 sai. */
  .game-board.game-board--tcg .hand-track > .card-tile--hand:is(.is-selected, :focus-visible) {
    z-index: 5;
    transform: none;
    rotate: 0deg;
    translate: 0 -35%;
    scale: 1.1;
  }
  @supports (width: calc(sibling-index() * 1px)) {
    .game-board.game-board--tcg .hand-track > .card-tile--hand { --i: sibling-index(); }
  }
  @media (hover: hover) and (prefers-reduced-motion: no-preference) {
    html:not(.reduce-motion) .game-board.game-board--tcg .hand-track > .card-tile--hand:not(:disabled):hover {
      z-index: 5;
      transform: none;
      rotate: 0deg;
      translate: 0 -35%;
      scale: 1.1;
    }
  }
  ```
  (Escrever as 12 regras `nth-child` por extenso — o comentário acima é só para o plano.)
- **Gate**: §4.4 + `e2e:fit:tcg` (regra da mão da D1) + `e2e:ui2` + `e2e:tcg:hit --upto 07`.
  Seção L07, em 390×844, 768×1024 e 1440×900, com um save fixo (fixture do `_tcg-shots` com a
  casa ativa e a battleline do jogador **vazia**):
  1. **Toque**: para cada carta `i < n-1`, o ponto no meio da faixa visível
     (`x = (left_i + left_{i+1}) / 2`, `y = top + 20`) devolve a carta `i` no `elementFromPoint`;
     com n ≤ 7, cada faixa visível tem ≥ 44px. Clique → `.is-selected` nela.
  2. **Arrastar e jogar**: `mouse.down` no centro visível de uma carta não-`is-dimmed`, `move`
     40px para cima em 4 passos, `move` até o centro de `.battle-zone--player`, `up` →
     `.battle-zone--player .board-piece` passa de 0 para 1 (ou aparece `.fight-instruction`
     de flanco → escolher "Left" e então 1).
  3. **Snap-back**: arrastar 40px para cima e soltar sobre `.player-band[data-seat=top] .player-avatar`
     → nenhuma peça nova e a mão com o mesmo `n`.
  4. **Lateral não arrasta**: `move` 40px para o lado → nenhum `.drag-ghost` no DOM.
  5. **Mão em repouso**: regra da D1 por carta (o mesmo cálculo do FIT).
  E: freezes 0 px + shots → `…/07` + `node e2e/fit.mjs --coach` (2D) inalterado.
- **Aceite**: os 5 checks; nas capturas o leque lê como "cartas espiando".

---

### H-ATL-08 · Playmat plano por tema · **S** · dep.: 07

- **Objetivo**: o tapete do Pokémon traduzido para a casa: metade do oponente puxando para ember,
  a sua para ether, anel da forja centrado na linha do meio, giz pontilhado; o lado de quem joga
  acende na cor da casa (o `--turn-house`/`--turn-y` que o board já publica). Só gradientes com
  tokens — nada de imagem, SVG ou fonte.
- **Arquivo tocado**: `src/ui/table/tcg.css`:
  ```css
  /* Centro vertical da linha do meio (as trilhas não são simétricas: a faixa de baixo + a mão
     pesam mais). % aqui é da caixa do fundo. */
  .game-board.game-board--tcg {
    --tcg-mid-y: calc(var(--nf-tcg-strip-h) + (100% - var(--nf-tcg-strip-h) - var(--nf-tcg-mid-h) - var(--nf-tcg-seat-h) - var(--nf-tcg-peek-h)) / 2 + var(--nf-tcg-mid-h) / 2);
    background:
      radial-gradient(ellipse 70% 38% at 50% var(--turn-y), color-mix(in srgb, var(--turn-house) 14%, transparent), transparent 70%),
      linear-gradient(180deg,
        color-mix(in srgb, var(--nf-ember) 9%, var(--nf-felt)) 0 var(--tcg-mid-y),
        color-mix(in srgb, var(--nf-ether) 9%, var(--nf-felt)) var(--tcg-mid-y) 100%);
    background-color: var(--nf-felt);
  }
  .game-board.game-board--tcg .felt-etching {
    inset: 0;
    border: 0;
    border-radius: inherit;
    background:
      radial-gradient(circle at 50% var(--tcg-mid-y),
        transparent 0 calc(var(--nf-tcg-ring) - var(--nf-tcg-ring-w)),
        color-mix(in srgb, var(--nf-accent) 32%, transparent) calc(var(--nf-tcg-ring) - var(--nf-tcg-ring-w)) var(--nf-tcg-ring),
        transparent var(--nf-tcg-ring)),
      radial-gradient(circle at 50% var(--tcg-mid-y),
        color-mix(in srgb, var(--nf-accent) 9%, transparent) 0 calc(var(--nf-tcg-ring) * 0.55),
        transparent calc(var(--nf-tcg-ring) * 0.55)),
      radial-gradient(circle, color-mix(in srgb, var(--nf-felt-text) 9%, transparent) 0 1px, transparent 2px) 0 0 / var(--nf-tcg-chalk) var(--nf-tcg-chalk);
  }
  ```
  O fundo do `.game-board` no 2D é declarado no `index.css:831`; esta regra vence por ordem de
  carga e especificidade (0,2,0). Se a captura mostrar o fundo do 2D: **parar e reportar**.
- **Gate**: §4.4 + `e2e:floor:tcg` + `e2e:ui2` (item 5: nenhuma animação nova) + freezes 0 px +
  shots → `…/08` (forja/aco/claro/arcano). Contraste: nenhum texto novo; os chips do lote 04
  ficam sobre `--nf-s2` misturado, não sobre o mat.
- **Aceite (dono)**: o mat lê como "arena" nos 4 temas; no Claro o anel aparece sem escurecer
  o texto das bandejas.

---

### H-ATL-09 · Dica contextual do turno (balão "coach") · **M** · dep.: 08 · **DECISÃO D2**

- **Objetivo**: o jogo ensina jogando — um balão invertido sobre a base da sua zona diz a
  próxima coisa útil do turno. Nunca rouba foco; não aparece junto do Coachmark guiado.
- **Arquivos novos**:
  1. `src/ui/lib/arenaTip.ts` (puro):
     ```ts
     // H-ATL-09: a dica do Layout Arena. PURA: lê só o que o jogador vê (casa, cartas jogáveis,
     // criaturas usáveis) e devolve a próxima ação útil. A ordem é a do turno do KeyForge.
     export type ArenaTip =
       | { key: "pickHouse" }
       | { key: "play"; count: number; house: string }
       | { key: "use"; count: number; house: string }
       | { key: "endTurn"; house: string };

     export interface ArenaTipInput {
       /** Vez do humano que segura o aparelho, sem mulligan/vencedor/pass screen/replay. */
       yourTurn: boolean;
       /** Escolha pendente (alvo/casa/flanco) ou Warden agindo: a UI já está pedindo outra coisa. */
       busy: boolean;
       activeHouse: string | null;
       /** Cartas distintas da mão com "play" legal. */
       playable: number;
       /** Criaturas distintas com reap/fight/use legal. */
       usable: number;
     }

     export function arenaTipOf(input: ArenaTipInput): ArenaTip | null {
       if (!input.yourTurn || input.busy) return null;
       if (input.activeHouse === null) return { key: "pickHouse" };
       if (input.playable > 0) return { key: "play", count: input.playable, house: input.activeHouse };
       if (input.usable > 0) return { key: "use", count: input.usable, house: input.activeHouse };
       return { key: "endTurn", house: input.activeHouse };
     }
     ```
  2. `src/ui/lib/arenaTip.test.ts` — 6 casos: fora da vez → null; `busy` → null; sem casa →
     pickHouse; jogáveis > 0 → play (com count/house); só usáveis → use; nada → endTurn.
  3. `src/ui/table/ArenaTip.tsx`:
     ```tsx
     import { X } from "lucide-react";
     import type { Translator } from "../../lib/i18n";
     import { houseLabel } from "../../lib/houses";
     import type { ArenaTip as Tip } from "../lib/arenaTip";

     // H-ATL-09: o balão vive DENTRO do grid (área p-zone, sem trilha própria: folga zero) e
     // nunca pega foco — é uma região viva educada; só o × recebe toque.
     export function ArenaTip({ t, tip, onDismiss }: { t: Translator; tip: Tip; onDismiss: () => void }) {
       const text =
         tip.key === "pickHouse" ? t("ui.arena.tip.pickHouse")
         : tip.key === "play" ? t("ui.arena.tip.play", { count: tip.count, house: houseLabel(tip.house, t) })
         : tip.key === "use" ? t("ui.arena.tip.use", { count: tip.count, house: houseLabel(tip.house, t) })
         : t("ui.arena.tip.endTurn", { house: houseLabel(tip.house, t) });
       return (
         <div className="nf-tcg-tip" role="status" aria-live="polite" data-tip={tip.key}>
           <p className="nf-tcg-tip-text">
             <span className="nf-tcg-tip-eyebrow">{t("ui.arena.tip.label")}</span>
             {text}
           </p>
           <button type="button" className="nf-tcg-tip-close" onClick={onDismiss} aria-label={t("ui.arena.tip.dismiss")} title={t("ui.arena.tip.dismiss")}>
             <X size={16} aria-hidden="true" />
           </button>
         </div>
       );
     }
     ```
     (Conferir a assinatura de `houseLabel` em `src/lib/houses.ts` — regra 4: estável.)
- **Arquivos tocados**:
  1. `src/App.tsx` — `GameBoard`:
     - props novas: `tips?: boolean;` (padrão `false`) e `onMuteTips?: () => void;` (padrão `NOOP`).
     - depois do `hintIds`:
       ```ts
       // H-ATL-09: contagens da dica do Layout Arena — só quando ela pode aparecer (mesmo motor da hint).
       const tipCounts = useMemo(() => {
         if (!tcg || !tips || !isHumanTurn || !game.activeHouse) return null;
         const moves = getLegalMoves(game, humanSide, game.activeHouse);
         return {
           playable: new Set(moves.flatMap((move) => (move.type === "play" ? [move.instanceId] : []))).size,
           usable: new Set(moves.flatMap((move) => (move.type === "reap" || move.type === "use" ? [move.instanceId] : move.type === "fight" ? [move.attackerId] : []))).size,
         };
       }, [tcg, tips, isHumanTurn, game, humanSide]);
       const tip = tcg && tips
         ? arenaTipOf({ yourTurn: isHumanTurn, busy: Boolean(pick) || aiPhase !== "idle", activeHouse: game.activeHouse, playable: tipCounts?.playable ?? 0, usable: tipCounts?.usable ?? 0 })
         : null;
       ```
       (A declaração `const tcg` do lote 01 precisa vir **antes** deste bloco — mover a linha
       para logo depois de `isHumanTurn` se preciso.)
     - render: logo depois do `</section>` da `.hand-zone`, ainda dentro do `.board-content`:
       `{tip && <ArenaTip t={t} tip={tip} onDismiss={onMuteTips} />}`
     - no `App`: `const [tipsMutedSeed, setTipsMutedSeed] = useState<number | null>(null);` e no
       `<GameBoard>` principal (não no do replay): conforme a **D2**:
       - **D2-A**: `tips={settings.hints && coach === "done" && tipsMutedSeed !== game.seed}`
       - **D2-B**: `tips={coach === "done" && tipsMutedSeed !== game.seed}`
       - **D2-C**: `tips={settings.arenaTips && coach === "done" && tipsMutedSeed !== game.seed}` + o
         ajuste novo (ver §8).
       e `onMuteTips={() => setTipsMutedSeed(game.seed)}`.
     - Com a variante ligada, a `.hand-prompt` (dica antiga de casa na barra da mão) sai —
       anexar ao `tcg.css`: `.game-board.game-board--tcg .hand-prompt { display: none; }`.
  2. `src/ui/table/tcg.css` (anexar):
     ```css
     /* Balão invertido (o branco do Pokémon é o --nf-text sobre --nf-void em qualquer tema).
        Item do grid na área p-zone: não cria trilha; não bloqueia toque (só o × recebe). */
     .game-board.game-board--tcg .nf-tcg-tip {
       z-index: 3;
       grid-area: p-zone;
       justify-self: center;
       align-self: end;
       display: flex;
       align-items: center;
       gap: var(--space-2);
       max-width: min(calc(100% - var(--space-4)), var(--nf-tcg-tip-w));
       margin-block-end: var(--space-2);
       padding: var(--space-1) var(--space-1) var(--space-1) var(--space-4);
       border-radius: var(--radius-lg);
       color: var(--nf-void);
       background: var(--nf-text);
       box-shadow: var(--nf-elev-2);
       pointer-events: none;
       animation: nf-tcg-tip-in var(--dur-base) var(--ease-out) backwards;
     }
     .nf-tcg-tip-text { margin: 0; font-size: var(--fs-sm); line-height: 1.3; }
     .nf-tcg-tip-eyebrow { display: block; font-size: var(--fs-3xs); font-weight: var(--fw-bold); letter-spacing: 0.12em; text-transform: uppercase; }
     .nf-tcg-tip-close {
       display: grid;
       flex: 0 0 auto;
       place-items: center;
       width: var(--nf-tcg-hit);
       height: var(--nf-tcg-hit);
       padding: 0;
       border: 0;
       border-radius: var(--radius-pill);
       color: inherit;
       background: transparent;
       pointer-events: auto;
       cursor: pointer;
     }
     .nf-tcg-tip-close:focus-visible { outline: 2px solid var(--nf-void); outline-offset: 0; }
     @keyframes nf-tcg-tip-in { from { opacity: 0; translate: 0 var(--space-2); } }
     .game-board.no-anim .nf-tcg-tip { animation: none; }
     html.reduce-motion .nf-tcg-tip { animation: none; }
     @media (prefers-reduced-motion: reduce) { .nf-tcg-tip { animation: none; } }
     ```
  3. `src/lib/i18n.ts` — bloco `ui.arena.*`:
     | Chave | en | pt-BR |
     |---|---|---|
     | `ui.arena.tip.label` | Tip | Dica |
     | `ui.arena.tip.pickHouse` | Choose a house below: only its cards can be played and used this turn. | Escolha uma casa abaixo: só as cartas dela podem ser jogadas e usadas neste turno. |
     | `ui.arena.tip.play` | {house} cards you can play: {count}. Drag one to your battleline or tap it. | Cartas de {house} que você pode jogar: {count}. Arraste uma para a sua linha ou toque nela. |
     | `ui.arena.tip.use` | {house} creatures ready to reap or fight: {count}. Tap one to use it. | Criaturas de {house} prontas para colher ou lutar: {count}. Toque em uma para usar. |
     | `ui.arena.tip.endTurn` | Nothing left to do with {house}. End your turn. | Nada mais a fazer com {house}. Encerre o turno. |
     | `ui.arena.tip.dismiss` | Hide tips for this match | Ocultar dicas nesta partida |
- **Gate**: §4.4 + `npx vitest run` (arenaTip + i18nUsage) + `e2e:fit:tcg` (com a dica visível:
  soma inalterada — a dica não cria trilha; incluir `.nf-tcg-tip` na lista de `clash` **só**
  contra `.house-pill`, `.end-turn-button` e `.player-resources`) + `node e2e/fit.mjs --coach --view tcg`
  (Coachmark aparece **e** `.nf-tcg-tip` ausente) + `e2e:ui2` (item 5: após 600ms nenhuma
  animação rodando) + `e2e:tcg:hit --upto 09`. Seção L09 (390×844 e 1440×900):
  1. no começo do seu turno, `[data-tip="pickHouse"]` existe, `role=status`, `aria-live=polite`;
  2. `document.activeElement` é o mesmo antes e depois da dica aparecer (registrar antes do
     reload/turno e comparar o `tagName`+classe);
  3. escolher a casa → `data-tip` vira `play` ou `use` ou `endTurn`;
  4. `elementFromPoint` no centro da dica cai **na carta/zona por baixo** (pointer-events),
     exceto no `×`;
  5. `×` → a dica some e não volta após encerrar o turno e o Warden jogar;
  6. `e2e:tcg:hit` em `?ui=1` com `tableView:"tcg"` gravado: nenhum `.nf-tcg-tip`, nenhum `--tcg`.
  E freezes 0 px + shots → `…/09`.
- **Aceite (dono)**: a dica certa em cada momento do turno, sem tapar o seletor de casa nem o
  END TURN; legível nos 4 temas.

---

### H-ATL-10 · Retrato da variante (fechamento) · **S** · dep.: 09

- **Objetivo**: a bateria inteira + o dossiê para o dono julgar. Sem código de produto.
- **Arquivos novos**: `docs/advisor/arena-tcg-live/10-retrato/RETRATO.md` com:
  1. tabela gate → resultado (todos os do §6) e o total do vitest vs baseline;
  2. as capturas finais `node e2e/probes/_tcg-shots.mjs docs/advisor/arena-tcg-live/10-retrato`
     (en) e `… 10-retrato/pt --lang ptBR`;
  3. lado a lado por viewport (forja, `leve`): `02-v2-2d` (antes) × `10-retrato` (depois);
  4. as medidas do `report.json` (largura de carta 2D × tcg) e a lista de riscos residuais
     (§7) com o estado de cada um;
  5. o número do bundle (`npm run e2e:bundle`) — informativo.
- **Arquivo tocado**: `CLAUDE.md` — um parágrafo curto em "Rules that must not be broken" item 10
  ou logo depois: "**Layout Arena (`tableView:"tcg"`, H-ATL)**: terceira visão, plana, só v2;
  CSS em `src/ui/table/tcg.css` escopado em `.game-board.game-board--tcg`; tokens `--nf-tcg-*`;
  gates `e2e:fit:tcg`, `e2e:floor:tcg`, `e2e:tcg:hit`, `e2e:tcg:shots`; o ui2 mede `tcg` pela
  soma das trilhas do grid." e os 4 scripts na seção Commands.
- **Gate**: tudo do §6, numa rodada só, sem nenhum retry.
- **Aceite**: o dono aprova o retrato (ou devolve itens pontuais por lote).

---

## 6. Gates por lote (matriz)

| Gate | 00 | 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `npm run typecheck` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `npx vitest run` (≥ baseline) | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `npm run lint:ui2` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `e2e:fit` / `--view 3d` (faixas idênticas ao 00) | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `e2e:floor` / `e2e:floor:3d` / `e2e:arena` | ● | ● | ● | ● | | | | ● | | ● | ● |
| `_2d-freeze` v1 (`?ui=1`, 2D e 3D) = 0 px | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `_tcg-shots --freeze --view 2d/3d` = 0 px vs `02-v2-*` | | | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `e2e:ui2` (2D, 3D, tcg) | ● | ● | | ● | ● | | ● | ● | ● | ● | ● |
| `e2e:journey` | ● | ● | | | | | | | | ● | ● |
| `e2e:fit:tcg` | | | | ● | ● | ● | ● | ● | | ● | ● |
| `e2e:floor:tcg` | | | | ● | ● | | ● | | ● | | ● |
| `e2e:tcg:hit --upto NN` | | | ● | ● | ● | | ● | ● | | ● | ● |
| `e2e:tcg:shots` (captura do lote) | | | | ● | ● | ● | ● | ● | ● | ● | ● |
| `fit --coach` (2D) / `--coach --view tcg` | ● | | | | | | | ● | | ● | ● |

---

## 7. Riscos e plano B

| # | Risco | Sinal (qual gate acusa) | Plano B (sem decisão nova) |
|---|---|---|---|
| R1 | **Folga vertical zero no 390** (R1 do plano atual): a dica, o pedido de casa e a instrução de alvo precisam de espaço. | `e2e:fit:tcg` soma ≠ viewport; `clash`. | Nenhum deles cria trilha: a dica e a instrução são itens sobrepostos na `p-zone`; o pedido de casa é `absolute`. Se a dica cobrir a carta da sua linha nas capturas: trocar `align-self: end` por `start` na `.nf-tcg-tip` (um valor). |
| R2 | **Leque × drag-to-play no 390**: com sobreposição, o `pointerdown` pode cair na carta vizinha; a rotação deixa o fantasma do `useHandDrag` do tamanho do retângulo girado. | L07 itens 1–3. | `--nf-tcg-fan-deg: 0deg` (só token) remove a rotação e o fantasma volta ao tamanho da carta; com 8+ cartas a faixa visível cai abaixo de 44px → aceitar (a carta erguida ocupa a largura toda) e registrar no RETRATO. |
| R3 | **Bandeja de status na borda × zoom/lightbox da carta**: o hover-zoom (desktop) de uma criatura da ponta direita cobre o placar; no toque o long-press abre o `CardLightbox` (portal, modal). | Captura/uso manual; nenhum gate. | Aceito: o zoom é transitório e o lightbox é modal. Se o dono pedir, o zoom já respeita `settings.hoverZoom` (desligável). |
| R4 | **Console portado ao rail** ≥1041px (A3). | L06: pílula ausente no board a 1440. | `consoleSlot={null}` do lote 01 — se faltar, o lote 01 não fechou. |
| R5 | **FIT/ui2 contam faixas por seletor** (A1). | Soma trivial (só zonas + mão). | Medição por trilhas do grid (lote 03). Proibido mudar o ramo 2D/3D dos harness. |
| R6 | **FIT 3D e probes 3D** mediriam a variante por engano. | Faixas do `fit --view 3d` diferentes do 00. | Os harness 3D semeiam `"3d"`; a variante exige `.game-board--tcg` — se alguma linha 3D mudar, é bug do lote: reverter. |
| R7 | **Especificidade**: alguma regra do `index.css` com 3+ classes vence a variante (ex.: `html:not(.reduce-motion) .game-board:not(.no-anim) …`, regras `@media` do palco). | Captura do lote mostra a peça fora da área; `clash`. | Subir **só** o seletor perdedor com `.game-board--stage` extra (`.game-board.game-board--tcg.game-board--stage X`). Nunca `!important`; nunca editar `index.css`. |
| R8 | `display: contents` some com o `.player-band--active`/`.turn-console--human` (as caixas não pintam). | Captura. | Coberto: o avatar ganha anel (lote 04) e a pílula muda de estado (lote 06). |
| R9 | Texto em pt-BR maior que em en nas bandejas de 56px ("30 NO BARALHO"). | `clash`/`outside` só roda em en. | O lote 03 já impõe `overflow-wrap: anywhere` + `max-width: 100%` nas bandejas (quebra, nunca vaza); o RETRATO captura em pt. |
| R10 | Paisagem de celular (844×390): palco no `min-height: 520px` → rola, cartas pequenas. | Fora do FIT. | Tokens `@media (max-height: 600px)` (§2.4). Aceito como herança do 2D (que também rola ali); registrar no RETRATO. |
| R11 | `_2d-freeze`/`_tcg-shots --freeze` acusam diferença por timing (o próprio freeze já registra "fantasma 22×22 em 3 de 8 rodadas"). | Diff ≠ 0 em região pequena. | Rodar de novo uma vez; se repetir no mesmo lugar, é regressão: parar e reportar. |

---

## 8. DECISÕES do dono (2)

**D1 — A mão na variante (lote 07; muda só `--nf-tcg-peek-h` e a regra da mão no FIT/ui2).**
- **D1-A (recomendada)**: mão **espiando**, como no Pokémon — cada carta ≥70% visível, o resto
  cortado pela borda do board. É a mesma regra que o dono já aceitou para o 3D (H3D-14) e dá
  ~20px a mais para cada battleline no 390.
- **D1-B**: mão **inteira** visível (a regra do 2D). Zonas ~10px menores no 390; mais fiel ao
  contrato "mão 100% visível" do FIT 2D.
> Sem D1 decidida, o lote 03 usa os valores de D1-A nos tokens e o FIT tcg roda a regra A; se o
> dono escolher B, o lote 07 troca os 5 valores e a regra (2 linhas).

**D2 — Quando a dica do turno aparece (lote 09).**
- **D2-A**: segue o ajuste "Dicas" que já existe (`settings.hints`, padrão **desligado**) — zero
  ajuste novo; quem não liga nunca vê.
- **D2-B (recomendada)**: **sempre ligada** no Layout Arena (fora da partida guiada), com o `×`
  que silencia até o fim da partida. É o "ensina jogando" da referência.
- **D2-C**: ajuste novo `arenaTips` (padrão ligado) na aba Jogo — custa 1 campo em
  `AppSettings`/`readSettings` + 2 chaves (`ui.arena.tipsSetting`, `…Sub`) + 1 caso de teste.

---

## 9. Aceite do dono — como julgar

- **Por lote** (03–09): a pasta `docs/advisor/arena-tcg-live/NN/` com 24 PNGs (4 temas × 3
  viewports × `leve`/`cheia`) + `report.json`; o critério objetivo do lote está no próprio lote.
- **Final** (10): `RETRATO.md` com antes (`02-v2-2d`) × depois lado a lado, em en e pt, e a
  matriz de gates toda verde.
- **Critérios objetivos consolidados**:
  1. 2D e 3D: freeze v1 e v2 = 0 px; linhas `faixas:` do FIT 2D/3D idênticas ao baseline.
  2. Variante: FIT tcg OK nos 7 viewports (soma = viewport ±1, documento sem rolar, zero
     sobreposição); piso tipográfico 2D a 360; todos os alvos ≥44px.
  3. Cartas de battleline ≥1,4× o 2D (390/768) e ≥1,2× (1440) com 2 criaturas por lado.
  4. Drag-to-play, toque, snap-back e cancelamento lateral funcionando a 390/768/1440.
  5. Dica: nunca rouba foco; some com a escolha pendente; não coexiste com o Coachmark.
