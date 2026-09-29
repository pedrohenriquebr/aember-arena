# Plano UX-FIT — mesa inteira na tela, preview maior e ritmo da IA ajustável (29/09/2026)

Origem: `docs/advisor/UXFIT-BRIEF.md`. O dono jogou no notebook dele e fez 3 pedidos:

1. "toda a tela coubesse na visão do usuário, sem precisar fazer scroll, isso tanto para
   mobile quanto para desktop"
2. "aumenta o container das cartas/preview ao passar mouse em cima"
3. "o turno da IA continua muito rápido [...] criar um input/config na tela de
   configurações pra ajustar esse tempo"

Evidência principal: os 3 prints em `docs/ux-prints/`. Este documento **não altera
código**. Os valores de CSS e as linhas citadas são do commit `287c1dd`.

---

## 1. Diagnóstico dos prints

### 1.1 O que o viewport do dono realmente é

Os prints têm **1296×716 px** e incluem a barra do navegador (≈48 px). O header do app
mede 62 px no print, exatamente os 62 px do CSS (`index.css:245`). A escala é portanto
1:1, e o **viewport real do dono é ≈1296×668 CSS px**. Isso bate com um notebook
1920×1080 a 150% de escala do Windows, somado à UI do Chrome e à barra de tarefas.

> Consequência: o cenário 1280×800 do harness **é otimista**. O caso do dono tem 132 px a
> menos de altura. O plano mede o palco em 4 alturas: 668 (o dono), 800, 1080 e 800 no
> celular.

### 1.2 Print 1 (`print-1-scroll-necessario.png`), 2D

| Faixa (y no print, com a barra do browser em 0–48) | Altura | Origem no CSS |
|---|---:|---|
| Barra do navegador | 48 | — |
| `.app-header` | 62 | `index.css:228-249` (62 px ≥701) |
| padding-top da `.game-screen` | 18 | `index.css:553-555` |
| `.match-heading` (eyebrow + H1 "Dr. 'The Old' Jeffries" em `--fs-2xl` + chip) | ≈65 | `index.css:591-645` |
| margin-bottom do heading | 12 | `index.css:603` |
| `.player-band` do Warden | ≈58 | `index.css:806-822` (min-height 58) |
| `.battle-zone--opponent` (título "LINHA DO OPONENTE" + lane com 8 cartas de 88 px + legendas) | ≈195 | `index.css:1144,1160` (min 167) + lane 125 + caption |
| `.turn-console` (rodada, seletor de casa, "Encerrar turno") | ≈85 | `index.css:1600-1622` (min 70) |
| `.battle-zone--player` (4 cartas; nomes cortados em y=716) | ≈195 | `index.css:1150,1163` (min 164) |
| **Abaixo da dobra:** `.player-band` "Você" | 58 | — |
| **Abaixo da dobra:** `.hand-zone` (heading + cartas de 103 px ≈ 144 de arte + legenda) | ≈220 | `index.css:1895-1975` (track min 165) |
| padding-bottom da `.game-screen` | 30 | `index.css:559` |

**Soma: ≈1000 px de conteúdo para 668 px de viewport.** A mão começa em y≈749 (81 px
abaixo da dobra) e a base das cartas fica em y≈970, ou seja **302 px abaixo da dobra**.
Mesmo a 1280×800 a base da mão fica ≈170 px abaixo.

### 1.3 Print 2 (`print-2-mao-na-dobra.png`), 3D

No 3D a lane do oponente fica ≈75 px mais baixa (mesa inclinada, `index.css:6890+`), e a
barra "Você" chega a aparecer (y 605–655). O heading "SUA MÃO / 23 NO BARALHO" fica em
y=674, com o corte logo abaixo. **A mão inteira continua fora da tela.** O leque do
H3D-06 (`index.css:7136-7210`) ainda soma `padding-top: 36px`, o que empurra mais.

### 1.4 Print 3 (`print-3-paliativo-zoom.png`), o paliativo

O header mede 47 px no print (62 no real), então o zoom do navegador está em **≈75%**. O
viewport vira ≈1728×890 CSS px. Mesmo assim, as legendas da mão ("Dominator Bauble",
"Hand of Dis") encostam na borda (y≈700 de 717). Tudo fica ¾ do tamanho, e a mesa usa
≈900 px de largura num viewport de 1728 px: **sobra largura e falta altura**.

### 1.5 Causas estruturais

1. **A tela de jogo é um documento que rola, não um palco.** `.game-screen` não tem
   altura (`index.css:553`). O board é um `flex-column` de 7 faixas empilhadas no fluxo
   (`App.tsx:1366-1523`), e a **mão é a última faixa do documento** (`App.tsx:1484`),
   então é sempre ela que vai para baixo da dobra.
2. **As alturas são piso fixo, não flexíveis.** São `min-height` de 167/164 nas zonas,
   125 na lane, 165 no hand-track, 70 no console e 58×2 nas bands
   (`index.css:1160-1164, 1210, 1967, 1616, 818`). Nada encolhe com a altura do viewport,
   e a largura das cartas é fixa em px (88/103, `index.css:1249,1261`).
3. **Há cabeçalhos redundantes** que custam ≈155 px verticais. O H1 grande e o chip
   "RODADA 04 / Seu turno" somam ≈77 px, e o chip repete o turn-console (UX_REVIEW §2 #4
   já pedia a remoção). Os títulos "LINHA DO OPONENTE / SUA LINHA" custam ≈22 px cada, e
   o heading "SUA MÃO" mais 18 px, e as duas informações estão logo ao lado.
4. **A barra "Você" e o heading da mão são duas faixas** (58 + 21 px) com informação
   do mesmo jogador.
5. **Linhas condicionais entram no fluxo e empurram a mão.** São três: a
   `.fight-instruction` (28–31 px, `App.tsx:1446`, `index.css:1874`), o `.hand-prompt`
   (≈18 px, `App.tsx:1492`) e a `.board-attachments`, que é `width:100%` + `flex-wrap`,
   ou seja **uma segunda fileira de cartas** quando há artefato ou upgrade
   (`index.css:6587`, `App.tsx:1245`).
