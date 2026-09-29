# HANDOFF — estado da pausa (29/09, tardia — antes de desligar)

> **⚠️ ESTE É O ESTADO VIGENTE.** As seções abaixo são históricas.

## Terceira pausa (noite de 29/09)

**Landed e commitado desde a segunda pausa:**
- coder-12b: ondas de animação confirmadas (o WIP do stash já estava commitado) ✅
- Opus VALIDATE-AUDIO: `docs/VALIDATION_AUDIO.md` — APROVADO COM RESSALVAS (VAL-01..06) ✅
- coder-13: VAL-01/02/03/05/06 corrigidos (5 commits) ✅
- Opus VALIDATE-FX: `docs/VALIDATION_FX.md` — APROVADO COM RESSALVAS (FX-01..08 obrigatórios + VAL-04b/04c/05) ✅
- coder-14: FX-01..05+08 corrigidos (browser real) ✅ · coder-15: VAL-04b/05 ✅ · VAL-04c pelo coordenador ✅
- Opus VALIDATE-CLOSE: **PRONTO PARA FECHAR** (9/9 resolvidos) `docs/VALIDATION_CLOSE.md` ✅
- Opus VIEW3D (coder-16/17/18): **12 histórias H3D implementadas** + `docs/VIEW3D_VALIDATE.md` — PRONTO COM RESSALVAS
- Opus UX-FIT: `docs/UX_FIT_PLAN.md` (654 l) — plano do palco de viewport medido NO NOTEBOOK do dono (1296×668) ✅

**Pendências para retomar (especs completas nos docs):**
1. VIEW3D punch list (docs/VIEW3D_VALIDATE.md §5): legendas do leque cortadas (H3D-06), playmat do --lite vazando (H3D-09), assert do parallax instável no _3d-chain
2. UX-FIT implementação: FIT-01..08 (docs/UX_FIT_PLAN.md — palco 100dvh, preview maior, aiDelayMs) em 3 lotes deepseek
3. Opus re-valida 3D + FIT no fim
4. Catálogo dinâmico (docs/DYNAMIC_CATALOG_PLAN.md) aguardando aprovação do dono

Estado: 127+ specs verdes, bundle 142,57/143,5 kB (teto revisado no histórico do CLAUDE.md §7), árvore limpa. **Nenhum processo rodando.**

---

# Histórico — segunda pausa (noite de 29/09)

> **⚠️ ESTE É O ESTADO VIGENTE.** A seção "primeira pausa" (fim do arquivo) é
> histórica. O que mudou desde ela:

## Segunda pausa (noite de 29/09)

**Completado e commitado desde a primeira pausa:**
- Gravação do clipe: `e2e/clips/session-1280x800.webm` + 32 frames ✅
- Opus UX-REVIEW: `docs/UX_REVIEW.md` (Top 8 melhorias com evidência de frame) ✅
- Opus ANIM: `docs/ANIMATIONS_PLAN.md` (526 linhas, 3 ondas com âncoras) ✅
- Opus AUDIT2: `docs/BUGS_ROUND2.md` (15 bugs) ✅ → **todos corrigidos**:
  - BUG2-01..07 (alta/média): commits `9114c33..e44b686` (7 commits com repro)
  - BUG2-08..15 (baixa): commits `a7891ba..5ba16cd` (8 commits com probe)
- Opus AUDIO: fix do unlock (`0373e97`) + **paleta procedural completa de 14
  timbres** (`b1480bc`, probe real: 27 vozes, zero erros) ✅
- Tutorial: o Opus já tinha entregue completo no snapshot; coder-9 validou em
  Chrome real (22/22) + corrigiu a regra do turno 1 (`76c6e2b`) ✅
- Teto de bundle: revisões documentadas até **135 kB** (histórico no CLAUDE.md §7)
- HEAD atual: `5ba16cd` — **115 specs verdes, acceptance OK**

