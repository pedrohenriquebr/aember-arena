# GAME ROADMAP — mecânicas, animações, efeitos e cobertura (29/09)

Relatório consolidado: o que está coberto, o que falta, quanto custa, e como
cada lacuna será fechada. Fontes: MECHANICS_REPORT.md (cobertura medida no pool
real de 2.603 cartas), ANIMATIONS_PLAN.md + VALIDATE_FX.md (animações),
VIEW3D_PLAN.md + VIEW3D_ARENA_LAYOUT.md + VIEW3D_VALIDATE.md (modo 3D),
UX_FIT_PLAN.md (palco de viewport), DYNAMIC_CATALOG_PLAN.md (pipeline de IA),
VALIDATION_AUDIO.md/CLOSE.md (áudio) e os commits do repositório.

---

## 1. O efeito de alvo tem nome: **targeting indicators**

Na terminologia oficial da Wizards of the Coast (MTG Arena), o conjunto é
**"targeting indicators"**; a moldura/brilho sobre as cartas válidas é o
**"target reticle"** (destaque de alvo válido) e a seta animada da carta de
origem ao alvo é a **"targeting arrow"** (ou *tether*). O estado geral da UI é
o **"targeting mode"** (fontes: feedback.wizards.com, mtgazone.com, draftsim.com).

**No Aember Arena hoje:** o modo já existe — `.board-lane--targeting` ergue os
alvos válidos (`--lift` 26/32px), afunda os inválidos (6px) e acende a borda
(onda de animações, H3D-07). **Falta do Arena:** o glow pulsante/reticle
permanente sobre cada alvo (hoje é borda estática) e a seta-tether da origem ao
alvo → coberto pela **H3D-18** (indicadores flutuantes) do layout Arena.

## 2. Tipos de carta × cobertura × keyteki

Pool medido: **2.603 cartas jogáveis únicas** (15 sets do keyteki-json-data).
Fora do pool (filtradas por não-jogáveis, BUG2-22): Token Creature ~84,
Prophecy ~22, Archon Power ~28.

| Tipo | No pool | Motor hoje | full | partial | vanilla | Cobertura de texto | keyteki tem? |
|---|---:|---|---:|---:|---:|---|---|
| **Creature** | 1.313 | jogável; luta/colher/use; keywords | 87 | 27 | 1.199 | 8,7% full | ✅ todas as 1.313 |
| **Action** | 802 | jogável; bônus âmbar; descarte | 27 | 1 | 774 | 3,5% full | ✅ |
| **Artifact** | 327 | jogável; use/Omni | 20 | 3 | 304 | 6,4% full | ✅ |
| **Upgrade** | 145 | jogável; anexa ao hospedeiro (BUG2-04 fix) | 0 | 2 | 143 | 1,4% full | ✅ |
| **Prophecy** | ~22 | **não jogável** (filtrada) — mecânica de profecia ausente | — | — | — | 0% | ✅ (sets PV/ToC) |
| **Token Creature** | ~84 | não entra no deck (não é carta de deck) | — | — | — | n/a | ✅ (criadas por efeitos) |
| **Archon Power** | ~28 | não jogável (filtrada) | — | — | — | 0% | ⚠️ parcial |

