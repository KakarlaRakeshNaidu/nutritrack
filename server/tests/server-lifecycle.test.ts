import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { once } from "node:events";
import test from "node:test";

import { startServer } from "../src/server.js";
import {
  databasePoolStub,
  recordingLogger,
  VALID_CORE_ENV,
} from "../support/testing.js";

async function listenOnRandomPort(): Promise<Server> {
  const server = createServer();
  server.listen(0);
  await once(server, "listening");
  return server;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function findUnusedPort() {
  const reservation = await listenOnRandomPort();
  const address = reservation.address();
  assert(address && typeof address === "object");
  const { port } = address;
  await closeServer(reservation);
  return port;
}

test("startup verifies and reuses one pool, then ends it once", async () => {
  const logger = recordingLogger();
  const port = await findUnusedPort();
  let createCalls = 0;
  let verifyCalls = 0;
  let endCalls = 0;
  const pool = databasePoolStub(async () => ({ rows: [] }));
  pool.end = async () => {
    endCalls += 1;
  };

  const running = await startServer(
    { ...VALID_CORE_ENV, PORT: String(port) },
    {
      logger,
      async createPool() {
        createCalls += 1;
        return pool;
      },
      async verifyConnection(value) {
        verifyCalls += 1;
        assert.equal(value, pool);
      },
    },
  );

  assert.equal(running.pool, pool);
  assert.equal(createCalls, 1);
  assert.equal(verifyCalls, 1);

  await Promise.all([
    running.shutdown("test"),
    running.shutdown("test-again"),
  ]);
  assert.equal(endCalls, 1);
});

test("verification failure closes the pool and preserves the original error", async () => {
  const logger = recordingLogger();
  const originalError = new Error("verification sentinel");
  let endCalls = 0;
  const pool = databasePoolStub(async () => ({ rows: [] }));
  pool.end = async () => {
    endCalls += 1;
    throw new Error("cleanup sentinel");
  };

  await assert.rejects(
    startServer(VALID_CORE_ENV, {
      logger,
      createPool: async () => pool,
      verifyConnection: async () => {
        throw originalError;
      },
    }),
    (error) => error === originalError,
  );

  assert.equal(endCalls, 1);
  assert(logger.entries.includes(
    "Database pool shutdown failed after startup error.",
  ));
});

test("listen failure closes the verified pool", async () => {
  const occupied = await listenOnRandomPort();
  const address = occupied.address();
  assert(address && typeof address === "object");
  let endCalls = 0;
  const pool = databasePoolStub(async () => ({ rows: [] }));
  pool.end = async () => {
    endCalls += 1;
  };

  try {
    await assert.rejects(
      startServer(
        { ...VALID_CORE_ENV, PORT: String(address.port) },
        {
          logger: recordingLogger(),
          createPool: async () => pool,
          verifyConnection: async () => {},
        },
      ),
      (error) => {
        assert(error && typeof error === "object" && "code" in error);
        return error.code === "EADDRINUSE";
      },
    );
    assert.equal(endCalls, 1);
  } finally {
    await closeServer(occupied);
  }
});
