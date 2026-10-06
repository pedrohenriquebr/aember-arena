// SPDX-License-Identifier: AGPL-3.0-only
// Lote 15a (DSL_VERSION 14, PARSER_VERSION 16): Then-chains — o link sequencial
// (`then`), o bloco do "If you do, X, and Y" (os atos do bloco compartilham o
// gate do ato ANTES do bloco, como o `then: {gameAction: […]}` do keyteki),
// "Then, if <cond>, X", "X, then Y" e a anáfora do resultado do ato anterior
// ("…, then ready it" — o token que o makeToken acabou de criar, `s:"moved"`).
// Todas as cartas são os prints REAIS do corpus (glyphs, aspas tipográficas e
// quebras incluídos), então uma regressão do parser aparece primeiro como falha
// de parse. O "If you do" de um ato só continua sendo `if: count did` (contrato
// do Lote 2/Seda) — o `then` entra só onde o encadeamento pede bloco.
import { afterEach, describe, expect, it } from "vitest";
import { DSL_VERSION, normaliseAbilityOverride, setAbilityOverrides } from "./abilities";
import { PARSER_VERSION, parseCardText } from "./cardText";
import { FEW_SHOTS } from "./catalogLlm";
import { applyMove, type CardFace, type GameState } from "./game";
import { DSL_SCHEMA } from "./generated/dslSchema";
import { byTitle, card, setupTest } from "./testkit";

afterEach(() => setAbilityOverrides(new Map()));

// Prints de scripts/harvest/cards-corpus.json (glyph U+F360 do Æmber, aspas
// tipográficas e as quebras de linha do Master Vault).
const ART_PROJECT = "Play: Unforge an opponent’s key. If you do, purge Art Project, and your opponent draws 10 cards.\n";
const KEY_ABDUCTION = "Play: Return each Mars creature to its owner's hand. Then, you may forge a key at +9<A> current cost, reduced by 1<A> for each card in your hand.";
const RAGNAROK_PREP = "Play: Make a token creature. Then, if you control more creatures than your opponent, your opponent loses 2.\n";
const COVER_OPERATION = "Play: Make a token creature, then ready it.\n";
const CHOTA_HAZRI = "Play: Lose 1A. If you do, you may forge a key at current cost.";
const FINISHING_BLOW = "Play: Destroy a damaged creature. If you do, steal 1.\n";
const CLEANSING_WAVE = "Play: Heal 1 damage from each creature. Gain 1 for each creature healed this way.";
const DARK_CENTURION = "Enhance . \nAction: Move 1 from a creature to the common supply. If you do, ward that creature.";

const face = (title: string, text: string, type: string, house: string): CardFace => ({ id: title, title, house, type, image: "", text, amber: 0, power: 3, armor: 0 });
const parse = (title: string, text: string, type: string, house: string) => parseCardText(face(title, text, type, house));
const row = (dsl: unknown[], extra: object = {}) => ({ cardId: "c", dsl, textHash: "h", source: "manual" as const, v: DSL_VERSION, ...extra });
const play = (state: GameState, id: string) => applyMove(state, 0, { type: "play", instanceId: id });
const DID = { k: "count", of: "did", op: "gte", n: 1 } as const;
const filler = (n: number) => Array.from({ length: n }, (_, i) => card(`Filler ${i}`, { house: "Dis" }));

describe("contract", () => {
  it("bumps both versions; the schema and the few-shots carry the then link and the moved selection", () => {
    expect(DSL_VERSION).toBe(15);
    expect(PARSER_VERSION).toBe(18);
    for (const needle of ["then?: true", '"moved"']) expect(DSL_SCHEMA).toContain(needle);
    const shots = FEW_SHOTS.map((shot) => shot.text);
    expect(shots.some((text) => text.includes("then ready it"))).toBe(true);
  });

  it("the shape gate reads `then` on a link and drops one without a gate before it", () => {
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "makeToken", n: 1 }, { k: "ready", s: "moved", then: true }] }]))?.v).toBe(DSL_VERSION);
    // primeiro ato não tem gate — linha de gramática mais nova, descartada
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "makeToken", n: 1, then: true }] }]))).toBeNull();
    expect(normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "makeToken", n: 1 }, { k: "ready", s: "moved", then: "yes" }] }]))).toBeNull();
    // o bloco todo pode ser link (o gate é o ato anterior ao bloco)
    expect(
      normaliseAbilityOverride(row([{ on: ["play"], acts: [{ k: "unforgeKey", n: 1 }, { k: "purge", s: "self", then: true }, { k: "draw", n: 10, opp: true, then: true }] }]))?.v,
    ).toBe(DSL_VERSION);
  });
});

