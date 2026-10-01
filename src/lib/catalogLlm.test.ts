// SPDX-License-Identifier: AGPL-3.0-only
// Onda 2 do catálogo dinâmico: pipeline LLM com provedor mockado (fetch stub),
// validação tripla, redaction da chave e o schema gerado do abilities.ts.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normaliseAbilityOverride, rulesOf, setAbilityOverrides, type AbilityOverride } from "./abilities";
import { buildMessages, callProvider, dryRunProblem, extractJson, FEW_SHOTS, pendingTranslations, runTranslation, sanityProblem, translateCard, validateDraft } from "./catalogLlm";
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

  it("few-shot answers are exactly what the parser produces (no drift from the engine)", () => {
    for (const shot of FEW_SHOTS) {
      const parsed = parseCardText(face(shot.text, { type: shot.type }));
      if ("unsupported" in shot.answer) {
        expect(parsed.coverage).not.toBe("full");
        continue;
      }
      expect({ abilities: parsed.abilities, effects: parsed.effects, keywords: parsed.keywords }).toEqual(shot.answer);
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
    expect(row).toMatchObject({ cardId: "c-1", source: "llm", reviewed: false, model: "tiny", textHash: textHash(reapCard.text) });
    expect(row.failure).toBeUndefined();
    expect(row.dsl).toEqual(VALID.abilities);
    expect(normaliseAbilityOverride(row)).not.toBeNull();
  });

  it("unsupported -> vanilla row with the reason", async () => {
    const row = await translateCard(reapCard, config, { fetcher: stub(reply({ unsupported: true, reason: "global watcher" })) });
    expect(row).toMatchObject({ dsl: [], reviewed: false, failure: "unsupported: global watcher" });
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

  it("stores each answer, honours the limit and reports progress", async () => {
    const saved: AbilityOverride[] = [];
    const progress: number[] = [];
    const fetcher = stub(reply(VALID), reply({ unsupported: true, reason: "no" }), reply(VALID));
    const result = await runTranslation(cards, config, { limit: 2, fetcher, save: async (row) => void saved.push(row), onProgress: (p) => progress.push(p.done) });
    expect(result).toMatchObject({ done: 2, total: 2, drafted: 1, failed: 1 });
    expect(saved.map((row) => row.cardId)).toEqual(["a", "b"]);
    expect(progress).toEqual([0, 1, 2]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("an auth error ends the run after the rows already stored; an abort is a quiet stop", async () => {
    const saved: AbilityOverride[] = [];
    await expect(runTranslation(cards, config, { fetcher: stub(reply(VALID), new Response("", { status: 401 })), save: async (row) => void saved.push(row) })).rejects.toMatchObject({ key: "llm.auth" });
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
