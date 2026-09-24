import type { DatabaseExecutor } from "../../types.js";
import { numericValue, timestampValue } from "../../db/values.js";
import type { GoalInput } from "./goal.schemas.js";

export interface Goal extends GoalInput {
  updated_at: string;
}

type GoalRow = Record<string, unknown>;

const GOAL_COLUMNS = [
  "daily_calories_kcal",
  "daily_protein_g",
  "daily_carbs_g",
  "daily_fat_g",
  "target_weight_kg",
  "updated_at",
].join(", ");

export function mapGoalRow(row: GoalRow | null | undefined): Goal | null {
  if (!row) {
    return null;
  }

  return {
    daily_calories_kcal: numericValue(
      row.daily_calories_kcal,
      "Persisted daily calorie goal",
    ),
    daily_protein_g: numericValue(
      row.daily_protein_g,
      "Persisted daily protein goal",
    ),
    daily_carbs_g: numericValue(
      row.daily_carbs_g,
      "Persisted daily carbohydrate goal",
    ),
    daily_fat_g: numericValue(
      row.daily_fat_g,
      "Persisted daily fat goal",
    ),
    target_weight_kg: numericValue(
      row.target_weight_kg,
      "Persisted target weight",
    ),
    updated_at: timestampValue(row.updated_at, "Persisted goal updated_at"),
  };
}

export async function findSingletonGoals(executor: DatabaseExecutor, userId: string): Promise<Goal | null> {
  const result = await executor.query({
    text: "SELECT " + GOAL_COLUMNS + " FROM goals WHERE user_id = $1",
    values: [userId],
  });

  return mapGoalRow(result.rows[0]);
}

export async function replaceSingletonGoals(
  executor: DatabaseExecutor,
  goals: GoalInput,
  userId: string,
): Promise<Goal | null> {
  const values = [
    goals.daily_calories_kcal,
    goals.daily_protein_g,
    goals.daily_carbs_g,
    goals.daily_fat_g,
    goals.target_weight_kg,
    userId,
  ];
  const result = await executor.query({
    text:
      "UPDATE goals SET daily_calories_kcal = $1, daily_protein_g = $2, " +
      "daily_carbs_g = $3, daily_fat_g = $4, target_weight_kg = $5, " +
      "updated_at = now() WHERE user_id = $6 RETURNING " +
      GOAL_COLUMNS,
    values,
  });

  return mapGoalRow(result.rows[0]);
}
