// SPDX-License-Identifier: AGPL-3.0-only
// Fail-closed specs of the lowering: what used to be ignored silently now rejects the card.
import { describe, expect, it } from "vitest";
import { Unsupported } from "./lambdas.mjs";
import { lowerCard } from "./lower.mjs";
import { parseCardSource } from "./parse.mjs";

const card = (body) => `const Card = require('../../Card.js');
class A extends Card {
    // text
    setupCardAbilities(ability) {
${body}
    }
}
A.id = 'a';
module.exports = A;
`;
const lower = (body) => lowerCard(parseCardSource(card(body)));
const reject = (body) => {
  try {
    lower(body);
  } catch (e) {
    expect(e).toBeInstanceOf(Unsupported);
    return `${e.code}:${e.detail}`;
  }
  return "ok";
};

describe("lowering fails closed (lower.mjs)", () => {
  it("baseline: the plain forms still lower", () => {
    expect(reject("        this.play({ gameAction: ability.actions.steal({ amount: 2 }) });")).toBe("ok");
    expect(lower("        this.reap({ fight: true, gameAction: ability.actions.draw() });").abilities[0].on.sort()).toEqual(["fight", "reap"]);
  });

  it("rejects an object spread in action arguments", () => {
    expect(reject("        const x = {};\n        this.play({ gameAction: ability.actions.steal({ ...x, amount: 2 }) });")).toMatch(/^custom|^spread/);
    expect(reject("        this.play({ gameAction: ability.actions.steal({ ...base, amount: 2 }) });")).toBe("spread:object spread or computed key");
  });

  it("rejects a computed key", () => {
    expect(reject("        this.play({ gameAction: ability.actions.steal({ [k]: 2 }) });")).toBe("spread:object spread or computed key");
  });

  it("rejects play/reap/fight: true on a reaction instead of swallowing it", () => {
    const body = (flag) => `        this.reaction({ when: { onReap: (event, context) => event.card === context.source }, ${flag}: true, gameAction: ability.actions.draw() });`;
    expect(reject(body("play"))).toBe("prop:play");
    expect(reject(body("fight"))).toBe("prop:fight");
  });

  it("rejects registrar arguments beyond the first", () => {
    expect(reject("        this.play({ gameAction: ability.actions.draw() }, { extra: true });")).toBe("registrar:play extra arguments");
  });

  it("rejects a non-literal targetController instead of guessing friendly", () => {
    const body = (tc) => `        this.persistentEffect({ targetController: ${tc}, match: (card) => card.type === 'creature', effect: ability.effects.modifyPower(1) });`;
    expect(reject(body("someVar"))).toBe("dynamic:targetController");
    expect(reject(body("'bogus'"))).toBe("dynamic:targetController");
    expect(reject(body("'opponent'"))).not.toBe("dynamic:targetController");
  });
});

describe("lowering matches the engine's reading (M3 triage)", () => {
  it("whole-ability optional marks every act, or the engine never offers the decline move", () => {
    const l = lower("        this.play({ optional: true, gameAction: ability.actions.draw() });").abilities[0];
    expect(l.optional).toBe(true);
    expect(l.acts.every((a) => a.optional)).toBe(true);
  });

  it("keywords granted by a trait match only reach creatures", () => {
    const e = lower("        this.persistentEffect({ targetController: 'any', match: (card) => card.hasTrait('mutant'), effect: ability.effects.addKeyword({ elusive: 1 }) });").effects[0];
    expect(e.target).toEqual({ type: "Creature", trait: "Mutant" });
  });

  it("drops the creaturesInPlay guard that the creature target already implies", () => {
    const l = lower("        this.action({ condition: (context) => context.game.creaturesInPlay.length > 0, target: { cardType: 'creature', gameAction: ability.actions.enrage() } });").abilities[0];
    expect(l.if).toBeUndefined();
  });
});

// Lote 15a (M2): o `then` do keyteki vira o vocabulário de cadeias do DSL v14.
// Formas reais do corpus (Finishing Blow, Chota Hazri, Key Abduction, Art
// Project, Cover Operation, Ragnarok Prep) — a grafia segue o parser de texto:
// "If you do" de um ato só = `if: did`; a cadeia ("Then, X" / bloco / anáfora
// preThenEvent) = `then: true`. O `may` do bloco desce só para os atos dele.
const DID = { k: "count", of: "did", op: "gte", n: 1 };

