import type { DatabaseExecutor } from "../../types.js";
import type { ReportAggregateRow } from "./report.calculations.js";

export async function aggregateNutritionByDate(
  executor: DatabaseExecutor,
  { startDate, endDate }: { startDate: string; endDate: string },
): Promise<ReportAggregateRow[]> {
  // History pagination is intentionally absent: PostgreSQL aggregates every
  // matching persisted meal before the service paginates calendar buckets.
  const result = await executor.query({
    text: `
      SELECT
        consumption_date,
        count(*) AS entry_count,
        sum(calories_kcal) AS calories_kcal,
        sum(protein_g) AS protein_g,
        sum(carbs_g) AS carbs_g,
        sum(fat_g) AS fat_g,
        sum(sodium_mg) AS sodium_mg_known_total,
        count(sodium_mg) AS sodium_mg_known_count,
        sum(calcium_mg) AS calcium_mg_known_total,
        count(calcium_mg) AS calcium_mg_known_count,
        sum(iron_mg) AS iron_mg_known_total,
        count(iron_mg) AS iron_mg_known_count,
        sum(potassium_mg) AS potassium_mg_known_total,
        count(potassium_mg) AS potassium_mg_known_count,
        sum(vitamin_c_mg) AS vitamin_c_mg_known_total,
        count(vitamin_c_mg) AS vitamin_c_mg_known_count,
        sum(vitamin_d_mcg) AS vitamin_d_mcg_known_total,
        count(vitamin_d_mcg) AS vitamin_d_mcg_known_count
      FROM meals
      WHERE consumption_date >= $1 AND consumption_date <= $2
      GROUP BY consumption_date
      ORDER BY consumption_date ASC
    `,
    values: [startDate, endDate],
  });

  // SUM plus non-null COUNT preserves the distinction between an all-unknown
  // nutrient and a known total of zero. Raw NUMERIC strings remain exact here.
  for (const row of result.rows) {
    if (typeof row.consumption_date !== "string") {
      throw new TypeError("Persisted aggregate date must be text.");
    }
  }

  return result.rows as ReportAggregateRow[];
}
