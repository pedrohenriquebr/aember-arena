// SPDX-License-Identifier: AGPL-3.0-only
// Caça a bugs — specs adversárias sobre as áreas RECÉM-adicionadas do motor
// (Act.then / Selection "moved" / explicitDid, mostStat/lowest, nextTurn +
// sourceId, attackKeywords/whenAttacking, skipForgeStep, Restrict.who "any",
// control/controlCards duráveis, observador temporário de lasting, fallback por
// textHash). Cada bloco combina o que jogadores reais provocam: guarda `if`
// falhando no MEIO de um bloco then, recusa de "You may" matando o bloco,
// ward/armor interferindo no "If you do" (gate de did), janelas nextTurn
// sobrepostas, morte da fonte/da controlada no meio da janela, duas cartas de
// texto idêntico em lados opostos com override de uma só.
// Referência de semântica: keyteki (ThenAbility.resolveThenIfNeeded — "If you
// do" = events.every(e => !e.cancelled); DealDamageAction.checkEventCondition —
// armorUsed>0 ainda conta como evento; Card.js ward interrupt — cancel:true).
import { afterEach, describe, expect, it } from "vitest";
import { rulesOf, setAbilityOverrides, type AbilityOverride, type PersistentEffect } from "./abilities";
import { textHash } from "./cardText";
import { applyMove, chooseHouse, endTurn, effectivePower, isLegalMove, keyword, type CardFace, type GameState } from "./game";
import { byTitle, card, setupTest, titles } from "./testkit";

afterEach(() => setAbilityOverrides(new Map()));

const DID = { k: "count", of: "did", op: "gte", n: 1 } as const;
const overrideFor = (c: CardFace, dsl: AbilityOverride["dsl"], effects: PersistentEffect[] = []): AbilityOverride => ({
  cardId: c.id,
  dsl,
  effects,
  keywords: {},
  textHash: textHash(c.text),
  source: "manual",
  reviewed: true,
  generatedAt: 1,
});
const play = (state: GameState, id: string, target?: string, decline = false) =>
  applyMove(state, 0, { type: "play", instanceId: id, ...(target ? { target } : {}), ...(decline ? { decline: true } : {}) });
/** Passa o turno e deixa o lado que entrou escolher casa (o endTurn zera activeHouse). */
const passTurn = (state: GameState, side: 0 | 1, house?: string) => {
  const next = endTurn(state, side);
  const pick = house ?? next.players[next.activePlayer].houses[0];
  next.players[next.activePlayer].houses = [...next.players[next.activePlayer].houses, pick];
  return chooseHouse(next, next.activePlayer, pick);
};

