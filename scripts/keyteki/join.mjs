// SPDX-License-Identifier: AGPL-3.0-only
// Derived from keyteki card scripts (copyright keyteki contributors, AGPL-3.0).
// keyteki slug → corpus faces. The candidates (by "<expansion>_<number>" and by title) are only
// candidates: the card file's header comment (its printed text) must match the face text, because
// an "-evil-twin" shares the title of the normal card and the corpus can reuse a key for two cards.
// Lote 15a: o texto cru é a PRIMEIRA tentativa; quando ele não casa (o corpus
// mistura os glifos U+F360/1 do Æmber/dano com "1A"/"2D" digitados, e o header
// omite linhas que são só keyword impressa), o join cai para a forma canônica
// (canonDeTexto). Canon nunca decide sozinho entre textos crus diferentes: dois
// candidatos canonicamente iguais e cruamente distintos são AMBÍGUOS e não casam.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalise } from "../../src/lib/cardText";
import { readKeyword } from "../../src/lib/keywords";

export const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** O símbolo digitado SOLTO ("A with on it" do header vs o glifo da face) vira
    a forma entre <>, que o normalise já converte para "amber"/"damage" — a
    mesma saída das grafias "1A"/"1<A>"/"1 amber". Os glifos U+F360/1 e as
    grafias com dígito o normalise já canoniza sozinho. */
const symbolCanon = (s) =>
  String(s ?? "")
    .replace(/[\uF360]/gi, "<A>")
    .replace(/[\uF361]/gi, "<D>")
    .replace(/(^|[\s(])A\b/g, "$1<A>")
    .replace(/(^|[\s(])D\b/g, "$1<D>");

/** Uma linha que é só keyword impressa (+ lembrete entre parênteses): o header
    keyteki costuma não copiá-la ("Taunt. | While…"), mas a face do corpus traz. */
const keywordOnlyLine = (line) => {
  const sentences = line
    .replace(/\([^)]*\)/g, " ")
    .split(/\.\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  return sentences.length > 0 && sentences.every((sentence) => readKeyword(sentence) !== null);
};

/** Forma canônica do texto impresso para o join (Lote 15a): símbolos do
    Æmber/dano na forma escrita, linhas de keyword impressa removidas, e o
    normalise do cardText por cima (parênteses de lembrete, linha Enhance,
    whitespace). */
export function canonDeTexto(text) {
  const semKeywords = String(text ?? "")
    .split("\n")
    .filter((line) => !keywordOnlyLine(line))
    .join("\n");
  return normalise(symbolCanon(semKeywords)).replace(/[^a-z0-9]+/g, "");
}

/** Canon SEM remover linhas de keyword: só as normalizações que nunca mudam o
    texto impresso (notação do Æmber/dano, lembretes entre parênteses, linha
    Enhance, whitespace). Duas faces com `canonRigoroso` diferentes são
    impressões diferentes de verdade — a ambiguidade que o canon não pode
    decidir sozinho. */
export function canonRigoroso(text) {
  return normalise(symbolCanon(String(text ?? ""))).replace(/[^a-z0-9]+/g, "");
}

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

/** → { faces, why }. `why` is "noPack" | "noText" | "noFace" | "noTextMatch" when faces is empty.
 *  Lote 15a: o texto cru decide primeiro; sem ele, a FORMA CANÔNICA (glifos/letras
 *  do Æmber, linhas de keyword impressa) — mas o canon nunca decide entre
 *  impressões que divergem de verdade (canonRigoroso): duas impressões
 *  diferentes são ambíguas e não casam, como no `ambiguous` do indexCorpus. */
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
  if (faces.length) return { faces };
  const wantCanon = canonDeTexto(header);
  if (wantCanon) {
    const byCanon = [...found.values()].filter((f) => canonDeTexto(f.text) === wantCanon);
    // Ambíguo como o `ambiguous` do indexCorpus: impressões que divergem além
    // das normalizações seguras (linha de keyword é texto impresso de verdade;
    // \r\n, apóstrofo, glifo e lembrete não são).
    const prints = new Set(byCanon.map((f) => canonRigoroso(f.text)));
    if (byCanon.length && prints.size === 1) return { faces: byCanon };
  }
  return { faces: [], why: "noTextMatch" };
}
