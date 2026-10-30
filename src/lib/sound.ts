export type SfxName =
  | "click"
  | "select"
  | "play"
  | "land"
  | "reap"
  | "fight"
  | "forge"
  | "house"
  | "win"
  | "lose"
  | "error"
  | "endTurn"
  | "turn"
  | "shuffle"
  | "sparkle";

export interface SoundPrefs {
  sfx: boolean;
  music: boolean;
}

// One synth layer. f = 0 plays the shared noise buffer instead of an oscillator.
export interface Voice {
  f: number;
  /** Pitch glide target, reached at the end of the voice. */
  to?: number;
  w?: OscillatorType;
  /** Start offset (s). */
  at?: number;
  /** Attack (s). */
  a?: number;
  /** Length after the attack (s). */
  d: number;
  /** Peak gain. */
  g: number;
  /** Sustain as a fraction of the peak; 0 = percussive decay. */
  s?: number;
  flt?: BiquadFilterType;
  fq?: number;
  /** Filter sweep target. */
  fto?: number;
  q?: number;
  /** Also feed the echo bus. */
  wet?: 1;
}

const MAX_VOICES = 32;

// Brass stab (fanfares): sawtooth through a 2.6 -> 0.9 kHz lowpass plus a
// half-frequency triangle body, 20 ms attack and 60% sustain as the default.
const brass = (f: number, at: number, d: number, g: number, s = 0.6): Voice[] => [
  { f, w: "sawtooth", at, a: 0.02, d, g, s, flt: "lowpass", fq: 2600, fto: 900, wet: 1 },
  { f: f / 2, w: "triangle", at, a: 0.02, d, g: g * 0.8, s },
];

// Hint sparkle: five rising partials (G6..E7) 45 ms apart, 300 ms tails.
const sparkle = (at: number, g: number): Voice[] =>
  [1568, 1760, 2093, 2349, 2637].map((f, i) => ({ f, at: at + i * 0.045, d: 0.3, g, wet: 1 }));

// Amber chime: struck-bar bell (900 ms fundamental) plus its 2.76x inharmonic partial.
const bell = (f: number, at: number, g: number): Voice[] => [
  { f, at, d: 0.9, g, wet: 1 },
  // 2.76x is the first inharmonic partial of a struck bar: reads as crystal, not organ.
  { f: f * 2.76, at, d: 0.3, g: g * 0.3 },
];

