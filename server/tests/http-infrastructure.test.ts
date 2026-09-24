import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { createApp } from "../src/app.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { validateRequest } from "../src/middleware/validate-request.js";
import { recordingLogger, testConfig } from "../support/testing.js";

const SENTINEL_SECRET = "sentinel-database-password";

function createHarness() {
  const logger = recordingLogger();
  let rejectedHandlerCalled = false;
  const bodySchema = z.strictObject({
    amount: z.number(),
    optional: z.number().nullable(),
  });
  const querySchema = z.strictObject({
    tag: z.string(),
  });
  const paramsSchema = z.strictObject({
    id: z.string().uuid(),
  });

  const app = createApp(testConfig(), {
    logger,
    registerRoutes(router) {
      router.post(
        "/api/v1/fixture/body",
        validateRequest({ body: bodySchema }),
        (_request, response) => {
          response.json(response.locals.validated.body);
        },
      );
      router.post(
        "/api/v1/fixture/rejected",
        validateRequest({ body: bodySchema }),
        (_request, response) => {
          rejectedHandlerCalled = true;
          response.sendStatus(204);
        },
      );
      router.get(
        "/api/v1/fixture/query",
        validateRequest({ query: querySchema }),
        (_request, response) => {
          response.json(response.locals.validated.query);
        },
      );
      router.get(
        "/api/v1/fixture/params/:id",
        validateRequest({ params: paramsSchema }),
        (_request, response) => {
          response.json(response.locals.validated.params);
        },
      );
      router.post("/api/v1/fixture/raw", (request, response) => {
        response.json({ bodyWasParsed: request.body !== undefined });
      });
      router.get("/api/v1/fixture/sync-error", () => {
        throw new Error(SENTINEL_SECRET);
      });
      router.get("/api/v1/fixture/async-error", async () => {
        await Promise.resolve();
        throw new Error(SENTINEL_SECRET);
      });
      router.get(
        "/api/v1/fixture/schema-error",
        validateRequest({
          query: {
            safeParse() {
              throw new Error(SENTINEL_SECRET);
            },
          },
        }),
        (_request, response) => response.sendStatus(204),
      );
    },
  });

  return {
    app,
    logger,
    wasRejectedHandlerCalled: () => rejectedHandlerCalled,
  };
}

test("request IDs are server-generated and shared by headers and errors", async () => {
  const { app } = createHarness();
  const response = await request(app)
    .get("/api/v1/unknown")
    .set("X-Request-ID", "forged-client-id");

  assert.match(response.headers["x-request-id"], /^[0-9a-f-]{36}$/);
  assert.notEqual(response.headers["x-request-id"], "forged-client-id");
  assert.equal(response.body.error.request_id, response.headers["x-request-id"]);
});

test("malformed and oversized JSON receive distinct safe errors", async () => {
  const { app } = createHarness();
  const malformed = await request(app)
    .post("/api/v1/fixture/body")
    .set("Content-Type", "application/json")
    .send("{");
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, "MALFORMED_JSON");

  const oversized = await request(app)
    .post("/api/v1/fixture/body")
    .set("Content-Type", "application/json")
    .send(JSON.stringify({ data: "x".repeat(100_000) }));
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.error.code, "REQUEST_TOO_LARGE");

  const multibyte = await request(app)
    .post("/api/v1/fixture/body")
    .set("Content-Type", "application/json")
    .send(JSON.stringify({ data: "é".repeat(50_000) }));
  assert.equal(multibyte.status, 413);
});

test("strict validation rejects bad input before its handler", async () => {
  const harness = createHarness();
  const wrongType = await request(harness.app)
    .post("/api/v1/fixture/rejected")
    .send({ amount: "0", optional: null });
  const unknownKey = await request(harness.app)
    .post("/api/v1/fixture/rejected")
    .send({ amount: 0, optional: null, surprise: true });

  assert.equal(wrongType.status, 422);
  assert.equal(wrongType.body.error.code, "VALIDATION_ERROR");
  assert.equal(wrongType.body.error.details[0].field, "amount");
  assert.equal(unknownKey.status, 422);
  assert.equal(unknownKey.body.error.details[0].field, "surprise");
  assert.equal(harness.wasRejectedHandlerCalled(), false);
});

