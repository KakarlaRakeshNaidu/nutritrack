import { z } from "zod";

import { boundedNumericSchema } from "../../utils/numeric-schema.js";

const nullablePositiveGoal = boundedNumericSchema({
  positive: true,
}).nullable();
const nullableMacroGoal = boundedNumericSchema().nullable();

export const goalSchema = z.strictObject({
  daily_calories_kcal: nullablePositiveGoal,
  daily_protein_g: nullableMacroGoal,
  daily_carbs_g: nullableMacroGoal,
  daily_fat_g: nullableMacroGoal,
  target_weight_kg: nullablePositiveGoal,
});

export type GoalInput = z.output<typeof goalSchema>;

export const goalQuerySchema = z.strictObject({});

export const absentGoalBodySchema = z
  .unknown()
  .refine((value) => value === undefined, {
    message: "Request body is not allowed.",
  });
