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
`npm run relay:go` (tier OpenCode Go). Specs: 876+ (07/out).

**Lotes 15a/15b FECHADOS (05/out noite, commits 74f8107/a541906/0a5da70/04a525e, mimo-v2.6-pro):**
  15a = then-chains (DSL v14 `Act.then`, Selection "moved", Ctx.chain; parser v16; canon do join +106 linhas
  grátis, noTextMatch 71→13; stub M2 fechado). 15b = target-select (DSL v15 `Filter.mostStat`/`lowest`,
  pick upTo/exactly/house, casa escolhida REUSADA do Lote 5; parser v17 mostStat/lowest/carryCond; 34 specs
  dsl16) + triagem dos 15 DIFFs (10 = `alwaysTriggers` do keyteki é ANTI-GATE: ThenAbility dispara no vácuo —
  lower emite follow-up sem gate; 1 parser "non-Star Alliance"; 3 equivalentes; 1 documentado).
  **converted 221→330, golden agree 371→447, 0 diff sem triagem.** Semântica em aberto p/ o dono: "Then,
  you may X" do parser segue com gate (case vácuo não oferece X) enquanto o keyteki nunca gateia — o
  comportamento de referência está specado no lado do conversor (Key Abduction). Pendente: noTextMatch 15
  (faces lowered sem face no corpus), Festering Touch (replacement por alvo fora do vocabulário).

  **15c/15d também FECHADOS (06/out, commits 7982002/940ca55 + ae0b213/f38f1b6):** 15c = pacote de tabelas
  (20 entradas no lambda-map de amounts dinâmicos, 5 gatilhos na triggers.json, archive/unstun/moveAmber,
  exactly-1 → alvo singular; parser v18 zonas/gatilho de casa própria). 15d = durações (DSL v16
  `duration:"nextTurn"`, **fix de motor: `self` em efeito lasting guardado era no-op — sourceId congelado**;
  parser v19 "during your next turn"; 6 ações keyteki → lasting). converted 221→**383**, golden 371→**476**,
  847 specs, 0 diff sem triagem. 15e TAMBÉM FECHADO (ba4b0ae/b2da28e): who "any" (sow-salt virou AGREE), takeControl efeito
  durável, lasting com gatilho (Crystal Hive), before-window. converted 221→**393**, golden 371→**480**,
  862 specs. 15f TAMBÉM FECHADO (4eba275/f452f2f/fa8aa6f, parser v22): gain-ability foi CONVERSOR/PARSER
  como previsto — parseGrant combo keyword+ability, "another X", archives nos corpos concedidos;
  equivalentEffects funde escritas e descarta undefined (fix killzord). converted 221→**432**, golden
  371→**531**, 872 specs, rows 704, newlyCovered 148. Os 5 grandes clusters do M4 FECHADOS (15a-f).
  Fora com motivo: beforeX genérico sem print, fires-once (Blypyp) sem modelo, gainAbility de
  persistentEffect (efeito concedido = outro lote), "instead" dentro de grant (changeEvent).

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
npm run build          # tsc --noEmit && vite build + inject-sw-version (gate: tipos + bundle)
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
node e2e/sw-reset.mjs  # PWA: BUILD_ID registrado, repro do SW envenenado, ?swreset=1,
                       # update via toast FEAT-09 (requer `npm run build` antes)
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
- **Service worker curado**: dev não registra SW, `sw.js` é versionado por build
  (`?swreset=1` é o escape hatch) e build novo dispara o toast FEAT-09
  (`node e2e/sw-reset.mjs`).
- **Fallback por `textHash` no storedAbility**: os ids do Master Vault divergem dos
  ids do corpus ETL nos sets novos, então, quando o id não acha, a linha cujo
  `textHash` é igual ao texto da carta aplica (texto igual = regra igual; carta sem
  texto nunca cai no fallback — o teste dsl3 do laço de observers cobre).
