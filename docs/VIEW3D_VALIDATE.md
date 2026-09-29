# Validação — Modo de Visão 3D da mesa (VIEW3D, H3D-01..12)

Validação **somente leitura** do modo 3D contra `docs/VIEW3D_PLAN.md`. Nenhum código foi
alterado; este é o único arquivo criado. Estado validado: HEAD `2b2867d` (29/09/2026),
`dist/index.html` gerado depois do último commit de `src/` (`235086b`).

**Veredito do modo: PRONTO COM RESSALVAS.** A mesa é sólida no que o plano mais temia.
O 2D está **pixel-idêntico**, medido por mim. O hit-test acerta 100% em Chromium, o piso
visual passa nas 4 viewports, o FX pousa com ≤ 3px de erro e o bundle fica em 142,57 de
143,5 kB. Três defeitos reais e um probe instável devem ser fechados antes de anunciar o
modo ao dono (§5).

---

## 0. Evidência coletada nesta validação

| Execução | Resultado |
|---|---|
| `node e2e/probes/_3d-chain.mjs` ×3 | **2 FAIL / 1 OK**: a única falha é sempre "H3D-12: ponteiro no topo tira 1,5 grau do tilt (X)"; todos os outros ~45 checks passam nas 3 execuções |
| Cópia instrumentada do `_3d-chain` (em `/tmp`, fora do repo) ×3 | 2 OK / 1 FAIL; a falha coincide com `scrollY=129` (§3) |
| `node e2e/probes/_3d-hit.mjs` | **OK**: 1/6/12 criaturas × 360/768/1280/1440, cliques 100% certos, alvos ≥ 56×78 / 44×44, câmera no extremo 24/24. Firefox/WebKit **PULADOS** (sem binário) |
| `node e2e/probes/_3d-fx.mjs` | **OK**: quadro 0 com delta de 0,0%, pouso com deltas ≤ 0,5px (jogador) e ≤ 1,1px (Warden), hold de 420ms, toggle no voo sem órfãos |
| `npm run e2e:floor:3d` | **OK**: 0 violações a 360/768/1280/1440; o teste do teste acusa 12-13 elementos em cada viewport |
| `npm run e2e:bundle` | **142,57 kB gz** (teto 143,5) |
| 2D pixel-idêntico: `_2d-freeze` em `6ee58a6` (pré-3D) × `HEAD`, extraídos por `git archive` em `/tmp` | `.game-board` **idêntico pixel a pixel** a 360/768/1280; a tela `game` difere só num bbox 44×44 (`749,89–792,132` a 1280) = o botão `.view-toggle` novo (esperado, H3D-01) |
| Diagnóstico do modo `--lite` (`hardwareConcurrency` forçado a 2, 1280×800) | **defeito** (§1, H3D-09) |
| Medição do leque 3D com a mão inicial (7 cartas) a 1280/768 | **defeito** (§1, H3D-06) |
| Freeze 3D (`--view 3d`) × 2D | Mão sobe **131px** (1280) / **97px** (768) em relação ao topo do board; razão de escala **0,768** / **0,782** |

> Armadilha encontrada no ferramental local: `e2e/shots/_png-diff.mjs` só compara
> subpastas `WxH/` (`_png-diff.mjs:77`). Com pastas planas, como as que o `_2d-freeze`
> gera (`freeze-before/board-1280.png`), ele não compara nada e imprime **"DIFF: identico
> pixel a pixel"** (`:104`). Minha primeira comparação caiu nisso; refiz no layout
> `WxH/` e o resultado acima é real. Qualquer "2D idêntico" anterior tirado dessas pastas
> planas pode ter sido um falso positivo. Neste caso a conclusão se mantém, porque medi
> de novo.

---

## 1. Por história

### H3D-01 — Toggle e persistência — **RESOLVIDA**
- `settings.ts:16/34/56/78`: `tableView` com default `"2d"`; um save antigo sem o campo
  vira 2D (check "save antigo sem tableView le 2d").
- i18n en+pt-BR: `i18n.ts:93-94,123`.
- Toggle em "Som e movimento" (`App.tsx:911-916`), linha no resumo (`App.tsx:988`),
  botão de 44px com `aria-pressed`/`aria-label` via `t()` (`App.tsx:3141-3149`,
  `index.css:716-740`).
