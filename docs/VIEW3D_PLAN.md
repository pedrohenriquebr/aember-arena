# Plano — Modo de Visão 3D da mesa "estilo Arena" (set 2026)

Plano **somente leitura**: nenhum código foi alterado. Objetivo, nas palavras do dono:
*"visão do jogador com a mesa inclinada, um ângulo como se fosse do ponto de vista dele
olhando pra mesa, as cartas ficam levitando sobre a mesa e inclinadas"*.

É um **modo alternativo**: o board 2D de hoje continua sendo o **padrão** e não muda
nem um pixel. O 3D é uma **camada de CSS sobre o mesmo DOM**, ligada por uma classe.

**Base lida:** `CLAUDE.md`, `docs/ANIMATIONS_PLAN.md`, `docs/UX_REVIEW.md`,
`docs/HANDOFF.md`, `src/App.tsx` (`CardTile` l.266, `BoardLane` l.1128, `GameBoard`
l.1217, `commitWithFx` l.1876, `FxLayer` montado na l.3152), `src/components/FxLayer.tsx`,
`src/lib/fx.ts`, `src/lib/settings.ts`, `src/index.css` (board l.720-800, zonas/lanes
l.1099-1300, mão l.1843-1930, FX l.5079-5175, reduce-motion l.6335).
As âncoras de linha valem para a **working copy** de 29/09/2026 (onda 1 de FX não
commitada: `FxLayer.tsx`, `fx.ts` e o diff em `App.tsx`/`index.css`).

**Sem Three.js / WebGL.** Quebraria o orçamento de bundle (regra 7) e não acrescenta nada
que CSS 3D + WAAPI não façam aqui: a cena tem 1 plano, ≤ 30 cartas e nenhuma iluminação
dinâmica real.

---

## 0. Restrições que moldam o desenho

| Restrição | Consequência |
|---|---|
| Regra 1 — single-file, sem CDN/fontes/assets remotos | Tudo é CSS + TS no bundle. Playmat = gradientes CSS (como o `.felt-etching` de hoje), nada de textura em imagem. |
| Regra 7 — teto de **135 kB gz** | O `dist/index.html` atual mede **136,52 kB gz** (`npm run e2e:bundle` em 29/09, com a onda 1 de FX na working copy): **já está acima do teto** antes do 3D. A onda 1 precisa da sua própria revisão de teto primeiro. O 3D completo estima **+2,0 a +2,6 kB gz** (§5) e pede outra revisão explícita (chore commit + justificativa). |
| Regra 2 — motor puro | O 3D é só apresentação. Nenhum campo no `GameState`. |
| Regra 5 — i18n | 3 chaves novas (en + pt-BR): `config.experience.view3d`, `config.experience.view3dSub`, `game.view3dToggle`. |
| Regra 8 — `prefers-reduced-motion` + `settings.animations` | A **pose** 3D é estática e não é "movimento": continua valendo com reduce-motion. O que desliga: transição entre modos, hover que ergue, parallax e voos (o guard `motionEnabled` do `fx.ts` já cobre os voos). |
| Regra 9 — alvos ≥ 44px | Em perspectiva o que conta é o **alvo visual** (`getBoundingClientRect`, que já devolve a caixa projetada), não a largura de layout. |
| Piso tipográfico (11px / 10px em caps) | `e2e:floor` mede `font-size` computado e **não enxerga transforms**: um texto de 11px numa zona a 0,88× passaria no gate e teria 9,7px na tela. É preciso um **piso visual** (§2.6). |
| `CLAUDE.md`: "`fill-mode: both` deixa transform residual" | `.board-piece` tem `animation: card-arrive 330ms … both` (`index.css:1172-1176`) — o quadro final `transform: translateY(0) scale(1)` **vence qualquer `transform` estático** da peça. A pose 3D **não pode** usar `transform` na `.board-piece`: usa as propriedades individuais `translate`/`rotate`/`scale`, que se compõem com `transform` em vez de brigar com ele (§2.2). |
| `.board-lane { overflow-x: auto }` (`index.css:1151`) | `overflow` ≠ `visible` é **propriedade de agrupamento**: achata o `preserve-3d` de todos os filhos. No 3D completo a lane precisa de `overflow: visible` e de outra estratégia para muitas cartas (§2.3). |
| Memos por valor (`CardTile`, `BoardLane`, `PlayerBand`) | Nada de props novas por carta. O modo entra como **classe no `<section class="game-board">`** (que não é memo) e como custom properties; o React não re-renderiza tile nenhum ao alternar. |
| Modo 2D intacto | Toda regra 3D fica sob `.game-board--3d …`. O único JSX novo que existe no 2D é um wrapper com `display: contents` (layout e árvore de acessibilidade idênticos). Gate: `e2e:capture` do 2D **pixel-idêntico** à baseline. |

---

## 1. Extração do MTG Arena — o que define o *feel*

Observações da referência visual (aproximadas — medidas de captura, não de spec):

### 1.1 Câmera e mesa
- A câmera fica **atrás e acima** do jogador, olhando a mesa a **~50-55°** da vertical
  da tela. O playmat é um único plano inclinado com ponto de fuga acima do centro da
  tela; a borda de perto é mais larga que a de longe (trapézio visível ~12-18%).
- O ângulo é **fixo** durante a partida. O único movimento de câmera é sutil (leve
  parallax/respiração, shake em impactos grandes). Nada de órbita.
- Iluminação "de palco": o centro da mesa mais claro, bordas em vinheta — ajuda o olho a
  ir para o meio, onde as coisas acontecem.

### 1.2 Zonas (escala relativa)
| Zona | Posição na tela | Escala relativa (sua battleline = 1,0) |
|---|---|---|
| Mão do oponente | borda superior, só dorsos | ~0,45 |
| Battleline do oponente | terço superior, "ao fundo" | **~0,75-0,85** |
| Faixa central (fase/turno) | meio da mesa | HUD, escala 1 |
| Sua battleline | terço inferior, "perto" | **1,0** |
| Sua mão | base da tela, em leque, parcialmente cortada pela borda | **~1,3-1,5** (maior que tudo na mesa) |
| Avatares/vida | laterais, perto de cada battleline | HUD, escala 1 |

