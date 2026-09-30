# Pesquisa — Imagens de carta localizadas no Master Vault S3 + arquitetura de hospedagem (2026-09-30)

Pergunta de origem: *"será que é possível cachear no servidor para hospedar para o
front? (aí teria que rever a arquitetura, backend e frontend separados)"* — e, antes
disso: **variantes de idioma das artes existem no bucket oficial?**

Resposta curta, com evidência empírica abaixo:

1. **Sim, `pt` existe** — e não só pt: o bucket `mastervault-storage-prod` tem artes
   localizadas em **9 idiomas** (`en, pt, es, fr, de, it, pl, zh-hans, zh-hant`) para
   TODOS os sets da era FFG (CotA 341 → Winds of Exchange 600) e parcialmente nos da
   era Ghost Galaxy. **Não há nada a sintetizar nem backend a criar** para ter carta
   em português: basta reescrever a URL que a API já devolve.
2. A listagem do bucket segue negada (403 em `media/card_front/` também) — mas ela
   nem é necessária: o padrão de URL é determinístico a partir do `front_image`
   que o payload do deck já traz.
3. A opção (c) (backend/CDN próprio) **quebra invariantes do projeto e não é
   recomendada** — a opção recomendada é a (a) evoluída: URL rewrite por idioma +
   fallback EN, zero servidor. Detalhes e prós/contras honestos na §4.

---

## 1. Probes de idioma (S3, direto via curl)

**Metodologia:** `curl -s -o /dev/null -w "%{http_code}"` contra
`media/card_front/{lang}/341_107_X3G2GX9QW86R_{lang}.png` (a carta-exemplo da
missão). Duas lições de execução: (i) a rede deste ambiente produziu falhas
transitórias `000` (conexão) em rajadas — **todo probe desta pesquisa foi rodado
com `--retry` e intervalo**; os números abaixo são respostas reais do S3, não
timeouts; (ii) **403 neste bucket = "objeto não existe"**, porque o bucket nega
`s3:ListBucket` ao público — provado com três controles negativos, todos 403:
idioma inexistente (`xx/…_xx.png`), filename com idioma errado
(`pt/341_107_…_en.png`) e carta inexistente (`en/341_999_…_en.png`). Um objeto
real responde 200 (não há 404 neste bucket para objetos privados).

### 1.1 A carta-exemplo (set 341) — todos os códigos testados

| Código | HTTP | Conclusão |
|---|---|---|
| `en` | **200** | existe (controle) |
| **`pt`** | **200** | **existe — PNG real, 270.628 bytes** |
| `es` | **200** | existe |
| `fr` | **200** | existe |
| `de` | **200** | existe |
| `it` | **200** | existe |
| `pl` | **200** | existe |
| **`zh-hans`** | **200** | existe — **o hífen importa** |
| **`zh-hant`** | **200** | existe |
| `zh` | 403 | não existe (código errado; precisa de hífen) |
| `zhhans` | 403 | não existe (sem hífen não resolve) |
| `zh-cn`, `zhcn`, `zh-Hans`, `tw` | 403 | não existem |
| `pt-br`, `ptbr` | 403 | não existem (o código é `pt` puro) |
| `ja` | 403 | não existe (KeyForge nunca teve japonês) |
| `ru` | 403 | não existe |
| `th`, `ko` | 403 | não existem **no S3** (ver §3: keyteki lista th/ko/vi como nomes, mas não há artes) |
| `cs`, `hu`, `nl`, `tr`, `sv`, `da`, `no`, `fi`, `el`, `ro`, `uk`, `he`, `ar` | 403 | não existem |
| `xx` (controle falso) | 403 | confirma que 403 = inexistente |

**Correção ao enunciado da missão:** `341` **não é** AoA/set 5 — é **Call of the
Archons (set 1)**. Mapeamento completo e verificado em §1.3.

### 1.2 Prova de que a arte pt é conteúdo distinto (não redirect/mesmo arquivo)