describe("Act.then: guardas e recusa no meio do bloco", () => {
  // "Make a token creature. Then, if <cond>, X. Then, Y." — a guarda do ato do
  // MEIO falhando zera o gate e o resto do bloco morre (Lote 15a: um link
  // pulado — if falso, "You may" recusado — mata os `then` seguintes).
  const chain: AbilityOverride["dsl"] = [
    {
      on: ["play"],
      acts: [
        { k: "makeToken", n: 1 },
        { k: "gainAmber", n: 5, then: true, if: { k: "amber", opp: true, op: "gte", n: 99 } },
        { k: "draw", n: 2, then: true },
      ],
    },
  ];

  it("a guarda falsa no MEIO do bloco mata o ato seguinte (e a token criada fica)", () => {
    const spell = card("Midchain", { type: "Action", house: "Dis", text: "Play: …" });
    setAbilityOverrides(new Map([[spell.face.id, overrideFor(spell.face, chain)]]));
    const cast = play(setupTest({ hand: [spell], deck: [card("D1", { house: "Dis" }), card("D2", { house: "Dis" })] }, { amber: 3 }, "Dis"), spell.instanceId);
    expect(cast.players[0].board.map((c) => c.face.title)).toEqual(["Token Creature"]); // o gate abriu
    expect(cast.players[0].amber).toBe(0); // o ato do meio não resolveu
    expect(cast.players[0].hand).toEqual([]); // e o then seguinte morreu com ele
  });

  it("contra-caso: com a guarda verdadeira os dois links resolvem", () => {
    const spell = card("Midchain", { type: "Action", house: "Dis", text: "Play: …" });
    setAbilityOverrides(new Map([[spell.face.id, overrideFor(spell.face, chain)]]));
    // a guarda lê o âmbar do OPONENTE (opp: true) — 99 ali libera o bloco
    const cast = play(setupTest({ hand: [spell], deck: [card("D1", { house: "Dis" }), card("D2", { house: "Dis" })] }, { amber: 99 }, "Dis"), spell.instanceId);
    expect(cast.players[0].amber).toBe(5);
    expect(cast.players[0].hand.map((c) => c.face.title).sort()).toEqual(["D1", "D2"]);
  });

  // "If you do, X, and Y" — X opcional recusado deve matar Y mesmo quando Y tem
  // alvo vivo (prova que foi a RECUSA, não o alvo esgotado).
  const ifYouDo: AbilityOverride["dsl"] = [
    {
      on: ["play"],
      acts: [
        { k: "destroy", s: { each: { type: "Creature", damaged: true } } },
        { k: "gainAmber", n: 4, then: true, optional: true },
        { k: "stun", s: { each: { type: "Creature", side: "enemy" } }, then: true },
      ],
    },
  ];
  const blockSetup = () => {
    const spell = card("Compound", { type: "Action", house: "Dis", text: "Play: …" });
    setAbilityOverrides(new Map([[spell.face.id, overrideFor(spell.face, ifYouDo)]]));
    const hurt = card("Hurt", { house: "Dis", power: 3 });
    hurt.damage = 1;
    const fresh = card("Fresh", { house: "Dis", power: 3 });
    return { spell, hurt, fresh, state: setupTest({ hand: [spell] }, { inPlay: [hurt, fresh] }, "Dis") };
  };

  it("recusar o X opcional mata o Y — mesmo com alvo vivo para o Y", () => {
    const { spell, hurt, state } = blockSetup();
    const cast = play(state, spell.instanceId, hurt.instanceId, true);
    expect(cast.players[1].board.map((c) => c.face.title)).toEqual(["Fresh"]); // o destroy aconteceu
    expect(cast.players[0].amber).toBe(0); // X recusado
    expect(byTitle(cast.players[1].board, "Fresh")?.stunned).toBeFalsy(); // Y morto com o bloco
  });

  it("aceitando o X, o Y resolve (contra-caso do bloco inteiro)", () => {
    const { spell, hurt, state } = blockSetup();
    const cast = play(state, spell.instanceId, hurt.instanceId);
    expect(cast.players[0].amber).toBe(4);
    expect(byTitle(cast.players[1].board, "Fresh")?.stunned).toBe(true);
  });

  it("aceitando o X com o Y SEM alvo: X resolve, Y é no-op sem crash (alvo esgotado)", () => {
    const spell = card("Compound", { type: "Action", house: "Dis", text: "Play: …" });
    setAbilityOverrides(new Map([[spell.face.id, overrideFor(spell.face, ifYouDo)]]));
    const hurt = card("Hurt", { house: "Dis", power: 3 });
    hurt.damage = 1;
    const cast = play(setupTest({ hand: [spell] }, { inPlay: [hurt] }, "Dis"), spell.instanceId, hurt.instanceId);
    expect(cast.players[0].amber).toBe(4);
    expect(cast.players[1].board).toEqual([]);
  });
});

describe("mostStat/lowest: empates, vazio e o stat de amber", () => {
  // Standardized Testing (print real) — dois efeitos mostStat na MESMA ability:
  // o primeiro mata o extremo baixo, o segundo re-avalia o alto sobre o resto.
  const STANDARDIZED = "Play: Destroy each creature with the lowest power and each creature with the highest power.\n";
  it("empate nos DOIS extremos: os quatro morrem", () => {
    const spell = card("Standardized Testing", { type: "Action", house: "Logos", text: STANDARDIZED });
    const cast = play(
      setupTest({ hand: [spell] }, { inPlay: [card("Low A", { house: "Dis", power: 2 }), card("Low B", { house: "Mars", power: 2 }), card("High A", { house: "Logos", power: 7 }), card("High B", { house: "Dis", power: 7 })] }, "Logos"),
      spell.instanceId,
    );
    expect(cast.players[1].board).toEqual([]);
  });

  it("mostStat de armor com empate mata o grupo inteiro; board vazio é no-op", () => {
    const dsl: AbilityOverride["dsl"] = [{ on: ["play"], acts: [{ k: "destroy", s: { each: { type: "Creature", mostStat: "armor" } } }] }];
    const spell = card("Armor Sweep", { type: "Action", house: "Dis", text: "Play: …" });
    setAbilityOverrides(new Map([[spell.face.id, overrideFor(spell.face, dsl)]]));
    const cast = play(
      setupTest({ hand: [spell] }, { inPlay: [card("Plate", { house: "Dis", power: 3, armor: 2 }), card("Plate 2", { house: "Mars", power: 3, armor: 2 }), card("Naked", { house: "Logos", power: 3 })] }, "Dis"),
      spell.instanceId,
    );
    expect(titles(cast.players[1].board)).toEqual(["Naked"]);
    const emptySpell = card("Armor Sweep", { type: "Action", house: "Dis", text: "Play: …" });
    setAbilityOverrides(new Map([[emptySpell.face.id, overrideFor(emptySpell.face, dsl)]]));
    const empty = play(setupTest({ hand: [emptySpell] }, {}, "Dis"), emptySpell.instanceId);
    expect(empty.players[1].board).toEqual([]);
    expect(empty.players[0].hand).toEqual([]);
  });

  // mostStat "amber" = o amber SOBRE a criatura (capturado/exaltado) — keyteki
  // `cardStat: (card) => card.amber` (Word of Returning: "for each Æmber on
  // it"). O amber IMPRESSO (bonus) nunca é "amber on it": um bicho com 2A
  // impressos e 0 em cima NÃO vence o com 1A capturado.
  it("mostStat amber lê o amber SOBRE a criatura, não o impresso", () => {
    const dsl: AbilityOverride["dsl"] = [{ on: ["play"], acts: [{ k: "destroy", s: { each: { type: "Creature", mostStat: "amber" } } }] }];
    const spell = card("Amber Sweep", { type: "Action", house: "Dis", text: "Play: …" });
    setAbilityOverrides(new Map([[spell.face.id, overrideFor(spell.face, dsl)]]));
    const rich = card("Rich Worn", { house: "Dis", power: 3 });
    rich.amber = 1;
    const printed = card("Printed", { house: "Mars", power: 3, amber: 2 });
    const cast = play(setupTest({ hand: [spell] }, { inPlay: [rich, printed] }, "Dis"), spell.instanceId);
    expect(titles(cast.players[1].board)).toEqual(["Printed"]);
    // contra-caso: com amber em cima, quem tem o máximo é que morre
    const spell2 = card("Amber Sweep", { type: "Action", house: "Dis", text: "Play: …" });
    setAbilityOverrides(new Map([[spell2.face.id, overrideFor(spell2.face, dsl)]]));
    const richer = card("Rich Worn", { house: "Dis", power: 3 });
    richer.amber = 3;
    const cast2 = play(setupTest({ hand: [spell2] }, { inPlay: [richer, printed] }, "Dis"), spell2.instanceId);
    expect(titles(cast2.players[1].board)).toEqual(["Printed"]);
  });
});

