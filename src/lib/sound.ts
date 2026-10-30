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
  // Corda friccionada (só a trilha; os SFX não usam):
  /** Segundo oscilador a ±det cents do primeiro (largura de naipe). */
  det?: number;
  /** Vibrato (cents) que cresce de 0 até aqui nos 0,6 s depois do ataque. */
  vib?: number;
  /** Swell: a nota entra a (1-sw) do pico, cresce e cai — substitui o ADSR. */
  sw?: number;
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
// Trilha v2 "Luz da Forja": fá maior, 62 BPM, naipe de cordas (contrabaixo,
// violoncelo, viola, violino II, violino I) na forma A A2 B A' de 8 compassos
// (32 compassos ≈ 2 min 4 s). A melodia viaja: nasce no violoncelo (A), passa ao
// violino (A2), sobe com resposta do violoncelo (B) e fica só com o violino sobre
// o pedal (A'). A composição é DADO puro — `planBar` diz o que soa em cada
// compasso e `eventVoices` traduz um evento em vozes do motor —, então a teoria
// (escala, compassos, graves, vozes vivas) é verificável sem AudioContext.
// ---------------------------------------------------------------------------

/** A/B no ouvido: `true` restaura a v1 "Forja Noturna" (ré eólio, pad + drone). */
export const TRILHA_V1: boolean = false;

export const MUSIC_BPM = TRILHA_V1 ? 66 : 62;
/** Colcheias num 4/4. */
export const STEPS_PER_BAR = 8;
export const STEP_SEC = 60 / MUSIC_BPM / 2;
export const BAR_SEC = STEP_SEC * STEPS_PER_BAR;
/** Nível do fader da música (o fade-in sobe até aqui). */
export const MUSIC_LEVEL = 0.07;
/** Vozes agendadas da música; o resto do teto (MAX_VOICES) fica para os SFX.
 * As cordas são notas longas com cauda cruzada: a v2 precisa de 16. */
export const MUSIC_VOICES = TRILHA_V1 ? 14 : 16;

export type ChordName = "F" | "Am7" | "Bbmaj7" | "Dm7" | "Bb" | "Gm7" | "Csus" | "C" | "Dm" | "G" | "F/A";

export interface Chord {
  bass: number;
  /** Nota de tenor do violoncelo quando ele não canta. */
  cello: number;
  /** [viola, violino II]. */
  inner: [number, number];
  /** Suspensão do violino II: segura esta nota e cai em `inner[1]` na 2ª metade. */
  sus?: number;
}

// Violoncelo nunca abaixo de F3 (53) fora do pedal: o grave é do contrabaixo, sem lama.
export const CHORDS: Record<ChordName, Chord> = {
  F: { bass: 41, cello: 57, inner: [60, 65], sus: 67 }, // 9-8
  Am7: { bass: 33, cello: 55, inner: [60, 64], sus: 65 }, // 6-5
  Bbmaj7: { bass: 34, cello: 53, inner: [57, 62], sus: 64 }, // #11 -> 3
  Dm7: { bass: 38, cello: 57, inner: [60, 65] },
  Bb: { bass: 34, cello: 53, inner: [60, 62] }, // add9: o cacho dó/ré
  Gm7: { bass: 31, cello: 53, inner: [58, 62] },
  Csus: { bass: 36, cello: 55, inner: [58, 64], sus: 65 }, // 4-3 com a 7ª embaixo
  C: { bass: 36, cello: 55, inner: [60, 64] },
  Dm: { bass: 38, cello: 57, inner: [62, 65], sus: 67 }, // 4-3
  // O "amanhecer": Sol MAIOR (si natural, o lídio de fá) só no B.
  G: { bass: 31, cello: 55, inner: [59, 62], sus: 64 }, // 6-5
  "F/A": { bass: 33, cello: 53, inner: [60, 65] },
};

export const IONIAN = [5, 7, 9, 10, 0, 2, 4];
export const LYDIAN = [5, 7, 9, 11, 0, 2, 4];
export const scaleOf = (chord: ChordName): number[] => (chord === "G" ? LYDIAN : IONIAN);

