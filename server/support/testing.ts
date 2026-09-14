import { loadEnv } from "../src/config/env.js";
import type { EnvironmentSource } from "../src/config/env.js";
import type {
  DatabaseExecutor,
  DatabasePool,
  Logger,
} from "../src/types.js";

export interface RecordingLogger extends Logger {
  entries: string[];
}

export const VALID_CORE_ENV = {
  CLIENT_ORIGIN: "http://localhost:5173",
  DATABASE_URL:
    "postgresql://phase2_user:synthetic@database.invalid:5432/nutritrack",
  PG_CA_CERT_PATH: "/phase-3/aiven-ca.pem",
};

export function testConfig(overrides: EnvironmentSource = {}) {
  return loadEnv({ ...VALID_CORE_ENV, NODE_ENV: "test", ...overrides });
}

export function recordingLogger(): RecordingLogger {
  const entries: string[] = [];

  return {
    entries,
    log(message: string) {
      entries.push(String(message));
    },
    warn(message: string) {
      entries.push(String(message));
    },
    error(message: string) {
      entries.push(String(message));
    },
  };
}

export function databasePoolStub(
  query: DatabaseExecutor["query"],
): DatabasePool {
  return {
    query,
    async connect() {
      return {
        query,
        release() {},
      };
    },
    async end() {},
  };
}
