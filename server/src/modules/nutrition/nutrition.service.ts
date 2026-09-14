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
import { createGrokAdapter } from "./grok.adapter.js";
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
  providers: Record<"gemini" | "grok", ProviderState>;
  clock?: Clock;
  now?: () => number;
  normalize?: (
    input: Buffer,
    declaredMime: string,
    signal: AbortSignal,
  ) => Promise<NormalizedImage>;
  gemini?: ProviderAdapter;
  grok?: ProviderAdapter;
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

function finalFailure(primary: ProviderFailure, fallback: ProviderFailure): AppError {
  // Failure classes are deliberately narrow: configuration/content/programming
  // failures are terminal; only availability and invalid output can reach here.
  if (fallback.kind === "configuration") {
    return configurationError();
  }
  if (fallback.kind === "content") {
    return clientErrorForContent(fallback);
  }
  if (fallback.kind === "application_bug") {
    return new AppError({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    });
  }
  if (primary.kind === "output_invalid" && fallback.kind === "output_invalid") {
    return new AppError({
      status: 502,
      code: "AI_INVALID_OUTPUT",
      message: "Image providers returned invalid output.",
    });
  }
  return new AppError({
    status: 503,
    code: "AI_PROVIDERS_UNAVAILABLE",
    message: "Image providers are temporarily unavailable.",
  });
}

export function createExtractionService({
  pool,
  providers,
  clock,
  now = Date.now,
  normalize = normalizeImage,
  gemini = createGeminiAdapter(providers.gemini),
  grok = createGrokAdapter(providers.grok),
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

      let primaryFailure: ProviderFailure;
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
        primaryFailure = error;
      }

      if (providers.grok.status !== "configured") {
        throw new AppError({
          status: 503,
          code: "AI_FALLBACK_UNAVAILABLE",
          message: "The fallback image provider is not configured.",
        });
      }
      const remainingBeforeFallback = OVERALL_TIMEOUT_MS - (now() - startedAt);
      if (remainingBeforeFallback <= 0) {
        throw new AppError({
          status: 503,
          code: "AI_PROVIDERS_UNAVAILABLE",
          message: "Image providers are temporarily unavailable.",
        });
      }

      try {
        const output = await grok.analyze({
          image: normalized.buffer,
          imageType,
          signal,
          timeoutMs: Math.min(PROVIDER_TIMEOUT_MS, remainingBeforeFallback),
        });
        const profile = await profileService.getProfile();
        return buildExtractionResult({
          provider: "grok",
          imageType,
          output,
          today: profile.today,
        });
      } catch (error) {
        if (!(error instanceof ProviderFailure)) {
          throw error;
        }
        if (error.kind === "user_cancellation") {
          throw error;
        }
        throw finalFailure(primaryFailure, error);
      }
    },
  };
}
