import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";
import {
  EnvironmentValidationError,
  loadEnv,
} from "./config/env.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

function safeStartupMessage(error) {
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

function reportProviderState(config, logger) {
  for (const [providerName, provider] of Object.entries(config.providers)) {
    if (provider.status === "configuration_error") {
      logger.warn(
        `${providerName} configuration is incomplete; image analysis remains disabled.`,
      );
    }
  }
}

export function startServer(source = process.env, { logger = console } = {}) {
  // Environment parsing happens only at process startup. Importing app.js stays
  // independent of local configuration, files, databases, and providers.
  const config = loadEnv(source);
  reportProviderState(config, logger);
  const app = createApp(config, { logger });
  const server = app.listen(config.PORT, () => {
    logger.log(`Server listening on http://localhost:${config.PORT}`);
  });

  server.on("error", (error) => {
    logger.error(`Server failed to start: ${safeStartupMessage(error)}`);
    process.exitCode = 1;
  });

  let shutdownStarted = false;
  function shutdown(signal) {
    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;
    logger.log(`Received ${signal}; closing the HTTP server.`);

    // Stop accepting new requests and allow current requests to finish. The
    // timeout prevents a stuck connection from holding process shutdown open.
    const timeout = setTimeout(() => {
      logger.error("Server shutdown timed out; closing active connections.");
      server.closeAllConnections();
      process.exitCode = 1;
    }, SHUTDOWN_TIMEOUT_MS);
    timeout.unref();

    server.close((error) => {
      clearTimeout(timeout);
      if (error) {
        logger.error("Server shutdown failed.");
        process.exitCode = 1;
      }
    });
  }

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  return server;
}

function isExecutedDirectly() {
  return Boolean(
    process.argv[1] &&
      fileURLToPath(import.meta.url) === resolve(process.argv[1]),
  );
}

if (isExecutedDirectly()) {
  try {
    startServer();
  } catch (error) {
    console.error(`Server failed to start: ${safeStartupMessage(error)}`);
    process.exitCode = 1;
  }
}
