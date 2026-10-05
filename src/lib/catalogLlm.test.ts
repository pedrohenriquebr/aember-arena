// SPDX-License-Identifier: AGPL-3.0-only
// Onda 2 do catálogo dinâmico: pipeline LLM com provedor mockado (fetch stub),
// validação tripla, redaction da chave e o schema gerado do abilities.ts.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normaliseAbilityOverride, DSL_VERSION, rulesOf, setAbilityOverrides, type Ability, type AbilityOverride } from "./abilities";
import { approvedFailures, buildMessages, callProvider, dryRunProblem, exportableRows, extractJson, FEW_SHOTS, groupByText, pendingTranslations, reviewQueue, runTranslation, sanityProblem, translateCard, translationTries, validateDraft, validateQueueRows } from "./catalogLlm";
import { parseCardText, textHash } from "./cardText";
import type { CardFace } from "./game";
import { DSL_SCHEMA } from "./generated/dslSchema";
import { applyLlmPreset, DEFAULT_LLM, llmReady, LLM_PRESETS, readLlmConfig, redactSecret, saveLlmConfig, type LlmConfig } from "./settings";
// @ts-expect-error — script de build em .mjs sem tipos
import { renderModule } from "../../scripts/gen-dsl-schema.mjs";

const KEY = "sk-secret-key-12345";
const config: LlmConfig = { preset: "custom", baseUrl: "https://llm.example/v1/", apiKey: KEY, model: "tiny" };

const face = (text: string, patch: Partial<CardFace> = {}): CardFace => ({
  id: "c-1",
  title: "Probe Creature",
  house: "Logos",
  type: "Creature",
  image: "",
  text,
  amber: 0,
  power: 3,
  armor: 0,
  ...patch,
});

const reply = (content: unknown, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), { status });
const stub = (...responses: Response[]) => {
  const queue = [...responses];
  const fetcher = vi.fn(async () => queue.shift() ?? reply({ unsupported: true, reason: "empty" }));
  return fetcher as unknown as typeof fetch & ReturnType<typeof vi.fn>;
};

const VALID = { abilities: [{ on: ["reap"], acts: [{ k: "gainAmber", n: 1 }] }], effects: [], keywords: {} };

afterEach(() => {
  setAbilityOverrides(new Map());
  vi.unstubAllGlobals();
});

describe("prompt", () => {
  it("carries the generated schema, the rules and the few-shots before the card", () => {
    const messages = buildMessages(face("Reap: Gain 1<A>."));
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain(DSL_SCHEMA);
    expect(messages[0].content).toContain("unsupported");
    expect(messages[0].content).toContain("GOLDEN RULE");
    expect(messages.length).toBe(1 + FEW_SHOTS.length * 2 + 1);
    expect(messages.at(-1)?.content).toContain("Reap: Gain 1<A>.");
    expect(messages.some((message) => message.role === "assistant" && message.content.includes('"unsupported":true'))).toBe(true);
  });

  it("sends the clean printed text: glyphs as <A>/<D>, no reminders, no Enhance line", () => {
    const messages = buildMessages(face("Enhance \uF362\uF362. (These icons were added to your deck.)\nPlay: Steal 1\uF360."));
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("Play: Steal 1<A>.");
    expect(prompt).not.toContain("Enhance");
    expect(prompt).not.toContain("(");
    expect(messages[0].content).toContain("Ignore an \"Enhance\"");
    expect(messages[0].content).toContain("fewerCreatures");
    expect(messages[0].content).toContain("Otherwise");
  });

  it("few-shot answers are exactly what the parser produces (no drift from the engine)", () => {
    for (const shot of FEW_SHOTS) {
      const parsed = parseCardText(face(shot.text, { type: shot.type }));
      if ("unsupported" in shot.answer || shot.promptOnly) {
        // `unsupported` (out of the grammar) and `promptOnly` (a wording only
        // the MODEL translates, §4.3) must stay outside the deterministic parser.
        expect(parsed.coverage).not.toBe("full");
        continue;
      }
      const { partial, ...expected } = shot.answer;
      // `partial` is metadata of the answer, not a parser part: the parser must
      // agree on the coverage instead.
      if (partial) expect(parsed.coverage).toBe("partial");
      expect({ abilities: parsed.abilities, effects: parsed.effects, keywords: parsed.keywords }).toEqual(expected);
    }
  });

  it("the generated schema is in sync with abilities.ts", () => {
    const source = readFileSync(new URL("./abilities.ts", import.meta.url), "utf8");
    const generated = readFileSync(new URL("./generated/dslSchema.ts", import.meta.url), "utf8");
    // The checkout may be CRLF; the generator ignores carriage returns.
    expect(generated.split(String.fromCharCode(13)).join("")).toBe(renderModule(source));
  });
});

