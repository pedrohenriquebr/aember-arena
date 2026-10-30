# Backlog de QA — bugs reportados jogando (live)

Bugs reportados pelo dono durante partidas reais. Cada item: repro, causa-raiz preliminar
(arquivo/comportamento), status e correção. Novos bugs entram no topo.

---

## QA-07 · Scrap de upgrade/artefato EM JOGO nunca dispara
- **Descoberto**: 29/out, lote M1 da moagem Haiku (bancada da Essence Entangler; não é bug
  reportado pelo dono — achado de código).
- **Causa-raiz (motor)**: o gatilho `scrap` só existe no caminho do move `discard`
  (game.ts:2734), e esse move só é gerado para cartas NA MÃO (:2916). `leavePlay` manda a
  carta ao descarte SEM disparar "scrap" — então upgrades/artefatos em jogo com "Scrap:"
  (Essence Entangler, Animating Force "Scrap: Gain 1") são inalcançáveis. A DSL do lote M1
  está correta e espera o gatilho (bancada com `it.skip` documentado).
- **Correção necessária**: `leavePlay` (ou o caminho de destruição) deve disparar
  `scrap` para cartas com ability `on:["scrap"]` — motor puro, sem UI. **Status: FILA DE
  MOTOR** (junto com QA-06; testes já prontos na bancada M1 para validar o fix).

## QA-06 · Witch of the Eye colhe sem deixar ESCOLHER a carta do descarte
- **Reportado**: 29/out, dono jogando: "quando fiz reap dela, não me ofereceu a oportunidade
  de escolher qual carta do descarte eu pegar".
- **Carta**: Witch of the Eye (Untamed, "Reap: Return a card from your discard pile to your
  hand." — 3 variantes no corpus, todas sem row vendored; o parser produz
  `{on:["reap"], acts:[{k:"fromDiscard"}]}` com coverage "full").
- **Causa-raiz (motor, game.ts:2153)**: o ato `fromDiscard` pega SEMPRE a carta do TOPO do
  descarte próprio (`reverse().find`) — sem escolha do jogador. Regras reais: "your discard
  pile" é o descarte do controlador e **ele escolhe** qualquer carta (informação aberta;
  rulebook FFG §Discard Pile — confirmado por pesquisa em 29/out a pedido do dono). Segunda
  instância da mentira do selo "full": frase parseada ≠ efeito fiel.
- **Correção necessária**: primitiva de ESCOLHA em zona (novo kind de prompt listando o
  descarte do jogador + variante do ato que espera a escolha) — motor + UI (o prompt de
  alvo atual só varre battlelines, `everyMatch` não enxerga zonas). É da família 🟢/🔴 da
  onda 4 (selection em zona). **Status: ✅ RESOLVIDO (código + testes; commit pendente)**.
- **Correção (29/out, Haiku 5.5 high)**: `pendingPrompt` ganhou o kind `"discard"` (ids das
  cartas do descarte do próprio lado, filtradas pelo `type` do ato, mais recente primeiro); o
  move responde com `targets[0]` (a fila que `citesQueue` já entrega ao ato — `citesQueue`
  passou a incluir `fromDiscard`). O ato escolhe o id da fila se ele estiver no descarte;
  sem escolha (IA, caminho sem UI, id inválido) pega o topo — a heurística documentada.
  UI: o banner lista as cartas do descarte (botões de 44px, foco no primeiro; Esc não
  mexe no prompt; o X desfaz a jogada como nos demais prompts). Sem mudança de schema:
  `DSL_VERSION` e `PARSER_VERSION` ficam como estão. O selo "full" do parser agora é
  verdadeiro (o ato faz o que o texto manda). Bancada: `src/lib/qa06-discard.test.ts`
  (10 casos). Suíte completa: 93 arquivos, 1191 verdes; typecheck limpo.
  Não verificado no navegador (e2e não rodado nesta missão).

## QA-05 · Dominator Bauble não faz nada (sem prompt de escolha de criatura)
- **Reportado**: 29/out, dono jogando (deck demo): "não deixou escolher a criatura, que era do tipo Indomáveis".
- **Carta**: Dominator Bauble (Dis, Artefato, demo deck — "Action: Use a friendly creature.").
- **Causa-raiz**: carta SEM linha vendored (vanilla) — o texto não vira efeito nenhum, nem prompt
  existe. A infraestrutura do motor está completa (move `use` → gatilho `action` → ato `use`
  em `game.ts:2128` com criatura de QUALQUER casa — não há check de casa no ato; `asYours`
  existe); faltam só a row e a porta de escolha lutar/colher do jogador (`via` default = reap;
  a escolha pode sair pelo mecanismo de `mode` do Lote 8).
- **Status**: EM VOO — primeira produção do Haiku 5.5 (executor aprovado no duelo 9/9), com
  bancada comportamental + hash carimbado + review antes de vendorizar.

## QA-04 · Glifo privado (Æmber/dano) aparece como caractere inválido no texto exibido
- **Reportado**: 13/out noite, dono (inspetor do Trawler: "capture all your opponent’s ." com tofu).
- **Causa-raiz**: corpus/MV guardam Æmber e dano como glifos PUA (U+F360/F361). O parser
  normaliza (`cardText.ts:195` readableText → `<A>`), mas os pontos de EXIBIÇÃO renderizam
  `face.text` cru: inspetor (App.tsx:2391), zoom (CardArt.tsx:274), lightbox (CardArt.tsx:337)
  e demais sites de `.text`.
