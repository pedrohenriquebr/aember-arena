# Aember Arena — KeyForge Solo Play

Offline-first PWA that lets a player import a real KeyForge Master Vault deck, play a
solo match against a configurable local AI, and keep working with no connection.
Shipped as **one self-contained `index.html`** (JS + CSS inlined by
`vite-plugin-singlefile`), so it can be opened from disk, emailed, or dropped on any
static host with no server.

**Estado atual (30/09, ~260 commits):** Mobile-first + palco de viewport (UX-FIT
FIT-01..08), animações estilo Arena (3 ondas), áudio procedural (14 timbres),
tutorial, modo 3D da mesa (12 histórias + punch list) e **motor de abilities
declarativas (ondas 1-4)** — efeitos persistentes, "you may", reações,
purge/sacrifice/tokens/exalt, ward/enrage/enhanced/take-control/forja/instead
(cobertura do catálogo: full 200/2.603, crashes 0). Specs: 222+. Este arquivo
descreve o estado ATUAL — histórico em `docs/` (CODE_REVIEW, WORKFLOW,
MECHANICS_REPORT, ROADMAP_REVIEW, GAME_ROADMAP, UX_FIT_PLAN, VIEW3D_*).

## Stack

- React 19 + TypeScript 5.9 (strict), Vite 7
- **Tailwind foi removido** — o CSS é 100% hand-written, mobile-first, com reset mínimo
  próprio no topo de `src/index.css`
- `lucide-react` for icons
- Web Audio API synthesis for all SFX/music (no audio files)
- IndexedDB (`cache.ts`, conexão singleton) with a localStorage fallback
- Service worker (`public/sw.js`) with LRU cap (~300) + `QuotaExceededError` handling,
  caminhos relativos (`./`) — funciona em subpath
- `playwright-core` (devDep, sem download de browser) dirigindo o Edge/Chrome do sistema
  para o harness `e2e/`

## Commands

```bash
npm run dev            # vite dev server
npm run build          # tsc --noEmit && vite build  (gate: tipos + bundle)
npm run typecheck      # tsc --noEmit
npm run preview        # serve o build
npm run e2e:capture    # screenshots 4 viewports × 5 telas -> e2e/shots/current
npm run e2e:capture:3d # o mesmo com tableView: "3d" -> e2e/shots/current-3d
npm run e2e:floor      # piso tipográfico medido a 360px (exit != 0 se violado)
npm run e2e:floor:3d   # piso VISUAL do 3D (fator de projeção) a 360/768/1280/1440
npm run e2e:smoke      # inicia a partida demo e passa 2 turnos, headless
npm run e2e:smoke:3d   # o mesmo na mesa 3D -> e2e/shots/match-smoke-3d
npm run e2e:bundle     # imprime gzipKB do dist/index.html
npm run e2e:acceptance # piso 2D + piso visual 3D + bundle + bloco 700px
node e2e/probes/_3d-chain.mjs   # cadeia preserve-3d, toggle, sombras, leque, câmera
node e2e/probes/_3d-hit.mjs     # hit-test/click/alvo de luta com 1/6/12 cartas
node e2e/probes/_3d-fx.mjs      # voo do leque ao slot 3D (quadro 0, pouso, hold)
npm run e2e:record:3d  # clipe + frames da mesa 3D (e2e/clips/frames-3d)
npm run e2e:fit:3d     # o encaixe do palco (e2e:fit) com a mesa 3D; mão overlay >= 70%
npm run e2e:arena      # layout Arena (H3D-13..15): palco, fileiras, notch, escala, a11y;
                       # `--break` (lane em flex) TEM de falhar; `--shots` salva PNGs
```

## Layout

