# UX ARENA PLAN — jornada, auditoria e contrato das fases C/D/E

**Escopo**: missão UX ARENA (jornada completa + design system + home AAA + mesa
estilo MTG Arena). Este documento é o **CONTRATO** das fases C, D e E: nada que
contradiga o backlog abaixo deve ser implementado sem revisar este arquivo.

**Gates obrigatórios ao fim de cada fase** (todas as fases, sem exceção):

| Gate | Comando | Critério |
| --- | --- | --- |
| Encaixe | `node e2e/fit.mjs` (+ `--view 3d`) | `FIT OK` — a partida inteira cabe no viewport sem rolar, mão 100% visível |
| Tipos | `npx tsc --noEmit` | sem erros |
| Testes | `npx vitest run` | **873+** verdes (nunca menos que a baseline) |
| Captura | `node e2e/capture.mjs --out e2e/shots/ux-<fase>` e `--view 3d --out e2e/shots/ux-<fase>-3d` | shots 2D e 3D novos gerados |

> **Restrição dura descoberta na baseline**: a tela de jogo tem **folga vertical
> zero**. FIT mediu `soma=768 viewport=768` (1024×768) e `soma=1024 viewport=1024`
> (768×1024). Qualquer elemento novo que some altura de layout quebra o gate.
> Profundidade e movimento **só via `transform`/`opacity`** (que não alteram
> layout box). Se o FIT quebrar, o ajuste está errado — reverta.

---

## 1. Inventário de telas

Todas as telas vivem em `src/App.tsx` (single-file) e são selecionadas pelo
estado `screen`. A navegação é o `header-nav` (desktop, `App.tsx:3823`) e a
`mobile-tabs` (mobile, `App.tsx:4280`).

| # | Tela | Seletor | Onde | Papel |
| --- | --- | --- | --- | --- |
| 1 | **Home** | `.home-screen` | `App.tsx:540` | Hero + escolha de baralho + atalhos + CTA |
| 2 | **Config** (wizard) | `.config-screen` | `App.tsx:935` | 6 passos: mode, difficulty, opponent, thinking, experience, review |
| 3 | **Browse / Vault** | `.browse-screen` (`screen === "browse"`) | `App.tsx:3952` + `src/components/DeckBrowser.tsx` | Biblioteca completa, busca, favoritos, import |
| 4 | **Inspect** | `screen === "inspect"` | `App.tsx:3965` + `src/components/DeckInspector.tsx` | Detalhe do baralho, cartas por casa, export |
| 5 | **Partida — setup** | `.game-screen` + `.winner-shade.mulligan-shade` | `App.tsx:1990` | Mulligan (keep/take) |
| 6 | **Partida — review** | `.config-screen` passo `review` | `App.tsx:1225-1291` | Resumo: decks, interface, catálogo, LLM |
| 7 | **Partida — jogo** | `.game-screen` + `.game-board` | `App.tsx:4010`, `GameBoard` `App.tsx:1653` | Mesa: bands, battlelines, console, mão |
| 8 | **Partida — vitória** | `.winner-shade` | `App.tsx:2026-2057` | Stats + rematch/replay/home |
| 9 | **Pass-and-play** | `.winner-shade.pass-shade` | `App.tsx:2012` | Passar o aparelho entre turnos |
| 10 | **Peek** | `PeekDialog` | `App.tsx:2313` | "Look at …" modal privado |
| 11 | **Deck modal** | `DeckModal` | `App.tsx:2238` | Import de baralho |
| 12 | **Tutorial** | `TutorialWizard` | `src/components/TutorialWizard.tsx` | Onboarding em passos |
| 13 | **Config LLM** | `LlmSettings` | `src/components/LlmSettings.tsx` | BYOK do pipeline de abilities |

Colunas/peças da mesa (`GameBoard`):
`player-band` (×2) · `battle-zone--opponent` · `turn-console` ·
`battle-zone--player` · `hand-zone`/`hand-track` · `command-rail` (dockada ou
drawer) · `SelectedCardPanel` · `felt-etching` · `table-plane` (só no 3D).

---

## 2. Jornada alvo (fluxo ideal do jogador)

