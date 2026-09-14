import type { DatabaseExecutor } from "../../types.js";
import type { MealInput, MealListQuery } from "./meal.schemas.js";
import { numericValue, timestampValue } from "../../db/values.js";

export interface Meal extends MealInput {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface MealFilter {
  clause: string;
  values: readonly unknown[];
}
type MealFilterInput = Pick<
  MealListQuery,
  "start_date" | "end_date" | "meal_type"
>;


function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(label + " must be text.");
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(label + " must be boolean.");
  }
  return value;
}

function requiredNumericValue(value: unknown, label: string): number {
  const result = numericValue(value, label);
  if (result === null) {
    throw new TypeError(label + " must not be null.");
  }
  return result;
}

const MEAL_COLUMNS = [
  "id",
  "food_name",
  "meal_type",
  "consumption_date",
  "consumed_quantity",
  "quantity_unit",
  "calories_kcal",
  "protein_g",
  "carbs_g",
  "fat_g",
  "sodium_mg",
  "calcium_mg",
  "iron_mg",
  "potassium_mg",
  "vitamin_c_mg",
  "vitamin_d_mcg",
  "entry_source",
  "is_estimate",
  "created_at",
  "updated_at",
].join(", ");

const WRITABLE_COLUMNS = [
  "food_name",
  "meal_type",
  "consumption_date",
  "consumed_quantity",
  "quantity_unit",
  "calories_kcal",
  "protein_g",
  "carbs_g",
  "fat_g",
  "sodium_mg",
  "calcium_mg",
  "iron_mg",
  "potassium_mg",
  "vitamin_c_mg",
  "vitamin_d_mcg",
  "entry_source",
  "is_estimate",
];


export function mapMealRow(
  row: Record<string, unknown> | null | undefined,
): Meal | null {
  if (!row) {
    return null;
  }

  // PostgreSQL NUMERIC is returned as text for precision. The API contract has
  // bounded finite numbers, while nullable micronutrients must remain NULL.
  return {
    id: stringValue(row.id, "Persisted meal id"),
    food_name: stringValue(row.food_name, "Persisted meal food name"),
    meal_type: stringValue(row.meal_type, "Persisted meal type") as Meal["meal_type"],
    consumption_date: stringValue(row.consumption_date, "Persisted consumption date"),
    consumed_quantity: requiredNumericValue(row.consumed_quantity, "Persisted quantity"),
    quantity_unit: stringValue(row.quantity_unit, "Persisted quantity unit") as Meal["quantity_unit"],
    calories_kcal: requiredNumericValue(row.calories_kcal, "Persisted calories"),
    protein_g: requiredNumericValue(row.protein_g, "Persisted protein"),
    carbs_g: requiredNumericValue(row.carbs_g, "Persisted carbohydrates"),
    fat_g: requiredNumericValue(row.fat_g, "Persisted fat"),
    micronutrients: {
      sodium_mg: numericValue(row.sodium_mg),
      calcium_mg: numericValue(row.calcium_mg),
      iron_mg: numericValue(row.iron_mg),
      potassium_mg: numericValue(row.potassium_mg),
      vitamin_c_mg: numericValue(row.vitamin_c_mg),
      vitamin_d_mcg: numericValue(row.vitamin_d_mcg),
    },
    entry_source: stringValue(
      row.entry_source,
      "Persisted entry source",
    ) as Meal["entry_source"],
    is_estimate: booleanValue(row.is_estimate, "Persisted estimate flag"),
    created_at: timestampValue(
      row.created_at,
      "Persisted meal created_at",
    ),
    updated_at: timestampValue(
      row.updated_at,
      "Persisted meal updated_at",
    ),
  };
}
function requiredMealRow(row: Record<string, unknown> | undefined): Meal {
  const meal = mapMealRow(row);
  if (!meal) {
    throw new TypeError("Persisted meal row is required.");
  }
  return meal;
}


