# WORKFLOW — Aember Arena mobile-first (síntese executor + advisor)

**Data:** 2026-09-26 · **Fontes:** `docs/PLAN_EXECUTOR.md` (plano da sessão executora) +
`docs/advisor/RESPONSE.md` (parecer Opus 5.5, effort medium, com leitura independente do
código via graphify + Read). Este documento é o plano único que passa a valer; onde os
dois divergiam, a decisão está registrada em §1.

**Roteiro de processo:** `$workflow` (dev-workflow) — brainstorm c/ HARD GATE → plano TDD
→ worktree → execução (direta ou subagentes) → finalização. As fases abaixo mapeiam as
tarefas técnicas nesse roteiro.

---

## 1. Síntese: onde os planos convergiram e o que foi decidido

**Convergências (sem conflito):** F0/repo baseline + typecheck; quick wins de viewport;
escala tipográfica como coração do trabalho; touch como fase própria; perf percebida
(CLS, IDB, SW); higiene de Tailwind por último.

**Divergências resolvidas (sempre anotado quem venceu e por quê):**

| Tema | Executor dizia | Advisor dizia | Decisão |
|---|---|---|---|
| Decompor `App.tsx` | Fase 6, no fluxo | **Fora do caminho crítico**; opcional; só extrair `GameBoard` se `memo` exigir | **Advisor.** CSS não enxerga a árvore de componentes; decomposição é objetivo de manutenção, não de responsividade. Vira trilha opcional (§4, T10) |
| Inverter a cascata | Media queries mínimas por fase | Inverter **componente por componente**: default = mobile, desktop em `@media (min-width: 701px)` ao lado do seletor; o bloco de 700px encolhe até sumir | **Advisor** (mais específico e bisectável). Sem big-bang |
| Tipo de carta vs interface | Uma escala única de tokens | **Duas populações**: (A) texto dentro da carta escala com a carta → `cqi`; (B) texto de interface → escala global `rem`+`clamp` | **Advisor.** A premissa de população única estava errada |
| Touch: como abrir carta | Tap abre lightbox | **Não**: tap já seleciona carta/alvo. Lightbox em **long-press** ou botão de info + `matchMedia('(hover: hover)')`, esconder toggle `hoverZoom` em touch | **Advisor** (conflito de gesto real no board) |
| Rede de segurança | Smoke manual por fase | **Harness de screenshots Playwright** (360/390/768/1280, 5 telas) como tarefa própria | **Advisor.** A inversão de 5.237 linhas sem diff visual é regression-bait |
| `memo`/perf | Só se profiler mostrar | Medir primeiro (CPU 4× throttle); e `memo` só funciona com `t` e callbacks estáveis — senão é no-op | **Advisor** (condição concreta que eu não tinha) |

**Correções de fato do advisor (adotadas nos docs):** `index.css` tem **5.237 linhas**
(não 4.488 — corrigido em `CLAUDE.md` e `CODE_REVIEW.md`); o bloco `max-width: 700px`
tem ~723 linhas = 14% do arquivo; os menores textos (5–6px) são **estado de jogo**
(`.ready-label`, `.key-counter small`, `.active-turn-tag`), não decoração — legibilidade
aqui é jogabilidade, e isso sobe para o topo da prioridade.

**Descobertas novas do advisor incorporadas como tarefas:** falta total de
`(hover: hover)`/`pointer: coarse`/`touch-action`; `black-translucent` + `viewport-fit=cover`
exige tratar `safe-area-inset-top` no header (conteúdo sobe sob a notch); caminhos
absolutos (`start_url:"/"`, `register("/sw.js")`) quebram subpath/`file://`; i18n violado
(`aria-label` fixo em inglês, `<html lang="en">` estático); grids `minmax(258px/272px,…)`
estouram em 320px (padrão: `minmax(min(Xpx,100%),1fr)`).

---

## 2. Invariantes (nenhuma tarefa quebra)

1. Single-file build (`vite-plugin-singlefile`); funciona de `file://` e offline.
2. `lib/game.ts` / `lib/ai.ts` puros e imutáveis.
3. Decks demo jogáveis sem rede no primeiro uso.
4. Assinaturas de `houses.ts` estáveis; strings novas sempre via `i18n`.
5. Erro engolido de propósito em storage/audio permanece.
6. **Orçamento de bundle:** gzip baseline 118,52 kB — nenhuma fase aumenta >3 kB;
   a remoção do Tailwind (T9) deve reduzir.

