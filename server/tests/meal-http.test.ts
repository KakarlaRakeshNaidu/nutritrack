import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import type { Express } from "express";
import type { QueryConfig } from "pg";
import test from "node:test";
import request from "supertest";

import { createApp } from "../src/app.js";
import type { MealInput } from "../src/modules/meals/meal.schemas.js";
import {
  databasePoolStub,
  recordingLogger,
  testConfig,
} from "../support/testing.js";

interface ChunkedMealResponse {
  status: number | undefined;
  headers: IncomingHttpHeaders;
  body: {
    data: { id: string };
    error: { code: string; details: Array<{ message: string }> };
  };
}

const ID = "70a2071d-5cb8-4f15-b6f6-9ed632462bef";

function validMeal(): MealInput {
  return {
    food_name: "Boundary yogurt",
    meal_type: "breakfast",
    consumption_date: "2026-09-12",
    consumed_quantity: 150,
    quantity_unit: "g",
    calories_kcal: 180,
    protein_g: 9,
    carbs_g: 27,
    fat_g: 3,
    micronutrients: {
      sodium_mg: 0,
      calcium_mg: 120,
      iron_mg: null,
      potassium_mg: null,
      vitamin_c_mg: null,
      vitamin_d_mcg: null,
    },
    entry_source: "manual",
    is_estimate: false,
  };
}

function mealRow(): Record<string, unknown> {
  return {
    id: ID,
    food_name: "Boundary yogurt",
    meal_type: "breakfast",
    consumption_date: "2026-09-12",
    consumed_quantity: "150.0000",
    quantity_unit: "g",
    calories_kcal: "180.0000",
    protein_g: "9.0000",
    carbs_g: "27.0000",
    fat_g: "3.0000",
    sodium_mg: "0.0000",
    calcium_mg: "120.0000",
    iron_mg: null,
    potassium_mg: null,
    vitamin_c_mg: null,
    vitamin_d_mcg: null,
    entry_source: "manual",
    is_estimate: false,
    created_at: new Date("2026-09-12T10:00:00Z"),
    updated_at: new Date("2026-09-12T10:00:00Z"),
  };
}

function createHarness() {
  const calls: QueryConfig<unknown[]>[] = [];
  const pool = databasePoolStub(async (query) => {
    assert.notEqual(typeof query, "string");
    const queryConfig = query as QueryConfig<unknown[]>;
    calls.push(queryConfig);
    if (queryConfig.text.includes("FROM tracker_profile")) {
        return {
          rowCount: 1,
          rows: [{ display_name: "Tester", timezone: "Asia/Kolkata" }],
        };
      }
      if (queryConfig.text.startsWith("INSERT INTO meals")) {
        return { rowCount: 1, rows: [mealRow()] };
      }
      throw new Error("Unexpected database access");
    },
  );
  return {
    app: createApp(testConfig(), {
      pool,
      clock: () => new Date("2026-09-12T12:00:00Z"),
      logger: recordingLogger(),
    }),
    calls,
  };
}

function paddedPayload(bytes: number): string {
  const json = JSON.stringify(validMeal());
  assert(json.length < bytes);
  return json + " ".repeat(bytes - json.length);
}

async function sendChunkedJson(
  app: Express,
  body: string,
): Promise<ChunkedMealResponse> {
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");

  try {
    return await new Promise<ChunkedMealResponse>((resolve, reject) => {
      const outbound = httpRequest(
        {
          host: "127.0.0.1",
          port: address.port,
          path: "/api/v1/meals",
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Transfer-Encoding": "chunked",
          },
        },
        (response) => {
          const chunks: Uint8Array[] = [];
          response.on("data", (chunk: Uint8Array) => chunks.push(chunk));
          response.on("end", () => {
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body: JSON.parse(
                Buffer.concat(chunks).toString("utf8"),
              ) as ChunkedMealResponse["body"],
            });
          });
        },
      );
      outbound.on("error", reject);
      const midpoint = Math.floor(body.length / 2);
      outbound.write(body.slice(0, midpoint));
      outbound.end(body.slice(midpoint));
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("meal parser accepts exactly 65536 streamed bytes and rejects 65537", async () => {
  const acceptedHarness = createHarness();
  const accepted = await sendChunkedJson(
    acceptedHarness.app,
    paddedPayload(65_536),
  );
  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.data.id, ID);
  assert.equal(accepted.headers.location, "/api/v1/meals/" + ID);

  const rejectedHarness = createHarness();
  const rejected = await sendChunkedJson(
    rejectedHarness.app,
    paddedPayload(65_537),
  );
  assert.equal(rejected.status, 413);
  assert.equal(rejected.body.error.code, "REQUEST_TOO_LARGE");
  assert.equal(
    rejected.body.error.details[0].message,
    "The maximum JSON body is 65536 bytes.",
  );
  assert.equal(
    rejectedHarness.calls.some((query) =>
      query.text?.startsWith("INSERT INTO meals"),
    ),
    false,
  );
});

test("meal mutation media type, malformed JSON, empty body, and fields map distinctly", async () => {
  const { app } = createHarness();
  const unsupported = await request(app)
    .post("/api/v1/meals")
    .set("Content-Type", "text/plain")
    .send(JSON.stringify(validMeal()));
  const malformed = await request(app)
    .post("/api/v1/meals")
    .set("Content-Type", "application/json")
    .send("{");
  const empty = await request(app)
    .post("/api/v1/meals")
    .set("Content-Type", "application/json")
    .send();
  const incomplete = await request(app)
    .post("/api/v1/meals")
    .send({ food_name: "missing everything else" });

  assert.equal(unsupported.status, 415);
  assert.equal(unsupported.body.error.code, "UNSUPPORTED_MEDIA_TYPE");
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, "MALFORMED_JSON");
  assert.equal(empty.status, 422);
  assert.equal(incomplete.status, 422);
  for (const response of [unsupported, malformed, empty, incomplete]) {
    assert.equal(
      response.body.error.request_id,
      response.headers["x-request-id"],
    );
    assert.ok(response.headers["content-security-policy"]);
  }
});

test("meal read/delete body, unknown queries, malformed IDs, and future writes fail before mutation", async () => {
  const harness = createHarness();
  const unexpectedBody = await request(harness.app)
    .get("/api/v1/meals")
    .set("Content-Type", "application/json")
    .send({});
  const unknownQuery = await request(harness.app).get(
    "/api/v1/meals?unexpected=1",
  );
  const malformedId = await request(harness.app).get(
    "/api/v1/meals/not-a-uuid",
  );
  const future = await request(harness.app)
    .post("/api/v1/meals")
    .send({ ...validMeal(), consumption_date: "2026-09-13" });

  assert.equal(unexpectedBody.status, 422);
  assert.equal(unexpectedBody.body.error.details[0].field, "body");
  assert.equal(unknownQuery.status, 422);
  assert.equal(malformedId.status, 422);
  assert.equal(future.status, 422);
  assert.equal(
    harness.calls.some((query) => query.text?.startsWith("INSERT INTO meals")),
    false,
  );
});
