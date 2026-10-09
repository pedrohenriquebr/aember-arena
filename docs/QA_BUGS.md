# Backlog de QA — bugs reportados jogando (live)

Bugs reportados pelo dono durante partidas reais. Cada item: repro, causa-raiz preliminar
(arquivo/comportamento), status e correção. Novos bugs entram no topo.

---

## QA-02 · Upgrade Under Pressure não anexa à criatura escolhida
- **Reportado**: 07/out noite, partida Deus Basílio (navegador do dono).
- **Print**: Under Pressure (Upgrade, Geistoid — "This creature cannot ready") no inspetor.
- **Repro**: jogar Under Pressure; o esperado é escolher uma criatura (qualquer linha, inclusive
  inimiga — upgrades podem anexar no outro lado, BUG-04) e a ficha anexar a ela.
- **Causa-raiz preliminar**: o CAMINHO DO MOTOR está correto (`game.ts:2741` — play de Upgrade
  retorna `attachTargets`; `canPlay` exige targets > 0), então a falha é na camada de UI/fluxo:
  ou o prompt de anexar não aparece, ou o clique na criatura não está resolvendo o attach
  (mesma família do targeting que aa2cd9a consertou para efeitos — faltou o caso "play de
  Upgrade"). Repro exato pendente: confirmar o que aconteceu na tela (ficou na mão? foi para
  a battleline como criatura? anexou errado?).
- **Status**: ABERTO — investigar fluxo de UI do attach + repro.
- **Fix**: pendente.

## QA-01 · Energy Vampirism não pergunta qual criatura captura/sofre o dano
- **Reportado**: 07/out noite, partida Deus Basílio.
- **Print**: Energy Vampirism (Ação — "Play: A creature captures 1⭘ from its own side. For each
  ⭘ on that creature, deal 1⭤ to a creature.").
- **Repro**: jogar a carta; NENHUMA seleção de criatura aparece — o efeito resolve sozinho.
- **Esperado (regra)**: os DOIS alvos são ESCOLHA DO JOGADOR — (1) qualquer criatura captura 1
  do pool do próprio lado dela; (2) qualquer criatura em jogo sofre 1 de dano (podem ser a
  mesma ou diferentes). Aleatório só se o print dissesse "random" (não diz).
- **Causa-raiz (DSL do override, draft flash-free auto-aprovado)**:
  - ato 1 `capture s:"target"` depende do `ability.target` — mas o prompt desse alvo não
    aparece no fluxo de play de Ação (verificar por que: é o mesmo mecanismo que deveria
    servir a QA-02);
  - ato 2 `damage s:{pick:{type:"Creature"}}` — **`pick` = escolha AUTOMÁTICA do motor**, não
    do jogador. O rascunho traduziu "a creature" como auto-pick. Errado.
- **Complexidade extra**: o print tem DOIS alvos independentes numa mesma ability e a DSL de
  hoje modela UM `ability.target` — verificar se atos podem ter alvo próprio (`s:{target:…}`)
  ou se é um gap do motor (dois prompts sequenciais num play).
- **Status**: ABERTO — pode ser (a) bug do override, (b) gap do motor para 2 alvos, ou (c) bug
  de UI de prompt. Investigar na ordem.
- **Fix**: pendente.

## Arquivados (corrigidos nesta sessão)
- ~~Targeting sem affordance / clique cancelava a jogada em silêncio~~ → aa2cd9a (banner
  "Escolha um alvo", anel pulsante, clique em não-elegível não cancela).
- ~~Stun sem token visual~~ → aa2cd9a (`.stun-badge` 2D + ficha 3D reforçada).
- ~~Decks importados "vanilla" apesar das regras vendorizadas~~ → f77ffe5 (fallback por
  textHash: ids do MV divergem dos ids do corpus).
