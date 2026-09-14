import type { Express, Request, RequestHandler } from "express";

import type { Clock, DatabasePool } from "../../types.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { AppError } from "../../utils/errors.js";
import { absentBodySchema } from "../meals/meal.schemas.js";
import { createReportController } from "./report.controller.js";
import { reportQuerySchema } from "./report.schemas.js";
import { createReportService } from "./report.service.js";

function requestHasBody(request: Request): boolean {
  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined) {
    const parsed = Number(contentLength);
    return Number.isFinite(parsed) && parsed > 0;
  }
  return request.headers["transfer-encoding"] !== undefined;
}

export const enforceReportBodyContract: RequestHandler = (request, _response, next): void => {
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
  next();
};

export function registerReportRoutes(
  app: Express,
  { pool, clock }: { pool: DatabasePool; clock?: Clock },
): void {
  const service = createReportService({ pool, clock });
  const controller = createReportController(service);

  app.get(
    "/api/v1/reports/nutrition",
    validateRequest({
      body: absentBodySchema,
      query: reportQuerySchema,
    }),
    controller.getNutritionReport,
  );
}
