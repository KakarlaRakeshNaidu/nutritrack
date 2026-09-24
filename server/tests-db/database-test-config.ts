import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

import { loadEnv } from "../src/config/env.js";
import type { AppConfig, EnvironmentSource } from "../src/config/env.js";

type ReadEnvironment = (path: URL, encoding: "utf8") => Promise<string>;
type ParseEnvironment = (
  contents: string,
) => Record<string, string | undefined>;
type LoadApplicationEnvironment = (source: EnvironmentSource) => AppConfig;

interface DatabaseTestConfigDependencies {
  readEnvironment?: ReadEnvironment;
  parseEnvironment?: ParseEnvironment;
  loadApplicationEnvironment?: LoadApplicationEnvironment;
}

const applicationEnvironmentFile = new URL("../.env", import.meta.url);

export class DatabaseTestConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseTestConfigurationError";
  }
}

export async function loadDatabaseTestConfig({
  readEnvironment = (path, encoding) => readFile(path, encoding),
  parseEnvironment = parseEnv,
  loadApplicationEnvironment = loadEnv,
}: DatabaseTestConfigDependencies = {}): Promise<AppConfig> {
  let contents: string;

  try {
    contents = await readEnvironment(applicationEnvironmentFile, "utf8");
  } catch {
    throw new DatabaseTestConfigurationError(
      "The application environment file could not be read for database tests.",
    );
  }

  // Parse the selected file directly so inherited shell variables cannot
  // silently redirect destructive integration work to another database.
  const parsed = parseEnvironment(contents);
  return loadApplicationEnvironment({
    ...parsed,
    NODE_ENV: "test",
    JWT_SECRET: parsed.JWT_SECRET ?? "test-only-database-secret-with-at-least-32-characters",
  });
}
