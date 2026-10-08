# UX REWRITE PLAN — Aember Arena "Forja Noturna"

**Escopo**: reescrita completa da camada de apresentação e das jornadas (design language,
telas, fluxos, componentes). **O motor e o estado do jogo NÃO mudam** (`lib/game.ts`,
`lib/ai.ts`, `abilities`, DSL, `fx.ts` — intocáveis). Este documento é só planejamento:
nenhuma linha de implementação foi escrita.

**Método da pesquisa (08/out/2026)**: leitura de `App.tsx` (estrutura de telas e rail),
`index.css` (tokens e palco), `components/`, `UX_ARENA_PLAN.md`, `references/mtg-arena/NOTES.md`;
execução de `node e2e/fit.mjs` (FIT OK nos 7 viewports) e de `node e2e/capture.mjs` (2D e 3D,
5 telas × 4 viewports) com inspeção visual dos PNGs. Toda proposta abaixo cita o problema
real que a originou (`arquivo:linha`, medida ou screenshot).

**Como ler**: §0 diagnóstico → §1 identidade → §2 telas → §3 jornada → §4 arquitetura →
§5 lotes para o Haiku (o que será executado) → §6 riscos → §7 decisões do dono.

---

## 0. Diagnóstico — o que existe hoje e por que reescrever

O ciclo anterior (UX-01..14) entregou tokens, home AAA e mesa 3D. O que **não** entregou é
a **jornada**: o produto ainda é organizado pela história do código (wizard de 6 passos,
header global único), não pela do jogador. Achados verificados:

| # | Problema | Evidência |
| --- | --- | --- |
| D-01 | **"Settings" abre o wizard de partida**, não as configurações do app. Opções do app (som, música, 3D, velocidade da IA, idioma) vivem no passo 5 do wizard de partida; o BYOK/LLM (`LlmSettings`) está enterrado no passo 6 (review). Não há lugar único de configurações. | `App.tsx:4173` (nav `config`), `:653` (`MODE_CONFIG_STEPS`), `:1308` (LlmSettings dentro do review) |
| D-02 | **8 toques até a primeira jogada** (Continue → Next×5 → Start → Keep). O UX-01 ("CTA vira Start match") nunca foi entregue: o CTA da Home ainda é "Continue to setup". Dificuldade e profundidade de busca são **dois passos separados para a mesma ideia** (força do Warden). | `App.tsx:4289` (`onContinue → setScreen("config")`), `:653`; screenshot `config.png` |
| D-03 | **Header global carrega ações de contexto de deck em todas as telas**, inclusive na partida: "Deck" (= importar, rótulo ambíguo) e "Sync" (= sincronizar o deck atual) + chip "ONLINE" em texto. Na partida o header (62px) + título (46px) consomem **108px de 800** (13,5%) num layout de folga zero; no celular header 58 + tab bar 61,5 = **119,5px de 844** (14%). | `App.tsx:4196-4205`; FIT: `header=62 title=46` (1280×800), `header=58 tabs=61.5` (390×844) |
| D-04 | **Rail da partida desperdiça espaço**: o console de turno é espremido ("Your tu…" truncado), "Table notes 01" tem um numeral decorativo sem função, o "Card inspector" vazio ocupa ~230px enquanto não há seleção, e o rodapé fixo ("Card data by Master Vault / Offline-ready table") é informação estática ocupando espaço de jogo. | `App.tsx:4435-4440` (`rail-topline`, `table-number`), `:4563` (`rail-footer`); screenshot `1280x800/game.png` |
| D-05 | **Home sem hierarquia de jogo**: o hero narra o wizard antigo ("1 Select deck › 2 Match setup › 3 Play"), "Replay tutorial" é botão de primeira classe no hero, o `resume-bar` (continuar partida) é um botão **fora** do `HomeScreen` — duas entradas de "continuar" em lugares diferentes — e os atalhos Vault/Import ficam abaixo da dobra a 1280×800. | `App.tsx:569-574` (`home-steps`), `:4231-4270` (`resume-bar`), screenshot `1280x800/home.png` |
| D-06 | **Resultado da partida é um modal de 400px** com 6 números só do jogador, sem comparar com o Warden — embora `GamePlayer` tenha os contadores dos dois lados — e sem linha do tempo de chaves, embora `game.log` guarde `log.forge` com `turn`. O W/L gravado (`recordMatchResult`) só reaparece se o jogador abrir o Inspect do deck. | `App.tsx:2231-2270`, `index.css:4036`, `cache.ts:335`, `App.tsx:3431` |
| D-07 | **Vault: "Page 1 of 5,000"** (3,6 M decks) com paginação numerada até 5000 — navegação inútil; o mesmo `DeckTile` serve biblioteca pessoal e catálogo público sem distinguir "meu" de "do mundo". | screenshot `1280x800/browse.png`, `DeckBrowser.tsx`, `Pagination.tsx` |
| D-08 | **Inspect: hover-zoom cobre a própria tela** (o zoom gigante tapa a faixa de stats e os chips de filtro) enquanto já existe um painel "Card detail" docado à direita — dois mecanismos para a mesma informação. | screenshot `1280x800/inspect.png`, `DeckInspector.tsx` |
| D-09 | **Primeira visita**: o `TutorialWizard` abre sozinho como modal sobre a Home antes de o jogador ter visto um deck ou uma mesa; idioma não é perguntado (só detectado). | `App.tsx:2768` (`useState(isFirstVisit)`), `TutorialWizard.tsx:16` |
| D-10 | **O design system existe mas não é a fonte da verdade**: `index.css` tem 9.575 linhas, **359 hex + 423 `rgba(`** literais, **199** `gap: Npx` literais contra **47** usos de `var(--space-*)`, **86** `box-shadow` contra **11** `var(--elev-*)`. Tokens de espaço/elevação/motion foram criados mas só parcialmente aplicados. | `grep` em `src/index.css`; `index.css:95-215` (tokens) |
| D-11 | **Pilhas (archive/discard) só como chips + overlay modal** fechando o contexto da mesa; sem separar descarte do Warden vs. seu, nem purged. | `App.tsx:2556` (`PileDialog`) |
| D-12 | **Navegação de 4 abas com a quarta condicional** ("Play" só existe com partida viva): o destino mais importante do app é o que mais some. | `App.tsx:4176-4180`, `:4634` (`disabled={!game}`) |

**O que está bom e MORRE SÓ SE SUBSTITUÍDO por algo melhor** (não reescrever por esporte):
o `GameBoard` (DOM + probes 2D/3D), `CardArt`, `useHandDrag`, `FxLayer`, o stage de folga zero
(`.game-board--stage`, `index.css:~883`), o mulligan com mão legível (`.mulligan-shade`,
`index.css:4076`), a affordance de targeting (aa2cd9a), o TutorialWizard como conteúdo,
o `PileDialog` como conteúdo, o `ConfirmDialog`, o `useDialogFocus`.

---

## 1. Identidade visual — "FORJA NOTURNA" (*Night Forge*)

**Conceito**: uma arena profissional vista à luz de **uma única fonte quente** — o âmbar
fundido. Superfícies de obsidiana/vidro fumê, bordas de latão escovado, o feltro verde-petróleo
da mesa como único campo "vivo". É a tradução, para KeyForge, dos 8 padrões transversais
de `references/mtg-arena/NOTES.md` (uma fonte de luz; profundidade por escala+sombra; vinheta como
hierarquia; **glow = estado ativo**; CTA único e estável). O app deixa de parecer "dashboard
escuro com acentos dourados" e passa a ter **regra**: *âmbar = ação e energia do jogador;
éter (ciano) = seleção/alvo; brasa (vermelho) = perigo/inimigo; tudo o mais é matéria fosca.*

Toda a v2 é escrita **somente com tokens** (gate de lint em H-03). Prefixo `--nf-` para não
colidir com os tokens atuais; `--nf-*` aponta para os existentes quando o valor é o mesmo.

### 1.1 Paleta com papéis semânticos

| Papel | Token | Valor | Uso (e só isso) |
| --- | --- | --- | --- |
| Vazio (fundo do app) | `--nf-void` | `#0d0f0c` | fundo da página; vinheta nas bordas |
| Superfície 1 | `--nf-s1` | `#151813` | seções, trilhos, barras |
| Superfície 2 | `--nf-s2` | `#1b1f18` | painéis/cards (= `--panel` atual) |
| Superfície 3 | `--nf-s3` | `#232820` | itens erguidos, hover de linha, input |
| Feltro | `--nf-felt` | `#16241f` | **só** o tapete da mesa e miniaturas dele |
| Linha | `--nf-line` / `--nf-line-strong` | `rgba(230,221,198,.10)` / `.22` | bordas 1px |
| Texto principal | `--nf-text` | `#eee9dc` (=`--paper`) | títulos, valores |
| Texto secundário | `--nf-text-2` | `#b9b8aa` | corpo auxiliar |
| Texto terciário | `--nf-text-3` | `#8e8f83` (=`--faint`) | rótulos, contagens (mín. no piso 11px) |
| **Âmbar** | `--nf-amber` / `-hi` / `-deep` | `#d3ad5d` / `#edc878` / `#a9822f` | **CTA primário**, Æmber, chaves, item ativo da nav |
| Sobre âmbar | `--nf-on-amber` | `#1b1405` | texto/ícone sobre fundo âmbar |
| **Éter** | `--nf-ether` | `#a0e8ff` (=`--sel-core`) | seleção, alvo elegível, foco de teclado, "informação" |
| **Brasa** | `--nf-ember` | `#ef6a5a` | dano, perigo, derrota, ação destrutiva (sempre com ícone+texto) |
| Verdejante | `--nf-verdant` | `#82aa87` (=`--green`) | sucesso, vitória, online |
| Casas | `houseColor()` | `houses.ts` | **só identidade de casa**; nunca para estado semântico |

