# Guia do dono: navegar e debugar o Aember Arena

> Para quem conhece o KeyForge de cor, mas ainda não navega no código.
> Deixe o VS Code e um terminal abertos na pasta do repo. Todo `arquivo:linha`
> abaixo foi conferido em 22/out/2026. Se o código mudar, a linha pode andar
> alguns números; procure o nome da função com `Ctrl+Shift+F`.

**Atalho no VS Code:** `Ctrl+P` e digite `game.ts:3029` para abrir o arquivo já na linha.

---

## 1. Mapa da arquitetura: duas camadas

O projeto tem duas camadas que **não se misturam**:

```
┌──────────────── APLICAÇÃO / UI (React) ────────────────┐
│ telas, botões, animações, som, salvar no navegador     │
│   manda: "o jogador quer fazer ESTA jogada"  ──────┐   │
│   recebe: "este é o estado novo da partida"  ◄──┐  │   │
└─────────────────────────────────────────────────┼──┼───┘
┌──────────────── MOTOR (TypeScript puro) ────────┼──┼───┐
│ regras do KeyForge, abilities, IA               │  ▼   │
│   applyMove(estadoVelho, lado, jogada) → estadoNovo    │
└────────────────────────────────────────────────────────┘
```

**Termos:**
- **Estado (`GameState`)**: um objeto JavaScript com *tudo* da partida (mãos, mesa,
  âmbar, chaves, casa ativa, log). Definido em `src/lib/game.ts:156`.
- **Jogada (`GameMove`)**: um objeto pequeno que descreve a intenção, como
  `{ type: "play", instanceId: "..." }`. Definido em `src/lib/game.ts:198`.
- **Função pura**: recebe dados e devolve dados novos, sem alterar nada fora dela
  e sem tocar na tela, no disco ou na rede. Mesma entrada → mesma saída, sempre.

### A regra de ouro

> **A UI nunca lê nem altera o estado do motor "por dentro".** Ela só entrega
> uma jogada e recebe um estado novo. O motor nunca altera o estado que recebeu.
> Ele clona e devolve uma cópia (`applyMove` começa com `cloneGame`, em `src/lib/game.ts:3030`).

Por que isso importa para você: (1) um bug de regra pode ser reproduzido num teste
sem abrir o navegador; (2) o **Desfazer** funciona porque o estado antigo continua
intacto; (3) a IA "imagina" jogadas chamando o mesmo `applyMove` sem estragar a
partida real. O `CLAUDE.md` transforma isso em regra inquebrável (nº 2).

### Camada MOTOR (`src/lib/`)

| Arquivo | Papel |
|---|---|
| `game.ts` (~3,4 mil linhas) | **O coração.** Estado, legalidade (`isLegalMove` :3009), execução (`applyMove` :3029), disparo de abilities (`fire` :2320), fim de turno (`endTurn` :3199), log (`record` :437). |
| `abilities.ts` | Converte cada carta em regras declarativas: `rulesOf(face)` (:632) devolve abilities, keywords e efeitos. Aplica overrides do catálogo. `DSL_VERSION` em :18. |
| `cardText.ts` | O **parser**: lê o texto impresso ("Play: Gain 2 amber…") e gera a DSL. |
| `generated/` | Dados prontos: `keyteki.json`/`approved.json` (abilities revisadas) e `dslSchema.ts`. |
| `ai.ts` | A IA (o "Warden"): `chooseAiMove` (:216), `chooseAiHouse` (:187), `evaluatePosition` (:88). |
| `piles.ts` | Regras das pilhas laterais (descarte é público, arquivo só o dono vê). |
| `keywords.ts`, `houses.ts`, `fx.ts`, `laneLayout.ts` | Auxiliares puros (keywords, casas, plano de animação, layout das fileiras). |
| `cache.ts` | Armazenamento: IndexedDB para decks/catálogo e `localStorage` para a partida salva (`saveMatch` :268). |
| `keyforgeApi.ts`, `catalogLlm.ts` | Rede: Master Vault e o pipeline de tradução por LLM. |
| `i18n.ts` | Todos os textos da tela, en + pt-BR. |
| `testkit.ts` | **Seu melhor amigo para testes**: monta uma mesa sob medida (`setupTest` :46). |
| `*.test.ts` / `dsl*.test.ts` | Os testes (vitest). Cada `dslN` cobre um lote da DSL. |
| `scripts/` | ETL do catálogo (keyteki → corpus), harvest, conversor. Roda fora do app. |

