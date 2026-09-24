import express from "express";
import type { Express, RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";

import type { AppConfig } from "../../config/env.js";
import { JSON_BODY_LIMIT_BYTES } from "../../config/constants.js";
import { validateRequest } from "../../middleware/validate-request.js";
import type { DatabasePool, Logger } from "../../types.js";
import { AppError } from "../../utils/errors.js";
import { absentAuthBodySchema, credentialsSchema, emptyAuthQuerySchema } from "./auth.schemas.js";
import { createAuthService, type AuthService } from "./auth.service.js";

export function csrfOriginGuard(clientOrigin: string): RequestHandler {
  return (request, _response, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
    if (request.headers.origin !== clientOrigin) {
      return next(new AppError({ status: 403, code: "CSRF_ORIGIN_REJECTED", message: "The request origin is not allowed." }));
    }
    next();
  };
}

export function requireAuthentication(service: AuthService): RequestHandler {
  return async (request, response, next) => {
    try {
      response.locals.auth = await service.authenticate(request.headers.cookie);
      next();
    } catch (error) { next(error); }
  };
}

export function registerAuthRoutes(app: Express, { pool, config, logger = console }: {
  pool: DatabasePool; config: Pick<AppConfig, "CLIENT_ORIGIN" | "JWT_SECRET" | "NODE_ENV" | "SESSION_TTL_HOURS" | "mail">; logger?: Logger;
}): AuthService {
  const service = createAuthService({ pool, config, logger });
  const router = express.Router();
  const authRateLimit = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler(_request, _response, next) {
      next(new AppError({
        status: 429,
        code: "AUTH_RATE_LIMITED",
        message: "Too many authentication attempts. Please try again later.",
      }));
    },
  });
  router.use(csrfOriginGuard(config.CLIENT_ORIGIN));
  router.use(express.json({ limit: JSON_BODY_LIMIT_BYTES, type: ["application/json"] }));

  router.post("/signup", authRateLimit, validateRequest({ body: credentialsSchema, query: emptyAuthQuerySchema }), async (request, response) => {
    const result = await service.signup(response.locals.validated.body);
    service.setCookie(response, result.token, result.expiresAt);
    response.status(201).json({ data: { user: result.user } });
  });
  router.post("/login", authRateLimit, validateRequest({ body: credentialsSchema, query: emptyAuthQuerySchema }), async (request, response) => {
    const result = await service.login(response.locals.validated.body);
    service.setCookie(response, result.token, result.expiresAt);
    response.json({ data: { user: result.user } });
  });
  router.post("/logout", async (request, response) => {
    await service.logout(request.headers.cookie);
    service.clearCookie(response);
    response.status(204).end();
  });
  router.get("/me", validateRequest({ body: absentAuthBodySchema, query: emptyAuthQuerySchema }), requireAuthentication(service), (request, response) => {
    response.json({ data: { user: { id: response.locals.auth.userId, email: response.locals.auth.email } } });
  });
  app.use("/api/v1/auth", router);
  return service;
}
