# Plano — Arte offline (PWA + desktop Tauri) (2026-10-05)

> **Estado:** plano apenas. Nenhum código em `src/`. A pesquisa de bucket está em
> `docs/RESEARCH_CARD_IMAGES_S3.md` (30/set). Este doc substitui o plano (d3) que
> existia só na conversa (Opus low, nunca salvo) e o ajusta à decisão do dono:
> **desktop via Tauri é a primeira opção leve**; o PWA continua com IndexedDB.

Objetivo: a carta continuar jogável sem rede, com a arte oficial (WebP), sem
embutir imagem no `index.html` e sem backend. O jogo já sobrevive sem arte
(`card-fallback` tipográfico em `CardArt.tsx`); este plano só garante a imagem.

Números do plano (d3), recontados nesta sessão (`compute_math`):

| | |
|---|---|
| Imagens, 1 idioma | 4.031 |
| PNG de origem | ~263 KB → 4.031 × 263 KB = **1.035,3 MiB** |
| WebP q82 | ~31 KB → 4.031 × 31 KB = 124.961 KB = **122,0 MiB** |
| Razão | 263/31 ≈ **8,5×** |
| Estimativa falada | "~125 MB" — usar **122 MiB** daqui pra frente |

Um idioma por instalação. `pt` existe nos sets 341–700; 800+ cai em `en`
(matriz em `RESEARCH_CARD_IMAGES_S3.md` §1.3). Nove idiomas de uma vez
(~1,1 GiB) não é o pacote padrão.

---

## 0. O que muda quando o desktop é Tauri

O (d3) tratava o navegador como único runtime: o harvest Node produz o pacote,
o usuário importa um `File`, e os bytes viram `Blob` num IndexedDB à parte
(`artStore`), com o S3 como fallback. O risco central era a **evicção da
origem** (Chromium apaga IndexedDB + Cache + localStorage juntos sob pressão
de disco). `navigator.storage.persist()` era pré-requisito, não garantia.

No Tauri isso deixa de ser o caminho principal.

| | Plano (d3), só PWA | Desktop Tauri (decisão do dono) |
|---|---|---|
| Onde a arte mora | IndexedDB (`Blob`) | Pasta do usuário, fora do perfil da webview |
| Quota / evicção | Sim — origem inteira | Não. Apagar dados do WebView2 não leva a pasta |
| Como os bytes entram | `<input type=file>` (CORS impede `fetch` do S3) | O mesmo pacote, extraído no disco. `plugin-http` *poderia* baixar do S3 (o Rust não passa por CORS), mas o plano **não** faz harvest dentro do app |
| Como o `<img>` lê | `URL.createObjectURL(blob)` | `convertFileSrc(path)` → protocolo de asset |
| O que vai no instalador | — | Só o single-file (webview). O pacote de arte é **pós-instalação** |
| Fallback | S3 (`<img>`, opaco) | O mesmo S3, se houver rede |

O PWA **não ganha filesystem**. A rota IndexedDB permanece para quem abre o
`index.html` no browser ou de `file://`. Um `CardArt` só, com a ordem abaixo.

O que **não** muda:

- O produtor continua um script Node **fora** do bundle (harvest → WebP q82 →
  zip por set e por idioma). Compressão não entra na webview.
- Arte **não** entra no `index.html` nem no instalador (tamanho + o mesmo
  risco de IP já anotado em `DYNAMIC_CATALOG_PLAN` §6: uso pessoal, sem
  redistribuir o catálogo no produto).
- Sem arte local e sem rede, o fallback tipográfico atual permanece.
- Erro de storage/arquivo é engolido: a partida segue.

---

## 1. Arquitetura por plataforma

```
scripts/art-harvest (Node, fora do app)
        │  PNG do S3 → WebP q82 → zip por set/idioma + manifest
        ▼
   pacote .zip  (o usuário já tem o arquivo; ninguém hospeda isso)
        │
        ├─ PWA / file://
        │     unzip na webview → Blobs
        │     IndexedDB "keyforge-arena-art"  (NÃO o DB v4 do jogo)
        │     persist() pedido antes da 1ª gravação
        │
        └─ Tauri (Windows primeiro)
              unzip na webview, um arquivo por vez
              plugin-fs grava em  $APPLOCALDATA/art/{lang}/{id}.webp
              manifest.json ao lado
              <img src=convertFileSrc(absoluto)>

CardArt, as duas cascas:
  1. arquivo local (só Tauri)
  2. Blob no art-store (PWA; no Tauri fica vazio de propósito)
  3. S3 no idioma pedido          ← <img> direto, como hoje
  4. S3 en
  5. card-fallback tipográfico
```

### 1.1 Por que duas cascas e um resolvedor