**DSL** = "linguagem específica de domínio": aqui, o formato JSON em que cada
ability de carta é descrita (gatilho, ação e alvo) em vez de código `if/else` por carta.

### Camada APLICAÇÃO / UI

| Onde | Papel |
|---|---|
| `src/main.tsx` | Ponto de entrada: importa CSS e monta o `<App/>`. |
| `src/App.tsx` (~5,1 mil linhas) | O **componente-deus**: guarda o estado da partida, liga motor ↔ tela, roda o loop da IA, salva. Contém também o tabuleiro (`GameBoard` :1797, `BoardLane` :1659, `CardTile` :371) e o tradutor do log (`renderLog` :278). |
| `src/ui/` | **v2 "Forja Noturna"** (padrão): `screens/` (lobby, biblioteca, deck, resultado, configurações…), `primitives/` (Button, Chip, Sheet…), `shell/` (moldura, menu da mesa, rail), `lib/` (lógica pura das telas, com testes), `themes/` + `tokens.css`. |
| `src/ui/flag.ts` | Decide v1 ou v2: `?ui=1` / `?ui=2` na URL vence e fica salvo (`readUiFlag` :8). |
| `src/components/` | **v1**, ainda viva via `?ui=1`, e peças compartilhadas (CardArt, CardText, FxLayer = animações, DeckInspector…). |
| `src/index.css` | O CSS da mesa e da v1, escrito à mão e mobile-first. |
| `public/sw.js` | Service worker (cache offline). |
| `e2e/` | Robôs que abrem o navegador e medem a tela (veja §4). |

---

## 2. O ciclo de vida de uma jogada (do toque ao re-render)

Exemplo: você toca/arrasta o **Smith** da mão para a mesa.

1. **A carta é solta na mesa.** Em `GameBoard`, o arrasto da mão chama
   `onDrop` → `onPlayHand(card)` em `src/App.tsx:1913`. Antes disso, `canDrag`
   (`src/App.tsx:1911`) já perguntou ao motor `isLegalMove(...)` se a carta
   pode ser jogada. É por isso que cartas ilegais não arrastam.
2. **A UI monta a jogada.** O `GameBoard` é renderizado com
   `onPlayHand={(card) => performHumanMove({ type: "play", instanceId: card.instanceId })}`
   em `src/App.tsx:4701`.
3. **Escolhas pendentes.** `performHumanMove` (`src/App.tsx:3879`) pergunta ao
   motor, nesta ordem: há casa a escolher? (`houseChoices`, :3887), há mais de um
   alvo? (`targetChoices`, :3892), há segundo alvo/"up to N"? (`pendingPrompt`, :3899).
   Se houver, ela só abre o seletor (`setPick`) e **retorna**. Quando você escolhe,
   a mesma função roda de novo com a jogada completa.
4. **O motor executa.** `src/App.tsx:3909`:
   `commitWithFx(prev, applyMove(prev, side, move), …)`.
   Dentro de `applyMove` (`src/lib/game.ts:3029`):
   - `cloneGame` (:3030) copia o estado; o antigo nunca é tocado;
   - `isLegalMove` (:3032) valida de novo (se for ilegal, devolve a cópia sem mudança);
   - `resolveMove` (:3056) faz o trabalho da carta.
5. **A carta resolve.** Em `resolveMove`: a carta sai da mão, o bônus de âmbar é
   pago, `record(state, "log.play", …)` (por volta de :3090) escreve no log e
   então `fire(state, playerIndex, source, "play", …)` (:3115) dispara as
   abilities "Play:". Em seguida, `fireObservers(..., "enter")` avisa cartas que
   reagem a criaturas entrando.
6. **A DSL vira efeito.** `fire` (`src/lib/game.ts:2320`) chama `fireOwn` (:2337),
   que pega `abilitiesOf(state, source)` (:693, que por baixo usa `rulesOf` de
   `abilities.ts:632`), filtra as que têm o gatilho certo (`ability.on.includes(trigger)`),
   checa a condição (`ability.if`), escolhe o alvo e executa cada ação sobre o
   estado clonado. No Smith, a condição é "mais criaturas que o oponente" e a ação é "ganhar 2".
