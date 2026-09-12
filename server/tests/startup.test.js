import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import test from "node:test";

import { VALID_CORE_ENV } from "../support/testing.js";

const execFileAsync = promisify(execFile);
const serverDirectory = new URL("..", import.meta.url);

async function startThenStopServer(overrides) {
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: serverDirectory,
    env: { ...process.env, ...VALID_CORE_ENV, ...overrides },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  try {
    await Promise.race([
      new Promise((resolve) => {
        const interval = setInterval(() => {
          if (output.includes("Server listening")) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      new Promise((_, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Server did not start in time.")), 2_000);
        timeout.unref();
      }),
      once(child, "exit").then(([code, signal]) => {
        throw new Error(`Server exited early: code=${code} signal=${signal}`);
      }),
    ]);

    const exit = once(child, "exit");
    child.kill("SIGTERM");
    const [code, signal] = await exit;
    assert.equal(code, 0);
    assert.equal(signal, null);
    assert.match(output, /Received SIGTERM; closing the HTTP server\./);
    return output;
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
}

test("valid synthetic core configuration starts without reading the CA path", async () => {
  const output = await startThenStopServer({
    PORT: "3391",
    PG_CA_CERT_PATH: "/file/does/not/exist/in/phase-2.pem",
  });

  assert.match(output, /Server listening on http:\/\/localhost:3391/);
});

test("partial provider configuration warns safely but does not block startup", async () => {
  const sentinel = "provider-secret-must-not-be-logged";
  const output = await startThenStopServer({
    PORT: "3392",
    GEMINI_API_KEY: sentinel,
  });

  assert.match(output, /gemini configuration is incomplete/);
  assert.equal(output.includes(sentinel), false);
});

test("missing core configuration exits nonzero without exposing supplied values", () => {
  const sentinel = "postgresql://user:secret@hidden.invalid/private";
  const result = spawnSync(process.execPath, ["src/server.js"], {
    cwd: serverDirectory,
    env: {
      ...process.env,
      DATABASE_URL: sentinel,
    },
    encoding: "utf8",
    timeout: 2_000,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /CLIENT_ORIGIN/);
  assert.match(result.stderr, /PG_CA_CERT_PATH/);
  assert.equal(result.stderr.includes(sentinel), false);
});

test("importing server and app modules has no listener or external side effect", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "await import('./src/app.js'); await import('./src/server.js'); console.log('safe import')",
    ],
    { cwd: serverDirectory, timeout: 2_000 },
  );

  assert.equal(stdout.trim(), "safe import");
});