test("validated output preserves numeric zero and explicit null", async () => {
  const { app } = createHarness();
  const response = await request(app)
    .post("/api/v1/fixture/body")
    .send({ amount: 0, optional: null });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { amount: 0, optional: null });
});

test("strict query schemas reject repeated and unknown query values", async () => {
  const { app } = createHarness();
  const repeated = await request(app).get(
    "/api/v1/fixture/query?tag=one&tag=two",
  );
  const unknown = await request(app).get(
    "/api/v1/fixture/query?tag=one&extra=value",
  );

  assert.equal(repeated.status, 422);
  assert.equal(unknown.status, 422);
  assert.equal(unknown.body.error.details[0].field, "extra");
});

test("strict path schemas reject invalid params and provide parsed params", async () => {
  const { app } = createHarness();
  const invalid = await request(app).get("/api/v1/fixture/params/not-a-uuid");
  const id = "70a2071d-5cb8-4f15-b6f6-9ed632462bef";
  const valid = await request(app).get(`/api/v1/fixture/params/${id}`);

  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.error.details[0].field, "id");
  assert.equal(valid.status, 200);
  assert.deepEqual(valid.body, { id });
});

test("unexpected sync, async, and schema errors are generic and redacted", async () => {
  const { app, logger } = createHarness();

  for (const path of ["sync-error", "async-error", "schema-error"]) {
    const response = await request(app).get(`/api/v1/fixture/${path}`);
    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, "INTERNAL_ERROR");
    assert.equal(response.text.includes(SENTINEL_SECRET), false);
  }

  assert.equal(logger.entries.join("\n").includes(SENTINEL_SECRET), false);
});

test("Helmet headers are present and Express branding is absent", async () => {
  const { app } = createHarness();
  const response = await request(app).get("/api/v1/unknown");

  assert.ok(response.headers["content-security-policy"]);
  assert.equal(response.headers["x-powered-by"], undefined);
});

test("CORS permits only the configured origin and supports preflight", async () => {
  const { app } = createHarness();
  const allowed = await request(app)
    .get("/api/v1/unknown")
    .set("Origin", "http://localhost:5173");
  const disallowed = await request(app)
    .get("/api/v1/unknown")
    .set("Origin", "https://unapproved.example");
  const withoutOrigin = await request(app).get("/api/v1/unknown");
  const preflight = await request(app)
    .options("/api/v1/unknown")
    .set("Origin", "http://localhost:5173")
    .set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "Content-Type");

  assert.equal(
    allowed.headers["access-control-allow-origin"],
    "http://localhost:5173",
  );
  assert.match(
    allowed.headers["access-control-expose-headers"],
    /X-Request-ID/i,
  );
  assert.equal(disallowed.headers["access-control-allow-origin"], undefined);
  assert.equal(withoutOrigin.headers["access-control-allow-origin"], undefined);
  assert.equal(withoutOrigin.status, 404);
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers["access-control-allow-origin"],
    "http://localhost:5173",
  );
  assert.match(preflight.headers["access-control-allow-methods"], /POST/);
  assert.match(preflight.headers["access-control-allow-headers"], /Content-Type/i);
  assert.equal(preflight.headers["access-control-allow-credentials"], "true");
});

test("the central error handler delegates after response headers are sent", () => {
  const originalError = new Error("already handled elsewhere");
  let delegatedError: unknown;
  const middleware = errorHandler({ logger: recordingLogger() });

  middleware(
    originalError,
    { method: "GET" } as Request,
    { headersSent: true, locals: {} } as unknown as Response,
    ((error: unknown) => {
      delegatedError = error;
    }) as NextFunction,
  );

  assert.equal(delegatedError, originalError);
});

test("multipart bodies are not parsed by the API JSON parser", async () => {
  const { app } = createHarness();
  const response = await request(app)
    .post("/api/v1/fixture/raw")
    .field("amount", "0");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { bodyWasParsed: false });
});
