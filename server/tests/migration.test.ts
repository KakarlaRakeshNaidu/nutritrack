import assert from "node:assert/strict";
import test from "node:test";

import { migrateDatabase } from "../src/db/migrate.js";
import {
  discoverMigrations,
  MigrationDefinitionError,
  quoteInternalIdentifier,
  runMigrations,
} from "../src/db/migration-runner.js";
import type { QueryConfig } from "pg";
import type { TransactionClient } from "../src/types.js";
import {
  databasePoolStub,
  VALID_CORE_ENV,
  recordingLogger,
} from "../support/testing.js";

interface MigrationClientOptions {
  appliedRows?: Record<string, unknown>[];
  failSql?: string;
}

interface RecordedQuery {
  text: string;
  values?: unknown[];
}

interface MigrationTestClient extends TransactionClient {
  calls: RecordedQuery[];
  releases: Array<Error | undefined>;
}

function file(name: string) {
  return { name, isFile: () => true };
}

function createMigrationClient(
  { appliedRows = [], failSql }: MigrationClientOptions = {},
): MigrationTestClient {
  const calls: RecordedQuery[] = [];
  const releases: Array<Error | undefined> = [];
  return {
    calls,
    releases,
    async query(
      query: string | QueryConfig<unknown[]>,
      values?: unknown[],
    ) {
      const text = typeof query === "string" ? query : query.text;
      calls.push({ text, values });
      if (text === failSql) {
        throw new Error("synthetic migration failure");
      }
      if (text.includes("SELECT version, name FROM schema_migrations")) {
        return { rows: appliedRows };
      }
      return { rows: [] };
    },
    release(error?: Error) {
      releases.push(error);
    },
  };
}

test("migration discovery validates names and sorts numeric versions", async () => {
  const migrations = await discoverMigrations("/trusted", {
    readDirectory: async () => [
      file("010_tenth.sql"),
      file("002_second.sql"),
      { name: "notes.md", isFile: () => true },
    ],
    readMigration: async (path) => `SELECT '${path}';`,
  });

  assert.deepEqual(
    migrations.map(({ version, name }) => ({ version, name })),
    [
      { version: 2, name: "002_second.sql" },
      { version: 10, name: "010_tenth.sql" },
    ],
  );
});

test("discovery rejects malformed, duplicate, and self-transactional SQL", async () => {
  await assert.rejects(
    discoverMigrations("/trusted", {
      readDirectory: async () => [file("initial.sql")],
    }),
    MigrationDefinitionError,
  );
  await assert.rejects(
    discoverMigrations("/trusted", {
      readDirectory: async () => [file("001_one.sql"), file("01_again.sql")],
      readMigration: async () => "SELECT 1",
    }),
    /duplicated/,
  );
  await assert.rejects(
    discoverMigrations("/trusted", {
      readDirectory: async () => [file("001_one.sql")],
      readMigration: async () => "BEGIN; SELECT 1; COMMIT;",
    }),
    /must not control its own transaction/,
  );
});

test("internal schema identifiers are strictly validated and quoted", () => {
  assert.equal(
    quoteInternalIdentifier("phase3_test_abc123"),
    '"phase3_test_abc123"',
  );
  for (const value of ["public; DROP SCHEMA public", "UpperCase", "", "3bad"]) {
    assert.throws(() => quoteInternalIdentifier(value), MigrationDefinitionError);
  }
});

test("pending migrations and metadata commit atomically under one session lock", async () => {
  const client = createMigrationClient();
  const migrations = [
    { version: 1, name: "001_one.sql", sql: "CREATE TABLE one()" },
    { version: 2, name: "002_two.sql", sql: "CREATE TABLE two()" },
  ];
  const result = await runMigrations({
    pool: { connect: async () => client },
    migrations,
    schema: "phase3_test_abc123",
    logger: recordingLogger(),
  });

  assert.deepEqual(result, { appliedCount: 2, existingCount: 0 });
  assert.equal(client.calls.filter(({ text }) => text === "BEGIN").length, 2);
  assert.equal(client.calls.filter(({ text }) => text === "COMMIT").length, 2);
  assert.equal(
    client.calls.filter(({ text }) =>
      text.startsWith("INSERT INTO schema_migrations")).length,
    2,
  );
  assert.equal(
    client.calls.some(({ text }) => text.includes("pg_advisory_lock")),
    true,
  );
  assert.equal(
    client.calls.some(({ text }) => text.includes("pg_advisory_unlock")),
    true,
  );
  assert.deepEqual(client.releases, [undefined]);
});

test("applied versions are not replayed or reconciled silently", async () => {
  const client = createMigrationClient({
    appliedRows: [{ version: 1, name: "001_one.sql" }],
  });
  const result = await runMigrations({
    pool: { connect: async () => client },
    migrations: [{ version: 1, name: "001_one.sql", sql: "SHOULD NOT RUN" }],
    logger: recordingLogger(),
  });
  assert.deepEqual(result, { appliedCount: 0, existingCount: 1 });
  assert.equal(client.calls.some(({ text }) => text === "SHOULD NOT RUN"), false);

  const mismatchClient = createMigrationClient({
    appliedRows: [{ version: 1, name: "001_different.sql" }],
  });
  await assert.rejects(
    runMigrations({
      pool: { connect: async () => mismatchClient },
      migrations: [{ version: 1, name: "001_one.sql", sql: "SELECT 1" }],
      logger: recordingLogger(),
    }),
    /does not match file version 1/,
  );
});

test("a failed migration rolls back, records no version, and stops later files", async () => {
  const client = createMigrationClient({ failSql: "BROKEN SQL" });
  const migrations = [
    { version: 1, name: "001_broken.sql", sql: "BROKEN SQL" },
    { version: 2, name: "002_later.sql", sql: "MUST NOT RUN" },
  ];

  await assert.rejects(
    runMigrations({
      pool: { connect: async () => client },
      migrations,
      logger: recordingLogger(),
    }),
    /synthetic migration failure/,
  );
  assert.equal(client.calls.some(({ text }) => text === "ROLLBACK"), true);
  assert.equal(
    client.calls.some(({ text }) =>
      text.startsWith("INSERT INTO schema_migrations")),
    false,
  );
  assert.equal(client.calls.some(({ text }) => text === "MUST NOT RUN"), false);
  assert.deepEqual(client.releases, [undefined]);
});

test("migration CLI closes its one pool on success and failure", async () => {
  for (const shouldFail of [false, true]) {
    let endCount = 0;
    const pool = databasePoolStub(async (query) => {
      assert.equal(query, "SELECT 1");
      return { rows: [{ "?column?": 1 }] };
    });
    pool.end = async () => {
      endCount += 1;
    };
    const run = migrateDatabase(VALID_CORE_ENV, {
      logger: recordingLogger(),
      createPool: async () => pool,
      discover: async () => [],
      migrate: async () => {
        if (shouldFail) {
          throw new Error("synthetic secret database failure");
        }
        return { appliedCount: 0, existingCount: 0 };
      },
    });

    if (shouldFail) {
      await assert.rejects(run, /synthetic secret/);
    } else {
      await run;
    }
    assert.equal(endCount, 1);
  }
});

test("migration modules are import-safe", async () => {
  const runner = await import("../src/db/migration-runner.js");
  const cli = await import("../src/db/migrate.js");
  assert.equal(typeof runner.runMigrations, "function");
  assert.equal(typeof cli.migrateDatabase, "function");
});
