# UX Review — Aember Arena (sessão gravada, 28/09/2026)

Análise da sessão `e2e/clips/session-1280x800.webm` (81 s, 1280×800) e dos 32 frames-chave
em `e2e/clips/frames/`. O vídeo foi assistido quadro a quadro (1 fps na sessão inteira;
4 fps no mulligan e no turno da IA), com recortes ampliados das cartas no board para
checar se os estados são legíveis. Os timestamps são aproximados (`≈mm:ss`).

Todo o polish anterior foi considerado (POLISH_REPORT, FEAT-01..15, BUG-01..25) e não
é proposto de novo. Também há missões na fila que cobrem parte do "como" — **ANIM**
(animações estilo Arena + ritmo da IA), **AUDIO** (o dono não ouve som nenhum) e
**TUTORIAL**. Onde este review toca o mesmo assunto, o que ele entrega são **requisitos
de UX** (o que o jogador precisa perceber); a técnica fica com essas missões.

### Limites desta gravação (ler antes de concluir qualquer coisa)

- Gravada com `animations: false`, `reducedMotion: "reduce"`, sfx e música **off**. Nada
  de movimento ou som pôde ser avaliado. Os pops do placar (P1-4), por exemplo, não
  aparecem. Mesmo assim o vídeo mostra como fica o jogo **sem** esses efeitos, e é
  exatamente isso que um usuário com reduced-motion vê, ou o dono enquanto o áudio está
  quebrado.
- Dev server (vite): os primeiros ≈11 s são tela branca/preta de carregamento. Isso **não**
  representa o build single-file e não entra no diagnóstico.
- Quem joga é um bot, com pausas fixas de 0,6–1,2 s. Só 2 turnos: não houve **luta**,
  **forja de chave**, fim de partida nem estatísticas. Esses momentos ficam para uma
  próxima gravação (ver o fim do documento).

### Linha do tempo da sessão

| t | Momento | Frames |
|---|---|---|
| ≈0:11–0:17 | Home, scroll para baixo e para cima | 01, 02, 03 |
| ≈0:17–0:24 | Wizard de setup, 6 passos | 04, 05, 06 |
| ≈0:25–0:28 | Mulligan (humano) e depois "Warden is thinking" (mulligan da IA) | 07 |
| ≈0:28–0:35 | Turno 1: casa, inspeção, jogar 1 carta | 08, 09, 10, 11 |
| ≈0:35–0:37,5 | **Turno inteiro da IA (≈2 s)** | 12, 13, 14 |
| ≈0:38–0:53 | Turno 2: casa, colher, 3 cartas, alvo | 15–24 |
| ≈0:53–0:59 | Scroll do board/rail, log completo e filtrado | 25–28 |
| ≈0:60–1:21 | Home com partida em andamento, Vault, Home | 29–32 |

---

## 1. Diagnóstico por momento da sessão

### 1.1 Home (`01-home.png`, `02-home-scrolled-bottom.png`, `03-home-back-top.png`, ≈0:11–0:17)

- **Nada rola a 1280×800.** 02 e 03 têm exatamente o mesmo tamanho de arquivo: o gesto de
  scroll não produziu nada. Isso é bom (tudo cabe), mas a Home inteira é uma escolha
  entre **dois decks** e três cards de navegação, e o único CTA é **"Continue to setup"**.
  Não existe "Jogar agora". Quem já configurou uma vez passa por mais 6 passos toda vez
  (ver 1.2).
- **A arte chega atrasada.** Em 01 as capas dos dois decks são retângulos marrom/roxo; em
  02, ≈2 s depois, a arte aparece. O primeiro frame da marca é um placeholder.
- **Voltar à Home com partida em andamento** (`29-home-return.png`, ≈1:00): a faixa dourada
  do topo diz **"Replay last match"**, com a partida viva no Round 02. Não há "Retomar
  partida" em lugar nenhum da Home. O CTA dominante continua sendo "Continue to setup",
  que leva a uma partida **nova**. O único caminho de volta é a aba "Play" do header, que
  nem está destacada. Um jogador que saiu para olhar o Vault pode achar que perdeu a
  partida, ou começar outra sem querer (FEAT-15 confirma o abandono, mas a pergunta
  certa aqui é "onde está minha partida?").

### 1.2 Setup (`04-config-mode.png`, `05-config-difficulty.png`, `06-config-review.png`, ≈0:17–0:24)

- **Seis passos entre querer jogar e jogar:** Mode, Difficulty, Opponent, Thinking,
  Experience, Review. O bot, que não pensa, levou ≈7 s. Para uma partida solo casual isso
  é um formulário, não um lobby.
