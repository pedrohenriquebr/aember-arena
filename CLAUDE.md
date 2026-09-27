# Aember Arena — KeyForge Solo Play

Offline-first PWA that lets a player import a real KeyForge Master Vault deck, play a
solo match against a configurable local AI, and keep working with no connection.
Shipped as **one self-contained `index.html`** (JS + CSS inlined by
`vite-plugin-singlefile`), so it can be opened from disk, emailed, or dropped on any
static host with no server.

**Estado atual (pós-refactor mobile-first, 40+ commits, set 2026):** escala tipográfica
fluida por tokens, cascata mobile-first invertida, interação touch real, Tailwind
removido, harness de regressão visual em `e2e/`. Este arquivo descreve o estado ATUAL —
não o histórico (isso está em `docs/CODE_REVIEW.md` e `docs/WORKFLOW.md`).

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
npm run e2e:floor      # piso tipográfico medido a 360px (exit != 0 se violado)
npm run e2e:smoke      # inicia a partida demo e passa 2 turnos, headless
npm run e2e:bundle     # imprime gzipKB do dist/index.html
npm run e2e:acceptance # piso + bundle + tamanho do bloco 700px em um gate
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
7. **Orçamento de bundle:** gzip do `dist/index.html` ≤ **121.5 kB** (baseline pós-refactor
   ≈ 118.4 kB). Confira com `npm run e2e:bundle`.
8. Áudio permanece 100% sintetizado (Web Audio); animações respeitam
   `prefers-reduced-motion` E `settings.animations` (classe `no-anim`).
9. Alvos de toque ≥ 44px em controles primários; `<html lang>` segue `settings.language`.

## Verification gates (rode antes de commitar mudança relevante)

1. `npm run build` — tipos + bundle (obrigatório sempre)
2. `npm run e2e:floor` — se tocou tipografia/layout
3. `npm run e2e:capture` + olhar `e2e/shots/current` contra `e2e/shots/baseline` —
   se tocou visual (espera-se diferença intencional; diferença acidental é regressão)
4. `npm run e2e:smoke` — se tocou o board/partida
5. `npm run e2e:acceptance` — fechamento

## Pontos de atenção conhecidos (herdados da última passada)

- config 360×800: descrições de dificuldade quebram 2 linhas e empurram Back/Next
  para fora da dobra.
- 768×1024: chip de idioma corta na borda direita do header.
- H1 serif do hero renderiza menor em 360px que em viewports maiores.
- Contador de keys e badge de turno são ícone-only (texto virou `aria-label` na fase
  de cartas) — decisão aberta se o texto "/ 3 KEYS" deve voltar visível.

## Conventions

- Comments explain *why* only. Commits no padrão `feat|fix|perf(css): escopo - descrição`,
  um commit coeso por mudança.
- Errors from the Master Vault API go through `describeFailure()` in `keyforgeApi.ts`.
- Storage failures are swallowed on purpose. Keep that property.
- Audio unlocked from a user gesture (`sound.unlock()` on first `pointerdown`).
- Repo git próprio do projeto (41+ commits desde o baseline); sem remote — nunca push.
