# Code Review — Aember Arena (keyforge-browser)

Reviewed at commit-state of the extracted `keyforge-browser-game-development.zip`
(2026-09-26). Every finding below is backed by a command run or a file/line read during
this review. Severity is about **impact on the user's stated goals** (responsiveness,
adaptive typography, mobile-first), not general code style.

## Verification performed

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | **FAIL** — 2 × `TS6133` in `src/App.tsx` (`CardFace` :47, `CardLightbox` :58) |
| Production build | `npx vite build` | PASS — `dist/index.html` 411,08 kB / 118,86 kB gzip, 3,6 s |
| Knowledge graph | `graphify update .` | 346 nodes, 589 edges, 20 communities, 0 import cycles, 0 API cost |

The build passing while the type check fails is the single most important process
finding: `vite build` uses esbuild, which strips types without checking them, and
`package.json` has no `typecheck` script and no CI. Nothing in this repo has ever
enforced types.

---

## P0 — Breaks the product on phones

### 1. Every text input is 10–11 px, so iOS zooms the page on focus

`src/index.css:1969` — `.deck-input-row input { font-size: 10px; }`
`src/index.css:3685` — `.browse-search input { font-size: 11px; }`
`src/index.css:3982` — `.filter-search input { font-size: 11px; }`

Safari on iOS auto-zooms to the focused field whenever the computed `font-size` is below
16 px, and the user must pinch back out. All three of the app's text fields are affected,
including the deck-UUID import box — the only way to load a real Master Vault deck by hand.
Compounding it, `src/index.css:29-41` sets `min-width: 320px` on both `html` and `body`,
so the zoomed view cannot even reflow.

### 2. `viewport-fit=cover` is missing, so the safe-area padding is dead code

`index.html:5` — `<meta name="viewport" content="width=device-width, initial-scale=1.0" />`

`src/index.css:2983` uses `padding: ... calc(11px + env(safe-area-inset-bottom, 0px))` on
the mobile tab bar. Without `viewport-fit=cover`, `env(safe-area-inset-*)` resolves to `0`
on every iOS device. The bottom tab bar sits under the home indicator in standalone
(`display: standalone`) mode — which is exactly the mode `apple-mobile-web-app-capable`
advertises.

### 3. The mobile breakpoint makes the typography *worse*, not better

Inside `@media (max-width: 700px)` (lines 4455–5178) there are still **29** declarations
below 10 px, including `font-size: 5px` at lines 4904 and 5207, and `6px` at 4808, 4845,
4877, 4898, 4939, 5008. Outside that block, **90** more sub-10 px declarations apply
unchanged on mobile.

Full distribution across the file: `5px`×2, `6px`×10, `7px`×30, `8px`×39, `9px`×38,
`10px`×27 — **163 declarations under 10 px**, against only 5 `clamp()` usages for font
size in 5,237 lines. On a 390 px phone these are not "small", they are illegible, and card
captions in the hand fan are among them.

### 4. Card images have no intrinsic size, so every tile reflows on load

`src/components/CardArt.tsx:27-33` — the `<img>` sets `loading="lazy"` but no `width`,
no `height`, no `aspect-ratio`, and no `decoding="async"`.

Card art is remote (`mastervault-storage-prod.s3.amazonaws.com`, see
`src/lib/keyforgeApi.ts:41`), so it is never in the first paint. Every hand fan, board
lane, deck tile and inspector grid therefore reflows as images arrive. This is the main
source of the "feels sluggish" impression, and it is measured as Cumulative Layout Shift.

### 5. The card-zoom preview is mouse-only

`src/components/CardArt.tsx:133-135` — `CardArt` binds `onMouseEnter` / `onMouseMove` /
`onMouseLeave` only. There is no `onPointerEnter` / focus / long-press path.

On a touch device the primary way to inspect a card's full text simply does not exist.
Compounding it, `CardLightbox` (`src/components/CardArt.tsx:169-232`) — the component
that *would* be the touch answer — is fully implemented, correctly portalled, and
**never rendered anywhere**. That is also the cause of finding #1's unused-symbol error.

---

## P1 — Responsiveness and perceived performance

### 6. `App()` re-renders the entire tree on every state change

`src/App.tsx:1003-1571`. 26 `useState` hooks in one component, **zero** `memo`, **zero**
`useCallback` across the file (confirmed: `useCallback` count is 0; only 3 `useMemo` and
6 `useRef`).

The AI turn loop alone (`src/App.tsx:1150-1160`) calls `setGame` up to **9 times** per
turn with 340–460 ms gaps, and each call re-renders the header, the board, every
`CardTile`, and the whole command rail. Every `CardArt` child re-runs its effects. Human
selection does the same. This is why the game feels heavier than a 36-card game should.

The graphify run quantifies it: `App()` is the **top god node with 32 edges**, and every
community's cohesion score sits between 0.07 and 0.21 — there are no real module
boundaries, just one hub.

### 7. Hover zoom thrashes timers and forces layout on every mouse move

