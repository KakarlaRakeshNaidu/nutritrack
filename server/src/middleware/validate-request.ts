import type { RequestHandler } from "express";
import type { ZodError } from "zod";

import { requestValidationError } from "../utils/errors.js";

const REQUEST_LOCATIONS = ["body", "query", "params"] as const;
type RequestLocation = (typeof REQUEST_LOCATIONS)[number];
interface RequestSchema {
  safeParse(value: unknown):
    | { success: true; data: unknown }
    | { success: false; error: ZodError };
}

type RequestSchemas = Partial<Record<RequestLocation, RequestSchema>>;
type ValidatedLocations = Partial<Record<RequestLocation, unknown>>;

export function validateRequest(schemas: RequestSchemas): RequestHandler {
  return function requestValidation(request, response, next): void {
    try {
      const validated: ValidatedLocations = {};

      for (const location of REQUEST_LOCATIONS) {
        const schema = schemas[location];

        if (!schema) {
          continue;
        }

        const result = schema.safeParse(request[location]);

        if (!result.success) {
          next(requestValidationError(result.error));
          return;
        }

        validated[location] = result.data;
      }

      // Express 5 exposes req.query through a getter. Keeping parsed values in
      // locals avoids mutating framework-owned request properties.
      response.locals.validated = validated;
      next();
    } catch (error) {
      // A schema implementation that throws is a programming failure, not a
      // user validation error, so the central handler maps it to generic 500.
      next(error);
    }
  };
}