- **Decks do dono**: os 2 decks próprios estão 100% cobertos; o que faltava eram
  rascunhos nunca revisados (checar `drafts.json` antes de farmar).
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
  faces (+73). T2 CONCLUÍDA: revisão delegada ao script review-auto (4 gates) e vendorizada — hoje são 148 linhas vivas em src/lib/generated/keyteki.json (50befa4), entram no boot sem clique. Ruling do "Then" APLICADO (4f69697): "Then, you may X" impresso fica SEM
  gate (sempre ofertado — Key Abduction no vácuo; keyteki alwaysTriggers); "If you do" e Then obrigatório
  mantêm o gate de did (Art Project, Malison). Caso latente documentado: Key Drain ("You may discard…
  Then, forge") morre com predecessor resolvido-vazio — decidir quando a gramática cobrir
  (recomendação: chave `textHash|type`, 51 pares distintos); M4 = cauda (541 C-layer,
  1.745 unsupported). Testes do conversor rodam via **vitest**; CLI via **vite-node**.
- **Versão e orçamentos (ondas 2-3)**: `DSL_VERSION` (hoje 17 — Lote 15f não mudou motor (gainAbility → effect.abilities que já existia); Lote 15e: `Restrict.who "any"`, `control`/`controlCards` duráveis (takeControl como efeito, devolve na expiração), observador temporário de lasting com gatilho, janela beforeFight; Lote 15d: `duration: "nextTurn"` no lasting, `sourceId` congelado em efeito guardado (self resolvia como no-op); Lote 15b: `Filter.mostStat`/`lowest`, pick `upTo`/`exactly`/`house`, casa escolhida reusada do Lote 5; Lote 14: `skipForgeStep` one-shot no passo de chave/Miasma, `attackKeywords`+`whenAttacking` estado de luta/Spyyyder, arquivo de vizinhos + casas compartilhadas do conjunto movido/Code Monkey); `PARSER_VERSION` (hoje 22 — grafias Then/If-you-do/anáforas, mostStat/lowest, durações, who any, gain-ability combo/another/archives) — linha com `v` maior é
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

A versão pública atual é — e enquanto estas direções não tiverem design, continua
sendo — **solo contra a IA, offline, sem contas e sem monetização**.

- **Backend próprio para cache de arte e APIs** (anotado em 01/nov): um backend
  intermediário poderia servir/cache a arte das cartas e abrigar chamadas ao Master
  Vault (incluindo eventual chave de API, longe do bundle público). Sem design;
  depende de decisão de hospedagem.
- **Multiplayer com backend/API**: o dono pretende adicionar partida multiplayer com
  backend próprio — impacta o single-file (API same-origin mata CORS de terceiros),
  o modo solo vs remote, e a arte (servida pelo backend). Anotado; plano separado
  quando entrar na pauta.
- **Empacotamento desktop via Tauri** (primeira opção leve): envolve o single-file
  como webview, filesystem próprio para arte offline (pacote WebP extraído numa pasta
  do usuário, sem quota de navegador), e atualização via pacote. Plano:
  `docs/ART_OFFLINE_PLAN.md` (ajustado para Tauri). **Nota (01/nov): o plano de
  empacotar a arte offline ficou PAUSADO** — empacotar arte do Master Vault seria
  redistribuir conteúdo de terceiros; sem licença escrita dos detentores, a arte
  continua sendo carregada em tempo real do CDN.

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
7. **Tamanho de bundle:** INFORMATIVO (decisão do dono: features valem mais que
   bytes). `npm run e2e:bundle` mede o gzip como telemetria — não é gate, não
   bloqueia feature e não gera chore de teto.
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
- **Repo público:** <https://github.com/pedrohenriquebr/aember-arena> — `dev` é a
  branch de trabalho, `master` é o que o Pages publica (deploy por GitHub Actions,
  `.github/workflows/pages.yml`). Nunca force-push; PR `dev → master` sem squash.
- **Todo commit leva `[AI]` no assunto** (hook `.githooks/commit-msg`; ative com
  `git config core.hooksPath .githooks`). O commit baseline é a única exceção.
- Documentação interna de missões (`docs/advisor/`, `docs/references/`,
  `docs/ux-prints/`, `bench/`) fica fora do repositório público (gitignored).
