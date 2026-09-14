import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import type { Express } from "express";
import type { QueryConfig } from "pg";
import test from "node:test";
import request from "supertest";

import { createApp } from "../src/app.js";
import type { GoalInput } from "../src/modules/goals/goal.schemas.js";
import {
  databasePoolStub,
  recordingLogger,
  testConfig,
} from "../support/testing.js";

interface ChunkedGoalResponse {
  status: number | undefined;
  headers: IncomingHttpHeaders;
  body: {
    data: { daily_protein_g: number };
    error: { code: string; details: Array<{ message: string }> };
  };
}

function goalInput(overrides: Partial<GoalInput> = {}): GoalInput {
  return {
    daily_calories_kcal: 2200.125,
    daily_protein_g: 0,
    daily_carbs_g: 250.5,
    daily_fat_g: null,
    target_weight_kg: 72.3456,
    ...overrides,
  };
}

function goalRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    daily_calories_kcal: null,
    daily_protein_g: null,
    daily_carbs_g: null,
    daily_fat_g: null,
    target_weight_kg: null,
    updated_at: new Date("2026-09-13T10:00:00Z"),
    ...overrides,
  };
}

function createHarness(
  {
    missing = false,
    databaseError,
  }: { missing?: boolean; databaseError?: string } = {},
) {
  const calls: QueryConfig<unknown[]>[] = [];
  let current = goalRow();
  const pool = databasePoolStub(async (query) => {
    assert.notEqual(typeof query, "string");
    const queryConfig = query as QueryConfig<unknown[]>;
    calls.push(queryConfig);
      if (databaseError) {
        throw Object.assign(new Error("private database detail"), {
          code: databaseError,
        });
      }
      if (
        queryConfig.text.startsWith("SELECT") &&
        queryConfig.text.includes("FROM goals")
      ) {
        return { rowCount: missing ? 0 : 1, rows: missing ? [] : [current] };
      }
      if (queryConfig.text.startsWith("UPDATE goals")) {
        if (missing) {
          return { rowCount: 0, rows: [] };
        }
        assert(queryConfig.values);
        current = goalRow({
          daily_calories_kcal: queryConfig.values[0],
          daily_protein_g: queryConfig.values[1],
          daily_carbs_g: queryConfig.values[2],
          daily_fat_g: queryConfig.values[3],
          target_weight_kg: queryConfig.values[4],
          updated_at: new Date("2026-09-13T11:00:00Z"),
        });
        return { rowCount: 1, rows: [current] };
      }
      throw new Error("Unexpected database access");
    },
  );
  return {
    app: createApp(testConfig(), {
      pool,
      logger: recordingLogger(),
    }),
    calls,
  };
}

function paddedPayload(bytes: number): string {
  const json = JSON.stringify(goalInput());
  assert(Buffer.byteLength(json) < bytes);
  return json + " ".repeat(bytes - Buffer.byteLength(json));
}