7. **O log.** `record` (`src/lib/game.ts:437`) só empurra `{ key, params, turn }`
   em `state.log`. O texto legível é montado depois, na tela, por `renderLog`
   (`src/App.tsx:278`) com as frases do `i18n.ts`.
8. **Commit e re-render.** `commitWithFx` (`src/App.tsx:3081`) mede as posições
   para a animação e chama `commitGame` (:3068), que empilha o estado antigo no
   histórico do Desfazer, guarda o novo em `gameRef` e chama **`setGame(next)`**.
   É esse `setGame` que faz o React redesenhar a tela (**re-render** = o React
   recalcula os componentes cujo estado mudou e atualiza o DOM).
9. **Salvar.** Um efeito em `src/App.tsx:3436` grava a partida a cada mudança:
   `saveMatch({ game, deckId })` → `localStorage["aember-arena-match"]`
   (`src/lib/cache.ts:257`).
10. **Vez da IA.** Ao passar o turno, o loop da IA em App.tsx chama
    `chooseAiMove` e depois o **mesmo** `applyMove` (`src/App.tsx:3619`). A IA
    passa pela mesma porta que você.

---

## 3. Por onde começar a LER

Comece pelo que é pequeno e puro e deixe o monolito para o fim.

1. **`src/lib/piles.ts` + `piles.test.ts`** (~30 linhas cada). *Meta:* entender
   o formato de um teste (`describe`/`it`/`expect`) e como `setupTest` monta uma mesa.
2. **`src/lib/testkit.ts`**. *Meta:* saber criar cartas falsas (`card`, `face`)
   e uma partida no meio do turno (`setupTest`: `turn = 2`, casa já escolhida).
3. **`src/lib/game.ts` :156-220** (`GameState`, `GameMove`). *Meta:* conseguir
   olhar um save e saber o que é cada campo (`players[0].hand`, `board`, `amber`,
   `activeHouse`, `log`…).
4. **`game.ts` :3009-3130** (`isLegalMove`, `applyMove`, começo de `resolveMove`).
   *Meta:* seguir uma jogada "play" até `fire`.
5. **`game.ts` :2320-2400** (`fire`/`fireOwn`) + `abilities.ts:632` (`rulesOf`).
   *Meta:* entender "gatilho → condição → alvo → ação".
6. **`docs/MECHANICS_REPORT.md`** junto com um `dsl*.test.ts` qualquer. *Meta:*
   ler a DSL de uma carta sabendo o que cada chave significa.
7. **`src/lib/ai.ts`** (270 linhas). *Meta:* ver que a IA só simula jogadas e dá nota.
8. **`src/ui/lib/*.ts`** (lógica pura das telas v2, com testes) e uma tela simples,
   como `src/ui/screens/result/ResultScreen.tsx`. *Meta:* entender props → JSX.
9. **`src/App.tsx`**, por busca e não de ponta a ponta: `performHumanMove`,
   `commitGame`, `GameBoard`. *Meta:* achar a ponte motor ↔ tela.
10. **CSS** (`src/index.css`, `src/ui/**/*.css`) por último, e só quando for mexer em visual.

---

## 4. Como DEBUGAR na prática

### 4.1 Subir o ambiente

```bash
npm install        # só na primeira vez
npm run dev        # abre em http://localhost:5173
```

- `http://localhost:5173/` → UI **v2** (padrão).
- `http://localhost:5173/?ui=1` → UI **v1**. A escolha **fica salva**; use `?ui=2` para voltar.
- O **HMR** (troca a quente) do Vite aplica na hora o que você salvar no editor, sem recarregar a página.
- Em dev **não** há service worker (cache offline), então você sempre vê o código atual.

### 4.2 DevTools do navegador (F12)

- **Sources → breakpoint no TypeScript.** O Vite gera *sourcemaps* (mapas que
  ligam o JS executado ao seu `.ts`). `Ctrl+P` dentro do DevTools, digite
  `game.ts`, clique no número da linha (ex.: a do `applyMove`). Jogue uma carta e
  a execução **para** ali. Passe o mouse sobre as variáveis ou use o painel
  *Scope*. Use `F10` para ir à próxima linha, `F11` para entrar na função e `F8` para continuar.
- **Breakpoint condicional:** botão direito no número → *Add conditional
  breakpoint* → `move.type === "fight"`. Para só no que interessa.