describe("o gate de did do 'If you do' contra ward e armor (keyteki)", () => {
  // keyteki Card.js: o ward CANCELA o evento de destroy/damage (changeEvent
  // cancel:true) — o ThenAbility ("If you do") só dispara com todos os eventos
  // não-cancelados. Um destroy PREVENIDO pelo ward não aconteceu.
  it("Finishing Blow contra um alvo warded NÃO rouba (o destroy foi cancelado)", () => {
    // Print real do corpus (glyph U+F360 do Æmber incluso — sem ele o parser lê vanilla).
    const FINISHING = "Play: Destroy a damaged creature. If you do, steal 1.\n";
    const spell = card("Finishing Blow", { type: "Action", house: "Shadows", text: FINISHING });
    const hurt = card("Hurt", { house: "Dis", power: 3 });
    hurt.damage = 1;
    hurt.warded = 1;
    const cast = play(setupTest({ hand: [spell] }, { inPlay: [hurt], amber: 5 }, "Shadows"), spell.instanceId, hurt.instanceId);
    expect(byTitle(cast.players[1].board, "Hurt")).toBeDefined(); // ward consumido, criatura viva
    expect(byTitle(cast.players[1].board, "Hurt")?.warded).toBe(0);
    expect(cast.players[0].amber).toBe(0); // o "If you do" NÃO abriu
    // contra-caso: sem ward o destroy acontece e o steal resolve
    const spell2 = card("Finishing Blow", { type: "Action", house: "Shadows", text: FINISHING });
    const hurt2 = card("Hurt", { house: "Dis", power: 3 });
    hurt2.damage = 1;
    const clean = play(setupTest({ hand: [spell2] }, { inPlay: [hurt2], amber: 5 }, "Shadows"), spell2.instanceId, hurt2.instanceId);
    expect(clean.players[1].board).toEqual([]);
    expect(clean.players[0].amber).toBe(1);
  });

  // DealDamageAction.checkEventCondition: `!event.amount && !event.armorUsed`
  // ainda conta como evento — dano TODO absorvido por armor NÃO cancela o
  // evento ("If you do" abre); ward sim (unwardAndCancel).
  const selfDamage: AbilityOverride["dsl"] = [
    { on: ["action"], acts: [{ k: "damage", n: 2, s: "self" }, { k: "gainAmber", n: 3, if: DID }] },
  ];

  it("dano absorvido TODO pela armor ainda abre o 'If you do' (evento aconteceu)", () => {
    const self = card("Self Hitter", { type: "Creature", house: "Dis", text: "Action: …", power: 6, armor: 2 });
    setAbilityOverrides(new Map([[self.face.id, overrideFor(self.face, selfDamage)]]));
    const cast = applyMove(setupTest({ inPlay: [self] }, {}, "Dis"), 0, { type: "use", instanceId: self.instanceId });
    expect(cast.players[0].board[0].damage).toBe(0);
    expect(cast.players[0].board[0].armorUsed).toBe(2);
    expect(cast.players[0].amber).toBe(3); // armorUsed>0 = evento resolvido (keyteki)
  });

  it("dano CANCELADO pelo ward não abre o 'If you do' (warded deixa de contar como did)", () => {
    const self = card("Self Hitter", { type: "Creature", house: "Dis", text: "Action: …", power: 6 });
    self.warded = 1;
    setAbilityOverrides(new Map([[self.face.id, overrideFor(self.face, selfDamage)]]));
    const cast = applyMove(setupTest({ inPlay: [self] }, {}, "Dis"), 0, { type: "use", instanceId: self.instanceId });
    expect(cast.players[0].board[0].warded).toBe(0);
    expect(cast.players[0].amber).toBe(0);
  });

  it("dano aplicado abre o gate (contra-caso)", () => {
    const self = card("Self Hitter", { type: "Creature", house: "Dis", text: "Action: …", power: 6 });
    setAbilityOverrides(new Map([[self.face.id, overrideFor(self.face, selfDamage)]]));
    const cast = applyMove(setupTest({ inPlay: [self] }, {}, "Dis"), 0, { type: "use", instanceId: self.instanceId });
    expect(cast.players[0].board[0].damage).toBe(2);
    expect(cast.players[0].amber).toBe(3);
  });
});