- Classe no board, sem prop nova para tiles (`App.tsx:1366-1376`); `cancelFx()` no toggle
  (`App.tsx:1964-1968`).
- Probe: foco fica no botão, **0 re-render de CardTile** (84 tiles vistos; o teste do
  teste enxerga 1 commit), persistência após reload e toggle da Config.

### H3D-02 — Base da cena 3D — **RESOLVIDA**
- `.table-plane` com `display: contents` no 2D (`index.css:6720-6729`) e `block` +
  `preserve-3d` + transform no 3D (`:6737-6752`); cadeia `preserve-3d` até a peça
  (`:6766-6771`); lane com `overflow: visible` ≥ 701px (`:6778-6783`); HUDs com
  `z-index: 2` (`:6788-6792`).
- Probe: auditoria da cadeia sem agrupamento, `perspective` real, projeção viva (altura
  −25,2%, borda de perto +13,9%, Z vivo +5,6%), `container-type` não achata.
- Ressalva de harness: o plano (§5, "Achatamento acidental") queria este probe **no**
  `e2e:acceptance`, e ele não está lá (ver H3D-11).

### H3D-03 — Mesa inclinada e playmat — **RESOLVIDA (desvio aceitável)**
- 40°/1100px ≥ 1041 e 32°/1000px na faixa 701-1040 (`index.css:6916-6922`, `:6975-6984`).
  `margin-block` −48/−32. Playmat em gradientes estáticos com `pointer-events: none`
  (`:6901-6913`). Billboard do heading, console, instrução e empty-state (`:6946-6952`).
- Medido: borda de perto +13,9% (critério 12-18%); razão de escala 0,768/0,782
  (critério 0,74-0,80); mão sobe 131px/97px (critério ≥ 60); controles ≥ 44×44 (hit
  probe: casa 119×46, fim de turno 105×45, toggle 44×44).
- **Desvio:** a largura do oponente é **76px**, não 96 (`index.css:7070-7078`). O plano
  supôs o plano centrado na origem de perspectiva; com `perspective-origin: 50% 38%` o
  fundo projeta a ~0,985, e 96px deixariam as duas battlelines do mesmo tamanho. O
  desvio é correto: ele preserva a diferença de escala, que é o que vende a profundidade
  (§1.2).
- Limite conhecido e aceito (`CLAUDE.md`, "Mesa 3D (a)"): com lane cheia, a carta de pé
  cobre parte do `zone-heading` (gap de −30/−34px a 1280/1440 no hit probe).

### H3D-04 — Cartas em pé, levitando — **RESOLVIDA (desvios aceitáveis)**
- Pose em propriedades individuais (`index.css:6993-7014`): `rotate: x calc(lean −
  tilt)`, `translate: 0 0 lift`, `transform-origin` nos "pés". Probe: `rotate x −28deg`,
  `translate 16px`, `animation: none`, sem transform residual.
- Estado ergue sempre (seleção/acting, `:7030-7036`); o hover ergue só com movimento
  (`:7104-7110`) e é ouvido na peça, que não se move.
- 12 criaturas sem scroll nem corte: o hit probe n=12 dá 24/24 e headings sem corte a
  768/1280/1440. Sobreposição calculada (`--overlap`, `:7051-7064`) em vez do `−18px`
  fixo acima de 13 cartas: uma melhoria.
- **Desvios:** (1) o `card-arrive` da peça foi removido no 3D (`:7005`) em vez de virar
  opacity no tile; a entrada da folha (`card-deal`) continua, então é aceitável. (2)
  Exausta = `rotate: z 12deg` na **arte** (`:7041-7043`), não `transform` no tile; assim
  os badges ficam em pé e legíveis, então é aceitável. (3) `--depth-k` aplicado só a
  headings e ao texto do fallback (`:6938-6958`, `:7114-7124`); `CLAUDE.md` (b)
  documenta que ele não é load-bearing hoje. É aceitável e o gate visual confirma.

### H3D-05 — Sombras no chão — **RESOLVIDA** (Safari não verificado)
- `::before` da peça contra-rotacionado, `+1px` em Z, gradiente estático
  (`index.css:7131-7152`). Probe: repouso 0,62/1, erguida 0,32/1,18, caixa mais larga que
  alta, `pointer-events: none`.