```
index.html                 PWA shell (viewport-fit=cover, manifest, lang dinâmico)
public/                    manifest.webmanifest, sw.js, ícone
e2e/                       harness (capture/floor/smoke/bundle/acceptance) + shots/
src/
  main.tsx                 mounts <App/> in StrictMode
  App.tsx                  ~1.6k lines - god component (AINDA monolítico; T10 opcional não feito)
  index.css                design system hand-written MOBILE-FIRST:
                           - reset mínimo próprio no topo
                           - tokens tipográficos em :root (--fs-3xs..--fs-display, --fs-input)
                           - default = mobile; desktop em @media (min-width: 701px/1041px/1221px)
                             AO LADO de cada seletor (não existe mais bloco max-width no fim)
  components/              CardArt (pointer events: hover-zoom em mouse, long-press ->
                           CardLightbox em touch), DeckBrowser, DeckInspector, DeckTile,
                           HouseIcon, Pagination
  lib/                     game.ts (puro), ai.ts (puro), i18n.ts (en/pt-BR),
                           keyforgeApi.ts, cache.ts (IndexedDB singleton), houses.ts,
                           demoDeck(s).ts, settings.ts, sound.ts (WebAudio)
```

## Motor de abilities (ondas 1-4 — leia antes de mexer em regras)

As cartas têm efeitos declarativos derivados do `card_text` (não mais if/else por
título): `rulesOf()` em `abilities.ts` retorna `CardRules { abilities, keywords,
effects, coverage }` memoizado. LEIA `docs/MECHANICS_REPORT.md` (a bíblia: triggers,
ações, cobertura por set, pendências).

- **Efeitos persistentes derivados**: `activeEffects(state, side)` coleta do board
  a cada consulta (nada armazenado); leitura efetiva via `effectivePower/Armor`,
  `keyword(state, card, name)` — NUNCA leia `face.power` cru no motor.