- **Console:** erros vermelhos são o primeiro lugar a olhar. Com a execução
  parada, você pode digitar `state.players[0].board` ali mesmo.
- **Network:** filtre por `img` para ver de onde vem a arte (S3 do Master Vault,
  por idioma). Marque *Offline* para testar o modo sem rede.
- **React DevTools** (extensão do Chrome/Edge): aba *Components* mostra a árvore
  (`App` → `GameBoard` → `BoardLane` → `CardTile`) com props e estado. Clique num
  `CardTile` para ver a carta que ele recebeu.

### 4.3 O estado da partida no `localStorage` (reproduzir um bug)

DevTools → **Application → Local Storage → `http://localhost:5173`**:

| Chave | Conteúdo |
|---|---|
| `aember-arena-match` | `{ game, deckId, savedAt }`, a partida inteira |
| `aember-arena-settings` | configurações (velocidade da IA, 3D, animações…) |
| `aember-arena-theme` | tema |
| `aember-arena-language` | idioma |
| `aember-arena-ui` | v1 ou v2 |
| `aember-arena-last-deck` | último deck jogado |

**Receita para guardar a partida exata de um bug** (no Console):

```js
copy(localStorage.getItem("aember-arena-match"))   // vai para a área de transferência
```

Cole num arquivo (ex.: `docs/qa/bug-xyz.json`). Para **reinjetar** depois:

```js
localStorage.setItem("aember-arena-match", `COLE_AQUI`); location.reload()
```

Na Home aparece "Continuar partida" no ponto exato. Você também pode **editar** o
JSON antes de reinjetar (pôr uma carta na mão, mudar o âmbar) para montar o
cenário. É o mesmo truque que os probes usam (`FILL_PILES` em `e2e/probes/_zonas-piles.mjs`).
A partida carrega pelo `loadSavedMatch` (`src/lib/cache.ts`), que normaliza saves antigos.

### 4.4 Os gates (verificações automáticas)

| Comando | O que protege | Quando rodar |
|---|---|---|
| `npm run typecheck` | Tipos do TypeScript (pega nome errado, campo inexistente). | Sempre, depois de qualquer edição. |
| `npm test` | Todos os testes vitest (motor, DSL, IA, lógica das telas). | Mexeu em `src/lib` ou `src/ui/lib`. |
| `npm test -- piles` | Só os testes cujo arquivo contém "piles". | Enquanto investiga um bug. |
| `npm run lint:ui2` | Regras do CSS da v2 (tokens, sem valores soltos). | Mexeu em CSS de `src/ui`. |
| `npm run e2e:floor` | Piso de fonte (11px) a 360px de largura. | Mexeu em texto ou layout 2D. |
| `npm run e2e:fit` / `e2e:fit:3d` | A mesa cabe na tela (2D/3D), e a mão aparece. | Mexeu no tabuleiro ou na mão. |
| `npm run e2e:arena` | Layout Arena da mesa 3D (fileiras, notch, escala). | Mexeu na mesa 3D. |
| `npm run build` | Tipos + bundle final. | Antes de qualquer commit. |

### 4.5 Probes: exemplos executáveis

Um **probe** (`e2e/probes/_*.mjs`) é um script Node que: (1) sobe um Vite numa
porta própria, (2) abre o Edge/Chrome do sistema via `playwright-core`, (3) entra
na partida demo, (4) **edita o save no `localStorage`** para criar o cenário, e (5)
mede o DOM e tira capturas. Leia `e2e/probes/_zonas-piles.mjs` junto com este guia:
- linha ~18: `spawn(... vite.js --port 5232)`, o servidor próprio;
- `FILL_PILES`: o patch de `aember-arena-match` (a mesma receita da §4.3);
- `bad(msg)`: cada falha vira uma linha `! ...` e o código de saída é diferente de 0.

Rode com `node e2e/probes/_zonas-piles.mjs` e veja as capturas em `e2e/shots/zonas/`.

### 4.6 Teste de 10 linhas para dissecar o motor

Crie `src/lib/meu.test.ts` (**este exemplo foi rodado e passa**):

