// SPDX-License-Identifier: AGPL-3.0-only
// Camada 2 do catálogo dinâmico (docs/DYNAMIC_CATALOG_PLAN.md §4): o texto de uma
// carta que o parser não lê vira DSL pela API do provedor do usuário (BYOK) e só
// vira regra depois da VALIDAÇÃO TRIPLA — (a) schema, (b) dry-run numa partida
// sintética, (c) sanidade semântica. Reprovou = a carta segue vanilla e a fila
// guarda o motivo. Nada aqui é meio-resolvido: o rascunho que passa entra como
// `source: "llm"`, `reviewed: false` e só um humano o torna regra (abilities.ts).
import { type Ability, type AbilityOverride, DSL_VERSION, hasScript, type PersistentEffect, normaliseAbilityOverride, rulesOf, withTrialOverride } from "./abilities";
import { putAbilityOverride } from "./cache";
import { normalise, parseCardText, readableText, textHash } from "./cardText";
import { DEMO_DECK } from "./demoDeck";
import { DEMO_DECK_2 } from "./demoDeck2";
import { applyMove, canResolve, createMatch, effectivePower, endTurn, getLegalMoves, setHold, type CardFace, type CardInstance, type GameState } from "./game";
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
  /** The one omission the golden rule allows: the `Fate:` sentence was left
      out (Prophecy, out of the engine) and coverage reports "partial". */
  partial?: boolean;
}

/** Few-shot pairs: card text -> the exact answer. Each one is what the
    deterministic parser produces for that text (a spec asserts it), so the
    examples cannot drift from the engine — `promptOnly` marks the exception: a
    wording the MODEL must translate but the deterministic parser does not read,
    so the assertion checks that it stays outside the grammar instead. */