> O jogador abre o app e, **em um toque**, está jogando: o home já traz o
> baralho selecionado e o CTA primário **"Start match"** parte direto para a
> partida com as configurações atuais (o wizard continua acessível como ajuste
> fino, não como pré-requisito). A mesa surge com uma transição de entrada que
> leva o baralho escolhido da home para o campo, o jogador vê sua mão em leque
> na base e as duas battlelines em profundidade, escolhe a casa do turno com um
> glow claro e joga; cada jogada tem feedback curto e o console narra o que
> aconteceu. Ao terminar, a tela de vitória mostra o placar e devolve o jogador
> ao home em um toque — e o ciclo recomeça sem fricção.

Mapa da jornada (estado atual → alvo):

```
HOJE:   home → [Ir para os ajustes] → config(6 passos) → review → [Start match]
              → mulligan → jogo → vitória → home

ALVO:   home → [Start match] ─────────────────────────→ mulligan → jogo → vitória
        └─▶ config(ajuste fino, opcional)  └─▶ review
        └─▶ browse / inspect (paralelo, sem sair do fluxo)
```

---

## 3. Backlog UX (fricções numeradas)

Cada item: **tela · evidência (arquivo:linha) · correção proposta**.

### UX-01 — Jornada até a primeira partida é longa demais
- **Tela**: Home → Config → Review
- **Evidência**: `src/App.tsx:494-651` (HomeScreen, CTA único é
  `home.continueSetup` em `:641`), `src/App.tsx:653`
  (`MODE_CONFIG_STEPS` com **6** passos), `src/App.tsx:1292-1300`
  (o `home.play`/"Start match" só aparece quando `activeStep === "review"`).
- **Correção**: CTA primário do home vira **"Start match"** quando já há
  baralho selecionado (mantendo o wizard como caminho secundário). Nada de
  navegação nova — mesma função, atalho. *Fase D.*

### UX-02 — Troca de tela sem continuidade espacial
- **Tela**: todas
- **Evidência**: `src/index.css:603-611` — `.screen` usa a **mesma**
  animação `screen-in 420ms` para home, config, browse, inspect e game. Sem
  cascata por seção, sem entrada do tabuleiro.
- **Correção**: tokens de motion (Fase C) + entradas em cascata por seção e
  transição de entrada da tela (Fase D) e transições de jogada (Fase E).

### UX-03 — Home sem hierarquia clara entre hero, grade e CTA
- **Tela**: Home
- **Evidência**: `src/App.tsx:541` (`home-hero`), `:558` (`home-section`),
  `:628` (`home-cta-bar`) — três blocos com peso visual próximo; o glow do hero
  (`home-hero-glow`, `src/index.css:4311`) e o CTA competem pelo olhar.
- **Correção**: camadas com elevação crescente (hero < grade < CTA) e glow
  reservado ao CTA. *Fase C (tokens) + Fase D (aplicação).*

### UX-04 — Hover dos baralhos sem profundidade
- **Tela**: Home, Browse
- **Evidência**: `src/index.css:4653-4674` — o hover só acende o
  `.deck-tile-sheen` (brilho que desliza); não há lift, nem sombra de elevação,
  nem giro 3D. As referências MTG Arena (`docs/references/mtg-arena/NOTES.md`
  §"Hierarquia") mostram elevação + sombra larga como resposta de hover.
- **Correção**: hover com elevação 3D (`translateZ`/`scale` + sombra de
  elevação), desligado no `prefers-reduced-motion`. *Fase D.*

### UX-05 — Baralho selecionado não se destaca o suficiente
- **Tela**: Home
- **Evidência**: `src/components/DeckTile.tsx:37-40` — o estado selecionado só
  adiciona `deck-tile--selected` e troca o rótulo do botão para `home.selected`
  (`"SELECTED"`); o tile não ganha cor de casa nem elevação persistente.
- **Correção**: borda/glow com a `houseColor` do baralho + elevação de
  seleção. *Fase C (token de elevação) + Fase D.*

### UX-06 — Escala de espaçamento irregular
- **Tela**: todas
- **Evidência**: `src/index.css:292,302,312,322,362,369,435,440,447,626,667,678`
  usam `gap` **1, 5, 6, 7, 8, 9, 10, 14, 15, 16, 18px** — onze valores sem
  escala. Mais `marginTop` inline em `src/App.tsx:1047,1071,1073,1087,1089`
  (8/12/14px), que passam por cima de qualquer sistema.
