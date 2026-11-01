# Aember Arena

[![Deploy](https://github.com/pedrohenriquebr/aember-arena/actions/workflows/pages.yml/badge.svg)](https://github.com/pedrohenriquebr/aember-arena/actions/workflows/pages.yml)
[![CI](https://github.com/pedrohenriquebr/aember-arena/actions/workflows/ci.yml/badge.svg)](https://github.com/pedrohenriquebr/aember-arena/actions/workflows/ci.yml)
[![Live](https://img.shields.io/badge/play-pedrohenriquebr.github.io%2Faember-arena-2ea043)](https://pedrohenriquebr.github.io/aember-arena/)

**Status: protótipo.** Jogo solo de fã, não comercial, em desenvolvimento ativo.

**English:** Aember Arena is an offline-first PWA for solo KeyForge: import a real
Master Vault deck, play against a configurable local AI, and keep playing with no
connection. The build is a single self-contained `index.html` (works from `file://`,
from an e-mail attachment or from any static host). It is a fan-made, non-commercial
prototype — see the licence and fan notice below.

## O que é

PWA offline-first para jogar KeyForge solo: importe um deck real do Master Vault,
jogue contra uma IA local configurável e continue jogando sem conexão. O build é um
único `index.html` autocontido.

Jogue em <https://pedrohenriquebr.github.io/aember-arena/>.

```bash
npm install
npm run dev     # servidor de desenvolvimento
npm run build   # tsc --noEmit && vite build -> dist/index.html
npm test        # vitest (motor de regras e IA)
```

Arquitetura, invariantes e gates de verificação estão em [`CLAUDE.md`](CLAUDE.md);
o mapa do código e o roteiro de debug estão em [`docs/GUIA_DEV.md`](docs/GUIA_DEV.md);
o motor de mecânicas está descrito em [`docs/MECHANICS_REPORT.md`](docs/MECHANICS_REPORT.md).
Como contribuir: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## PWA: atualização e recuperação

O `dist/sw.js` é versionado a cada build (`__BUILD_ID__` trocado por
`scripts/inject-sw-version.mjs`), então o navegador detecta a nova versão do
service worker, o toast "Nova versão disponível" (FEAT-09) aparece e o botão
"Recarregar" troca o worker sob demanda — nunca há reload silencioso em partida.

Se o app parecer **preso numa versão velha** (service worker envenenado: tela
antiga que não atualiza nem com reload), abra o app com `?swreset=1` na URL —
por exemplo `http://localhost:4173/?swreset=1` no `npm run preview`, ou, em
produção, <https://pedrohenriquebr.github.io/aember-arena/?swreset=1>. O
parâmetro precisa ir no caminho do app (o Pages serve o site do usuário na raiz,
não o subpath). Isso desregistra todos os service workers, apaga todos os caches
`aember-arena-*`, tira o parâmetro da URL e recarrega o app limpo uma única vez.

## Licença

Copyright (C) 2026 Aember Arena contributors.

Este programa é software livre: você pode redistribuí-lo e/ou modificá-lo sob os
termos da **GNU Affero General Public License, versão 3** (`AGPL-3.0-only`), conforme
publicada pela Free Software Foundation. O texto integral está em [`LICENSE`](LICENSE).

Este programa é distribuído na esperança de que seja útil, mas SEM NENHUMA GARANTIA;
sem sequer a garantia implícita de COMERCIABILIDADE ou ADEQUAÇÃO A UM PROPÓSITO
ESPECÍFICO. Veja a licença para mais detalhes.

Quem disponibilizar uma versão modificada deste programa a usuários por rede deve
oferecer a eles o código-fonte correspondente (AGPL-3.0, seção 13). O app publicado
faz isso pelo link "Código-fonte (AGPL-3.0)" em Ajustes › Sobre.

### Código derivado do keyteki

O modelo de mecânicas (abilities declarativas por gatilho, gameActions, keywords
resolvidas pelo motor, regras de luta/dano/armadura, compra com chains e custo de
chave) foi portado para TypeScript a partir do
[keyteki](https://github.com/keyteki/keyteki) — Copyright (C) keyteki contributors,
licenciado sob **AGPL-3.0** (o mesmo licenciamento deste projeto) — e o mesmo keyteki
é a fonte das linhas de habilidade derivadas que entram no boot. Nenhum runtime ou
dependência npm do keyteki é empacotado: a lógica foi reescrita e os dados derivados
são só DSL + hash, sem texto de carta. A lista completa de arquivos derivados, o
commit fonte e as demais atribuições estão em [`NOTICE`](NOTICE).

## Aviso de projeto de fã

Aember Arena é um **projeto de fã, gratuito e não comercial**, sem afiliação,
patrocínio ou endosso da Fantasy Flight Games, da Ghost Galaxy ou do Master Vault.
KeyForge, os nomes, textos e artes das cartas e demais elementos do jogo são
propriedade intelectual de seus respectivos titulares (Fantasy Flight Games /
Ghost Galaxy). A licença AGPL-3.0 cobre **apenas o código** deste repositório — não
concede nenhum direito sobre esse conteúdo. Imagens de cartas são carregadas do
Master Vault em tempo de execução e não são redistribuídas por este projeto.

*KeyForge is a Registered Trademark of Ghost Galaxy, Inc.*
