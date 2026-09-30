# Revisão do roadmap — matriz de mecânicas (`docs/GAME_ROADMAP.md` §2/§2.b/§6)

Revisão read-only, 2026-09-30, sobre `HEAD` `2e94b33`. Nenhum código nem o roadmap
foram alterados.

## 0. Método e limite de medição

- **Motor:** leitura de `src/lib/game.ts` (1.044 linhas), `keywords.ts`,
  `abilities.ts` e `cardText.ts`, com grep por verbo/estado.
- **Pool:** o `keyteki-json-data` (fonte do §3 do `MECHANICS_REPORT`) **não está
  nesta máquina** (`KF_DATA` ausente; o probe `e2e/probes/coverage.probe.ts` pula).
  Por isso o grep em `card_text` não foi possível. Usei um **proxy equivalente:** as
  classes de carta do keyteki em `%TEMP%/keyteki/server/game/cards/<set>/*.js`
  (2.607 arquivos, cerca de 1 por carta, então muito próximo das 2.603 do pool). Cada
  contagem abaixo é o **número de arquivos de carta** que usam a API do keyteki para a
  mecânica (`grep -rli`). Limite: keywords *impressas* vêm do JSON, não da classe, então
  para keywords o proxy **subconta** (ex.: Entrenched dá 0).

## 1. Conferência linha a linha

### 1.1 Keywords (10/18): **CONFIRMADO**

- A lista do keyteki (`docs/keywords.md`: 18 entradas, de Alpha a Versatile) bate
  exatamente com 10 presentes e 8 ausentes.
- Presentes: `src/lib/keywords.ts:8-19` (`ENGINE_KEYWORDS`). Nenhuma das 8 faltantes
  aparece em `game.ts` (grep zero para treachery/versatile/graft/entrenched/exalt/
  haunted/invulnerable/overwhelm).
- **Solidez das presentes:**
  - Elusive, Skirmish, Poison e Splash: `game.ts:645-654`.
  - Assault e Hazardous antes da troca de dano: `game.ts:640-642`.
  - Taunt: `game.ts:688-693`. Alpha: `game.ts:675`.
  - Omega: `game.ts:666` + `875`. Deploy: `game.ts:819`.
  - Poison só marca quando há dano aplicado de fato (`game.ts:476-482`), como na regra.
  - **Ressalva:** uma keyword concedida por efeito (ex.: upgrade "gains Taunt") não
    existe. `keyword()` só lê as impressas, porque não há modelo de efeito persistente.
    "10/18" vale só para keywords **impressas**.
- **Peso real das faltantes** (proxy): Exalt 106, Haunted 85, Overwhelm 16,
  Treachery 14, Versatile 8, Invulnerable 7, Graft 4. Exalt e Haunted são as únicas
  com volume alto. Elas deveriam estar numa onda anterior, e não "keywords −8" como
  bloco único.

### 1.2 Mecânicas marcadas como ✅ cobertas

| Item | Veredito | Evidência |
|---|---|---|
| Escolha de casa | ✅ sólido | `game.ts:900-911` |
| Forja/custo | ✅ **parcial** | Forja obrigatória no passo 1, custo 6+mod (`game.ts:348-350`, `934-945`). **Falta** forjar fora do passo de chave (59 cartas `forgeKey`) e desforjar (5). |
| Chains | ✅ sólido | Penalidade `floor((c+5)/6)` e perda de 1 chain só quando compra (`game.ts:209-215`) |
| Armadura 1×/turno | ✅ sólido | `game.ts:474-483`, zerada em `920-923`. Não há modificação de armadura (37 cartas `modifyArmor`). |
| Flancos/vizinhos | ✅ | Usado por Taunt/Splash |
| Archives | ⚠️ **parcial, com erro de regra** | `game.ts:907-909` pega o archive **sempre**; na regra pegar é opcional ("may"). |
| Capture | ✅ sólido | `game.ts:537-539`. O âmbar capturado volta ao oponente ao sair de jogo (`game.ts:440-441`). |
| Stun | ✅ sólido | Usar criatura atordoada só remove o stun (`game.ts:764-767`, `876-878`) |
| Gigantic | ⚠️ parcial (declarado) | `game.ts:677-686`, `852-862` |
| 1ª jogada do turno 1 | ✅ | `game.ts:669-672` (só o 1º jogador, 1 carta) |
| Reembaralhar descarte | ✅ | `game.ts:197-206` |

### 1.3 Mecânicas marcadas como ❌ ausentes

