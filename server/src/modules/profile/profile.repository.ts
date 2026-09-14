import type { DatabaseExecutor } from "../../types.js";

export async function findSingletonProfile(
  pool: DatabaseExecutor,
): Promise<Record<string, unknown> | null> {
  const result = await pool.query({
    name: "profile-read-singleton",
    text: `
      SELECT display_name, timezone
      FROM tracker_profile
      WHERE id = $1
    `,
    values: [1],
  });

  if (result.rowCount === 0) {
    return null;
  }

  return result.rows[0];
}
