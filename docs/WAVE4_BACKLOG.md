<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Backlog onda 4 — clusters `unsupported` do corpus (03-04/out/2026)

Fonte: 332 falhas `unsupported` sobre o corpus de 4.809 cartas (medição pós-onda 3, DSL v8).
Famílias: 🟢 espelho barato (primitivas que estendem as existentes) · 🟡 condições exóticas
(precisa ver os casos crus) · 🔴 pedra grande (cortes mantidos da onda 3).

## 🟢 Espelho barato — candidatos ao Lote 8
| Linhas | O que falta | Espelha |
|---|---|---|
| 3+4 | Superlativo `most`/`stronger` | `least`/`weaker` existem |
| 5+5 | Filtro OR (disjunção: "artifact or Cyborg") | Filter sem `or` |
| 3 | Ausência de keyword ("sem taunt") | Filter/Condition |
| 5 | **Blanking da caixa de texto** ("perde todas as habilidades") | PersistentEffect sem `blank` |
| 8 | **"A discard pile" (qualquer lado)** | Selection sem zona any-side |
| 4 | Condição "while fighting" + invulnerável | contexto de luta |
| 3 | Gatilho "after your amber is stolen" | Trigger novo |
| 4 | **Re-referência às escolhidas** ("as escolhidas") | ctx.chosen |
| 5 | Frações ("um terço da mão") | Count sem divisão |
| 3+3 | Poder dinâmico/relativo extra | só powerMin/Max fixos |

## 🟡 Condições exóticas — 18 linhas ("Condition 'X' is not representable")
Ver os `X` crus no drafts.json antes de desenhar; mistura provável de comparativos, timing e estados.

## 🔴 Pedra grande — cortes mantidos (esperam `targets[]` + design de info oculta)
| Linhas | Tema |
|---|---|
| 16 | Look/reveal/informação oculta |
| 13 | Search + reveal entre zonas |
| 15 | Jogar cartas do deck/mão do oponente |
| 5 | Restringir o defensor de cada luta |
| 4 | "Invulnerable while fighting" |
| 4 | Exclusive choice archive deck/discard |
| 4 | Play from opponent's archives/deck as if yours |

## ⚙️ Higiene do pipeline
- 4× `sanity: empty translation` — resposta vazia deveria virar `unsupported`, não falha de sanidade (conserto de 1 linha).

Amostra crua dos títulos: 448c1335, 4CR “Foreseer”, 56252b23, 60f095d7, 652c4e38, Abyssal Sight, Against All Flags, Allusions of Grandeur, Ambassador Liu, Ardent Hero, Aubade the Grim, Auto-Encoder, Azrael, Bandit Culver, Banish, Barrel Roll, Blank Check, Bondsman Belvan, Book of Malefaction, Borr Nit’s Touch, Bot Bookton, Broken Intent, Build Your Champion, Burning Glare, Bypass Burglar, CALV-1N, Caspart, Catch and Release, Cauldron Boil, Chonk Evermore, Cladogenesis, Code Monkey, Collector Worm, Com. Officer Kirby, Consult the Bones, Cosmicrux, Cover Fire, Cursed Loot, Cŏnrăd Fisiquĕ, Dapper Chapeau
