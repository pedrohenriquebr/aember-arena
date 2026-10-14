// SPDX-License-Identifier: AGPL-3.0-only
// QA-02: upgrade jogado no hospedeiro do adversário se desenha na lane do hospedeiro.
import { afterEach, describe, expect, it } from "vitest";
import { setAbilityOverrides, type PersistentEffect } from "./abilities";
import { textHash } from "./cardText";
import { canReady, endTurn, type CardInstance } from "./game";
import { partitionLane } from "./laneLayout";
import { card, setupTest } from "./testkit";

afterEach(() => setAbilityOverrides(new Map()));

const creature = (title: string, ready = true) => card(title, { type: "Creature", house: "Brobnar", power: 3, text: "" }, ready);
const upgrade = (title: string, host?: CardInstance): CardInstance => {
  const item = card(title, { type: "Upgrade", house: "Unfathomable", text: "" });
  item.attachedTo = host?.instanceId;
  return item;
};
const artifact = (title: string) => card(title, { type: "Artifact", house: "Brobnar", text: "" });
const ids = (cards: CardInstance[]) => cards.map((item) => item.face.title);

describe("partitionLane (QA-02)", () => {
  it("upgrade on an own host stays on the own lane, bound to the host column", () => {
    const [a, b] = [creature("A"), creature("B")];
    const up = upgrade("Up", b);
    const lane = partitionLane([a, b, up], []);
    expect(ids(lane.upgrades)).toEqual(["Up"]);
    expect(lane.hostCol.get(b.instanceId)).toBe(2);
    expect(lane.upgradeRank.get(up.instanceId)).toBe(1);
    expect(lane.artifacts).toEqual([]);
  });

  it("upgrade on an enemy host shows on the enemy lane and leaves the owner's strip", () => {
    const warden = creature("Warden");
    const mine = creature("Mine");
    const up = upgrade("Under Pressure", warden);
    const ownerLane = partitionLane([mine, up], [warden]);
    const enemyLane = partitionLane([warden], [mine, up]);
    expect(ids(ownerLane.attachments)).toEqual([]);
    expect(ids(ownerLane.artifacts)).toEqual([]);
    expect(ids(enemyLane.upgrades)).toEqual(["Under Pressure"]);
    expect(ids(enemyLane.attachments)).toEqual(["Under Pressure"]);
    expect(enemyLane.upgradeRank.get(up.instanceId)).toBe(1);
    expect(enemyLane.hostCol.get(warden.instanceId)).toBe(1);
  });

  it("ranks several upgrades on one host across both boards", () => {
    const host = creature("Host");
    const own = upgrade("Own", host);
    const foreign = upgrade("Foreign", host);
    const lane = partitionLane([host, own], [foreign]);
    expect(lane.upgradeRank.get(own.instanceId)).toBe(1);
    expect(lane.upgradeRank.get(foreign.instanceId)).toBe(2);
  });

  it("artifacts stay in the owner's strip and an orphan upgrade falls back to artifact", () => {
    const host = creature("Host");
    const relic = artifact("Relic");
    const orphan = upgrade("Orphan");
    orphan.attachedTo = "gone";
    const lane = partitionLane([host, relic, orphan], [creature("Foe")]);
    expect(ids(lane.artifacts)).toEqual(["Relic", "Orphan"]);
    expect(lane.upgrades).toEqual([]);
  });

  it("empty lanes are inert", () => {
    const lane = partitionLane([], [upgrade("X")]);
    expect(lane.attachments).toEqual([]);
  });
});

describe("motor: 'cannot ready' no hospedeiro inimigo (evidência QA-02)", () => {
  it("an upgrade on the opponent's creature blocks that creature's ready step", () => {
    const warden = creature("Warden", false);
    const up = upgrade("Under Pressure", warden);
    up.face = { ...up.face, text: "This creature cannot ready." };
    const effects: PersistentEffect[] = [{ target: { host: true }, noReady: true }];
    setAbilityOverrides(
      new Map([
        [up.face.id, { cardId: up.face.id, dsl: [], effects, textHash: textHash(up.face.text ?? ""), source: "manual", reviewed: true, generatedAt: 1 }],
      ]),
    );
    const state = setupTest({ inPlay: [up] }, { inPlay: [warden] }, "Unfathomable");
    expect(canReady(state, state.players[1].board[0], true)).toBe(false);
    // Opponent's ready step runs at the end of THEIR turn.
    expect(endTurn(state, 1).players[1].board[0].ready).toBe(false);
  });
});
