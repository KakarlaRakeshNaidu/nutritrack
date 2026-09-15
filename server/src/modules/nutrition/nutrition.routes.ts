import express from "express";
import type { Express, Request, Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import multer from "multer";

import type { AppConfig } from "../../config/env.js";
import { JSON_BODY_LIMIT_BYTES } from "../../config/constants.js";
import { validateRequest } from "../../middleware/validate-request.js";
import type { Clock, DatabasePool } from "../../types.js";
import { AppError } from "../../utils/errors.js";
import {
  ImageProcessingError,
  MAX_IMAGE_BYTES,
  SUPPORTED_IMAGE_MIMES,
} from "./image-processing.js";
import { ProviderFailure } from "./nutrition.failures.js";
import { imageTypeSchema } from "./nutrition.schemas.js";
import {
  mealBasicsSchema,
} from "./nutrition-estimate.schemas.js";
import {
  createNutritionEstimateService,
  type NutritionEstimateService,
} from "./nutrition-estimate.service.js";
import {
  createExtractionService,
  type ExtractionService,
} from "./nutrition.service.js";

const UPLOAD_TIMEOUT_MS = 15_000;
const MAX_CONCURRENT_EXTRACTIONS = 2;
const RATE_WINDOW_MS = 10 * 60 * 1_000;
const RATE_MAX = 10;

export class ExtractionRuntime {
  private activeCount = 0;
  private readonly controllers = new Set<AbortController>();

  acquire(): (() => void) | null {
    if (this.activeCount >= MAX_CONCURRENT_EXTRACTIONS) {
      return null;
    }
    this.activeCount += 1;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.activeCount -= 1;
      }
    };
  }

  track(controller: AbortController): () => void {
    this.controllers.add(controller);
    return () => this.controllers.delete(controller);
  }

  cancelAll(): void {
    for (const controller of this.controllers) {
      controller.abort("server-shutdown");
    }
  }

  get active(): number {
    return this.activeCount;
  }
}

interface NutritionRouteDependencies {
  pool: DatabasePool;
  config: Pick<AppConfig, "providers">;
  clock?: Clock;
  service?: ExtractionService;
  estimateService?: NutritionEstimateService;
  runtime?: ExtractionRuntime;
  rateMax?: number;
  rateWindowMs?: number;
  uploadTimeoutMs?: number;
}

function requestError(
  status: number,
  code: string,
  message: string,
  field = "",
): AppError {
  return new AppError({
    status,
    code,
    message,
    details: field ? [{ field, message }] : [],
  });
}

function mapUploadError(error: unknown): AppError {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return requestError(413, "IMAGE_TOO_LARGE", "The image exceeds 10,000,000 bytes.", "image");
    }
    return requestError(422, "VALIDATION_ERROR", "The multipart fields are invalid.");
  }
  return requestError(400, "MALFORMED_MULTIPART", "The multipart request is malformed.");
}

function uploadOnce(
  upload: ReturnType<typeof multer>,
  timeoutMs: number,
): (request: Request, response: Response) => Promise<void> {
  const parse = upload.single("image");
  return async (request, response): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) {
          return;
        }
        done = true;
        request.unpipe();
        request.resume();
        response.setHeader("Connection", "close");
        response.once("finish", () => request.destroy());
        reject(requestError(408, "UPLOAD_TIMEOUT", "The multipart upload timed out."));
      }, timeoutMs);
      timer.unref();
      parse(request, response, (error?: unknown) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        if (error) {
          reject(mapUploadError(error));
        } else {
          resolve();
        }
      });
    });
  };
}

function hasNoQuery(request: Request): boolean {
  return Object.keys(request.query).length === 0;
}

