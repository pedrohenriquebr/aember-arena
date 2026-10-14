// SPDX-License-Identifier: AGPL-3.0-only
// QA-01 (sameTarget2, campo opcional): `sameTarget2` (QA-01, Energy Vampirism: "a creature … a creature") e o seed dos
// parentes do capture-all (Corpulent Collector, Envy, ANT1-10NY, Gatekeeper) via vendoredOverrides().
import { afterEach, describe, expect, it } from "vitest";
import { type Ability, DSL_VERSION, normaliseAbilityOverride, setAbilityOverrides } from "./abilities";
import { textHash } from "./cardText";
import { applyMove, canResolve, endTurn, getLegalMoves, pendingPrompt, type CardInstance, type GameMove } from "./game";
import { byTitle, card, setupTest } from "./testkit";
import { vendoredOverrides } from "./vendored";

afterEach(() => setAbilityOverrides(new Map()));

const A = "";
const D = "";
const creature = (title: string, power = 5, extra: Partial<CardInstance["face"]> = {}) => card(title, { type: "Creature", house: "Dis", power, text: "", ...extra });
const seeded = () => setAbilityOverrides(vendoredOverrides());
const play = (state: ReturnType<typeof setupTest>, c: CardInstance) => applyMove(state, 0, { type: "play", instanceId: c.instanceId });

describe("sameTarget2 — validação", () => {
  const row = (ability: object) => ({ cardId: "c", dsl: [ability], textHash: "h", source: "manual" as const, v: DSL_VERSION });
  const base = { on: ["play"], target: { type: "Creature" }, acts: [{ k: "capture", n: 1, s: "target" }] };
  it("exige target2 e o literal true", () => {
    expect(DSL_VERSION).toBeGreaterThanOrEqual(17);
    expect(normaliseAbilityOverride(row({ ...base, target2: { type: "Creature" }, sameTarget2: true }))).not.toBeNull();
    expect(normaliseAbilityOverride(row({ ...base, sameTarget2: true }))).toBeNull();
    expect(normaliseAbilityOverride(row({ ...base, target2: { type: "Creature" }, sameTarget2: false }))).toBeNull();
  });
});

describe("QA-01 Energy Vampirism: o jogador escolhe os DOIS alvos", () => {
  const EV = `Play: A creature captures 1${A} from its own side. For each ${A} on that creature, deal 1${D} to a creature.\n`;
  const ids = ["658893af-54cc-44af-a200-0e93a4cde3ab", "db02dbc6-216c-45a3-b66d-04cd9461475a"];
  const setup = (id: string) => {
    seeded();
    const ev = card("Energy Vampirism", { id, type: "Action", house: "Dis", text: EV });
    const mine = creature("Mine", 5);
    const foe = creature("Foe", 5);
    const other = creature("Other", 5);
    const state = setupTest({ hand: [ev], inPlay: [mine, other], amber: 3 }, { inPlay: [foe], amber: 4 }, "Dis");
    return { ev, mine, foe, other, state };
  };

  it.each(ids)("%s: pergunta alvo 1, depois alvo 2 (a mesma criatura é legal)", (id) => {
    const { ev, mine, foe, state } = setup(id);
    // O alvo 1 vem do próprio movimento legal (um play por criatura); o prompt que sobra é o do alvo 2.
    const plays = getLegalMoves(state, 0).filter((m) => m.type === "play" && m.instanceId === ev.instanceId);
    expect(plays.length).toBeGreaterThanOrEqual(3);
    const picked: GameMove = { type: "play", instanceId: ev.instanceId, target: foe.instanceId };
    const second = pendingPrompt(state, 0, picked);
    expect(second?.kind).toBe("target2");
    expect(second?.ids).toContain(foe.instanceId); // a primeira também pode sofrer o dano
    expect(second?.ids).toHaveLength(3);
    // Foe captura 1 do pool do PRÓPRIO lado (inimigo: 4 -> 3); o jogador manda o dano em Mine.
    const after = applyMove(state, 0, { ...picked, targets: [mine.instanceId] } as GameMove);
    expect(after.players[1].amber).toBe(3);
    expect(byTitle(after.players[1].board, "Foe")?.amber).toBe(1);
    expect(byTitle(after.players[0].board, "Mine")?.damage).toBe(1);
    expect(byTitle(after.players[1].board, "Foe")?.damage).toBe(0);
  });

  it("alvo 2 = alvo 1: a criatura que capturou sofre o dano", () => {
    const { ev, mine, state } = setup(ids[1]);
    const after = applyMove(state, 0, { type: "play", instanceId: ev.instanceId, target: mine.instanceId, targets: [mine.instanceId] } as GameMove);
    expect(after.players[0].amber).toBe(2);
    expect(byTitle(after.players[0].board, "Mine")).toMatchObject({ amber: 1, damage: 1 });
  });

  it("com uma única criatura em jogo ainda resolve", () => {
    seeded();
    const ev = card("Energy Vampirism", { id: ids[1], type: "Action", house: "Dis", text: EV });
    const solo = creature("Solo", 5);
    const state = setupTest({ hand: [ev], inPlay: [solo], amber: 2 }, {}, "Dis");
    const after = applyMove(state, 0, { type: "play", instanceId: ev.instanceId, target: solo.instanceId });
    expect(byTitle(after.players[0].board, "Solo")).toMatchObject({ amber: 1, damage: 1 });
  });

  it("sem sameTarget2 o segundo continua sendo OUTRA carta (contrato antigo)", () => {
    const ab: Ability = { on: ["play"], target: { type: "Creature" }, target2: { type: "Creature" }, acts: [{ k: "moveAmber", s: "target", to: "target2" }] };
    const solo = creature("Solo");
    const state = setupTest({ inPlay: [solo] });
    expect(canResolve(state, 0, solo, ab)).toBe(false);
    expect(canResolve(state, 0, solo, { ...ab, sameTarget2: true })).toBe(true);
  });
});

