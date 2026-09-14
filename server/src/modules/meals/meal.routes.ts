import express from "express";
import type { Express, Request, RequestHandler } from "express";

import { MEAL_JSON_BODY_LIMIT_BYTES } from "../../config/constants.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { AppError } from "../../utils/errors.js";
import type { Clock, DatabasePool } from "../../types.js";
import { createMealController } from "./meal.controller.js";
import {
  absentBodySchema,
  createMealSchema,
  emptyQuerySchema,
  mealIdParamSchema,
  mealListQuerySchema,
  updateMealSchema,
} from "./meal.schemas.js";
import { createMealService } from "./meal.service.js";

const MUTATION_METHODS = new Set(["POST", "PUT"]);

function requestHasBody(request: Request): boolean {
  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined) {
    const parsed = Number(contentLength);
    return Number.isFinite(parsed) && parsed > 0;
  }

  return request.headers["transfer-encoding"] !== undefined;
}

function unsupportedMediaType(): AppError {
  return new AppError({
    status: 415,
    code: "UNSUPPORTED_MEDIA_TYPE",
    message: "Meal mutations require an application/json request body.",
    details: [{ field: "", message: "Use Content-Type application/json." }],
  });
}

function unexpectedBody(): AppError {
  return new AppError({
    status: 422,
    code: "VALIDATION_ERROR",
    message: "Please correct the highlighted fields.",
    details: [{ field: "body", message: "Request body is not allowed." }],
  });
}

const requireMutationJson: RequestHandler = (request, _response, next): void => {
  if (
    MUTATION_METHODS.has(request.method) &&
    requestHasBody(request) &&
    !request.is("application/json")
  ) {
    next(unsupportedMediaType());
    return;
  }

  next();
};

const rejectReadBody: RequestHandler = (request, _response, next): void => {
  if (
    !MUTATION_METHODS.has(request.method) &&
    requestHasBody(request)
  ) {
    next(unexpectedBody());
    return;
  }

  next();
};

export function registerMealRoutes(
  app: Express,
  { pool, clock }: { pool: DatabasePool; clock?: Clock },
): void {
  const router = express.Router();
  const service = createMealService({ pool, clock });
  const controller = createMealController(service);

  // This parser is mounted before the broader API parser so actual stream bytes
  // for meal routes are capped at exactly 64 KiB, not merely Content-Length.
  router.use(requireMutationJson);
  router.use(
    express.json({
      limit: MEAL_JSON_BODY_LIMIT_BYTES,
      type: ["application/json"],
    }),
  );
  router.use(rejectReadBody);

  router.post(
    "/",
    validateRequest({ body: createMealSchema, query: emptyQuerySchema }),
    controller.createMeal,
  );
  router.get(
    "/",
    validateRequest({
      body: absentBodySchema,
      query: mealListQuerySchema,
    }),
    controller.listMeals,
  );
  router.get(
    "/:id",
    validateRequest({
      body: absentBodySchema,
      params: mealIdParamSchema,
      query: emptyQuerySchema,
    }),
    controller.getMeal,
  );
  router.put(
    "/:id",
    validateRequest({
      body: updateMealSchema,
      params: mealIdParamSchema,
      query: emptyQuerySchema,
    }),
    controller.updateMeal,
  );
  router.delete(
    "/:id",
    validateRequest({
      body: absentBodySchema,
      params: mealIdParamSchema,
      query: emptyQuerySchema,
    }),
    controller.deleteMeal,
  );

  app.use("/api/v1/meals", router);
}