6. **O rail de 296 px não é o culpado pela altura.** Ele já é sticky, com scroll próprio
   (`index.css:2022-2033`). Mas abaixo de 1041 px ele cai **depois** da mão, no fluxo, e
   aumenta o documento (é por isso que existe o `padding-bottom: min(58dvh,560px)` em
   `index.css:2157`).
7. O `.game-screen` ainda soma `padding-bottom: 30px` (desktop) ou `82px` (mobile, para
   a `.mobile-tabs`).

---

## 2. Plano "Mesa sempre inteira" (pedido 1)

### 2.1 A mudança estrutural: palco de viewport

A `.game-screen` passa a ser um **palco**: altura exata do viewport menos o header, sem
scroll no documento, com um grid interno cujas linhas elásticas são as duas battlelines.

```css
/* Palco: a tela de jogo ocupa exatamente o que sobra do viewport. */
.game-screen {
  height: calc(100vh - var(--header-h) - var(--tabbar-h-game));
  height: calc(100dvh - var(--header-h) - var(--tabbar-h-game));
  min-height: 520px;            /* degradação: abaixo disso volta a rolar */
  overflow: hidden;             /* só no palco ≥ min-height, ver §2.6 */
  padding: 6px clamp(8px, 1.4vw, 20px);
}
.workspace { height: 100%; align-items: stretch; }
.main-column { display: flex; flex-direction: column; min-height: 0; }
.game-board { flex: 1 1 auto; min-height: 0; }
.board-content {
  display: grid;
  height: 100%;
  grid-template-rows:
    var(--band-h)      /* Warden */
    minmax(0, 1fr)     /* linha do oponente */
    var(--console-h)   /* rodada + casa + encerrar */
    minmax(0, 1fr)     /* sua linha */
    var(--hand-bar-h)  /* "Você" + "Sua mão" fundidos */
    var(--hand-h);     /* cartas da mão */
}
```

- Tokens novos em `:root` (`index.css:~155`, junto de `--tabbar-h`): `--header-h`,
  `--band-h`, `--console-h`, `--hand-bar-h`, `--hand-h` e `--tabbar-h-game`, definidos
  por perfil (tabela §2.3). O `--header-h` já espelha a altura do `.app-header`.
- **Por construção**, a soma das linhas é igual à altura do palco. As zonas `1fr` absorvem
  a diferença, e o risco passa a ser o conteúdo não caber na zona, o que se resolve
  **dimensionando as cartas pela altura da zona** (§2.2), não pela página.
- `100vh` vem antes de `100dvh` como fallback, no mesmo padrão já usado em
  `index.css:2027-2028`.
- **A classe do palco é `game-board--stage` (no board), não uma regra da
  `.game-screen`.** O `replay-overlay` (`App.tsx:3254`) renderiza outro `GameBoard`, e
  ele precisa do mesmo encaixe.

### 2.2 Battlelines que flexionam

A `.battle-zone` vira um **container de tamanho**. A carta do board passa a derivar a
largura da altura disponível e do número de cartas da lane (o `--n` por lane já existe
desde o H3D-04):

```css
.game-board--stage .battle-zone { container: zone / size; padding: 6px 12px; min-height: 0; }
.game-board--stage .card-tile--board {
  /* altura da zona − padding − legenda (18) − folga da seleção (6) → largura pela proporção 0,714;
     limitada também pela largura da lane dividida por --n. */
  width: clamp(var(--board-min), min((100cqh - 36px) * 0.714,
               (100cqw - (var(--n, 1) - 1) * 12px) / var(--n, 1)), var(--board-max));
}
```

- `--board-min`: **60 px** no desktop e 56 px no celular (o piso do H3D-09 para o perfil
  2.5D é 60). O texto da carta já usa `max(var(--fs-card-floor), 7cqi)`, então o
  `e2e:floor` segue valendo em qualquer largura.
- `--board-max`: **104 px** (desktop ≥1041), **128 px** quando `(min-height: 960px)`, e
  76 px no celular.
- **O título da zona sai do fluxo.** "LINHA DO OPONENTE · 8 NA MESA" vira um rótulo
  absoluto no canto superior esquerdo da zona (`position:absolute; pointer-events:none`,
  mesmo texto, mesmo `aria-label` da `<section>`). Economia: 2 × 22 px. No 3D o heading
  do oponente já é billboard (`index.css:6906`), e passa a seguir a mesma regra.
- **`.board-attachments`** (artefatos/upgrades) deixa de quebrar linha no palco:
  `flex-wrap: nowrap; width:auto; margin: 0 0 0 12px`, e fica **na mesma fileira** que as
  criaturas, separado por um divisor vertical. Entra no `--n` como mais uma carta
  (`--n = criaturas + anexos` calculado no `BoardLane`, `App.tsx:~1190`).
- `.empty-battleline` (`index.css:1564`): o `min-height` 91/118 é removido no palco, e a
  zona vazia fica só com o `1fr`.
- `.board-lane` mantém `overflow-x:auto` no 2D, **só como rede de segurança** (com
  mais de 10 cartas o `clamp` bate no mínimo). No 3D a lane continua `overflow:visible`
  (`index.css:6743`).

### 2.3 Perfis de altura e a soma por cenário

Há dois perfis no desktop, escolhidos pela **altura** do viewport, e um no celular:

- **Alto:** `(min-width: 701px) and (min-height: 760px)`
- **Baixo:** `(min-width: 701px) and (max-height: 759px)`. É o notebook do dono.
- **Celular:** `< 701px`

