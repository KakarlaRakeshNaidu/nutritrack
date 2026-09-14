import { z } from "zod";

import {
  compareCalendarDates,
  isValidCalendarDate,
} from "../../utils/calendar.js";
import { boundedNumericSchema } from "../../utils/numeric-schema.js";

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snacks"] as const;
export const QUANTITY_UNITS = ["g", "ml", "serving", "piece"] as const;
export const ENTRY_SOURCES = ["manual", "nutrition_label", "food_plate"] as const;

const nullableMicronutrient = boundedNumericSchema().nullable();

const micronutrientsSchema = z.strictObject({
  sodium_mg: nullableMicronutrient,
  calcium_mg: nullableMicronutrient,
  iron_mg: nullableMicronutrient,
  potassium_mg: nullableMicronutrient,
  vitamin_c_mg: nullableMicronutrient,
  vitamin_d_mcg: nullableMicronutrient,
});

export const createMealSchema = z
  .strictObject({
    food_name: z.string().trim().min(1).max(200),
    meal_type: z.enum(MEAL_TYPES),
    consumption_date: z.string().refine(isValidCalendarDate, {
      message: "Must be a real YYYY-MM-DD date from 1900 through 9999.",
    }),
    consumed_quantity: boundedNumericSchema({ positive: true }),
    quantity_unit: z.enum(QUANTITY_UNITS),
    calories_kcal: boundedNumericSchema(),
    protein_g: boundedNumericSchema(),
    carbs_g: boundedNumericSchema(),
    fat_g: boundedNumericSchema(),
    micronutrients: micronutrientsSchema,
    entry_source: z.enum(ENTRY_SOURCES),
    is_estimate: z.boolean(),
  })
  .superRefine((meal, context) => {
    if (meal.entry_source === "food_plate" && meal.is_estimate !== true) {
      context.addIssue({
        code: "custom",
        path: ["is_estimate"],
        message: "Food-plate entries must be marked as estimates.",
      });
    }
  });

export type MealInput = z.output<typeof createMealSchema>;

// PUT is deliberately a full replacement and therefore uses the identical
// complete writable shape; omitted fields must never acquire implicit defaults.
export const updateMealSchema = createMealSchema;

export const mealIdParamSchema = z.strictObject({
  id: z.string().uuid(),
});

export function positiveIntegerQuery({ maximum }: { maximum: number }) {
  return z
    .string()
    .regex(/^\d+$/, "Must be a positive decimal integer.")
    .refine((value) => {
      if (!/^\d+$/.test(value)) {
        return true;
      }
      const parsed = BigInt(value);
      return parsed >= 1n && parsed <= BigInt(maximum);
    }, "Must be between 1 and " + maximum + ".")
    .transform(Number);
}

export const calendarDateQuery = z.string().refine(isValidCalendarDate, {
  message: "Must be a real YYYY-MM-DD date from 1900 through 9999.",
});

export const mealListQuerySchema = z
  .strictObject({
    start_date: calendarDateQuery.optional(),
    end_date: calendarDateQuery.optional(),
    meal_type: z.enum(MEAL_TYPES).optional(),
    page: positiveIntegerQuery({ maximum: 2_147_483_647 })
      .optional()
      .transform((value) => value ?? 1),
    page_size: positiveIntegerQuery({ maximum: 100 })
      .optional()
      .transform((value) => value ?? 20),
  })
  .superRefine((query, context) => {
    if (
      query.start_date &&
      query.end_date &&
      compareCalendarDates(query.start_date, query.end_date) > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["end_date"],
        message: "Must be on or after start_date.",
      });
    }
  });

export type MealListQuery = z.output<typeof mealListQuerySchema>;

export const emptyQuerySchema = z.strictObject({});

export const absentBodySchema = z.unknown().refine((value) => value === undefined, {
  message: "Request body is not allowed.",
});
