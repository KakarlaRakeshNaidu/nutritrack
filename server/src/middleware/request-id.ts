import type { RequestHandler } from "express";

import { randomUUID } from "node:crypto";

export const requestId: RequestHandler = (_request, response, next): void => {
  // IDs are always generated here; accepting a caller-supplied value would let
  // unrelated requests forge the same diagnostic identity.
  const id = randomUUID();
  response.locals.requestId = id;
  response.set("X-Request-ID", id);
  next();
};