- **Correção**: tokens `--space-*` na escala **4/8** (4, 8, 12, 16, 24, 32,
  48, 64) e substituição pontual dos valores + remoção dos inline.
  *Fase C.*

### UX-07 — Sem escala de sombras/elevação
- **Tela**: todas
- **Evidência**: **58** declarações `box-shadow` espalhadas por
  `src/index.css` (ex.: `:2138` `inset 0 0 14px …`, `:7857` `inset 0 0 0 2px …`),
  nenhuma referenciando um grau de elevação.
- **Correção**: tokens `--elev-0/1/2/3` + `--elev-focus` e aplicação nos
  painéis, cartas e overlays. *Fase C.*

### UX-08 — Motion sem tokens: durações e easings literais
- **Tela**: todas
- **Evidência**: durações literais (200/240/260/320/330/420/520/620/660ms) em
  **39** `transition:`/`animation:` de `src/index.css`, e **8**
  `cubic-bezier(...)` distintos contra **um** único token `--ease-out`
  (`src/index.css:147`). Exemplos de easings órfãos:
  `cubic-bezier(0.2, 1.6, 0.4, 1)`, `cubic-bezier(0.16, 1, 0.3, 1)`,
  `cubic-bezier(0.55, 0, 0.75, 0.25)`.
- **Correção**: tokens `--dur-fast/base/slow/enter` e
  `--ease-out/--ease-in/--ease-spring/--ease-emph`, migrando os literais.
  *Fase C.*

### UX-09 — Tipografia sem tokens de peso/linha
- **Tela**: todas
- **Evidência**: a escala `--fs-*` já existe (`src/index.css:100-113`), mas não
  há tokens de `line-height`/`letter-spacing`/peso; os títulos usam
  `text-transform`/`letter-spacing` ad-hoc (ex.: `.eyebrow`, `src/index.css`).
- **Correção**: tokens `--lh-tight/snug/normal`, `--ls-caps/eyebrow`,
  `--fw-normal/medium/semibold`. *Fase C.*

### UX-10 — Console de turno visualmente separado da mesa
- **Tela**: Partida — jogo
- **Evidência**: `src/App.tsx:1853` (`turn-console`) é irmão do `.table-plane`
  no 3D; `src/index.css:929` o reposiciona mas ele continua lendo como uma
  faixa colada, não como HUD integrado ao tapete (as referências mostram o HUD
  dentro do aro do tabuleiro).
- **Correção**: integrar visualmente o console ao aro do playmat (bordas,
  glow da casa ativa, alinhamento com a vinheta). *Fase E.*

### UX-11 — Zona de chaves/âmbar sem hierarquia
- **Tela**: Partida — jogo
- **Evidência**: `AmberCounter` (`src/App.tsx:1308`) e `KeyCounter`
  (`src/App.tsx:1324`) vivem dentro da `player-band` (`src/App.tsx:1406`), uma
  faixa de 44–52px (`--band-h`, `src/index.css:172-196`) onde disputam espaço
  com avatar, nome, correntes e a casa ativa.
- **Correção**: bloco "pool" agrupado, com contagem de chaves em destaque e o
  glow da casa ativa elevado (`--turn-house`). *Fase E.*

### UX-12 — Battlelines sem profundidade por fileira
- **Tela**: Partida — jogo
- **Evidência**: a diferença de profundidade hoje é só de **largura de carta**
  (`--card-w-2d5: 60px` oponente / `72px` jogador, `src/index.css:7740-7741`) e
  de fator de texto (`--depth-k: 1.13`, `:7897`); não há `translateZ`/escala por
  fileira como nas referências (`NOTES.md` §1 "Profundidade por fileira").
- **Correção**: cada fileira ganha profundidade própria (escala/`translateZ`
  consistente com `--tilt`), reforçando o "eu na frente, oponente ao fundo".
  *Fase E.*

### UX-13 — Zonas vazias sem feedback de estado
- **Tela**: Partida — jogo
- **Evidência**: `src/App.tsx:1987` (`empty-hand`) e o `empty-battleline`
  (`src/index.css:8135`) são texto simples; no 3D o do jogador é escondido
  (`clip-path`, `src/index.css:8131-8139`) e só o do oponente volta fraco
  (`:8142-8150`). O estado "sua fileira está vazia" não tem tratamento visual.