describe("provider call", () => {
  it("posts OpenAI-compatible JSON with a bearer key", async () => {
    const fetcher = stub(reply("ok"));
    await expect(callProvider(config, [{ role: "user", content: "hi" }], { fetcher })).resolves.toBe("ok");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://llm.example/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "tiny", temperature: 0 });
  });

  it("merges extra headers without overriding Authorization/Content-Type", async () => {
    const fetcher = stub(reply("ok"));
    const extraHeaders = JSON.stringify({ "x-opencode-session": "aember-arena-game", authorization: "evil", "Content-Type": "text/plain" });
    await callProvider({ ...config, extraHeaders }, [], { fetcher });
    const headers = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["x-opencode-session"]).toBe("aember-arena-game");
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.authorization).toBeUndefined();
  });

  it("invalid extra headers JSON is ignored, the call still happens", async () => {
    for (const extraHeaders of ["{not json", "[1,2]", "42"]) {
      const fetcher = stub(reply("ok"));
      await expect(callProvider({ ...config, extraHeaders }, [], { fetcher })).resolves.toBe("ok");
      const headers = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
      expect(Object.keys(headers).sort()).toEqual(["Authorization", "Content-Type"]);
    }
  });

  it("paused without a key, no request made", async () => {
    const fetcher = stub();
    await expect(callProvider({ ...config, apiKey: " " }, [], { fetcher })).rejects.toMatchObject({ key: "llm.noKey" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps statuses and redacts the key from the provider's error text", async () => {
    await expect(callProvider(config, [], { fetcher: stub(new Response("", { status: 401 })) })).rejects.toMatchObject({ key: "llm.auth" });
    await expect(callProvider(config, [], { fetcher: stub(new Response("", { status: 429 })) })).rejects.toMatchObject({ key: "llm.rateLimit" });
    const error = await callProvider(config, [], { fetcher: stub(new Response(`bad request for key ${KEY}`, { status: 400 })) }).catch((caught) => caught);
    expect(error.key).toBe("llm.http");
    expect(JSON.stringify(error.params)).not.toContain(KEY);
    expect(String(error.params.detail)).toContain("[redacted]");
    expect(error.message).not.toContain(KEY);
  });

  it("network failure and timeout become llm.* errors, never the raw cause", async () => {
    const down = vi.fn(async () => {
      throw new TypeError(`fetch failed for ${KEY}`);
    }) as unknown as typeof fetch;
    const unreachable = await callProvider(config, [], { fetcher: down }).catch((caught) => caught);
    expect(unreachable.key).toBe("llm.unreachable");
    expect(unreachable.message).not.toContain(KEY);
    const controller = new AbortController();
    const hang = vi.fn(
      (_url: unknown, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("x"), { name: "AbortError" })))),
    ) as unknown as typeof fetch;
    const pending = callProvider(config, [], { fetcher: hang, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ key: "llm.timeout" });
  });

  it("an unreadable body is llm.badBody", async () => {
    await expect(callProvider(config, [], { fetcher: stub(new Response("<html>", { status: 200 })) })).rejects.toMatchObject({ key: "llm.badBody" });
  });
});