describe("seed dos parentes do capture-all (via vendoredOverrides)", () => {
  it("The Corpulent Collector: captura todo o pool e leva 1 de dano por Æmber nele", () => {
    seeded();
    const text = `Play: Capture all of your opponent’s ${A}. Deal 1${D} to The Corpulent Collector for each ${A} on it.`;
    for (const id of ["1a773916-d37a-4455-8a45-7acc54198c17", "7bed5831-16b3-4af0-9f50-1becb4788cf9"]) {
      const c = card("The Corpulent Collector", { id, type: "Creature", house: "Sanctum", power: 7, text });
      const foe = creature("Foe");
      foe.amber = 2;
      const state = setupTest({ hand: [c] }, { inPlay: [foe], amber: 4 }, "Sanctum");
      const after = play(state, c);
      expect(after.players[1].amber).toBe(0);
      expect(byTitle(after.players[1].board, "Foe")?.amber).toBe(2); // já capturado não se move
      expect(byTitle(after.players[0].board, "The Corpulent Collector")).toMatchObject({ amber: 4, damage: 4 });
    }
  });

  it("Envy: After Reap só captura com 2+ Sin amigas", () => {
    seeded();
    const text = `Elusive. \nAfter Reap: If there are 2 or more friendly Sin creatures, capture all of your opponent’s ${A}.`;
    const build = (sins: number) => {
      const envy = card("Envy", { id: "9afe3a12-5280-45e0-afc7-93d0a991f4aa", type: "Creature", house: "Dis", power: 3, text, traits: "Demon • Sin" });
      const mates = Array.from({ length: sins - 1 }, (_, i) => creature(`Sin${i}`, 2, { traits: "Sin" }));
      return { envy, state: setupTest({ inPlay: [envy, ...mates] }, { amber: 3 }, "Dis") };
    };
    const lone = build(1);
    expect(applyMove(lone.state, 0, { type: "reap", instanceId: lone.envy.instanceId }).players[1].amber).toBe(3);
    const pair = build(2);
    const after = applyMove(pair.state, 0, { type: "reap", instanceId: pair.envy.instanceId });
    expect(after.players[1].amber).toBe(0);
    expect(byTitle(after.players[0].board, "Envy")?.amber).toBe(3);
  });

  it("ANT1-10NY: Play captura tudo; no fim do turno devolve 1 ao pool do oponente", () => {
    seeded();
    const text = `At the end of your turn, move 1${A} from ANT1‑10NY to your opponent’s pool.\nPlay: Capture all of your opponent’s ${A}.\n`;
    for (const id of ["39eeafff-e0ab-49e2-8476-bfd9dc29fd9d", "f01b294f-7956-4c8a-a648-f6aac88e9e60"]) {
      const ant = card("ANT1-10NY", { id, type: "Creature", house: "Star Alliance", power: 6, text });
      const played = play(setupTest({ hand: [ant] }, { amber: 5 }, "Star Alliance"), ant);
      expect(byTitle(played.players[0].board, "ANT1-10NY")?.amber).toBe(5);
      const ended = endTurn(played, 0);
      expect(byTitle(ended.players[0].board, "ANT1-10NY")?.amber).toBe(4);
      expect(ended.players[1].amber).toBe(1);
    }
  });

  it("Gatekeeper: com 7+ captura tudo menos 5; com 6 nada", () => {
    seeded();
    const text = `Play: If your opponent has 7${A} or more, capture all but 5 of it. (Move each ${A} from your opponent’s pool to this creature.)\n`;
    const gk = () => card("Gatekeeper", { id: "74e875b8-e06f-4a05-a222-f769ca33fdd1", type: "Creature", house: "Sanctum", power: 5, text });
    const [a, b, c] = [gk(), gk(), gk()];
    const nine = play(setupTest({ hand: [a] }, { amber: 9 }, "Sanctum"), a);
    expect(nine.players[1].amber).toBe(5);
    expect(nine.players[0].board[0].amber).toBe(4);
    const seven = play(setupTest({ hand: [b] }, { amber: 7 }, "Sanctum"), b);
    expect(seven.players[1].amber).toBe(5);
    const six = play(setupTest({ hand: [c] }, { amber: 6 }, "Sanctum"), c);
    expect(six.players[1].amber).toBe(6);
    expect(six.players[0].board[0].amber ?? 0).toBe(0);
  });

  it("o textHash do seed bate com o texto impresso da Energy Vampirism", () => {
    expect(textHash(`Play: A creature captures 1${A} from its own side. For each ${A} on that creature, deal 1${D} to a creature.\n`)).toBe("2faa6806");
  });
});
