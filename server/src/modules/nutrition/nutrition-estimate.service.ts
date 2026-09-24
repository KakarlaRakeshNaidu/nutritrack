import type { ProviderState } from "../../config/env.js";
import type { Clock, DatabaseExecutor } from "../../types.js";
import { isConsumptionDateAllowed } from "../../utils/calendar.js";
import { AppError } from "../../utils/errors.js";
import { createProfileService } from "../profile/profile.service.js";
import {
  createGeminiEstimateAdapter,
  type NutritionEstimateAdapter,
} from "./gemini-estimate.adapter.js";
import { ProviderFailure } from "./nutrition.failures.js";
import {
  buildEstimateResult,
  type EstimateResult,
  type MealBasicsInput,
} from "./nutrition-estimate.schemas.js";

const PROVIDER_TIMEOUT_MS = 25_000;

export interface NutritionEstimateService {
  estimate(
    basics: MealBasicsInput,
    signal: AbortSignal,
    userId: string,
  ): Promise<EstimateResult>;
}

function providerError(failure: ProviderFailure): AppError {
  if (failure.kind === "configuration") {
    return new AppError({
      status: 503,
      code: "AI_CONFIGURATION_ERROR",
      message: "Nutrition estimation is not configured.",
    });
  }
  if (failure.kind === "output_invalid") {
    return new AppError({
      status: 502,
      code: "AI_INVALID_OUTPUT",
      message: "The nutrition provider returned invalid output.",
    });
  }
  if (failure.kind === "content") {
    return new AppError({
      status: 422,
      code: "AI_ANALYSIS_REFUSED",
      message: "The provider could not estimate nutrition for these details.",
    });
  }
  if (failure.kind === "application_bug") {
    return new AppError({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    });
  }
  return new AppError({
    status: 503,
    code: "AI_PROVIDERS_UNAVAILABLE",
    message: "The nutrition provider is temporarily unavailable.",
  });
}

export function createNutritionEstimateService({
  pool,
  providers,
  clock,
  gemini = createGeminiEstimateAdapter(providers.gemini),
}: {
  pool: DatabaseExecutor;
  providers: Record<"gemini", ProviderState>;
  clock?: Clock;
  gemini?: NutritionEstimateAdapter;
}): NutritionEstimateService {
  const profileService = createProfileService({ pool, clock });

  return {
    async estimate(basics, signal, userId) {
      // Resolve the persisted timezone before provider work without holding a
      // transaction or database connection during the external request.
      const { today } = await profileService.getProfile(userId);
      if (!isConsumptionDateAllowed(basics.consumption_date, today)) {
        throw new AppError({
          status: 422,
          code: "VALIDATION_ERROR",
          message: "Please correct the highlighted fields.",
          details: [{
            field: "consumption_date",
            message: "Consumption date cannot be after today.",
          }],
        });
      }

      try {
        const output = await gemini.estimate({
          basics,
          signal,
          timeoutMs: PROVIDER_TIMEOUT_MS,
        });
        return buildEstimateResult(output);
      } catch (error) {
        if (!(error instanceof ProviderFailure)) throw error;
        if (error.kind === "user_cancellation") throw error;
        throw providerError(error);
      }
    },
  };
}