describe("translateCard — validacao tripla", () => {
  const reapCard = face("Reap: Gain 1<A>.");

  it("a valid answer becomes an unreviewed llm row with the model", async () => {
    const row = await translateCard(reapCard, config, { fetcher: stub(reply("```json\n" + JSON.stringify(VALID) + "\n```")) });
    expect(row).toMatchObject({ cardId: "c-1", source: "llm", reviewed: false, model: "tiny", textHash: textHash(reapCard.text), v: DSL_VERSION });
    expect(row.failure).toBeUndefined();
    expect(row.dsl).toEqual(VALID.abilities);
    expect(normaliseAbilityOverride(row)).not.toBeNull();
  });

  it("unsupported -> vanilla row with the reason", async () => {
    const row = await translateCard(reapCard, config, { fetcher: stub(reply({ unsupported: true, reason: "global watcher" })) });
    expect(row).toMatchObject({ dsl: [], reviewed: false, failure: "unsupported: global watcher", v: DSL_VERSION });
  });

  it("(a) schema: junk, unknown act and bad keyword fail with a motive", async () => {
    const unknownAct = { abilities: [{ on: ["reap"], acts: [{ k: "explode", n: 1 }] }] };
    const badKeyword = { ...VALID, keywords: { flying: 1 } };
    const cases: [unknown, string][] = [
      ["not json", "not a JSON object"],
      [unknownAct, "abilities[0]"],
      [badKeyword, "keywords"],
      [{ effects: [] }, "abilities"],
    ];
    for (const [answer, needle] of cases) {
      const row = await translateCard(reapCard, config, { fetcher: stub(reply(answer)) });
      expect(row.dsl).toEqual([]);
      expect(row.failure).toContain(needle);
    }
  });

  it("(c) sanity: invented triggers, numbers and missing targets fail", () => {
    const reason = (abilities: unknown, card = reapCard) => validateDraft(card, { abilities }, "llm").reason;
    expect(reason([{ on: ["fight"], acts: [{ k: "gainAmber", n: 1 }] }])).toContain('"fight" is not named');
    expect(reason([{ on: ["reap"], acts: [{ k: "gainAmber", n: 5 }] }])).toContain("number 5");
    expect(reason([{ on: ["reap"], acts: [{ k: "damage", n: 1, s: "target" }] }], face("Reap: Deal 1<D> to a creature."))).toContain("no `target` filter");
    expect(reason([{ on: ["reap"], acts: [{ k: "gainAmber", n: 1 }] }], face("Reap: Gain 1<A>.", { type: "Action" }))).toContain("cannot happen on a Action");
    expect(reason([])).toContain("empty translation");
  });

  it("(c) sanity: Play exige nomeacao; inflexoes contam; sem exencao fora de Action", () => {
    const reason = (abilities: unknown, card = reapCard) => validateDraft(card, { abilities }, "llm").reason;
    // "when played" e inflexao do gatilho Play.
    expect(reason([{ on: ["play"], acts: [{ k: "gainAmber", n: 2 }] }], face("Gains 2 amber when played."))).toBeUndefined();
    // Action e isenta de nomear o gatilho ("Gain 3 amber." e o texto tipico).
    expect(reason([{ on: ["play"], acts: [{ k: "gainAmber", n: 3 }] }], face("Gain 3 amber.", { type: "Action" }))).toBeUndefined();
    // Fora de Action nao ha Play implicito: sem gatilho nomeado, o rascunho cai
    // (habilidade constante e gatilhos fora da tabela nao viram Play).
    for (const type of ["Creature", "Artifact", "Upgrade"] as const) {
      expect(reason([{ on: ["play"], acts: [{ k: "gainAmber", n: 3 }] }], face("Gain 3 amber.", { type }))).toContain('"play" is not named');
    }
    expect(reason([{ on: ["play"], acts: [{ k: "draw", n: 1 }] }], face("Fate: Archive a card."))).toContain('"play" is not named');
    expect(reason([{ on: ["play"], acts: [{ k: "gainAmber", n: 1 }] }], face("Each friendly Mars creature gets +1 power."))).toContain('"play" is not named');
    // Se a linha nomeia outro gatilho, o Play tambem exige nomeacao.
    expect(reason([{ on: ["play"], acts: [{ k: "gainAmber", n: 2 }] }], face("After Fight: Deal 2 to a creature."))).toContain('"play" is not named');
    // "play" dentro de outra palavra nao conta ("displayed"/"replay").
    expect(reason([{ on: ["play"], acts: [{ k: "gainAmber", n: 2 }] }], face("After Fight: Replay a displayed creature."))).toContain('"play" is not named');
    // Gatilho nao nomeado continua rejeitado (sem regressao).
    expect(reason([{ on: ["reap"], acts: [{ k: "gainAmber", n: 1 }] }], face("Gain 1 amber."))).toContain('"reap" is not named');
  });

  it("(c) sanity: Scrap is legal on Action/Upgrade and its draft survives the dry-run", () => {
    const scrap = face("Scrap: Archive a card.", { type: "Action" });
    const draft = validateDraft(scrap, { abilities: parseCardText(scrap).abilities, effects: [], keywords: {} }, "llm");
    expect(draft.ok).toBe(true);
    expect(dryRunProblem(scrap, draft.row!)).toBeNull();
    expect(sanityProblem(scrap, draft.row!)).toBeNull();
    // The trigger must still be named by the text ("Scrap:" is not printed here).
    const invented = sanityProblem(face("Play: Gain 1<A>.", { type: "Action" }), {
      ...draft.row!,
      dsl: [{ on: ["scrap"], acts: [{ k: "gainAmber", n: 1 }] }],
    });
    expect(invented).toContain('"scrap" is not named');
  });

  it("(b) dry-run: a draft that breaks the engine is rejected, a sane one passes", () => {
    const sane = validateDraft(reapCard, { abilities: VALID.abilities, effects: [], keywords: {} }, "llm");
    expect(sane.ok).toBe(true);
    const row = sane.row!;
    expect(dryRunProblem(reapCard, row)).toBeNull();
    expect(sanityProblem(reapCard, row)).toBeNull();
    // A row that skipped the structural gate (power Infinity) must still be caught
    // by the engine-level check of the synthetic match.
    const poisoned = { ...row, effects: [{ target: { self: true }, power: Infinity }] } as AbilityOverride;
    expect(dryRunProblem(reapCard, poisoned)).not.toBeNull();
  });

  it("(b) dry-run: the rich table exercises the same draft (overwhelmed + Otherwise)", () => {
    const card = face("After Reap: If you are overwhelmed, steal 2<A>. Otherwise, steal 1<A>.");
    const result = validateDraft(card, { abilities: parseCardText(card).abilities }, "llm");
    expect(result.reason).toBeUndefined();
    expect(result.ok).toBe(true);
    // Both tables run the creature in hand and on the board: the base one has
    // even counts, the rich one 3 enemies against 2 friends.
    expect(dryRunProblem(card, result.row!)).toBeNull();
  });

  it("dry-run leaves the live overrides and the real card alone", async () => {
    await translateCard(reapCard, config, { fetcher: stub(reply(VALID)) });
    expect(rulesOf(reapCard).abilities).toEqual(parseCardText(reapCard).abilities);
  });

  it("merges parser keywords the model forgot", async () => {
    const card = face("Elusive. Reap: Gain 1<A>.");
    const row = await translateCard(card, config, { fetcher: stub(reply({ abilities: VALID.abilities })) });
    expect(row.keywords).toEqual({ elusive: 1 });
  });

  it("transport errors propagate (no row is made up)", async () => {
    await expect(translateCard(reapCard, config, { fetcher: stub(new Response("", { status: 401 })) })).rejects.toMatchObject({ key: "llm.auth" });
  });
});

