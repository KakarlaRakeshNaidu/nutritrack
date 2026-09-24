import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { discoverMigrations, quoteInternalIdentifier, runMigrations } from "../src/db/migration-runner.js";
import { assignLegacyOwner } from "../src/db/assign-legacy-owner.js";
import { createDatabasePool } from "../src/db/pool.js";
import { insertMeal, findMealById, countMeals, createMealFilter } from "../src/modules/meals/meal.repository.js";
import { findSingletonGoals, replaceSingletonGoals } from "../src/modules/goals/goal.repository.js";
import { aggregateNutritionByDate } from "../src/modules/reports/report.repository.js";
import { recordingLogger } from "../support/testing.js";
import { loadDatabaseTestConfig } from "./database-test-config.js";
import type { DatabasePool } from "../src/types.js";

const LEGACY_ID = "00000000-0000-4000-8000-000000000001";

test("forward migration preserves legacy data and enforces private user ownership", async () => {
  const config = await loadDatabaseTestConfig();
  const pool = await createDatabasePool(config, { logger: recordingLogger() });
  const schema = "nutritrack_auth_" + randomUUID().replaceAll("-", "").slice(0, 16);
  const quoted = quoteInternalIdentifier(schema);
  let owned = false;

  function schemaPool(): DatabasePool {
    return {
      async connect() {
        const client = await pool.connect();
        await client.query("SELECT set_config('search_path', $1, false)", [quoted]);
        return client;
      },
      async query(query, values) {
        const client = await this.connect();
        try { return await client.query(query, values); } finally { client.release(); }
      },
      async end() {},
    };
  }

  try {
    await pool.query("CREATE SCHEMA " + quoted);
    owned = true;
    const isolated = schemaPool();
    const migrations = await discoverMigrations(new URL("../migrations/", import.meta.url));
    const phaseOne = await runMigrations({
      pool: isolated,
      migrations: migrations.filter((migration) => migration.version === 1),
      schema,
      logger: recordingLogger(),
    });
    assert.equal(phaseOne.appliedCount, 1);
    await isolated.query(`
      INSERT INTO meals (
        food_name, meal_type, consumption_date, consumed_quantity, quantity_unit,
        calories_kcal, protein_g, carbs_g, fat_g, sodium_mg, entry_source, is_estimate
      ) VALUES ('Preserved legacy meal', 'dinner', DATE '2026-09-11', 1, 'serving',
        400, 20, 40, 12, 500, 'manual', false)
    `);
    const phaseTwo = await runMigrations({ pool: isolated, migrations, schema, logger: recordingLogger() });
    const repeat = await runMigrations({ pool: isolated, migrations, schema, logger: recordingLogger() });
    assert.equal(phaseTwo.appliedCount, 1);
    assert.equal(repeat.appliedCount, 0);

    const legacy = await isolated.query("SELECT user_id FROM tracker_profile");
    assert.deepEqual(legacy.rows, [{ user_id: LEGACY_ID }]);
    assert.equal((await isolated.query("SELECT count(*) AS count FROM meals WHERE user_id = $1", [LEGACY_ID])).rows[0].count, "1");

    const userA = randomUUID();
    const userB = randomUUID();
    for (const [id, email] of [[userA, "a@example.com"], [userB, "b@example.com"]]) {
      await isolated.query("INSERT INTO nutritrack_users (id, email_normalized, password_hash) VALUES ($1, $2, $3)", [id, email, "scrypt$test"]);
      await isolated.query("INSERT INTO tracker_profile (user_id, display_name, timezone) VALUES ($1, $2, 'UTC')", [id, email]);
      await isolated.query("INSERT INTO goals (user_id) VALUES ($1)", [id]);
    }

    const meal = {
      food_name: "Private meal",
      meal_type: "lunch" as const,
      consumption_date: "2026-09-12",
      consumed_quantity: 1,
      quantity_unit: "serving" as const,
      calories_kcal: 250,
      protein_g: 10,
      carbs_g: 30,
      fat_g: 8,
      micronutrients: {
        sodium_mg: null, calcium_mg: null, iron_mg: null,
        potassium_mg: null, vitamin_c_mg: null, vitamin_d_mcg: null,
      },
      entry_source: "manual" as const,
      is_estimate: false,
    };
    const created = await insertMeal(isolated, meal, userA);
    assert.equal((await findMealById(isolated, created.id, userB)), null);
    assert.equal(await countMeals(isolated, createMealFilter({}, userA)), "1");
    assert.equal(await countMeals(isolated, createMealFilter({}, userB)), "0");

    await replaceSingletonGoals(isolated, {
      daily_calories_kcal: 2000,
      daily_protein_g: null,
      daily_carbs_g: null,
      daily_fat_g: null,
      target_weight_kg: null,
    }, userA);
    assert.equal((await findSingletonGoals(isolated, userA))?.daily_calories_kcal, 2000);
    assert.equal((await findSingletonGoals(isolated, userB))?.daily_calories_kcal, null);

    const reportA = await aggregateNutritionByDate(isolated, { startDate: "2026-09-12", endDate: "2026-09-12" }, userA);
    const reportB = await aggregateNutritionByDate(isolated, { startDate: "2026-09-12", endDate: "2026-09-12" }, userB);
    assert.equal(reportA.length, 1);
    assert.equal(reportB.length, 0);

    const conflictUser = randomUUID();
    const targetUser = randomUUID();
    for (const [id, email] of [
      [conflictUser, "legacy-conflict@example.com"],
      [targetUser, "legacy-target@example.com"],
    ]) {
      await isolated.query(
        "INSERT INTO nutritrack_users (id, email_normalized, password_hash) VALUES ($1, $2, $3)",
        [id, email, "scrypt$test"],
      );
      await isolated.query(
        "INSERT INTO tracker_profile (user_id, display_name, timezone) VALUES ($1, $2, 'Asia/Kolkata')",
        [id, email.split("@")[0]],
      );
      await isolated.query("INSERT INTO goals (user_id) VALUES ($1)", [id]);
    }
    await isolated.query("UPDATE goals SET daily_calories_kcal = 1 WHERE user_id = $1", [conflictUser]);
    await assert.rejects(
      assignLegacyOwner(isolated, "legacy-conflict@example.com"),
      /assignment refused/,
    );
    assert.equal((await isolated.query("SELECT count(*) AS count FROM nutritrack_users WHERE id = $1", [LEGACY_ID])).rows[0].count, "1");

    await assignLegacyOwner(isolated, " LEGACY-TARGET@example.com ");
    assert.equal((await isolated.query("SELECT count(*) AS count FROM nutritrack_users WHERE id = $1", [LEGACY_ID])).rows[0].count, "0");
    const assignedMeal = await isolated.query(
      "SELECT food_name, user_id FROM meals WHERE food_name = 'Preserved legacy meal'",
    );
    assert.deepEqual(assignedMeal.rows, [{ food_name: "Preserved legacy meal", user_id: targetUser }]);
    const assignedProfile = await isolated.query(
      "SELECT display_name, timezone FROM tracker_profile WHERE user_id = $1",
      [targetUser],
    );
    assert.deepEqual(assignedProfile.rows, [{ display_name: "Personal user", timezone: "Asia/Kolkata" }]);
  } finally {
    if (owned) await pool.query("DROP SCHEMA " + quoted + " CASCADE");
    await pool.end();
  }
});
