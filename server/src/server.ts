import type { Server } from "node:http";
import type { Express } from "express";

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";
import {
  EnvironmentValidationError,
  loadEnv,
} from "./config/env.js";
import type { AppConfig, EnvironmentSource } from "./config/env.js";
import {
  createDatabasePool,
  DatabaseConfigurationError,
  verifyDatabaseConnection,
} from "./db/pool.js";
import { ExtractionRuntime } from "./modules/nutrition/nutrition.routes.js";
import type { ExtractionService } from "./modules/nutrition/nutrition.service.js";
import type { NutritionEstimateService } from "./modules/nutrition/nutrition-estimate.service.js";
import type { AuthIdentity } from "./modules/auth/auth.service.js";
import type { Clock, DatabaseExecutor, DatabasePool, Logger } from "./types.js";

interface ServerDependencies {
  logger?: Logger;
  createPool?: (
    config: AppConfig,
    options: { logger: Logger },
  ) => Promise<DatabasePool>;
  verifyConnection?: (pool: DatabaseExecutor) => Promise<void>;
  clock?: Clock;
  extractionService?: ExtractionService;
  nutritionEstimateService?: NutritionEstimateService;
  testAuthIdentity?: AuthIdentity;
}

export interface RunningServer {
  app: Express;
  pool: DatabasePool;
  server: Server;
  shutdown(signal: string): Promise<void>;
}


const SHUTDOWN_TIMEOUT_MS = 10_000;

function safeStartupMessage(error: unknown): string {
  if (error instanceof DatabaseConfigurationError) {
    return error.message;
  }

  if (error instanceof EnvironmentValidationError) {
    return error.message;
  }

  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "EADDRINUSE") {
      return "The configured port is already in use.";
    }
    if (error.code === "EACCES") {
      return "The process is not allowed to use the configured port.";
    }
  }

  return "An unexpected startup error occurred.";
}

function reportProviderState(config: AppConfig, logger: Logger): void {
  for (const [providerName, provider] of Object.entries(config.providers)) {
    if (provider.status === "configuration_error") {
      logger.warn(
        `${providerName} configuration is incomplete; image analysis remains disabled.`,
      );
    }
  }
}

function waitForListening(server: Server): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    function cleanup(): void {
      server.off("listening", onListening);
      server.off("error", onError);
    }
    function onListening(): void {
      cleanup();
      resolvePromise();
    }
    function onError(error: Error): void {
      cleanup();
      rejectPromise(error);
    }

    server.once("listening", onListening);
    server.once("error", onError);
  });
}

export async function startServer(
  source: EnvironmentSource = process.env,
  {
    logger = console,
    createPool = createDatabasePool,
    verifyConnection = verifyDatabaseConnection,
    clock,
    extractionService,
    nutritionEstimateService,
    testAuthIdentity,
  }: ServerDependencies = {},
): Promise<RunningServer> {
  // Environment parsing happens only at process startup. Importing app.js stays
  // independent of local configuration, certificate files, and live resources.
  const config = loadEnv(source);
  reportProviderState(config, logger);
  const pool = await createPool(config, { logger });
  let poolEndPromise: Promise<void> | undefined;

  function endPool(): Promise<void> {
    // Multiple shutdown/error paths may converge here. The one shared pool must
    // end exactly once so later callers await the same cleanup.
    poolEndPromise ??= pool.end();
    return poolEndPromise;
  }

  async function cleanUpStartupFailure(error: unknown): Promise<never> {
    try {
      await endPool();
    } catch {
      logger.error("Database pool shutdown failed after startup error.");
    }

    throw error;
  }

  try {
    // Connectivity is proven before the listener accepts traffic. Migrations
    // remain an explicit operator action and never run during API startup.
    await verifyConnection(pool);
  } catch (error) {
    await cleanUpStartupFailure(error);
  }

  const app = createApp(config, {
    pool,
    clock,
    logger,
    extractionService,
    nutritionEstimateService,
    testAuthIdentity,
  });
  const server = app.listen(config.PORT);

  try {
    await waitForListening(server);
  } catch (error) {
    await cleanUpStartupFailure(error);
  }

  logger.log(`Server listening on http://localhost:${config.PORT}`);
  let shutdownPromise: Promise<void> | undefined;

  function shutdown(signal: string): Promise<void> {
    shutdownPromise ??= (async () => {
      logger.log(`Received ${signal}; closing HTTP and database resources.`);
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);

      const closeError = await new Promise<Error | undefined>((resolvePromise) => {
        // Stop accepting requests first, then give active work a bounded window
        // before closing sockets and ending the shared database pool.
        const timeout = setTimeout(() => {
          logger.error("Server shutdown timed out; closing active connections.");
          server.closeAllConnections();
          process.exitCode = 1;
        }, SHUTDOWN_TIMEOUT_MS);
        timeout.unref();

        const extractionRuntime = app.locals.extractionRuntime;
        if (extractionRuntime instanceof ExtractionRuntime) {
          extractionRuntime.cancelAll();
        }

        server.close((error) => {
          clearTimeout(timeout);
          resolvePromise(error);
        });
      });

      if (closeError) {
        logger.error("HTTP server shutdown failed.");
        process.exitCode = 1;
      }
      try {
        await endPool();
      } catch {
        logger.error("Database pool shutdown failed.");
        process.exitCode = 1;
      }
    })();

    return shutdownPromise;
  }

  function onSigint(): void {
    void shutdown("SIGINT");
  }
  function onSigterm(): void {
    void shutdown("SIGTERM");
  }

  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  return { app, pool, server, shutdown };
}

function isExecutedDirectly(): boolean {
  return Boolean(
    process.argv[1] &&
      fileURLToPath(import.meta.url) === resolve(process.argv[1]),
  );
}

if (isExecutedDirectly()) {
  try {
    await startServer();
  } catch (error) {
    console.error(`Server failed to start: ${safeStartupMessage(error)}`);
    process.exitCode = 1;
  }
}