```ts
import { describe, expect, it } from "vitest";
import { applyMove } from "./game";
import { byTitle, setupTest } from "./testkit";

describe("guia: jogar o Smith", () => {
  it("dá 1 Æ do ícone + 2 Æ quando tenho mais criaturas", () => {
    const before = setupTest({ hand: ["Smith"], inPlay: ["Headhunter"] }, {});
    const smith = byTitle(before.players[0].hand, "Smith")!;
    const after = applyMove(before, 0, { type: "play", instanceId: smith.instanceId });
    expect(after.players[0].amber).toBe(3);
    expect(byTitle(after.players[0].discard, "Smith")).toBeDefined();
    expect(before.players[0].hand).toHaveLength(1); // o estado antigo não mudou!
    console.log(after.log);
  });
});
```

`npx vitest run src/lib/meu.test.ts` → `✓ 1 passed` e imprime
`[{ key: 'log.play', params: { name: 'You', card: 'Smith' }, turn: 2 }]`.

Observações importantes:
- `setupTest` usa os **decks demo**. Uma carta que não existe neles vira uma
  criatura Brobnar genérica sem texto, e o teste falha de forma confusa. Para
  cartas de fora, passe o texto: `card("Urchin", { house: "Shadows", type: "Creature", text: "Play: Steal 1A." })`.
- A casa ativa é a da 1ª carta da mão. Para outra, passe o 3º argumento:
  `setupTest(..., ..., "Shadows")`.
- Rode em modo observação com `npx vitest src/lib/meu.test.ts`: ele roda de novo a cada salvamento.

### 4.7 Fluxo de QA do dono

1. Achou o bug jogando → **antes de qualquer clique**, `copy(localStorage.getItem("aember-arena-match"))`.
2. Registre em `docs/QA_BUGS.md` no formato existente (`## QA-NN · título`): carta,
   texto impresso, o que esperava, o que aconteceu e o save anexado.
3. Se for regra: reproduza num teste da §4.6. Teste falhando = bug provado.
   A correção fica pronta quando ele passa e o `npm test` inteiro continua verde.
   Veja `src/lib/qa01.test.ts` e `trawler.test.ts` como modelos reais.

---

## 5. Exercícios práticos

**(a) Breakpoint numa jogada real.** `npm run dev` → inicie a partida demo → F12 →
Sources → `game.ts` → breakpoint na 1ª linha de `applyMove` (:3030). Jogue uma
carta. Na pausa, inspecione `move` e `current.players[0].hand.length`. Aperte
`F10` até depois de `resolveMove` e compare. *Pergunta:* `current` mudou? (Não deveria.)

**(b) Mudar um texto com HMR.** `Ctrl+Shift+F` por `"log.play"` em `src/lib/i18n.ts`.
Mude a versão pt-BR (2º item do par `[en, pt]`), salve e jogue uma carta: o log
já mostra o texto novo, sem recarregar. Desfaça depois. O texto **das cartas**
vem do Master Vault/decks demo (`src/lib/demoDeck.ts`) e não do i18n.

**(c) Teste do motor.** Faça a §4.6. Depois troque `inPlay: ["Headhunter"]` por
`inPlay: []` e preveja o âmbar antes de rodar (resposta: 1, só o ícone).

**(d) Probe.** `node e2e/probes/_zonas-piles.mjs`. Linhas `!` indicam falha; o
código de saída 0 indica sucesso. Abra as PNG em `e2e/shots/zonas/` e confira se
o arquivo do oponente aparece virado. *(Este não foi executado ao escrever o
guia. Precisa do Edge/Chrome instalado.)*

---

## 6. Referências do repo

- `CLAUDE.md` (raiz): estado atual, comandos e regras invioláveis. **Leia primeiro.**
- `docs/ARCHITECTURE.md`: visão técnica geral (não existe `AGENTS.md`/`ARCHITECTURE.md` na raiz).
- `docs/MECHANICS_REPORT.md`: a "bíblia" do motor: gatilhos, ações, cobertura.
- `docs/DSL_EXPANSION_PLAN*.md`, `DSL_LOTE11.md`, `WAVE4_BACKLOG.md`: por que cada pedaço da DSL existe e o que falta.
- `docs/KEYTEKI_CONVERSION_PLAN.md`: de onde vêm as abilities importadas do keyteki.
- `docs/UX_REWRITE_PLAN.md`: a v2 "Forja Noturna" (H-xx), quando mexer em telas.
- `docs/QA_BUGS.md`: bugs de gameplay, abertos e resolvidos.
- `docs/VIEW3D_PLAN.md` / `VIEW3D_ARENA_LAYOUT.md`: a mesa 3D.
