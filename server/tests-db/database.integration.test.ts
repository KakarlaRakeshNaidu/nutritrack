import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { rootCertificates } from "node:tls";
import test, { after, before } from "node:test";
import request from "supertest";
import type { QueryConfig } from "pg";

import { createApp } from "../src/app.js";
import {
  discoverMigrations,
  quoteInternalIdentifier,
  runMigrations,
} from "../src/db/migration-runner.js";
import {
  createDatabasePool,
  MIGRATION_STATEMENT_TIMEOUT_MS,
  verifyDatabaseConnection,
} from "../src/db/pool.js";
import { withTransaction } from "../src/db/transaction.js";
import { findSingletonGoals } from "../src/modules/goals/goal.repository.js";
import { findSingletonProfile } from "../src/modules/profile/profile.repository.js";
import { aggregateNutritionByDate } from "../src/modules/reports/report.repository.js";
import { createReportService } from "../src/modules/reports/report.service.js";
import { startServer } from "../src/server.js";
import type { RunningServer } from "../src/server.js";
import type { AppConfig } from "../src/config/env.js";
import type {
  DatabasePool,
  QueryResultLike,
} from "../src/types.js";
import type { Migration } from "../src/db/migration-runner.js";
import { recordingLogger } from "../support/testing.js";
import { loadDatabaseTestConfig } from "./database-test-config.js";

const LEGACY_ID = "00000000-0000-4000-8000-000000000001";
const LEGACY_AUTH = { userId: LEGACY_ID, email: "legacy-test@invalid.local", sessionId: "00000000-0000-4000-8000-000000000002" };