const PALETTE: Record<SfxName, () => Voice[]> = {
  // UI tick: 30 ms band-passed noise flick at 2.4 kHz over a 900 Hz triangle blip.
  click: () => [
    { f: 0, flt: "bandpass", fq: 2400, q: 2, d: 0.03, g: 0.5 },
    { f: 900, w: "triangle", d: 0.03, g: 0.08 },
  ],
  // Selection tick: 60 ms sine chirp 1560 -> 2080 Hz, 5 kHz noise brush on top.
  select: () => [
    { f: 1560, to: 2080, d: 0.06, g: 0.05 },
    { f: 0, flt: "highpass", fq: 5000, d: 0.02, g: 0.08 },
  ],
  // House call: 900 -> 3000 Hz band sweep opens, then A4 and E5 triangles answer.
  house: () => [
    { f: 0, flt: "bandpass", fq: 900, fto: 3000, a: 0.08, d: 0.12, g: 0.2 },
    { f: 440, w: "triangle", d: 0.18, g: 0.18, wet: 1 },
    { f: 660, w: "triangle", at: 0.07, d: 0.28, g: 0.16, wet: 1 },
  ],
  // Whoosh while the card travels (500 -> 2600 Hz band sweep, 120 ms attack).
  play: () => [{ f: 0, flt: "bandpass", fq: 500, fto: 2600, q: 1.4, a: 0.12, d: 0.08, g: 0.35 }],
  // VAL-04: o pouso separado do whoosh. Com voo, o FxLayer dispara no início do
  // slam com delayS = 0,24 (VAL-04b): o `fx-slam` usa ease-in e a carta só chega
  // ao slot aos ~92% de 270 ms — o thump tem que soar no contato, não no começo
  // do trecho. `delayS` desloca TODAS as vozes do timbre (play()). Sem animação
  // ele toca 150 ms depois do `play` (sound.play("land", 0.15)), reproduzindo o
  // timbre antigo.
  land: () => [
    { f: 160, to: 70, d: 0.14, g: 0.45 },
    { f: 0, flt: "lowpass", fq: 1400, d: 0.05, g: 0.4 },
  ],
  // Fight: full-band noise slam low-passed 3500 -> 250 Hz, 120 -> 42 Hz body
  // drop and a short 260 Hz square crack to keep it punchy.
  fight: () => [
    { f: 0, flt: "lowpass", fq: 3500, fto: 250, a: 0.002, d: 0.3, g: 0.6, wet: 1 },
    { f: 120, to: 42, a: 0.002, d: 0.35, g: 0.6 },
    { f: 260, to: 90, w: "square", flt: "lowpass", fq: 1200, d: 0.09, g: 0.15 },
  ],
  // Reap: crystal chime, bells at E6 then B6 (70 ms apart), each with its 2.76x partial.
  reap: () => [...bell(1319, 0, 0.2), ...bell(1976, 0.07, 0.14)],
  // C5-G5-C6 call over a low hit, the last note held with an air swell.
  forge: () => [
    ...brass(523.25, 0, 0.16, 0.14),
    ...brass(783.99, 0.13, 0.16, 0.14),
    ...brass(1046.5, 0.26, 0.9, 0.16),
    { f: 131, to: 65, d: 0.5, g: 0.4 },
    { f: 0, flt: "highpass", fq: 4000, at: 0.26, a: 0.05, d: 0.6, g: 0.08, wet: 1 },
  ],
  // Turn closing: soft two-note fall, D5 then A4 100 ms later.
  endTurn: () => [
    { f: 587, w: "triangle", d: 0.16, g: 0.12, wet: 1 },
    { f: 440, w: "triangle", at: 0.1, d: 0.3, g: 0.12, wet: 1 },
  ],
  // Turn opening: soft two-note rise, A4 then E5 100 ms later.
  turn: () => [
    { f: 440, w: "triangle", d: 0.16, g: 0.12, wet: 1 },
    { f: 659, w: "triangle", at: 0.1, d: 0.35, g: 0.12, wet: 1 },
  ],
  // A riffle: nine bright band-passed noise flicks (2.6-4.4 kHz) 45 ms apart,
  // each offset a few ms so the spacing never sounds metronomic.
  shuffle: () =>
    Array.from({ length: 9 }, (_, i) => ({
      f: 0, flt: "bandpass" as const, fq: 2600 + Math.random() * 1800, q: 1.2,
      at: i * 0.045 + Math.random() * 0.012, d: 0.035, g: 0.35,
    })),
  sparkle: () => sparkle(0, 0.07),
  // Win stinger (2.6 s): C-E-G fanfare into a held C major chord an octave up,
  // low C2 anchor and a sparkle tail.
  win: () => [
    ...brass(523.25, 0, 0.14, 0.12),
    ...brass(659.25, 0.12, 0.14, 0.12),
    ...brass(783.99, 0.24, 0.14, 0.12),
    ...[523.25, 659.25, 783.99, 1046.5].flatMap((f) => brass(f, 0.38, 2.2, 0.07, 0.7)),
    ...sparkle(0.4, 0.05),
    { f: 130.81, at: 0.38, d: 1.6, g: 0.3 },
  ],
  // Lose stinger (2.6 s): descending G-E-C triads settle into a low minor pad
  // (C3-Eb3-G3 saws, 300 Hz lowpass sweep) with a muffled noise bed under it.
  lose: () => [
    { f: 392, w: "triangle", d: 0.3, g: 0.15, wet: 1 },
    { f: 311.13, w: "triangle", at: 0.2, d: 0.3, g: 0.15, wet: 1 },
    { f: 261.63, w: "triangle", at: 0.4, d: 0.3, g: 0.15, wet: 1 },
    ...[130.81, 155.56, 196].map((f): Voice => (
      { f, w: "sawtooth", at: 0.6, a: 0.05, d: 2, s: 0.6, g: 0.1, flt: "lowpass", fq: 1800, fto: 300, wet: 1 }
    )),
    { f: 0, flt: "lowpass", fq: 300, at: 0.6, a: 0.1, d: 1.2, g: 0.2 },
  ],
  // Error: two low square blips (180 -> 140 Hz), the second 100 ms later.
  error: () => [
    { f: 180, to: 140, w: "square", flt: "lowpass", fq: 900, d: 0.08, g: 0.12 },
    { f: 170, to: 130, w: "square", flt: "lowpass", fq: 900, at: 0.1, d: 0.1, g: 0.12 },
  ],
};

