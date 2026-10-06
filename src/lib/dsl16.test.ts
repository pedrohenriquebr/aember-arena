// SPDX-License-Identifier: AGPL-3.0-only
// Lote 15b (DSL_VERSION 15, PARSER_VERSION 17): target-select — o cluster 2 da
// cauda (274 arquivos / 431 faces). "Choose a house" + a variável de casa
// escolhida (`house: "chosen"`, REUSE do Lote 5 §5.1 — nada duplicado), "Choose
// up to N" (pick `upTo` lido da fila `targets` do movimento, Lote 7 §7.1),
// "exactly N" (pick `n`: o engine escolhe exatamente n) e o superlativo com
// EMPATES (`mostStat`/`lowest` — o `most`/`least` de contagem continua cortando
// pela ordem do board). Prints REAIS do corpus (scripts/harvest/cards-corpus.json).
// Reforço do dono: FOCO EM COMPORTAMENTO — caminho feliz + decline, alvo
// esgotado, escolha inválida derrubada pelo shape gate, orçamento anti-laço e
// contra-caso; cada campo novo entra com aceita-forma + comportamento; cada bug
// da triagem dos 15 DIFFs entra com regressão que falhava antes do fix.
import { afterEach, describe, expect, it } from "vitest";
import { DSL_VERSION, normaliseAbilityOverride, setAbilityOverrides, type AbilityOverride } from "./abilities";
import { PARSER_VERSION, parseCardText, textHash } from "./cardText";
import { applyMove, chooseHouse, houseChoices, type CardFace, type GameState } from "./game";
import { DSL_SCHEMA } from "./generated/dslSchema";
import { byTitle, card, setupTest } from "./testkit";

afterEach(() => setAbilityOverrides(new Map()));

// Prints de scripts/harvest/cards-corpus.json (glyphs e aspas tipográficas
// preservados, como no dsl15).
const UNPREPARED = "Play: Choose a house. Stun each creature of that house.\n";
const PERSISTENCE_HUNTING = "Play: Choose a house. Exhaust each enemy creature of the chosen house.";
const THEY_TELL_NO_TALES = "Play: Choose a house. Destroy each creature of the chosen house. Gain 2 chains.\n";
const CONTROL_THE_WEAK = "Play: Choose a house on your opponent’s identity card. Your opponent must choose that house as their active house on their next turn.";
const DRACO_PRAECO = "Reap: You may exalt Draco Praeco. If you do, choose a house. Enrage each creature of that house.";
const ROCKATIEL = "Elusive. Hazardous 1.\nPlay/After Reap: Choose up to 2 creatures. Shuffle each chosen creature into its owner’s deck.\n";
const LIGHTS_OUT = "Play: Return 2 enemy creatures to their owner’s hand.﻿﻿";
const PALE = "Play: Destroy each creature with the lowest power.\n";
const STANDARDIZED = "Play: Destroy each creature with the lowest power and each creature with the highest power.\n";
const SEANCE = "Enhance .\nAction: If you are haunted, use a friendly non-Star Alliance creature.\n";
const RADIX = "Action: Your opponent loses 1. If your opponent has no , draw 1 card.";
const ARM = "Play: Make a token creature. Ward it.\n";

const face = (title: string, text: string, type: string, house: string): CardFace => ({ id: title, title, house, type, image: "", text, amber: 0, power: 3, armor: 0 });
const parse = (title: string, text: string, type: string, house: string) => parseCardText(face(title, text, type, house));
const row = (dsl: unknown[], extra: object = {}) => ({ cardId: "c", dsl, textHash: "h", source: "manual" as const, v: DSL_VERSION, ...extra });
const play = (state: GameState, id: string) => applyMove(state, 0, { type: "play", instanceId: id });
const filler = (n: number, house = "Dis", power = 3) => Array.from({ length: n }, (_, i) => card(`Filler ${i}`, { house, power }));
/** Injeta uma linha de store (a forma que o Conversor emite) sobre a carta. */
const overrideFor = (c: CardFace, dsl: AbilityOverride["dsl"]): AbilityOverride => ({
  cardId: c.id,
  dsl,
  effects: [],
  keywords: {},
  textHash: textHash(c.text),
  source: "manual",
  reviewed: true,
  generatedAt: 1,
  v: DSL_VERSION,
});

