import { z, ZodError } from "zod";

import type { ProviderState } from "../../config/env.js";
import { mapDatabaseError } from "../../db/database-errors.js";
import { withTransaction } from "../../db/transaction.js";
import type { Clock, DatabasePool, TransactionClient } from "../../types.js";
import { isConsumptionDateAllowed } from "../../utils/calendar.js";
import { AppError } from "../../utils/errors.js";
import {
  findSingletonGoals,
  replaceSingletonGoals,
} from "../goals/goal.repository.js";
import { goalSchema } from "../goals/goal.schemas.js";
import {
  deleteMealById,
  findMealById,
  insertMeal,
  replaceMeal,
  type Meal,
} from "../meals/meal.repository.js";
import {
  createMealSchema,
  mealListQuerySchema,
  type MealInput,
  type MealListQuery,
} from "../meals/meal.schemas.js";
import { createMealService } from "../meals/meal.service.js";
import { mealBasicsSchema } from "../nutrition/nutrition-estimate.schemas.js";
import {
  createNutritionEstimateService,
  type NutritionEstimateService,
} from "../nutrition/nutrition-estimate.service.js";
import { ProviderFailure } from "../nutrition/nutrition.failures.js";
import { createProfileService } from "../profile/profile.service.js";
import { createReportService } from "../reports/report.service.js";
import { reportQuerySchema } from "../reports/report.schemas.js";
import { createGeminiChatPlanner, type ChatPlanner } from "./chat.gemini.js";
import {
  countConversations,
  countMessages,
  findActiveProposal,
  findConversation,
  findProposal,
  insertConversation,
  insertMessage,
  insertProposal,
  listConversations,
  listMessages,
  recentMessages,
  setInitialConversationTitle,
  setProposalStatus,
  touchConversation,
  type ChatConversation,
  type ChatMessage,
  type ChatProposal,
} from "./chat.repository.js";
import {
  CHAT_CONTEXT_MESSAGE_LIMIT,
  CHAT_PROPOSAL_TTL_MINUTES,
  goalPatchSchema,
  mealMatchSchema,
  mealPatchSchema,
  proposalPayloadSchema,
  type ChatPagination,
  type ProposalPayload,
} from "./chat.schemas.js";

const CHAT_PROVIDER_TIMEOUT_MS = 25_000;
const CONFIRM_PATTERN = /^(?:yes\s*,?\s*)?(?:confirm|save it|go ahead)[.!]?$/i;
const CANCEL_PATTERN = /^(?:cancel|no\s*,?\s*cancel|do not save)[.!]?$/i;
const DEFAULT_CONVERSATION_TITLE = "New nutrition conversation";
const CONVERSATION_TITLE_MAX_LENGTH = 64;

const noArgumentsSchema = z.strictObject({});
const getMealArgumentsSchema = z.strictObject({ id: z.string().uuid() });
const updateIntentSchema = z.strictObject({
  match: mealMatchSchema,
  changes: mealPatchSchema,
  quantity_handling: z.enum(["retain_totals", "reestimate"]).optional(),
});
const deleteIntentSchema = z.strictObject({ match: mealMatchSchema });
const goalIntentSchema = z.strictObject({ changes: goalPatchSchema });

function normalizePaginationArguments(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const result = { ...value as Record<string, unknown> };
  for (const field of ["page", "page_size"]) {
    if (typeof result[field] === "number") result[field] = String(result[field]);
  }
  return result;
}

interface ChatServiceDependencies {
  pool: DatabasePool;
  providers: Record<"gemini", ProviderState>;
  clock?: Clock;
  planner?: ChatPlanner;
  estimateService?: NutritionEstimateService;
}

interface Page<T> {
  items: T[];
  pagination: {
    page: number;
    page_size: number;
    total_items: number;
    total_pages: number;
  };
}

export interface ChatTurnResult {
  user_message: ChatMessage;
  assistant_message: ChatMessage;
}

