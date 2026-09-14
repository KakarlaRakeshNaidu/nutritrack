import type { RequestHandler } from "express";

import { AppError } from "../utils/errors.js";

export const notFound: RequestHandler = (_request, _response, next): void => {
  next(
    new AppError({
      status: 404,
      code: "ROUTE_NOT_FOUND",
      message: "The requested route does not exist.",
      details: [],
    }),
  );
};
