import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import request from "supertest";

import { createApp } from "../src/app.js";
import { recordingLogger, testConfig } from "../support/testing.js";

const execFileAsync = promisify(execFile);

test("an unknown API route receives the Phase 2 error contract", async () => {
  const app = createApp(testConfig(), { logger: recordingLogger() });
  const response = await request(app).get("/api/v1/phase-2-unknown");

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, "ROUTE_NOT_FOUND");
  assert.equal(response.body.error.request_id, response.headers["x-request-id"]);
  assert.deepEqual(response.body.error.details, []);
});

test("importing the composed app exits without opening a fixed-port listener", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--input-type=module", "--eval", "await import('./src/app.js'); console.log('imported')"],
    { cwd: new URL("..", import.meta.url), timeout: 2_000 },
  );

  assert.equal(stdout.trim(), "imported");
});

test("production composition never exposes test fixture routes", async () => {
  const app = createApp(testConfig(), { logger: recordingLogger() });
  const response = await request(app)
    .post("/api/v1/fixture/body")
    .send({ amount: 0, optional: null });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, "ROUTE_NOT_FOUND");
});