- `ready-breathe`, `sel-breathe` e o pulso do `round-dot` foram convertidos para opacity
  (`:7165-7206`). Probe: **zero** animação de `box-shadow`/`filter` no plano.
- O critério "sem z-fighting no Safari" não é verificável aqui (sem WebKit).

### H3D-06 — Mão em leque — **PARCIAL**
- Leque via `--i` (`nth-child` + `sibling-index()`), `rotate` de 3,5°/carta, arco
  2,2px·d², 118px, sobreposição a partir de 7 (`index.css:7214-7263`, `:7273-7279`).
  Seleção e `:focus-visible` erguem (`:7256-7262`), hover só com movimento
  (`:7282-7290`), leque desligado < 701px.
- **Defeito medido: legendas das pontas do leque cortadas.** Com a **mão inicial de 7
  cartas**, a `.card-caption` da 1ª e da 7ª carta (±10,5°) passa **13px** da base do
  `.game-board` a 1280×800 e **11px** a 768×1024; a caixa da legenda tem 35/30px. O
  `.game-board { overflow: hidden }` (`index.css:762-763`) corta ~⅓ do nome ("Dextre",
  "Key to Di…" na captura). O arco (`translate: 0 d²·2,2px`, `:7232`) e a rotação descem
  as pontas abaixo do padding inferior da `.hand-zone` (12px). O plano (§1.5) promete
  "Leque 100% visível". O `e2e:floor:3d` não pega isso porque mede tamanho, não recorte,
  e o probe só testa o leque com 6 cartas e a carta erguida.
- Não verificados pelos probes: 8 cartas com pontas a ±12° ± 0,5° e Tab percorrendo a
  mão (a regra `:focus-visible` existe).

### H3D-07 — Interações em 3D — **RESOLVIDA em Chromium** (Firefox/WebKit/iOS pendentes)
- Alvo do pick sobe e o inválido afunda (`index.css:7091-7100`, `:7016-7019`); sombra e
  playmat com `pointer-events: none`.
- `_3d-hit`: 100% de acertos com 1/6/12 criaturas nas 4 viewports, clique seleciona a
  própria carta, luta resolve com clique no alvo, alvos ≥ 56×78 (menor 62×81 com n=12).
- **Firefox e WebKit PULADOS** (binário do `playwright-core` ausente); o critério pede
  os 3 motores e Safari iOS real manual. Nada disso foi exercido.

### H3D-08 — Integração com as ondas de FX — **RESOLVIDA (desvio aceitável)**
- `captureFx` usa o tamanho de layout × scale e a rotação do leque (`FxLayer.tsx:75-95`).
  O pouso lê `--lean` e o giro da arte do destino (`:211-218`); `.fx-layer--3d .fx-gone`
  herda o lean (`index.css:5195-5200`). O shake da forja vai no plano com `translate`
  individual (`:5120-5140`). `acting` no 3D = lift/lean (`:7030-7036`, `:7148-7151`).
- `_3d-fx`: todos os critérios passam.
- **Desvio:** a pose final do ghost é `rotateX(lean)` **sem** `perspective(1100px)`
  (`FxLayer.tsx:214`). A medição de ≤ 3px mostra que não importa. Investida da luta e
  FLIP das vizinhas não existem no código (nem no 2D), então não há o que portar.

### H3D-09 — Mobile e degradação — **PARCIAL**
- 2.5D < 701px OK (`index.css:6823-6889`). Hit probe a 360: `rotate/translate none` na
  peça, lane com `overflow: auto`, cartas 60×84 ≥ 44; o `e2e:floor:3d` a 360 passa.
- **Defeito medido: o modo `--lite` pinta o playmat sobre os HUDs.** O App troca `--3d`
  por `--lite` com ≤ 2 núcleos (`App.tsx:160`, `:1371`). Só `.game-board--3d
  .table-plane` ganha `display: block; position: relative` (`index.css:6737-6752`); no
  lite o plano **continua `display: contents`**. O `::before` do playmat
  (`:6829-6841`, `inset: -41% 0 -4%`) passa então a usar o `.board-content` como bloco
  de contenção. Medido a 1280×800: `::before` com **1120px** de altura e `top: −317px`,
  contra 412px no 3D real. Na captura, o trapézio e a vinheta atravessam a `player-band`
  e a mão. É cosmético (pointer-events none), mas é visível para todo usuário do perfil
  lite, e **nenhum probe exercita o lite**.