Contrastes calculados (WCAG): texto/void 15,9:1 · texto/s2 13,8:1 · text-2/s2 8,4:1 ·
text-3/s2 5,1:1 (text-3/s3 4,6:1 — **proibido text-3 sobre s3 em corpo <12px**) · âmbar/s2 7,9:1 ·
on-amber/âmbar 8,6:1 · éter/feltro 11,9:1 · brasa/s2 5,5:1 · verdejante/s2 6,4:1. Brobnar
(`#c65e4a`) é visualmente próximo da brasa: regra — **estado nunca é só cor** (ícone + texto +
`aria-label`), então a ambiguidade não vira informação perdida.

### 1.2 Tipografia (sistema, sem web fonts — regra 1 do CLAUDE.md)

A pilha atual declara `Inter` mas **não carrega a fonte** (`index.css:95`): na prática é
`system-ui`. A v2 assume isso e para de fingir.

- `--nf-font-ui`: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- `--nf-font-display`: `"Iowan Old Style", "Palatino Linotype", Georgia, serif` (já usada em
  `index.css:763` etc.; vira token único — hoje são 5 variantes soltas).
- Numerais de jogo (Æmber, chaves, poder, contadores): `font-variant-numeric: tabular-nums`
  + `--fw-bold` — números não "dançam" quando mudam.

| Papel | Fonte | Token de tamanho (existente) | Peso | Uso |
| --- | --- | --- | --- | --- |
| Display | display | `--fs-display` | 600 | só Lobby hero e Resultado |
| Título de tela | display | `--fs-2xl` | 600 | H1 das telas |
| Seção | display | `--fs-lg` | 600 | H2 de painel |
| Item | ui | `--fs-base` | 600 | nome de deck, linha de lista |
| Corpo | ui | `--fs-sm` | 400 | descrições |
| Rótulo | ui | `--fs-xs` | 500 | chips, metadados |
| Caps/eyebrow | ui | `--fs-3xs` + `--ls-caps` (≥0,1em) | 700 | overline; **única** exceção a 10px |
| Numeral HUD | ui | `--fs-xl`/`--fs-2xl` | 800 | Æmber/chaves |

Piso inalterado: 11px informativo, 16px em inputs (gate `e2e:floor`).

### 1.3 Layout e grid

Três **shells** (conceito novo — hoje há um só, e a partida é "uma tela com header"):

| Shell | Telas | Estrutura |
| --- | --- | --- |
| **Lobby shell** | Lobby, Decks, Detalhe, Settings | barra superior (≥701px) ou tab bar (<701px) + conteúdo com largura-alvo: leitura 680 · conteúdo 1120 · amplo 1280 |
| **Table shell** (imersivo) | Partida, Replay | **sem header, sem tab bar, sem título** (D-03); só `GameBoard` + rail + HUD; saída pelo `TableMenu` |
| **Sheet** | MatchSheet, Import, Zonas, TableMenu, Confirm | bottom-sheet <701px / diálogo centrado ≥701px; sempre sobre o shell atual |

- Escala de espaço: `--space-1..8` (4/8) — única permitida em CSS novo.
- Breakpoints inalterados (701 / 1041 / 1221 — ver `index.css` e CLAUDE.md); grids com mínimo:
  `repeat(auto-fill, minmax(min(280px,100%), 1fr))`.
- Alvo de toque ≥44px nos primários; ≥36px em secundários densos (chips) com área de hit expandida.

### 1.4 Elevação e materiais

| Camada | Token | Receita |
| --- | --- | --- |
| e0 chão | `--elev-0` | sem sombra |
| e1 painel | `--elev-1` + borda | `1px var(--nf-line)` + `inset 0 1px 0 rgba(255,255,255,.04)` (vidro fumê) |
| e2 erguido | `--elev-2` | hover de tile, popover |
| e3 flutuante | `--elev-3` | sheet, diálogo, toast |
| **lit** (novo) | `--nf-lit-amber/ether/ember` | `0 0 0 1px <cor>/.5, 0 0 24px <cor>/.25` — **só estado ativo** (selecionado, alvo, turno) |

Materiais: **Obsidiana** (`--nf-s1..3` + vinheta radial `radial-gradient(120% 90% at 50% 0%, ...)`),
**Latão** (CTA: `linear-gradient(180deg, var(--nf-amber-hi), var(--nf-amber))` + sombra interna
inferior), **Feltro** (já existe no playmat), **Poeira de âmbar** (partículas do Lobby —
`home-amber-dust` existente, mantida), **Granulado** (SVG `feTurbulence` em data-URI ≤1 kB a 3–4%
de opacidade, **só** em Lobby/Result; nunca dentro de `.table-plane` — cadeia 3D, regra 10).

### 1.5 Motion

Tokens já existem (`--dur-fast/base/slow/enter`, `--ease-*`). A v2 acrescenta **coreografia**:

| Ritmo | Duração | Quando |
| --- | --- | --- |
| *tap* | `--dur-fast` 140ms | pressionar, toggle, chip |
| *settle* | `--dur-base`/`--dur-slow` 220/340ms | troca de aba, sheet, hover de tile |
| *reveal* | `--dur-enter` 420ms + `--ease-emph` | entrada de tela (rise 12px), cascata |
| *climax* | até 700ms | **um por tela**: contagem do Resultado; (NOTES padrão 7) |

Regras: cascata ≤5 itens com 60ms de passo; entradas com `fill-mode: backwards` (nunca `both` —
CLAUDE.md); nada anima `height/margin/padding` na partida (FIT); reduced-motion = só
`opacity` em 1 quadro (a classe `reduce-motion` no `<html>` e `@media (prefers-reduced-motion)`
já neutralizam via `*`; todo CSS novo usa os tokens `--dur-*` para herdar isso de graça).

---

## 2. Inventário de telas-alvo

Legenda de estados: **V** vazio · **C** carregando · **E** erro · **S** sucesso.

### S1 — Boas-vindas / first-run *(nova)*
- **Propósito**: do primeiro toque à primeira jogada sem ler nada. Resolve D-09.
- **Fluxo**: (1) tela-marca com seletor de idioma (en/pt) e "Começar"; (2) "Escolha seu arquétipo":
  os 2 starters como cartas-herói (arte, casas, uma linha de estilo) com um já pré-selecionado;
  (3) "Jogar partida guiada" → mesa com *coachmarks* (H-24) e `hints` ligados.
- **Estados**: C (hidratação da biblioteca — esqueleto das 2 cartas), E (falha de storage → segue
  com starters em memória, sem erro visível — regra 6). Sem V.
- **Componentes**: `OnboardingFlow`, `DeckHero`, `LanguagePicker`, `Coachmark`.
- **Morre**: abertura automática do `TutorialWizard` como modal (`App.tsx:2768`). O wizard vira
  "Tour da mesa" opcional dentro de Ajuda e passo 3 do onboarding.

### S2 — Lobby *(redesenho da Home)*
- **Propósito**: um painel de **jogar**, não uma lista de decks.
- **Estrutura** (desktop ≥1041; no celular empilha):
```
┌───────────────────────────────────────────────────────────────┐
│ [AEMBER ARENA]   Jogar · Decks · Ajustes          ● Offline-ok │
├──────────────────────────────┬────────────────────────────────┤
│  HERO DO DECK SELECIONADO    │  CONTINUAR (se houver save)    │
│  ┌ arte em leque 3 cartas ┐  │  Rodada 5 · Você 2/3 chaves    │
│  Dr. "The Old" Jeffries      │  [ Continuar ▸ ]               │
│  ◉ Brobnar ◉ Dis ◉ Logos     ├────────────────────────────────┤
│  36 cartas · 34/36 simuladas │  ÚLTIMO RESULTADO / RECORDE    │
│  Warden: [Casual|Padrão|Duro]│  V 4 · D 2  (este deck)        │
│  vs Espelho  ›  (abre sheet) │                                │
│  [      ▶  JOGAR      ]      │                                │
├──────────────────────────────┴────────────────────────────────┤
│ SEUS DECKS  [tile][tile][tile] …  [+ Importar]  [Explorar Vault]│
└───────────────────────────────────────────────────────────────┘
```
- **Estados**: V (biblioteca só com starters → seção "Seus decks" mostra CTA "Importar do Vault");
  C (esqueletos); E (catálogo/sync falhou → chip discreto, nunca bloqueia); S (toast ao adotar deck).
- **Componentes**: `DeckHero`, `StrengthSegmented`, `ContinueCard`, `RecordCard`, `DeckShelf`
  (+ `DeckTile` refatorado).
- **Morre**: `home-steps` (breadcrumb do wizard), botão "Replay tutorial" no hero, `resume-bar`
  externo (`App.tsx:4231`), `home-cta-bar` "Continue to setup", atalhos como cards enormes
  (viram links da seção "Seus decks"), `home-lang-float` (idioma vai para Ajustes + onboarding).