A **diferença de escala entre as duas battlelines** (~20%) é o que vende a
profundidade — mais que o ângulo em si.

### 1.3 Como as cartas "levitam"
- Cartas na mesa ficam **de frente para a câmera, levemente deitadas para trás**
  (lean de ~10-15°), nunca totalmente deitadas no plano (seriam ilegíveis) nem 100%
  billboard (perderiam o "estão sobre a mesa").
- Sombra **difusa e deslocada para baixo/perto** no tapete, separada da carta: é a
  sombra que diz "flutua a X px". Carta erguida → sombra maior, mais clara e mais longe.
- **Hover/seleção ergue**: a carta sobe (mais altura, sombra se espalha), endireita (lean
  → 0°) e cresce ~10%. Na mão, o hover puxa a carta para cima e para a frente,
  saindo do leque (~1,4× e sem rotação).
- Estado "virada" (tapped) = rotação de 90° no plano da mesa.

### 1.4 Transições
- **Jogar da mão:** a carta sai do leque, sobe, **se apresenta grande no centro** e
  depois "cai" no slot, encolhendo com a perspectiva (fica menor porque está mais
  longe). Aterrissagem com pequeno overshoot e poeira/anel no tapete.
- **Carta do oponente:** nasce do lado dele, **para no centro por mais tempo** (para ser
  lida) e cai no fundo da mesa.
- **Ataque:** a criatura avança **pela profundidade** (sobe na tela e diminui) até o alvo,
  impacta e volta.

### 1.5 O que NÃO copiar
| Arena faz | Por que não aqui | O que fazemos |
|---|---|---|
| Mesa a 50-55° | A 55° o plano encurta para cos 55° = 0,57 da altura; qualquer texto que fique no plano cai abaixo do piso. | **40°** no desktop (0,77), 32° no tablet, 2.5D no celular (§3). Máximo absoluto de ajuste: 48°. |
| Mão cortada pela borda inferior, só revela no hover | Não existe hover no toque (regra: nada hover-only) e a mão aqui vive no fluxo da página. | Leque 100% visível; toque seleciona e ergue. |
| Tapped = 90° | Quebra a largura da lane; o `UX_REVIEW` #3 já recomendou ~15° + dessaturação. | Exausta = `rotate: z 12deg` + dessaturação, sem mudar o slot. |
| Zoom de hover grande cobrindo a mesa | `UX_REVIEW` #7: o zoom cobre placar e criaturas. | Mantém o zoom/lightbox atual (portal, fora do 3D). |
| Pilha lateral, partículas pesadas, bloom | Custo de GPU em celular fraco e de bundle. | Anel de poeira da onda 1 + sombras em gradiente estático. |
| Legenda e números **no** plano | Ilegíveis em perspectiva. | Todo texto é *billboard* (contra-inclinado) ou HUD plano. |

---

## 2. Arquitetura técnica no código atual

### 2.1 Árvore de contexto 3D

Hoje (`App.tsx:1298-1440`):

```
section.game-board        (overflow: hidden, isolation: isolate)
  div.felt-etching
  div.board-content
    PlayerBand (inimigo)
    section.battle-zone--opponent > .zone-heading + BoardLane(.board-lane > .board-piece > button.card-tile)
    div.turn-console
    div.fight-instruction?
    section.battle-zone--player  > …
    PlayerBand (jogador)
    section.hand-zone > .hand-heading + .hand-track > button.card-tile…
```

Mudança de JSX (a única estrutural): envolver **zona do oponente + console + instrução
de luta + zona do jogador** num `<div className="table-plane">`.

```css
.table-plane { display: contents; }               /* 2D: não existe para layout nem a11y */
.game-board--3d .table-plane { display: block; }  /* 3D: é o plano da mesa */
```

No 3D:

```
div.board-content                     perspective: 1100px; perspective-origin: 50% 38%
  PlayerBand (inimigo)                HUD plano, position: relative; z-index: 2
  div.table-plane                     transform-style: preserve-3d; transform: rotateX(var(--tilt))
    ::before (playmat)                translateZ(0) — gradientes, pointer-events: none
    section.battle-zone--opponent     preserve-3d (sem overflow/opacity/filter)
      .zone-heading                   billboard (§2.6)
      .board-lane                     preserve-3d; overflow: visible
        .board-piece                  pose: translate/rotate individuais (§2.2)
          ::before (sombra no chão)   volta ao plano da mesa (§2.4)
          button.card-tile            FOLHA: daqui para baixo pode achatar à vontade
    div.turn-console                  billboard, fica em z≈0 → escala 1
    section.battle-zone--player       idem oponente
  PlayerBand (jogador)                HUD, z-index: 2
  section.hand-zone                   HUD plano (leque próprio, §2.5)
```

Regras da árvore:
- **Cadeia sem agrupamento** entre `.table-plane` e `.board-piece`: nada de `overflow`
  ≠ visible, `opacity < 1`, `filter`, `clip-path`, `mask`, `isolation`, `mix-blend-mode`
  ou `contain: paint`. Checklist de auditoria na H3D-02. `.game-board` pode continuar com
  `overflow: hidden`/`isolation`: está **acima** da raiz de perspectiva, só recorta o
  resultado final.
- **A folha é o `.card-tile`**: `.is-dimmed` (`opacity .48 + filter`, `index.css:1360`),
  `.card-art { overflow: hidden }` e `container-type` podem achatar o que está dentro da
  carta — a carta é um plano só, então não importa.
- A mesa gira em torno do **centro** (`transform-origin: 50% 50%`). O console fica perto
  do centro → z ≈ 0 → escala ≈ 1,0. O fundo recua e o perto avança sozinhos.
- HUDs (bands, mão) são irmãos do plano, sem transform 3D: `z-index: 2` para pintar por
  cima de qualquer carta que avance (o plano não é z-ordenado com eles porque
  `.board-content` não é `preserve-3d`).