- **`@supports` parcial:** o comentário de `index.css:6821-6822` diz "sem suporte a
  classe 3D não aplica NADA", mas o bloco-base (`:6737-6810`: `display: block`,
  `perspective`, lane `overflow: visible` + `container-type` ≥ 701, `z-index` dos HUDs)
  está **fora** do `@supports` (que abre em `:6823`). Num motor sem `preserve-3d`, a lane
  perderia o scroll sem ganhar o dimensionamento por `--n` (que está dentro do
  `@supports`), e com muitas criaturas as cartas vazariam para o recorte do board. O
  impacto prático é teórico (todo motor-alvo suporta `preserve-3d`), mas o contrato
  escrito não bate com o código. O plano pedia degradar para 2.5D nesse caso; o código
  degrada para "quase 2D".
- Não medido: trace com CPU 6× rolando a lane.

### H3D-10 — Transição entre modos — **RESOLVIDA com ressalva de performance**
- `@property --tilt` + transição de 420ms (`index.css:6720-6735`); fade 1 → 0,65 → 1 e
  `will-change` só durante `--switching` (`:6794-6810`); a classe sai no `animationend`,
  com fallback de 500ms (`App.tsx:1970-1986`).
- Probe: assenta em **392ms** (a amostragem por rAF explica a distância aos 420 ± 20),
  CLS 0, `will-change` volta a `auto`, reduce-motion troca em 1 frame e o fade não achata
  o 3D.
- **Ressalva:** o critério "nenhum frame > 33ms (CPU 4×)" **não** foi demonstrado. Em
  headless por software o pior frame foi 499,9ms e 9 de 18 frames passaram de 33ms. O
  probe afrouxou o check para "corpo > 150ms = 0" e registra que a meta vale com GPU.
  Falta um trace manual no DevTools com GPU. Lembrete técnico: transição de custom
  property registrada roda na **main thread** (recalc de estilo da subárvore que lê
  `--tilt` a cada frame), não no compositor.

### H3D-11 — Harness do 3D — **PARCIAL (desvios parcialmente aceitáveis)**
- Existe: `e2e:capture:3d`, `e2e:floor:3d` (piso visual com teste do teste), `e2e:smoke:3d`,
  `e2e:record:3d`, probes `_3d-chain`/`_3d-hit`/`_3d-fx` (`package.json:12-21`).
- **Falta vs. plano:** (1) `e2e:acceptance` roda piso 2D + piso visual 3D + bundle +
  bloco (`acceptance.mjs:1-44` e os 4 passos em `:103-151`), **não** o smoke 2D/3D nem o `_3d-chain`. O plano (H3D-11
  e §5) queria os dois modos e o probe da cadeia no acceptance. (2) `baseline-3d` não é
  versionada: `e2e/shots/` está no `.gitignore`, tal como a baseline 2D. Aceitável como
  convenção do repo, mas então "baseline versionada" não existe para nenhum modo. (3) O
  `_3d-chain` é **instável** (§3).
- Desvio aceitável: o teste do teste usa o stressor "tilt 60 sem compensadores" em vez
  de "remover `--depth-k`", que não é load-bearing (`CLAUDE.md`, "Mesa 3D (b)").

### H3D-12 — Parallax e reflexo — **RESOLVIDA (parallax) / DESVIADA (reflexo)**
- Um listener passivo + rAF com lerp 0,12, escrevendo só `--cam-x/--cam-y`
  (`App.tsx:1988-2041`); CSS `rotateY(±2,5°)` e `--tilt ± 1,5°` (`index.css:6749`); a luz
  do playmat acompanha (`:6911`). Desligado em toque, reduce-motion, animações off e lite
  (`App.tsx:1995-1996`).
- Probes: ±2,5° em Y nas duas pontas, 38,56° no topo (execução OK), 0 re-render, volta ao
  neutro, desligado com animações off e com reduce-motion, hit-test 100% com a câmera no
  extremo.
- **Reflexo cortado** de propósito ("orçamento e risco", mensagem do `235086b`). É
  aceitável, mas vale registrar no plano ou no `CLAUDE.md`: hoje só a mensagem do commit
  conta isso.

### Placar