**Em andamento (STASH `stash@{0}`):** coder-12 estava implementando a **onda 1
do ANIM** quando foi parado — `src/lib/fx.ts` + `fx.test.ts` + `FxLayer.tsx`
criados, integração em App/index.css parcial, sweep scripts em e2e/probes/_*.
**Não commitado.** Para retomar: `git stash pop` e continuar a onda 1
(integração do commitWithFx no App + ondas 2 e 3).

**Fila restante:**
1. Terminar onda 1 + ondas 2 (palco do turno da IA) e 3 (impacto) do ANIM
2. **Validação pelo Opus** das animações/áudio (quota reseta 12:20am — usar o
   padrão de despacho: `cat docs/advisor/PROMPT-X.md | claude -p ...`)
3. Catálogo dinâmico (`docs/DYNAMIC_CATALOG_PLAN.md`) aguardando aprovação
   do dono para a onda 1

---

# Histórico — primeira pausa (29/09, véspera de desligamento)

Documento de retomada. **HEAD: `d872ae1`** — 112 specs verdes, acceptance OK,
bundle 130,73/132 kB. Tudo do ciclo anterior (25 bugs + 15 features + emblemas das
casas) está commitado e estável.

## Stash com o trabalho em andamento

**`stash@{0}`** — "WIP pausa do dono (29/09)". Criado com `git stash push -u`
(inclui não-rastreados). Conteúdo:

| Arquivo | Estado | De quem |
|---|---|---|
| `src/components/TutorialWizard.tsx` | **parcial** — componente criado, FALTA integrar no App/i18n/CSS | Opus TUTORIAL |
| `e2e/record-session.mjs` | gravador de vídeo escrito, **clipe ainda não gravado** | coder-7 (deepseek) |
| `.gitignore` / `package.json` | entrada `e2e/clips/` + script `e2e:record` | coder-7 |
| `docs/advisor/PROMPT-{AUDIO,ANIM,TUTORIAL,AUDIT2,UX-REVIEW}.md` | prompts completos, prontos para re-despacho | — |
| `docs/advisor/*-stream.jsonl` | streams parciais das 4 missões Opus (para auditoria de custo) | — |

**Para retomar:** `git stash pop` (ou `apply` se preferir manter a cópia).

## Fila de redespacho (na ordem)

1. **coder-7 (deepseek)** — terminar a gravação: rodar `node e2e/record-session.mjs`
   (o script já está no stash), gerar `e2e/clips/session-1280x800.webm` + frames.
   ⚠️ Não usar a porta 4173.
2. **Opus UX-REVIEW** — análise de UX do vídeo: prompt pronto em
   `docs/advisor/PROMPT-UX-REVIEW.md`. Despacho padrão (claude CLI -p, opus-5-5,
   effort medium, stream-json).
3. **Opus AUDIO** — silêncio do jogo + paleta procedural estilo Arena: prompt em
   `docs/advisor/PROMPT-AUDIO.md` (write: sound.ts/App).
4. **Opus ANIM** — plano das animações Arena (glow de seleção, jogada com zoom ao
   centro + voo ao slot, pacing da IA): prompt em `PROMPT-ANIM.md` (read-only, doc).
5. **Opus TUTORIAL** — retomar o wizard: prompt em `PROMPT-TUTORIAL.md`; começar do
   `TutorialWizard.tsx` do stash (integrar App/i18n/CSS).
6. **Opus AUDIT2** — varredura de bugs das 15 features: prompt em `PROMPT-AUDIT2.md`.
   Depois: corrigir os BUG2-xx (deepseek) e o Opus valida o código de
   animações/áudio (acordo com o dono).

## Infra

- Servidor/túnel **derrubados** no desligamento. Para subir de novo:
  `npx vite preview --port 4173` + `D:/arc-raiders-replica/tools/cloudflared.exe
  tunnel --url http://localhost:4173` (a URL trycloudflare muda a cada run;
  o Vite já aceita `.trycloudflare.com` via allowedHosts, commit `a18c5f4`).
- Pacote de análise para o Opus: prompt via `cat docs/advisor/PROMPT-X.md | claude -p
  --model claude-opus-5-5 --effort medium --output-format stream-json --verbose
  --allowedTools ... > X-stream.jsonl` (streaming mostra quota na hora).
