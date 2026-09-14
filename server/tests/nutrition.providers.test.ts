import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "@google/genai";

import { createGeminiAdapter } from "../src/modules/nutrition/gemini.adapter.js";
import { ProviderFailure } from "../src/modules/nutrition/nutrition.failures.js";

const candidate = JSON.stringify({
  status: "ok",
  food_name: "Oats",
  quantity: 100,
  quantity_unit: "g",
  calories_kcal: 120,
  protein_g: 4,
  carbs_g: 20,
  fat_g: 2,
  micronutrients: {
    sodium_mg: null,
    calcium_mg: null,
    iron_mg: null,
    potassium_mg: null,
    vitamin_c_mg: null,
    vitamin_d_mcg: null,
  },
  source_basis: "per 100 g",
  notes: [],
});

test("Gemini adapter builds stateless Interactions image/schema request with retries off", async () => {
  const calls: Array<{ input: Record<string, unknown>; options: Record<string, unknown> }> = [];
  const adapter = createGeminiAdapter(
    { status: "configured", apiKey: "test-key", model: "test-model" },
    () => ({
      interactions: {
        async create(input, options) {
          calls.push({ input, options });
          return { output_text: candidate };
        },
      },
    }),
  );

  const result = await adapter.analyze({
    image: Buffer.from("same-jpeg"),
    imageType: "nutrition_label",
    signal: new AbortController().signal,
    timeoutMs: 1000,
  });

  assert.equal(result.calories_kcal, 120);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input.model, "test-model");
  assert.equal(calls[0]?.input.store, false);
  assert.equal(calls[0]?.input.background, false);
  assert.equal(calls[0]?.input.tools, undefined);
  assert.deepEqual(calls[0]?.options.retries, { strategy: "none" });
  const input = calls[0]?.input.input;
  assert(Array.isArray(input));
  assert.equal(input[1]?.mime_type, "image/jpeg");
  assert.equal(input[1]?.data, Buffer.from("same-jpeg").toString("base64"));
});

test("Gemini classifies HTTP failures without treating developer 400 as outage", async () => {
  for (const [status, kind] of [
    [429, "unavailable"],
    [503, "unavailable"],
    [401, "configuration"],
    [400, "application_bug"],
  ] as const) {
    const adapter = createGeminiAdapter(
      { status: "configured", apiKey: "key", model: "model" },
      () => ({
        interactions: {
          async create() {
            throw new ApiError({ status, message: "test" });
          },
        },
      }),
    );
    await assert.rejects(
      adapter.analyze({
        image: Buffer.from("x"),
        imageType: "food_plate",
        signal: new AbortController().signal,
        timeoutMs: 100,
      }),
      (error) => error instanceof ProviderFailure && error.kind === kind,
    );
  }
});

test("Gemini refusal and incomplete states are terminal content/output failures", async () => {
  const geminiRefusal = createGeminiAdapter(
    { status: "configured", apiKey: "key", model: "model" },
    () => ({
      interactions: {
        async create() {
          return { status: "failed", errors: [{ code: "SAFETY_POLICY" }] };
        },
      },
    }),
  );
  await assert.rejects(
    geminiRefusal.analyze({
      image: Buffer.from("x"),
      imageType: "food_plate",
      signal: new AbortController().signal,
      timeoutMs: 100,
    }),
    (error) => error instanceof ProviderFailure &&
      error.kind === "content" &&
      error.contentStatus === "refused",
  );

  const geminiIncomplete = createGeminiAdapter(
    { status: "configured", apiKey: "key", model: "model" },
    () => ({
      interactions: {
        async create() {
          return { status: "in_progress" };
        },
      },
    }),
  );
  await assert.rejects(
    geminiIncomplete.analyze({
      image: Buffer.from("x"),
      imageType: "nutrition_label",
      signal: new AbortController().signal,
      timeoutMs: 100,
    }),
    (error) => error instanceof ProviderFailure && error.kind === "output_invalid",
  );
});

test("provider transport abort distinguishes caller cancellation from timeout", async () => {
  const waitForAbort = (signal: AbortSignal): Promise<never> =>
    new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
        once: true,
      });
    });
  const gemini = createGeminiAdapter(
    { status: "configured", apiKey: "key", model: "model" },
    () => ({
      interactions: {
        async create(_input, options) {
          return waitForAbort(options.signal as AbortSignal);
        },
      },
    }),
  );
  const caller = new AbortController();
  const cancelled = gemini.analyze({
    image: Buffer.from("x"),
    imageType: "food_plate",
    signal: caller.signal,
    timeoutMs: 1_000,
  });
  caller.abort("test-disconnect");
  await assert.rejects(
    cancelled,
    (error) => error instanceof ProviderFailure && error.kind === "user_cancellation",
  );
  await assert.rejects(
    gemini.analyze({
      image: Buffer.from("x"),
      imageType: "food_plate",
      signal: new AbortController().signal,
      timeoutMs: 5,
    }),
    (error) => error instanceof ProviderFailure && error.kind === "unavailable",
  );
});