`src/components/CardArt.tsx:113-119` — `scheduleZoom` does `clearTimeout` + `setTimeout`
(120 ms). `src/components/CardArt.tsx:134` calls `scheduleZoom` on **every `mousemove`**
while the preview is not yet placed. So a pointer crossing a card fires dozens of
timer resets, then one `getBoundingClientRect()` (forced synchronous layout) at the end.

### 8. IndexedDB opens a fresh connection per deck, and leaks it on failure

`src/lib/cache.ts:12-28` — `openDatabase()` is called by `cacheDeck`, `listCachedDecks`
and `getCachedDeck` every time; there is no connection cache.

Worst case is `src/lib/keyforgeApi.ts:175`:
`void Promise.all(decks.map((deck) => cacheDeck(deck)))` — a 9-deck browse page fires
**9 concurrent `indexedDB.open()` calls**, each with its own transaction writing ~36
cards. On a mid-range phone that is a visible stall.

Worse, in `cacheDeck` (`src/lib/cache.ts:34-55`) `database.close()` sits inside the `try`
after the awaited transaction. If that promise rejects, control jumps to `catch` and
`close()` never runs — the connection is leaked. `listCachedDecks` and `getCachedDeck`
have the same shape.

### 9. Audio context is resumed on every single sound effect

`src/lib/sound.ts:112-115` — `play()` calls `ensureContext()` on every invocation, and
`ensureContext` (lines 47-50) fires `void this.context.resume()` whenever state is
`suspended`. `play("click")` is wired to essentially every navigation action in
`App.tsx`. There is also no throttle, so a fast click stream stacks oscillators.

`setPrefs` is additionally called from a `useEffect` keyed on `[settings, screen]`
(`src/App.tsx:1040-1043`), so simply changing screen restarts or stops the music bed.

### 10. The service worker art cache is unbounded and has no quota handling

`public/sw.js:76-88` — every cross-origin card image is cached `ART_CACHE` first, with no
size cap, no eviction, and no `QuotaExceededError` handling. Browsing the Master Vault
grows it without limit until the browser evicts it silently.

### 11. `vh` units on panels that are visible on mobile

`src/index.css:1136` — `max-height: calc(100vh - 92px)`, plus `min(90vh, 820px)` at 1678.
`vh` is the *large* viewport on mobile, so these panels jump when the browser chrome
collapses. Only one `dvh` usage exists in the file (`src/index.css:5132`).

---

## P2 — Cost and dead weight

### 12. Tailwind v4 ships in the single-file bundle and is never used

`package.json:19-20` pulls in `tailwindcss` + `@tailwindcss/vite`; `vite.config.ts:13`
registers the plugin; `src/index.css:1` is `@import "tailwindcss"`. But of the **270
distinct class names** used in the app, **0 are Tailwind utilities** — every one is a
custom BEM class.

So the inlined single file carries Tailwind's preflight and the utility engine for
nothing. `src/utils/cn.ts` (clsx + twMerge) is dead for the same reason.

### 13. `index.css` is 5,237 lines with no `@layer`, no tokens beyond `:root` colours

All five `@media` blocks sit at lines 4375–5229, after ~4375 lines of desktop defaults.
The stylesheet is effectively unmaintainable in its current form: no cascade layers, no
spacing scale, no type scale — just 270 hand-tuned selectors with pixel font sizes.

### 14. Graphify blind spot worth knowing

The graphify AST pass skipped `src/index.css` (unsupported extension), so the 5,237-line
stylesheet — 56 % of the source by volume and the *entire* subject of the
responsiveness complaint — is invisible to the knowledge graph. Every graph-derived
conclusion in this review is about the TypeScript only.

---

## What is genuinely good

Worth protecting during any refactor:

- `lib/game.ts` and `lib/ai.ts` are **pure and immutable**. `applyMove` / `endTurn` return
  new state. This is the only part of the codebase that is genuinely testable, and it is
  the part a future test suite should target first.
- Storage and audio failures are swallowed **on purpose** so a match stays playable in
  private-browsing or quota-exhausted conditions. That is a deliberate resilience
  property, not sloppiness — do not "fix" it by surfacing errors.
- `sound.ts` synthesises all audio in Web Audio, which is what lets the whole app be one
  file with no assets. Good constraint, honour it.
- There are **no import cycles** (graphify confirmed), and the layering is clean:
  `components/` → `lib/` → nothing.
- The `AbortController` + timeout wrapper in `keyforgeApi.ts:110-114` is correct, and
  `describeFailure` gives the user real messages instead of "fetch failed".
- `prefers-reduced-motion` is honoured both in CSS and via a `.reduce-motion` class driven
  by a user setting.

## Suggested order of attack

P0 items 1–3 are pure CSS plus one line in `index.html` and fix the majority of what a
phone user experiences. Items 4 and 5 are the perceived-performance items. Item 6 is the
architectural one that makes everything else harder, so it should be sequenced deliberately
rather than folded in — see `docs/WORKFLOW.md` for the phased plan.
