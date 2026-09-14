import assert from "node:assert/strict";
import test from "node:test";

import {
  createMealSchema,
  mealIdParamSchema,
  mealListQuerySchema,
  updateMealSchema,
} from "../src/modules/meals/meal.schemas.js";

interface MutableMeal extends Record<string, unknown> {
  micronutrients: Record<string, unknown>;
}

function validMeal(
  overrides: Record<string, unknown> = {},
): MutableMeal {
  return {
    food_name: "Chef's dal \u2013 \u0918\u0930",
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

test("complete meal schemas preserve consumed totals, Unicode, zero, and null", () => {
  const input = validMeal({
    consumed_quantity: 1.0001,
    calories_kcal: 999999.9999,
  });

  assert.deepEqual(createMealSchema.parse(input), input);
  assert.deepEqual(updateMealSchema.parse(input), input);
  assert.equal(createMealSchema.parse(validMeal({ food_name: "  yogurt  " })).food_name, "yogurt");
});

test("every writable and micronutrient key is required", () => {
  for (const key of Object.keys(validMeal())) {
    const input = validMeal();
    delete input[key];
    assert.equal(createMealSchema.safeParse(input).success, false, key);
  }

  for (const key of Object.keys(validMeal().micronutrients)) {
    const input = validMeal();
    delete input.micronutrients[key];
    assert.equal(createMealSchema.safeParse(input).success, false, key);
  }
});

test("unknown, nested-extra, and server-owned fields are rejected", () => {
  for (const extra of ["id", "created_at", "updated_at", "owner_id"]) {
    assert.equal(
      createMealSchema.safeParse(validMeal({ [extra]: "forbidden" })).success,
      false,
      extra,
    );
  }

  const nested = validMeal();
  nested.micronutrients.extra = 1;
  assert.equal(createMealSchema.safeParse(nested).success, false);
});

test("numeric fields require finite JSON numbers within bounds and precision", () => {
  for (const value of ["1", true, null, Number.NaN, Infinity, -1, 1_000_000.0001]) {
    assert.equal(
      createMealSchema.safeParse(validMeal({ calories_kcal: value })).success,
      false,
      String(value),
    );
  }

  for (const value of [0, 1.0001, 0.0001, 1_000_000]) {
    assert.equal(
      createMealSchema.safeParse(validMeal({ calories_kcal: value })).success,
      true,
      String(value),
    );
  }

  assert.equal(
    createMealSchema.safeParse(validMeal({ calories_kcal: 1.00001 })).success,
    false,
  );
  assert.equal(
    createMealSchema.safeParse(validMeal({ consumed_quantity: 0 })).success,
    false,
  );
});

test("nullable micronutrients retain the same numeric rules", () => {
  for (const value of [null, 0, 1.0001, 1_000_000]) {
    const input = validMeal();
    input.micronutrients.iron_mg = value;
    assert.equal(createMealSchema.safeParse(input).success, true);
  }

  for (const value of ["0", false, -1, 1.00001, 1_000_000.0001]) {
    const input = validMeal();
    input.micronutrients.iron_mg = value;
    assert.equal(createMealSchema.safeParse(input).success, false);
  }
});

test("enums, boolean provenance, name limits, and food-plate estimates are strict", () => {
  for (const overrides of [
    { food_name: " " },
    { food_name: "x".repeat(201) },
    { meal_type: "brunch" },
    { quantity_unit: "kg" },
    { entry_source: "model" },
    { is_estimate: "true" },
    { entry_source: "food_plate", is_estimate: false },
  ]) {
    assert.equal(createMealSchema.safeParse(validMeal(overrides)).success, false);
  }

  assert.equal(
    createMealSchema.safeParse(
      validMeal({ entry_source: "food_plate", is_estimate: true }),
    ).success,
    true,
  );
});

test("meal dates and UUID params follow strict supported contracts", () => {
  for (const value of ["2024-02-29", "1900-01-01", "9999-12-31"]) {
    assert.equal(
      createMealSchema.safeParse(validMeal({ consumption_date: value })).success,
      true,
    );
  }
  for (const value of [
    "2025-02-29",
    "1899-12-31",
    "10000-01-01",
    "2026-09-12T00:00:00Z",
  ]) {
    assert.equal(
      createMealSchema.safeParse(validMeal({ consumption_date: value })).success,
      false,
    );
  }

  assert.equal(
    mealIdParamSchema.safeParse({
      id: "70a2071d-5cb8-4f15-b6f6-9ed632462bef",
    }).success,
    true,
  );
  assert.equal(mealIdParamSchema.safeParse({ id: "not-a-uuid" }).success, false);
});

test("list query defaults, normalizes leading zeros, and accepts inclusive bounds", () => {
  assert.deepEqual(mealListQuerySchema.parse({}), { page: 1, page_size: 20 });
  assert.deepEqual(
    mealListQuerySchema.parse({
      start_date: "2026-09-01",
      end_date: "2026-09-12",
      meal_type: "dinner",
      page: "0002",
      page_size: "010",
    }),
    {
      start_date: "2026-09-01",
      end_date: "2026-09-12",
      meal_type: "dinner",
      page: 2,
      page_size: 10,
    },
  );
  assert.equal(
    mealListQuerySchema.safeParse({ start_date: "2099-01-01" }).success,
    true,
  );
});

test("list query rejects malformed paging, repeated values, ranges, and keys", () => {
  for (const query of [
    { page: "0" },
    { page: "-1" },
    { page: "1.5" },
    { page: "1e2" },
    { page: "" },
    { page: ["1", "2"] },
    { page: "2147483648" },
    { page_size: "101" },
    { end_date: "2026-02-30" },
    { start_date: "2026-09-13", end_date: "2026-09-12" },
    { extra: "value" },
  ]) {
    assert.equal(mealListQuerySchema.safeParse(query).success, false);
  }

  assert.equal(
    mealListQuerySchema.parse({ page: "2147483647", page_size: "100" }).page,
    2_147_483_647,
  );
});
