import cors from "cors";
import express from "express";
import type { Express } from "express";
import type { CorsOptions } from "cors";
import helmet from "helmet";

import {
  API_PREFIX,
  CORS_METHODS,
  JSON_BODY_LIMIT_BYTES,
} from "./config/constants.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFound } from "./middleware/not-found.js";
import { requestId } from "./middleware/request-id.js";
import {
  enforceGoalBodyContract,
  registerGoalRoutes,
} from "./modules/goals/goal.routes.js";
import { registerMealRoutes } from "./modules/meals/meal.routes.js";
import {
  ExtractionRuntime,
  registerNutritionRoutes,
} from "./modules/nutrition/nutrition.routes.js";
import type { ExtractionService } from "./modules/nutrition/nutrition.service.js";
import { registerProfileRoutes } from "./modules/profile/profile.routes.js";
import {
  enforceReportBodyContract,
  registerReportRoutes,
} from "./modules/reports/report.routes.js";
import type { AppConfig } from "./config/env.js";
import type { Clock, DatabasePool, Logger } from "./types.js";

interface CreateAppOptions {
  pool?: DatabasePool;
  clock?: Clock;
  registerRoutes?: (app: Express) => void;
  logger?: Logger;
  extractionService?: ExtractionService;
  extractionRuntime?: ExtractionRuntime;
  extractionUploadTimeoutMs?: number;
}

type HttpConfig = Pick<AppConfig, "TRUST_PROXY_HOPS" | "CLIENT_ORIGIN" | "providers">;


function corsOptions(clientOrigin: string): CorsOptions {
  return {
    origin(origin, callback) {
      callback(null, origin === clientOrigin);
    },
    methods: CORS_METHODS,
    allowedHeaders: ["Content-Type"],
    exposedHeaders: ["X-Request-ID"],
    credentials: false,
    optionsSuccessStatus: 204,
  };
}

export function createApp(
  config: HttpConfig,
  {
    pool,
    clock,
    registerRoutes,
    logger = console,
    extractionService,
    extractionRuntime,
    extractionUploadTimeoutMs,
  }: CreateAppOptions = {},
): Express {
  const app = express();

  // A numeric hop count trusts only the configured proxy depth. Zero preserves
  // Express's direct-client behavior and never enables unrestricted proxy trust.
  app.set("trust proxy", config.TRUST_PROXY_HOPS);
  app.disable("x-powered-by");

  app.use(requestId);
  app.use(helmet());
  app.use(cors(corsOptions(config.CLIENT_ORIGIN)));

  if (pool) {
    // Meal routes own a stricter parser and must see the request stream before
    // the broader API parser consumes it.
    app.locals.extractionRuntime = registerNutritionRoutes(app, {
      pool,
      config,
      clock,
      service: extractionService,
      runtime: extractionRuntime,
      uploadTimeoutMs: extractionUploadTimeoutMs,
    });

    registerMealRoutes(app, { pool, clock });
    app.use("/api/v1/goals", enforceGoalBodyContract);
    app.use("/api/v1/reports/nutrition", enforceReportBodyContract);
  }

  // JSON parsing is deliberately limited to the versioned API surface. Later
  // multipart image routes must retain their own parser and 10 MB file limit.
  app.use(
    API_PREFIX,
    express.json({
      limit: JSON_BODY_LIMIT_BYTES,
      type: ["application/json", "application/*+json"],
    }),
  );

  if (pool) {
    registerGoalRoutes(app, { pool });
    registerProfileRoutes(app, { pool, clock });
    registerReportRoutes(app, { pool, clock });
  }

  // Tests can mount small fixture handlers through this composition boundary.
  // Production never supplies the callback, so fixture/debug routes cannot ship.
  if (registerRoutes) {
    registerRoutes(app);
  }

  app.use(notFound);
  app.use(errorHandler({ logger }));

  return app;
}