function notFound(kind: "conversation" | "proposal"): AppError {
  return new AppError({
    status: 404,
    code: kind === "conversation" ? "CHAT_CONVERSATION_NOT_FOUND" : "CHAT_PROPOSAL_NOT_FOUND",
    message: "The requested chat " + kind + " does not exist.",
  });
}

function staleProposal(): AppError {
  return new AppError({
    status: 409,
    code: "CHAT_PROPOSAL_STALE",
    message: "The underlying record changed. Request a fresh review before confirming.",
  });
}

function invalidProposal(message: string): AppError {
  return new AppError({
    status: 409,
    code: "CHAT_PROPOSAL_NOT_EXECUTABLE",
    message,
  });
}

function providerError(error: ProviderFailure): AppError {
  if (error.kind === "configuration") {
    return new AppError({
      status: 503,
      code: "AI_CONFIGURATION_ERROR",
      message: "Chat is not configured.",
    });
  }
  if (error.kind === "output_invalid") {
    return new AppError({
      status: 502,
      code: "AI_INVALID_OUTPUT",
      message: "Gemini returned an invalid chat action.",
    });
  }
  if (error.kind === "content") {
    return new AppError({
      status: 422,
      code: "AI_ANALYSIS_REFUSED",
      message: "Gemini could not process that request.",
    });
  }
  return new AppError({
    status: error.kind === "application_bug" ? 500 : 503,
    code: error.kind === "application_bug" ? "INTERNAL_ERROR" : "AI_PROVIDERS_UNAVAILABLE",
    message: error.kind === "application_bug"
      ? "An unexpected error occurred."
      : "Gemini is temporarily unavailable.",
  });
}

function page<T>(items: T[], total: number, pagination: ChatPagination): Page<T> {
  return {
    items,
    pagination: {
      page: pagination.page,
      page_size: pagination.page_size,
      total_items: total,
      total_pages: total === 0 ? 0 : Math.ceil(total / pagination.page_size),
    },
  };
}

function proposalExpiry(clock: Clock): Date {
  return new Date(clock().getTime() + CHAT_PROPOSAL_TTL_MINUTES * 60_000);
}

export function conversationTitleFromMessage(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  if (!compact) return DEFAULT_CONVERSATION_TITLE;
  if (compact.length <= CONVERSATION_TITLE_MAX_LENGTH) return compact;

  const candidate = compact.slice(0, CONVERSATION_TITLE_MAX_LENGTH - 1);
  const wordBoundary = candidate.lastIndexOf(" ");
  const shortened = wordBoundary >= 48 ? candidate.slice(0, wordBoundary) : candidate;
  return shortened.trimEnd() + "…";
}

function formatMeal(meal: MealInput & { id?: string }): string {
  const identity = meal.id ? " (" + meal.id + ")" : "";
  return [
    meal.food_name + identity,
    meal.meal_type + " on " + meal.consumption_date,
    meal.consumed_quantity + " " + meal.quantity_unit,
    meal.calories_kcal + " kcal; protein " + meal.protein_g +
      " g; carbs " + meal.carbs_g + " g; fat " + meal.fat_g + " g",
    meal.is_estimate ? "AI-estimated values" : "user-supplied values",
  ].join(" · ");
}

function proposalReview(payload: ProposalPayload): string {
  switch (payload.kind) {
    case "meal_create":
      return "Review meal to save: " + formatMeal(payload.meal);
    case "meal_update":
      return "Review replacement for meal " + payload.meal_id + ": " + formatMeal(payload.meal);
    case "meal_delete":
      return "Review deletion: " + payload.food_name + " (" + payload.meal_id + "). This removes the meal from history and reports.";
    case "goals_replace":
      return "Review goal replacement: " + JSON.stringify(payload.goals) + ". Unlisted existing targets were preserved.";
  }
}