`CardImage` hoje põe `face.image` (URL absoluta do S3) direto no `<img>`
(`src/components/CardArt.tsx`). O resolvedor novo devolve uma string de URL e
não muda o resto do componente (lazy, 300×420, `onError`, fallback).

Detecção de casca: presença do runtime Tauri (`__TAURI_INTERNALS__` /
`isTauri()`). No browser isso é falso e o degrau 1 nem é consultado.

**Build.** `@tauri-apps/api` e `plugin-fs` não podem ser import estático do
`main.tsx`. O `vite-plugin-singlefile` **inline** `import()` dinâmico: se o
adaptador Tauri for alcançável pelo entry do PWA, ele entra no `index.html` e
o arquivo deixa de abrir limpo fora do shell. O build do PWA (`npm run build`)
exclui o adaptador; o build desktop é outro entry (ou `define`) que o inclui.
O single-file continua sendo a webview — não há code-splitting no PWA.

### 1.2 Onde fica a pasta (Windows é o alvo)

Tauri 2 resolve diretórios por variável, não por string montada na mão:

| Variável | Windows | Uso |
|---|---|---|
| `$APPLOCALDATA` | `%LOCALAPPDATA%\<identificador>\` | **destino da arte** |
| `$APPDATA` | `%APPDATA%\<identificador>\` (roaming) | não usar — 122 MiB não deve roaming |
| `$DOCUMENT` / `$DOWNLOAD` | Documentos / Downloads | não usar — nesta máquina Documentos está no OneDrive |

Caminho lógico: `$APPLOCALDATA/art/{lang}/{cardId}.webp` mais
`$APPLOCALDATA/art/{lang}/manifest.json`.

`cardId` é o id já usado no filename do S3 (`341_107_X3G2GX9QW86R`), não o
título. Nome curto, ASCII, sem espaço. Não estoura `MAX_PATH`.

Junção só por `@tauri-apps/api/path` (`join` / `appLocalDataDir`). O plugin-fs
**recusa** `..` e caminho que não seja relativo a um base dir ou produzido
pela path API.

### 1.3 IndexedDB no PWA (rota que o (d3) já descrevia)

Banco **separado** do `keyforge-arena-cache` (DB v4: decks, cards, stats,
abilities em `src/lib/cache.ts`). Nome proposto: `keyforge-arena-art`.

| Store | Chave | Valor |
|---|---|---|
| `blobs` | `cardId` | `Blob` WebP + `lang` |
| `meta` | `"manifest"` | sets importados, contagem, idioma, `importedAt` |

Separar o banco **não** isola a evicção. No Chromium a pressão de disco
remove a **origem inteira** (todos os IndexedDB, Cache Storage, localStorage).
Um art-store no mesmo origin do jogo não protege a biblioteca de decks.
`navigator.storage.persist()` é pedido num gesto (o botão de importar), antes
do primeiro `put`. Se o browser negar, a UI avisa e não grava 122 MiB — a
arte segue no S3. Falha de `put` é engolida como o resto do storage.

Object URL: um mapa em módulo (`cardId → blob:`), criado uma vez, revogado
quando o pacote é apagado. Não criar URL por render.

No Tauri este banco não é preenchido. O degrau 2 do resolvedor existe para o
PWA e para um save antigo, só.

---

## 2. Produtor (um pacote, duas cascas)

Script Node (não entra no bundle), irmão do harvest de catálogo:

1. Lê os `front_image` que o catálogo local já tem (não lista o bucket — o S3
   responde 403 em `ListBucket`, ver a pesquisa §2).
2. Baixa o PNG do idioma pedido. 403 = não existe → registra fallback `en`,
   não falha o set.
3. Recomprime WebP qualidade 82 (alvo ~31 KB; a pesquisa mediu ~263–271 KB
   no PNG).
4. Empacota **por set e por idioma**: `art-pt-341.zip`, etc.
5. Cada zip traz `manifest.json`: `{ lang, set, files: [{ id, bytes, sha256 }] }`.

O app não baixa esse zip de servidor nenhum. O usuário aponta o arquivo
(seletor). "Baixado uma vez" significa: o harvest roda uma vez na máquina do
dono; a instalação só extrai.

`plugin-http` (Tauri 2) faz o GET no Rust e **não está sujeito a CORS**, mas
a URL tem de estar no scope do plugin. Isso destravaria um harvest dentro do
app. Fica de fora de propósito: a recompressão q82 e o manifest ficam num
lugar só, e as duas cascas leem o mesmo zip. Quando existir API própria, esse
atalho volta — ver §futuro.

---

## 3. Fluxo de importação / extração

UX única nas Configurações (não um pill novo na Home): "Arte offline".

1. Usuário escolhe um ou mais zips (gesto — também destrava `persist()` no PWA).
2. App lê o `manifest.json` antes de gravar. Entrada com `..`, absoluta, ou
   fora de `art/{lang}/` é rejeitada (zip-slip; no Windows isso escreve fora
   da pasta do app).
3. Progresso: `gravados / total` do manifest, cancelável (`AbortSignal`).
4. **PWA:** `Blob` por arquivo no art-store. Transações curtas (um put por
   carta, não um transaction de 122 MiB).
5. **Tauri:** `mkdir` se faltar; `writeFile` de cada WebP em
   `$APPLOCALDATA/art/{lang}/`; o `manifest.json` é o último arquivo (se o
   cancelamento cortar no meio, o manifest ausente = pacote incompleto, e a
   UI oferece continuar ou apagar).
6. Ao terminar, o resolvedor passa a achar a carta no degrau 1 ou 2. Carta
   ausente no manifest não é erro: desce para o S3.

Apagar: PWA `clear` do art-store + revogar object URLs. Tauri remove o
diretório `art/` (a desinstalação do app no Windows **não** apaga
`%LOCALAPPDATA%\<id>` sozinha — a UI de "remover artes" é o caminho; o resto
fica documentado).

Atualizar: importar o zip de novo. Mesmo `cardId` sobrescreve. O manifest
novo substitui o antigo no fim.

---

## 4. CardArt unificado

Ordem de resolução, por carta, idioma efetivo = `settings.language` mapeado
para código de arte (`pt-BR` → `pt`; o S3 não tem `pt-br`, pesquisa §1.1):

1. **Arquivo local** (Tauri). O path absoluto é resolvido **uma vez** no boot
   (`appLocalDataDir`). `convertFileSrc` em si é síncrono: só reescreve a
   string. Não usar `readFile` para pintar carta — cada leitura copia o WebP
   pelo IPC; uma mão de seis cartas faria isso no frame.
2. **IndexedDB.** Hit no mapa de object URL, senão `get` do Blob e cria a URL.
3. **S3 no idioma** — rewrite do `face.image` (o helper da pesquisa §4a:
   `card_front/{lang}/…_{lang}.png`). Ainda PNG remoto; o WebP é só o pacote
   local.
4. **S3 `en`**, uma vez, se o 3 falhou (`onError`).
5. **`card-fallback`** — o estado `failed` que já existe.

`onError` avança um degrau. Não fica em loop. Cache de "este id não está no
manifest" em memória, para não statar disco por carta a cada paint.

O `<img>` remoto continua sem `fetch`: o S3 não manda
`Access-Control-Allow-Origin` (pesquisa §2). Blob a partir da resposta do S3
segue impossível no PWA. O `<img>` opaco funciona e é o fallback online.

---

## 5. UX e i18n

Secção nas Configurações, ao lado do resto de preferências. Textos por
`t()`, en e pt-BR, no padrão atual:

- título, uma linha do que o pacote é (offline, um idioma, tamanho ~122 MB);
- botão importar;
- progresso (`{done}/{total}`) e cancelar;
- estado: nada importado / N cartas em `{lang}` / incompleto;
- PWA, se `persist()` negar: aviso de que o browser pode apagar a arte e os
  decks juntos, e que a importação não segue;
- Tauri: caminho da pasta (texto, não input editável) e "remover artes";
- erro de zip inválido / zip-slip — mensagem curta, partida intacta.

Alvos de toque ≥ 44px. Nada que exista só em hover. A secção não pode
empurrar o piso tipográfico (11px informativo; input 16px se algum dia houver
campo).

---

## 6. Riscos

### 6.1 As três perguntas que o cenário Tauri abre

**O fs do Tauri é síncrono?** Na webview, não. `@tauri-apps/plugin-fs` (v2)
expõe `readFile` / `writeFile` / `exists` / `mkdir` / `remove` como funções
`async` que fazem `invoke` no Rust. Não há `readFileSync` no JavaScript.
(`std::fs` no Rust pode ser síncrono; a webview não chama isso.)
`convertFileSrc` (`@tauri-apps/api/core`) **é** síncrono — não lê o arquivo,
monta a URL do protocolo. O boot espera `appLocalDataDir()` (Promise) uma vez;
o paint da carta não espera IPC.

**Paths por plataforma?** Sim, e a API existe para isso. Escopo e código usam
`$APPLOCALDATA` / `BaseDirectory.AppLocalData` + `path.join`. Proibido
concatenar `C:\` ou `/`. No Windows o protocolo de asset pede o absoluto que
o `join` devolveu; `convertFileSrc` codifica a barra invertida. `..` é
rejeitado pelo plugin.

**O CSP bloqueia o `<img>` do `convertFileSrc`?** Bloqueia, se não for
configurado. Os dois gates são independentes:

1. `app.security.assetProtocol.enable: true` e `scope` cobrindo a pasta.
   Default é `enable: false`, `scope: []`. Sem isso o WebView recusa com
   "asset protocol not configured to allow the path". O scope do **plugin-fs**
   (capability em `capabilities/`) não vale para o protocolo de asset, e o
   inverso também. Extração precisa de write/mkdir no fs; a imagem precisa do
   scope do asset. Os dois entram no shell desktop.
2. CSP `img-src`. No **Windows (WebView2)** e no Android, `convertFileSrc`
   produz `http://asset.localhost/…`, não o scheme `asset:`. Em macOS/Linux
   o scheme é `asset://localhost/…`. `img-src` tem de listar
   `'self' asset: http://asset.localhost https://asset.localhost blob:`
   e o host do S3 (`https://mastervault-storage-prod.s3.amazonaws.com`).
   Tauri só injeta `asset:` / `asset.localhost` sozinho quando reescreve uma
   CSP em string; uma CSP objeto escrita por nós não herda isso. Não ligar
   `dangerousDisableAssetCspModification` para "simplificar".

