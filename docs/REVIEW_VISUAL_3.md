# REVIEW_VISUAL_3 — Re-auditoria de fechamento (VA-01..14)

Só olhos, sem alterar código. Julguei os frames PNG, não o vídeo em movimento.

## Material e limites

- Regerado em 2026-09-30: `node e2e/record-session.mjs --animations` (2D) e `... --view 3d` → `e2e/clips/frames/` e `frames-3d/` (37 frames cada). `npm run e2e:capture` e `e2e:capture:3d` → `e2e/shots/current` e `current-3d`. `npm test` → 12 arquivos, **222 testes verdes**.
- **Diferença de ambiente:** desta vez o ambiente estava online, então a arte real das cartas carregou. Isso deixa o caminho *sem imagem* (VA-02, VA-04) fora dos frames oficiais. Para não deixar buraco, rodei um script descartável fora do repo (em `C:\tmp\rv3`, nada no projeto) que bloqueia as imagens externas, com:
  - 360×800 e 390×844 (touch), em 2D e 3D;
  - 1280×800, em 2D e 3D;
  - mesa com 3 criaturas por lado, uma danificada, uma com armadura e uma exausta.
  Os prints citados como "sem-arte" vêm daí e não estão versionados.
- Continua sem clipe mobile no `record-session`. Cobri o celular com esse script: partida com cartas, seleção com sheet do inspetor e drawer do rail. **O turno da IA no celular segue sem ser observado.**
- `scrollWidth == clientWidth` confirmado nos 4 cenários do script (360/390, 2D/3D) e a 1280.

## Tabela VA-01..14

