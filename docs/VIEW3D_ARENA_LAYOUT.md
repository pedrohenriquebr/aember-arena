# Plano — Layout "Arena" da mesa 3D (fileiras, pose orgânica, indicadores e FX) (30/09/2026)

Plano **somente leitura**. Nenhum código foi alterado e este é o único arquivo criado.
O pedido do dono: *"esse layout de mesa e inclinação angular das cartas para caberem todas
na tela e ficar mais fácil de visualizar"*. As referências são duas capturas do MTG Arena:

- `docs/ux-prints/arena-ref-1-mesa-trapezio.png`: mesa-trapézio clássica (1920×1080).
- `docs/ux-prints/arena-ref-2-ambiente-vfx.png`: mesa-ambiente com VFX de ataque e painel de
  detalhe (1920×1080).

**Base lida:** `docs/VIEW3D_PLAN.md` (H3D-01..12), `docs/VIEW3D_VALIDATE.md`,
`docs/UX_FIT_PLAN.md` (palco FIT-01..08), `src/index.css` (palco l.815-977, mesa 3D
l.6969-7563, FX l.5344-5640), `src/App.tsx` (`CardTile` l.306, `PlayerBand` l.1128,
`BoardLane` l.1239, `GameBoard` l.1334), `src/lib/fx.ts`, `src/lib/game.ts`
(`CardInstance`). As âncoras valem para o HEAD `7453ec9` com a working copy de 30/09
(FIT-08 não commitado em `App.tsx`/`settings.ts`/`i18n.ts`/`index.css`).

---

## 0. Ponto de partida: o que já existe e NÃO se re-propõe

| Já existe (commitado) | Onde | Uso neste plano |
|---|---|---|
| Plano inclinado 40° (≥1041) / 32° (701-1040), `perspective` 1100/1000, `perspective-origin 50% 38%`, `@property --tilt` | `index.css:6981-7028`, `:7184-7252` | Base. Os ângulos **não** mudam. |
| Carta em pé: `rotate: x calc(lean − tilt)`, lean 12°/10°, lift 16/12px, raise 18/14px, props individuais | `:7261-7304` | Base da pose. A rotação orgânica entra **por cima** (§3.3). |
| Exausta = `rotate: z 12deg` na arte | `:7309`, 2.5D `:7134` | Mapeia direto. Só falta a **transição** (§3.5). |
| Sombra no chão (`.board-piece::before`), glow "pronta" por opacity (`tile::after`) | `:7400-7452` | O `tile::after` "pronta" é **substituído** pelo arco (§3.5). |
| Lane sem scroll com `--n`, `--fit`, `--overlap` e teto `--card-w-3d` 76/84px | `:7319-7346` | Continua sendo a regra de largura. Muda o contêiner (grid, §3.2). |
| Leque 3D (3,5°/carta, arco 2,2px·d², 118px) + `padding-bottom: 32px` (punch 1) | `:7482-7561` | Vira overlay no palco (§3.1). |
| Perfil 2.5D (<701px e `--lite`) com playmat decorativo a 30° | `:7091-7157` | Recebe só a pose orgânica e os indicadores. Nada de fileiras. |
| FX: voo do leque → slot com lean, `fx-dmg` (−N), marca de impacto, dissolve, correntes, shake no plano | `FxLayer.tsx`, `index.css:5381-5640` | O número de dano **já existe**. Muda só o ponto de nascimento (§3.6). |
| Palco 100dvh (`game-board--stage`), zona como container `size`, carta pela altura (`cqh`), anexos na mesma fileira, `.hand-bar` | `index.css:821-977`, `App.tsx:1186-1196` | **Hoje só no 2D.** `App.tsx:1434` dá o palco apenas quando `!view3d`. |
| Inspetor à direita (rail ≥1041) e drawer/sheet (FIT-05) | `App.tsx` rail, `index.css:1992-2160` | É o "painel lateral de detalhe" do Arena. Não se re-propõe. |

**Punch list do VIEW3D_VALIDATE §5:** os 3 itens obrigatórios **já estão commitados**:
`a2461ca` (padding-bottom do leque e check de legendas), `963087e` (plano do lite com
`display: block`) e `48e1dd2` (`_3d-chain` estável). A coluna "Punch" das histórias (§4)
marca qual item cada uma pressupõe. Se algum for revertido, a história trava.