describe("queue run", () => {
  const cards = [face("Reap: Gain 1<A>.", { id: "a" }), face("Reap: Gain 1<A>.", { id: "b" }), face("Reap: Gain 1<A>.", { id: "c" })];

  it("picks only cards the parser cannot fully read and the store has no answer for", () => {
    const covered = face("Reap: Gain 1 amber.", { id: "full" });
    const unread = face("Play: Shuffle things around in a strange way.", { id: "gap" });
    const answered = face("Play: Shuffle things around in a strange way.", { id: "done" });
    const known = (id: string): AbilityOverride | undefined => (id === "done" ? ({ textHash: textHash(answered.text) } as AbilityOverride) : undefined);
    expect(pendingTranslations([covered, unread, answered], known).map((item) => item.id)).toEqual(["gap"]);
  });

  it("re-enqueues a failure from an older DSL_VERSION; a current answer stays cached", () => {
    const gap = "Play: Shuffle things around in a strange way.";
    const stored = (id: string, patch: Partial<AbilityOverride>): AbilityOverride => ({
      cardId: id,
      dsl: [],
      textHash: textHash(gap),
      source: "llm",
      reviewed: false,
      generatedAt: 1,
      ...patch,
    });
    const rows = new Map<string, AbilityOverride>([
      ["old", stored("old", { failure: "unsupported: no", v: DSL_VERSION - 1 })],
      ["implicit", stored("implicit", { failure: "unsupported: no" })],
      ["current", stored("current", { failure: "unsupported: no", v: DSL_VERSION })],
      ["newer", stored("newer", { failure: "unsupported: no", v: DSL_VERSION + 1 })],
      ["draft", stored("draft", { dsl: [{ on: ["reap"], acts: [{ k: "gainAmber", n: 1 }] }], v: DSL_VERSION })],
    ]);
    const cards = [...rows.keys()].map((id) => face(gap, { id }));
    expect(pendingTranslations(cards, (id) => rows.get(id)).map((item) => item.id)).toEqual(["old", "implicit"]);
  });

  it("stores each answer, honours the limit and reports progress", async () => {
    const saved: AbilityOverride[] = [];
    const progress: number[] = [];
    const fetcher = stub(reply(VALID), reply({ unsupported: true, reason: "no" }), reply(VALID));
    const result = await runTranslation(cards, config, { limit: 2, fetcher, save: async (row) => void saved.push(row), onProgress: (p) => progress.push(p.done) });
    // a, b and c share a text, so they are one group and the limit keeps that group.
    expect(result).toMatchObject({ done: 3, total: 3, drafted: 3, failed: 0 });
    expect(saved.map((row) => row.cardId)).toEqual(["a", "b", "c"]);
    expect(progress).toEqual([0, 3]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("an auth error ends the run after the rows already stored; an abort is a quiet stop", async () => {
    const saved: AbilityOverride[] = [];
    const distinct = [face("Play: Alpha zzz unique.", { id: "a" }), face("Play: Beta zzz unique.", { id: "b" })];
    await expect(runTranslation(distinct, config, { fetcher: stub(reply(VALID), new Response("", { status: 401 })), save: async (row) => void saved.push(row) })).rejects.toMatchObject({ key: "llm.auth" });
    expect(saved).toHaveLength(1);
    const controller = new AbortController();
    controller.abort();
    const stopped = await runTranslation(cards, config, { fetcher: stub(), signal: controller.signal, save: async () => undefined });
    expect(stopped.done).toBe(0);
  });

  it("without a key the run fails before any request", async () => {
    const fetcher = stub();
    await expect(runTranslation(cards, { ...config, apiKey: "" }, { fetcher, save: async () => undefined })).rejects.toMatchObject({ key: "llm.noKey" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("review queue", () => {
  it("lists unreviewed llm rows (drafts and failures), newest first", () => {
    const row = (patch: Partial<AbilityOverride>): AbilityOverride => ({
      cardId: "x",
      dsl: [],
      textHash: "h",
      source: "llm",
      reviewed: false,
      generatedAt: 1,
      ...patch,
    });
    const rows = [
      row({ cardId: "draft", generatedAt: 2 }),
      row({ cardId: "approved", reviewed: true, generatedAt: 9 }),
      row({ cardId: "manual", source: "manual", generatedAt: 8 }),
      row({ cardId: "failed", failure: "unsupported: no", generatedAt: 3 }),
    ];
    expect(reviewQueue(rows).map((item) => item.cardId)).toEqual(["failed", "draft"]);
  });

  it("approvedFailures lists only reviewed llm failures, newest first", () => {
    const row = (patch: Partial<AbilityOverride>): AbilityOverride => ({
      cardId: "x",
      dsl: [],
      textHash: "h",
      source: "llm",
      reviewed: true,
      generatedAt: 1,
      ...patch,
    });
    const rows = [
      row({ cardId: "old", failure: "unsupported: no", generatedAt: 2 }),
      row({ cardId: "new", failure: "unsupported: no", generatedAt: 5 }),
      row({ cardId: "rule", generatedAt: 9 }),
      row({ cardId: "open", failure: "unsupported: no", reviewed: false }),
      row({ cardId: "manual", failure: "x", source: "manual" }),
    ];
    expect(approvedFailures(rows).map((item) => item.cardId)).toEqual(["new", "old"]);
  });

  it("prunes a zombie failure whose card the parser covers fully today (Lote 4 §4.0)", () => {
    const row = (patch: Partial<AbilityOverride>): AbilityOverride => ({
      cardId: "x",
      dsl: [],
      textHash: "h",
      source: "llm",
      reviewed: false,
      generatedAt: 1,
      ...patch,
    });
    const rows = [
      row({ cardId: "covered", failure: "unsupported: no", generatedAt: 3 }),
      row({ cardId: "still-gap", failure: "unsupported: no", generatedAt: 2 }),
      row({ cardId: "draft", generatedAt: 1 }),
    ];
    expect(reviewQueue(rows, (id) => id === "covered").map((item) => item.cardId)).toEqual(["still-gap", "draft"]);
    // A draft from a now-covered card is not a failure: it still deserves review.
    expect(reviewQueue([row({ cardId: "covered" })], () => true).map((item) => item.cardId)).toEqual(["covered"]);
  });
});

describe("pipeline hygiene (Lote 4 §4.0)", () => {
  const gapText = "Play: Shuffle things around in a strange way.";
  const gap = (id: string, patch: Partial<CardFace> = {}) => face(gapText, { id, ...patch });
  const stored = (id: string, patch: Partial<AbilityOverride>): AbilityOverride => ({
    cardId: id,
    dsl: [],
    textHash: textHash(gapText),
    source: "llm",
    reviewed: false,
    generatedAt: 1,
    ...patch,
  });

  it("skips a card with a hand-written script (the script wins over any draft)", () => {
    // Scripted titles are written for the starter decks; the LLM call would be wasted.
    const bear = face("Starter text the parser cannot read.", { id: "bear", title: "Ancient Bear" });
    expect(pendingTranslations([bear, gap("gap")], () => undefined).map((item) => item.id)).toEqual(["gap"]);
  });

  it("retries a reply: failure on the current version, stopping at 3 tries", () => {
    const cards = [gap("x")];
    const pending = (row: AbilityOverride) => pendingTranslations(cards, () => row);
    expect(pending(stored("x", { failure: "reply: not a JSON object", v: DSL_VERSION }))).toHaveLength(1);
    expect(pending(stored("x", { failure: "reply: not a JSON object", v: DSL_VERSION, tries: 2 }))).toHaveLength(1);
    expect(pending(stored("x", { failure: "reply: not a JSON object", v: DSL_VERSION, tries: 3 }))).toHaveLength(0);
    // A current-version unsupported stays cached: it is not a transient format error.
    expect(pending(stored("x", { failure: "unsupported: no", v: DSL_VERSION }))).toHaveLength(0);
  });

  it("counts the retry on the row (translateCard and runTranslation previous)", async () => {
    const row = await translateCard(face("Reap: Gain 1<A>."), config, { fetcher: stub(reply("not json")), tries: 2 });
    expect(row).toMatchObject({ failure: "reply: not a JSON object", tries: 3, v: DSL_VERSION });
    const saved: AbilityOverride[] = [];
    await runTranslation([face("Reap: Gain 1<A>.", { id: "r" })], config, {
      fetcher: stub(reply("not json")),
      previous: () => 1,
      save: async (item) => void saved.push(item),
    });
    expect(saved[0]).toMatchObject({ failure: "reply: not a JSON object", tries: 2 });
  });
});

describe("partial (Fate) — Lote 4 §4.1", () => {
  const fateCard = face("Play: Gain 1<A>. Fate: Archive a card.");
  const playAbility: Ability[] = [{ on: ["play"], acts: [{ k: "gainAmber", n: 1 }] }];

  it("sanity: partial only with Fate:, and Fate: only with partial", () => {
    expect(validateDraft(fateCard, { abilities: playAbility }, "llm").reason).toContain("partial: true");
    expect(validateDraft(fateCard, { abilities: playAbility, partial: true }, "llm").ok).toBe(true);
    // The exit door cannot skip a sentence on a card without Fate:.
    expect(validateDraft(face("Play: Gain 1<A>."), { abilities: playAbility, partial: true }, "llm").reason).toContain("Fate:");
  });

  it("translateCard carries partial into the row; rulesOf reports partial coverage", async () => {
    const row = await translateCard(fateCard, config, { fetcher: stub(reply({ abilities: playAbility, partial: true })) });
    expect(row).toMatchObject({ partial: true, v: DSL_VERSION });
    expect(row.failure).toBeUndefined();
    setAbilityOverrides(new Map([[row.cardId, { ...row, reviewed: true }]]));
    expect(rulesOf(fateCard).coverage).toBe("partial");
    expect(rulesOf(fateCard).abilities).toEqual(playAbility);
  });

  it("the row shape gate keeps partial and tries", () => {
    const row: AbilityOverride = {
      cardId: "p",
      dsl: playAbility,
      textHash: textHash(fateCard.text),
      source: "llm",
      reviewed: true,
      generatedAt: 1,
      partial: true,
      tries: 2,
    };
    expect(normaliseAbilityOverride(row)).toMatchObject({ partial: true, tries: 2 });
  });
});

describe("prompt-only rules — Lote 4 §4.3", () => {
  it("teaches repeat, versatile and fought", () => {
    const system = buildMessages(face("Reap: Gain 1<A>."))[0].content;
    expect(system).toContain("repeat the preceding effect");
    expect(system).toContain("versatile");
    expect(system).toContain('s:"fought"');
    expect(system).toContain("Fate:");
    // The repeat shot is marked promptOnly (the parser must not claim it).
    const repeat = FEW_SHOTS.find((shot) => shot.text.includes("repeat the preceding effect"));
    expect(repeat?.promptOnly).toBe(true);
  });
});

describe("keyteki source (F0)", () => {
  const card = face("Play: Gain 1<A>.", { id: "kt-1" });
  const row = (patch: Record<string, unknown> = {}) => ({
    cardId: "kt-1",
    dsl: [{ on: ["reap"], acts: [{ k: "gainAmber", n: 1 }] }],
    textHash: textHash(card.text),
    source: "keyteki",
    reviewed: false,
    generatedAt: 0,
    v: DSL_VERSION,
    model: "keyteki-ast@d9b239b",
    ...patch,
  });

  it("passes the shape gate", () => {
    expect(normaliseAbilityOverride(row())?.source).toBe("keyteki");
  });

  it("enters the review queue, the approved failures and the queue import", () => {
    const draft = normaliseAbilityOverride(row())!;
    expect(reviewQueue([draft]).map((item) => item.cardId)).toEqual(["kt-1"]);
    const failure = normaliseAbilityOverride(row({ reviewed: true, failure: "unsupported: x" }))!;
    expect(approvedFailures([failure]).map((item) => item.cardId)).toEqual(["kt-1"]);
    expect(exportableRows([draft], [card])).toHaveLength(1);
    expect(validateQueueRows([row()], [card]).rejected).toEqual([]);
  });

  it("never becomes a rule without review", () => {
    const opaque = face("Play: Look at the top card of your deck and name it.", { id: "kt-2" });
    const own = (patch: Record<string, unknown>) => normaliseAbilityOverride(row({ cardId: "kt-2", textHash: textHash(opaque.text), ...patch }))!;
    setAbilityOverrides(new Map([[opaque.id, own({})]]));
    expect(rulesOf(opaque).abilities).toEqual([]);
    setAbilityOverrides(new Map([[opaque.id, own({ reviewed: true })]]));
    expect(rulesOf(opaque).abilities).toHaveLength(1);
    setAbilityOverrides(new Map());
  });
});

describe("harvest queue import", () => {
  const card = face("Play: Gain 1<A>.", { id: "q-1" });
  const row = (patch: Record<string, unknown> = {}) => ({
    cardId: "q-1",
    dsl: [{ on: ["reap"], acts: [{ k: "gainAmber", n: 1 }] }],
    textHash: textHash(card.text),
    source: "llm",
    reviewed: false,
    generatedAt: 1,
    v: DSL_VERSION,
    ...patch,
  });

  it("imports a valid row (reviewed:true stays a rule candidate)", () => {
    const other = face("Play: Gain 1<A>.", { id: "q-2" });
    const out = validateQueueRows([row(), row({ cardId: "q-2", reviewed: true })], [card, other]);
    expect(out.rejected).toEqual([]);
    expect(out.valid.map((item) => item.reviewed)).toEqual([false, true]);
  });

  it("keeps only the last row per cardId and counts it once", () => {
    const out = validateQueueRows([row({ reviewed: false }), row({ reviewed: true })], [card]);
    expect(out.rejected).toEqual([]);
    expect(out.valid.map((item) => item.reviewed)).toEqual([true]);
  });

  it("does not throw on a deeply nested hostile row (guard lives in validateQueueRows)", () => {
    let nested: unknown = { c: "x" };
    for (let i = 0; i < 20000; i++) nested = { not: nested };
    const hostile = row({ dsl: [{ on: ["reap"], if: nested, acts: [{ k: "gainAmber", n: 1 }] }] });
    const out = validateQueueRows([hostile], [card]);
    expect(out.valid).toEqual([]);
    expect(out.rejected.map((item) => item.reason)).toEqual(["shape"]);
  });

  it("rejects a row from a newer DSL, a divergent hash and a bad shape", () => {
    const out = validateQueueRows([row({ v: DSL_VERSION + 1 }), row({ textHash: "other" }), row({ dsl: "nope" }), row({ source: "manual" }), row({ cardId: "gone" })].map((item, index) => (item.cardId === "gone" ? item : { ...item, cardId: `q-${index + 1}` })), [card, ...[2, 3, 4, 5].map((n) => ({ ...card, id: `q-${n}` }))]);
    expect(out.valid).toEqual([]);
    expect(out.rejected.map((item) => item.reason)).toEqual(["version", "hash", "shape", "source", "unknownCard"]);
  });

  it("does not trample a decision already taken", () => {
    const stored = normaliseAbilityOverride(row({ reviewed: true }))!;
    expect(validateQueueRows([row()], [card], new Map([["q-1", stored]])).rejected[0].reason).toBe("protected");
    expect(validateQueueRows("not an array", [card]).valid).toEqual([]);
  });
});

describe("BYOK settings", () => {
  it("presets fill base URL and model; custom keeps what was typed; ready needs all three", () => {
    const anthropic = applyLlmPreset(DEFAULT_LLM, "anthropic");
    expect(anthropic).toMatchObject({ preset: "anthropic", baseUrl: LLM_PRESETS.anthropic.baseUrl, model: LLM_PRESETS.anthropic.model });
    expect(applyLlmPreset({ ...DEFAULT_LLM, baseUrl: "http://x/v1" }, "custom").baseUrl).toBe("http://x/v1");
    expect(llmReady(DEFAULT_LLM)).toBe(false);
    expect(llmReady({ ...DEFAULT_LLM, apiKey: "k" })).toBe(true);
  });

  it("redacts the secret and survives a save/read round trip", () => {
    expect(redactSecret(`oops ${KEY} oops ${KEY}`, KEY)).toBe("oops [redacted] oops [redacted]");
    let stored = "";
    vi.stubGlobal("localStorage", {
      getItem: () => stored || null,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    });
    saveLlmConfig(config);
    expect(readLlmConfig()).toEqual(config);
    stored = "{broken";
    expect(readLlmConfig()).toEqual(DEFAULT_LLM);
  });
});

describe("pipeline hygiene — Lote 6 §6.0", () => {
  const gapText = "Play: Look at the top of your deck.";
  const gap = (id: string, type = "Action"): CardFace => face(gapText, { id, type, title: id });

  it("retries by class, resets tries when v is older, and sorts transport last", () => {
    const stored = (id: string, patch: Partial<AbilityOverride>): AbilityOverride => ({
      cardId: id,
      dsl: [],
      textHash: textHash(gapText),
      source: "llm",
      reviewed: false,
      generatedAt: 1,
      v: DSL_VERSION,
      ...patch,
    });
    const cards = [gap("fresh"), gap("draft"), gap("format"), gap("transport"), gap("old")];
    const rows = new Map<string, AbilityOverride>([
      ["draft", stored("draft", { failure: "schema: no", tries: 1 })],
      ["format", stored("format", { failure: "reply: not a JSON object", tries: 1 })],
      ["transport", stored("transport", { failure: "llm.timeout", tries: 4 })],
      ["old", stored("old", { failure: "llm.timeout", tries: 5, v: DSL_VERSION - 1 })],
    ]);
    expect(translationTries(rows.get("old"))).toBe(0);
    expect(pendingTranslations(cards, (id) => rows.get(id)).map((item) => item.id)).toEqual(["fresh", "old", "draft", "format", "transport"]);
    expect(pendingTranslations([gap("done")], () => stored("done", { failure: "llm.timeout", tries: 5 }))).toHaveLength(0);
    expect(pendingTranslations([gap("cap")], () => stored("cap", { failure: "schema: no", tries: 2 }))).toHaveLength(0);
  });

  it("retries a timeout once with a doubled timeout and records tries", async () => {
    const fetcher = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;
    const saved: AbilityOverride[] = [];
    await runTranslation([gap("slow")], config, { fetcher, previous: () => 1, save: async (row) => void saved.push(row) });
    expect(saved[0]).toMatchObject({ failure: "llm.timeout", tries: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("counts a schema failure toward the draft cap", async () => {
    const row = await translateCard(face("Reap: Gain 1<A>."), config, { fetcher: stub(reply({ abilities: "nope" })), tries: 1 });
    expect(row.failure).toMatch(/^schema:/);
    expect(row.tries).toBe(2);
  });

  it("groups identical text before the run limit", async () => {
    const shared = "Play: Alpha zzz unique shared.";
    const other = "Play: Beta zzz unique other.";
    const faces = [face(shared, { id: "a" }), face(other, { id: "b" }), face(shared, { id: "c" })];
    const fetcher = stub(reply({ abilities: [], effects: [], keywords: {}, unsupported: true, reason: "no" }));
    const saved: AbilityOverride[] = [];
    await runTranslation(faces, config, { limit: 1, fetcher, save: async (row) => void saved.push(row) });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(saved.map((row) => row.cardId).sort()).toEqual(["a", "c"]);
  });

  it("translates one lead per textHash and type and copies the row", async () => {
    const a = gap("a");
    const b = gap("b");
    const upgrade = gap("u", "Upgrade");
    expect(groupByText([a, b, upgrade])).toHaveLength(2);
    const saved: AbilityOverride[] = [];
    const fetcher = stub(reply({ abilities: [], effects: [], keywords: {}, unsupported: true, reason: "no" }));
    await runTranslation([a, b], config, { fetcher, save: async (row) => void saved.push(row) });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(saved.map((row) => row.cardId).sort()).toEqual(["a", "b"]);
  });

  it("drops transport, scripts and unknown ids from the export", () => {
    const known = gap("known");
    const rows: AbilityOverride[] = [
      { cardId: "known", dsl: [], textHash: textHash(gapText), source: "llm", reviewed: false, generatedAt: 1, failure: "unsupported: no", v: DSL_VERSION },
      { cardId: "known", dsl: [], textHash: "x", source: "llm", reviewed: false, generatedAt: 2, failure: "llm.timeout", v: DSL_VERSION },
      { cardId: "missing", dsl: [], textHash: "h", source: "llm", reviewed: false, generatedAt: 1, failure: "unsupported: no", v: DSL_VERSION },
      { cardId: "bear", dsl: [], textHash: "h", source: "llm", reviewed: false, generatedAt: 1, failure: "unsupported: no", v: DSL_VERSION },
    ];
    const bear = face("Scripted.", { id: "bear", title: "Ancient Bear" });
    expect(exportableRows(rows, [known, bear]).map((row) => row.failure)).toEqual(["unsupported: no"]);
  });

  it("tells the model that unless is a negated condition", () => {
    expect(buildMessages(face("Play: Gain 1<A>."))[0].content).toContain("unless <cond>");
    expect(buildMessages(face("Play: Gain 1<A>."))[0].content).not.toContain("Qualified forms");
  });
});

describe("extractJson", () => {
  it("finds the object inside fences or prose", () => {
    expect(extractJson('Sure! ```json\n{"a":1}\n``` done')).toEqual({ a: 1 });
    expect(extractJson("no braces")).toBeNull();
    expect(extractJson("{oops}")).toBeNull();
  });
});

describe("harvest vendorizado", () => {
  it("o JSON aprovado do repositorio e valido e nao carrega texto de carta", async () => {
    const { vendoredOverrides } = await import("./vendored");
    const approved = JSON.parse(readFileSync(new URL("./generated/approved.json", import.meta.url), "utf8")) as Record<string, unknown>[];
    expect(vendoredOverrides().size).toBe(approved.length);
    for (const row of approved) {
      expect(row.reviewed).toBe(true);
      expect(row).not.toHaveProperty("text");
      expect(row).not.toHaveProperty("failure");
    }
  });
});

describe("runTranslation concorrente", () => {
  it("processa N grupos em paralelo e grava cada linha exatamente uma vez", async () => {
    const faces = Array.from({ length: 6 }, (_, i) =>
      face(`Play: Gain ${i + 1} amber lote paralelo.`, { id: `p-${i}` }),
    );
    let inFlight = 0;
    let peak = 0;
    const saved: string[] = [];
    const progress = await runTranslation(faces, config, {
      concurrency: 3,
      fetcher: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        try {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return reply(VALID);
        } finally {
          inFlight -= 1;
        }
      },
      save: async (row) => {
        // Gravação serializada na prática (o runTranslation encadeia os saves);
        // o teste garante que nenhuma carta foi gravada duas vezes.
        if (saved.includes(row.cardId)) throw new Error(`duplicada: ${row.cardId}`);
        saved.push(row.cardId);
      },
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
    expect(saved).toHaveLength(6);
    expect(progress.done).toBe(6);
  });

  it("concurrencia 1 mantém o comportamento sequencial", async () => {
    const faces = [face("Play: Gain 2 amber lote sequencial.", { id: "s-1" })];
    let calls = 0;
    const progress = await runTranslation(faces, config, {
      concurrency: 1,
      fetcher: async () => {
        calls += 1;
        return reply(VALID);
      },
      save: async () => {},
    });
    expect(calls).toBe(1);
    expect(progress.done).toBe(1);
  });
});