**Piso tipográfico absoluto (contrato):** `11px` para qualquer texto informativo em
qualquer viewport; `10px` só para caps/eyebrows com `letter-spacing ≥ 0.1em`; inputs
`16px` sempre; `≤9px` só `aria-hidden` decorativo (nenhum caso legítimo hoje).

---

## 3. Tarefas consolidadas (executor ∪ advisor)

| # | Tarefa | Classe | Arquivos | Depende de |
|---|---|---|---|---|
| T0 | Repo próprio (`git init` + `.gitignore` + baseline) + fix 2×TS6133 + script `typecheck` | bounded ⚠️ exige aprovação do usuário (repo aninhado) | raiz | — |
| T1 | Harness de regressão visual: Playwright screenshots 360/390/768/1280 × 5 telas c/ deck demo; spike de custo → bounded | spike→bounded | novo `e2e/` | T0 |
| T2 | Viewport/iOS: `viewport-fit=cover`; inputs ≥16px; remover `min-width:320px`; `vh→dvh`; `safe-area-inset-top` no header; `lang` dinâmico | bounded | `index.html`, `index.css`, `App.tsx`, `i18n` | T0 |
| T3 | Escala de tipo global (população B): tokens `:root` da §5 + conversão seção a seção, 1 commit/seção | **architectural** | `index.css` | T1, T2 |
| T4 | Texto dentro da carta (população A): `container-type: inline-size` + `max(floor, 7cqi)`; estados 5–6px viram indicador visual + `aria-label` | spike→bounded | `index.css`, `CardArt`, `game` render | T3 |
| T5 | Touch: long-press/info → `CardLightbox`; `matchMedia('(hover: hover)')`; esconder toggle `hoverZoom` em touch; `touch-action`; `@media (hover:hover)` nos 36 `:hover` | bounded | `CardArt.tsx`, `App.tsx`, `index.css` | T2 |
| T6 | Inversão mobile-first componente por componente (default mobile; desktop em `min-width: 701px` ao lado do seletor); grids → `minmax(min(Xpx,100%),1fr)`; alvo: bloco 700px <100 linhas | architectural (1 decisão) / N×bounded (execução) | `index.css` | T3 |
| T7a | CLS: `width/height/aspect-ratio/decoding` no `<img>` de `CardArt` | bounded | `CardArt.tsx` | T1 |
| T7b | IDB: conexão singleton, `close()` em `finally`, sem 9 `open()` por página | bounded | `cache.ts`, `keyforgeApi.ts` | — |
| T7c | SW: cap LRU no `ART_CACHE` + `QuotaExceededError`; caminhos relativos (`./`) p/ subpath/`file://` | bounded | `sw.js`, `manifest`, `App.tsx` | — |
| T7d | Renders: **medir** (CPU 4×); se confirmado: `useMemo(t)` + `useCallback` + `memo(CardTile/BoardLane)` — extrair `GameBoard` só se necessário | bounded | `App.tsx` | T6 |
| T8 | i18n: `aria-label` do board via `t()`; `<html lang>` segue `settings.language` | bounded | `App.tsx`, `i18n.ts` | — |
| T9 | Remover Tailwind (`@import`, plugin, `cn.ts`) mantendo reset mínimo; medir gzip | bounded | `index.css`, `vite.config.ts` | T3 |
| T10 | **Trilha opcional (fora do caminho crítico):** decompor `App.tsx` em `screens/`; vitest p/ `game.ts`/`ai.ts` | architectural / bounded | `src/` | T6, T7d |

---

## 4. Fases do `$workflow`

### Fase 0 — Pré-requisito (antes do fluxo)
T0. **Gate:** aprovação explícita do usuário para o `git init` aninhado. Exit: typecheck
verde, build verde, commit baseline existe.

### Fase 1 — Brainstorm / design (HARD GATE — não pulável)
Classificação individual de T1–T9 (tabela acima), cada uma aprovada — ser `bounded` não
isenta aprovação. **Exit:** documento de design com: escala da §5, breakpoints finais
(360/701/1040/1280 + `(hover:hover)`), viewport mínimo suportado (**320px**), matriz de
browsers (Safari iOS ≥16, Chrome Android ≥105 — necessários p/ `cqi`/`dvh`), piso
tipográfico. **Reviewer confere:** cada tarefa classificada e aprovada.

### Fase 2 — Plano TDD (`writing-plans`)
"TDD" por tipo de tarefa: **CSS** → screenshot baseline → mudança → diff aprovado +
script Playwright que percorre o DOM e falha se `getComputedStyle().fontSize` < piso em
360px (o teste de verdade); **perf** → contagem de renders por turno da IA + CLS medido;
**IDB** → `fake-indexeddb` ou aceite explícito de teste manual. A pergunta de modo de
execução é feita ao humano e a escolha registrada.