### S3 — MatchSheet *(substitui o wizard de 6 passos)*
- **Propósito**: ajuste fino **opcional** da partida, numa folha só. Resolve D-01/D-02.
- **Seções** (todas visíveis, rolagem interna, sem "Next"):
  1. **Modo**: Solo vs Warden · Pass-and-play (secundário, segmento).
  2. **Oponente**: Espelho · Deck da biblioteca (picker) · Aleatório (mostra o sorteado).
  3. **Força do Warden**: presets **Casual / Padrão / Duro / Implacável** (mapeiam
     `difficulty`+`thinkingDepth`, §5 H-13) + "Avançado" colapsado com os dois controles atuais e
     a frase de `describeAiThinking`.
  4. **Resumo** vivo: "Jeffries vs Espelho · Padrão" e botão **Jogar**.
- **Estados**: pass-and-play troca a seção 2/3 pela escolha dos dois decks (reuso de
  `resolvePassDecks`); E: deck do oponente removido → volta ao espelho (já tratado em `launchMatch`).
- **Componentes**: `Sheet`, `SegmentedControl`, `OpponentPicker`, `StrengthPicker`.
- **Morre**: `ConfigScreen` inteira (`App.tsx:856-1330`), `config-stepper`, passos
  difficulty/thinking/experience/review como telas; a "review" vira o Resumo (sem lista de
  cartas por casa — essa informação já é a tela de deck).

### S4 — Decks *(unifica Home-grid + Vault)*
- **Propósito**: um lugar para **meus decks / Vault / importar**. Resolve D-07.
- **Abas**: **Meus** (biblioteca, favoritos primeiro, ordenar) · **Vault** (busca + ordenação;
  paginação compacta "‹ Anterior · pág N · Próxima ›" com salto; sem lista numerada até 5000) ·
  **Importar** (abre `ImportSheet`).
- **Estados**: Meus-V ("Você só tem os decks iniciais"), Vault-C (esqueletos de tile), Vault-E
  (offline: banner "Vault indisponível offline — seus decks seguem aqui", reuso de
  `vault.*` errors via `describeFailure`), Vault-V (busca sem resultado).
- **Componentes**: `LibraryScreen`, `DeckTile` (variantes `mine`/`vault`), `VaultBrowser`
  (`useVaultBrowse`), `PagerCompact`, `ImportSheet`.
- **Morre**: tela `browse` como destino de nav próprio; `DeckBrowser` monolítico; `Pagination`
  numerada longa.

### S5 — Detalhe do deck *(redesenho do Inspect)*
- **Propósito**: avaliar e **jogar** com o deck. Resolve D-08.
- **Layout**: hero (arte, casas, recorde V/D via `getDeckStats`, selo de cobertura de regras) +
  abas **Cartas por casa** · **Estatísticas** (curva de custo/poder, tipos — dados já em
  `summarizeDeck`) + painel de carta **docado** (desktop) / sheet (mobile). **Hover em desktop
  atualiza o painel docado — nunca um popup flutuante** (hoverZoom continua como opção para a
  mesa, onde não há painel). CTA sticky: **Jogar com este deck** (1 toque).
- **Estados**: C (deck do Vault carregando), E (falha de arte → fallback de `CardArt`), V (filtro
  sem cartas).
- **Componentes**: `DeckDetail` (refactor de `DeckInspector`), `CardPane`, `StatStrip`.
- **Morre**: o popup de zoom em hover dentro do Inspect; botões `Select`+`Explore` duplicados.

### S6 — Importar deck *(sheet; substitui `DeckModal`)*
- Input único (UUID ou URL do Vault; colar detecta), pré-visualização do candidato (arte+casas),
  **Adicionar à biblioteca** / **Adicionar e jogar**. Estados C/E/S + "veio do cache offline".
  Morre: `DeckModal` (`App.tsx:2443`) e o botão "Deck" do header.

### S7 — Ajustes *(central nova — resolve D-01)*
Abas (lista no desktop, acordeão de largura total no celular):
1. **Jogo**: força padrão do Warden, ritmo da IA (`aiDelayMs`), dicas (`hints`).
2. **Interface**: som, música, animações, mesa 2D/3D, hover zoom, idioma.
3. **Dados e offline**: catálogo (N cartas, sincronizar, progresso/cancelar), status do app
   (versão/BUILD_ID, "atualização pronta", offline-ready, `?swreset=1` documentado), ação
   "Sincronizar deck atual" (sai do header).
4. **Laboratório**: `LlmSettings` (BYOK), fila de tradução/revisão — com aviso de que é avançado.
5. **Sobre**: versão, licença (AGPL-3.0), créditos (Master Vault, keyteki), "Rever tutorial".
- **Estados**: C (sync em curso), E (BYOK inválido — erro do `LlmSettings` existente), S (toast).
- **Morre**: passos `experience`/`review` do wizard como lar dessas opções; `LlmSettings` dentro do
  review; "Sync/Deck/Online" do header.

### S8 — Mesa (Table shell) *(GameBoard intacto, casca nova)*
- **Imersiva**: sem header/tab bar/título ⇒ o palco ganha 108px (desktop) ou 119,5px (celular),
  absorvidos pelas duas linhas `1fr` do grid (§5 H-08).
- **TableMenu** (☰, sheet): Continuar · Ver log completo · Regras rápidas · Alternar 2D/3D ·
  Som/música/velocidade · **Sair para o Lobby** (com `ConfirmDialog`, partida fica salva) ·
  Rever tutorial. Atalho `Esc` no desktop.
- **Rail ≥1041px redesenhado**: console de turno em linha própria sem truncar; inspetor só ocupa
  espaço quando há seleção (senão o log cresce); "Table notes 01" e rodapé estático **morrem**
  (o conteúdo vai para Ajustes › Sobre).
- **ZonesSheet** (substitui `PileDialog` por abas): *Seu descarte · Descarte do Warden · Arquivos
  (só o dono vê o conteúdo; oponente só contagem) · Purgadas*. **Não** é uma tela dedicada: sair
  da mesa para ver uma pilha custa o contexto de jogo (e a folga é zero); sheet resolve D-11.
- **Mantém e restila**: mulligan (`.mulligan-shade`), pass-the-device, Peek, targeting banner, pill
  de casas, chips de pilha — só tokens, sem alterar DOM que os probes usam.
- **Morre**: `match-heading` visível (continua no DOM para a11y, visualmente oculto), botões
  isolados cube/panel no console (viram itens do TableMenu), tab bar e header na partida.

### S9 — Resultado *(nova — resolve D-06)*
- **Propósito**: fechar o ciclo e empurrar o próximo. Overlay full-screen sobre a mesa (a mesa
  fica atrás, desfocada), **um clímax** (contagem animada ≤700ms).
- **Conteúdo**: banner Vitória/Derrota (verdejante/brasa + ícone), **duelo de stats**
  (você × Warden: Æmber ganho, roubado, capturado, criaturas destruídas, cartas jogadas, rodadas
  — dados de `players[0]`/`players[1]` que **já existem**), **linha do tempo de chaves** (derivada
  de `game.log` filtrando `log.forge` por `turn`), recorde atualizado do deck (V/D com delta),
  seed copiável.
- **Ações**: **Revanche** (primário, 1 toque), Trocar de deck, Ver replay (se `canReplay`),
  Lobby. 2P: sem recorde (como hoje — W/L de um dos dois decks locais seria enganoso).
- **Estados**: leitura de recorde (C breve), E (storage falhou → omite o card de recorde).
- **Morre**: `winner-panel` como modal.

### S10 — Replay
Mantém o `replay` (`App.tsx`) com a casca Table e a barra de passos restilada (tokens). Sem mudança
de estado.

### S11 — Estados globais
- **Offline**: chip discreto no Lobby/Decks (hoje texto "ONLINE" permanente); banner só quando
  offline *e* a tela depende de rede (Vault).
- **Atualização do app** (FEAT-09): toast mantido; tela Ajustes › Dados mostra o status.
- **ErrorBoundary**: restilar (Table shell mostra "Voltar ao Lobby" que preserva o save).

### Telas que NÃO serão criadas
- **Deck building**: **não faz sentido para solo**. Um deck KeyForge é selado e único (36 cartas
  de 3 casas, identidade = o deck inteiro); o Vault é a fonte, a edição quebraria cobertura de
  regras, corpus (`textHash`) e a lógica de "deck do Vault". O que o jogador precisa é **escolher
  e avaliar** (S4/S5), não montar. Se o dono quiser "deck custom" depois, é um produto novo.
- **Tela dedicada de pilhas**: ver S8 (ZonesSheet).

---

## 3. Jornada do usuário

### 3.1 Mapa de navegação (IA)

```
        ┌────────── Lobby shell ───────────┐        ┌── Table shell ──┐
  [Jogar] ── Lobby ──── Play ───────────────────────▶ Mesa ──▶ Resultado
     │         ├─ MatchSheet (opcional)                 ├─ TableMenu / ZonesSheet
  [Decks]──── Meus │ Vault │ Importar                   └─ Replay
     │             └─▶ Detalhe do deck ── Jogar com este deck ─┘
  [Ajustes]── Jogo │ Interface │ Dados │ Lab │ Sobre
```
Três destinos fixos (**Jogar · Decks · Ajustes**) — D-12 resolvido: a partida deixa de ser aba
condicional e vira **estado** do botão Jogar (*"Continuar"* quando há partida viva).

### 3.2 Regra dos ≤3 toques (de qualquer estado à partida)

