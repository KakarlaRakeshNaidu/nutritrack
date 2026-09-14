import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EnvironmentValidationError,
  loadEnv,
} from "../config/env.js";
import type { AppConfig, EnvironmentSource } from "../config/env.js";
import {
  createDatabasePool,
  DatabaseConfigurationError,
  MIGRATION_STATEMENT_TIMEOUT_MS,
  verifyDatabaseConnection,
} from "./pool.js";
import {
  discoverMigrations,
  MigrationDefinitionError,
  runMigrations,
} from "./migration-runner.js";
import type { Migration, MigrationResult } from "./migration-runner.js";
import type { DatabasePool, Logger } from "../types.js";

interface MigrationDependencies {
  logger?: Logger;
  createPool?: (
    config: AppConfig,
    options: {
      logger: Logger;
      statementTimeoutMillis: number;
    },
  ) => Promise<DatabasePool>;
  discover?: (directory: URL) => Promise<Migration[]>;
  migrate?: (options: {
    pool: DatabasePool;
    migrations: Migration[];
    logger: Logger;
  }) => Promise<MigrationResult>;
}


const migrationsDirectory = new URL("../../migrations/", import.meta.url);

function safeMigrationMessage(error: unknown): string {
  if (
    error instanceof EnvironmentValidationError ||
    error instanceof DatabaseConfigurationError ||
    error instanceof MigrationDefinitionError
  ) {
    return error.message;
  }

  return "Migration failed because the database was unavailable or rejected the operation.";
}

export async function migrateDatabase(
  source: EnvironmentSource = process.env,
  {
    logger = console,
    createPool = createDatabasePool,
    discover = discoverMigrations,
    migrate = runMigrations,
  }: MigrationDependencies = {},
): Promise<MigrationResult> {
  const config = loadEnv(source);
  const pool = await createPool(config, {
    logger,
    statementTimeoutMillis: MIGRATION_STATEMENT_TIMEOUT_MS,
  });

  try {
    await verifyDatabaseConnection(pool);
    const migrations = await discover(migrationsDirectory);
    const result = await migrate({ pool, migrations, logger });
    logger.log(
      result.appliedCount === 0
        ? "Database schema is already current."
        : `Applied ${result.appliedCount} pending migration(s).`,
    );
    return result;
  } finally {
    await pool.end();
  }
}

function isExecutedDirectly(): boolean {
  return Boolean(
    process.argv[1] &&
      fileURLToPath(import.meta.url) === resolve(process.argv[1]),
  );
}

if (isExecutedDirectly()) {
  try {
    await migrateDatabase();
  } catch (error) {
    console.error(`Database migration failed: ${safeMigrationMessage(error)}`);
    process.exitCode = 1;
  }
}
