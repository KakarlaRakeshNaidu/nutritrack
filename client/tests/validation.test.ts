import { describe, expect, it } from "vitest";

import {
  mealFormSchema,
  mealPayload,
  mealToFormValues,
} from "../src/validation/meals";
import {
  goalFormSchema,
  goalPayload,
  goalsToFormValues,
} from "../src/validation/goals";
import {
  historySearch,
  parseHistorySearch,
} from "../src/validation/history";

function mealForm(overrides = {}) {
  return {
    food_name: "  Test meal  ",
    meal_type: "lunch",
    consumption_date: "2026-09-12",
    consumed_quantity: "150",
    quantity_unit: "g",
    calories_kcal: "180",
    protein_g: "0",
    carbs_g: "27.125",
    fat_g: "3",
    micronutrients: {
      sodium_mg: "0",
      calcium_mg: "",
      iron_mg: "",
      potassium_mg: "",
      vitamin_c_mg: "",
      vitamin_d_mcg: "",
    },
    entry_source: "manual",
    is_estimate: false,
    ...overrides,
  };
}

describe("meal form contract", () => {
  it("turns blank micros into null while retaining explicit zero", () => {
    const parsed = mealFormSchema("2026-09-12").parse(mealForm());
    expect(parsed.food_name).toBe("Test meal");
    expect(parsed.protein_g).toBe(0);
    expect(parsed.micronutrients.sodium_mg).toBe(0);
    expect(parsed.micronutrients.calcium_mg).toBeNull();
  });

  it("rejects blank core nutrition, future/invalid dates, bounds, and precision", () => {
    for (const overrides of [
      { calories_kcal: "" },
      { calories_kcal: "1.00001" },
      { calories_kcal: "1000000.0001" },
      { consumed_quantity: "0" },
      { consumption_date: "2026-02-30" },
      { consumption_date: "2026-09-13" },
    ]) {
      expect(
        mealFormSchema("2026-09-12").safeParse(mealForm(overrides)).success,
      ).toBe(false);
    }
  });

  it("enforces plate estimate provenance and never rescales totals", () => {
    expect(
      mealFormSchema("2026-09-12").safeParse(
        mealForm({ entry_source: "food_plate", is_estimate: false }),
      ).success,
    ).toBe(false);

    const parsed = mealFormSchema("2026-09-12").parse(
      mealForm({ consumed_quantity: "300", calories_kcal: "180" }),
    );
    expect(mealPayload(parsed)).toMatchObject({
      consumed_quantity: 300,
      calories_kcal: 180,
    });
  });

  it("constructs complete writable payloads without server-owned fields", () => {
    const apiMeal = {
      id: "server-id",
      ...mealPayload(mealFormSchema("2026-09-12").parse(mealForm())),
      created_at: "2026-09-12T00:00:00.000Z",
      updated_at: "2026-09-12T01:00:00.000Z",
    };
    const parsed = mealFormSchema("2026-09-12").parse(
      mealToFormValues(apiMeal),
    );
    const payload = mealPayload(parsed);
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("created_at");
    expect(payload).not.toHaveProperty("updated_at");
    expect(Object.keys(payload.micronutrients)).toHaveLength(6);
  });
});

describe("goal and history contracts", () => {
  it("serializes blank goals as null and explicit zero macros as zero", () => {
    const parsed = goalFormSchema.parse({
      daily_calories_kcal: "",
      daily_protein_g: "0",
      daily_carbs_g: "",
      daily_fat_g: "",
      target_weight_kg: "",
    });
    expect(goalPayload(parsed)).toEqual({
      daily_calories_kcal: null,
      daily_protein_g: 0,
      daily_carbs_g: null,
      daily_fat_g: null,
      target_weight_kg: null,
    });
  });

  it("rejects zero calories/weight, excess precision, and strings outside bounds", () => {
    const base = goalsToFormValues({
      daily_calories_kcal: null,
      daily_protein_g: null,
      daily_carbs_g: null,
      daily_fat_g: null,
      target_weight_kg: null,
    });
    for (const override of [
      { daily_calories_kcal: "0" },
      { target_weight_kg: "0" },
      { daily_fat_g: "1.00001" },
      { daily_carbs_g: "1000001" },
    ]) {
      expect(goalFormSchema.safeParse({ ...base, ...override }).success).toBe(
        false,
      );
    }
  });

  it("strictly restores supported URL filters and paging", () => {
    const valid = parseHistorySearch(
      new URLSearchParams(
        "start_date=2026-09-01&meal_type=lunch&page=2&page_size=20",
      ),
    );
    expect(valid.value).toEqual({
      start_date: "2026-09-01",
      end_date: undefined,
      meal_type: "lunch",
      page: 2,
      page_size: 20,
    });
    expect(
      historySearch({ ...valid.value, page: 1 }).toString(),
    ).toBe("start_date=2026-09-01&meal_type=lunch");
    for (const value of [
      "start_date=2026-09-12&end_date=2026-09-11",
      "page=0",
      "page_size=101",
      "page=1&page=2",
      "owner=1",
    ]) {
      expect(parseHistorySearch(new URLSearchParams(value)).error).toBeTruthy();
    }
  });
});
