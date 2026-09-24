import type { DatabaseExecutor } from "../../types.js";

export async function findSingletonProfile(
  pool: DatabaseExecutor,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const result = await pool.query({
    name: "profile-read-by-user",
    text: `
      SELECT display_name, timezone
      FROM tracker_profile
      WHERE user_id = $1
    `,
    values: [userId],
  });

  return result.rowCount === 0 ? null : result.rows[0];
}

export async function updateProfileDisplayName(
  pool: DatabaseExecutor,
  userId: string,
  displayName: string,
): Promise<Record<string, unknown> | null> {
  const result = await pool.query({
    name: "profile-display-name-update-by-user",
    text: `
      UPDATE tracker_profile
      SET display_name = $2
      WHERE user_id = $1
      RETURNING display_name, timezone
    `,
    values: [userId, displayName],
  });

  return result.rowCount === 0 ? null : result.rows[0];
}
