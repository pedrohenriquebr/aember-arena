# Plano do Executor — Aember Arena mobile-first (2026-09-26)

Plano em fases escrito pela sessão executora a partir do `docs/CODE_REVIEW.md`, **antes**
de ver a resposta do advisor. Cada fase tem: objetivo, tarefas, classificação
(`spike` / `bounded` / `architectural`), critério de saída e gate.

Invariantes que nenhuma fase quebra (de `CLAUDE.md` §Rules):
single-file build; `lib/game.ts`/`lib/ai.ts` puros; decks demo offline; assinaturas de
`houses.ts`; strings via `i18n`; erro engolido de propósito em storage/audio.

---

## Fase 0 — Rede de segurança e baseline (pré-requisito de tudo)

**Objetivo:** nenhum passo seguinte sem como detectar regressão e sem baseline de git.

- Inicializar repositório git próprio do projeto (`git init` + `.gitignore` de
  `node_modules`/`dist`/`graphify-out/cache`) e commitar o estado extraído do zip como
  baseline. Hoje o `git status` enxerga um repo raiz muito acima, tudo untracked —
  não existe baseline para branch/worktree. `bounded`
- Corrigir os 2 `TS6133` (`App.tsx:47,58`) — `CardLightbox` será usado na Fase 3, então
  o fix real é remover o import morto de `CardFace` e deixar `CardLightbox` para a Fase 3,
  ou `npx tsc` com suppress até lá. Decidir na execução. `bounded`
- Scripts de gate no `package.json`: `"typecheck": "tsc --noEmit"`, e `build` passando a
  rodar typecheck antes. `bounded`

**Exit:** `npm run typecheck` verde; `npm run build` verde; commit baseline existe;
`git log` mostra o estado do zip.

**Gate:** reviewer confere que o baseline builda e que os scripts de gate existem.

## Fase 1 — Quick wins mobile (uma tarde, sem refactor)

**Objetivo:** matar os defeitos que mais machucam usuário de celular com mudanças de 1 linha.

- `index.html`: adicionar `viewport-fit=cover` ao meta viewport (ativa o safe-area já
  escrito no CSS). `bounded`
- `index.css`: trocar `100vh` → `100dvh` (3 ocorrências, linhas 37/87/1136) com fallback
  `vh` antes de `dvh`. `bounded`
- Inputs 10–11px → ≥16px (`.deck-input-row input`, `.browse-search input`,
  `.filter-search input`) para eliminar o auto-zoom do iOS. `bounded`
- Alvos de toque: elevar os controles primários do mobile (`.mobile-tab`, botões de turno,
  paginação) a mínimo 44px de área tocável. `bounded`

**Exit:** em DevTools 360×800 e 390×844: sem zoom-on-focus nos 3 inputs; tab bar fora da
home indicator; sem corte pelo chrome do browser ao rolar.

**Gate:** reviewer olha diff (deve ser <30 linhas) e roda o smoke das duas viewports.

## Fase 2 — Tokens tipográficos e escala fluida (o coração do pedido)

**Objetivo:** nada de `font-size` em px fixo; type que cresce e encolhe com a tela.

- **Spike curto:** medir os ~20 valores de fonte distintos em uso e mapeá-los em 5–7
  tiers de token (`--fs-2xs … --fs-2xl`), cada um `clamp(min, fluido, max)`. Piso proposto
  pelo executor: **11px no menor tier em 360px** (legibilidade KeyForge densa), teto no
  maior em 1920px. O floor exato é um dos pontos que o advisor deve confirmar ou corrigir.
  `spike`
- Definir os tokens em `:root` com comentário de escala; documentar no `CLAUDE.md`. `bounded`
- **Passada de conversão por seção do CSS** (header → home → deck tile → config → vault →
  inspector → game board → mobile blocks), substituindo px por token; apagar os overrides
  de fonte dentro do `@media 700px` que os tokens tornam redundantes. `architectural`
  em volume, mecânico em risco — por seção, um commit por seção.
- Remover `min-width: 320px` de `html`/`body` (bloqueia reflow e convive mal com zoom). `bounded`

**Exit:** `grep -c "font-size: *[0-9]px"` ≈ 0 fora dos tokens; screenshot smoke em
320/360/390/768/1040/1440/1920 sem texto cortado ou ilegível; tamanho do build não sobe.

**Gate:** reviewer confere seção por seção (o diff será grande e mecânico — bisectável
por commit).

## Fase 3 — Interação touch-first (hover não é interação)

**Objetivo:** inspecionar carta e jogar com um dedo.

- `CardArt.tsx`: trocar a trinca `onMouseEnter/Move/Leave` por pointer events com
  detecção `pointerType`; em touch, tap abre o `CardLightbox` (**já implementado,
  portalled, unused** — o touch answer existe, só não está ligado); em mouse, mantém o
  hover-zoom. Elimina também o re-arm de timer a cada `mousemove`. `bounded`