describe("contract", () => {
  it("bumps both versions; the schema carries the target-select fields", () => {
    expect(DSL_VERSION).toBe(15);
    expect(PARSER_VERSION).toBe(18);
    for (const needle of ["mostStat?:", "lowest?: boolean", '"moved"']) expect(DSL_SCHEMA).toContain(needle);
  });
});

describe("shape gate (escolha inválida derruba a linha)", () => {
  it("accepts the new selection fields (aceita-forma)", () => {
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "destroy", s: { each: { type: "Creature", mostStat: "power" } } }] }]))?.v).toBe(DSL_VERSION);
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "destroy", s: { each: { type: "Creature", mostStat: "power", lowest: true } } }] }]))?.v).toBe(DSL_VERSION);
    expect(normaliseAbilityOverride(row([{ on: ["play"], target: { type: "Creature", mostStat: "armor" }, acts: [{ k: "stun", s: "target" }] }]))?.v).toBe(DSL_VERSION);
  });

  it("rejects an invalid choice the engine would misread", () => {
    // stat desconhecido / direção fora do tipo → a linha cai inteira
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "destroy", s: { each: { type: "Creature", mostStat: "bogus" } } }] }]))).toBeNull();
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "destroy", s: { each: { type: "Creature", mostStat: "power", lowest: "yes" } } }] }]))).toBeNull();
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "destroy", s: { each: { type: "Creature", mostStat: 3 } } }] }]))).toBeNull();
  });

  it("keeps mostStat out of a persistent per (readsPower: anti-laço)", () => {
    // o extremo lê effectivePower DENTRO de allEffects: um `per` persistente
    // recursaria para sempre — a linha é derrubada, como `top`/`most` (Lote 8).
    expect(normaliseAbilityOverride(row([], { effects: [{ target: { type: "Creature" }, per: { c: { type: "Creature", mostStat: "power" } }, e: { power: 1 } }] }))).toBeNull();
    // contra-caso: o mesmo per SEM o extremo continua válido
    expect(normaliseAbilityOverride(row([], { effects: [{ target: { type: "Creature" }, per: { c: { type: "Creature" } }, e: { power: 1 } }] }))).not.toBeNull();
  });
});

describe("parse das grafias do cluster (cartas reais)", () => {
  it.each([
    ["Unprepared", UNPREPARED, "Action", "Star Alliance", [{ k: "stun", s: { each: { type: "Creature", house: "chosen" } } }]],
    ["Persistence Hunting", PERSISTENCE_HUNTING, "Action", "Untamed", [{ k: "exhaust", s: { each: { type: "Creature", house: "chosen", side: "enemy" } } }]],
    ["They Tell No Tales", THEY_TELL_NO_TALES, "Action", "Dis", [{ k: "destroy", s: { each: { type: "Creature", house: "chosen" } } }, { k: "gainChains", n: 2 }]],
    ["Rockatiel", ROCKATIEL, "Creature", "Untamed", [{ k: "returnToDeck", s: { pick: { type: "Creature" }, n: 2, upTo: true }, at: "shuffle" }]],
    ["Lights Out", LIGHTS_OUT, "Action", "Shadows", [{ k: "returnToHand", s: { pick: { type: "Creature", side: "enemy" }, n: 2 } }]],
    ["Pale Into Insignificance", PALE, "Action", "Saurian", [{ k: "destroy", s: { each: { type: "Creature", mostStat: "power", lowest: true } } }]],
    ["Standardized Testing", STANDARDIZED, "Action", "Logos", [{ k: "destroy", s: { each: { type: "Creature", mostStat: "power", lowest: true } } }, { k: "destroy", s: { each: { type: "Creature", mostStat: "power" } } }]],
  ])("%s", (title, text, type, house, acts) => {
    const parsed = parse(title, text, type, house);
    expect(parsed.coverage).toBe("full");
    expect(parsed.abilities[0].acts).toEqual(acts);
  });

  it("Séance Scanner reads 'non-Star Alliance' as a NEGATED HOUSE (regressão triagem M3)", () => {
    // antes do fix o pair "star alliance" não atravessava a negação e o alvo
    // saía como trait "Alliance" (nada casava).
    const parsed = parse("Séance Scanner", SEANCE, "Artifact", "Star Alliance");
    expect(parsed.abilities).toEqual([
      { on: ["action"], acts: [{ k: "use", s: "target" }], target: { type: "Creature", side: "friendly", house: "!Star Alliance", ready: true }, if: { k: "count", of: { p: "discard" }, op: "gte", n: 10 } },
    ]);
  });

  it("Control the Weak reads the chosen house into the forced choice", () => {
    const parsed = parse("Control the Weak", CONTROL_THE_WEAK, "Action", "Dis");
    expect(parsed.coverage).toBe("full");
    expect(parsed.abilities).toEqual([{ on: ["play"], acts: [{ k: "forceHouse" }] }]);
  });
});

