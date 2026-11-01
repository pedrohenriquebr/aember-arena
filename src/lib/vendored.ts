// SPDX-License-Identifier: AGPL-3.0-only
// keyteki.json é derivado das cartas do keyteki (https://github.com/keyteki/keyteki,
// Copyright (C) keyteki contributors, AGPL-3.0, commit d9b239bc em SOURCE.json).
// As linhas vendidas são só DSL + hash — nenhum texto de carta. Ver NOTICE.
// Linhas de ability aprovadas e vendorizadas por CLI: scripts/ability-harvest.mjs
// (--vendor, fila do farm LLM) e scripts/keyteki/vendor.mjs (fila do conversor
// keyteki→AST) — só DSL + hash, nenhum texto de carta. O boot as junta DEPOIS do
// store do usuário (mergeAbilityOverrides: a entrada já presente vence) e uma linha
// do farm vence a do keyteki na mesma carta (aprovação humana explícita por cima do
// gate em lote).
import { normaliseAbilityOverride, type AbilityOverride } from "./abilities";
import approved from "./generated/approved.json";
import keyteki from "./generated/keyteki.json";

export function vendoredOverrides(): Map<string, AbilityOverride> {
  const rows = new Map<string, AbilityOverride>();
  for (const raw of [...(approved as unknown[]), ...(keyteki as unknown[])]) {
    const row = normaliseAbilityOverride(raw);
    if (row) rows.set(row.cardId, row);
  }
  return rows;
}
