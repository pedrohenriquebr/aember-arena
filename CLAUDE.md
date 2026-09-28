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
7. **Orçamento de bundle:** gzip do `dist/index.html` ≤ **129,5 kB** (teto revisado em
   28/09 de 127,5 → 129,5 para o FEAT-12: o FEAT-12a — pilha de undo com os estados
   imutáveis do motor + botão "Desfazer" no rail — mediu 127,77 kB gz logo após a
   limpeza, e o FEAT-12b (replay passo a passo a partir do seed + lista de passos em
   memória) consome a folga restante; 129,5 kB é o teto máximo pré-autorizado, sem
   folga residual de propósito. A auditoria de código morto desta rodada (chaves
   i18n sem uso, exports nunca importados, classes CSS órfãs) não achou peso
   removível — o que sobra é tree-shaken. Revisões anteriores: 124 → 125 com
   `modulePreload: false` + mangle de toplevel + dicionário i18n compacto; 125 → 126
   com FEAT-05/08/10; 126 → 127,5 com FEAT-11/14/06).
   Nova folga só com justificativa explícita. Confira com `npm run e2e:bundle`.
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

## Conventions

- Comments explain *why* only. Commits no padrão `feat|fix|perf(css): escopo - descrição`,
  um commit coeso por mudança.
- Errors from the Master Vault API go through `describeFailure()` in `keyforgeApi.ts`.
- Storage failures are swallowed on purpose. Keep that property.
- Audio unlocked from a user gesture (`sound.unlock()` on first `pointerdown`).
- Repo git próprio do projeto (41+ commits desde o baseline); sem remote — nunca push.
