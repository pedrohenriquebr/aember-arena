# REVIEW_VISUAL_2 — Auditoria visual do Aember Arena

Auditoria só com olhos (sem validação de código/specs). Material regerado em 2026-09-30:

- Clipes: `node e2e/record-session.mjs --animations` e `... --animations --view 3d --port 5198` → `e2e/clips/frames/` (33 frames) e `e2e/clips/frames-3d/` (36 frames), mais os `.webm`. Julguei pelos frames PNG, não pelo vídeo em movimento.
- Prints: `npm run e2e:capture` (`e2e/shots/current`) e `e2e:capture:3d` (`e2e/shots/current-3d`), 4 viewports × 5 telas.
- Referência: `docs/ux-prints/arena-ref-1-mesa-trapezio.png`.
- Sanidade: `npm test` → 12 arquivos, 222 testes, todos passando.

## Limites da auditoria (ler antes da tabela)

1. **Sem arte de carta.** O ambiente de captura está offline. Toda carta aparece como gradiente de casa; só o fallback tipográfico (casa/nome/tipo/poder) dá identidade. Parte das conclusões sobre "cartas ilegíveis" pode ser consequência disso. Mesmo assim, a **inconsistência** entre cartas (VA-02) é real.
2. **O clipe só existe a 1280×800.** O `record-session` não grava mobile. A partida em 360/390 só foi vista nos prints do `e2e:capture`, que mostram o tabuleiro **vazio** (mão na primeira rodada). Drawer, sheet do inspetor, undo e turno da IA no mobile **não foram observados** — é lacuna de cobertura, não "está OK".
3. **Vault/browse offline** mostra só o estado de erro. Loading, lista real e tutorial de primeira vez não foram vistos.
4. O vídeo 3D foi gravado com `--animations`, mas o timing (batidas de 700–900ms) não dá para julgar em frames estáticos; só o conteúdo de cada batida.

## Tabela de achados