describe("Art Project (o bloco do If-you-do)", () => {
  it("parses the comma-and compound as ONE then block: both acts gate on the unforge", () => {
    const parsed = parse("Art Project", ART_PROJECT, "Action", "Ekwidon");
    expect(parsed.coverage).toBe("full");
    expect(parsed.abilities).toEqual([
      { on: ["play"], acts: [{ k: "unforgeKey", n: 1 }, { k: "purge", s: "self", then: true }, { k: "draw", n: 10, opp: true, then: true }] },
    ]);
  });

  it("with a key to unforge: purges itself and the opponent draws 10", () => {
    const spell = card("Art Project", { type: "Action", house: "Ekwidon", text: ART_PROJECT });
    const cast = play(setupTest({ hand: [spell] }, { keys: 1, amber: 6, deck: filler(12) }, "Ekwidon"), spell.instanceId);
    expect(cast.players[1].keys).toBe(0);
    expect(cast.players[1].hand.length).toBe(10);
  });

  it("without a key the unforge does nothing and the whole block dies with it", () => {
    const spell = card("Art Project", { type: "Action", house: "Ekwidon", text: ART_PROJECT });
    const cast = play(setupTest({ hand: [spell] }, { keys: 0, amber: 6, deck: filler(12) }, "Ekwidon"), spell.instanceId);
    // o gate do bloco é o ato antes dele: nada de purge, nada de draw
    expect(cast.players[1].hand.length).toBe(0);
    expect(cast.players[0].purged).toEqual([]);
  });
});

describe("Ragnarok Prep (Then, if <cond>, …)", () => {
  it("parses as a token plus a then-linked conditional loss", () => {
    const parsed = parse("Ragnarok Prep", RAGNAROK_PREP, "Action", "Brobnar");
    expect(parsed.coverage).toBe("full");
    expect(parsed.abilities).toEqual([
      { on: ["play"], acts: [{ k: "makeToken", n: 1 }, { k: "loseAmber", n: 2, opp: true, then: true, if: { k: "moreCreatures" } }] },
    ]);
  });

  it("the opponent loses 2 only while we control more creatures (the token counts)", () => {
    const spell = card("Ragnarok Prep", { type: "Action", house: "Brobnar", text: RAGNAROK_PREP });
    const ahead = play(
      setupTest({ hand: [spell], inPlay: [card("Friend", { house: "Brobnar", power: 3 })] }, { amber: 5, inPlay: [card("Foe", { house: "Dis", power: 3 })] }, "Brobnar"),
      spell.instanceId,
    );
    // 1 criatura + o token = 2 contra 1: o link resolve e o oponente perde 2
    expect(ahead.players[0].board.length).toBe(2);
    expect(ahead.players[1].amber).toBe(3);
    const spell2 = card("Ragnarok Prep", { type: "Action", house: "Brobnar", text: RAGNAROK_PREP });
    const behind = play(
      setupTest({ hand: [spell2], inPlay: [card("Friend", { house: "Brobnar", power: 3 })] }, { amber: 5, inPlay: filler(3) }, "Brobnar"),
      spell2.instanceId,
    );
    // 2 contra 3: a condição falha e o link não resolve
    expect(behind.players[1].amber).toBe(5);
  });
});

