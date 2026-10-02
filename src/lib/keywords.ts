// SPDX-License-Identifier: AGPL-3.0-only
// Keyword model ported from keyteki (https://github.com/keyteki/keyteki):
// server/game/Card.js (printedKeywords / getKeywordValue) and docs/keywords.md.
// Copyright (C) keyteki contributors. Rewritten in TypeScript for Aember Arena.
import type { CardFace } from "./game";

/** Keywords the engine resolves by itself (see game.ts). "exalt" is recognized
    for coverage but resolved through the `exalt` act ("Exalt <card>"), as in
    keyteki (docs/keywords.md: ExaltAction, not an automatic keyword effect).
    "ward" (Onda 4) is the same shape: a token placed by the `ward` act, listed
    here so a JSON keyword array that carries it is read as ward, not as text. */
export const ENGINE_KEYWORDS = [
  "elusive",
  "taunt",
  "skirmish",
  "poison",
  "deploy",
  "alpha",
  "omega",
  "assault",
  "hazardous",
  "splash-attack",
  "exalt",
  "ward",
  // Versatile has no printed value: it lets the card be played/used outside the
  // active house (game.houseAllows reads it through keyword()).
  "versatile",
  // Entrench resolves in the ready step: a held, exhausted entrenched creature
  // may stay exhausted (game.canReady reads it through keyword()).
  "entrench",
] as const;

export type Keyword = (typeof ENGINE_KEYWORDS)[number];
export type Keywords = Partial<Record<Keyword, number>>;

const KEYWORD_SENTENCE = new RegExp(`^(${ENGINE_KEYWORDS.join("|")})(?:[\\s:]+(\\d+))?$`);

/** "assault:2" (keyteki JSON), "Assault 2" (card text) or "Elusive" -> [name, value]. */
export function readKeyword(raw: string): [Keyword, number] | null {
  const match = raw.trim().toLowerCase().replace(/\s*[-–]\s*/g, "-").match(KEYWORD_SENTENCE);
  return match ? [match[1] as Keyword, match[2] ? Number(match[2]) : 1] : null;
}

/** Keywords printed on the card: the vault array when present, else the leading
    keyword sentences of card_text ("Elusive. Assault 2."). */
export function printedKeywords(face: CardFace, textSentences: string[]): Keywords {
  const result: Keywords = {};
  for (const raw of face.keywords?.length ? face.keywords : textSentences) {
    const parsed = readKeyword(raw);
    if (parsed) result[parsed[0]] = parsed[1];
  }
  return result;
}