| Estado de partida | Caminho | Toques |
| --- | --- | --- |
| Retorno, deck e força já escolhidos | Jogar → **Manter mão** (mulligan) | **2** |
| Qualquer tela do Lobby shell | aba Jogar → Jogar → Manter | 3 |
| Detalhe de um deck | **Jogar com este deck** → Manter | 2 |
| Tile de deck (Meus/Vault) | botão **Jogar** do tile → Manter | 2 |
| Resultado | **Revanche** → Manter | 2 |
| Partida interrompida (reload) | **Continuar** | 1 |
| Primeira visita | Começar → (starter já marcado) Jogar partida guiada → Manter | 3 |
| Mudar a força e jogar | segmento de força → Jogar → Manter | 3 |
| Oponente diferente | abrir MatchSheet → escolher → Jogar → Manter | 4 *(exceção documentada: é personalização, não caminho feliz)* |

Hoje: **8** (D-02). Critério de aceite do e2e (H-14): contar `click()` do harness do estado
"Lobby recém-aberto" ao primeiro frame de mesa; falha se >3.

### 3.3 Fluxos passo a passo

**F1 — Primeira visita**
1. Boot sem `aember-arena-settings` ⇒ `OnboardingFlow` (não abre o tutorial-modal).
2. *Boas-vindas*: logo + seletor de idioma (aplica na hora, sem reload) + **Começar**.
3. *Escolha de arquétipo*: 2 starters; **Jogar partida guiada** (primário) / "Explorar o Vault
   primeiro" (secundário → Decks › Vault, onboarding marcado como visto).
4. Mesa com `hints:true` e **3 coachmarks** (escolher casa → jogar carta → terminar turno);
   cada um some no primeiro uso correto e nunca volta (`localStorage aember-arena-coach`).
5. Resultado → mensagem extra única "Quer um desafio maior?" apontando para a força do Warden.
- **Pontos de retorno**: fechar o app no meio do onboarding → reabre no passo salvo; a partida
  guiada é uma partida normal (entra no save/resume).

**F2 — Jogador recorrente**
1. Abre o PWA (SW já cacheado) → Lobby com o deck e a força da última partida.
2. **Jogar** → mesa (mulligan) → partida → Resultado → **Revanche** (loop de 2 toques).
3. Se há save: o Lobby mostra `ContinueCard`; o botão Jogar vira "Continuar" (e pede
   `ConfirmDialog` de abandono apenas se o jogador escolher "Nova partida" explicitamente — hoje
   `pendingDeck`, FEAT-15).

**F3 — Trazer um deck novo**
Decks › Vault (busca) → tile › **Jogar** (adota com `saved:true`, regra do CLAUDE.md) **ou** Detalhe
› Jogar com este deck; ou Importar (UUID/URL) → pré-visualização → *Adicionar e jogar*.
Offline: Vault mostra banner e a aba Meus segue 100% funcional.

**F4 — Durante a partida**
Mesa imersiva. ☰ abre TableMenu (jogo continua pausado só visualmente; a IA já não age no turno
do jogador). Pilhas: chip → ZonesSheet na aba correta. Sair: ☰ › Sair para o Lobby (confirma;
save preservado) → Lobby exibe Continuar.

**F5 — Pós-partida**
Resultado (clímax único) → Revanche | Trocar de deck (→ Decks) | Replay | Lobby. O recorde do
deck é atualizado **antes** de renderizar o card (ordem: `recordMatchResult` já ocorre no efeito
`App.tsx:3431`; o `ResultScreen` lê `getDeckStats` após o `await`/efeito, com C breve).

**F6 — Configurar o app**
Ajustes (3º destino) — qualquer opção em 2 toques (aba + controle). Mudanças aplicam ao vivo e
persistem (`saveSettings`); idioma muda sem reload (`createTranslator`).

---

## 4. Arquitetura de componentes

### 4.1 Estrutura de pastas

```
src/ui/                       # tudo da v2 — presentacional, SEM estado de jogo
  flag.ts                     # ui2 on/off (H-01)
  tokens.css                  # --nf-* (H-02)
  primitives/                 # Button, Chip, Panel, StatBlock, Sheet, SegmentedControl,
                              #   SettingRow/Switch, EmptyState, Skeleton  (+ primitives.css)
  shell/                      # LobbyShell (TopBar/TabBar), TableShell, TableMenu
  screens/                    # Lobby, MatchSheet, Library, DeckDetail, ImportSheet,
                              #   Settings(+tabs), Result, Onboarding
  lib/                        # funções PURAS testáveis: presets.ts, matchSummary.ts, coach.ts
```
O `App.tsx` continua dono do estado e dos handlers; as telas v2 recebem **props** (uma
`Actions` tipada). Refatorar o god component (T10) **não** faz parte desta reescrita.

### 4.2 Novo × refactor × mantido

| Componente | Tipo | Origem / observação |
| --- | --- | --- |
| `Button`, `Chip`, `Panel`, `StatBlock`, `SegmentedControl`, `SettingRow`, `EmptyState`, `Skeleton` | **novo** | substituem ~40 variantes (`cta-button`, `ghost-button`, `view-toggle`, `quiet-icon-button`…) |
| `Sheet` | **novo** | absorve `winner-shade`/`modal-*`/`bottom sheet` do inspetor; usa `useDialogFocus` |
| `LobbyShell`, `TableShell`, `TableMenu` | **novo** | substituem `app-header`/`mobile-tabs` (`App.tsx:4155`, `:4624`) |
| `DeckHero`, `ContinueCard`, `RecordCard`, `DeckShelf` | **novo** | Lobby |
| `StrengthPicker`, `OpponentPicker`, `MatchSheet` | **novo** | substitui `ConfigScreen` |
| `LibraryScreen`, `VaultBrowser`+`useVaultBrowse`, `PagerCompact` | **refactor** | de `DeckBrowser` (231 l) e `Pagination` (80 l) |
| `DeckTile` | **refactor** | variantes `mine`/`vault`, botão **Jogar** no tile |
| `DeckDetail`, `CardPane`, `StatStrip` | **refactor** | de `DeckInspector` (302 l) |
| `ImportSheet` | **refactor** | de `DeckModal` (`App.tsx:2443`) |
| `SettingsScreen` + 5 abas | **novo** (reusa `Toggle`, `LanguageMenu`, `LlmSettings`) | |
| `ResultScreen`, `matchSummary()` | **novo** | |
| `OnboardingFlow`, `Coachmark`, `coach.ts` | **novo** | reusa `TutorialWizard` como passo/ajuda |
| `ZonesSheet` | **refactor** | de `PileDialog` (`App.tsx:2556`) |
| `CardArt`, `HouseIcon`, `CoverageBadge`, `FxLayer`, `useHandDrag`, `useDialogFocus`, `ErrorBoundary` | **mantido** (ErrorBoundary só restila) | **não tocar** FxLayer/useHandDrag |
| `GameBoard`, `SelectedCardPanel`, `PlayerBand`, `BoardLane` | **mantido** | só CSS de tokens/casca |

### 4.3 Dependências e ordem de construção

```
tokens(H-02) ─▶ primitives(H-05,06) ─▶ ┬▶ Shells(H-07) ─▶ Table shell(H-08) ─▶ TableMenu(H-09) ─▶ Rail(H-10)
                                        ├▶ Lobby(H-11,12) ─▶ MatchSheet(H-13) ─▶ Play wiring(H-14)
                                        ├▶ Decks(H-15,16,17)
                                        ├▶ Settings(H-18..20)
                                        └▶ Result(H-21,22) ─▶ Onboarding(H-23,24)
flag(H-01) e harness(H-03,04) precedem tudo. Cutover(H-29) só depois de todas as telas.
```
A ordem prioriza **valor cedo e risco isolado**: shell imersivo (maior ganho de pixels, maior
risco no FIT) logo após as primitivas; Lobby+Play (maior ganho de jornada) em seguida; as telas
de gestão por último.

---

## 5. Roadmap de implementação — lotes para o Haiku 5.5

### 5.0 Protocolo comum (vale para TODO lote)

1. **Antes**: `git status` limpo; `npx vitest run` e anotar o total (baseline ≥ **922** segundo o
   commit `ccfd53d`; nunca regredir). `node e2e/fit.mjs` deve estar `FIT OK`.
2. **Proibido**: editar `src/lib/game.ts`, `ai.ts`, `abilities.ts`, `dsl*`, `fx.ts`,
   `FxLayer.tsx`, `useHandDrag.tsx`, `public/sw.js`; adicionar dependência npm; usar web fonts/CDN;
   introduzir `hex`/`rgba(`/`gap: Npx` literais em `src/ui/**` (gate H-03); escrever texto de UI
   sem `t("…")`; chave de i18n sem **as duas** línguas (`[en, pt-BR]` em `i18n.ts`).
3. **Estilo**: comentários só explicam *por quê*; `fill-mode: backwards` em entradas; alvo de
   toque ≥44px; estados nunca só por cor.
4. **Depois, sempre**: `npm run typecheck` · `npx vitest run` · `node e2e/fit.mjs` e
   `node e2e/fit.mjs --view 3d` (se tocou board/shell) · o gate próprio do lote.
5. **Flag**: todo código novo só aparece com a v2 ligada (`?ui=2`, ver H-01); com a v2 desligada o
   app é **byte-a-byte o de hoje** (o gate `_2d-freeze.mjs` prova isso em H-02, H-07, H-08).
6. **Commit**: um por lote, `feat(ui2): H-NN - descrição`. O dono revisa antes de integrar.
7. Se um critério falhar e o conserto não for óbvio em 2 tentativas: **parar e reportar** (não
   afrouxar o gate, não desligar o teste).

Tamanhos: **S** ≤ 1 arquivo novo + ajuste pequeno (~150 linhas) · **M** 2–5 arquivos
(~300–600 linhas) · **L** toca muitos pontos ou exige varredura.