| História | Veredito |
|---|---|
| H3D-01 | RESOLVIDA |
| H3D-02 | RESOLVIDA |
| H3D-03 | RESOLVIDA (desvio 76px aceitável) |
| H3D-04 | RESOLVIDA (desvios aceitáveis) |
| H3D-05 | RESOLVIDA (Safari não verificado) |
| H3D-06 | **PARCIAL**: legendas das pontas cortadas |
| H3D-07 | RESOLVIDA em Chromium; FF/WebKit/iOS pendentes |
| H3D-08 | RESOLVIDA (desvio aceitável) |
| H3D-09 | **PARCIAL**: lite com playmat vazando; `@supports` parcial |
| H3D-10 | RESOLVIDA; meta de frames sem prova com GPU |
| H3D-11 | **PARCIAL**: acceptance sem smoke/probes; `_3d-chain` instável |
| H3D-12 | RESOLVIDA (parallax) / DESVIADA (reflexo, aceitável) |

---

## 2. Riscos técnicos que o plano apontou

| Risco | Estado | Evidência / ressalva |
|---|---|---|
| **Legibilidade** (billboard/counter-tilt em todo texto) | **OK com 2 ressalvas** | Todo texto do plano é billboard (`index.css:6946-6952`) ou HUD; caption do board oculto (`:6859-6862`); `e2e:floor:3d` com 0 violações nas 4 viewports e teste do teste ativo. Ressalvas: (a) legendas das pontas do leque **recortadas** (H3D-06), algo que o gate não enxerga; (b) heading coberto pela lane cheia (limite aceito no `CLAUDE.md`). |
| **Performance** (só transform/opacity, 60fps mobile) | **Parcial / não provado** | Animações e transições do 3D só usam `translate/rotate/scale/opacity` (probe: 0 `box-shadow`/`filter` animados). Mobile < 701 não tem pose 3D. Não medido com GPU: 60fps a 1280 com CPU 4×, teto de ≤ 60 camadas, trace CPU 6× no celular. Dois pontos de main thread: a transição de `--tilt` (só durante a troca) e o parallax, que reescreve custom properties **herdadas** no plano a cada frame em movimento, invalidando o estilo de toda a subárvore. Aceitável pelo desenho do plano (§2.9), mas merece um trace; se pesar, escrever o `transform` do plano direto no hook elimina o recalc dos descendentes. |
| **Hit-testing em transforms** | **OK em Chromium** | 100% com 1/6/12 cartas × 4 viewports, câmera no extremo, alvo de luta. Firefox/WebKit pulados e Safari iOS manual pendente: o risco "WebKit" do plano segue **aberto**. |
| **`@supports` fallback** | **Parcial** | Bloco-base fora do `@supports` (H3D-09). Impacto teórico, comentário incorreto. |
| **Reduced motion** | **OK** | Regra global `.reduce-motion *` (`index.css:6574-6581`); hover que ergue guardado por `html:not(.reduce-motion)` + media (`:7104`, `:7154`, `:7282`); shake desligado (`:5131-5134`); parallax fora (`App.tsx:1996`, probe); troca em 1 frame (probe). A seleção ergue sem transição, como o plano pede. |
| **2D pixel-idêntico** | **OK, medido** | `.game-board` idêntico pixel a pixel entre `6ee58a6` e HEAD a 360/768/1280 (save fixo do `_2d-freeze`); única diferença de tela = o botão 44×44 da H3D-01. |

---

## 3. Achado do coordenador: `_3d-chain` falha em "ponteiro no topo tira 1,5 grau do tilt (X)"

**Julgamento: o assert do probe está mal calibrado; não é bug do parallax.**

**O que o probe faz:** depois do smoke de dois turnos, ele move o ponteiro para
`(board.x + 50%, boardBox.y + 6)` (`e2e/probes/_3d-chain.mjs:508`) e espera o tilt em 38,5°
± 0,8 (`:512`).

**Por que falha às vezes:** o smoke clica em `.end-turn-button` com
`locator.click()` (`:447`), e o Playwright rola a página até o botão. A altura do board
depende da mão demo sorteada e do que o Warden jogou, então o scroll final **varia a
cada execução**. Quando a página termina rolada, o topo do board fica **embaixo do
`.app-header` sticky** (`index.css:228-233`, 58px). O ponto `boardBox.y + 6` cai no header
e o ponteiro sai do board, o que dispara `pointerleave`. O `onLeave`
(`App.tsx:2027-2031`) zera os alvos e a câmera volta ao neutro, exatamente como o
produto deve fazer.

