# Polish Report — Aember Arena (set 2026)

Passada de acabamento visual/UX sobre o estado pós-refactor mobile-first (41 commits,
HEAD `b343fbf`). Fase 1 = auditoria (este documento); Fase 2 = implementação, um commit
por melhoria; fechamento com gates e comparativos no fim do arquivo.

**Método.** Leitura de `src/App.tsx`, `src/index.css`, `src/components/*`, `index.html`,
`public/*`; `npm run e2e:capture` (4 viewports × 5 telas, `e2e/shots/current`, copiado
para `e2e/shots/polish-before/`); probes Playwright ad-hoc (scroll/sticky, alvos de
toque, fluxo de seleção de carta no mobile, pt-BR, foco de modal) e uma auditoria de
contraste WCAG que compõe fundos translúcidos até o primeiro fundo opaco e mede cada nó
de texto visível em 5 telas a 1280×800.

Prioridade: **P0** machuca a percepção de qualidade ou a jogabilidade · **P1** gap
claro de acabamento/consistência · **P2** refinamento.

---

## Fase 1 — Gaps encontrados

### P0

| # | Lente | Gap | Evidência |
|---|---|---|---|
| P0-1 | (b) UX | **Mobile: tocar numa carta não mostra as ações.** O inspetor (Jogar/Colher/Lutar) vive no `command-rail`, que no mobile fica *abaixo* da mão: após escolher casa e tocar a 1ª carta da mão a 360×800, `.inspector-actions` está em `top = 1094px` (viewport 800). Nada muda na dobra — parece que o toque não funcionou. | probe `game-after-select` (`e2e/shots/polish-before/360-game-after-select.png`); `App.tsx:1634-1649`, `index.css:1828-1930` |
| P0-2 | (b) UX | **Scroll vaza entre telas.** `setScreen` não reseta a rolagem: Config abre em `scrollY=178` vindo da Home; browse/inspect/game capturados no meio da página, sem header. | `e2e/shots/polish-before/360x800/{game,browse,inspect}.png`; `App.tsx:1140` |
| P0-3 | (a) DS | **Header sticky não gruda.** `.app-root { overflow-x: hidden }` transforma o root no scroll-container do `position: sticky` — ao rolar 368px o header vai para `top = -368`. Navegação/brand somem ao rolar. | `index.css:198-202` + `205-218`; probe `home-scrolled` |
| P0-4 | (c) acabamento | **Paginação renderiza um "0" literal** antes da página 1 (`{gap && …}` com `gap = 0` → React imprime `0`). Além disso os `aria-label` "Previous page/Next page/Pagination" são fixos em inglês (viola invariante i18n). | `e2e/shots/polish-before/1280x800/browse.png` (rodapé "‹ 0 1 2 3 4 … 5000 ›"); `Pagination.tsx:32,41,51,68` |
| P0-5 | (a) DS | **Tag "MASTER VAULT DECK" cobre os números** de Cards/Creatures nos tiles do Vault (a tag é absoluta e mais larga que a arte, sobrepondo o `dl`). Em todas as viewports os valores parecem vazios. | `polish-before/{360x800,1280x800}/browse.png`; `DeckTile.tsx:45`, `.deck-tile-tag` |
| P0-6 | (b) UX | **Config 360×800: Back/Next fora da dobra** (herdado #1) e CTAs primários com **40px** de altura (< 44px). Stepper sem rótulo visível no mobile (só "1 2 3 4"). | `polish-before/360x800/config.png`; probe de alvos: `ghost-button 80×40`, `cta-button 80×40`, `config-step-pill 73×40`; `index.css:3385-3445` |
| P0-7 | (a) DS | **768×1024: header estoura** (herdado #2) — nav desktop + 5 ações não cabem; chip de idioma totalmente fora, Sync colado na borda. | `polish-before/768x1024/home.png` |

### P1

| # | Lente | Gap | Evidência |
|---|---|---|---|
| P1-1 | (c) AA | **Contraste abaixo de AA** em texto informativo: `.zone-card-count` 2.90:1, "Battleline is clear" 2.52:1, `.hand-count` 3.54:1, `.deck-count` 3.67:1, `dt` dos tiles (#7b7d72) 3.98:1, `.pager-gap` 3.61:1, `.pager-hint` 4.16:1, `.table-number` 4.22:1, `.status-page` 4.46:1. Causa: cinzas ad-hoc com alpha (0.36–0.58) em vez de tokens; `--faint #6d7067` dá 3.6:1 sobre `--ink`. | auditoria de contraste (1280×800, 5 telas); `index.css:109-110`, `.zone-card-count`, `.hand-count`, `.deck-count` |
| P1-2 | (b) motion | **`settings.animations` só é parcialmente respeitado.** Só 8 seletores têm override `.reduce-motion`/`.no-anim`; continuam animando com o toggle OFF: `hero-pulse` (infinito), `rise-in` de board/rail/heading, `warm-pulse` da instrução de luta, `status-glow`, `skeleton-slide`, `sheen-sweep`, `toast-in`, `modal-in`, `house-lock`, transições de hover. | `grep animation: index.css` (31 usos) vs. overrides em `:540,3635,4257,4563,4669,4722` |
| P1-3 | (b) densidade | **Mão fora da dobra.** 1280×800: cartas da mão começam em y≈766. 360×800: só o topo das cartas aparece. Causas: `.match-heading p` repete o subtítulo da Home na partida; `match-chip` "ROUND 01 / Your turn" duplica o `turn-console` (e quebra em 2 linhas no mobile pt-BR); battlelines vazias com 130–170px. | `polish-before/1280x800/game.png`, `polish-before/360x800/game.png`; `App.tsx:1605-1615` |
| P1-4 | (b) microinteração | **Placar ambíguo e sem vida.** Keys = 3 pips + "0" solto (herdado #4: "0" de quê?); âmbar sem referência ao custo da chave (6) — o jogador não sabe quanto falta para forjar; `.amber-counter span` tem `transition: transform` que nunca dispara (nada muda o transform); pip forjado só troca de cor, sem momento de "chave forjada". | `App.tsx:624-647`; `index.css:966-1015, 4709-4711` |
| P1-5 | (c) i18n | **Coerência en/pt-BR.** (i) `PlayerBand` mostra `player.name`/`deckName` crus → "You", "The Ember Warden", "Warden's mirror deck" em pt-BR (o log já localiza, o placar não); (ii) números com locale do navegador, não do app ("3.606.217 decks" com UI em inglês); (iii) erros da API (`describeFailure`) só em inglês e exibidos ao usuário; (iv) busca sem resultados cai no estado "O Vault está inacessível" (mensagem de offline para um caso que não é erro). | `polish-before/…` pt probe `pt-game` ("You" no band); `DeckBrowser.tsx:130,134`; `keyforgeApi.ts:100-108,174` |
| P1-6 | (b) a11y | **Diálogos sem gestão de foco.** Abrir o modal de deck deixa o foco no botão do header (`activeElement = header-button--subtle`); sem retorno de foco ao fechar; painel de vitória idem; menu de idioma não fecha com Escape. | probe `pt-deckmodal`; `App.tsx:1061-1130, 941-953, 204-266` |
| P1-7 | (c) branding | `index.html` aponta favicon/manifest para **caminho absoluto** (`/forge-icon.svg`, `/manifest.webmanifest`) — quebra em `file://` (o build single-file aberto do disco fica sem favicon) e em subpath, incoerente com T7c; header usa o `Sparkles` genérico do lucide enquanto o favicon é o glifo forja/chave; sem Open Graph; `<title>` fixo em inglês. | `index.html:11-13`; `App.tsx:1499`; `public/forge-icon.svg` |
| P1-8 | (c) tipografia | **H1 do hero menor no mobile** (herdado #3): `--fs-2xl` (27px) no default contra títulos de sub-tela quase do mesmo tamanho — o momento de marca perde hierarquia. | `index.css:3507-3522`; `polish-before/360x800/home.png` |

### P2

| # | Lente | Gap | Evidência |
|---|---|---|---|
| P2-1 | (a) DS | **Sem escala de raio/sombra/motion.** 17 raios distintos (3,4,5,6,7,8,9,10,11,12,13,16px + compostos), 40 `box-shadow` ad-hoc, ~20 variantes de `transition` (150/160/170/180/200ms, eases diferentes). | `grep border-radius/box-shadow/transition index.css` |
| P2-2 | (a) | `TABLE NOTES01` — `.table-number` colado no rótulo no mobile. | `polish-before/360x800/game.png` (rodapé) |
| P2-3 | (a) | Breadcrumb do hero quebra a 360 ("3 Play" órfão numa 2ª linha). | `polish-before/360x800/home.png` |
| P2-4 | (c) | Card detail do inspect mostra um "." solto acima do título; chip "0W · 0L" sem significado para decks sem histórico. | `polish-before/1280x800/inspect.png`; `DeckInspector.tsx:93` |
| P2-5 | (a) | CSS morto de telas removidas (`.settings-modal`, `.header-room-status`, `.app-footer`, `.modal-done`, `.thinking-setting`…) pesa no bundle. | `index.css:341-377, 2444-2478, 2575-2660, 2740-2850` |
| P2-6 | (c) | Casas novas (Geistoid, Skyborn, Redemption, Star Alliance, Ekwidon…) caem em iniciais "GE/SK/RE/ST/EK" no Vault. | `polish-before/1280x800/browse.png`; `lib/houses.ts` |
| P2-7 | (a) | Botões secundários do header a 30px em ≤390px (primários estão ok, mas o alvo é pequeno). | probe de alvos |
| P2-8 | (c) | Nome do jogador/deck truncado agressivamente no band a 360 ("Warden'…", "Dr. "The …"). | `polish-before/360x800/game.png` |
| P2-9 | (c) | `package.json` ainda se chama `react-vite-tailwind`. | `package.json:2` |

---

## Fase 2 — Implementação

_(preenchido commit a commit)_
