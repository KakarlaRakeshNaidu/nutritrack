import type { ProviderState } from "../../config/env.js";
import type { Clock, DatabaseExecutor } from "../../types.js";
import { AppError } from "../../utils/errors.js";
import { createProfileService } from "../profile/profile.service.js";
import { createGeminiAdapter } from "./gemini.adapter.js";
import { normalizeImage, type NormalizedImage } from "./image-processing.js";
import { ProviderFailure } from "./nutrition.failures.js";
import {
  buildExtractionResult,
  type ExtractionResult,
  type ImageType,
} from "./nutrition.schemas.js";
import type { ProviderAdapter } from "./provider-common.js";

const PROVIDER_TIMEOUT_MS = 25_000;
const OVERALL_TIMEOUT_MS = 55_000;

export interface ExtractionService {
  extract(input: {
    image: Buffer;
    declaredMime: string;
    imageType: ImageType;
    signal: AbortSignal;
  }): Promise<ExtractionResult>;
}

interface ExtractionServiceDependencies {
  pool: DatabaseExecutor;
  providers: Record<"gemini", ProviderState>;
  clock?: Clock;
  now?: () => number;
  normalize?: (
    input: Buffer,
    declaredMime: string,
    signal: AbortSignal,
  ) => Promise<NormalizedImage>;
  gemini?: ProviderAdapter;
}

function clientErrorForContent(failure: ProviderFailure): AppError {
  if (failure.contentStatus === "not_food") {
    return new AppError({
      status: 422,
      code: "IMAGE_NOT_FOOD",
      message: "The image does not appear to contain food or a nutrition label.",
    });
  }
  if (failure.contentStatus === "refused") {
    return new AppError({
      status: 422,
      code: "IMAGE_ANALYSIS_REFUSED",
      message: "The provider could not analyze this image.",
    });
  }
  return new AppError({
    status: 422,
    code: "IMAGE_UNREADABLE",
    message: "The food or nutrition information is not readable.",
  });
}

function configurationError(): AppError {
  return new AppError({
    status: 503,
    code: "AI_CONFIGURATION_ERROR",
    message: "Image extraction is not configured.",
  });
}

function providerFailure(failure: ProviderFailure): AppError {
  // Gemini availability and output failures retain their existing public error
  // classes; configuration, content, programming, and cancellation are handled
  // at their narrower boundaries below.
  if (failure.kind === "output_invalid") {
    return new AppError({
      status: 502,
      code: "AI_INVALID_OUTPUT",
      message: "The image provider returned invalid output.",
    });
  }
  return new AppError({
    status: 503,
    code: "AI_PROVIDERS_UNAVAILABLE",
    message: "The image provider is temporarily unavailable.",
  });
}

export function createExtractionService({
  pool,
  providers,
  clock,
  now = Date.now,
  normalize = normalizeImage,
  gemini = createGeminiAdapter(providers.gemini),
}: ExtractionServiceDependencies): ExtractionService {
  const profileService = createProfileService({ pool, clock });

  return {
    async extract({ image, declaredMime, imageType, signal }) {
      const startedAt = now();
      const normalized = await normalize(image, declaredMime, signal);
      const remainingBeforePrimary = OVERALL_TIMEOUT_MS - (now() - startedAt);
      if (remainingBeforePrimary <= 0) {
        throw new AppError({
          status: 503,
          code: "AI_PROVIDERS_UNAVAILABLE",
          message: "Image extraction timed out.",
        });
      }

      try {
        const output = await gemini.analyze({
          image: normalized.buffer,
          imageType,
          signal,
          timeoutMs: Math.min(PROVIDER_TIMEOUT_MS, remainingBeforePrimary),
        });
        const profile = await profileService.getProfile();
        return buildExtractionResult({
          provider: "gemini",
          imageType,
          output,
          today: profile.today,
        });
      } catch (error) {
        if (!(error instanceof ProviderFailure)) {
          throw error;
        }
        if (error.kind === "configuration") {
          throw configurationError();
        }
        if (error.kind === "content") {
          throw clientErrorForContent(error);
        }
        if (error.kind === "application_bug") {
          throw new AppError({
            status: 500,
            code: "INTERNAL_ERROR",
            message: "An unexpected error occurred.",
          });
        }
        if (error.kind === "user_cancellation") {
          throw error;
        }
        throw providerFailure(error);
      }
    },
  };
}
