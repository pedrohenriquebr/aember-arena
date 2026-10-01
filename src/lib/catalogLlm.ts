// SPDX-License-Identifier: AGPL-3.0-only
// Camada 2 do catálogo dinâmico (docs/DYNAMIC_CATALOG_PLAN.md §4): o texto de uma
// carta que o parser não lê vira DSL pela API do provedor do usuário (BYOK) e só
// vira regra depois da VALIDAÇÃO TRIPLA — (a) schema, (b) dry-run numa partida
// sintética, (c) sanidade semântica. Reprovou = a carta segue vanilla e a fila
// guarda o motivo. Nada aqui é meio-resolvido: o rascunho que passa entra como
// `source: "llm"`, `reviewed: false` e só um humano o torna regra (abilities.ts).
import { type Ability, type AbilityOverride, type PersistentEffect, normaliseAbilityOverride, rulesOf, withTrialOverride } from "./abilities";
import { putAbilityOverride } from "./cache";
import { normalise, parseCardText, textHash } from "./cardText";
import { DEMO_DECK } from "./demoDeck";
import { DEMO_DECK_2 } from "./demoDeck2";
import { applyMove, canResolve, createMatch, effectivePower, endTurn, getLegalMoves, type CardFace, type CardInstance, type GameState } from "./game";
import { DSL_SCHEMA } from "./generated/dslSchema";
import { VaultError, withTimeout } from "./keyforgeApi";
import { ENGINE_KEYWORDS, type Keywords } from "./keywords";
import { llmReady, redactSecret, type LlmConfig } from "./settings";

/** Teto por requisição ao provedor. 180s: provedores locais (ex. opencode-cli-proxy) têm
 * cold start acima de 60s no primeiro spawn do CLI; provedores remotos respondem bem antes. */
export const LLM_TIMEOUT_MS = 180000;
/** Teto de cartas por rodada da fila (o gasto do BYOK é do usuário — plano §6). */
export const LLM_RUN_LIMIT = 25;

// ---------- prompt ----------

interface DslAnswer {
  abilities: Ability[];
  effects: PersistentEffect[];
  keywords: Keywords;
}

/** Few-shot pairs: card text -> the exact answer. Each one is what the
    deterministic parser produces for that text (a spec asserts it), so the
    examples cannot drift from the engine. The last one teaches `unsupported`. */
export const FEW_SHOTS: { type: string; text: string; answer: DslAnswer | { unsupported: true; reason: string } }[] = [
  {
    type: "Creature",
    text: "Play: Deal 2<D> to a creature. Reap: Gain 1<A>.",
    answer: {
      abilities: [
        { on: ["play"], acts: [{ k: "damage", n: 2, s: "target" }], target: { type: "Creature" } },
        { on: ["reap"], acts: [{ k: "gainAmber", n: 1 }] },
      ],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Creature",
    text: "Elusive. Destroyed: Draw a card.",
    answer: { abilities: [{ on: ["destroyed"], acts: [{ k: "draw", n: 1 }] }], effects: [], keywords: { elusive: 1 } },
  },
  {
    type: "Creature",
    text: "Skirmish. This creature gets +2 power while it is on a flank. Play: Capture 1<A>.",
    answer: {
      abilities: [{ on: ["play"], acts: [{ k: "capture", n: 1, s: "self" }] }],
      effects: [{ target: { self: true }, power: 2, when: "flank" }],
      keywords: { skirmish: 1 },
    },
  },
  {
    type: "Creature",
    text: "Play: If your opponent has 4<A> or more, steal 1<A>.",
    answer: {
      abilities: [{ on: ["play"], acts: [{ k: "steal", n: 1 }], if: { k: "amber", opp: true, op: "gte", n: 4 } }],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Artifact",
    text: "Each time a creature is destroyed, gain 1<A>.",
    answer: { unsupported: true, reason: "Global watcher: the DSL only has triggers bound to the card itself." },
  },
];

const SYSTEM_RULES = [
  "You translate the printed text of a KeyForge card into a JSON DSL for a rules engine.",
  'Answer with ONLY one JSON object: {"abilities": Ability[], "effects": PersistentEffect[], "keywords": Keywords}, or {"unsupported": true, "reason": "<short>"}.',
  "GOLDEN RULE: every sentence of the card text must be representable EXACTLY with the types below. If any sentence is not, answer unsupported. Never approximate, never invent, never drop a sentence.",
  "Keep the order of the text. Printed keywords (Elusive. Skirmish. Taunt. Assault 2 ...) go in `keywords` with their number (1 when absent), not in abilities.",
  'Prefixes map to triggers: "Play:" play, "Reap:" reap, "Fight:" fight, "Before Fight:" beforeFight, "Destroyed:" destroyed, "Action:" action, "Omni:" omni, "At the start of your turn:" startOfTurn, "At the end of your turn:" endOfTurn. "After X:" / "Each time X:" bind to the same trigger.',
  'An Ability `target` is the filter of the creature the player chooses; acts that use it say `s: "target"`. "You may" => `optional: true`. <A> is amber, <D> is damage.',
  "Constant text (+/- power, armor, granted keywords, 'cannot' clauses) goes in `effects`; triggered text goes in `abilities`.",
  `Keywords = an object whose keys are among: ${ENGINE_KEYWORDS.join(", ")}; values are numbers.`,
  "Types:",
  DSL_SCHEMA,
].join("\n");

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const cardPrompt = (type: string, text: string) => `Card type: ${type}\nCard text:\n${text}`;

/** The conversation sent to the provider: rules + schema, the few-shot pairs,
    then the card. Exported for the specs (the prompt must carry schema and shots). */
export function buildMessages(face: CardFace): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_RULES }];
  for (const shot of FEW_SHOTS) {
    messages.push({ role: "user", content: cardPrompt(shot.type, shot.text) }, { role: "assistant", content: JSON.stringify(shot.answer) });
  }
  messages.push({ role: "user", content: cardPrompt(face.type, face.text ?? "") });
  return messages;
}

