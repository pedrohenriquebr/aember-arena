// SPDX-License-Identifier: AGPL-3.0-only
import { type CardInstance, isCreatureCard } from "./game";

export type LanePartition = {
  creatures: CardInstance[];
  /** Anexos mostrados nesta lane: upgrades (próprios ou do outro lado) e artefatos. */
  attachments: CardInstance[];
  upgrades: CardInstance[];
  artifacts: CardInstance[];
  /** instanceId do hospedeiro -> coluna (1-based) na fileira de criaturas. */
  hostCol: Map<string, number>;
  /** instanceId do upgrade -> k-ésimo upgrade do seu hospedeiro. */
  upgradeRank: Map<string, number>;
};

/** Divide o board de uma lane em criaturas/upgrades/artefatos. O motor guarda o
    upgrade no board de quem o jogou (attachedTo -> hospedeiro), mas a UI o mostra
    na lane do HOSPEDEIRO: por isso recebe o board do outro jogador — seus upgrades
    cujo hospedeiro é criatura desta lane entram aqui, e os próprios cujo
    hospedeiro está na lane oposta saem da tira. Órfão (hospedeiro morreu) = artefato. */
export function partitionLane(own: CardInstance[], other: CardInstance[]): LanePartition {
  const creatures = own.filter((card) => isCreatureCard(card));
  const hostCol = new Map(creatures.map((card, index) => [card.instanceId, index + 1]));
  const otherHosts = new Set(other.filter((card) => isCreatureCard(card)).map((card) => card.instanceId));
  const isUpgrade = (card: CardInstance) => Boolean(card.attachedTo && hostCol.has(card.attachedTo));

  const ownAttachments = own.filter((card) => !isCreatureCard(card));
  const foreignUpgrades = other.filter((card) => !isCreatureCard(card) && isUpgrade(card));
  const upgrades = [...ownAttachments.filter(isUpgrade), ...foreignUpgrades];
  const artifacts = ownAttachments.filter((card) => !isUpgrade(card) && !(card.attachedTo && otherHosts.has(card.attachedTo)));

  const upgradeRank = new Map<string, number>();
  const perHost = new Map<string, number>();
  for (const card of upgrades) {
    const k = (perHost.get(card.attachedTo as string) ?? 0) + 1;
    perHost.set(card.attachedTo as string, k);
    upgradeRank.set(card.instanceId, k);
  }
  // Ordem estável da tira: a do board próprio primeiro, depois os de fora.
  const attachments = [...ownAttachments.filter((card) => isUpgrade(card) || artifacts.includes(card)), ...foreignUpgrades];
  return { creatures, attachments, upgrades, artifacts, hostCol, upgradeRank };
}
