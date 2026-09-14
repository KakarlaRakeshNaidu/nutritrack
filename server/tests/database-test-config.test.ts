import assert from "node:assert/strict";
import test from "node:test";

import {
  DatabaseTestConfigurationError,
  loadDatabaseTestConfig,
} from "../tests-db/database-test-config.js";

const FILE_DATABASE_URL =
  "postgresql://file_user:file_secret@database.invalid:5432/nutritrack";

test("database tests load the selected application environment file", async () => {
  const config = await loadDatabaseTestConfig({
    readEnvironment: async () =>
      [
        "PORT=3000",
        "NODE_ENV=test",
        "CLIENT_ORIGIN=http://localhost:5173",
        "TRUST_PROXY_HOPS=0",
        "DATABASE_URL=" + FILE_DATABASE_URL,
        "PG_CA_CERT_PATH=/synthetic/application-ca.pem",
      ].join("\n"),
  });

  assert.equal(config.DATABASE_URL, FILE_DATABASE_URL);
  assert.equal(config.PG_CA_CERT_PATH, "/synthetic/application-ca.pem");
});

test("database test configuration errors do not expose file paths", async () => {
  const sentinel = "/secret/database-test-environment";

  await assert.rejects(
    loadDatabaseTestConfig({
      readEnvironment: async () => {
        throw new Error(sentinel);
      },
    }),
    (error) => {
      assert(error instanceof DatabaseTestConfigurationError);
      assert.equal(
        error.message,
        "The application environment file could not be read for database tests.",
      );
      assert.equal(error.message.includes(sentinel), false);
      return true;
    },
  );
});

test("invalid parsed application settings retain safe field-only errors", async () => {
  await assert.rejects(
    loadDatabaseTestConfig({
      readEnvironment: async () => "DATABASE_URL=not-a-postgres-url",
    }),
    (error) => {
      assert(error instanceof Error);
      assert.match(error.message, /CLIENT_ORIGIN/);
      assert.match(error.message, /DATABASE_URL/);
      assert.match(error.message, /PG_CA_CERT_PATH/);
      assert.equal(error.message.includes("not-a-postgres-url"), false);
      return true;
    },
  );
});