---

### FASE 0 — Fundação

#### H-01 · Flag `ui2` · **S** · dep.: —
- **Escopo**: interruptor da v2, sem efeito visual.
- **Arquivos**: `src/ui/flag.ts` (novo), `src/ui/flag.test.ts` (novo), `src/App.tsx` (ler a flag
  uma vez e expor `const ui2 = useMemo(readUiFlag, [])`; **ainda sem usar**).
- **Código**:
```ts
// src/ui/flag.ts
const KEY = "aember-arena-ui";
export type UiVersion = "1" | "2";
/** ?ui=2 / ?ui=1 vence e persiste; sem param lê o storage; padrão "1" até o cutover (H-29). */
export function readUiFlag(search = typeof location !== "undefined" ? location.search : "",
  store: Pick<Storage, "getItem" | "setItem"> | null = safeStore()): UiVersion {
  const q = new URLSearchParams(search).get("ui");
  if (q === "1" || q === "2") { try { store?.setItem(KEY, q); } catch { /* storage opcional (regra 6) */ } return q; }
  try { return store?.getItem(KEY) === "2" ? "2" : "1"; } catch { return "1"; }
}
function safeStore() { try { return localStorage; } catch { return null; } }
```
- **Aceite**: vitest cobre `?ui=2` persiste · `?ui=1` reverte · sem storage retorna `"1"` ·
  valor inválido ignora. `npm run build` ok; `e2e:capture` visualmente idêntico.

#### H-02 · Tokens `--nf-*` · **M** · dep.: H-01
- **Escopo**: arquivo de tokens da §1; **nenhum seletor existente muda**.
- **Arquivos**: `src/ui/tokens.css` (novo, só `:root{…}`), `src/main.tsx` (`import "./ui/tokens.css"`
  **depois** de `./index.css`).
- **Conteúdo mínimo** (valores da §1.1; aliases quando o valor já existe):
```css
:root {
  --nf-void:#0d0f0c; --nf-s1:#151813; --nf-s2:var(--panel); --nf-s3:#232820; --nf-felt:#16241f;
  --nf-line:rgba(230,221,198,.10); --nf-line-strong:rgba(230,221,198,.22);
  --nf-text:var(--paper); --nf-text-2:#b9b8aa; --nf-text-3:var(--faint);
  --nf-amber:var(--gold); --nf-amber-hi:var(--gold-bright); --nf-amber-deep:#a9822f; --nf-on-amber:#1b1405;
  --nf-ether:#a0e8ff; --nf-ember:#ef6a5a; --nf-verdant:var(--green);
  --nf-font-ui:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --nf-font-display:"Iowan Old Style","Palatino Linotype",Georgia,serif;
  --nf-lit-amber:0 0 0 1px rgb(211 173 93/.5),0 0 24px rgb(211 173 93/.25);
  --nf-lit-ether:0 0 0 1px rgb(160 232 255/.5),0 0 24px rgb(160 232 255/.25);
  --nf-lit-ember:0 0 0 1px rgb(239 106 90/.5),0 0 24px rgb(239 106 90/.25);
  --nf-w-read:680px; --nf-w-content:1120px; --nf-w-wide:1280px;
}
```
- **Aceite**: `npm run build` ok; `node e2e/shots/_2d-freeze.mjs` + `_png-diff.mjs` = **0 pixels de
  diferença** no board 2D; `e2e:floor` ok. Tabela de contraste da §1.1 reproduzível (script
  curto no PR descreve o cálculo).

#### H-03 · Harness `e2e/ui2.mjs` + lint de tokens · **M** · dep.: H-01
- **Escopo**: o gate de todas as telas novas. Sobe o vite (como `fit.mjs`, porta própria **5211**),
  abre `?ui=2`, e para cada tela registrada em `SCREENS` (inicialmente vazia + `_kit`) mede, em
  **390×844, 768×1024, 1024×768, 1280×800, 1920×1080**, em 2D:
  1. sem overflow horizontal (`documentElement.scrollWidth <= innerWidth`);
  2. todo `button,[role=button],a,input,select` visível com área ≥44×44 **ou** `data-dense` (≥36);
  3. todo `button` sem texto tem `aria-label`;
  4. nenhum texto visível < 11px (<10px caps com `letter-spacing<0.1em`);
  5. com `reducedMotion:"reduce"` nenhuma animação em curso (`document.getAnimations()` vazio após
     600ms, exceto `infinite` de partículas marcadas `data-decor`).
  Cada tela expõe `data-screen="<nome>"` no elemento raiz.
- **Lint** `scripts/lint-ui2-css.mjs` (novo, `node`): falha se algum `src/ui/**/*.css` (exceto
  `tokens.css`) contiver `#[0-9a-f]{3,8}\b`, `rgba?\(` fora de `var()`/`color-mix`, ou
  `(gap|margin|padding)[^;]*\b\d+px` que não seja 0/1/2 (hairline) — instruindo a usar
  `var(--space-*)`. Adicionar `"lint:ui2": "node scripts/lint-ui2-css.mjs"` e `"e2e:ui2": "node e2e/ui2.mjs"` ao `package.json`.
- **Aceite**: `npm run e2e:ui2` sai 0 com `SCREENS` vazio; um CSS de teste com `#fff` faz o lint
  sair ≠0 (provar com fixture em `scripts/__fixtures__/`).

#### H-04 · Teste de paridade i18n · **S** · dep.: —
- **Escopo**: `src/lib/i18nUsage.test.ts`: varre `src/ui/**/*.{ts,tsx}` por `t("chave"` e
  `t(\`prefixo.${…}\`)` (só literais), e afirma que `createTranslator("ptBR")(chave) !== chave` e
  `createTranslator("en")(chave) !== chave`; e que nenhum par `[en, pt]` tem string vazia.
- **Aceite**: passa com `src/ui` vazio; falha se um `t("ui.inexistente")` for adicionado (provar
  localmente e desfazer). **Convenção de chaves novas**: prefixo `ui.<tela>.<elemento>`.

### FASE 1 — Primitivas

#### H-05 · Primitivas A: Button, Chip, Panel, StatBlock · **M** · dep.: H-02, H-03
- **Arquivos**: `src/ui/primitives/{Button,Chip,Panel,StatBlock}.tsx`, `primitives.css`,
  `src/ui/screens/KitScreen.tsx` (rota `?ui=2&screen=_kit`, só em dev/flag).
- **API** (a ambiguidade a matar: botão só-ícone **tem** de ter label):
```tsx
type Common = { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "md" | "lg" | "sm" };
type WithText = Common & { children: ReactNode; icon?: ReactNode; "aria-label"?: string };
type IconOnly  = Common & { icon: ReactNode; children?: never; "aria-label": string }; // obrigatório
export function Button(p: (WithText | IconOnly) & ButtonHTMLAttributes<HTMLButtonElement>) { … }
```
  `primary` = latão (âmbar) com `--nf-on-amber`; só **um** primário por tela (documentado no kit).
  `size="md"` = 44px de altura; `sm` marca `data-dense` (36px).
- **Aceite**: KitScreen registrada em `SCREENS`; `npm run e2e:ui2` e `npm run lint:ui2` verdes nos
  5 viewports; foco visível com `--elev-focus`; `Button` iconOnly sem `aria-label` **não compila**
  (`@ts-expect-error` num teste de tipo).

#### H-06 · Primitivas B: Sheet, SegmentedControl, SettingRow/Switch, EmptyState, Skeleton · **M** · dep.: H-05
- **Arquivos**: `src/ui/primitives/{Sheet,SegmentedControl,SettingRow,EmptyState,Skeleton}.tsx`,
  CSS e entradas no KitScreen.
- **`Sheet`**: `{ open, onClose, title, children, footer? }`; portal em `document.body`; <701px
  bottom-sheet (entra por `translateY`, `--dur-slow`, `--ease-emph`), ≥701px diálogo centrado
  (largura `--nf-w-read` máx); usa `useDialogFocus`, fecha com `Esc`/backdrop/X; `aria-modal`.
  Entrada com `fill-mode: backwards`. Segura rolagem do body.
- **`SegmentedControl`**: `role="radiogroup"`, setas navegam, cada opção ≥44px.
- **`SettingRow`**: rótulo + descrição + controle; `Switch` = `role="switch"` + `aria-checked`.
- **Aceite**: KitScreen mostra todos; e2e:ui2 verde; teste Playwright no próprio `ui2.mjs`:
  abrir Sheet → foco dentro → `Esc` fecha → foco volta ao gatilho; reduced-motion sem animação.

### FASE 2 — Casca e mesa

#### H-07 · LobbyShell (TopBar + TabBar de 3 destinos) · **M** · dep.: H-06
- **Escopo**: com `ui2`, o `App` renderiza `LobbyShell` em vez de `app-header`/`mobile-tabs`
  **nas telas não-jogo**; destinos **Jogar / Decks / Ajustes**; botão Jogar mostra "Continuar" se
  `game` existe; status de rede vira ponto + `aria-label` (sem texto "ONLINE"); **Sync e Deck saem**
  do chrome (viram ações de tela em H-16/H-17/H-19).
- **Arquivos**: `src/ui/shell/LobbyShell.tsx`, `shell.css`, `src/App.tsx` (ramo `ui2` em
  `:4155`/`:4624`; novo valor `"settings"` em `type Screen` `:127`).