Scope proposto (teto, não o disco inteiro):

```json
"assetProtocol": {
  "enable": true,
  "scope": ["$APPLOCALDATA/art/**"]
}
```

### 6.2 Windows (alvo primário)

- WebView2 usa `http://asset.localhost`. Esquecer esse host no `img-src` é a
  falha mais provável: a imagem quebra com o arquivo no disco certo.
- Arte em `%LOCALAPPDATA%`, nunca em Documentos (OneDrive) nem em
  `%APPDATA%` roaming.
- Antivírus pode segurar o arquivo no meio do `writeFile`. Retry curto; se
  persistir, a carta cai no S3 e o manifest não é commitado.
- Desinstalar o `.msi`/NSIS deixa a pasta. A UI "remover artes" é o contrato;
  não contar com o uninstaller.
- Path com não-ASCII não aparece em `%LOCALAPPDATA%\<id>` se o identificador
  do `tauri.conf` for ASCII. Não colocar a arte debaixo do repo
  (`…\Documentos\…`).
- O perfil do WebView2 também vive em AppData, noutro subdiretório. Limpar
  "dados do app" da webview não é o mesmo que apagar `art/` — e não deve ser.
- `plugin-http`, se um dia for ligado ao S3: scope no host exato. Não é CORS,
  mas capability negada rejeita a Promise do mesmo jeito.