| | `en/341_107_…_en.png` | `pt/341_107_…_pt.png` |
|---|---|---|
| Content-Length | 271.496 B | **270.628 B** |
| ETag | `2076601279047fa36499cdb89b28e849` | `836f1971ca14fe4bc6cc9bcab51322f7` |
| Last-Modified | 24 jan 2023 15:38:59 | 24 jan 2023 15:42:54 |
| Content-Type | image/png | image/png |

Arquivos diferentes de verdade: a arte pt tem o texto da carta impresso em
português (mesmo layout, razão 300×420 = 5:7 já assumida pelo `CardArt.tsx`).

### 1.3 Matriz set × idioma (o mapa completo)

Amostras reais por set (uma a duas cartas por set; IDs extraídos do repositório
`cardsofkeyforge.github.io` e `keyteki-json-data`, ver §3). HTTP 200 = ✓, 403 = ✗.

| Set (código MV) | amostra | en | pt | es | fr | de | it | pl | zh-hans | zh-hant |
|---|---|---|---|---|---|---|---|---|---|---|
| **341 Call of the Archons** (2018, FFG) | `341_001_7C854VPW72RH`, `341_107_X3G2GX9QW86R` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **435 Age of Ascension** (FFG) | `435_001_CCC247PX4H2C` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **452 Worlds Collide** (FFG) | `452_001_3F7RF5RJ4QQ6` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **479 Mass Mutation** (FFG) | `479_001_8GCXGP3F824C`, `479_117_82R4HCP3VC4P` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **496 Dark Tidings** (FFG) | `496_000_3W836P58R5VM` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **600 Winds of Exchange** (2023, Ghost Galaxy) | `600_001_7de1ac8b1aa9` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **700 Grim Reminders** (GG) | `700_001_4e065147b752`, `700_002_a40beb40090e` | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ |
| **800 Æmber Skies** (GG) | `800_001_c1b9f9de1ce6` | ✓ | **✗** | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ |
| **609 Vault Masters 2023** (reprint POB) | `609_210_3171248e5813` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **939 Vault Masters 2025** (reprint POB) | `939_001_a91d223d694a` | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |

Leitura do mapa:

- **Era FFG + WoE (341–600): 9/9 idiomas, sem exceção amostrada** — inclui todo o
  conteúdo que os decks reais dos jogadores usam na prática (os sets competitivos
  de referência até a transição).
- **Era Ghost Galaxy:** a localização encolhe. Grim Reminders (700) mantém
  **pt**; a partir de Æmber Skies (800) **pt deixou de existir** no bucket
  (ficam en/fr/de/zh). Sets de reprint POB (609, 939) são quase en-only.
