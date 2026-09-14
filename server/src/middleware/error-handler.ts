import type { ErrorRequestHandler } from "express";

import {
  JSON_BODY_LIMIT_BYTES,
  MEAL_JSON_BODY_LIMIT_BYTES,
} from "../config/constants.js";
import { AppError } from "../utils/errors.js";
import type { Logger } from "../types.js";

function parserProperty(error: unknown, property: "type" | "limit"): unknown {
  if (!error || typeof error !== "object" || !(property in error)) {
    return undefined;
  }

  return Reflect.get(error, property);
}

function mapBodyParserError(error: unknown): AppError | null {
  const type = parserProperty(error, "type");
  if (type === "entity.parse.failed") {
    return new AppError({
      status: 400,
      code: "MALFORMED_JSON",
      message: "The request body contains malformed JSON.",
      details: [{ field: "", message: "Provide valid JSON." }],
    });
  }

  if (type === "entity.too.large") {
    const limit =
      parserProperty(error, "limit") === MEAL_JSON_BODY_LIMIT_BYTES
        ? MEAL_JSON_BODY_LIMIT_BYTES
        : JSON_BODY_LIMIT_BYTES;
    return new AppError({
      status: 413,
      code: "REQUEST_TOO_LARGE",
      message: "The JSON request body is too large.",
      details: [{ field: "", message: "The maximum JSON body is " + limit + " bytes." }],
    });
  }

  return null;
}

function internalError(): AppError {
  return new AppError({
    status: 500,
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred.",
    details: [],
  });
}

export function errorHandler(
  { logger = console }: { logger?: Logger } = {},
): ErrorRequestHandler {
  return function handleError(error, request, response, next): void {
    if (response.headersSent) {
      next(error);
      return;
    }

    const mappedParserError = mapBodyParserError(error);
    const clientError =
      error instanceof AppError ? error : (mappedParserError ?? internalError());
    const requestId = response.locals.requestId;

    // Log only bounded, application-owned context. Arbitrary error objects and
    // messages can contain request bodies, URLs, credentials, or provider data.
    logger.error(
      `request_id=${requestId} code=${clientError.code} method=${request.method}`,
    );

    response.status(clientError.status).json({
      error: {
        code: clientError.code,
        message: clientError.message,
        details: clientError.details,
        request_id: requestId,
      },
    });
  };
}