// ---------------------------------------------------------------------------
// Trilha "Forja Noturna": ré menor, 66 BPM, forma A A2 B A' de 8 compassos
// (32 compassos ≈ 1 min 56 s). A composição é DADO puro — `planBar` diz o que
// soa em cada compasso e `eventVoices` traduz um evento em vozes do motor —,
// então a teoria (escala, compassos, graves) é verificável sem AudioContext.
// ---------------------------------------------------------------------------

export const MUSIC_BPM = 66;
/** Colcheias num 4/4. */
export const STEPS_PER_BAR = 8;
export const STEP_SEC = 60 / MUSIC_BPM / 2;
export const BAR_SEC = STEP_SEC * STEPS_PER_BAR;
/** Nível do fader da música (o fade-in sobe até aqui). */
export const MUSIC_LEVEL = 0.07;
/** Vozes agendadas da música; o resto do teto (MAX_VOICES) fica para os SFX. */
export const MUSIC_VOICES = 14;

export type ChordName = "Dm" | "Bb" | "F" | "C" | "Gm" | "G" | "Asus";

// Pad sempre acima do drone (A2/D3) e o baixo abaixo dele: os três registros
// não se esbarram em segunda nos graves (o teste mede isso).
export const CHORDS: Record<ChordName, { bass: number; pad: number[] }> = {
  Dm: { bass: 38, pad: [57, 62, 65] },
  Bb: { bass: 34, pad: [58, 62, 65] },
  F: { bass: 41, pad: [57, 60, 65] },
  C: { bass: 36, pad: [55, 60, 64] },
  Gm: { bass: 31, pad: [55, 58, 62] },
  // A cor dórica (si natural) só aparece no B: é o "amanhecer" da forja.
  G: { bass: 31, pad: [55, 59, 62] },
  // Lá sem terça: a dominante sem dó sustenido mantém o modo, sem cadência de ópera.
  Asus: { bass: 33, pad: [57, 62, 64] },
};

export const AEOLIAN = [2, 4, 5, 7, 9, 10, 0];
export const DORIAN = [2, 4, 5, 7, 9, 11, 0];
export const scaleOf = (chord: ChordName): number[] => (chord === "G" ? DORIAN : AEOLIAN);

/** Drone contínuo (A2 + D3): a brasa embaixo de tudo. */
export const DRONE = [45, 50];
/** Pico do drone no barramento (dois níveis + a respiração do LFO). */
export const DRONE_PEAK = 0.3 + 0.08;

export interface Section {
  name: "A" | "A2" | "B" | "A'";
  prog: ChordName[];
}

export const FORM: Section[] = [
  { name: "A", prog: ["Dm", "Bb", "F", "C", "Dm", "Bb", "Gm", "Asus"] },
  { name: "A2", prog: ["Dm", "Bb", "F", "C", "Dm", "Bb", "Gm", "Asus"] },
  { name: "B", prog: ["Bb", "C", "Dm", "G", "Bb", "F", "C", "Asus"] },
  // A' fecha em Dm: o loop volta ao A sem a dominante pendurada.
  { name: "A'", prog: ["Dm", "Bb", "F", "C", "Dm", "Bb", "Asus", "Dm"] },
];
export const FORM_BARS = FORM.length * 8;

/** [colcheia, nota MIDI, duração em colcheias] */
type Note = [number, number, number];