- **"Thinking" é um passo separado de "Difficulty"**, e em 05 a dificuldade já descreve a
  profundidade ("Deeper tactical search…"). O card "Minimax + alpha-beta pruning" em 05 é
  jargão de implementação e não ajuda o jogador a escolher.
- **O oponente padrão é espelho.** Em 06: "Deck: Dr. 'The Old' Jeffries" contra "Deck:
  Dr. 'The Old' Jeffries". No board isso vira "Warden's mirror deck" (07). Contra o
  mesmo deck, a partida parece jogar contra si mesmo, e a IA usa as mesmas cartas que o
  jogador acabou de ler (Doc Bookton, Psychic Bug…). Há um segundo deck inicial pronto
  (Shadowmaster Desmares), que seria o default natural.
- **Rótulos de navegação incoerentes.** O header diz "Settings" (04–06), a tela diz "Match
  setup", o breadcrumb da Home diz "2 Match setup". O jogador procura "Settings" para
  mudar volume e cai num wizard de partida.
- **"Start match" meio fora da dobra** a 1280×800 (06: o botão começa em y≈758, com a
  base cortada pela borda da janela). O CTA mais importante da tela está no limite.
- **"22/36 with simulated effect"** (06) é honesto, mas só existe aqui e no inspetor.
  Mais sobre isso em 1.4 e na melhoria 5.

### 1.3 Mulligan (`07-mulligan.png`, ≈0:25–0:28)

- **Pede-se para julgar uma mão que não está visível.** O diálogo "Keep this hand?" fica
  no centro do board **vazio**. As 7 cartas estão na base da janela, com ≈70 px de altura
  visíveis, e em ≈0:25,5 ainda são **retângulos coloridos sem arte** (a arte chega
  ≈1 s depois). É a primeira decisão do jogo, e é tomada às cegas: seria preciso fechar o
  diálogo para ver a mão, e fechar significa "keep".
- O texto "Mulligan once to shuffle it back and draw one card fewer" é bom, mas falta o
  resumo que decide um mulligan no KeyForge: **quantas cartas de cada casa** e quantas
  criaturas.
- ≈0:27: aparece um segundo diálogo, "Warden is thinking" (mulligan da IA), e some em
  ≈0,5 s. O resultado vai só para o log ("The Ember Warden took a mulligan", 08). O
  jogador não vê a IA "decidir"; ele vê um diálogo piscar.

### 1.4 Turno humano (`08`–`11`, `15`–`24`, ≈0:28–0:35 e ≈0:38–0:53)

**Escolher casa (08, 09)**
- Os chips "Brobnar / Dis / Logos" (08) mostram **só o nome**. Para escolher, o jogador
  precisa varrer 7 cartas pequenas, cortadas pela dobra, e contar cores. A dica "Choose
  a house to unlock cards from that house" (08) diz **o que** fazer, mas não dá a
  informação para decidir.
- A escolha em si tem boa resposta visual (09: chip ativo com ✓, os outros apagados, as
  cartas de outras casas esmaecidas).

**Jogar uma carta (10, 11, 18, 20, 22)**
- **As ações ficam longe da carta.** O fluxo é: clicar na carta da mão (10: Veylan Analyst
  em x≈375, y≈700) e depois ir até o rail para "Play card" (x≈1033, y≈442). São ≈700 px
  de mouse **para cada ação**, e o bot repetiu isso 5 vezes em 2 turnos. No turno 2
  (18→19→20→21→22→24), o olhar alterna mão → rail → board → rail a cada jogada. É a
  principal fonte de "o jogo é lento de jogar".
- **Duas lentes para a mesma coisa.** Ao selecionar, aparece o hover-zoom grande sobre o
  board (10, 16, 18, 20, 22) e, ao mesmo tempo, o inspetor no rail mostra a mesma arte,
  o mesmo texto e o mesmo nome. Informação duplicada, e o zoom **cobre coisas
  importantes**: em 22 cobre o placar do jogador ("0/3 · 2 AEMBER" some atrás da carta);
  em 18 cobre a criatura Veylan Analyst no board; em 24 o zoom de Doc Bookton cobre o nav
  do header.
- **"Discard" tem o mesmo peso de "Play card"** (10, 18, 20, 22: dois botões iguais lado a
  lado). O undo reduz o dano, mas o erro nem deveria ser fácil.
