import { describe, expect, it } from "vitest";
import {
  BAR_SEC, CELLO_B, CHORDS, CHORDS_V1, CODA, DRONE, DRONE_PEAK, FORM, FORM_BARS, FORM_V1, MUSIC_BPM,
  MUSIC_LEVEL, MUSIC_VOICES, STEP_SEC, STEPS_PER_BAR, THEME, THEME_B, TRILHA_V1, eventVoices, planBar,
  planBarV1, scaleOf, scaleOfV1, type MusicEvent,
} from "./sound";

const CYCLES = [0, 1, 2, 3];
const bars = (fn: (bar: number, cycle: number) => void) => {
  for (const cycle of CYCLES) for (let bar = 0; bar < FORM_BARS; bar += 1) fn(bar, cycle);
};
const chordAt = (bar: number) => FORM[Math.floor(bar / 8)].prog[bar % 8];
const STRINGS = new Set(["bass", "cello", "viola", "violin2", "violin"]);

// Vozes deste compasso e dos dois anteriores (as caudas cruzam) com o início relativo.
const windowVoices = (bar: number, cycle: number) =>
  [-2, -1, 0].flatMap((back) =>
    planBar(bar + back, cycle + (bar + back < 0 ? -1 : 0)).flatMap((e) =>
      eventVoices(e, (back * STEPS_PER_BAR + e.step) * STEP_SEC),
    ),
  );
const alive = (v: { at?: number; a?: number; d: number }, t: number) =>
  (v.at ?? 0) <= t && t < (v.at ?? 0) + (v.a ?? 0.004) + v.d;

