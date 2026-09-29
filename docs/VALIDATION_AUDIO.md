# Validação — paleta sonora procedural (sound.ts + integração)

Validação **só por leitura** (o dono ainda não consegue ouvir). Alvo: `src/lib/sound.ts`
no HEAD `506895c` (commits `0373e97` unlock, `b1480bc` paleta), chamadas em
`src/App.tsx`, `src/components/DeckBrowser.tsx` e `src/components/DeckInspector.tsx`.
Requisitos: `docs/advisor/PROMPT-AUDIO.md` §2. Os números de linha do App.tsx são da
working tree atual, que inclui a ANIM onda 1 **não commitada** (FxLayer/fx.ts).

## VEREDITO: **APROVADO COM RESSALVAS**

O motor é estruturalmente sólido: todo timbre abre em 0, nenhuma voz tem pico > 1,
toda fonte tem `stop()` agendado, o echo é estável (ganho de malha ≈ 0,45) e o unlock
cobre os gestos que de fato concedem ativação. A paleta tem os 14 timbres e cada um
corresponde ao pedido do §2. Nenhum problema deixa a partida muda nem trava o jogo.

As ressalvas são **bugs de automação na música ambiente** (VAL-01/02: clique no
desligar e música muda com osciladores órfãos), **sobreposição forja + vitória**
(VAL-03) e **dessincronia do "pouso" com o voo de carta da ANIM onda 1** (VAL-04).
Nada é bloqueante para a paleta de SFX em si; VAL-01..04 devem ser corrigidos antes de
considerar o áudio fechado.

---

## Problemas

### VAL-01 — Fade da música sem âncora: corte seco (pop) ao desligar
**Severidade:** média
**Evidência:** `src/lib/sound.ts:324-325` e `src/lib/sound.ts:351`.
`linearRampToValueAtTime` interpola a partir do **evento anterior**, não do
`currentTime`. No start, `gain.value = 0` não cria evento. No stop, o evento anterior é
o fim do fade-in (`t0 + 2 s`, valor 0,05). Com a música tocando há 60 s, a rampa até 0 em
`now + 0,6` vai de `(t0+2, 0,05)` a `(now+0,6, 0)`: no instante `now` o valor calculado
já está perto de 0,0005, e o ganho **salta** de 0,05 para ≈0 num quantum. Num drone de
65 Hz isso é um "tuc" audível. Se o stop cair **durante** o fade-in (< 2 s), o evento em
`now+0,6` entra antes da rampa de 0,05 ainda pendente: o ganho vai a 0 e depois **volta a
subir** até os osciladores pararem no timer.
**Correção:**
```ts
const g = this.musicGain.gain, now = this.context.currentTime;
g.cancelScheduledValues(now);
g.setValueAtTime(g.value, now);
g.linearRampToValueAtTime(0, now + 0.6);
```
No start, `setValueAtTime(0, now)` antes da rampa até 0,05.

### VAL-02 — Desligar e religar a música em < 700 ms: música muda + osciladores órfãos
**Severidade:** média
**Evidência:** `src/lib/sound.ts:355-367` (o timer usa `this.musicGain`, não o gain
capturado) e `src/App.tsx:1975` (`music && screen === "game"`).
Sequência: no board, ir para Config e voltar em menos de 700 ms (tab bar, botão de
engrenagem `App.tsx:2933`). `stopMusic` agenda o timer; `startMusic` cria um **novo**
`musicGain`; o timer dispara, faz `disconnect()` e anula o gain **novo**. Os 6
osciladores novos continuam rodando ligados a um nó desconectado: a música fica muda
até o próximo toggle e gasta CPU ("fonte presa").
**Correção:** capturar localmente, `const gain = this.musicGain;` antes do timer; dentro
dele, `gain?.disconnect(); if (this.musicGain === gain) this.musicGain = null;`.