| ID | Sev. | Tela / viewport | Problema e evidência | Correção sugerida |
|---|---|---|---|---|
| VA-01 | **Alta** | Partida, 360×800 (2D) e 390×844 / 360×800 (3D), 768×1024 (2D) | **A barra de console e as faixas de jogador estouram na horizontal e são cortadas.** `current/360x800/game.png`: "Battleline is clear" vira "Batt…" colado na borda direita, a fileira de casas e o "End turn" não aparecem (só uma borda de botão em x≈320), "Choose one house" e contador de chaves/âmbar do jogador cortados. `current-3d/360x800/game.png` e `current-3d/390x844/game.png`: o console vira 4 quadrados vazios + ícones (→, cubo, desfazer, painel) que sai do viewport; "ROUND 01 / Your turn" quebra em duas linhas espremidas e sobrepostas; "Choose a house to u…" cortado. `current/768x1024/game.png`: "End t…" cortado à direita e contagem de chaves/âmbar do oponente cortada. Em mobile o usuário não consegue ver quais casas pode escolher nem terminar o turno sem scroll lateral. | Tratar o console no mobile como uma grade de 2 linhas (status em cima, casas + End turn embaixo) com `min-width:0`, e fazer a lane/ faixas caberem em `100cqw`. Gate novo: medir `scrollWidth <= clientWidth` do `.game-board` a 360/390/768. |
| VA-02 | **Alta** | Partida 1280×800, 2D e 3D | **Cartas sem face legível, e de forma inconsistente.** `frames-3d/19-ai-turn-done.png`: das 6 cartas da mão, 4 têm casa/nome/custo e 2 são gradiente liso; no campo do oponente as duas criaturas roxas não mostram nome nem poder. `frames/25-play-turn2-1.png`: o "Dextre" do oponente é um retângulo liso (o nome só está no rótulo abaixo, que o 3D não tem) enquanto "Valdr" ao lado mostra face completa. Parece que a face de fallback só aparece em algumas cartas (carga/observer) — para o jogador é "carta que não sei o que faz". Em `frames-3d/12-play-turn1.png` a carta recém-jogada também é um retângulo vazio. | Garantir fallback tipográfico **sempre** que não há imagem (não depender de estado de carga); criaturas em campo devem sempre exibir nome + poder/armadura, mesmo sem arte. |
| VA-03 | **Alta** | 3D 1280×800, mão | **Mão em leque sem texto nem rótulo de nome.** `frames-3d/08-board-start.png`: 7 cartas só como gradiente, nenhuma identificação, enquanto o 2D (`frames/10-hand-card-selected.png`) mostra o nome embaixo de cada uma. Só a carta selecionada ganha o nome (`frames-3d/10-…`). Além disso, quando há texto (`frames-3d/19-…`) a borda inferior da carta (custo "0A", "1A", "6") fica cortada pela borda da janela: a zona de leitura é o topo, mas o custo — informação de decisão — fica meio escondido. | Rótulo de nome sob/sobre cada carta do leque (mesmo 2D) e/ou subir o leque ~20px para o custo caber inteiro. |
| VA-04 | **Média** | 1280×800, hover/seleção (2D e 3D) | **Zoom/inspetor vira um painel enorme e vazio.** `frames-3d/10-hand-card-selected.png`, `frames-3d/21-board-creature-selected.png`, `frames/10-hand-card-selected.png` e `e2e/shots/current/1280x800/inspect.png` (Hebe the Huge): popover de ~330×525 px, quase todo preto, com o nome e o texto só no rodapé; cobre o "CARD INSPECTOR", o log e o botão de Undo, e ainda deixa só um pedaço do card atrás ("espiando" em 969,180). Sem arte, é 80% de vazio. | Com `imageFailed`, reduzir o popover ao tamanho do texto ou renderizar a face tipográfica grande dentro dele; não sobrepor o rail inteiro. |
| VA-05 | **Média** | Mesa 3D 1280×800 | **Profundidade pouco legível vs referência.** Comparando com `arena-ref-1`: a referência tem trapézio claro, bordas do tapete iluminadas, cartas grandes (~1/9 da largura) e forte diferença de tamanho frente/fundo. Aqui (`current-3d/1280x800/game.png`, `frames-3d/19-…`) o plano é verde-escuro quase uniforme, o trapézio mal se vê (só um elipse fraco), e as cartas do oponente (≈85×115) e a minha (≈105×150) são ~1/12 da largura — metade do tamanho que o campo permite, com ~60% da lane vazia em volta. O resultado lê como "2D levemente inclinado". | Subir `--card-w-3d` (há folga vertical de ~60px em cada lane), reforçar borda/vinheta do tapete (contraste ≥ 1.4× na borda) e uma luz central. |
| VA-06 | **Média** | 3D 1280×800, lane do jogador | **Carta de pé invade o console.** `frames-3d/14-ai-turn-1.png`, `19-…`, `22-reap.png`: o topo da minha criatura (y≈400–410) entra ~10–20px na barra do console (y 360–420), tocando os botões de casa/"Logos ✓" — já documentado em CLAUDE.md como limite (a), mas visualmente é feio: a carta parece atravessar a faixa. No `22-reap` (carta "cansada" inclinada) a sobreposição com "Brobnar/Dis" é maior. | Mover o ponto de apoio da carta ~16px para baixo ou dar `z-index` abaixo do console e máscara suave no topo. |
| VA-07 | **Média** | 3D, estado "exausta" | **Criatura exausta quase indistinguível de pronta.** `frames-3d/22-reap.png` (depois do reap) vs `21-…`: a carta apenas inclina ~10° e escurece ligeiramente. No KeyForge/Arena a referência gira 90° (ou mostra o ícone de girar). Um jogador novo não vai ler "já usei". | Adicionar o ícone de "exausta" (ou borda cinza + rotação maior) — o ready-breathe já indica a pronta, falta o contrário forte. |
| VA-08 | **Média** | Turno da IA, 3D 1280×800 | **Duas cartas "em cena" simultâneas.** `frames-3d/15-ai-turn-2.png`/`16-…`: a carta jogada da IA (grande, roxa, centro) aparece **ao lado** da minha carta no plano (azul, y≈410–560) e sobre a barra do console; a legenda "The Ember Warden played Tocsin." aparece abaixo do voo sem alinhamento com nenhuma delas. Lê como desordem. Ao mesmo tempo as 2 criaturas do oponente (`16-…`, em x≈440) já pousaram enquanto a carta em cena ainda exibe a anterior. | Escurecer levemente a mesa durante a batida (scrim) e centralizar a legenda acima da carta em cena. |
| VA-09 | **Média** | Partida 1280×800 (2D e 3D) | **Rótulos "BATTLELINE" duplicam o console.** `current/1280x800/game.png` e 3D: "OPPONENT BATTLELINE 0 ON TABLE" + "Battleline is clear" em cada zona e o rótulo "YOUR BATTLELINE" colado logo abaixo do console (y 429 no 3D): é texto demais para uma mesa vazia e, no 3D, o rótulo do jogador encosta no console. | No 3D, tirar o "Battleline is clear" (ou deixar só em estado vazio do início) e dar 8px de respiro sob o console. |
| VA-10 | **Média** | Home / Config mobile 360×800 | **Barra de ação sticky + tab bar ocupam ~110px** (`current/360x800/home.png`: "Continue to setup" sobre a tab bar; `config.png`: Back/Next sobre a tab bar). Funciona, mas o conteúdo útil fica em ~690px e o card do segundo deck (Shadowmaster) aparece cortado atrás da barra no scroll inicial. Não é bug, é densidade. | Opcional: esconder a tab bar quando há dock de ação, ou reduzir a dock a 52px. |
| VA-11 | **Baixa** | Config 1280×800 (último passo) | `frames/06-config-review.png`: o Review está bom, mas o card "Opponent" tem ~150px de vazio interno abaixo de 3 linhas e a linha "Warden turns ~0.7 s per action" é a última visível — o slider/ritmo da IA fica abaixo da dobra. | Alinhar a altura dos dois cards de resumo ao conteúdo (`align-items:start`). |
| VA-12 | **Baixa** | Vault 1280×800 (offline) | `current/1280x800/browse.png`: estado de erro correto, com a ação "Use my saved decks", mas as 7 bolinhas de casa soltas abaixo (y≈548) não têm rótulo e parecem um loader quebrado. | Rotular ("Filtrar por casa") ou esconder no estado de erro. |
| VA-13 | **Baixa** | Partida 1280×800 | O rail esquerdo de "Quick rules" / "Card data by Master Vault" é cortado pela dobra (`frames-3d/14-…`: "Card data by Master Vault" meio escondido, y≈780); o log mostra só 5 itens. Aceitável, mas não há indicação de scroll. | Sombra de fade no rodapé do rail. |
| VA-14 | **Baixa** | Inspect 360×800 | `current/360x800/inspect.png`: stats em grade 3×3 com célula vazia (canto direito), o "BONUS AMBER" quebra em 2 linhas e desalinha a linha. | Preencher a última célula (ex. "Enhanced") ou `grid-column: span 2` na última linha. |

