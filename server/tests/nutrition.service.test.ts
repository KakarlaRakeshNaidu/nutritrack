import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../src/utils/errors.js";
import { ProviderFailure } from "../src/modules/nutrition/nutrition.failures.js";
import { createExtractionService } from "../src/modules/nutrition/nutrition.service.js";
import type { ProviderAdapter } from "../src/modules/nutrition/provider-common.js";
import type { ProviderOutput } from "../src/modules/nutrition/nutrition.schemas.js";
import { databasePoolStub } from "../support/testing.js";

const configured = { status: "configured", apiKey: "key", model: "model" } as const;
const output: ProviderOutput = {
  status: "ok",
  food_name: "Soup",
  quantity: 1,
  quantity_unit: "serving",
  calories_kcal: 100,
  protein_g: 2,
  carbs_g: 10,
  fat_g: 4,
  micronutrients: {
    sodium_mg: null,
    calcium_mg: null,
    iron_mg: null,
    potassium_mg: null,
    vitamin_c_mg: null,
    vitamin_d_mcg: null,
  },
  source_basis: "one bowl",
  notes: ["estimated portion"],
};

function adapter(implementation: ProviderAdapter["analyze"]): ProviderAdapter {
  return { name: "gemini", analyze: implementation };
}

function service({
  gemini,
  providers = { gemini: configured },
  now,
}: {
  gemini: ProviderAdapter;
  providers?: { gemini: typeof configured | { status: "disabled" } };
  now?: () => number;
}) {
  const queries: string[] = [];
  const pool = databasePoolStub(async (query) => {
    queries.push(typeof query === "string" ? query : query.name ?? "");
    return { rowCount: 1, rows: [{ display_name: "Tester", timezone: "UTC" }] };
  });
  const extraction = createExtractionService({
    pool,
    providers,
    clock: () => new Date("2026-09-14T12:00:00Z"),
    now,
    normalize: async (image) => ({
      buffer: image,
      width: 1,
      height: 1,
      mime: "image/jpeg",
    }),
    gemini,
  });
  return { extraction, queries };
}

const request = {
  image: Buffer.from("normalized"),
  declaredMime: "image/jpeg",
  imageType: "food_plate" as const,
  signal: new AbortController().signal,
};

test("Gemini success performs only the profile read", async () => {
  const { extraction, queries } = service({
    gemini: adapter(async () => output),
  });
  const result = await extraction.extract(request);
  assert.equal(result.provider, "gemini");
  assert.deepEqual(queries, ["profile-read-singleton"]);
});

for (const kind of ["unavailable", "output_invalid"] as const) {
  test(`Gemini ${kind} maps to its existing safe API error`, async () => {
    const { extraction } = service({
      gemini: adapter(async () => {
        throw new ProviderFailure(kind, "gemini");
      }),
    });
    const expected = kind === "output_invalid"
      ? "AI_INVALID_OUTPUT"
      : "AI_PROVIDERS_UNAVAILABLE";
    await assert.rejects(
      extraction.extract(request),
      (error) => error instanceof AppError && error.code === expected,
    );
  });
}

test("terminal Gemini failures retain their exact mappings", async () => {
  for (const [kind, expected] of [
    ["configuration", "AI_CONFIGURATION_ERROR"],
    ["content", "IMAGE_UNREADABLE"],
    ["application_bug", "INTERNAL_ERROR"],
  ] as const) {
    const { extraction } = service({
      gemini: adapter(async () => {
        throw new ProviderFailure(kind, "primary", {
          contentStatus: kind === "content" ? "unreadable" : undefined,
        });
      }),
    });
    await assert.rejects(
      extraction.extract(request),
      (error) => error instanceof AppError && error.code === expected,
    );
  }
});

test("overall budget prevents a late Gemini attempt", async () => {
  const values = [0, 55_001];
  let calls = 0;
  const { extraction } = service({
    now: () => values.shift() ?? 55_001,
    gemini: adapter(async () => {
      calls += 1;
      return output;
    }),
  });
  await assert.rejects(
    extraction.extract(request),
    (error) => error instanceof AppError && error.code === "AI_PROVIDERS_UNAVAILABLE",
  );
  assert.equal(calls, 0);
});

test("caller cancellation remains terminal", async () => {
  const current = service({
    gemini: adapter(async () => {
      throw new ProviderFailure("user_cancellation", "gone");
    }),
  });
  await assert.rejects(
    current.extraction.extract(request),
    (error) => error instanceof ProviderFailure && error.kind === "user_cancellation",
  );
});