export function registerNutritionRoutes(
  app: Express,
  {
    pool,
    config,
    clock,
    service = createExtractionService({ pool, providers: config.providers, clock }),
    estimateService = createNutritionEstimateService({
      pool,
      providers: config.providers,
      clock,
    }),
    runtime = new ExtractionRuntime(),
    rateMax = RATE_MAX,
    rateWindowMs = RATE_WINDOW_MS,
    uploadTimeoutMs = UPLOAD_TIMEOUT_MS,
  }: NutritionRouteDependencies,
): ExtractionRuntime {
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      // Busboy emits its limit event at the sentinel byte/part. One extra byte
      // is bounded in memory, then rejected explicitly below, which makes the
      // documented 10,000,000-byte maximum inclusive.
      fileSize: MAX_IMAGE_BYTES + 1,
      files: 1,
      fields: 2,
      parts: 3,
      fieldSize: 100,
    },
  });
  const parseUpload = uploadOnce(upload, uploadTimeoutMs);
  // One limiter instance and one runtime are shared by image and text work, so
  // adding estimation cannot double the process or per-IP AI budget.
  const aiRateLimit = rateLimit({
    windowMs: rateWindowMs,
    limit: rateMax,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (request) => ipKeyGenerator(request.ip ?? "unknown"),
    handler(request, response) {
      response.status(429).json({
        error: {
          code: "AI_RATE_LIMITED",
          message: "Too many nutrition AI requests.",
          details: [],
          request_id: response.locals.requestId,
        },
      });
    },
  });

  router.post(
    "/extract",
    aiRateLimit,
    async (request, response, next): Promise<void> => {
      if (!request.is("multipart/form-data")) {
        next(requestError(415, "UNSUPPORTED_MEDIA_TYPE", "Use multipart/form-data."));
        return;
      }
      if (!hasNoQuery(request)) {
        next(requestError(422, "VALIDATION_ERROR", "Query parameters are not allowed."));
        return;
      }
      const release = runtime.acquire();
      if (!release) {
        response.setHeader("Retry-After", "1");
        next(requestError(429, "AI_BUSY", "Image extraction capacity is busy."));
        return;
      }

      const controller = new AbortController();
      const untrack = runtime.track(controller);
      const onAborted = (): void => controller.abort("caller-disconnected");
      const onClose = (): void => {
        if (!response.writableEnded) {
          controller.abort("caller-disconnected");
        }
      };
      request.once("aborted", onAborted);
      response.once("close", onClose);

      try {
        await parseUpload(request, response);
        if (!request.file || request.file.buffer.byteLength === 0) {
          throw requestError(422, "VALIDATION_ERROR", "A nonempty image is required.", "image");
        }
        if (request.file.buffer.byteLength > MAX_IMAGE_BYTES) {
          throw requestError(
            413,
            "IMAGE_TOO_LARGE",
            "The image exceeds 10,000,000 bytes.",
            "image",
          );
        }
        if (Object.keys(request.body).length !== 1) {
          throw requestError(422, "VALIDATION_ERROR", "Exactly one image_type field is required.");
        }
        if (!SUPPORTED_IMAGE_MIMES.includes(
          request.file.mimetype as (typeof SUPPORTED_IMAGE_MIMES)[number],
        )) {
          throw requestError(415, "UNSUPPORTED_MEDIA_TYPE", "The declared image type is unsupported.", "image");
        }
        const parsedType = imageTypeSchema.safeParse(request.body.image_type);
        if (!parsedType.success) {
          throw requestError(422, "VALIDATION_ERROR", "Select a supported image mode.", "image_type");
        }

        const result = await service.extract({
          image: request.file.buffer,
          declaredMime: request.file.mimetype,
          imageType: parsedType.data,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          response.json({ data: result });
        }
      } catch (error) {
        if (controller.signal.aborted) {
          if (controller.signal.reason === "server-shutdown") {
            next(requestError(
              503,
              "AI_PROVIDERS_UNAVAILABLE",
              "Image extraction stopped because the server is shutting down.",
            ));
          }
          return;
        }
        if (error instanceof ProviderFailure && error.kind === "user_cancellation") {
          return;
        }
        if (error instanceof ImageProcessingError) {
          next(requestError(
            error.code === "unsupported" ? 415 : 422,
            error.code === "unsupported" ? "UNSUPPORTED_MEDIA_TYPE" : "IMAGE_INVALID",
            error.code === "unsupported"
              ? "The declared and decoded image types must match."
              : "The image could not be safely decoded.",
            "image",
          ));
          return;
        }
        next(error);
      } finally {
        request.off("aborted", onAborted);
        response.off("close", onClose);
        untrack();
        // The service/image worker has completed or acknowledged cancellation
        // before the request-owned admission lease is released exactly once.
        release();
      }
    },
  );

  router.post(
    "/estimate",
    (request, _response, next): void => {
      if (!request.is("application/json")) {
        next(requestError(
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "Nutrition estimation requires application/json.",
        ));
        return;
      }
      next();
    },
    express.json({
      limit: JSON_BODY_LIMIT_BYTES,
      type: ["application/json"],
    }),
    aiRateLimit,
    validateRequest({ body: mealBasicsSchema }),
    async (request, response, next): Promise<void> => {
      if (!hasNoQuery(request)) {
        next(requestError(
          422,
          "VALIDATION_ERROR",
          "Query parameters are not allowed.",
        ));
        return;
      }
      const release = runtime.acquire();
      if (!release) {
        response.setHeader("Retry-After", "1");
        next(requestError(
          429,
          "AI_BUSY",
          "Nutrition AI capacity is busy.",
        ));
        return;
      }

      const controller = new AbortController();
      const untrack = runtime.track(controller);
      const onAborted = (): void => controller.abort("caller-disconnected");
      const onClose = (): void => {
        if (!response.writableEnded) controller.abort("caller-disconnected");
      };
      request.once("aborted", onAborted);
      response.once("close", onClose);

      try {
        const result = await estimateService.estimate(
          request.body,
          controller.signal,
        );
        if (!controller.signal.aborted) response.json({ data: result });
      } catch (error) {
        if (controller.signal.aborted) {
          if (controller.signal.reason === "server-shutdown") {
            next(requestError(
              503,
              "AI_PROVIDERS_UNAVAILABLE",
              "Nutrition estimation stopped because the server is shutting down.",
            ));
          }
          return;
        }
        if (
          error instanceof ProviderFailure &&
          error.kind === "user_cancellation"
        ) {
          return;
        }
        next(error);
      } finally {
        request.off("aborted", onAborted);
        response.off("close", onClose);
        untrack();
        release();
      }
    },
  );

  app.use("/api/v1/nutrition", router);
  return runtime;
}