**Orçamento:** `CLAUDE.md` regra 7 fixa hoje o teto em **145 kB** ("teto ÚNICO do lote
UX-FIT, acima de 145: parar"). O FIT-05 mediu **143,66 kB**, que já passa dos 143,5
citados no pedido. FIT-06/07/08 estimam mais ≈0,8 kB (UX_FIT §6), o que dá ≈144,5. **Este
plano precisa de uma revisão própria do teto** (§5).

---

## 1. Extração das referências

As medidas estão em px da captura (1920×1080). São aproximadas, tiradas da imagem, não
de spec.

### 1.1 Ref 1: mesa-trapézio

**Mesa e profundidade**
- O tapete é um trapézio. A borda de fundo fica em y≈55 e vai de x≈150 a x≈1770 (≈1620px).
  A borda de perto sai da tela, com ≈1920px ou mais. A razão fundo/perto fica em
  **≈0,84**.
- A inclinação aparente do plano é de ≈50°. O indício é a compressão das fileiras: no
  fundo, a fileira de terrenos do oponente tem ≈105px de altura; perto, a de terrenos do
  jogador tem ≈110px, mas com cartas bem maiores.
- A iluminação vem de um ponto central, com vinheta nas bordas e um "caminho" mais claro
  que desce do avatar do oponente ao do jogador.

**Fileiras por zona.** São quatro fileiras, com os combatentes no meio e os recursos nas
bordas:

| Fileira (de longe para perto) | y (px) | Largura típica da carta | Pose |
|---|---|---|---|
| Terrenos do oponente | 155-260 | ≈130 | quase deitadas, com lean forte |
| Criaturas do oponente | 265-425 | ≈170-180 | **em pé**, lean ≈10-15° |
| (faixa central vazia, só o "caminho" do tapete) | 430-495 | — | — |
| Criaturas do jogador | 500-690 | ≈210-230 | **em pé** |
| Terrenos do jogador | 725-835 | ≈120-125 | quase deitadas |

- A razão de escala entre as criaturas do oponente e as do jogador é **≈0,78**. A dos
  terrenos em relação às criaturas do mesmo lado fica em ≈0,57 no jogador e ≈0,74 no
  oponente. **Recurso é menor que combatente mesmo estando mais perto.** A escala marca
  importância, não só profundidade.
- **As fileiras de recurso não passam pelo centro.** Os terrenos do jogador ocupam só a
  metade esquerda (x 65-825), porque o avatar mora no centro-baixo. Os do oponente ocupam
  a esquerda do topo (x 300-890), e o avatar dele fica no centro-topo. A única carta à
  direita do avatar do oponente é um encantamento (x≈1320).

**Pose das cartas**
- As criaturas ficam em pé, levemente deitadas para trás. O trapézio da carta (topo mais
  estreito) mede ≈7%, ou seja, um lean de ≈12°.
- **Jitter rotacional por carta.** Nenhuma carta fica perfeitamente alinhada. Hydroid
  Krasis 14/14 está a ≈+3°, o segundo Llanowar Elves a ≈−3°, a pilha Hero ≈−2°, e os
  terrenos variam ±2-4°. Há também um deslocamento vertical de ±4-6px entre vizinhas. É o
  que dá o aspecto "colocado à mão".
- **Sobreposição leve** na fileira do oponente: os dois Krasis se cobrem em ≈15% da
  largura. Nas outras, o gap fica em ≈15-25px.

**Empilhamento xN**
- Cópias idênticas viram **uma pilha**: o badge `x5`/`x22` (caixa preta de ≈30×22px, texto
  branco) fica no canto superior esquerdo, e 3-4 camadas aparecem deslocadas ≈10px para a
  esquerda. Com 22 cópias, as camadas visíveis continuam limitadas a 3-4.
- Terrenos iguais também empilham, com 2-3 camadas deslocadas ≈12px.

**Indicadores sobre a carta**
- Contadores ficam em círculos azuis de ≈26px (`10`, `14`, `11`, `5`) no **canto superior
  direito**, metade para fora da borda.
- Ícones de habilidade ficam em discos de ≈36px no canto inferior esquerdo, também
  saindo da borda.
- Poder e resistência ficam num pill de ≈70×28 na base da carta, em texto branco bold de
  ≈22px.
- **"Pronta para atacar":** acima de cada criatura do jogador há um **arco em chevron com
  brilho** laranja-vermelho, de ≈110-150px de largura (≈60% da carta) e ≈40px de altura,
  começando ≈15px acima do topo. As que já atacam ganham contorno vermelho.
- **Estado virado:** um ícone de seta circular translúcida (≈45% da carta) sobre a arte,
  somado a escurecimento e dessaturação. Nesta captura as cartas não giram 90°.

**Avatares**
- O avatar do oponente fica no centro-topo (x 960, y 40-160). O retrato tem ≈120px, a
  vida "19" fica num pill logo abaixo em ≈40px bold, e um arco azul de ≈180px o envolve
  (relógio/prioridade).
- O avatar do jogador fica no centro-baixo (x 960, y 760-940), com retrato de ≈130px e
  vida "58" em ≈48px. Raios laranja se estendem ±180px na horizontal, o que indica turno
  ativo.
- Os avatares **invadem a mesa** e não ficam numa barra separada.

**Mão do oponente e pilhas**
- A mão do oponente aparece como **dorsos no topo** (y −20..40, cortados pela borda),
  ≈4 visíveis, num leque leve.
- O grimório e o cemitério do jogador ficam embaixo à esquerda (≈130×180). Os do oponente
  ficam em cima à direita (≈90×110), menores pela profundidade.

### 1.2 Ref 2: mesa-ambiente e VFX

**Mesa-ambiente**
- Não há borda de tapete. O próprio cenário é o plano: grama, rio, cristais, e montanhas
  3D que fecham as bordas da tela. Os cantos são "paredes" do cenário.
- A inclinação é a mesma da ref 1 e a composição de fileiras também.

**Fileiras**
- Terrenos do oponente: y 150-255, ≈150px, com jitter e pilhas de 2.
- Criaturas do jogador: y 515-665, ≈215px cada. São 4 cartas com gap de ≈20px,
  centralizadas (x 310-1230). Dois contadores azuis (`1`, `2`) no canto superior direito.
- Terrenos do jogador: y 705-845, ≈150-170px, **visivelmente mais deitados que as
  criaturas**. O trapézio é forte (lean de ≈35-45°) e o giro orgânico vai de −3° a −8°.
- Um artefato (Lithoform Engine, x≈1180-1320) fica **à direita do avatar**, separado dos
  terrenos, que ficam à esquerda. Confirma a regra: recursos ladeiam o avatar e o centro
  fica livre.

**VFX de ataque**
- Uma espada de ≈90×300 desce sobre a área do oponente (x≈760, y 90-400). Há explosão de
  ≈300px, raios e brasas espalhadas por ≈700px.
- **Número de dano "6"** em vermelho, ≈36px, com glow, nasce **na base do impacto**
  (x≈825, y≈462), não no centro da carta.

**Painel de detalhe**
- Desliza da **direita** e ocupa x 1560-1890 (≈330px, 17% da largura) e y 260-770
  (≈510px). Mostra a carta grande com arte, texto e a habilidade (`−3`), com borda de lava
  animada.
- Há chevrons de navegação (círculos de ≈40px) à direita-topo e à esquerda-meio.

**Mão e rótulos**
- A mão tem 3 cartas visíveis a partir de y≈945, das quais só **≈40%** (≈130 de ≈300px)
  fica à mostra. Os custos são badges de ≈26px acima. O leque quase não existe (< 2°): as
  cartas ficam retas e levemente sobrepostas, centralizadas sob o avatar.
- O avatar do jogador ("16") sobrepõe o topo da mão.
- Os rótulos "Opponent" e "Local Player" ficam nos cantos esquerdos (≈30px, com ícone de
  losango). O exílio/cemitério forma uma coluna à esquerda, com 3 cartas e badge `x2`.

### 1.3 Por que "cabem todas na tela" no Arena

1. **Duas escalas por lado:** combatente grande e recurso pequeno. A fileira de recurso
   custa ≈55% da altura de uma fileira de criaturas.
2. **Centro vertical livre para o avatar:** as fileiras de recurso não passam por ele, e o
   avatar não empurra ninguém.
3. **A mão é overlay cortado.** Ela quase não reserva altura (40-60% visível).
4. **Sobreposição e pilha** absorvem excesso de cartas sem scroll.
5. **Nenhum texto no plano.** O nome da carta é uma faixa minúscula ilegível, e quem lê é
   o painel lateral.

---

## 2. Mapeamento para o Aember (KeyForge ≠ MTG)

### 2.1 Mapeia direto

| Arena | Aember | Estado |
|---|---|---|
| Criaturas em pé, lean ≈12°, sombra no tapete | Pose H3D-04/05 | **Existe.** |
| Duas battlelines frente a frente com o centro livre | Zonas oponente/jogador com o `turn-console` no meio | **Existe.** |
| Fileira de recursos na borda externa, menor e mais deitada | **Artefatos** numa fileira externa (§3.2) | Novo: H3D-15 |
| Jitter rotacional por carta | Pose orgânica determinística por `instanceId` (§3.3) | Novo: H3D-16 |
| Contador no canto superior direito, fora da borda | `.damage-label` (já fica em `top: 4px; right: -5px`) | Existe. No 3D vira ficha redonda (§3.5). |
| Arco com brilho "pronta para atacar" | `.board-piece--ready` (`canUse`: pronta, sem atordoamento, da casa ativa) → arco acima da carta | Novo: H3D-18 (substitui o `ready-glow`) |
| Avatar central com número grande | Avatar central com **Æmber** grande + 3 slots de chave | Novo: H3D-19 |
| Dorsos da mão do oponente no topo | `enemy.hand.length` em dorsos (a contagem de mão é pública no KeyForge) | Novo: H3D-19 |
| Número de dano no ponto de impacto | `fx-dmg` (onda 3) | **Existe**; nasce no centro da caixa. Passa a nascer a 35% da altura (H3D-20). |
| Painel de detalhe à direita | Inspetor no rail (≥1041), drawer/sheet (FIT-05) | **Existe.** Não se re-propõe. |
| Mão como overlay cortado | Leque 3D com ≥70% visível (FIT-04 §2.4) | Planejado no FIT-04, **não aplicado ao 3D** (§3.1, H3D-14). |

### 2.2 Muda (regras do KeyForge)

| Tema | MTG/Arena | Aember | Consequência no layout |
|---|---|---|---|
| **Tamanho da battleline** | Sem ordem, empilhável | **A ordem importa**: flancos e vizinhança (BUG-18). As regras **não** limitam a quantidade de criaturas. O pedido cita "6 máx", mas no jogo real 6-8 é o típico e o código já testa 12. | O layout usa **6 criaturas em tamanho cheio como alvo de desenho** a 1296×668 (§3.4). De 7 a 9 cartas elas encolhem até o piso de 64px, e a partir daí sobrepõem (`--overlap`, já existe). **Criaturas nunca empilham xN.** |
| **Exausta** | Virar 90° (ou ícone) | `ready: false`: **rotação de 12°** na arte + opacidade 0,62 | Já existe. Ganha transição de 200ms. A seta circular do Arena **não** é copiada: o giro já comunica. |
| **Atordoada** | (não existe) | `stunned: true` | **Ficha** flutuante acima do canto superior esquerdo (§3.5). Hoje só há borda laranja + dessaturação (`index.css:1693`). |
| **Upgrades** | Auras presas atrás da criatura | `attachedTo`: renderizados numa faixa separada (`BoardLane`, l.1305) | No 3D ficam **embaixo do hospedeiro**, na mesma célula e deslocados para a borda externa, com 40px aparecendo (§3.2, H3D-17). |
| **Âmbar capturado** | (contadores genéricos) | `card.amber` com o `.amber-label` já no tile | No 3D vira uma **ficha dourada** acima do topo central da carta (§3.5). |
| **"Vida"** | Pontos de vida | **Æmber + chaves (0/3)** | O número grande do avatar é o Æmber. As chaves são 3 slots, e a forjada acende. |
| **Terrenos (mana)** | Fileira própria, muitas cópias | Não existem. A fileira externa é dos **artefatos** (0-4 típicos). | A fileira externa só ocupa altura **quando há artefato** (linha `auto` do grid, §3.2). |
| **Recursos ao lado do avatar** | Terrenos à esquerda, não-terrenos à direita | Artefatos **alinhados à esquerda** e o centro livre (notch de 200px) | Deck, descarte e arquivo continuam na `.hand-bar` (FIT-04). Não se abre uma coluna de pilhas. |

### 2.3 O que NÃO copiar

| Arena faz | Por que não | O que fazemos |
|---|---|---|
| Plano a ≈50° | O piso visual (`e2e:floor:3d`) reprova texto a cos 50° = 0,64. | Continua **40°/32°**. A sensação de profundidade vem da escala entre fileiras (combatente × recurso), não do ângulo. |
| Mão com 40-60% visível | FIT-04 fixou no máximo 30% cortado no 3D e 0% no 2D. O celular não tem leque. | Overlay com **≥70% visível** (FIT-04 §2.4). |
| Pilha xN de criaturas | A ordem e os vizinhos são regra (flanco, BUG-18). | Nunca. A pilha fica **só para artefatos idênticos, e é opcional** (H3D-22). |
| Espada gigante, brasas, raios, bloom | Custo de GPU no celular fraco, bundle e regra 1 (sem assets). | **1 anel + 8 faíscas** em gradiente, 320ms, só `transform`/`opacity` (§3.6). |
| Mesa-ambiente com cenário 3D (montanhas, rio) | Exige imagens ou modelos (regra 1) e WebGL (regra 7). | Tapete temático **em gradientes** com a cor da casa ativa (H3D-21). Zero imagem. |
| Nome e texto da carta no plano | Ilegível em perspectiva. | Caption oculto no 3D (já é assim). Texto só billboard ou HUD. |
| Painel de detalhe **sobre** o board, com borda de lava animada | Cobriria criaturas. O inspetor já vive no rail ou no sheet. | Mantém o inspetor. Só ganha entrada de 200ms (H3D-21). |
| Relógios, ampulhetas, rótulos "Opponent/Local Player" | Partida solo sem relógio. Os nomes já estão nas bands. | Nada. |
| Cantos com deck e cemitério em tamanho de carta | Custa altura e largura. A informação já está na `.hand-bar`. | Nada. |
| Qualquer biblioteca 3D | Regra 7 (e o plano VIEW3D já descartou). | CSS 3D + WAAPI. |
| Fileiras separadas no celular | A 342px úteis não há largura para duas escalas. | O 2.5D (<701px e lite) recebe **só** a pose orgânica e os indicadores (§3.7). |

---

## 3. Plano técnico no código atual

### 3.1 Pré-condição: a mesa 3D entra no palco

Hoje `App.tsx:1434` só dá `game-board--stage` ao 2D. O comentário de `index.css:817-820`
diz que o 3D o receberia "no FIT-04", o que não aconteceu. **Sem o palco, o 3D continua
rolando, e "caber tudo na tela" é impossível.** A regra 3D-no-palco:

```css
/* 3D no palco: o plano ocupa as linhas 2..4 do grid e tem o próprio grid interno.
   O layout do plano = espaço do palco; a projeção só o encurta (cos θ). As margens
   negativas do H3D-03 (−48/−32) saem: o grid já não sobra altura. */
.game-board--3d.game-board--stage .table-plane {
  display: grid;
  grid-row: 2 / 5;
  grid-template-rows: minmax(0, 1fr) var(--console-h) minmax(0, 1fr);
  margin-block: 0;
}
/* Mão = overlay (FIT-04 §2.4): a linha reserva 70% do --hand-h e a carta em repouso
   mostra ≥70% dela; erguida (hover/foco/seleção) ela aparece inteira. */
.game-board--3d.game-board--stage { --hand-row: calc(var(--hand-h) * 0.7); }
.game-board--3d.game-board--stage .hand-track { padding-top: 0; }
```

- `grid-template-rows` do `.board-content` no 3D: `var(--band-h) minmax(0,1fr)
  var(--console-h) minmax(0,1fr) var(--hand-bar-h) var(--hand-row)`, com as mesmas
  linhas do 2D. O plano cobre as três do meio.
- `display: grid` não é propriedade de agrupamento, e a cadeia `preserve-3d` continua
  válida. `container: zone / size` na `.battle-zone` é contenção de
  tamanho/layout/estilo, não de paint. **O `_3d-chain` tem que provar isso**, como já faz
  com o `inline-size` da lane.
- O `padding-bottom: 32px` do punch 1 (`:7493`) continua fora do palco, e no palco vira
  `padding-bottom: 0`: no overlay, a ponta do leque **pode** ir abaixo da borda, mas o
  critério "≥70% visível" vale **para cada carta, pontas incluídas**.
- O 2D não muda: nenhuma regra nova sai de `.game-board--3d`.

### 3.2 Fileiras por zona no `BoardLane` (grid só no 3D)

O DOM do `BoardLane` **não muda de ordem nem de estrutura**. Criaturas vêm primeiro e
depois o `.board-attachments` com artefatos e upgrades. Entram só **custom properties
inline**, inertes no 2D (nenhuma regra 2D as lê, então o 2D fica pixel-idêntico):

| Nó | Propriedade nova | Valor (derivado de `cards`, que o memo já compara) |
|---|---|---|
| criatura `.board-piece` | `--col` | índice na battleline + 1 |
| upgrade `.board-piece--attachment` | `--col`, `--up` | coluna do hospedeiro (`attachedTo`) e k-ésimo upgrade dele (1, 2…) |
| artefato `.board-piece--attachment` | `--acol`, `class board-piece--artifact` | índice entre os artefatos + 1 |
| `div.board-lane` | `--na`, `class board-lane--upgrades` se houver upgrade | nº de artefatos |

Um upgrade órfão, sem hospedeiro visível, cai no comportamento de artefato. No 3D (≥701):

```css
.game-board--3d .board-lane {
  display: grid;
  grid-template-columns: repeat(var(--n), minmax(0, var(--slot)));  /* --slot = w + gap, ou menos → sobrepõe */
  grid-template-rows: auto auto auto;           /* criaturas | faixa de upgrade | artefatos */
  justify-content: center;
}
.game-board--3d .board-attachments { display: contents; }  /* os filhos viram células do grid da lane */
.game-board--3d .board-lane > .board-piece { grid-row: 1; grid-column: var(--col); justify-self: center; }
.game-board--3d .board-piece--attachment:not(.board-piece--artifact) { grid-row: 1 / 3; grid-column: var(--col);
  align-self: end; translate: var(--up-dx) 0 calc(var(--lift) - 2px); z-index: -1; }
.game-board--3d .board-piece--artifact { grid-row: 3; grid-column: 1 / -1; justify-self: start;
  margin-inline-start: calc((var(--acol) - 1) * var(--a-slot)); }
/* Oponente = espelho: artefatos em cima, upgrades espiando para cima. */
.game-board--3d .battle-zone--opponent .board-lane { grid-template-rows: auto auto auto; }
.game-board--3d .battle-zone--opponent .board-lane > .board-piece { grid-row: 3; }
.game-board--3d .battle-zone--opponent .board-piece--artifact { grid-row: 1; }
```

- **Por que grid.** Duas peças na mesma célula se sobrepõem naturalmente (o upgrade fica
  embaixo do hospedeiro). Uma coluna mais estreita que a carta dá sobreposição sem margem
  negativa, e a fileira de artefatos com `auto` **mede 0 quando não há artefato**.
- **`display: contents` no `.board-attachments`** tira do caminho da cadeia 3D um
  ancestral que hoje precisa de `preserve-3d` (`:7036`). Risco de a11y: o `role="list"`
  com `display: contents` perde o papel no WebKit < 17.4. Mitigação: o probe da H3D-13
  verifica a árvore a11y no Chromium, e o Safari entra na verificação manual já pendente
  (VALIDATE §5.7). Se falhar, plano B: mover o `role="list"` + `aria-label` para a própria
  `.board-lane` só no 3D (atributo sempre presente, sem efeito visual no 2D).
- **Upgrade embaixo do hospedeiro.** Fica 1px atrás em Z (`lift − 2px`, sem z-fighting) e
  deslocado **para a borda externa**: para baixo no jogador, para cima no oponente, com
  **40px à mostra** por upgrade (k-ésimo: `40px × k`) e `--up-dx: 4px × k` na horizontal.
  A faixa de upgrade (linha 2) só existe com `.board-lane--upgrades`, e aí a altura da
  criatura desconta 40px (§3.4). A tira visível tem ≥45×84px visuais no jogador
  (40 × 1,14) e ≥46px no oponente (tira de 46px, compensando 0,985), acima dos 44px da
  regra 9. É uma **exceção documentada** ao 56×78 das cartas do board.
- **Artefatos: fileira externa, menor e mais deitada.** Largura **0,6×** da criatura do
  mesmo lado (≈50px no jogador e ≈46px no oponente a 1296×668), `--lean: 24deg` (mais
  "no tapete", como os terrenos da ref 2) e `--lift: 8px`. Alinham à esquerda, com
  `--a-slot = w_a + 8px`, e param num **notch central de 200px** reservado ao avatar
  (`max-width: calc(50% − 100px)`). Acima disso sobrepõem, com o mesmo cálculo de
  `--overlap` usando `--na`. Texto do fallback: `--depth-k: 1.1` na fileira, porque
  cos 24° × 0,985 = 0,90.
- **Hit-test.** A ordem de pintura segue o DOM e o Z. O upgrade fica atrás do hospedeiro
  e só a tira externa é clicável, o que é o comportamento esperado. O `_3d-hit` ganha os
  casos "upgrade" e "artefato" (§4, H3D-13).

### 3.3 Pose orgânica determinística (jitter por `instanceId`)

Uma função **pura** em `lib/fx.ts` (junto de `diffFx`, testável em `fx.test.ts`). Nada de
`Math.random` no render:

```ts
/** Pose orgânica (H3D-16): a mesma carta sempre com o mesmo giro — FNV-1a do id. */
export function cardJitter(id: string): { rot: number; dy: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const u = (h >>> 0) / 4294967295;
  const v = ((h >>> 11) & 0xffff) / 65535;
  return { rot: Math.round((u * 2 - 1) * 16) / 10, dy: Math.round((v * 2 - 1) * 3) }; // ±1,6° · ±3px
}
```

- O `BoardLane` escreve `--jr: ${rot}deg; --jy: ${dy}px` no `style` da `.board-piece`. É
  inerte no 2D. Nenhuma prop nova desce ao `CardTile` e o memo não muda.
- **Aplicação no tile, não na peça.** A `rotate` da peça já é o eixo X da pose. O tile em
  repouso ganha `rotate: z var(--jr); translate: 0 var(--jy) 0`. Selecionado, com
  `acting` ou em hover, o tile já recebe `rotate: x −lean; translate: 0 0 raise`
  (`:7298-7304`, `:7373-7377`), então **a carta erguida "endireita"** e o jitter vai a 0,
  com a transição de 150ms existente (slerp de z para x). O `card-deal` do tile é dono de
  `transform` (`:5346`), e a `rotate` individual compõe com ele sem briga.
- **Faixas:** jogador ±1,6°, oponente ±1,6°, artefatos ±2,4° (`calc(var(--jr) * 1.5)`,
  mais "jogados na mesa", como os terrenos da ref 2). Upgrades herdam o `--jr` do
  hospedeiro (o `BoardLane` copia o valor), para a pilha girar junta.
- **Custo:** zero animação, é pose estática. No bbox, a 118px de altura, ±1,6° somam
  ≈3,3px de largura, e o `--overlap` absorve isso.
- **FX:** o pouso do voo (`FxLayer.tsx:211-218`, que já lê `--lean` e o giro da arte) passa
  a ler também `--jr` da peça de destino e soma ao `rotateZ` final do ghost. Sem isso o
  pouso erraria em até ≈3px, no limite do critério do `_3d-fx`.
- **2.5D (<701 e lite):** o mesmo `rotate: var(--jr)` no tile plano. É barato, dá o mesmo
  "colocado à mão" no celular e zera em `.is-selected`.

### 3.4 Dimensionamento no palco 3D ("caber todas")

A altura da zona agora divide com as fileiras. A **criatura** deriva a altura do que
sobra:

```
h_zona  = 100cqh − 16px (padding)
h_art   = artefatos ? 0,6 × h_cri × (lean 24° → ×0,91) : 0      (linha auto)
h_up    = upgrades  ? 40px (46 no oponente) : 0
h_cri   = (h_zona − h_up − gap 4) / (1 + 0,55·[tem artefato])
w_cri   = clamp(64px, min(h_cri × 0,714, (100cqi − 88 − (n−1)·10) / n), --card-w-3d)
w_opp   = 0,9 × w_cri (mantém a razão visual 0,74-0,80 medida no VALIDATE H3D-03)
```

Os tetos `--card-w-3d` no palco são 84 (jogador) / 76 (oponente) no perfil baixo e 96/86
no alto. No `(min-height: 960px)` passam a 112/100.

**Cenários** (tokens do UX_FIT §2.3, rail em coluna de 296px ≥1041, mão em overlay a 70%):

| Cenário | Plano (px) | Zona | Criatura sem artefato | Com artefato + upgrade | Máx. em tamanho cheio / sobreposição a partir de |
|---|---|---|---|---|---|
| **1296×668** (dono, baixo) | 604 − 44 − 40 − 104 − 2 = **414** | (414 − 52)/2 = **181** | teto **84** (≈96 visual) | h_cri = (165 − 40 − 4)/1,55 = 78 → **w 56 → piso 64** | 9 / 10 |
| **1280×800** (alto) | 680 − 52 − 44 − 115 − 2 = **467** | (467 − 60)/2 = **203** | teto **96** (≈109 visual) | (187 − 44)/1,55 = 92 → **w 66** | 8 / 9 |
| **1920×1080** (alto + ≥960) | ≈**755** | **347** | teto **112** | **w 140 → teto 112** | 10 / 11 |
| **768×1024** (tablet, 32°) | 904 − 52 − 44 − 115 − 2 = **691** | **315** | teto 84 | teto 84 | 6 / 7 (lane de ≈680px) |

- **Leitura honesta:** a 1296×668, com artefato **e** upgrade no mesmo lado, a criatura
  bate no piso de 64px (≈73 visuais no jogador). Está dentro do contrato (piso da carta
  do board no 3D = 64px de layout, alvo ≥56×78 visual), mas é o limite. O alvo de desenho
  de **6 criaturas por lado em tamanho cheio** vale em todos os cenários **sem** artefato.
  Com artefato, vale do 1280×800 para cima.
- As cartas em pé projetam acima da própria caixa (limite (a) do `CLAUDE.md`, ≈30px).
  No palco elas **não podem ficar sob os HUDs** (band/hand-bar têm `z-index: 2`). Aceite
  da H3D-14: `elementFromPoint` a 6px abaixo do topo visual de cada `.card-art` devolve o
  próprio tile.

### 3.5 Indicadores flutuantes acima das cartas (e animações de estado)

Todos são decorativos, com o estado já no `aria-label` via `stateLabel`/`t()`. Ficam em
pseudo-elementos ou nos spans existentes e só animam `opacity`/`translate`/`scale`.

| Indicador | Onde | Forma (desktop 3D) | Animação |
|---|---|---|---|
| **Arco "pronta"** (`canUse`) | `.board-piece--ready::after` (livre hoje) | Chevron de 60% da largura da carta × 14px, a 6px acima do topo, com `radial-gradient` âmbar `rgb(255 176 70)` → transparente e recorte por `clip-path: polygon(...)` (é folha, não achata ninguém) | `opacity 0,55 ↔ 1` em **1,6s** ease-in-out infinito. Com a peça erguida (seleção/hover) acompanha em `translate: 0 0 var(--raise)` e 150ms. Com reduce-motion fica **estático a 0,85**. **Substitui** o `ready-glow` do `tile::after` (`:7438-7452`), com uma animação a menos por carta. |
| **Ficha de atordoada** | `.board-piece--stunned::after` (exclusivo com `--ready`: `canUse` exige `!stunned`) | Disco de 24px (22 no 2.5D) no canto superior esquerdo, 8px acima do topo, fundo `#b8612f`, anel `0 0 0 2px rgb(255 200 150 / .5)` e ícone por `mask` com SVG inline (`zap-off`, ≈250 B) | Entrada `scale .4 → 1.15 → 1` em **240ms** quando a classe aparece (a animação do pseudo roda ao passar a valer). Sai sem animação. |
| **Âmbar capturado** | `.amber-label` existente, reposicionado só no 3D | Ficha-pílula centrada **acima** do topo (`top: -18px; left: 50%`), com gema e número e `box-shadow` **estático** de brilho dourado 10px | Nenhuma nova. O `+N Æ` da onda 2 já voa. |
| **Dano** | `.damage-label` existente | Vira disco de 22px no canto superior direito, metade fora da borda (o contador azul do Arena), em vermelho `#7c3e32` | Nenhuma nova. O `fx-dmg` + `data-fx="hit"` já existem. |
| **Exausta** | arte (`rotate: z 12deg` existente) | — | **Nova transição**: `rotate 200ms var(--ease-out)` na `.card-art` do board 3D/2.5D. Com reduce-motion, troca seca pela regra global. |

- **Tipografia:** o número das fichas usa `calc(var(--fs-2xs) * var(--depth-k, 1))`, então
  no oponente, a ≈0,985 de escala, sobe o necessário para passar no `e2e:floor:3d`. O gate
  decide.
- Um dos pseudos da peça já está ocupado: `::before` é a sombra. O `::after` fica com o
  arco **ou** a ficha de stun, nunca os dois.
- Armadura, *enrage*, *ward* e *power tokens*: o motor (`CardInstance`) só modela
  `armorUsed`. Fica fora de escopo, porque desenhar ficha de estado que o motor não tem
  mentiria.

### 3.6 Investida e impacto (o "VFX central" possível)

O `VIEW3D_VALIDATE` H3D-08 registrou que a investida da luta **não existe** (nem no 2D).
Só no 3D (o 2D fica intacto) e só com `motionEnabled`:

1. **Investida** (WAAPI na **propriedade individual `translate`** da `.board-piece`
   atacante, sem tocar na `rotate`/pose): `0 0 var(--lift)` → `0 dy 34px` (45%) → segura
   (60%) → volta, em **460ms** `cubic-bezier(.3,.7,.2,1)`. `dy = (offsetTop do defensor −
   offsetTop do atacante no plano) × 0,72`, parando antes de cobrir o alvo. A perspectiva
   já faz a carta "subir e diminuir" sozinha, como na ref 2.
2. **Impacto** (portal `FxLayer`, screen-space) no ponto a **35% da altura** da caixa
   projetada do defensor, em t = 45%:
   - um **anel** de 120px (`radial-gradient`, âmbar → transparente) em `scale .3 → 1.6`,
     `opacity 1 → 0`, 320ms;
   - **8 faíscas** num único elemento com `conic-gradient` mascarado por
     `radial-gradient`, em `rotate 0 → 25deg`, `scale .5 → 1.4`, 320ms;
   - o **`fx-dmg` existente** passa a nascer nesse mesmo ponto, e não mais no centro da
     caixa, 60ms depois do anel. O pop de 1,25× e a subida de 190% continuam.
3. `data-fx="hit"` (existente) no defensor em t = 45%.
4. A sequência cabe no hold da IA (`aiDelayMs`, FIT-08), sem estender o turno. Com
   reduce-motion ou animações off, **nada** disso roda, e o dano chega pelo badge + log,
   como hoje.

### 3.7 Avatares centrais e mão do Warden (HUD)

- **`PlayerBand` no 3D (≥701):** `grid-template-columns: 1fr auto 1fr`. À esquerda, nome
  e casas. No centro, o avatar de **56px** (64 no ≥960 de altura), com o **Æmber** em
  `--fs-2xl` bold num pill logo abaixo/ao lado. À direita, 3 **slots de chave** de 20px
  (forjada = preenchida e com glow estático) + correntes. É o mesmo DOM de hoje
  (`player-avatar`, `AmberCounter`, `KeyCounter`, `chain-counter`), reordenado por
  `order`/`grid-area`. **Nenhuma informação sai.**
- O avatar **invade 12px** no plano: para baixo no Warden, para cima no jogador. Isso
  acontece **exatamente no notch central** que a fileira de artefatos deixa livre (§3.2),
  então não cobre carta nenhuma. O turno ativo ganha um "halo" estático (radial com a cor
  existente do `avatar-live-dot`), e o `thinking` da IA pulsa em opacity a 1,2s.
- **Dorsos da mão do Warden:** a `PlayerBand` do oponente ganha a prop `backs={enemy.hand.length}`
  (entra no `arePlayerBandPropsEqual`) e renderiza
  `<span class="hand-backs" role="img" aria-label={t("game.opponentHand", {count})}>` com
  até 7 `<i/>` e "+N" quando passar. No **2D** fica `display: none` (sem layout, 2D
  pixel-idêntico). No 3D fica **ao lado direito do avatar**: dorsos de 22×31px em
  gradiente (o mesmo verso do `CardArt` fallback), leque de ±4° por carta e sobreposição
  de −10px. **i18n:** `game.opponentHand` em en + pt-BR.
- **Origem do voo da IA:** o `captureFx` do Warden passa a medir o **último dorso**, e não
  a band. A carta "sai da mão dele" como na ref 1.
- O 2.5D, o celular e o lite ficam **sem** avatar central e sem dorsos: a band de 48px
  continua como é.

### 3.8 Mesa-ambiente sem imagem (a ref 2 possível)

- O `.table-plane::before` (3D real) ganha uma **4ª camada** de fundo: `radial-gradient`
  com `--turn-house` (a `houseColor` da casa ativa, escrita pelo `GameBoard` no `style`
  do board) a **10%** de opacidade, centrada na metade de quem joga (y 72% no jogador, 28%
  no Warden). É o "terreno" do turno.
- Mais uma camada de "gravura" com `repeating-radial-gradient` fino (≈1px a 4% de
  opacidade, anéis de 38px) para textura. É estática, sem `filter`.
- A troca de casa **não** anima o gradiente, porque custaria repaint do plano inteiro: a
  cor troca seco, mascarada pelo `view-fade` existente só quando o modo muda. Com a casa
  mudando no meio do turno, a troca é instantânea.

### 3.9 Compatibilidade e invariantes

| Invariante | Como é garantido |
|---|---|
| **2D pixel-idêntico** | Toda regra nova fica sob `.game-board--3d` (ou `:is(--3d, --lite)` no 2.5D). As props inline (`--col`, `--jr`…) são inertes no 2D. Os dorsos ficam `display: none` no 2D. Gate: `e2e/shots/_2d-freeze.mjs` antes/depois, com a pasta `WxH/` (armadilha do `_png-diff`, VALIDATE §0). |
| **Palco 100dvh** | §3.1. O 3D usa as **mesmas** linhas e tokens do FIT-02. `e2e:fit` em 3D a 1296×668, 1280×800, 1920×1080, 1024×768 e 768×1024. |
| **Cadeia 3D sem agrupamento** | Grid na lane e no plano, `display: contents` no `.board-attachments`, `clip-path`/`mask` **só em pseudos-folha**. `_3d-chain` é rodado por história. |
| **Motor puro** | `cardJitter` é pura e fica fora do `GameState`. Nenhum campo novo no motor. |
| **Reduce-motion** | Arco estático, ficha sem pop, sem transição de exausta, sem investida/impacto. A pose (jitter) **permanece**, porque é estática. |
| **Performance** | Só `transform`/`opacity`/`translate`/`rotate`/`scale` animados. Animações infinitas: 1 por carta pronta (o arco substitui o `ready-glow`, saldo 0). `will-change` só no ghost do FX. Teto de camadas ≤ 60 (VIEW3D §2.9): os upgrades somam 1 camada cada e ficam dentro disso até 8 upgrades. |
| **Toque** | Nada novo é hover-only. O arco e as fichas são estado. A tira do upgrade tem ≥44px. Long-press → lightbox, sem mudança. |

---

## 4. Histórias

Esforço: **S** ≤ ½ dia · **M** 1-2 dias · **L** 3+ dias. Todas exigem `npm run build`,
**2D pixel-idêntico** (`_2d-freeze`), `e2e:floor`, `e2e:floor:3d`, e os três probes 3D
quando tocam board ou mão (regra 10 do `CLAUDE.md`).

Coluna **Punch** (VIEW3D_VALIDATE §5, obrigatórios, **todos já commitados**): P1 = leque
sem legenda cortada (`a2461ca`), P2 = plano do lite com caixa (`963087e`), P3 = `_3d-chain`
estável (`48e1dd2`). A história pressupõe o item e **trava** se ele for revertido.

| # | História | Esforço | Depende de | Punch | Δ gz estimado |
|---|---|:-:|---|:-:|---:|
| H3D-13 | Harness do layout Arena | S-M | — | P3 | 0 (e2e) |
| H3D-14 | Mesa 3D no palco (mão em overlay) | M-L | FIT-04 ✔, H3D-13 | P1, P3 | +0,35 |
| H3D-15 | Fileiras por zona (grid, artefatos na borda externa) | L | H3D-14 | P3 | +0,45 |
| H3D-16 | Pose orgânica determinística | S | H3D-13 | P2 | +0,12 |
| H3D-17 | Upgrades embaixo do hospedeiro | M | H3D-15 | P3 | +0,25 |
| H3D-18 | Indicadores flutuantes + transição da exausta | M | H3D-15, H3D-16 | P2 | +0,40 |
| H3D-19 | Avatares centrais + dorsos do Warden | M | H3D-14, H3D-15 | P2 | +0,35 |
| H3D-20 | Investida e impacto | M | H3D-16 | — | +0,40 |
| H3D-21 | Mesa-ambiente em gradiente + entrada do inspetor | S | H3D-14 | P2 | +0,15 |
| H3D-22 | *(opcional)* Pilha xN de artefatos idênticos | M | H3D-15 | P3 | +0,35 |

### H3D-13: Harness do layout Arena (S-M)
**Como** mantenedor, **quero** gates que medem fileiras, pose e encaixe do 3D **para** que
o layout Arena não regrida em silêncio.
- **Escopo:** `e2e/probes/_3d-arena.mjs` (novo), com seeds de save fixos: 6 criaturas por
  lado; 6 + 2 artefatos + 1 upgrade; 12 criaturas; 1 atordoada, 1 exausta e 1 com 2 de
  âmbar. Extensão do `e2e/fit.mjs` para 3D em todos os viewports. `_3d-hit` com os casos
  "upgrade" e "artefato".
- **Aceite:** o probe roda em < 60s e sai com código ≠ 0 em violação. O teste do teste
  (`--break`, que injeta `.board-lane{display:flex}` no 3D) **tem de falhar**. Nasce
  vermelho no HEAD atual, documentando que o 3D não está no palco.
- **Depende de:** nada. Cresce com cada história.

### H3D-14: Mesa 3D no palco (M-L)
**Como** jogador no notebook, **quero** a mesa 3D inteira na tela sem rolar **para**
jogar como no Arena.
- **Escopo:** `App.tsx:1434` (o palco passa a valer também com `view3d`; o lite recebe o
  palco com o perfil 2.5D). `index.css`: §3.1 (plano no grid, `--hand-row` a 70%, sem
  `margin-block` e sem `padding-top: 36px` no palco), fórmula da criatura por `cqh` com os
  tetos do §3.4 e `transform: none` → `translate` da mão erguida
  (`translate: 0 calc(-30% - 30px)`, FIT-04 §2.4).
- **Aceite:**
  - `e2e:fit` em 3D passa a 1296×668, 1280×800, 1920×1080, 1024×768 e 768×1024: sem
    scroll no documento, soma das linhas ≤ `innerHeight` e cada carta da mão com ≥70% da
    altura visível e 100% quando em foco.
  - Criatura do jogador ≥ **84px** de layout a 1296×668 (sem artefato) e 6 criaturas por
    lado sem sobreposição a 1296×668.
  - `elementFromPoint` 6px abaixo do topo visual de cada `.card-art` devolve o tile (nenhuma
    carta sob HUD).
  - `_3d-chain`, `_3d-hit` e `_3d-fx` passam. A razão de escala oponente/jogador fica em
    0,74-0,80.
- **Nota:** se o lote FIT entregar o 3D no palco antes (o FIT-04 §2.4 previa isso), esta
  história vira só os critérios acima.

### H3D-15: Fileiras por zona (L)
**Como** jogador, **quero** criaturas grandes no meio e artefatos menores na borda
**para** ler a mesa como no Arena e caber mais cartas.
- **Escopo:** `App.tsx` `BoardLane` (`--col`, `--acol`, `--na`, classes
  `board-piece--artifact` e `board-lane--upgrades`, sem mudar a ordem do DOM).
  `index.css` §3.2 (grid, `display: contents` no `.board-attachments`, espelho do
  oponente, artefato 0,6× com lean 24° e lift 8px, notch de 200px, `--depth-k: 1.1`).
  Remoção da regra 3D de largura do `.board-piece--attachment` (`:7353-7356`), que o grid
  torna morta.
- **Aceite:**
  - Com o seed "6 + 2 artefatos", o topo visual dos artefatos do jogador fica **abaixo** da
    base visual das criaturas, e o do oponente **acima**.
  - Nenhum artefato intersecta a faixa central de 200px (x do centro do board ±100).
  - Artefato visual = 0,55-0,65× da criatura do mesmo lado.
  - Sem artefato, a linha 3 mede 0px (±1).
  - A árvore a11y mantém a lista "anexos" no Chromium.
  - `_3d-chain` passa, incluindo o novo nó do grid. `_3d-hit` passa com 100% dos cliques
    em artefatos.
  - 2D pixel-idêntico.

### H3D-16: Pose orgânica determinística (S)
**Como** jogador, **quero** que as cartas pareçam colocadas à mão **para** a mesa ter
vida sem virar bagunça.
- **Escopo:** `lib/fx.ts` (`cardJitter`) + `fx.test.ts`. `App.tsx` `BoardLane` (`--jr`/`--jy`,
  com o upgrade herdando do hospedeiro). `index.css`: tile em repouso com
  `rotate: z var(--jr)`, artefato ×1,5 e 2.5D. `FxLayer.tsx`: soma do `--jr` no pouso.
- **Aceite:**
  - O teste unitário garante o mesmo id → a mesma pose, rot ∈ [−1,6; 1,6] e dy ∈ [−3; 3].
  - Em 1000 ids aleatórios, média |rot| ≥ 0,6° (sem concentrar em 0).
  - Recarregar a partida mantém o giro de cada carta (probe compara o `rotate` computado
    antes e depois do reload).
  - Carta selecionada tem `rotate` z = 0 após 150ms.
  - `_3d-fx`: o pouso continua ≤ 3px.
  - Nenhum `Math.random` novo em `App.tsx` (grep no probe).

### H3D-17: Upgrades embaixo do hospedeiro (M)
**Como** jogador, **quero** ver cada upgrade preso à sua criatura **para** saber na hora
quem está equipado, sem ler legenda.
- **Escopo:** `index.css` §3.2 (célula do hospedeiro, tira de 40/46px para a borda
  externa, `--up-dx`, Z −2px, desconto de altura com `.board-lane--upgrades`).
  `App.tsx`: fallback do órfão para artefato.
- **Aceite:**
  - Com o seed de upgrade, o centro horizontal do upgrade fica a ≤ 8px do centro do
    hospedeiro.
  - Tira visível ≥ 44px de altura e ≥ 56px de largura (jogador e oponente); o clique no
    centro da tira seleciona o upgrade (`data-iid`).
  - 2 upgrades no mesmo hospedeiro: 2 tiras (80/92px), sem cobrir a fileira de artefatos.
  - Nenhum `z-fighting`: 3 capturas seguidas idênticas.
  - `_3d-chain` e `_3d-hit` passam.

### H3D-18: Indicadores flutuantes + transição da exausta (M)
**Como** jogador, **quero** ver acima de cada carta se ela está pronta, atordoada ou com
âmbar **para** decidir sem abrir o inspetor.
- **Escopo:** `index.css` §3.5 (arco no `.board-piece--ready::after`, remoção do
  `ready-glow` do tile no 3D, ficha de stun com a máscara SVG, `.amber-label` e
  `.damage-label` reposicionados, transição de 200ms da arte exausta, versões 2.5D a
  0,8× de tamanho).
- **Aceite:**
  - Arco presente **só** em `canUse`, com base ≥ 4px acima do topo visual da arte.
  - Ficha de stun só em `stunned`, nunca junto do arco.
  - Âmbar capturado acima do topo e dano no canto superior direito, ambos com texto ≥ 11px
    visuais (`e2e:floor:3d`).
  - `getAnimations()` no plano: 0 animação de `box-shadow`/`filter` e o nº de animações
    infinitas ≤ nº de cartas prontas.
  - Com reduce-motion o arco fica estático (opacity 0,85) e a exausta troca em 1 frame.
  - A troca pronta → exausta leva 200ms ± 20.

### H3D-19: Avatares centrais + dorsos do Warden (M)
**Como** jogador, **quero** o placar de cada lado grande e no centro, e ver quantas
cartas o Warden tem, **para** ler a corrida pelas chaves de relance.
- **Escopo:** `App.tsx` `PlayerBand` (prop `backs`, comparador, span `.hand-backs`), o
  `GameBoard` passando `enemy.hand.length` e `FxLayer` (origem do voo da IA no último
  dorso). `index.css` §3.7 (grid do band no 3D ≥701, avatar de 56/64px invadindo 12px,
  Æmber em `--fs-2xl`, slots de chave, dorsos, `display: none` no 2D). `i18n.ts`:
  `game.opponentHand` (en + pt-BR).
- **Aceite:**
  - Centro do avatar a ≤ 4px do centro horizontal do board.
  - Número do Æmber ≥ 22px visuais.
  - O retângulo do avatar não intersecta nenhuma `.card-art` (seeds de 6 e 12 criaturas e
    com artefatos).
  - Dorsos = `min(hand, 7)` + "+N", com `aria-label` correto nas duas línguas.
  - Ghost do Warden no frame 0 a ≤ 6px do dorso.
  - `e2e:fit` passa (a band não cresce).
  - 2D pixel-idêntico (os dorsos existem no DOM com `display: none`).

### H3D-20: Investida e impacto (M)
**Como** jogador, **quero** ver minha criatura avançar e acertar o alvo **para** sentir o
combate como na referência.
- **Escopo:** `FxLayer.tsx` (fase `lunge` com WAAPI em `translate` individual,
  `.fx-burst` com anel e faíscas, `fx-dmg` no ponto a 35%). `App.tsx` `commitWithFx`
  (atacante e defensor do move `fight`; `dy` por `offsetTop`). `index.css`
  (`.fx-burst`, só no portal). Só com `.game-board--3d` e `motionEnabled`.
- **Aceite:**
  - A investida dura 460 ± 30ms e a `rotate` computada da peça fica igual durante todo o
    trajeto.
  - A peça volta à pose (translate = `0 0 lift`) sem resíduo; o probe checa 100ms após o
    fim.
  - O `fx-dmg` nasce a ≤ 6px do ponto (centro x, 35% y) do defensor.
  - Nenhum frame > 33ms a 1280×800 com CPU 4× e GPU (trace manual, pendência herdada do
    VALIDATE §5.6).
  - Com reduce-motion: 0 animação disparada.
  - 2D: nenhuma animação nova (probe da luta no 2D sem `lunge`).

### H3D-21: Mesa-ambiente em gradiente + entrada do inspetor (S)
**Como** jogador, **quero** que a mesa tenha a cor do turno e que o detalhe da carta
entre deslizando **para** a cena parecer um lugar, não um fundo.
- **Escopo:** `index.css` (4ª e 5ª camadas do `.table-plane::before`, `--turn-house`;
  inspetor ≥1041 no 3D com `translate 16px → 0` + opacity em 200ms, `fill-mode:
  backwards` pelo `CLAUDE.md`). `App.tsx` (`--turn-house` no `style` do board).
- **Aceite:**
  - A cor do tapete na metade ativa muda com a casa (probe lê o `background-image`
    computado).
  - 0 `filter`/`backdrop-filter` novos.
  - A entrada do inspetor dura 200ms e não deixa `transform` residual (filhos `fixed`
    intactos).
  - Com reduce-motion a entrada é instantânea.
  - ≤ +0,15 kB gz.

### H3D-22 (opcional): Pilha xN de artefatos idênticos (M)
**Como** jogador com artefatos repetidos, **quero** vê-los empilhados com "x3" **para**
economizar espaço, como no Arena.
- **Regra:** empilham só artefatos com o mesmo `face.id` **e** estado idêntico (`ready`,
  `amber`, `damage`), 3 ou mais. Criaturas **nunca** empilham.
- **Escopo:** `App.tsx` `BoardLane` (agrupamento só visual: as peças 2..N ficam com
  `--stack-k` e a classe `board-piece--stacked`, **no DOM**, focáveis). `index.css`
  (camadas deslocadas −8px × k com no máximo 3 visíveis, badge "xN" como `::after` do
  topo com o texto num atributo `data-count`). `i18n.ts`: o `aria-label` do topo inclui
  `game.stackCount`.
- **Aceite:**
  - Tab percorre as N peças.
  - O clique no topo seleciona a do topo, e o pick de alvo aceita qualquer uma do grupo.
  - Quando o estado de uma diverge, ela sai da pilha no mesmo render.
  - Ganho medido: artefatos ocupam ≤ 1 slot por grupo.
- **Só fazer se** um deck real do Master Vault mostrar 3 ou mais artefatos iguais em jogo
  com frequência. Senão é bundle sem uso.

### Ordem sugerida

```
H3D-13 ─► H3D-14 ─► H3D-15 ─► H3D-17
   │         │         ├──► H3D-18 ◄── H3D-16
   │         │         └──► H3D-19
   └──► H3D-16 ─► H3D-20
             └──► H3D-21                      H3D-22 (opcional, por último)
```

- **Marco A1** (13 + 14 + 16) atende o pedido literal: "caber todas na tela" com a
  inclinação e o jitter do Arena.
- **Marco A2** (15 + 17 + 18) entrega a leitura: fileiras, upgrades e indicadores.
- **Marco A3** (19 + 20 + 21) completa o espetáculo: avatares, combate e ambiente.

Mostrar ao dono uma captura lado a lado com a ref 1 ao fim de A1, antes de investir em A2.

---

## 5. Orçamento, riscos e pendências

**Bundle.** Soma estimada: **+2,47 kB gz** sem a H3D-22, **+2,82 kB** com ela. Com o
baseline projetado de ≈144,5 kB (FIT-05 medido em 143,66 + FIT-06/07/08), o lote chega a
**≈147,0-147,3 kB**. Proposta pela regra 7: `chore(budget)` **145 → 147,5** por marco
(A1 ≈ +0,47 cabe sob 145 se o FIT fechar abaixo de 144,5; A2/A3 pedem a revisão), com a
tabela acima como justificativa. **Varredura de mortos antes de cada revisão.**
Candidatos já vistos na leitura:
- `.game-board--stage .hand-zone` e `.game-board--stage .hand-track` estão **declarados
  duas vezes** (`index.css:935/951` e `:955/959`); os blocos podem ser fundidos.
- Regra de largura 3D do anexo (`:7353-7356`), morta com o grid da H3D-15.
- `margin-block` −48/−32 e `padding-top: 36px` do leque, mortos **só no palco**. Continuam
  vivos no fallback `min-height: 520px`, então é preciso medir antes de remover.
- `ready-glow` do tile no 3D (`:7438-7452`), substituído pelo arco.

**Riscos**

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| `display: contents` no `role="list"` perde a semântica no WebKit antigo | Média | Médio | Probe a11y no Chromium, Safari manual e plano B no §3.2 |
| `container-type: size` na zona achata o 3D em algum motor | Baixa | Alto | `_3d-chain` com o check de projeção viva na H3D-14; plano B: medir a zona 1× por resize (sem estado React) |
| Criatura no piso de 64px a 1296×668 com artefato + upgrade | Certa (nesse seed) | Médio | Documentado (§3.4); se o dono achar pequeno, o artefato cai para 0,5× (+6px na criatura) |
| Jitter conflitar com o critério de pouso do FX | Média | Baixo | `--jr` lido pelo `FxLayer` (H3D-16) |
| Investida brigar com `data-fx="hit"`/`transform` | Média | Médio | Investida só em `translate` individual; o `hit` usa `transform` no tile (folha) |
| Carta em pé sob a band/hand-bar no palco | Média | Alto | Critério de `elementFromPoint` da H3D-14 |
| Firefox/WebKit sem binário no `playwright-core` | Certa | Médio | Pendência herdada (VALIDATE §5.7). As APIs usadas são as que o 3D já usa (`@property`, props individuais, container queries) mais grid e `display: contents` |

**Pendências herdadas que continuam valendo** (não bloqueiam, VALIDATE §5 "recomendado"):
`@supports` parcial no bloco-base, `e2e:acceptance` sem smoke 3D e sem `_3d-chain`, trace
com GPU, Safari iOS manual e `_png-diff` devolvendo "idêntico" no vazio. A H3D-13 é o
lugar natural para levar o `_3d-chain` e o `_3d-arena` para dentro do `e2e:acceptance`.
