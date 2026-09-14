import type { Meal, MealPayload } from "../types";
import { z } from "zod";

import { isValidDateOnly } from "../utils/dates";
import {
  ENTRY_SOURCES,
  MEAL_TYPES,
  QUANTITY_UNITS,
} from "../utils/nutrition";
import { numericInput } from "./numbers";

const mealTypeValues = MEAL_TYPES.map(({ value }) => value);
const quantityUnitValues = QUANTITY_UNITS.map(({ value }) => value);
const entrySourceValues = ENTRY_SOURCES.map(({ value }) => value);

export function mealFormSchema(today: string) {
  return z
    .strictObject({
      food_name: z
        .string()
        .trim()
        .min(1, "Food name is required.")
        .max(200, "Food name must be 200 characters or fewer."),
      meal_type: z.enum(mealTypeValues),
      consumption_date: z
        .string()
        .refine(isValidDateOnly, "Enter a real date in YYYY-MM-DD format.")
        .refine(
          (value) => !today || !isValidDateOnly(value) || value <= today,
          "Consumption date cannot be after today.",
        ),
      consumed_quantity: numericInput({
        label: "Consumed quantity",
        positive: true,
      }),
      quantity_unit: z.enum(quantityUnitValues),
      calories_kcal: numericInput({ label: "Calories" }),
      protein_g: numericInput({ label: "Protein" }),
      carbs_g: numericInput({ label: "Carbohydrates" }),
      fat_g: numericInput({ label: "Fat" }),
      micronutrients: z.strictObject({
        sodium_mg: numericInput({ label: "Sodium", nullable: true }),
        calcium_mg: numericInput({ label: "Calcium", nullable: true }),
        iron_mg: numericInput({ label: "Iron", nullable: true }),
        potassium_mg: numericInput({ label: "Potassium", nullable: true }),
        vitamin_c_mg: numericInput({ label: "Vitamin C", nullable: true }),
        vitamin_d_mcg: numericInput({ label: "Vitamin D", nullable: true }),
      }),
      entry_source: z.enum(entrySourceValues),
      is_estimate: z.boolean(),
    })
    .superRefine((meal, context) => {
      if (meal.entry_source === "food_plate" && !meal.is_estimate) {
        context.addIssue({
          code: "custom",
          path: ["is_estimate"],
          message: "Food plate entries must remain marked as estimates.",
        });
      }
    });
}
export type MealFormSchema = ReturnType<typeof mealFormSchema>;
export type MealFormInput = z.input<MealFormSchema>;
export type MealFormOutput = z.output<MealFormSchema>;


export function emptyMealForm(today = ""): MealFormInput {
  return {
    food_name: "",
    meal_type: "breakfast",
    consumption_date: today,
    consumed_quantity: "",
    quantity_unit: "g",
    calories_kcal: "",
    protein_g: "",
    carbs_g: "",
    fat_g: "",
    micronutrients: {
      sodium_mg: "",
      calcium_mg: "",
      iron_mg: "",
      potassium_mg: "",
      vitamin_c_mg: "",
      vitamin_d_mcg: "",
    },
    entry_source: "manual",
    is_estimate: false,
  };
}

function formNumber(value: number | null): string {
  return value === null ? "" : String(value);
}

export function mealToFormValues(meal: Meal): MealFormInput {
  return {
    food_name: meal.food_name,
    meal_type: meal.meal_type,
    consumption_date: meal.consumption_date,
    consumed_quantity: formNumber(meal.consumed_quantity),
    quantity_unit: meal.quantity_unit,
    calories_kcal: formNumber(meal.calories_kcal),
    protein_g: formNumber(meal.protein_g),
    carbs_g: formNumber(meal.carbs_g),
    fat_g: formNumber(meal.fat_g),
    micronutrients: {
      sodium_mg: formNumber(meal.micronutrients.sodium_mg),
      calcium_mg: formNumber(meal.micronutrients.calcium_mg),
      iron_mg: formNumber(meal.micronutrients.iron_mg),
      potassium_mg: formNumber(meal.micronutrients.potassium_mg),
      vitamin_c_mg: formNumber(meal.micronutrients.vitamin_c_mg),
      vitamin_d_mcg: formNumber(meal.micronutrients.vitamin_d_mcg),
    },
    entry_source: meal.entry_source,
    is_estimate: meal.is_estimate,
  };
}

export function mealPayload(parsed: MealFormOutput): MealPayload {
  // Construct the complete API shape explicitly so server-owned response fields
  // can never leak into POST/PUT through object spreading.
  return {
    food_name: parsed.food_name,
    meal_type: parsed.meal_type,
    consumption_date: parsed.consumption_date,
    consumed_quantity: parsed.consumed_quantity as number,
    quantity_unit: parsed.quantity_unit,
    calories_kcal: parsed.calories_kcal as number,
    protein_g: parsed.protein_g as number,
    carbs_g: parsed.carbs_g as number,
    fat_g: parsed.fat_g as number,
    micronutrients: {
      sodium_mg: parsed.micronutrients.sodium_mg,
      calcium_mg: parsed.micronutrients.calcium_mg,
      iron_mg: parsed.micronutrients.iron_mg,
      potassium_mg: parsed.micronutrients.potassium_mg,
      vitamin_c_mg: parsed.micronutrients.vitamin_c_mg,
      vitamin_d_mcg: parsed.micronutrients.vitamin_d_mcg,
    },
    entry_source: parsed.entry_source,
    is_estimate: parsed.is_estimate,
  };
}
