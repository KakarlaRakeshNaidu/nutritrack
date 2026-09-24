import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { loadEnv } from "../config/env.js";
import type { ConnectionPool } from "../types.js";
import { createDatabasePool } from "./pool.js";
import { withTransaction } from "./transaction.js";

const LEGACY_ID = "00000000-0000-4000-8000-000000000001";

export async function assignLegacyOwner(pool: ConnectionPool, suppliedEmail: string): Promise<void> {
  const email = suppliedEmail.trim().toLowerCase();
  if (!email) throw new Error("A target account email is required.");

  await withTransaction(pool, async (client) => {
    const userResult = await client.query(
      "SELECT id FROM nutritrack_users WHERE email_normalized = $1 AND is_legacy = false FOR UPDATE",
      [email],
    );
    const userId = userResult.rows[0]?.id;
    if (typeof userId !== "string") throw new Error("The target login user does not exist.");

    const target = await client.query(`
      SELECT p.display_name, p.timezone,
        g.daily_calories_kcal, g.daily_protein_g, g.daily_carbs_g, g.daily_fat_g, g.target_weight_kg,
        (SELECT count(*) FROM meals WHERE user_id = $1) AS meal_count
      FROM tracker_profile p JOIN goals g ON g.user_id = p.user_id
      WHERE p.user_id = $1 FOR UPDATE
    `, [userId]);
    const row = target.rows[0];
    const defaultGoals = row && [
      "daily_calories_kcal",
      "daily_protein_g",
      "daily_carbs_g",
      "daily_fat_g",
      "target_weight_kg",
    ].every((key) => row[key] === null);
    const expectedName = email.split("@")[0].slice(0, 100) || "Personal user";
    if (
      !row ||
      row.display_name !== expectedName ||
      row.timezone !== "Asia/Kolkata" ||
      !defaultGoals ||
      Number(row.meal_count) !== 0
    ) {
      throw new Error("Target account contains profile, goal, or meal data; assignment refused.");
    }

    await client.query("DELETE FROM tracker_profile WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM goals WHERE user_id = $1", [userId]);
    await client.query("UPDATE tracker_profile SET user_id = $1 WHERE user_id = $2", [userId, LEGACY_ID]);
    await client.query("UPDATE goals SET user_id = $1 WHERE user_id = $2", [userId, LEGACY_ID]);
    await client.query("UPDATE meals SET user_id = $1 WHERE user_id = $2", [userId, LEGACY_ID]);
    await client.query("DELETE FROM nutritrack_users WHERE id = $1", [LEGACY_ID]);
  });
}

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) throw new Error("Usage: npm run db:assign-legacy -- user@example.com");
  const config = loadEnv();
  const pool = await createDatabasePool(config, { logger: console });
  try {
    await assignLegacyOwner(pool, email);
    console.log("Legacy data assigned transactionally.");
  } finally {
    await pool.end();
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Legacy assignment failed.");
    process.exitCode = 1;
  });
}
