import { describe, expect, it } from "vitest";
import {
  BAR_SEC, CHORDS, DRONE, DRONE_PEAK, FORM, FORM_BARS, LEAD_A, LEAD_B, MUSIC_BPM, MUSIC_LEVEL,
  STEP_SEC, STEPS_PER_BAR, eventVoices, planBar, scaleOf,
} from "./sound";

const CYCLES = [0, 1, 2, 3];
const bars = (fn: (bar: number, cycle: number) => void) => {
  for (const cycle of CYCLES) for (let bar = 0; bar < FORM_BARS; bar += 1) fn(bar, cycle);
};
const chordAt = (bar: number) => FORM[Math.floor(bar / 8)].prog[bar % 8];

describe("trilha Forja Noturna — composição", () => {
  it("andamento, nível e forma A A2 B A' de 8 compassos", () => {
    expect(MUSIC_BPM).toBeGreaterThanOrEqual(60);
    expect(MUSIC_BPM).toBeLessThanOrEqual(76);
    expect(MUSIC_LEVEL).toBeGreaterThanOrEqual(0.05);
    expect(MUSIC_LEVEL).toBeLessThanOrEqual(0.09);
    expect(FORM.map((s) => s.name)).toEqual(["A", "A2", "B", "A'"]);
    for (const s of FORM) expect(s.prog).toHaveLength(8);
    expect(FORM_BARS).toBe(32);
    // O loop fecha em Dm para voltar ao Dm do A.
    expect(FORM[3].prog[7]).toBe("Dm");
    expect(FORM[0].prog[0]).toBe("Dm");
  });

  it("os temas têm uma frase por compasso", () => {
    expect(LEAD_A).toHaveLength(8);
    expect(LEAD_B).toHaveLength(8);
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

  it("toda nota está na escala do acorde (eólio; dórico só no Sol)", () => {
    bars((bar, cycle) => {
      const scale = scaleOf(chordAt(bar));
      for (const e of planBar(bar, cycle)) {
        if (e.layer === "anvil") continue;
        expect(scale, `compasso ${bar} ciclo ${cycle} ${e.layer} ${e.midi}`).toContain(e.midi % 12);
      }
    });
    for (const [name, { bass, pad }] of Object.entries(CHORDS)) {
      const scale = scaleOf(name as keyof typeof CHORDS);
      for (const m of [bass, ...pad]) expect(scale).toContain(m % 12);
    }
  });

  it("sem segunda nos graves (abaixo do C4): baixo, drone e pad não se esbarram", () => {
    bars((bar, cycle) => {
      const events = planBar(bar, cycle);
      for (let step = 0; step < STEPS_PER_BAR; step += 1) {
        const low = [
          ...DRONE,
          ...events.filter((e) => e.midi && e.step <= step && step < e.step + e.len).map((e) => e.midi),
        ].filter((m) => m < 60);
        for (const a of low) for (const b of low) {
          const gap = Math.abs(a - b);
          expect(gap === 1 || gap === 2, `compasso ${bar}: ${a} x ${b}`).toBe(false);
        }
      }
    });
  });

  it("a melodia aparece e some: nem todo compasso tem tema, e as passadas variam", () => {
    let withLead = 0;
    bars((bar, cycle) => {
      if (planBar(bar, cycle).some((e) => e.layer === "lead")) withLead += 1;
    });
    const total = FORM_BARS * CYCLES.length;
    expect(withLead).toBeGreaterThan(total * 0.25);
    expect(withLead).toBeLessThan(total * 0.75);
    // A abertura é só pad/baixo/sino.
    for (let bar = 0; bar < 8; bar += 1) expect(planBar(bar, 0).some((e) => e.layer === "lead")).toBe(false);
    const sig = (cycle: number) => JSON.stringify(Array.from({ length: FORM_BARS }, (_, b) => planBar(b, cycle)));
    expect(sig(0)).not.toBe(sig(1));
    expect(sig(1)).not.toBe(sig(3));
  });

  it("a bigorna é rara: no máximo a cada 2 compassos e nunca mais de uma por compasso", () => {
    let strikes = 0;
    bars((bar, cycle) => {
      const n = planBar(bar, cycle).filter((e) => e.layer === "anvil").length;
      expect(n).toBeLessThanOrEqual(1);
      strikes += n;
    });
    expect(strikes).toBeGreaterThan(0);
    expect(strikes).toBeLessThanOrEqual((FORM_BARS * CYCLES.length) / 2);
  });

  it("o B é a seção mais cheia", () => {
    const density = (name: string) =>
      FORM.findIndex((s) => s.name === name) * 8;
    const count = (start: number) =>
      Array.from({ length: 8 }, (_, b) => planBar(start + b, 0).length).reduce((a, b) => a + b, 0);
    for (const other of ["A", "A2", "A'"]) expect(count(density("B"))).toBeGreaterThan(count(density(other)));
  });

  it("o pico do barramento da música fica ≤ 0,35 em qualquer instante", () => {
    let worst = 0;
    for (const cycle of CYCLES) {
      for (let bar = 0; bar < FORM_BARS; bar += 1) {
        // Vozes deste compasso e dos dois anteriores (as caudas do pad cruzam).
        const voices = [-2, -1, 0].flatMap((back) =>
          planBar(bar + back, cycle + (bar + back < 0 ? -1 : 0)).flatMap((e) =>
            eventVoices(e, (back * STEPS_PER_BAR + e.step) * STEP_SEC),
          ),
        );
        for (let t = 0; t < BAR_SEC; t += STEP_SEC / 4) {
          const sum = voices
            .filter((v) => (v.at ?? 0) <= t && t < (v.at ?? 0) + (v.a ?? 0.004) + v.d)
            .reduce((acc, v) => acc + v.g, DRONE_PEAK);
          worst = Math.max(worst, sum * MUSIC_LEVEL);
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(0.35);
  });
});
