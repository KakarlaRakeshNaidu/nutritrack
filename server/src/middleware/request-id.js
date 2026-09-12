import { randomUUID } from "node:crypto";

export function requestId(request, response, next) {
  // IDs are always generated here; accepting a caller-supplied value would let
  // unrelated requests forge the same diagnostic identity.
  const id = randomUUID();
  response.locals.requestId = id;
  response.set("X-Request-ID", id);
  next();
}
