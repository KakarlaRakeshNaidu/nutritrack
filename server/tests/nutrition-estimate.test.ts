import assert from "node:assert/strict";
import test from "node:test";

import request from "supertest";

import { createApp } from "../src/app.js";
import { createGeminiEstimateAdapter } from "../src/modules/nutrition/gemini-estimate.adapter.js";
import { ProviderFailure } from "../src/modules/nutrition/nutrition.failures.js";
import {
  buildEstimateResult,
  estimateProviderOutputSchema,
  type EstimateProviderOutput,
  type MealBasicsInput,
} from "../src/modules/nutrition/nutrition-estimate.schemas.js";
import { createNutritionEstimateService } from "../src/modules/nutrition/nutrition-estimate.service.js";
import {
  ExtractionRuntime,
} from "../src/modules/nutrition/nutrition.routes.js";
import type { ExtractionResult } from "../src/modules/nutrition/nutrition.schemas.js";
import type { ExtractionService } from "../src/modules/nutrition/nutrition.service.js";
import type { NutritionEstimateService } from "../src/modules/nutrition/nutrition-estimate.service.js";
import {
  databasePoolStub,
  recordingLogger,
  testConfig,
} from "../support/testing.js";

const basics: MealBasicsInput = {
  food_name: "Cooked brown rice",
  meal_type: "lunch",
  consumption_date: "2026-09-14",
  consumed_quantity: 150,
  quantity_unit: "g",
};

const output: EstimateProviderOutput = {
  status: "ok",
  calories_kcal: 180,
  protein_g: 0,
  carbs_g: 38,
  fat_g: 1.5,
  micronutrients: {
    sodium_mg: 0,
    calcium_mg: null,
    iron_mg: 0.6,
    potassium_mg: null,
    vitamin_c_mg: null,
    vitamin_d_mcg: null,
  },
  assumptions: ["Cooked without added fat."],
  clarification: null,
};

const result = buildEstimateResult(output);

function estimateApp(
  estimateService: NutritionEstimateService = {
    estimate: async () => result,
  },
  {
    extractionService,
    runtime,
  }: {
    extractionService?: ExtractionService;
    runtime?: ExtractionRuntime;
  } = {},
) {
  return createApp(testConfig(), {
    pool: databasePoolStub(async () => ({ rows: [], rowCount: 0 })),
    logger: recordingLogger(),
    nutritionEstimateService: estimateService,
    extractionService,
    extractionRuntime: runtime,
  });
}

test("estimate endpoint accepts only exact valid meal basics and returns suggestions", async () => {
  const valid = await request(estimateApp())
    .post("/api/v1/nutrition/estimate")
    .send(basics);
  assert.equal(valid.status, 200);
  assert.deepEqual(valid.body, { data: result });
  assert.equal(typeof valid.headers["x-request-id"], "string");

  for (const body of [
    { ...basics, consumed_quantity: 0 },
    { ...basics, consumed_quantity: 1.00001 },
    { ...basics, consumed_quantity: "150" },
    { ...basics, meal_type: "brunch" },
    { ...basics, quantity_unit: "oz" },
    { ...basics, consumption_date: "2026-02-30" },
    { ...basics, unexpected: true },
  ]) {
    const response = await request(estimateApp())
      .post("/api/v1/nutrition/estimate")
      .send(body);
    assert.equal(response.status, 422);
    assert.equal(response.body.error.code, "VALIDATION_ERROR");
  }

  assert.equal(
    (
      await request(estimateApp())
        .post("/api/v1/nutrition/estimate?provider=other")
        .send(basics)
    ).status,
    422,
  );
  assert.equal(
    (
      await request(estimateApp())
        .post("/api/v1/nutrition/estimate")
        .type("text")
        .send(JSON.stringify(basics))
    ).status,
    415,
  );
});

test("estimate schemas preserve zero/null metadata and enforce clarification rules", () => {
  assert.equal(result.provider, "gemini");
  assert.equal(result.is_estimate, true);
  assert.equal(result.nutrition.protein_g, 0);
  assert.equal(result.nutrition.micronutrients.sodium_mg, 0);
  assert.equal(result.nutrition.micronutrients.calcium_mg, null);
  assert.deepEqual(result.missing_fields, []);

  const clarification = buildEstimateResult({
    status: "needs_clarification",
    calories_kcal: null,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    micronutrients: {
      sodium_mg: null,
      calcium_mg: null,
      iron_mg: null,
      potassium_mg: null,
      vitamin_c_mg: null,
      vitamin_d_mcg: null,
    },
    assumptions: [],
    clarification: "What ingredients and portion size are in the curry?",
  });
  assert.equal(clarification.status, "needs_clarification");
  assert.deepEqual(clarification.missing_fields, [
    "calories_kcal",
    "protein_g",
    "carbs_g",
    "fat_g",
  ]);

  for (const candidate of [
    { ...output, calories_kcal: null, protein_g: null, carbs_g: null, fat_g: null },
    { ...output, calories_kcal: "180" },
    { ...output, calories_kcal: 1.00001 },
    { ...output, unexpected: true },
    {
      ...output,
      status: "needs_clarification",
      clarification: null,
    },
  ]) {
    assert.equal(estimateProviderOutputSchema.safeParse(candidate).success, false);
  }
});

