import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";

import { createApp } from "../src/app.js";
import type { QueryConfig } from "pg";
import type { QueryResultLike } from "../src/types.js";
import {
  databasePoolStub,
  recordingLogger,
  testConfig,
} from "../support/testing.js";

const FIXED_INSTANT = new Date("2026-09-12T12:00:00Z");
const SENTINEL = "secret-database-detail";

function createProfileHarness(resultOrError: QueryResultLike | Error) {
  const calls: QueryConfig<unknown[]>[] = [];
  const pool = databasePoolStub(async (query) => {
    if (typeof query === "string") {
      throw new TypeError("Expected a query configuration.");
    }
    calls.push(query);
    if (resultOrError instanceof Error) {
      throw resultOrError;
    }
    return resultOrError;
  });
  const logger = recordingLogger();
  const app = createApp(testConfig(), {
    pool,
    clock: () => FIXED_INSTANT,
    logger,
  });
  return { app, calls, logger, pool };
}

test("profile returns persisted identity and timezone-derived date context", async () => {
  const harness = createProfileHarness({
    rowCount: 1,
    rows: [{ display_name: "Personal user", timezone: "Asia/Kolkata" }],
  });
  const response = await request(harness.app).get("/api/v1/profile");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    data: {
      display_name: "Personal user",
      timezone: "Asia/Kolkata",
      today: "2026-09-12",
      week_start: "2026-09-07",
      week_end: "2026-09-13",
    },
  });
  assert.equal(harness.calls.length, 1);
  assert.deepEqual(harness.calls[0].values, [1]);
  assert.match(harness.calls[0].text, /WHERE id = \$1/);
});

test("profile rejects every unexpected query key before database access", async () => {
  const harness = createProfileHarness({
    rowCount: 1,
    rows: [{ display_name: "Personal user", timezone: "Asia/Kolkata" }],
  });
  const response = await request(harness.app).get(
    "/api/v1/profile?unexpected=1",
  );

  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
  assert.equal(response.body.error.details[0].field, "unexpected");
  assert.equal(harness.calls.length, 0);
});

test("missing or invalid persisted profiles fail with safe internal errors", async () => {
  for (const result of [
    { rowCount: 0, rows: [] },
    {
      rowCount: 1,
      rows: [{ display_name: "Personal user", timezone: "Not/A_Timezone" }],
    },
    {
      rowCount: 1,
      rows: [{ display_name: "", timezone: "Asia/Kolkata" }],
    },
  ]) {
    const harness = createProfileHarness(result);
    const response = await request(harness.app).get("/api/v1/profile");
    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, "INTERNAL_ERROR");
    assert.equal(response.text.includes("Not/A_Timezone"), false);
  }
});

test("known database timeout and outage codes map narrowly to 503", async () => {
  for (const [databaseCode, responseCode] of [
    ["57014", "DATABASE_TIMEOUT"],
    ["ECONNREFUSED", "DATABASE_UNAVAILABLE"],
  ]) {
    const error = Object.assign(new Error(SENTINEL), { code: databaseCode });
    const harness = createProfileHarness(error);
    const response = await request(harness.app).get("/api/v1/profile");

    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, responseCode);
    assert.equal(response.text.includes(SENTINEL), false);
    assert.equal(harness.logger.entries.join("\n").includes(SENTINEL), false);
  }
});

test("SQL and programming failures remain generic 500 errors", async () => {
  for (const error of [
    Object.assign(new Error(SENTINEL), { code: "42601" }),
    new TypeError(SENTINEL),
  ]) {
    const harness = createProfileHarness(error);
    const response = await request(harness.app).get("/api/v1/profile");

    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, "INTERNAL_ERROR");
    assert.equal(response.text.includes(SENTINEL), false);
    assert.equal(harness.logger.entries.join("\n").includes(SENTINEL), false);
  }
});

test("the same supplied pool serves repeated profile requests", async () => {
  const harness = createProfileHarness({
    rowCount: 1,
    rows: [{ display_name: "One pool", timezone: "UTC" }],
  });

  const first = await request(harness.app).get("/api/v1/profile");
  const second = await request(harness.app).get("/api/v1/profile");

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(harness.calls.length, 2);
});