| Linha | Hoje (desktop) | Alto | Baixo | Celular |
|---|---:|---:|---:|---:|
| `.app-header` (`--header-h`) | 62 | 62 | **52** | 58 |
| padding vertical do palco | 18 + 30 | 6 + 6 | 6 + 6 | 6 + 6 |
| Faixa de título (§2.5) | 77 | **40** + gap 6 | **0** (sai) | 0 (sai) |
| `--band-h` (Warden) | 58 | 52 | 44 | 48 |
| `--console-h` | 70–85 | 60 | 52 | 56 (1 linha, §2.7) |
| `--hand-bar-h` ("Você" + "Sua mão") | 58 + 21 | 44 | 40 | 44 |
| `--hand-h` (cartas da mão, no 2D 100% visíveis) | ≈165 | 164 (carta 96) | 149 (carta 88) | 139 (carta 82) |
| `.mobile-tabs` (`--tabbar-h-game`) | — | 0 | 0 | 54 |
| bordas do board | 2 | 2 | 2 | 2 |

`--hand-h` = padding 6+4, carta com arte de largura × 1,4, e legenda de 18 (16 no
celular).

**Cenário A — 1280×800 (perfil alto, rail em coluna de 296 px):**
header 62 + padding 12 + título 46 + board (2 + 52 + 60 + 44 + 164 = 322 fixos). As zonas
ficam com 800 − 62 − 12 − 46 − 322 = **358 → 179 px cada**. Carta do board =
min((179 − 12 − 36) × 0,714 = **93 px**, limite por largura). A largura do board é
1280 − 40 − 296 − 15 = 929 px, e 8 cartas de 93 + 7 gaps de 12 = 828 px, então cabe.
**Soma: 62 + 12 + 46 + 322 + 358 = 800 ≤ 800. ✓** As cartas do board ficam maiores que
hoje (93 vs 88) e a mão fica em 96 px (hoje 103).

**Cenário do dono — ≈1296×668 (perfil baixo):**
header 52 + padding 12 + título 0 + board (2 + 44 + 52 + 40 + 149 = 287 fixos). As zonas
ficam com 668 − 52 − 12 − 287 = **317 → 158 px cada**. Carta do board =
(158 − 12 − 36) × 0,714 = **79 px** (hoje 88). A mão fica em 88 px, legível: é o
tamanho atual das cartas do board.
**Soma: 52 + 12 + 287 + 317 = 668 ≤ 668. ✓** Sem zoom do navegador, a carta visível
fica ≈10% maior do que o dono vê hoje no paliativo a 75% (88 × 0,75 = 66 px).

**Cenário B — 1920×1080 (perfil alto + `min-height: 960px`):**
header 62 + padding 12 + título 46 + board (2 + 52 + 60 + 44 + `--hand-h` 195 com carta
de 118, o mesmo tamanho do leque 3D = 353 fixos). As zonas ficam com 1080 − 62 − 12 − 46
− 353 = **607 → 303 px cada**. Carta do board = min((303 − 48) × 0,714 = 182,
`--board-max` 128) = **128 px**. A zona sobra (centralizar verticalmente com
`align-content: center`). **Soma: 62 + 12 + 46 + 353 + 607 = 1080. ✓**

**Cenário C — 360×800 (celular, 2D):**
header 58 + tabs 54 + padding 12 + board (2 + 48 + 56 + 44 + 139 = 289 fixos). As zonas
ficam com 800 − 58 − 54 − 12 − 289 = **387 → 193 px cada**. Carta do board = min(
(193 − 48) × 0,714 = 103, `--board-max` 76) = **76 px** (hoje 68). A lane rola na
horizontal como hoje. **Soma: 58 + 54 + 12 + 289 + 387 = 800. ✓** Sobram ≈50 px por zona.
Se preferir priorizar a mão, dá para subir a carta da mão para 88 px nesse cenário.

**Degradação (360×640, iPhone SE com barra de URL ≈ 375×548):** com 548 − 58 − 54 − 12
− 289 = 135, sobram **67 px por zona**, o que não comporta carta ≥ 56 px com legenda.
Regra: `@media (max-width: 700px) and (max-height: 620px)` esconde `.mobile-tabs` durante
a partida. A navegação vai para o botão "Notas", que abre o drawer, e o drawer tem os
links (+54 px → 94 por zona → carta 56 px ✓). Abaixo de `min-height: 520px` de palco,
o palco **volta a rolar** (`overflow:auto` na `.game-screen`). O conteúdo nunca é
cortado.

### 2.4 A mão: HUD ancorado na base

- **Fusão das duas faixas.** A `PlayerBand` do jogador (`App.tsx:1471-1481`) e a
  `.hand-heading` (`App.tsx:1485-1491`) viram uma barra de 40–44 px, `.hand-bar`:
  - à esquerda: avatar, "Você", casas, chaves `0/3` e âmbar;
  - à direita: "SUA MÃO 6 · 23 NO BARALHO".

  O `PlayerBand` do jogador ganha uma prop `trailing` (ou o `hand-heading` passa a ser
  filho dele). Nenhuma informação sai.
- **`.hand-prompt`** (dica "desbloqueie uma casa") sai do fluxo e vira o texto secundário
  da `.hand-bar`, trocando o "23 no baralho" enquanto vale. A `.fight-instruction` vira
  um **toast absoluto** no topo da zona do jogador (`position:absolute; top:6px;
  left:50%`) e não empurra nada.
- **No 2D**, a mão é a última linha do grid (`--hand-h`), **100% visível**, e nunca se
  sobrepõe às battlelines. A carta de mão erguida (seleção `translateY(-12px)`) invade o
  gap de 6 px e a `.hand-bar`, e a `.hand-bar` fica `z-index` abaixo da mão.