- **Aceite**: com `ui2` desligado, `_2d-freeze` = 0 diff; com ligado, `data-screen="shell"`
  passa em `e2e:ui2`; navegação por teclado (Tab ordena brand → destinos → ações) e `aria-current`.
  FIT **não é afetado** (a partida usa H-08).

#### H-08 · Table shell imersivo · **M** · dep.: H-07 · **maior risco do projeto**
- **Escopo**: na partida (`screen==="game"`), com `ui2`: ocultar header, tab bar e título, e
  entregar os pixels ao palco.
- **Arquivos**: `src/ui/shell/tableShell.css` (novo, importado por `main.tsx`), `src/App.tsx`
  (atributo `data-shell="table"` no `.app-root` quando `ui2 && screen==="game"`).
- **Código**:
```css
.app-root[data-shell="table"] { --header-h: 0px; --title-h: 0px; --tabbar-g: 0px; }
.app-root[data-shell="table"] .app-header,
.app-root[data-shell="table"] .mobile-tabs { display: none; }
/* NÃO deixar o heading com altura negativa (calc(var(--title-h) - 6px) vira inválido): ocultar visualmente, manter a11y. */
.app-root[data-shell="table"] .match-heading {
  position: absolute; overflow: hidden; width: 1px; height: 1px; clip-path: inset(50%); white-space: nowrap;
}
```
  O palco (`.game-board--stage`, `index.css:~883`) usa `--stage-off = header + safe-area + 12px +
  title + tabbar`; ao zerar os três as duas linhas `1fr` crescem sozinhas. **Preservar o
  `env(safe-area-inset-top)`** (notch). Rever `--board-max` por perfil para a carta poder usar o
  espaço (hoje 104/128).
- **Aceite (FIT estendido)**: adicionar ao `fit.mjs` um modo `--shell table` (ou param) e afirmar:
  1. `FIT OK` nos 7 viewports **e** `--view 3d`;
  2. **sem folga residual**: `soma >= viewport - 1` (o ganho foi absorvido, nada sobrou em branco);
  3. `zoneOpponent` ≥ **250** em 1280×800 (hoje 204,5), ≥ **210** em 1024×768 (hoje 158,5), ≥ **240**
     em 390×844 (hoje 183), ≥ **320** em 768×1024 (hoje 271) — todos **+54/+60px** reclamados;
  4. `docScroll == viewport` (sem rolagem de documento);
  5. `_3d-chain.mjs`, `_3d-hit.mjs`, `_3d-fx.mjs`, `e2e:arena` e `e2e:floor:3d` seguem como no
     baseline (flake conhecido `H3D-05` e `H3D-17 z-fighting` pré-existentes — não pioram).
- **Atenção**: sem header **não há como sair da mesa** até H-09 — este lote só é integrado junto
  com H-09 (mesma entrega ao dono), ou deixa um botão provisório "Lobby" no console atrás da flag.

#### H-09 · TableMenu (☰) · **M** · dep.: H-08, H-06
- **Escopo**: `Sheet` com: Continuar · Log completo (abre o painel existente) · Regras rápidas ·
  Mesa 2D/3D · Som/Música/Velocidade (`SettingRow`) · Sair para o Lobby (`ConfirmDialog` existente;
  `saveMatch` já persiste) · Rever tutorial. `Esc` abre/fecha no desktop (só quando nenhum outro
  diálogo está aberto).
- **Arquivos**: `src/ui/shell/TableMenu.tsx`, `src/App.tsx` (substituir os botões cube/panel em
  `consoleExtra`, `App.tsx:~4410`: no celular **Undo + ☰** — 2 botões em vez de 3, para não
  espremer a linha de 390px; no desktop ≥1041 o ☰ fica no console, o cube vira item do menu).
- **Aceite**: `fit.mjs` (2D+3D) verde com `soma >= viewport-1`; harness: abrir ☰ → "Sair" → confirmar
  → Lobby com `ContinueCard`; `Esc` fecha; `_3d-hit` e `e2e:smoke`/`smoke:3d` verdes (a partida
  demo ainda passa 2 turnos).

#### H-10 · Rail redesenhado (≥1041px) · **M** · dep.: H-09
- **Escopo**: console de turno em linha própria (sem truncar "Your turn"), inspetor **colapsa a 0**
  sem seleção (log ocupa o espaço), remover "Table notes 01" (`App.tsx:4435-4440`) e o
  `rail-footer` (`:4563`; conteúdo → Ajustes › Sobre em H-20), manter Undo, Warden e Log.
- **Arquivos**: `src/App.tsx` (bloco do rail `:4425-4575`), `src/ui/shell/rail.css`.
- **Aceite**: `fit.mjs` em 1280×800/1920×1080/1296×668 verde; o texto do turno mede ≥ largura
  de "Round 01 · Your turn" sem `text-overflow` (assert via `scrollWidth<=clientWidth` no
  harness); log rola internamente (`overflow-y:auto`) sem aumentar a altura do rail; drawer (<1041)
  inalterado (`drawer OK` do fit).

### FASE 3 — Lobby e partida

#### H-11 · `DeckHero` + `HouseTrio` + `DeckTile` v2 · **M** · dep.: H-06
- **Escopo**: hero do deck (arte em leque de 3 cartas via `CardArt`, nome em display, casas,
  linha de metadados, selo de cobertura `CoverageBadge`), tile compacto com variantes
  `mine`/`vault`, botão **Jogar** no tile (`onPlay`), favorito/remover em menu `⋯`.
- **Arquivos**: `src/ui/screens/lobby/DeckHero.tsx`, `src/components/DeckTile.tsx` (prop opcional
  `variant`; **sem quebrar** os usos atuais), CSS.
- **Aceite**: Kit mostra os dois; hover **só** em `@media (hover:hover)`, toque tem caminho
  (menu ⋯ e long-press já do `CardArt`); lift de hover via `transform` (nunca altera layout);
  `e2e:ui2` verde; `DeckTile` atual inalterado quando `variant` ausente (`_2d-freeze` do Home v1).

#### H-12 · `LobbyScreen` · **M** · dep.: H-11, H-07
- **Escopo**: a tela S2. Props: `selectedDeck`, `savedDecks`, `resume`, `lastRecord`, ações
  `onPlay`, `onOpenMatchSheet`, `onSelectDeck`, `onInspect`, `onImport`, `onExplore`.
  `ContinueCard` consome o `resumeMatch` que hoje alimenta o `resume-bar` (`App.tsx:4231`).
  Cascata de entrada ≤5 itens (§1.5); partículas `data-decor`.
- **Aceite**: `data-screen="lobby"` em `e2e:ui2` nos 5 viewports; **a 1280×800 o botão Jogar e o
  topo da shelf estão acima da dobra** (assert por `getBoundingClientRect().bottom <= innerHeight`);
  estados V/C simulados por query `?ui=2&state=empty|loading`; capture 2D/3D das 5 telas sem
  diferença nas telas ≠ lobby.

#### H-13 · `MatchSheet` + presets · **M** · dep.: H-06, H-12
- **Escopo**: S3. Lógica pura **testada** em `src/ui/lib/presets.ts`:
```ts
import type { Difficulty } from "../../lib/ai";
export type StrengthPreset = "casual" | "standard" | "hard" | "relentless";
export const PRESETS: Record<StrengthPreset, { difficulty: Difficulty; thinkingDepth: number }> = {
  casual:     { difficulty: "Easy",      thinkingDepth: 1 },
  standard:   { difficulty: "Medium",    thinkingDepth: 2 },   // = DEFAULT_SETTINGS
  hard:       { difficulty: "Hard",      thinkingDepth: 4 },
  relentless: { difficulty: "Very hard", thinkingDepth: 6 },
};
/** null = combinação "custom" (aparece só em Avançado). */
export function presetOf(s: { difficulty: Difficulty; thinkingDepth: number }): StrengthPreset | null { … }
export function applyPreset<T extends { difficulty: Difficulty; thinkingDepth: number }>(s: T, p: StrengthPreset): T { … }
```
  (Os 4 presets cobrem 4 dos 5 `Difficulty`; "Impossible" só em Avançado — o dono valida os
  valores na decisão aberta §7-D se quiser outro mapeamento.) A folha escreve em `AppSettings`
  via o mesmo `onChange(settings)` do `ConfigScreen` (sem novo estado).
- **Arquivos**: `src/ui/lib/presets.ts` + `.test.ts`, `src/ui/screens/MatchSheet.tsx` (+ `OpponentPicker`,
  `StrengthPicker`).
- **Aceite**: vitest: round-trip `applyPreset→presetOf` para os 4; valores fora → `null`;
  pass-and-play mostra os dois pickers de deck e nunca o mesmo deck duas vezes (reuso de
  `resolvePassDecks`); `e2e:ui2` verde com a folha aberta; paridade i18n (H-04) verde.

#### H-14 · Fiação "Jogar" (≤3 toques) · **M** · dep.: H-12, H-13
- **Escopo**: `onPlay` chama o `launchMatch` **existente** (`App.tsx:3658`) com deck+settings
  atuais; aba Jogar vira "Continuar" com save vivo; `pendingDeck`/FEAT-15 (confirmar abandono)
  preservado; Revanche reusa `rematch`. Nenhuma lógica de jogo nova.
- **Aceite**: harness `e2e/ui2-journey.mjs`: contar cliques do Lobby recém-aberto ao primeiro
  frame da mesa == **2** (Jogar, Manter) e do Detalhe/Tile == 2; falha se >3. `e2e:smoke` v2 passa
  2 turnos. Abandono confirmado só quando há partida viva e o jogador escolhe nova.

### FASE 4 — Decks

