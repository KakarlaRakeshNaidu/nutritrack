import { AppError } from "../utils/errors.js";

export function notFound(_request, _response, next) {
  next(
    new AppError({
      status: 404,
      code: "ROUTE_NOT_FOUND",
      message: "The requested route does not exist.",
      details: [],
    }),
  );
}