function mergeMeal(current: Meal, changes: Record<string, unknown>): MealInput {
  const micronutrientChanges =
    changes.micronutrients && typeof changes.micronutrients === "object"
      ? changes.micronutrients as Partial<MealInput["micronutrients"]>
      : {};
  const writableCurrent: MealInput = {
    food_name: current.food_name,
    meal_type: current.meal_type,
    consumption_date: current.consumption_date,
    consumed_quantity: current.consumed_quantity,
    quantity_unit: current.quantity_unit,
    calories_kcal: current.calories_kcal,
    protein_g: current.protein_g,
    carbs_g: current.carbs_g,
    fat_g: current.fat_g,
    micronutrients: current.micronutrients,
    entry_source: current.entry_source,
    is_estimate: current.is_estimate,
  };
  return createMealSchema.parse({
    ...writableCurrent,
    ...changes,
    micronutrients: {
      ...current.micronutrients,
      ...micronutrientChanges,
    },
  });
}

function matchingMeals(
  meals: Meal[],
  match: { id?: string; food_name?: string },
): Meal[] {
  if (match.id) return meals.filter((meal) => meal.id === match.id);
  const needle = match.food_name?.trim().toLocaleLowerCase() ?? "";
  return meals.filter((meal) =>
    meal.food_name.toLocaleLowerCase().includes(needle),
  );
}

async function ensureWriteDate(
  client: TransactionClient,
  userId: string,
  meal: MealInput,
  clock: Clock,
): Promise<void> {
  const profile = await createProfileService({ pool: client, clock }).getProfile(userId);
  if (!isConsumptionDateAllowed(meal.consumption_date, profile.today)) {
    throw new AppError({
      status: 422,
      code: "VALIDATION_ERROR",
      message: "Consumption date cannot be after today.",
      details: [{ field: "consumption_date", message: "Consumption date cannot be after today." }],
    });
  }
}

async function executePayload(
  client: TransactionClient,
  userId: string,
  payload: ProposalPayload,
  clock: Clock,
): Promise<unknown> {
  switch (payload.kind) {
    case "meal_create": {
      await ensureWriteDate(client, userId, payload.meal, clock);
      return { action: "meal_created", meal: await insertMeal(client, payload.meal, userId) };
    }
    case "meal_update": {
      const current = await findMealById(client, payload.meal_id, userId);
      if (!current || current.updated_at !== payload.expected_updated_at) throw staleProposal();
      await ensureWriteDate(client, userId, payload.meal, clock);
      const meal = await replaceMeal(client, payload.meal_id, payload.meal, userId);
      if (!meal) throw staleProposal();
      return { action: "meal_updated", meal };
    }
    case "meal_delete": {
      const current = await findMealById(client, payload.meal_id, userId);
      if (!current || current.updated_at !== payload.expected_updated_at) throw staleProposal();
      if (!(await deleteMealById(client, payload.meal_id, userId))) throw staleProposal();
      return { action: "meal_deleted", meal_id: payload.meal_id };
    }
    case "goals_replace": {
      const current = await findSingletonGoals(client, userId);
      if (!current || current.updated_at !== payload.expected_updated_at) throw staleProposal();
      const goals = await replaceSingletonGoals(client, payload.goals, userId);
      if (!goals) throw staleProposal();
      return { action: "goals_replaced", goals };
    }
  }
}

export interface ChatService {
  createConversation(userId: string, title?: string): Promise<ChatConversation>;
  listConversations(userId: string, pagination: ChatPagination): Promise<Page<ChatConversation>>;
  listMessages(userId: string, conversationId: string, pagination: ChatPagination): Promise<Page<ChatMessage>>;
  submitMessage(input: {
    userId: string;
    conversationId: string;
    message: string;
    signal: AbortSignal;
  }): Promise<ChatTurnResult>;
  createImageProposal(input: {
    userId: string;
    conversationId: string;
    meal: MealInput;
    assumptions: string[];
  }): Promise<ChatMessage>;
  getProposal(userId: string, proposalId: string): Promise<ChatProposal>;
  confirmProposal(userId: string, proposalId: string): Promise<ChatProposal>;
  cancelProposal(userId: string, proposalId: string): Promise<ChatProposal>;
}

