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

**Revisão 08/out/2026 — sistema de temas**: a paleta Forja Noturna é o tema *padrão* de um sistema de
4 temas selecionáveis em Ajustes (§1.6; lotes H-02b/H-02c; linha Tema em H-18; tapete em H-25).

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
colidir com os tokens atuais. **Os tokens `--nf-*` são tematizáveis** (§1.6): "Forja Noturna" é o
tema **padrão**, não "a" paleta; o jogador troca em Ajustes › Interface. Por isso os valores dos
tokens são **literais** (nunca `var(--panel)`/`var(--gold)` legados — um alias aponta para o
valor do tema padrão e furaria a troca). Os *papéis* (§1.1) são o contrato; os hex da tabela
abaixo são os valores do tema Forja Noturna.

### 1.1 Paleta com papéis semânticos

| Papel | Token | Valor (Forja Noturna) | Uso (e só isso) |
| --- | --- | --- | --- |
| Vazio (fundo do app) | `--nf-void` | `#0d0f0c` | fundo da página; vinheta nas bordas |
| Superfície 1 | `--nf-s1` | `#151813` | seções, trilhos, barras |
| Superfície 2 | `--nf-s2` | `#1b1f18` | painéis/cards |
| Superfície 3 | `--nf-s3` | `#232820` | itens erguidos, hover de linha, input |
| Feltro | `--nf-felt` | `#16241f` | **só** o tapete da mesa e miniaturas dele |
| Texto sobre feltro | `--nf-felt-text` | `#b9c9bd` | rótulos de zona e contagens no tapete |
| Linha | `--nf-line` / `--nf-line-strong` | `rgba(230,221,198,.10)` / `.22` | bordas decorativas de 1px |
| **Borda de controle** | `--nf-edge` | `rgba(230,221,198,.42)` | contorno de input/segmento/switch (**≥3:1**, WCAG 1.4.11) |
| Texto principal | `--nf-text` | `#eee9dc` | títulos, valores |
| Texto secundário | `--nf-text-2` | `#b9b8aa` | corpo auxiliar |
| Texto terciário | `--nf-text-3` | `#8e8f83` | rótulos, contagens (mín. no piso 11px) |
| **Acento primário** | `--nf-accent` / `-hi` / `-deep` | `#d3ad5d` / `#edc878` / `#a9822f` | **CTA primário**, item ativo da nav, ação (o nome histórico "âmbar" vale só no tema padrão) |
| Sobre acento | `--nf-on-accent` | `#1b1405` | texto/ícone sobre fundo de acento |
| **Æmber (recurso)** | `--nf-aember` | `#edc878` | **só** o contador/ícone do Æmber do jogo — *não* acompanha o acento (§1.6.3) |
| **Éter** | `--nf-ether` | `#a0e8ff` | seleção, alvo elegível, foco de teclado, "informação" |
| **Brasa** | `--nf-ember` | `#ef6a5a` | dano, perigo, derrota, ação destrutiva (sempre com ícone+texto) |
| Verdejante | `--nf-verdant` | `#82aa87` | sucesso, vitória, online |
| Sombra (canal rgb) | `--nf-shadow` | `0 0 0` | sombras `--nf-elev-*` da v2: `rgb(var(--nf-shadow) / .4)` |
| Véu | `--nf-scrim` | `rgba(9,12,10,.76)` | backdrop de Sheet/diálogo |
| Esquema nativo | `color-scheme` | `dark` | inputs, scrollbars e `<select>` nativos |
| Casas | `houseColor()` | `houses.ts` | **só** identidade de casa; nunca para estado semântico |

Contrastes calculados (WCAG, Forja Noturna): texto/void 15,9:1 · texto/s2 13,8:1 · text-2/s2 8,4:1 ·
text-3/s2 5,1:1 (text-3/s3 4,6:1 — **proibido text-3 sobre s3 em corpo <12px**) · acento/s2 7,9:1 ·
on-accent/accent 8,6:1 · éter/feltro 11,9:1 · brasa/s2 5,5:1 · verdejante/s2 6,4:1 · edge/s2 ≥3:1.
Brobnar (`#c65e4a`) é visualmente próximo da brasa: regra — **estado nunca é só cor** (ícone +
texto + `aria-label`), então a ambiguidade não vira informação perdida. Os contrastes dos outros
três temas estão na §1.6.4.

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
| e1 painel | `--nf-elev-1` + borda | `1px var(--nf-line)` + realce superior `inset 0 1px 0 color-mix(in srgb, var(--nf-text) 5%, transparent)` (vidro fumê; no Claro, papel) |
| e2 erguido | `--nf-elev-2` | hover de tile, popover |
| e3 flutuante | `--nf-elev-3` | sheet, diálogo, toast |
| **lit** (novo) | `--nf-lit-accent/ether/ember` | `0 0 0 1px color-mix(in srgb, var(--nf-<cor>) 50%, transparent), 0 0 24px color-mix(in srgb, var(--nf-<cor>) 25%, transparent)` — derivado do token de cor (**muda com o tema**, §1.6); **só estado ativo** (selecionado, alvo, turno) |

