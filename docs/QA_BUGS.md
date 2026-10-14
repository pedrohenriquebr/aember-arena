# Backlog de QA — bugs reportados jogando (live)

Bugs reportados pelo dono durante partidas reais. Cada item: repro, causa-raiz preliminar
(arquivo/comportamento), status e correção. Novos bugs entram no topo.

---

## QA-04 · Glifo privado (Æmber/dano) aparece como caractere inválido no texto exibido
- **Reportado**: 13/out noite, dono (inspetor do Trawler: "capture all your opponent’s ." com tofu).
- **Causa-raiz**: corpus/MV guardam Æmber e dano como glifos PUA (U+F360/F361). O parser
  normaliza (`cardText.ts:195` readableText → `<A>`), mas os pontos de EXIBIÇÃO renderizam
  `face.text` cru: inspetor (App.tsx:2391), zoom (CardArt.tsx:274), lightbox (CardArt.tsx:337)
  e demais sites de `.text`.
- **Fix desejado (dono)**: normalizar na exibição — glifo vira símbolo do app (ícone inline
  Gem/Swords preferível a texto cru). Status: ABERTO — missão Sonnet em voo.

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
