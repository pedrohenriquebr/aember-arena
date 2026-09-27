# Aember Arena — KeyForge Solo Play

Offline-first PWA that lets a player import a real KeyForge Master Vault deck, play a
solo match against a configurable local AI, and keep working with no connection.
Shipped as **one self-contained `index.html`** (JS + CSS inlined by
`vite-plugin-singlefile`), so it can be opened from disk, emailed, or dropped on any
static host with no server.

## Stack

- React 19 + TypeScript 5.9 (strict), Vite 7
- Tailwind CSS v4 is **installed and imported but not used** — see "Styling" below
- `lucide-react` for icons, `clsx` + `tailwind-merge` via `src/utils/cn.ts`
- Web Audio API synthesis for all SFX/music (no audio files)
- IndexedDB (`cache.ts`) with a localStorage fallback for offline deck storage
- Service worker (`public/sw.js`) for shell + card-art caching

## Commands

```bash
npm install
npm run dev        # vite dev server
npm run build      # -> dist/index.html (single file, ~409 kB / ~119 kB gzip)
npm run preview    # serve the built single file
```

There is **no** `test`, `lint`, or `typecheck` script. Because `vite build` strips types
without checking them, type errors ship silently — run `npx tsc --noEmit` by hand.
(As of this writing it reports 2 `TS6133` unused-symbol errors in `src/App.tsx`.)

## Layout

```
src/
  main.tsx                 10 lines - mounts <App/> in StrictMode
  App.tsx                1573 lines - ALL screens, all game state, all handlers
  index.css              5237 lines - the entire design system, hand-written BEM
  lib/
    game.ts       455 ln  rules engine: createMatch/applyMove/endTurn (pure, immutable)
    ai.ts         145 ln  house choice, move choice, minimax (pure)
    i18n.ts       551 ln  en + pt-BR dictionaries, createTranslator
    demoDeck.ts   395 ln  starter deck #1
    demoDeck2.ts   60 ln  starter deck #2
    houses.ts     126 ln  house color + label (the two most-called helpers)
    keyforgeApi.ts 199 ln Master Vault fetch + normalise
    cache.ts       96 ln  IndexedDB deck cache + localStorage fallback
    sound.ts      218 ln  SoundEngine class, Web Audio synthesis
    settings.ts    52 ln  AppSettings + localStorage
  components/
    CardArt.tsx     232 ln  card image, hover-zoom portal, CardLightbox (UNUSED)
    DeckInspector.tsx 274 ln deck detail screen
    DeckBrowser.tsx  172 ln paginated Master Vault search
    DeckTile.tsx      65 ln deck card in a grid
    Pagination.tsx    71 ln page control
    HouseIcon.tsx     54 ln inline SVG house emblems
  utils/cn.ts            6 ln clsx + twMerge
```

## Architecture in one paragraph

`App()` is a single god component. It owns 26 `useState` hooks, all navigation
(`Screen = "home" | "config" | "game" | "browse" | "inspect"`), the whole `GameState`,
and every mutation callback. Screens are plain inner functions of `App.tsx` that receive
dozens of props. The rules engine in `lib/game.ts` and the AI in `lib/ai.ts` are pure
and immutable — that is the good part, and the only part that is easy to test. There is
no state library, no data fetching library, and no test runner.

## Rules that must not be broken

1. **Never** remove `vite-plugin-singlefile` or switch to code-splitting. The single-file
   output is the product requirement (offline, file://, email-attached).
2. **Never** make `lib/game.ts` or `lib/ai.ts` impure or mutate `GameState` in place.
   `applyMove`/`endTurn` return new state; the AI depends on that.
3. The build must keep working **fully offline**. Do not add runtime CDN dependencies,
   web fonts, or remote assets that are not already precached in `public/sw.js`.
4. Preserve the two starter decks (`DEMO_DECK`, `DEMO_DECK_2`) — a first-run user with no
   network must still be able to start a match.
5. `houseColor` / `houseLabel` in `lib/houses.ts` are imported everywhere; keep their
   signatures stable.
6. All user-facing strings go through `i18n.ts` (`t("...")`). Adding a raw English string
   in a component breaks the pt-BR build.

## Styling: read this before touching CSS

`src/index.css` is a 5,237-line hand-written BEM stylesheet. `@import "tailwindcss"` is at
the top, but **zero Tailwind utility classes are used anywhere** — all 270 distinct
class names in the app are custom BEM classes. Tailwind currently contributes only
preflight and an unused utility engine to the inlined bundle. `src/utils/cn.ts` is
effectively dead.

The stylesheet is **desktop-first**: all five `@media` blocks live at the very bottom
(lines 4375–5229), cascading over ~4375 lines of desktop defaults. Breakpoints are
`1220px`, `1040px`, `700px`, `390px`, plus `prefers-reduced-motion`.

`font-size` is hardcoded in pixels almost everywhere: there are 120 declarations below
10px (down to 5px), and only 5 `clamp()` usages for font size in the whole file. The
smallest text is game state, not decoration — `.ready-label` and `.key-counter small` are
5px, `.active-turn-tag` is 6px. `index.html` lacks `viewport-fit=cover`, so the
`env(safe-area-inset-*)` in the CSS is inert on iOS.

## Conventions

- Comments explain *why* only; the codebase is otherwise sparsely commented.
- Errors from the Master Vault API are funnelled through `describeFailure()` in
  `keyforgeApi.ts` — extend that rather than throwing raw.
- Storage failures are swallowed on purpose (settings, cache) so a match always stays
  playable. Keep that property.
- Audio must be unlocked from a user gesture (`sound.unlock()` on first `pointerdown`).
