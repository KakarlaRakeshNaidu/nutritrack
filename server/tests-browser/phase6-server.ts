import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import { discoverMigrations, quoteInternalIdentifier, runMigrations } from "../src/db/migration-runner.js";
import { createDatabasePool } from "../src/db/pool.js";
import { ProviderFailure } from "../src/modules/nutrition/nutrition.failures.js";
import { createExtractionService } from "../src/modules/nutrition/nutrition.service.js";
import type { ProviderAdapter } from "../src/modules/nutrition/provider-common.js";
import { startServer as startSourceServer } from "../src/server.js";
import type { DatabasePool } from "../src/types.js";
import { recordingLogger } from "../support/testing.js";
import { loadDatabaseTestConfig } from "../tests-db/database-test-config.js";

let startServer = startSourceServer;
let createRuntimeExtractionService = createExtractionService;
let RuntimeProviderFailure = ProviderFailure;
if (process.env.PHASE8_COMPILED === "true") {
  const compiledServerPath = "../dist/server.js";
  const compiledServer = (await import(compiledServerPath)) as {
    startServer: typeof startSourceServer;
  };
  const compiledServicePath = "../dist/modules/nutrition/nutrition.service.js";
  const compiledService = (await import(compiledServicePath)) as {
    createExtractionService: typeof createExtractionService;
  };
  const compiledFailurePath = "../dist/modules/nutrition/nutrition.failures.js";
  const compiledFailure = (await import(compiledFailurePath)) as {
    ProviderFailure: typeof ProviderFailure;
  };
  startServer = compiledServer.startServer;
  createRuntimeExtractionService = compiledService.createExtractionService;
  RuntimeProviderFailure = compiledFailure.ProviderFailure;
}

const schema =
  "nutritrack_browser_" +
  process.pid +
  "_" +
  randomUUID().replaceAll("-", "").slice(0, 12);
const quotedSchema = quoteInternalIdentifier(schema);
const tables = [
  { name: "tracker_profile", order: "id" },
  { name: "goals", order: "id" },
  { name: "meals", order: "id" },
  { name: "schema_migrations", order: "version" },
];
const clientOrigin = process.env.PHASE6_CLIENT_ORIGIN ?? "http://localhost:5173";
const serverPort = process.env.PHASE6_SERVER_PORT ?? "3420";
const usePhase10Provider = process.env.PHASE10_SIMULATED_PROVIDER === "true";
const config = await loadDatabaseTestConfig();
const basePool = await createDatabasePool(config, {
  logger: recordingLogger(),
});
let schemaOwned = false;
let closed = false;

interface TableSnapshot {
  exists?: false;
  rowCount?: number | null;
  digest?: string;
}

async function snapshotApplicationTables(): Promise<Record<string, TableSnapshot>> {
  const snapshot: Record<string, TableSnapshot> = {};
  for (const { name, order } of tables) {
    const relation = await basePool.query("SELECT to_regclass($1) AS relation", [
      "public." + name,
    ]);
    if (relation.rows[0].relation === null) {
      snapshot[name] = { exists: false };
      continue;
    }
    const qualified =
      quoteInternalIdentifier("public") + "." + quoteInternalIdentifier(name);
    const result = await basePool.query(
      "SELECT * FROM " + qualified + " ORDER BY " + quoteInternalIdentifier(order),
    );
    snapshot[name] = {
      rowCount: result.rowCount,
      digest: createHash("sha256")
        .update(JSON.stringify(result.rows))
        .digest("hex"),
    };
  }
  return snapshot;
}

const applicationBefore = await snapshotApplicationTables();

function isolatedPool(): DatabasePool {
  async function connect() {
    const client = await basePool.connect();
    try {
      await client.query("SELECT set_config('search_path', $1, false)", [
        quotedSchema,
      ]);
      const check = await client.query(
        "SELECT current_schema() AS current_schema, current_setting('search_path') AS search_path",
      );
      assert.equal(check.rows[0].current_schema, schema);
      assert.equal(check.rows[0].search_path, quotedSchema);
      return client;
    } catch (error) {
      client.release(error instanceof Error ? error : undefined);
      throw error;
    }
  }

  return {
    connect,
    async query(query, values) {
      const client = await connect();
      try {
        return await client.query(query, values);
      } finally {
        client.release();
      }
    },
    async end() {
      if (closed) {
        return;
      }
      closed = true;
      let cleanupError: unknown;
      if (schemaOwned) {
        try {
          // The generated name is validated and quoted before any destructive
          // operation; ordinary application schemas are never a cleanup target.
          await basePool.query("DROP SCHEMA " + quotedSchema + " CASCADE");
          schemaOwned = false;
        } catch (error) {
          cleanupError = error;
        }
      }
      try {
        assert.deepEqual(
          await snapshotApplicationTables(),
          applicationBefore,
          "Ordinary application tables changed during browser verification.",
        );
      } catch (error) {
        cleanupError ??= error;
      }
      await basePool.end();
      if (cleanupError) {
        throw cleanupError;
      }
      console.log("Phase 6 browser schema removed; application snapshot unchanged.");
    },
  };
}

