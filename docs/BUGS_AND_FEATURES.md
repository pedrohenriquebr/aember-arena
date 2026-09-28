# BUGS_AND_FEATURES — varredura de qualidade (auditoria pós-keyteki)

Levantamento para o executor: **nada aqui foi corrigido ou implementado**. Cada `BUG-xx`
tem severidade, evidência (arquivo:linha em `HEAD` 1d4e385 + passos de repro) e uma
correção sugerida em uma linha; cada `FEAT-xx` tem problema, comportamento esperado,
escopo, esforço e prioridade. Itens já resolvidos nas missões de polish/keyteki
(`docs/POLISH_REPORT.md`, `git log`) foram excluídos. O estado do motor está em
[`MECHANICS_REPORT.md`](./MECHANICS_REPORT.md).

**Severidade:** alta = crash / progresso perdido / regra real violada · média =
comportamento errado visível · baixa = cosmético ou raro.

## Probes (evidência executável)

| Probe | Como rodar | O que prova |
|---|---|---|
| `e2e/probes/engine.probe.ts` | `npx vitest run --config e2e/probes/vitest.config.ts engine` | BUG-01, 02, 04, 06, 09, 10, 11 como `it.fails`: cada teste afirma o comportamento **correto** e passa enquanto o bug existe. Quando o executor corrigir, o probe fica vermelho → mover o spec para `src/lib/*.test.ts`. |
| `e2e/probes/ui.probe.mjs` | `node e2e/probes/ui.probe.mjs` | BUG-01, 02, 03, 05, 13, 14, 15, 16 no app real (vite dev + Edge/Chrome do sistema, API do Master Vault mockada com `page.route`, roda offline). Imprime `REPRODUCED <id> <evidência>`; screenshots em `e2e/probes/shots/` (não versionados). |

Saída do `ui.probe.mjs` em 2026-09-28:

```
REPRODUCED  BUG-02  button "Play card" enabled=true; hand 7 -> 6; turn console: "Choose one house"
REPRODUCED  BUG-03  15 s after returning: end turn disabled=true; console "Warden is thinking"
REPRODUCED  BUG-01  #root children=0; pageerror: Cannot read properties of undefined (reading 'match')
REPRODUCED  BUG-05  selected before sync "Shadowmaster Desmares" -> after "Synced Demo Deck"; toast "Synced Synced Demo Deck: 36 card records refreshed."
REPRODUCED  BUG-14  vault list requests: 2 -> 3 after changing language
REPRODUCED  BUG-15  browse "Page 3 of 10" -> after back "Page 1 of 10"
REPRODUCED  BUG-13  Home library "2 decks available" -> after opening Browse once and reloading "11 decks available"
REPRODUCED  BUG-16  IndexedDB off: library "3 decks available" (localStorage copy=true) -> after reload "2 decks available"
```

## Índice

