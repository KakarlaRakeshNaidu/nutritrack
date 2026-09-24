import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import test from "node:test";
import type { Express } from "express";
import sharp from "sharp";
import request from "supertest";

import { createApp } from "../src/app.js";
import {
  ExtractionRuntime,
} from "../src/modules/nutrition/nutrition.routes.js";
import type { ExtractionResult } from "../src/modules/nutrition/nutrition.schemas.js";
import type { ExtractionService } from "../src/modules/nutrition/nutrition.service.js";
import { ProviderFailure } from "../src/modules/nutrition/nutrition.failures.js";
import {
  databasePoolStub,
  recordingLogger,
  testConfig,
} from "../support/testing.js";

const result: ExtractionResult = {
  provider: "gemini",
  image_type: "nutrition_label",
  is_estimate: false,
  source_basis: "per serving",
  assumptions: [],
  draft: {
    food_name: "Fixture",
    meal_type: null,
    consumption_date: "2026-09-14",
    consumed_quantity: 1,
    quantity_unit: "serving",
    calories_kcal: 100,
    protein_g: 2,
    carbs_g: 3,
    fat_g: 4,
    micronutrients: {
      sodium_mg: null,
      calcium_mg: null,
      iron_mg: null,
      potassium_mg: null,
      vitamin_c_mg: null,
      vitamin_d_mcg: null,
    },
    entry_source: "nutrition_label",
    is_estimate: false,
  },
  missing_fields: ["meal_type"],
};

function testApp(
  service: ExtractionService = { extract: async () => result },
  runtime = new ExtractionRuntime(),
): Express {
  return createApp(testConfig(), {
    pool: databasePoolStub(async () => ({ rows: [], rowCount: 0 })),
    clock: () => new Date("2026-09-14T12:00:00Z"),
    logger: recordingLogger(),
    extractionService: service,
    extractionRuntime: runtime,
  });
}

function validUpload(app: Express, bytes = Buffer.from("bytes")) {
  return request(app)
    .post("/api/v1/nutrition/extract")
    .field("image_type", "nutrition_label")
    .attach("image", bytes, { filename: "label.jpg", contentType: "image/jpeg" });
}

test("valid multipart reaches extraction and preserves the established envelope", async () => {
  const response = await validUpload(testApp());
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { data: result });
  assert.equal(typeof response.headers["x-request-id"], "string");
});

test("route rejects wrong media, query parameters, missing and invalid fields", async () => {
  const app = testApp();
  const wrong = await request(app)
    .post("/api/v1/nutrition/extract")
    .send({ image_type: "nutrition_label" });
  assert.equal(wrong.status, 415);

  const queried = await request(app)
    .post("/api/v1/nutrition/extract?force=unsupported")
    .field("image_type", "nutrition_label")
    .attach("image", Buffer.from("x"), { filename: "x.jpg", contentType: "image/jpeg" });
  assert.equal(queried.status, 422);

  const missingImage = await request(app)
    .post("/api/v1/nutrition/extract")
    .field("image_type", "nutrition_label");
  assert.equal(missingImage.status, 422);

  const missingType = await request(app)
    .post("/api/v1/nutrition/extract")
    .attach("image", Buffer.from("x"), { filename: "x.jpg", contentType: "image/jpeg" });
  assert.equal(missingType.status, 422);

  const invalidType = await request(app)
    .post("/api/v1/nutrition/extract")
    .field("image_type", "other")
    .attach("image", Buffer.from("x"), { filename: "x.jpg", contentType: "image/jpeg" });
  assert.equal(invalidType.status, 422);

  const unsupported = await request(app)
    .post("/api/v1/nutrition/extract")
    .field("image_type", "nutrition_label")
    .attach("image", Buffer.from("x"), { filename: "x.gif", contentType: "image/gif" });
  assert.equal(unsupported.status, 415);
});

