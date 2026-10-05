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