- **Correção**: placeholder com hierarquia (glow suave, texto secundário)
  consistente nos dois lados. *Fase E.*

### UX-14 — Feedback de jogada sem token compartilhado
- **Tela**: Partida — jogo
- **Evidência**: as transições de jogada usam durações próprias
  (`card-arrive 330ms`, `card-deal`, `toast-in 260ms`, `sheet-in 240ms`,
  `forge-flash`) sem um vocabulário comum de motion.
- **Correção**: todas passam a ler os tokens de motion da Fase C; a Fase E
  define as transições de jogada (entra/sai/ergue/golpe) sobre esses tokens.

---

## 4. Plano das fases C / D / E

### Fase C — Design System (tokens + consistência)
1. Acrescentar em `src/index.css` (`:root`):
   - **Espaçamento** `--space-1..--space-8` (4/8/12/16/24/32/48/64).
   - **Elevação** `--elev-0`, `--elev-1`, `--elev-2`, `--elev-3`, `--elev-focus`.
   - **Motion** `--dur-fast` (140ms), `--dur-base` (220ms), `--dur-slow`
     (340ms), `--dur-enter` (420ms); `--ease-out`, `--ease-in`,
     `--ease-spring`, `--ease-emph` (sobrescrevendo/augmentando `--ease-out`).
   - **Tipografia** `--lh-tight/snug/normal`, `--ls-eyebrow/ls-caps`,
     `--fw-medium/semibold`.
   - Cores por casa já existem (`houseColor`, `src/lib/houses.ts`) — não mexer.
2. Aplicar nos componentes de `src/components/` **sem mudar comportamento**:
   `DeckTile`, `DeckBrowser`, `DeckInspector`, `TutorialWizard`, `LlmSettings`,
   `CoverageBadge`, `Pagination`, `HouseIcon`, `CardArt`, `FxLayer`, `ErrorBoundary`.
3. Substituir literais pontuais (gaps, sombras, durações) pelos tokens onde a
   troca for 1:1. **Nada de rewrite total.**
4. Gates.

### Fase D — Home estilo AAA (sem navegação nova)
1. **Parallax leve** do fundo do hero (camadas de profundidade que respondem ao
   pointer, como o `--cam-x/--cam-y` do 3D — `src/index.css:7631`).
2. **Partículas de Æmber/glow** via `FxLayer`/CSS (canvas só se inevitável).
3. **Entrada das seções em cascata** (hero → grade → atalhos → CTA), escalonada
   pelos tokens de motion.
4. **Hover com elevação 3D** nos `DeckTile` (UX-04) + destaque do selecionado
   (UX-05).
5. **Transição de entrada da tela** dedicada ao home (UX-02).
6. **CTA "Start match"** como atalho (UX-01) — mesma função existente.
7. `prefers-reduced-motion` desliga tudo; a probe que congela animações
   (`e2e/capture.mjs`, `reducedMotion: "reduce"` + `animations: false`) segue
   compatível.
8. Gates.

### Fase E — Mesa estilo MTG Arena (o prato principal)
1. **Plano inclinado na perspectiva do jogador**: `rotateX` consistente com o
   `--tilt` existente, horizonte no topo (ajuste de `perspective-origin`).
2. **Mão em leque na base**: o leque já existe (H3D-06, `src/index.css:8449`);
   refinar rotação/elevação e garantir que `useHandDrag`
   (`src/components/useHandDrag.tsx`) continua funcionando.
3. **Battlelines com profundidade** por fileira (UX-12).
4. **Zona de chaves/pool com hierarquia** (UX-11).
5. **Luz/vinheta/glow da casa ativa** elevando o `--turn-house` já existente
   (H3D-21, `src/index.css:7857-7862`).
6. **Transições de jogada** com os tokens de motion (UX-14).
7. **HUD limpo**, console integrado visualmente (UX-10).
8. O toggle 2D/3D continua funcionando; o 2D permanece funcional e intocado.
9. Gates.

---

## 5. Riscos conhecidos