| Mecânica | Veredito | Evidência no motor | Cartas (proxy keyteki) | Número da auditoria |
|---|---|---|---|---|
| Tide | **ausente, confirmado** | grep `tide` = 0 em `game.ts` | **83** | "central do DT", sem número |
| Scrap | **ausente, confirmado** | Só é reconhecido para ser **rejeitado** (`cardText.ts:13-15`); não entra em `Trigger` (`abilities.ts:13`) | **59** | 59 ✅ |
| Purge | **ausente, confirmado** | grep `purge` = 0; `leavePlay` não tem destino "purged" (`game.ts:435`) | **119** | **"45+" subconta:** 45 é só o *1º token* dos corpos rejeitados |
| Take control | **ausente, confirmado** | `controllerOf` (`game.ts:327`) deriva do tabuleiro; não há troca | **48** | sem número |
| "You may" | **ausente, confirmado** | Todo `Act` é obrigatório (`abilities.ts:32-38`) | **145** (`optional: true`) | "132": na verdade é o 1º token `you` dos corpos rejeitados, não "começam com you may" |
| Enhanced/bônus | **ausente, pior do que diz a auditoria** | `CardFace` só tem `amber` (`game.ts:16-32`). Não há campo de ícone, logo nem ícones **impressos** de capture/damage/draw (MM+) existem. | **86** (`bonusIcon`/`enhance`) | sem número |
| Prophecy | ausente, com **erro de enquadramento** (§4) | grep 0 | 22 profecias + **70 cartas com `Fate:`** no deck | ~22 |
| Interrupt/After | ausente, **muito subcontado** | `cardText.ts:15` só rejeita | `reaction()` **239**, `interrupt()` **74** | "1+ carta" |
| Persistentes | ausente, confirmado | Não há camada de efeito; `face.power` é lido cru (`game.ts:383`, `492`, `650`) | `persistentEffect` 430; texto constante 1.000 (§3.5 MR) | 1.000 ✅ |

### 1.4 Mecânicas ausentes que a auditoria **não** pegou

| Mecânica | Evidência de ausência | Cartas (proxy) |
|---|---|---|
| **Tokens** ("make a token creature") | grep `token` = 0 em `game.ts`. Aparece no §4.1, mas falta na tabela 2.b. | **124** |
| **Efeitos com duração** ("for the remainder of the turn", `lastingEffect`) | Não existe; o único mod temporal é `keyCostMod` (`game.ts:76`, `925`) | **117** |
| **Ganhar habilidade** (`gainAbility`: "gains 'Reap: …'") | Não existe | **174** |
| **Contadores de poder** (+1 power) | `CardInstance` não tem campo de poder (`game.ts:47-60`) | **66** |
| **Modificar poder/armadura** | Idem | 80 / 37 |
| **Ward** (token WoE+) | grep `ward` = 0 no motor | **39** |
| **Enrage** (token) | grep 0 | **32** |
| **Forjar/desforjar fora do passo de chave** | Só existe o passo de chave (`game.ts:934-945`) | 59 / 5 |
| **Proibições** ("cannot be played/used/fought") | Não existe | **131** |
| **Substituição "instead"** (destroy→archive, dano redirecionado) | grep `instead` = 0 em `game.ts`. `destroy` sempre descarta (`game.ts:470-471`). | ~95 |
| **Sacrifice** | Não existe como verbo (só `destroy`) | 36 |
| **Search/mill** (procurar ou descartar do topo do deck) | Não existe | 20 / 6 |
| **Archive opcional** | Erro de regra: é obrigatório (`game.ts:907-909`) | todas as partidas |
| **Leaves play como gatilho** | `leavePlay` (`game.ts:435-455`) não dispara nada | 11 |

### 1.5 Itens do glossário que **não são regra do KeyForge** (para não virar backlog falso)

- **Haste:** não existe keyword Haste no KeyForge (fica fora dos 18 do keyteki).
- **Limite de 6 criaturas:** não existe. O motor acerta ao não ter limite. O 6 do código
  é o tamanho da mão (`game.ts:129`).
- **1º turno sem compra:** não é regra. O 1º jogador compra normalmente no fim do turno;
  a restrição real é "1 carta jogada/descartada", e ela está implementada.
- **Armadura negativa:** não existe; armadura é ≥0 e absorve 1×/turno.
- **Keys custam âmbar capturado:** falso. Só âmbar do pool forja (`game.ts:935-937`
  usa `nextPlayer.amber`, correto).

## 2. Percentuais corrigidos

| Métrica | Auditoria | Revisão | Justificativa |
|---|---|---|---|
| Keywords | 10/18 (55%) | **10/18 impressas (56%)**; concedidas 0 | §1.1 |
| Motor core | 78% (§6) **e** "~85%" (§4.1) | **~65%** | O roadmap se contradiz (78 vs 85). A lista de ausências é ~2× maior que a auditada: +tokens, gainAbility, duração, contadores/ward/enrage, proibições, "instead", forja fora de fase. Por impacto (proxy): 9 itens auditados somam ~1.200 dependências; os 14 novos somam ~1.000. O esqueleto de turno/combate está sólido (~90% das regras de turno), mas a camada de efeitos está quase vazia. |
| Cobertura de texto | "6%" (§6), "5,1%" (§2 MR), "5,4% hoje" (§2.b) | **5,1% full (134); 6,4% full+partial (167)** | Três números diferentes para a mesma métrica no mesmo documento. Fixar um: 5,1% full. |
| Produto global | ~80% | **~72%** | Média ponderada que dá peso ≥25% a motor+catálogo. Um deck real importado tem ~93% das cartas vanilla, então "80%" superestima a experiência com deck real. |

