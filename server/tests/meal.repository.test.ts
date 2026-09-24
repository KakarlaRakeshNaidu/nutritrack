import assert from "node:assert/strict";
import test from "node:test";
import type { QueryConfig } from "pg";
import type { MealInput } from "../src/modules/meals/meal.schemas.js";

import {
  countMeals,
  createMealFilter,
  deleteMealById,
  findMealById,
  findMealsPage,
  insertMeal,
  mapMealRow,
  replaceMeal,
} from "../src/modules/meals/meal.repository.js";

const ID = "70a2071d-5cb8-4f15-b6f6-9ed632462bef";
const CREATED_AT = new Date("2026-09-12T10:00:00Z");

function mealInput(overrides: Partial<MealInput> = {}): MealInput {
  return {
    food_name: "O'Brien'); DROP TABLE meals; --",
    meal_type: "lunch",
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

function databaseRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: ID,
    ...mealInput(),
    sodium_mg: "0.0000",
    calcium_mg: "120.0000",
    iron_mg: null,
    potassium_mg: null,
    vitamin_c_mg: null,
    vitamin_d_mcg: null,
    consumed_quantity: "150.0000",
    calories_kcal: "180.0000",
    protein_g: "9.0000",
    carbs_g: "27.0000",
    fat_g: "3.0000",
    micronutrients: undefined,
    created_at: CREATED_AT,
    updated_at: new Date("2026-09-12T11:00:00Z"),
    ...overrides,
  };
}

test("meal row mapping explicitly nests micros and preserves null, zero, dates, and UTC timestamps", () => {
  assert.deepEqual(mapMealRow(databaseRow()), {
    id: ID,
    ...mealInput(),
    created_at: "2026-09-12T10:00:00.000Z",
    updated_at: "2026-09-12T11:00:00.000Z",
  });
  assert.equal(mapMealRow(null), null);
  assert.throws(
    () => mapMealRow(databaseRow({ sodium_mg: "not-numeric" })),
    /finite/,
  );
});

test("insert parameterizes every submitted value without rescaling totals", async () => {
  let call: QueryConfig<unknown[]> | undefined;
  const executor = {
    async query(query: string | QueryConfig<unknown[]>) {
      assert.notEqual(typeof query, "string");
      call = query as QueryConfig<unknown[]>;
      return { rows: [databaseRow()] };
    },
  };
  const input = mealInput();
  const result = await insertMeal(executor, input, "00000000-0000-4000-8000-000000000099");

  assert.equal(result.calories_kcal, 180);
  assert(call);
  assert(call.values);
  assert.equal(call.values[0], "00000000-0000-4000-8000-000000000099");
  assert.equal(call.values[1], input.food_name);
  assert.equal(call.values[4], 150);
  assert.equal(call.values[6], 180);
  assert.equal(call.text.includes(input.food_name), false);
  assert.match(call.text, /VALUES \(\$1, \$2/);
});

test("find, full replacement, and delete use one atomic parameterized statement", async () => {
  const calls: QueryConfig<unknown[]>[] = [];
  const executor = {
    async query(query: string | QueryConfig<unknown[]>) {
      assert.notEqual(typeof query, "string");
      const queryConfig = query as QueryConfig<unknown[]>;
      calls.push(queryConfig);
      if (queryConfig.text.startsWith("DELETE")) {
        return { rowCount: calls.length === 3 ? 1 : 0, rows: [{ id: ID }] };
      }
      return { rowCount: 1, rows: [databaseRow()] };
    },
  };

  await findMealById(executor, ID, "00000000-0000-4000-8000-000000000099");
  await replaceMeal(executor, ID, mealInput({ consumed_quantity: 300 }), "00000000-0000-4000-8000-000000000099");
  assert.equal(await deleteMealById(executor, ID, "00000000-0000-4000-8000-000000000099"), true);
  assert.equal(await deleteMealById(executor, ID, "00000000-0000-4000-8000-000000000099"), false);

  assert(calls[0].values);
  assert(calls[1].values);
  assert.deepEqual(calls[0].values, [ID, "00000000-0000-4000-8000-000000000099"]);
  assert.match(calls[1].text, /updated_at = now\(\).*WHERE id = \$18/);
  assert.equal(calls[1].values[3], 300);
  assert.equal(calls[1].values[5], 180);
  assert.equal(calls[1].values[17], ID);
  assert.equal(calls[1].values[18], "00000000-0000-4000-8000-000000000099");
  assert.match(calls[2].text, /DELETE FROM meals WHERE id = \$1 AND user_id = \$2 RETURNING id/);
});

test("one parameterized filter sequence drives count and deterministic page SQL", async () => {
  const calls: QueryConfig<unknown[]>[] = [];
  const executor = {
    async query(query: string | QueryConfig<unknown[]>) {
      assert.notEqual(typeof query, "string");
      const queryConfig = query as QueryConfig<unknown[]>;
      calls.push(queryConfig);
      if (queryConfig.text.startsWith("SELECT count")) {
        return { rows: [{ total_items: "25" }] };
      }
      return { rows: [databaseRow()] };
    },
  };
  const filter = createMealFilter({
    start_date: "2026-09-01",
    end_date: "2026-09-12",
    meal_type: "dinner",
  }, "00000000-0000-4000-8000-000000000099");

  assert.equal(await countMeals(executor, filter), "25");
  const rows = await findMealsPage(executor, filter, {
    pageSize: 10,
    offset: 20,
  });

  assert.equal(rows.length, 1);
  assert.equal(
    filter.clause,
    "WHERE user_id = $1 AND consumption_date >= $2 AND consumption_date <= $3 AND meal_type = $4",
  );
  assert(calls[0].values);
  assert(calls[1].values);
  assert.deepEqual(calls[0].values, [
    "00000000-0000-4000-8000-000000000099",
    "2026-09-01",
    "2026-09-12",
    "dinner",
  ]);
  assert.deepEqual(calls[1].values, [
    "00000000-0000-4000-8000-000000000099",
    "2026-09-01",
    "2026-09-12",
    "dinner",
    10,
    20,
  ]);
  assert.match(
    calls[1].text,
    /ORDER BY consumption_date DESC, created_at DESC, id DESC LIMIT \$5 OFFSET \$6/,
  );
});
