import cors from "cors";
import express from "express";
import helmet from "helmet";

import {
  API_PREFIX,
  CORS_METHODS,
  JSON_BODY_LIMIT_BYTES,
} from "./config/constants.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFound } from "./middleware/not-found.js";
import { requestId } from "./middleware/request-id.js";

function corsOptions(clientOrigin) {
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

export function createApp(config, { registerRoutes, logger = console } = {}) {
  const app = express();

  // A numeric hop count trusts only the configured proxy depth. Zero preserves
  // Express's direct-client behavior and never enables unrestricted proxy trust.
  app.set("trust proxy", config.TRUST_PROXY_HOPS);
  app.disable("x-powered-by");

  app.use(requestId);
  app.use(helmet());
  app.use(cors(corsOptions(config.CLIENT_ORIGIN)));

  // JSON parsing is deliberately limited to the versioned API surface. Later
  // multipart image routes must retain their own parser and 10 MB file limit.
  app.use(
    API_PREFIX,
    express.json({
      limit: JSON_BODY_LIMIT_BYTES,
      type: ["application/json", "application/*+json"],
    }),
  );

  // Tests can mount small fixture handlers through this composition boundary.
  // Production never supplies the callback, so fixture/debug routes cannot ship.
  if (registerRoutes) {
    registerRoutes(app);
  }

  app.use(notFound);
  app.use(errorHandler({ logger }));

  return app;
}