- Fixar o `TS6133` restante ao ligar o lightbox. `bounded`
- Revisar os 36 `:hover` restantes: os que carregam informação (tooltip/zoom) ganham
  caminho touch; os decorativos podem morrer em touch via `@media (hover: hover)`. `bounded`

**Exit:** em 390×844 com toque simulado: ver carta grande + texto completo com 1 tap;
partida completa jogável sem hover; desktop idem antes (hover-zoom intacto).

**Gate:** reviewer testa os dois modos (mouse e touch emulation).

## Fase 4 — Game screen e layouts mobile-first

**Objetivo:** o tabuleiro — a tela que paga o produto — rearranjado para retrato, não
somente espremido.

- **Spike:** prototipar o rearranjo do game board em retrato (mão como leque horizontal
  scrollável na base, board lanes empilhadas, console de turno fixo) vs. paisagem com
  hint de rotação. Decidir com print nas duas orientações. `spike`
- Implementar o layout escolhido com media queries mínimas + container query onde
  couber; alturas de painéis em `dvh`. `architectural`
- `.workspace`/`.command-rail`: revisar as quebras 1040/700 — a faixa 700–1040px hoje é
  sub-especificada. `bounded`

**Exit:** partida demo completa jogável em 360×800 retrato sem scroll horizontal e sem
alcance impossível de polegar; em 1920×1080 idêntico a hoje.

**Gate:** reviewer joga uma partida demo nas duas orientações e compara 1920 antes/depois.

## Fase 5 — Percepção de performance (o que faz "parecer lento")

**Objetivo:** eliminar reflow e stall perceptível, sem tocar no motor de regras.

- `CardArt` `<img>`: `width`/`height`/`aspect-ratio` + `decoding="async"` (mata o CLS das
  grades inteiras). `bounded`
- `cache.ts`: conexão IndexedDB única (cache da promise de `openDatabase`), `close()` em
  `finally`; `keyforgeApi` não dispara 9 `open()` por página. `bounded`
- `sound.ts`: `ensureContext` só quando `state === "suspended"` e não a cada `play`;
  `setPrefs` fora do efeito de `screen`. `bounded`
- `sw.js`: cap no `ART_CACHE` (LRU simples, ex. 300 entradas) + handler de
  `QuotaExceededError`. `bounded`
- `React.memo` nos `CardTile`/`CardArt` + `useCallback` nos handlers quentes **só se** o
  profiler ainda mostrar re-render caro após a Fase 4. `bounded`

**Exit:** Lighthouse mobile (ou trace manual) sem layout shift nas grades; abrir Browse
com 9 decks não trava a UI; partidas longas sem degradação de áudio.

**Gate:** reviewer compara métricas antes/depois num roteiro fixo (home → browse →
partida demo).

## Fase 6 — Decomposição do `App.tsx` (destrava manutenção)

**Objetivo:** quebrar o god component em módulos de tela sem mudar comportamento.

- Extrair para `src/screens/`: `HomeScreen`, `ConfigScreen`, `GameScreen` (com
  `GameBoard`/`SelectedCardPanel`/`DeckModal` já separáveis), `BrowseScreen`,
  `InspectScreen`; estado global via props explícitas ou um reducer de partida.
  Nenhuma mudança visual. `architectural`
- `Header`/`MobileTabs`/`Toast` para `src/components/`. `bounded`

**Exit:** `App.tsx` < 300 linhas (só orquestração); `tsc` verde; todos os smoke da Fase 4
idênticos; grafo graphify deixa de ter god node de 32 arestas.

**Gate:** reviewer confere zero diff visual (screenshot compare) e que `lib/` continuou intocado.

## Fase 7 — Higiene de build (fechamento)

- Decidir Tailwind: **ou** remover plugin/import/`cn.ts` (−bundle), **ou** adotar
  utilitários nos componentes novos — decidir com o veredito do advisor; não fazer os dois. `bounded`
- Sweep de CSS morto (regras sem chamadores) com grep das 270 classes. `bounded`

**Exit:** bundle menor ou igual; zero classe órfã; `CLAUDE.md` atualizado ao estado final.

---

## Ordem e dependências

```
F0 ──► F1 ──► F2 ──► F3 ──► F4 ──► F5 ──► F6 ──► F7
 rede  quick  type   touch  layout  perf   decom   higiene
 guard vitos  scale
```

Sequência escolhida: responsividade **antes** de decompor `App.tsx` — as fases 1–5 tocam
CSS e componentes folha, quase não `App.tsx`; decompor junto seria regressão
inbisectável (opinião a challenge pelo advisor). F6 pode anteceder F5 se o profiler
mostrar que memoização sem decomposição é trabalho jogado fora.

## Pontos explícitos em que quero o advisor

1. Floor da escala tipográfica e formato do token (`clamp` vs steps em `rem`).
2. Tailwind: remover ou adotar.
3. Ordem F5×F6 (perf antes ou depois da decomposição).
4. Se a cascata desktop-first precisa de inversão completa ou se tokens + media mínimas bastam.
5. O que eu não vi.
