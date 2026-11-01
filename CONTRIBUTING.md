# Contributing

Aember Arena is a fan-made, non-commercial prototype. Bug reports and small,
focused pull requests are welcome.

## Fluxo

- `dev` é a branch de desenvolvimento; `master` é o que está publicado em
  <https://aember-arena.com.br/>.
- Abra PRs **contra `dev`** (nunca direto no `master`). O `master` só recebe o
  merge de `dev` (fast-forward ou merge commit, nunca squash, para os
  históricos não divergirem); o deploy do Pages sai do push no `master`.
- Todo commit neste repositório leva prefixo `[AI]` (ou `[human]`) no assunto —
  é um projeto escrito com assistência de IA e o histórico diz isso de forma
  explícita. O hook `.githooks/commit-msg` aplica a regra; ative-o com
  `git config core.hooksPath .githooks`.
- Commits no padrão `feat|fix|perf(css): escopo - descrição`, um commit coeso
  por mudança.

## Antes de abrir o PR

```bash
npm ci
npm test          # vitest — motor de regras, IA, parser de cartas
npm run build     # tsc --noEmit + vite build + versão do service worker
```

Os gates de layout (`npm run e2e:*`) dirigem o Edge/Chrome **do sistema** via
`playwright-core` (sem download de browser) e por isso não rodam no CI; rode-os
localmente se a mudança mexer em CSS, board, mesa 3D ou tipografia:

```bash
npm run e2e:smoke
npm run e2e:floor          # piso tipográfico a 360px
npm run e2e:capture        # screenshots em e2e/shots/current
```

## Escopo

- Não adicione dependências novas sem discussão (o alvo é um único
  `index.html`, offline, sem CDN).
- `src/lib/game.ts` e `src/lib/ai.ts` são puros: nada de mutação de estado nem de
  efeitos colaterais.
- Textos de interface passam por `src/lib/i18n.ts` (en + pt-BR).
- Conteúdo de jogo (nomes/textos/artes de cartas) não é licenciado por este
  projeto — veja `NOTICE` e o aviso de projeto de fã no `README.md`.
