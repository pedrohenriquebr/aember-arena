// SPDX-License-Identifier: AGPL-3.0-only
// Coverage measurement for docs/MECHANICS_REPORT.md: runs every playable card of
// keyteki-json-data (one JSON per set, https://github.com/keyteki/keyteki-json-data,
// packs/*.json) through rulesOf() and prints full/partial/vanilla counts.
//   KF_DATA=<dir with AoA.json, CotA.json, …> npx vitest run --config e2e/probes/vitest.config.ts coverage
// Skipped when KF_DATA is not set (the data is not vendored: AGPL/FFG text).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { rulesOf } from "../../src/lib/abilities";
import type { CardFace } from "../../src/lib/game";

const DIR = process.env.KF_DATA ?? "";
const PLAYABLE = new Set(["action", "creature", "artifact", "upgrade"]);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const bump = (o: Record<string, number>, k: string, n = 1) => (o[k] = (o[k] ?? 0) + n);

it.skipIf(!DIR || !existsSync(DIR))("coverage of every playable card", () => {
  const unique = new Map<string, { raw: any; set: string }>();
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()) {
    const pack = JSON.parse(readFileSync(`${DIR}/${file}`, "utf8"));
    for (const raw of pack.cards) if (PLAYABLE.has(raw.type) && !unique.has(raw.id)) unique.set(raw.id, { raw, set: pack.code });
  }
  const coverage: Record<string, number> = {};
  const byType: Record<string, Record<string, number>> = {};
  const bySet: Record<string, Record<string, number>> = {};
  const triggers: Record<string, number> = {};
  const acts: Record<string, number> = {};
  const crashes: string[] = [];
  let keywordOnly = 0;
  let withAbilities = 0;
  let abilities = 0;
  for (const { raw, set } of unique.values()) {
    const face: CardFace = {
      id: raw.id, title: raw.name, house: raw.house, type: cap(raw.type), image: "", text: raw.text ?? "",
      amber: raw.amber ?? 0, power: raw.power ?? 0, armor: raw.armor ?? 0, keywords: raw.keywords,
    };
    let rules;
    try {
      rules = rulesOf(face);
    } catch {
      crashes.push(`${set} ${raw.name}`);
      bump(coverage, "crash");
      continue;
    }
    bump(coverage, rules.coverage);
    bump((byType[face.type] ??= {}), rules.coverage);
    bump((bySet[set] ??= {}), rules.coverage);
    if (rules.abilities.length) withAbilities += 1;
    else if (rules.coverage === "full") keywordOnly += 1;
    abilities += rules.abilities.length;
    for (const ability of rules.abilities) {
      for (const trigger of ability.on) bump(triggers, trigger);
      for (const act of ability.acts) bump(acts, act.k);
    }
  }
  console.log(JSON.stringify({ total: unique.size, coverage, keywordOnly, withAbilities, abilities, byType, bySet, triggers, acts, crashes }, null, 1));
  expect(unique.size).toBeGreaterThan(0);
});