test("multipart cardinality rejects duplicate/unknown fields and extra files", async () => {
  const duplicateField = await request(testApp())
    .post("/api/v1/nutrition/extract")
    .field("image_type", "nutrition_label")
    .field("image_type", "food_plate")
    .attach("image", Buffer.from("x"), { filename: "x.jpg", contentType: "image/jpeg" });
  assert.equal(duplicateField.status, 422);

  const unknownField = await request(testApp())
    .post("/api/v1/nutrition/extract")
    .field("image_type", "nutrition_label")
    .field("other", "x")
    .attach("image", Buffer.from("x"), { filename: "x.jpg", contentType: "image/jpeg" });
  assert.equal(unknownField.status, 422);

  const extraFile = await request(testApp())
    .post("/api/v1/nutrition/extract")
    .field("image_type", "nutrition_label")
    .attach("image", Buffer.from("x"), { filename: "x.jpg", contentType: "image/jpeg" })
    .attach("other", Buffer.from("x"), { filename: "y.jpg", contentType: "image/jpeg" });
  assert.equal(extraFile.status, 422);
});

test("file size is inclusive at 10,000,000 and rejects 10,000,001 bytes", async () => {
  const accepted = await validUpload(testApp(), Buffer.alloc(10_000_000));
  assert.equal(accepted.status, 200);
  const rejected = await validUpload(testApp(), Buffer.alloc(10_000_001));
  assert.equal(rejected.status, 413);
  assert.equal(rejected.body.error.code, "IMAGE_TOO_LARGE");
});

test("malformed multipart gets a safe 400 envelope and releases its slot", async () => {
  const runtime = new ExtractionRuntime();
  const app = testApp(undefined, runtime);
  const malformed = await request(app)
    .post("/api/v1/nutrition/extract")
    .set("Content-Type", "multipart/form-data; boundary=broken")
    .send("--broken\r\nContent-Disposition: form-data; name=\"image_type\"\r\n\r\nnutrition_label");
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, "MALFORMED_MULTIPART");
  assert.equal(runtime.active, 0);
  assert.equal((await validUpload(app)).status, 200);
});

test("only two extraction requests run concurrently and the third is not queued", async () => {
  const releases: Array<() => void> = [];
  let active = 0;
  let started = 0;
  const service: ExtractionService = {
    async extract() {
      started += 1;
      active += 1;
      if (started <= 2) {
        await new Promise<void>((resolve) => releases.push(resolve));
      }
      active -= 1;
      return result;
    },
  };
  const app = testApp(service);
  const first = new Promise<request.Response>((resolve, reject) => {
    validUpload(app).end((error, response) => error ? reject(error) : resolve(response));
  });
  const second = new Promise<request.Response>((resolve, reject) => {
    validUpload(app).end((error, response) => error ? reject(error) : resolve(response));
  });
  try {
    for (let turn = 0; active < 2 && turn < 100; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(active, 2);
    const third = await validUpload(app);
    assert.equal(third.status, 429);
    assert.equal(third.body.error.code, "AI_BUSY");
    assert.equal(third.headers["retry-after"], "1");
  } finally {
    releases.splice(0).forEach((release) => release());
  }
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  assert.equal((await validUpload(app)).status, 200);

});
test("runtime shutdown cancels active extraction, responds safely, and releases the slot", async () => {
  const runtime = new ExtractionRuntime();
  let calls = 0;
  let active = 0;
  const service: ExtractionService = {
    async extract({ signal }) {
      calls += 1;
      if (calls > 1) {
        return result;
      }
      active += 1;
      try {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new ProviderFailure("user_cancellation", "cancelled"));
          }, { once: true });
        });
      } finally {
        active -= 1;
      }
      return result;
    },
  };
  const app = testApp(service, runtime);
  const pending = new Promise<request.Response>((resolve, reject) => {
    validUpload(app).end((error, response) => error ? reject(error) : resolve(response));
  });
  for (let turn = 0; active < 1 && turn < 100; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(active, 1);
  runtime.cancelAll();
  const cancelled = await pending;
  assert.equal(cancelled.status, 503);
  assert.equal(cancelled.body.error.code, "AI_PROVIDERS_UNAVAILABLE");
  assert.equal(runtime.active, 0);
  assert.equal((await validUpload(app)).status, 200);
});