// Tema: começa no meio do compasso, sobe à 5ª e desce em degraus — frase de quem
// pensa, não de quem marcha. Cada compasso respira (há pausas em 0 ou no fim).
export const LEAD_A: Note[][] = [
  [[4, 69, 2], [6, 72, 2]],
  [[0, 74, 6], [6, 72, 2]],
  [[0, 69, 4], [4, 65, 2], [6, 67, 2]],
  [[0, 67, 6]],
  [[4, 65, 2], [6, 69, 2]],
  [[0, 74, 3], [3, 72, 1], [4, 70, 4]],
  [[0, 69, 4], [4, 67, 2], [6, 65, 2]],
  [[0, 64, 7]],
];

// Resposta do B: registro mais alto, o si natural sobre Sol e o pouso no ré.
export const LEAD_B: Note[][] = [
  [[0, 77, 4], [4, 74, 2], [6, 72, 2]],
  [[0, 76, 6], [6, 74, 2]],
  [[0, 69, 4], [4, 74, 4]],
  [[0, 71, 4], [4, 74, 2], [6, 76, 2]],
  [[0, 77, 6], [6, 76, 2]],
  [[0, 72, 4], [4, 69, 4]],
  [[0, 67, 2], [2, 69, 2], [4, 72, 4]],
  [[0, 74, 8]],
];

export type MusicLayer = "pad" | "bass" | "lead" | "bell" | "anvil";

export interface MusicEvent {
  layer: MusicLayer;
  step: number;
  len: number;
  /** 0 no anvil (ruído). */
  midi: number;
  g: number;
  /** Corte do lowpass do pad (Hz): o B abre o filtro. */
  tone?: number;
}

