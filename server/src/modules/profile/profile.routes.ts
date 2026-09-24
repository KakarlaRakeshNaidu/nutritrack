import type { Express } from "express";

import type { Clock, DatabaseExecutor } from "../../types.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { createProfileController } from "./profile.controller.js";
import { profileQuerySchema, profileUpdateSchema } from "./profile.schemas.js";
import { createProfileService } from "./profile.service.js";

export function registerProfileRoutes(
  app: Express,
  { pool, clock }: { pool: DatabaseExecutor; clock?: Clock },
): void {
  const service = createProfileService({ pool, clock });
  const controller = createProfileController(service);

  app.get(
    "/api/v1/profile",
    validateRequest({ query: profileQuerySchema }),
    controller.getProfile,
  );
  app.put(
    "/api/v1/profile",
    validateRequest({ body: profileUpdateSchema, query: profileQuerySchema }),
    controller.updateProfile,
  );
}
