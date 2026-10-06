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

  it("alwaysTriggers + may is an UNGATED follow-up (Key Abduction shape)", () => {
    // Lote 15b (triagem M3): `alwaysTriggers` é o ANTI-gate do keyteki
    // (ThenAbility.resolveThenIfNeeded: o bloco dispara mesmo com zero eventos —
    // spec "should prompt to forge a key even if no mars creatures are returned").
    // Virar `then: true` aqui matava o forge quando o return era vácuo.
    const l = lower(
      "        this.play({ gameAction: ability.actions.makeTokenCreature(), then: { may: 'forge a key', alwaysTriggers: true, gameAction: ability.actions.forgeKey() } });",
    ).abilities[0];
    expect(l.acts).toEqual([
      { k: "makeToken", n: 1 },
      { k: "forgeKey", n: 1, optional: true },
    ]);
  });

  it("alwaysTriggers without may is an UNGATED follow-up (Edge of the World shape)", () => {
    // "Move a creature to a flank of its battleline. Steal 1A." — o print não tem
    // "Then,": o steal acontece mesmo quando o move é vácuo.
    const l = lower(
      "        this.play({ target: { cardType: 'creature', gameAction: ability.actions.moveToFlank() }, then: { alwaysTriggers: true, gameAction: ability.actions.steal() } });",
    ).abilities[0];
    expect(l.acts).toEqual([
      { k: "toFlank", s: "target" },
      { k: "steal", n: 1 },
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

  it("then.condition rides the act; alwaysTriggers drops the link (Ragnarok/Radix shapes)", () => {
    // Lote 15b (triagem M3): com `alwaysTriggers` a condição é o ÚNICO gate
    // (Radix of Suffering: "Your opponent loses 1A. If your opponent has no A,
    // draw 1 card." — o draw acontece com o oponente já em 0 âmbar).
    const l = lower(
      "        this.play({ gameAction: ability.actions.makeTokenCreature(), then: { alwaysTriggers: true, condition: (context) => context.player.creaturesInPlay.length > context.player.opponent.creaturesInPlay.length, gameAction: ability.actions.loseAmber({ amount: 2 }) } });",
    ).abilities[0];
    expect(l.acts).toEqual([
      { k: "makeToken", n: 1 },
      { k: "loseAmber", n: 2, opp: true, if: { k: "moreCreatures" } },
    ]);
    // sem alwaysTriggers o link continua ("Then, if <cond>, X" compartilha o gate)
    const linked = lower(
      "        this.play({ gameAction: ability.actions.makeTokenCreature(), then: { condition: (context) => context.player.creaturesInPlay.length > context.player.opponent.creaturesInPlay.length, gameAction: ability.actions.loseAmber({ amount: 2 }) } });",
    ).abilities[0];
    expect(linked.acts).toEqual([
      { k: "makeToken", n: 1 },
      { k: "loseAmber", n: 2, opp: true, then: true, if: { k: "moreCreatures" } },
    ]);
  });

  it("nested then-chains keep appending acts", () => {
    // alwaysTriggers em cascata = follow-ups em cascata, todos sem gate
    const l = lower(
      "        this.play({ gameAction: ability.actions.draw(), then: { alwaysTriggers: true, gameAction: ability.actions.draw(), then: { alwaysTriggers: true, gameAction: ability.actions.draw() } } });",
    ).abilities[0];
    expect(l.acts).toEqual([
      { k: "draw", n: 1 },
      { k: "draw", n: 1 },
      { k: "draw", n: 1 },
    ]);
    // then puro em cascata: cada link é o "If you do" do ato imediatamente antes
    const bare = lower(
      "        this.play({ gameAction: ability.actions.draw(), then: { gameAction: ability.actions.draw(), then: { gameAction: ability.actions.draw() } } });",
    ).abilities[0];
    expect(bare.acts).toEqual([
      { k: "draw", n: 1 },
      { k: "draw", n: 1, if: DID },
      { k: "draw", n: 1, if: DID },
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

// Lote 15b (target-select): os targetingModes do keyteki viram as grafias do
// parser — `mode: 'exactly'|'upTo'` + `numCards` = pick Selection; `mode:
// 'house'` = a escolha de casa (os filtros dos gameAction leem
// `house: "chosen"` via hasHouse(context.house)).
describe("lowering maps keyteki target modes (Lote 15b)", () => {
  it("target.mode 'exactly'/'upTo' + numCards become the pick selection", () => {
    // Lights Out ("Return 2 enemy creatures to their owner's hand")
    const exact = lower(
      "        this.play({ target: { mode: 'exactly', numCards: 2, controller: 'opponent', cardType: 'creature', gameAction: ability.actions.returnToHand() } });",
    ).abilities[0];
    expect(exact.target).toBeUndefined();
    expect(exact.acts).toEqual([{ k: "returnToHand", s: { pick: { type: "Creature", side: "enemy" }, n: 2 } }]);
    // Nature's Call ("Return up to 3 creatures to their owners hands")
    const upTo = lower(
      "        this.play({ target: { mode: 'upTo', numCards: 3, cardType: 'creature', gameAction: ability.actions.returnToHand() } });",
    ).abilities[0];
    expect(upTo.acts).toEqual([{ k: "returnToHand", s: { pick: { type: "Creature" }, n: 3, upTo: true } }]);
  });

  it("target.mode 'house' is the house choice — the filters read `house: \"chosen\"`", () => {
    // Blinding Light ("Choose a house. Stun each creature of that house.")
    const l = lower(
      "        this.play({ target: { mode: 'house' }, gameAction: ability.actions.stun((context) => ({ target: context.game.creaturesInPlay.filter((card) => card.hasHouse(context.house)) })) });",
    ).abilities[0];
    expect(l.target).toBeUndefined();
    expect(l.acts).toEqual([{ k: "stun", s: { each: { type: "Creature", house: "chosen" } } }]);
  });

  it("rejects the target modes the mapping would guess about", () => {
    expect(reject("        this.play({ target: { mode: 'random', numCards: 1, cardType: 'creature', gameAction: ability.actions.returnToHand() } });")).toBe("target:mode random");
    expect(reject("        this.play({ target: { mode: 'exactly', cardType: 'creature', gameAction: ability.actions.returnToHand() } });")).toBe("target:exactly without numCards");
    expect(reject("        this.play({ target: { mode: 'house', cardType: 'creature', gameAction: ability.actions.returnToHand() } });")).toBe("target:house mode with card target");
  });
});

// Lote 15c (pacote de tabelas): dynamic-amount (o map de lambdas resolve o
// `amount` dinâmico em n x per), triggers-novos (gatilhos que o MOTOR já
// dispara: wakePlayer/fire/fireObservers em game.ts) e action-zones.
describe("lowering maps dynamic amounts (Lote 15c)", () => {
  it("an amount the lambda map knows becomes n x per (fn body and bare expr)", () => {
    // corpo-fn: (context) => ({ amount: … }) — Dr Escotera ("for each forged key")
    const fn = lower(
      "        this.play({ gameAction: ability.actions.gainAmber((context) => ({ amount: context.player.opponent ? context.player.opponent.getForgedKeys() : 0 })) });",
    ).abilities[0];
    expect(fn.acts).toEqual([{ k: "gainAmber", n: 1, per: { p: "keys", opp: true } }]);
    // expr nu no objeto: { amount: … } — Drumble/Envy (pool do oponente)
    const bare = lower("        this.play({ gameAction: ability.actions.gainAmber({ amount: context.player.amber }) });").abilities[0];
    expect(bare.acts).toEqual([{ k: "gainAmber", n: 1, per: { p: "amber" } }]);
    // metade arredondada para baixo — Rant and Rive ("lose half their amber")
    const half = lower(
      "        this.play({ gameAction: ability.actions.loseAmber((context) => ({ target: context.player.opponent, amount: Math.floor(context.player.opponent.amber / 2) })) });",
    ).abilities[0];
    expect(half.acts).toEqual([{ k: "loseAmber", n: 1, opp: true, per: { p: "amber", opp: true, div: 2 } }]);
  });

  it("an amount the map does not know still fails closed", () => {
    expect(reject("        this.play({ gameAction: ability.actions.gainAmber((context) => ({ amount: context.player.opponent.getForgedKeys() + 1 })) });")).toMatch(/^dynamic:gainAmber\.amount/);
    expect(reject("        this.play({ gameAction: ability.actions.gainAmber({ amount: context.player.opponent.hand.length * 2 }) });")).toMatch(/^dynamic:gainAmber\.amount/);
  });
});

describe("lowering maps the triggers the engine already fires (Lote 15c)", () => {
  it("onChooseActiveHouse with the house literal is the self+active gate (Jehu shape)", () => {
    const l = lower(
      "        this.reaction({ when: { onChooseActiveHouse: (event, context) => event.player === context.player && event.house === 'sanctum' }, gameAction: ability.actions.gainAmber({ amount: 2 }) });",
    ).abilities[0];
    expect(l.on).toEqual(["house"]);
    expect(l.if).toEqual({ k: "count", of: { c: { self: true, house: "active" } }, op: "gte", n: 1 });
    expect(l.acts).toEqual([{ k: "gainAmber", n: 2 }]);
  });

  it("onTurnStart reads this.game.activePlayer and the player shape (Liam Say)", () => {
    const turn = lower("        this.reaction({ when: { onTurnStart: (_, context) => context.player === this.game.activePlayer }, gameAction: ability.actions.draw() });").abilities[0];
    expect(turn.on).toEqual(["startOfTurn"]);
    expect(turn.if).toBeUndefined();
    const player = lower("        this.reaction({ when: { onTurnStart: (event, context) => event.player === context.player }, gameAction: ability.actions.draw() });").abilities[0];
    expect(player.on).toEqual(["startOfTurn"]);
  });

  it("onCardEntersPlay filters the event card and reaches s: \"event\" (Autocannon shape)", () => {
    const l = lower(
      "        this.reaction({ when: { onCardEntersPlay: (event) => event.card.type === 'creature' }, gameAction: ability.actions.dealDamage((context) => ({ amount: 1, target: context.event.card })) });",
    ).abilities[0];
    expect(l.on).toEqual(["enter"]);
    expect(l.of).toEqual({ type: "Creature" });
    expect(l.acts).toEqual([{ k: "damage", n: 1, s: "event" }]);
  });

  it("rejects the trigger keys the engine has no event for (engineGap)", () => {
    expect(reject("        this.reaction({ when: { onUseCard: (event) => event.card === context.source }, gameAction: ability.actions.draw() });")).toBe("event:onUseCard");
    expect(reject("        this.reaction({ when: { onDamageApplied: (event) => event.card === context.source }, gameAction: ability.actions.draw() });")).toBe("event:onDamageApplied");
    // variante do oponente de um gatilho preso ao turno: sem evento
    expect(reject("        this.reaction({ when: { onTurnStart: (event, context) => event.player === context.player.opponent }, gameAction: ability.actions.draw() });")).toBe("event:onTurnStart (opponent turn)");
  });
});

describe("lowering maps the zone actions (Lote 15c)", () => {
  it("archive/unstun/removeAmber mirror acts the engine already has", () => {
    const arch = lower("        this.play({ target: { cardType: 'creature', gameAction: ability.actions.archive() } });").abilities[0];
    expect(arch.acts).toEqual([{ k: "archive", s: "target" }]);
    const unstun = lower("        this.play({ gameAction: ability.actions.removeStun((context) => ({ target: context.player.creaturesInPlay })) });").abilities[0];
    expect(unstun.acts).toEqual([{ k: "unstun", s: { each: { type: "Creature", side: "friendly" } } }]);
    const amber = lower("        this.play({ target: { cardType: 'creature', gameAction: ability.actions.removeAmber({ amount: 1 }) } });").abilities[0];
    expect(amber.acts).toEqual([{ k: "moveAmber", n: 1, s: "target", to: "supply" }]);
  });

  it("placeAmber (supply -> creature) stays unsupported (engineGap: o capture debita um pool)", () => {
    expect(reject("        this.play({ target: { cardType: 'creature', gameAction: ability.actions.placeAmber({ amount: 2 }) } });")).toBe("action:placeAmber");
  });
});

describe("lowering maps 'exactly 1' as the single target (Lote 15c)", () => {
  it("a one-card exact pick is the classic target, not the engine-auto pick (Wurm Tunnel shape)", () => {
    // regressão: o pick {n:1} fazia o ENGINE escolher; o print "Move 1A from a
    // creature" é escolha do jogador (s:"target" + ability.target).
    const l = lower(
      "        this.play({ target: { mode: 'exactly', numCards: 1, cardType: 'creature', gameAction: ability.actions.removeAmber({ amount: 1 }) } });",
    ).abilities[0];
    expect(l.target).toEqual({ type: "Creature" });
    expect(l.acts).toEqual([{ k: "moveAmber", n: 1, s: "target", to: "supply" }]);
    // dois ou mais continua pick (a escolha do engine)
    const two = lower(
      "        this.play({ target: { mode: 'exactly', numCards: 2, controller: 'opponent', cardType: 'creature', gameAction: ability.actions.returnToHand() } });",
    ).abilities[0];
    expect(two.acts).toEqual([{ k: "returnToHand", s: { pick: { type: "Creature", side: "enemy" }, n: 2 } }]);
  });
});

// Lote 15d (lasting-effects): as ações de duração do keyteki viram o ato
// `lasting` com a janela certa (turn/next/nextTurn do motor v16).
describe("lowering maps the lasting durations (Lote 15d)", () => {
  it("untilPlayerTurnEnd / duringOpponentNextTurn / untilPlayerNextTurnEnd carry their window", () => {
    const turn = lower("        this.play({ gameAction: ability.actions.untilPlayerTurnEnd({ match: (card) => card.type === 'creature', effect: ability.effects.modifyPower(2) }) });").abilities[0];
    expect(turn.acts).toEqual([{ k: "lasting", e: { target: { type: "Creature", side: "friendly" }, power: 2, duration: "turn" } }]);
    const next = lower("        this.play({ gameAction: ability.actions.untilPlayerNextTurnEnd({ match: (card) => card.type === 'creature', effect: ability.effects.modifyArmor(1) }) });").abilities[0];
    expect(next.acts).toEqual([{ k: "lasting", e: { target: { type: "Creature", side: "friendly" }, armor: 1, duration: "nextTurn" } }]);
  });

  it("cardCannot + targetController is the restrict row (Fogbank shape)", () => {
    const l = lower(
      "        this.play({ gameAction: ability.actions.duringOpponentNextTurn({ targetController: 'opponent', effect: ability.effects.cardCannot('fight') }) });",
    ).abilities[0];
    expect(l.acts).toEqual([{ k: "lasting", e: { target: {}, restrict: { action: "fight", who: "opponent" }, duration: "next" } }]);
  });

  it("lastingEffect reads a duration prop and the effect table (modifyKeyCost/changeHouse)", () => {
    const l = lower("        this.play({ gameAction: ability.actions.lastingEffect({ duration: 'untilPlayerNextTurnStart', match: (card) => card.type === 'creature', effect: ability.effects.modifyKeyCost(1) }) });").abilities[0];
    expect(l.acts).toEqual([{ k: "lasting", e: { target: { type: "Creature", side: "friendly" }, keyCost: 1, duration: "next" } }]);
    const house = lower("        this.play({ gameAction: ability.actions.untilPlayerTurnEnd({ match: (card) => card.type === 'creature', effect: ability.effects.changeHouse('mars') }) });").abilities[0];
    expect(house.acts).toEqual([{ k: "lasting", e: { target: { type: "Creature", side: "friendly" }, house: "Mars", duration: "turn" } }]);
  });

  it("rejects the lasting shapes the mapping would guess about", () => {
    // lasting COM gatilho ("gain 1 each time a creature reaps") — fora
    expect(reject("        this.play({ gameAction: ability.actions.untilPlayerTurnEnd((context) => ({ when: { onReap: () => true }, gameAction: ability.actions.gainAmber() })) });")).toBe("prop:lasting.when");
    // duração fora do mapa (untilLeavesPlay) não vira achismo
    expect(reject("        this.play({ gameAction: ability.actions.cardLastingEffect({ match: (card) => card.type === 'creature', until: 'untilLeavesPlay', effect: ability.effects.modifyPower(1) }) });")).toBe("lasting:until untilLeavesPlay");
    // efeito sem entrada na tabela
    expect(reject("        this.play({ gameAction: ability.actions.untilPlayerTurnEnd({ effect: ability.effects.takeControl() }) });")).toBe("effect:takeControl");
  });
});