| ID | Status | Evidência |
|---|---|---|
| VA-01 console/faixas estourando | **RESOLVIDO** | `current/360x800/game.png`: console em 2 linhas (Round/Your turn + 3 botões de 44px em cima; 3 casas + "End turn" embaixo), nada cortado à direita. `current-3d/360x800/game.png` idem, sem os quadrados vazios de antes. `current/768x1024/game.png`: "End turn" inteiro, casas com rótulo, chaves/âmbar do oponente visíveis. Sem rolagem lateral em 360/390/1280. Os cortes restantes são só reticências, sem perda de função: "Warden'…" e "Choose a h…" na faixa da mão (a instrução completa continua no console: "Choose one house"). |
| VA-02 face sempre legível | **RESOLVIDO** (verificado no cenário sem imagem) | Sem arte, toda carta em campo, na mão e no popover mostra casa, nome, tipo e poder, com armadura quando há (`360-2d-board`, `d-1280-3d-board`). O desktop 3D fica consistente. Com arte (frames oficiais) a arte aparece sem flicker. Detalhe ruim, ver R-03: o selo "2 DMG" cobre o nome da casa. |
| VA-03 leque 3D sem nome | **PARCIAL** | Todas as cartas do leque têm tarja com o nome (`frames-3d/10-…`, `d-1280-3d-board`), e o leque subiu. Mas a tarja agora **cobre o custo**: "0A"/"1A" fica pela metade sob o nome nas cartas não selecionadas (`d-1280-3d-board`, Tremor/Hysteria/Psychic Bug). O custo é informação de decisão. Resolvido o nome, trocado o problema. |
| VA-04 popover enorme/vazio | **PARCIAL** | Com arte (`current/1280x800/inspect.png`) o popover mostra a carta grande e útil. **Sem arte** (`d-1280-2d-hover`, `d-1280-3d-hover`) ele segue com ~330×525 px, agora com a face tipográfica grande (nome/tipo/poder) e **sem o texto de regras** dentro. Ele ainda cobre os botões Deck/Sync do header e o topo do rail (Card Inspector/Undo). O rail entrou no score de sobreposição, mas nesses casos o popover vai para lá mesmo assim. |
| VA-05 profundidade/escala 3D | **PARCIAL** | Melhorou: bordas do trapézio do jogador iluminadas, luz central, cartas ~15% maiores (`d-1280-3d-board`, `frames-3d/29`). Mas a lane do **oponente continua sem trapézio visível**, então a assimetria de profundidade da referência (`arena-ref-1`) não aparece. Quem abre o 3D vê um lado inclinado e o outro chapado. Melhor que antes, abaixo da referência. |
| VA-06 carta invade o console | **RESOLVIDO** | `frames-3d/29`, `d-1280-3d-board`: o topo das criaturas do jogador fica na borda inferior do console, sem tocar os chips de casa. A exausta inclinada (Valdr) também não cruza o console. |
| VA-07 exausta indistinguível | **RESOLVIDO** | 3D: carta inclinada ~20°, borda cinza, dim e selo de giro (↻) (`frames-3d/29`, `d-1280-3d-board`). 2D: selo ↻ e dim (`d-1280-2d-hover`, "The Terror"). Lê "usada" sem esforço. |
| VA-08 duas cartas em cena | **RESOLVIDO** (com ressalva) | `frames-3d/14` e `16`: scrim escurece a mesa, a legenda fica acima da carta em cena e as cartas do plano ficam em segundo plano. Ressalva: a carta em cena usa a face tipográfica mesmo com a arte disponível, ao contrário do campo (R-04). |
| VA-09 "Battleline" duplicado | **RESOLVIDO** | No 3D desktop o "Battleline is clear" saiu e o título do jogador tem folga sob o console (`current-3d/1280x800/game.png`). Sobra só um ruído: o rótulo "YOUR BATTLELINE"/"0 ON TABLE" é cruzado pela linha do trapézio. Ver R-05. |
| VA-10 docks ~110px no celular | **RESOLVIDO** | `current/360x800/home.png` e `config.png`: dock de ~52px sobre a tab bar, o card do 2º deck aparece por cima do conteúdo sem ser engolido. |
| VA-11 cards do Review desalinhados | **RESOLVIDO** | `frames/06-config-review.png`: "Opponent" acompanha o conteúdo, sem o vazio de ~150px. O ritmo da IA ("Warden turns") subiu para dentro da dobra. |
| VA-12 bolinhas de casa no erro do Vault | **RESOLVIDO** | `current/1280x800/browse.png`: só o estado de erro e "Use my saved decks". |
| VA-13 rail cortado sem indício | **NÃO CONFIRMADO / PARCIAL** | O fade só existe com rolagem. Em `frames-3d/19` e `frames/31` o rodapé do rail aparece sem corte visível; no 3D (`frames-3d/14`/`16`) "Card data by Master Vault" segue cortado em y≈780, e o fade não deu para distinguir nos frames estáticos. Precisa de olho em movimento. |
| VA-14 grade de stats | **RESOLVIDO** | `current/360x800/inspect.png`: última linha "Armored / Unique" preenche as duas colunas. "Bonus amber" não quebra mais. |

Resumo: **9 resolvidos, 4 parciais/não confirmados (VA-03, 04, 05, 13), 0 abertos por completo.**

## Regressões novas

| ID | Sev. | O que | Evidência |
|---|---|---|---|
| R-01 | **Média** | A tarja do nome no leque 3D cobre o custo da carta (efeito colateral do VA-03). | `d-1280-3d-board`, `frames-3d/19` |
| R-02 | **Baixa** | No drawer do rail no celular, os divisores de seção terminam em larguras diferentes (~290/595/215/490 px de 720). Pode ser captura no meio da transição, já que a animação estava ligada; não comprovei. A função está toda presente (Undo, log, IA, regras), só o acabamento está em dúvida. | `360-2d-drawer` |
| R-03 | **Baixa** | O selo "2 DMG" cobre o nome da casa da carta (BRO…, L…, D…), sobretudo no celular. A casa também aparece no ícone/cor, então não bloqueia. | `360-2d-board`, `d-1280-*-board` |
| R-04 | **Baixa** | A carta "em cena" da IA usa a face tipográfica mesmo com arte carregada, e cobre o chip da casa ativa no console durante a batida. Não compromete a leitura com o scrim. | `frames-3d/14`, `16` |
| R-05 | **Baixa** | No 3D desktop a linha do trapézio cruza o "0 ON TABLE"/"YOUR BATTLELINE". Sem o "Battleline is clear", a lane vazia do oponente fica só como uma faixa escura sem pista. O jogo inicial lê vazio demais. | `current-3d/1280x800/game.png` |
| R-06 | **Baixa** | No celular, o nome das cartas da mão fica colado à tab bar. A trilha rola, mas nenhuma carta ganha altura extra. | `360-2d-board` |