test("missing AI configuration is isolated from existing manual APIs", async () => {
  const pool = databasePoolStub(async (query) => {
    const name = typeof query === "string" ? query : query.name;
    if (name === "profile-read-by-user") {
      return {
        rowCount: 1,
        rows: [{ display_name: "Tester", timezone: "UTC" }],
      };
    }
    return { rowCount: 0, rows: [] };
  });
  const app = createApp(testConfig(), {
    pool,
    clock: () => new Date("2026-09-14T12:00:00Z"),
    logger: recordingLogger(),
  });
  const jpeg = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: "white",
    },
  }).jpeg().toBuffer();
  const extraction = await validUpload(app, jpeg);
  assert.equal(extraction.status, 503);
  assert.equal(extraction.body.error.code, "AI_CONFIGURATION_ERROR");

  const profile = await request(app).get("/api/v1/profile");
  assert.equal(profile.status, 200);
  assert.equal(profile.body.data.display_name, "Tester");
});

test("the eleventh request per IP is rate limited with Retry-After", async () => {
  const app = testApp();
  for (let index = 0; index < 10; index += 1) {
    const response = await request(app).post("/api/v1/nutrition/extract").send({});
    assert.equal(response.status, 415);
  }
  const limited = await request(app).post("/api/v1/nutrition/extract").send({});
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, "AI_RATE_LIMITED");
  assert.equal(typeof limited.headers["retry-after"], "string");
});

test("stalled upload receives a bounded 408, releases its slot, and permits reuse", async () => {
  const runtime = new ExtractionRuntime();
  const app = createApp(testConfig(), {
    pool: databasePoolStub(async () => ({ rows: [], rowCount: 0 })),
    logger: recordingLogger(),
    extractionService: { extract: async () => result },
    extractionRuntime: runtime,
    extractionUploadTimeoutMs: 25,
  });
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");

  try {
    const response = await new Promise<{ status: number | undefined; body: string }>(
      (resolve, reject) => {
        let settled = false;
        const upload = httpRequest({
          host: "127.0.0.1",
          port: address.port,
          method: "POST",
          path: "/api/v1/nutrition/extract",
          headers: {
            "content-type": "multipart/form-data; boundary=slow",
            "content-length": "100000",
          },
        }, (incoming) => {
          let body = "";
          incoming.setEncoding("utf8");
          incoming.on("data", (chunk) => {
            body += chunk;
          });
          incoming.on("end", () => {
            settled = true;
            resolve({ status: incoming.statusCode, body });
          });
        });
        upload.on("error", (error) => {
          if (!settled) {
            reject(error);
          }
        });
        upload.write(
          "--slow\r\nContent-Disposition: form-data; name=\"image_type\"\r\n\r\n" +
          "nutrition_label\r\n--slow\r\nContent-Disposition: form-data; " +
          "name=\"image\"; filename=\"label.jpg\"\r\nContent-Type: image/jpeg\r\n\r\nabc",
        );
      },
    );
    assert.equal(response.status, 408);
    assert.equal(JSON.parse(response.body).error.code, "UPLOAD_TIMEOUT");
    assert.equal(runtime.active, 0);
    assert.equal((await validUpload(app)).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("caller disconnect during provider work aborts the owned signal promptly", async () => {
  const runtime = new ExtractionRuntime();
  let calls = 0;
  let active = 0;
  let observedAbort = false;
  const service: ExtractionService = {
    async extract({ signal }) {
      calls += 1;
      if (calls > 1) {
        return result;
      }
      active += 1;
      try {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            observedAbort = true;
            reject(new ProviderFailure("user_cancellation", "caller left"));
          }, { once: true });
        });
      } finally {
        active -= 1;
      }
      return result;
    },
  };
  const app = testApp(service, runtime);
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const boundary = "disconnect";
  const body = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="image_type"\r\n\r\n` +
    `nutrition_label\r\n--${boundary}\r\nContent-Disposition: form-data; ` +
    `name="image"; filename="label.jpg"\r\nContent-Type: image/jpeg\r\n\r\n` +
    `bytes\r\n--${boundary}--\r\n`,
  );
  const operation = httpRequest({
    host: "127.0.0.1",
    port: address.port,
    method: "POST",
    path: "/api/v1/nutrition/extract",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(body.byteLength),
    },
  });
  operation.on("error", () => {});
  operation.end(body);

  try {
    for (let turn = 0; active < 1 && turn < 100; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(active, 1);
    operation.destroy();
    for (let turn = 0; runtime.active !== 0 && turn < 100; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(observedAbort, true);
    assert.equal(calls, 1);
    assert.equal(runtime.active, 0);
    assert.equal((await validUpload(app)).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