### Fase 3 — Worktree (`using-git-worktrees`)
Só existe após T0. Exit: build+typecheck verdes, screenshots baseline commitados, gzip
baseline registrado como orçamento.

### Fase 4 — Execução
- **4b — sequencial direto:** T2 → T3 → T4 → T6 (e T1 antes de todos). Tudo toca
  `index.css` (5.237 linhas): subagentes paralelos no mesmo arquivo = conflito garantido.
- **4a — subagentes em paralelo** (arquivos disjuntos): lote T7a/T7b/T7c + T5 + T8.
- **Checkpoint por tarefa:** typecheck + build + diff de screenshots revisado + script de
  piso zerado nas telas já migradas.

### Fase 5 — Finalização (`finishing-a-development-branch`)
**Critérios de aceite (todos):**
1. Zero `font-size` computado abaixo do piso em 360px, em todas as telas, durante uma
   partida inteira contra a IA.
2. Partida completa jogável **só com touch** em 360×640, sem zoom e sem scroll horizontal.
3. `dist/index.html` abre via `file://` e offline; deck demo inicia.
4. Orçamento de bundle respeitado (T9 reduziu).
5. Bloco `max-width: 700px` com menos de 100 linhas.
6. Desktop 1920×1080 visualmente idêntico ao baseline (screenshots T1).

Depois: menu merge / PR / manter branch.

---

## 5. Escala tipográfica (contrato técnico, do advisor §3)

Híbrido: **interface** = escala discreta em `rem` com `clamp()` suave; **texto dentro de
carta** = `cqi` com piso. Base do `html` permanece 16px (não mexer no root font-size).

| Token | Valor | 360px | 1280px | Substitui |
|---|---|---|---|---|
| `--fs-3xs` | `0.625rem` fixo | 10 | 10 | eyebrows/caps 5–7px |
| `--fs-2xs` | `clamp(0.6875rem, 0.66rem + 0.12vw, 0.75rem)` | **11** | 12 | 8–9px (maioria) |
| `--fs-xs` | `clamp(0.75rem, 0.72rem + 0.15vw, 0.8125rem)` | 12 | 13 | 10–11px |
| `--fs-sm` | `clamp(0.8125rem, 0.78rem + 0.2vw, 0.9375rem)` | 13 | 15 | 12–14px |
| `--fs-base`→`display` | razão ~1.2 até os 46px atuais | — | — | 15–46px |
| `--fs-input` | `max(16px, 1rem)` | 16 | 16 | inputs |

**Dentro da carta:** `container-type: inline-size` em `.card-tile`;
`font-size: max(var(--fs-card-floor), 7cqi)` com `--fs-card-floor: 10px` (carta de 150px
→ 10,5px). Onde o piso não cabe, **o texto sai da carta** (label vira indicador visual —
borda/ícone/opacidade — e o estado vai para `aria-label` via `t()`). Exemplo concreto:
`.ready-label` (5px, "Ready/Stunned") vira estado visual.

**Regra de ouro (critério de reviewer):** encolher texto nunca é solução de layout.
Se não cabe, muda o layout (hand fan com scroll-snap, labels viram ícones, painéis viram abas).

---

## 6. Dependências

```
T0 ──► T1 ──► T2 ──► T3 ──► T4 ──► T6 ──► T7d ──► (T10 opcional)
        │      │     │
        │      │     └──► T5 (paralelo ao lote 4a)   T7a/T7b/T7c/T8 (paralelos)
        └────────────┴──► T9 (após T3)
```

## 7. O que invalida este plano (reevaluar se ocorrer)

- **T1 instável/caro** (screenshots flaky por fonte/animação): a inversão (T6) perde a
  rede de segurança → manter desktop-first e aplicar só tokens + consertar o bloco 700px.
- **Browser alvo sem `cqi`** (Safari <16 / WebView antigo confirmado): T4 cai para
  `clamp()` por breakpoint.
- **Tailwind adiciona <3 kB gzip:** T9 sai do escopo (risco sem ganho).
- **CPU 4× throttle mostra turno da IA fluido:** T7d cai de prioridade; T7a (CLS) sobe.
- **Usuário define alvo como desktop/tablet paisagem:** "mobile-first" vira
  "mobile-usable" e a T6 sai do caminho crítico.
- **Usuário recusar `git init` aninhado:** Fases 3/5 do `$workflow` precisam de exceção
  explícita (cópia de pasta + diff manual) — registrada, nunca contornada em silêncio.