describe("nextTurn sobreposto + sourceId", () => {
  it("duas janelas nextTurn criadas no MESMO turno expiram juntas no fim do seu próximo turno", () => {
    const bearer = card("Bearer", { type: "Creature", house: "Mars", text: "Play: …", power: 3 });
    setAbilityOverrides(new Map([[bearer.face.id, overrideFor(bearer.face, [
      { on: ["play"], acts: [{ k: "lasting", e: { target: { self: true }, power: 2, duration: "nextTurn" } }] },
      { on: ["play"], acts: [{ k: "lasting", e: { target: { self: true }, power: 3, duration: "nextTurn" } }] },
    ])]]));
    const cast = play(setupTest({ hand: [bearer] }, {}, "Mars"), bearer.instanceId);
    const powered = cast.players[0].board[0];
    expect(effectivePower(cast, powered)).toBe(8);
    const foeTurn = passTurn(cast, 0);
    expect(effectivePower(foeTurn, foeTurn.players[0].board[0])).toBe(8);
    const myNext = passTurn(foeTurn, 1);
    expect(effectivePower(myNext, myNext.players[0].board[0])).toBe(8);
    const after = passTurn(myNext, 0);
    expect(effectivePower(after, after.players[0].board[0])).toBe(3);
  });

  it("uma janela criada no turno seguinte SOBREVIVE à primeira (expirações independentes)", () => {
    const bearer = card("Bearer", { type: "Creature", house: "Mars", text: "Action: …", power: 3 });
    setAbilityOverrides(new Map([[bearer.face.id, overrideFor(bearer.face, [
      { on: ["action"], acts: [{ k: "lasting", e: { target: { self: true }, power: 2, duration: "nextTurn" } }] },
    ])]]));
    const cast = applyMove(setupTest({ inPlay: [bearer] }, {}, "Mars"), 0, { type: "use", instanceId: bearer.instanceId });
    expect(effectivePower(cast, cast.players[0].board[0])).toBe(5);
    const foeTurn = passTurn(cast, 0); // pronto de novo no ready step
    expect(effectivePower(foeTurn, foeTurn.players[0].board[0])).toBe(5);
    const myNext = passTurn(foeTurn, 1, "Mars"); // meu próximo turno (a casa ativa precisa ser a da carta)
    expect(effectivePower(myNext, myNext.players[0].board[0])).toBe(5);
    // uso de novo: a segunda janela abre com prazo próprio (stamp + 3 daqui)
    const again = applyMove(myNext, 0, { type: "use", instanceId: myNext.players[0].board[0].instanceId });
    expect(effectivePower(again, again.players[0].board[0])).toBe(7);
    // fim do meu próximo turno: só a primeira expira
    const split = passTurn(again, 0);
    expect(effectivePower(split, split.players[0].board[0])).toBe(5);
    const back = passTurn(passTurn(split, 1), 0);
    expect(effectivePower(back, back.players[0].board[0])).toBe(3); // a segunda expira uma volta depois
  });

  it("sourceId: a janela self fica inerte com a fonte fora de jogo e poda limpa", () => {
    const bearer = card("Bearer", { type: "Creature", house: "Mars", text: "Play: …", power: 3 });
    const killer = card("Killer", { type: "Action", house: "Mars", text: "Play: …" });
    setAbilityOverrides(new Map([
      [bearer.face.id, overrideFor(bearer.face, [{ on: ["play"], acts: [{ k: "lasting", e: { target: { self: true }, power: 2, duration: "nextTurn" } }] }])],
      [killer.face.id, overrideFor(killer.face, [{ on: ["play"], target: { type: "Creature" }, acts: [{ k: "destroy", s: "target" }] }])],
    ]));
    const cast = play(setupTest({ hand: [bearer, killer] }, {}, "Mars"), bearer.instanceId);
    expect(effectivePower(cast, cast.players[0].board[0])).toBe(5);
    // a fonte sai de jogo no meio da janela: o efeito guardado fica inerte
    const slain = play(cast, killer.instanceId, cast.players[0].board[0].instanceId);
    expect(slain.players[0].board).toEqual([]);
    expect(slain.lasting ?? []).toHaveLength(1); // a janela ainda existe…
    const pruned = passTurn(passTurn(passTurn(slain, 0), 1), 0);
    expect(pruned.lasting ?? []).toEqual([]); // …mas expira limpa
  });
});

