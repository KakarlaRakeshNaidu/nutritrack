import { app } from "./app.js";
import { loadEnv } from "./config/env.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

function safeErrorMessage(error) {
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "EADDRINUSE") {
      return "The configured port is already in use.";
    }

    if (error.code === "EACCES") {
      return "The process is not allowed to use the configured port.";
    }
  }

  return error instanceof Error ? error.message : "Unknown startup error.";
}

export function startServer(source = process.env) {
  const { PORT } = loadEnv(source);
  const server = app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });

  server.on("error", (error) => {
    console.error(`Server failed to start: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  });

  let shutdownStarted = false;

  function shutdown(signal) {
    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;
    console.log(`Received ${signal}; closing the HTTP server.`);

    // Stop accepting new requests and allow current requests to finish. The
    // timeout prevents a stuck connection from keeping process shutdown open.
    const timeout = setTimeout(() => {
      console.error("Server shutdown timed out; closing active connections.");
      server.closeAllConnections();
      process.exitCode = 1;
    }, SHUTDOWN_TIMEOUT_MS);
    timeout.unref();

    server.close((error) => {
      clearTimeout(timeout);

      if (error) {
        console.error(`Server shutdown failed: ${safeErrorMessage(error)}`);
        process.exitCode = 1;
      }
    });
  }

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  return server;
}

try {
  startServer();
} catch (error) {
  console.error(`Server failed to start: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
}
