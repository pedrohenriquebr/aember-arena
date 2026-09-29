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
interface Voice {
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
  // VAL-04: o pouso separado do whoosh — com o voo da ANIM onda 1 o FxLayer
  // dispara este cue no INÍCIO do slam; sem animação ele toca 150 ms depois do
  // `play` (sound.play("land", 0.15)), reproduzindo o timbre antigo.
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

// A tiny synthesized audio engine so the build stays self-contained (no asset files).
class SoundEngine {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private echo: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private musicGain: GainNode | null = null;
  private musicNodes: OscillatorNode[] = [];
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

  private voice(context: AudioContext, v: Voice): void {
    if (!this.masterGain || !this.noiseBuffer || this.voices >= MAX_VOICES) return;
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
    env.connect(this.masterGain);
    if (v.wet && this.echo) env.connect(this.echo);
    this.voices += 1;
    source.onended = () => {
      this.voices -= 1;
    };
    (source as AudioBufferSourceNode).start(t, offset);
    source.stop(end + 0.02);
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
    this.musicGain.gain.linearRampToValueAtTime(0.05, now + 2);
    this.musicGain.connect(this.masterGain);

    const frequencies = [65.41, 98, 130.81];
    for (const freq of frequencies) {
      const osc = context.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const detune = context.createOscillator();
      detune.type = "sine";
      detune.frequency.value = 0.08;
      const detuneGain = context.createGain();
      detuneGain.gain.value = 2.5;
      detune.connect(detuneGain);
      detuneGain.connect(osc.frequency);
      osc.connect(this.musicGain);
      osc.start();
      detune.start();
      this.musicNodes.push(osc, detune);
    }
  }

  private stopMusic(): void {
    if (!this.musicPlaying) return;
    this.musicPlaying = false;
    if (this.context && this.musicGain) {
      // VAL-01: linearRampToValueAtTime interpola do evento ANTERIOR (o fim do
      // fade-in, t0+2s com valor 0,05), não do currentTime. Sem âncora o ganho
      // saltaria de 0,05 para ~0 num quantum (pop) e, parando durante o
      // fade-in, voltaria a subir depois do zero. cancelScheduledValues +
      // setValueAtTime(g.value) fixa a partida da rampa no valor que está
      // soando agora.
      const gain = this.musicGain.gain;
      const now = this.context.currentTime;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(0, now + 0.6);
    }
    const nodesToStop = this.musicNodes;
    this.musicNodes = [];
    // VAL-02: capturar o gain DESTE disparo. Se a música for religada antes do
    // timer (toggle < 700 ms), `this.musicGain` já aponta para o gain novo —
    // desconectar/anular pelo campo deixaria os osciladores novos órfãos
    // (música muda até o próximo toggle + CPU presa). O timer só para os nós
    // capturados e só limpa o campo se ele ainda for este gain.
    const gain = this.musicGain;
    window.setTimeout(() => {
      for (const node of nodesToStop) {
        try {
          node.stop();
        } catch {
          // Node may already be stopped.
        }
      }
      gain?.disconnect();
      if (this.musicGain === gain) this.musicGain = null;
    }, 700);
  }
}

export const sound = new SoundEngine();
