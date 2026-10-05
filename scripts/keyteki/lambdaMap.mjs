// SPDX-License-Identifier: AGPL-3.0-only
// Derived from keyteki card scripts (copyright keyteki contributors, AGPL-3.0).
// Lane G/M tables → lowering (plan M2): a C-layer lambda whose canonical text is in
// patterns/data/lambda-map.json becomes our Condition / Count. The map is DATA, never
// trusted: `mapeamento` is parsed here and the result still passes validateDraft like
// everything else. A null (or absent, or malformed) entry stays C-layer.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonOf } from "./canon.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MAP = JSON.parse(readFileSync(resolve(here, "patterns/data/lambda-map.json"), "utf8"));

/** Condition kinds the DSL knows; anything else with a `k` is rejected here, before the gate. */
const CONDITION_KINDS = new Set(["amber", "moreCreatures", "fewerCreatures", "count", "forged", "myTurn", "actor", "key", "not"]);

let enabled = true;
/** `--baseline`: switch the map AND the table recognisers off to measure what they add. */
export const setEnabled = (on) => {
  enabled = on;
};
export const isEnabled = () => enabled;

/** Per-card usage ("map" = lambda-map entry, "table" = structural family); lowerCard resets and reads it. */
let usage = { map: 0, table: 0 };
export const resetUsage = () => {
  usage = { map: 0, table: 0 };
};
export const readUsage = () => ({ ...usage });
export const markTable = () => {
  usage.table += 1;
};

/** `{ kind: "condition" | "count", value }` for a lambda node, or null. */
export function lookup(fnNode) {
  if (!enabled || !fnNode || fnNode.t !== "fn") return null;
  const entry = MAP[canonOf(fnNode)];
  if (!entry || typeof entry.mapeamento !== "string") return null;
  let value;
  try {
    value = JSON.parse(entry.mapeamento);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  if (typeof value.k === "string") return CONDITION_KINDS.has(value.k) ? { kind: "condition", value } : null;
  return { kind: "count", value };
}

/** Marks a hit as used (only the lowering that really consumed the entry calls this). */
export const markMap = () => {
  usage.map += 1;
};
