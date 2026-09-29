export type SfxName =
  | "click"
  | "select"
  | "play"
  | "reap"
  | "fight"
  | "forge"
  | "house"
  | "win"
  | "lose"
  | "error"
  | "endTurn";

export interface SoundPrefs {
  sfx: boolean;
  music: boolean;
}

// A tiny synthesized audio engine so the build stays self-contained (no asset files).
class SoundEngine {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicNodes: OscillatorNode[] = [];
  private prefs: SoundPrefs = { sfx: true, music: false };
  private musicPlaying = false;
  private kicked = false;

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
      // Limiter lets the master sit near full scale without clipping stacked voices.
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.ratio.value = 12;
      limiter.connect(this.context.destination);
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = 1;
      this.masterGain.connect(limiter);
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

  private tone(
    context: AudioContext,
    options: {
      freq: number;
      endFreq?: number;
      type?: OscillatorType;
      duration: number;
      gain?: number;
      delay?: number;
    },
  ): void {
    if (!this.masterGain) return;
    const now = context.currentTime + (options.delay ?? 0);
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = options.type ?? "sine";
    osc.frequency.setValueAtTime(options.freq, now);
    if (options.endFreq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, options.endFreq), now + options.duration);
    }
    const peak = options.gain ?? 0.22;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + options.duration);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + options.duration + 0.05);
  }

  private noise(context: AudioContext, duration: number, gainValue = 0.14, delay = 0): void {
    if (!this.masterGain) return;
    const now = context.currentTime + delay;
    const bufferSize = Math.floor(context.sampleRate * duration);
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 900;
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  play(name: SfxName): void {
    if (!this.prefs.sfx) return;
    const context = this.ensureContext();
    if (!context) return;

    switch (name) {
      case "click":
        this.tone(context, { freq: 320, type: "triangle", duration: 0.06, gain: 0.12 });
        break;
      case "select":
        this.tone(context, { freq: 520, endFreq: 720, type: "sine", duration: 0.09, gain: 0.13 });
        break;
      case "house":
        this.tone(context, { freq: 300, endFreq: 480, type: "sawtooth", duration: 0.14, gain: 0.12 });
        this.tone(context, { freq: 600, type: "sine", duration: 0.12, gain: 0.08, delay: 0.04 });
        break;
      case "play":
        this.tone(context, { freq: 380, endFreq: 560, type: "triangle", duration: 0.16, gain: 0.16 });
        this.noise(context, 0.12, 0.08, 0.02);
        break;
      case "reap":
        this.tone(context, { freq: 660, endFreq: 990, type: "sine", duration: 0.2, gain: 0.15 });
        this.tone(context, { freq: 880, endFreq: 1320, type: "sine", duration: 0.22, gain: 0.09, delay: 0.05 });
        break;
      case "fight":
        this.noise(context, 0.18, 0.2);
        this.tone(context, { freq: 180, endFreq: 90, type: "sawtooth", duration: 0.22, gain: 0.2 });
        break;
      case "forge":
        this.tone(context, { freq: 440, endFreq: 880, type: "sine", duration: 0.28, gain: 0.18 });
        this.tone(context, { freq: 660, endFreq: 1320, type: "triangle", duration: 0.3, gain: 0.12, delay: 0.08 });
        this.tone(context, { freq: 1320, type: "sine", duration: 0.4, gain: 0.08, delay: 0.16 });
        break;
      case "endTurn":
        this.tone(context, { freq: 400, endFreq: 260, type: "triangle", duration: 0.16, gain: 0.13 });
        break;
      case "win":
        [523, 659, 784, 1047].forEach((freq, index) => {
          this.tone(context, { freq, type: "triangle", duration: 0.38, gain: 0.16, delay: index * 0.12 });
        });
        break;
      case "lose":
        [392, 330, 262, 196].forEach((freq, index) => {
          this.tone(context, { freq, type: "sawtooth", duration: 0.34, gain: 0.14, delay: index * 0.14 });
        });
        break;
      case "error":
        this.tone(context, { freq: 200, endFreq: 140, type: "square", duration: 0.16, gain: 0.13 });
        break;
    }
  }

  private async startMusic(): Promise<void> {
    if (this.musicPlaying) return;
    const context = this.ensureContext();
    if (!context || !this.masterGain) return;
    this.musicPlaying = true;

    this.musicGain = context.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.gain.linearRampToValueAtTime(0.05, context.currentTime + 2);
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
      this.musicGain.gain.linearRampToValueAtTime(0, this.context.currentTime + 0.6);
    }
    const nodesToStop = this.musicNodes;
    this.musicNodes = [];
    window.setTimeout(() => {
      for (const node of nodesToStop) {
        try {
          node.stop();
        } catch {
          // Node may already be stopped.
        }
      }
      if (this.musicGain) {
        this.musicGain.disconnect();
        this.musicGain = null;
      }
    }, 700);
  }
}

export const sound = new SoundEngine();