{
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const schema = "nutritrack_test_" + process.pid + "_" + suffix;
  const concurrentSchema = schema + "_lock";
  const quotedSchema = quoteInternalIdentifier(schema);
  const quotedConcurrentSchema = quoteInternalIdentifier(concurrentSchema);
  const migrationsDirectory = new URL("../migrations/", import.meta.url);
  const applicationSchemaTables = [
    { name: "nutritrack_users", orderBy: "id" },
    { name: "tracker_profile", orderBy: "user_id" },
    { name: "goals", orderBy: "user_id" },
    { name: "meals", orderBy: "id" },
    { name: "auth_sessions", orderBy: "id" },
    { name: "chat_conversations", orderBy: "id" },
    { name: "chat_messages", orderBy: "id" },
    { name: "chat_action_proposals", orderBy: "id" },
    { name: "schema_migrations", orderBy: "version" },
  ];
  type ApplicationSnapshot = Record<
    string,
    { exists: boolean; rowCount?: number | null; digest?: string }
  >;

  let applicationSnapshot: ApplicationSnapshot;
  let config: AppConfig;
  let pool: DatabasePool;
  let migrations: Migration[];
  let schemaOwned = false;
  let concurrentSchemaOwned = false;

  async function snapshotApplicationSchema(): Promise<ApplicationSnapshot> {
    const snapshot: ApplicationSnapshot = {};

    for (const { name, orderBy } of applicationSchemaTables) {
      const qualifiedName =
        quoteInternalIdentifier("public") + "." + quoteInternalIdentifier(name);
      const existsResult = await pool.query(
        "SELECT to_regclass($1) AS relation",
        ["public." + name],
      );

      if (existsResult.rows[0].relation === null) {
        snapshot[name] = { exists: false };
        continue;
      }

      // Only fixed, internally validated application identifiers are composed.
      // Digests let cleanup assertions compare data without printing user rows.
      const result = await pool.query(
        `SELECT * FROM ${qualifiedName} ORDER BY ${quoteInternalIdentifier(orderBy)}`,
      );
      snapshot[name] = {
        exists: true,
        rowCount: result.rowCount,
        digest: createHash("sha256")
          .update(JSON.stringify(result.rows))
          .digest("hex"),
      };
    }

    return snapshot;
  }

  function schemaPool(
    {
      schemaName = schema,
      basePool = pool,
      closeBase = false,
    }: {
      schemaName?: string;
      basePool?: DatabasePool;
      closeBase?: boolean;
    } = {},
  ): DatabasePool {
    const quotedSchemaName = quoteInternalIdentifier(schemaName);

    return {
      async connect() {
        const client = await basePool.connect();
        try {
          await client.query("SELECT set_config('search_path', $1, false)", [
            quotedSchemaName,
          ]);
          const isolation = await client.query(
            "SELECT current_schema() AS current_schema, current_setting('search_path') AS search_path",
          );
          assert.equal(isolation.rows[0].current_schema, schemaName);
          assert.equal(isolation.rows[0].search_path, quotedSchemaName);
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
        if (closeBase) {
          await basePool.end();
        }
      },
    };
  }

  async function queryInSchema(
    query: string | QueryConfig<unknown[]>,
    values?: unknown[],
  ): Promise<QueryResultLike> {
    return schemaPool().query(query, values);
  }

  async function insertSyntheticMeal(
    overrides: Record<string, unknown> = {},
  ): Promise<QueryResultLike> {
    const values = {
      foodName: "Phase 3 synthetic meal",
      mealType: "breakfast",
      consumptionDate: "2026-09-12",
      quantity: "1.0000",
      quantityUnit: "serving",
      calories: "250.0000",
      protein: "10.0000",
      carbs: "30.0000",
      fat: "8.0000",
      sodium: "0.0000",
      calcium: null,
      entrySource: "manual",
      isEstimate: false,
      ...overrides,
    };
    return queryInSchema(
      "INSERT INTO meals (user_id, food_name, meal_type, consumption_date, consumed_quantity, quantity_unit, calories_kcal, protein_g, carbs_g, fat_g, sodium_mg, calcium_mg, entry_source, is_estimate) VALUES ('00000000-0000-4000-8000-000000000001', $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",
      [
        values.foodName,
        values.mealType,
        values.consumptionDate,
        values.quantity,
        values.quantityUnit,
        values.calories,
        values.protein,
        values.carbs,
        values.fat,
        values.sodium,
        values.calcium,
        values.entrySource,
        values.isEstimate,
      ],
    );
  }

  async function assertConstraint(
    query: string,
    values: unknown[],
    expectedConstraint: string,
    expectedCode = "23514",
  ): Promise<void> {
    await assert.rejects(
      queryInSchema(query, values),
      (error) => {
        assert(error && typeof error === "object");
        return (
          "code" in error &&
          error.code === expectedCode &&
          "constraint" in error &&
          error.constraint === expectedConstraint
        );
      },
    );
  }

  before(async () => {
    config = await loadDatabaseTestConfig();
    pool = await createDatabasePool(config, {
      statementTimeoutMillis: MIGRATION_STATEMENT_TIMEOUT_MS,
      logger: recordingLogger(),
    });
    await verifyDatabaseConnection(pool);
    applicationSnapshot = await snapshotApplicationSchema();
    await pool.query("CREATE SCHEMA " + quotedSchema);
    schemaOwned = true;

    const isolatedPool = schemaPool();
    const isolationClient = await isolatedPool.connect();
    isolationClient.release();

    migrations = await discoverMigrations(migrationsDirectory);
    await runMigrations({
      pool: isolatedPool,
      migrations,
      schema,
      logger: recordingLogger(),
    });
  });

  after(async () => {
    if (!pool) {
      return;
    }

    let cleanupError: Error | undefined;

    async function dropOwnedSchema({
      name,
      owned,
      quotedName,
      onDropped,
    }: {
      name: string;
      owned: boolean;
      quotedName: string;
      onDropped: () => void;
    }): Promise<void> {
      if (!owned) {
        return;
      }

      try {
        await pool.query("DROP SCHEMA " + quotedName + " CASCADE");
        onDropped();
      } catch (error) {
        cleanupError ??= new Error(
          `Owned test schema ${name} could not be removed.`,
          { cause: error },
        );
      }
    }

    // Ownership flags are set only after CREATE SCHEMA succeeds. Cleanup never
    // accepts external names and always closes the pool, even when DROP fails.
    await dropOwnedSchema({
      name: concurrentSchema,
      owned: concurrentSchemaOwned,
      quotedName: quotedConcurrentSchema,
      onDropped() {
        concurrentSchemaOwned = false;
      },
    });
    await dropOwnedSchema({
      name: schema,
      owned: schemaOwned,
      quotedName: quotedSchema,
      onDropped() {
        schemaOwned = false;
      },
    });

    try {
      if (applicationSnapshot) {
        assert.deepEqual(
          await snapshotApplicationSchema(),
          applicationSnapshot,
        );
      }
    } catch (error) {
      cleanupError ??= new Error(
        "Application schema changed during isolated database tests.",
        { cause: error },
      );
    }

    try {
      await pool.end();
    } catch (error) {
      cleanupError ??= new Error("Database test pool could not be closed.", {
        cause: error,
      });
    }

    if (cleanupError) {
      throw cleanupError;
    }
  });

  test("test harness owns one isolated schema and preserves application data", async () => {
    assert.equal(schemaOwned, true);
    const client = await schemaPool().connect();
    client.release();
    assert.deepEqual(await snapshotApplicationSchema(), applicationSnapshot);
  });

  test("Aiven connection uses TLS and rejects an unrelated CA", async () => {
    const sslResult = await queryInSchema(
      "SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()",
    );
    assert.equal(sslResult.rows[0].ssl, true);
    assert.equal(typeof sslResult.rows[0].version, "string");

    const unrelatedPool = await createDatabasePool(config, {
      readCertificate: async () => rootCertificates[0],
      logger: recordingLogger(),
    });
    try {
      await assert.rejects(verifyDatabaseConnection(unrelatedPool));
    } finally {
      await unrelatedPool.end();
    }
  });

  test("migration creates exactly the approved tables, columns, indexes, and constraints", async () => {
    const tables = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
      [schema],
    );
    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      ["auth_sessions", "chat_action_proposals", "chat_conversations", "chat_messages", "goals", "meals", "nutritrack_users", "schema_migrations", "tracker_profile"],
    );

    const columns = await pool.query(
      "SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 ORDER BY table_name, ordinal_position",
      [schema],
    );
    const byColumn = new Map<string, Record<string, unknown>>(
      columns.rows.map(
        (row) => [String(row.table_name) + "." + String(row.column_name), row],
      ),
    );
    function column(name: string): Record<string, unknown> {
      const value = byColumn.get(name);
      assert(value);
      return value;
    }
    assert.equal(column("meals.consumption_date").data_type, "date");
    assert.equal(column("meals.consumption_date").is_nullable, "NO");
    assert.equal(column("meals.calories_kcal").data_type, "numeric");
    assert.equal(column("meals.calcium_mg").is_nullable, "YES");
    const idDefault = column("meals.id").column_default;
    assert(typeof idDefault === "string");
    assert.match(idDefault, /gen_random_uuid/);
    assert.equal(column("tracker_profile.user_id").data_type, "uuid");
    assert.equal(column("goals.user_id").data_type, "uuid");
    assert.equal(column("meals.user_id").data_type, "uuid");
    assert.equal(column("chat_conversations.user_id").data_type, "uuid");
    assert.equal(column("chat_messages.content").data_type, "character varying");
    assert.equal(column("chat_action_proposals.payload").data_type, "jsonb");
    assert.equal(column("chat_action_proposals.expires_at").is_nullable, "NO");

    const indexes = await pool.query(
      "SELECT indexname FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname",
      [schema],
    );
    const indexNames = indexes.rows.map((row) => row.indexname);
    assert.ok(indexNames.includes("meals_consumption_order_idx"));
    assert.ok(indexNames.includes("meals_type_consumption_order_idx"));
    assert.ok(indexNames.includes("chat_conversations_user_order_idx"));
    assert.ok(indexNames.includes("chat_messages_conversation_order_idx"));
    assert.ok(indexNames.includes("chat_action_proposals_user_status_idx"));

    const constraints = await pool.query(
      "SELECT conname FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace WHERE n.nspname = $1",
      [schema],
    );
    const constraintNames = new Set(constraints.rows.map((row) => row.conname));
    for (const name of [
      "tracker_profile_user_fk",
      "goals_user_fk",
      "meals_user_fk",
      "meals_food_name_nonblank",
      "meals_meal_type_allowed",
      "meals_consumption_date_supported",
      "meals_consumed_quantity_bounds",
      "meals_quantity_unit_allowed",
      "meals_food_plate_is_estimate",
      "chat_conversations_user_id_fkey",
      "chat_messages_conversation_id_fkey",
      "chat_action_kind_valid",
      "chat_action_status_valid",
      "chat_action_outcome_consistent",
    ]) {
      assert.ok(constraintNames.has(name), name);
    }
  });

  test("seeds are singular and migrations preserve modified data and timestamps", async () => {
    const profileSeed = await queryInSchema("SELECT * FROM tracker_profile");
    const goalsSeed = await queryInSchema("SELECT * FROM goals");
    const mealsSeed = await queryInSchema("SELECT count(*)::int AS count FROM meals");
    assert.equal(profileSeed.rowCount, 1);
    assert.equal(profileSeed.rows[0].display_name, "Personal user");
    assert.equal(profileSeed.rows[0].timezone, "Asia/Kolkata");
    assert.equal(goalsSeed.rowCount, 1);
    for (const field of [
      "daily_calories_kcal",
      "daily_protein_g",
      "daily_carbs_g",
      "daily_fat_g",
      "target_weight_kg",
    ]) {
      assert.equal(goalsSeed.rows[0][field], null);
    }
    assert.equal(mealsSeed.rows[0].count, 0);

    await queryInSchema(
      "UPDATE tracker_profile SET display_name = $1, timezone = $2 WHERE user_id = '00000000-0000-4000-8000-000000000001'",
      ["Phase 3 synthetic user", "UTC"],
    );
    await queryInSchema(
      "UPDATE goals SET daily_calories_kcal = $1, daily_protein_g = $2 WHERE user_id = '00000000-0000-4000-8000-000000000001'",
      ["2100.0000", "100.0000"],
    );
    const meal = await insertSyntheticMeal();
    const beforeRerun = await queryInSchema(
      "SELECT (SELECT row_to_json(p) FROM tracker_profile p WHERE user_id = '00000000-0000-4000-8000-000000000001') AS profile, (SELECT row_to_json(g) FROM goals g WHERE user_id = '00000000-0000-4000-8000-000000000001') AS goals, (SELECT applied_at FROM schema_migrations WHERE version=1) AS applied_at",
    );

    const result = await runMigrations({
      pool: schemaPool(),
      migrations,
      schema,
      logger: recordingLogger(),
    });
    const afterRerun = await queryInSchema(
      "SELECT (SELECT row_to_json(p) FROM tracker_profile p WHERE user_id = '00000000-0000-4000-8000-000000000001') AS profile, (SELECT row_to_json(g) FROM goals g WHERE user_id = '00000000-0000-4000-8000-000000000001') AS goals, (SELECT applied_at FROM schema_migrations WHERE version=1) AS applied_at",
    );
    const persistedMeal = await queryInSchema("SELECT * FROM meals WHERE id = $1", [
      meal.rows[0].id,
    ]);

    assert.equal(result.appliedCount, 0);
    assert.deepEqual(afterRerun.rows[0], beforeRerun.rows[0]);
    assert.equal(persistedMeal.rowCount, 1);
  });

  test("DATE, timestamps, decimal strings, known zero, NULL, duplicates, and constraints behave correctly", async () => {
    const first = await queryInSchema("SELECT * FROM meals ORDER BY created_at LIMIT 1");
    assert.equal(first.rows[0].consumption_date, "2026-09-12");
    assert.ok(first.rows[0].created_at instanceof Date);
    assert.equal(first.rows[0].sodium_mg, "0.0000");
    assert.equal(first.rows[0].calcium_mg, null);

    const duplicate = await insertSyntheticMeal();
    assert.notEqual(duplicate.rows[0].id, first.rows[0].id);

    await assertConstraint(
      "INSERT INTO tracker_profile (user_id) VALUES ($1)",
      [LEGACY_ID],
      "tracker_profile_pkey",
      "23505",
    );
    await assertConstraint(
      "INSERT INTO goals (user_id) VALUES ($1)",
      [LEGACY_ID],
      "goals_pkey",
      "23505",
    );
    await assertConstraint(
      "INSERT INTO meals (user_id, food_name,meal_type,consumption_date,consumed_quantity,quantity_unit,calories_kcal,protein_g,carbs_g,fat_g) VALUES ('00000000-0000-4000-8000-000000000001', ' ', 'breakfast', '2026-09-12', 1, 'g', 0,0,0,0)",
      [],
      "meals_food_name_nonblank",
    );
    await assertConstraint(
      "INSERT INTO meals (user_id, food_name,meal_type,consumption_date,consumed_quantity,quantity_unit,calories_kcal,protein_g,carbs_g,fat_g) VALUES ('00000000-0000-4000-8000-000000000001', 'x', 'brunch', '2026-09-12', 1, 'g', 0,0,0,0)",
      [],
      "meals_meal_type_allowed",
    );
    await assertConstraint(
      "INSERT INTO meals (user_id, food_name,meal_type,consumption_date,consumed_quantity,quantity_unit,calories_kcal,protein_g,carbs_g,fat_g) VALUES ('00000000-0000-4000-8000-000000000001', 'x', 'breakfast', '2026-09-12', -1, 'g', 0,0,0,0)",
      [],
      "meals_consumed_quantity_bounds",
    );
    await assertConstraint(
      "INSERT INTO meals (user_id, food_name,meal_type,consumption_date,consumed_quantity,quantity_unit,calories_kcal,protein_g,carbs_g,fat_g,entry_source,is_estimate) VALUES ('00000000-0000-4000-8000-000000000001', 'x', 'breakfast', '2026-09-12', 1, 'g', 0,0,0,0,'food_plate',false)",
      [],
      "meals_food_plate_is_estimate",
    );
  });

  test("failing and concurrent migrations remain atomic and serialized", async () => {
    const fixtureMigrations = [
      ...migrations,
      {
        version: 4,
        name: "004_failing_fixture.sql",
        sql: "CREATE TABLE rollback_probe (id INTEGER); SELECT missing_phase3_function();",
      },
      { version: 5, name: "005_must_not_run.sql", sql: "CREATE TABLE later_probe()" },
    ];
    await assert.rejects(
      runMigrations({
        pool: schemaPool(),
        migrations: fixtureMigrations,
        schema,
        logger: recordingLogger(),
      }),
    );
    const rollbackProbe = await pool.query("SELECT to_regclass($1) AS object", [
      schema + ".rollback_probe",
    ]);
    const migrationVersions = await queryInSchema(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    assert.equal(rollbackProbe.rows[0].object, null);
    assert.deepEqual(migrationVersions.rows.map((row) => row.version), [1, 2, 3]);

    await pool.query("CREATE SCHEMA " + quotedConcurrentSchema);
    concurrentSchemaOwned = true;
    const concurrentPool = schemaPool({ schemaName: concurrentSchema });

    const results = await Promise.all([
      runMigrations({
        pool: concurrentPool,
        migrations,
        schema: concurrentSchema,
        logger: recordingLogger(),
      }),
      runMigrations({
        pool: concurrentPool,
        migrations,
        schema: concurrentSchema,
        logger: recordingLogger(),
      }),
    ]);
    assert.deepEqual(
      results.map((result) => result.appliedCount).sort(),
      [0, 3],
    );
    const concurrentCounts = await pool.query(
      "SELECT (SELECT count(*)::int FROM " + quotedConcurrentSchema + ".schema_migrations) AS migrations, (SELECT count(*)::int FROM " + quotedConcurrentSchema + ".tracker_profile) AS profiles, (SELECT count(*)::int FROM " + quotedConcurrentSchema + ".goals) AS goals",
    );
    assert.deepEqual(concurrentCounts.rows[0], {
      migrations: 3,
      profiles: 1,
      goals: 1,
    });
  });

  test("real transactions roll back, commit, reject read-only writes, and recover", async () => {
    const transactionalPool = schemaPool();
    const original = await queryInSchema(
      "SELECT daily_calories_kcal FROM goals WHERE user_id = '00000000-0000-4000-8000-000000000001'",
    );
    await assert.rejects(
      withTransaction(transactionalPool, async (client) => {
        await client.query(
          "UPDATE goals SET daily_calories_kcal = 3333 WHERE user_id = '00000000-0000-4000-8000-000000000001'",
        );
        throw new Error("rollback fixture");
      }),
      /rollback fixture/,
    );
    const afterRollback = await queryInSchema(
      "SELECT daily_calories_kcal FROM goals WHERE user_id = '00000000-0000-4000-8000-000000000001'",
    );
    assert.deepEqual(afterRollback.rows, original.rows);

    await withTransaction(transactionalPool, async (client) => {
      await client.query("UPDATE goals SET daily_calories_kcal = 2222 WHERE user_id = '00000000-0000-4000-8000-000000000001'");
    });
    const afterCommit = await queryInSchema(
      "SELECT daily_calories_kcal FROM goals WHERE user_id = '00000000-0000-4000-8000-000000000001'",
    );
    assert.equal(afterCommit.rows[0].daily_calories_kcal, "2222.0000");

    await assert.rejects(
      withTransaction(
        transactionalPool,
        (client) =>
          client.query("UPDATE goals SET daily_calories_kcal = 4444 WHERE user_id = '00000000-0000-4000-8000-000000000001'"),
        { mode: "readOnlySnapshot" },
      ),
      (error) => {
        assert(error && typeof error === "object" && "code" in error);
        return error.code === "25006";
      },
    );
  });

  test("profile route uses migrated data and handles invalid/missing profile safely", async () => {
    const app = createApp(config, {
      testAuthIdentity: LEGACY_AUTH,
      pool: schemaPool(),
      clock: () => new Date("2026-09-12T12:00:00Z"),
      logger: recordingLogger(),
    });
    const success = await request(app).get("/api/v1/profile");
    assert.equal(success.status, 200);
    assert.equal(success.body.data.display_name, "Phase 3 synthetic user");
    assert.equal(success.body.data.timezone, "UTC");
    assert.equal(success.body.data.today, "2026-09-12");
    assert.equal(success.body.data.week_start, "2026-09-07");
    assert.equal(success.body.data.week_end, "2026-09-13");

    const invalidQuery = await request(app).get("/api/v1/profile?unexpected=1");
    assert.equal(invalidQuery.status, 422);

    await queryInSchema("UPDATE tracker_profile SET timezone='Not/A_Timezone' WHERE user_id = '00000000-0000-4000-8000-000000000001'");
    const invalid = await request(app).get("/api/v1/profile");
    assert.equal(invalid.status, 500);
    await queryInSchema("UPDATE tracker_profile SET timezone='UTC' WHERE user_id = '00000000-0000-4000-8000-000000000001'");

    await queryInSchema("DELETE FROM tracker_profile WHERE user_id = '00000000-0000-4000-8000-000000000001'");
    const missing = await request(app).get("/api/v1/profile");
    assert.equal(missing.status, 500);
    await queryInSchema(
      "INSERT INTO tracker_profile (user_id, display_name, timezone) VALUES ('00000000-0000-4000-8000-000000000001', $1, $2)",
      ["Phase 3 synthetic user", "UTC"],
    );
  });

  test("PostgreSQL statement timeout cancels work and leaves the pool usable", async () => {
    const client = await schemaPool().connect();
    try {
      await client.query("SET statement_timeout TO '25ms'");
      await assert.rejects(
        client.query("SELECT pg_sleep(0.2)"),
        (error) => {
          assert(error && typeof error === "object" && "code" in error);
          return error.code === "57014";
        },
      );
      await client.query("SET statement_timeout TO '10000ms'");
      const result = await client.query("SELECT 1 AS ok");
      assert.equal(result.rows[0].ok, 1);
    } finally {
      client.release();
    }
  });

  test("API restart preserves profile, goals, meals, and migration state", async () => {
    const beforeRestart = await queryInSchema(
      "SELECT (SELECT count(*)::int FROM meals) AS meals, (SELECT count(*)::int FROM schema_migrations) AS migrations, (SELECT display_name FROM tracker_profile WHERE user_id = '00000000-0000-4000-8000-000000000001') AS display_name, (SELECT daily_calories_kcal FROM goals WHERE user_id = '00000000-0000-4000-8000-000000000001') AS calories",
    );

    for (const port of [3396, 3397]) {
      const basePool = await createDatabasePool(config, {
        logger: recordingLogger(),
      });
      const runtimePool = schemaPool({ basePool, closeBase: true });
      let runtime;

      try {
        runtime = await startServer(
          { ...config, PORT: String(port) },
          {
            testAuthIdentity: LEGACY_AUTH,
          createPool: async () => runtimePool,
            clock: () => new Date("2026-09-12T12:00:00Z"),
            logger: recordingLogger(),
          },
        );
        const response = await fetch(
          "http://127.0.0.1:" + port + "/api/v1/profile",
        );
        assert.equal(response.status, 200);
        assert.equal(
          (await response.json()).data.display_name,
          "Phase 3 synthetic user",
        );
      } finally {
        if (runtime) {
          await runtime.shutdown("integration test");
        }
      }
    }

    const afterRestart = await queryInSchema(
      "SELECT (SELECT count(*)::int FROM meals) AS meals, (SELECT count(*)::int FROM schema_migrations) AS migrations, (SELECT display_name FROM tracker_profile WHERE user_id = '00000000-0000-4000-8000-000000000001') AS display_name, (SELECT daily_calories_kcal FROM goals WHERE user_id = '00000000-0000-4000-8000-000000000001') AS calories",
    );
    assert.deepEqual(afterRestart.rows, beforeRestart.rows);
  });

  test("live owned-schema goal lifecycle survives replacement and restart", async () => {
    await queryInSchema(
      "UPDATE goals SET daily_calories_kcal=NULL, daily_protein_g=NULL, daily_carbs_g=NULL, daily_fat_g=NULL, target_weight_kg=NULL, updated_at=TIMESTAMPTZ '2000-01-01T00:00:00Z' WHERE user_id = '00000000-0000-4000-8000-000000000001'",
    );
    const original = await queryInSchema(
      "SELECT user_id AS id, created_at, updated_at, daily_calories_kcal, daily_protein_g, daily_carbs_g, daily_fat_g, target_weight_kg FROM goals WHERE user_id = '00000000-0000-4000-8000-000000000001'",
    );
    assert.equal(original.rowCount, 1);

    let runtime: RunningServer | undefined;
    let activePort = 3400;
    async function call(options: RequestInit = {}) {
      const response = await fetch(
        "http://127.0.0.1:" + activePort + "/api/v1/goals",
        options,
      );
      return { response, body: await response.json() };
    }
    async function start(port: number): Promise<RunningServer> {
      activePort = port;
      return startServer(
        { ...config, PORT: String(port) },
        {
          testAuthIdentity: LEGACY_AUTH,
          createPool: async () => schemaPool(),
          logger: recordingLogger(),
        },
      );
    }

    try {
      runtime = await start(3400);
      const initial = await call();
      assert.equal(initial.response.status, 200);
      assert.deepEqual(initial.body.data, {
        daily_calories_kcal: null,
        daily_protein_g: null,
        daily_carbs_g: null,
        daily_fat_g: null,
        target_weight_kg: null,
        updated_at: "2000-01-01T00:00:00.000Z",
      });
      const afterRead = await queryInSchema(
        "SELECT user_id AS id, created_at, updated_at, daily_calories_kcal, daily_protein_g, daily_carbs_g, daily_fat_g, target_weight_kg FROM goals WHERE user_id = '00000000-0000-4000-8000-000000000001'",
      );
      assert.deepEqual(afterRead.rows, original.rows);

      const replacement = {
        daily_calories_kcal: 2300.1234,
        daily_protein_g: 0,
        daily_carbs_g: 280.5,
        daily_fat_g: null,
        target_weight_kg: 72.1234,
      };
      const replaced = await call({
        method: "PUT",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(replacement),
      });
      assert.equal(replaced.response.status, 200);
      assert.deepEqual(
        {
          ...replaced.body.data,
          updated_at: undefined,
        },
        {
          ...replacement,
          updated_at: undefined,
        },
      );
      assert.match(replaced.body.data.updated_at, /^\d{4}-\d{2}-\d{2}T/);

      const persisted = await queryInSchema(
        "SELECT user_id AS id, created_at, updated_at, daily_calories_kcal, daily_protein_g, daily_carbs_g, daily_fat_g, target_weight_kg FROM goals WHERE user_id = '00000000-0000-4000-8000-000000000001'",
      );
      assert.equal(persisted.rowCount, 1);
      assert.equal(persisted.rows[0].id, original.rows[0].id);
      assert.deepEqual(persisted.rows[0].created_at, original.rows[0].created_at);
      assert.notDeepEqual(persisted.rows[0].updated_at, original.rows[0].updated_at);
      assert.equal(persisted.rows[0].daily_calories_kcal, "2300.1234");
      assert.equal(persisted.rows[0].daily_protein_g, "0.0000");
      assert.equal(persisted.rows[0].daily_carbs_g, "280.5000");
      assert.equal(persisted.rows[0].daily_fat_g, null);
      assert.equal(persisted.rows[0].target_weight_kg, "72.1234");

      const beforeInvalid = await queryInSchema(
        "SELECT daily_calories_kcal, daily_protein_g, daily_carbs_g, daily_fat_g, target_weight_kg, updated_at FROM goals WHERE user_id = '00000000-0000-4000-8000-000000000001'",
      );
      for (const invalidBody of [
        { daily_calories_kcal: 2500 },
        { ...replacement, daily_calories_kcal: 1.00001 },
        { ...replacement, daily_protein_g: -1 },
      ]) {
        const invalid = await call({
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(invalidBody),
        });
        assert.equal(invalid.response.status, 422);
      }
      const afterInvalid = await queryInSchema(
        "SELECT daily_calories_kcal, daily_protein_g, daily_carbs_g, daily_fat_g, target_weight_kg, updated_at FROM goals WHERE user_id = '00000000-0000-4000-8000-000000000001'",
      );
      assert.deepEqual(afterInvalid.rows, beforeInvalid.rows);

      await queryInSchema(
        "UPDATE goals SET updated_at=TIMESTAMPTZ '2001-01-01T00:00:00Z' WHERE user_id = '00000000-0000-4000-8000-000000000001'",
      );
      const allNull = {
        daily_calories_kcal: null,
        daily_protein_g: null,
        daily_carbs_g: null,
        daily_fat_g: null,
        target_weight_kg: null,
      };
      const cleared = await call({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(allNull),
      });
      assert.equal(cleared.response.status, 200);
      assert.deepEqual(
        { ...cleared.body.data, updated_at: undefined },
        { ...allNull, updated_at: undefined },
      );
      assert.notEqual(
        cleared.body.data.updated_at,
        "2001-01-01T00:00:00.000Z",
      );
      assert.equal(
        (await queryInSchema("SELECT count(*)::int AS count FROM goals")).rows[0]
          .count,
        1,
      );

      await runtime.shutdown("Phase 5 pre-restart");
      runtime = undefined;
      runtime = await start(3401);
      const afterRestart = await call();
      assert.equal(afterRestart.response.status, 200);
      assert.deepEqual(afterRestart.body.data, cleared.body.data);

      await queryInSchema("DELETE FROM goals WHERE user_id = '00000000-0000-4000-8000-000000000001'");
      const missingRead = await call();
      assert.equal(missingRead.response.status, 500);
      assert.equal(missingRead.body.error.code, "INTERNAL_ERROR");
      const missingWrite = await call({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(replacement),
      });
      assert.equal(missingWrite.response.status, 500);
      assert.equal(missingWrite.body.error.code, "INTERNAL_ERROR");
      assert.equal(
        (await queryInSchema("SELECT count(*)::int AS count FROM goals")).rows[0]
          .count,
        0,
      );
    } finally {
      if (runtime) {
        await runtime.shutdown("Phase 5 integration test");
      }
      const existing = await queryInSchema(
        "SELECT count(*)::int AS count FROM goals WHERE user_id = '00000000-0000-4000-8000-000000000001'",
      );
      if (existing.rows[0].count === 0) {
        await queryInSchema(
          "INSERT INTO goals (user_id, daily_calories_kcal, daily_protein_g, daily_carbs_g, daily_fat_g, target_weight_kg, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000001', $1, $2, $3, $4, $5, $6, $7)",
          [
            original.rows[0].daily_calories_kcal,
            original.rows[0].daily_protein_g,
            original.rows[0].daily_carbs_g,
            original.rows[0].daily_fat_g,
            original.rows[0].target_weight_kg,
            original.rows[0].created_at,
            original.rows[0].updated_at,
          ],
        );
      }
    }
  });

  test("live owned-schema meal CRUD preserves totals and full-replacement semantics", async () => {
    await queryInSchema("DELETE FROM meals");
    await queryInSchema("UPDATE tracker_profile SET timezone = 'UTC' WHERE user_id = '00000000-0000-4000-8000-000000000001'");
    const port = 34998;
    const runtimePool = schemaPool();
    let runtime;

    function payload(overrides = {}) {
      return {
        food_name: "Example yogurt",
        meal_type: "breakfast",
        consumption_date: "2026-09-12",
        consumed_quantity: 150,
        quantity_unit: "g",
        calories_kcal: 180,
        protein_g: 9,
        carbs_g: 27,
        fat_g: 3,
        micronutrients: {
          sodium_mg: 0,
          calcium_mg: 120,
          iron_mg: null,
          potassium_mg: null,
          vitamin_c_mg: null,
          vitamin_d_mcg: null,
        },
        entry_source: "manual",
        is_estimate: false,
        ...overrides,
      };
    }

    async function call(path: string, options: RequestInit = {}) {
      const response = await fetch(
        "http://127.0.0.1:" + port + "/api/v1" + path,
        options,
      );
      return {
        response,
        body: response.status === 204 ? null : await response.json(),
      };
    }

    try {
      runtime = await startServer(
        { ...config, PORT: String(port) },
        {
          testAuthIdentity: LEGACY_AUTH,
          createPool: async () => runtimePool,
          clock: () => new Date("2026-09-12T20:00:00Z"),
          logger: recordingLogger(),
        },
      );

      const createdResult = await call("/meals", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload()),
      });
      assert.equal(createdResult.response.status, 201);
      assert.equal(
        createdResult.response.headers.get("location"),
        "/api/v1/meals/" + createdResult.body.data.id,
      );
      const created = createdResult.body.data;
      assert.match(created.id, /^[0-9a-f-]{36}$/);
      assert.equal(created.consumed_quantity, 150);
      assert.equal(created.calories_kcal, 180);
      assert.equal(created.micronutrients.sodium_mg, 0);
      assert.equal(created.micronutrients.iron_mg, null);

      const read = await call("/meals/" + created.id);
      assert.equal(read.response.status, 200);
      assert.deepEqual(read.body.data, created);

      const incomplete = await call("/meals/" + created.id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ food_name: "partial" }),
      });
      assert.equal(incomplete.response.status, 422);
      const afterIncomplete = await call("/meals/" + created.id);
      assert.deepEqual(afterIncomplete.body.data, created);

      const replacement = payload({
        food_name: "O'Brien'); DROP TABLE meals; -- \u0918\u0930",
        meal_type: "lunch",
        consumed_quantity: 300,
        quantity_unit: "ml",
        micronutrients: {
          sodium_mg: null,
          calcium_mg: 0,
          iron_mg: 1.0001,
          potassium_mg: null,
          vitamin_c_mg: null,
          vitamin_d_mcg: null,
        },
        entry_source: "nutrition_label",
      });
      const updatedResult = await call("/meals/" + created.id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(replacement),
      });
      assert.equal(updatedResult.response.status, 200);
      const updated = updatedResult.body.data;
      assert.equal(updated.id, created.id);
      assert.equal(updated.created_at, created.created_at);
      assert.notEqual(updated.updated_at, created.updated_at);
      assert.equal(updated.consumed_quantity, 300);
      assert.equal(updated.calories_kcal, 180);
      assert.equal(updated.micronutrients.sodium_mg, null);
      assert.equal(updated.micronutrients.calcium_mg, 0);
      assert.equal(updated.micronutrients.iron_mg, 1.0001);
      assert.equal(updated.food_name, replacement.food_name);

      const categoryIds = [];
      for (const [mealType, unit] of [
        ["breakfast", "g"],
        ["lunch", "ml"],
        ["dinner", "serving"],
        ["snacks", "piece"],
      ]) {
        const result = await call("/meals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            payload({ meal_type: mealType, quantity_unit: unit }),
          ),
        });
        assert.equal(result.response.status, 201);
        categoryIds.push(result.body.data.id);
      }
      const repeated = await call("/meals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload({ meal_type: "lunch", quantity_unit: "ml" })),
      });
      assert.equal(repeated.response.status, 201);
      assert.notEqual(repeated.body.data.id, categoryIds[1]);

      const futureUtc = await call("/meals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload({ consumption_date: "2026-09-13" })),
      });
      assert.equal(futureUtc.response.status, 422);

      await queryInSchema(
        "UPDATE tracker_profile SET timezone = $1, updated_at = now() WHERE user_id = '00000000-0000-4000-8000-000000000001'",
        ["Asia/Kolkata"],
      );
      const kolkataToday = await call("/meals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          payload({
            consumption_date: "2026-09-13",
            entry_source: "food_plate",
            is_estimate: true,
          }),
        ),
      });
      assert.equal(kolkataToday.response.status, 201);

      const filtered = await call(
        "/meals?start_date=2026-09-12&end_date=2026-09-12&meal_type=lunch",
      );
      assert.equal(filtered.response.status, 200);
      assert.equal(filtered.body.pagination.total_items, 3);

      const deleted = await call("/meals/" + created.id, { method: "DELETE" });
      assert.equal(deleted.response.status, 204);
      assert.equal(deleted.body, null);
      assert.equal((await call("/meals/" + created.id)).response.status, 404);
      assert.equal(
        (await call("/meals/" + created.id, { method: "DELETE" })).response.status,
        404,
      );
      assert.equal(
        (
          await call("/meals/" + created.id, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload()),
          })
        ).response.status,
        404,
      );
    } finally {
      await queryInSchema(
        "UPDATE tracker_profile SET timezone = $1, updated_at = now() WHERE user_id = '00000000-0000-4000-8000-000000000001'",
        ["UTC"],
      );
      if (runtime) {
        await runtime.shutdown("Phase 4 integration test");
      }
    }
  });

  test("filtered database pagination is inclusive, stable, and mutation-aware", async () => {
    await queryInSchema("DELETE FROM meals");
    await queryInSchema(
      "INSERT INTO meals (user_id, id, food_name, meal_type, consumption_date, consumed_quantity, quantity_unit, calories_kcal, protein_g, carbs_g, fat_g, sodium_mg, entry_source, is_estimate, created_at, updated_at) SELECT '00000000-0000-4000-8000-000000000001', ('10000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid, 'Paged meal ' || value, 'dinner', DATE '2026-09-10', 1, 'piece', value, 1, 2, 3, 0, 'manual', false, TIMESTAMPTZ '2026-09-12T09:00:00Z', TIMESTAMPTZ '2026-09-12T09:00:00Z' FROM generate_series(1, 25) AS value",
    );
    await queryInSchema(
      "INSERT INTO meals (user_id, id, food_name, meal_type, consumption_date, consumed_quantity, quantity_unit, calories_kcal, protein_g, carbs_g, fat_g, entry_source, is_estimate, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Older diary date', 'breakfast', '2026-09-09', 1, 'piece', 1, 1, 1, 1, 'manual', false, '2099-01-01T00:00:00Z', '2099-01-01T00:00:00Z'), ('00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'Newer diary date', 'breakfast', '2026-09-10', 1, 'piece', 1, 1, 1, 1, 'manual', false, '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z')",
    );

    const app = createApp(config, {
      testAuthIdentity: LEGACY_AUTH,
      pool: schemaPool(),
      clock: () => new Date("2026-09-12T12:00:00Z"),
      logger: recordingLogger(),
    });
    const baseQuery =
      "/api/v1/meals?start_date=2026-09-10&end_date=2026-09-10&meal_type=dinner";
    const first = await request(app).get(baseQuery);
    const second = await request(app).get(baseQuery + "&page=2");
    assert.equal(first.status, 200);
    assert.equal(first.body.items.length, 20);
    assert.deepEqual(first.body.pagination, {
      page: 1,
      page_size: 20,
      total_items: 25,
      total_pages: 2,
    });
    assert.equal(second.body.items.length, 5);
    assert.equal(second.body.pagination.total_items, 25);

    const pages = [];
    for (const page of [1, 2, 3]) {
      const response = await request(app).get(
        baseQuery + "&page=" + page + "&page_size=10",
      );
      pages.push(
        ...response.body.items.map((meal: { id: string }) => meal.id),
      );
      assert.equal(response.body.pagination.total_items, 25);
      assert.equal(response.body.pagination.total_pages, 3);
      assert.equal(response.body.items.length, page < 3 ? 10 : 5);
    }
    assert.equal(new Set(pages).size, 25);
    assert.deepEqual(
      pages,
      [...pages].sort().reverse(),
    );

    for (const query of [
      "?start_date=2026-09-10&meal_type=dinner",
      "?end_date=2026-09-10&meal_type=dinner",
      "?start_date=2026-09-10&end_date=2026-09-10&meal_type=dinner",
    ]) {
      const response = await request(app).get("/api/v1/meals" + query);
      assert.equal(response.body.pagination.total_items, 25);
    }
    const empty = await request(app).get(
      "/api/v1/meals?start_date=2099-01-01&meal_type=dinner",
    );
    assert.deepEqual(empty.body.pagination, {
      page: 1,
      page_size: 20,
      total_items: 0,
      total_pages: 0,
    });
    assert.equal(
      (await request(app).get("/api/v1/meals?start_date=2026-09-11&end_date=2026-09-10")).status,
      422,
    );
    assert.equal(
      (await request(app).get("/api/v1/meals?page_size=101")).status,
      422,
    );
    const beyond = await request(app).get(baseQuery + "&page=99&page_size=10");
    assert.equal(beyond.body.items.length, 0);
    assert.equal(beyond.body.pagination.total_items, 25);
    assert.equal(beyond.body.pagination.total_pages, 3);

    const breakfast = await request(app).get(
      "/api/v1/meals?meal_type=breakfast&page_size=10",
    );
    assert.deepEqual(
      breakfast.body.items.map(
        (meal: { food_name: string }) => meal.food_name,
      ),
      ["Newer diary date", "Older diary date"],
    );

    const updateId = "10000000-0000-4000-8000-000000000025";
    const replacement = {
      food_name: "Moved meal",
      meal_type: "lunch",
      consumption_date: "2026-09-11",
      consumed_quantity: 2,
      quantity_unit: "piece",
      calories_kcal: 25,
      protein_g: 1,
      carbs_g: 2,
      fat_g: 3,
      micronutrients: {
        sodium_mg: 0,
        calcium_mg: null,
        iron_mg: null,
        potassium_mg: null,
        vitamin_c_mg: null,
        vitamin_d_mcg: null,
      },
      entry_source: "manual",
      is_estimate: false,
    };
    assert.equal(
      (
        await request(app)
          .put("/api/v1/meals/" + updateId)
          .send(replacement)
      ).status,
      200,
    );
    assert.equal(
      (await request(app).get(baseQuery)).body.pagination.total_items,
      24,
    );
    assert.equal(
      (
        await request(app).delete(
          "/api/v1/meals/10000000-0000-4000-8000-000000000024",
        )
      ).status,
      204,
    );
    assert.equal(
      (await request(app).get(baseQuery)).body.pagination.total_items,
      23,
    );
  });

  test("repeatable-read meal count and page observations share one snapshot", async () => {
    const outsideBefore = await queryInSchema(
      "SELECT count(*)::int AS count FROM meals",
    );

    await withTransaction(
      schemaPool(),
      async (client) => {
        const snapshotBefore = await client.query(
          "SELECT count(*)::int AS count FROM meals",
        );
        await queryInSchema(
          "INSERT INTO meals (user_id, food_name, meal_type, consumption_date, consumed_quantity, quantity_unit, calories_kcal, protein_g, carbs_g, fat_g, entry_source, is_estimate) VALUES ('00000000-0000-4000-8000-000000000001', $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
          ["Concurrent meal", "snacks", "2026-09-12", 1, "piece", 1, 1, 1, 1, "manual", false],
        );
        const snapshotAfter = await client.query(
          "SELECT count(*)::int AS count FROM meals",
        );
        assert.equal(
          snapshotAfter.rows[0].count,
          snapshotBefore.rows[0].count,
        );
      },
      { mode: "readOnlySnapshot" },
    );

    const outsideAfter = await queryInSchema(
      "SELECT count(*)::int AS count FROM meals",
    );
    const outsideBeforeCount = outsideBefore.rows[0].count;
    const outsideAfterCount = outsideAfter.rows[0].count;
    assert(typeof outsideBeforeCount === "number");
    assert(typeof outsideAfterCount === "number");
    assert.equal(outsideAfterCount, outsideBeforeCount + 1);
  });
  test("nutrition report real HTTP paging, grouping, and mutations use full aggregates", async () => {
    await queryInSchema("DELETE FROM meals");
    await queryInSchema(
      "UPDATE tracker_profile SET timezone = 'Asia/Kolkata' WHERE user_id = '00000000-0000-4000-8000-000000000001'",
    );
    await queryInSchema(
      "UPDATE goals SET daily_calories_kcal = 2000, daily_protein_g = 0, daily_carbs_g = NULL, daily_fat_g = 70, target_weight_kg = 75 WHERE user_id = '00000000-0000-4000-8000-000000000001'",
    );
    await queryInSchema(
      "INSERT INTO meals (user_id, food_name, meal_type, consumption_date, consumed_quantity, quantity_unit, calories_kcal, protein_g, carbs_g, fat_g, entry_source, is_estimate) SELECT '00000000-0000-4000-8000-000000000001', 'Report meal ' || value, 'breakfast', DATE '2026-09-07', 1, 'piece', 10, 0, 0, 0, 'manual', false FROM generate_series(1, 25) AS value",
    );

    const app = createApp(config, {
      testAuthIdentity: LEGACY_AUTH,
      pool: schemaPool(),
      clock: () => new Date("2026-09-12T12:00:00Z"),
      logger: recordingLogger(),
    });
    const base =
      "/api/v1/reports/nutrition?start_date=2026-09-07&end_date=2026-09-13&page_size=2";
    const itemCounts = [];
    for (const page of [1, 2, 3, 4]) {
      const response = await request(app).get(base + "&page=" + page);
      assert.equal(response.status, 200);
      itemCounts.push(response.body.items.length);
      assert.equal(response.body.summary.entry_count, 25);
      assert.equal(response.body.summary.calories_kcal, 250);
      assert.deepEqual(response.body.goal_comparison.calories_kcal, {
        actual: 250,
        target: 12000,
        difference: -11750,
        percent: 2.08,
      });
      assert.equal(response.body.pagination.total_items, 7);
      assert.equal(response.body.pagination.total_pages, 4);
    }
    assert.deepEqual(itemCounts, [2, 2, 2, 1]);

    const week = await request(app).get(
      "/api/v1/reports/nutrition?start_date=2026-09-07&end_date=2026-09-13&group_by=week",
    );
    assert.equal(week.status, 200);
    assert.equal(week.body.items.length, 1);
    assert.equal(week.body.items[0].calories_kcal, 250);
    assert.equal(week.body.summary.calories_kcal, 250);

    const beyond = await request(app).get(base + "&page=99");
    assert.equal(beyond.status, 200);
    assert.deepEqual(beyond.body.items, []);
    assert.equal(beyond.body.summary.calories_kcal, 250);

    const defaults = await request(app).get("/api/v1/reports/nutrition");
    assert.equal(defaults.status, 200);
    assert.equal(defaults.body.range.start_date, "2026-09-07");
    assert.equal(defaults.body.range.end_date, "2026-09-13");
    assert.equal(defaults.body.range.timezone, "Asia/Kolkata");

    await queryInSchema(
      "UPDATE meals SET calories_kcal = 20 WHERE id = (SELECT id FROM meals LIMIT 1)",
    );
    await queryInSchema(
      "UPDATE goals SET daily_calories_kcal = 1000 WHERE user_id = '00000000-0000-4000-8000-000000000001'",
    );
    const changed = await request(app).get(base);
    assert.equal(changed.body.summary.calories_kcal, 260);
    assert.equal(changed.body.goal_comparison.calories_kcal.target, 6000);
    await queryInSchema("DELETE FROM meals");
    const emptied = await request(app).get(base);
    assert.equal(emptied.body.summary.entry_count, 0);
    assert.equal(emptied.body.summary.calories_kcal, 0);

    const meal = {
      food_name: "Report mutation meal",
      meal_type: "lunch",
      consumption_date: "2026-09-12",
      consumed_quantity: 1,
      quantity_unit: "piece",
      calories_kcal: 500,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      micronutrients: {
        sodium_mg: null,
        calcium_mg: null,
        iron_mg: null,
        potassium_mg: null,
        vitamin_c_mg: null,
        vitamin_d_mcg: null,
      },
      entry_source: "manual",
      is_estimate: false,
    };
    const created = await request(app).post("/api/v1/meals").send(meal);
    assert.equal(created.status, 201);
    assert.equal((await request(app).get(base)).body.summary.calories_kcal, 500);

    const replaced = await request(app)
      .put("/api/v1/meals/" + created.body.data.id)
      .send({
        ...meal,
        consumption_date: "2026-09-11",
        calories_kcal: 600,
      });
    assert.equal(replaced.status, 200);
    assert.equal((await request(app).get(base)).body.summary.calories_kcal, 600);

    const beforeGoalUpdate = await request(app).get(base);
    assert.equal(
      beforeGoalUpdate.body.goal_comparison.calories_kcal.target,
      6000,
    );
    const goalUpdate = await request(app).put("/api/v1/goals").send({
      daily_calories_kcal: 2000,
      daily_protein_g: 0,
      daily_carbs_g: null,
      daily_fat_g: 70,
      target_weight_kg: 75,
    });
    assert.equal(goalUpdate.status, 200);
    const afterGoalUpdate = await request(app).get(base);
    assert.equal(afterGoalUpdate.body.summary.calories_kcal, 600);
    assert.equal(
      afterGoalUpdate.body.goal_comparison.calories_kcal.target,
      12000,
    );

    const invalid = await request(app)
      .put("/api/v1/meals/" + created.body.data.id)
      .send({ ...meal, consumption_date: "2026-09-13" });
    assert.equal(invalid.status, 422);
    assert.equal((await request(app).get(base)).body.summary.calories_kcal, 600);

    assert.equal(
      (await request(app).delete("/api/v1/meals/" + created.body.data.id))
        .status,
      204,
    );
    assert.equal((await request(app).get(base)).body.summary.calories_kcal, 0);

  });

  test("nutrition report preserves coverage and exact decimal arithmetic", async () => {
    await queryInSchema("DELETE FROM meals");
    await queryInSchema(
      "INSERT INTO meals (user_id, food_name, meal_type, consumption_date, consumed_quantity, quantity_unit, calories_kcal, protein_g, carbs_g, fat_g, sodium_mg, calcium_mg, iron_mg, entry_source, is_estimate) VALUES ('00000000-0000-4000-8000-000000000001', 'Micro 1','lunch','2026-09-10',1,'piece',0.1,0,0,0,100,NULL,0,'manual',false), ('00000000-0000-4000-8000-000000000001', 'Micro 2','lunch','2026-09-10',1,'piece',0.2,0,0,0,NULL,NULL,0,'manual',false), ('00000000-0000-4000-8000-000000000001', 'Micro 3','lunch','2026-09-10',1,'piece',750000,0,0,0,20,NULL,0,'manual',false), ('00000000-0000-4000-8000-000000000001', 'Micro 4','lunch','2026-09-10',1,'piece',750000,0,0,0,0,NULL,0,'manual',false)",
    );
    const response = await request(
      createApp(config, {
      testAuthIdentity: LEGACY_AUTH,
        pool: schemaPool(),
        clock: () => new Date("2026-09-12T12:00:00Z"),
        logger: recordingLogger(),
      }),
    ).get(
      "/api/v1/reports/nutrition?start_date=2026-09-10&end_date=2026-09-10",
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.summary.calories_kcal, 1500000.3);
    assert.deepEqual(response.body.summary.micronutrients.sodium_mg, {
      unit: "mg",
      known_total: 120,
      known_count: 3,
      unknown_count: 1,
      entry_count: 4,
    });
    assert.deepEqual(response.body.summary.micronutrients.calcium_mg, {
      unit: "mg",
      known_total: null,
      known_count: 0,
      unknown_count: 4,
      entry_count: 4,
    });
    assert.equal(
      response.body.summary.micronutrients.iron_mg.known_total,
      0,
    );
  });

  test("nutrition report validates its cap and clips current and future weeks", async () => {
    await queryInSchema("DELETE FROM meals");
    const app = createApp(config, {
      testAuthIdentity: LEGACY_AUTH,
      pool: schemaPool(),
      clock: () => new Date("2026-09-12T12:00:00Z"),
      logger: recordingLogger(),
    });
    const accepted = await request(app).get(
      "/api/v1/reports/nutrition?start_date=2024-01-01&end_date=2024-12-31",
    );
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.pagination.total_items, 366);
    for (const path of [
      "?start_date=2024-01-01&end_date=2025-01-01",
      "?start_date=2026-09-13&end_date=2026-09-12",
      "?meal_type=breakfast",
    ]) {
      assert.equal(
        (
          await request(app).get(
            "/api/v1/reports/nutrition" + path,
          )
        ).status,
        422,
      );
    }

    const clipped = await request(app).get(
      "/api/v1/reports/nutrition?start_date=2026-09-10&end_date=2026-09-15&group_by=week",
    );
    assert.equal(clipped.status, 200);
    assert.deepEqual(
      clipped.body.items.map((item: {
        period_start: string;
        period_end: string;
        covered_start: string;
        covered_end: string;
        calendar_day_count: number;
        elapsed_day_count: number;
        temporal_state: string;
      }) => ({
        period_start: item.period_start,
        period_end: item.period_end,
        covered_start: item.covered_start,
        covered_end: item.covered_end,
        calendar_day_count: item.calendar_day_count,
        elapsed_day_count: item.elapsed_day_count,
        temporal_state: item.temporal_state,
      })),
      [
        {
          period_start: "2026-09-07",
          period_end: "2026-09-13",
          covered_start: "2026-09-10",
          covered_end: "2026-09-13",
          calendar_day_count: 4,
          elapsed_day_count: 3,
          temporal_state: "current",
        },
        {
          period_start: "2026-09-14",
          period_end: "2026-09-20",
          covered_start: "2026-09-14",
          covered_end: "2026-09-15",
          calendar_day_count: 2,
          elapsed_day_count: 0,
          temporal_state: "future",
        },
      ],
    );
    assert.equal(
      clipped.body.items[1].goal_comparison.calories_kcal.actual,
      0,
    );
    assert.equal(
      clipped.body.items[1].goal_comparison.calories_kcal.target,
      null,
    );
  });

  test("report meal and goal reads stay on one synchronized snapshot", async () => {
    await queryInSchema("DELETE FROM meals");
    await queryInSchema(
      "UPDATE goals SET daily_calories_kcal = 2000 WHERE user_id = '00000000-0000-4000-8000-000000000001'",
    );
    let signalReached: () => void = () => {};
    let signalAllowed: () => void = () => {};
    const reached = new Promise<void>((resolve) => {
      signalReached = resolve;
    });
    const allowed = new Promise<void>((resolve) => {
      signalAllowed = resolve;
    });
    const isolatedPool = schemaPool();
    const service = createReportService({
      pool: isolatedPool,
      clock: () => new Date("2026-09-12T12:00:00Z"),
      repository: {
        findSingletonProfile,
        findSingletonGoals,
        async aggregateNutritionByDate(client, range) {
          signalReached();
          await allowed;
          return aggregateNutritionByDate(client, range, "00000000-0000-4000-8000-000000000001");
        },
      },
    });
    const reportPromise = service.getNutritionReport({
      start_date: "2026-09-12",
      end_date: "2026-09-12",
      group_by: "day",
      page: 1,
      page_size: 20,
    }, "00000000-0000-4000-8000-000000000001");
    await reached;
    await withTransaction(isolatedPool, async (client) => {
      await client.query(
        "UPDATE goals SET daily_calories_kcal = 1000 WHERE user_id = '00000000-0000-4000-8000-000000000001'",
      );
      await client.query(
        "INSERT INTO meals (user_id, food_name, meal_type, consumption_date, consumed_quantity, quantity_unit, calories_kcal, protein_g, carbs_g, fat_g, entry_source, is_estimate) VALUES ('00000000-0000-4000-8000-000000000001', 'Concurrent report meal','snacks','2026-09-12',1,'piece',500,0,0,0,'manual',false)",
      );
    });
    signalAllowed();
    const snapshot = await reportPromise;

    assert.equal(snapshot.goal_snapshot.daily_calories_kcal, 2000);
    assert.equal(snapshot.summary.entry_count, 0);
    assert.equal(snapshot.goal_comparison.calories_kcal.target, 2000);
    const after = await request(
      createApp(config, {
      testAuthIdentity: LEGACY_AUTH,
        pool: isolatedPool,
        clock: () => new Date("2026-09-12T12:00:00Z"),
        logger: recordingLogger(),
      }),
    ).get(
      "/api/v1/reports/nutrition?start_date=2026-09-12&end_date=2026-09-12",
    );
    assert.equal(after.body.goal_snapshot.daily_calories_kcal, 1000);
    assert.equal(after.body.summary.calories_kcal, 500);
  });
}