**Gatilhos implementados (7 de ~12):** play, reap, fight, after fight→fight,
beforeFight, destroyed, action, omni. **Faltam:** Scrap: (59 cartas),
After you…: (1), interrupt/genérico.
**Ações implementadas (21):** destroy, damage, steal, capture, stun, draw,
discardRandom, gainAmber, fromDiscard, returnToHand, archiveTop, exhaust,
loseAmber, gainChains, heal, archive, ready, keyCost, use, returnToDeck, unstun.
**Keywords no motor (10):** Elusive, Taunt, Assault X, Hazardous X, Skirmish,
Splash-Attack X, Poison, Deploy, Alpha, Omega.
**Lacuna estrutural nº 1:** efeitos persistentes constantes ("Each friendly
creature gets +1 power") — **1.000 cartas** do pool (493 delas têm SÓ isso).
**Lacuna nº 2:** condições "If…" além das 3 formas (170 cartas). **Lacuna nº 3:**
objetos complexos ("for each…", traits) — ~600 cartas.

### Cobertura total do texto: **full 134 (5,1%) · partial 33 (1,3%) · vanilla 2.420 (93%)**

**Via keyteki: 100% do design existe** (cada carta = classe JS em
`server/game/cards/<set>/`) — AGPL, cópia autorizada (projeto é AGPL-3.0).
**Via pipeline LLM→DSL (DYNAMIC_CATALOG_PLAN):** estimativa honesta para as
1.942 cartas com gatilho suportado e corpo hoje rejeitado: **60–75% resolvíveis**
com LLM + validação tripla (o resto são construções que exigem suporte novo no
motor, não tradução). Meta realista pós-pipeline: **~60–70% do pool com efeito
simulado** (vs 5,4% hoje).

## 3. Onde vive o pipeline LLM→DSL no código

| Peça | Hoje | No pipeline |
|---|---|---|
| Contrato da DSL | `src/lib/abilities.ts` — tipos `Ability/Act/Filter/Condition` (**é o "SDK"**) | mesmo contrato; JSON validado contra ele |
| Resolução por carta | `rulesOf()` em `abilities.ts`: cache WeakMap + record `scripts` (demo decks) | lê **antes** o store `abilities` (IndexedDB DB v4, doc DYNAMIC_CATALOG_PLAN §2) |
| Parser (camada 1) | `src/lib/cardText.ts` (gramática determinística) | intacto — camada grátis |
| LLM (camada 2) | — | `scripts/ability-harvest.mjs` (build-time, catálogo todo) + BYOK em Configurações (runtime, cartas novas) |
| Validação tripla | — | schema → dry-run no testkit (`src/lib/testkit.ts`) → sanidade semântica |
| Fila de revisão | — | UI própria (aprovar/editar/rejeitar) + selo `reviewed` no selo de cobertura (FEAT-14) |
| Catálogo/arte | `cache.ts` store `cards` (write-only hoje) + `artBlobs` (novo) | sync incremental (DYNAMIC_CATALOG_PLAN §3) |

## 4. Roadmap por frente — o que está coberto e o que falta

### 4.1 Motor & mecânicas — **~85% do core, 6% do catálogo**
✅ Turno/combate/armadura por turno/keywords 10/abilities declarativas/selo de
cobertura/IA (minimax + delay configurável FIT-08)/seed/undo/replay/mulligan/
pass-and-play/stats.
❌ Pendente: efeitos persistentes (1.000 cartas), condições ricas, Scrap,
Prophecy, tokens, pilha de dmg em "for each", **pipeline LLM (ondas 1-2 do
DYNAMIC_CATALOG)**.
**Esforço:** onda 1 catálogo (M) · onda 2 pipeline LLM (G ≈ 3-5 sessões) ·
efeitos persistentes (G — novo modelo no motor).

### 4.2 Animações & efeitos — **~80%**
✅ Ondas 1-3 (glow seleção, voo mão→centro→slot com pose exata ≤1,1px, palco da
IA com batidas 700-900ms, resumo persistente, forja com glow+shake, dano
flutuante, dissolve, chains) + targeting mode (H3D-07).
❌ Pendente: FX-06..12 (não-bloqueantes), seta-tether/reticle (H3D-18),
investida com profundidade (H3D-20), FX no replay, sombras dinâmicas em 2P.
**Esforço:** reticle+tether (M, dentro do H3D-18) · resto (S cada, polimento).

### 4.3 Modo 3D da mesa — **10/12 histórias + punch list 3/3 ✅ (validate: PRONTO COM RESSALVAS)**
✅ Toggle persistido, cadeia preserve-3d com probe 40+ checks, mesa 40°/32°,
cartas em pé levitando com lean e sombra no tapete, mão em leque, interações
(hit-test 98 checks), FX compatível (pouso ≤1,1px), 2.5D mobile + @supports
fallback, harness `--view 3d`, parallax.
❌ Punch list (3 itens): legendas do leque ✅ (commitado), lite playmat ✅
(commitado), assert parallax ✅ (calibrado) — **re-validar**.
❌ Layout Arena (H3D-13..22): 10 histórias — fileiras por zona (L), pose
orgânica (S), mesa no palco (M-L), avatares centrais (M), investida (M),
upgrades sob hospedeiro (M), indicadores (M), mesa-ambiente (S), xN (M),
harness Arena (S-M).

### 4.4 UX-FIT (palco de viewport) — **8/8 histórias commitadas ✅**
Palco 100dvh com perfis ALTO/BAIXO/CELULAR, battlelines flexíveis, mão HUD,
rail drawer <1041, aiDelayMs slider, celular sem scroll (FIT-06) e preview
maior (FIT-07). Pendente: **validação Opus** do conjunto (com print-4 como
densidade-alvo) + FIT-06b (docScroll residual no mobile, docScroll=1447).

### 4.5 Áudio procedural — **~95%** ✅
14 timbres + unlock + VAL-01..06 corrigidos. Pendente menor: VAL-07..11
(mulligan do Warden mudo, discard/unstun soam como play, retorno ao ligar), música ambiente para 2P.

### 4.6 Outros — ✅ tutorial (7 passos, first-time), 11 emblemas de casas,
rail drawer, preview maior, duel de modelos (Sonnet 200/200 × deepseek 195,7/200).

## 5. Estimativas (throughput medido no projeto)

Throughput real: missão Sonnet 5.5 low ≈ 3-5 features pequenas/3h/$0,4-0,7 ·
missão deepseek ≈ 2-6 histórias M/1-7h (flat) · validação Opus ≈ $1-3.

| Frente | Itens | Esforço | Estimativa |
|---|---|---|---|
| Punch list 3D | 3 fixes | done ✅ | — |
| UX-FIT lote 2-3 (FIT-04..07) | 4 histórias | done ✅ | — |
| VIEW3D punch list + validação | 3 + re-check | 1 sessão | ~2 h |
| Layout Arena H3D-13/14/15 (fundação+fileiras) | 3 (L) | 2-3 missões deepseek | 1-2 dias |
| Layout Arena H3D-16..22 (vida+polish) | 7 (S-M) | 2-3 missões | 1-2 dias |
| Catálogo onda 1 (sync+store+chip) | 1 épico | 1 missão deepseek | ~4 h |
| Pipeline LLM onda 2 (harvest+BYOK+fila) | G | 2-3 missões + Opus valida | 2-3 dias |
| Efeitos persistentes (motor) | G | 2-3 missões + specs | 2-3 dias |
| FIT-06b mobile scroll | S | 1 fix | ~1 h |

## 6. Percentual global do produto (estimativa)

| Frente | Coberto | Nota |
|---|---:|---|
| Motor de regras (core) | 85% | falta efeitos persistentes + condições ricas |
| Cobertura do catálogo (texto→efeito) | **6%** | pula para ~65-70% com o pipeline LLM |
| UX palco/mobile | 95% | FIT-06b + validação |
| Animações/efeitos | 80% | ondas 1-3 feitas; reticle/investida pendentes |
| Modo 3D | 85% | 12/12 base + punch; layout Arena (10 histórias) pendente |
| Áudio | 95% | menores VAL-07..11 |
| Tutorial/onboarding | 100% | — |
| **Produto global (ponderado)** | **~82%** | com as 3 frentes pendentes: modo 3D Arena, pipeline de catálogo, efeitos persistentes |
