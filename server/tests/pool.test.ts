import assert from "node:assert/strict";
import { rootCertificates } from "node:tls";
import test from "node:test";
import type { PoolConfig } from "pg";
import type {
  QueryResultLike,
  TransactionClient,
} from "../src/types.js";

import {
  API_STATEMENT_TIMEOUT_MS,
  configureDateParser,
  createDatabasePool,
  DatabaseConfigurationError,
  validateCertificateMaterial,
} from "../src/db/pool.js";
import { recordingLogger, testConfig } from "../support/testing.js";

test("pool setup uses verified CA TLS and the approved resource bounds", async () => {
  let options: PoolConfig | undefined;
  let idleErrorHandler: ((error: Error) => void) | undefined;
  const parsers = new Map<number, (value: string) => string>();

  class FakePool {
    constructor(poolOptions: PoolConfig) {
      options = poolOptions;
    }

    on(event: "error", handler: (error: Error) => void): void {
      assert.equal(event, "error");
      idleErrorHandler = handler;
    }

    async query(): Promise<QueryResultLike> {
      return { rows: [] };
    }

    async connect(): Promise<TransactionClient> {
      return {
        query: this.query.bind(this),
        release() {},
      };
    }

    async end(): Promise<void> {}
  }

  const logger = recordingLogger();
  const pool = await createDatabasePool(testConfig(), {
    PoolClass: FakePool,
    typeRegistry: {
      setTypeParser(oid, parser) {
        parsers.set(oid, parser);
      },
    },
    readCertificate: async () => rootCertificates[0],
    logger,
  });

  assert.ok(pool instanceof FakePool);
  assert(options);
  assert.equal(options.connectionString, testConfig().DATABASE_URL);
  assert.deepEqual(options.ssl, {
    ca: rootCertificates[0],
    rejectUnauthorized: true,
  });
  assert.equal(options.max, 5);
  assert.equal(options.connectionTimeoutMillis, 5_000);
  assert.equal(options.idleTimeoutMillis, 30_000);
  assert.equal(options.statement_timeout, API_STATEMENT_TIMEOUT_MS);
  const dateParser = parsers.get(1082);
  assert(dateParser);
  assert.equal(dateParser("2026-09-12"), "2026-09-12");

  assert(idleErrorHandler);
  idleErrorHandler(Object.assign(new Error("synthetic secret"), {
    code: "ECONNRESET",
  }));
  assert.deepEqual(logger.entries, ["database_pool_error code=ECONNRESET"]);
});

test("DATE parser registration preserves text and does not alter NUMERIC", () => {
  const calls: Array<{
    oid: number;
    parser: (value: string) => string;
  }> = [];
  configureDateParser({
    setTypeParser(oid, parser) {
      calls.push({ oid, parser });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].oid, 1082);
  assert.equal(calls[0].parser("1900-01-01"), "1900-01-01");
});

test("missing, unreadable, and malformed CA material fail safely", async () => {
  const sentinelPath = "/secret/location/aiven-ca.pem";

  await assert.rejects(
    createDatabasePool(
      testConfig({ PG_CA_CERT_PATH: sentinelPath }),
      {
        readCertificate: async () => {
          throw new Error("permission denied");
        },
      },
    ),
    (error) => {
      assert.ok(error instanceof DatabaseConfigurationError);
      assert.equal(error.message.includes(sentinelPath), false);
      return true;
    },
  );

  await assert.rejects(
    createDatabasePool(testConfig(), {
      readCertificate: async () => "not a certificate",
    }),
    DatabaseConfigurationError,
  );
  assert.throws(
    () => validateCertificateMaterial(""),
    DatabaseConfigurationError,
  );
});

test("pool module import performs no CA read or connection", async () => {
  const imported = await import("../src/db/pool.js");

  assert.equal(typeof imported.createDatabasePool, "function");
});