Materiais: **Obsidiana** (`--nf-s1..3` + vinheta radial `radial-gradient(120% 90% at 50% 0%, ...)`),
**Latão** (CTA: `linear-gradient(180deg, var(--nf-accent-hi), var(--nf-accent))` + sombra interna
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

### 1.6 Sistema de temas — a paleta é um *valor*, os papéis são o *contrato*

**Pedido do dono**: temas de cor selecionáveis em Ajustes. **Forja Noturna é o tema padrão**; a
camada `--nf-*` é tematizável sem tocar em nenhum seletor.

#### 1.6.1 Mecanismo

- **Raiz**: atributo `data-theme` em `<html>` (`document.documentElement`, não no `.app-root`, para
  que Sheets em portal no `body` herdem). Valores: `forja` (padrão — atributo ausente = `forja`),
  `aco`, `claro`, `arcano`.
- **Um arquivo por tema** (temas são arquivos de tokens — o lint de H-03 segue valendo para todo
  o resto de `src/ui/**`):
  `src/ui/tokens.css` (tema `forja` + tokens não cromáticos) · `src/ui/themes/aco.css` ·
  `themes/claro.css` · `themes/arcano.css`. Importados em `main.tsx` nessa ordem, **depois** de
  `index.css`.
- **Seletor sem `:root`** — o ponto que viabiliza a pré-visualização sem JS:
```css
/* tokens.css */
:root, [data-theme="forja"] { --nf-void:#0d0f0c; /* … os 22 tokens do contrato … */ color-scheme: dark; }
/* themes/aco.css */
[data-theme="aco"] { --nf-void:#080b10; /* … os mesmos 22 … */ color-scheme: dark; }
```
  `:root` e `[data-theme]` têm a mesma especificidade (0,1,0); o tema importado depois vence. Como o
  seletor casa **qualquer elemento**, um `<button data-theme="claro">` re-tematiza a própria
  subárvore (é assim que os cartões de Ajustes se pré-visualizam com as cores *do tema que
  representam*, sem aplicar nada).
- **Contrato fechado** — todo tema define **exatamente** estes 22 tokens (e nada mais; nenhum
  `var()` — valores literais, senão um alias aponta para o tema padrão):
  `void s1 s2 s3 felt felt-text line line-strong edge text text-2 text-3 accent accent-hi
  accent-deep on-accent aember ether ember verdant shadow scrim` + `color-scheme`.
- **Tokens derivados** (realce `lit`, elevações `--nf-elev-1..3`) são declarados **uma vez**, num
  bloco `:root, [data-theme] { … }` em `tokens.css`, com `color-mix()` e `rgb(var(--nf-shadow) / .x)`.
  Armadilha a evitar: uma propriedade custom com `var()` declarada **só** em `:root` é calculada
  na raiz e os descendentes `data-theme` herdam o valor *já calculado* — o preview mostraria o
  glow da Forja num cartão Aço Frio. Declarar o derivado em `[data-theme]` o recalcula por elemento.
- **Motor** `src/ui/theme.ts` (puro, testável):
```ts
export const THEMES = ["forja", "aco", "claro", "arcano"] as const;
export type ThemeId = (typeof THEMES)[number];
export const DEFAULT_THEME: ThemeId = "forja";
const KEY = "aember-arena-theme";
/** Cor da barra do navegador/PWA por tema (espelho de --nf-void; o teste compara com o CSS). */
export const THEME_COLOR: Record<ThemeId, string> = { forja: "#0d0f0c", aco: "#080b10", claro: "#f1ede4", arcano: "#0e0718" };
export function readTheme(store: Pick<Storage, "getItem"> | null = safeStore()): ThemeId { /* valor fora de THEMES → DEFAULT_THEME */ }
export function applyTheme(id: ThemeId, root = document.documentElement, store = safeStore()): void {
  if (id === DEFAULT_THEME) delete root.dataset.theme; else root.dataset.theme = id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[id]);
  try { store?.setItem(KEY, id); } catch { /* storage opcional (regra 6) */ }
}
```
- **Sem flash (FOUC)**: um `<script>` inline mínimo no `<head>` do `index.html` (antes do CSS
  pintar) lê `aember-arena-theme` e seta `data-theme`; valor desconhecido simplesmente não casa
  nenhum seletor e cai no padrão. `main.tsx` chama `applyTheme(readTheme())` antes de `createRoot`.
- **Persistência**: chave própria `aember-arena-theme` no `localStorage` (não entra em
  `AppSettings`/`readSettings`: o contrato e os specs de `settings.ts` ficam intactos).
- **Escopo do tema**: tudo que lê `--nf-*` — telas v2 e, a partir de H-25, o HUD e o tapete da mesa.
  **Não muda**: arte das cartas, emblemas oficiais das casas, a v1 (que só existe até o cutover).
  A tematização do tapete exige migrar os gradientes literais do board para `--nf-felt`/
  `--nf-felt-text` em H-25 (risco R12).
- **Fora de escopo (decisão de produto, não técnica)**: "Automático" por `prefers-color-scheme`
  (mapearia escuro→Forja, claro→Claro). É trivial depois que o motor existe; não foi pedido.

#### 1.6.2 Seletor com pré-visualização ao vivo (Ajustes › Interface)

`ThemePicker` = `radiogroup` de 4 cartões. Cada cartão é um `<button role="radio"
data-theme="<id>" aria-checked>` contendo uma **miniatura do Lobby** feita só de tokens
(painel `--nf-s2`, botão `--nf-accent`, duas linhas de texto, um chip de seleção `--nf-ether`, faixa
de feltro) — como o atributo está no próprio cartão, a miniatura já aparece nas cores do tema.
**Clicar aplica na hora** (`applyTheme`), persiste e toca o som `select`; setas navegam; o cartão
ativo recebe `--nf-lit-accent` (do tema *vigente*, para o jogador ver onde está). A tela inteira
repinta em ≤`--dur-base` (transição de `background-color/color` na raiz; reduced-motion = instantâneo).
Nome e linha de descrição via i18n (`ui.theme.<id>.name/.desc`).

#### 1.6.3 Regras semânticas — o que **nunca** muda entre temas

1. **Papéis imutáveis**: `accent` = ação/CTA; `ether` = seleção/alvo/foco; `ember` = perigo/dano;
   `verdant` = sucesso. Mudam só os valores. Por isso, num tema em que o acento é azul (Aço Frio),
   o `ether` deixa de ser ciano e vira **menta** — senão seleção e CTA se confundiriam.
2. **Æmber é recurso de jogo, não acento**: `--nf-aember` existe separado para o contador de Æmber
   continuar *dourado* em qualquer tema (um Æmber azul no Aço Frio seria um bug de leitura do jogo).
3. **Casas = identidade**: `houseColor()` não é tematizado. Em fundos claros a cor de casa usada
   como **texto/glifo** passa por `color-mix(in srgb, var(--hc) 55%, var(--nf-text))` (pior caso das
   19 cores sobre `#ffffff`: **5,45:1**; sem a mistura: 2,14:1). Preenchimentos/tints seguem diretos.
4. **Estado nunca só por cor** (ícone + texto + `aria-label`) — vale para os quatro temas.
5. **Tema não muda geometria**: nenhum tema altera `--space-*`, `--fs-*`, alturas de faixa — o FIT
   e o piso tipográfico são **independentes de tema** (gate roda em todos, §5 H-02c).

#### 1.6.4 Os quatro temas

| Papel / token | **Forja Noturna** *(padrão)* | **Aço Frio** | **Claro Alto-Contraste** | **Arcano** |
| --- | --- | --- | --- | --- |
| Direção | obsidiana + âmbar fundido | tech azul-aço, "cockpit" | papel/dia, AAA, impressão | violeta saturado, mágico |
| `color-scheme` | dark | dark | **light** | dark |
| `--nf-void` | `#0d0f0c` | `#080b10` | `#f1ede4` | `#0e0718` |
| `--nf-s1` | `#151813` | `#0f141b` | `#f8f5ee` | `#160c26` |
| `--nf-s2` | `#1b1f18` | `#151c26` | `#ffffff` | `#1e1233` |
| `--nf-s3` | `#232820` | `#1d2733` | `#ebe6da` | `#2a1a46` |
| `--nf-felt` | `#16241f` | `#0f1d2b` | `#cfd9c8` | `#1b1040` |
| `--nf-felt-text` | `#b9c9bd` | `#a9bfd3` | `#1d2a1f` | `#cdbff0` |
| `--nf-line` / `-strong` | `rgba(230,221,198,.10)` / `.22` | `rgba(170,200,235,.12)` / `.30` | `rgba(21,18,11,.14)` / `.30` | `rgba(200,170,255,.14)` / `.30` |
| `--nf-edge` (controles) | `rgba(230,221,198,.42)` | `rgba(170,200,235,.48)` | `rgba(21,18,11,.50)` | `rgba(200,170,255,.50)` |
| `--nf-text` | `#eee9dc` | `#e6edf5` | `#15120b` | `#f3ecff` |
| `--nf-text-2` | `#b9b8aa` | `#aebccd` | `#3b372c` | `#c6b8e2` |
| `--nf-text-3` | `#8e8f83` | `#8696aa` | `#575246` | `#a395c4` |
| `--nf-accent` | `#d3ad5d` | `#5aa9ff` | `#8a4a00` | `#ff5fd2` |
| `--nf-accent-hi` | `#edc878` | `#8cc4ff` | `#a65d06` | `#ff8fe0` |
| `--nf-accent-deep` | `#a9822f` | `#3a88e0` | `#6b3800` | `#e048bb` |
| `--nf-on-accent` | `#1b1405` | `#04101f` | `#ffffff` | `#1c0618` |
| `--nf-aember` | `#edc878` | `#f2c85f` | `#7a5200` | `#ffd35e` |
| `--nf-ether` (seleção) | `#a0e8ff` | `#9dfcd2` | `#0a54a8` | `#5ef2ff` |
| `--nf-ember` (perigo) | `#ef6a5a` | `#ff7b72` | `#b3231b` | `#ff8a4c` |
| `--nf-verdant` | `#82aa87` | `#5fd0a0` | `#17663a` | `#62f0b0` |
| `--nf-shadow` (rgb) | `0 0 0` | `2 8 20` | `60 40 10` | `12 0 32` |
| `--nf-scrim` | `rgba(9,12,10,.76)` | `rgba(4,8,14,.78)` | `rgba(21,18,11,.55)` | `rgba(10,4,24,.80)` |
| `lit` (estado ativo) | halo 1px + 24px | halo 1px + 24px, frio | **anel duplo sólido** 2px+4px (sem blur) | halo 1px + 32px, mais intenso |
| Granulado do Lobby | 3% | 0% (limpo, "tech") | 0% (papel liso) | 4% + poeira violeta |
| Vinheta | pesada (referência Arena) | média | **nenhuma** (fundo plano) | pesada, centrada |

**Intenção de cada direção** (por que são distintas, não variações de matiz):
- **Aço Frio** — troca a *temperatura* e o *acento*: sai o quente (âmbar), entra o azul-aço
  com ciano-menta de seleção; sombras azuladas; zero granulado. É o "painel de comando".
- **Claro Alto-Contraste** — troca a *luminância*: único tema claro (`color-scheme: light`),
  texto ≥7:1 em corpo, controles com borda ≥3:1, **sem glow** (anel sólido) e sem vinheta;
  o tapete vira sálvia-clara com rótulos escuros. Serve a luz do dia, baixa visão e impressão
  de screenshots.
- **Arcano** — troca a *saturação*: violeta profundo, acento magenta, éter ciano elétrico,
  halo mais forte; o tema "show", o mais afastado da Forja.

**Contrastes calculados (WCAG 2.x)** — mínimo exigido em negrito; o teste de H-02c reproduz esta
tabela, não confia nela:

| Par (fg / bg) | mín. | Forja | Aço Frio | Claro | Arcano |
| --- | --- | --- | --- | --- | --- |
| `text` / `s2` | **7** | 13,80 | 14,52 | 18,70 | 15,34 |
| `text-2` / `s2` | **4,5** | 8,36 | 8,87 | 11,87 | 9,55 |
| `text-3` / `s2` | **4,5** | 5,10 | 5,67 | 7,78 | 6,43 |
| `text-3` / `s3` *(só ≥12px)* | 4,5 | 4,59 | 5,00 | 6,24 | 5,73 |
| `accent` / `s2` (texto de acento) | **4,5** | 7,89 | 6,98 | 6,86 | 6,57 |
| `on-accent` / `accent` (CTA) | **4,5** | 8,62 | 7,78 | 6,86 | 7,18 |
| `on-accent` / `accent-hi` (hover) | **4,5** | 11,43 | 10,42 | 5,01 | 9,42 |
| `on-accent` / `accent-deep` (pressed) | **4,5** | 5,15 | 5,26 | 9,59 | 5,34 |
| `ether` / `s2` | **4,5** | 12,33 | 14,10 | 7,38 | 13,13 |
| `ether` / `felt` | **4,5** | 11,85 | 14,04 | 5,06 | 13,07 |
| `ember` / `s2` | **4,5** | 5,48 | 6,79 | 6,62 | 7,56 |
| `verdant` / `s2` | **4,5** | 6,41 | 8,99 | 7,00 | 12,28 |
| `aember` / `s2` | **4,5** | 10,46 | 10,77 | 6,92 | 12,38 |
| `felt-text` / `felt` | **4,5** | 9,30 | 9,00 | 10,27 | 10,30 |
| `edge` composto / `s2` e `s3` *(controle)* | **3,0** | ≥3,05 | ≥3,05 | ≥3,05 | ≥3,05 |
| casas (pior das 19) / `s2` *(glifo)* | **3,0** | 3,80 | 3,89 | 5,45 *(com mistura §1.6.3)* | 4,01 |

Notas: (a) os alfas de `--nf-edge` foram obtidos por busca (menor alfa que dá ≥3,05 sobre `s2`
**e** `s3`) e arredondados para cima; (b) `text-3` em `s3` é o par mais fraco — herdou a regra "só
≥12px" da Forja; (c) o Claro é o único cujo `on-accent` é claro sobre acento escuro (CTA invertido).

#### 1.6.5 Como um quinto tema entra (checklist de autoria)

1. Copiar `themes/aco.css`, trocar o seletor e os valores; **não** adicionar nem remover token.
2. Registrar o id em `THEMES` + `THEME_COLOR` (`theme.ts`) e as 2 chaves i18n `ui.theme.<id>.*`.
3. `npx vitest run src/ui/themes` — o teste exige os 22 tokens, valores literais e **todos** os
   pares da tabela de contraste acima do mínimo; só então o tema aparece no `ThemePicker`.
4. `node e2e/ui2.mjs --theme <id>` (screenshots de cada tela) e o FIT no tema novo.

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
2. **Interface**: **Tema** (primeira linha: 4 cartões com pré-visualização ao vivo — troca aplica na
   hora e persiste, §1.6.2), som, música, animações, mesa 2D/3D, hover zoom, idioma.
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
  tokens.css                  # tema Forja (padrão) + derivados + não cromáticos (H-02)
  theme.ts                    # THEMES, readTheme, applyTheme (H-02b)
  themes/                     # aco.css, claro.css, arcano.css + themes.test.ts (H-02c)
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
| `theme.ts` (motor), `ThemePicker` + `ThemePreview` | **novo** | tokens tematizáveis §1.6; o picker vive em Ajustes › Interface (H-18) |
| `ResultScreen`, `matchSummary()` | **novo** | |
| `OnboardingFlow`, `Coachmark`, `coach.ts` | **novo** | reusa `TutorialWizard` como passo/ajuda |
| `ZonesSheet` | **refactor** | de `PileDialog` (`App.tsx:2556`) |
| `CardArt`, `HouseIcon`, `CoverageBadge`, `FxLayer`, `useHandDrag`, `useDialogFocus`, `ErrorBoundary` | **mantido** (ErrorBoundary só restila) | **não tocar** FxLayer/useHandDrag |
| `GameBoard`, `SelectedCardPanel`, `PlayerBand`, `BoardLane` | **mantido** | só CSS de tokens/casca |

### 4.3 Dependências e ordem de construção

```
tokens(H-02) ─▶ motor de temas(H-02b) ─▶ temas+contraste(H-02c) ─┐
            └──────────▶ primitives(H-05,06) ─────────────────────┴▶ ┬▶ Shells(H-07) ─▶ Table shell(H-08) ─▶ TableMenu(H-09) ─▶ Rail(H-10)
                                        ├▶ Lobby(H-11,12) ─▶ MatchSheet(H-13) ─▶ Play wiring(H-14)
                                        ├▶ Decks(H-15,16,17)
                                        ├▶ Settings(H-18..20)  ← H-18 traz o ThemePicker (exige H-02c)
                                        └▶ Result(H-21,22) ─▶ Onboarding(H-23,24)
flag(H-01) e harness(H-03,04) precedem tudo; o tema vale para toda tela nova desde H-05 (tudo lê `--nf-*`). Cutover(H-29) só depois de todas as telas.
```
A ordem prioriza **valor cedo e risco isolado**: shell imersivo (maior ganho de pixels, maior
risco no FIT) logo após as primitivas; Lobby+Play (maior ganho de jornada) em seguida; as telas
de gestão por último.

---

## 5. Roadmap de implementação — lotes para o Haiku 5.5

> **Estado de execução (revisão do sistema de temas, 08/out/2026)**: H-01..H-10 estão commitados
> (`git log`: `525b15d` … `493bb93`); H-11..H-14 existem no working tree (Lobby/MatchSheet). Como
> H-05..H-14 já consomem `--nf-amber*`, **H-02b e H-02c entram na fila AGORA** (antes de H-15):
> cada tela nova escrita antes deles é mais uma a migrar. H-18 (linha Tema) exige H-02c; H-25
> (tapete) exige H-02c. Nenhum lote já entregue é refeito — H-02b é uma migração mecânica
> verificável por `grep` (ver o lote).

### 5.0 Protocolo comum (vale para TODO lote)

1. **Antes**: `git status` limpo; `npx vitest run` e anotar o total (baseline ≥ **922** segundo o
   commit `ccfd53d`; nunca regredir). `node e2e/fit.mjs` deve estar `FIT OK`.
2. **Proibido**: editar `src/lib/game.ts`, `ai.ts`, `abilities.ts`, `dsl*`, `fx.ts`,
   `FxLayer.tsx`, `useHandDrag.tsx`, `public/sw.js`; adicionar dependência npm; usar web fonts/CDN;
   introduzir `hex`/`rgba(`/`gap: Npx` literais em `src/ui/**` fora dos arquivos de tokens `tokens.css` e `themes/*.css` (gate H-03; cor só via `var(--nf-*)`); escrever texto de UI
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

#### H-02 · Tokens `--nf-*` · **M** · dep.: H-01 · ✅ **entregue** (`4377de2`)
- Entregou `src/ui/tokens.css` com um único `:root{…}`, nomes `--nf-amber*`/`--nf-on-amber`/
  `--nf-lit-amber` e **aliases** para tokens legados (`--nf-s2: var(--panel)`, `--nf-text:
  var(--paper)`, `--nf-text-3: var(--faint)`, `--nf-accent…: var(--gold…)`, `--nf-verdant:
  var(--green)`) mais `--nf-stagger: 60ms`. Era o desenho certo *antes* dos temas; **o sistema de
  temas (§1.6) o supera** — o contrato final (22 tokens literais, `data-theme`, derivados) é
  entregue por **H-02b**, que também migra o que já foi construído sobre estes nomes.

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
- **Lint** `scripts/lint-ui2-css.mjs` (novo, `node`): falha se algum `src/ui/**/*.css` (exceto os
  **arquivos de tokens**: `tokens.css` e `themes/*.css`) contiver `#[0-9a-f]{3,8}\b`, `rgba?\(` fora de `var()`/`color-mix`, ou
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

#### H-02b · Motor de temas + migração de tokens para o contrato tematizável · **M** · dep.: H-02, H-03 *(prioridade: **antes de H-15**; hoje H-05..H-14 já consomem os nomes antigos)*
- **Escopo**: (A) reestruturar `tokens.css` para o contrato da §1.6.1 e renomear o que já existe;
  (B) o motor `data-theme`; ainda com **um** tema (`forja`) — prova a infraestrutura antes de
  existirem os outros.
- **(A) Migração mecânica** (nenhuma tela muda de aparência além da nota de `--nf-s2` abaixo):
  1. Renomear em **todo** `src/ui/**`, `e2e/`, `scripts/` (incl. `scripts/__fixtures__/ui2-ok/ok.css`):
     `--nf-lit-amber→--nf-lit-accent`, `--nf-on-amber→--nf-on-accent`,
     `--nf-amber-hi→--nf-accent-hi`, `--nf-amber-deep→--nf-accent-deep`, `--nf-amber→--nf-accent`
     (nessa ordem, mais longos primeiro). Hoje são **19** ocorrências em `tokens.css`,
     `primitives/primitives.css`, `screens/lobby/lobby.css`, `screens/match.css`, `shell/shell.css`.
     Aceite da etapa: `grep -rnE "nf-(amber|on-amber|lit-amber)" src e2e scripts` = **0**.
  2. Reescrever `tokens.css` em três blocos (código abaixo): tema `forja` com **22 valores
     literais** (sem `var(--panel/--paper/--faint/--gold/--green)`), derivados em `:root,
     [data-theme]`, não cromáticos em `:root` (**preservar** `--nf-font-*`, `--nf-w-*`,
     `--nf-stagger`).
  3. Onde o código já usava `var(--elev-N)` legados dentro de `src/ui`, trocar por `--nf-elev-N`.
  4. **Nota de valor**: `--nf-s2` passa de `var(--panel)` (= `#191b17`) para `#1b1f18` (o valor da
     §1.1/§1.6.4, sobre o qual todos os contrastes foram calculados) — mudança de 1 degrau, só nas
     telas v2; a v1 não é afetada. Registrar no commit.
- **Código-alvo de `tokens.css`**:
```css
/* 1) TEMA PADRÃO — contrato fechado de 22 tokens + color-scheme (valores = tabela §1.6.4) */
:root, [data-theme="forja"] {
  --nf-void:#0d0f0c; --nf-s1:#151813; --nf-s2:#1b1f18; --nf-s3:#232820;
  --nf-felt:#16241f; --nf-felt-text:#b9c9bd;
  --nf-line:rgba(230,221,198,.10); --nf-line-strong:rgba(230,221,198,.22); --nf-edge:rgba(230,221,198,.42);
  --nf-text:#eee9dc; --nf-text-2:#b9b8aa; --nf-text-3:#8e8f83;
  --nf-accent:#d3ad5d; --nf-accent-hi:#edc878; --nf-accent-deep:#a9822f; --nf-on-accent:#1b1405;
  --nf-aember:#edc878; --nf-ether:#a0e8ff; --nf-ember:#ef6a5a; --nf-verdant:#82aa87;
  --nf-shadow:0 0 0; --nf-scrim:rgba(9,12,10,.76);
  color-scheme: dark;
}
/* 2) DERIVADOS — mesmo bloco para a raiz e para qualquer [data-theme] (previews, §1.6.1) */
:root, [data-theme] {
  --nf-lit-accent: 0 0 0 1px color-mix(in srgb, var(--nf-accent) 50%, transparent), 0 0 24px color-mix(in srgb, var(--nf-accent) 25%, transparent);
  --nf-lit-ether:  0 0 0 1px color-mix(in srgb, var(--nf-ether) 50%, transparent),  0 0 24px color-mix(in srgb, var(--nf-ether) 25%, transparent);
  --nf-lit-ember:  0 0 0 1px color-mix(in srgb, var(--nf-ember) 50%, transparent),  0 0 24px color-mix(in srgb, var(--nf-ember) 25%, transparent);
  --nf-elev-1: 0 1px 2px rgb(var(--nf-shadow) / .28);
  --nf-elev-2: 0 12px 26px rgb(var(--nf-shadow) / .28);
  --nf-elev-3: 0 25px 90px rgb(var(--nf-shadow) / .55);
}
/* 3) NÃO CROMÁTICOS (iguais em todos os temas) */
:root {
  --nf-font-ui:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --nf-font-display:"Iowan Old Style","Palatino Linotype",Georgia,serif;
  --nf-w-read:680px; --nf-w-content:1120px; --nf-w-wide:1280px; --nf-stagger:60ms;
}
```
- **(B) Motor**: `src/ui/theme.ts` (código da §1.6.1), `src/ui/theme.test.ts`, `src/main.tsx`
  (`applyTheme(readTheme())` **antes** de `createRoot`), `index.html` (o `<meta name="theme-color">`
  **já existe** com `#111310` — trocar para `#0d0f0c`; adicionar o script inline abaixo no `<head>`,
  **antes** de qualquer `<style>`/CSS).
```html
<script>try{var t=localStorage.getItem("aember-arena-theme");if(t&&t!=="forja")document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>
```
- **(C) Lint**: `scripts/lint-ui2-css.mjs` hoje isenta só o arquivo `tokens.css` (`EXEMPT` é um
  `Set` de nomes, linha ~10). Passar a comparar o caminho relativo a `src/ui`: isentos =
  `tokens.css` **e** `themes/*.css`. Adicionar fixture `scripts/__fixtures__/ui2-theme-exempt/`
  (um `themes/x.css` com `#fff` **passa**; o mesmo arquivo fora de `themes/` **falha**).
- **Regras do motor**: `THEMES`/`THEME_COLOR`/`DEFAULT_THEME` exportados; `readTheme` com valor
  inválido, storage ausente ou lançando → `"forja"`; `applyTheme("forja")` **remove** o atributo;
  tudo em `try/catch` silencioso (regra 6). **Não** tocar em `settings.ts`/`AppSettings`.
- **Aceite**: vitest (injetar `root` e `store` falsos, como `flag.test.ts`): ler/aplicar/persistir;
  inválido → padrão; `applyTheme` atualiza o `content` do meta `theme-color`; `THEME_COLOR[id]` é
  hex de 7 chars. `npm run build`, `npm run lint:ui2` (com a fixture nova) e `npx vitest run` verdes;
  `e2e/ui2.mjs` e `e2e/ui2-journey.mjs` seguem verdes **sem alteração de comportamento**;
  `_2d-freeze` = 0 diff (v1 intacta); recarregar com `localStorage["aember-arena-theme"]="lixo"` não
  quebra nada (probe de 1 linha em `ui2.mjs`).

#### H-02c · Temas Aço Frio, Claro Alto-Contraste e Arcano + teste de contraste · **M** · dep.: H-02b, H-03
- **Escopo**: os três arquivos da §1.6.4 e o gate que impede um tema ruim de entrar.
- **Arquivos**: `src/ui/themes/{aco,claro,arcano}.css` (novos, cada um **um** bloco
  `[data-theme="<id>"] { … 22 tokens … color-scheme: … }`), override do `lit` do Claro **no próprio
  `claro.css`** (depois do bloco de tokens, mesma especificidade, vence por ordem):
```css
[data-theme="claro"] {
  --nf-lit-accent: 0 0 0 2px var(--nf-s2), 0 0 0 4px var(--nf-accent);   /* anel duplo, sem blur */
  --nf-lit-ether:  0 0 0 2px var(--nf-s2), 0 0 0 4px var(--nf-ether);
  --nf-lit-ember:  0 0 0 2px var(--nf-s2), 0 0 0 4px var(--nf-ember);
}
```
  `src/ui/theme.ts` (acrescentar `aco`, `claro`, `arcano` a `THEMES` e `THEME_COLOR`),
  `src/main.tsx` (importar os 3 CSS **depois** de `tokens.css`), `src/ui/themes/themes.test.ts` (novo),
  `e2e/ui2.mjs` (flag `--theme <id>`: semeia `aember-arena-theme` antes de abrir e roda **todos** os
  checks do H-03 naquele tema).
- **Teste** (`themes.test.ts`, vitest; lê os CSS com `import css from "./aco.css?raw"`):
```ts
export const REQUIRED = ["void","s1","s2","s3","felt","felt-text","line","line-strong","edge","text","text-2",
  "text-3","accent","accent-hi","accent-deep","on-accent","aember","ether","ember","verdant","shadow","scrim"] as const;
// [fg, bg, mínimo] — a tabela da §1.6.4; "edge" e "line*" são compostos sobre o bg antes de medir.
export const PAIRS = [["text","s2",7],["text-2","s2",4.5],["text-3","s2",4.5],["accent","s2",4.5],
  ["on-accent","accent",4.5],["on-accent","accent-hi",4.5],["on-accent","accent-deep",4.5],
  ["ether","s2",4.5],["ether","felt",4.5],["ember","s2",4.5],["verdant","s2",4.5],["aember","s2",4.5],
  ["felt-text","felt",4.5],["edge","s2",3],["edge","s3",3]] as const;
```
  Afirmações: (1) cada tema declara **exatamente** `REQUIRED` + `color-scheme`; (2) nenhum valor
  contém `var(`; (3) todos os `PAIRS` ≥ mínimo (luminância WCAG implementada no próprio teste, ~15
  linhas, sem dependência); (4) `THEME_COLOR[id] === --nf-void` do CSS; (5) `claro` tem
  `color-scheme: light` e os demais `dark`; (6) o tema `forja` em `tokens.css` passa os mesmos pares.
- **Aceite**: vitest verde (inclusive o *teste do teste*: trocar localmente um valor por um cinza
  que viola 4,5:1 faz o teste falhar — provar e desfazer); `npm run lint:ui2` verde (os 4 arquivos
  de tokens são **isentos**, o resto de `src/ui/**` não); com `?ui=2` e `localStorage` semeado,
  `node e2e/ui2.mjs --theme claro|aco|arcano` verde na `_kit` nos 5 viewports; `node e2e/fit.mjs`
  e `--view 3d` idênticos em qualquer tema (o tema não pode mexer em geometria — §1.6.3.5; semear o
  tema no `SEED()` do fit via param `--theme`).

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
  `primary` = latão (cor de acento do tema) com `--nf-on-accent`; só **um** primário por tela (documentado no kit).
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

#### H-18 · `SettingsScreen` + abas Jogo/Interface (+ linha **Tema**) · **M** · dep.: H-02c, H-06, H-07
- **Escopo**: S7 abas 1 e 2 com `SettingRow`; **as mesmas** chaves de `AppSettings`
  (`sfx/music/animations/tableView/aiDelayMs/hints/hoverZoom`, idioma). `hasHover` esconde
  hoverZoom como hoje (`ConfigScreen`). **Nova primeira linha da aba Interface: Tema**
  (`ThemePicker`, §1.6.2) — não passa por `AppSettings`; usa `readTheme`/`applyTheme` de H-02b.
- **Arquivos**: `src/ui/screens/settings/{SettingsScreen,InterfaceTab,GameTab}.tsx`,
  `src/ui/screens/settings/ThemePicker.tsx` + `ThemePreview.tsx`, CSS, chaves i18n
  `ui.theme.title`, `ui.theme.<id>.name`, `ui.theme.<id>.desc` (4 temas) e `ui.theme.boardPending` (aviso transitório, removido em H-25) — todas en + pt-BR.
- **Contrato do `ThemePicker`** (para não haver ambiguidade):
```tsx
export function ThemePicker({ t, value, onChange }: { t: Translator; value: ThemeId; onChange: (id: ThemeId) => void }) {
  return (
    <div role="radiogroup" aria-label={t("ui.theme.title")} className="u-theme-grid">
      {THEMES.map((id) => (
        <div key={id} className="u-theme-slot" data-lit={value === id}>{/* FORA do escopo: o anel usa o tema VIGENTE */}
          <button type="button" role="radio" aria-checked={value === id} data-theme={id}
            className="u-theme-card" onClick={() => onChange(id)}>
            <ThemePreview />{/* miniatura só de tokens; herda as cores do data-theme do botão */}
            <strong>{t(`ui.theme.${id}.name`)}</strong><small>{t(`ui.theme.${id}.desc`)}</small>
          </button>
        </div>
      ))}
    </div>
  );
}
// no SettingsScreen: onChange = (id) => { sound.play("select"); applyTheme(id); setTheme(id); }
```
  Grade `repeat(auto-fill, minmax(min(160px,100%), 1fr))`; cartão ≥44px de alvo (na prática ~120px);
  setas navegam (roving `tabindex`). O `.u-theme-slot[data-lit=true]` desenha o anel
  `--nf-lit-accent` com os tokens do tema **vigente** (por isso fica *fora* do `data-theme` do botão;
  dentro dele o anel sairia na cor do tema que o cartão representa). Testar visualmente nos 4.
- **Aceite**: alternar cada opção persiste (`readSettings` após reload) e aplica ao vivo; vitest
  de `settings.test.ts` inalterado; `data-screen="settings"` verde. **Tema**: clicar um cartão muda
  `document.documentElement.dataset.theme` **no mesmo frame** e `localStorage["aember-arena-theme"]`;
  recarregar mantém o tema **sem flash** (Playwright: `page.addInitScript` captura o primeiro
  `getComputedStyle(body).backgroundColor` e compara com o `--nf-void` do tema salvo); `forja`
  remove o atributo; os 4 cartões mostram cores distintas (assert: `--nf-accent` computado difere
  entre cartões); `e2e:ui2` verde **nos 4 temas × 5 viewports** na tela Ajustes; teclado: setas
  movem a seleção e `Enter/Espaço` aplicam; paridade i18n (H-04) verde para as 10 chaves novas (`ui.theme.title`, 4×`name`, 4×`desc`, `boardPending`).

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

#### H-25 · Tokens no HUD e no tapete da mesa (tematização do board) · **L** · dep.: H-10, H-02c
- **Escopo**: bandas, console, chips de pilha, pill de casas, selos de chave/Æmber **e o tapete**
  passam a ler `--nf-*`/`--nf-elev-*`/`--dur-*` **sem mudar dimensões** (altura/padding intactos).
  Numerais `tabular-nums`. Glow só em estado ativo (turno, alvo, seleção) — auditar e remover glows
  estáticos; remover `ui.theme.boardPending` do ThemePicker. **É aqui que os temas chegam à mesa** (§1.6.1 "Escopo do tema"; risco R12): mapa de
  migração — fundo/gradientes do playmat e `.felt-etching` → `--nf-felt` (variações por
  `color-mix(in srgb, var(--nf-felt) N%, var(--nf-void))`); `.zone-heading`, contagens "N on table"
  → `--nf-felt-text`; `.player-band`/`.turn-console`/chips → `--nf-s2`/`--nf-s3`/`--nf-line`;
  contador de Æmber → `--nf-aember` (**não** o acento); aro "pronta"/alvo/seleção → `--nf-ether`
  (substitui `--sel-core` no board); botão End turn → `Button primary`. Método: `grep -nE
  "#[0-9a-fA-F]{3,8}|rgba?\(" src/index.css` restrito aos seletores do board, convertendo um
  seletor por vez. **Sombras/halos dentro de `.table-plane` continuam sem `filter`** (regra 10).
- **Aceite**: `fit.mjs` **idêntico** ao baseline pós-H-08 (mesmos `rows`) **em cada um dos 4
  temas** (seed `--theme`); `e2e:floor`, `floor:3d`, `e2e:arena`, 3 probes 3D e capture 2D/3D sem
  regressão no tema padrão; **capture 2D+3D da mesa nos 4 temas** (`node e2e/capture.mjs --theme
  <id> --out …`) com revisão lado a lado: nenhum texto "escuro sobre escuro"/"claro sobre claro";
  novo check no `ui2.mjs` (modo mesa): para `.zone-heading`, `.player-band` e `.turn-console`,
  contraste `color` × primeiro `background-color` opaco ancestral ≥4,5:1 (elementos com gradiente
  são listados como "não medido", não aprovados em silêncio); com o tema **Claro** o contador de
  Æmber continua dourado-escuro (`--nf-aember`) e distinto do botão de acento.

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
  `capture.mjs`/`fit.mjs`/`ui2.mjs` aceitam `--theme <id>` (semeiam `aember-arena-theme`);
  `acceptance.mjs` roda `fit` e `ui2` **nos 4 temas** e o capture no padrão + 1 tema escuro e o Claro.
- **Aceite**: **`npm run e2e:acceptance`** + `e2e:fit` (2D/3D, 4 temas) + `e2e:arena` + 3 probes 3D +
  `e2e:smoke`(2D/3D) + `e2e:ui2` (4 temas) + `e2e/sw-reset.mjs` + `npx vitest run` (≥ baseline +
  novos, inclusive `themes.test.ts`) + `npm run build` — todos verdes.

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
| R12 | **Tema não alcança o que ainda é literal**: o board tem centenas de `hex`/`rgba` em `index.css` (D-10); trocar para Claro deixaria tapete/bandas escuros com texto claro (ou o inverso) | H-25 migra o board seletor a seletor para `--nf-*` e o gate `--theme` mede contraste computado; até H-25 vale a nota abaixo |
| R13 | **Flash do tema errado** (FOUC) ao abrir o PWA com tema salvo | script inline no `<head>` antes do CSS (H-02b) + teste do primeiro `backgroundColor` pintado |
| R14 | **Tema novo quebra contraste** (hex "quase certo") | `themes.test.ts` (H-02c) calcula WCAG de 15 pares por tema e falha o build; o lint H-03 proíbe literal fora dos arquivos de tokens |
| R15 | **Derivado calculado na raiz** (`lit`/`elev` com `var()` só em `:root`) faz o preview mostrar o glow do tema errado | derivados declarados em `:root, [data-theme]` (H-02); `ui2.mjs` compara o `--nf-lit-accent` computado de cada cartão de tema |
| R16 | Tema muda geometria por acidente (fonte/borda/padding) | temas só definem os 22 tokens cromáticos; FIT e floor rodam nos 4 temas (H-02c, H-25, H-29) |
| R17 | Æmber azul/rosa no Aço Frio/Arcano lido como outro recurso | token `--nf-aember` dourado nos 4 temas (§1.6.3.2) |

> **Nota R12 (transição)**: entre H-02c e H-25 o `GameBoard` ainda lê tokens legados. Para o jogador
> nunca ver uma mesa meio-tematizada, o ThemePicker mostra o aviso i18n `ui.theme.boardPending`
> ("a mesa adota o tema em uma atualização futura"), removido em H-25. O cutover (H-29) é posterior
> a H-25, então nenhum usuário final vê o estado intermediário.

### 6.3 O que testar (pirâmide)
1. **vitest** (puro): `flag`, `theme` (motor), `themes` (22 tokens + contraste WCAG × 4 temas), `presets`,
   `matchSummary`, `coach`, paridade i18n, parser de import.
   Meta: baseline 922 + os novos, **zero removidos**.
2. **Harness `e2e/ui2.mjs`** (por tela, 5 viewports, 2D, **`--theme` em cada um dos 4 temas**):
   overflow, alvo de toque, `aria-label`, piso tipográfico, reduced-motion e contraste computado do HUD.
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
**S×8 · M×24 · L×2** em **33 lotes** (H-01..H-31 + H-02b/H-02c; H-25 virou L ao absorver a
tematização do tapete). H-08, H-25 e H-30 concentram o risco; reservar revisão humana extra neles.