describe("lowering maps keyteki then-chains (M2)", () => {
  it("a bare then of one act is the single 'If you do' (Finishing Blow shape)", () => {
    const l = lower(
      "        this.play({ target: { cardType: 'creature', cardCondition: (card) => card.hasToken('damage'), gameAction: ability.actions.destroy() }, then: { gameAction: ability.actions.steal() } });",
    ).abilities[0];
    expect(l.target).toEqual({ type: "Creature", damaged: true });
    expect(l.acts).toEqual([
      { k: "destroy", s: "target" },
      { k: "steal", n: 1, if: DID },
    ]);
    // a forma de função do then (Dark Centurion) lê o alvo escolhido da ability
    const fn = lower(
      "        this.play({ target: { cardType: 'creature', gameAction: ability.actions.destroy() }, then: (context) => ({ gameAction: ability.actions.ward({ target: context.target }) }) });",
    ).abilities[0];
    expect(fn.acts).toEqual([
      { k: "destroy", s: "target" },
      { k: "ward", s: "target", if: DID },
    ]);
  });

  it("the then-block's `may` marks only its own acts optional (Chota Hazri shape)", () => {
    const l = lower(
      "        this.play({ gameAction: ability.actions.loseAmber((context) => ({ target: context.player })), then: { may: 'forge a key', gameAction: ability.actions.forgeKey() } });",
    ).abilities[0];
    expect(l.acts).toEqual([
      { k: "loseAmber", n: 1 },
      { k: "forgeKey", n: 1, optional: true, if: DID },
    ]);
    // "o 'you may' é do forge": recusar o link não pode pular o ato obrigatório.
    expect(l.optional).toBeUndefined();
  });

  it("alwaysTriggers + may opens the chain link (Key Abduction shape)", () => {
    const l = lower(
      "        this.play({ gameAction: ability.actions.makeTokenCreature(), then: { may: 'forge a key', alwaysTriggers: true, gameAction: ability.actions.forgeKey() } });",
    ).abilities[0];
    expect(l.acts).toEqual([
      { k: "makeToken", n: 1 },
      { k: "forgeKey", n: 1, optional: true, then: true },
    ]);
  });

  it("a block of several acts shares the chain link (Art Project shape)", () => {
    const l = lower(
      "        this.play({ gameAction: ability.actions.draw(), then: { gameAction: [ability.actions.purge(), ability.actions.draw((context) => ({ target: context.player.opponent, amount: 10 }))] } });",
    ).abilities[0];
    expect(l.acts).toEqual([
      { k: "draw", n: 1 },
      { k: "purge", s: "self", then: true },
      { k: "draw", n: 10, opp: true, then: true },
    ]);
  });

  it("the preThenEvent anaphora is the `moved` selection (Cover Operation shape)", () => {
    const l = lower(
      "        this.play({ gameAction: ability.actions.makeTokenCreature(), then: { gameAction: ability.actions.ready((context) => ({ target: context.preThenEvent.card })) } });",
    ).abilities[0];
    expect(l.acts).toEqual([
      { k: "makeToken", n: 1 },
      { k: "ready", s: "moved", then: true },
    ]);
  });

  it("then.condition rides the chain act (Ragnarok Prep shape)", () => {
    const l = lower(
      "        this.play({ gameAction: ability.actions.makeTokenCreature(), then: { alwaysTriggers: true, condition: (context) => context.player.creaturesInPlay.length > context.player.opponent.creaturesInPlay.length, gameAction: ability.actions.loseAmber({ amount: 2 }) } });",
    ).abilities[0];
    expect(l.acts).toEqual([
      { k: "makeToken", n: 1 },
      { k: "loseAmber", n: 2, opp: true, then: true, if: { k: "moreCreatures" } },
    ]);
  });

  it("nested then-chains keep appending linked acts", () => {
    const l = lower(
      "        this.play({ gameAction: ability.actions.draw(), then: { alwaysTriggers: true, gameAction: ability.actions.draw(), then: { alwaysTriggers: true, gameAction: ability.actions.draw() } } });",
    ).abilities[0];
    expect(l.acts).toEqual([
      { k: "draw", n: 1 },
      { k: "draw", n: 1, then: true },
      { k: "draw", n: 1, then: true },
    ]);
  });

  it("without a then the lowering is unchanged", () => {
    expect(lower("        this.play({ gameAction: ability.actions.draw() });").abilities).toEqual([{ on: ["play"], acts: [{ k: "draw", n: 1 }] }]);
    expect(lower("        this.play({ optional: true, gameAction: ability.actions.draw() });").abilities).toEqual([
      { on: ["play"], acts: [{ k: "draw", n: 1, optional: true }], optional: true },
    ]);
  });

  it("rejects the then shapes the mapping would guess about", () => {
    // alvo próprio dentro do bloco (Yzphyz Knowdrone): fora do vocabulário, não à moda velha
    expect(reject("        this.play({ gameAction: ability.actions.draw(), then: { target: { cardType: 'creature', gameAction: ability.actions.destroy() } } });")).toBe("prop:then.target");
    // `alwaysTriggers: 'true'` (string) existe no corpus — o map não adivinha
    expect(reject("        this.play({ gameAction: ability.actions.draw(), then: { alwaysTriggers: 'true', gameAction: ability.actions.draw() } });")).toBe("prop:then.alwaysTriggers");
    expect(reject("        this.play({ gameAction: ability.actions.draw(), then: { may: true, gameAction: ability.actions.draw() } });")).toBe("dynamic:then.may");
  });
});