## 3. Priorização por impacto (cartas dependentes, proxy keyteki) → ondas

| Onda | Conteúdo | Dependências | Por quê |
|---|---|---|---|
| **1: camada de efeitos** | Efeitos persistentes + modificadores de poder/armadura + keyword concedida + `gainAbility` + duração ("remainder of turn") + proibições | 430 + 80 + 37 + 174 + 117 + 131 (com sobreposição; ~1.000 cartas de texto constante) | É uma infraestrutura só; destrava metade do resto (Haunted, Exalt, ward…). |
| **2: opcionalidade e reações** | "You may" (Act opcional + escolha na UI/IA) + reações/interrupts ("After…", "Each time…") + archive opcional (bug de regra) | 145 + 239 + 74 | Transversal a todos os sets. |
| **3: verbos de zona e tokens** | Purge, Sacrifice, Search/Mill, Tokens, Exalt, Scrap | 119 + 36 + 26 + 124 + 106 + 59 | Todos são destinos novos de `leavePlay` ou gatilhos simples. |
| **4: estado de set** | Tide (83), Haunted (85), Enhanced/ícones impressos (86, exige campo novo em `CardFace`), Take control (48), forjar/desforjar fora de fase (64), ward/enrage/contadores (137), "instead" (95) | ~600 | Precisam de onda 1 e 2. |
| **5: cauda** | Overwhelm 16, Treachery 14, Versatile 8, Invulnerable 7, Graft 4, Prophecy/Fate (22+70), Gigantic completo | ~140 | Baixo volume ou sets novos. |

Observação: o pipeline LLM→DSL (§3 do roadmap) só rende depois da onda 1. Sem a
camada de efeitos, ~1.000 cartas continuam sem ter para onde traduzir, qualquer que
seja o LLM. A meta de "60-70% pós-pipeline" pressupõe as ondas 1-2.

## 4. Erros da auditoria (tabela por tipo e metodologia)

1. **Coluna "Cobertura de texto … full" mistura métricas.**
   - Creature 8,7% = (87+27)/1.313, isto é, **full+partial**; full puro dá 6,6%.
   - Action 3,5% = 28/802 (full+partial); full puro dá 3,4%.
   - Upgrade "1,4% full" com **0 full**: é 2 partial/145. Rótulo invertido.
   - Artifact 6,4% não bate com nenhum dos dois: full 6,1%, full+partial 7,0%.
2. **Linhas não fecham com o total.** 1.313+802+327+145 = 2.587, não 2.603. Faltam as
   16 cartas que derrubam o parser (BUG-01, §3.2 MR), que a tabela omite em silêncio.
3. **Prophecy enquadrada como "tipo de carta do pool, 0%".** Profecias não fazem parte
   do deck de 36; ficam num conjunto à parte. A dívida real é a mecânica **Fate**, que
   está em ~70 cartas **dentro** do deck e hoje viram vanilla. O mesmo raciocínio vale
   para Archon Power, que não é carta de deck. Token Creature "n/a" esconde que
   **124 cartas do deck criam tokens**.
4. **Leitura errada do §3.5 do MECHANICS_REPORT.** Os números `you 132`, `purge 45` e
   `exalt 39` são **1º token dos corpos rejeitados**, não "cartas com a mecânica". A
   auditoria transformou isso em contagem de cartas: "132 cartas começam com 'you'",
   "45+ usam o verbo". O proxy dá 145 e 119. O mesmo vale para "After you…: (1)": é só
   o *prefixo de header*; reações reais são 239.
5. **Percentual do core contraditório:** 78% no §6 e ~85% no título do §4.1.
6. **Contagem de gatilhos:** "7 de ~12" lista 8 nomes (play, reap, fight, after
   fight→fight, beforeFight, destroyed, action, omni). O `Trigger` do código tem **7**
   (`abilities.ts:13`); "after fight→fight" não é um gatilho próprio, é normalização do
   parser.
7. **Archives marcado como ✅** apesar de violar a regra do "may" (§1.2).

## 5. Resumo

A auditoria acertou as keywords (10/18) e as ausências que listou; todas se confirmam
no código. Mas ela:

- subconta Purge, "you may" e reações, porque leu primeiros tokens como se fossem
  contagem de cartas;
- deixa de fora ~14 mecânicas (tokens, `gainAbility`, duração, contadores/ward/enrage,
  proibições, "instead", forja fora de fase, sacrifice, search, archive opcional…);
- tem a coluna de cobertura por tipo com rótulo invertido (full+partial rotulado "full")
  e linhas que não somam 2.603;
- se contradiz no % do core.

Números revistos: **core ~65%, texto 5,1% full, global ~72%**. Prioridade: construir a
camada de efeitos (onda 1) antes do pipeline LLM.