describe("lasting com gatilho: observador temporário", () => {
  // O observador concedido pelo lasting tem o MESMO desdobramento do observer
  // de board: alvo auto-escolhido (s:"target"), captura de who e stamp. Um
  // observador com `target` não pode simplesmente não selecionar nada.
  it("o observador concedido auto-escolhe o alvo do próprio ability (s:'target')", () => {
    const hive = card("Hunter Hive", { type: "Creature", house: "Mars", text: "Action: …", power: 3 });
    setAbilityOverrides(new Map([[hive.face.id, overrideFor(hive.face, [
      {
        on: ["action"],
        acts: [
          {
            k: "lasting",
            e: {
              target: { self: true },
              duration: "turn",
              abilities: [{ on: ["reap"], of: { type: "Creature" }, target: { type: "Creature", damaged: true }, acts: [{ k: "destroy", s: "target" }] }],
            },
          },
        ],
      },
    ])]]));
    const reaper = card("Reaper", { type: "Creature", house: "Mars", power: 3 });
    const wounded = card("Wounded", { house: "Dis", power: 5 });
    wounded.damage = 2;
    const cast = applyMove(setupTest({ inPlay: [hive, reaper] }, { inPlay: [wounded] }, "Mars"), 0, { type: "use", instanceId: hive.instanceId });
    const after = applyMove(cast, 0, { type: "reap", instanceId: cast.players[0].board.find((c) => c.face.title === "Reaper")!.instanceId });
    expect(byTitle(after.players[1].board, "Wounded")).toBeUndefined(); // o alvo do observer morreu
  });

  // Anti-laço: o observador concede "cada vez que uma criatura reaps, destrua ~".
  // A primeira ocorrência mata a fonte; as seguintes não têm mais observador —
  // o movimento termina dentro dos budgets, sem RangeError.
  it("o observador que mata a PRÓPRIA fonte se desarma sozinho (anti-laço)", () => {
    const hive = card("Suicide Hive", { type: "Creature", house: "Mars", text: "Action: …", power: 3 });
    setAbilityOverrides(new Map([[hive.face.id, overrideFor(hive.face, [
      {
        on: ["action"],
        acts: [
          {
            k: "lasting",
            e: {
              target: { self: true },
              duration: "turn",
              abilities: [{ on: ["reap"], of: { type: "Creature" }, acts: [{ k: "destroy", s: "self" }] }],
            },
          },
        ],
      },
    ])]]));
    const reaper = card("Reaper", { type: "Creature", house: "Mars", power: 3 });
    const reaper2 = card("Reaper 2", { type: "Creature", house: "Mars", power: 3 });
    const cast = applyMove(setupTest({ inPlay: [hive, reaper, reaper2] }, {}, "Mars"), 0, { type: "use", instanceId: hive.instanceId });
    expect(cast.players[0].board.map((c) => c.face.title)).toEqual(["Suicide Hive", "Reaper", "Reaper 2"]);
    const first = applyMove(cast, 0, { type: "reap", instanceId: cast.players[0].board.find((c) => c.face.title === "Reaper")!.instanceId });
    // a fonte morreu com o primeiro reap
    expect(first.players[0].discard.map((c) => c.face.title)).toContain("Suicide Hive");
    // o segundo reap não tem mais observador: nada explode, o orçamento sobra
    const second = applyMove(first, 0, { type: "reap", instanceId: first.players[0].board.find((c) => c.face.title === "Reaper 2")!.instanceId });
    expect(second.players[0].board.map((c) => c.face.title)).toEqual(["Reaper", "Reaper 2"]); // os dois reapers vivos
    expect(second.players[0].discard.map((c) => c.face.title)).toEqual(["Suicide Hive"]); // só a fonte morreu
    expect(second.players[0].amber).toBe(2); // os dois reaps, nenhum efeito extra
  });
});