- **Fix desejado (dono)**: normalizar na exibição — glifo vira símbolo do app (ícone inline
  Gem/Swords preferível a texto cru). Status: ✅ RESOLVIDO (c83c8ae — Æmber/dano viram
  ícone inline no texto exibido).

## QA-03 · Trawler não captura o âmbar do oponente (ability ausente) — ✅ RESOLVIDO
- **Reportado**: 13/out noite, partida do dono (PWA/celular).
- **Carta**: Trawler (Criatura, Insondáveis, GR — "Play: If you are haunted, capture all
  your opponent's <A>.").
- **Regras confirmadas com spec**: Play dispara na entrada MESMO exausto; captura vem do
  POOL do oponente (âmbar capturado em criaturas NÃO se move); haunted = 10+ no descarte
  próprio; o âmbar capturado fica NA carta (e volta ao pool do dono dela quando sai de jogo).
- **Causa-raiz**: sem entry no seed keyteki.json e 0 drafts — mas no device do dono a captura
  FUNCIONOU na 2ª partida (provável: impressão do Trawler no catálogo do farm + fallback por
  textHash f77ffe5, e desta vez ele estava haunted). O seed torna o comportamento determinístico.
- **Fix**: 2 entries no seed (GR ca5f5ab1 + MG24 a94f91e2, textHash 724798d1 com o glifo
  U+F360; DSL = on play, if count discard gte 10, capture n:1 per {p:"amber",opp:true} s:self,
  espelhando Drumble) + 6 specs via vendoredOverrides (loader real). 1054 specs verdes.
- **Follow-up (fila de motor, aguardando lote)**: parentes vanilla medidos pelo Sonnet —
  The Corpulent Collector, Gatekeeper ("all but 5"), ANT1-10NY (gatilho fim de turno), Envy
  (After Reap condicional), Bring Low (distribuição entre criaturas) — alguns podem exigir
  formas novas de DSL; batch com QA-01.

## QA-02 · Upgrade Under Pressure não anexa à criatura escolhida — ✅ RESOLVIDO
- **Reportado**: 07/out noite, partida Deus Basílio (navegador do dono). Repro extra do dono
  em 13/out: upgrade no Warden inimigo animou/parou na tira de anexos do próprio lado.
- **Causa-raiz real (13/out)**: motor CORRETO (`canReady` varre efeitos dos dois boards;
  attach por `attachedTo` cross-side ok — BUG-04). A UI mentia: `BoardLane` constría
  `hostCol` só com as criaturas da própria lane, então upgrade com hospedeiro inimigo
  falhava no check e caía na tira de artefatos do dono (`--acol`).
- **Fix**: `partitionLane` (src/lib/laneLayout.ts, puro) — BoardLane recebe `otherCards`;
  upgrade com hospedeiro na lane oposta renderiza preso à criatura no lado do hospedeiro
  (`--col`/`--up`), some da tira do dono; órfão segue como artefato; memo compara
  `otherCards`. 6 specs + 1 de evidência do motor (`cannot ready` morde hospedeiro
  inimigo). 1048 specs verdes (tsc/lint ok).

## QA-01 · Energy Vampirism não pergunta qual criatura captura/sofre o dano — ✅ RESOLVIDO
- **Reportado**: 07/out noite, partida Deus Basílio. Print: "Play: A creature captures 1⭘
  from its own side. For each ⭘ on that creature, deal 1⭤ to a creature." Resolvia sozinho.
- **Causa-raiz (13/out, lote de motor Sonnet medium)**: dupla. (1) O rascunho vendorizado
  em approved.json (flash-free, auto-aprovado) traduziu o 2º "a creature" como
  `s:{pick:{type:"Creature"}}` = escolha AUTOMÁTICA do motor. (2) Gap real na DSL:
  `target2` (o 2º alvo do jogador) EXIGIA carta diferente da 1ª — e "A creature … a
  creature" permite a mesma. O fluxo de UI estava correto.
- **Fix**: campo opcional `sameTarget2:true` na Ability (validação; canResolve/fire/
  pendingPrompt gated no campo; DSL_VERSION fica 17 por ser opcional); linha da carta
  corrigida nos 2 ids (658893af, db02dbc6) com source "manual"; few-shot em catalogLlm
  ensina a forma pro farm. 11 specs (qa01.test.ts): os dois prompts aparecem, mesmo alvo
  permitido, contrato antigo (sem o campo) preservado. 1069 verdes.
- **Follow-up do QA-03 (parentes) RESOLVIDO no mesmo lote**: semeados The Corpulent
  Collector (2 impressões), Envy, ANT1-10NY (3 impressões) e Gatekeeper (3 impressões —
  "all but 5" já era expressível com per:{sub:[{p:"amber",opp:true},5]}). **Bring Low
  ficou de fora**: a DSL não tem a forma (captura distribuída entre criaturas) — gap
  reportado, proposta pendente para lote de DSL futuro.

## Arquivados (corrigidos nesta sessão)
- ~~Targeting sem affordance / clique cancelava a jogada em silêncio~~ → aa2cd9a (banner
  "Escolha um alvo", anel pulsante, clique em não-elegível não cancela).
- ~~Stun sem token visual~~ → aa2cd9a (`.stun-badge` 2D + ficha 3D reforçada).
- ~~Decks importados "vanilla" apesar das regras vendorizadas~~ → f77ffe5 (fallback por
  textHash: ids do MV divergem dos ids do corpus).
