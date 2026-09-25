import { z } from "zod";

import { goalSchema } from "../goals/goal.schemas.js";
import {
  createMealSchema,
  mealListQuerySchema,
  MEAL_TYPES,
  positiveIntegerQuery,
} from "../meals/meal.schemas.js";
import { mealBasicsSchema } from "../nutrition/nutrition-estimate.schemas.js";
import { reportQuerySchema } from "../reports/report.schemas.js";

export const CHAT_MAX_MESSAGE_LENGTH = 2_000;
export const CHAT_CONTEXT_MESSAGE_LIMIT = 12;
export const CHAT_PROPOSAL_TTL_MINUTES = 30;

export const conversationIdParamSchema = z.strictObject({
  conversationId: z.string().uuid(),
});

export const proposalIdParamSchema = z.strictObject({
  proposalId: z.string().uuid(),
});

export const chatPaginationSchema = z.strictObject({
  page: positiveIntegerQuery({ maximum: 2_147_483_647 })
    .optional()
    .transform((value) => value ?? 1),
  page_size: positiveIntegerQuery({ maximum: 50 })
    .optional()
    .transform((value) => value ?? 20),
});

export type ChatPagination = z.output<typeof chatPaginationSchema>;

export const createConversationSchema = z.strictObject({
  title: z.string().trim().min(1).max(120).optional(),
});

export const submitMessageSchema = z.strictObject({
  message: z.string().trim().min(1).max(CHAT_MAX_MESSAGE_LENGTH),
});

export const imageProposalSchema = z.strictObject({
  meal: createMealSchema,
  assumptions: z.array(z.string().trim().min(1).max(200)).max(10),
});

export const emptyChatBodySchema = z
  .unknown()
  .refine((value) => value === undefined, {
    message: "Request body is not allowed.",
  });

export const emptyChatQuerySchema = z.strictObject({});

const micronutrientPatchSchema = createMealSchema.shape.micronutrients.partial();

export const mealPatchSchema = z
  .strictObject({
    food_name: createMealSchema.shape.food_name.optional(),
    meal_type: createMealSchema.shape.meal_type.optional(),
    consumption_date: createMealSchema.shape.consumption_date.optional(),
    consumed_quantity: createMealSchema.shape.consumed_quantity.optional(),
    quantity_unit: createMealSchema.shape.quantity_unit.optional(),
    calories_kcal: createMealSchema.shape.calories_kcal.optional(),
    protein_g: createMealSchema.shape.protein_g.optional(),
    carbs_g: createMealSchema.shape.carbs_g.optional(),
    fat_g: createMealSchema.shape.fat_g.optional(),
    micronutrients: micronutrientPatchSchema.optional(),
    entry_source: createMealSchema.shape.entry_source.optional(),
    is_estimate: createMealSchema.shape.is_estimate.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one meal value must change.",
  });

export const goalPatchSchema = goalSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one goal value must change.",
  });

export const mealMatchSchema = z.strictObject({
  id: z.string().uuid().optional(),
  food_name: z.string().trim().min(1).max(200).optional(),
  consumption_date: createMealSchema.shape.consumption_date.optional(),
  meal_type: z.enum(MEAL_TYPES).optional(),
}).refine(
  (value) => value.id !== undefined || value.food_name !== undefined,
  { message: "A meal id or food name is required." },
);

export const chatToolNames = [
  "generalNutrition",
  "clarify",
  "listMeals",
  "getMeal",
  "getGoals",
  "getNutritionReport",
  "estimateNutrition",
  "proposeMealCreate",
  "proposeMealUpdate",
  "proposeMealDelete",
  "proposeGoalReplacement",
] as const;

export type ChatToolName = (typeof chatToolNames)[number];

export const chatPlanSchema = z.strictObject({
  tool: z.enum(chatToolNames),
  arguments_json: z.string().max(8_000),
  assistant_message: z.string().trim().min(1).max(2_000),
});

export type ChatPlan = z.output<typeof chatPlanSchema>;

const noArgumentsSchema = z.strictObject({});

const toolArgumentSchemas = {
  generalNutrition: noArgumentsSchema,
  clarify: noArgumentsSchema,
  listMeals: mealListQuerySchema,
  getMeal: z.strictObject({ id: z.string().uuid() }),
  getGoals: noArgumentsSchema,
  getNutritionReport: reportQuerySchema,
  estimateNutrition: mealBasicsSchema,
  proposeMealCreate: createMealSchema,
  proposeMealUpdate: z.strictObject({
    match: mealMatchSchema,
    changes: mealPatchSchema,
    quantity_handling: z.enum(["retain_totals", "reestimate"]).optional(),
  }),
  proposeMealDelete: z.strictObject({ match: mealMatchSchema }),
  proposeGoalReplacement: z.strictObject({ changes: goalPatchSchema }),
} satisfies Record<ChatToolName, z.ZodType>;

export function parseChatToolArguments(
  plan: ChatPlan,
): z.output<(typeof toolArgumentSchemas)[ChatToolName]> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(plan.arguments_json);
  } catch {
    throw new Error("Chat tool arguments were not valid JSON.");
  }
  return toolArgumentSchemas[plan.tool].parse(decoded);
}

const timestampSchema = z.string().datetime({ offset: true });

export const mealCreateProposalPayloadSchema = z.strictObject({
  kind: z.literal("meal_create"),
  meal: createMealSchema,
});

export const mealUpdateProposalPayloadSchema = z.strictObject({
  kind: z.literal("meal_update"),
  meal_id: z.string().uuid(),
  meal: createMealSchema,
  expected_updated_at: timestampSchema,
});

export const mealDeleteProposalPayloadSchema = z.strictObject({
  kind: z.literal("meal_delete"),
  meal_id: z.string().uuid(),
  food_name: z.string().trim().min(1).max(200),
  expected_updated_at: timestampSchema,
});

export const goalsReplaceProposalPayloadSchema = z.strictObject({
  kind: z.literal("goals_replace"),
  goals: goalSchema,
  expected_updated_at: timestampSchema,
});

export const proposalPayloadSchema = z.discriminatedUnion("kind", [
  mealCreateProposalPayloadSchema,
  mealUpdateProposalPayloadSchema,
  mealDeleteProposalPayloadSchema,
  goalsReplaceProposalPayloadSchema,
]);

export type ProposalPayload = z.output<typeof proposalPayloadSchema>;
export type ProposalKind = ProposalPayload["kind"];

export const CHAT_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tool", "arguments_json", "assistant_message"],
  properties: {
    tool: { type: "string", enum: chatToolNames },
    arguments_json: { type: "string", maxLength: 8000 },
    assistant_message: { type: "string", minLength: 1, maxLength: 2000 },
  },
} as const;