- **Folga vertical zero** (ver acima): toda a Fase E deve ser feita com
  `transform`/`opacity`. `translateZ`, `rotateX` e `scale` não alteram layout;
  `height`/`padding`/`margin` alteram e quebram o FIT.
- **Cadeia 3D frágil**: `src/index.css:7585-7590` documenta que qualquer
  `filter`/`clip-path`/`mask`/`isolation`/`transform-style != preserve-3d` na
  cadeia achata o 3D em silêncio. Mudou o board? Rodar
  `node e2e/probes/_3d-chain.mjs`.
- **A probe 3D congela animações por design** — não tentar "consertar" isso;
  as capturas 3D devem continuar determinísticas.
- **873 specs** são o piso; nada de mudança em `src/lib/game.ts`/DSL.

---

## 6. Medidas e desvios (registrados na execução)

Medido com `e2e/probes/_3d-chain.mjs` e `e2e/probes/_3d-arena.mjs` antes/depois.
Esses probes **não** são os gates obrigatórios da missão, mas são os guardas que
o próprio código manda rodar quando o board muda — por isso foram respeitados.

| Tentativa | Efeito | Veredito |
| --- | --- | --- |
| `perspective-origin` 38% → **28%** | horizonte mais alto | **descartado**: encolha do plano cai 20,5% → 18,1% (limiar >20%) e a escala oponente/jogador sai da faixa 0,74–0,80 |
| `perspective-origin` 38% → **32% / 34%** | idem | **descartado**: encolha 18,1% / 18,9% |
| `--persp` 1100→1020 e 1000→930 | perspectiva mais forte | **descartado**: recupera a encolha (20,1%) mas derruba a escala oponente/jogador |
| `--row-z` (translateZ por fileira) **+11px / −5px** | profundidade real por fileira | **descartado**: hit-test do centro visual cai para o vizinho em `cr-ups-*` (lane com `--overlap`) e "6px abaixo do topo visual" falha |
| `--row-z` **+3px / −2px** | idem | **descartado**: mesmas falhas |
| `--row-z` **apenas no oponente (−2px)** | idem | **descartado**: mesmo `cr-ups-*` falha — qualquer Z por fileira quebra o hit-test |
| `filter: drop-shadow` no `key-pip` | glow | **trocado** por `box-shadow`: `filter` achata cadeia 3D (restrição H3D-02) |

### O que ficou (profundidade por meios verificados)

Geometria calibrada mantida (`--tilt` 40°/32°, `perspective-origin: 50% 38%`,
`--persp` 1100/1000). O horizonte já fica nos **38% altos** do palco — o
"horizonte no topo" pedido — e o conjunto passa nos dois invariantes.

- **Profundidade por fileira** (UX-12): escala de layout já existente
  (`--card-w-2d5` 60px/72px) + **sombra por distância** nova (a do fundo é menor
  e mais colada, a da frente se espalha) + **atmosfera** (o fundo do tapete
  escurece mais que a frente). Nenhuma mexe em Z nem em ordem de pintura.
- **Gancho `--row-z`** ficou declarado a `0px`, com a medição no comentário —
  quem quiser retomar tem o número que quebra.
- **Luz da casa ativa** (H3D-21) elevada de 1 para 3 degraus (halo 12%, miolo
  26%, terreno 10%) + brilho no aro do tapete.
- **Pool de chaves/âmbar** (UX-11): o bloco ativo ganha anel no avatar, glow no
  Æmber e glow nos pips de chave.
- **Console integrado** (UX-10): mesmo aro do playmat, sem mudar altura.
- **Motion tokens** (UX-14) nas transições 3D, incluindo `--dur-action: 200ms`
  calibrado (o probe mede 200±20ms na troca pronta→exausta).

### Resultado dos probes vs baseline

| Probe | Baseline | Depois |
| --- | --- | --- |
| `_3d-chain.mjs` | OK (com flake conhecido em `H3D-05: hover ergue`) | **OK** (mesmo flake) |
| `_3d-arena.mjs` | FAIL 2 (`z-fighting` + `carta selecionada 100% visível`) | **FAIL 1** (`z-fighting`, pré-existente) |

Nota: `H3D-17: sem z-fighting (3 capturas identicas)` **já falhava no baseline**
e não foi introduzido por esta missão; ficou registrado aqui para não se perder.
