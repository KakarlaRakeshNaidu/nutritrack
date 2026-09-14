import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";

import { createApp } from "../src/app.js";
import type { QueryConfig } from "pg";
import type {
  DatabasePool,
  TransactionClient,
} from "../src/types.js";
import type { ReportAggregateRow } from "../src/modules/reports/report.calculations.js";
import {
  databasePoolStub,
  recordingLogger,
  testConfig,
} from "../support/testing.js";

function profileRow(): Record<string, unknown> {
  return {
    display_name: "Rakesh",
    timezone: "Asia/Kolkata",
    updated_at: new Date("2026-09-12T00:00:00Z"),
  };
}

function goalRow(): Record<string, unknown> {
  return {
    daily_calories_kcal: "2000.0000",
    daily_protein_g: "100.0000",
    daily_carbs_g: "250.0000",
    daily_fat_g: "70.0000",
    target_weight_kg: "75.0000",
    updated_at: new Date("2026-09-12T00:00:00Z"),
  };
}

function aggregateRow(): ReportAggregateRow {
  const row: ReportAggregateRow = {
    consumption_date: "2026-09-07",
    entry_count: "25",
    calories_kcal: "250.0000",
    protein_g: "10.0000",
    carbs_g: "20.0000",
    fat_g: "5.0000",
  };
  for (const field of [
    "sodium_mg",
    "calcium_mg",
    "iron_mg",
    "potassium_mg",
    "vitamin_c_mg",
    "vitamin_d_mcg",
  ]) {
    row[field + "_known_total"] = null;
    row[field + "_known_count"] = "0";
  }
  return row;
}

function createHarness(
  { databaseError }: { databaseError?: string } = {},
) {
  const calls: Array<string | QueryConfig<unknown[]>> = [];
  let releases = 0;
  const client: TransactionClient = {
    async query(query) {
      calls.push(query);
      if (databaseError) {
        throw Object.assign(new Error("private database detail"), {
          code: databaseError,
        });
      }
      const text = typeof query === "string" ? query : query.text;
      if (/^BEGIN|^COMMIT|^ROLLBACK/.test(text)) return { rows: [] };
      if (text.includes("FROM tracker_profile")) return { rows: [profileRow()] };
      if (text.includes("FROM goals")) return { rows: [goalRow()] };
      if (text.includes("FROM meals")) return { rows: [aggregateRow()] };
      throw new Error("Unexpected database access");
    },
    release() {
      releases += 1;
    },
  };
  const pool: DatabasePool = databasePoolStub(client.query);
  pool.connect = async () => client;
  return {
    app: createApp(testConfig(), {
      pool,
      clock: () => new Date("2026-09-12T12:00:00.000Z"),
      logger: recordingLogger(),
    }),
    calls,
    get releases() {
      return releases;
    },
  };
}

test("nutrition report returns its complete root contract without a data wrapper", async () => {
  const harness = createHarness();
  const response = await request(harness.app).get(
    "/api/v1/reports/nutrition?page=2&page_size=2",
  );

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "goal_comparison",
    "goal_snapshot",
    "items",
    "pagination",
    "range",
    "summary",
  ]);
  assert.equal(response.body.data, undefined);
  assert.deepEqual(response.body.pagination, {
    page: 2,
    page_size: 2,
    total_items: 7,
    total_pages: 4,
  });
  assert.equal(response.body.summary.entry_count, 25);
  assert.equal(response.body.summary.calories_kcal, 250);
  assert.equal(response.body.goal_comparison.calories_kcal.target, 12_000);
  assert.equal(response.body.goal_comparison.calories_kcal.percent, 2.08);
  assert.equal(response.body.items.length, 2);
  assert.equal(harness.releases, 1);
  assert.equal(harness.calls[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(harness.calls.at(-1), "COMMIT");
  assert.ok(response.headers["content-security-policy"]);
  assert.equal(response.body.range.timezone, "Asia/Kolkata");
});

test("report rejects invalid ranges, meal filters, repeated values, and request bodies", async () => {
  const harness = createHarness();
  const paths = [
    "?start_date=2026-09-01",
    "?start_date=2026-09-02&end_date=2026-09-01",
    "?start_date=2025-01-01&end_date=2026-01-02",
    "?meal_type=lunch",
    "?group_by=month",
    "?page=1&page=2",
    "?page=1.5",
    "?page_size=101",
    "?unknown=value",
  ];
  for (const query of paths) {
    const response = await request(harness.app).get(
      "/api/v1/reports/nutrition" + query,
    );
    assert.equal(response.status, 422, query);
    assert.equal(response.body.error.code, "VALIDATION_ERROR");
  }
  const body = await request(harness.app)
    .get("/api/v1/reports/nutrition")
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(body.status, 422);
  assert.equal(body.body.error.details[0].field, "body");
  assert.equal(harness.calls.length, 0);
});

test("report failures release the checked-out client and hide database details", async () => {
  const harness = createHarness({ databaseError: "ECONNRESET" });
  const response = await request(harness.app).get(
    "/api/v1/reports/nutrition",
  );

  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, "DATABASE_UNAVAILABLE");
  assert.equal(response.body.error.message.includes("private"), false);
  assert.equal(harness.releases, 1);
});