- **"You may"** = `Act.optional` + variante `decline` no GameMove (UI: botão "Sem
  efeito"); IA compara variantes no search.
- **Reações**: `After <ev>:`/`Each time <ev>:` = pós-evento (sem contador — `fire`
  roda por ocorrência); `At the start/end of your turn:` = `startOfTurn`/`endOfTurn`
  (endOfTurn dispara APÓS ready+compra; startOfTurn ANTES da forja).
- **Zonas**: `purged` (sai do jogo, nunca volta), `sacrifice` (descarte do dono,
  DISPARA Destroyed: — keyteki DestroyAction), tokens (`isToken: true`, nascem
  exaustos, nunca em deck, saem do jogo em qualquer leavePlay).
- **Estado de set**: `warded`/`enraged` (tokens com consumo — dano cancela evento
  inteiro; enrage obrigа luta "if able"), `controlledBy` (take control MOVE a carta
  de battleline), `bonusIcons` (enhanced: capture/damage/draw além do âmbar),
  `forgeKey/unforgeKey` fora do passo, `PersistentEffect.replace` ("instead").
- **Cobertura do catálogo**: full 200/2.603 (7,7%), partial 88, crashes 0.
  Pendente (ondas 3-5 do ROADMAP_REVIEW): efeitos persistentes complexos,
  opcionalidade de fase, verbos de busca, tide/enhanced-completo/prophecy.

## Regras de estilo vigentes

- **Piso tipográfico (contrato):** 11px para qualquer texto informativo; 10px só em
  caps/eyebrow com `letter-spacing ≥ 0.1em`; inputs/textarea/select **16px** sempre
  (anti auto-zoom iOS). O gate `npm run e2e:floor` falha se violado a 360px.
- **Cascata mobile-first:** o default de cada seletor é mobile; desktop vive em
  `@media (min-width: …)` colocado junto do seletor. NÃO recriar blocos `max-width`
  no fim do arquivo. Grids com mínimo usam `minmax(min(Xpx,100%), 1fr)`.
- **Toque é cidadão de primeira:** nenhuma interação pode ser hover-only. Informação
  que era hover-zoom tem caminho touch (long-press → lightbox). `touch-action` e
  `@media (hover: hover)` quando pertinente.
- Texto de estado dentro de carta usa `max(var(--fs-card-floor), 7cqi)` (container
  query) e nunca abaixa do piso; estados ("Ready/Stunned") são indicador visual +
  `aria-label` via `t()`.

## Rules that must not be broken

1. **Never** remove `vite-plugin-singlefile` or switch to code-splitting. One
   `index.html`, works from `file://` and offline. **No CDN/web fonts/remote assets**
   beyond what `public/sw.js` precaches.
2. **Never** make `lib/game.ts` or `lib/ai.ts` impure or mutate `GameState` in place.
3. Keep both starter decks working offline (first run, no network).
4. `houseColor` / `houseLabel` signatures stable.
5. All user-facing strings (incl. `aria-label`) go through `i18n.ts` (`t("…")`), en + pt-BR.
6. Preserve the deliberate error-swallowing in storage/audio paths (match stays playable).
7. **Orçamento de bundle:** gzip do `dist/index.html` ≤ **151 kB**. Histórico de
   revisões (sempre chore commit + justificativa): 121,5 → 122 (FEAT-01/02) → 124
   (fechamento tutorial) → 125 (BUG2-05) → 126 (FEAT-05/08/10) → 127,5 (FEAT-11/14/06)
   → 129,5 (FEAT-12) → 132 (FEAT-13) → 134 (tutorial) → 135 (fixes BUG2-01..07:
   +0,15 kB líquidos, dos quais 56 bytes são do BUG2-04 — reconstrução de DeckInfo
   retomado, lógica nova real; varredura de mortos exaustiva pré-revisão: 0 removível)
   → **136,5** (ANIM onda 1, `docs/ANIMATIONS_PLAN.md`: infra de FX — `lib/fx.ts`
   (diff determinístico, puro), diretor `FxLayer` no portal, `data-iid`/`data-side`,
   voo da carta com assento no slot, fade de quem sai do board, glow de seleção com
   a aura fria, e VAL-04 (whoosh `play` + `land` no slam). Medido 136,46 kB;
   varredura de mortos pré-revisão: 6 overrides `.reduce-motion` redundantes
   (superseded pelo `*` global) e 2 metadados do `card-tile--enter`/`ready-breathe`
   removidos)
   → **138** (ANIM onda 2, `docs/ANIMATIONS_PLAN.md` §3: palco do turno da IA —
   batida de 700-900ms por ação com curva de degradação, legenda "o Warden jogou
   X", pulso de quem age + "+N Æ" voando ao placar, selo da casa no band, banner
   "Seu turno", resumo persistente na faixa do round, toque para acelerar e
   `aiSpeed` (normal/rápida) em settings com i18n en+pt. Medido 137,92 kB)
   → **139,5** (ANIM onda 3, `docs/ANIMATIONS_PLAN.md` §4: impacto — forja com
   glow no lado de quem forjou + shake, números flutuantes de dano (aria-hidden)
   com marca de impacto, morte com dissolve do clone e correntes com elo no
   contador. Medido 138,68 kB)
   → **141** (VIEW3D H3D-01..10, `docs/VIEW3D_PLAN.md` §2/§5 — fundação do modo
   3D: `settings.tableView` persistido ("2d" default) com toggle na Config e
   botão de 44px na partida, wrapper `.table-plane` (`display: contents` no 2D)
   e a cadeia `perspective`/`preserve-3d` até a `.board-piece`, `@property
   --tilt` + transição de 420ms e fade da troca de modo, probe
   `e2e/probes/_3d-chain.mjs`. Só CSS/TS, zero dependência; a fundação mediu
   +0,87 kB gz (139,26 → 140,13) e o modo completo (H3D-03..12, mesa
   inclinada/leque/FX) ainda pede a revisão dos marcos M2/M3 — estimativa do
   plano: +2,0 a +2,6 kB no total. Varredura de mortos pré-revisão
   (`_dead-css`): 0 removível — os nomes
   "sem uso" são dinâmicos (`card-art--${size}`) e os overrides `.reduce-motion`
   restantes são intencionais (o `*` global só encurta a duração, não remove o
   fill).
   → **143,5** (VIEW3D H3D-03..06, `docs/VIEW3D_PLAN.md` §2.1-§2.5: mesa
   inclinada a 40°/32° com playmat em gradientes + billboards, cartas de pé e
   levitando (pose em propriedades individuais, --n por lane com sobreposição),
   sombras difusas no tapete com o ready-breathe/sel-breathe convertidos para
   opacity e mão em leque com recuo lateral, mais os checks novos do probe
   `_3d-chain` (pose, sombra, teto de animações por propriedade e leque). Só
   CSS/TS, zero dependência; medido 141,38 kB gz (+1,25 sobre os 140,13 da
   fundação: +0,26 no 03, +0,45 no 04, +0,25 no 05 e +0,29 no 06). Varredura de
   mortos pré-revisão (`_dead-css`): 0 removível — os "sem uso" são nomes
   dinâmicos (`card-art--${size}`, `house-icon--${size}`). Confira com
   `npm run e2e:bundle`.
   → **143,5 mantido** (VIEW3D H3D-07/08/09/12, `docs/VIEW3D_PLAN.md` §2.7-§3:
   interação (alvo do pick sobe/afunda), FX no 3D (pouso com a pose do slot,
   origem do leque por layout+scale, shake no plano), perfil 2.5D do celular +
   modo lite (<= 2 núcleos) + `@supports` que anula o 3D sem suporte, parallax
   da câmera e os instrumentos (capture/floor visual/smoke/record 3D + probes
   `_3d-hit`/`_3d-fx` e os checks de câmera no `_3d-chain`). Só CSS/TS, zero
   dependência: medido **142,57 kB gz** (+1,19 sobre os 141,38) — dentro do teto,
   sem necessidade de nova revisão. Varredura de mortos pós-mudança
   (`_dead-css`): 0 removível (mesmos nomes dinâmicos de antes).
   → **145** (UX-FIT lote 2, `docs/UX_FIT_PLAN.md` §2.4/§2.6/§4: mão como HUD
   com título fundido à barra do jogador, rail em drawer abaixo de 1041px
   (botões Desfazer/Notas no console, useDialogFocus, Esc/backdrop/X) e ritmo da
   IA configurável `aiDelayMs`. Só CSS/TS, zero dependência; FIT-04 mediu
   143,20 e FIT-05 143,66 kB gz. Teto ÚNICO deste lote — acima de 145: parar.
   Varredura de mortos pré-revisão: 0 removível (`.match-chip` já saiu).)
   → **148** (onda 1 da camada de efeitos, `docs/ROADMAP_REVIEW.md` §3:
   persistentEffect derivado do board em `game.activeEffects` — gramática
   constante no `cardText.ts` (gets/gains/gets ±N power|armor/cannot play|use|fight/
   gains '<ability citada>'), leitura efetiva (`effectivePower`/`effectiveArmor`/
   `keyword(state,…)`/`abilitiesOf`) em luta, dano, morte por poder e avaliação da
   IA, proibições na legalidade, duração ("remainder of the turn"/"on their next
   turn") como dado primitivo em `GameState.lasting` podado no endTurn, e o fix de
   regra dos arquivos opcionais ("may") com botão no console. Só TS/CSS, zero
   dependência; a gramática sozinha mediu 145,38 e o fechamento **146,34 kB** gz.
   Deixou de fora da onda (documentado no roadmap): bonusFightDamage (Valdr),
   contadores de poder, "instead" e tokens. Teto ÚNICO deste lote — acima de 148:
   parar. Varredura de mortos pré-revisão: 0 removível (o nome novo
   `.archives-action/.archives-count` é usado pelo botão; os nomes "sem uso" do CSS
   continuam dinâmicos).)
   → **151** (onda 4, "estado de set", `docs/ROADMAP_REVIEW.md` §3: ward/enrage
   como tokens em `CardInstance` (`warded`/`enraged`) com consumo no destroy/dano e
   a luta forçada na legalidade, `CardFace.bonusIcons` + `enhancements` do Master
   Vault lidos no `normaliseCard` e resolvidos no play, `controlledBy` para a troca
   de controle (que move a carta de battleline e devolve à pilha do dono), `forge()`
   compartilhado com `forgeKey`/`unforgeKey` fora do passo de chave e
   `PersistentEffect.replace` para as substituições "instead" suportadas. Só TS,
   zero dependência; medido **148,35 kB** gz no fechamento (147,16 antes da onda).
   Teto ÚNICO deste lote — acima de 151: parar. Varredura de mortos pré-revisão
   (`_dead-css`): 0 removível (os nomes "sem uso" continuam dinâmicos:
   `card-art--${size}`, `house-icon--${size}`, `coverage-note--*`,
   `toast-message--${kind}`).)
8. Áudio permanece 100% sintetizado (Web Audio); animações respeitam
   `prefers-reduced-motion` E `settings.animations` (classe `no-anim`).
9. Alvos de toque ≥ 44px em controles primários; `<html lang>` segue `settings.language`.
10. **Mesa 3D (H3D) — o 2D é o default e não muda um pixel.** O 3D é só CSS
    escopado em `.game-board--3d` sobre o MESMO DOM (o `--lite` troca o 3D real
    pelo perfil 2.5D; nunca coexistem) e vive sob
    `@supports (transform-style: preserve-3d)`. Regras:
    - **Nada de agrupamento** entre `.table-plane` e `.board-piece` (overflow ≠
      visible, opacity < 1, filter, clip-path/mask, isolation, contain: paint
      achata o 3D em silêncio). Mudou o board? `node e2e/probes/_3d-chain.mjs`.
    - Pose 3D sempre em propriedades INDIVIDUAIS (`translate`/`rotate`/`scale`):
      `transform` pertence ao `card-arrive`, que vence uma pose estática.
    - Texto do plano é billboard (contra-rotacionado) ou HUD; no 3D o gate é
      `e2e:floor:3d` (piso VISUAL = fontSize × projeção), não o `e2e:floor` 2D.
    - Mudou board/hand? Rode capture 2D **e** 3D, `e2e:floor` **e** `e2e:floor:3d`
      e os três probes (`_3d-chain`, `_3d-hit`, `_3d-fx`) **e** `e2e:arena`/`e2e:fit:3d`.
    - **Palco (H3D-14):** o 3D/lite também recebem `game-board--stage`; o `.table-plane`
      é item do grid (linhas 2-4, colunas `minmax(0,1fr)`) com grid próprio (zona,
      console, zona) e SEM margem negativa. A mão é overlay (`--hand-row` = 70% do
      `--hand-h`, carta a 0,9×, cada carta >= 70% visível). A razão visual
      oponente/jogador (0,74-0,80) NÃO é fixa: os tetos `--card-w-3d` sobem por faixa
      de altura/largura (o fundo recua mais com o plano alto) — retunar com o
      `_3d-arena` ao mexer em alturas.
    - **Fileiras (H3D-15, >= 701px):** a `.board-lane` é grid (goteira 1fr + n
      colunas `--col` + goteira 1fr; linhas: criaturas | externa). `.board-attachments`
      é `display: contents` (a lista "anexos" segue na árvore a11y do Chromium).
      Artefatos/upgrades vão para a fileira externa (abaixo no jogador, acima no
      oponente), a 0,6× da criatura, lean 24°, parando antes do notch central de
      200px. Sem anexo a fileira mede 0.
    - **Upgrades (H3D-17):** ocupam a célula do hospedeiro (`--col`, `--up` = k-ésimo), tile
      deslocada para a borda externa (`top`, 44px jogador / 52 oponente) e recortada na
      faixa externa por `clip-path` NA TILE (folha — entre plano e peça continua proibido):
      a ordem de profundidade de planos paralelos varia com o viewport. O clique no centro
      cai no hospedeiro (por desenho); o probe mira a tira. Órfão = artefato.
    - **Pose (H3D-16) e indicadores (H3D-18):** `cardJitter(id)` puro em `lib/fx.ts` →
      `--jr` (giro, aplicado na `.card-art`, NUNCA no tile: rotate z no tile quebra o
      hit-test) e `--jy` (na translate da PEÇA, não do tile). O `::after` da peça é o arco
      "pronta" OU a ficha de stun; só opacity/scale animam (`ready-breathe` tem de ficar
      `animation: none` no 3D, também com animações ligadas).

## Verification gates (rode antes de commitar mudança relevante)

1. `npm run build` — tipos + bundle (obrigatório sempre)
2. `npm run e2e:floor` — se tocou tipografia/layout (2D)
3. `npm run e2e:capture` + olhar `e2e/shots/current` contra `e2e/shots/baseline` —
   se tocou visual (espera-se diferença intencional; diferença acidental é regressão)
4. `npm run e2e:smoke` — se tocou o board/partida
5. `npm run e2e:acceptance` — fechamento (piso 2D + piso visual 3D + bundle + bloco)
6. Mudou a mesa 3D? `e2e:capture:3d`, `e2e:floor:3d`, `e2e:smoke:3d`,
   `node e2e/probes/_3d-chain.mjs`, `_3d-hit.mjs`, `_3d-fx.mjs` e
   `e2e:record:3d` (frames em `e2e/clips/frames-3d`).
   Para o 2D pixel-idêntico, o `e2e:capture` oficial sorteia a mão demo a cada
   rodada (o `game.png` nunca bate entre duas execuções); o gate determinístico é
   a ferramenta local `e2e/shots/_2d-freeze.mjs` (save fixo + `_png-diff.mjs`),
   que compara o board 2D antes/depois de um diff de CSS.

## Pontos de atenção conhecidos (pós-passada de polish, ver `docs/POLISH_REPORT.md`)

- Resolvidos: Back/Next do config (dock sticky), chip de idioma a 768 (rótulos do header
  só ≥1041px), H1 do hero (fs-3xl/display), keys voltam a mostrar "n/3".
- Abaixo de 1041px o inspetor de carta é um bottom sheet (`.inspector-section--docked`).
  Entradas animadas usam `fill-mode: backwards` — `both` deixa transform residual e
  quebra filhos `position: fixed`.
- Toggle de animações = classe `reduce-motion` no `<html>` (alcança portais no body).
- Tokens: `--faint` (texto terciário AA), `--radius-*`, `--ease-out`, `--tabbar-h`.
- Erros do Master Vault são `VaultError` (chave `vault.*`), texto via `vaultErrorText(e, t)`.
- Em aberto: sombras ainda ad-hoc; emblemas de casas novas caem em iniciais; a 1280×800
  a mão começa perto da dobra (lanes com min-height para não pular).
- Imagens de carta LOCALIZADAS: o S3 oficial tem **9 idiomas** (en, pt, es, fr,
  de, it, pl, zh-hans, zh-hant) para os sets 341-600 (era FFG); GR (700) mantém pt;
  Æmber Skies (800+) é en/fr/de/zh. URL: `media/card_front/{lang}/{id}_{lang}.png`
  (id vem do `front_image` da API, trocando o sufixo de idioma). Pendente: rewrite
  client-side pt→EN-fallback no CardArt (~0,3-0,5 kB). Sem CORS (BUG2-05) e sem
  listagem do bucket. Pesquisa completa: `docs/RESEARCH_CARD_IMAGES_S3.md`.
- Mesa 3D, limites conhecidos (medidos nos probes): (a) com a lane cheia a carta de
  pé avança ~30px acima da própria caixa e cobre parte do texto do `zone-heading`
  (o do oponente fica ~8px atrás no desktop) — fechar isso com padding na lane
  exigiria somar altura à mesa e o desconto na margem puxava o `player-band` por
  cima das cartas (o hit-test caía para 50%), então ficou documentado; (b) o
  `--depth-k` do oponente não é load-bearing hoje (a pose billboard das cartas já
  mantém o texto acima do piso visual) — o teste do teste do `e2e:floor:3d` usa o
  stressor que remove o billboard/contra-tilt; (c) Firefox/WebKit dos probes
  dependem do binário do `playwright-core` (ausente na máquina de referência:
  `_3d-hit` PULA com aviso; Safari iOS é verificação manual).

## Conventions

- Comments explain *why* only. Commits no padrão `feat|fix|perf(css): escopo - descrição`,
  um commit coeso por mudança.
- Errors from the Master Vault API go through `describeFailure()` in `keyforgeApi.ts`.
- Storage failures are swallowed on purpose. Keep that property.
- Audio unlocked from a user gesture (`sound.unlock()` on first `pointerdown`).
- Repo git próprio do projeto (41+ commits desde o baseline); sem remote — nunca push.