- **A mão vive na dobra.** Em 08 aparece só o topo das cartas. Depois do auto-scroll
  (10), os nomes debaixo das cartas ficam cortados ("Key to Dis", "Hand of Dis" em
  y≈793). Já é um ponto aberto no CLAUDE.md; o vídeo mostra o custo em movimento: a
  página **pula** entre 08 (título visível) e 10 (título sumiu, board subiu ≈90 px) no
  instante em que o jogador seleciona a carta.

**Colher (16, 17)**
- Depois de "Reap for 1 amber" (16), a criatura em 17 **tem exatamente a mesma aparência de
  antes**. O recorte ampliado de Veylan Analyst em 17 não mostra rotação, selo "exausta"
  nem dessaturação perceptível. O único sinal é o âmbar, que passa de 0 para 1 **sem
  delta, sem origem, sem movimento**.
- O jogador não consegue responder, olhando para o board, à pergunta básica do KeyForge:
  **"quem ainda pode agir este turno?"**.

**Jogar uma ação (18 → 19)**
- Scrambler Storm (18) diz "Play: Your opponent cannot play action cards on their next
  turn", com selo **VANILLA** ("Text not simulated"). Depois de jogada (19), a carta
  desaparece da mão, o âmbar vai de 1 para 2 e **nada no board lembra do efeito**. Mesmo
  se ele fosse simulado, não há indicador de efeito persistente ("sem ações no próximo
  turno") no placar de nenhum dos lados.
- **Das 5 cartas que o jogador tocou nesta sessão, 3 não funcionam por completo:**
  Veylan Analyst (VANILLA, 10), Scrambler Storm (VANILLA, 18) e Experimental Therapy
  (PARTIAL, 22). O jogador só sabe disso se ler o selo pequeno no inspetor **depois** de
  escolher a carta. A sensação resultante é "o jogo está quebrado", mesmo com a
  honestidade técnica do selo.

**Escolher alvo (23 → 24)**
- O prompt "Choose a highlighted card as the target", centralizado entre as lanes (23), é
  claro. Os alvos válidos têm borda laranja fina. O botão "Cancel target" no rail
  funciona, mas de novo fica longe.
- **Onde foi parar o upgrade?** Experimental Therapy (um **Upgrade**, 22) foi posta num
  alvo. Em 24/25, a carta aparece como **uma peça solta na battleline do jogador**
  ("Experimental …", terceira carta), e o contador diz "3 ON TABLE". Nada liga o upgrade
  à criatura que o recebeu. O recorte ampliado (25) de Doc Bookton, que o bot clicou como
  alvo, não mostra selo de atordoado nem de exausto. O jogador não sabe onde está o
  upgrade nem o que ele fez.

**Placar**
- Com a página rolada (19, 22, 23, 24, 25) o **placar do Warden some** pelo topo: só
  sobra uma borda em y≈60. Durante o próprio turno, o jogador não vê o âmbar e as chaves
  do adversário, justamente o que decide "corro para forjar ou seguro o board?".
- O medidor de âmbar até 6 (P1-4) existe: é o traço dourado debaixo do número (17, 19, 25).
  A 1280×800 ele parece um sublinhado decorativo e ninguém o lê como "faltam 4 para a
  chave".
- O marcador de jogador ativo é um **raio de 16 px** ao lado do nome (08: ao lado de "You";
  12: ao lado de "The Ember Warden"). É o único sinal de posse do turno no placar, e é
  pequeno demais.

**Densidade**
- Em 07/08 o título grande "SOLO MATCH — TABLE 01 / Dr. 'The Old' Jeffries" e o chip
  "ROUND 01 / Your turn" (canto superior direito) **duplicam** a faixa "ROUND 01 / Your
  turn" do meio do board, e empurram a mão para baixo. O P1-3 removeu o chip só no mobile.
- O rail gasta altura com "TABLE NOTES 01", com o bloco "THE EMBER WARDEN / Medium / 2
  plies" e com o rodapé "Card data by Master Vault / Offline-ready table" (08, 26). Nada
  disso é informação de jogo.

### 1.5 Turno da IA (`12-turn-ended.png`, `13-ai-turn-live.png`, `14-ai-turn-done.png`, ≈0:35–0:37,5)

Esta é a parte mais fraca da sessão. Quadro a quadro, a 4 fps:

| t | O que a tela mostra |
|---|---|
| ≈0:35,5 | O jogador clica End turn |
| ≈0:35,75 | Status "**Opponent turn** / Choose one house", com os 3 chips de casa **acesos** (parece que o jogador precisa escolher) |
| ≈0:36,0 | Status muda para "**Warden is thinking**" (outro rótulo para o mesmo estado); o chip Logos aparece marcado, mas agora é a casa **da IA**, e nada diz de quem é |
| ≈0:37,0 | Doc Bookton surge na lane do Warden **como um retângulo sem arte** |
| ≈0:37,5 | Psychic Bug surge (também sem arte), o âmbar do Warden vai de 0 para 1, e o status já mostra "**ROUND 02 / Your turn / Choose one house**", **tudo no mesmo quadro** |

- **O turno inteiro da IA dura ≈2 s**, e a segunda jogada chega **junto** com a devolução
  do turno. Não há um momento "a IA jogou X". 13 e 14 são bytes idênticos: o turno
  acabou antes de o gravador conseguir mostrá-lo.
- A primeira aparição de uma carta inimiga é **um retângulo vazio** (a arte não estava
  pré-carregada, mesmo sendo o deck espelho). O momento de revelação, o mais dramático
  do turno do adversário, é o pior frame visual da partida.
- A única narrativa do que aconteceu fica **no log do rail**, a ≈450 px do board, em
  texto de 11–12 px, em ordem mais-recente-primeiro. Para saber "por que o Warden tem 1
  âmbar?", o jogador precisa ler 4 linhas de baixo para cima (13).
- A faixa de casa **reaproveita os chips do jogador** para mostrar a casa da IA. Com deck
  espelho (mesmas 3 casas), isso fica ambíguo.
- Não há transição de "Seu turno". Em 13, o botão End turn volta a ficar ativo e a
  faixa troca o texto. É fácil não perceber que a IA terminou, e também fácil achar que
  "nada aconteceu".

### 1.6 Log (`27-log-panel.png`, `28-log-filtered.png`, ≈0:55–0:59)

- O log completo funciona: filtros por lado e por ação, agrupamento por round ("ROUND 02",
  "ROUND 01"). Em 28, o filtro Warden + Play mostra exatamente as 2 jogadas da IA.
- **Falta causa e efeito.** As linhas são "The Ember Warden played Psychic Bug." sem o
  resultado (+1 Æ, alvo, efeito). O único delta de âmbar do turno da IA (0→1) não
  aparece em linha nenhuma, e o log não responde "de onde veio esse âmbar?".
- **As linhas não são clicáveis.** Clicar em "played Doc Bookton" não destaca nem inspeciona
  a carta, quando a ponte log → board é justamente o que faria o log explicar o turno da
  IA.
- O log abre **no lugar do inspetor/rail** (27). Com o log aberto, o jogador perde o
  inspetor; é um modo, não um painel de consulta.
- O filtro "Forge" existe, mas nada no fluxo mostrou forja. Não foi avaliado.

### 1.7 Vault (`30-vault.png`, `31-vault-scrolled.png`, ≈1:01–1:12)

- **≈5 s de skeleton** (≈1:01–1:06) antes dos resultados, e depois ≈1 s de capas vazias
  (30: 9 retângulos de gradiente) até a arte chegar (31). Para "ver decks" é aceitável
  (é rede), mas o skeleton não diz o que está carregando nem quanto falta.
- "Page 1 of 5,000" e "3,606,408 decks" impressionam, mas **não ajudam a escolher um deck
  para jogar**. Nenhum tile diz se o deck vai funcionar bem no motor: a cobertura
  "22/36 simulated" (06) é a informação mais relevante para este produto, e aparece só
  depois de importar.
- As casas nos tiles são só ícones de 22 px, sem nome. Fica difícil para quem não
  decorou os 13+ emblemas.
- "Select" em cada tile tem o mesmo peso de "Explore". Para 3,6 milhões de decks
  desconhecidos, o caminho natural seria explorar e depois selecionar.

---

## 2. Top 8 melhorias de UX (ranqueadas por impacto/esforço)

Impacto: **A**lto / **M**édio. Esforço: **P**equeno / **M**édio / **G**rande.

### #1 — Dar palco ao turno da IA (Impacto A · Esforço M)

- **Problema:** o turno inteiro do Warden (mulligan de casa + 2 criaturas + 1 Æ) passa em
  ≈2 s. A segunda jogada chega no mesmo quadro que "Your turn", as cartas surgem sem
  arte, e a explicação fica num log a 450 px de distância (12→13, ≈0:35,5–0:37,5).
- **Por que dói:** *visibilidade do estado* e *timing*. Num jogo por turnos, o turno do
  oponente é metade da partida e é quando o jogador aprende a ameaça. Ao voltar, ele não
  sabe o que mudou e precisa fazer diff visual do board sozinho. A sensação de "o jogo é
  ruim" nasce muito aqui.
- **Solução:**
  1. Cada ação da IA vira uma **batida de 700–900 ms**. A carta jogada aparece grande
     (≈1,5×) ao lado da lane do Warden com a legenda "Warden joga **Doc Bookton**" e
     depois assenta no slot. Colheita/luta: a criatura pulsa, e o "+1 Æ" voa até o
     placar do Warden.
  2. A escolha de casa da IA vira um **selo no placar do Warden** ("Logos"), não os chips
     do jogador. Um único rótulo de estado ("Vez do Warden") em vez de "Opponent turn"
     seguido de "Warden is thinking".
  3. Ao final: um **banner "Seu turno"** de ≈900 ms e um **resumo do turno** que fica na
     faixa do round até a primeira ação do jogador: "Warden: jogou 2 criaturas · +1 Æ ·
     casa Logos".
  4. **Clique em qualquer lugar = acelerar** (pula para o fim da batida atual); uma
     opção "Velocidade da IA: normal/rápida" em Settings.
  5. **Pré-carregar a arte do deck do oponente** na tela de mulligan, porque o deck é
     conhecido desde o setup.
  6. Com reduced-motion / animações off, **as batidas continuam** (tempo, não movimento):
     troca de estado com destaque estático e pausa. O jogador com movimento reduzido
     precisa do ritmo tanto quanto os outros.
  - A mecânica de animação é da missão **ANIM**. Este item define o contrato de UX:
    uma ação por batida, legenda, resumo persistente, pular.
- **Como validar:** regravar a sessão com animações ON e OFF e medir o tempo por ação da
  IA (alvo ≥ 700 ms). Teste de recordação com 3–5 pessoas: depois do turno da IA,
  perguntar "o que o Warden fez?" (alvo ≥ 80% de acerto sem abrir o log; hoje depende
  do log).

### #2 — Ações na própria carta, não no rail (Impacto A · Esforço M)

- **Problema:** cada jogada = clicar na carta, cruzar ≈700 px até o inspetor, clicar
  "Play card"/"Reap". Foram 5 viagens em 2 turnos (10, 16, 18, 20, 22). "Cancel target"
  também fica no rail (23).
- **Por que dói:** *Lei de Fitts* e *carga cognitiva*. O olhar sai da mesa a cada ação e o
  ritmo de jogo quebra. Hearthstone e Arena mantêm a ação **onde está a carta**.
- **Solução:** ao selecionar, abrir uma **barra de ação ancorada na carta** (acima da mão,
  ou abaixo da criatura no board) com os mesmos botões do inspetor: "Jogar · Descartar"
  na mão; "Colher · Lutar · Ação" no board. O inspetor continua no rail como leitura.
  Atalhos: **duplo clique = ação primária** (Jogar / Colher), **arrastar da mão para a
  battleline = jogar**, incluindo o flanco (esquerdo ou direito conforme onde soltar,
  que no KeyForge importa). "Descartar" vira botão secundário menor, à parte do
  primário. No touch, o long-press → lightbox continua; o tap abre a barra ancorada.
- **Como validar:** cronometrar um turno scriptado de 4 ações (colher + 3 jogadas), antes e
  depois. Alvo: −40% de tempo e de distância de ponteiro. Checar 44 px e o piso de 11 px
  na barra ancorada com `e2e:floor`.

### #3 — Estado das criaturas legível à primeira vista (Impacto A · Esforço P)

- **Problema:** depois de colher, Veylan Analyst fica **igual** a antes (17, recorte
  ampliado). Doc Bookton, alvo de "Stun and exhaust", não mostra selo (25). O upgrade
  Experimental Therapy aparece como **peça solta** na battleline do jogador, contando em
  "3 ON TABLE", sem ligação com o hospedeiro (24/25).
- **Por que dói:** *visibilidade do estado*. "Quem ainda pode agir?" e "quem está
  atordoado?" são as perguntas centrais de cada turno de KeyForge, e hoje só são
  respondidas pelo `aria-label` ou clicando carta por carta.
- **Solução:**
  - **Exausta:** a carta gira ≈90° (a convenção física do KeyForge; se o layout não
    comportar, ≈15° + 35% de dessaturação) e ganha o chip "EXAUSTA" com o piso de 10 px
    caps.
  - **Atordoada:** um **token** sobre a arte (ícone de estrela/espiral + borda
    tracejada), visível no tamanho do board.
  - **Upgrades:** renderizados **encaixados sob a criatura hospedeira** (uma faixa de
    ≈18 px com o nome aparecendo por baixo), fora da contagem "on table". Ao passar o
    mouse ou tocar, os dois se destacam juntos.
  - **Pronta para agir** no turno do jogador (casa ativa, não exausta): um brilho sutil de
    borda. Isso é diferente do highlight de *dicas* (FEAT-04), que sugere a *melhor*
    jogada; aqui é só o estado.
- **Como validar:** teste de 5 segundos com um screenshot de board com 4 criaturas em
  estados mistos: "quais podem colher agora?" (alvo 100%). Regravar e conferir no
  recorte ampliado que exausta/atordoada são distinguíveis a 1280 e a 360.

### #4 — Mulligan com a mão à vista e resumo de casas (Impacto A · Esforço P)

- **Problema:** "Keep this hand?" é decidido com a mão a ≈70 px de altura na base da janela
  e, no primeiro segundo, sem arte (07, ≈0:25,5). A mão continua na dobra durante o jogo
  (08) e a página salta quando se seleciona uma carta (08→10).
- **Por que dói:** *reconhecimento em vez de lembrança* e *visibilidade*. A primeira
  decisão da partida é tomada no escuro, o que passa a sensação de desleixo logo no
  primeiro minuto.
- **Solução:**
  - O **próprio diálogo de mulligan mostra as 7 cartas** em leque, legíveis (≈120 px de
    largura a 1280), com a linha "Brobnar 2 · Dis 2 · Logos 3 · 4 criaturas" e um toque
    na carta para abrir o lightbox. O diálogo só aparece quando a arte da mão carregou
    (ou mostra a arte com fade-in, nunca retângulos).
  - No board, **a mão sempre visível no turno do jogador**: a battleline vazia colapsa
    para ≈64 px ("Battleline is clear" não precisa de 150 px), o título grande da partida
    e o chip "ROUND / Your turn" do canto saem no desktop (a faixa do meio já diz isso),
    e nada de auto-scroll que desloque o board ao selecionar.
- **Como validar:** a 1280×800 e a 360×800, medir que a base das cartas da mão fica
  ≤ viewport no início do turno (adicionar ao `e2e:acceptance`). No frame do mulligan,
  os 7 nomes legíveis.

### #5 — Toda jogada fecha com um "resultado" visível, e cartas não simuladas avisam antes (Impacto A · Esforço M)

- **Problema:** Scrambler Storm some e o âmbar muda de 1 para 2 sem explicação (18→19);
  "Reap" muda o número sem origem (16→17). Efeitos persistentes ("sem ações no próximo
  turno") não deixam rastro. Das 5 cartas tocadas na sessão, 3 eram VANILLA ou PARTIAL, e
  isso só se descobre no inspetor, **depois** de escolher a carta (10, 18, 22).
- **Por que dói:** *feedback* e *modelo mental*. Se o jogador não vê a causa do número, não
  aprende o deck. Se a carta não faz o que diz o texto e ele só descobre depois, conclui
  que o jogo está quebrado.
- **Solução:**
  - **Faixa de resolução** logo acima da faixa do round, 1,5 s por jogada: "Scrambler
    Storm → +1 Æ (bônus)". "Reap: Veylan Analyst → +1 Æ". Se o efeito não for simulado,
    ela diz isso: "Scrambler Storm → +1 Æ · efeito do texto não simulado".
  - **Números com delta:** "+1" flutuando no contador de âmbar, na cor do dono.
  - **Efeitos persistentes** como chips no placar do afetado: "Sem ações no próximo
    turno", com a carta de origem no tooltip ou no tap.
  - **Cobertura antes da escolha:** um glifo discreto no canto da carta na mão para
    VANILLA/PARTIAL (≈ ou meia-lua, com `aria-label` via `t()`), e a mesma marca na linha
    do log. No setup, "22/36 with simulated effect" vira link para a lista das 14.
- **Como validar:** após 1 turno, perguntar "de onde vieram seus 2 âmbares?" (alvo:
  resposta correta sem abrir o log). Checar que toda linha de log com mudança de
  âmbar/chave mostra o delta.

### #6 — Escolha de casa informada e com prévia (Impacto M-A · Esforço P)

- **Problema:** os chips (08, 15) mostram só "Brobnar / Dis / Logos". Para decidir, o
  jogador conta cores em cartas pequenas cortadas pela dobra. No turno 2 também é preciso
  lembrar de qual casa são as criaturas **prontas** no board.
- **Por que dói:** *carga cognitiva*. É a decisão mais importante de cada turno de
  KeyForge, e hoje exige contar e lembrar.
- **Solução:** cada chip mostra contagens, por exemplo "Logos · 3 na mão · 1 pronta". Ao
  passar o mouse ou focar o chip (ou no primeiro tap no touch), fazer **prévia**:
  destacar as cartas da mão e as criaturas daquela casa e esmaecer o resto, **sem
  confirmar**. Confirmar é clicar de novo ou no ✓.
- **Como validar:** medir o tempo do início do turno até a escolha da casa (gravação com
  humano). Teste: "qual casa te deixa jogar mais cartas?" com 3 s de exposição.

### #7 — Placar dos dois lados sempre visível, e o zoom não o cobre (Impacto M · Esforço P)

- **Problema:** com a página rolada, o âmbar e as chaves do Warden saem da tela (19, 22–25).
  O hover-zoom cobre o placar do jogador (22) e as próprias criaturas (18), e duplica o
  inspetor. O marcador de turno é um raio de 16 px (08/12). O medidor até 6 parece um
  sublinhado.
- **Por que dói:** *visibilidade do estado*. "Quanto falta para ele forjar?" é a pergunta
  de risco de toda jogada.
- **Solução:**
  - **Barra de placar compacta e sticky** no topo da coluna do board: "Warden 1 Æ ·
    0/3 🔑 | Você 2 Æ · 0/3 🔑", com o medidor explícito "2/6". Quem tem o turno fica
    com fundo aceso, não com um ícone de 16 px.
  - **Zoom:** suprimido para a carta que já está no inspetor. Nos outros casos, abrir
    **lateralmente**, com área de exclusão sobre o placar e a faixa do round.
- **Como validar:** em qualquer scroll do board a 1280×800 e a 360×800, os dois placares
  continuam visíveis (assert no harness). Em nenhum frame de hover o zoom intersecta
  `.amber-counter`.

### #8 — Entrada rápida, retomar partida e oponente não-espelho (Impacto M · Esforço P)

- **Problema:** 6 passos de wizard a cada partida (04–06). O oponente padrão é o próprio
  deck (06/07). Com partida em andamento, a Home oferece "Replay last match" e "Continue
  to setup", e não "Retomar" (29). O header chama o wizard de "Settings".
- **Por que dói:** *atrito* e *prevenção de erro*. O caminho mais curto para jogar deveria
  ser 1 clique, e o mais perigoso (abandonar sem querer) não deveria ser o dominante.
- **Solução:**
  - Home: **"Jogar agora"** (CTA primário) com a última configuração e um resumo de uma
    linha ("vs Warden · Medium · Shadowmaster Desmares"). O wizard vira "Personalizar
    partida".
  - Com partida viva: a faixa superior vira **"Partida em andamento — Round 02 · você 2 Æ
    × 1 Æ — Retomar"**, e "Replay last match" só aparece depois do fim.
  - Default do oponente: **o outro deck inicial**, não o espelho.
  - Juntar **Difficulty + Thinking** num passo só; tirar o card "Minimax + alpha-beta" (ou
    movê-lo para um "Detalhes" recolhido). Renomear a aba do header para "Partida" ou
    "Setup".
- **Como validar:** contar cliques da Home até a primeira carta jogada (hoje ≈9; alvo ≤ 3
  para quem retorna). Teste: sair da partida para o Vault e voltar. Alvo: 100% acham o
  "Retomar" em ≤ 5 s.

---

## 3. Microinterações ausentes

Comparação em espírito com Hearthstone e MTG Arena: o que eles fazem **barato** que falta
aqui. Itens já ligados às missões ANIM e AUDIO estão marcados. Aqui o registro é **o que o
jogador deveria sentir**; a implementação é delas.

| Momento | O que falta | Referência |
|---|---|---|
| Hover na mão | A carta **sobe** ≈12 px e endireita (hoje só abre o zoom, 10) | Hearthstone: mão em leque que "respira" |
| Selecionar carta | Aura/glow na carta escolhida, distinta do marcador de dica (ANIM) | Arena |
| Jogar carta | Sai da mão → centro → slot (ANIM). Sem animação: um **flash de pouso** no slot | Arena |
| Colher | Âmbar **voa** da criatura ao contador; chime cristalino (AUDIO) | Hearthstone: mana/armor com partícula |
| Delta de âmbar | "+1"/"−2" flutuante no contador, na cor do dono (#5) | Os dois |
| Alvo | **Linha/seta** da carta de origem até o cursor durante o pick (23 tem só a borda laranja) | Hearthstone: seta de alvo |
| Luta (não gravada) | Números de dano sobre as criaturas, tremida no impacto, morte com fade/queima | Hearthstone |
| Exausta | Rotação com transição de ≈200 ms quando a criatura age (#3) | Convenção física do KeyForge |
| Forja de chave (não gravada) | Momento de palco: a chave acende no centro por ≈1 s antes de ir ao placar; fanfarra de 3 notas (AUDIO) | Arena: "momento de life total" |
| Fim de turno | Se ainda há criaturas prontas ou cartas jogáveis, o botão End turn mostra "2 ações disponíveis" em vez de confirmar em modal; quando **não resta nada**, ele pulsa (sem animação: muda para cor primária) | Hearthstone: botão "END TURN" fica verde quando não há jogadas |
| Início do turno | Banner "Seu turno" + compra da mão visível (as cartas entram) + tick no "29 IN DECK" | Os dois |
| IA decidindo | "Presença" no avatar do Warden (anel girando) em vez de um diálogo que pisca (07, ≈0:27) | Arena: indicador do oponente |
| Clique inválido | Carta esmaecida de outra casa: tremida curta + dica "Só Logos este turno" em vez de nada | Arena: carta volta à mão |
| Log | Hover/tap numa linha destaca a carta no board (#1.6) | Arena: game log com highlight |
| Mulligan | Embaralhamento visível das cartas voltando ao deck; som de shuffle (AUDIO) | Hearthstone: mulligan com as cartas "voando" |
| Carregamento de arte | Fade-in da arte em vez de pop de retângulo → imagem (07, 13, 30) | Qualquer jogo polido |

---

## 4. O que está BOM (não regredir) e o que eu descartaria

### Manter

- **Identidade visual.** O feltro verde-petróleo com dourado e as serifas nos títulos têm
  cara de mesa de jogo, não de dashboard (08, 13). As artes reais das cartas carregam
  a experiência.
- **Travamento de casa** (09): chip escolhido com ✓, os outros apagados, cartas fora da
  casa esmaecidas. Feedback imediato e claro.
- **Prompt de alvo** centralizado entre as lanes (23): diz o que fazer, no lugar certo.
- **Selo de cobertura do motor** no inspetor (FULL EFFECT / PARTIAL / VANILLA com uma
  frase, 10/20/22): honesto e sem hover. O problema é só o **momento** em que aparece (#5).
- **Undo** visível, desabilitado no início do turno e habilitado depois de cada ação (15→17).
- **Log ao vivo** com a mais recente em destaque, agrupado por round, com filtros de lado
  e de ação que funcionam (27/28).
- **Review do setup** (06): o resumo de deck + oponente + interface antes de começar é
  bom. Ele só deveria ser o **ponto de partida** do "Jogar agora", não o fim de um
  wizard.
- **Vault**: grid limpo, paginação ‹ 1 2 3 4 … 5000 ›, sort em chips, skeleton em vez de
  tela vazia (30/31).
- **Contagens de zona** ("2 ON TABLE", "29 IN DECK", "YOUR HAND 6 CARDS"): informação
  certa. Só precisa excluir upgrades (#3).

### Descartaria

- **O título grande "SOLO MATCH — TABLE 01 / nome do deck" e o chip "ROUND 01 / Your
  turn"** no desktop (07/08): duplicam a faixa do round e custam a mão.
- **"TABLE NOTES 01"** e o rodapé **"Card data by Master Vault / Offline-ready table"**
  no rail durante a partida: ruído. O crédito cabe no Settings/About.
- **O bloco "THE EMBER WARDEN / Medium / 2 plies"** no rail: vira um selo no placar do
  Warden ("Medium"). "2 plies" não diz nada ao jogador.
- **"ONLINE" e "Sync" no header durante a partida**: jogo solo offline-first não precisa
  anunciar conectividade enquanto se joga.
- **O passo "Thinking"** do wizard e o card **"Minimax + alpha-beta pruning"** (05).
- **O hover-zoom quando a mesma carta já está no inspetor** (10, 16, 18, 20, 22).
- **O diálogo relâmpago "Warden is thinking"** do mulligan da IA (≈0:27): substituir pela
  presença no avatar.

---

## Próxima gravação (para fechar as lacunas deste review)

1. **Animações ON e sfx ON** (depois da missão AUDIO), para avaliar ritmo e som de verdade.
2. Roteiro com **luta**, **forja de chave**, **fim de partida + estatísticas** (FEAT-06) e
   **undo** usado de fato.
3. A mesma sessão a **390×844** com toque (long-press → lightbox, bottom sheet do inspetor).
4. Um **turno longo da IA** (dificuldade Hard, deck com 5+ ações) para medir o pior caso do #1.
5. Um humano real jogando 1 partida inteira com narração em voz alta: o bot com pausas
   fixas não revela hesitação, que é o sinal mais útil de UX.