/** Drone contínuo do motor: só a v1 (na v2 o "drone" do A' é o pedal das cordas). */
export const DRONE: number[] = TRILHA_V1 ? [45, 50] : [];
/** Pico do drone no barramento (dois níveis + a respiração do LFO). */
export const DRONE_PEAK = TRILHA_V1 ? 0.3 + 0.08 : 0;

export interface Section {
  name: "A" | "A2" | "B" | "A'";
  prog: ChordName[];
}

export const FORM: Section[] = [
  { name: "A", prog: ["F", "Am7", "Bbmaj7", "F", "Dm7", "Bb", "Gm7", "Csus"] },
  { name: "A2", prog: ["F", "Am7", "Bbmaj7", "F", "Dm7", "Bb", "Gm7", "Csus"] },
  { name: "B", prog: ["Bb", "C", "Dm", "G", "Bbmaj7", "F/A", "Gm7", "Csus"] },
  // A' sobre o pedal de fá, fechando em F: o loop volta ao F do A.
  { name: "A'", prog: ["F", "Am7", "Bbmaj7", "F", "Dm7", "Bb", "Csus", "F"] },
];
export const FORM_BARS = FORM.length * 8;

/** [colcheia, nota MIDI, duração em colcheias] */
type Note = [number, number, number];

// Tema (altura do violino; o violoncelo canta uma oitava abaixo): anacruse,
// sobe à terça, desce em suspiros. Cada compasso respira.
export const THEME: Note[][] = [
  [[4, 72, 2], [6, 74, 2]],
  [[0, 76, 5], [5, 74, 1], [6, 72, 2]],
  [[0, 74, 4], [4, 69, 4]],
  [[0, 72, 6]],
  [[2, 69, 2], [4, 72, 2], [6, 77, 2]],
  [[0, 76, 4], [4, 74, 2], [6, 72, 2]],
  [[0, 74, 3], [3, 72, 1], [4, 70, 4]],
  [[0, 69, 4], [4, 67, 3]],
];

// B: o violino uma oitava de luz acima (o si natural no Sol), terminando no mi
// que pede o fá do A'.
export const THEME_B: Note[][] = [
  [[0, 77, 4], [4, 81, 4]],
  [[0, 79, 6], [6, 77, 2]],
  [[0, 76, 2], [2, 77, 2], [4, 81, 4]],
  [[0, 83, 6], [6, 81, 2]],
  [[0, 81, 4], [4, 77, 4]],
  [[0, 79, 2], [2, 77, 2], [4, 76, 4]],
  [[0, 74, 4], [4, 77, 4]],
  [[0, 76, 8]],
];

// Resposta do violoncelo no B: só onde o violino segura nota longa.
export const CELLO_B: (Note[] | null)[] = [
  null,
  [[2, 60, 2], [4, 64, 4]],
  null,
  [[2, 59, 2], [4, 62, 4]],
  null,
  null,
  null,
  [[0, 60, 2], [2, 62, 2], [4, 64, 4]],
];

// Coda do A': depois dos 4 primeiros compassos do tema, um fecho que pousa na terça.
export const CODA: Note[][] = [
  [[2, 72, 6]],
  [[0, 74, 4], [4, 72, 4]],
  [[0, 70, 4], [4, 69, 4]],
  [[0, 69, 8]],
];

// Contrabaixo: raiz e semínimas de passagem ligando os acordes (sempre na escala).
const WALK_A: Note[][] = [
  [[0, 41, 6], [6, 36, 2]],
  [[0, 33, 8]],
  [[0, 34, 6], [6, 36, 2]],
  [[0, 41, 6], [6, 40, 2]],
  [[0, 38, 8]],
  [[0, 34, 6], [6, 33, 2]],
  [[0, 31, 4], [4, 33, 2], [6, 34, 2]],
  [[0, 36, 6], [6, 40, 2]],
];
const WALK_B: Note[][] = [
  [[0, 34, 4], [4, 33, 2], [6, 34, 2]],
  [[0, 36, 6], [6, 40, 2]],
  [[0, 38, 4], [4, 36, 2], [6, 33, 2]],
  [[0, 31, 6], [6, 33, 2]],
  [[0, 34, 8]],
  [[0, 33, 8]],
  [[0, 31, 4], [4, 33, 2], [6, 34, 2]],
  [[0, 36, 6], [6, 40, 2]],
];