## O que está BOM (não regredir)

- **Mulligan** (`frames-3d/07-mulligan.png`): modal centrado, hierarquia clara (Keep hand primário dourado, Mulligan secundário), fundo escurecido sem perder o contexto, mão visível atrás.
- **Escolha de casa + seleção** (`frames-3d/10-…`, `11-…`): chip de casa ativo com check, demais esmaecidos; aura azul de seleção clara na carta do leque; "Logos is active" na legenda do console.
- **Placares**: chaves, âmbar (com sublinhado âmbar na mudança 0→1→3), "0/3" e badge de turno (⚡) legíveis e estáveis entre 2D e 3D; o âmbar do oponente sobe em `frames/16-…` (2 Æ) junto com o log.
- **Turno da IA**: a legenda em pílula escura ("The Ember Warden played Ember Imp.") e o destaque do chip de casa da IA ("Dis ✓" no header do oponente) contam bem o que acontece; o log em tempo real acompanha linha a linha; "Round 02 · Your turn · Warden: 3 cards · +0 Æ · Dis" como resumo (`frames-3d/19-…`) é excelente.
- **Undo e log**: Undo ativa/desativa coerentemente (cinza no início, ativo depois da jogada); filtro do log (`frames-3d/31-…`) com chips bem espaçados.
- **Home e tiles de deck** (`current/1280x800/home.png`, `360x800/home.png`): hero sóbrio, stepper 1-2-3, tiles com emblemas das casas, CTA sticky "Continue to setup" claro; nada cortado em 360.
- **Config/wizard** (`frames/06-config-review.png`, `360x800/config.png`): stepper com checks, escolhas com radio grande (≥ 44px), Back/Next sticky.
- **Inspect mobile** (`360x800/inspect.png`): chips de filtro e breakdown legíveis; nada fora da tela.
- **Tab bar mobile**: 4 abas com rótulo, alvo ≥ 44px, ativa em destaque; "Play" desabilitado antes da partida.
- **2D 1280×800**: composição limpa — lanes, console e mão sem sobreposição, nomes sob cada carta, contraste confortável.
- **Estado de erro do Vault**: mensagem honesta ("bundled and saved decks are still fully playable offline") e saída clara.

## VEREDITO

**Desktop: aprovado com ressalvas. Mobile em partida: reprovado até o VA-01 ser corrigido.**

O 2D a 1280×800 está polido e coerente. O 3D novo (fileiras por zona) funciona como estrutura, mas ainda não entrega a *sensação* da referência: profundidade tímida, cartas pequenas e, principalmente, cartas sem face legível em parte dos casos (VA-02/03), o que hoje pesa mais que qualquer ajuste de proporção.

Bloqueadores antes de chamar de "pronto para jogar no celular":

1. **VA-01** — console e faixas estourando em 360/390/768 (não dá para escolher casa nem encerrar o turno sem ver os botões).
2. **VA-02/VA-03** — fallback de face sempre presente e rótulo de nome na mão 3D.
3. Em seguida VA-04 (popover vazio), VA-05 (escala/profundidade 3D) e VA-06 (carta invadindo o console).

Também falta cobertura: gravar um clipe mobile (360×844 e 390×844) com cartas em jogo, drawer, sheet do inspetor e turno da IA — com o harness atual esses fluxos não foram auditáveis.