- Nada `position: fixed` dentro do plano (transform de ancestral quebra o `fixed`, a
  mesma armadilha já documentada no `CLAUDE.md`). Hoje não há: `winner-shade` e
  `mulligan-shade` são irmãos de `.board-content`, zoom/lightbox/FX são portais no body.

**Geometria (desktop, ≥ 1041px).** Plano de ~440px de altura (167 + ~110 + 164), `P =
1100px`, `θ = 40°`:
- borda do fundo: z = −220 · sin 40° = −141px → escala `1100 / 1241` = **0,886**;
- borda de perto: z = +141px → escala `1100 / 959` = **1,147**;
- razão fundo/perto = **0,77** — dentro da faixa do Arena (0,75-0,85);
- altura visual do plano = 440 · cos 40° ≈ **337px** → ~100px devolvidos à mão, **se**
  o layout os devolver: transform não muda layout, então o plano leva
  `margin-block: -48px` (≥ 1041) / `-32px` (701-1040), afinados na H3D-03 com a captura.

| Faixa | `perspective` | `--tilt` | contra-inclinação | lean líquido | lift (`translateZ`) |
|---|---|---|---|---|---|
| ≥ 1041px | 1100px | 40° | −28° | **12°** | 16px (hover/seleção 34px) |
| 701-1040px | 1000px | 32° | −22° | **10°** | 12px (hover/seleção 26px) |
| < 701px | — (2.5D, §3) | 0° nas cartas | — | 0° | sombra estática |

### 2.2 Cartas em pé, levitando (pose na `.board-piece`)

```css
.game-board--3d .board-piece {
  transform-style: preserve-3d;
  /* Individuais: o card-arrive (fill both) é dono de `transform` e venceria. */
  translate: 0 0 var(--lift, 16px);
  rotate: x calc(var(--lean) - var(--tilt));      /* -28deg a 40° de mesa */
  transform-origin: 50% 100%;                     /* "pés" da carta no tapete */
  transition: translate 150ms var(--ease-out), rotate 150ms var(--ease-out);
}
```

- `--lean: 12deg`: a carta fica **inclinada para trás** 12° em relação à tela — é o
  "inclinadas" do dono — e o encurtamento vertical é só cos 12° = 0,978 (irrelevante
  para o piso).
- **Hover (`@media (hover: hover)`) / `.is-selected` / `[data-fx="acting"]`:** a carta
  "se levanta" de frente para o jogador — **no tile, não na peça**:
  `.card-tile { translate: 0 0 18px; rotate: x calc(-1 * var(--lean)); }` (lift total
  34px, lean 0°), 150ms `--ease-out`. O `:hover` é ouvido na `.board-piece`, cuja caixa
  **não se move** → a carta erguida não "foge" do cursor e não há flicker de
  hover-in/out. O `translateY(-4px) scale(1.04)` da seleção da onda 1 é trocado por
  isso no 3D; o glow (`::before` do tile) vem junto porque mora na folha.
- **Exausta** (`.board-piece--resting`): 12° de giro **no plano da carta** via
  `transform: rotate(12deg)` no tile (o `rotate` individual já está ocupado pelo eixo X,
  e os dois se compõem) + a dessaturação que já existe. Não mexe no slot.
