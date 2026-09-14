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

function adapter(
  name: "gemini" | "grok",
  implementation: ProviderAdapter["analyze"],
): ProviderAdapter {
  return { name, analyze: implementation };
}

function service({
  gemini,
  grok,
  providers = { gemini: configured, grok: configured },
  now,
}: {
  gemini: ProviderAdapter;
  grok: ProviderAdapter;
  providers?: { gemini: typeof configured; grok: typeof configured | { status: "disabled" } };
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
    grok,
  });
  return { extraction, queries };
}

const request = {
  image: Buffer.from("normalized"),
  declaredMime: "image/jpeg",
  imageType: "food_plate" as const,
  signal: new AbortController().signal,
};

test("primary success never touches fallback and performs only the profile read", async () => {
  let grokCalls = 0;
  const { extraction, queries } = service({
    gemini: adapter("gemini", async () => output),
    grok: adapter("grok", async () => {
      grokCalls += 1;
      return output;
    }),
  });
  const result = await extraction.extract(request);
  assert.equal(result.provider, "gemini");
  assert.equal(grokCalls, 0);
  assert.deepEqual(queries, ["profile-read-singleton"]);
});

for (const kind of ["unavailable", "output_invalid"] as const) {
  test(`eligible primary ${kind} uses one Grok fallback with identical bytes`, async () => {
    let fallbackBytes: Buffer | undefined;
    const { extraction } = service({
      gemini: adapter("gemini", async () => {
        throw new ProviderFailure(kind, "primary");
      }),
      grok: adapter("grok", async ({ image }) => {
        fallbackBytes = image;
        return output;
      }),
    });
    const result = await extraction.extract(request);
    assert.equal(result.provider, "grok");
    assert.equal(fallbackBytes?.equals(request.image), true);
  });
}

test("terminal primary failures never fall back", async () => {
  for (const [kind, expected] of [
    ["configuration", "AI_CONFIGURATION_ERROR"],
    ["content", "IMAGE_UNREADABLE"],
    ["application_bug", "INTERNAL_ERROR"],
  ] as const) {
    let calls = 0;
    const { extraction } = service({
      gemini: adapter("gemini", async () => {
        throw new ProviderFailure(kind, "primary", {
          contentStatus: kind === "content" ? "unreadable" : undefined,
        });
      }),
      grok: adapter("grok", async () => {
        calls += 1;
        return output;
      }),
    });
    await assert.rejects(
      extraction.extract(request),
      (error) => error instanceof AppError && error.code === expected,
    );
    assert.equal(calls, 0);
  }
});

test("fallback absence and final failure precedence map exactly", async () => {
  const primaryInvalid = adapter("gemini", async () => {
    throw new ProviderFailure("output_invalid", "bad");
  });
  const never = adapter("grok", async () => output);
  const absent = service({
    gemini: primaryInvalid,
    grok: never,
    providers: { gemini: configured, grok: { status: "disabled" } },
  });
  await assert.rejects(
    absent.extraction.extract(request),
    (error) => error instanceof AppError && error.code === "AI_FALLBACK_UNAVAILABLE",
  );

  for (const [fallbackKind, expected] of [
    ["output_invalid", "AI_INVALID_OUTPUT"],
    ["unavailable", "AI_PROVIDERS_UNAVAILABLE"],
    ["configuration", "AI_CONFIGURATION_ERROR"],
    ["application_bug", "INTERNAL_ERROR"],
  ] as const) {
    const current = service({
      gemini: primaryInvalid,
      grok: adapter("grok", async () => {
        throw new ProviderFailure(fallbackKind, "fallback");
      }),
    });
    await assert.rejects(
      current.extraction.extract(request),
      (error) => error instanceof AppError && error.code === expected,
    );
  }
});

test("remaining overall budget bounds fallback and prevents a late attempt", async () => {
  const values = [0, 1, 55_001];
  let calls = 0;
  const { extraction } = service({
    now: () => values.shift() ?? 55_001,
    gemini: adapter("gemini", async () => {
      throw new ProviderFailure("unavailable", "late");
    }),
    grok: adapter("grok", async () => {
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

test("caller cancellation is terminal and cannot leak a fallback", async () => {
  let calls = 0;
  const current = service({
    gemini: adapter("gemini", async () => {
      throw new ProviderFailure("user_cancellation", "gone");
    }),
    grok: adapter("grok", async () => {
      calls += 1;
      return output;
    }),
  });
  await assert.rejects(
    current.extraction.extract(request),
    (error) => error instanceof ProviderFailure && error.kind === "user_cancellation",
  );
  assert.equal(calls, 0);
});