**Evidência (cópia instrumentada em `/tmp`, fora do repo):**

| Execução | `scrollY` | topo do board | fim do header | `elementFromPoint` no ponto "topo" | Resultado |
|---|---|---|---|---|---|
| diag 1 | 0 | 154,5 | 62 | `DIV.player-band--ai` (no board) | OK: tilt 38,69°, `camY −0,872` |
| diag 2 | 0 | 154,5 | 62 | `DIV.player-band--ai` (no board) | OK: tilt 38,56°, `camY −0,960` |
| diag 3 | **129** | **25,5** | 62 | **`BUTTON.nav-link`** (fora do board) | **FAIL**: tilt 40,00°, `camY 0.000` |

A assinatura da falha também fecha nas 3 execuções oficiais. Nas duas FAIL, `camY` fica
exatamente em `0.000` e `camX = 0.025`, que é o decaimento do lerp de 0,888 para o alvo 0
em ~27 frames (0,888 × 0,88²⁷ ≈ 0,028), ou seja, o `onLeave`. Um move válido para o topo
daria `camY ≈ −0,96`. O ponto do hit-test do mesmo run também denuncia o scroll: y = 138
nas duas FAIL e y = 272 na OK.

**Correção sugerida (no probe, não no app):** antes do bloco H3D-12, rolar para o topo
(`window.scrollTo(0, 0)` + espera) **ou** mirar em `max(boardBox.y, header.bottom) + 6`.
Depois, afirmar que `elementFromPoint` do ponto está dentro de `.game-board`, falhando
com mensagem clara se não estiver, e derivar o tilt esperado do `targetY` real, em vez
de fixar 38,5°.

Nuance de produto, sem ação: com a página rolada e o topo do board sob o header, o
usuário não alcança o extremo `camY = −1`. É irrelevante para um efeito de ±1,5°.

---

## 4. Veredito

**Modo: PRONTO COM RESSALVAS.** O núcleo do plano (cena, pose, sombras, leque, FX,
transição, parallax, 2D intacto, piso visual, hit-test) está implementado e medido. Os
desvios de H3D-03/04/08/11/12 são justificáveis. Os defeitos restantes são pequenos e
localizados, mas **um deles aparece no primeiro turno de toda partida no desktop** (as
legendas do leque).

## 5. O que corrigir antes de anunciar ao dono

**Obrigatório**
1. **Legendas das pontas do leque cortadas** (H3D-06). Dar à `.game-board--3d
   .hand-track` (≥ 701px) um `padding-bottom` que cubra a descida máxima das pontas
   (~16-24px), ou reduzir o arco. Critério: 0px de legenda além do `.game-board` com 7 e
   8 cartas a 768/1280. Acrescentar esse check ao `_3d-chain` (o gate de piso não pega
   recorte).
2. **Playmat do `--lite` vazando sobre os HUDs** (H3D-09). Estender ao lite o `display:
   block; position: relative` do plano (hoje só `index.css:6737-6752`, escopo `--3d`) e
   cobrir o lite num probe (forçando `hardwareConcurrency = 2`).
3. **Estabilizar o `_3d-chain`** (§3). Um gate que falha em 2 de 3 execuções treina o
   time a ignorar vermelho.

**Recomendado (não bloqueia o anúncio)**
4. Levar para dentro do `@supports` o bloco-base (`index.css:6737-6810`), ou corrigir o
   comentário de `:6821-6822` e o texto do plano.
5. `e2e:acceptance` rodar também o smoke 3D e o `_3d-chain` (plano H3D-11/§5).
6. Trace com GPU no DevTools: 1280×800, CPU 4× (transição e varredura do leque/board) e
   celular com CPU 6× rolando a lane; auditoria de camadas (≤ 60).
7. Verificação manual no Safari iOS (hit-test e z-fighting da sombra) e, se possível,
   instalar os binários Firefox/WebKit do `playwright-core` para o `_3d-hit`.
8. `e2e/shots/_png-diff.mjs`: falhar quando não encontrar nenhum par `WxH/` para comparar
   (hoje devolve "idêntico" no vazio).
9. Registrar no plano ou no `CLAUDE.md` que o reflexo da H3D-12 foi cortado.