#### H-15 · `LibraryScreen` (Meus / Vault) · **M** · dep.: H-11, H-07
- **Escopo**: abas; "Meus" = favoritos primeiro + ordenar; "Vault" = `VaultBrowser` com
  `useVaultBrowse` extraído de `DeckBrowser` (mesma API de `keyforgeApi`, mesmo `BrowseState`
  `App.tsx:~2705`, **mesma persistência BUG-15**); `PagerCompact` (Anterior/Próxima + "ir para");
  esqueletos; banner offline (D-07).
- **Aceite**: com rede mockada (`page.route`) lista 9 tiles; offline mostra banner e "Meus"
  funciona; sem `Pagination` numerada até 5000 no DOM; `data-screen="library"` verde; voltar de
  Detalhe preserva página/busca.

#### H-16 · `DeckDetail` v2 · **M** · dep.: H-15
- **Escopo**: S5. Painel de carta docado atualiza em **hover (desktop)** e em toque (mobile →
  sheet); **remover o popup de zoom do Inspect**; abas Cartas/Estatísticas (`summarizeDeck`);
  recorde V/D (`getDeckStats`); CTA sticky "Jogar com este deck"; ação "Sincronizar" (sai do
  header; reusa `syncCurrentDeck`).
- **Aceite**: screenshot a 1280×800 sem sobreposição do stat strip (assert: nenhum elemento
  `position:fixed/absolute` de zoom intersecta `.stat-strip`); CTA ≥44px sempre visível sem rolar
  a 390×844; 2 toques até a mesa (journey).

#### H-17 · `ImportSheet` · **S** · dep.: H-06
- **Escopo**: S6 sobre o `DeckModal` (`App.tsx:2443`) mantendo `cacheDeck(..., {saved:true})`
  (regra CLAUDE.md) e os estados C/E/S + "do cache".
- **Aceite**: vitest/fixture do parser de UUID/URL (extrair para função pura se ainda não for);
  e2e: colar UUID demo → pré-visualização → "Adicionar e jogar" (2 toques).

### FASE 5 — Ajustes

#### H-18 · `SettingsScreen` + abas Jogo/Interface · **M** · dep.: H-06, H-07
- **Escopo**: S7 abas 1 e 2 com `SettingRow`; **as mesmas** chaves de `AppSettings`
  (`sfx/music/animations/tableView/aiDelayMs/hints/hoverZoom`, idioma). `hasHover` esconde
  hoverZoom como hoje (`ConfigScreen`).
- **Aceite**: alternar cada opção persiste (`readSettings` após reload) e aplica ao vivo; vitest
  de `settings.test.ts` inalterado; `data-screen="settings"` verde.

#### H-19 · Aba Dados e offline · **M** · dep.: H-18
- **Escopo**: card de catálogo (contagem, sincronizar, progresso `CatalogProgress`, cancelar) —
  hoje no passo review (`App.tsx:~1243`); status do SW (BUILD_ID, "atualização pronta" + botão
  recarregar, reusa o estado `updateReady` do FEAT-09); "Sincronizar deck atual".
- **Aceite**: com catálogo mockado a barra progride e cancela; `node e2e/sw-reset.mjs` verde
  (requer `npm run build`); nenhum texto "ONLINE" fixo.

#### H-20 · Abas Laboratório e Sobre · **S** · dep.: H-18
- **Escopo**: Laboratório = `<LlmSettings …>` **sem alterar o componente**, com aviso de
  avançado; Sobre = versão, licença, créditos, "Rever tutorial" (conteúdo do `rail-footer`).
- **Aceite**: BYOK salva/valida como antes (specs `catalogLlm`/`settings` verdes); paridade i18n.

### FASE 6 — Resultado e onboarding

#### H-21 · `matchSummary()` puro · **S** · dep.: —
- **Escopo**: `src/ui/lib/matchSummary.ts`:
```ts
import type { GameState } from "../../lib/game";
export interface MatchSummary {
  winner: 0 | 1; rounds: number; seed: string | number;
  sides: [SideStats, SideStats];
  forgeTimeline: { side: 0 | 1; turn: number }[];   // de game.log, key === "log.forge"
}
export interface SideStats { amberGained: number; amberStolen: number; amberCaptured: number; creaturesDestroyed: number; cardsPlayed: number; keys: number }
export function summarizeMatch(game: GameState): MatchSummary | null  // null se winner === null
```
  Atribuição de `side` na timeline: comparar `params.name` com os nomes dos jogadores
  (`localizeName` já trata "Warden"); documentar o fallback se ambíguo.
- **Aceite**: vitest com estados gerados por `testkit.ts` (vitória do jogador, do Warden, partida
  sem chaves por vitória especial, log vazio, saves legados sem tallies = 0); **não importa nada
  de React**.

#### H-22 · `ResultScreen` · **M** · dep.: H-21, H-06, H-14
- **Escopo**: S9. Substitui `winner-panel` (`App.tsx:2231`) com a flag. Contagem animada ≤700ms
  (único clímax), duelo de stats, timeline de chaves, recorde (`getDeckStats` após o efeito de
  `recordMatchResult`), ações Revanche/Trocar deck/Replay/Lobby. 2P sem recorde.
- **Aceite**: `?ui=2` + partida forçada ao fim (fixture de save com `winner:0` e `winner:1`):
  assert dos 6 stats dos dois lados, ≥1 marco na timeline, botão Revanche é o único `primary`;
  reduced-motion renderiza valores finais sem contagem; **Revanche → mesa em 2 toques** no journey.

#### H-23 · `OnboardingFlow` · **M** · dep.: H-12, H-06
- **Escopo**: S1 passos 1–2; substitui a abertura automática do `TutorialWizard`
  (`App.tsx:2768`) quando `ui2`. Idioma aplica na hora. Marca `markTutorialSeen()`.
- **Aceite**: Playwright com storage limpo: Começar → starter → Jogar guiada = mesa em **3 toques**;
  recarregar no passo 2 retoma o passo 2; com `aember-arena-settings` presente **não** aparece.

#### H-24 · Coachmarks da partida guiada · **M** · dep.: H-23
- **Escopo**: `src/ui/lib/coach.ts` (máquina de estados pura: `pickHouse → playCard → endTurn →
  done`, avança por eventos observáveis da UI — mudança de `activeHouse`, `cardsPlayed`, `turn`),
  `Coachmark.tsx` (balão ancorado por `data-coach="…"` nos elementos existentes; **overlay absoluto,
  nunca soma altura**). Persistência `aember-arena-coach`.
- **Aceite**: vitest da máquina (sequência feliz, passos fora de ordem não avançam, `skip` encerra);
  `fit.mjs` com coachmark ativo mantém `soma<=viewport`; some após o 3º passo e não volta ao recarregar.

### FASE 7 — Mesa: acabamento

#### H-25 · Tokens no HUD da mesa · **M** · dep.: H-10
- **Escopo**: bandas, console, chips de pilha, pill de casas, selos de chave/Æmber passam a ler
  `--nf-*`/`--elev-*`/`--dur-*` **sem mudar dimensões** (altura/padding intactos). Numerais
  `tabular-nums`. Glow só em estado ativo (turno, alvo, seleção) — auditar e remover glows
  estáticos.
- **Aceite**: `fit.mjs` **idêntico** ao baseline pós-H-08 (mesmos `rows`); `e2e:floor`, `floor:3d`,
  `e2e:arena`, 3 probes 3D e capture 2D/3D sem regressão; revisão visual lado a lado.

#### H-26 · `ZonesSheet` (pilhas por abas) · **M** · dep.: H-06
- **Escopo**: substitui `PileDialog` (`App.tsx:2556`) com abas Descarte (você) · Descarte (Warden)
  · Arquivos · Purgadas; privacidade preservada (oponente só contagem em Arquivos); chips existentes
  abrem a aba certa; grid de cartas com `CardArt`.
- **Aceite**: specs `piles.test.ts` verdes (lógica intocada); harness: chip do descarte abre a aba
  Descarte; Arquivos do Warden mostra só contagem; `Esc` fecha e devolve foco ao chip; FIT inalterado
  (é overlay).

#### H-27 · Estados vazios e erros da mesa · **S** · dep.: H-25
- **Escopo**: UX-13 pendente — `empty-battleline`/`empty-hand` com hierarquia (ícone, 1 linha,
  glow suave); `ErrorBoundary` restilado com "Voltar ao Lobby" que preserva o save.
- **Aceite**: capture da mesa vazia 2D/3D; forçar throw num filho (`?ui=2&crash=1` apenas em
  dev) mostra o fallback e **não** apaga `aember-arena-match`.

#### H-28 · Coreografia de transição · **M** · dep.: H-12, H-15, H-18
- **Escopo**: entrada de tela (rise 12px/`--dur-enter`), cascata do Lobby, troca de aba com
  crossfade de `opacity`, `Sheet` com `--ease-emph`; auditoria: toda `animation`/`transition` em
  `src/ui/**` usa `--dur-*`/`--ease-*` e há regra reduced-motion.
- **Aceite**: lint H-03 estendido (sem `ms` literal em `src/ui/**/*.css`); e2e:ui2 item 5
  (reduced-motion) verde em todas as telas registradas; probe de duração mede `--dur-enter`±20ms
  na entrada do Lobby.

### FASE 8 — Cutover e limpeza