Os itens que você perguntou:

- **Console de 2 linhas no mobile:** não aperta nada relevante. As 3 casas e o "End turn" ficam ≥44px.
- **Scrim da IA:** escurece o suficiente, sem afogar a mesa. O placar e a mão seguem legíveis.
- **Drawer/dock de 52px:** nenhuma ação necessária ficou escondida. O drawer tem Undo, log, IA e regras.
- **"Battleline is clear" removido:** piora só o primeiro segundo da partida 3D desktop (R-05).

## O que os fixes não cobriram

1. Partida mobile **durante o turno da IA** (legenda, scrim, "Seu turno"). O harness não grava mobile. Ainda é lacuna de cobertura.
2. O popover sem arte continua cobrindo o rail (VA-04) e o texto de regras não entra.
3. A assimetria de profundidade do oponente no 3D (VA-05).
4. Fade do rail em movimento (VA-13) e o acabamento do drawer (R-02): só dá para fechar com vídeo ou um print durante a transição.
5. Não testei Vault com a API viva, o tutorial de primeira vez e o loading.

## VEREDITO FINAL

**Desktop: PRONTO COM PENDÊNCIAS.** O 2D está polido e o 3D ganhou legibilidade real: face sempre presente, exausta clara, cena da IA organizada, carta fora do console. Pendências, em ordem de peso: (1) tarja do nome cobrindo o custo no leque 3D (R-01); (2) popover sem arte cobrindo o rail e o header; (3) lane do oponente sem trapézio, então a profundidade é só pela metade.

**Mobile: PRONTO COM PENDÊNCIAS.** O bloqueador anterior (VA-01) foi resolvido. Partida, seleção, sheet do inspetor, drawer e docks funcionam em 360/390, sem rolagem lateral. O que impede o "PRONTO" puro é não ter sido observado o turno da IA no celular e o acabamento do drawer (R-02).

Nenhum dos itens acima impede jogar. Recomendo fechar R-01 (subir a tarja ou mover o custo para fora dela) e gravar um clipe mobile antes de declarar o visual encerrado.

## Rodada de acabamento

| Item | Resultado | Evidência |
|---|---|---|
| R-01 | **RESOLVIDO** — `padding-bottom: 28px` no `.card-fallback` do leque 3D (`src/index.css`, bloco "R-01"): o rodapé da face sobe acima da tarja. Com arte, o custo fica no canto superior esquerdo, livre. Nome e custo legíveis juntos. | `frames-1279x800-3d/08-board-start`, `frames-768x1024-3d/08-board-start` |
| R-05 | **RESOLVIDO** — o `empty-battleline` do oponente volta em billboard com opacity .55 ("Battleline is clear"); o do jogador segue oculto. Sem nada entre `.table-plane` e as peças que achate o 3D (`_3d-chain` OK). | mesmos frames |
| Gravação mobile | **FEITA** — `record-session --viewport 360x844` (touch, sem rail/log/Vault). O WIP não aplicava o argumento no `main` e chamava `finishRecording` inexistente; corrigidos. Cobre partida, carta selecionada + sheet do inspetor e turno da IA (legenda "The Ember Warden played …"). | `e2e/clips/session-360x844.webm`, `frames-360x844/10`, `13` |

Limites: o leque foi conferido a 1279x800 e 768x1024 (não 1280x800, para não sobrescrever `session-1280x800-3d`); a 768 o harness falha no painel de log (rail vira drawer), depois dos frames do board. Bundle: 149,55 kB gz.