describe("takeControl durável: morte da controlada e da fonte", () => {
  const hookDsl: AbilityOverride["dsl"] = [
    { on: ["action"], acts: [{ k: "lasting", e: { target: { type: "Creature", side: "enemy" }, control: "you", duration: "turn" } }] },
  ];

  it("a criatura controlada MORRE antes do fim da janela: a expiração é no-op", () => {
    const hook = card("Mind Hook", { type: "Creature", house: "Dis", text: "Action: …", power: 3 });
    const killer = card("Killer", { type: "Action", house: "Dis", text: "Play: …" });
    setAbilityOverrides(new Map([
      [hook.face.id, overrideFor(hook.face, hookDsl)],
      [killer.face.id, overrideFor(killer.face, [{ on: ["play"], target: { type: "Creature" }, acts: [{ k: "destroy", s: "target" }] }])],
    ]));
    const foe = card("Foe", { house: "Dis", power: 3 });
    const cast = applyMove(setupTest({ hand: [killer], inPlay: [hook] }, { inPlay: [foe] }, "Dis"), 0, { type: "use", instanceId: hook.instanceId });
    expect(titles(cast.players[0].board)).toContain("Foe");
    const taken = cast.players[0].board.find((c) => c.face.title === "Foe")!;
    const slain = play(cast, killer.instanceId, taken.instanceId);
    expect(slain.players[1].discard.map((c) => c.face.title)).toContain("Foe"); // volta ao DONO
    const over = passTurn(slain, 0); // a expiração não pode ressuscitar nem mover nada
    expect(over.players[0].board.map((c) => c.face.title)).toEqual(["Mind Hook"]);
    expect(over.players[1].board).toEqual([]);
    expect(over.players[1].discard.map((c) => c.face.title)).toContain("Foe");
    expect(over.lasting ?? []).toEqual([]);
  });

  // O `boundTo` do control devolve a carta quando a fonte sai (Lote 15e), mas o
  // reset de "volta como estava antes da forma de criatura" é do materialize —
  // aplicado a uma criatura controlada ele CURAVA e READYava a carta (bug).
  it("a fonte MORRE no meio da janela: a controlada volta ao dono COM seu estado", () => {
    const hook = card("Mind Hook", { type: "Creature", house: "Dis", text: "Action: …", power: 3 });
    const killer = card("Killer", { type: "Action", house: "Dis", text: "Play: …" });
    setAbilityOverrides(new Map([
      [hook.face.id, overrideFor(hook.face, hookDsl)],
      [killer.face.id, overrideFor(killer.face, [{ on: ["play"], target: { type: "Creature" }, acts: [{ k: "destroy", s: "target" }] }])],
    ]));
    const foe = card("Foe", { house: "Dis", power: 3 });
    foe.damage = 2;
    foe.ready = false;
    const cast = applyMove(setupTest({ hand: [killer], inPlay: [hook] }, { inPlay: [foe] }, "Dis"), 0, { type: "use", instanceId: hook.instanceId });
    const taken = cast.players[0].board.find((c) => c.face.title === "Foe")!;
    expect(taken.ready).toBe(false);
    const dead = play(cast, killer.instanceId, cast.players[0].board.find((c) => c.face.title === "Mind Hook")!.instanceId);
    const back = dead.players[1].board.find((c) => c.face.title === "Foe");
    expect(back).toBeDefined(); // devolvida ao dono quando a fonte saiu
    expect(back?.damage).toBe(2); // NÃO curada (o reset é só do artifact materializado)
    expect(back?.ready).toBe(false); // NÃO readiada
  });
});

describe("fallback por textHash: duas cópias do mesmo texto em lados opostos", () => {
  const TEXT = "Reap: Gain 2.";

  it("a linha de UMA carta alcança a gêmea do oponente (texto igual = regra igual)", () => {
    const twinA = card("Twin A", { id: "corpus-1", text: TEXT, type: "Creature", house: "Dis", power: 3 });
    const twinB = card("Twin B", { id: "mv-2", text: TEXT, type: "Creature", house: "Dis", power: 3 });
    setAbilityOverrides(new Map([[twinA.face.id, overrideFor(twinA.face, [{ on: ["reap"], acts: [{ k: "gainAmber", n: 2 }] }])]]));
    const state = setupTest({ inPlay: [twinA] }, { inPlay: [twinB] }, "Dis");
    const mine = applyMove(state, 0, { type: "reap", instanceId: twinA.instanceId });
    expect(mine.players[0].amber).toBe(3); // 1 do reap + 2 da linha
    const theirs = applyMove(state, 1, { type: "reap", instanceId: twinB.instanceId });
    expect(theirs.players[1].amber).toBe(3); // o vazamento é POR DESIGN (mesmo texto)
  });

  it("o dono da linha por id VENCE o fallback de hash", () => {
    const twinA = card("Twin A", { id: "corpus-1", text: TEXT, type: "Creature", house: "Dis", power: 3 });
    const twinB = card("Twin B", { id: "mv-2", text: TEXT, type: "Creature", house: "Dis", power: 3 });
    setAbilityOverrides(new Map([
      [twinA.face.id, overrideFor(twinA.face, [{ on: ["reap"], acts: [{ k: "gainAmber", n: 2 }] }])],
      [twinB.face.id, overrideFor(twinB.face, [{ on: ["reap"], acts: [{ k: "gainAmber", n: 5 }] }])],
    ]));
    const state = setupTest({ inPlay: [twinA] }, { inPlay: [twinB] }, "Dis");
    const mine = applyMove(state, 0, { type: "reap", instanceId: twinA.instanceId });
    expect(mine.players[0].amber).toBe(3); // 1 + 2 (a linha por id da A)
    const theirs = applyMove(state, 1, { type: "reap", instanceId: twinB.instanceId });
    expect(theirs.players[1].amber).toBe(6); // 1 + 5 (a linha por id da B — não a da A)
  });

  it("uma linha OBsoleta no id não bloqueia a linha do texto atual (hash)", () => {
    // face cujo texto mudou depois da linha antiga (hash divergente no id) —
    // quem tem o texto ATUAL escrito em outra linha (outro id) deve ganhar do
    // parser: texto igual = regra igual.
    const stale = card("Stale Face", { id: "corpus-stale", text: "Play: Draw 2 cards.", type: "Action", house: "Dis", power: 0 });
    const old: CardFace = { ...stale.face, text: "Play: Draw 1 card." };
    setAbilityOverrides(new Map([
      [stale.face.id, overrideFor(old, [{ on: ["play"], acts: [{ k: "draw", n: 9 }] }])],
      ["other-id", overrideFor(stale.face, [{ on: ["play"], acts: [{ k: "draw", n: 4 }] }])],
    ]));
    expect(rulesOf(stale.face).abilities).toEqual([{ on: ["play"], acts: [{ k: "draw", n: 4 }] }]);
  });
});

