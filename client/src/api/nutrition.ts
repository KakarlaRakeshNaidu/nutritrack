import { z } from "zod";

import type {
  ExtractionResult,
  ImageType,
  MealBasicsPayload,
  NutritionEstimateResult,
} from "../types";
import { isValidDateOnly } from "../utils/dates";
import { ApiError, apiRequest } from "./client";

const nullableNutrient = z.number().finite().min(0).max(1_000_000).nullable();
const micronutrientsSchema = z.strictObject({
  sodium_mg: nullableNutrient,
  calcium_mg: nullableNutrient,
  iron_mg: nullableNutrient,
  potassium_mg: nullableNutrient,
  vitamin_c_mg: nullableNutrient,
  vitamin_d_mcg: nullableNutrient,
});

const extractionResultSchema = z
  .strictObject({
    provider: z.literal("gemini"),
    image_type: z.enum(["nutrition_label", "food_plate"]),
    is_estimate: z.boolean(),
    source_basis: z.string().max(200).nullable(),
    assumptions: z.array(z.string().max(200)).max(10),
    draft: z.strictObject({
      food_name: z.string().trim().min(1).max(200).nullable(),
      meal_type: z.enum(["breakfast", "lunch", "dinner", "snacks"]).nullable(),
      consumption_date: z.string().refine(isValidDateOnly),
      consumed_quantity: z.number().finite().positive().max(1_000_000).nullable(),
      quantity_unit: z.enum(["g", "ml", "serving", "piece"]).nullable(),
      calories_kcal: nullableNutrient,
      protein_g: nullableNutrient,
      carbs_g: nullableNutrient,
      fat_g: nullableNutrient,
      micronutrients: micronutrientsSchema,
      entry_source: z.enum(["nutrition_label", "food_plate"]),
      is_estimate: z.boolean(),
    }),
    missing_fields: z.array(z.string()).max(8),
  })
  .superRefine((result, context) => {
    if (
      result.draft.entry_source !== result.image_type ||
      result.draft.is_estimate !== result.is_estimate ||
      result.is_estimate !== (result.image_type === "food_plate")
    ) {
      context.addIssue({
        code: "custom",
        path: ["draft", "entry_source"],
        message: "Extraction provenance was inconsistent.",
      });
    }
  });

const extractionEnvelopeSchema = z.strictObject({
  data: extractionResultSchema,
});

export const EXTRACTION_TIMEOUT_MS = 60_000;

const estimateResultSchema = z.strictObject({
  provider: z.literal("gemini"),
  status: z.enum(["ok", "needs_clarification"]),
  nutrition: z.strictObject({
    calories_kcal: nullableNutrient,
    protein_g: nullableNutrient,
    carbs_g: nullableNutrient,
    fat_g: nullableNutrient,
    micronutrients: micronutrientsSchema,
  }),
  is_estimate: z.literal(true),
  assumptions: z.array(z.string().max(200)).max(10),
  clarification: z.string().max(500).nullable(),
  missing_fields: z.array(
    z.enum(["calories_kcal", "protein_g", "carbs_g", "fat_g"]),
  ).max(4),
});

const estimateEnvelopeSchema = z.strictObject({ data: estimateResultSchema });

export async function extractNutrition(
  file: File,
  imageType: ImageType,
  {
    signal,
    timeoutMs = EXTRACTION_TIMEOUT_MS,
  }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ExtractionResult> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();

  if (signal?.aborted) {
    abortFromCaller();
  } else {
    signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const form = new FormData();
  form.append("image", file);
  form.append("image_type", imageType);

  try {
    const response = await apiRequest<unknown>("/nutrition/extract", {
      method: "POST",
      body: form,
      signal: controller.signal,
      ambiguousOnNetworkError: false,
    });
    const parsed = extractionEnvelopeSchema.safeParse(response);
    if (!parsed.success) {
      throw new ApiError({
        code: "INVALID_RESPONSE",
        message: "The server returned an invalid nutrition draft.",
      });
    }
    return parsed.data.data;
  } catch (error) {
    if (
      timedOut &&
      error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError"
    ) {
      throw new ApiError({
        code: "REQUEST_TIMEOUT",
        message: "Image analysis took longer than 60 seconds. Try again.",
      });
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function estimateNutrition(
  basics: MealBasicsPayload,
  {
    signal,
    timeoutMs = EXTRACTION_TIMEOUT_MS,
  }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<NutritionEstimateResult> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });

  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await apiRequest<unknown>("/nutrition/estimate", {
      method: "POST",
      body: basics,
      signal: controller.signal,
      ambiguousOnNetworkError: false,
    });
    const parsed = estimateEnvelopeSchema.safeParse(response);
    if (!parsed.success) {
      throw new ApiError({
        code: "INVALID_RESPONSE",
        message: "The server returned an invalid nutrition estimate.",
      });
    }
    return parsed.data.data;
  } catch (error) {
    if (
      timedOut &&
      error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError"
    ) {
      throw new ApiError({
        code: "REQUEST_TIMEOUT",
        message: "Nutrition estimation took longer than 60 seconds. Try again.",
      });
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
