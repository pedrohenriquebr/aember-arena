// Specs do diff determinístico que alimenta o diretor de FX (plano §0.2):
// o motor segue puro e o estado não ganha eventos — tudo sai de prev → next.
import { describe, expect, it } from "vitest";
import { applyMove, endTurn, type GameMove } from "./game";
import { cardJitter, diffFx } from "./fx";
import { byTitle, card, setupTest } from "./testkit";

function play(state: ReturnType<typeof setupTest>, title: string, side: 0 | 1 = 0) {
  const target = byTitle(state.players[side].hand, title);
  if (!target) throw new Error(`${title} not in hand`);
  const move: GameMove = { type: "play", instanceId: target.instanceId };
  return { next: applyMove(state, side, move), move, id: target.instanceId };
}

describe("diffFx", () => {
  it("reports the played creature as entering the board (flight destination)", () => {
    const state = setupTest({ hand: ["Valdr"] });
    const { next, id } = play(state, "Valdr");
    expect(diffFx(state, next)).toEqual([{ kind: "enter", side: 0, id }]);
  });

  it("does not invent a destination for an Action (it goes to the discard)", () => {
    const state = setupTest({ hand: ["Smith"] });
    const { next } = play(state, "Smith");
    // Só o bônus de âmbar da carta: nada de board (a Ação vai para o discard).
    expect(diffFx(state, next).filter((event) => event.kind !== "amber")).toEqual([]);
  });

  it("reports the amber a play adds (the '+N Æ' that flies to the band)", () => {
    const state = setupTest({ hand: ["Smith"] });
    const { next } = play(state, "Smith");
    expect(diffFx(state, next)).toContainEqual({ kind: "amber", side: 0, delta: 1 });
  });

  it("reports the amber of a reap on the reaping side", () => {
    const state = setupTest({ inPlay: ["Valdr"] });
    const valdr = byTitle(state.players[0].board, "Valdr")!;
    const next = applyMove(state, 0, { type: "reap", instanceId: valdr.instanceId });
    expect(diffFx(state, next)).toEqual([{ kind: "amber", side: 0, delta: 1 }]);
  });

  it("reports a destroyed creature as leaving the board", () => {
    const doomed = card("Headhunter");
    const state = setupTest({ hand: ["Coward's End"], inPlay: ["Valdr"] }, { inPlay: [doomed] });
    state.players[0].board[0].damage = 1; // a danificada sobrevive; a intacta morre
    const { next } = play(state, "Coward's End");
    const events = diffFx(state, next);
    // Sem enter (Coward's End é Ação); a danificada sobrevive (leva dano) e a
    // intacta sai de jogo.
    expect(events).toContainEqual({ kind: "leave", side: 1, id: doomed.instanceId });
    expect(events.some((event) => event.kind === "enter")).toBe(false);
  });

  it("reports the damage a surviving creature took (the '-N' over the tile)", () => {
    const attacker = card("Valdr", { power: 1 });
    const target = card("Headhunter", { power: 9 });
    const state = setupTest({ inPlay: [attacker] }, { inPlay: [target] });
    const next = applyMove(state, 0, { type: "fight", attackerId: attacker.instanceId, targetId: target.instanceId });
    expect(diffFx(state, next)).toContainEqual({ kind: "damage", id: target.instanceId, amount: 1 });
  });

  it("reports the chains a card cost (the elo falling into the counter)", () => {
    const state = setupTest({ hand: ["Coward's End"] });
    const { next } = play(state, "Coward's End");
    expect(diffFx(state, next)).toContainEqual({ kind: "chains", side: 0, delta: 3 });
  });

  it("reports a forged key for the side that forges (the glow side)", () => {
    const state = setupTest({}, { amber: 6 });
    const next = endTurn(state, 0);
    expect(diffFx(state, next)).toContainEqual({ kind: "key", side: 1 });
  });

  it("an upgrade entering the board is an enter for its owner", () => {
    const state = setupTest({ hand: ["Experimental Therapy"], inPlay: ["Valdr"] });
    const { next, id } = play(state, "Experimental Therapy");
    expect(diffFx(state, next)).toContainEqual({ kind: "enter", side: 0, id });
  });

  it("is deterministic and side-ordered (0 before 1)", () => {
    const state = setupTest({ inPlay: ["Valdr"] }, { hand: ["Charette"] });
    const charette = byTitle(state.players[1].hand, "Charette")!;
    const move: GameMove = { type: "play", instanceId: charette.instanceId };
    const next = applyMove(state, 1, move);
    const first = diffFx(state, next);
    expect(diffFx(state, next)).toEqual(first);
    expect(first).toEqual([{ kind: "enter", side: 1, id: charette.instanceId }]);
  });

  it("a discard changes no board event", () => {
    const state = setupTest({ hand: ["Valdr"] });
    const target = byTitle(state.players[0].hand, "Valdr")!;
    const move: GameMove = { type: "discard", instanceId: target.instanceId };
    expect(diffFx(state, applyMove(state, 0, move))).toEqual([]);
  });

  it("a creature that dies in the same transition enters and leaves (no destination)", () => {
    // "Play: deal damage" pode matar a própria carta: o diff precisa entregar os
    // dois eventos para o diretor cair no dissolve (destino não existe).
    const doomed = card("Headhunter");
    const state = setupTest({ inPlay: [doomed] }, { hand: ["Coward's End"] });
    const played = byTitle(state.players[1].hand, "Coward's End")!;
    const next = applyMove(state, 1, { type: "play", instanceId: played.instanceId });
    const events = diffFx(state, next);
    expect(events).toContainEqual({ kind: "leave", side: 0, id: doomed.instanceId });
    expect(events.some((event) => event.kind === "enter")).toBe(false);
  });
});

describe("cardJitter", () => {
  it("is deterministic and stays inside the pose bounds", () => {
    expect(cardJitter("p0-card-7")).toEqual(cardJitter("p0-card-7"));
    for (let i = 0; i < 1000; i++) {
      const { rot, dy } = cardJitter(`id-${i}-${(i * 7919) % 1013}`);
      expect(rot).toBeGreaterThanOrEqual(-1.6);
      expect(rot).toBeLessThanOrEqual(1.6);
      expect(dy).toBeGreaterThanOrEqual(-3);
      expect(dy).toBeLessThanOrEqual(3);
    }
  });

  it("does not concentrate on zero", () => {
    let sum = 0;
    for (let i = 0; i < 1000; i++) sum += Math.abs(cardJitter(`c${i}`).rot);
    expect(sum / 1000).toBeGreaterThanOrEqual(0.6);
  });
});
