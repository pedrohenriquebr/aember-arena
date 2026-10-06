// SPDX-License-Identifier: AGPL-3.0-only
// Derived from keyteki card scripts (copyright keyteki contributors, AGPL-3.0).
// Specs of the keyteki AST reader and the M1 lowering, over verbatim copies of real
// card files (01-Core @ d9b239b) so they do not depend on the clone being present.
import { describe, expect, it } from "vitest";
import { Unsupported } from "./lambdas.mjs";
import { lowerCard } from "./lower.mjs";
import { parseCardSource } from "./parse.mjs";

const card = (cls, id, body) => `const Card = require('../../Card.js');
class ${cls} extends Card {
    // header of ${cls}
    setupCardAbilities(ability) {
${body}
    }
}
${cls}.id = '${id}';
module.exports = ${cls};
`;

const ANGER = card(
  "Anger",
  "anger",
  `        this.play({
            target: {
                cardType: 'creature',
                controller: 'self',
                gameAction: ability.actions.sequential([
                    ability.actions.ready(),
                    ability.actions.fight()
                ])
            },
            effect: 'ready and fight with {0}'
        });`,
);
const DEXTRE = card(
  "Dextre",
  "dextre",
  `        this.play({ gameAction: ability.actions.capture() });
        this.destroyed({ gameAction: ability.actions.returnToDeck() });`,
);
const TROLL = card("Troll", "troll", `        this.reap({ gameAction: ability.actions.heal({ amount: 3 }) });`);
const REMIEL = card(
  "CommanderRemiel",
  "commander-remiel",
  `        this.reap({
            target: {
                cardType: 'creature',
                controller: 'self',
                cardCondition: (card) => !card.hasHouse('sanctum'),
                gameAction: ability.actions.use()
            }
        });`,
);
const BUMPSY = card("Bumpsy", "bumpsy", `        this.play({ gameAction: ability.actions.loseAmber() });`);
const HALACOR = card(
  "Halacor",
  "halacor",
  `        this.persistentEffect({
            match: (card) => card.isOnFlank(),
            effect: ability.effects.addKeyword({ skirmish: 1 })
        });`,
);
const HELPER = card("Helper", "helper", `        const x = 1;\n        this.play({ gameAction: ability.actions.gainAmber() });`);

describe("keyteki AST reader (parse.mjs)", () => {
  it("reads Anger: class, id, header and the nested action tree", () => {
    const ir = parseCardSource(ANGER, "Anger.js");
    expect(ir).toMatchObject({ id: "anger", className: "Anger", header: "header of Anger" });
    expect(ir.regs).toHaveLength(1);
    expect(ir.regs[0].registrar).toBe("play");
    const bag = ir.regs[0].args[0];
    expect(bag.props.target.props.cardType).toEqual({ t: "lit", v: "creature" });
    const seq = bag.props.target.props.gameAction;
    expect(seq).toMatchObject({ t: "action", name: "sequential" });
    expect(seq.args[0].items.map((i) => i.name)).toEqual(["ready", "fight"]);
  });

  it("keeps lambdas as small trees, not strings", () => {
    const ir = parseCardSource(REMIEL, "CommanderRemiel.js");
    const cond = ir.regs[0].args[0].props.target.props.cardCondition;
    expect(cond).toEqual({
      t: "fn",
      params: ["card"],
      body: { t: "un", op: "!", arg: { t: "call", callee: { t: "member", obj: { t: "id", name: "card" }, prop: "hasHouse" }, args: [{ t: "lit", v: "sanctum" }] } },
    });
  });

  it("flags code outside setupCardAbilities", () => {
    expect(parseCardSource(HELPER).flags.complexSetup).toBe(true);
    expect(parseCardSource("class X extends Card { foo() {} }\nX.id='x';").flags).toMatchObject({ customMethods: true, noSetup: true });
  });
});

describe("keyteki lowering (lower.mjs)", () => {
  const lower = (src) => lowerCard(parseCardSource(src));

  it("Anger: ready, then use via fight, with a friendly creature target", () => {
    expect(lower(ANGER)).toEqual({
      abilities: [{ on: ["play"], target: { type: "Creature", side: "friendly" }, acts: [{ k: "ready", s: "target" }, { k: "use", via: "fight", s: "target" }] }],
      effects: [],
    });
  });

  it("Dextre: keyteki defaults (capture 1 onto self, returnToDeck on top)", () => {
    expect(lower(DEXTRE).abilities).toEqual([
      { on: ["play"], acts: [{ k: "capture", n: 1, s: "self" }] },
      { on: ["destroyed"], acts: [{ k: "returnToDeck", at: "top", s: "self" }] },
    ]);
  });

  it("Troll: an explicit amount; Bumpsy: the player action's default target is the opponent", () => {
    expect(lower(TROLL).abilities[0].acts).toEqual([{ k: "heal", n: 3, s: "self" }]);
    expect(lower(BUMPSY).abilities[0].acts).toEqual([{ k: "loseAmber", n: 1, opp: true }]);
  });

  it("Commander Remiel: the lambda becomes a filter and `use` needs a ready target", () => {
    expect(lower(REMIEL).abilities[0].target).toEqual({ type: "Creature", side: "friendly", house: "!Sanctum", ready: true });
  });

  it("persistentEffect: match lambda → target filter, flank implies Creature", () => {
    expect(lower(HALACOR).effects).toEqual([{ target: { flank: true, type: "Creature", side: "friendly" }, keywords: { skirmish: 1 } }]);
  });

  it("fails closed: unknown prop / helper / lambda / custom code", () => {
    const code = (src) => {
      try {
        lower(src);
      } catch (e) {
        expect(e).toBeInstanceOf(Unsupported);
        return e.code;
      }
      return "ok";
    };
    expect(code(card("A", "a", `        this.play({ gameAction: ability.actions.gainAmber({ bonus: true }) });`))).toBe("prop");
    expect(code(card("A", "a", `        this.play({ gameAction: ability.actions.search() });`))).toBe("action");
    expect(code(card("A", "a", `        this.play({ target: { cardCondition: (c) => c.name === 'X', gameAction: ability.actions.destroy() } });`))).toBe("lambda");
    // Lote 15a (M2): o `then` baixa para as cadeias do DSL v14; o que o
    // vocabulário não representa (um alvo dentro do bloco) continua fail-closed.
    expect(code(card("A", "a", `        this.play({ gameAction: ability.actions.destroy(), then: { gameAction: ability.actions.draw() } });`))).toBe("ok");
    expect(code(card("A", "a", `        this.play({ gameAction: ability.actions.destroy(), then: { target: { cardType: 'creature', gameAction: ability.actions.draw() } } });`))).toBe("prop");
    expect(code(HELPER)).toBe("custom");
  });
});