describe("trilha v2 — composição", () => {
  it("a v2 é a trilha ativa", () => {
    expect(TRILHA_V1).toBe(false);
    expect(DRONE).toEqual([]);
    expect(DRONE_PEAK).toBe(0);
  });

  it("andamento, nível e forma A A2 B A' de 8 compassos", () => {
    expect(MUSIC_BPM).toBeGreaterThanOrEqual(56);
    expect(MUSIC_BPM).toBeLessThanOrEqual(76);
    expect(MUSIC_LEVEL).toBeGreaterThanOrEqual(0.05);
    expect(MUSIC_LEVEL).toBeLessThanOrEqual(0.09);
    expect(FORM.map((s) => s.name)).toEqual(["A", "A2", "B", "A'"]);
    for (const s of FORM) expect(s.prog).toHaveLength(8);
    expect(FORM_BARS).toBe(32);
    // O loop fecha em F para voltar ao F do A.
    expect(FORM[3].prog[7]).toBe("F");
    expect(FORM[0].prog[0]).toBe("F");
  });

  it("os temas têm uma frase por compasso", () => {
    expect(THEME).toHaveLength(8);
    expect(THEME_B).toHaveLength(8);
    expect(CELLO_B).toHaveLength(8);
    expect(CODA).toHaveLength(4);
  });

  it("todo evento cabe no compasso", () => {
    bars((bar, cycle) => {
      for (const e of planBar(bar, cycle)) {
        expect(Number.isInteger(e.step)).toBe(true);
        expect(e.step).toBeGreaterThanOrEqual(0);
        expect(e.len).toBeGreaterThan(0);
        expect(e.step + e.len).toBeLessThanOrEqual(STEPS_PER_BAR);
      }
    });
  });

  it("toda nota está na escala (fá maior; lídio — si natural — só no Sol do B)", () => {
    bars((bar, cycle) => {
      const scale = scaleOf(chordAt(bar));
      for (const e of planBar(bar, cycle)) {
        if (e.layer === "anvil") continue;
        expect(scale, `compasso ${bar} ciclo ${cycle} ${e.layer} ${e.midi}`).toContain(e.midi % 12);
      }
    });
    for (const [name, { bass, cello, inner, sus }] of Object.entries(CHORDS)) {
      const scale = scaleOf(name as keyof typeof CHORDS);
      for (const m of [bass, cello, ...inner, ...(sus ? [sus] : [])]) expect(scale).toContain(m % 12);
    }
  });

  it("as suspensões resolvem por grau descendente (4-3, 9-8, 6-5)", () => {
    for (const { inner, sus } of Object.values(CHORDS)) {
      if (sus === undefined) continue;
      expect([1, 2]).toContain(sus - inner[1]);
    }
  });

  it("sem segunda nos graves (abaixo de G3): contrabaixo e violoncelo não se esbarram", () => {
    bars((bar, cycle) => {
      const events = planBar(bar, cycle);
      for (let step = 0; step < STEPS_PER_BAR; step += 1) {
        const low = events
          .filter((e) => e.midi && e.step <= step && step < e.step + e.len)
          .map((e) => e.midi)
          .filter((m) => m < 55);
        for (const a of low) for (const b of low) {
          const gap = Math.abs(a - b);
          expect(gap === 1 || gap === 2, `compasso ${bar}: ${a} x ${b}`).toBe(false);
        }
      }
    });
  });

  it("a melodia viaja: A no violoncelo, A2/A' no violino, B com resposta do violoncelo", () => {
    const melodic = (bar: number, cycle: number, layer: MusicEvent["layer"]) =>
      planBar(bar, cycle).filter((e) => e.layer === layer && e.g >= 0.15);
    // A (passada 1): o tema no violoncelo, uma oitava abaixo do violino.
    expect(melodic(0, 1, "cello").map((e) => e.midi)).toEqual(THEME[0].map(([, m]) => m - 12));
    expect(melodic(0, 1, "violin")).toHaveLength(0);
    // A2: o violino canta, o violoncelo segura.
    expect(melodic(8, 0, "violin").map((e) => e.midi)).toEqual(THEME[0].map(([, m]) => m));
    // B: violino agudo e o violoncelo responde onde ele segura.
    expect(melodic(19, 0, "violin").map((e) => e.midi)).toEqual(THEME_B[3].map(([, m]) => m));
    expect(planBar(19, 0).filter((e) => e.layer === "cello").map((e) => e.midi)).toEqual(CELLO_B[3]!.map(([, m]) => m));
    // A': só violino + pedal fá/dó.
    for (let bar = 24; bar < 31; bar += 1) {
      const layers = new Set(planBar(bar, 0).map((e) => e.layer));
      expect([...layers].sort()).toEqual(["bass", "cello", "violin"]);
    }
    // A abertura (ciclo 0) dá 4 compassos só de acordes antes do violoncelo cantar.
    for (let bar = 0; bar < 4; bar += 1) expect(melodic(bar, 0, "cello")).toHaveLength(0);
    // E as passadas variam (timing humano e a troca de quem canta no A2).
    const sig = (cycle: number) => JSON.stringify(Array.from({ length: FORM_BARS }, (_, b) => planBar(b, cycle)));
    expect(sig(0)).not.toBe(sig(1));
    expect(sig(1)).not.toBe(sig(3));
  });

  it("o contrabaixo caminha: há semínimas de passagem, não só semibreves", () => {
    let walking = 0;
    for (let bar = 0; bar < 24; bar += 1) {
      if (planBar(bar, 0).filter((e) => e.layer === "bass").length > 1) walking += 1;
    }
    expect(walking).toBeGreaterThanOrEqual(10);
  });

  it("timing humano: ataques fora da grade em 0-40 ms", () => {
    let off = 0;
    bars((bar, cycle) => {
      for (const e of planBar(bar, cycle)) {
        if (!STRINGS.has(e.layer)) continue;
        expect(e.nudge ?? 0).toBeGreaterThanOrEqual(0);
        expect(e.nudge ?? 0).toBeLessThanOrEqual(0.04);
        if ((e.nudge ?? 0) > 0) off += 1;
      }
    });
    expect(off).toBeGreaterThan(0);
  });

  it("cordas: dupla desafinada, vibrato, swell e cauda cruzada", () => {
    const e = planBar(8, 0).find((x) => x.layer === "violin")!;
    const [v] = eventVoices(e, 0);
    expect(v.w).toBe("sawtooth");
    expect(v.det).toBeGreaterThanOrEqual(6);
    expect(v.det).toBeLessThanOrEqual(9);
    expect(v.vib).toBeGreaterThan(0);
    expect(v.sw).toBeGreaterThan(0);
    expect(v.a).toBeGreaterThanOrEqual(0.12);
    expect(v.fq).toBeGreaterThanOrEqual(1800);
    expect(v.fq).toBeLessThanOrEqual(2600);
    // Legato: a nota soa além da própria duração.
    expect((v.a ?? 0) + v.d).toBeGreaterThan(e.len * STEP_SEC);
  });

  it("sino e bigorna são raros: bigorna 1x por forma", () => {
    bars((bar, cycle) => {
      if (bar === 0) {
        let anvils = 0;
        for (let b = 0; b < FORM_BARS; b += 1) anvils += planBar(b, cycle).filter((e) => e.layer === "anvil").length;
        expect(anvils).toBe(1);
      }
      expect(planBar(bar, cycle).filter((e) => e.layer === "bell").length).toBeLessThanOrEqual(1);
    });
  });

  it("o B é a seção mais cheia", () => {
    const count = (start: number) =>
      Array.from({ length: 8 }, (_, b) => planBar(start + b, 0).length).reduce((a, b) => a + b, 0);
    for (const other of [0, 8, 24]) expect(count(16)).toBeGreaterThan(count(other));
  });

  it("vozes vivas cabem em MUSIC_VOICES e o pico do barramento fica ≤ 0,35", () => {
    let worst = 0;
    let crowd = 0;
    for (const cycle of CYCLES) {
      for (let bar = 0; bar < FORM_BARS; bar += 1) {
        const voices = windowVoices(bar, cycle);
        for (let t = 0; t < BAR_SEC; t += STEP_SEC / 4) {
          const live = voices.filter((v) => alive(v, t));
          crowd = Math.max(crowd, live.length);
          worst = Math.max(worst, live.reduce((acc, v) => acc + v.g, DRONE_PEAK) * MUSIC_LEVEL);
        }
      }
    }
    expect(crowd).toBeLessThanOrEqual(MUSIC_VOICES);
    expect(worst).toBeLessThanOrEqual(0.35);
  });
});

describe("trilha v1 — guardada para o A/B", () => {
  it("forma intacta e toda nota no ré eólio/dórico", () => {
    expect(FORM_V1.map((s) => s.name)).toEqual(["A", "A2", "B", "A'"]);
    for (let cycle = 0; cycle < 2; cycle += 1) {
      for (let bar = 0; bar < FORM_BARS; bar += 1) {
        const scale = scaleOfV1(FORM_V1[Math.floor(bar / 8)].prog[bar % 8]);
        for (const e of planBarV1(bar, cycle)) {
          if (e.layer !== "anvil") expect(scale).toContain(e.midi % 12);
        }
      }
    }
    expect(CHORDS_V1.Dm.pad).toEqual([57, 62, 65]);
  });
});
