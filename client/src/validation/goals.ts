import type { Goals } from "../types";
import { z } from "zod";

import { numericInput } from "./numbers";

export const goalFormSchema = z.strictObject({
  daily_calories_kcal: numericInput({
    label: "Daily calories",
    nullable: true,
    positive: true,
  }),
  daily_protein_g: numericInput({
    label: "Daily protein",
    nullable: true,
  }),
  daily_carbs_g: numericInput({
    label: "Daily carbohydrates",
    nullable: true,
  }),
  daily_fat_g: numericInput({
    label: "Daily fat",
    nullable: true,
  }),
  target_weight_kg: numericInput({
    label: "Target weight",
    nullable: true,
    positive: true,
  }),
});
export type GoalFormInput = z.input<typeof goalFormSchema>;
export type GoalFormOutput = z.output<typeof goalFormSchema>;


export function emptyGoalForm(): GoalFormInput {
  return {
    daily_calories_kcal: "",
    daily_protein_g: "",
    daily_carbs_g: "",
    daily_fat_g: "",
    target_weight_kg: "",
  };
}

export function goalsToFormValues(goals: Goals): GoalFormInput {
  return {
    daily_calories_kcal:
      goals.daily_calories_kcal === null ? "" : String(goals.daily_calories_kcal),
    daily_protein_g:
      goals.daily_protein_g === null ? "" : String(goals.daily_protein_g),
    daily_carbs_g:
      goals.daily_carbs_g === null ? "" : String(goals.daily_carbs_g),
    daily_fat_g: goals.daily_fat_g === null ? "" : String(goals.daily_fat_g),
    target_weight_kg:
      goals.target_weight_kg === null ? "" : String(goals.target_weight_kg),
  };
}

export function goalPayload(parsed: GoalFormOutput): Goals {
  // PUT is complete replacement: blank controls are already transformed to
  // null, and explicit "0" macro controls are numeric zero.
  return {
    daily_calories_kcal: parsed.daily_calories_kcal,
    daily_protein_g: parsed.daily_protein_g,
    daily_carbs_g: parsed.daily_carbs_g,
    daily_fat_g: parsed.daily_fat_g,
    target_weight_kg: parsed.target_weight_kg,
  };
}