test("Gemini text adapter sends quantity context, structured schema, no image/tools, and no retries", async () => {
  const calls: Array<{
    input: Record<string, unknown>;
    options: Record<string, unknown>;
  }> = [];
  const adapter = createGeminiEstimateAdapter(
    { status: "configured", apiKey: "test-key", model: "test-model" },
    () => ({
      interactions: {
        async create(input, options) {
          calls.push({ input, options });
          return { output_text: JSON.stringify(output) };
        },
      },
    }),
  );
  const estimated = await adapter.estimate({
    basics,
    signal: new AbortController().signal,
    timeoutMs: 1_000,
  });
  assert.equal(estimated.calories_kcal, 180);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input.model, "test-model");
  assert.equal(calls[0]?.input.store, false);
  assert.equal(calls[0]?.input.background, false);
  assert.deepEqual(calls[0]?.input.tools, []);
  assert.deepEqual(calls[0]?.options.retries, { strategy: "none" });
  const input = calls[0]?.input.input;
  assert(Array.isArray(input));
  assert.equal(input.length, 1);
  assert.match(String(input[0]?.text), /Cooked brown rice/);
  assert.match(String(input[0]?.text), /"consumed_quantity":150/);
  assert.equal("data" in (input[0] ?? {}), false);
});

test("Gemini text adapter rejects malformed, unexpected, imprecise, and unsafe output", async () => {
  const candidates = [
    "not json",
    JSON.stringify({ ...output, calories_kcal: "180" }),
    JSON.stringify({ ...output, unexpected: true }),
    JSON.stringify({ ...output, calories_kcal: 1.00001 }),
  ];
  for (const outputText of candidates) {
    const adapter = createGeminiEstimateAdapter(
      { status: "configured", apiKey: "key", model: "model" },
      () => ({
        interactions: {
          async create() {
            return { output_text: outputText };
          },
        },
      }),
    );
    await assert.rejects(
      adapter.estimate({
        basics,
        signal: new AbortController().signal,
        timeoutMs: 100,
      }),
      (error) =>
        error instanceof ProviderFailure && error.kind === "output_invalid",
    );
  }
});

test("estimate service enforces profile today, reads only profile, and maps failures", async () => {
  const queries: string[] = [];
  const pool = databasePoolStub(async (query) => {
    queries.push(typeof query === "string" ? query : query.name ?? "");
    return {
      rowCount: 1,
      rows: [{ display_name: "Tester", timezone: "UTC" }],
    };
  });
  const service = createNutritionEstimateService({
    pool,
    providers: {
      gemini: { status: "configured", apiKey: "key", model: "model" },
    },
    clock: () => new Date("2026-09-14T12:00:00Z"),
    gemini: { estimate: async () => output },
  });
  assert.deepEqual(
    await service.estimate(basics, new AbortController().signal, "00000000-0000-4000-8000-000000000099"),
    result,
  );
  assert.deepEqual(queries, ["profile-read-by-user"]);
  await assert.rejects(
    service.estimate(
      { ...basics, consumption_date: "2026-09-15" },
      new AbortController().signal, "00000000-0000-4000-8000-000000000099"
    ),
    (error: unknown) =>
      Boolean(
        error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "VALIDATION_ERROR",
      ),
  );

  const unavailable = createNutritionEstimateService({
    pool,
    providers: { gemini: { status: "disabled" } },
    clock: () => new Date("2026-09-14T12:00:00Z"),
    gemini: {
      async estimate() {
        throw new ProviderFailure("unavailable", "test");
      },
    },
  });
  await assert.rejects(
    unavailable.estimate(basics, new AbortController().signal, "00000000-0000-4000-8000-000000000099"),
    (error: unknown) =>
      Boolean(
        error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "AI_PROVIDERS_UNAVAILABLE",
      ),
  );
});

test("image and text work share two admission slots and release them", async () => {
  const runtime = new ExtractionRuntime();
  const releases: Array<() => void> = [];
  let active = 0;
  const wait = async <Result>(value: Result): Promise<Result> => {
    active += 1;
    await new Promise<void>((resolve) => releases.push(resolve));
    active -= 1;
    return value;
  };
  const imageResult: ExtractionResult = {
    provider: "gemini",
    image_type: "nutrition_label",
    is_estimate: false,
    source_basis: "one serving",
    assumptions: [],
    draft: {
      food_name: "Fixture",
      meal_type: null,
      consumption_date: "2026-09-14",
      consumed_quantity: 1,
      quantity_unit: "serving",
      calories_kcal: 100,
      protein_g: 1,
      carbs_g: 2,
      fat_g: 3,
      micronutrients: {
        sodium_mg: null,
        calcium_mg: null,
        iron_mg: null,
        potassium_mg: null,
        vitamin_c_mg: null,
        vitamin_d_mcg: null,
      },
      entry_source: "nutrition_label",
      is_estimate: false,
    },
    missing_fields: ["meal_type"],
  };
  const app = estimateApp(
    { estimate: async () => wait(result) },
    {
      runtime,
      extractionService: {
        extract: async () => wait(imageResult),
      },
    },
  );
  const image = new Promise<request.Response>((resolve, reject) => {
    request(app)
      .post("/api/v1/nutrition/extract")
      .field("image_type", "nutrition_label")
      .attach("image", Buffer.from("x"), {
        filename: "x.jpg",
        contentType: "image/jpeg",
      })
      .end((error, response) => error ? reject(error) : resolve(response));
  });
  const text = new Promise<request.Response>((resolve, reject) => {
    request(app)
      .post("/api/v1/nutrition/estimate")
      .send(basics)
      .end((error, response) => error ? reject(error) : resolve(response));
  });
  for (let turn = 0; active < 2 && turn < 100; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(active, 2);
  const third = await request(app)
    .post("/api/v1/nutrition/estimate")
    .send(basics);
  assert.equal(third.status, 429);
  assert.equal(third.body.error.code, "AI_BUSY");
  releases.splice(0).forEach((release) => release());
  assert.equal((await image).status, 200);
  assert.equal((await text).status, 200);
  assert.equal(runtime.active, 0);
});
