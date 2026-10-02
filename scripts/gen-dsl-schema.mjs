// SPDX-License-Identifier: AGPL-3.0-only
// Gera src/lib/generated/dslSchema.ts: os tipos TypeScript do DSL de abilities
// (Ability/Act/Filter/Condition...) extraídos de src/lib/abilities.ts, sem
// comentários, para o prompt do pipeline LLM. O spec `catalogLlm.test.ts` falha
// se o arquivo gerado divergir do abilities.ts (rode `npm run gen:schema`).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SCHEMA_TYPES = ["Trigger", "Zone", "Filter", "Selection", "Count", "Act", "Condition", "Ability", "Restrict", "Replacement", "PersistentEffect"];

function stripComments(source) {
  // Line comments first: the file header has a "GameActions/*" that is not a block opener.
  return source.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The declaration of `name`, from `export type|interface` to its end. */
function declaration(source, name) {
  const match = new RegExp(`export (type|interface) ${name}\\b`).exec(source);
  if (!match) throw new Error(`dsl schema: ${name} not found in abilities.ts`);
  let depth = 0;
  for (let index = match.index; index < source.length; index += 1) {
    const char = source[index];
    if ("{([".includes(char)) depth += 1;
    else if ("})]".includes(char)) {
      depth -= 1;
      if (depth === 0 && char === "}" && match[1] === "interface") return source.slice(match.index, index + 1);
    } else if (char === ";" && depth === 0) return source.slice(match.index, index + 1);
  }
  throw new Error(`dsl schema: ${name} is unterminated`);
}

export function extractSchema(abilitiesSource) {
  const clean = stripComments(abilitiesSource.replaceAll(String.fromCharCode(13), ""));
  return SCHEMA_TYPES.map((name) => declaration(clean, name).replace(/^export /, "").replace(/\n\s*\n/g, "\n")).join("\n\n");
}

export function renderModule(abilitiesSource) {
  return [
    "// GERADO por scripts/gen-dsl-schema.mjs a partir de src/lib/abilities.ts — não edite.",
    "// Os tipos do DSL no prompt do pipeline LLM (lib/catalogLlm.ts).",
    `export const DSL_SCHEMA = ${JSON.stringify(extractSchema(abilitiesSource))};`,
    "",
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL("../", import.meta.url);
  const source = readFileSync(new URL("src/lib/abilities.ts", root), "utf8");
  writeFileSync(new URL("src/lib/generated/dslSchema.ts", root), renderModule(source));
  console.log("src/lib/generated/dslSchema.ts atualizado");
}
