# HANDOFF — estado da pausa (29/09, véspera de desligamento)

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