const pool = isolatedPool();

function phase10Provider(): ProviderAdapter {
  let callCount = 0;
  return {
    name: "gemini",
    async analyze({ imageType, signal }) {
      callCount += 1;
      if (callCount === 3) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 5_000);
          const cancel = () => {
            clearTimeout(timer);
            reject(new RuntimeProviderFailure("user_cancellation", "Simulated request canceled."));
          };
          if (signal.aborted) cancel();
          else signal.addEventListener("abort", cancel, { once: true });
        });
      }
      if (callCount === 4) {
        throw new RuntimeProviderFailure("unavailable", "Simulated provider outage.");
      }
      const plate = imageType === "food_plate";
      return {
        status: "ok",
        food_name: plate ? "Simulated plate meal" : "Simulated label meal",
        quantity: 1,
        quantity_unit: plate ? "piece" : "serving",
        calories_kcal: plate ? 500 : 250,
        protein_g: plate ? 24 : 12,
        carbs_g: plate ? 60 : 30,
        fat_g: plate ? 16 : 8,
        micronutrients: {
          sodium_mg: plate ? 800 : 400,
          calcium_mg: null,
          iron_mg: 0,
          potassium_mg: null,
          vitamin_c_mg: null,
          vitamin_d_mcg: null,
        },
        source_basis: plate ? "One visible plate" : "One labeled serving",
        notes: plate ? ["Portions are simulated estimates."] : [],
      };
    },
  };
}

try {
  await basePool.query("CREATE SCHEMA " + quotedSchema);
  schemaOwned = true;
  const migrations = await discoverMigrations(
    new URL("../migrations/", import.meta.url),
  );
  await runMigrations({
    pool,
    migrations,
    schema,
    logger: recordingLogger(),
  });

  await pool.query(
    "INSERT INTO meals (food_name, meal_type, consumption_date, consumed_quantity, quantity_unit, calories_kcal, protein_g, carbs_g, fat_g, sodium_mg, entry_source, is_estimate) SELECT 'Browser fixture ' || lpad(value::text, 2, '0'), CASE WHEN value % 2 = 0 THEN 'lunch' ELSE 'dinner' END, DATE '2026-09-10', 1, 'piece', 10, 2, 3, 1, CASE value WHEN 1 THEN 100 WHEN 2 THEN NULL WHEN 3 THEN 20 WHEN 4 THEN 0 ELSE NULL END, 'manual', false FROM generate_series(1, 25) AS value",
  );
  await pool.query(
    "UPDATE goals SET daily_calories_kcal = 2000, daily_protein_g = 100, daily_carbs_g = 250, daily_fat_g = 70, target_weight_kg = 75 WHERE id = 1",
  );

  await startServer(
    {
      ...config,
      PORT: serverPort,
      CLIENT_ORIGIN: clientOrigin,
    },
    {
      createPool: async () => pool,
      clock: () => new Date("2026-09-12T10:00:00Z"),
      logger: console,
      extractionService: usePhase10Provider
        ? createRuntimeExtractionService({
            pool,
            providers: config.providers,
            clock: () => new Date("2026-09-12T10:00:00Z"),
            gemini: phase10Provider(),
          })
        : undefined,
    },
  );
  console.log(
    (usePhase10Provider ? "Phase 10" : "Phase 6") +
      " browser backend ready on port " +
      serverPort +
      " for origin " +
      clientOrigin +
      "; isolated schema owns 25 fixtures.",
  );
} catch (error) {
  console.error(
    "Phase 6 browser failure: " + (error instanceof Error ? error.message : "unknown error"),
  );
  try {
    await pool.end();
  } catch {
    console.error("Phase 6 browser cleanup also failed.");
  }
  console.error("Phase 6 browser backend failed safely.");
  process.exitCode = 1;
}
