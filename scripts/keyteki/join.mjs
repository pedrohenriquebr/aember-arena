// SPDX-License-Identifier: AGPL-3.0-only
// Derived from keyteki card scripts (copyright keyteki contributors, AGPL-3.0).
// keyteki slug → corpus faces. The candidates (by "<expansion>_<number>" and by title) are only
// candidates: the card file's header comment (its printed text) must match the face text, because
// an "-evil-twin" shares the title of the normal card and the corpus can reuse a key for two cards.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** slug → { names, keys:"exp_number" } from keyteki-json-data (.kfdata-tmp/packs). */
export function loadPacks(root) {
  const dir = resolve(root, ".kfdata-tmp/packs");
  const slugs = new Map();
  if (!existsSync(dir)) return slugs;
  for (const file of readdirSync(dir)) {
    const pack = JSON.parse(readFileSync(resolve(dir, file), "utf8"));
    for (const card of pack.cards ?? []) {
      const entry = slugs.get(card.id) ?? { names: new Set(), keys: new Set() };
      entry.names.add(norm(card.name));
      entry.keys.add(`${card.expansion}_${card.number}`);
      slugs.set(card.id, entry);
    }
  }
  return slugs;
}

/** Corpus faces indexed by "<expansion>_<number>" (from the image URL) and by title.
 *  A key whose faces carry different texts is `ambiguous` and never joins by key. */
export function indexCorpus(faces) {
  const byKey = new Map();
  const byTitle = new Map();
  const ambiguous = new Set();
  const push = (map, key, face) => map.set(key, [...(map.get(key) ?? []), face]);
  for (const face of faces) {
    const m = /\/(\d+)_(\d+)_/.exec(face.image ?? "");
    if (m) {
      const key = `${m[1]}_${m[2]}`;
      if ((byKey.get(key) ?? []).some((f) => norm(f.text) !== norm(face.text))) ambiguous.add(key);
      push(byKey, key, face);
    }
    push(byTitle, norm(face.title), face);
  }
  return { byKey, byTitle, ambiguous, size: faces.length };
}

/** → { faces, why }. `why` is "noPack" | "noText" | "noFace" | "noTextMatch" when faces is empty. */
export function facesOf(slug, header, packs, corpus) {
  const entry = packs.get(slug);
  if (!entry) return { faces: [], why: "noPack" };
  const want = norm(header);
  if (!want) return { faces: [], why: "noText" };
  const found = new Map();
  for (const key of entry.keys) if (!corpus.ambiguous.has(key)) for (const f of corpus.byKey.get(key) ?? []) found.set(f.id, f);
  for (const name of entry.names) for (const f of corpus.byTitle.get(name) ?? []) found.set(f.id, f);
  if (!found.size) return { faces: [], why: "noFace" };
  const faces = [...found.values()].filter((f) => norm(f.text) === want);
  return faces.length ? { faces } : { faces, why: "noTextMatch" };
}