describe("skipForgeStep: duas Miasmas + forjar por carta", () => {
  const MIASMA = "Play: Your opponent skips the “forge a key” step during their next turn.";

  it("o passo é pulado mas um 'forge a key' de carta continua valendo", () => {
    const one = card("Miasma", { type: "Action", house: "Shadows", text: MIASMA });
    const two = card("Miasma", { type: "Action", house: "Shadows", text: MIASMA });
    const forgeCard = card("Key Smith", { type: "Action", house: "Dis", text: "Play: …" });
    setAbilityOverrides(new Map([[forgeCard.face.id, overrideFor(forgeCard.face, [{ on: ["play"], acts: [{ k: "forgeKey", n: 1, free: true }] }])]]));
    const state = setupTest({ hand: [one, two] }, { hand: [forgeCard], amber: 8 }, "Shadows");
    const cast = play(play(state, one.instanceId), two.instanceId);
    expect((cast.lasting ?? []).length).toBe(2);
    const skipped = passTurn(cast, 0);
    // as DUAS cópias foram consumidas no mesmo passo, e o passo não forjou
    expect(skipped.lasting ?? []).toEqual([]);
    expect(skipped.players[1].keys).toBe(0);
    expect(skipped.players[1].amber).toBe(8);
    // …mas o forge POR CARTA não é o passo: ele forja
    const forged = applyMove(skipped, 1, { type: "play", instanceId: skipped.players[1].hand[0].instanceId });
    expect(forged.players[1].keys).toBe(1);
  });

  it("contra-caso: sem Miasma o passo do oponente forja normalmente", () => {
    const control = passTurn(setupTest({}, { amber: 8 }, "Shadows"), 0);
    expect(control.players[1].keys).toBe(1);
    expect(control.players[1].amber).toBe(2);
  });
});

describe("attackKeywords: atacante x defensor", () => {
  const poison = (c: CardFace): AbilityOverride => ({ ...overrideFor(c, []), effects: [{ target: { self: true }, attackKeywords: { poison: 1 } }] });

  it("o defensor NÃO ganha o próprio attackKeywords ao defender (só quem ataca)", () => {
    const bug = card("Att Bug", { type: "Creature", house: "Dis", text: "", power: 10 });
    const wall = card("Def Bug", { type: "Creature", house: "Logos", text: "", power: 5 });
    setAbilityOverrides(new Map([[bug.face.id, poison(bug.face)], [wall.face.id, poison(wall.face)]]));
    const next = applyMove(setupTest({ inPlay: [bug] }, { inPlay: [wall] }, "Dis"), 0, { type: "fight", attackerId: bug.instanceId, targetId: wall.instanceId });
    // o atacante envenenou o defensor (e o matou)…
    expect(next.players[1].board).toEqual([]);
    // …mas o contra-ataque do defensor NÃO veio envenenado: o atacante sobrevive
    const survivor = next.players[0].board[0];
    expect(survivor.face.title).toBe("Att Bug");
    expect(survivor.damage).toBe(5);
    expect(survivor.poisoned).toBeFalsy();
    expect(keyword(next, survivor, "poison")).toBe(0); // fora da luta o grant não existe
  });

  it("o poison do defensor também não vaza para o ataque do oponente", () => {
    const plain = card("Plain Att", { type: "Creature", house: "Dis", text: "", power: 10 });
    const wall = card("Def Bug", { type: "Creature", house: "Logos", text: "", power: 5 });
    setAbilityOverrides(new Map([[wall.face.id, poison(wall.face)]]));
    const next = applyMove(setupTest({ inPlay: [plain] }, { inPlay: [wall] }, "Dis"), 0, { type: "fight", attackerId: plain.instanceId, targetId: wall.instanceId });
    const survivor = next.players[0].board[0];
    expect(survivor.damage).toBe(5);
    expect(survivor.poisoned).toBeFalsy();
  });
});