describe("mostStat (o extremo, empates incluídos)", () => {
  it("Pale Into Insignificance destroys EVERY creature tied at the lowest power", () => {
    const spell = card("Pale Into Insignificance", { type: "Action", house: "Saurian", text: PALE });
    const cast = play(
      setupTest({ hand: [spell] }, { inPlay: [card("Weak A", { house: "Dis", power: 2 }), card("Weak B", { house: "Logos", power: 2 }), card("Strong", { house: "Mars", power: 5 })] }, "Saurian"),
      spell.instanceId,
    );
    expect(cast.players[1].board.map((c) => c.face.title)).toEqual(["Strong"]);
  });

  it("Standardized Testing takes the two extremes and keeps the middle", () => {
    const spell = card("Standardized Testing", { type: "Action", house: "Logos", text: STANDARDIZED });
    const cast = play(
      setupTest({ hand: [spell] }, { inPlay: [card("Low", { house: "Dis", power: 2 }), card("Mid", { house: "Logos", power: 4 }), card("High", { house: "Mars", power: 6 })] }, "Logos"),
      spell.instanceId,
    );
    expect(cast.players[1].board.map((c) => c.face.title)).toEqual(["Mid"]);
    // contra-caso extremo: empate TOTAL = o extremo é o conjunto inteiro
    const spell2 = card("Standardized Testing", { type: "Action", house: "Logos", text: STANDARDIZED });
    const tied = play(setupTest({ hand: [spell2] }, { inPlay: [card("A", { house: "Dis", power: 3 }), card("B", { house: "Logos", power: 3 })] }, "Logos"), spell2.instanceId);
    expect(tied.players[1].board).toEqual([]);
  });

  it("an empty board is a no-op (alvo esgotado)", () => {
    const spell = card("Pale Into Insignificance", { type: "Action", house: "Saurian", text: PALE });
    const cast = play(setupTest({ hand: [spell] }, {}, "Saurian"), spell.instanceId);
    expect(cast.players[0].hand).toEqual([]);
    expect(cast.players[1].board).toEqual([]);
  });

  it("an optional extreme act is skipped on decline (recusa)", () => {
    const mine = card("Optional Pale", { type: "Action", house: "Saurian", text: PALE });
    setAbilityOverrides(new Map([[mine.face.id, overrideFor(mine.face, [{ on: ["play"], acts: [{ k: "destroy", s: { each: { type: "Creature", mostStat: "power", lowest: true } }, optional: true }] }])]]));
    const target = card("Weak", { house: "Dis", power: 1 });
    const declined = applyMove(setupTest({ hand: [mine] }, { inPlay: [target] }, "Saurian"), 0, { type: "play", instanceId: mine.instanceId, decline: true });
    expect(declined.players[1].board).toHaveLength(1);
    const accepted = applyMove(setupTest({ hand: [mine] }, { inPlay: [target] }, "Saurian"), 0, { type: "play", instanceId: mine.instanceId });
    expect(accepted.players[1].board).toEqual([]);
  });
});