// ---------- provider (OpenAI-compatible) ----------

type Fetcher = typeof fetch;

function endpoint(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "")}/chat/completions`;
}

/** One chat completion. Failures become VaultError with `llm.*` keys (the same
    channel keyforgeApi uses), and the key never reaches a message: provider
    error text is redacted before it becomes a parameter. */
export async function callProvider(config: LlmConfig, messages: ChatMessage[], options: { signal?: AbortSignal; fetcher?: Fetcher } = {}): Promise<string> {
  if (!llmReady(config)) throw new VaultError("llm.noKey");
  const { signal, clear } = withTimeout(LLM_TIMEOUT_MS, options.signal);
  const url = endpoint(config.baseUrl);
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey.trim()}` };
  // Anthropic only answers browsers that say so (its own CORS opt-in header).
  if (/(^|\/\/)api\.anthropic\.com/.test(url)) headers["anthropic-dangerous-direct-browser-access"] = "true";
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({ model: config.model.trim(), messages, temperature: 0 }),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new VaultError("llm.auth");
      if (response.status === 429) throw new VaultError("llm.rateLimit");
      const raw = await response.text().catch(() => "");
      throw new VaultError("llm.http", { status: response.status, detail: redactSecret(raw, config.apiKey).replace(/\s+/g, " ").slice(0, 160) });
    }
    const payload = (await response.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new VaultError("llm.badBody");
    return content;
  } catch (error) {
    if (error instanceof VaultError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new VaultError("llm.timeout");
    throw new VaultError("llm.unreachable");
  } finally {
    clear();
  }
}

// ---------- validation (a): schema ----------