function writableValues(meal: MealInput): unknown[] {
  // Nutrition values are already totals for the consumed amount. Persistence
  // stores them exactly as submitted and never rescales them by quantity.
  return [
    meal.food_name,
    meal.meal_type,
    meal.consumption_date,
    meal.consumed_quantity,
    meal.quantity_unit,
    meal.calories_kcal,
    meal.protein_g,
    meal.carbs_g,
    meal.fat_g,
    meal.micronutrients.sodium_mg,
    meal.micronutrients.calcium_mg,
    meal.micronutrients.iron_mg,
    meal.micronutrients.potassium_mg,
    meal.micronutrients.vitamin_c_mg,
    meal.micronutrients.vitamin_d_mcg,
    meal.entry_source,
    meal.is_estimate,
  ];
}

export async function insertMeal(
  executor: DatabaseExecutor,
  meal: MealInput,
): Promise<Meal> {
  const placeholders = WRITABLE_COLUMNS.map(
    (_column, index) => "$" + (index + 1),
  ).join(", ");
  const result = await executor.query({
    text:
      "INSERT INTO meals (" +
      WRITABLE_COLUMNS.join(", ") +
      ") VALUES (" +
      placeholders +
      ") RETURNING " +
      MEAL_COLUMNS,
    values: writableValues(meal),
  });

  return requiredMealRow(result.rows[0]);
}

export async function findMealById(
  executor: DatabaseExecutor,
  id: string,
): Promise<Meal | null> {
  const result = await executor.query({
    text: "SELECT " + MEAL_COLUMNS + " FROM meals WHERE id = $1",
    values: [id],
  });

  return mapMealRow(result.rows[0]);
}

export async function replaceMeal(
  executor: DatabaseExecutor,
  id: string,
  meal: MealInput,
): Promise<Meal | null> {
  const assignments = WRITABLE_COLUMNS.map(
    (column, index) => column + " = $" + (index + 1),
  ).join(", ");
  const values = [...writableValues(meal), id];
  const result = await executor.query({
    text:
      "UPDATE meals SET " +
      assignments +
      ", updated_at = now() WHERE id = $" +
      values.length +
      " RETURNING " +
      MEAL_COLUMNS,
    values,
  });

  return mapMealRow(result.rows[0]);
}

export async function deleteMealById(
  executor: DatabaseExecutor,
  id: string,
): Promise<boolean> {
  const result = await executor.query({
    text: "DELETE FROM meals WHERE id = $1 RETURNING id",
    values: [id],
  });

  return result.rowCount === 1;
}

export function createMealFilter(
  { start_date, end_date, meal_type }: MealFilterInput,
): MealFilter {
  const clauses: string[] = [];
  const values: unknown[] = [];

  function addFilter(column: string, operator: string, value: unknown): void {
    if (value === undefined) {
      return;
    }
    values.push(value);
    clauses.push(column + " " + operator + " $" + values.length);
  }

  addFilter("consumption_date", ">=", start_date);
  addFilter("consumption_date", "<=", end_date);
  addFilter("meal_type", "=", meal_type);

  // Count and page queries receive this same immutable clause/value sequence,
  // ensuring filters cannot drift between metadata and returned rows.
  return Object.freeze({
    clause: clauses.length > 0 ? "WHERE " + clauses.join(" AND ") : "",
    values: Object.freeze(values),
  });
}

export async function countMeals(
  executor: DatabaseExecutor,
  filter: MealFilter,
): Promise<unknown> {
  const result = await executor.query({
    text: "SELECT count(*) AS total_items FROM meals " + filter.clause,
    values: [...filter.values],
  });

  return result.rows[0]?.total_items;
}

export async function findMealsPage(
  executor: DatabaseExecutor,
  filter: MealFilter,
  { pageSize, offset }: { pageSize: number; offset: number },
): Promise<Meal[]> {
  const limitPosition = filter.values.length + 1;
  const offsetPosition = limitPosition + 1;
  const result = await executor.query({
    text:
      "SELECT " +
      MEAL_COLUMNS +
      " FROM meals " +
      filter.clause +
      " ORDER BY consumption_date DESC, created_at DESC, id DESC" +
      " LIMIT $" +
      limitPosition +
      " OFFSET $" +
      offsetPosition,
    values: [...filter.values, pageSize, offset],
  });

  return result.rows.map(requiredMealRow);
}
