import { loadEnv } from "../src/config/env.js";

export const VALID_CORE_ENV = {
  CLIENT_ORIGIN: "http://localhost:5173",
  DATABASE_URL:
    "postgresql://phase2_user:synthetic@database.invalid:5432/nutritrack",
  PG_CA_CERT_PATH: "/phase-3/aiven-ca.pem",
};

export function testConfig(overrides = {}) {
  return loadEnv({ ...VALID_CORE_ENV, NODE_ENV: "test", ...overrides });
}

export function recordingLogger() {
  const entries = [];

  return {
    entries,
    log(message) {
      entries.push(String(message));
    },
    warn(message) {
      entries.push(String(message));
    },
    error(message) {
      entries.push(String(message));
    },
  };
}