/** The JSON object inside a reply (models wrap it in fences or prose). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

type Draft = { ok: true; row: AbilityOverride } | { ok: false; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function draftRow(face: CardFace, parts: { abilities: unknown; effects?: unknown; keywords?: unknown }, source: AbilityOverride["source"], model?: string): Draft {
  const base = { cardId: face.id, textHash: textHash(face.text ?? ""), source, reviewed: source === "manual", generatedAt: Date.now(), ...(model ? { model } : {}) };
  if (!Array.isArray(parts.abilities)) return { ok: false, reason: "schema: `abilities` must be an array" };
  const effects = parts.effects ?? [];
  const keywords = parts.keywords ?? {};
  const gate = (patch: Record<string, unknown>) => normaliseAbilityOverride({ ...base, dsl: [], ...patch }) !== null;
  for (const [index, ability] of parts.abilities.entries()) {
    if (!gate({ dsl: [ability] })) return { ok: false, reason: `schema: abilities[${index}] is not a valid Ability` };
  }
  if (!gate({ effects })) return { ok: false, reason: "schema: `effects` is not a valid PersistentEffect[]" };
  if (!gate({ keywords })) return { ok: false, reason: "schema: `keywords` has an unknown keyword or a non-number value" };
  const row = normaliseAbilityOverride({ ...base, dsl: parts.abilities, effects, keywords });
  return row ? { ok: true, row } : { ok: false, reason: "schema: rejected by the engine's row gate" };
}

// ---------- validation (c): semantic sanity ----------

const TRIGGER_WORDS: Record<string, RegExp> = {
  play: /\bplay\b/,
  reap: /\breap\b/,
  fight: /\bfight\b/,
  beforeFight: /\bbefore fight\b/,
  destroyed: /\bdestroyed\b/,
  action: /\baction\b/,
  omni: /\bomni\b/,
  startOfTurn: /\bstart of your turn\b/,
  endOfTurn: /\bend of your turn\b/,
};
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const TARGETED = new Set(["target", "targetAndNeighbors"]);

function actProblem(act: Ability["acts"][number], ability: Ability, face: CardFace, text: string): string | null {
  if ("n" in act && (!Number.isInteger(act.n) || act.n < 1 || act.n > 20)) return `${act.k}: n=${act.n} is out of range`;
  // A number the printed text never states is a hallucination ("a"/"an" = 1).
  if ("n" in act && act.n > 1 && !new RegExp(`\\b(${act.n}|${NUMBER_WORDS[act.n] ?? "$^"})\\b`).test(text)) return `${act.k}: the number ${act.n} is not in the card text`;
  if ("s" in act && typeof act.s === "string" && TARGETED.has(act.s) && !ability.target) return `${act.k}: selects a target but the ability has no \`target\` filter`;
  if ("s" in act && act.s === "host" && face.type !== "Upgrade") return `${act.k}: "host" only exists on upgrades`;
  if (act.k === "lasting" && !act.e.duration) return "lasting: the effect has no duration";
  return null;
}

/** (c): triggers are possible for the card type and cited by the text, targets
    exist, numbers come from the text. Structure (known triggers/acts/keywords) is
    already guaranteed by (a). */
export function sanityProblem(face: CardFace, row: AbilityOverride): string | null {
  const text = normalise(face.text ?? "");
  const checkAbility = (ability: Ability): string | null => {
    for (const trigger of ability.on) {
      if (face.type === "Action" || face.type === "Upgrade") {
        if (trigger !== "play") return `trigger "${trigger}" cannot happen on a ${face.type} card`;
      } else if (face.type === "Artifact" && (trigger === "reap" || trigger === "fight" || trigger === "beforeFight")) {
        return `trigger "${trigger}" cannot happen on an Artifact`;
      }
      if (!(trigger === "play" && face.type === "Action") && !TRIGGER_WORDS[trigger].test(text)) return `trigger "${trigger}" is not named by the card text`;
    }
    for (const act of ability.acts) {
      const problem = actProblem(act, ability, face, text);
      if (problem) return problem;
    }
    return null;
  };
  for (const ability of row.dsl) {
    const problem = checkAbility(ability);
    if (problem) return `sanity: ${problem}`;
  }
  for (const effect of row.effects ?? []) {
    for (const ability of effect.abilities ?? []) {
      const problem = checkAbility(ability);
      if (problem) return `sanity: ${problem}`;
    }
    if (Math.abs(effect.power ?? 0) > 20 || Math.abs(effect.armor ?? 0) > 20) return "sanity: stat modifier out of range";
  }
  if (!row.dsl.length && !row.effects?.length && !Object.keys(row.keywords ?? {}).length) return "sanity: empty translation (the card should have been answered unsupported)";
  return null;
}

// ---------- validation (b): dry-run in a synthetic match ----------

const dummy = (id: string, house: string, power: number): CardInstance => ({
  instanceId: id,
  face: { id: `${id}-face`, title: id, house, type: "Creature", image: "", text: "", amber: 0, power, armor: 0 },
  damage: 0,
  ready: true,
  stunned: false,
});