#### H-29 · Virar o padrão para v2 · **S** · dep.: H-01..H-28
- **Escopo**: `readUiFlag` devolve `"2"` por padrão; `?ui=1` continua como escape por **uma**
  versão; atualizar `e2e/capture.mjs`, `fit.mjs`, `acceptance.mjs`, `e2e/sw-reset.mjs` (seeds e
  telas: `home→lobby`, `browse→library`, `config→settings`) e regerar `e2e/shots/baseline`.
- **Aceite**: **`npm run e2e:acceptance`** + `e2e:fit` (2D/3D) + `e2e:arena` + 3 probes 3D +
  `e2e:smoke`(2D/3D) + `e2e:ui2` + `e2e/sw-reset.mjs` + `npx vitest run` (≥ baseline + novos) +
  `npm run build` — todos verdes.

#### H-30 · Remover a v1 · **L** · dep.: H-29 + 1 ciclo de uso do dono
- **Escopo**: apagar `HomeScreen`, `ConfigScreen`/`MODE_CONFIG_STEPS`, `DeckModal`, `PileDialog`,
  `winner-panel`, `app-header`/`mobile-tabs` v1 e o ramo `ui2`; varredura `node e2e/shots/_dead-css.mjs`
  e remoção do CSS morto; limpar chaves i18n órfãs (cuidado: algumas são dinâmicas —
  `config.*` reaproveitadas); atualizar `CLAUDE.md` (Layout, Estado atual, regras 9-10 se mudarem).
- **Aceite**: `tsc` sem referências quebradas; gzip do `index.html` só telemetria (regra 7);
  nenhuma regressão de FIT/probes/specs; diff líquido de `App.tsx` **negativo**.

#### H-31 · Documentação e fechamento · **S** · dep.: H-30
- **Escopo**: este plano ganha seção "Medidas e desvios" (como `UX_ARENA_PLAN §6`), `CLAUDE.md`
  atualizado, `docs/` obsoletos marcados (HomeScreen/ConfigScreen).
- **Aceite**: revisão do dono.

---

## 6. Riscos e migração

### 6.1 Estratégia: **coexistência por flag, cutover em bloco**
A v2 vive em `src/ui/` e é ativada por `?ui=2`/`localStorage aember-arena-ui` (H-01). O `App`
decide **nos mesmos pontos de render** que hoje escolhem a tela (`App.tsx:4276` home, `:4295`
browse, `:4308` inspect, `:4319` config, `:4352` game): `ui2 ? <LobbyScreen/> : <HomeScreen/>`.
Vantagens: o dono pode alternar para comparar; um bug na v2 nunca afeta quem está na v1; os
lotes integram em `main` sem expor nada. Custo: dois caminhos por ~8 lotes (aceito; H-30 apaga).
**Não usar** feature flag por tela: Lobby novo + Config velho cria uma jornada incoerente.

### 6.2 Riscos principais
| # | Risco | Mitigação |
| --- | --- | --- |
| R1 | **Folga zero**: o shell imersivo (H-08) muda `--stage-off`; um `height` perdido quebra o FIT | gate `soma ∈ [viewport-1, viewport]` (novo) + zonas mínimas medidas; reverter o lote se falhar |
| R2 | `calc(var(--title-h) - 6px)` negativo é **inválido** e vira `height:auto` | CSS de H-08 oculta o heading visualmente em vez de zerar a altura (código na §5) |
| R3 | **Cadeia 3D** achatada por wrapper/filter/clip-path/isolation novo | nada novo entre `.table-plane` e `.board-piece`; sheets em portal; `_3d-chain.mjs` em todo lote que toque board/rail |
| R4 | Selectors de probes/harness (`.hand-track`, `.card-tile--hand`, `.board-piece`, `.turn-console`, `.player-band`, `.battle-zone`, `[data-iid]`, `.game-board--3d/--stage`) | **contrato**: não renomear nem remover; novas classes só aditivas |
| R5 | i18n: chave só em inglês ou duplicada em `config.*` | H-04 (paridade) + prefixo `ui.*`; pt-BR revisado na revisão do lote |
| R6 | Estado do `App` (god component, ~4,7k linhas) ganha mais ramos | telas v2 são puras/props; sem novo estado global além do `ui2`, `settings` existentes e `coach` |
| R7 | SW cacheia a v1 e o usuário "não vê" a v2 | build novo = toast FEAT-09; `?swreset=1` documentado em Ajustes › Dados |
| R8 | Regressão de **save/resume** (formato do `SavedMatch`) | v2 **não** altera `saveMatch`/`loadSavedMatch`; teste de abrir save antigo na v2 |
| R9 | Haiku deriva do plano (inventa API, CSS literal) | lotes pequenos, código-âncora, lint H-03/H-04, regra "parar e reportar" (§5.0 item 7) |
| R10 | `hover` sem equivalente touch no novo Detalhe | gate `e2e:ui2` roda com `hasTouch` além do mouse; hover só em `@media (hover:hover)` |
| R11 | Pass-and-play esquecido na nova folha/resultado | H-13/H-22 têm assert explícito de 2P (decks distintos, sem recorde) |

### 6.3 O que testar (pirâmide)
1. **vitest** (puro): `flag`, `presets`, `matchSummary`, `coach`, paridade i18n, parser de import.
   Meta: baseline 922 + os novos, **zero removidos**.
2. **Harness `e2e/ui2.mjs`** (por tela, 5 viewports, 2D): overflow, alvo de toque, `aria-label`, piso
   tipográfico, reduced-motion.
3. **Jornada `e2e/ui2-journey.mjs`**: contagem de toques (≤3), F1–F6.
4. **Gates existentes** (CLAUDE.md "Verification gates"): FIT 2D/3D, floor 2D/3D, capture, smoke
   2D/3D, arena, 3 probes 3D, `sw-reset`, acceptance.
5. **Revisão visual** humana por lote: capture 2D+3D comparado ao baseline (diferença só onde o
   lote promete).

### 6.4 O que **NÃO tocar** (lista fechada)
`lib/game.ts`, `lib/ai.ts`, `abilities.ts`, `dsl*`, `cardText.ts`, `fx.ts`, `FxLayer.tsx`,
`useHandDrag.tsx`, `CardArt.tsx` (props), `public/sw.js`, esquema do IndexedDB (a menos que a
decisão §7-C seja "sim"), a DOM/classe de `GameBoard` usada pelos probes, `.table-plane` e a cadeia
3D, `houseColor`/`houseLabel` (assinaturas), `ConfirmDialog`/`useDialogFocus` (apenas reusar).

---

## 7. Decisões abertas para o dono (máx. 5)

**A. Arquitetura de navegação — 3 destinos ou 4?**
- (1) **Jogar · Decks · Ajustes**, partida como estado de "Jogar" *(recomendo)*; (2) manter 4 abas
  com "Play" condicional; (3) 3 destinos + "Ajuda" separada.
- Recomendação **(1)**: resolve D-12, reduz a tab bar do celular a 3 alvos largos e a mesa deixa de
  ser "um lugar" para virar um modo. (2) mantém o problema; (3) tira espaço sem ganho.

**B. Mesa imersiva (sem header/tab bar) em todos os viewports?**
- (1) **Sim, sempre** *(recomendo)*; (2) só ≥701px, celular mantém tab bar; (3) imersiva só em
  modo "tela cheia" opcional.
- Recomendação **(1)**: é o único ganho de espaço real num layout de folga zero (+108px desktop,
  +119,5px celular) e o MTG Arena das referências é assim. Custo: o ☰ passa a ser a única saída
  (H-09), e jogador acostumado a tocar "Vault" durante a partida perde o atalho. (2) deixa o
  celular — onde faz mais falta — sem o ganho.

**C. Histórico de partidas — persistir ou só derivar da partida atual?**
- (1) **Persistir resumos das últimas 20 partidas** (novo store/`localStorage`, ~300 B cada),
  habilitando "Histórico" em Decks e recorde por força do Warden *(recomendo, com `localStorage`
  e sem subir a versão do IndexedDB)*; (2) só o `DeckStats` atual (V/D por deck); (3) IndexedDB v5
  com store próprio.
- Recomendação **(1)**: dá retenção ao loop (o jogador vê progresso) sem tocar no schema do DB. Se
  escolher (3), o lote H-22 ganha dependência de migração e o R8 sobe de nível.

**D. Mapeamento dos presets de força do Warden**
- (1) Casual / Padrão / Duro / Implacável = `Easy·1` / `Medium·2` / `Hard·4` / `Very hard·6`,
  "Impossible" só em Avançado *(recomendo; Padrão = `DEFAULT_SETTINGS`)*; (2) 3 presets só;
  (3) expor os 5 `Difficulty` como hoje.
- Recomendação **(1)**: 4 degraus claros cobrem o público, Avançado preserva o controle total. O
  dono deve **calibrar os valores de profundidade** jogando (o plano não mede a força real da IA).

**E. Telefone em paisagem**
- (1) **Fora de escopo agora** (só retrato; em paisagem exibe a mesa como hoje) *(recomendo)*;
  (2) layout próprio de paisagem (mão lateral, rail oculto) — novo conjunto de viewports no FIT
  (ex.: 844×390) e re-tuning do 3D.
- Recomendação **(1)**: o FIT atual não cobre paisagem de celular; (2) é um projeto por si (altura
  útil ~330px) e deve entrar **depois** do cutover, como plano próprio.

---

*Notas finais*: bundle não é critério de corte (regra 7); nenhuma dependência npm nova é
proposta; as primitivas custam ~3–5 kB gz estimados. A estimativa de esforço total dos 31 lotes:
**S×8 · M×22 · L×1** (H-08 e H-30 concentram o risco; reservar revisão humana extra neles).