### VAL-03 — A 3ª chave dispara forja e vitória no mesmo frame
**Severidade:** média (design sonoro)
**Evidência:** `src/App.tsx:2137-2150`. O mesmo efeito toca `forge` (8 vozes, C5-G5-C6)
e, se `winner !== null`, `win` (20 vozes, C-E-G + acorde). As duas fanfarras de metais
se sobrepõem com ritmos diferentes, o que soa embolado e tira o destaque do stinger.
Somadas, 28 vozes, mais as da jogada/turno do mesmo instante (`endTurn`/`turn`, 2+2):
bate o teto de 32 e as **últimas** camadas do `win` (sparkle, âncora C2) são descartadas
em silêncio (`sound.ts:254`).
**Correção:** `if (game.winner === null) sound.play("forge")` (o flash visual pode
continuar), ou atrasar o stinger. A vitória nasce da forja, então o stinger basta.

### VAL-04 — O "pouso" do timbre `play` não coincide com o voo da ANIM onda 1
**Severidade:** média (regressão de integração com a WIP, ainda não commitada)
**Evidência:** `src/lib/sound.ts:84-90`: whoosh de 120 ms e pouso em **150 ms**, pensado
para commit instantâneo. Com a onda 1, `commitWithFx` (`App.tsx:1876-1905`) faz o voo
durar `PRESENT_MS 260 + hold + SLAM_MS 270` (`FxLayer.tsx:17-18,115`): ≈670 ms para o
jogador (hold 140) e ≈950 ms para o Warden (hold 420). O som é disparado **antes** do
voo (`App.tsx:2199` e `App.tsx:2387`). Resultado: o thump soa ~0,5–0,8 s antes do slam
visual.
**Correção:** quando houver plano de voo, dividir o timbre em `play` (whoosh no início)
e um `land` (thump + slap) disparado pelo FxLayer no início do SLAM. Sem animação
(`motionEnabled` falso) mantém o `play` atual. Outra saída: `sound.play(name, delayS)`
com o atraso vindo do plano. **Não** acoplar ao reduced-motion: é só timing (ver "O que
está correto").

### VAL-05 — O "kick" do WebKit é gasto num `pointerdown` de toque, que não é gesto
**Severidade:** baixa-média
**Evidência:** `src/lib/sound.ts:228-240`, `244-251`. Em toque, `pointerdown` chega
primeiro. Ele cria o contexto (suspended) e toca o buffer de 1 amostra; `start()` não
lança em contexto suspenso, então `kicked = true` na hora. O `pointerup`/`touchend`, que
**é** o gesto, já não refaz o kick. O comentário "the next gesture retries" nunca se
cumpre, porque `start()` não falha. Em WebKit moderno o `resume()` dentro do `touchend`
(que continua acontecendo via `ensureContext`) costuma bastar, então o impacto é
residual (iOS antigo). Mas o próprio motivo do kick fica anulado.
**Correção:** só fazer o kick com ativação real,
`if (navigator.userActivation && !navigator.userActivation.isActive) return;` antes do
`try`. Ou zerar `kicked` em `context.onstatechange` quando `state !== "running"`, o que
também cobre o "interrupted".

### VAL-06 — Com o contexto suspenso, vozes se acumulam e tocam juntas na retomada
**Severidade:** baixa
**Evidência:** `src/lib/sound.ts:293-298`, `301-315`. `play()` agenda em `currentTime`,
que está **congelado** enquanto o contexto não roda (antes do primeiro gesto, iOS
"interrupted" por ligação ou app em segundo plano). As fontes não terminam, o `onended`
não roda e `voices` sobe até 32. Daí em diante tudo é descartado, e **na retomada as
vozes enfileiradas tocam todas no mesmo instante** (rajada fantasma). No desktop
Chrome/Edge (aba oculta não suspende) quase não acontece; no iOS com a IA jogando é
plausível.
**Correção:** em `play()`, depois de `ensureContext()`:
`if (context.state !== "running" && !navigator.userActivation?.isActive) return;`
(descarta som fora de gesto enquanto suspenso; o primeiro toque ainda soa).
Menor: incrementar `voices` só **depois** de `start()`, para uma exceção não vazar o
contador.

### VAL-07 — O mulligan do Warden é mudo e a passagem de vez no 2P usa `click`
**Severidade:** baixa
**Evidência:** `src/App.tsx:2230-2238`: o mulligan da IA faz `commitGame` sem som (o do
humano toca `shuffle` em `App.tsx:2436`). `App.tsx:2880`: no pass-and-play,
`onPassConfirm` toca `click` quando o próximo humano assume. O solo, ao contrário, toca
`turn` quando a vez volta (`App.tsx:2213`).
**Correção:** `if (take) sound.play("shuffle")` no timer do Warden; `onPassConfirm` →
`sound.play("turn")`. Zero bytes de timbre novo.
Obs.: o mulligan **dos dois lados** no 2P está coberto, porque os dois passam por
`decideOpeningHand` (`App.tsx:2432-2448`) → `shuffle`.

### VAL-08 — `discard`, `unstun` e `use` caem no timbre `play` (whoosh + pouso)
**Severidade:** baixa
**Evidência:** `src/App.tsx:2199`, `2387` (`fight ? … : reap ? … : "play"`), com os tipos
de `src/lib/game.ts:120-126`. Descartar uma carta ou tirar o stun de uma criatura soa como
"carta pousando na mesa", o que é semanticamente errado. Com `use` via `reap`
(`game.ts:124`) o som também não é o chime de colheita.
**Correção:** mapear `discard` → `click` (ou `shuffle` curto), `unstun` → `select`,
`use` com `via === "reap"` → `reap`. Um helper `moveSfx(move)` substitui as 4 cópias do
ternário (reduz bytes).

### VAL-09 — Ligar o SFX no header não dá retorno sonoro (feedback invertido)
**Severidade:** baixa
**Evidência:** `src/App.tsx:2698`. O `click` é tocado **antes** do toggle. Ao ligar,
`prefs.sfx` ainda é `false` e nada soa; ao desligar, o clique soa.
**Correção:** tocar depois de aplicar as prefs, por exemplo
`sound.setPrefs({ …, sfx: true }); sound.play("click")` quando `!prev.sfx`.

### VAL-10 — Cauda percussiva cortada em ≈ e⁻⁵ do pico
**Severidade:** informativa
**Evidência:** `src/lib/sound.ts:288`, `298`. Com `τ = d/5` e `stop(end + 0,02)`, o
envelope está em ≈0,6 % do pico no corte. Para `g = 0,6` (fight) isso dá ≈ −49 dBFS, ou
≈ −46 dBFS depois do makeup do compressor. Na prática é inaudível; em fone e com ruído
branco pode virar um tique quase imperceptível.
**Correção (opcional):** `τ = d/7` ou `stop(end + 2 * τ)`. Custo zero.

### VAL-11 — Documentação e comentários divergentes
**Severidade:** informativa
- `sound.ts:193-199`: o `DynamicsCompressor` **não** é brickwall. Pelo spec ele aplica
  makeup automático: com threshold −8, ratio 12 e knee 0, o makeup é ≈ **+4,4 dB**. Sinais
  abaixo de −8 dBFS saem mais altos, com master efetivo ≈ 0,8 × 1,66, e os picos ficam
  em ≈ −3 dBFS (attack de 3 ms, lookahead de 6 ms). O resultado é bom, mas o comentário
  "limiter" engana quem for ajustar ganhos.
- O commit `0373e97` diz "master 0.5 → 1"; o código atual usa `0.8` (`sound.ts:198`),
  ajustado depois em `b1480bc`. Vale registrar.
- `sound.ts:136`: o comentário diz "descending G-E-C triads", mas o código toca notas
  **isoladas** G4-Eb4-C4 (arpejo menor, não tríades).

### VAL-12 — Bundle: sem espaço para timbres novos agora
**Severidade:** informativa (o risco é da ANIM WIP, não do áudio)
**Evidência:** `vite build` na working tree atual dá `dist/index.html` **gzip 140,20 kB**,
acima do orçamento de 135 kB (regra 7 do CLAUDE.md). O excesso vem da ANIM onda 1 não
commitada (`FxLayer.tsx`, `fx.ts`, CSS). `sound.ts` isolado e minificado ocupa ≈ **2,25 kB
gzip**. **Nada nele é morto:** todo campo de `Voice` é lido, os 14 timbres têm chamadores
(`sparkle` via toggle de dicas, `error` via DeckBrowser/import) e os helpers
`brass`/`bell`/`sparkle` evitam repetição.
**Recomendação:** **não** adicionar agora timbres para captura, stun, haste, destruição
ou chains. Não eram requisito do §2, e o `diffFx` da onda 1 é o gancho natural quando
houver orçamento. O único corte barato é o helper `moveSfx` (VAL-08).

---

## Cenários verificados sem problema

**Envelope / grafo**
- Cada voz cria seus próprios osc/buffer, filtro e gain (`sound.ts:253-299`). Não há
  AudioParam compartilhado nos SFX, então `cancelScheduledValues` não é necessário ali.
- Todo envelope começa com `setValueAtTime(0, t)` e sobe por rampa **linear** até `g`
  (ataque ≥ 2 ms). Não há rampa exponencial para 0 (que lançaria erro) nem salto de
  valor. Os alvos `to`/`fto` são todos ≠ 0, e as rampas exponenciais de frequência têm
  `setValueAtTime` âncora no mesmo `t`.
- A ordem dos eventos está certa: a rampa termina em `t+a`, o `setTargetAtTime` de decay
  começa em `t+a` e o release (vozes com sustain) em `t+a+0,6d`, chegando a ≈ e⁻⁵ no
  `end`.
- Nenhuma voz passa de 1: o maior `g` é 0,6 (fight). As somas por timbre (fight ≈ 1,35
  antes do master 0,8) são seguradas pelo compressor.
- **Não há fonte presa nos SFX:** toda fonte tem `stop(end + 0,02)`, e o ruído em loop
  também para. O `onended` devolve a vaga no teto.
- **Echo estável:** são duas malhas independentes (89 ms e 137 ms), cada uma com delay →
  lowpass 2,6 kHz (Q = 1 dB, pico ≈ 1,12) → feedback 0,4. O ganho de malha é ≈ 0,45 < 1,
  com −60 dB em ≈ 0,8 s / 1,2 s. A malha tem atraso ≥ 128 frames e o send é 0,3.
  `maxDelayTime` padrão (1 s) basta.
- O noise buffer (1 s, mono) é criado uma vez e reaproveitado em loop com offset
  aleatório, então o ruído não soa idêntico a cada disparo.

**Paleta vs PROMPT-AUDIO §2** (todas as chaves mantidas)
| Pedido | Timbre | OK |
|---|---|---|
| seleção (tick sutil) | `select` chirp 1560→2080 Hz + escova 5 kHz; `click` ruído BP 2,4 kHz | ✓ |
| jogar carta (whoosh + pousar) | `play` BP 500→2600 Hz + thump 160→70 Hz + slap LP | ✓ (ver VAL-04) |
| luta (impacto + noise burst) | `fight` ruído LP 3,5k→250 Hz + corpo 120→42 Hz + crack square | ✓ |
| colher (chime de âmbar) | `reap` sinos E6/B6 + parcial 2,76× | ✓ |
| forjar (fanfarra de 3 notas) | `forge` C5-G5-C6 em metais + hit grave + ar | ✓ |
| início/fim de turno (soft) | `turn` A4→E5, `endTurn` D5→A4, triangle 0,12 | ✓ |
| mulligan (shuffle por ruído filtrado) | `shuffle` 9 flicks BP 2,6–4,4 kHz com jitter | ✓ |
| vitória/derrota (2–3 s) | `win` ≈ 2,6 s, `lose` ≈ 2,65 s | ✓ |
| dica ligada (sparkle) | `sparkle` G6-A6-C7-D7-E7 | ✓ |
| reverb barato | echo bus de duas malhas | ✓ |
| throttle anti-spam | 50 ms/nome + teto de 32 vozes | ✓ |

**Unlock (`0373e97`)**
- Escuta `pointerdown` (mouse), `pointerup` e `touchend` (toque/caneta) e `keydown`, que
  batem com os eventos de ativação do HTML. Os listeners são de captura, então rodam
  **antes** do `onClick` que chama `play()`: o primeiro toque na Home já soa. O listener
  fica ligado (sem `once`) e revive "suspended"/"interrupted"; o cleanup está no efeito
  de mount (`App.tsx:2034-2040`), o que é seguro no StrictMode.
- A retomada de partida (`App.tsx:2742`) toca dentro do clique, com o contexto ativo.
  O `prevKeysRef` é semeado com as chaves salvas (`App.tsx:2756`), então **não** há
  `forge` espúrio na retomada. `launchMatch` zera o `prevKeysRef` (`App.tsx:2352`).
- Troca de aba: Chrome/Edge não suspendem o contexto. No iOS, `ensureContext` chama
  `resume()` em qualquer estado ≠ running, e o próximo gesto revive o contexto (ressalva
  de fila em VAL-06). O `audioSession.type = "playback"` evita o mudo da chave de
  silêncio no iOS.
- Falhas de construtor, `resume()` e voz são engolidas (regra 6): a partida continua
  jogável sem áudio.

**Integração**
- Solo: casa (humano `App.tsx:2455`, IA `2187`), jogada/luta/colheita (humano `2387`,
  IA `2199`), fim de turno (`2421`), volta da vez (`2213`), forja dos **dois lados**
  (efeito `2140`), vitória/derrota (`2149`), mulligan do humano (`2436`), alvo/seleção
  (`2383`, `2411`, `2464`, `2898`), undo (`1952`) e erro de busca/import
  (`DeckBrowser.tsx:77`, `App.tsx:2564`).
- **2P (FEAT-13):** vitória de qualquer lado toca `win`, nunca `lose` (correto: os dois
  lados são humanos). A forja soa para os dois lados, o mulligan dos dois passa por
  `shuffle`, o loop da IA e o mulligan do Warden ficam dormentes (sem som fantasma) e o
  undo fica bloqueado (sem `click` de undo). Risco de regressão baixo; só VAL-07.
- **Replay viewer:** usa estados próprios (`setReplay`) e não toca em `game`, então não
  redispara forja nem vitória.
- **Toggle de velocidade da IA:** **não existe** no código atual (grep por
  `speed`/`aiSpeed` vazio). Os passos da IA são fixos (520/340/460 ms; com a onda 1, a
  IA também espera o voo). O throttle de 50 ms não afeta ações ≥ 340 ms. Se um modo
  rápido vier (< 50 ms por ação), o throttle funde sons de mesmo nome, que é o
  comportamento desejado. A duração das vozes (≤ 0,4 s nos timbres de jogada) mantém o
  teto de 32 folgado.
- **Throttle/teto:** o relógio `performance.now()` está correto, porque o `currentTime`
  congela quando suspenso. O throttle por nome também absorve o duplo disparo de efeitos
  do StrictMode em dev. O maior timbre tem 20 vozes (`win`), então o teto só aperta no
  caso de VAL-03.
- **settings:** `sfx` true e `music` false por padrão (`settings.ts:35-36`). `play()`
  respeita `prefs.sfx`, e a música só toca com `music && screen === "game"`
  (`App.tsx:1975`).
- **reduced-motion:** **não há acoplamento com áudio.** `sound.ts` não lê
  `settings.animations` nem `prefers-reduced-motion`. `settings.animations` só governa
  o `forgeFlash` (`App.tsx:2142`) e os voos (`motionEnabled` em `fx.ts:70`). O áudio
  toca igual com animações desligadas, como deve.

---

## Resumo das correções sugeridas (ordem)
1. VAL-01 + VAL-02 (música: âncora do fade e corrida do timer): ~6 linhas em `sound.ts`.
2. VAL-03 (sem `forge` quando há vencedor): 1 linha no App.
3. VAL-04 (pouso sincronizado com o SLAM): junto com o commit da ANIM onda 1.
4. VAL-05/06 (gate de `userActivation` no kick e no play suspenso).
5. VAL-07/08/09 (mapeamentos de evento, helper `moveSfx`): zero bytes de timbre novo.
6. VAL-10/11: comentários e τ, oportunistas.

Nenhum código foi alterado nesta validação. O único artefato novo é este documento; o
`dist/` gerado para medir o bundle é ignorado pelo git.
