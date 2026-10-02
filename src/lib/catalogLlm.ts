// SPDX-License-Identifier: AGPL-3.0-only
// Camada 2 do catálogo dinâmico (docs/DYNAMIC_CATALOG_PLAN.md §4): o texto de uma
// carta que o parser não lê vira DSL pela API do provedor do usuário (BYOK) e só
// vira regra depois da VALIDAÇÃO TRIPLA — (a) schema, (b) dry-run numa partida
// sintética, (c) sanidade semântica. Reprovou = a carta segue vanilla e a fila
// guarda o motivo. Nada aqui é meio-resolvido: o rascunho que passa entra como
// `source: "llm"`, `reviewed: false` e só um humano o torna regra (abilities.ts).
import { type Ability, type AbilityOverride, DSL_VERSION, type PersistentEffect, normaliseAbilityOverride, rulesOf, withTrialOverride } from "./abilities";
import { putAbilityOverride } from "./cache";
import { normalise, parseCardText, readableText, textHash } from "./cardText";
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
    type: "Creature",
    text: "Play: Gain 1<A>. Fate: Archive a card.",
    answer: { unsupported: true, reason: "Fate: belongs to the Prophecy subsystem, which the engine does not resolve." },
  },
  // Lote 2 (docs/DSL_EXPANSION_PLAN.md §2): dynamic amounts, act conditions,
  // house/trait filters, key costs, picks, player zones and the Scrap trigger.
  {
    type: "Creature",
    text: "Play: Heal 1<D> from each creature. Gain 1<A> for each creature healed this way.",
    answer: {
      abilities: [{ on: ["play"], acts: [{ k: "heal", n: 1, s: { each: { type: "Creature" } } }, { k: "gainAmber", n: 1, per: "did" }] }],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Creature",
    text: "Play: Exhaust a friendly creature. If you do, steal 2<A>.",
    answer: {
      abilities: [
        {
          on: ["play"],
          acts: [{ k: "exhaust", s: "target" }, { k: "steal", n: 2, if: { k: "count", of: "did", op: "gte", n: 1 } }],
          target: { type: "Creature", side: "friendly" },
        },
      ],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Creature",
    text: "Play: If you are haunted, deal 5<D> to a creature. Otherwise, return a creature to its owner's hand.",
    answer: {
      abilities: [
        { on: ["play"], acts: [{ k: "damage", n: 5, s: "target" }], target: { type: "Creature" }, if: { k: "count", of: { p: "discard" }, op: "gte", n: 10 } },
        {
          on: ["play"],
          acts: [{ k: "returnToHand", s: "target" }],
          target: { type: "Creature" },
          if: { k: "not", c: { k: "count", of: { p: "discard" }, op: "gte", n: 10 } },
        },
      ],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Creature",
    text: "Play: Destroy each non-Mars creature.",
    answer: {
      abilities: [{ on: ["play"], acts: [{ k: "destroy", s: { each: { type: "Creature", house: "!Mars" } } }] }],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Creature",
    text: "Each friendly Knight creature gets +1 power.",
    answer: { abilities: [], effects: [{ target: { type: "Creature", side: "friendly", trait: "Knight" }, power: 1 }], keywords: {} },
  },
  {
    type: "Creature",
    text: "Your opponent's keys cost +1<A> for each card in your archives.",
    answer: { abilities: [], effects: [{ target: {}, keyCost: 1, opp: true, per: { p: "archives" } }], keywords: {} },
  },
  {
    type: "Creature",
    text: "After Reap: Exhaust an enemy creature. If you do, ready a non-Priest creature.",
    answer: {
      abilities: [
        {
          on: ["reap"],
          acts: [
            { k: "exhaust", s: "target" },
            { k: "ready", s: { pick: { type: "Creature", trait: "!Priest" } }, if: { k: "count", of: "did", op: "gte", n: 1 } },
          ],
          target: { type: "Creature", side: "enemy" },
        },
      ],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Creature",
    text: "Destroyed: Your opponent purges a random card from their hand.",
    answer: {
      abilities: [{ on: ["destroyed"], acts: [{ k: "move", n: 1, from: "hand", to: "purged", opp: true, pick: "random" }] }],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Creature",
    text: "Action: Put a friendly creature on the bottom of its owner's deck.",
    answer: {
      abilities: [{ on: ["action"], acts: [{ k: "returnToDeck", s: "target", at: "bottom" }], target: { type: "Creature", side: "friendly" } }],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Action",
    text: "Scrap: Archive a card.",
    answer: { abilities: [{ on: ["scrap"], acts: [{ k: "move", n: 1, from: "hand", to: "archives" }] }], effects: [], keywords: {} },
  },
  // Lote 3 (docs/DSL_EXPANSION_PLAN.md §3): use.via, observers, +1 power
  // counters and splash.
  {
    type: "Action",
    text: "Play: Ready and fight with a friendly creature.",
    answer: {
      abilities: [
        {
          on: ["play"],
          acts: [{ k: "ready", s: "target" }, { k: "use", s: "target", via: "fight" }],
          target: { type: "Creature", side: "friendly" },
        },
      ],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Creature",
    text: "After an enemy creature reaps, stun it.",
    answer: {
      abilities: [{ on: ["reap"], of: { type: "Creature", side: "enemy" }, acts: [{ k: "stun", s: "event" }] }],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Action",
    text: "Play: Give a creature two +1 power counters.",
    answer: {
      abilities: [{ on: ["play"], acts: [{ k: "counter", n: 2, s: "target" }], target: { type: "Creature" } }],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Action",
    text: "Play: Deal 3<D> to a creature, with 1<D> splash.",
    answer: {
      abilities: [
        {
          on: ["play"],
          acts: [{ k: "damage", n: 1, s: "targetNeighbors" }, { k: "damage", n: 3, s: "target" }],
          target: { type: "Creature" },
        },
      ],
      effects: [],
      keywords: {},
    },
  },
];

const SYSTEM_RULES = [
  "You translate the printed text of a KeyForge card into a JSON DSL for a rules engine.",
  'Answer with ONLY one JSON object: {"abilities": Ability[], "effects": PersistentEffect[], "keywords": Keywords}, or {"unsupported": true, "reason": "<short>"}.',
  "GOLDEN RULE: every sentence of the card text must be representable EXACTLY with the types below. If any sentence is not, answer unsupported. Never approximate, never invent, never drop a sentence.",
  "Keep the order of the text. Printed keywords (Elusive. Skirmish. Taunt. Assault 2 ...) go in `keywords` with their number (1 when absent), not in abilities.",
  'Prefixes map to triggers: "Play:" play, "Reap:" reap, "Fight:" fight, "Before Fight:" beforeFight, "Destroyed:" destroyed, "Action:" action, "Omni:" omni, "At the start of your turn:" startOfTurn, "At the end of your turn:" endOfTurn. "After X:" / "Each time X:" bind to the same trigger.',
  'An Ability `target` is the filter of the creature the player chooses; acts that use it say `s: "target"`. "You may" => `optional: true`. <A> is amber, <D> is damage.',
  'Ignore an "Enhance" sentence (its icons are deck-building bonusIcons, not an ability). "You are overwhelmed" = fewerCreatures. "Otherwise, X" = a second ability with if {"k":"not","c":<the previous condition>}.',
  '"Scrap:" = on ["scrap"] (the card in its discard pile). "If you do" = the act\'s if {"k":"count","of":"did","op":"gte","n":1}: a condition in a later clause gates only its own acts. "Haunted" = 10+ cards in your discard.',
  '"for each X" = the act\'s per. Filters: {"house":"Mars"}, {"house":"!Mars"}, {"trait":"Knight"}, {"house":"active"}. "keys cost +N" (no possessive) = two effects (owner + opp).',
  'Watchers ("After an enemy creature reaps, stun it.") set `of` to the watched filter; the event card is s:"event". "After your opponent plays a creature" = on ["play"], of {"type":"Creature","side":"enemy"}; "Each time you use an artifact" = on ["action","omni"].',
  '"Ready and fight/reap with X" = [{k:"ready",s:"target"},{k:"use",s:"target",via:"fight"|"reap"}]. "Give X two +1 power counters" = {k:"counter",n:2,s:...}. Splash: "Deal 3<D> to a creature, with 1<D> splash" = [{k:"damage",n:1,s:"targetNeighbors"},{k:"damage",n:3,s:"target"}] — neighbors first, the only exception to the printed order.',
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
  messages.push({ role: "user", content: cardPrompt(face.type, readableText(face.text ?? "")) });
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
  const base = { cardId: face.id, textHash: textHash(face.text ?? ""), source, reviewed: source === "manual", generatedAt: Date.now(), v: DSL_VERSION, ...(model ? { model } : {}) };
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
  // Inflexões contam ("when played"); word boundary impede "displayed"/"replay".
  // "reaps"/"fights" são as formas impressas dos observadores (§3.2).
  play: /\bplay(s|ed|ing)?\b/,
  reap: /\breaps?\b/,
  fight: /\bfights?\b/,
  beforeFight: /\bbefore fight\b/,
  destroyed: /\bdestroyed\b/,
  // "Each time you use an artifact" acorda Action/Omni sem imprimir as palavras.
  action: /\baction\b|\buse[sd]? an? artifact\b/,
  omni: /\bomni\b|\buse[sd]? an? artifact\b/,
  startOfTurn: /\bstart of your turn\b/,
  endOfTurn: /\bend of your turn\b/,
  scrap: /\bscrap\b/,
};
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const TARGETED = new Set(["target", "targetAndNeighbors", "targetNeighbors"]);

function actProblem(act: Ability["acts"][number], ability: Ability, face: CardFace, text: string): string | null {
  if ("n" in act && (!Number.isInteger(act.n) || act.n < 1 || act.n > 20)) return `${act.k}: n=${act.n} is out of range`;
  // A number the printed text never states is a hallucination ("a"/"an" = 1).
  if ("n" in act && act.n > 1 && !new RegExp(`\\b(${act.n}|${NUMBER_WORDS[act.n] ?? "$^"})\\b`).test(text)) return `${act.k}: the number ${act.n} is not in the card text`;
  if ("s" in act && typeof act.s === "string" && TARGETED.has(act.s) && !ability.target) return `${act.k}: selects a target but the ability has no \`target\` filter`;
  if ("s" in act && act.s === "host" && face.type !== "Upgrade") return `${act.k}: "host" only exists on upgrades`;
  // Observers: "event" only exists when the ability declares what it watches.
  if ("s" in act && act.s === "event" && !ability.of) return `${act.k}: selects the event but the ability has no \`of\` filter`;
  // §3.1: the re-trigger loop the dry-run would only catch as a stack overflow.
  if (act.k === "use" && act.s === "self" && (ability.on.includes("fight") || ability.on.includes("beforeFight"))) {
    return `use: "self" on a ${ability.on.join("/")} trigger would re-run the ability forever`;
  }
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
        // Scrap is a trigger of the card DISCARDED from hand: an Action/Upgrade
        // is the card that reaches the pile (keyteki Scrap: on those types).
        if (trigger !== "play" && trigger !== "scrap") return `trigger "${trigger}" cannot happen on a ${face.type} card`;
      } else if (face.type === "Artifact" && (trigger === "reap" || trigger === "fight" || trigger === "beforeFight")) {
        return `trigger "${trigger}" cannot happen on an Artifact`;
      }
      // Fora de Action não existe Play implícito: em Creature/Artifact/Upgrade o
      // texto sem gatilho conhecido costuma ser habilidade constante ou um gatilho
      // que a tabela não cobre (Fate:, Scrap:). Exigir a nomeação erra para o lado
      // conservador — o rascunho errado vira falha, nunca regra.
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

/** The six zones of a player, in one list (the invariants below walk both). */
const zones = (player: GameState["players"][number]) => [...player.hand, ...player.board, ...player.discard, ...player.deck, ...player.archives, ...player.purged];

/** Non-token cards across every zone: a card may move, never vanish — only
    tokens leave the game (2.6 relies on this invariant to catch a lost card). */
const cardCount = (state: GameState): number => state.players.reduce((total, player) => total + zones(player).filter((card) => !card.isToken).length, 0);

function brokenState(state: GameState): string | null {
  const seen = new Set<string>();
  for (const player of state.players) {
    if (![player.amber, player.keys, player.chains, player.keyCostMod].every(Number.isFinite)) return "a player counter became NaN";
    for (const card of zones(player)) {
      if (!card?.face || !Number.isFinite(card.damage)) return "a card lost its face or damage";
      if (seen.has(card.instanceId)) return "a card instance is in two zones at once";
      seen.add(card.instanceId);
    }
    for (const card of player.board) if (!Number.isFinite(effectivePower(state, card))) return "a creature's power became NaN";
  }
  return null;
}

/** The card in a table with friendly/enemy creatures (one of them too strong to
    survive, so Destroyed:/Fight: text can fire), either in hand or in play. The
    rich table adds a hand of three dummies (one of another house), two archive
    cards, a full discard, three enemies against two friends and one damaged
    creature per side — a mix of houses so house filters have something to
    answer; the dummies carry no traits, so a draft filtered by trait simply
    finds nothing (the exercise still proves it does not crash). */
function scenario(face: CardFace, where: "hand" | "board", rich: boolean): { state: GameState; card: CardInstance } {
  const state = createMatch(DEMO_DECK, DEMO_DECK_2, { seed: 7 });
  const card: CardInstance = { instanceId: "dry-card", face, damage: 0, ready: true, stunned: false };
  const [me, rival] = state.players;
  const foe = rival.houses[0] ?? "Dis";
  const pack = (prefix: string, house: string, n: number) => Array.from({ length: n }, (_, index) => dummy(`${prefix}${index}`, house, 2));
  const friends = [dummy("dry-f0", face.house, 3), dummy("dry-f1", face.house, 4)];
  const enemies = [dummy("dry-e0", foe, 3), dummy("dry-e1", foe, 20)];
  me.hand = where === "hand" ? [card] : [];
  me.board = where === "board" ? [friends[0], { ...card, ...(face.type === "Upgrade" ? { attachedTo: "dry-f0" } : {}) }, friends[1]] : friends;
  rival.board = enemies;
  me.discard = [dummy("dry-d0", face.house, 2)];
  // The rich table: a hand of three dummies (one of another house), two archive
  // cards, a full discard, three enemies against two friends and one damaged
  // creature per side — the house mix is what "cited by the filters" can reach.
  if (rich) {
    me.hand.push(...pack("dry-h", face.house, 2), dummy("dry-h2", foe, 2));
    enemies.push(dummy("dry-e2", foe, 3));
    me.discard = pack("dry-d", face.house, 11);
    me.archives = pack("dry-a", face.house, 2);
    friends[0].damage = 1;
    enemies[0].damage = 1;
  }
  me.amber = 3;
  rival.amber = 5;
  state.activeHouse = face.house;
  state.turn = 2;
  state.pendingMulligan = null;
  state.log = [];
  return { state, card: where === "board" ? me.board.find((item) => item.instanceId === "dry-card")! : card };
}

function exerciseTable(face: CardFace, where: "hand" | "board", rich: boolean): string | null {
  const { state, card } = scenario(face, where, rich);
  const label = `dry-run (${where}${rich ? ", rich" : ""}, `;
  const moves = getLegalMoves(state, 0, face.house).filter((move) => ("instanceId" in move && move.instanceId === card.instanceId) || ("attackerId" in move && move.attackerId === card.instanceId));
  for (const ability of rulesOf(face).abilities) {
    if (typeof canResolve(state, 0, card, ability) !== "boolean") return "canResolve did not answer a boolean";
  }
  const baseline = cardCount(state);
  for (const move of moves) {
    const next = applyMove(state, 0, move);
    const again = applyMove(state, 0, move);
    const problem = brokenState(next);
    if (problem) return `${label}${move.type}): ${problem}`;
    if (cardCount(next) !== baseline) return `${label}${move.type}): non-token cards were not conserved`;
    if (JSON.stringify(next) !== JSON.stringify(again)) return `${label}${move.type}): the move is not deterministic`;
  }
  if (where === "board") {
    const ended = endTurn(state, 0);
    const problem = brokenState(ended) ?? brokenState(endTurn(ended, 1));
    if (problem) return `${label}turn boundaries): ${problem}`;
  }
  return null;
}

function exercise(face: CardFace, where: "hand" | "board"): string | null {
  if (where === "board" && face.type === "Action") return null;
  if (where === "board" && face.type === "Upgrade") return null;
  return exerciseTable(face, where, false) ?? exerciseTable(face, where, true);
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
  return { cardId: face.id, dsl: [], textHash: textHash(face.text ?? ""), source: "llm", reviewed: false, generatedAt: Date.now(), v: DSL_VERSION, failure: reason, ...(model ? { model } : {}) };
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
    no answer yet for this exact text. The cache is eternal per textHash, except
    for a FAILURE written by an older DSL_VERSION — the DSL grows every version
    and yesterday's "unsupported" may be expressible today, so those retry. */
export function pendingTranslations(cards: CardFace[], known: (id: string) => AbilityOverride | undefined): CardFace[] {
  return cards.filter((face) => {
    if (!face.text?.trim() || parseCardText(face).coverage === "full") return false;
    const row = known(face.id);
    if (!row || row.textHash !== textHash(face.text)) return true;
    return !!row.failure && (row.v ?? 1) < DSL_VERSION;
  });
}

/** The review queue's open rows (onda 2): `llm` answers a human has not ruled on
    yet — valid drafts and failures (vanilla + motive) — newest first. */
export function reviewQueue(rows: AbilityOverride[]): AbilityOverride[] {
  return rows.filter((row) => row.source === "llm" && !row.reviewed).sort((a, b) => b.generatedAt - a.generatedAt);
}

export type QueueRejection = "shape" | "version" | "source" | "unknownCard" | "hash" | "protected";

/** Porta de entrada da fila do harvest (CAT-3.5): cada linha do JSON exportado só
    é gravada se (a) passa na porta de forma, (b) não vem de uma DSL mais nova que
    a do motor, (c) é `llm`, (d) a carta existe no catálogo e (e) o textHash ainda
    bate com o texto dela. `existing` protege o que o dono já decidiu: uma linha
    manual/parser, ou uma aprovada, não é pisada por um rascunho. Linhas com o mesmo
    cardId: só a ÚLTIMA vale (é a que persistiria) e só ela é contada. JSON hostil
    (aninhamento que estoura a pilha do normalise) vira "shape", não exceção.
    Pura: a persistência real depende do storage; falhas de gravação são engolidas
    por design do cache. */
export function validateQueueRows(
  rows: unknown,
  cards: CardFace[],
  existing: ReadonlyMap<string, AbilityOverride> = new Map(),
): { valid: AbilityOverride[]; rejected: { cardId: string; reason: QueueRejection }[] } {
  const valid: AbilityOverride[] = [];
  const rejected: { cardId: string; reason: QueueRejection }[] = [];
  const byId = new Map(cards.map((face) => [face.id, face]));
  const list: any[] = Array.isArray(rows) ? rows : [];
  const lastOf = new Map<string, number>();
  list.forEach((raw, index) => { if (typeof raw?.cardId === "string") lastOf.set(raw.cardId, index); });
  for (const [index, raw] of list.entries()) {
    const id = typeof raw?.cardId === "string" ? raw.cardId : "?";
    if (id !== "?" && lastOf.get(id) !== index) continue;
    const reject = (reason: QueueRejection) => rejected.push({ cardId: id, reason });
    if (typeof raw?.v === "number" && raw.v > DSL_VERSION) { reject("version"); continue; }
    let row: AbilityOverride | null;
    try {
      row = normaliseAbilityOverride(raw);
    } catch {
      row = null;
    }
    if (!row) { reject("shape"); continue; }
    if (row.source !== "llm") { reject("source"); continue; }
    const face = byId.get(row.cardId);
    if (!face) { reject("unknownCard"); continue; }
    if (row.textHash !== textHash(face.text ?? "")) { reject("hash"); continue; }
    const current = existing.get(row.cardId);
    if (current && (current.source !== "llm" || (current.reviewed && !row.reviewed))) { reject("protected"); continue; }
    valid.push(row);
  }
  return { valid, rejected };
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
  // Erro de transporte (timeout/rede/provedor) numa carta não derruba a rodada:
  // vira failureRow — o contrato de versão re-enfileira depois — e a fila segue.
  // Só N falhas de transporte CONSECUTIVAS param, pois isso indica provedor fora,
  // não carta difícil (falha honesta zera o contador).
  const TRANSPORT = new Set(["llm.timeout", "llm.http", "llm.rateLimit", "llm.unreachable", "llm.badBody"]);
  let consecutiveTransport = 0;
  for (const face of queue) {
    if (options.signal?.aborted) break;
    let row: AbilityOverride;
    try {
      row = await translateCard(face, config, { signal: options.signal, fetcher: options.fetcher });
    } catch (error) {
      // An abort (Cancel button) is a stop, not a failure.
      if (options.signal?.aborted) break;
      const key = error instanceof VaultError && TRANSPORT.has(error.key) ? error.key : null;
      if (!key || consecutiveTransport >= 3) throw error;
      consecutiveTransport += 1;
      row = failureRow(face, key, config.model);
    }
    if (!row.failure || !TRANSPORT.has(row.failure)) consecutiveTransport = 0;
    await save(row);
    progress.done += 1;
    if (row.failure) progress.failed += 1;
    else progress.drafted += 1;
    options.onProgress?.({ ...progress });
  }
  return progress;
}