- **No 3D (leque)**, a mão vira **overlay** estilo Arena: `position:absolute; bottom:0`
  dentro do `.board-content`. A linha do grid reserva só **70%** do `--hand-h`, e as
  cartas em repouso mostram ≈70% da altura (os 30% de baixo, rodapé com legenda, ficam
  fora do palco). Hover, `:focus-visible` e `.is-selected` erguem a carta 100% (a regra
  do H3D-06 já faz `translate: 0 -30px; scale: 1.14`, `index.css:7179`; o valor passa a
  `-30% - 30px`). O brief autoriza esse corte parcial **só no 3D**. O `padding-top: 36px`
  do leque (`index.css:7139`) sai, porque a carta erguida sobe por cima da zona do jogador
  (`z-index:2` já existe, `index.css:6751-6755`).
- **No celular** (<701), 2D ou 2.5D: a mão segue em scroll-snap horizontal
  (`index.css:1952`). Aqui "100% visível" é vertical.

### 2.5 Título encolhe para uma linha

- **Perfil alto:** `.match-heading` vira uma **faixa de 40 px**, com eyebrow e H1 na
  mesma linha (`display:flex; align-items:baseline`), H1 em `--fs-lg` com
  `text-overflow: ellipsis`. O `.view-toggle` fica à direita com **44×44 de alvo**
  (regra 9), com 36 px visuais e `::before` com `inset:-4px`. O **`.match-chip` "Rodada /
  Seu turno" sai** porque repete o turn-console (UX_REVIEW §2 #4). O CSS dele
  (`index.css:648+`) sai junto, o que ajuda o orçamento.
- **Perfil baixo e celular:** a faixa some. O nome do deck continua acessível como
  `document.title` + `aria-label` do board e no topo do drawer (§2.6). O `.view-toggle`
  entra no `.turn-console`, antes de "Encerrar turno".

### 2.6 O rail de 296 px: coluna no desktop largo, drawer no resto

| Largura | Hoje | Plano |
|---|---|---|
| ≥ 1041 | Coluna sticky de 285/296 px com scroll próprio | **Continua coluna.** A largura sobra (cenário A: board 929 px para 8 cartas de 93). Passa a medir `height:100%` do palco (`max-height: calc(100dvh - 92px)` e `min-height: 520px`, `index.css:2026-2029`, saem) e mantém `overflow:auto`. |
| 701–1040 | Grid de 2 colunas **no fluxo, abaixo da mão** | **Drawer lateral direito** de 340 px (`position:fixed; inset-block:var(--header-h) 0; right:0`), aberto pelo botão **"Notas" (44 px)** no turn-console. Fecha com Esc, clique fora ou o X. Foco preso via o `useDialogFocus` que já existe. |
| < 701 | Bloco solto abaixo da mão | **Drawer de baixo** (sheet de até `min(80dvh, 640px)`), mesmo botão "Notas". |

Nenhuma função se perde:

- **Undo** é frequente: com o rail em drawer, um **botão de ícone 44 px "Desfazer"**
  fica também no turn-console, ao lado de "Notas" (mesmo handler `undoLastMove`, mesmo
  `disabled`/`title`, `App.tsx:3151-3161`). Só no solo, como hoje.
- **Inspetor:** abaixo de 1041 ele **já** é bottom sheet (`.inspector-section--docked`,
  `index.css:2118`). No palco o sheet encolhe para **`max-height: min(44dvh, 360px)`**,
  com título, estatísticas e **botões de ação primeiro**, e o texto completo por "ver
  carta" (abre o `CardLightbox`). Assim as cartas da mão acima do sheet continuam
  clicáveis. A regra `.game-screen:has(.inspector-section--docked) { padding-bottom }`
  (`index.css:2157`) morre, porque não há mais scroll.
- **Log completo, filtros, briefing do Warden (com atalho para Config), regras rápidas e
  rodapé** vão para o drawer, na mesma ordem de hoje (`App.tsx:3120-3246`). Com o drawer
  fechado, a **última linha do log** aparece como badge no botão "Notas" (reusa o
  `narration`, `App.tsx:1360`).
- O `aria-label={t("rail.controls")}` e o `<aside>` continuam. O drawer é o mesmo
  `<aside>` com a classe `command-rail--drawer` e `aria-hidden`/`inert` quando fechado.

### 2.7 Turn-console no celular: uma linha

Hoje o console no celular é um grid de 2 linhas, com ≈96 px. No palco ele fica com
**56 px em uma linha**:

- à esquerda, "Rodada 04 · Seu turno" (duas linhas curtas em `--fs-2xs`);
- ao centro, os 3 chips de casa **só com ícone** (44×44, nome no `aria-label` e no
  `title`);
- à direita, "Encerrar turno" como botão de ícone de 44 px, com o texto dentro do
  `aria-label`.

A conta: 3 × 44 + 44 + 44 (Notas) + gaps de 4 × 6 = 244 px, mais ≈98 px de texto, cabe
em 342 px úteis. O resumo do turno da IA (`aiSummary`) vira a 2ª linha do texto à
esquerda, com ellipsis, e o texto completo segue no log.

### 2.8 Pisos (o que não pode encolher)

| Elemento | Mínimo | Por quê |
|---|---:|---|
| Carta do board | 60 px desktop / 56 celular | Arte reconhecível; `7cqi` ≥ piso do `--fs-card-floor` |
| Carta da mão | 82 px celular / 88 px desktop | É a peça que o jogador lê para decidir |
| Botões (Encerrar, casas, Notas, Desfazer, 3D) | 44×44 alvo | Regra 9 |
| Textos informativos | 11 px (caps 10 px com tracking ≥ 0,1em) | Contrato do `e2e:floor` |
| Altura do palco | 520 px | Abaixo disso, degradação para rolagem (§2.3) |

---

## 3. Preview maior (pedido 2)

### 3.1 O que existe hoje

- `CardArt.tsx:16-20`: `ZOOM_WIDTH = 204`, `ZOOM_TEXT_HEIGHT = 76`, gap e margem de 12,
  atraso de 120 ms. A arte mede 204 × 1/0,714 = **286 px**, mais 76 de texto, o que dá
  **204×362**.
- Em relação às cartas: é **2,3×** a carta do board (88) e **2,0×** a da mão (103). O
  texto é `--fs-xs` com `line-clamp: 3` (`index.css:4975-4985`), e cartas com texto longo
  saem cortadas no preview.
