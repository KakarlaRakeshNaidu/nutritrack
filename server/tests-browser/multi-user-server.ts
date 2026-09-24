import { randomUUID } from "node:crypto";
import { discoverMigrations, quoteInternalIdentifier, runMigrations } from "../src/db/migration-runner.js";
import { createDatabasePool } from "../src/db/pool.js";
import { startServer } from "../src/server.js";
import type { DatabasePool } from "../src/types.js";
import { recordingLogger } from "../support/testing.js";
import { loadDatabaseTestConfig } from "../tests-db/database-test-config.js";

const schema = "nutritrack_multi_browser_" + randomUUID().replaceAll("-", "").slice(0, 16);
const quotedSchema = quoteInternalIdentifier(schema);
const baseConfig = await loadDatabaseTestConfig();
const basePool = await createDatabasePool(baseConfig, { logger: recordingLogger() });
let owned = false;
let closed = false;

const pool: DatabasePool = {
  async connect() {
    const client = await basePool.connect();
    try {
      await client.query("SELECT set_config('search_path', $1, false)", [quotedSchema]);
      return client;
    } catch (error) {
      client.release(error instanceof Error ? error : undefined);
      throw error;
    }
  },
  async query(query, values) {
    const client = await this.connect();
    try {
      return await client.query(query, values);
    } finally {
      client.release();
    }
  },
  async end() {
    if (closed) return;
    closed = true;
    try {
      if (owned) {
        await basePool.query("DROP SCHEMA " + quotedSchema + " CASCADE");
        owned = false;
      }
    } finally {
      await basePool.end();
    }
    console.log("Multi-user browser schema removed.");
  },
};

try {
  await basePool.query("CREATE SCHEMA " + quotedSchema);
  owned = true;
  const migrations = await discoverMigrations(new URL("../migrations/", import.meta.url));
  await runMigrations({ pool, migrations, schema, logger: recordingLogger() });
  const clientOrigin = process.env.MULTI_USER_CLIENT_ORIGIN ?? "http://localhost:5174";
  const port = Number(process.env.MULTI_USER_SERVER_PORT ?? "3540");
  await startServer(
    {
      ...baseConfig,
      NODE_ENV: "development",
      PORT: port,
      CLIENT_ORIGIN: clientOrigin,
    },
    { createPool: async () => pool, logger: console },
  );
  console.log("Multi-user browser backend ready on port " + port + " for " + clientOrigin + ".");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Multi-user browser setup failed.");
  await pool.end();
  process.exitCode = 1;
}
