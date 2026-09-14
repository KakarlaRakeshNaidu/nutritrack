import assert from "node:assert/strict";
import test from "node:test";

import {
  EnvironmentValidationError,
  loadEnv,
} from "../src/config/env.js";
import { VALID_CORE_ENV } from "../support/testing.js";
import type { EnvironmentSource } from "../src/config/env.js";

function assertInvalid(
  overrides: EnvironmentSource,
  expectedFields: string[],
): void {
  assert.throws(
    () => loadEnv({ ...VALID_CORE_ENV, ...overrides }),
    (error) => {
      assert.ok(error instanceof EnvironmentValidationError);
      assert.deepEqual(error.fields, expectedFields);
      return true;
    },
  );
}

test("core configuration applies defaults and normalizes the client origin", () => {
  const config = loadEnv({
    ...VALID_CORE_ENV,
    CLIENT_ORIGIN: "https://tracker.example/",
  });

  assert.equal(config.PORT, 3000);
  assert.equal(config.NODE_ENV, "development");
  assert.equal(config.TRUST_PROXY_HOPS, 0);
  assert.equal(config.CLIENT_ORIGIN, "https://tracker.example");
  assert.equal(config.DATABASE_URL, VALID_CORE_ENV.DATABASE_URL);
  assert.equal(config.PG_CA_CERT_PATH, VALID_CORE_ENV.PG_CA_CERT_PATH);
});

test("core configuration accepts valid explicit overrides", () => {
  const config = loadEnv({
    ...VALID_CORE_ENV,
    PORT: "3100",
    NODE_ENV: "production",
    TRUST_PROXY_HOPS: "2",
    EXTRA_OS_VALUE: "ignored",
  });

  assert.equal(config.PORT, 3100);
  assert.equal(config.NODE_ENV, "production");
  assert.equal(config.TRUST_PROXY_HOPS, 2);
});

test("PORT accepts boundaries and rejects malformed or out-of-range values", () => {
  for (const [input, expected] of [
    ["1", 1],
    ["65535", 65535],
  ]) {
    assert.equal(loadEnv({ ...VALID_CORE_ENV, PORT: input }).PORT, expected);
  }

  for (const value of ["", "   ", "abc", "0", "-1", "1.5", "65536"]) {
    assertInvalid({ PORT: value }, ["PORT"]);
  }
});

test("NODE_ENV and PG_CA_CERT_PATH reject unsupported or blank values", () => {
  for (const NODE_ENV of ["staging", "Production", ""]) {
    assertInvalid({ NODE_ENV }, ["NODE_ENV"]);
  }

  for (const PG_CA_CERT_PATH of ["", "   "]) {
    assertInvalid({ PG_CA_CERT_PATH }, ["PG_CA_CERT_PATH"]);
  }
});

test("TRUST_PROXY_HOPS accepts nonnegative integers only", () => {
  assert.equal(
    loadEnv({ ...VALID_CORE_ENV, TRUST_PROXY_HOPS: "3" }).TRUST_PROXY_HOPS,
    3,
  );

  for (const value of ["", " ", "-1", "1.5", "all"]) {
    assertInvalid({ TRUST_PROXY_HOPS: value }, ["TRUST_PROXY_HOPS"]);
  }
});

test("missing required core settings fail with field names but no values", () => {
  const sentinel = "do-not-log-this-secret";

  assert.throws(
    () => loadEnv({ DATABASE_URL: sentinel }),
    (error) => {
      assert.ok(error instanceof EnvironmentValidationError);
      assert.deepEqual(error.fields, [
        "CLIENT_ORIGIN",
        "DATABASE_URL",
        "PG_CA_CERT_PATH",
      ]);
      assert.equal(error.message.includes(sentinel), false);
      return true;
    },
  );
});

test("CLIENT_ORIGIN rejects credentials, paths, query, fragment, wildcard, and lists", () => {
  const invalidOrigins = [
    "ftp://tracker.example",
    "http://user:pass@tracker.example",
    "https://tracker.example/path",
    "https://tracker.example/?mode=test",
    "https://tracker.example/#section",
    "*",
    "https://one.example,https://two.example",
  ];

  for (const CLIENT_ORIGIN of invalidOrigins) {
    assertInvalid({ CLIENT_ORIGIN }, ["CLIENT_ORIGIN"]);
  }
});

test("DATABASE_URL requires PostgreSQL host/database and rejects TLS overrides", () => {
  const invalidUrls = [
    "https://database.example/nutritrack",
    "postgresql:///nutritrack",
    "postgresql://database.example",
    "postgresql://database.example/first/second",
    "postgresql://database.example/nutritrack?sslmode=require",
    "postgresql://database.example/nutritrack?SSLCERT=client.pem",
    "postgresql://database.example/nutritrack?sslkey=client.key",
    "postgresql://database.example/nutritrack?sslrootcert=ca.pem",
    "postgresql://database.example/nutritrack?ssl=true",
    "postgresql://database.example/nutritrack?ssl_min_protocol_version=TLSv1.3",
  ];

  for (const DATABASE_URL of invalidUrls) {
    assertInvalid({ DATABASE_URL }, ["DATABASE_URL"]);
  }

  assert.equal(
    loadEnv({
      ...VALID_CORE_ENV,
      DATABASE_URL: "postgres://database.example:5432/nutritrack",
    }).DATABASE_URL,
    "postgres://database.example:5432/nutritrack",
  );
});

test("Gemini configuration is disabled, configured, or safely marked invalid", () => {
  const disabled = loadEnv(VALID_CORE_ENV);
  assert.deepEqual(disabled.providers.gemini, { status: "disabled" });

  const configured = loadEnv({
    ...VALID_CORE_ENV,
    GEMINI_API_KEY: "synthetic-gemini-key",
    GEMINI_MODEL: "synthetic-gemini-model",
  });
  assert.equal(configured.providers.gemini.status, "configured");

  const partial = loadEnv({
    ...VALID_CORE_ENV,
    GEMINI_API_KEY: "",
  });
  assert.deepEqual(partial.providers.gemini, {
    status: "configuration_error",
    fields: ["GEMINI_API_KEY", "GEMINI_MODEL"],
  });
});

test("Phase 2 validates CA path syntax without reading the filesystem", () => {
  const config = loadEnv({
    ...VALID_CORE_ENV,
    PG_CA_CERT_PATH: "/definitely/not/read/until/phase-3.pem",
  });

  assert.equal(config.PG_CA_CERT_PATH, "/definitely/not/read/until/phase-3.pem");
});
