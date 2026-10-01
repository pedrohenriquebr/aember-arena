// SPDX-License-Identifier: AGPL-3.0-only
// Linhas de ability aprovadas pelo dono e vendorizadas por scripts/ability-harvest.mjs
// (--vendor): só DSL + hash, nenhum texto de carta. O boot as junta DEPOIS do store
// do usuário (mergeAbilityOverrides: a entrada já presente vence).
import { normaliseAbilityOverride, type AbilityOverride } from "./abilities";
import approved from "./generated/approved.json";

export function vendoredOverrides(): Map<string, AbilityOverride> {
  const rows = new Map<string, AbilityOverride>();
  for (const raw of approved as unknown[]) {
    const row = normaliseAbilityOverride(raw);
    if (row) rows.set(row.cardId, row);
  }
  return rows;
}
