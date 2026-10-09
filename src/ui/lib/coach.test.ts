import { describe, expect, it } from "vitest";
import { advanceCoach, coachIndex, parseCoach, skipCoach, type CoachSnapshot, type CoachStep } from "./coach";

// UX_REWRITE_PLAN §5 H-24: a máquina dos coachmarks. Sequência feliz, passo fora de ordem não
// avança, pular encerra. O estado do jogo entra como snapshot (o App monta o par prev/next).
const turnStart: CoachSnapshot = { activeHouse: null, cardsPlayed: 0, yourTurn: true };
const houseChosen: CoachSnapshot = { ...turnStart, activeHouse: "Brobnar" };
const cardPlayed: CoachSnapshot = { ...houseChosen, cardsPlayed: 1 };
const turnPassed: CoachSnapshot = { ...cardPlayed, yourTurn: false };

/** Roda uma sequência de (prev, next) e devolve o passo final. */
function run(start: CoachStep, pairs: [CoachSnapshot, CoachSnapshot][]): CoachStep {
  return pairs.reduce((step, [prev, next]) => advanceCoach(step, prev, next), start);
}

describe("coach (H-24)", () => {
  it("sequência feliz: pickHouse → playCard → endTurn → done", () => {
    let step: CoachStep = "pickHouse";
    step = advanceCoach(step, turnStart, houseChosen);
    expect(step).toBe("playCard");
    step = advanceCoach(step, houseChosen, cardPlayed);
    expect(step).toBe("endTurn");
    step = advanceCoach(step, cardPlayed, turnPassed);
    expect(step).toBe("done");
  });

  it("a casa escolhida pelo Warden não conta: a dica do jogador só avança na vez dele", () => {
    const wardenHouse: CoachSnapshot = { activeHouse: "Logos", cardsPlayed: 0, yourTurn: false };
    expect(advanceCoach("pickHouse", turnStart, wardenHouse)).toBe("pickHouse");
  });

  it("fora de ordem não avança: carta antes da casa, troca de vez antes da carta", () => {
    expect(advanceCoach("pickHouse", turnStart, { ...turnStart, cardsPlayed: 1 })).toBe("pickHouse");
    expect(advanceCoach("playCard", houseChosen, { ...houseChosen, yourTurn: false })).toBe("playCard");
    expect(advanceCoach("playCard", turnStart, houseChosen)).toBe("playCard");
  });

  it("endTurn só avança com a troca de vez, não com outra carta", () => {
    expect(advanceCoach("endTurn", cardPlayed, cardPlayed)).toBe("endTurn");
    expect(advanceCoach("endTurn", cardPlayed, { ...cardPlayed, cardsPlayed: 2 })).toBe("endTurn");
  });

  it("done é terminal", () => {
    expect(run("done", [[turnStart, houseChosen], [houseChosen, cardPlayed]])).toBe("done");
  });

  it("pular encerra de qualquer passo", () => {
    expect(skipCoach()).toBe("done");
    expect(coachIndex(skipCoach())).toBeNull();
  });

  it("o número do balão vai de 1 a 3 e some no done", () => {
    expect([coachIndex("pickHouse"), coachIndex("playCard"), coachIndex("endTurn")]).toEqual([1, 2, 3]);
    expect(coachIndex("done")).toBeNull();
  });

  it("storage: ausente ou inválido vira done (sem dica fantasma)", () => {
    expect(parseCoach(null)).toBe("done");
    expect(parseCoach("qualquer")).toBe("done");
    expect(parseCoach("playCard")).toBe("playCard");
  });
});
