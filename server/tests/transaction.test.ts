import assert from "node:assert/strict";
import test from "node:test";

import {
  runTransaction,
  withTransaction,
} from "../src/db/transaction.js";
import type { QueryConfig } from "pg";
import type { TransactionClient } from "../src/types.js";

interface TestClient extends TransactionClient {
  statements: string[];
  releases: Array<Error | undefined>;
}

function createClient(
  { failOn }: { failOn?: string } = {},
): TestClient {
  const statements: string[] = [];
  const releases: Array<Error | undefined> = [];
  const client = {
    statements,
    releases,
    async query(statement: string | QueryConfig<unknown[]>) {
      const text = typeof statement === "string" ? statement : statement.text;
      statements.push(text);
      if (text === failOn) {
        throw new Error(`failed ${text}`);
      }
      return { rows: [] };
    },
    release(error?: Error) {
      releases.push(error);
    },
  };
  return client;
}

test("write transaction commits on the same checked-out client", async () => {
  const client = createClient();
  const pool = {
    async connect() {
      return client;
    },
  };

  const result = await withTransaction(pool, async (transactionClient) => {
    assert.equal(transactionClient, client);
    await transactionClient.query("INSERT synthetic");
    return "committed";
  });

  assert.equal(result, "committed");
  assert.deepEqual(client.statements, ["BEGIN", "INSERT synthetic", "COMMIT"]);
  assert.deepEqual(client.releases, [undefined]);
});

test("read-only snapshot uses its fixed safe transaction mode", async () => {
  const client = createClient();
  await runTransaction(
    client,
    async () => "read",
    { mode: "readOnlySnapshot" },
  );

  assert.deepEqual(client.statements, [
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    "COMMIT",
  ]);
});

test("operation failure rolls back and preserves the original error", async () => {
  const client = createClient();
  const original = new Error("original write failure");
  const pool = {
    async connect() {
      return client;
    },
  };

  await assert.rejects(
    withTransaction(pool, async () => {
      throw original;
    }),
    (error) => error === original,
  );
  assert.deepEqual(client.statements, ["BEGIN", "ROLLBACK"]);
  assert.deepEqual(client.releases, [undefined]);
});

test("rollback failure preserves the original and discards the client", async () => {
  const client = createClient({ failOn: "ROLLBACK" });
  const original = new Error("original failure");
  const pool = {
    async connect() {
      return client;
    },
  };

  await assert.rejects(
    withTransaction(pool, async () => {
      throw original;
    }),
    (error) => error === original,
  );
  assert.deepEqual(client.statements, ["BEGIN", "ROLLBACK"]);
  assert.equal(client.releases.length, 1);
  assert.ok(client.releases[0] instanceof Error);
});

test("BEGIN failure discards the client", async () => {
  const client = createClient({ failOn: "BEGIN" });
  const pool = {
    async connect() {
      return client;
    },
  };

  await assert.rejects(withTransaction(pool, async () => {}), /failed BEGIN/);
  assert.deepEqual(client.statements, ["BEGIN"]);
  assert.ok(client.releases[0] instanceof Error);
});

test("acquisition failure never attempts release", async () => {
  let released = false;
  const pool = {
    async connect() {
      throw new Error("acquisition failed");
    },
  };

  await assert.rejects(
    withTransaction(pool, async () => {
      released = true;
    }),
    /acquisition failed/,
  );
  assert.equal(released, false);
});

test("unsupported transaction mode is rejected before BEGIN", async () => {
  const client = createClient();
  await assert.rejects(
    Reflect.apply(runTransaction, undefined, [
      client,
      async () => {},
      { mode: "request supplied SQL" },
    ]),
    /Unsupported transaction mode/,
  );
  assert.deepEqual(client.statements, []);
});