function brokenState(state: GameState): string | null {
  for (const player of state.players) {
    if (![player.amber, player.keys, player.chains, player.keyCostMod].every(Number.isFinite)) return "a player counter became NaN";
    for (const card of [...player.hand, ...player.board, ...player.discard, ...player.deck, ...player.archives, ...player.purged]) {
      if (!card?.face || !Number.isFinite(card.damage)) return "a card lost its face or damage";
    }
    for (const card of player.board) if (!Number.isFinite(effectivePower(state, card))) return "a creature's power became NaN";
  }
  return null;
}

/** The card in a table with friendly/enemy creatures (one of them too strong to
    survive, so Destroyed:/Fight: text can fire), either in hand or in play. */
function scenario(face: CardFace, where: "hand" | "board"): { state: GameState; card: CardInstance } {
  const state = createMatch(DEMO_DECK, DEMO_DECK_2, { seed: 7 });
  const card: CardInstance = { instanceId: "dry-card", face, damage: 0, ready: true, stunned: false };
  const [me, rival] = state.players;
  const friends = [dummy("dry-f0", face.house, 3), dummy("dry-f1", face.house, 4)];
  me.hand = where === "hand" ? [card] : [];
  me.board = where === "board" ? [friends[0], { ...card, ...(face.type === "Upgrade" ? { attachedTo: "dry-f0" } : {}) }, friends[1]] : friends;
  rival.board = [dummy("dry-e0", rival.houses[0] ?? "Dis", 3), dummy("dry-e1", rival.houses[0] ?? "Dis", 20)];
  me.discard = [dummy("dry-d0", face.house, 2)];
  me.amber = 3;
  rival.amber = 5;
  state.activeHouse = face.house;
  state.turn = 2;
  state.pendingMulligan = null;
  state.log = [];
  return { state, card: where === "board" ? me.board.find((item) => item.instanceId === "dry-card")! : card };
}

function exercise(face: CardFace, where: "hand" | "board"): string | null {
  const { state, card } = scenario(face, where);
  if (where === "board" && face.type === "Action") return null;
  if (where === "board" && face.type === "Upgrade") return null;
  const moves = getLegalMoves(state, 0, face.house).filter((move) => ("instanceId" in move && move.instanceId === card.instanceId) || ("attackerId" in move && move.attackerId === card.instanceId));
  for (const ability of rulesOf(face).abilities) {
    if (typeof canResolve(state, 0, card, ability) !== "boolean") return "canResolve did not answer a boolean";
  }
  for (const move of moves) {
    if (move.type === "discard") continue;
    const next = applyMove(state, 0, move);
    const again = applyMove(state, 0, move);
    const problem = brokenState(next);
    if (problem) return `dry-run (${where}, ${move.type}): ${problem}`;
    if (JSON.stringify(next) !== JSON.stringify(again)) return `dry-run (${where}, ${move.type}): the move is not deterministic`;
  }
  if (where === "board") {
    const ended = endTurn(state, 0);
    const problem = brokenState(ended) ?? brokenState(endTurn(ended, 1));
    if (problem) return `dry-run (turn boundaries): ${problem}`;
  }
  return null;
}

/** (b): the draft plays inside a synthetic match under a synthetic card id (the
    live overrides and any real match stay untouched). Nothing may throw, every
    counter stays finite, moves are deterministic, canResolve answers. */
