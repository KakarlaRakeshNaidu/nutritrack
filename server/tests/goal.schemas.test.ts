import assert from "node:assert/strict";
import test from "node:test";

import { goalSchema } from "../src/modules/goals/goal.schemas.js";

function validGoals(overrides = {}) {
  return {
    daily_calories_kcal: 2200.125,
    daily_protein_g: 0,
    daily_carbs_g: 250.5,
    daily_fat_g: null,
    target_weight_kg: 72.3456,
    ...overrides,
  };
}

test("goal schema requires the complete strict five-field replacement shape", () => {
  assert.deepEqual(goalSchema.parse(validGoals()), validGoals());
  assert.equal(
    goalSchema.safeParse({
      ...validGoals(),
      daily_fat_g: undefined,
    }).success,
    false,
  );
  assert.equal(
    goalSchema.safeParse({
      ...validGoals(),
      id: 1,
    }).success,
    false,
  );
});

test("all-null goals and explicit zero macro goals remain distinct valid values", () => {
  const allNull = {
    daily_calories_kcal: null,
    daily_protein_g: null,
    daily_carbs_g: null,
    daily_fat_g: null,
    target_weight_kg: null,
  };
  assert.deepEqual(goalSchema.parse(allNull), allNull);
  assert.equal(goalSchema.parse(validGoals()).daily_protein_g, 0);
});

test("calorie and weight goals are positive while macro goals are nonnegative", () => {
  for (const field of ["daily_calories_kcal", "target_weight_kg"]) {
    assert.equal(goalSchema.safeParse(validGoals({ [field]: 0 })).success, false);
    assert.equal(goalSchema.safeParse(validGoals({ [field]: -1 })).success, false);
  }
  for (const field of ["daily_protein_g", "daily_carbs_g", "daily_fat_g"]) {
    assert.equal(goalSchema.safeParse(validGoals({ [field]: 0 })).success, true);
    assert.equal(goalSchema.safeParse(validGoals({ [field]: -1 })).success, false);
  }
});

test("goal numbers are finite, bounded, precise JSON numbers without coercion", () => {
  for (const invalid of [
    "2200",
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1_000_000.0001,
    1.00001,
  ]) {
    assert.equal(
      goalSchema.safeParse(validGoals({ daily_calories_kcal: invalid })).success,
      false,
    );
  }
  assert.equal(
    goalSchema.safeParse(validGoals({ daily_calories_kcal: 1_000_000 })).success,
    true,
  );
  assert.equal(
    goalSchema.safeParse(validGoals({ daily_calories_kcal: 0.0001 })).success,
    true,
  );
});