### 6.3 PWA / browser

- Evicção de origem apaga decks e artes juntos. `persist()` antes de gravar;
  se negado, não gravar. Banco separado não mitiga isso.
- Quota: 122 MiB cabe no teto típico do Chromium, mas não é o risco — a
  evicção sob disco cheio é.
- `fetch` do S3 continua opaco. Não há atalho "baixa a carta vista e guarda".
  Só o zip importado vira Blob.
- Cache HTTP do `<img>` remoto segue heurístico (pesquisa §2) e some com
  "limpar dados". Não é o offline garantido.
- Object URL vazada se o mapa não revogar no "remover" — limite prático de
  memória, não de quota.

### 6.4 Os dois

- Zip-slip na extração.
- Pacote de um idioma só. Carta 800+ em instalação `pt` não está no zip (não
  existe no S3); o degrau `en` remoto cobre quando há rede, o fallback
  tipográfico cobre quando não há.
- Manifest commitado por último, senão um cancelamento mente "completo".

---

## 7. Fora deste plano

- Implementação (harvest, shell Tauri, UI, i18n). Este doc não autoriza
  código.
- Embutir WebP no `index.html` ou no instalador.
- Harvest ao vivo dentro da webview (canvas/wasm para WebP, ou `plugin-http`
  carta a carta).
- Listar o bucket S3.
- Rewrite de idioma no `<img>` online sozinho — isso já é a opção (a) da
  pesquisa e pode sair antes da arte offline. Não depende deste plano.

---

## §futuro

Multiplayer com backend/API própria fica para um plano separado; aqui só a
implicação na arte.

Uma API same-origin mata o CORS das terceiras (o S3 opaco deixa de ser a
única fonte) e pode servir o WebP ela mesma: o PWA passaria a `fetch` com
corpo legível (Blob/Cache Storage sem importar zip) e o Tauri passaria a
preencher `$APPLOCALDATA/art` por `plugin-http` nesse host, em vez do zip
local. O `file://` do single-file continua sem alcançar essa API — a partida
solo offline segue no pacote já extraído ou no art-store, com o mesmo
resolvedor (arquivo → IndexedDB → URL da API → fallback). Nada disso se
desenha agora.
