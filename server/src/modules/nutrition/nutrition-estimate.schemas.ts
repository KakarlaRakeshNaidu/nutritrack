import { z } from "zod";

import { isValidCalendarDate } from "../../utils/calendar.js";
import { boundedNumericSchema } from "../../utils/numeric-schema.js";
import {
  MEAL_TYPES,
  QUANTITY_UNITS,
} from "../meals/meal.schemas.js";

const nullableNutrient = boundedNumericSchema().nullable();

export const mealBasicsSchema = z.strictObject({
  food_name: z.string().trim().min(1).max(200),
  meal_type: z.enum(MEAL_TYPES),
  consumption_date: z.string().refine(isValidCalendarDate, {
    message: "Must be a real YYYY-MM-DD date from 1900 through 9999.",
  }),
  consumed_quantity: boundedNumericSchema({ positive: true }),
  quantity_unit: z.enum(QUANTITY_UNITS),
});
export type MealBasicsInput = z.output<typeof mealBasicsSchema>;

export const estimateMicronutrientsSchema = z.strictObject({
  sodium_mg: nullableNutrient,
  calcium_mg: nullableNutrient,
  iron_mg: nullableNutrient,
  potassium_mg: nullableNutrient,
  vitamin_c_mg: nullableNutrient,
  vitamin_d_mcg: nullableNutrient,
});

const estimateNutritionSchema = z.strictObject({
  calories_kcal: nullableNutrient,
  protein_g: nullableNutrient,
  carbs_g: nullableNutrient,
  fat_g: nullableNutrient,
  micronutrients: estimateMicronutrientsSchema,
});

export const estimateProviderOutputSchema = z
  .strictObject({
    status: z.enum(["ok", "needs_clarification"]),
    calories_kcal: nullableNutrient,
    protein_g: nullableNutrient,
    carbs_g: nullableNutrient,
    fat_g: nullableNutrient,
    micronutrients: estimateMicronutrientsSchema,
    assumptions: z.array(z.string().trim().min(1).max(200)).max(10),
    clarification: z.string().trim().min(1).max(500).nullable(),
  })
  .superRefine((value, context) => {
    const core = [
      value.calories_kcal,
      value.protein_g,
      value.carbs_g,
      value.fat_g,
    ];
    if (value.status === "ok" && core.every((amount) => amount === null)) {
      context.addIssue({
        code: "custom",
        path: ["calories_kcal"],
        message: "At least one core nutrient is required when status is ok.",
      });
    }
    if (value.status === "needs_clarification") {
      const micros = Object.values(value.micronutrients);
      if ([...core, ...micros].some((amount) => amount !== null)) {
        context.addIssue({
          code: "custom",
          path: ["status"],
          message: "Clarification responses cannot include nutrition guesses.",
        });
      }
      if (value.clarification === null) {
        context.addIssue({
          code: "custom",
          path: ["clarification"],
          message: "A useful clarification is required.",
        });
      }
    }
  });
export type EstimateProviderOutput = z.output<
  typeof estimateProviderOutputSchema
>;

export const estimateResultSchema = z.strictObject({
  provider: z.literal("gemini"),
  status: z.enum(["ok", "needs_clarification"]),
  nutrition: estimateNutritionSchema,
  is_estimate: z.literal(true),
  assumptions: z.array(z.string().max(200)).max(10),
  clarification: z.string().max(500).nullable(),
  missing_fields: z.array(
    z.enum(["calories_kcal", "protein_g", "carbs_g", "fat_g"]),
  ).max(4),
});
export type EstimateResult = z.output<typeof estimateResultSchema>;

const nullableNumberJsonSchema = {
  anyOf: [
    { type: "number", minimum: 0, maximum: 1_000_000, multipleOf: 0.0001 },
    { type: "null" },
  ],
};

export const ESTIMATE_PROVIDER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "status",
    "calories_kcal",
    "protein_g",
    "carbs_g",
    "fat_g",
    "micronutrients",
    "assumptions",
    "clarification",
  ],
  properties: {
    status: { type: "string", enum: ["ok", "needs_clarification"] },
    calories_kcal: nullableNumberJsonSchema,
    protein_g: nullableNumberJsonSchema,
    carbs_g: nullableNumberJsonSchema,
    fat_g: nullableNumberJsonSchema,
    micronutrients: {
      type: "object",
      additionalProperties: false,
      required: [
        "sodium_mg",
        "calcium_mg",
        "iron_mg",
        "potassium_mg",
        "vitamin_c_mg",
        "vitamin_d_mcg",
      ],
      properties: {
        sodium_mg: nullableNumberJsonSchema,
        calcium_mg: nullableNumberJsonSchema,
        iron_mg: nullableNumberJsonSchema,
        potassium_mg: nullableNumberJsonSchema,
        vitamin_c_mg: nullableNumberJsonSchema,
        vitamin_d_mcg: nullableNumberJsonSchema,
      },
    },
    assumptions: {
      type: "array",
      maxItems: 10,
      items: { type: "string", minLength: 1, maxLength: 200 },
    },
    clarification: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 500 },
        { type: "null" },
      ],
    },
  },
} as const;

const REQUIRED_NUTRITION = [
  "calories_kcal",
  "protein_g",
  "carbs_g",
  "fat_g",
] as const;

export function buildEstimateResult(
  output: EstimateProviderOutput,
): EstimateResult {
  const nutrition = {
    calories_kcal: output.calories_kcal,
    protein_g: output.protein_g,
    carbs_g: output.carbs_g,
    fat_g: output.fat_g,
    micronutrients: output.micronutrients,
  };
  return estimateResultSchema.parse({
    provider: "gemini",
    status: output.status,
    nutrition,
    is_estimate: true,
    assumptions: output.assumptions,
    clarification: output.clarification,
    missing_fields: REQUIRED_NUTRITION.filter(
      (field) => nutrition[field] === null,
    ),
  });
}