describe("house mode (REUSE: a variável de casa escolhida)", () => {
  it("Unprepared stuns only the chosen house (a casa escolhida é visível aos atos seguintes)", () => {
    const spell = card("Unprepared", { type: "Action", house: "Star Alliance", text: UNPREPARED });
    const state = setupTest({ hand: [spell] }, { inPlay: [card("Disy", { house: "Dis", power: 3 }), card("Loggy", { house: "Logos", power: 3 })] }, "Star Alliance");
    const cast = applyMove(state, 0, { type: "play", instanceId: spell.instanceId, house: "Dis" });
    expect(byTitle(cast.players[1].board, "Disy")?.stunned).toBe(true);
    expect(byTitle(cast.players[1].board, "Loggy")?.stunned).toBe(false);
  });

  it("houseChoices lists the pick before the move carries one, and clears after (escolha)", () => {
    const spell = card("Unprepared", { type: "Action", house: "Star Alliance", text: UNPREPARED });
    const state = setupTest({ hand: [spell] }, { inPlay: [card("Disy", { house: "Dis", power: 3 })] }, "Star Alliance");
    expect(houseChoices(state, 0, { type: "play", instanceId: spell.instanceId })).toContain("Dis");
    expect(houseChoices(state, 0, { type: "play", instanceId: spell.instanceId, house: "Dis" })).toEqual([]);
  });

  it("without a house the engine falls back to the most numerous house of the harmful pool", () => {
    const spell = card("Unprepared", { type: "Action", house: "Star Alliance", text: UNPREPARED });
    const cast = play(
      setupTest({ hand: [spell] }, { inPlay: [card("Disy A", { house: "Dis", power: 3 }), card("Disy B", { house: "Dis", power: 3 }), card("Loggy", { house: "Logos", power: 3 })] }, "Star Alliance"),
      spell.instanceId,
    );
    expect(byTitle(cast.players[1].board, "Disy A")?.stunned).toBe(true);
    expect(byTitle(cast.players[1].board, "Loggy")?.stunned).toBe(false);
  });

  it("Persistence Hunting exhausts only the ENEMY creatures of the chosen house (contra-caso: o resto fica)", () => {
    const spell = card("Persistence Hunting", { type: "Action", house: "Untamed", text: PERSISTENCE_HUNTING });
    const mine = card("My Mars", { house: "Mars", power: 3 });
    const foe = card("Foe Mars", { house: "Mars", power: 3 });
    const other = card("Foe Dis", { house: "Dis", power: 3 });
    const cast = applyMove(setupTest({ hand: [spell], inPlay: [mine] }, { inPlay: [foe, other] }, "Untamed"), 0, { type: "play", instanceId: spell.instanceId, house: "Mars" });
    expect(byTitle(cast.players[0].board, "My Mars")?.ready).toBe(true);
    expect(byTitle(cast.players[1].board, "Foe Mars")?.ready).toBe(false);
    expect(byTitle(cast.players[1].board, "Foe Dis")?.ready).toBe(true);
  });

  it("Draco Praeco: declining the 'you may' skips the choice and the enrage", () => {
    const draco = card("Draco Praeco", { type: "Creature", house: "Saurian", text: DRACO_PRAECO });
    const disy = card("Disy", { house: "Dis", power: 3 });
    const setup = () => setupTest({ inPlay: [draco] }, { inPlay: [disy] }, "Saurian");
    const declined = applyMove(setup(), 0, { type: "reap", instanceId: draco.instanceId, decline: true });
    expect(byTitle(declined.players[1].board, "Disy")?.enraged).toBeUndefined();
    const accepted = applyMove(setup(), 0, { type: "reap", instanceId: draco.instanceId, house: "Dis" });
    expect(byTitle(accepted.players[1].board, "Disy")?.enraged).toBe(1);
  });

  it("Control the Weak forces the opponent's next active house (e uma escolha fora da lista cai no padrão)", () => {
    const spell = card("Control the Weak", { type: "Action", house: "Dis", text: CONTROL_THE_WEAK });
    const state = setupTest({ hand: [spell] }, {}, "Dis");
    // "a house on your opponent's identity card": só as casas da identidade
    const offered = houseChoices(state, 0, { type: "play", instanceId: spell.instanceId });
    expect(offered).toEqual(state.players[1].houses);
    const cast = applyMove(state, 0, { type: "play", instanceId: spell.instanceId, house: offered[offered.length - 1] });
    expect(cast.players[1].mustChoose).toBe(offered[offered.length - 1]);
    // escolha INVÁLIDA (fora da identidade): o engine cai na primeira oferecida
    const spell2 = card("Control the Weak", { type: "Action", house: "Dis", text: CONTROL_THE_WEAK });
    const bad = applyMove(setupTest({ hand: [spell2] }, {}, "Dis"), 0, { type: "play", instanceId: spell2.instanceId, house: "Mars" });
    expect(bad.players[1].mustChoose).toBe(offered[0]);
  });
});

