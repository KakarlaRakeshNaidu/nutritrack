import { AppError } from "../utils/errors.js";

function mapBodyParserError(error) {
  if (error?.type === "entity.parse.failed") {
    return new AppError({
      status: 400,
      code: "MALFORMED_JSON",
      message: "The request body contains malformed JSON.",
      details: [{ field: "", message: "Provide valid JSON." }],
    });
  }

  if (error?.type === "entity.too.large") {
    return new AppError({
      status: 413,
      code: "REQUEST_TOO_LARGE",
      message: "The JSON request body is too large.",
      details: [{ field: "", message: "The maximum JSON body is 100000 bytes." }],
    });
  }

  return null;
}

function internalError() {
  return new AppError({
    status: 500,
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred.",
    details: [],
  });
}

export function errorHandler({ logger = console } = {}) {
  return function handleError(error, request, response, next) {
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