| ID | Sev. | Área | Título |
|---|---|---|---|
| [BUG-01](#bug-01) | alta | motor/parser | "Fully heal …" derruba o parser → tela branca com deck importado |
| [BUG-02](#bug-02) | alta | motor/regras | Antes de escolher a casa dá para jogar/colher/usar qualquer carta |
| [BUG-03](#bug-03) | alta | partida/IA | Sair do board durante o turno da IA congela a partida |
| [BUG-06](#bug-06) | alta | motor/regras | Alvo de `Fight:`/`Before Fight:` nunca é escolhido (humano nem IA) |
| [BUG-11](#bug-11) | alta | motor/regras | "Use a friendly creature" só colhe |
| [BUG-23](#bug-23) | alta | motor/regras | Criaturas Gigantic jogáveis metade por metade |
| [BUG-04](#bug-04) | média | motor | Upgrade num hospedeiro inimigo fica órfão no board |
| [BUG-05](#bug-05) | média | sync | Sync age no deck da última partida e troca o deck selecionado |
| [BUG-07](#bug-07) | média | service worker | Shell offline nunca atualiza depois da primeira instalação |
| [BUG-08](#bug-08) | média | board/UI | Âmbar capturado e upgrades anexados invisíveis no board |
| [BUG-12](#bug-12) | média | IA | IA para após 7 ações por turno |
| [BUG-13](#bug-13) | média | cache/IndexedDB | Todo deck listado no Vault vira deck "salvo" na Home |
| [BUG-16](#bug-16) | média | cache | Sem IndexedDB, o deck importado some da biblioteca no reload |
| [BUG-17](#bug-17) | média | board/UI | Chains invisíveis; compra menor sem explicação |
| [BUG-09](#bug-09) | baixa | motor/UI | Prompt de alvo avalia a condição antes do âmbar bônus da carta |
| [BUG-10](#bug-10) | baixa | motor/IA | "Sacrifice X. Destroy an artifact." conta o próprio X como alvo |
| [BUG-14](#bug-14) | baixa | Vault/i18n | Trocar idioma no Vault refaz a requisição |
| [BUG-15](#bug-15) | baixa | Vault | Vault → Explorar deck → Voltar perde página e busca |
| [BUG-18](#bug-18) | baixa | board/UI | Artefatos/upgrades intercalados na linha: vizinhos visuais ≠ vizinhos do motor |
| [BUG-19](#bug-19) | baixa | i18n | Interpolação interpreta `$&`, `$'`… em nomes de deck |
| [BUG-20](#bug-20) | baixa | Vault/i18n | Erros não-Vault aparecem em inglês cru |
| [BUG-21](#bug-21) | baixa | sync | Sync não atualiza a partida em curso (`refreshGameFaces` morto) |
| [BUG-22](#bug-22) | baixa | i18n/motor | Tipo de carta desconhecido vira chave crua e é resolvido como Action |
| [BUG-24](#bug-24) | baixa | board/UI | Seleção de alvo pendente sobrevive a clicar numa carta da mão |
| [BUG-25](#bug-25) | baixa | service worker | Arte opaca inflando a cota do cache |

---

## A) Bugs

<a id="bug-01"></a>
### BUG-01 — "Fully heal …" derruba o parser → tela branca com deck importado
- **Severidade:** alta (crash; a partida e o inspetor ficam inutilizáveis).
- **Evidência:** `src/lib/cardText.ts:103` define `/^fully heal (.+)$/` com `k: "heal"`;
  `src/lib/cardText.ts:140` passa `m[2]` para `parseObject` sempre que `k === "heal"`,
  mas esse regex só tem `m[1]` → `parseObject(undefined)` → `phrase.match` lança
  `TypeError` (`cardText.ts:49`). `rulesOf` (`abilities.ts:79`) propaga; é chamado por
  `keyword()` (`game.ts:215`) em `canPlay`/`fightTargets`/`placeCreature`, por
  `CoverageBadge` e pelo `SelectedCardPanel` (`App.tsx:1034-1036`, que avalia legalidade
  da mão inteira em todo render). Não há error boundary → `#root` vazio. 16 cartas do
  pool real afetadas (Seraphic Armor, Healing Blast, Bosch the Unyielding, Duma the
  Martyr, Monsquito, Deepwood Druid… lista em `coverage.probe.ts`).
- **Repro:** importar um deck do Master Vault com qualquer dessas cartas → Configurar →
  Jogar → tela branca assim que a carta está na mão (ou abrir a carta no lightbox).
  Probes: `engine.probe.ts` (2 casos) e `ui.probe.mjs` (`#root children=0`).
- **Correção sugerida:** usar o grupo certo por verbo (`fully heal` → `m[1]`) e
  envolver `parseCardText` em `try/catch` que degrade a carta para `vanilla`.

<a id="bug-02"></a>
### BUG-02 — Antes de escolher a casa dá para jogar/colher/usar qualquer carta
- **Severidade:** alta (regra real violada: a casa ativa é escolhida antes de qualquer
  jogada; hoje o jogador joga cartas de **todas** as casas e depois ainda escolhe uma).
- **Evidência:** `isLegalMove` usa `state.activeHouse` (`game.ts:641`), que é `null` até
  `chooseHouse`; `houseAllows(card, null)` devolve `true` (`game.ts:518`), então
  `baseMoves` libera play/discard/reap/fight/use de qualquer casa. A UI confia nisso
  (`App.tsx:1034-1036`): o botão "Jogar carta" fica habilitado com o console dizendo
  "Choose one house". `endTurn` também aceita terminar sem casa (`game.ts:733-735`).
- **Repro:** iniciar partida → sem escolher casa, tocar uma carta da mão → "Jogar
  carta" habilitado; tocar → a carta é jogada (mão 7 → 6). `ui.probe.mjs` e
  `engine.probe.ts`.
- **Correção sugerida:** em `baseMoves`, retornar `[]` para o jogador ativo enquanto
  `activeHouse === null` (a IA já passa a casa explicitamente em `chooseAiMove`).

<a id="bug-03"></a>
### BUG-03 — Sair do board durante o turno da IA congela a partida
- **Severidade:** alta (progresso perdido: a partida não anda mais; só resta iniciar outra).
- **Evidência:** o efeito do turno da IA grava `aiTurnRef.current = turnKey` antes de
  agir (`App.tsx:1373-1375`) e depende de `screen` (`App.tsx:1416`). Ao trocar de tela o
  cleanup cancela o loop (`App.tsx:1415`); ao voltar, `turnKey` é o mesmo e o efeito sai
  cedo em `App.tsx:1374` → a IA nunca termina o turno, `aiThinking` fica `true` e "End
  turn" desabilitado. O botão de engrenagem do próprio rail (`App.tsx:1778`) leva à
  Configuração no meio do turno da IA.
- **Repro:** partida → "End turn" → em <1 s ir a Settings (ou tocar a engrenagem do
  rail) → voltar a Play → "Warden is thinking" para sempre. `ui.probe.mjs` (15 s depois,
  `end turn disabled=true`), screenshot `bug-03-ai-softlock.png`.
- **Correção sugerida:** só gravar `aiTurnRef` quando o turno termina (ou limpá-lo no
  cleanup quando `cancelled`) e retomar a partir de `gameRef.current`.

<a id="bug-06"></a>
### BUG-06 — Alvo de `Fight:`/`Before Fight:` nunca é escolhido (humano nem IA)
- **Severidade:** alta (regra real violada: o controlador escolhe o alvo; hoje sempre
  `autoPick`).
- **Evidência:** `getLegalMoves` não expande alvos de jogadas `fight`
  (`game.ts:619`: `move.type === "fight" ? []`), então a IA nunca busca a escolha; a UI
  descarta o prompt para lutas (`App.tsx:1448`: `move.type === "fight" … ? []`). O motor
  já aceita `move.target` em `fight` (`game.ts:667`, `fire` com `choice`), e
  `targetChoices` já entende `beforeFight`/`fight` (`game.ts:551`, `578-582`).
  Afeta ex.: Achromatic Basilisk ("After Fight: Exhaust an enemy creature"),
  Bestiarii Urso ("Play/Fight: Stun a creature").
- **Repro:** criatura com "After Fight: Exhaust an enemy creature" lutando com 3
  inimigos → o alvo é sempre o mais forte, sem prompt. `engine.probe.ts`.
- **Correção sugerida:** expandir `fight` por `targetChoices` em `getLegalMoves` e,
  na UI, abrir o segundo pick (alvo da ability) depois de escolher o defensor.

<a id="bug-11"></a>
### BUG-11 — "Use a friendly creature" só colhe
- **Severidade:** alta (regra real violada; hoje afeta Dominator Bauble e qualquer carta
  futura com `use`).
- **Evidência:** `run` trata `use` chamando `reap(...)` (`game.ts:446-447`): a criatura
  nunca luta nem usa sua `Action:`. Usar = colher **ou** lutar **ou** Action/Omni, à
  escolha do jogador.
- **Repro:** Dominator Bauble + criatura "Action: Steal 2A" com oponente em 5 âmbar →
  usar o Bauble mirando a criatura → ganha 1 (colheita) em vez de roubar 2.
  `engine.probe.ts`.
- **Correção sugerida:** modelar `use` como sub-jogada (reap/fight/action) escolhida
  via `move` aninhado (IA: expandir as três opções).

<a id="bug-23"></a>
### BUG-23 — Criaturas Gigantic jogáveis metade por metade
- **Severidade:** alta (regra real violada; 20 criaturas Gigantic = 40 cartas em
  decks de MM/MoMu/sets posteriores).
- **Evidência:** a restrição vem só em texto de lembrete — "(Play only with the other
  half of Ultra Gravitron.)" — e `normalise` apaga todo parêntese
  (`cardText.ts:34`); `canPlay` não conhece Gigantic (`game.ts:530-534`). Cada metade
  vira uma criatura independente, com poder e texto próprios. Lista: Ultra Gravitron,
  Niffle Kong, Dodger's 10, Deusillus, Kulsha, Zomok, Gigantor, The Golden Queen…
- **Repro:** deck do Master Vault com Ultra Gravitron → escolher a casa → jogar só uma
  metade (a outra no deck) → entra em jogo como criatura normal.
- **Correção sugerida:** detectar "play only with the other half of X" antes do
  `normalise`, marcar a carta como Gigantic e só permitir jogar com as duas metades
  na mão (uma criatura, a outra metade embaixo).

<a id="bug-04"></a>
### BUG-04 — Upgrade num hospedeiro inimigo fica órfão no board
- **Severidade:** média.
- **Evidência:** o upgrade fica no board de **quem o jogou** (`game.ts:691`), mas
  `leavePlay` do hospedeiro só procura upgrades no board do **controlador do
  hospedeiro** (`game.ts:331`). Upgrade jogado em criatura inimiga nunca vai ao
  descarte e mantém `attachedTo` apontando para uma instância fora de jogo (se essa
  criatura voltar à mesa com o mesmo `instanceId`, o upgrade "reanexa").
- **Repro:** jogar um upgrade numa criatura inimiga → destruí-la em luta → o upgrade
  continua na sua linha. `engine.probe.ts`.
- **Correção sugerida:** em `leavePlay`, varrer os boards dos **dois** jogadores por
  `attachedTo === card.instanceId`.

<a id="bug-05"></a>
### BUG-05 — Sync age no deck da última partida e troca o deck selecionado
- **Severidade:** média.
- **Evidência:** `syncCurrentDeck` sincroniza `currentDeck` (deck da última partida;
  `DEMO_DECK` antes de qualquer partida) e depois chama `setSelectedDeck(deck)`
  (`App.tsx:1519-1526`). Na Home, com outro deck selecionado, Sync sobrescreve a
  seleção; offline, o toast "usando cópia salva de X" (`App.tsx:1531`) cita um deck que
  o jogador não escolheu.
- **Repro:** Home → selecionar "Shadowmaster Desmares" → Sync → a barra inferior passa
  a mostrar o deck sincronizado. `ui.probe.mjs`.
- **Correção sugerida:** sincronizar `selectedDeck` fora da tela de jogo (e
  `currentDeck` só dentro dela) e nunca mudar a seleção como efeito colateral.

<a id="bug-07"></a>
### BUG-07 — Shell offline nunca atualiza depois da primeira instalação
- **Severidade:** média (após um deploy, abrir offline serve a versão da instalação).
- **Evidência:** navegação é network-first mas o `fetch` bem-sucedido **não** é gravado
  no cache (`public/sw.js:127-133`); o fallback offline sempre devolve o `./`/
  `index.html` do `install` (`sw.js:103-104`). Demais assets same-origin são
  cache-first sem revalidação (`sw.js:135-142`), então `manifest.webmanifest`/ícone
  também congelam. `SHELL_CACHE` só muda com edição manual do nome (`sw.js:1`).
- **Repro:** instalar a v1 → publicar v2 (sem mudar `sw.js`) → abrir online (vê v2) →
  abrir offline → volta a v1.
- **Correção sugerida:** no branch `navigate`, `cache.put("./index.html", copy)` quando
  `response.ok`; assets same-origin em stale-while-revalidate.

<a id="bug-08"></a>
### BUG-08 — Âmbar capturado e upgrades anexados invisíveis no board
- **Severidade:** média (informação de jogo escondida: o jogador não vê quanto âmbar o
  oponente capturou nem onde está cada upgrade).
- **Evidência:** `CardTile` só desenha título e dano (`App.tsx:206-207`); o âmbar
  capturado aparece apenas no inspetor (`App.tsx:1061`). O memo `sameCardInstance`
  compara só `damage/ready/stunned` (`App.tsx:139-149`), então nem adicionando o badge
  ele atualizaria quando `amber`/`attachedTo` mudam. Upgrades são desenhados como
  cartas soltas na linha do dono (`App.tsx:812-835`).
- **Repro:** jogar Charette ("Play: Capture 3A") com o oponente em 3 âmbar → a criatura
  não mostra nada; só abrindo o inspetor aparece "3 captured".
- **Correção sugerida:** badge de âmbar capturado no tile + upgrade desenhado sob o
  hospedeiro, incluindo `amber`/`attachedTo` em `sameCardInstance`.

<a id="bug-12"></a>
### BUG-12 — IA para após 7 ações por turno
- **Severidade:** média (IA joga pior do que as regras permitem em boards grandes).
- **Evidência:** `for (let action = 0; action < 7; action += 1)` no loop da IA
  (`App.tsx:1391`). Com mão + criaturas prontas > 7, o restante fica sem uso e o turno
  acaba.
- **Repro:** partida longa em que a IA tem 5 criaturas prontas e 4 cartas da casa →
  ela termina o turno com jogadas úteis sobrando (log mostra 7 ações).
- **Correção sugerida:** trocar o teto fixo por "até `chooseAiMove` devolver `null`"
  com um limite de segurança alto (ex.: 40).

<a id="bug-13"></a>
### BUG-13 — Todo deck listado no Vault vira deck "salvo" na Home
- **Severidade:** média (biblioteca poluída e crescimento sem limite do IndexedDB; sem
  forma de remover).
- **Evidência:** `fetchDeckPage` grava **todos** os decks da página no cache
  (`keyforgeApi.ts:200-202`); na inicialização a Home restaura **todo** deck do cache
  como salvo (`App.tsx:1302-1311`). A store `cards` é escrita (`cache.ts:71-72`) e nunca
  lida.
- **Repro:** abrir o Vault uma vez → recarregar → Home passa de "2 decks" para "11
  decks", todos com o selo "salvo offline". `ui.probe.mjs`.
- **Correção sugerida:** marcar decks importados/adotados (`saved: true`) e listar só
  esses; decks do Vault vão para um cache LRU separado.

<a id="bug-16"></a>
### BUG-16 — Sem IndexedDB, o deck importado some da biblioteca no reload
- **Severidade:** média (progresso perdido: o deck continua no `localStorage`, mas a
  Home não o mostra).
- **Evidência:** `cacheDeck` cai para `localStorage` (`cache.ts:78-80`), e
  `getCachedDeck` lê esse fallback (`cache.ts:118-120`), mas `listCachedDecks` só lê o
  IndexedDB e devolve `[]` quando ele falha (`cache.ts:87-101`).
- **Repro:** navegador sem IndexedDB (ex.: modos privados restritivos; o probe remove
  `window.indexedDB`) → importar deck → recarregar → a biblioteca volta a 2 decks.
  `ui.probe.mjs`.
- **Correção sugerida:** `listCachedDecks` também varre as chaves `keyforge-deck-*` do
  `localStorage` e mescla por `id`.

<a id="bug-17"></a>
### BUG-17 — Chains invisíveis; compra menor sem explicação
- **Severidade:** média.
- **Evidência:** o motor aplica penalidade de chains na compra (`game.ts:164-168`) e
  cartas dão chains (Coward's End, Gateway to Dis, Ballcano…), mas `PlayerBand` mostra
  só chaves e âmbar (`App.tsx:751-755`); nenhum lugar da UI exibe `chains`. A regra
  rápida ainda diz "6 amber forges a key" (`i18n.ts:175`/`474`) mesmo quando o custo
  está em 9 (Lash).
- **Repro:** jogar Gateway to Dis (+3 chains) → fim do turno compra 1 carta a menos,
  sem nenhum indicador ou log.
- **Correção sugerida:** contador de chains no `PlayerBand` (com `aria-label` via `t()`)
  e `rail.rule3` com `{cost}` interpolado.

<a id="bug-09"></a>
### BUG-09 — Prompt de alvo avalia a condição antes do âmbar bônus da carta
- **Severidade:** baixa.
- **Evidência:** `targetChoices` avalia `item.if` no estado **antes** da jogada
  (`game.ts:579-581`), mas `applyMove` soma o âmbar bônus (`game.ts:681`) antes de
  `fire` (`game.ts:695`). Uma carta com ícone de âmbar e "If you have 3A or more…" com
  2 âmbar: a UI não pergunta o alvo e o motor resolve com `autoPick`.
- **Repro:** `engine.probe.ts` (Scrapper com 1 âmbar bônus, 2 alvos → `targetChoices`
  vazio, mas o dano acontece).
- **Correção sugerida:** na view de `targetChoices` para `play`, somar
  `source.face.amber` ao jogador antes de avaliar a condição.

<a id="bug-10"></a>
### BUG-10 — "Sacrifice X. Destroy an artifact." conta o próprio X como alvo
- **Severidade:** baixa (só a avaliação da IA; o resultado é inócuo).
- **Evidência:** o alvo é resolvido antes das ações (`game.ts:475-480`) e o filtro
  `{ type: "Artifact" }` inclui a própria fonte; `canResolve` (`game.ts:318-320`) diz
  que Gorm of Omm/Mighty Javelin sempre têm efeito, então a IA sacrifica o artefato
  sem outro alvo.
- **Repro:** Gorm of Omm sozinho em jogo → `moveHasEffect` = `true`. `engine.probe.ts`.
- **Correção sugerida:** quando a ability sacrifica `self`, adicionar `other: true` ao
  filtro do alvo no parser.

<a id="bug-14"></a>
### BUG-14 — Trocar idioma no Vault refaz a requisição
- **Severidade:** baixa (tráfego extra; offline, a lista vira a tela de erro).
- **Evidência:** `t` está nas dependências do efeito de busca
  (`DeckBrowser.tsx:67`), mas não é usado dentro dele.
- **Repro:** Vault → trocar EN→PT → nova chamada à API (2 → 3 no probe).
  `ui.probe.mjs`.
- **Correção sugerida:** remover `t` do array de dependências.

<a id="bug-15"></a>
### BUG-15 — Vault → Explorar deck → Voltar perde página e busca
- **Severidade:** baixa.
- **Evidência:** página/busca/ordenação vivem em `useState` dentro de `DeckBrowser`
  (`DeckBrowser.tsx:32-35`), que é desmontado ao trocar de tela (`App.tsx:1685-1701`);
  o Voltar do inspetor remonta na página 1.
- **Repro:** Vault → página 3 → Explorar um deck → Voltar → "Page 1 of 10".
  `ui.probe.mjs`.
- **Correção sugerida:** elevar `{page, search, ordering}` para o `App` (ou
  `sessionStorage`) e repassar como props.

<a id="bug-18"></a>
### BUG-18 — Artefatos/upgrades intercalados na linha: vizinhos visuais ≠ vizinhos do motor
- **Severidade:** baixa.
- **Evidência:** artefatos/upgrades vão para o fim de `board` (`game.ts:691-693`) e
  criaturas no flanco direito entram depois deles (`game.ts:654-657`); `BoardLane`
  desenha `board` na ordem (`App.tsx:812`). O motor calcula vizinhos só entre
  criaturas (`game.ts:228-234`), então "[C1] [Artefato] [C2]" parecem não-vizinhas mas
  são (Tremor, Splash-attack, Taunt).
- **Repro:** jogar um artefato e depois uma criatura no flanco direito.
- **Correção sugerida:** renderizar criaturas numa faixa e artefatos/upgrades em outra
  (ou ordenar por tipo na lane).

<a id="bug-19"></a>
### BUG-19 — Interpolação interpreta `$&`, `$'`… em nomes de deck
- **Severidade:** baixa.
- **Evidência:** `value.replace(regex, String(replacement))` (`i18n.ts:633`) trata `$&`,
  `` $` ``, `$'`, `$$` do valor como padrões de substituição. Nomes de deck do Master
  Vault são texto livre e entram em `toast.synced`, `toast.deckReady`, `log.matchStart`.
- **Repro:** adotar um deck chamado `Cash $& Carry` → toast "Cash {name} Carry is ready for a new match."
- **Correção sugerida:** `value.replace(regex, () => String(replacement))`.

<a id="bug-20"></a>
### BUG-20 — Erros não-Vault aparecem em inglês cru
- **Severidade:** baixa.
- **Evidência:** `vaultErrorText` devolve `error.message` para qualquer `Error` que não
  seja `VaultError` (`keyforgeApi.ts:25`); `describeFailure` só converte `AbortError` e
  `TypeError` (`keyforgeApi.ts:122-130`). Um `SyntaxError` de `response.json()` (API
  devolvendo HTML de manutenção/Cloudflare) chega à UI como "Unexpected token '<'…",
  também em pt-BR.
- **Repro:** mockar a API com `200 text/html` → importar → mensagem técnica em inglês.
- **Correção sugerida:** em `describeFailure`, mapear qualquer erro não-`VaultError`
  para `new VaultError("vault.loadFailed")`.

<a id="bug-21"></a>
### BUG-21 — Sync não atualiza a partida em curso (`refreshGameFaces` morto)
- **Severidade:** baixa.
- **Evidência:** `refreshGameFaces` (`game.ts:768-778`) e a chave `log.synced`
  (`i18n.ts:216`) não têm chamador; `syncCurrentDeck` só troca o deck salvo
  (`App.tsx:1519-1528`). Durante uma partida, o Sync do header não muda nada na mesa.
- **Repro:** partida em curso → Sync → nenhuma entrada "Card data synced" no log.
- **Correção sugerida:** chamar `refreshGameFaces` quando `screen === "game"` (ou
  remover a função e a chave).

<a id="bug-22"></a>
### BUG-22 — Tipo de carta desconhecido vira chave crua e é resolvido como Action
- **Severidade:** baixa (defensivo: o pool tem 84 `token creature`, 22 `prophecy`, 28
  `archon power`).
- **Evidência:** `t(\`type.${face.type}\`)` sem fallback em `App.tsx:181` (aria-label do
  tile) e `App.tsx:1053` (inspetor) — o `DeckInspector` já tem `typeLabel` com fallback
  (`DeckInspector.tsx:42-46`). No motor, qualquer tipo fora de
  Creature/Artifact/Upgrade é descartado ao ser jogado, como uma Action
  (`game.ts:696`).
- **Repro:** deck do Vault cujo payload traga `card_type: "Token Creature"` → rótulo
  "type.Token Creature" e a carta vai ao descarte ao ser jogada.
- **Correção sugerida:** extrair o `typeLabel` do inspetor para um helper comum e
  filtrar tipos não jogáveis em `normaliseCard`.

<a id="bug-24"></a>
### BUG-24 — Seleção de alvo pendente sobrevive a clicar numa carta da mão
- **Severidade:** baixa.
- **Evidência:** `selectHandCard` troca a seleção mas não limpa `pick`
  (`App.tsx:1498-1501`); o inspetor da carta da mão mostra "Cancelar alvo" e tocar num
  alvo destacado executa a jogada da carta anterior (`App.tsx:1464-1469`).
- **Repro:** criatura → Lutar (defensores destacados) → tocar uma carta da mão → tocar
  um defensor → a luta da criatura acontece.
- **Correção sugerida:** `setPick(null)` em `selectHandCard`.

<a id="bug-25"></a>
### BUG-25 — Arte opaca inflando a cota do cache
- **Severidade:** baixa.
- **Evidência:** respostas `no-cors`/`opaque` são gravadas no `ART_CACHE`
  (`sw.js:31-32`, `sw.js:158-160`). Chromium contabiliza cada resposta opaca com
  preenchimento de ~7 MB na cota, então 300 artes (`ART_CACHE_LIMIT`, `sw.js:12`)
  estouram cotas pequenas e disparam `pruneOldestArt` em ciclo.
- **Repro:** DevTools → Application → Storage após navegar várias páginas do Vault:
  uso reportado ≫ tamanho real das imagens.
- **Correção sugerida:** buscar arte com `mode: "cors"` quando o host permitir (S3
  aceita) ou reduzir o limite para respostas opacas.

### Verificado sem defeito (vara mínima coberta)

- **Stunned:** só "Remover stun" é oferecido e exige criatura pronta (`game.ts:601-605`);
  o uso de Action fica oculto enquanto atordoada (`App.tsx:1102`).
- **Exausta:** reap/fight/use bloqueados; dica "descansando" no inspetor.
- **Última criatura / campo vazio:** vizinhos vazios, flanco = verdadeiro; upgrade não
  jogável sem criaturas (`game.ts:532`); ability com alvo e campo vazio é pulada sem
  impedir a jogada (`game.ts:480`); "Lutar" desabilitado sem defensores.
- **Mão vazia / deck vazio:** estado "mão vazia" renderizado; descarte reembaralhado ao
  comprar com deck vazio, sem loop quando ambos estão vazios (`game.ts:150-160`).
- **Chains no custo da chave:** correto não haver efeito — chains só reduzem a compra
  (1–6→1, 7–12→2…, perde 1 por compra) e a chave custa `6 + keyCostMod`; o modificador
  do Lash vale na etapa de chave do oponente e zera no fim do turno dele.
- **Condição nunca satisfeita:** a ability é pulada, a carta ainda é jogada; a IA não
  gasta a jogada (`moveHasEffect`).
- **Vitória / revanche:** vencedor definido na etapa de chave, painel com foco preso,
  revanche reinicia `matchVersion`/`prevKeysRef`.
- **i18n:** en e pt-BR com 271 chaves cada, nenhuma faltando, nenhuma usada sem
  definição, placeholders idênticos nas duas línguas.
- **Offline:** importar cai para o cache (`loadDeckOrCache`), Vault mostra estado
  offline próprio, Sync offline avisa "usando cópia salva".

---

## B) Features

| ID | Título | Esforço | Prioridade |
|---|---|---|---|
| [FEAT-01](#feat-01) | Salvar e retomar a partida | M | P1 |
| [FEAT-02](#feat-02) | Error boundary com recuperação | S | P1 |
| [FEAT-03](#feat-03) | Dificuldades de IA usando as conditions do motor | M | P1 |
| [FEAT-04](#feat-04) | Modo dica com highlight de jogadas legais | M | P1 |
| [FEAT-05](#feat-05) | Log de partida completo e filtrável | S | P2 |
| [FEAT-06](#feat-06) | Estatísticas pós-partida e W/L local por deck | M | P2 |
| [FEAT-07](#feat-07) | Biblioteca: favoritos e remover deck | S | P2 |
| [FEAT-08](#feat-08) | Seed determinístico (RNG injetável) | S | P2 |
| [FEAT-09](#feat-09) | Toast de atualização do PWA | S | P2 |
| [FEAT-10](#feat-10) | Mulligan | S | P2 |
| [FEAT-11](#feat-11) | Escolher o deck do oponente | S | P2 |
| [FEAT-12](#feat-12) | Desfazer a última jogada / replay do turno | M | P3 |
| [FEAT-13](#feat-13) | Multiplayer local pass-and-play | L | P3 |
| [FEAT-14](#feat-14) | Cobertura do motor por deck | S | P3 |
| [FEAT-15](#feat-15) | Confirmar antes de abandonar uma partida | S | P3 |

<a id="feat-01"></a>
### FEAT-01 — Salvar e retomar a partida
- **Problema / jogador:** qualquer jogador mobile. A partida vive só em memória
  (`useState<GameState>`, `App.tsx:1213`); recarregar, o SO matar a aba ou um update do
  PWA perde tudo — justamente no caso de uso offline/celular do app.
- **Esperado:** estado salvo a cada jogada; ao abrir, "Continuar partida (rodada N)" na
  Home; partida encerrada limpa o save.
- **Escopo:** `App.tsx` (efeito em `game` → storage, restore no mount), `lib/cache.ts`
  (store `match` ou chave `localStorage`, erros engolidos), `i18n.ts` (en+pt-BR). O
  `GameState` já é JSON puro; `CardFace` pode ser reidratado por `id` do deck.
- **Esforço:** M · **Prioridade:** P1.

<a id="feat-02"></a>
### FEAT-02 — Error boundary com recuperação
- **Problema / jogador:** todos. Qualquer exceção de render (ex.: BUG-01) deixa `#root`
  vazio sem saída; nenhum `ErrorBoundary` existe em `src/`.
- **Esperado:** tela "Algo deu errado" com "Voltar ao início" e "Nova partida", e a
  partida salva (FEAT-01) preservada; erro registrado no console.
- **Escopo:** novo `components/ErrorBoundary.tsx` (classe), `main.tsx`/`App.tsx`,
  `i18n.ts`.
- **Esforço:** S · **Prioridade:** P1.

<a id="feat-03"></a>
### FEAT-03 — Dificuldades de IA usando as conditions do motor
- **Problema / jogador:** jogador intermediário. As 5 dificuldades diferem só em
  profundidade/ruído/aleatoriedade (`ai.ts:28-34`); a avaliação ignora `keyCostMod`,
  chains do oponente, abilities `destroyed`/`fight` pendentes e usa um regex no texto
  (`ai.ts:44`) em vez das abilities parseadas.
- **Esperado:** Easy ignora condições (joga cartas que não resolvem), Medium usa
  `canResolve`, Hard+ valoriza criaturas por `rulesOf().abilities` (gatilhos
  reap/fight/action, alvos disponíveis), pressão de chave com custo real, e prepara
  condições (ex.: segurar Smith até ter mais criaturas).
- **Escopo:** `lib/ai.ts` (avaliação por perfil), exportar `canResolve`/`rulesOf` já
  públicos, `ai.test.ts` (specs por perfil).
- **Esforço:** M · **Prioridade:** P1.

<a id="feat-04"></a>
### FEAT-04 — Modo dica com highlight de jogadas legais
- **Problema / jogador:** iniciante. Hoje é preciso abrir carta por carta para
  descobrir o que é jogável.
- **Esperado:** toggle em Configuração; com casa escolhida, cartas da mão e do board
  com jogada legal ganham destaque (e `aria-label` "jogável"); opcional "melhor jogada"
  via `chooseAiMove` com perfil Hard.
- **Escopo:** `App.tsx` (`getLegalMoves(game, 0, activeHouse)` → set de ids),
  `index.css` (estado com borda/ícone, não só cor), `settings.ts`, `i18n.ts`.
- **Esforço:** M · **Prioridade:** P1.

<a id="feat-05"></a>
### FEAT-05 — Log de partida completo e filtrável
- **Problema / jogador:** todos. O motor guarda 14 entradas (`game.ts:110`) e o rail
  mostra 5 (`App.tsx:1787`); não dá para reconstruir o que a IA fez num turno longo.
- **Esperado:** log da partida inteira (limite alto), agrupado por rodada, filtros
  Você/Warden e tipo (jogar, lutar, colher, forjar), abrindo em sheet no mobile.
- **Escopo:** `game.ts` (`LOG_SIZE`, `turn` no `LogEntry`), `App.tsx` (painel), `i18n.ts`,
  `index.css`.
- **Esforço:** S · **Prioridade:** P2.

<a id="feat-06"></a>
### FEAT-06 — Estatísticas pós-partida e W/L local por deck
- **Problema / jogador:** jogador recorrente. `wins/losses` vêm do Master Vault
  (`keyforgeApi.ts:110-111`) e nunca são atualizados por partidas locais; o painel de
  vitória só diz quem ganhou.
- **Esperado:** painel de fim com rodadas, âmbar gerado/roubado/capturado, criaturas
  destruídas, cartas jogadas; histórico local por deck (W/L vs cada dificuldade) no
  `DeckInspector` e no tile.
- **Escopo:** `game.ts` (contadores no estado, puros), `App.tsx` (painel),
  `lib/cache.ts` (store `stats`), `DeckInspector.tsx`, `i18n.ts`.
- **Esforço:** M · **Prioridade:** P2.

<a id="feat-07"></a>
### FEAT-07 — Biblioteca: favoritos e remover deck
- **Problema / jogador:** quem importa muitos decks (e todos após BUG-13).
- **Esperado:** estrela de favorito (favoritos primeiro na Home), remover deck salvo
  com confirmação; decks inclusos não removíveis.
- **Escopo:** `lib/cache.ts` (`deleteDeck`, flag `favorite`), `App.tsx`/`DeckTile.tsx`,
  `i18n.ts`. Casa bem com a correção de BUG-13.
- **Esforço:** S · **Prioridade:** P2.

<a id="feat-08"></a>
### FEAT-08 — Seed determinístico (RNG injetável)
- **Problema / jogador:** desenvolvimento e jogadores que querem repetir uma mão.
  `shuffle`, ids de instância e `discardRandom` usam `Math.random` direto
  (`game.ts:118`, `131`, `374`); a IA também (`ai.ts:145`, `157`). O testkit já tem
  `seededRandom` (`testkit.ts:69`) mas o motor não aceita.
- **Esperado:** `createMatch(deck, rival, { seed })`, seed guardado no estado e exibido
  no fim da partida ("jogar de novo com a mesma seed").
- **Escopo:** `game.ts` (PRNG no estado, puro), `ai.ts`, `testkit.ts`, `App.tsx`.
  Pré-requisito natural para FEAT-12 e replays.
- **Esforço:** S · **Prioridade:** P2.

<a id="feat-09"></a>
### FEAT-09 — Toast de atualização do PWA
- **Problema / jogador:** usuário instalado. O SW faz `skipWaiting` + `clients.claim`
  (`sw.js:106`, `116`) sem avisar; somado a BUG-07, a versão em uso é imprevisível.
- **Esperado:** quando um SW novo instala, toast "Nova versão disponível — Recarregar"
  (não durante a partida sem salvar; ver FEAT-01).
- **Escopo:** `public/sw.js` (esperar mensagem `SKIP_WAITING`), `App.tsx`
  (`registration.onupdatefound`/`controllerchange`), `i18n.ts`.
- **Esforço:** S · **Prioridade:** P2.

<a id="feat-10"></a>
### FEAT-10 — Mulligan
- **Problema / jogador:** todos; regra do jogo real ausente (ver MECHANICS_REPORT §6).
- **Esperado:** após a mão inicial, "Manter" ou "Mulligan" (reembaralha e compra uma a
  menos); a IA decide por heurística simples.
- **Escopo:** `game.ts` (`mulligan(state, side)` puro + fase no estado), `ai.ts`,
  `App.tsx`, `i18n.ts`, `rules.test.ts`.
- **Esforço:** S · **Prioridade:** P2.

<a id="feat-11"></a>
### FEAT-11 — Escolher o deck do oponente
- **Problema / jogador:** todos. A IA sempre joga o espelho do deck do jogador
  (`startMatch` → `createMatch(deck, deck)`, `App.tsx:1430`).
- **Esperado:** passo "Oponente" na Configuração: espelho, outro deck da biblioteca ou
  aleatório.
- **Escopo:** `App.tsx` (`ConfigScreen`, `startMatch`), `settings.ts`, `i18n.ts`.
- **Esforço:** S · **Prioridade:** P2.

<a id="feat-12"></a>
### FEAT-12 — Desfazer a última jogada / replay do turno
- **Problema / jogador:** iniciante (toque errado no celular) e quem quer estudar a
  partida.
- **Esperado:** "Desfazer" disponível até a escolha revelar informação oculta (compra,
  aleatório); replay da partida passo a passo a partir do seed + lista de jogadas.
- **Escopo:** `App.tsx` (pilha de `GameState` imutáveis — o motor já é puro),
  `game.ts` (marcar jogadas irreversíveis), depende de FEAT-08.
- **Esforço:** M · **Prioridade:** P3.

<a id="feat-13"></a>
### FEAT-13 — Multiplayer local pass-and-play
- **Problema / jogador:** dois jogadores com um aparelho.
- **Esperado:** modo "2 jogadores": cada lado escolhe deck, tela de "passe o aparelho"
  entre turnos escondendo a mão, sem IA.
- **Escopo:** `App.tsx` (hoje o lado 0 é fixo como humano em várias checagens:
  `isHumanTurn`, `performHumanMove`, `endHumanTurn`), `game.ts` (nomes "You"/"The Ember
  Warden" fixos em `createMatch`, `game.ts:171-173`), `i18n.ts`, `index.css`.
- **Esforço:** L · **Prioridade:** P3.

<a id="feat-14"></a>
### FEAT-14 — Cobertura do motor por deck
- **Problema / jogador:** quem importa decks. O selo existe por carta, mas não há visão
  do deck ("12/36 cartas com efeito simulado") antes de jogar.
- **Esperado:** chip no `DeckInspector` e na revisão da Configuração com contagem
  full/partial/vanilla e filtro por cobertura.
- **Escopo:** `DeckInspector.tsx`, `App.tsx` (`ConfigScreen` review), `rulesOf`,
  `i18n.ts`.
- **Esforço:** S · **Prioridade:** P3.

<a id="feat-15"></a>
### FEAT-15 — Confirmar antes de abandonar uma partida
- **Problema / jogador:** todos. "Jogar" na Configuração e "Revanche" substituem a
  partida em curso sem aviso (`startMatch`, `App.tsx:1429-1441`).
- **Esperado:** se há partida sem vencedor, diálogo "Abandonar a partida atual?"
  (com foco via `useDialogFocus`).
- **Escopo:** `App.tsx`, `i18n.ts`.
- **Esforço:** S · **Prioridade:** P3.