describe("upTo pick (Choose up to N — a fila targets do movimento)", () => {
  const setup = () => {
    const spell = card("Rockatiel", { type: "Creature", house: "Untamed", text: ROCKATIEL });
    const a = card("Chosen A", { house: "Dis", power: 3 });
    const b = card("Chosen B", { house: "Logos", power: 3 });
    const c = card("Left Out", { house: "Mars", power: 3 });
    return { spell, a, b, c, state: setupTest({ hand: [spell] }, { inPlay: [a, b, c], deck: [] }, "Untamed") };
  };

  it("shuffles each chosen creature into its owner's deck (caminho feliz)", () => {
    const { spell, a, b, state } = setup();
    const cast = applyMove(state, 0, { type: "play", instanceId: spell.instanceId, targets: [a.instanceId, b.instanceId] });
    expect(cast.players[1].board.map((x) => x.face.title)).toEqual(["Left Out"]);
    expect(cast.players[1].deck.map((x) => x.face.title).sort()).toEqual(["Chosen A", "Chosen B"]);
  });

  it("an empty queue is zero cards — the engine never guesses a subset", () => {
    const { spell, state } = setup();
    const cast = applyMove(state, 0, { type: "play", instanceId: spell.instanceId, targets: [] });
    expect(cast.players[1].board).toHaveLength(3);
    expect(cast.players[1].deck).toEqual([]);
  });

  it("the queue is capped at N and skips ids that are not legal choices", () => {
    const { spell, a, b, c, state } = setup();
    const cast = applyMove(state, 0, { type: "play", instanceId: spell.instanceId, targets: ["nope", a.instanceId, b.instanceId, c.instanceId] });
    // "nope" não é carta; o cap é 2 — a terceira legal (Left Out) fica
    expect(cast.players[1].board.map((x) => x.face.title)).toEqual(["Left Out"]);
  });

  it("fewer creatures than N: every legal choice goes (alvo esgotado)", () => {
    const spell = card("Rockatiel", { type: "Creature", house: "Untamed", text: ROCKATIEL });
    const only = card("Only", { house: "Dis", power: 3 });
    const cast = applyMove(setupTest({ hand: [spell] }, { inPlay: [only] }, "Untamed"), 0, { type: "play", instanceId: spell.instanceId, targets: [only.instanceId] });
    expect(cast.players[1].board).toEqual([]);
  });
});

describe("exactly (pick n: o engine escolhe exatamente n)", () => {
  it("Lights Out returns the two strongest enemy creatures to their OWNER's hand", () => {
    const spell = card("Lights Out", { type: "Action", house: "Shadows", text: LIGHTS_OUT });
    const weak = card("Weak", { house: "Dis", power: 2 });
    const mid = card("Mid", { house: "Logos", power: 4 });
    const strong = card("Strong", { house: "Mars", power: 6 });
    const cast = play(setupTest({ hand: [spell] }, { inPlay: [weak, mid, strong] }, "Shadows"), spell.instanceId);
    expect(cast.players[1].board.map((x) => x.face.title)).toEqual(["Weak"]);
    expect(cast.players[1].hand.map((x) => x.face.title).sort()).toEqual(["Mid", "Strong"]);
  });

  it("with fewer enemies than n it returns them all (alvo esgotado)", () => {
    const spell = card("Lights Out", { type: "Action", house: "Shadows", text: LIGHTS_OUT });
    const only = card("Only", { house: "Dis", power: 2 });
    const cast = play(setupTest({ hand: [spell] }, { inPlay: [only] }, "Shadows"), spell.instanceId);
    expect(cast.players[1].board).toEqual([]);
  });
});