- **Atordoada:** token sobre a arte (fora deste plano; é o `UX_REVIEW` #3).
- O `card-arrive` passa a animar **opacidade no tile**, não na peça, no 3D
  (`opacity` na peça achataria a sombra durante 330ms).

### 2.3 Lanes sem scroll

`overflow: visible` na lane 3D → as cartas precisam caber. `BoardLane` ganha
`style={{ "--n": creatures.length }}` no `div.board-lane` (valor derivado de `cards`,
que o comparador do memo já considera; nenhuma prop nova):

```css
.game-board--3d .board-lane { overflow: visible; container-type: inline-size;
  justify-content: center; gap: 10px; }
.game-board--3d .card-tile--board {
  width: clamp(64px, calc((100cqi - (var(--n) - 1) * 10px) / var(--n)), var(--card-w-3d));
}
.game-board--3d .battle-zone--opponent { --card-w-3d: 96px; }  /* × 0,886 ≈ 85px visuais */
.game-board--3d .battle-zone--player   { --card-w-3d: 84px; }  /* × 1,147 ≈ 96px visuais */
```

- `container-type: inline-size` aplica contenção de layout/estilo, **não** de paint.
  Risco: em algum motor isso achatar o 3D → verificado na H3D-02 com um probe; plano B é
  medir a largura da lane uma vez por resize (sem estado React).
- Abaixo de 64px (> ~13 criaturas a 1041px): sobreposição `margin-inline-start: -18px`
  (a lane "empilha" como o Arena).
- A faixa `.board-attachments` segue a mesma pose, com cartas a 0,75× da largura.

### 2.4 Sombras no chão, separadas da carta

A sombra é o `::before` da `.board-piece` desfazendo a pose — ela volta a ficar
**deitada no tapete**, embaixo da carta:

```css
.game-board--3d .board-piece::before {
  content: ""; position: absolute; inset: auto 6% -6px; height: 34%;
  transform-origin: 50% 100%;
  transform: rotateX(calc(var(--tilt) - var(--lean))) translateZ(calc(-1 * var(--lift) + 1px));
  background: radial-gradient(closest-side, rgb(0 0 0 / 0.5), transparent);
  opacity: calc(0.62 - var(--lift-n) * 0.3);        /* --lift-n: 0 (16px) → 1 (34px) */
  scale: calc(1 + var(--lift-n) * 0.18);
  pointer-events: none;
}
```

- **Gradiente estático, sem `filter: blur` e sem `box-shadow` animado** — muda só
  `opacity`/`scale` (compositor).
- `+1px` em Z evita *z-fighting* com o playmat (Safari pisca com planos coplanares).
- O `ready-breathe` (`index.css:5180`) anima `box-shadow` da arte. No 3D, cada peça é
  camada de GPU; animar `box-shadow` re-rasteriza a camada a cada frame. No 3D ele vira
  um `::after` do tile com `opacity` animada (mesma aparência, compositor).

### 2.5 Mão em leque (HUD, fora do plano)

A mão **não entra** no plano inclinado (seria menor e ilegível): é HUD na base, como no
Arena, e só ganha o leque. `.hand-track` ganha `style={{ "--n": player.hand.length }}`
(o `GameBoard` não é memo). O índice vem do CSS: `sibling-index()` onde houver, com
fallback de 12 regras `:nth-child(k) { --i: k-1 }` (a mão passa de 12 só em casos
patológicos → cartas 13+ ficam com `--i: 11`).

```css
.game-board--3d .hand-track > .card-tile--hand {
  --d: calc(var(--i) - (var(--n) - 1) / 2);         /* -3,5 … +3,5 com 8 cartas */
  transform-origin: 50% 130%;
  rotate: calc(var(--d) * 3.5deg);                   /* ±12° nas pontas com 8 */
  translate: 0 calc(var(--d) * var(--d) * 2.2px);    /* arco: 27px nas pontas */
  margin-inline: calc(-1 * max(0px, (var(--n) - 6) * 4px));  /* sobrepõe a partir de 7 */
  transition: rotate 200ms var(--ease-out), translate 200ms var(--ease-out), scale 200ms var(--ease-out);
}
.game-board--3d .hand-track > .card-tile--hand:is(.is-selected, :focus-visible) { rotate: 0deg;
  translate: 0 -30px; scale: 1.14; z-index: 5; }
@media (hover: hover) { … :hover { mesma coisa } }
```

- Largura das cartas da mão no 3D desktop: **118px** (vs 103 no 2D) — a mão é a maior
  coisa da tela (Arena ~1,3×). 8 cartas: 8·118 − 7·8 = 888px, cabe na coluna de ~960px.
- `:focus-visible` ergue igual ao hover: teclado tem o mesmo caminho do mouse.
- `.hand-track` no 3D: `overflow: visible` e `padding-top: 36px` para a carta erguida não
  ser cortada.
- O `rotate` individual é **combinado** com o `transform` da seleção da onda 1
  (`translateY(-12px) scale(1.06)`), sem se anularem.

### 2.6 Piso tipográfico em perspectiva — legibilidade manda

Regra: **nenhum texto informativo fica deitado no plano.** Três casos:

1. **Texto dentro da carta** (título, dano, âmbar, estado): já está *billboard* porque a
   carta está (lean de 12° → 0,978). Mas a escala de profundidade do fundo é 0,886: um
   texto de 11px no oponente aparece com 9,7px. Por isso a largura de layout das cartas
   do oponente é maior (96px, §2.3) — o `cqi` cresce com ela — e o piso ganha um fator
   por zona: `--depth-k: 1.13` no oponente (1 no jogador), aplicado a
   `max(calc(var(--fs-card-floor) * var(--depth-k)), 7cqi)`.
2. **`.card-caption` do board** (nome sob a carta) é **ocultado no 3D** (o nome continua
   no `aria-label`, no inspetor e no lightbox). O Arena também não legenda o campo de
   batalha; ganha-se altura e tira-se o texto mais frágil.
3. **Cabeçalhos de zona / console / instrução de luta:** *billboard* completo
   (`rotate: x calc(-1 * var(--tilt))`, `transform-origin: 50% 100%`) + o mesmo
   `--depth-k` no do oponente. O console fica em z≈0: escala 1, sem compensação.

**Piso visual (gate novo):** `e2e/floor` ganha o modo `--view3d`: para cada nó de texto
visível, `fontPx_visual = fontSize_computado × (rect.height / el.offsetHeight)`. Mesmo
contrato: ≥ 11px (≥ 10px em caps com `letter-spacing ≥ 0.1em`), a 360, 768, 1280 e
1440px.

### 2.7 Hit-testing e toque em transforms 3D

- Chrome/Edge/Firefox/Safari fazem hit-test na **geometria projetada** — clicar no que se
  vê funciona sem código. `getBoundingClientRect` devolve a caixa do quadrilátero
  projetado (o que o `FxLayer` e o zoom do `CardArt` já usam).
- **Bloqueios conhecidos:** (a) um elemento com Z maior intercepta cliques de quem está
  "atrás" na tela — o playmat (`::before`) e as sombras levam `pointer-events: none`;
  (b) WebKit tem histórico de hit-test errado com `preserve-3d` + planos coplanares —
  mitigado pelo `+1px` em Z e verificado no Safari iOS real na H3D-07.
- **Alvo de toque = caixa visual.** Critério: toda `.card-tile` do board 3D com caixa
  visual ≥ **56×78px**; `.house-choice`, `.end-turn-button` e `button` do console ≥
  **44×44px** visuais (medido por `getBoundingClientRect` no harness).
- A carta erguida no hover **não muda o alvo**: o hover é ouvido na `.board-piece`
  (caixa fixa) e o movimento acontece no tile filho (§2.2), então não há flicker de
  hover-in/hover-out.
- Long-press → `CardLightbox` (portal) funciona igual.

### 2.8 FxLayer no 3D (voos em screen-space)

O `FxLayer` é um portal no `<body>`, fora do contexto 3D. **Isso é uma vantagem**: a
"apresentação no centro" (UX #1, palco da IA) fica **plana e grande**, sem perspectiva,
que é justamente como o Arena mostra a carta sendo jogada. Ajustes:

1. **Aterrissar inclinado.** O ghost (plano) pousa numa carta com lean de 12° e escala
   de profundidade. O `fx-slam` termina com
   `transform: var(--fx-slot) perspective(1100px) rotateX(var(--fx-land-lean, 0deg))`.
   O diretor lê o modo com `document.querySelector('.game-board--3d')` e seta
   `--fx-land-lean: 12deg` (desktop) no host. A escala do slot já está certa: `to` é a
   caixa projetada da `.card-art` de destino.
2. **Origem no leque.** A carta da ponta do leque está girada ±12°; a caixa dela é ~25%
   maior que a carta (w·cos + h·sin). `captureFx` passa a medir o **centro** pela caixa e
   o **tamanho** por `offsetWidth` (sem transform), e manda a rotação de origem em
   `--fx-from-rot` para o ghost começar alinhado ao leque.
3. **`captureGone`** clona a `.board-piece` inteira — no portal o clone perde a pose. No
   3D o `.fx-gone` ganha `transform: perspective(1100px) rotateX(var(--fx-land-lean))` e
   usa a caixa projetada: diferença residual < 3px em 320ms de fade, imperceptível.
4. **`[data-fx="landing"]`** (`visibility: hidden`) continua funcionando: não é
   agrupamento, não achata nada.
5. **Onda 2/3 (§3-§4 do ANIMATIONS_PLAN):**
   - `acting` do Warden = `--lift: 34px; --lean: 0deg` (a carta "se levanta"), **não**
     `translateY(6px) scale(1.12)` — no 3D "descer em direção ao jogador" é subir em Z.
   - **Investida da luta** anima `translate` **no espaço do plano** (a peça atacante
     sobe na tela e diminui por perspectiva sozinha): WAAPI em
     `translate: 0 0 34px → 0 calc(dy) 34px`, com `composite: "replace"` só na
     propriedade individual — a pose (`rotate`) não é tocada. `dy` = distância no plano
     entre as duas lanes (medida por `offsetTop`, não pela caixa projetada).
   - **FLIP das vizinhas** (onda 3) usa `translate` individual também — nunca `transform`
     da peça.
   - Números de dano, gemas de âmbar, linha de mira: screen-space, nascem no **centro da
     caixa projetada** (já é o que `getBoundingClientRect` dá). Nada muda.
   - Shake da forja: no 3D sacode o `.table-plane` com `translate` individual (±2px), não
     o `.board-content` (que carrega a perspectiva).
6. **`cancelAll()`** é chamado ao alternar 2D/3D (rects de viewport deixam de valer),
   como já acontece em scroll/resize.

### 2.9 Performance

- Anima **só** `translate`/`rotate`/`scale`/`opacity`. Zero `box-shadow`/`filter`
  animados dentro do plano (o `ready-breathe` é convertido, §2.4).
- **Camadas:** cada peça com pose 3D já é promovida; ~20 peças + 20 sombras + mão ≈ **50
  camadas**. Custo de memória a DPR 3 (carta 96×134 CSS → 288×402 px × 4B ≈ 0,46 MB) ≈
  20 MB no pior caso. Aceitável; teto de auditoria: **≤ 60 camadas** no painel Layers.
- `will-change` **só** em: `.table-plane` durante a transição de modo (removido no
  `transitionend`), carta da mão em hover/seleção, ghost do FX. Nunca em todas as peças.
- Nada de `backdrop-filter` dentro ou atrás do plano.
- Parallax (H3D-12): 1 listener `pointermove` passivo, `requestAnimationFrame`, escreve
  2 custom properties no `.table-plane`; zero React.
- **Metas:** (a) 60fps (nenhum frame > 16,7ms) varrendo o mouse pelo leque e pelo board a
  1280×800 com CPU 4× throttle no DevTools; (b) transição 2D↔3D sem frame > 33ms;
  (c) turno da IA com voos (onda 1) sem long task nova além do `chooseAiMove`.

### 2.10 Reduced motion

- `prefers-reduced-motion: reduce` **ou** `settings.animations = false` (classe
  `reduce-motion` no `<html>`, `App.tsx:2002`): a **pose 3D permanece** (é estática, não
  vestibular), mas: sem transição entre modos (troca instantânea), sem hover que ergue
  (a seleção ainda ergue — é estado, não movimento — mas sem transição), sem parallax,
  sem shake. O guard `motionEnabled` (`fx.ts:72`) já corta os voos.
- A regra global `.reduce-motion * { … }` (`index.css:6335`) cobre as `transition`s; o
  parallax checa o mesmo guard em JS.

### 2.11 Toggle 2D/3D (persistido, sem recarregar)

- `settings.ts`: `tableView: "2d" | "3d"`, default **`"2d"`**; `readSettings` valida
  (`parsed.tableView === "3d" ? "3d" : "2d"`) — saves antigos continuam 2D.
- UI:
  1. **Settings › Som e movimento**: `Toggle` "Mesa 3D" / "3D table" + sub
     "Mesa inclinada com cartas flutuando." (`config.experience.view3d[Sub]`); linha no
     resumo do setup (`App.tsx:944`).
  2. **Botão rápido na partida** no `.match-heading`: ícone `Box` do lucide (já no
     pacote, tree-shaken), `aria-pressed`, `aria-label={t("game.view3dToggle")}`, 44×44.
- `GameBoard`: `className` ganha `" game-board--3d"` e `data-view="3d"`.
- **Transição (com movimento ligado):** 420ms `cubic-bezier(0.2, 0.8, 0.2, 1)`:
  o `--tilt` é registrado com `@property --tilt { syntax: "<angle>"; inherits: true;
  initial-value: 0deg }` e transiciona 0° → 40°; como a pose das cartas é
  `calc(var(--lean) - var(--tilt))`, elas acompanham no mesmo frame sem timeline
  separada. As mudanças de layout (largura de carta, lane sem scroll, `margin-block`)
  acontecem no frame 0, mascaradas por um fade do `.board-content` 1 → 0,65 → 1 em
  420ms. Navegadores sem `@property` (Firefox < 128): troca instantânea — degradação
  aceitável.
- Chama `fxRef.current?.cancelAll()` e mantém o foco no botão do toggle.
- O **replay viewer** usa o mesmo `GameBoard` → herda o 3D de graça.
- `@supports not (transform-style: preserve-3d)` → a classe 3D não aplica nada (2D).

---

## 3. Mobile primeiro (360px)

**Recomendação: a 360px o modo 3D vira "2.5D" — mesa inclinada só como cenário, cartas
planas com profundidade por tamanho. Não desligar o toggle, não inclinar as cartas.**

Por quê:
- Em < 701px as lanes **precisam** de scroll horizontal (`board-lane overflow-x: auto`,
  e a mão com scroll-snap). Scroll achata o 3D: as cartas ficariam deitadas no plano
  (trapézio + texto comprimido por cos θ) — reprova no piso.
- A largura é 342px úteis: sem margem para cartas maiores do oponente compensarem a
  profundidade (§2.6).
- Desligar o 3D no celular frustra quem ativou o modo e deixa o toggle mentindo.

Perfil **2.5D** (`.game-board--3d` abaixo de 701px):

| Elemento | Comportamento |
|---|---|
| Playmat | `.table-plane::before` inclinado **30°** com `perspective: 800px` — só decoração (`pointer-events: none`), dá o trapézio e o ponto de fuga. |
| Cartas do oponente | planas, **60px** (vs 68 no 2D) — "mais longe"; `opacity` do playmat mais escura atrás delas. |
| Cartas do jogador | planas, **72px** — "mais perto". |
| Sombras | a mesma sombra em gradiente, estática (sem lift). |
| Lanes e mão | scroll como no 2D (sem leque — 8 cartas em leque não cabem em 342px sem sobrepor > 50%). |
| Seleção | sobe 8px (limite já fixado no ANIMATIONS_PLAN §1 para 360px) + sombra se afasta. |
| Texto | layout real = visual (nada de transform nas cartas) → o `e2e:floor` normal vale. `cqi` de 60px: `max(10px, 7cqi)` = 10px só em caps; caption do board oculto como no 3D. |
| Toque | cartas de 60×84 e 72×101 visuais ≥ 44px; controles inalterados. |

701-1040px (tablet / celular deitado): 3D real com `--tilt: 32°` (tabela §2.1), leque
com 3° por carta e sobreposição a partir de 6.

**Degradação automática para 2.5D também no desktop** quando: `@supports not
(transform-style: preserve-3d)`, ou `navigator.hardwareConcurrency <= 2`. Nada de
detectar "celular fraco" por UA. O usuário não é avisado (o modo continua "3D"; só
o perfil muda).

---

## 4. Histórias de desenvolvimento

Esforço: **S** ≤ ½ dia · **M** 1-2 dias · **L** 3+ dias. Todas exigem `npm run build`
e **`e2e:capture` do 2D idêntico à baseline** (o 2D não pode mudar).

### H3D-01 — Toggle e persistência (S)
**Como** jogador, **quero** ligar/desligar a mesa 3D nas configurações e na própria
partida **para** escolher a visão sem perder o jogo.
- **Escopo:** `lib/settings.ts` (`tableView`), `lib/i18n.ts` (3 chaves en+pt-BR),
  `App.tsx` (Toggle em Som e movimento, linha no resumo l.944, botão no
  `.match-heading`, classe/`data-view` no `GameBoard`), `index.css` (botão 44px).
- **Aceite:** default `"2d"`; setting sobrevive a reload; save antigo sem o campo →
  2D; alternar no meio da partida não re-renderiza `CardTile` (React Profiler: 0
  commits de tile no toggle); `cancelAll()` chamado; foco permanece no botão;
  `aria-pressed` correto; bundle ≤ +0,3 kB gz.
- **Depende de:** nada.

### H3D-02 — Base da cena 3D (M)
**Como** desenvolvedor, **quero** um contexto 3D limpo sobre o board atual **para**
que inclinar a mesa não quebre layout, cliques nem o modo 2D.
- **Escopo:** `App.tsx` (wrapper `.table-plane` com `display: contents` no 2D),
  `index.css` (perspective, `preserve-3d` na cadeia, `overflow: visible` na lane 3D,
  `z-index` dos HUDs), `e2e/probes/_3d-chain.mjs` (probe novo).
- **Aceite:** probe percorre `.table-plane → .board-piece` e falha se algum ancestral
  computar `overflow ≠ visible`, `opacity < 1`, `filter ≠ none`, `isolation: isolate`,
  `clip-path`/`mask` ou `transform-style ≠ preserve-3d`; `container-type` na lane não
  achata (probe mede que a `.card-art` tem caixa projetada ≠ caixa plana com tilt 40°);
  2D pixel-idêntico; `e2e:smoke` passa com `tableView: "3d"` e tilt 0°.
- **Depende de:** H3D-01.

### H3D-03 — Mesa inclinada e playmat (M)
**Como** jogador, **quero** ver a mesa inclinada a partir do meu ponto de vista **para**
sentir que estou sentado diante dela.
- **Escopo:** `index.css` (`rotateX(var(--tilt))` 40°/32°, `perspective` 1100/1000,
  `perspective-origin 50% 38%`, playmat em `.table-plane::before` com vinheta e
  realce central, `margin-block` que devolve altura), billboard de `.zone-heading`,
  `.turn-console`, `.fight-instruction`.
- **Aceite:** a 1280×800, borda de fundo do playmat 12-18% mais estreita que a de
  perto; razão de escala oponente/jogador entre 0,74 e 0,80 (medida pela largura
  visual de duas cartas iguais); topo das cartas da mão ≥ 60px mais alto que no 2D;
  botões do console ≥ 44×44 visuais; `.zone-heading` do oponente ≥ 10px visuais
  (caps).
- **Depende de:** H3D-02.

### H3D-04 — Cartas em pé, levitando (L)
**Como** jogador, **quero** que as criaturas fiquem de pé, inclinadas e flutuando sobre
a mesa **para** reconhecer cada carta como no Arena, sem esforço de leitura.
- **Escopo:** `index.css` (pose com `translate`/`rotate` individuais na `.board-piece`,
  `--lift`/`--lean`, hover/seleção levantam, exausta com `rotate(12deg)` no tile,
  caption oculto, `--depth-k`, larguras 96/84 com `clamp` por `--n`, sobreposição > 13),
  `App.tsx` (`--n` no `div.board-lane`), `card-arrive` por opacidade no tile.
- **Aceite:** lean líquido medido 12° ± 1° (a razão altura/largura visual da carta =
  1,40 × cos 12° ± 2%); 12 criaturas a 1280×800 sem scroll horizontal nem corte;
  hover ergue em 150ms sem flicker (mover o cursor de baixo para cima da carta não
  gera `pointerleave`); piso visual ok (via H3D-11); `card-arrive` não deixa `transform`
  residual que anule a pose (probe: `rotate` computado ≠ `none` após 400ms do mount).
- **Depende de:** H3D-03.

### H3D-05 — Sombras no chão (S)
**Como** jogador, **quero** ver a sombra de cada carta no tapete **para** perceber que
ela flutua e a que altura.
- **Escopo:** `index.css` (`.board-piece::before` em gradiente, `+1px` em Z,
  opacidade/escala por `--lift-n`), conversão do `ready-breathe` para `opacity` no 3D.
- **Aceite:** sombra deitada no plano (caixa visual mais larga que alta); lift 16 →
  34px faz a sombra ir de opacidade 0,62 → 0,32 e escala 1 → 1,18; zero animação de
  `box-shadow`/`filter` no 3D (probe: `getAnimations()` filtrado por propriedade);
  sem z-fighting em Safari (captura em 3 frames seguidos idêntica).
- **Depende de:** H3D-04.

### H3D-06 — Mão em leque (M)
**Como** jogador, **quero** minha mão grande em leque na base da tela **para** ler minhas
cartas e escolher com um toque, como no Arena.
- **Escopo:** `App.tsx` (`--n` no `.hand-track`), `index.css` (`--i` via
  `sibling-index()`/`:nth-child`, `rotate` 3,5°/carta, arco 2,2px·d², sobreposição a
  partir de 7, 118px de largura, erguer em hover/seleção/`:focus-visible`,
  `overflow: visible` + `padding-top: 36px`).
- **Aceite:** 8 cartas a 1280px sem scroll, pontas a ±12° ± 0,5°; carta erguida
  (−30px, 1,14×, 0°) totalmente visível (não cortada); Tab percorre a mão na ordem e
  cada foco ergue a carta; toque seleciona sem precisar de hover; leque desligado
  < 701px (scroll-snap intacto).
- **Depende de:** H3D-01 (independente do plano — pode andar em paralelo a 02-05).

### H3D-07 — Interações em 3D: selecionar, jogar, lutar, alvo (M)
**Como** jogador, **quero** selecionar, jogar, colher, lutar e escolher alvos na mesa
inclinada exatamente como no 2D **para** que o modo 3D não custe precisão.
- **Escopo:** `index.css` (seleção = lift 34px + lean 0 + glow da onda 1;
  `.board-lane--targeting` e `.is-dimmed` no 3D; `pointer-events: none` em playmat e
  sombras), `e2e/probes/_3d-hit.mjs` (clica no centro visual de cada carta e confere
  que o `data-iid` recebido é o esperado).
- **Aceite:** 100% dos cliques no centro visual acertam a carta certa, com 1, 6 e 12
  criaturas por lado, a 768/1280/1440 em Chromium, Firefox e WebKit
  (`playwright-core` com os navegadores do sistema onde houver; Safari iOS real
  manual); alvos visuais ≥ 56×78 (cartas) e ≥ 44×44 (controles); `e2e:smoke` em 3D
  passa 2 turnos.
- **Depende de:** H3D-04, H3D-06.

### H3D-08 — Integração com as ondas de FX (M)
**Como** jogador, **quero** que a carta jogada voe do leque, se apresente grande e caia
inclinada no seu lugar na mesa **para** sentir o peso da jogada também no 3D.
- **Escopo:** `components/FxLayer.tsx` (`--fx-land-lean`, tamanho de origem por
  `offsetWidth` + `--fx-from-rot`, `.fx-gone` com perspectiva), `index.css`
  (`fx-slam` com `perspective() rotateX()` final; `acting` no 3D = lift/lean),
  guia para a onda 2/3: investida e FLIP em `translate` individual, shake no plano.
- **Aceite:** no quadro de pouso, a diferença entre a caixa do ghost e a caixa da
  `.card-art` de destino ≤ 3px em cada lado (1280×800, criatura do jogador e do
  Warden); ghost saindo da ponta do leque não "pula" de tamanho no frame 0 (≤ 4% de
  diferença de largura); hold da IA inalterado (420ms); alternar o modo durante um voo
  não deixa ghost órfão nem `data-fx` residual.
- **Depende de:** H3D-04, H3D-06, onda 1 de FX commitada.

### H3D-09 — Mobile e degradação (M)
**Como** jogador no celular, **quero** o modo 3D funcionando sem letra minúscula nem
toque errado **para** ter a mesma sensação de mesa no telefone.
- **Escopo:** `index.css` (perfil 2.5D < 701px: playmat 30° decorativo, cartas 60/72px
  planas, sombra estática; perfil 701-1040 com 32°), `App.tsx` (classe
  `game-board--lite` quando `hardwareConcurrency <= 2`), `@supports`.
- **Aceite:** a 360×800, `e2e:floor` normal e `--view3d` passam; nenhum `rotate`/
  `translate` 3D computado em `.board-piece` < 701px; lanes e mão rolam como no 2D;
  alvos ≥ 44px; trace com CPU 6× throttle sem frame > 33ms rolando a lane.
- **Depende de:** H3D-03, H3D-04, H3D-05.

### H3D-10 — Transição entre modos (S)
**Como** jogador, **quero** ver a mesa "deitar" suavemente quando ligo o 3D **para**
entender o que mudou sem desorientar.
- **Escopo:** `index.css` (`@property --tilt`, transição 420ms, fade 1 → 0,65 → 1,
  `will-change` só durante a transição), `App.tsx` (remover `will-change` no
  `transitionend`).
- **Aceite:** 420ms ± 20ms medidos; nenhum frame > 33ms (CPU 4×); com reduce-motion ou
  animações off, troca em 1 frame; sem `@property` (Firefox antigo) troca instantânea
  sem erro; nenhum layout shift depois do fim da transição (CLS 0 no trecho).
- **Depende de:** H3D-02, H3D-03, H3D-04.

### H3D-11 — Harness do 3D (M)
**Como** mantenedor, **quero** gates automáticos para o 3D **para** que os dois modos
não regridam em silêncio.
- **Escopo:** `e2e/capture` (+ variante 3D: 4 viewports × tela do board), `e2e/floor`
  (`--view3d` com fator de escala visual), `e2e/smoke` (roda também com
  `tableView: "3d"`), `e2e/acceptance` (inclui os dois), probes da H3D-02/07.
- **Aceite:** `npm run e2e:acceptance` roda 2D + 3D; baseline 3D versionada em
  `e2e/shots/baseline-3d`; o gate de piso visual falha de propósito se o
  `--depth-k` for removido (teste do teste).
- **Depende de:** H3D-02 (começa cedo e cresce com cada história).

### H3D-12 — Polish: parallax da câmera e reflexo (S-M)
**Como** jogador no desktop, **quero** que a mesa reaja levemente ao mouse e que as
cartas brilhem no tapete **para** a cena parecer viva.
- **Escopo:** `App.tsx` ou hook pequeno (`pointermove` passivo + rAF, lerp 0,12/frame,
  só com `(hover: hover)` e `motionEnabled`), `index.css` (`--cam-x/--cam-y` →
  `rotateY(±2.5deg)` e `--tilt ± 1.5deg` no plano; reflexo = `::after` da peça com
  `radial-gradient` da `--house-color` a 18% de opacidade deitado no tapete; luz do
  playmat acompanha o `--cam-x`).
- **Aceite:** amplitude máxima ±2,5° (Y) e ±1,5° (X); volta ao neutro em 600ms quando o
  ponteiro sai do board; 0 re-render React por `pointermove`; desligado em toque e em
  reduce-motion; hit-test da H3D-07 continua 100% com a câmera no extremo; ≤ +0,4 kB gz.
- **Depende de:** todas as anteriores.

### Ordem sugerida

```
H3D-01 ─► H3D-02 ─► H3D-03 ─► H3D-04 ─► H3D-05 ─► H3D-09 ─► H3D-07 ─► H3D-08 ─► H3D-10 ─► H3D-12
            │                                          ▲
            └─► H3D-11 (cresce junto)      H3D-06 ─────┘  (paralelo a 02-05)
```

Marcos de entrega: **M1** (01-05 + 11 parcial) = mesa inclinada com cartas flutuando,
já jogável; **M2** (06, 09, 07) = leque + celular + interação validada; **M3** (08,
10, 12) = FX, transição e polish. **Pré-requisito externo:** onda 1 de FX commitada e
com o teto de bundle revisado antes de H3D-08.

---

## 5. Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| **Legibilidade**: texto encolhe na profundidade e o `e2e:floor` atual não percebe (mede `font-size` computado). | Alta | Alto | Nada de texto no plano (§2.6): billboard + `--depth-k`, caption do board oculto, cartas do fundo mais largas; gate de **piso visual** (H3D-11) com teste do teste. Tilt limitado a 40° (máx. 48°). |
| **Performance mobile**: ~50 camadas de GPU, sombras, leque com transições. | Média | Alto | < 701px é 2.5D (cartas sem 3D); só `transform`/`opacity`; `ready-breathe` convertido; `will-change` pontual; perfil lite por `hardwareConcurrency`; metas de trace nas histórias 04/09/10. |
| **Hit-testing / WebKit**: cliques no lugar errado com `preserve-3d`, z-fighting. | Média | Alto | `pointer-events: none` em decoração, `+1px` em Z, probe de clique automatizado nos 3 motores + Safari iOS manual (H3D-07). |
| **Achatamento acidental**: alguém adiciona `overflow`/`opacity`/`filter` num ancestral e o 3D some silenciosamente. | Alta (com o tempo) | Médio | Probe da cadeia 3D no `e2e:acceptance` (H3D-02); comentário "por quê" no CSS da cadeia. |
| **Conflito com animações existentes**: `card-arrive` com `both` e os `transform` da onda 1/2/3 anulando a pose. | Alta | Médio | Pose só em propriedades individuais; FX de peça em `translate` individual; probe de `rotate` computado após o mount. |
| **Acessibilidade / screen reader**: transforms não mudam a árvore a11y, mas a ordem visual pode divergir da ordem DOM; foco em elemento transformado. | Baixa | Médio | O 3D não reordena nada (oponente em cima, jogador embaixo, igual ao DOM); o wrapper é `display: contents` no 2D e `div` sem role no 3D; `:focus-visible` ergue a carta (foco sempre visível); o toggle tem `aria-pressed` e label via `t()`; o 3D não é obrigatório e o default é 2D. |
| **Bundle**: +2,0 a +2,6 kB gz com o teto já estourado pela onda 1 (136,52 vs 135). | Certa | Médio | Estimativa por história (01 ≈ 0,3 · 02-05 ≈ 1,0 · 06 ≈ 0,3 · 08-10 ≈ 0,5 · 12 ≈ 0,4, só CSS/TS, zero dependência); revisão explícita do teto em chore commit por marco (M1/M2/M3) com esta tabela como justificativa; varredura de CSS morto antes de cada revisão (probes `_dead-css`/`_dup-css` já existem). |
| **Manutenção de dois modos**: toda mudança futura de board precisa ser checada em 2D e 3D. | Certa | Médio | 3D é **só CSS escopado** (`.game-board--3d`) sobre o mesmo DOM — nenhum componente duplicado; `e2e:capture`/`floor`/`smoke` rodam os dois modos (H3D-11); regra no `CLAUDE.md` (a acrescentar quando M1 entrar): "mudou board → capture 2D e 3D". |
| **Altura a 1280×800**: transform não devolve layout; sem o `margin-block` negativo a mão continua na dobra. | Média | Baixo | `margin-block` afinado por captura (H3D-03, critério "topo da mão ≥ 60px mais alto"). |
| **Expectativa do dono** ("igual ao Arena"): o ângulo é menor (40° vs 50-55°) e o celular é 2.5D. | Média | Baixo | Explicar a troca legibilidade × ângulo com captura lado a lado em M1; `--tilt` é um único token para ajustar até 48° se o dono preferir, com o gate de piso decidindo. |