describe("Restrict.who 'any': os dois lados, outras ações", () => {
  it("'creatures cannot fight' fecha a luta DOS DOIS lados", () => {
    const ward = card("Peace Bond", { type: "Creature", house: "Dis", text: "", power: 3 });
    setAbilityOverrides(new Map([[ward.face.id, { ...overrideFor(ward.face, []), effects: [{ target: {}, restrict: { who: "any", action: "fight" } }] }]]));
    const mine = card("My Fighter", { type: "Creature", house: "Dis", power: 5 });
    const foe = card("Foe Fighter", { type: "Creature", house: "Dis", power: 5 });
    const state = setupTest({ inPlay: [ward, mine] }, { inPlay: [foe] }, "Dis");
    expect(isLegalMove(state, 0, { type: "fight", attackerId: mine.instanceId, targetId: foe.instanceId })).toBe(false);
    expect(isLegalMove(state, 1, { type: "fight", attackerId: foe.instanceId, targetId: mine.instanceId })).toBe(false);
  });

  it("o play-limit de who 'any' conta para os dois lados", () => {
    const tax = card("Play Tax", { type: "Creature", house: "Dis", text: "", power: 3 });
    setAbilityOverrides(new Map([[tax.face.id, { ...overrideFor(tax.face, []), effects: [{ target: {}, restrict: { who: "any", action: "play", limit: 1 } }] }]]));
    const a = card("One", { type: "Creature", house: "Dis", power: 3 });
    const b = card("Two", { type: "Creature", house: "Dis", power: 3 });
    const state = setupTest({ hand: [a, b], inPlay: [tax] }, {}, "Dis");
    expect(isLegalMove(state, 0, { type: "play", instanceId: a.instanceId })).toBe(true);
    const mid = play(state, a.instanceId);
    expect(isLegalMove(mid, 0, { type: "play", instanceId: b.instanceId })).toBe(false);
  });
});

describe("explicitDid: atos sem assinatura ainda abrem o gate", () => {
  it("peek num alvo vazio NÃO abre o 'If you do'; com o que olhar, abre", () => {
    const spy = card("Spyglass", { type: "Artifact", house: "Dis", text: "Action: …" });
    setAbilityOverrides(new Map([[spy.face.id, overrideFor(spy.face, [
      { on: ["action"], acts: [{ k: "peek", from: "hand", opp: true }, { k: "gainAmber", n: 1, if: DID }] },
    ])]]));
    const empty = applyMove(setupTest({ inPlay: [spy] }, {}, "Dis"), 0, { type: "use", instanceId: spy.instanceId });
    expect(empty.players[0].amber).toBe(0);
    const full = applyMove(setupTest({ inPlay: [spy] }, { hand: [card("Secret", { house: "Dis" })] }, "Dis"), 0, { type: "use", instanceId: spy.instanceId });
    expect(full.players[0].amber).toBe(1);
  });

  it("setHouse conta como did (houseAs não entra na assinatura)", () => {
    const tuner = card("House Tuner", { type: "Artifact", house: "Dis", text: "Action: …" });
    setAbilityOverrides(new Map([[tuner.face.id, overrideFor(tuner.face, [
      { on: ["action"], acts: [{ k: "setHouse", s: "self", house: "Mars" }, { k: "gainAmber", n: 2, if: DID }] },
    ])]]));
    const cast = applyMove(setupTest({ inPlay: [tuner] }, {}, "Dis"), 0, { type: "use", instanceId: tuner.instanceId });
    expect(cast.players[0].board[0].houseAs).toBe("Mars");
    expect(cast.players[0].amber).toBe(2);
  });
});

describe("Selection 'moved' quando o makeToken não criou nada", () => {
  it("um makeToken vazio zera o moved: o 'ready it' não alcança o token anterior", () => {
    const maker = card("Token Maker", { type: "Action", house: "Dis", text: "Play: …" });
    setAbilityOverrides(new Map([[maker.face.id, overrideFor(maker.face, [
      {
        on: ["play"],
        acts: [
          { k: "makeToken", n: 1 },
          { k: "makeToken", n: 1, per: { c: { type: "Creature", house: "Mars" } } }, // 0 Marte = 0 tokens
          { k: "ready", s: "moved" },
        ],
      },
    ])]]));
    const cast = play(setupTest({ hand: [maker] }, {}, "Dis"), maker.instanceId);
    expect(cast.players[0].board.map((c) => c.face.title)).toEqual(["Token Creature"]);
    expect(cast.players[0].board[0].ready).toBe(false); // moved vazio = nada a readiar
  });

  it("makeToken vazio zera o did: um then atrás dele não resolve", () => {
    const maker = card("Token Maker 2", { type: "Action", house: "Dis", text: "Play: …" });
    setAbilityOverrides(new Map([[maker.face.id, overrideFor(maker.face, [
      {
        on: ["play"],
        acts: [
          { k: "makeToken", n: 1, per: { c: { type: "Creature", house: "Mars" } } },
          { k: "ready", s: "moved", then: true },
          { k: "gainAmber", n: 7, then: true },
        ],
      },
    ])]]));
    const cast = play(setupTest({ hand: [maker] }, {}, "Dis"), maker.instanceId);
    expect(cast.players[0].board).toEqual([]);
    expect(cast.players[0].amber).toBe(0);
  });
});
