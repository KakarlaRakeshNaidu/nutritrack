import express from "express";
import type { Express, Request, RequestHandler } from "express";

import { validateRequest } from "../../middleware/validate-request.js";
import { AppError } from "../../utils/errors.js";
import type { DatabaseExecutor } from "../../types.js";
import { createGoalController } from "./goal.controller.js";
import {
  absentGoalBodySchema,
  goalQuerySchema,
  goalSchema,
} from "./goal.schemas.js";
import { createGoalService } from "./goal.service.js";

function requestHasBody(request: Request): boolean {
  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined) {
    const parsed = Number(contentLength);
    return Number.isFinite(parsed) && parsed > 0;
  }

  return request.headers["transfer-encoding"] !== undefined;
}

export const enforceGoalBodyContract: RequestHandler = (request, _response, next): void => {
  if (request.method === "GET" && requestHasBody(request)) {
    next(
      new AppError({
        status: 422,
        code: "VALIDATION_ERROR",
        message: "Please correct the highlighted fields.",
        details: [{ field: "body", message: "Request body is not allowed." }],
      }),
    );
    return;
  }

  if (
    request.method === "PUT" &&
    requestHasBody(request) &&
    !request.is("application/json")
  ) {
    next(
      new AppError({
        status: 415,
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "Goal replacement requires an application/json request body.",
        details: [{ field: "", message: "Use Content-Type application/json." }],
      }),
    );
    return;
  }

  next();
};

export function registerGoalRoutes(app: Express, { pool }: { pool: DatabaseExecutor }): void {
  const router = express.Router();
  const service = createGoalService({ pool });
  const controller = createGoalController(service);

  router.get(
    "/",
    validateRequest({
      body: absentGoalBodySchema,
      query: goalQuerySchema,
    }),
    controller.getGoals,
  );
  router.put(
    "/",
    validateRequest({ body: goalSchema, query: goalQuerySchema }),
    controller.replaceGoals,
  );

  app.use("/api/v1/goals", router);
}