describe("regressões da triagem dos 15 DIFFs (M3)", () => {
  it("Séance Scanner uses a friendly non-Star Alliance creature (falhava antes: trait 'Alliance' não casava nada)", () => {
    const scanner = card("Séance Scanner", { type: "Artifact", house: "Star Alliance", text: SEANCE });
    const outsider = card("Outsider", { type: "Creature", house: "Dis", power: 3 });
    const haunted = setupTest({ inPlay: [scanner] }, {}, "Star Alliance", 4242);
    haunted.players[0].discard = filler(10, "Dis", 1);
    haunted.players[0].board.push(outsider);
    const cast = applyMove(haunted, 0, { type: "use", instanceId: scanner.instanceId, house: "Star Alliance" });
    expect(byTitle(cast.players[0].board, "Outsider")?.ready).toBe(false);
    // contra-caso: só uma criatura Star Alliance no board — alvo nenhum
    const insider = card("Insider", { type: "Creature", house: "Star Alliance", power: 3 });
    const saOnly = setupTest({ inPlay: [scanner] }, {}, "Star Alliance", 4242);
    saOnly.players[0].discard = filler(10, "Dis", 1);
    saOnly.players[0].board.push(insider);
    const untouched = applyMove(saOnly, 0, { type: "use", instanceId: scanner.instanceId, house: "Star Alliance" });
    expect(byTitle(untouched.players[0].board, "Insider")?.ready).toBe(true);
  });

  it("Radix of Suffering: the ungated follow-up fires even when the loss is a no-op (falhava com o gate do then)", () => {
    // keyteki: `then: {alwaysTriggers, condition}` = SEM gate — o draw depende
    // SÓ do "if" impresso. Com o oponente já em 0 âmbar o loss não acontece e
    // mesmo assim o draw resolve.
    const radix = card("Radix of Suffering", { type: "Artifact", house: "Dis", text: RADIX });
    const broke = applyMove(setupTest({ inPlay: [radix], deck: filler(3) }, { amber: 0 }, "Dis"), 0, { type: "use", instanceId: radix.instanceId, house: "Dis" });
    expect(broke.players[1].amber).toBe(0);
    expect(broke.players[0].hand).toHaveLength(1);
    // contra-caso: com âmbar a perder, o loss acontece e o draw NÃO (if falso)
    const radix2 = card("Radix of Suffering", { type: "Artifact", house: "Dis", text: RADIX });
    const rich = applyMove(setupTest({ inPlay: [radix2], deck: filler(3) }, { amber: 3 }, "Dis"), 0, { type: "use", instanceId: radix2.instanceId, house: "Dis" });
    expect(rich.players[1].amber).toBe(2);
    expect(rich.players[0].hand).toHaveLength(0);
  });

  it("Arm the Plebeians wards the token it made (o `moved` sem gate — normalização do golden)", () => {
    const spell = card("Arm the Plebeians", { type: "Action", house: "Saurian", text: ARM });
    const cast = play(setupTest({ hand: [spell] }, {}, "Saurian"), spell.instanceId);
    expect(cast.players[0].board).toHaveLength(1);
    expect(cast.players[0].board[0].warded).toBe(1);
  });

  it("the converter's Key Abduction row offers the forge even with no Mars creatures (keyteki spec test 3)", () => {
    // A linha que o Conversor emite (alwaysTriggers = sem gate): o return vácuo
    // NÃO mata o "you may" do forge. Com `then: true` (a grafia antiga do map)
    // o forge era engolido — este comportamento falharia antes do fix do M2.
    const spell = card("Key Abduction", { type: "Action", house: "Mars", text: "Play: Return each Mars creature to its owner's hand. Then, you may forge a key at +9<A> current cost, reduced by 1<A> for each card in your hand." });
    setAbilityOverrides(new Map([
      [spell.face.id, overrideFor(spell.face, [
        { on: ["play"], acts: [{ k: "returnToHand", s: { each: { type: "Creature", house: "Mars" } } }, { k: "forgeKey", n: 1, mod: 9, less: { p: "hand" }, optional: true }] },
      ])],
    ]));
    const forged = applyMove(setupTest({ hand: [spell], amber: 30 }, {}, "Mars"), 0, { type: "play", instanceId: spell.instanceId });
    expect(forged.players[0].keys).toBe(1);
    const declined = applyMove(setupTest({ hand: [spell], amber: 30 }, {}, "Mars"), 0, { type: "play", instanceId: spell.instanceId, decline: true });
    expect(declined.players[0].keys).toBe(0);
  });
});