async function sendChunkedJson(
  app: Express,
  body: string,
): Promise<ChunkedGoalResponse> {
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");

  try {
    return await new Promise<ChunkedGoalResponse>((resolve, reject) => {
      const outbound = httpRequest(
        {
          host: "127.0.0.1",
          port: address.port,
          path: "/api/v1/goals",
          method: "PUT",
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
              ) as ChunkedGoalResponse["body"],
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

test("goals read all-null state and full replacement preserves zero and null", async () => {
  const harness = createHarness();
  const initial = await request(harness.app).get("/api/v1/goals");
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body.data, {
    ...goalRow(),
    updated_at: "2026-09-13T10:00:00.000Z",
  });

  const replaced = await request(harness.app)
    .put("/api/v1/goals")
    .set("Content-Type", "application/json; charset=utf-8")
    .send(JSON.stringify(goalInput()));
  assert.equal(replaced.status, 200);
  assert.deepEqual(replaced.body.data, {
    ...goalInput(),
    updated_at: "2026-09-13T11:00:00.000Z",
  });
  assert.deepEqual(Object.keys(replaced.body.data).sort(), [
    "daily_calories_kcal",
    "daily_carbs_g",
    "daily_fat_g",
    "daily_protein_g",
    "target_weight_kg",
    "updated_at",
  ]);
  assert.equal(harness.calls.filter((call) => call.text.startsWith("UPDATE")).length, 1);
});

test("goal parser accepts exactly 100000 streamed bytes and rejects 100001", async () => {
  const accepted = await sendChunkedJson(
    createHarness().app,
    paddedPayload(100_000),
  );
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.data.daily_protein_g, 0);

  const rejectedHarness = createHarness();
  const rejected = await sendChunkedJson(
    rejectedHarness.app,
    paddedPayload(100_001),
  );
  assert.equal(rejected.status, 413);
  assert.equal(rejected.body.error.code, "REQUEST_TOO_LARGE");
  assert.equal(
    rejected.body.error.details[0].message,
    "The maximum JSON body is 100000 bytes.",
  );
  assert.equal(
    rejectedHarness.calls.some((call) => call.text.startsWith("UPDATE goals")),
    false,
  );
});

test("goal media type, malformed JSON, empty body, and invalid fields map distinctly", async () => {
  const harness = createHarness();
  const unsupported = await request(harness.app)
    .put("/api/v1/goals")
    .set("Content-Type", "text/plain")
    .send(JSON.stringify(goalInput()));
  const suffixJson = await request(harness.app)
    .put("/api/v1/goals")
    .set("Content-Type", "application/problem+json")
    .send(JSON.stringify(goalInput()));
  const malformed = await request(harness.app)
    .put("/api/v1/goals")
    .set("Content-Type", "application/json")
    .send("{");
  const empty = await request(harness.app)
    .put("/api/v1/goals")
    .set("Content-Type", "application/json")
    .send();
  const partial = await request(harness.app)
    .put("/api/v1/goals")
    .send({ daily_calories_kcal: 2200 });
  const invalid = await request(harness.app)
    .put("/api/v1/goals")
    .send(goalInput({ daily_calories_kcal: 0 }));

  assert.equal(unsupported.status, 415);
  assert.equal(suffixJson.status, 415);
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, "MALFORMED_JSON");
  assert.equal(empty.status, 422);
  assert.equal(partial.status, 422);
  assert.equal(invalid.status, 422);
  assert.equal(
    harness.calls.some((call) => call.text.startsWith("UPDATE goals")),
    false,
  );
  for (const response of [
    unsupported,
    suffixJson,
    malformed,
    empty,
    partial,
    invalid,
  ]) {
    assert.equal(
      response.body.error.request_id,
      response.headers["x-request-id"],
    );
    assert.ok(response.headers["content-security-policy"]);
  }
});

test("goal reads reject bodies and queries while unsupported methods remain 404", async () => {
  const harness = createHarness();
  const body = await request(harness.app)
    .get("/api/v1/goals")
    .set("Content-Type", "application/json")
    .send({});
  const query = await request(harness.app).get("/api/v1/goals?owner=1");
  const putQuery = await request(harness.app)
    .put("/api/v1/goals?owner=1")
    .send(goalInput());
  const post = await request(harness.app).post("/api/v1/goals").send(goalInput());
  const patch = await request(harness.app).patch("/api/v1/goals").send(goalInput());
  const deleted = await request(harness.app).delete("/api/v1/goals");

  assert.equal(body.status, 422);
  assert.equal(body.body.error.details[0].field, "body");
  assert.equal(query.status, 422);
  assert.equal(putQuery.status, 422);
  assert.equal(post.status, 404);
  assert.equal(patch.status, 404);
  assert.equal(deleted.status, 404);
  assert.equal(harness.calls.length, 0);
});

test("database outages return safe 503 and a missing singleton returns safe 500", async () => {
  const unavailable = await request(
    createHarness({ databaseError: "ECONNRESET" }).app,
  ).get("/api/v1/goals");
  const missingGet = await request(createHarness({ missing: true }).app).get(
    "/api/v1/goals",
  );
  const missingPut = await request(createHarness({ missing: true }).app)
    .put("/api/v1/goals")
    .send(goalInput());

  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.error.code, "DATABASE_UNAVAILABLE");
  for (const response of [missingGet, missingPut]) {
    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, "INTERNAL_ERROR");
    assert.equal(response.body.error.message, "An unexpected error occurred.");
    assert.equal(JSON.stringify(response.body).includes("singleton"), false);
  }
});