- Consequência honesta para o app: **pt cobre sets 341–700**; para 800+ o
  comportamento correto é fallback EN — **exatamente o que o Master Vault oficial
  faz** ("Cards not available in the selected language will be displayed in
  English", §3.1).

### 1.4 Códigos de expansão (referência)

Enum completo de `sebastienode/MasterVault` (`Expansion.cs`, §3.6): 341 CotA,
435 AoA, 452 Worlds Collide, 479 Mass Mutation, 496 Dark Tidings, 600 Winds of
Exchange, 601 Unchained 2023, 609 Vault Masters 2023, 700 Grim Reminders,
722 Menagerie 2024, 737 Vault Masters 2024, 800 Æmber Skies, 855 Token of Changes,
874 More Mutation, 886 Prophetic Visions, 892 Martian Civil Wars, 907 Discovery,
918 Crucible Clash, 928 Draconian Measures, 939 Vault Masters 2025.

## 2. Listagem do bucket e comportamento HTTP

| Teste | Resultado |
|---|---|
| `GET /?list-type=2&prefix=media/card_front/&max-keys=5` | **403 AccessDenied** (XML `<Code>AccessDenied</Code>`, `x-amz-bucket-region: us-east-1`) |
| `GET /?list-type=2&prefix=media/houses/` (dono, prévio) | 403 AccessDenied (confirmado) |
| HEAD/GET de objeto existente | 200 + `Content-Type: image/png`, `ETag`, `Last-Modified`, `Accept-Ranges: bytes`, `x-amz-server-side-encryption: AES256` |
| **CORS** — GET com `Origin` | **200 mas SEM `Access-Control-Allow-Origin`** |
| **CORS** — preflight OPTIONS | **403** |

Conclusões:

1. **Listagem está fora** (igual para qualquer prefixo) — não dá para enumerar o
   catálogo nem medir contagem por idioma por listing. A contagem por idioma que a
   missão pedia é impossível por essa via; a matriz da §1.3 (amostragem por set) é
   o limite do que dá para provar sem credenciais. A boa notícia: **não precisamos
   de listing** — a URL é função determinística do `front_image` que a API do deck
   já devolve (§4).
2. **Sem CORS confirmado em cartas** (o BUG2-05 já tinha medido isso nos emblemas;
   aqui está a prova para `card_front`). Toda resposta de arte lida por `fetch()`
   do app é **opaca** (corpo inacessível) — isso é a pedra no caminho do Blob no
   IndexedDB (§4b).
3. **Sem `Cache-Control`**: o S3 não manda política de cache; os browsers usam
   cache heurístico (`10% × (Date − Last-Modified)`; com Last-Modified de 2023 isso
   significa meses de cache local) e revalidação condicional por `ETag`. Na prática
   a arte é barata de re-visitar.

**Latência medida** (us-east-1 → rede do pesquisador, 3 medições): 0,91–1,07 s
para os 270 kB completos (~250–300 kB/s). ~9,7 MB por deck de 36 cartas em um
idioma; ~70–110 MB por set completo; ~0,5 GB os 9 idiomas — matemática que já
mata qualquer plano de embutir arte no bundle.

## 3. O que a internet diz sobre imagens localizadas

### 3.1 O Master Vault oficial localiza por idioma, com fallback EN

A página oficial do jogo documenta: *"Select a language to display card names and
card images in your preferred language. Cards not available in the selected
language will be displayed in English"* (keyforgegame.com). Ou seja: o
comportamento "idioma escolhido → arte localizada → EN se não houver" é o modelo
oficial — não um hack nosso. A API `keyforgegame.com/api` expõe `front_image` por
carta (documentado pela TechTrek em "Keyforge Data Scraping Part 1: The API");
**se a API respeita idioma via header/parâmetro não pôde ser verificado desta
rede** (a API está atrás de Cloudflare e não respondeu a curl/WebFetch durante a
pesquisa — ponto em aberto, ver §5). O que importa: o app não depende disso.

### 3.2 cardsofkeyforge.github.io — a prova de conceito exata do que devemos fazer

O site estático **Cards of KeyForge** (mesma comunidade da DoK) serve TODAS as
cartas direto deste bucket, com um seletor de idiomas que faz **rewrite de URL
client-side** — nenhum servidor próprio de imagens. O código real de
`mm/117.md` (repositório público):

```js
img.src = img.src
  .replace(/card_front\/[^/]+/, 'card_front/pt')
  .replace(/_[^/.0-9]+\.png/, '_pt.png')
```

com bandeiras para `pt, en, es, fr, it, de, pl, zh-hans, zh-hant, th, ru, ko`
(th/ru/ko são oferecidos e caem em 403/quebrados na prática — o seletor deles
também não garante existência; nossa matriz da §1.3 é mais rigorosa). Este
repositório foi a fonte dos anarchyIds por set usados nos probes.

### 3.3 keyteki / The Crucible — imagens sempre EN + nomes localizados em dados

O `keyteki-json-data` (dados oficiais do keyteki/The Crucible Online) traz por
carta `"image"` apontando para o **mesmo bucket, sempre `/en/`**, e um objeto
`locale` com **nomes** localizados (`de, en, es, fr, it, pl, pt, th, vi, zhhans,
zhhant` — note: keyteki escreve `zhhans` sem hífen nos dados, mas o S3 exige
`zh-hans` com hífen; são namespaces diferentes). Ou seja, a maior implementação
digital de KeyForge **não usa artes localizadas — só localiza nomes**. Nenhum
campo de texto de carta traduzido no `locale` amostrado (só `name`).

### 3.4 Outros projetos

- **decksofkeyforge.com** — API pública documentada
  (`https://decksofkeyforge.com/public-api/v1/…`, página "Sellers and Devs") para
  dados de deck/carta; as imagens do ecossistema DoK/cardsofkeyforge são as do
  bucket MV.
- **keyforg/keyforge-cards-json** — scripts que capturam a API não-documentada do
  MV e salvam JSON (incl. `front_image`); caminho típico de quem monta catálogo.
- **danieltinazzi/Keyforge-Simulator** — fangame; o downloader dele "retrieve the
  card images directly from the official website" (bucket MV), EN.
- **Archon Arcana** — wiki com galeria de cartas (imagens próprias de wiki, EN;
  não é espelho por idioma).
- **r/KeyforgeGame** ("Where to download all card image?") — a comunidade usa o
  bucket MV como fonte canônica de imagens, inclusive para sets ausentes em
  wikis.
- **(Falso positivo)** A wiki "Card Images" do Card-Forge/forge que apareceu na
  busca é do engine de Magic the Gathering, não de KeyForge — descartada.

### 3.5 `cdn.keyforgegame.com` está morto

O `public/sw.js` lista `cdn.keyforgegame.com` em `ART_HOSTS`, mas o host **não
resolve mais DNS** (ENOTFOUND tanto na rede local quanto via fetch externo).
Entrada vestigial — todo o tráfego de arte real usa o S3 direto.

## 4. Avaliação de arquitetura de hospedagem/cache

Contexto inegociável (CLAUDE.md): single-file `index.html` sem code-splitting,
funciona de `file://` e offline, **"No CDN/web fonts/remote assets beyond what
`public/sw.js` precaches"**, orçamento de bundle ≤ 151 kB gzip (hoje 148,35).
Estado atual da arte (sw.js, BUG2-05): o SW **não intercepta** `card_front` — a
arte fica no cache HTTP do browser; medições prévias mostraram que cachear
resposta opaca em Cache API custa **~7 MB de quota por entrada** no Chromium
(20 entradas = 140 MB medidos), então isso foi deliberadamente abandonado.

### (a) Client-side direto no S3 (hoje) + troca de idioma por rewrite — **RECOMENDADA**

Como funciona: o `front_image` que o payload do deck traz (ex.
`…/card_front/en/341_107_X3G2GX9QW86R_en.png`) é **reescrevível em uma linha**
para qualquer idioma — mesma técnica do cardsofkeyforge (§3.2) — com cadeia de
fallback no `onError` do `<img>`: `pt → en → card-fallback` (o `CardImage` em
`CardArt.tsx` já tem o estado `failed`; falta só o degrau do meio).

- **Prós:** zero backend, zero custo, zero manutenção; não toca em nenhuma
  invariante; funciona de `file://`, de host estático e offline (com o
  `card-fallback` existente quando não há rede); cache HTTP do browser de graça
  (Last-Modified de 2023 → cache heurístico de meses); latência medida aceitável
  (~1 s por carta, lazy).
- **Contras:** sem cache off-line garantido de arte (o cache HTTP não é
  controlável e some com "limpar dados"); a existência por idioma/set não é
  anunciável por API — depende de fallback; se um dia a FFG/GG fechar o bucket,
  a arte some (mas o jogo continua jogável — o fallback já é contrato).
- **Custo de implementação:** helper pequeno + um estado a mais no `CardImage`;
  estimativa **+0,3–0,5 kB gz** — cabe no teto com folga (148,35 → ~148,8).

### (b) Blob no IndexedDB (`DYNAMIC_CATALOG_PLAN` §3) — bloqueada hoje por CORS

O plano já previa `artBlobs` (store por `cardId`). **Impedimento objetivo e
re-medido nesta pesquisa: o S3 não manda ACAO** (§2), logo `fetch()` do app só
obtém resposta opaca — corpo ilegível, Blob impossível. Caminhos que a desbloqueiam
sem violar invariantes: (i) **pacote de artes importado como File** (o usuário
baixa/carrega um arquivo; File → Blob → IDB não passa por CORS nenhum) — exigiria
um leitor de zip store-only (~1–2 kB gz) e um fluxo de UI; (ii) um script de
harvest LOCAL (fora do jogo) que serve as artes em `localhost` com
`Access-Control-Allow-Origin: *` para o usuário avançado popular o `artBlobs` —
o plano §3 onda 3 já reserva a decisão final para "medição real de quota".
- **Veredito:** manter como está no plano (diferido para a onda 3); NÃO é
  necessário para ter carta em pt (isso a opção (a) resolve).

### (c) Backend proxy/CDN próprio — **REJEITADA** (quebra invariantes, custo real, ganho pequeno)

- **O que exigiria:** domínio + edge (CloudFront ~US$ 0,085/GB, ou Worker
  Cloudflare no free tier ~100k req/dia) com CORS ligado; deploy/CI separado;
  monitorar abuso/custo (arte é o tráfego pesado do app); versionar cache.
- **O que quebra:** invariante 1 não diz "sem backend" por estética — diz que o
  produto é **um arquivo que funciona de qualquer lugar, inclusive `file://` e
  sem rede**. Um backend (i) não é alcançável de `file://` offline (o cenário
  principal do jogo), (ii) cria duas fontes de verdade de arte (S3 + proxy) e
  (iii) converte um projeto sem operação em um serviço com responsabilidade
  (uptime, custo, LGPD/abuse não, mas bill surpresa sim). E o benefício — ligar
  CORS para viabilizar (b) — **não é necessário para o objetivo "carta em
  português"**, que a (a) resolve sem servidor. Se um dia o objetivo for "arte
  offline garantida", o caminho consistente com o projeto é o pacote importado da
  (b), não um backend hospedado.

### (d) Build-time harvest — **REJEITADA para o bundle; variante local é o caminho avançado legítimo**

- **Harvest para dentro do repo/bundle:** matematicamente absurdo (1 carta =
  270 kB vs orçamento de bundle total de 151 kB gz) e explicitamente proibido
  pelo próprio projeto (`DYNAMIC_CATALOG_PLAN` §6: *"nada do catálogo é
  redistribuído no bundle"* — risco IP FFG).
- **Harvest local para uso pessoal** (script Node do dono → zip → importação como
  File na UI, alimentando `artBlobs`): legítimo (uso pessoal local, projeto de fã
  AGPL com disclaimer), sem backend, sem redistribuição — é a materialização da
  onda 3 do plano. Recomendado apenas SE a demanda "arte offline garantida"
  existir de verdade; hoje não existe demanda que pague essa complexidade.

### Overlay/síntese de tradução sobre a arte EN — **DESCARTADA** (e felizmente desnecessária)

A premissa da pergunta ("se as variantes pt NÃO existem…") **não se confirma**:
pt existe para todo o catálogo 341–700 (§1.3). Sintetizar (OCR + re-layout de
texto sobre a arte) teria: custo alto (milhares de cartas, layout por carta),
resultado visual inferior, e risco IP maior (obra derivada com texto FFG
recomposto e redistribuído — pior que exibir a arte oficial por URL). Para os
sets sem pt (800+), o correto é o fallback EN — mesma conduta do app oficial
(§3.1) — lembrando que o **texto** das cartas no app já é camada de UI
(`face.text` na lightbox + i18n en/pt-BR): traduzir texto de carta é problema de
dados (o `locale` do keyteki-json-data já tem NOMES localizados pt, se um dia
quisermos i18n de nomes), não de imagem.

### Recomendação final

**Opção (a) evoluída — "rewrite de idioma + fallback EN", sem backend.**
Especificação mínima (para um futuro FEAT, não implementado nesta pesquisa):

1. Helper puro `localizedImageUrl(url: string, lang: "en" | "pt"): string`
   (dois `replace` no padrão do cardsofkeyforge; retorna a original se o padrão
   não casa — mavericks/alternates usam o mesmo esquema de filename).
2. `CardImage` (`CardArt.tsx`): `src = localizedImageUrl(face.image,
   settings.language)`; no `onError`, tentar a URL `en` original UMA vez antes de
   ligar `failed` (cadeia pt→en→card-fallback).
3. Nada no SW (manter o BUG2-05 resolvido como está: arte no cache HTTP do
   browser). Zero backend. Bundle estimado +0,3–0,5 kB gz — dentro do teto 151.
4. Opcional futuro (onda 3 do plano): importação de pacote de artes (File → Blob
   → `artBlobs`) para quem quiser arte offline; e, se um dia a API do MV revelar
   parâmetro de idioma, preferir o que a API devolver — o rewrite continua sendo
   o fallback.

## 5. Pontos em aberto

1. **API `keyforgegame.com` inacessível desta rede** (Cloudflare): não pôde ser
   verificado se o payload de decks respeita idioma (header/param) no
   `front_image`. Irrelevante para a recomendação (o rewrite não depende disso),
   mas vale um probe de dentro de um browser real um dia.
2. **Amostragem por set:** 1–2 cartas por set. A matriz da §1.3 descreve o
   padrão por set com alta confiança (11/11 cartas da era FFG consistentes em 2
   sets com segunda amostra), mas cartas individuais podem divergir (tradução
   faltando pontualmente) — o fallback EN na UI cobre exatamente esse caso.
3. **Idiomas th/ko/ru/vi:** existem como NOMES no `locale` do keyteki, mas não
   como artes no S3 (403). Se a UI um dia suportar mais idiomas, arte = EN.

## 6. Fontes

- Probes diretos (autoria desta pesquisa, 2026-09-30): `https://mastervault-storage-prod.s3.amazonaws.com/media/card_front/{lang}/{arquivo}` (curl, com retry)
- Master Vault oficial (nota de idioma com fallback EN): https://www.keyforgegame.com/
- Cards of KeyForge — seletor de idiomas com rewrite client-side do MESMO bucket (código-fonte público, ex. `mm/117.md`): https://github.com/cardsofkeyforge/cardsofkeyforge.github.io
- keyteki / The Crucible — dados com `image` EN + `locale` de nomes: https://github.com/keyteki/keyteki-json-data (packs/WoE.json, packs/GR.json, packs/AS.json, packs/VM25.json) · https://github.com/keyteki/keyteki
- Enum de expansões (341=CotA … 939=VM2025): https://github.com/sebastienode/MasterVault (`Keyforge.MasterVault/Keyforge.MasterVault.Entity/Expansion.cs`)
- Documentação do campo `front_image` da API MV: https://www.techtrek.io/keyforge-data-scraping-part-1-the-api/
- Captura da API MV em JSON: https://github.com/keyforg/keyforge-cards-json
- API pública DoK: https://decksofkeyforge.com/about/sellers-and-devs
- Thread da comunidade sobre baixar imagens (exemplo 609 usado nos probes): https://www.reddit.com/r/KeyforgeGame/comments/17e40sh/where_to_download_all_card_image/
- Fangame que baixa imagens do site oficial: https://github.com/danieltinazzi/Keyforge-Simulator
- Wiki de cartas (referência geral, EN): https://www.archonarcana.com/
- Docs internas relacionadas: `docs/DYNAMIC_CATALOG_PLAN.md` (§3 CORS/quota, §6 risco IP, onda 3), `public/sw.js` (BUG2-05: sem ACAO; opaco = ~7 MB de quota/entrada; `cdn.keyforgegame.com` morto), `src/components/CardArt.tsx` (`CardImage` + fallback), `src/lib/keyforgeApi.ts` (`front_image` → `face.image`), `src/lib/demoDeck.ts`/`demoDeck2.ts` (URLs en hardcoded)