export type MusicLayer =
  | "bass" | "cello" | "viola" | "violin2" | "violin" | "bell" | "anvil"
  // só a v1
  | "pad" | "lead";

export interface MusicEvent {
  layer: MusicLayer;
  step: number;
  len: number;
  /** 0 no anvil (ruído). */
  midi: number;
  g: number;
  /** Corte do lowpass (Hz). */
  tone?: number;
  /** Atraso humano (s): o ataque sai um pouco fora da grade. */
  nudge?: number;
}

// Hash inteiro determinístico: a variação por ciclo é reprodutível (e testável).
const hash = (a: number, b: number): number => {
  let h = Math.imul(a + 1, 374761393) ^ Math.imul(b + 7, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};

/** O que soa no compasso `index` (0..FORM_BARS-1) da passada `cycle`. */
export function planBar(index: number, cycle: number): MusicEvent[] {
  return TRILHA_V1 ? planBarV1(index, cycle) : planBarV2(index, cycle);
}

export function planBarV2(index: number, cycle: number): MusicEvent[] {
  const bar = ((index % FORM_BARS) + FORM_BARS) % FORM_BARS;
  const section = FORM[Math.floor(bar / 8)];
  const b = bar % 8;
  const chord = CHORDS[section.prog[b]];
  const odd = cycle % 2 === 1;
  const out: MusicEvent[] = [];
  const add = (layer: MusicLayer, notes: Note[], g: number, shift = 0, tone?: number) => {
    // 0-28 ms (quem canta até 40): ninguém do naipe ataca exatamente junto.
    const spread = layer === "violin" || layer === "cello" ? 41 : 29;
    for (const [step, midi, len] of notes) {
      const nudge = (hash(bar * 16 + step, cycle * 8 + out.length) % spread) / 1000;
      out.push({ layer, step, len, midi: midi + shift, g, tone, nudge });
    }
  };
  const inner = (shift: number, g: number, viola: boolean) => {
    if (viola) add("viola", [[0, chord.inner[0] + shift, 8]], g);
    const top = chord.inner[1] + shift;
    add("violin2", chord.sus ? [[0, chord.sus + shift, 4], [4, top, 4]] : [[0, top, 8]], g);
  };
  const celloHold = (g = 0.13) => add("cello", [[0, chord.cello, 8]], g, 0, 1100);
  const celloSing = (notes: Note[]) => add("cello", notes, 0.21, -12, 1500);
  const violin = (notes: Note[], g = 0.2) => add("violin", notes, g, 0, 2400);

  if (section.name === "A") {
    add("bass", WALK_A[b], 0.3);
    // O violoncelo canta; em cima só um halo do violino II (sem viola: o tenor é dele).
    // A primeira passada abre com quatro compassos só de acordes.
    if (cycle === 0 && b < 4) celloHold();
    else celloSing(THEME[b]);
    inner(12, 0.06, false);
  } else if (section.name === "A2") {
    add("bass", WALK_A[b], 0.3);
    // Passada ímpar: a segunda metade da frase volta ao violoncelo.
    if (odd && b >= 4) {
      celloSing(THEME[b]);
      inner(12, 0.06, false);
    } else {
      violin(THEME[b]);
      celloHold();
      inner(0, 0.1, true);
    }
  } else if (section.name === "B") {
    add("bass", WALK_B[b], 0.32);
    violin(THEME_B[b], 0.19);
    const answer = CELLO_B[b];
    if (answer) add("cello", answer, 0.17, 0, 1500);
    else celloHold(0.14);
    inner(0, 0.11, true);
    if (b === 3) out.push({ layer: "bell", step: 2, len: 2, midi: 83, g: 0.05 });
    // A bigorna da v1 sobrevive como UM golpe distante por forma: a entrada do B.
    if (b === 0) out.push({ layer: "anvil", step: 0, len: 1, midi: 0, g: 0.1 });
  } else {
    // A': só o violino e o "drone" — pedal fá/dó do contrabaixo e do violoncelo.
    add("bass", [[0, 41, 8]], 0.24);
    add("cello", [[0, 48, 8]], 0.11, 0, 900);
    violin(b < 4 ? THEME[b] : CODA[b - 4], 0.18);
    if (b === 7) {
      inner(0, 0.07, true);
      out.push({ layer: "bell", step: 4, len: 2, midi: 81, g: 0.05 });
    }
  }
  return out;
}

const midiHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

interface Bow {
  /** Ataque (s): o arco "pega" a corda. */
  a: number;
  /** Swell (fração do pico). */
  sw: number;
  /** Vibrato (cents) que cresce depois do ataque. */
  vib: number;
  /** Desafinação ± (cents) da dupla de serras: largura de naipe. */
  det: number;
  fq: number;
}

const BOWS: Record<"bass" | "cello" | "viola" | "violin2" | "violin", Bow> = {
  bass: { a: 0.12, sw: 0.15, vib: 3, det: 4, fq: 520 },
  cello: { a: 0.22, sw: 0.3, vib: 6, det: 6, fq: 1300 },
  viola: { a: 0.3, sw: 0.25, vib: 4, det: 8, fq: 1600 },
  violin2: { a: 0.28, sw: 0.25, vib: 5, det: 8, fq: 1800 },
  violin: { a: 0.16, sw: 0.22, vib: 8, det: 7, fq: 2400 },
};
/** Cauda cruzada (s): a nota seguinte entra antes desta acabar — legato. */
export const LEGATO = 0.12;

/** Traduz um evento em vozes do motor; `at` = segundos a partir de agora. */
export function eventVoices(e: MusicEvent, at: number): Voice[] {
  const dur = e.len * STEP_SEC;
  const f = midiHz(e.midi);
  at += e.nudge ?? 0;
  if (TRILHA_V1 && e.layer === "bass") return [{ f, w: "triangle", at, a: 0.04, d: dur * 0.95, s: 0.7, g: e.g, flt: "lowpass", fq: 420 }];
  switch (e.layer) {
    case "bass":
    case "cello":
    case "viola":
    case "violin2":
    case "violin": {
      const bow = BOWS[e.layer];
      return [{
        f, w: "sawtooth", at, a: bow.a, d: Math.max(0.2, dur - bow.a + LEGATO), g: e.g,
        flt: "lowpass", fq: e.tone ?? bow.fq, q: 0.6, sw: bow.sw, vib: bow.vib, det: bow.det,
      }];
    }
    case "pad":
      // Saw abafado com ataque lento; a cauda (d×1,3) cruza com o compasso seguinte
      // e a troca de acorde vira uma respiração, não um corte.
      return [{ f, w: "sawtooth", at, a: 1.1, d: dur * 1.3, s: 0.75, g: e.g, flt: "lowpass", fq: e.tone ?? 760, fto: (e.tone ?? 760) * 0.6, q: 0.7 }];
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

// ---------------------------------------------------------------------------
// v1 "Forja Noturna" (ré eólio, 66 BPM, pad + drone + sinos + bigorna), guardada
// intacta para o A/B com `TRILHA_V1`.
// ---------------------------------------------------------------------------

export type ChordNameV1 = "Dm" | "Bb" | "F" | "C" | "Gm" | "G" | "Asus";

export const CHORDS_V1: Record<ChordNameV1, { bass: number; pad: number[] }> = {
  Dm: { bass: 38, pad: [57, 62, 65] },
  Bb: { bass: 34, pad: [58, 62, 65] },
  F: { bass: 41, pad: [57, 60, 65] },
  C: { bass: 36, pad: [55, 60, 64] },
  Gm: { bass: 31, pad: [55, 58, 62] },
  G: { bass: 31, pad: [55, 59, 62] },
  Asus: { bass: 33, pad: [57, 62, 64] },
};
export const AEOLIAN = [2, 4, 5, 7, 9, 10, 0];
export const DORIAN = [2, 4, 5, 7, 9, 11, 0];
export const scaleOfV1 = (chord: ChordNameV1): number[] => (chord === "G" ? DORIAN : AEOLIAN);

export const FORM_V1: { name: Section["name"]; prog: ChordNameV1[] }[] = [
  { name: "A", prog: ["Dm", "Bb", "F", "C", "Dm", "Bb", "Gm", "Asus"] },
  { name: "A2", prog: ["Dm", "Bb", "F", "C", "Dm", "Bb", "Gm", "Asus"] },
  { name: "B", prog: ["Bb", "C", "Dm", "G", "Bb", "F", "C", "Asus"] },
  { name: "A'", prog: ["Dm", "Bb", "F", "C", "Dm", "Bb", "Asus", "Dm"] },
];

const LEAD_A_V1: Note[][] = [
  [[4, 69, 2], [6, 72, 2]],
  [[0, 74, 6], [6, 72, 2]],
  [[0, 69, 4], [4, 65, 2], [6, 67, 2]],
  [[0, 67, 6]],
  [[4, 65, 2], [6, 69, 2]],
  [[0, 74, 3], [3, 72, 1], [4, 70, 4]],
  [[0, 69, 4], [4, 67, 2], [6, 65, 2]],
  [[0, 64, 7]],
];
const LEAD_B_V1: Note[][] = [
  [[0, 77, 4], [4, 74, 2], [6, 72, 2]],
  [[0, 76, 6], [6, 74, 2]],
  [[0, 69, 4], [4, 74, 4]],
  [[0, 71, 4], [4, 74, 2], [6, 76, 2]],
  [[0, 77, 6], [6, 76, 2]],
  [[0, 72, 4], [4, 69, 4]],
  [[0, 67, 2], [2, 69, 2], [4, 72, 4]],
  [[0, 74, 8]],
];

export function planBarV1(index: number, cycle: number): MusicEvent[] {
  const bar = ((index % FORM_BARS) + FORM_BARS) % FORM_BARS;
  const section = FORM_V1[Math.floor(bar / 8)];
  const b = bar % 8;
  const { bass, pad } = CHORDS_V1[section.prog[b]];
  const odd = cycle % 2 === 1;
  const r = hash(bar, cycle);
  const bright = section.name === "B";
  const out: MusicEvent[] = [];

  for (const midi of pad) {
    out.push({ layer: "pad", step: 0, len: 8, midi, g: bright ? 0.15 : 0.13, tone: bright ? 1250 : 760 });
  }
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
    if (b % 2 === 1) out.push({ layer: "bell", step: [2, 4, 6][r % 3], len: 2, midi: pad[r % pad.length] + 12, g: 0.11 });
  } else if (section.name === "A2") {
    if (!odd || b % 4 < 2) lead(LEAD_A_V1[b], "lead", 0, 0.2);
    else lead(LEAD_A_V1[b], "bell", 12, 0.08);
  } else if (bright) {
    lead(LEAD_B_V1[b], "lead", 0, 0.18);
    const steps = odd ? [1, 5] : [2, 6];
    steps.forEach((step, i) => out.push({ layer: "bell", step, len: 2, midi: pad[(i + 1 + (r % 2)) % pad.length] + 12, g: 0.07 }));
  } else {
    if (odd && (b === 4 || b === 5)) lead(LEAD_A_V1[b], "bell", 12, 0.08);
    if (b === 7) out.push({ layer: "bell", step: 0, len: 4, midi: 86, g: 0.1 });
  }
  const strike = bright ? b % 2 === 0 : b % 4 === 0 && !(section.name === "A'" && b === 4);
  if (strike && !(cycle === 0 && bar === 0)) out.push({ layer: "anvil", step: 0, len: 1, midi: 0, g: bright ? 0.26 : 0.2 });
  return out;
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
    /** Osciladores auxiliares (dupla desafinada, LFO) com o mesmo start/stop. */
    const extra: OscillatorNode[] = [];
    let mix: AudioNode | null = null;
    if (v.f) {
      const osc = context.createOscillator();
      osc.type = v.w ?? "sine";
      osc.frequency.setValueAtTime(v.f, t);
      if (v.to) osc.frequency.exponentialRampToValueAtTime(v.to, end);
      source = osc;
      const oscs = [osc];
      if (v.det) {
        // Duas serras em ±det cents batem devagar: soa a naipe, não a um oscilador.
        const twin = context.createOscillator();
        twin.type = osc.type;
        twin.frequency.setValueAtTime(v.f, t);
        osc.detune.setValueAtTime(-v.det, t);
        twin.detune.setValueAtTime(v.det, t);
        const sum = context.createGain();
        sum.gain.value = 0.6;
        osc.connect(sum);
        twin.connect(sum);
        mix = sum;
        oscs.push(twin);
        extra.push(twin);
      }
      if (v.vib) {
        // Vibrato atrasado: o arco pega a corda reto e a mão esquerda entra depois.
        const lfo = context.createOscillator();
        lfo.frequency.value = 5 + Math.random() * 0.9;
        const depth = context.createGain();
        depth.gain.setValueAtTime(0, t);
        depth.gain.setValueAtTime(0, t + attack * 0.6);
        depth.gain.linearRampToValueAtTime(v.vib, t + attack + 0.6);
        lfo.connect(depth);
        for (const o of oscs) depth.connect(o.detune);
        extra.push(lfo);
      }
    } else {
      const noise = context.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.loop = true;
      offset = Math.random() * 0.5;
      source = noise;
    }
    let tail: AudioNode = mix ?? source;
    // Swell: a nota respira (entra a 1-sw do pico, cresce até ~40%, recua e afina a 0
    // no fim), e o filtro acompanha de leve — corda mais tocada é corda mais clara.
    const sw = v.sw;
    const crest = t + attack + v.d * 0.4;
    const ebb = t + attack + v.d * 0.85;
    if (v.flt) {
      const filter = context.createBiquadFilter();
      filter.type = v.flt;
      filter.Q.value = v.q ?? 1;
      filter.frequency.setValueAtTime(v.fq ?? 1000, t);
      if (sw !== undefined) {
        filter.frequency.linearRampToValueAtTime((v.fq ?? 1000) * (1 + sw), crest);
        filter.frequency.linearRampToValueAtTime(v.fq ?? 1000, ebb);
      } else if (v.fto) filter.frequency.exponentialRampToValueAtTime(v.fto, end);
      tail.connect(filter);
      tail = filter;
    }
    const env = context.createGain();
    env.gain.setValueAtTime(0, t);
    if (sw !== undefined) {
      env.gain.linearRampToValueAtTime(v.g * (1 - sw), t + attack);
      env.gain.linearRampToValueAtTime(v.g, crest);
      env.gain.linearRampToValueAtTime(v.g * (1 - sw) * 0.9, ebb);
      env.gain.linearRampToValueAtTime(0, end);
    } else {
      // ADSR: linear attack, decay toward sustain (or silence), release at 60% of a held note.
      const sustain = v.s ?? 0;
      env.gain.linearRampToValueAtTime(v.g, t + attack);
      env.gain.setTargetAtTime(v.g * sustain, t + attack, sustain ? 0.06 : v.d / 5);
      if (sustain) env.gain.setTargetAtTime(0, t + attack + v.d * 0.6, v.d * 0.08);
    }
    tail.connect(env);
    env.connect(out ?? this.masterGain);
    if (!out && v.wet && this.echo) env.connect(this.echo);
    this.voices += 1;
    source.onended = () => {
      this.voices -= 1;
    };
    (source as AudioBufferSourceNode).start(t, offset);
    source.stop(end + 0.02);
    for (const o of extra) {
      o.start(t);
      o.stop(end + 0.02);
    }
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