- Posicionamento (`placeZoom`, `CardArt.tsx:77-103`): lado direito, senão esquerdo,
  senão centralizado; na vertical, centrado na carta com clamp no viewport. **Não
  conhece o placar**. Esse é o problema do UX_REVIEW §2 #7 (o zoom cobre o placar do
  jogador e as criaturas).
- Portal em `document.body` (`CardArt.tsx:207`), `display:none` abaixo de 701 px
  (`index.css:4912-4930`). No toque, o long-press de 500 ms abre o `CardLightbox`
  (`CardArt.tsx:22, 236`).

### 3.2 Proposta

- **Tamanho:** `ZOOM_WIDTH` dinâmico = `clamp(260, min(0.26 × innerWidth, (innerHeight −
  24 − textH) × 0.714), 340)`.
  - 1280×800: min(333, 497) = **333 px** → arte 466 + texto ≈96 = 562 px de altura
    (≤ 800 − 24 ✓).
  - Dono, 1296×668: min(337, 408) = **337 px** → 568 px (≤ 644 ✓).
  - 1920×1080: **340 px** (teto).
  - 1024×768 (drawer): min(266, 461) = **266 px**.

  Resultado: **3,6×** a carta do board e **≈3,5×** a da mão, sem a mão "gigante".
- **Texto:** `ZOOM_TEXT_HEIGHT` deixa de ser constante. A altura é medida do nó
  renderizado (layout effect + `getBoundingClientRect`), e o `line-clamp` sobe de 3 para
  **6**, com `font-size: var(--fs-sm)` no texto e `--fs-md` no título.
- **Posição (≥1041, com o rail em coluna):** o preview vai para o **slot de leitura
  sobre o rail**, alinhado à direita do viewport com margem de 12 e centrado na vertical
  do palco. O rail é a área de "notas", então cobri-lo durante o hover **não esconde
  nada do jogo**. Com 340 px ele passa 44 px da coluna de 296 e cobre só a calha de
  15 px e ≈29 px da borda do board, fora das cartas, porque a lane é centralizada.
- **Posição (701–1040, rail em drawer):** o `placeZoom` ganha uma **lista de exclusão**
  medida no hover: `.amber-counter`, `.key-counter` (das duas `.player-band`), o
  `.turn-console` e a própria carta. Ele tenta, em ordem, direita da carta → esquerda da
  carta → metade horizontal oposta do palco, e aceita a primeira posição sem
  interseção. Se nenhuma servir, usa a metade oposta **e** reduz até 260 px.