// Hash inteiro determinístico: a variação por ciclo é reprodutível (e testável).
const hash = (a: number, b: number): number => {
  let h = Math.imul(a + 1, 374761393) ^ Math.imul(b + 7, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};

/** O que soa no compasso `index` (0..FORM_BARS-1) da passada `cycle`. */
export function planBar(index: number, cycle: number): MusicEvent[] {
  const bar = ((index % FORM_BARS) + FORM_BARS) % FORM_BARS;
  const section = FORM[Math.floor(bar / 8)];
  const b = bar % 8;
  const { bass, pad } = CHORDS[section.prog[b]];
  const odd = cycle % 2 === 1;
  const r = hash(bar, cycle);
  const bright = section.name === "B";
  const out: MusicEvent[] = [];

  for (const midi of pad) {
    out.push({ layer: "pad", step: 0, len: 8, midi, g: bright ? 0.15 : 0.13, tone: bright ? 1250 : 760 });
  }

  // Baixo: semibreve no A (o chão parado); no B um pulso de coração, 3+1+4.
  if (bright) {
    out.push({ layer: "bass", step: 0, len: 3, midi: bass, g: 0.4 });
    out.push({ layer: "bass", step: 3, len: 1, midi: bass, g: 0.22 });
    out.push({ layer: "bass", step: 4, len: 4, midi: bass, g: 0.32 });
  } else {
    out.push({ layer: "bass", step: 0, len: 8, midi: bass, g: 0.4 });
  }

  const lead = (notes: Note[], layer: MusicLayer, shift: number, g: number) => {
    for (const [step, midi, len] of notes) out.push({ layer, step, len, midi: midi + shift, g });
  };

  if (section.name === "A") {
    // Só sinos esparsos: um a cada 2 compassos, num tempo fraco sorteado.
    if (b % 2 === 1) out.push({ layer: "bell", step: [2, 4, 6][r % 3], len: 2, midi: pad[r % pad.length] + 12, g: 0.11 });
  } else if (section.name === "A2") {
    // Par: o tema inteiro. Ímpar: o tema some nos compassos 2-3 e 6-7 e os sinos
    // respondem uma oitava acima — a melodia aparece e some.
    if (!odd || b % 4 < 2) lead(LEAD_A[b], "lead", 0, 0.2);
    else lead(LEAD_A[b], "bell", 12, 0.08);
  } else if (bright) {
    lead(LEAD_B[b], "lead", 0, 0.18);
    // Arpejo de sino nos contratempos; a passada ímpar desloca o desenho.
    const steps = odd ? [1, 5] : [2, 6];
    steps.forEach((step, i) => out.push({ layer: "bell", step, len: 2, midi: pad[(i + 1 + (r % 2)) % pad.length] + 12, g: 0.07 }));
  } else {
    // A': esvazia. Na passada ímpar o começo do tema volta como eco de sino.
    if (odd && (b === 4 || b === 5)) lead(LEAD_A[b], "bell", 12, 0.08);
    if (b === 7) out.push({ layer: "bell", step: 0, len: 4, midi: 86, g: 0.1 });
  }

  // Bigorna: a cada 4 compassos (2 no B). A abertura (ciclo 0) entra sem martelo.
  const strike = bright ? b % 2 === 0 : b % 4 === 0 && !(section.name === "A'" && b === 4);
  if (strike && !(cycle === 0 && bar === 0)) out.push({ layer: "anvil", step: 0, len: 1, midi: 0, g: bright ? 0.26 : 0.2 });

  return out;
}

const midiHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** Traduz um evento em vozes do motor; `at` = segundos a partir de agora. */
export function eventVoices(e: MusicEvent, at: number): Voice[] {
  const dur = e.len * STEP_SEC;
  const f = midiHz(e.midi);
  switch (e.layer) {
    case "pad":
      // Saw abafado com ataque lento; a cauda (d×1,3) cruza com o compasso seguinte
      // e a troca de acorde vira uma respiração, não um corte.
      return [{ f, w: "sawtooth", at, a: 1.1, d: dur * 1.3, s: 0.75, g: e.g, flt: "lowpass", fq: e.tone ?? 760, fto: (e.tone ?? 760) * 0.6, q: 0.7 }];
    case "bass":
      return [{ f, w: "triangle", at, a: 0.04, d: dur * 0.95, s: 0.7, g: e.g, flt: "lowpass", fq: 420 }];
    case "lead":
      return [{ f, w: "triangle", at, a: 0.08, d: dur, s: 0.6, g: e.g, flt: "lowpass", fq: 2400, fto: 1300 }];
    case "bell":
      return bell(f, at, e.g);
    case "anvil":
      // Martelo na bigorna, longe: baque grave, estalo abafado e um ping em ré.
      return [
        { f: 92, to: 46, at, a: 0.002, d: 0.28, g: e.g * 1.1 },
        { f: 0, flt: "lowpass", fq: 2800, fto: 240, at, a: 0.002, d: 0.18, g: e.g },
        { f: 1174.66, at, d: 0.7, g: e.g * 0.12 },
      ];
  }
}

// A tiny synthesized audio engine so the build stays self-contained (no asset files).
class SoundEngine {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private echo: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private musicGain: GainNode | null = null;
  private musicNodes: OscillatorNode[] = [];
  /** Nós do barramento da música (drone, envio de eco) desligados no stop. */
  private musicBus: AudioNode[] = [];
  /** Vozes agendadas DESTA execução da música (teto MUSIC_VOICES). */
  private musicLive = new Set<AudioScheduledSourceNode>();
  private musicTimer: number | null = null;
  private musicStep = 0;
  private musicNext = 0;
  private musicPlan: { bar: number; events: MusicEvent[] } | null = null;
  private prefs: SoundPrefs = { sfx: true, music: false };
  private musicPlaying = false;
  private kicked = false;
  private voices = 0;
  private lastPlayed: Partial<Record<SfxName, number>> = {};

  setPrefs(prefs: SoundPrefs): void {
    this.prefs = prefs;
    if (prefs.music) {
      void this.startMusic();
    } else {
      this.stopMusic();
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        // iOS routes Web Audio through the ringer switch unless the page asks for playback.
        const session = (navigator as { audioSession?: { type: string } }).audioSession;
        if (session) session.type = "playback";
        this.context = new Ctor();
      } catch {
        return null;
      }
      const context = this.context;
      // VAL-05: rearme do kick — ele só vale enquanto a saída está destravada. Se o
      // sistema interrompe o áudio (ligação, segundo plano: "interrupted" no iOS,
      // "suspended" ao voltar), `kicked` precisa voltar a false — senão o próximo
      // gesto não repete o destrave e o som fica mudo. É o caso do WebKit antigo
      // (o alvo do kick), onde `navigator.userActivation` nem existe.
      context.onstatechange = () => {
        if (context.state !== "running") this.kicked = false;
      };
      // Limiter lets the master sit near full scale without clipping stacked voices.
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.knee.value = 0;
      limiter.ratio.value = 12;
      limiter.connect(context.destination);
      this.masterGain = context.createGain();
      this.masterGain.gain.value = 0.8;
      this.masterGain.connect(limiter);
      // Poor man's room: two damped feedback delays at unrelated lengths.
      this.echo = context.createGain();
      this.echo.gain.value = 0.3;
      for (const time of [0.089, 0.137]) {
        const delay = context.createDelay();
        delay.delayTime.value = time;
        const damp = context.createBiquadFilter();
        damp.frequency.value = 2600;
        const feedback = context.createGain();
        feedback.gain.value = 0.4;
        this.echo.connect(delay);
        delay.connect(damp);
        damp.connect(feedback);
        feedback.connect(delay);
        damp.connect(this.masterGain);
      }
      this.noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    // "interrupted" (iOS call/background) needs a resume as much as "suspended".
    if (this.context.state !== "running") {
      this.context.resume().catch(() => undefined);
    }
    return this.context;
  }

  // Must run inside a gesture: WebKit only opens the output once a buffer starts there.
  unlock(): void {
    const context = this.ensureContext();
    if (!context || this.kicked) return;
    // VAL-05: pointerdown só concede ativação para mouse (HTML spec); em toque
    // ele chega antes do gesto real. Sem ativação o kick é gasto sem destravar o
    // WebKit — start() não lança em contexto suspenso, então `kicked` ficava true
    // e o retry do próximo gesto nunca acontecia. Quem faz o kick no toque é o
    // pointerup/touchend/keydown, que são os eventos de ativação.
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    try {
      const source = context.createBufferSource();
      source.buffer = context.createBuffer(1, 1, 22050);
      source.connect(context.destination);
      source.start();
      this.kicked = true;
    } catch {
      // Output stays locked; the next gesture retries.
    }
  }

  // pointerdown only counts as user activation for mice (HTML spec); touch and pen
  // activate on pointerup/touchend. Stays bound so an interrupted context revives.
  bindUnlock(): () => void {
    const unlock = () => this.unlock();
    const events = ["pointerdown", "pointerup", "touchend", "keydown"];
    for (const name of events) window.addEventListener(name, unlock, true);
    return () => {
      for (const name of events) window.removeEventListener(name, unlock, true);
    };
  }

  // `out` desvia a voz para outro barramento (a música, que tem fader e envio de
  // eco próprios: o eco compartilhado entra DEPOIS do fade, então `wet` é ignorado).
  private voice(context: AudioContext, v: Voice, out?: AudioNode): AudioScheduledSourceNode | null {
    if (!this.masterGain || !this.noiseBuffer || this.voices >= MAX_VOICES) return null;
    const t = context.currentTime + (v.at ?? 0);
    const attack = v.a ?? 0.004;
    const end = t + attack + v.d;
    let source: AudioScheduledSourceNode;
    let offset = 0;
    if (v.f) {
      const osc = context.createOscillator();
      osc.type = v.w ?? "sine";
      osc.frequency.setValueAtTime(v.f, t);
      if (v.to) osc.frequency.exponentialRampToValueAtTime(v.to, end);
      source = osc;
    } else {
      const noise = context.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.loop = true;
      offset = Math.random() * 0.5;
      source = noise;
    }
    let tail: AudioNode = source;
    if (v.flt) {
      const filter = context.createBiquadFilter();
      filter.type = v.flt;
      filter.Q.value = v.q ?? 1;
      filter.frequency.setValueAtTime(v.fq ?? 1000, t);
      if (v.fto) filter.frequency.exponentialRampToValueAtTime(v.fto, end);
      tail.connect(filter);
      tail = filter;
    }
    // ADSR: linear attack, decay toward sustain (or silence), release at 60% of a held note.
    const env = context.createGain();
    const sustain = v.s ?? 0;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(v.g, t + attack);
    env.gain.setTargetAtTime(v.g * sustain, t + attack, sustain ? 0.06 : v.d / 5);
    if (sustain) env.gain.setTargetAtTime(0, t + attack + v.d * 0.6, v.d * 0.08);
    tail.connect(env);
    env.connect(out ?? this.masterGain);
    if (!out && v.wet && this.echo) env.connect(this.echo);
    this.voices += 1;
    source.onended = () => {
      this.voices -= 1;
    };
    (source as AudioBufferSourceNode).start(t, offset);
    source.stop(end + 0.02);
    return source;
  }

  play(name: SfxName, delayS = 0): void {
    if (!this.prefs.sfx) return;
    const context = this.ensureContext();
    if (!context) return;
    // VAL-06: com o contexto suspenso (antes do primeiro gesto, "interrupted" no
    // iOS, app em segundo plano) o currentTime congela: as vozes agendadas não
    // terminam, o onended não roda, o teto de 32 enche e na retomada todas soam
    // no mesmo instante (rajada fantasma). Fora de gesto não há como ouvir;
    // dentro do gesto userActivation está ativa e o som (incluindo o primeiro
    // toque que retoma o contexto) passa.
    if (context.state !== "running" && !navigator.userActivation?.isActive) return;
    // Anti-spam: a key re-fired within 50 ms (double click, AI burst) is one sound.
    // Wall clock, not currentTime: that one freezes while the context is suspended.
    const now = performance.now();
    if (now - (this.lastPlayed[name] ?? -1e3) < 50) return;
    this.lastPlayed[name] = now;
    try {
      for (const v of PALETTE[name]()) this.voice(context, delayS ? { ...v, at: (v.at ?? 0) + delayS } : v);
    } catch {
      // A failed voice must never break the gesture that triggered it.
    }
  }

  private async startMusic(): Promise<void> {
    if (this.musicPlaying) return;
    const context = this.ensureContext();
    if (!context || !this.masterGain) return;
    this.musicPlaying = true;

    const now = context.currentTime;
    this.musicGain = context.createGain();
    // VAL-01: sem evento ancorado em `now` a rampa interpola do último evento
    // agendado (nenhum no start), então o fade-in precisa do setValueAtTime
    // explícito em 0 antes da rampa.
    this.musicGain.gain.setValueAtTime(0, now);
    this.musicGain.gain.linearRampToValueAtTime(MUSIC_LEVEL, now + 2);
    this.musicGain.connect(this.masterGain);

    // Envio de eco PÓS-fader (o fade também cala a cauda) com highpass: o baixo e
    // o drone ficam secos, senão os delays de 89/137 ms embolam o grave.
    const sendFilter = context.createBiquadFilter();
    sendFilter.type = "highpass";
    sendFilter.frequency.value = 320;
    const send = context.createGain();
    send.gain.value = 0.6;
    this.musicGain.connect(sendFilter);
    sendFilter.connect(send);
    if (this.echo) send.connect(this.echo);

    // Drone: dois triângulos (A2, D3) num lowpass escuro, com deriva lenta de
    // afinação e uma respiração de ~29 s no volume — a brasa que nunca apaga.
    const droneFilter = context.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 520;
    droneFilter.Q.value = 0.7;
    const droneGain = context.createGain();
    droneGain.gain.value = 1;
    droneFilter.connect(droneGain);
    droneGain.connect(this.musicGain);
    const breath = context.createOscillator();
    breath.frequency.value = 0.035;
    const breathDepth = context.createGain();
    breathDepth.gain.value = 0.08 / 0.3;
    breath.connect(breathDepth);
    breathDepth.connect(droneGain.gain);
    breath.start();
    this.musicNodes.push(breath);
    this.musicBus = [sendFilter, send, droneFilter, droneGain, breathDepth];
    DRONE.forEach((midi, i) => {
      const osc = context.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = midiHz(midi);
      const drift = context.createOscillator();
      drift.frequency.value = 0.07 + i * 0.03;
      const driftDepth = context.createGain();
      driftDepth.gain.value = 0.4;
      drift.connect(driftDepth);
      driftDepth.connect(osc.frequency);
      const level = context.createGain();
      level.gain.value = i === 0 ? 0.17 : 0.13;
      osc.connect(level);
      level.connect(droneFilter);
      osc.start();
      drift.start();
      this.musicNodes.push(osc, drift);
      this.musicBus.push(driftDepth, level);
    });

    // Sequenciador: começa sempre no A, um pouco à frente para o fade pegar.
    this.musicStep = 0;
    this.musicNext = now + 0.1;
    this.musicPlan = null;
    this.musicLive = new Set();
    this.scheduleMusic();
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 100);
  }

  // Lookahead canônico: a cada ~100 ms agenda (com currentTime exato) toda
  // colcheia que cai nos próximos 300 ms. Contexto suspenso congela currentTime,
  // então nada se acumula; aba em segundo plano (timer a 1 s) pula o atraso.
  private scheduleMusic(): void {
    const context = this.context;
    const out = this.musicGain;
    if (!context || !out || !this.musicPlaying) return;
    const now = context.currentTime;
    if (this.musicNext < now - 1) {
      const behind = Math.ceil((now - this.musicNext) / STEP_SEC);
      this.musicStep += behind;
      this.musicNext += behind * STEP_SEC;
    }
    while (this.musicNext < now + 0.3) {
      const barIndex = Math.floor(this.musicStep / STEPS_PER_BAR);
      if (this.musicPlan?.bar !== barIndex) {
        this.musicPlan = { bar: barIndex, events: planBar(barIndex % FORM_BARS, Math.floor(barIndex / FORM_BARS)) };
      }
      const step = this.musicStep % STEPS_PER_BAR;
      const at = Math.max(0, this.musicNext - now);
      try {
        for (const e of this.musicPlan.events) {
          if (e.step !== step) continue;
          for (const v of eventVoices(e, at)) {
            if (this.musicLive.size >= MUSIC_VOICES) break;
            const source = this.voice(context, v, out);
            if (!source) continue;
            const live = this.musicLive;
            live.add(source);
            source.addEventListener("ended", () => live.delete(source));
          }
        }
      } catch {
        // Uma voz que falha não pode derrubar o loop da trilha.
      }
      this.musicStep += 1;
      this.musicNext += STEP_SEC;
    }
  }

  private stopMusic(): void {
    if (!this.musicPlaying) return;
    this.musicPlaying = false;
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (this.context && this.musicGain) {
      // VAL-01: linearRampToValueAtTime interpola do evento ANTERIOR (o fim do
      // fade-in, t0+2s com valor MUSIC_LEVEL), não do currentTime. Sem âncora o
      // ganho saltaria do nível para ~0 num quantum (pop) e, parando durante o
      // fade-in, voltaria a subir depois do zero. cancelScheduledValues +
      // setValueAtTime(g.value) fixa a partida da rampa no valor que está
      // soando agora.
      const gain = this.musicGain.gain;
      const now = this.context.currentTime;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(0, now + 0.6);
    }
    const nodesToStop: AudioScheduledSourceNode[] = [...this.musicNodes, ...this.musicLive];
    const busToDrop = this.musicBus;
    this.musicNodes = [];
    this.musicBus = [];
    this.musicLive = new Set();
    // VAL-02: capturar o gain DESTE disparo. Se a música for religada antes do
    // timer (toggle < 700 ms), `this.musicGain` já aponta para o gain novo —
    // desconectar/anular pelo campo deixaria os osciladores novos órfãos
    // (música muda até o próximo toggle + CPU presa). O timer só para os nós
    // capturados (drone + vozes agendadas desta execução, que senão seguiriam
    // ocupando o teto de vozes mudas) e só limpa o campo se ele ainda for este gain.
    const gain = this.musicGain;
    window.setTimeout(() => {
      for (const node of nodesToStop) {
        try {
          node.stop();
        } catch {
          // Node may already be stopped.
        }
      }
      for (const node of busToDrop) node.disconnect();
      gain?.disconnect();
      if (this.musicGain === gain) this.musicGain = null;
    }, 700);
  }
}

export const sound = new SoundEngine();
