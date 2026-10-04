// SPDX-License-Identifier: AGPL-3.0-only
// Extract offline do corpus completo a partir do keyteki-json-data (MIT, clone em
// .kfdata-tmp — `git -C .kfdata-tmp pull` antes para atualizar). Os 4 tipos
// jogáveis viram CardFace; id sintético "kt:<expansão>:<número>:<casa>".
//
//   npm run keyteki:cards       → scripts/harvest/cards-keyteki.json
//
// Executa com vite-node (resolve os .ts do app): `npm run keyteki:cards`.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKS = resolve(process.env.KF_DATA ?? ".kfdata-tmp/packs");
const OUT = resolve(ROOT, "scripts/harvest/cards-keyteki.json");

const HOUSES = {
  brobnar: "Brobnar", dis: "Dis", logos: "Logos", mars: "Mars", sanctum: "Sanctum",
  shadows: "Shadows", untamed: "Untamed", saurian: "Saurian", staralliance: "Star Alliance",
  unfathomable: "Unfathomable", ekwidon: "Ekwidon", geistoid: "Geistoid", skyborn: "Skyborn",
  redemption: "Redemption",
};
const TYPES = { action: "Action", creature: "Creature", artifact: "Artifact", upgrade: "Upgrade" };
const cap = (v) => (v ?? "").replace(/\b\w/g, (ch) => ch.toUpperCase());
const parseList = (v) => {
  try {
    const arr = typeof v === "string" ? JSON.parse(v) : Array.isArray(v) ? v : [];
    return arr.join(" • ");
  } catch { return ""; }
};

const faces = [];
for (const file of readdirSync(PACKS).filter((f) => f.endsWith(".json"))) {
  const pack = JSON.parse(readFileSync(resolve(PACKS, file), "utf8"));
  const setCode = pack.code ?? file.replace(".json", "");
  for (const card of pack.cards ?? []) {
    const type = TYPES[card.type];
    const house = HOUSES[card.house];
    if (!type || !house) continue;
    faces.push({
      id: `kt:${card.expansion}:${card.number}:${card.house}`,
      title: card.name,
      house,
      type,
      cardNumber: card.number,
      image: card.image ?? "",
      text: (card.text ?? "").trim(),
      amber: Number(card.amber ?? 0) || 0,
      power: Number(card.power ?? 0) || 0,
      armor: card.armor === "None" ? 0 : Number(card.armor ?? 0) || 0,
      traits: parseList(card.traits),
      set: setCode,
    });
  }
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(faces, null, 1)}\n`);
console.log(`${faces.length} cartas jogáveis de ${readdirSync(PACKS).length} sets em ${OUT}`);