describe("orçamento anti-laço", () => {
  it("a self-feeding reap chain with a mostStat act is stopped by the fire budget", () => {
    // "Reap: ready and use ~ via reap" se re-alimenta (dsl3); o destroy do
    // extremo roda a cada despacho — o FIRE_BUDGET (64) corta a cadeia antes do
    // board acabar, e o movimento termina sem RangeError.
    const looper = card("Loop Tester", { type: "Creature", house: "Dis", text: "Reap: Ready this creature and use this creature via reap.", power: 200 });
    setAbilityOverrides(new Map([
      [looper.face.id, overrideFor(looper.face, [
        { on: ["reap"], acts: [{ k: "ready", s: "self" }, { k: "use", s: "self", via: "reap" }, { k: "destroy", s: { each: { type: "Creature", mostStat: "power", lowest: true } } }] },
      ])],
    ]));
    const enemies = Array.from({ length: 100 }, (_, i) => card(`Enemy ${i}`, { house: "Logos", power: i + 1 }));
    const cast = applyMove(setupTest({ inPlay: [looper] }, { inPlay: enemies }, "Dis"), 0, { type: "reap", instanceId: looper.instanceId });
    // o movimento voltou (a cadeia não rodou para sempre) e o board não zerou
    expect(cast.players[1].board.length).toBeGreaterThan(0);
    expect(cast.players[1].board.length).toBeLessThan(100);
  });
});

describe("Lote 15c (pacote de tabelas): grafias novas e linhas convertidas", () => {
  it("'After you choose Sanctum as your active house' vira o gate self+active (regressão: era vanilla)", () => {
    const parsed = parse("Jehu the Bureaucrat", "After you choose Sanctum as your active house, gain 2<A>.", "Creature", "Sanctum");
    expect(parsed.coverage).toBe("full");
    expect(parsed.abilities).toEqual([
      { on: ["house"], if: { k: "count", of: { c: { self: true, house: "active" } }, op: "gte", n: 1 }, acts: [{ k: "gainAmber", n: 2 }] },
    ]);
  });

  it("'Purge a creature from a discard pile' e '…creature in play' são ato de zona (regressão: eram vanilla)", () => {
    const purge = parse("Purge Zone", "Play: Purge a creature from a discard pile.", "Action", "Dis");
    expect(purge.coverage).toBe("full");
    expect(purge.abilities).toEqual([{ on: ["play"], acts: [{ k: "move", n: 1, from: "discard", to: "purged", type: "Creature" }] }]);
    const archive = parse("Epic Quest", "Play: Archive each friendly Knight creature in play.", "Action", "Sanctum");
    expect(archive.coverage).toBe("full");
    expect(archive.abilities).toEqual([{ on: ["play"], acts: [{ k: "archive", s: { each: { type: "Creature", side: "friendly", trait: "Knight" } } }] }]);
  });

  it("a linha convertida de amount dinâmico resolve no motor (Dr Escotera: n x per)", () => {
    const spell = card("Dr Escotera", { type: "Creature", house: "Untamed", text: "Play: Gain 1<A> for each forged key your opponent has." });
    setAbilityOverrides(new Map([
      [spell.face.id, overrideFor(spell.face, [{ on: ["play"], acts: [{ k: "gainAmber", n: 1, per: { p: "keys", opp: true } }] }])],
    ]));
    const rich = play(setupTest({ hand: [spell] }, { keys: 3 }, "Untamed"), spell.instanceId);
    expect(rich.players[0].amber).toBe(3);
    // contra-caso: o oponente sem chaves forjadas não rende nada
    const poor = play(setupTest({ hand: [spell] }, { keys: 0 }, "Untamed"), spell.instanceId);
    expect(poor.players[0].amber).toBe(0);
  });

  it("a linha convertida do gatilho de casa dispara só na escolha da casa da carta (Jehu)", () => {
    const state = setupTest({ inPlay: [card("Placeholder", { house: "Brobnar" })] }, {}, null);
    const house = state.players[0].houses[0];
    const jehu = card("Jehu the Bureaucrat", { type: "Creature", house, text: "After you choose Sanctum as your active house, gain 2<A>." });
    setAbilityOverrides(new Map([
      [jehu.face.id, overrideFor(jehu.face, [
        { on: ["house"], if: { k: "count", of: { c: { self: true, house: "active" } }, op: "gte", n: 1 }, acts: [{ k: "gainAmber", n: 2 }] },
      ])],
    ]));
    const setup = () => {
      const s = setupTest({ inPlay: [jehu] }, {}, null);
      return s;
    };
    const chosen = chooseHouse(setup(), 0, house);
    expect(chosen.players[0].amber).toBe(2);
    // contra-caso: outra casa escolhida não dispara
    const other = state.players[0].houses.find((h) => h !== house) ?? "Dis";
    const missed = chooseHouse(setup(), 0, other);
    expect(missed.players[0].amber).toBe(0);
  });
});
