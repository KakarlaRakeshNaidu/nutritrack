import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import request from "supertest";

import { app } from "../src/app.js";

const execFileAsync = promisify(execFile);

test("an unknown API route receives Express's standard 404 response", async () => {
  const response = await request(app).get("/api/v1/phase-1-unknown");

  assert.equal(response.status, 404);
});

test("importing the composed app exits without opening a fixed-port listener", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--input-type=module", "--eval", "await import('./src/app.js'); console.log('imported')"],
    { cwd: new URL("..", import.meta.url), timeout: 2_000 },
  );

  // A listener created during import would keep this child process alive until
  // the timeout, so a clean exit proves composition remains side-effect free.
  assert.equal(stdout.trim(), "imported");
});
