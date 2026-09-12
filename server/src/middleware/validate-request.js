import { requestValidationError } from "../utils/errors.js";

const REQUEST_LOCATIONS = ["body", "query", "params"];

export function validateRequest(schemas) {
  return function requestValidation(request, response, next) {
    try {
      const validated = {};

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