describe("Cover Operation (X, then ready it)", () => {
  it("parses the mid-sentence link with the made token as its selection", () => {
    const parsed = parse("Cover Operation", COVER_OPERATION, "Action", "Shadows");
    expect(parsed.coverage).toBe("full");
    expect(parsed.abilities).toEqual([{ on: ["play"], acts: [{ k: "makeToken", n: 1 }, { k: "ready", s: "moved", then: true }] }]);
  });

  it("makes the token and readies it", () => {
    const spell = card("Cover Operation", { type: "Action", house: "Shadows", text: COVER_OPERATION });
    const cast = play(setupTest({ hand: [spell] }, {}, "Shadows"), spell.instanceId);
    expect(cast.players[0].board.length).toBe(1);
    expect(byTitle(cast.players[0].board, "Token Creature")).toBeDefined();
    expect(cast.players[0].board[0].ready).toBe(true);
  });
});

describe("Key Abduction (Then, you may …, reduced by …)", () => {
  it("parses the return plus a then-linked optional forge whose cost shrinks by hand size", () => {
    const parsed = parse("Key Abduction", KEY_ABDUCTION, "Action", "Mars");
    expect(parsed.coverage).toBe("full");
    expect(parsed.abilities).toEqual([
      {
        on: ["play"],
        acts: [
          { k: "returnToHand", s: { each: { type: "Creature", house: "Mars" } } },
          { k: "forgeKey", n: 1, mod: 9, less: { p: "hand" }, optional: true, then: true },
        ],
      },
    ]);
    // O "you may" é do FORGE (keyteki: `then: { may: 'forge a key' }` — o registrar
    // não tem `optional`): o return é obrigatório, então a ability mista mantém o
    // contrato do Onda 2 ("keeps a mixed ability mandatory"), o doc de
    // Ability.optional ("Every act is a 'You may' clause") e a forma paralela do
    // Redeem (dsl9) — `optional: true` só no ato do forge.
    expect(parsed.abilities[0].optional).toBeUndefined();
  });

  it("declining the forge still returns the Mars creatures (the 'you may' is the forge's)", () => {
    // keyteki spec: "should return creatures to hand and not prompt to forge…" —
    // o return acontece SEMPRE; recusar o forge não o cancela.
    const setup = (amber: number) => {
      const spell = card("Key Abduction", { type: "Action", house: "Mars", text: KEY_ABDUCTION });
      const state = setupTest(
        { hand: [spell], inPlay: [card("Mindwarper", { house: "Mars", power: 3 })], amber },
        { inPlay: [card("Zorg", { house: "Mars", power: 3 })] },
        "Mars",
      );
      return { spell, state };
    };
    const played = setup(20);
    const forged = play(played.state, played.spell.instanceId);
    expect(forged.players[0].keys).toBe(1); // o forge resolve quando há amber
    expect(forged.players[0].board).toEqual([]);
    expect(forged.players[1].board).toEqual([]);
    const declined = setup(20);
    const returned = applyMove(declined.state, 0, { type: "play", instanceId: declined.spell.instanceId, decline: true });
    expect(returned.players[0].keys).toBe(0); // só o forge foi recusado
    expect(returned.players[0].board).toEqual([]);
    expect(returned.players[1].board).toEqual([]); // o return obrigatório aconteceu
  });
});

describe("the single-act If-you-do keeps the Lote 2 spelling", () => {
  it.each([
    ["Chota Hazri", CHOTA_HAZRI, "Creature", "Untamed", [{ k: "loseAmber", n: 1 }, { k: "forgeKey", n: 1, optional: true, if: DID }]],
    ["Finishing Blow", FINISHING_BLOW, "Action", "Shadows", [{ k: "destroy", s: "target" }, { k: "steal", n: 1, if: DID }]],
    ["Cleansing Wave", CLEANSING_WAVE, "Action", "Sanctum", [{ k: "heal", s: { each: { type: "Creature" } }, n: 1 }, { k: "gainAmber", n: 1, per: "did" }]],
    ["Dark Centurion", DARK_CENTURION, "Creature", "Redemption", [{ k: "moveAmber", n: 1, s: "target", to: "supply" }, { k: "ward", s: "target", if: DID }]],
  ])("%s", (title, text, type, house, acts) => {
    const parsed = parse(title, text, type, house);
    expect(parsed.coverage).toBe("full");
    expect(parsed.abilities[0].acts).toEqual(acts);
    expect(parsed.abilities[0].acts.every((act) => (act as { then?: unknown }).then === undefined)).toBe(true);
  });
});
