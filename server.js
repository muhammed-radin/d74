"use strict";

/* ------------------------------------------------------------------
   D74 Edits — application bootstrap

   Run: node server.js        (or: npm start)
   Dev: npm run dev

   Responsibilities are deliberately thin: initialise the cache, event
   hub and cron sync, build the Express app, listen, and shut down
   cleanly. All HTTP behaviour lives in server/app.js.
------------------------------------------------------------------ */

const http = require("http");
const config = require("./server/config");
const logger = require("./server/logger");
const { cache } = require("./server/cache");
const { events } = require("./server/events");
const { analytics } = require("./server/analytics");
const { youtube } = require("./server/youtube");
const { createApp } = require("./server/app");

let server = null;
let shuttingDown = false;

async function start() {
  logger.info("Starting D74 Edits", {
    env: config.env,
    port: config.port,
    youtubeChannels: config.youtube.channels.length,
  });

  await cache.init();
  await events.init();
  await youtube.init();

  const app = createApp();

  server = http.createServer(app);
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = 30000;

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      logger.error("Port is already in use", { port: config.port });
    } else {
      logger.error("HTTP server error", { error });
    }
    process.exitCode = 1;
  });

  await new Promise((resolve, reject) => {
    server.listen(config.port, () => {
      logger.info("Listening on http://localhost:" + config.port);
      resolve();
    });
    server.once("error", reject);
  });

  return app;
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Shutting down", { signal });

  const forceExit = setTimeout(() => {
    logger.error("Graceful shutdown timed out; forcing exit");
    process.exit(1);
  }, 10000);
  forceExit.unref?.();

  try {
    youtube.stop();
  } catch (_) {}

  await new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    // Stop accepting new connections but let in-flight ones finish.
    if (typeof server.closeIdleConnections === "function") {
      server.closeIdleConnections();
    }
  });

  try {
    events.close();
  } catch (_) {}
  try {
    analytics.close();
  } catch (_) {}
  try {
    await cache.close();
  } catch (_) {}

  clearTimeout(forceExit);
  logger.info("Shutdown complete");
}

process.on("SIGINT", () => shutdown("SIGINT").then(() => process.exit(0)));
process.on("SIGTERM", () => shutdown("SIGTERM").then(() => process.exit(0)));

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", {
    error: reason instanceof Error ? reason : String(reason),
  });
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", { error });
  // A corrupted process state is worse than a restart.
  if (config.isProd) {
    shutdown("uncaughtException").then(() => process.exit(1));
  }
});

if (require.main === module) {
  start().catch((error) => {
    logger.error("Failed to start", { error });
    process.exit(1);
  });
}

module.exports = { start, shutdown };