export function dryRunProblem(face: CardFace, row: AbilityOverride): string | null {
  const dryId = `dry:${face.id}`;
  const dryFace: CardFace = { ...face, id: dryId };
  const trial: AbilityOverride = { ...row, cardId: dryId, source: "llm", reviewed: true };
  try {
    return withTrialOverride(trial, () => {
      if (rulesOf(dryFace).abilities !== trial.dsl) return "dry-run: the engine did not read the draft";
      return exercise(dryFace, "hand") ?? exercise(dryFace, "board");
    });
  } catch (error) {
    return `dry-run crashed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ---------- the pipeline ----------

export interface Validation {
  ok: boolean;
  /** The validated row (ok) or why it failed. */
  row?: AbilityOverride;
  reason?: string;
}

/** Triple validation of one candidate (shared by the LLM answer and the review
    queue's manual edit). `source` is what the row will claim. */
export function validateDraft(face: CardFace, parts: { abilities: unknown; effects?: unknown; keywords?: unknown }, source: AbilityOverride["source"], model?: string): Validation {
  const draft = draftRow(face, parts, source, model);
  if (!draft.ok) return { ok: false, reason: draft.reason };
  const problem = sanityProblem(face, draft.row) ?? dryRunProblem(face, draft.row);
  return problem ? { ok: false, reason: problem } : { ok: true, row: draft.row };
}

/** Vanilla + motive: an untrusted row with an empty DSL the queue lists. */
export function failureRow(face: CardFace, reason: string, model?: string): AbilityOverride {
  return { cardId: face.id, dsl: [], textHash: textHash(face.text ?? ""), source: "llm", reviewed: false, generatedAt: Date.now(), failure: reason, ...(model ? { model } : {}) };
}

/** Parser output for the parts the model may have left out: the parser's own
    effects stand in when the model returns none, and printed keywords merge. */
function withParserParts(face: CardFace, answer: Record<string, unknown>): { abilities: unknown; effects: unknown; keywords: unknown } {
  const parsed = parseCardText(face);
  const effects = Array.isArray(answer.effects) && answer.effects.length ? answer.effects : parsed.effects;
  const keywords = isRecord(answer.keywords) ? { ...parsed.keywords, ...answer.keywords } : parsed.keywords;
  return { abilities: answer.abilities, effects, keywords };
}

/** Translates one card. Resolves with a row ALWAYS — the validated draft or a
    failure row — and rejects only on transport problems (no key, auth, network,
    rate limit) so a run can stop instead of burning every card on the same error. */
export async function translateCard(face: CardFace, config: LlmConfig, options: { signal?: AbortSignal; fetcher?: Fetcher } = {}): Promise<AbilityOverride> {
  const reply = await callProvider(config, buildMessages(face), options);
  const model = config.model.trim();
  const answer = extractJson(reply);
  if (!isRecord(answer)) return failureRow(face, "reply: not a JSON object", model);
  if (answer.unsupported === true) return failureRow(face, `unsupported: ${typeof answer.reason === "string" ? answer.reason.slice(0, 200) : "not representable"}`, model);
  const result = validateDraft(face, withParserParts(face, answer), "llm", model);
  return result.ok ? result.row! : failureRow(face, result.reason ?? "invalid", model);
}

/** Cards worth a call: the parser does not cover them fully and the store holds
    no answer yet for this exact text (cache eterno por textHash — failures too). */
export function pendingTranslations(cards: CardFace[], known: (id: string) => AbilityOverride | undefined): CardFace[] {
  return cards.filter((face) => {
    if (!face.text?.trim() || parseCardText(face).coverage === "full") return false;
    return known(face.id)?.textHash !== textHash(face.text);
  });
}

export interface RunProgress {
  done: number;
  total: number;
  drafted: number;
  failed: number;
}

/** Sequential run over `faces` (at most `limit`): each answer is stored right
    away (`save` — IndexedDB by default), progress is reported per card and an
    abort stops between cards. A transport error ends the run and is rethrown
    after the rows already stored. */
export async function runTranslation(
  faces: CardFace[],
  config: LlmConfig,
  options: { limit?: number; signal?: AbortSignal; fetcher?: Fetcher; save?: (row: AbilityOverride) => Promise<void>; onProgress?: (progress: RunProgress) => void } = {},
): Promise<RunProgress> {
  const queue = faces.slice(0, options.limit ?? LLM_RUN_LIMIT);
  const save = options.save ?? putAbilityOverride;
  const progress: RunProgress = { done: 0, total: queue.length, drafted: 0, failed: 0 };
  options.onProgress?.({ ...progress });
  for (const face of queue) {
    if (options.signal?.aborted) break;
    let row: AbilityOverride;
    try {
      row = await translateCard(face, config, { signal: options.signal, fetcher: options.fetcher });
    } catch (error) {
      // An abort (Cancel button) is a stop, not a failure.
      if (options.signal?.aborted) break;
      throw error;
    }
    await save(row);
    progress.done += 1;
    if (row.failure) progress.failed += 1;
    else progress.drafted += 1;
    options.onProgress?.({ ...progress });
  }
  return progress;
}