- **Supressão:** não abrir o zoom para a carta que **já está no inspetor** (UX_REVIEW
  #7). O `CardArt` recebe `suppressZoom` quando `selected.instanceId` coincide.
- **Toque:** sem mudança de caminho. O long-press abre o `CardLightbox` que já existe.
  No palco, o lightbox continua sendo portal no body (`CardArt.tsx:260`) e não sofre
  com o `overflow:hidden`.
- **3D:** o zoom é screen-space (portal), então nada muda. No leque, a carta erguida
  (1,14×) e o zoom coexistem, e o zoom vai para o slot do rail, sem conflito de posição.

---

## 4. Ritmo da IA configurável (pedido 3)

### 4.1 Como o ritmo é hoje

- Constantes em `App.tsx:139-149`: pensar de 250 a 650 ms (dificuldade), casa 450, `PRE`
  de 80 a 260 por tipo, `HOLD` 520 (só sem animação), `GAP` 220 e fim 300.
- Voo de carta (FxLayer, `FxLayer.tsx:20-25`): apresentação 260, hold 420 (Warden com
  slot) ou 600 (Ação), slam 270. Colher/lutar: `ACTION_MS` de 620.
- `tempo()` (`App.tsx:2365`): 1 nas 4 primeiras ações, depois −0,1 por ação até 0,45.
  `aiSpeed:"fast"` ou "toque para acelerar" forçam 0,45 **e** o hold do voo × 0,45
  (`App.tsx:2007, 2044`).
- **Pausa real entre uma ação e a próxima** (o que o dono chama de "delay entre cada
  ação"): `GAP + PRE` = **300–480 ms** no normal e ≈135–215 ms acelerado.

**Achado provável** (a confirmar na próxima gravação): o "acelerar" escuta
`pointerdown` **na `window` inteira** (`App.tsx:2373`). No notebook do dono, a mesa
exigia rolagem (§1). Clicar na barra de rolagem, no rail ou em "Log completo" durante o
turno do Warden aciona o rush e **compacta o resto do turno para 0,45**, e isso casa com
"continua muito rápido". O palco (§2) elimina a rolagem, e o FIT-08 restringe o gatilho.

### 4.2 Proposta: `settings.aiDelayMs`

- **Modelo** (`settings.ts`): `aiDelayMs: number` substitui `aiSpeed`. Range **200–2000**,
  passo 100, **default 700**. `readSettings` faz clamp e arredonda. **Migração:** save
  antigo sem `aiDelayMs` lê `aiSpeed` (`"fast"` → 300, `"normal"` → 700). O tipo
  `AiSpeed` e `AI_SPEEDS` (`settings.ts:12, 44`) saem.
- **Semântica:** `aiDelayMs` é a **pausa de leitura entre ações** do Warden (PRE + GAP).
  O multiplicador único é `k = aiDelayMs / 400` (400 ≈ PRE médio 180 + GAP 220 de hoje):
  - `beat(PRE)`, `beat(GAP)`, `AI_HOUSE_MS`, `AI_END_MS` e `AI_HOLD` × **k**;
  - `aiThinkMs` × `min(k, 2)` (pensar não deve passar de ~1,3 s);
  - `holdMs` do voo do Warden (`App.tsx:2044`) × `clamp(k, 0.45, 1.6)`.

  Os tempos **de movimento** (apresentação 260, slam 270, `ACTION_MS` 620) não escalam:
  a animação não fica em câmera lenta, só a leitura fica mais longa.
- **Efeito no default:** 700 → k = 1,75. A pausa entre ações sobe de 300–480 para
  **525–840 ms**, e cada jogada do Warden passa de ≈1,3 s para ≈1,9 s. O default já
  responde à queixa do dono, e o preset "Rápido" (300) fica ≈ o normal de hoje.
- **Curva de degradação** (`App.tsx:2363-2365`): continua, mas **o piso passa a depender
  da escolha**. Com `aiDelayMs > 700` o piso é **0,75** (quem pediu devagar não é
  acelerado sozinho); com ≤ 700 continua 0,45. A curva começa na 6ª ação (hoje na 5ª).
- **Toque para acelerar:** o listener sai da `window` e vai para o **nó do board**
  (`.game-board`, via ref). Cliques no drawer, no rail, no header e na scrollbar não
  aceleram mais. Continua valendo `rush → 0.45` e `wake()`.
- **UI** (Config, `App.tsx:913-930`, na mesma `exp-row` do `Clock3`):
  - `<input type="range" min=200 max=2000 step=100>` com `aria-valuetext` via `t()`;
  - `<output>` com o texto de preview: "Pausa entre jogadas do Warden: ~0,7 s" /
    "Pause between Warden plays: ~0.7 s", formatado com `toLocaleString(lang,
    {maximumFractionDigits:1})`;
  - 3 chips de preset logo abaixo: **Rápido 300 · Normal 700 · Lento 1200**. O chip
    fica ativo quando o valor coincide.

  O thumb do range tem alvo de 44 px (`height:44px` no input, trilho de 4 px). O resumo
  da Config (`App.tsx:985`) passa a mostrar "~0,7 s". O controle só aparece no solo,
  como hoje.
- **i18n** (`i18n.ts:97-99`): mantém `config.experience.speed` e `config.speed.fast` e
  `.normal`. Entram:
  - `config.speed.slow` (Slow / Lento);
  - `config.experience.speedSub` (Reading pause between the Warden's actions / Pausa de
    leitura entre as ações do Warden);
  - `config.speed.value` ("~{s} s per action" / "~{s} s por ação").
- **Probes:** `e2e/probes/fx-ai-turn.mjs:18`, `fx-impact.mjs:17` e `_3d-chain.mjs:33`
  semeiam `aiSpeed`. Eles passam a semear `aiDelayMs` (300 para "fast"). A migração
  também cobre seeds antigos.

---

## 5. Histórias

A coluna **3D** indica se a história toca o modo 3D (VIEW3D_PLAN §3: o palco muda o
contêiner do 3D).

| # | História | Esforço | 3D | Depende de |
|---|---|:-:|:-:|---|
| FIT-08 | Ritmo da IA configurável | S | — | — |
| FIT-07 | Preview de hover maior e fora do placar | S-M | leve | — |
| FIT-01 | Harness de encaixe (`e2e:fit`) | S | sim | — |
| FIT-02 | Palco de viewport + faixa de título | M | sim | FIT-01 |
| FIT-03 | Battlelines flexíveis | M | sim | FIT-02 |
| FIT-04 | Mão como HUD ancorado (2D inteira, 3D overlay) | M | sim | FIT-02, FIT-03 |
| FIT-05 | Rail vira drawer abaixo de 1041 + Undo/Notas no console | M | — | FIT-02 |
| FIT-06 | Palco no celular (console em 1 linha, degradação) | M | sim (2.5D) | FIT-03, FIT-04, FIT-05 |

**Ordem:** FIT-08 → FIT-07 → FIT-01 → FIT-02 → FIT-03 → FIT-04 → FIT-05 → FIT-06.

FIT-08 e FIT-07 vêm primeiro porque são independentes, pequenos, respondem direto a 2 dos
3 pedidos e não mexem no layout. FIT-01 vem antes da estrutura para nascer vermelho e
virar o gate.

### FIT-08 — Ritmo da IA configurável (S)

- **Escopo:** `settings.ts` (aiDelayMs + migração), `App.tsx:139-149, 2007, 2044,
  2356-2373` (multiplicador k, piso da curva, listener no board), `App.tsx:913-930, 985`
  (range + presets + resumo), `i18n.ts` (3 chaves en+pt), probes `fx-ai-turn`,
  `fx-impact` e `_3d-chain` (seed).
- **Aceite:**
  - Com `aiDelayMs=700` e animações ligadas, o intervalo entre o fim do slam de uma
    ação e a marca PRE da próxima fica **≥ 500 ms** (`fx-ai-turn.mjs` mede via
    `data-fx`).
  - Com 2000, fica **≥ 1500 ms**; com 300, **≤ 400 ms**.
  - Save antigo `{aiSpeed:"fast"}` lê 300.
  - Clique no rail/drawer durante o turno do Warden **não** reduz o intervalo seguinte;
    clique no board reduz.
  - Com `reduce-motion`, as batidas continuam (UX #1.6).
  - `npm run build` passa, com **+≤0,35 kB gz**.

### FIT-07 — Preview de hover maior (S-M)

- **Escopo:** `CardArt.tsx:16-20, 77-103, 207-230` (largura dinâmica, medição do texto,
  exclusões, slot do rail, `suppressZoom`), `index.css:4912-4985` (`--fs-sm`, clamp 6),
  `App.tsx` (passar `suppressZoom` onde há `hoverZoom={settings.hoverZoom}`, linhas 316,
  1233, 1254, 1511).
- **Aceite:**
  - A 1280×800, o `.card-zoom` mede **≥ 320 px** de largura; a 1296×668, **≥ 320 px**;
    a 1024×768, **≥ 260 px**.
  - Em nenhum hover (harness passando o mouse em cada carta do board e da mão a
    1280×800, 1296×668 e 1024×768) o rect do zoom intersecta `.amber-counter`,
    `.key-counter` ou `.turn-console`.
  - O zoom cabe inteiro no viewport (top ≥ 12, bottom ≤ innerHeight − 12).
  - Hover na carta selecionada não abre zoom.
  - Long-press touch (probe com `hasTouch`) abre o `.card-lightbox`.
  - `e2e:floor` passa.

### FIT-01 — Harness de encaixe `e2e:fit` (S)

- **Escopo:** novo `e2e/probes/fit.mjs` e script `e2e:fit` no `package.json`. Entra no
  `e2e/acceptance.mjs` como etapa 5 (pulável com `--skip-fit`).
- **O que mede**, na partida demo, nos momentos turno do jogador, com carta selecionada,
  durante `pick` de luta e com um artefato em jogo, em **1296×668, 1280×800, 1920×1080,
  1024×768, 768×1024 e 360×800**, cada um em 2D e 3D:
  1. `document.scrollingElement.scrollHeight ≤ innerHeight + 1` (sem scroll no
     documento);
  2. a **soma das alturas** das linhas do palco (header + padding + faixa de título +
     rows do `.board-content` + tabs) ≤ `innerHeight`;
  3. **mão 100% visível no 2D**: todo `.hand-track > .card-tile--hand` com
     `rect.top ≥ 0 && rect.bottom ≤ innerHeight` (no celular só o eixo vertical). No 3D,
     **≥ 70%** da altura de cada carta visível, e 100% da carta com `:focus-visible`;
  4. os dois `.amber-counter`, o `.end-turn-button` e o botão "Notas" (quando houver)
     estão dentro do viewport;
  5. `.card-tile--board` ≥ 60 px (56 no celular).
- **Teste do teste:** com `--break` (injeta `.hand-track{min-height:600px}`) o probe
  **tem de falhar**, no mesmo padrão do `tilt 60` do H3D-11.
- **Aceite:** o probe roda em < 60 s, lista todas as violações por viewport e sai com
  código ≠ 0. No commit `287c1dd` ele **falha** em 1296×668 e 1280×800 (esperado,
  documenta o bug).

### FIT-02 — Palco de viewport + faixa de título (M)

- **Escopo:**
  - `index.css`: tokens em `:root`, `.game-screen` (553-561), `.workspace`/`.main-column`
    (566-589), `.match-heading` com perfis alto e baixo (591-660), `.game-board` e
    `.board-content` em grid (760, 799), `.app-header` a 52 px no perfil baixo (228-249).
    A classe `game-board--stage` é aplicada no board.
  - `App.tsx`: remoção do `.match-chip` (3087-3090); o `.view-toggle` migra para o console
    no perfil baixo (dois nós, um visível por media query, ou `order`).
- **Aceite:**
  - `e2e:fit` itens 1 e 2 passam em 1296×668, 1280×800 e 1920×1080 (mesmo ainda sem
    FIT-03 a FIT-05, com o rail em coluna ≥1041).
  - `e2e:floor` passa.
  - `e2e:capture`: diferença intencional em `game`, nenhuma nas outras 4 telas.
  - `e2e:smoke` passa.
  - O replay (`replay-overlay`) também encaixa (mesma classe).
- **3D:** o `perspective` do `.board-content` (`index.css:6723`) continua no mesmo nó, e
  o `display:grid` não quebra o `preserve-3d`, porque a cadeia começa no `.table-plane`.
  O `_3d-chain` precisa passar.

### FIT-03 — Battlelines flexíveis (M)

- **Escopo:** `index.css` 1139-1215 (zona como container `size`, heading absoluto, lane,
  `empty-battleline`), 1257-1265 (largura da carta por `cqh`/`cqw`/`--n`), 6587-6600
  (anexos na mesma fileira), 1874 (`.fight-instruction` como toast absoluto). `App.tsx`:
  `BoardLane` exporta `--n` (criaturas + anexos) também no 2D, e o JSX da
  `.fight-instruction` se move para dentro da zona do jogador.
- **Aceite:**
  - A carta do board mede **≥ 88 px a 1280×800**, **≥ 76 px a 1296×668** e **≤ 128 px a
    1920×1080** com 8 cartas por lado.
  - Com artefato em jogo e durante o `pick`, a altura do `.board-content` **não muda**
    (±1 px) e o `e2e:fit` passa.
  - `e2e:floor` passa em 360 e em 1296×668.
- **3D:** o `--card-w-3d` por lane (`index.css:7011-7012`) passa a ser o **teto** do
  cálculo por altura, e não um valor fixo. O `_3d-chain` (pose, sombra, teto de
  animações) precisa passar.

### FIT-04 — Mão como HUD ancorado (M)

- **Escopo:**
  - `App.tsx:1471-1523`: fusão da `PlayerBand` do jogador com o `hand-heading` em
    `.hand-bar`; o `.hand-prompt` vira texto secundário.
  - `index.css`: 806-830 e 1895-1975 (hand-bar e hand-h por perfil), 6751-6755 e
    7136-7210 (3D: overlay com 70% em repouso, sem o `padding-top: 36px`, erguida em
    100%).
- **Aceite:**
  - `e2e:fit` item 3 passa em todos os viewports: 2D com 100%, 3D com ≥ 70% em repouso
    e 100% em foco.
  - Com 12 cartas na mão (seed), a 1280×800 a mão ainda cabe na largura (sobreposição do
    leque no 3D, scroll horizontal só no celular).
  - O mulligan (`.mulligan-shade`) segue cobrindo o board, e as cartas continuam
    visíveis.
  - No 2P, o `handHidden` continua tirando a mão do DOM (a barra fica, sem as cartas).
- **3D:** sim, é a mudança principal do leque.

### FIT-05 — Rail em drawer abaixo de 1041 (M)

- **Escopo:**
  - `App.tsx:3120-3246`: o `<aside>` ganha o estado `railOpen`, a classe
    `command-rail--drawer`, `inert` quando fechado e o foco via `useDialogFocus`.
  - Botões "Notas" (com badge da última linha do log) e "Desfazer" (ícone de 44 px, só no
    solo) no `.turn-console`.
  - `index.css:1992-2160`: drawer lateral 701–1040 e sheet de baixo <701; o inspetor
    docked cai para `min(44dvh, 360px)`, com as ações primeiro; a regra
    `:has(...docked){padding-bottom}` sai.
  - `i18n.ts`: `rail.open` e `rail.close` (en+pt).
- **Aceite:**
  - A 1024×768 e 768×1024, o `e2e:fit` passa.
  - Nenhuma função some: um script do harness abre o drawer e encontra
    `.undo-button`, `.log-full-button`, `.ai-brief` e `.quick-rules`, e o log completo
    filtra.
  - Undo pelo console funciona e respeita `undo.blocked`.
  - Esc fecha e devolve o foco ao botão.
  - Selecionar carta da mão abre o sheet sem cobrir a `.hand-bar` (rect do sheet
    `top ≥` rect da `.hand-track` `top`, ou o sheet ≤ 44dvh).
  - `e2e:smoke` passa.

### FIT-06 — Palco no celular + degradação (M)

- **Escopo:** `index.css` 1600-1640 (console em uma linha < 701), perfil celular dos
  tokens, `.mobile-tabs` escondida na partida quando `max-height: 620px`, fallback
  `min-height: 520px` → `overflow:auto`. `App.tsx`: chips de casa só ícone (<701, com
  `aria-label`), e "Encerrar turno" como ícone com `aria-label`.
- **Aceite:**
  - A 360×800, `e2e:fit` passa em 2D e 2.5D (VIEW3D §3), com carta do board ≥ 72 px e
    mão ≥ 82 px.
  - A 375×548, o palco cabe com tabs ocultas e carta do board ≥ 56 px.
  - A 360×480 (paisagem baixa), o documento rola e nada é cortado.
  - Alvos ≥ 44 px (probe `ui.probe.mjs`), e o `e2e:floor` a 360 passa.
- **3D:** o perfil 2.5D (<701) herda os tamanhos (60/72 px) como **teto**; o cálculo
  por altura pode diminuí-los até o piso.

---

## 6. Riscos

### O que pode quebrar

| Área | Risco | Mitigação |
|---|---|---|
| **Undo / log / stats** | Descoberta pior no drawer (701–1040) | Undo duplicado no console; badge do log no botão "Notas"; o FIT-05 verifica cada controle |
| **Inspetor** | O sheet de 58dvh cobriria mão e lane sem scroll | Sheet compacto (44dvh, ações primeiro, texto no lightbox) |
| **2P** | `handHidden`, `pass-shade`, a rotação de lado e o título que acompanha o jogador ativo (BUG2-12) | A `.hand-bar` fica sem cartas; o título vai para o drawer/`document.title` no perfil baixo; `e2e:fit` com `gameMode: passAndPlay` no seed |
| **3D** | Grid no `.board-content` e overlay da mão mudam o contêiner da perspectiva | `perspective` continua no mesmo nó; o `_3d-chain` roda em cada FIT que toca o 3D; o leque perde o `padding-top` e ganha overlay |
| **FX** | Voo da carta mede rects antes e depois; lanes que mudam de largura com o `--n` alteram o destino | O destino é medido pelo diretor no frame do slot (já é assim); o `fx-flight`/`fx-ai-turn` precisam passar |
| **`.screen` com `transform`** | Animação de entrada cria containing block para `fixed` (drawer, sheet) | Já é `fill-mode: backwards` (CLAUDE.md); o drawer usa o mesmo cuidado |
| **Replay** | Overlay com outro `GameBoard` | A classe do palco está no board, não na `.game-screen` |
| **Tutorial** | O `TutorialWizard` pode apontar para o rail ou o chip | Conferir as âncoras do wizard; o chip sai, então apontar para o console |
| **Orçamento** | Medido 141,38 kB, teto 143,5 (margem de 2,1 kB). Estimativa: FIT-08 +0,3, FIT-07 +0,2, FIT-02..06 +1,2 a 1,6 CSS/TS, menos ≈0,3 de mortos (`.match-chip`, `min-height` fixos, a regra `:has(docked)`, o `max-height` do rail) | Varredura de mortos antes de cada FIT. Se a soma passar de 143,5, fazer um `chore(bundle)` com justificativa no padrão da regra 7 (provável teto 145) |
| **`dvh`** | Browsers antigos sem `dvh` | Fallback `100vh` na linha anterior |

### Celular: a mão em overlay é viável a 360?

Sim a 360×800: as contas do §2.3 deixam 193 px por zona. **Não como overlay:** no
celular a mão é a última linha do grid (2D) e o leque não existe (VIEW3D §3). Em
alturas < 620 px, as tabs saem na partida e ficam 94 px por zona, o mínimo jogável.
Abaixo de 520 px de palco, rola.

### O que NÃO fazer

- **Não usar `transform: scale()` no palco inteiro** para "caber". Seria o mesmo zoom do
  paliativo do dono (print 3): reprova no piso tipográfico e quebra o hit-testing.
- **Não esconder informação para caber.** Placar, chaves, casas, contagem de
  deck/descarte, legenda da IA e resumo do turno continuam na tela. Só **título e chip
  redundantes** saem.
- **Não cortar a mão no 2D.** O corte parcial (≤30%) é só para o leque 3D.
- **Não recriar bloco `@media (max-width: …)` no fim do CSS.** Os perfis são
  `min-width`/`max-height` ao lado de cada seletor (regra de estilo vigente;
  `acceptance.mjs` mede o bloco de 700 px).
- **Não escalar os tempos de movimento** das animações com o `aiDelayMs`. Só a leitura
  (PRE/GAP/hold) escala; carta em câmera lenta parece travada.
- **Não tirar o "toque para acelerar"**: ele só passa a valer no board.
