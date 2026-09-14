import { z } from "zod";

import { isValidCalendarDate } from "../../utils/calendar.js";
import { boundedNumericSchema } from "../../utils/numeric-schema.js";
import { ENTRY_SOURCES, MEAL_TYPES, QUANTITY_UNITS } from "../meals/meal.schemas.js";

export const IMAGE_TYPES = ["nutrition_label", "food_plate"] as const;
export const imageTypeSchema = z.enum(IMAGE_TYPES);
export type ImageType = z.output<typeof imageTypeSchema>;

const nullableNutrientSchema = boundedNumericSchema().nullable();
export const providerMicronutrientsSchema = z.strictObject({
  sodium_mg: nullableNutrientSchema,
  calcium_mg: nullableNutrientSchema,
  iron_mg: nullableNutrientSchema,
  potassium_mg: nullableNutrientSchema,
  vitamin_c_mg: nullableNutrientSchema,
  vitamin_d_mcg: nullableNutrientSchema,
});

export const providerOutputSchema = z
  .strictObject({
    status: z.enum(["ok", "unreadable", "not_food"]),
    food_name: z.string().trim().min(1).max(200).nullable(),
    quantity: boundedNumericSchema({ positive: true }).nullable(),
    quantity_unit: z.enum(QUANTITY_UNITS).nullable(),
    calories_kcal: nullableNutrientSchema,
    protein_g: nullableNutrientSchema,
    carbs_g: nullableNutrientSchema,
    fat_g: nullableNutrientSchema,
    micronutrients: providerMicronutrientsSchema,
    source_basis: z.string().max(200).nullable(),
    notes: z.array(z.string().max(200)).max(10),
  })
  .superRefine((value, context) => {
    const core = [value.calories_kcal, value.protein_g, value.carbs_g, value.fat_g];
    if (value.status === "ok" && core.every((amount) => amount === null)) {
      context.addIssue({
        code: "custom",
        path: ["calories_kcal"],
        message: "At least one core nutrient is required when status is ok.",
      });
    }
  });

export type ProviderOutput = z.output<typeof providerOutputSchema>;

const nullableNumberJsonSchema = {
  anyOf: [
    { type: "number", minimum: 0, maximum: 1_000_000, multipleOf: 0.0001 },
    { type: "null" },
  ],
};

// Providers receive a basic JSON Schema matching the strict local Zod boundary.
// Cross-field refinements and decimal precision remain authoritative locally.
export const PROVIDER_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "status", "food_name", "quantity", "quantity_unit", "calories_kcal",
    "protein_g", "carbs_g", "fat_g", "micronutrients", "source_basis", "notes",
  ],
  properties: {
    status: { type: "string", enum: ["ok", "unreadable", "not_food"] },
    food_name: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 200 },
        { type: "null" },
      ],
    },
    quantity: {
      anyOf: [
        {
          type: "number",
          exclusiveMinimum: 0,
          maximum: 1_000_000,
          multipleOf: 0.0001,
        },
        { type: "null" },
      ],
    },
    quantity_unit: {
      anyOf: [
        { type: "string", enum: [...QUANTITY_UNITS] },
        { type: "null" },
      ],
    },
    calories_kcal: nullableNumberJsonSchema,
    protein_g: nullableNumberJsonSchema,
    carbs_g: nullableNumberJsonSchema,
    fat_g: nullableNumberJsonSchema,
    micronutrients: {
      type: "object",
      additionalProperties: false,
      required: [
        "sodium_mg", "calcium_mg", "iron_mg", "potassium_mg",
        "vitamin_c_mg", "vitamin_d_mcg",
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
    source_basis: {
      anyOf: [{ type: "string", maxLength: 200 }, { type: "null" }],
    },
    notes: {
      type: "array",
      maxItems: 10,
      items: { type: "string", maxLength: 200 },
    },
  },
} as const;

const extractionDraftSchema = z.strictObject({
  food_name: z.string().trim().min(1).max(200).nullable(),
  meal_type: z.enum(MEAL_TYPES).nullable(),
  consumption_date: z.string().refine(isValidCalendarDate),
  consumed_quantity: boundedNumericSchema({ positive: true }).nullable(),
  quantity_unit: z.enum(QUANTITY_UNITS).nullable(),
  calories_kcal: nullableNutrientSchema,
  protein_g: nullableNutrientSchema,
  carbs_g: nullableNutrientSchema,
  fat_g: nullableNutrientSchema,
  micronutrients: providerMicronutrientsSchema,
  entry_source: z.enum(ENTRY_SOURCES),
  is_estimate: z.boolean(),
});

export const extractionResultSchema = z.strictObject({
  provider: z.literal("gemini"),
  image_type: imageTypeSchema,
  is_estimate: z.boolean(),
  source_basis: z.string().max(200).nullable(),
  assumptions: z.array(z.string().max(200)).max(10),
  draft: extractionDraftSchema,
  missing_fields: z.array(z.string()).max(8),
});
export type ExtractionResult = z.output<typeof extractionResultSchema>;

const REQUIRED_DRAFT_FIELDS = [
  "food_name", "meal_type", "consumed_quantity", "quantity_unit",
  "calories_kcal", "protein_g", "carbs_g", "fat_g",
] as const;

export function buildExtractionResult({
  provider,
  imageType,
  output,
  today,
}: {
  provider: "gemini";
  imageType: ImageType;
  output: ProviderOutput;
  today: string;
}): ExtractionResult {
  const isEstimate = imageType === "food_plate";
  const draft = {
    food_name: output.food_name,
    meal_type: null,
    consumption_date: today,
    consumed_quantity: output.quantity,
    quantity_unit: output.quantity_unit,
    calories_kcal: output.calories_kcal,
    protein_g: output.protein_g,
    carbs_g: output.carbs_g,
    fat_g: output.fat_g,
    micronutrients: output.micronutrients,
    // Server metadata cannot be selected by image text or provider output.
    entry_source: imageType,
    is_estimate: isEstimate,
  };
  const missingFields = REQUIRED_DRAFT_FIELDS.filter(
    (field) => draft[field] === null,
  );

  return extractionResultSchema.parse({
    provider,
    image_type: imageType,
    is_estimate: isEstimate,
    source_basis: output.source_basis,
    assumptions: output.notes,
    draft,
    missing_fields: missingFields,
  });
}
