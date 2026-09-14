import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExtractionResult,
  providerOutputSchema,
} from "../src/modules/nutrition/nutrition.schemas.js";

const micros = {
  sodium_mg: null,
  calcium_mg: 0,
  iron_mg: null,
  potassium_mg: null,
  vitamin_c_mg: null,
  vitamin_d_mcg: null,
};

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    status: "ok",
    food_name: "Test food",
    quantity: 100,
    quantity_unit: "g",
    calories_kcal: 0,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    micronutrients: micros,
    source_basis: "per 100 g",
    notes: [],
    ...overrides,
  };
}

test("provider schema is strict and preserves known zero separately from null", () => {
  assert.equal(providerOutputSchema.parse(candidate()).calories_kcal, 0);
  assert.throws(() => providerOutputSchema.parse(candidate({ extra: true })));
  assert.throws(() => providerOutputSchema.parse(candidate({ quantity: "100" })));
  assert.throws(() => providerOutputSchema.parse(candidate({ quantity: 0 })));
  assert.throws(() => providerOutputSchema.parse(candidate({ protein_g: -1 })));
  assert.throws(() => providerOutputSchema.parse(candidate({ carbs_g: 1.23456 })));
});

test("ok output requires at least one known core value, including zero", () => {
  assert.doesNotThrow(() => providerOutputSchema.parse(candidate()));
  assert.throws(() =>
    providerOutputSchema.parse(candidate({
      calories_kcal: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
    })),
  );
});

test("final result owns date/source metadata and derives deterministic missing fields", () => {
  const output = providerOutputSchema.parse(candidate({
    food_name: null,
    quantity: null,
    quantity_unit: null,
  }));
  const result = buildExtractionResult({
    provider: "gemini",
    imageType: "food_plate",
    output,
    today: "2026-09-14",
  });

  assert.equal(result.is_estimate, true);
  assert.equal(result.draft.entry_source, "food_plate");
  assert.equal(result.draft.consumption_date, "2026-09-14");
  assert.equal(result.draft.meal_type, null);
  assert.deepEqual(result.missing_fields, [
    "food_name",
    "meal_type",
    "consumed_quantity",
    "quantity_unit",
    "protein_g",
    "carbs_g",
    "fat_g",
  ]);
  assert(!result.missing_fields.includes("calories_kcal"));
  assert(!result.missing_fields.includes("micronutrients.sodium_mg"));
});