export function createChatService({
  pool,
  providers,
  clock = () => new Date(),
  planner = createGeminiChatPlanner(providers.gemini),
  estimateService = createNutritionEstimateService({ pool, providers, clock }),
}: ChatServiceDependencies): ChatService {
  const mealService = createMealService({ pool, clock });
  const reportService = createReportService({ pool, clock });
  const profileService = createProfileService({ pool, clock });

  async function requireConversation(userId: string, conversationId: string) {
    const conversation = await findConversation(pool, userId, conversationId);
    if (!conversation) throw notFound("conversation");
    return conversation;
  }

  async function assistantWithProposal(
    userId: string,
    conversationId: string,
    payload: ProposalPayload,
    contentSuffix = "",
  ): Promise<ChatMessage> {
    const validated = proposalPayloadSchema.parse(payload);
    return withTransaction(pool, async (client) => {
      const message = await insertMessage(client, {
        userId,
        conversationId,
        role: "assistant",
        content: proposalReview(validated) + contentSuffix,
      });
      const proposal = await insertProposal(client, {
        userId,
        conversationId,
        messageId: message.id,
        payload: validated,
        expiresAt: proposalExpiry(clock),
      });
      await touchConversation(client, userId, conversationId);
      return { ...message, proposal };
    });
  }

  async function resolveMatch(
    userId: string,
    match: { id?: string; food_name?: string; consumption_date?: string; meal_type?: MealListQuery["meal_type"] },
  ): Promise<{ meal?: Meal; message?: string }> {
    if (match.id) {
      try {
        return { meal: await mealService.getMeal(match.id, userId) };
      } catch (error) {
        if (error instanceof AppError && error.status === 404) {
          return { message: "I could not find that meal in your diary." };
        }
        throw error;
      }
    }
    const result = await mealService.listMeals(mealListQuerySchema.parse({
      start_date: match.consumption_date,
      end_date: match.consumption_date,
      meal_type: match.meal_type,
      page: "1",
      page_size: "100",
    }), userId);
    const matches = matchingMeals(result.items, match);
    if (result.pagination.total_pages > 1) {
      return { message: "There are more matching diary pages. Add a date or meal type so I can identify one exact meal." };
    }
    if (matches.length === 0) {
      return { message: "I could not find a matching meal. Add a date or meal type and try again." };
    }
    if (matches.length > 1) {
      return {
        message: "I found several matching meals. Choose one exact record: " +
          matches.map((meal) => meal.food_name + " on " + meal.consumption_date + " (" + meal.id + ")").join("; "),
      };
    }
    return { meal: matches[0] };
  }

  async function confirmAction(userId: string, proposalId: string): Promise<ChatProposal> {
    try {
      const result = await withTransaction(pool, async (client) => {
        const proposal = await findProposal(client, userId, proposalId, true);
        if (!proposal) return { kind: "missing" as const };
        if (proposal.status === "confirmed") {
          return { kind: "confirmed" as const, proposal };
        }
        if (proposal.status !== "pending") {
          return { kind: "blocked" as const, proposal };
        }
        if (new Date(proposal.expires_at).getTime() <= clock().getTime()) {
          const expired = await setProposalStatus(client, {
            userId,
            proposalId,
            status: "expired",
          });
          return { kind: "expired" as const, proposal: expired };
        }
        let outcome: unknown;
        try {
          outcome = await executePayload(client, userId, proposal.payload, clock);
        } catch (error) {
          if (error instanceof AppError && error.code === "CHAT_PROPOSAL_STALE") {
            const canceled = await setProposalStatus(client, {
              userId,
              proposalId,
              status: "canceled",
            });
            return { kind: "stale" as const, proposal: canceled };
          }
          throw error;
        }
        const confirmed = await setProposalStatus(client, {
          userId,
          proposalId,
          status: "confirmed",
          outcome,
        });
        await touchConversation(client, userId, proposal.conversation_id);
        return { kind: "executed" as const, proposal: confirmed };
      });
      if (result.kind === "missing") throw notFound("proposal");
      if (result.kind === "blocked") {
        throw invalidProposal("This proposal is " + result.proposal.status + " and cannot be confirmed.");
      }
      if (result.kind === "expired") {
        throw invalidProposal("This proposal expired. Request a fresh review.");
      }
      if (result.kind === "stale") throw staleProposal();
      return result.proposal;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw mapDatabaseError(error);
    }
  }

  async function cancelAction(userId: string, proposalId: string): Promise<ChatProposal> {
    try {
      const result = await withTransaction(pool, async (client) => {
        const proposal = await findProposal(client, userId, proposalId, true);
        if (!proposal) return { kind: "missing" as const };
        if (proposal.status === "canceled") return { kind: "canceled" as const, proposal };
        if (proposal.status !== "pending") return { kind: "blocked" as const, proposal };
        const canceled = await setProposalStatus(client, {
          userId,
          proposalId,
          status: "canceled",
        });
        await touchConversation(client, userId, proposal.conversation_id);
        return { kind: "canceled" as const, proposal: canceled };
      });
      if (result.kind === "missing") throw notFound("proposal");
      if (result.kind === "blocked") {
        throw invalidProposal("This proposal is " + result.proposal.status + " and cannot be canceled.");
      }
      return result.proposal;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw mapDatabaseError(error);
    }
  }

  return {
    async createConversation(userId, title = "New nutrition conversation") {
      return insertConversation(pool, userId, title);
    },

    async listConversations(userId, pagination) {
      return page(
        await listConversations(pool, userId, pagination),
        await countConversations(pool, userId),
        pagination,
      );
    },

    async listMessages(userId, conversationId, pagination) {
      await requireConversation(userId, conversationId);
      return page(
        await listMessages(pool, userId, conversationId, pagination),
        await countMessages(pool, userId, conversationId),
        pagination,
      );
    },

    async submitMessage({ userId, conversationId, message, signal }) {
      await requireConversation(userId, conversationId);
      await setInitialConversationTitle(
        pool,
        userId,
        conversationId,
        conversationTitleFromMessage(message),
      );
      const userMessage = await insertMessage(pool, {
        userId,
        conversationId,
        role: "user",
        content: message,
      });
      await touchConversation(pool, userId, conversationId);

      if (CONFIRM_PATTERN.test(message)) {
        const active = await findActiveProposal(pool, userId, conversationId);
        const content = active
          ? "Confirmed. The reviewed action was completed."
          : "There is no single active proposal to confirm.";
        if (active) await confirmAction(userId, active.id);
        const assistantMessage = await insertMessage(pool, {
          userId,
          conversationId,
          role: "assistant",
          content,
        });
        return { user_message: userMessage, assistant_message: assistantMessage };
      }

      if (CANCEL_PATTERN.test(message)) {
        const active = await findActiveProposal(pool, userId, conversationId);
        const content = active
          ? "Canceled. No diary or goal change was made."
          : "There is no single active proposal to cancel.";
        if (active) await cancelAction(userId, active.id);
        const assistantMessage = await insertMessage(pool, {
          userId,
          conversationId,
          role: "assistant",
          content,
        });
        return { user_message: userMessage, assistant_message: assistantMessage };
      }

      const [profile, context] = await Promise.all([
        profileService.getProfile(userId),
        recentMessages(pool, userId, conversationId, CHAT_CONTEXT_MESSAGE_LIMIT),
      ]);

      try {
        const plan = await planner.plan({
          message,
          context,
          dateContext: {
            timezone: profile.timezone,
            today: profile.today,
            week_start: profile.week_start,
            week_end: profile.week_end,
          },
          signal,
          timeoutMs: CHAT_PROVIDER_TIMEOUT_MS,
        });
        let decoded: unknown;
        try {
          decoded = JSON.parse(plan.arguments_json);
        } catch {
          throw new ProviderFailure("output_invalid", "Chat tool arguments were not JSON.");
        }

        let assistantMessage: ChatMessage;
        switch (plan.tool) {
          case "generalNutrition":
          case "clarify": {
            noArgumentsSchema.parse(decoded);
            assistantMessage = await insertMessage(pool, {
              userId,
              conversationId,
              role: "assistant",
              content: plan.assistant_message,
            });
            break;
          }
          case "listMeals": {
            const query = mealListQuerySchema.parse(normalizePaginationArguments(decoded));
            const result = await mealService.listMeals(query, userId);
            const content = result.items.length === 0
              ? "No meals matched that request."
              : result.items.map(formatMeal).join("\n") +
                "\nPage " + result.pagination.page + " of " +
                result.pagination.total_pages + "; " +
                result.pagination.total_items + " total matching meals." +
                (result.pagination.page < result.pagination.total_pages
                  ? " Use Show more to view another page."
                  : "");
            assistantMessage = await insertMessage(pool, {
              userId, conversationId, role: "assistant", content,
            });
            break;
          }
          case "getMeal": {
            const args = getMealArgumentsSchema.parse(decoded);
            const meal = await mealService.getMeal(args.id, userId);
            assistantMessage = await insertMessage(pool, {
              userId, conversationId, role: "assistant", content: formatMeal(meal),
            });
            break;
          }
          case "getGoals": {
            noArgumentsSchema.parse(decoded);
            const goals = await findSingletonGoals(pool, userId);
            if (!goals) throw new AppError({ status: 500, code: "INTERNAL_ERROR", message: "Goals are unavailable." });
            assistantMessage = await insertMessage(pool, {
              userId,
              conversationId,
              role: "assistant",
              content: "Current goals: " + JSON.stringify(goals),
            });
            break;
          }
          case "getNutritionReport": {
            const report = await reportService.getNutritionReport(
              reportQuerySchema.parse(normalizePaginationArguments(decoded)),
              userId,
            );
            assistantMessage = await insertMessage(pool, {
              userId,
              conversationId,
              role: "assistant",
              content:
                "Nutrition summary for " + report.range.start_date + " through " +
                report.range.end_date + ": " + report.summary.calories_kcal +
                " kcal, protein " + report.summary.protein_g + " g, carbs " +
                report.summary.carbs_g + " g, fat " + report.summary.fat_g +
                " g across " + report.summary.entry_count + " meals.",
            });
            break;
          }
          case "estimateNutrition": {
            const basics = mealBasicsSchema.parse(decoded);
            const estimate = await estimateService.estimate(basics, signal, userId);
            if (estimate.status === "needs_clarification" || estimate.missing_fields.length > 0) {
              assistantMessage = await insertMessage(pool, {
                userId,
                conversationId,
                role: "assistant",
                content: estimate.clarification ??
                  "The estimate is missing required nutrition values. Add more food or portion detail.",
              });
            } else {
              const meal = createMealSchema.parse({
                ...basics,
                ...estimate.nutrition,
                entry_source: "manual",
                is_estimate: true,
              });
              assistantMessage = await assistantWithProposal(userId, conversationId, {
                kind: "meal_create",
                meal,
              });
            }
            break;
          }
          case "proposeMealCreate": {
            assistantMessage = await assistantWithProposal(userId, conversationId, {
              kind: "meal_create",
              meal: createMealSchema.parse(decoded),
            });
            break;
          }
          case "proposeMealUpdate": {
            const intent = updateIntentSchema.parse(decoded);
            const { match, changes } = intent;
            const resolved = await resolveMatch(userId, match);
            if (!resolved.meal) {
              assistantMessage = await insertMessage(pool, {
                userId, conversationId, role: "assistant", content: resolved.message ?? "Choose one meal.",
              });
              break;
            }
            if (
              Object.hasOwn(changes, "consumed_quantity") &&
              intent.quantity_handling !== "retain_totals" &&
              intent.quantity_handling !== "reestimate"
            ) {
              assistantMessage = await insertMessage(pool, {
                userId,
                conversationId,
                role: "assistant",
                content: "Changing quantity does not automatically rescale nutrition. Should I retain the current totals or request a new estimate?",
              });
              break;
            }
            let replacement = mergeMeal(resolved.meal, changes);
            if (intent.quantity_handling === "reestimate") {
              const estimate = await estimateService.estimate({
                food_name: replacement.food_name,
                meal_type: replacement.meal_type,
                consumption_date: replacement.consumption_date,
                consumed_quantity: replacement.consumed_quantity,
                quantity_unit: replacement.quantity_unit,
              }, signal, userId);
              if (estimate.status !== "ok" || estimate.missing_fields.length > 0) {
                assistantMessage = await insertMessage(pool, {
                  userId,
                  conversationId,
                  role: "assistant",
                  content: estimate.clarification ?? "The new quantity needs more detail before it can be estimated.",
                });
                break;
              }
              replacement = createMealSchema.parse({
                ...replacement,
                ...estimate.nutrition,
                entry_source: "manual",
                is_estimate: true,
              });
            }
            assistantMessage = await assistantWithProposal(userId, conversationId, {
              kind: "meal_update",
              meal_id: resolved.meal.id,
              meal: replacement,
              expected_updated_at: resolved.meal.updated_at,
            });
            break;
          }
          case "proposeMealDelete": {
            const { match } = deleteIntentSchema.parse(decoded);
            const resolved = await resolveMatch(userId, match);
            assistantMessage = resolved.meal
              ? await assistantWithProposal(userId, conversationId, {
                  kind: "meal_delete",
                  meal_id: resolved.meal.id,
                  food_name: resolved.meal.food_name,
                  expected_updated_at: resolved.meal.updated_at,
                })
              : await insertMessage(pool, {
                  userId,
                  conversationId,
                  role: "assistant",
                  content: resolved.message ?? "Choose one meal.",
                });
            break;
          }
          case "proposeGoalReplacement": {
            const { changes } = goalIntentSchema.parse(decoded);
            const current = await findSingletonGoals(pool, userId);
            if (!current) throw new AppError({ status: 500, code: "INTERNAL_ERROR", message: "Goals are unavailable." });
            const goals = goalSchema.parse({
              daily_calories_kcal: current.daily_calories_kcal,
              daily_protein_g: current.daily_protein_g,
              daily_carbs_g: current.daily_carbs_g,
              daily_fat_g: current.daily_fat_g,
              target_weight_kg: current.target_weight_kg,
              ...changes,
            });
            assistantMessage = await assistantWithProposal(userId, conversationId, {
              kind: "goals_replace",
              goals,
              expected_updated_at: current.updated_at,
            });
            break;
          }
        }

        await touchConversation(pool, userId, conversationId);
        return { user_message: userMessage, assistant_message: assistantMessage };
      } catch (error) {
        if (error instanceof ProviderFailure) {
          if (error.kind === "user_cancellation") throw error;
          throw providerError(error);
        }
        if (error instanceof ZodError || error instanceof SyntaxError) {
          throw new AppError({
            status: 502,
            code: "AI_INVALID_OUTPUT",
            message: "Gemini selected invalid chat tool arguments.",
          });
        }
        throw error;
      }
    },

    async createImageProposal({ userId, conversationId, meal, assumptions }) {
      await requireConversation(userId, conversationId);
      const validatedMeal = createMealSchema.parse(meal);
      const note = assumptions.length > 0
        ? " Image assumptions: " + assumptions.join("; ")
        : "";
      return assistantWithProposal(userId, conversationId, {
        kind: "meal_create",
        meal: validatedMeal,
      }, note);
    },

    async getProposal(userId, proposalId) {
      const proposal = await findProposal(pool, userId, proposalId);
      if (!proposal) throw notFound("proposal");
      return proposal;
    },

    confirmProposal: confirmAction,
    cancelProposal: cancelAction,
  };
}