export const FEW_SHOTS: {
  type: string;
  text: string;
  promptOnly?: boolean;
  answer: DslAnswer | { unsupported: true; reason: string };
}[] = [
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
  // A Fate: sentence is the single omission the golden rule allows: the rest of
  // the card plays and the answer is marked `partial` (Lote 4 §4.1).
  {
    type: "Creature",
    text: "Play: Gain 1<A>. Fate: Archive a card.",
    answer: { abilities: [{ on: ["play"], acts: [{ k: "gainAmber", n: 1 }] }], effects: [], keywords: {}, partial: true },
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
  // Lote 4 (docs/DSL_EXPANSION_PLAN_WAVE2.md §2): Entrench/noReady, capture.own +
  // least, top-of-deck, `who`, takeControl.opp, myTurn, moveAmber e removeCounter.
  {
    type: "Creature",
    text: "Entrench. At the start of your turn, if this creature is exhausted, destroy an enemy creature.",
    answer: {
      abilities: [
        {
          on: ["startOfTurn"],
          acts: [{ k: "destroy", s: "target" }],
          target: { type: "Creature", side: "enemy" },
          if: { k: "count", of: { c: { self: true, exhausted: true } }, op: "gte", n: 1 },
        },
      ],
      effects: [],
      keywords: { entrench: 1 },
    },
  },
  {
    type: "Upgrade",
    text: "This creature cannot ready.",
    answer: { abilities: [], effects: [{ target: { host: true }, noReady: true }], keywords: {} },
  },
  {
    type: "Creature",
    text: "After Reap: The least powerful enemy creature captures 1<A> from its own side.",
    answer: {
      abilities: [
        { on: ["reap"], acts: [{ k: "capture", n: 1, own: true, s: { each: { type: "Creature", side: "enemy", least: 1 } } }] },
      ],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Action",
    text: "Play: Put an enemy creature on top of its owner's deck.",
    answer: {
      abilities: [{ on: ["play"], acts: [{ k: "returnToDeck", s: "target", at: "top" }], target: { type: "Creature", side: "enemy" } }],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Creature",
    text: "Play: Destroy a creature. Its controller gains 1<A>.",
    answer: {
      abilities: [
        {
          on: ["play"],
          acts: [{ k: "destroy", s: "target" }, { k: "gainAmber", n: 1, who: "controller" }],
          target: { type: "Creature" },
        },
      ],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Action",
    text: "Play: Give control of a friendly creature to your opponent.",
    answer: {
      abilities: [{ on: ["play"], acts: [{ k: "takeControl", s: "target", opp: true }], target: { type: "Creature", side: "friendly" } }],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Creature",
    text: "Destroyed: If it is not your turn, gain 2<A>.",
    answer: { abilities: [{ on: ["destroyed"], acts: [{ k: "gainAmber", n: 2 }], if: { k: "not", c: { k: "myTurn" } } }], effects: [], keywords: {} },
  },
  {
    type: "Creature",
    text: "After Reap: Return 1<A> from this creature to the common supply.",
    answer: { abilities: [{ on: ["reap"], acts: [{ k: "moveAmber", n: 1, s: "self", to: "supply" }] }], effects: [], keywords: {} },
  },
  {
    type: "Creature",
    text: "After Reap: You may remove each +1 power counter from a creature. If one or more counters are removed this way, archive a card.",
    answer: {
      abilities: [
        {
          on: ["reap"],
          acts: [
            { k: "removeCounter", s: "target", optional: true },
            { k: "move", n: 1, from: "hand", to: "archives", if: { k: "count", of: "did", op: "gte", n: 1 } },
          ],
          target: { type: "Creature" },
        },
      ],
      effects: [],
      keywords: {},
    },
  },
  // Lote 5 (docs/DSL_EXPANSION_PLAN_WAVE2.md §3): "Choose a house", o gatilho
  // `house`, forgeKey.less + purgar a própria Action e a aritmética de contagem.
  {
    type: "Action",
    text: "Play: Choose a house. Stun each creature of that house.",
    answer: { abilities: [{ on: ["play"], acts: [{ k: "stun", s: { each: { type: "Creature", house: "chosen" } } }] }], effects: [], keywords: {} },
  },
  {
    type: "Artifact",
    text: "After a player chooses an active house, destroy each artifact of that house.",
    answer: { abilities: [{ on: ["house"], acts: [{ k: "destroy", s: { each: { type: "Artifact", house: "active" } } }] }], effects: [], keywords: {} },
  },
  {
    type: "Action",
    text: "Play: Forge a key at +8<A> current cost, reduced by 1<A> for each <A> in your opponent's pool. If you do, purge this card.",
    answer: {
      abilities: [
        {
          on: ["play"],
          acts: [
            { k: "forgeKey", n: 1, mod: 8, less: { p: "amber", opp: true } },
            { k: "purge", s: "self", if: { k: "count", of: "did", op: "gte", n: 1 } },
          ],
        },
      ],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Action",
    text: "Play: Steal all but 6 of your opponent's <A>.",
    answer: { abilities: [{ on: ["play"], acts: [{ k: "steal", n: 1, per: { sub: [{ p: "amber", opp: true }, 6] } }] }], effects: [], keywords: {} },
  },
  {
    type: "Artifact",
    text: "Action: If your opponent has an even amount of <A>, steal 1<A>.",
    answer: {
      abilities: [{ on: ["action"], acts: [{ k: "steal", n: 1 }], if: { k: "count", of: { p: "amber", opp: true }, op: "even", n: 0 } }],
      effects: [],
      keywords: {},
    },
  },
  // O formato `unsupported` continua ensinado: nem toda carta é representável.
  {
    type: "Action",
    text: "Play: Look at your opponent's hand and discard a card from it.",
    answer: { unsupported: true, reason: "Looking at hidden information is not representable." },
  },
  // Só prompt (§4.3): "repeat the preceding effect" = os mesmos atos duplicados
  // com `if`; o parser determinístico não lê a sentença, então este shot não
  // carrega a invariante "o parser produz exatamente a resposta".
  {
    type: "Creature",
    promptOnly: true,
    text: "After Reap: Deal 2<D> to an enemy creature. If that creature has <A> on it, repeat the preceding effect.",
    answer: {
      abilities: [
        {
          on: ["reap"],
          acts: [
            { k: "damage", n: 2, s: "target" },
            {
              k: "damage",
              n: 2,
              s: { pick: { type: "Creature", side: "enemy" } },
              if: { k: "count", of: { of: "amber", s: "target" }, op: "gte", n: 1 },
            },
          ],
          target: { type: "Creature", side: "enemy" },
        },
      ],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Action",
    text: "Play: Destroy each creature with power 3 or lower.",
    answer: { abilities: [{ on: ["play"], acts: [{ k: "destroy", s: { each: { type: "Creature", powerMax: 3 } } }] }], effects: [], keywords: {} },
  },
  {
    type: "Creature",
    text: "After an enemy creature is destroyed fighting ~, gain 1<A>.",
    answer: { abilities: [{ on: ["destroyed"], of: { type: "Creature", side: "enemy", fighting: true }, acts: [{ k: "gainAmber", n: 1 }] }], effects: [], keywords: {} },
  },
  {
    type: "Creature",
    text: "After your opponent forges a key, destroy ~ and ward each friendly creature.",
    answer: {
      abilities: [{ on: ["forge"], if: { k: "actor", opp: true }, acts: [{ k: "destroy", s: "self" }, { k: "ward", s: { each: { type: "Creature", side: "friendly" } } }] }],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Creature",
    text: "After a player readies a creature, deal 1<D> to it.",
    answer: { abilities: [{ on: ["ready"], of: { type: "Creature" }, acts: [{ k: "damage", n: 1, s: "event" }] }], effects: [], keywords: {} },
  },
  {
    type: "Creature",
    text: "After a friendly Cat creature enters play, ward it.",
    answer: { abilities: [{ on: ["enter"], of: { type: "Creature", side: "friendly", trait: "Cat" }, acts: [{ k: "ward", s: "event" }] }], effects: [], keywords: {} },
  },
  {
    type: "Creature",
    text: "After Fight: Steal 1<A>. If a blue key is forged, ward ~.",
    answer: { abilities: [{ on: ["fight"], acts: [{ k: "steal", n: 1 }, { k: "ward", s: "self", if: { k: "key", color: "blue", any: true } }] }], effects: [], keywords: {} },
  },
  {
    type: "Action",
    text: "Play: For each color represented among forged keys, steal 1<A>.",
    answer: { abilities: [{ on: ["play"], acts: [{ k: "steal", n: 1, per: { p: "keyColors", any: true } }] }], effects: [], keywords: {} },
  },
  {
    type: "Action",
    text: "Play: Deal 1<D> to up to three creatures. Gain 1<A> for each creature destroyed this way.",
    answer: {
      abilities: [{ on: ["play"], acts: [{ k: "damage", n: 1, s: { pick: { type: "Creature" }, n: 3, upTo: true } }, { k: "gainAmber", n: 1, per: "gone" }] }],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Action",
    text: "Play: Move all <A> from one creature to another creature.",
    answer: {
      abilities: [{ on: ["play"], target: { type: "Creature", amber: true }, target2: { type: "Creature" }, acts: [{ k: "moveAmber", s: "target", to: "target2" }] }],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Action",
    text: "Play: Discard cards from the top of your deck until you discard a Logos card or run out of cards. If you discard a Logos card this way, put it into your hand.",
    answer: {
      abilities: [
        {
          on: ["play"],
          acts: [
            { k: "move", n: 1, from: "deck", to: "discard", pick: "top", until: { house: "Logos" } },
            { k: "move", n: 1, from: "discard", to: "hand", pick: "moved", house: "Logos" },
          ],
        },
      ],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Artifact",
    text: "After a card is discarded from your hand, archive the top card of your deck.",
    answer: { abilities: [{ on: ["discard"], of: {}, if: { k: "actor" }, acts: [{ k: "archiveTop" }] }], effects: [], keywords: {} },
  },
  {
    type: "Action",
    text: "Play: Discard the bottom card of your opponent's deck. Deal 2<D> to each enemy creature that shares a house with the discarded card.",
    answer: {
      abilities: [{ on: ["play"], acts: [{ k: "move", n: 1, from: "deck", to: "discard", opp: true, pick: "bottom" }, { k: "damage", n: 2, s: { each: { type: "Creature", side: "enemy", house: "moved" } } }] }],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Action",
    text: "Play: Destroy each creature that does not share a house with at least 1 of its neighbors.",
    answer: { abilities: [{ on: ["play"], acts: [{ k: "destroy", s: { each: { type: "Creature", house: "!neighbor" } } }] }], effects: [], keywords: {} },
  },
  {
    type: "Action",
    promptOnly: true,
    text: "Play: Deal 2<D> to a creature. If it is not destroyed, its controller must choose that creature's house as their active house on their next turn.",
    answer: {
      abilities: [{
        on: ["play"],
        target: { type: "Creature" },
        acts: [
          { k: "damage", n: 2, s: "target" },
          { k: "forceHouse", house: "target", who: "controller", if: { k: "count", of: "gone", op: "eq", n: 0 } },
        ],
      }],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Action",
    text: "Play: Discard the top 6 cards of your deck. You may put a non-Geistoid card discarded this way into your hand.",
    answer: {
      abilities: [{
        on: ["play"],
        acts: [
          { k: "move", n: 6, from: "deck", to: "discard", pick: "top" },
          { k: "move", n: 1, from: "discard", to: "hand", pick: "moved", house: "!Geistoid", optional: true },
        ],
      }],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Action",
    text: "Play: Your opponent discards a random card from their hand. For each bonus icon on the discarded card, they lose 1<A>.",
    answer: {
      abilities: [{ on: ["play"], acts: [{ k: "discardRandom", n: 1, opp: true }, { k: "loseAmber", n: 1, opp: true, per: { m: "icons" } }] }],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Creature",
    text: "After Reap: Purge a card from your discard pile. If you do, until the start of your next turn, your opponent cannot play cards of the purged card's type.",
    answer: {
      abilities: [{
        on: ["reap"],
        acts: [
          { k: "move", n: 1, from: "discard", to: "purged" },
          { k: "lasting", e: { target: {}, restrict: { who: "opponent", action: "play", type: "moved" }, duration: "next" }, if: { k: "count", of: "did", op: "gte", n: 1 } },
        ],
      }],
      effects: [],
      keywords: {},
    },
  },
  {
    type: "Creature",
    text: 'During their "draw cards" step, your opponent refills their hand to 1 less card.',
    answer: { abilities: [], effects: [{ target: {}, hand: -1, opp: true }], keywords: {} },
  },
  {
    type: "Creature",
    text: "At the end of your turn, put a scheme counter on ~. Action: Remove each scheme counter from ~. Steal 1<A> for each scheme counter removed this way.",
    answer: {
      abilities: [
        { on: ["endOfTurn"], acts: [{ k: "counter", n: 1, s: "self", name: "scheme" }] },
        { on: ["action"], acts: [{ k: "removeCounter", s: "self", name: "scheme" }, { k: "steal", n: 1, per: "did" }] },
      ],
      effects: [],
      keywords: {},
    },
  },
];

const SYSTEM_RULES = [
  "You translate the printed text of a KeyForge card into a JSON DSL for a rules engine.",
  'Answer with ONLY one JSON object: {"abilities": Ability[], "effects": PersistentEffect[], "keywords": Keywords, "partial"?: true}, or {"unsupported": true, "reason": "<short>"}.',
  "GOLDEN RULE: every sentence of the card text must be representable EXACTLY with the types below. If any sentence is not, answer unsupported. Never approximate, never invent, never drop a sentence.",
  'The ONE exception: a "Fate:" sentence belongs to the Prophecy subsystem the engine does not resolve. Omit ONLY that sentence and add "partial": true — every other sentence must still be represented. Never answer partial for a card without Fate:.',
  "Keep the order of the text. Printed keywords (Elusive. Skirmish. Taunt. Assault 2 ...) go in `keywords` with their number (1 when absent), not in abilities.",
  'Prefixes map to triggers: "Play:" play, "Reap:" reap, "Fight:" fight, "Before Fight:" beforeFight, "Destroyed:" destroyed, "Action:" action, "Omni:" omni, "At the start of your turn:" startOfTurn, "At the end of your turn:" endOfTurn. "After X:" / "Each time X:" bind to the same trigger.',
  'An Ability `target` is the filter of the creature the player chooses; acts that use it say `s: "target"`. "You may" => `optional: true`. <A> is amber, <D> is damage.',
  'Ignore an "Enhance" sentence (its icons are deck-building bonusIcons, not an ability). "You are overwhelmed" = fewerCreatures. "Otherwise, X" = a second ability with if {"k":"not","c":<the previous condition>}.',
  '"Scrap:" = on ["scrap"] (the card in its discard pile). "If you do" = the act\'s if {"k":"count","of":"did","op":"gte","n":1}: a condition in a later clause gates only its own acts. "Haunted" = 10+ cards in your discard.',
  '"for each X" = the act\'s per. Filters: {"house":"Mars"}, {"house":"!Mars"}, {"trait":"Knight"}, {"house":"active"}. "keys cost +N" (no possessive) = two effects (owner + opp).',
  'Watchers ("After an enemy creature reaps, stun it.") set `of` to the watched filter; the event card is s:"event". "After your opponent plays a creature" = on ["play"], of {"type":"Creature","side":"enemy"}; "Each time you use an artifact" = on ["action","omni"].',
  '"Ready and fight/reap with X" = [{k:"ready",s:"target"},{k:"use",s:"target",via:"fight"|"reap"}]. "Give X two +1 power counters" = {k:"counter",n:2,s:...}. Splash: "Deal 3<D> to a creature, with 1<D> splash" = [{k:"damage",n:1,s:"targetNeighbors"},{k:"damage",n:3,s:"target"}] — neighbors first, the only exception to the printed order.',
  '"If <condition>, repeat the preceding effect" = duplicate the acts of the preceding effect with that condition in the duplicated acts\' `if` (the repeated target becomes a {pick} of the same filter). "Repeat this effect" as a loop stays unsupported.',
  '"May be used as if it belonged to the active house" (Versatile\'s reminder) = keyword versatile; granted through effects when another card grants it. "May be played as if it belonged to the active house" is the same permission ONLY in that bare form — "as if it was in your hand/discard pile" stays unsupported.',
  '"The creature ~ fights" / "the attacked enemy" = s:"fought" (the defender of the fight in progress).',
  '"If a red key is forged" = {"k":"key","color":"red","any":true}; "your red key" = no `any`, "your opponent\'s" = opp:true; "each color represented among forged keys" = per {"p":"keyColors","any":true}. "Up to N creatures" / "any number of X" = s {"pick":<filter>,"n":N,"upTo":true} (99 for any number) — no `target`. "One creature … another creature" = `target` plus `target2` (always a different card, s:"target2"); "to a flank" = {"k":"toFlank","s":"target"}. "Discard from the top of your deck until you discard X" = a move with `until` ({"house"} or {"type"}) from deck to discard; "After a card is discarded from your hand" = on ["discard"], of {} and if {"k":"actor"} (opp:true for the opponent\'s hand, no `if` for any hand).',
  '"Choose a house" resolves no act: the NEXT sentences read it as {"house":"chosen"} ("of that house"). "Your opponent must choose that house next turn" = {"k":"forceHouse"}. "After a player chooses an active house, X" = on ["house"], and "that house" there is {"house":"active"}; "After you choose" adds if {"k":"myTurn"}.',
  '"Forge a key at +N cost, reduced by 1 for each X" = forgeKey with mod N and less = the count of X; "If you do, purge ~" on an Action = {"k":"purge","s":"self","if":<did gte 1>}. "Steal all but N of your opponent\'s <A>" = steal n 1 per {"sub":[{"p":"amber","opp":true},N]}. "an even/odd amount of <A>" = count op "even"/"odd" (n ignored). "If you forged a key on your previous turn" = {"k":"forged"} (opp:true for the opponent).',
  '"This creature belongs to all houses" = effects [{target, house:"all"}]. "X cannot be dealt damage" = effects [{target, replace:{on:"damage",prevent:true}}]; "your <A> cannot be stolen" = effects [{target:{},noSteal:true}]. `unless <cond>` = `if: not <cond>` on the effect. A card always goes to its owner\'s zone. A filter without `type` matches any card in play.',
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
export async function callProvider(config: LlmConfig, messages: ChatMessage[], options: { signal?: AbortSignal; fetcher?: Fetcher; timeoutMs?: number } = {}): Promise<string> {
  if (!llmReady(config)) throw new VaultError("llm.noKey");
  const { signal, clear } = withTimeout(options.timeoutMs ?? LLM_TIMEOUT_MS, options.signal);
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

function draftRow(
  face: CardFace,
  parts: { abilities: unknown; effects?: unknown; keywords?: unknown; partial?: unknown },
  source: AbilityOverride["source"],
  model?: string,
): Draft {
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
  const row = normaliseAbilityOverride({ ...base, dsl: parts.abilities, effects, keywords, ...(parts.partial === true ? { partial: true } : {}) });
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
  // "After a player chooses an active house" (Lote 5 §5.2).
  house: /\bchooses?\b[^.]*\bactive house\b/,
  forge: /\bforges?\b|\bkey is forged\b/,
  ready: /\breadies\b/,
  enter: /\benters play\b/,
};
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const TARGETED = new Set(["target", "targetAndNeighbors", "targetNeighbors"]);

function actProblem(act: Ability["acts"][number], ability: Ability, face: CardFace, text: string): string | null {
  // `n` is optional on moveAmber/removeCounter (absent = all).
  if ("n" in act && act.n !== undefined && (!Number.isInteger(act.n) || act.n < 1 || act.n > 20)) return `${act.k}: n=${act.n} is out of range`;
  // A number the printed text never states is a hallucination ("a"/"an" = 1).
  if ("n" in act && act.n !== undefined && act.n > 1 && !new RegExp(`\\b(${act.n}|${NUMBER_WORDS[act.n] ?? "$^"})\\b`).test(text)) return `${act.k}: the number ${act.n} is not in the card text`;
  if ("s" in act && typeof act.s === "string" && TARGETED.has(act.s) && !ability.target) return `${act.k}: selects a target but the ability has no \`target\` filter`;
  if ("s" in act && act.s === "host" && face.type !== "Upgrade") return `${act.k}: "host" only exists on upgrades`;
  // Observers: "event" only exists when the ability declares what it watches.
  if ("s" in act && act.s === "event" && !ability.of) return `${act.k}: selects the event but the ability has no \`of\` filter`;
  // §3.1: the re-trigger loop the dry-run would only catch as a stack overflow.
  if (act.k === "use" && act.s === "self" && (ability.on.includes("fight") || ability.on.includes("beforeFight"))) {
    return `use: "self" on a ${ability.on.join("/")} trigger would re-run the ability forever`;
  }
  if (act.k === "lasting" && !act.e.duration) return "lasting: the effect has no duration";
  // Lote 5: the numbers of a forge/sub must come from the text, and a house
  // reader needs the sentence that makes the choice.
  if (act.k === "forgeKey") {
    for (const value of [act.mod, act.min]) {
      if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 20)) return `forgeKey: ${value} is out of range`;
      if (value !== undefined && value > 1 && !new RegExp(`\\b(${value}|${NUMBER_WORDS[value] ?? "$^"})\\b`).test(text)) return `forgeKey: the number ${value} is not in the card text`;
    }
  }
  if (act.k === "forceHouse" && !/\bchoose a house\b/.test(text)) return 'forceHouse: the card text never says "choose a house"';
  if (act.k === "setHouse" && act.house !== "chosen" && !new RegExp(`\\b${act.house.toLowerCase()}\\b`).test(text)) return `setHouse: the house ${act.house} is not in the card text`;
  if (JSON.stringify(act).includes('"chosen"') && !/\bchoose a house\b/.test(text)) return 'a "chosen" house is read but the card text never says "choose a house"';
  return null;
}

/** (c): triggers are possible for the card type and cited by the text, targets
    exist, numbers come from the text. Structure (known triggers/acts/keywords) is
    already guaranteed by (a). */
export function sanityProblem(face: CardFace, row: AbilityOverride): string | null {
  const text = normalise(face.text ?? "");
  const checkAbility = (ability: Ability, type: string = face.type): string | null => {
    for (const trigger of ability.on) {
      if (type === "Action" || type === "Upgrade") {
        // Scrap is a trigger of the card DISCARDED from hand: an Action/Upgrade
        // is the card that reaches the pile (keyteki Scrap: on those types).
        if (trigger !== "play" && trigger !== "scrap") return `trigger "${trigger}" cannot happen on a ${type} card`;
      } else if (type === "Artifact" && (trigger === "reap" || trigger === "fight" || trigger === "beforeFight")) {
        return `trigger "${trigger}" cannot happen on an Artifact`;
      }
      // Fora de Action não existe Play implícito: em Creature/Artifact/Upgrade o
      // texto sem gatilho conhecido costuma ser habilidade constante ou um gatilho
      // que a tabela não cobre (Fate:, Scrap:). Exigir a nomeação erra para o lado
      // conservador — o rascunho errado vira falha, nunca regra.
      if (!(trigger === "play" && type === "Action") && !TRIGGER_WORDS[trigger].test(text)) return `trigger "${trigger}" is not named by the card text`;
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
    // A granted ability belongs to the HOST creature, not to the Upgrade that
    // prints it ("This creature gains, 'At the start of your turn, …'" — case
    // Starpatch, Lote 4 §4.0): validate it as a Creature.
    const hostType = face.type === "Upgrade" ? "Creature" : face.type;
    for (const ability of effect.abilities ?? []) {
      const problem = checkAbility(ability, hostType);
      if (problem) return `sanity: ${problem}`;
    }
    if (Math.abs(effect.power ?? 0) > 20 || Math.abs(effect.armor ?? 0) > 20) return "sanity: stat modifier out of range";
  }
  if (!row.dsl.length && !row.effects?.length && !Object.keys(row.keywords ?? {}).length) return "sanity: empty translation (the card should have been answered unsupported)";
  // `partial` is the one licensed omission and exists only for Fate: (Lote 4
  // §4.1): it can neither skip a sentence on a card without Fate: nor be
  // silently absent when the Fate: sentence was dropped.
  if (row.partial === true && !/\bfate\s*:/.test(text)) return "sanity: partial is only allowed when the card prints a Fate: sentence";
  if (row.partial !== true && /\bfate\s*:/.test(text)) return "sanity: the Fate: sentence may only be omitted with partial: true";
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
    // Entrench (§4.2): the ready step must be exercised with `hold` both ways —
    // the held branch is where `noReady`/Entrench bugs would hide.
    for (const hold of [false, true]) {
      const held = setHold(state, 0, card.instanceId, hold);
      const ended = endTurn(held, 0);
      const problem = brokenState(ended) ?? brokenState(endTurn(ended, 1));
      if (problem) return `${label}turn boundaries): ${problem}`;
    }
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
export function validateDraft(
  face: CardFace,
  parts: { abilities: unknown; effects?: unknown; keywords?: unknown; partial?: unknown },
  source: AbilityOverride["source"],
  model?: string,
): Validation {
  const draft = draftRow(face, parts, source, model);
  if (!draft.ok) return { ok: false, reason: draft.reason };
  const problem = sanityProblem(face, draft.row) ?? dryRunProblem(face, draft.row);
  return problem ? { ok: false, reason: problem } : { ok: true, row: draft.row };
}

/** Vanilla + motive: an untrusted row with an empty DSL the queue lists. `tries`
    counts the `reply:` attempts already spent (Lote 4 §4.0). */
export function failureRow(face: CardFace, reason: string, model?: string, options: { tries?: number } = {}): AbilityOverride {
  const row: AbilityOverride = {
    cardId: face.id,
    dsl: [],
    textHash: textHash(face.text ?? ""),
    source: "llm",
    reviewed: false,
    generatedAt: Date.now(),
    v: DSL_VERSION,
    failure: reason,
    ...(model ? { model } : {}),
  };
  if (options.tries !== undefined) row.tries = options.tries;
  return row;
}

/** Parser output for the parts the model may have left out: the parser's own
    effects stand in when the model returns none, and printed keywords merge.
    `partial` (a dropped Fate: sentence) rides along with the answer. */
function withParserParts(face: CardFace, answer: Record<string, unknown>): { abilities: unknown; effects: unknown; keywords: unknown; partial: boolean } {
  const parsed = parseCardText(face);
  const effects = Array.isArray(answer.effects) && answer.effects.length ? answer.effects : parsed.effects;
  const keywords = isRecord(answer.keywords) ? { ...parsed.keywords, ...answer.keywords } : parsed.keywords;
  return { abilities: answer.abilities, effects, keywords, partial: answer.partial === true };
}

/** Translates one card. Resolves with a row ALWAYS — the validated draft or a
    failure row — and rejects only on transport problems (no key, auth, network,
    rate limit) so a run can stop instead of burning every card on the same error. */
export async function translateCard(
  face: CardFace,
  config: LlmConfig,
  options: { signal?: AbortSignal; fetcher?: Fetcher; tries?: number; timeoutMs?: number } = {},
): Promise<AbilityOverride> {
  const reply = await callProvider(config, buildMessages(face), options);
  const model = config.model.trim();
  const answer = extractJson(reply);
  if (!isRecord(answer)) return failureRow(face, "reply: not a JSON object", model, { tries: (options.tries ?? 0) + 1 });
  if (answer.unsupported === true) return failureRow(face, `unsupported: ${typeof answer.reason === "string" ? answer.reason.slice(0, 200) : "not representable"}`, model);
  const result = validateDraft(face, withParserParts(face, answer), "llm", model);
  // Schema, sanity and dry-run failures count like a spent attempt. Without
  // `tries` the card stays under the draft cap forever (Lote 6 review).
  return result.ok ? result.row! : failureRow(face, result.reason ?? "invalid", model, { tries: (options.tries ?? 0) + 1 });
}

/** Tries already spent on this version. A row from an older DSL counts as zero
    (Lote 6 §6.0): a v6 `tries: 3` must not become 4 on the first v7 failure. */
export function translationTries(row: AbilityOverride | undefined): number {
  if (!row || (row.v ?? 1) < DSL_VERSION) return 0;
  return row.tries ?? 0;
}

const DRAFT_FAIL = /^(?:schema|sanity|dry-run)\b/;

/** Cards worth a call. Retry is by failure class (Lote 6 §6.0): verdicts only
    when `v` is older; invalid drafts twice; `reply:` three times; transport
    (`llm.*`) five times. Order: never tried, then drafts, then format, then
    transport — so the same timeouts do not occupy the head of every round. */
export function pendingTranslations(cards: CardFace[], known: (id: string) => AbilityOverride | undefined): CardFace[] {
  const fresh: CardFace[] = [];
  const drafts: CardFace[] = [];
  const format: CardFace[] = [];
  const transport: CardFace[] = [];
  for (const face of cards) {
    if (!face.text?.trim() || hasScript(face) || parseCardText(face).coverage === "full") continue;
    const row = known(face.id);
    if (!row || row.textHash !== textHash(face.text)) {
      fresh.push(face);
      continue;
    }
    if (!row.failure) continue;
    if ((row.v ?? 1) < DSL_VERSION) {
      fresh.push(face);
      continue;
    }
    const tries = row.tries ?? 0;
    if (row.failure.startsWith("unsupported:")) continue;
    if (DRAFT_FAIL.test(row.failure) && tries < 2) drafts.push(face);
    else if (row.failure.startsWith("reply:") && tries < 3) format.push(face);
    else if (row.failure.startsWith("llm.") && tries < 5) transport.push(face);
  }
  return [...fresh, ...drafts, ...format, ...transport];
}

/** One call per printed text and card type (the dry-run differs by type). */
export function groupByText(faces: CardFace[]): CardFace[][] {
  const groups = new Map<string, CardFace[]>();
  for (const face of faces) {
    const key = `${textHash(face.text ?? "")}|${face.type}`;
    const list = groups.get(key) ?? [];
    list.push(face);
    groups.set(key, list);
  }
  return [...groups.values()];
}

/** Rows the harvest export keeps. Transport is not a verdict; scripts, unknown
    ids and cards the parser now covers are pruned (Lote 6 §6.0). */
export function exportableRows(rows: AbilityOverride[], cards: CardFace[]): AbilityOverride[] {
  const byId = new Map(cards.map((face) => [face.id, face]));
  return rows.filter((row) => {
    if (row.failure?.startsWith("llm.")) return false;
    const face = byId.get(row.cardId);
    if (!face) return false;
    if (row.failure && (hasScript(face) || parseCardText(face).coverage === "full")) return false;
    return true;
  });
}

/** The review queue's open rows (onda 2): `llm` answers a human has not ruled on
    yet — valid drafts and failures (vanilla + motive) — newest first. `covered`
    prunes the zombies (§4.0): a failure whose card the parser reads fully today
    is stale, so neither the queue nor the export keeps showing it. */
export function reviewQueue(rows: AbilityOverride[], covered: (cardId: string) => boolean = () => false): AbilityOverride[] {
  return rows
    .filter((row) => row.source === "llm" && !row.reviewed)
    .filter((row) => !(row.failure && covered(row.cardId)))
    .sort((a, b) => b.generatedAt - a.generatedAt);
}

/** Failures a human approved (no rule came out of them): the only approved rows
    worth reopening — a validated draft became a rule on purpose. */
export function approvedFailures(rows: AbilityOverride[]): AbilityOverride[] {
  return rows
    .filter((row) => row.source === "llm" && row.reviewed && row.failure)
    .sort((a, b) => b.generatedAt - a.generatedAt);
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
  options: {
    limit?: number;
    signal?: AbortSignal;
    fetcher?: Fetcher;
    save?: (row: AbilityOverride) => Promise<void>;
    onProgress?: (progress: RunProgress) => void;
    /** Attempts already spent on a `reply:` failure, so the retry can count
        them (Lote 4 §4.0). */
    previous?: (cardId: string) => number | undefined;
    /** Chamadas em paralelo ao provedor (padrão 1 = sequencial). O harvest usa
        HARVEST_CONCURRENCY; respeite o max_concurrency do provedor local. */
    concurrency?: number;
  } = {},
): Promise<RunProgress> {
  // Identical texts are one call. Grouping after the slice would split a
  // repeated text across the limit and pay for it again next round.
  const groups = groupByText(faces).slice(0, options.limit ?? LLM_RUN_LIMIT);
  const save = options.save ?? putAbilityOverride;
  const progress: RunProgress = { done: 0, total: groups.reduce((sum, group) => sum + group.length, 0), drafted: 0, failed: 0 };
  options.onProgress?.({ ...progress });
  // Erro de transporte (timeout/rede/provedor) numa carta não derruba a rodada:
  // um retry imediato com o dobro do timeout, depois failureRow com `tries`.
  // Só N falhas de transporte CONSECUTIVAS param, pois isso indica provedor fora,
  // não carta difícil (falha honesta zera o contador).
  const TRANSPORT = new Set(["llm.timeout", "llm.http", "llm.rateLimit", "llm.unreachable", "llm.badBody"]);
  const transportKey = (error: unknown) => (error instanceof VaultError && TRANSPORT.has(error.key) ? error.key : null);
  let consecutiveTransport = 0;
  // Pool de workers sobre os grupos (textos idênticos são UMA chamada). As
  // gravações são serializadas por uma cadeia de promessas: o drafts.json é
  // reescrito inteiro a cada save e não tolera duas escritas concorrentes.
  const concurrency = Math.max(1, options.concurrency ?? 1);
  let next = 0;
  let saveChain = Promise.resolve();
  let saveError = null as { error: unknown } | null;
  // consecutiveTransport é GLOBAL de propósito: com workers concorrentes, 3
  // grupos esgotados em qualquer ordem = provedor fora, e a rodada para.
  const translateGroup = async (group: CardFace[]): Promise<void> => {
    if (options.signal?.aborted) return;
    const face = group[0];
    const spent = options.previous?.(face.id) ?? 0;
    let row: AbilityOverride;
    try {
      row = await translateCard(face, config, { signal: options.signal, fetcher: options.fetcher, tries: spent });
    } catch (error) {
      if (options.signal?.aborted) return;
      const key = transportKey(error);
      if (!key || consecutiveTransport >= 3) throw error;
      try {
        row = await translateCard(face, config, { signal: options.signal, fetcher: options.fetcher, tries: spent, timeoutMs: LLM_TIMEOUT_MS * 2 });
      } catch (again) {
        if (options.signal?.aborted) return;
        const retryKey = transportKey(again);
        if (!retryKey) throw again;
        consecutiveTransport += 1;
        row = failureRow(face, retryKey, config.model, { tries: spent + 1 });
      }
    }
    if (!row.failure || !TRANSPORT.has(row.failure)) consecutiveTransport = 0;
    // O worker NÃO espera a cadeia: segue para o próximo fetch enquanto o save
    // (rápido, mas serializado) corre; a cadeia é descarregada antes do return.
    saveChain = saveChain.then(async () => {
      if (saveError) return;
      try {
        for (const sibling of group) {
          const copy = sibling === face ? row : { ...row, cardId: sibling.id };
          await save(copy);
          progress.done += 1;
          if (copy.failure) progress.failed += 1;
          else progress.drafted += 1;
        }
        options.onProgress?.({ ...progress });
      } catch (error) {
        saveError = { error };
      }
    });
  };
  const workers = Array.from({ length: Math.min(concurrency, groups.length) }, async () => {
    while (next < groups.length && !saveError) {
      const index = next++;
      await translateGroup(groups[index]);
    }
  });
  try {
    await Promise.all(workers);
  } finally {
    // Também no abort/erro de transporte: nenhuma linha já traduzida se perde.
    await saveChain;
  }
  if (saveError) throw saveError.error;
  return progress;
}
