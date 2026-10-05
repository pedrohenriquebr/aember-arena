# Aember Arena — KeyForge Solo Play

Offline-first PWA that lets a player import a real KeyForge Master Vault deck, play a
solo match against a configurable local AI, and keep working with no connection.
Shipped as **one self-contained `index.html`** (JS + CSS inlined by
`vite-plugin-singlefile`), so it can be opened from disk, emailed, or dropped on any
static host with no server.

**Estado atual (05/out, ~315 commits):** Mobile-first + palco de viewport (UX-FIT
FIT-01..08), animações estilo Arena (3 ondas), áudio procedural (14 timbres),
tutorial, modo 3D da mesa (12 histórias + punch list), **motor de abilities
declarativas (ondas 1-4 + DSL v12, ondas 2-3)** — efeitos persistentes, "you may",
reações, purge/sacrifice/tokens/exalt, ward/enrage/enhanced/take-control/forja/
instead, quantidade dinâmica (`per`/`did`/`gone`/`slain`/`healed`/`housesOf`/
`sub`/`div`), condições (`act.if`, haunted, `myTurn`, `count op`), filtros por
casa/traço/exausta/contadores/âmbar/poder relativo, `keyCost`, act `move` (zonas
com `top`/`bottom`/`random`/`all`/`moved`/`revealed` + `side:"opponent"|"any"`),
gatilho `scrap` + **gatilho `discard`/`house`**, observadores
(`Ability.of`+`"event"`, orçados por movimento), `use.via`+`use {asYours}`,
contadores (+`removeCounter`), splash, `versatile`, **`partial` para Fate**,
**Entrench** (`hold`/`noReady`), `who` (dono/controlador dinâmico), `capture.own`,
`moveAmber`, **escolha de casa (`move.house`/`forceHouse`), gatilho `house`,
casa concedida (`houseOf`), `forged`/`forgeKey.less`, imunidades
(`prevent`/`noSteal`), **mayPlay**, **restrict.action:"reap"**,
**fightDamageCap (atacante E defensor)**, **Replacement.when
("attacking"/"defending")**, **peek privado + reveal público com ctx**
(`s:"revealed"`)**, **entersPlayReady**, **heal "all"**, **damage divide/upTo**
**— ondas em `docs/DSL_EXPANSION_PLAN.md` (ondas 1-3), `_WAVE2.md` (Lotes 4-5),
`_WAVE3.md` (Lotes 6-12, incl. §Lote 11/12)** — cobertura do parser sobre o
**corpus 4.809 (MV+keyteki)**: full **~1.800 + 276 partial**. **Catálogo
dinâmico completo** (DB v4, sync MV, BYOK com headers extras JSON, pipeline LLM
com validação tripla + harvest concorrente (`--concurrency`, saves serializados)
+ fila de tradução/revisão in-game (CAT-3) + importação da fila do harvest
(CAT-3.5, `--export-queue`); ETL keyteki (`npm run keyteki:cards` + `merge:cards`
→ corpus 4.809 local); proxy local do dono via `scripts/llm-cors-relay.mjs` +
`npm run relay:go` (tier OpenCode Go). Specs: 750+ (Lote 14). Este arquivo
descreve o estado ATUAL — histórico em `docs/` (CODE_REVIEW, WORKFLOW,
MECHANICS_REPORT, ROADMAP_REVIEW, GAME_ROADMAP, UX_FIT_PLAN, VIEW3D_*,
DYNAMIC_CATALOG_PLAN).

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

## Motor de abilities (ondas 1-4 + onda 2 da DSL — leia antes de mexer em regras)

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
- **Keyteki como fonte de DSL (pesquisa 05/out)**: `docs/KEYTEKI_DSL_RESEARCH.md` (Opus low) e
  `_SONNET.md` (Sonnet medium, independente) mediram o sistema de habilidades do keyteki
  (2.606 arquivos JS, 101 classes de GameAction, 127 helpers usados). Veredito: conversor
  AST keyteki→DSL (2-4 semanas, sem LLM) gera ~80% das 2.426 cartas que o keyteki
  implementa (~1.900-1.950 full), cobrindo 46% do corpus MV; híbrido com farm LLM para os
  sets que o keyteki não cobre (MoMu/VM25/CC/ToC). Top gaps da nossa DSL vs keyteki:
  interrupt/replace genérico de eventos, modos de alvo (select/house/card-name/trait),
  search+reveal públicos, until declarativo.
- **Conversor keyteki→AST (híbrido aprovado, `docs/KEYTEKI_CONVERSION_PLAN.md`)**: M1
  (parse acorn + lambdas + lower IR→DSL, join por texto exato), F0 (source `keyteki`
  nunca vira regra sem review), lane M (`classify.mjs` classifica lambdas via LLM no
  relay, retomável), M2 (lambda-map + famílias de tabela no lower) e M3 (golden **97,6%**
  — 283/290 agree, 16 DIFFs triados, 0 gap de DSL; `--export-queue` gera 73 drafts
  keyteki válidos em `scripts/harvest/`). Correções de jogo no caminho: `optional` do
  keyteki propaga para os atos (Legate Scipio), conjunção "and enrage/stun it" herda o
  alvo da 1ª cláusula (Pestering Blow/Subdue). Full efetivo do corpus: 1.826 → **1.899**
  faces (+73). Pendente: dono revisar as 73 na tela de revisão → leva T2 vendorizada
  (recomendação: chave `textHash|type`, 51 pares distintos); M4 = cauda (541 C-layer,
  1.745 unsupported). Testes do conversor rodam via **vitest**; CLI via **vite-node**.
- **Versão e orçamentos (ondas 2-3)**: `DSL_VERSION` (hoje 13 — Lote 14: `skipForgeStep` one-shot no passo de chave/Miasma, `attackKeywords`+`whenAttacking` estado de luta/Spyyyder, arquivo de vizinhos + casas compartilhadas do conjunto movido/Code Monkey; PARSER_VERSION 15) — linha com `v` maior é
  descartada, e falha com `v` menor é re-enfileirada (contrato de versionamento,
  `docs/DSL_EXPANSION_PLAN.md`); falhas `reply:` e transporte usam `tries` com tetos
  (3 e 5); `did`/`gone` são medidos pós-sweep (side capturado antes de sair de jogo);
  orçamentos por movimento (`OBSERVER_BUDGET`, `FIRE_BUDGET`, `OBSERVER_DEPTH`) e
  recheck de watcher vivo evitam laço de observador/`use.via`; `houseOf` tem guarda
  própria. Entrench = `hold` (preferência do controlador via `setHold`, fora de
  GameMove) + `canReady`; efeitos `noReady` bloqueiam pelo mesmo `canReady`.
  RunTranslation tem pool de concorrência (`--concurrency`/HARVEST_CONCURRENCY,
  saves serializados em cadeia, flush no abort).
- **Cobertura do catálogo**: full ~1.864/4.809 (38,8%) + partial no corpus
  MV+keyteki (`npm run merge:cards`), crashes 0 (medições pós-v13). Pendente (cortes de
  `docs/DSL_EXPANSION_PLAN_WAVE3.md` + `docs/WAVE4_BACKLOG.md`): "any number"/
  "up to N" (pede `GameMove.targets[]`), look/reveal/search de zonas ocultas,
  Fate/Prophecy completo, cor de chave, Tide/Treachery/Invulnerable.

## Direções de futuro (anotadas, sem design ainda)

- **Multiplayer com backend/API**: o dono pretende adicionar partida multiplayer com
  backend próprio — impacta o single-file (API same-origin mata CORS de terceiros),
  o modo solo vs remote, e a arte (servida pelo backend). Anotado; plano separado
  quando entrar na pauta.
- **Empacotamento desktop via Tauri** (primeira opção leve): envolve o single-file
  como webview, filesystem próprio para arte offline (pacote WebP extraído numa pasta
  do usuário, sem quota de navegador), e atualização via pacote. Plano:
  `docs/ART_OFFLINE_PLAN.md` (ajustado para Tauri).

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
7. **Tamanho de bundle:** INFORMATIVO desde 02/out/2026 (decisão do dono: features
   valem mais que bytes — o número é telemetria, não gate; histórico abaixo).
   Histórico de
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
   → **155** (onda 1 do catálogo dinâmico, `docs/DYNAMIC_CATALOG_PLAN.md`
   §1/§2/§3/§5: DB v4 com os stores `cards` (face + `textHash` + `syncedAt`) e
   `abilities` (DSL por carta com `source`/`reviewed`, pronto para a onda 2),
   sync incremental paginado com cursor persistido e cancelamento (só cartas
   novas ou com texto mudado entram), `rulesOf` lendo o store antes do parser
   (mapa carregado no boot, memo WeakMap invalidado quando os overrides chegam)
   e o chip "catálogo: N cartas" na Home/Vault + seção Catálogo no card do Review
   (um 7º pill não cabia com rótulo no stepper). Só
   TS/CSS, zero dependência; baseline real 152,26 kB e o fechamento mediu
   **153,80 kB** gz — teto revisado de 153 para 155, a ÚNICA revisão autorizada
   pelo pedido da onda. Varredura de identificadores CSS novos: 0 removível
   (`.catalog-row` e `.deck-list-meta` são usados; o resto é classe existente).)
   → **153** (lote A3 "o espetáculo", `docs/VIEW3D_ARENA_LAYOUT.md` §4 H3D-19..21:
   avatares centrais + dorsos do Warden, investida/impacto e mesa-ambiente. Só
   CSS/TS, zero dependência; baseline real 150,79 kB (o 148,39 citado no pedido era
   anterior ao ritmo da IA). Teto ÚNICO deste lote — acima de 153: parar. Varredura
   de mortos pré-revisão (`_dead-css`): 0 removível (só nomes dinâmicos).)
   → **157** (onda 2 do catálogo dinâmico, `docs/DYNAMIC_CATALOG_PLAN.md` §4/§5:
   parserVersion + overrides só entre partidas, BYOK na Config, pipeline LLM
   (`catalogLlm.ts`, schema gerado em `generated/dslSchema.ts`) e harvest. Baseline
   154,63; mediu **156,31 kB** (BYOK +1,26; o pipeline só entra no bundle quando a UI
   o importa). A fila de revisão (UI) NÃO coube: com ela o bundle vai a 163,61 kB
   (+7,3) e ficou na branch `wip/catalog-queue-ui`. Teto 157, a ÚNICA revisão desta
   onda — acima: parar.)
   → **162** (CAT-3, `npm run harvest`/docs do proxy: a fila de tradução in-game +
   revisão entrou pela primeira vez e traz o pipeline `catalogLlm` inteiro para o
   bundle. Baseline 156,31; mediu **161,76 kB** (+5,45: pipeline/schema/few-shots
   ~+4, UI/i18n/CSS ~+1,5). Teto 162, revisão ÚNICA do CAT-3 — acima: parar.)
   → **164** (DSL lote 1, `docs/DSL_EXPANSION_PLAN.md` §Lote 1: normalise dos glifos
   do MV com `textHash` congelado, `DSL_VERSION 2` com whitelists, grafias novas,
   snapshot dos `if` no `fire()`, dry-run rico. Baseline 161,77; mediu **162,67**
   (+0,90; a troca Sets→tabela `ACTS` do plano CUSTOU +78 — gzip comprime repetição
   de graça). Teto 164, revisão ÚNICA do lote — acima: parar.)
   → **167** (DSL lote 2, `docs/DSL_EXPANSION_PLAN.md` §Lote 2: `per`/`Count`,
   `act.if` (did/gone), filtros casa/traço/exausta, `keyCost` com guarda
   anti-recursão, `Selection.pick`/`"fought"`, act `move`, gatilho `scrap`.
   Baseline 162,67; mediu **166,44** (+3,77, o dobro do estimado; cortar os
   few-shots só chegaria a 166,03 — corte destrói entregável). Teto 167,
   revisão ÚNICA do lote — acima: parar.)
   → **TETO APOSENTADO** (decisão do dono, 02/out/2026): o tamanho do bundle deixou
   de ser gate — o acceptance mede o gzip só como telemetria informativa; features
   valem mais que bytes. Lotes seguintes da DSL e qualquer feature NÃO param mais
   por tamanho e não geram mais chore de teto; `maxGzipKb` segue só como referência
   do histórico (167).
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
    - **Avatares e dorsos (H3D-19, >= 701px):** o `.player-avatar` é ABSOLUTO no eixo (50%)
      do band (flex preservado), 56/64px = altura da faixa + 12px de invasão, e o band fica
      `overflow: visible`; Æmber (`--fs-2xl`) e `.hand-backs` ancoram nele. `.hand-backs` existe
      no DOM sempre (`display: none` fora do 3D) e o `captureFx` mede o último dorso quando
      visível. No band do jogador o selo da casa e o título "YOUR HAND" saem no 3D (largura).
    - **Investida (H3D-20):** só com `.game-board--3d` + movimento: `captureLunge` (FxLayer) mede
      ANTES do commit; o diretor anima a `translate` individual da `.board-piece` (WAAPI 460ms,
      nunca `rotate`), o `.fx-burst` nasce a 45% e o `fx-dmg` do defensor 60ms depois, a 35% da
      altura. Timers/WAAPI vivem no `Run` e morrem no `cancelAll`. Probe: `_3d-lunge.mjs`.

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
- **Importação de deck por id**: gravar SEMPRE com `saved: true` (cacheDeck) — sem o flag o
  deck some da biblioteca ao recarregar (só `saved:true` volta em listCachedDecks), e
  `cacheDeck` preserva `saved`/`favorite` já existentes na regravação (não rebaixar).
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
