import { randomUUID } from "node:crypto";

import { discoverMigrations, quoteInternalIdentifier, runMigrations } from "../src/db/migration-runner.js";
import { createDatabasePool } from "../src/db/pool.js";
import type { ChatPlanner } from "../src/modules/chat/chat.gemini.js";
import { startServer } from "../src/server.js";
import type { DatabasePool } from "../src/types.js";
import { recordingLogger } from "../support/testing.js";
import { loadDatabaseTestConfig } from "../tests-db/database-test-config.js";

const schema = "nutritrack_chat_browser_" + randomUUID().replaceAll("-", "").slice(0, 16);
const quoted = quoteInternalIdentifier(schema);
const baseConfig = await loadDatabaseTestConfig();
const basePool = await createDatabasePool(baseConfig, { logger: recordingLogger() });
let owned = false;
let closed = false;

const pool: DatabasePool = {
  async connect() {
    const client = await basePool.connect();
    await client.query("SELECT set_config('search_path', $1, false)", [quoted]);
    return client;
  },
  async query(query, values) {
    const client = await this.connect();
    try { return await client.query(query, values); } finally { client.release(); }
  },
  async end() {
    if (closed) return;
    closed = true;
    try {
      if (owned) await basePool.query("DROP SCHEMA " + quoted + " CASCADE");
    } finally {
      await basePool.end();
    }
    console.log("Chat browser schema removed.");
  },
};

const planner: ChatPlanner = {
  async plan({ message }) {
    const normalized = message.toLowerCase();
    if (normalized.includes("summary") || normalized.includes("calories")) {
      return {
        tool: "getNutritionReport",
        arguments_json: JSON.stringify({
          start_date: "2030-09-12",
          end_date: "2030-09-12",
          group_by: "day",
          page: 1,
          page_size: 20,
        }),
        assistant_message: "Reading your report.",
      };
    }
    if (normalized.includes("delete")) {
      return {
        tool: "proposeMealDelete",
        arguments_json: JSON.stringify({
          match: {
            food_name: "Browser rice",
            consumption_date: "2030-09-12",
            meal_type: "lunch",
          },
        }),
        assistant_message: "Preparing a deletion review.",
      };
    }
    return {
      tool: "proposeMealCreate",
      arguments_json: JSON.stringify({
        food_name: "Browser rice",
        meal_type: "lunch",
        consumption_date: "2030-09-12",
        consumed_quantity: 150,
        quantity_unit: "g",
        calories_kcal: 195,
        protein_g: 4,
        carbs_g: 42,
        fat_g: 0.5,
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
      }),
      assistant_message: "Preparing a meal review.",
    };
  },
};

try {
  await basePool.query("CREATE SCHEMA " + quoted);
  owned = true;
  const migrations = await discoverMigrations(new URL("../migrations/", import.meta.url));
  await runMigrations({ pool, migrations, schema, logger: recordingLogger() });
  await startServer(
    {
      ...baseConfig,
      NODE_ENV: "development",
      PORT: 3550,
      CLIENT_ORIGIN: "http://localhost:5175",
    },
    {
      createPool: async () => pool,
      logger: console,
      clock: () => new Date("2030-09-12T10:00:00.000Z"),
      chatPlanner: planner,
    },
  );
  console.log("Chat browser backend ready on port 3550.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Chat browser setup failed.");
  await pool.end();
  process.exitCode = 1;
}
