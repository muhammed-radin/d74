"use strict";

/* ------------------------------------------------------------------
   D74 Edits — Express application
   Builds the middleware chain, mounts the API routers and serves the
   static front-end. server.js only bootstraps this module.
------------------------------------------------------------------ */

const path = require("path");
const fs = require("fs");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const config = require("./config");
const logger = require("./logger");
const { cache } = require("./cache");
const { events } = require("./events");
const { analytics } = require("./analytics");
const sessions = require("./sessions");
const { rateLimit } = require("./rate-limit");
const {
  requestContext,
  apiHeaders,
  blockedPath,
  safeJoin,
  sendHtmlFile,
  allowedOrigin,
} = require("./http");
const publicRoutes = require("./routes/public");
const adminRoutes = require("./routes/admin");
const dbRoutes = require("./routes/db");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mpd": "application/dash+xml",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

function contentSecurityPolicy() {
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    // JW Player compiles its player at runtime.
    "'unsafe-eval'",
    "https://unpkg.com",
    "https://cdn.jsdelivr.net",
    "https://cdn.jwplayer.com",
    "https://content.jwplatform.com",
    "https://ssl.p.jwpcdn.com",
    "https://*.jwpcdn.com",
    "https://*.jwplayer.com",
    // AdSense loader and the ad-serving scripts it pulls in.
    "https://pagead2.googlesyndication.com",
    "https://*.googlesyndication.com",
    "https://*.doubleclick.net",
    "https://*.googleadservices.com",
    "https://*.adtrafficquality.google",
    "https://adservice.google.com",
    "https://www.googletagservices.com",
    "https://www.google.com",
    "https://*.google.com",
    "https://fundingchoicesmessages.google.com",
  ];
  // JW Player still requests its loader over plain HTTP on some hosts.
  // Allow that only outside production; production stays HTTPS-only.
  if (!config.isProd) {
    scriptSrc.push("http://ssl.p.jwpcdn.com", "http://*.jwpcdn.com");
  }
  const styleSrc = [
    "'self'",
    "'unsafe-inline'",
    "https://fonts.googleapis.com",
    "https://unpkg.com",
    "https://cdn.jsdelivr.net",
    "https://cdn.jwplayer.com",
  ];
  const imgSrc = ["'self'", "data:", "blob:", "https:"];
  // JW Player's telemetry beacon is plain HTTP in development.
  if (!config.isProd) imgSrc.push("http:");
  const mediaSrc = ["'self'", "blob:", "data:", "https:", "http:"];
  const connectSrc = ["'self'", "blob:", "https:", "http:", "wss:"];
  const frameSrc = [
    "'self'",
    "https://www.youtube.com",
    "https://youtube.com",
    "https://*.youtube.com",
    "https://*.youtube-nocookie.com",
    "https://cdn.jwplayer.com",
    "https://ssl.p.jwpcdn.com",
    "https://*.jwplayer.com",
    // Ad iframes (AdSense, Google Ads, funding choices, quality checks).
    "https://*.googlesyndication.com",
    "https://*.doubleclick.net",
    "https://*.googleadservices.com",
    "https://*.adtrafficquality.google",
    "https://*.google.com",
  ];
  if (!config.isProd) frameSrc.push("http://ssl.p.jwpcdn.com");

  const directives = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "script-src": scriptSrc,
    "script-src-attr": ["'unsafe-inline'"],
    "style-src": styleSrc,
    "style-src-attr": ["'unsafe-inline'"],
    "img-src": imgSrc,
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com", "https://unpkg.com"],
    "media-src": mediaSrc,
    "connect-src": connectSrc,
    "frame-src": frameSrc,
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'self'"],
  };
  if (config.isProd) directives["upgrade-insecure-requests"] = [];
  return directives;
}

function compressionFilter(req, res) {
  const type = String(res.getHeader("Content-Type") || "");
  if (type.includes("text/event-stream")) return false;
  if (res.getHeader("X-No-Compression")) return false;
  return compression.filter(req, res);
}

function buildCors() {
  return cors(function corsOptions(req, callback) {
    const origin = req.get("origin");
    callback(null, {
      origin: origin && allowedOrigin(req, origin) ? origin : false,
      credentials: true,
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "X-CSRF-Token", "Accept", "X-Requested-With"],
      exposedHeaders: ["X-Request-Id", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After"],
      maxAge: 600,
    });
  });
}

/* ------------------------------ static ----------------------------- */

function sendNotFound(req, res) {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Unknown API endpoint.", code: "not_found" });
  }
  return sendHtmlFile(res, path.join(config.root, "404", "index.html"), 404);
}

function serveStatic(req, res, next) {
  if (!["GET", "HEAD"].includes(req.method)) return next();

  const requestPath = req.path || "/";
  if (blockedPath(requestPath)) return sendNotFound(req, res);

  const target = safeJoin(config.root, requestPath);
  if (!target) return sendNotFound(req, res);

  let stat = null;
  try {
    stat = fs.statSync(target);
  } catch (_) {
    if (!path.extname(target)) {
      const withHtml = target + ".html";
      const indexFile = path.join(target, "index.html");
      if (fs.existsSync(withHtml) && fs.statSync(withHtml).isFile()) {
        return sendFile(req, res, withHtml);
      }
      if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) {
        return sendFile(req, res, indexFile);
      }
    }
    return sendNotFound(req, res);
  }

  if (stat.isDirectory()) {
    if (!requestPath.endsWith("/")) {
      const [pathname, query] = req.originalUrl.split("?");
      return res.redirect(308, pathname + "/" + (query ? "?" + query : ""));
    }
    const indexFile = path.join(target, "index.html");
    if (!fs.existsSync(indexFile) || !fs.statSync(indexFile).isFile()) {
      return sendNotFound(req, res);
    }
    return sendFile(req, res, indexFile);
  }

  if (!stat.isFile()) return sendNotFound(req, res);
  return sendFile(req, res, target);
}

function sendFile(req, res, file) {
  const ext = path.extname(file).toLowerCase();
  const isHtml = ext === ".html";
  const type = MIME_TYPES[ext] || "application/octet-stream";
  res.setHeader("Content-Type", type);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Cache-Control",
    isHtml ? "no-cache" : "public, max-age=3600, stale-while-revalidate=86400"
  );
  if (ext === ".webmanifest" || ext === ".xml") {
    res.setHeader("Cache-Control", "public, max-age=300");
  }
  if (req.method === "HEAD") {
    return res.status(200).end();
  }
  return res.sendFile(file, { dotfiles: "deny" }, (error) => {
    if (!error) return;
    if (res.headersSent) return;
    logger.error("Static file send failed", { file, error: error.message });
    res.status(500).type("text/plain").send("Server error");
  });
}

/* ------------------------------- app ------------------------------- */

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.set("etag", "strong");

  const { middleware: sessionMiddleware, store: sessionStore, driver } =
    sessions.createSessionMiddleware();
  app.set("d74.sessionStore", sessionStore);
  app.set("d74.sessionDriver", driver);
  app.locals.sessionDriver = driver;

  app.use(requestContext);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: contentSecurityPolicy(),
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
      crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      hsts: config.isProd
        ? { maxAge: 15552000, includeSubDomains: true, preload: false }
        : false,
      originAgentCluster: true,
      dnsPrefetchControl: { allow: false },
      frameguard: { action: "sameorigin" },
    })
  );

  // A small permissions policy on top of Helmet's defaults.
  app.use((req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
    );
    next();
  });

  app.use(compression({ filter: compressionFilter, threshold: 1024 }));
  app.use(buildCors());
  app.use(cookieParser(config.session.secret));

  // Reject unknown cross-origin mutations before they reach any handler.
  app.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (allowedOrigin(req, req.get("origin"))) return next();
    return res.status(403).json({ error: "Cross-origin request rejected.", code: "bad_origin" });
  });

  app.use(express.json({ limit: "128kb", strict: true }));
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));
  app.use(sessionMiddleware);

  // Request timing + analytics. Only writes compact log lines for API
  // traffic or anything that failed, so static assets stay quiet.
  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      try {
        analytics.recordRequest(req, res, durationMs);
      } catch (error) {
        logger.debug("Analytics record failed", { error: error.message });
      }
      const isApi = req.path.startsWith("/api/");
      if (isApi || res.statusCode >= 500) {
        const meta = {
          method: req.method,
          path: req.originalUrl.split("?")[0],
          status: res.statusCode,
          ms: Math.round(durationMs),
        };
        if (res.statusCode >= 500) logger.error("request failed", meta);
        else logger.debug("request", meta);
      }
    });
    next();
  });

  app.use("/api", apiHeaders);

  // Coarse limiter for every API call; individual routes add tighter ones.
  app.use(
    "/api",
    rateLimit({
      name: "api",
      windowMs: config.rateLimits.globalWindowMs,
      max: config.rateLimits.apiMax,
    })
  );

  app.use("/api/admin", adminRoutes);
  app.use("/api/db", dbRoutes);
  app.use("/api", publicRoutes);

  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Unknown API endpoint.", code: "not_found" })
  );

  app.use(serveStatic);

  app.use((req, res) => {
    if (req.accepts(["html", "json"]) === "json") {
      return res.status(404).json({ error: "Not found.", code: "not_found" });
    }
    return sendNotFound(req, res);
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (res.headersSent) return res.end();

    const isApi = req.path.startsWith("/api/");
    let status = Number(error.status || error.statusCode) || 500;
    let message = "Something went wrong.";

    if (error.type === "entity.too.large") {
      status = 413;
      message = "Request body is too large.";
    } else if (error.type === "entity.parse.failed" || error instanceof SyntaxError) {
      status = 400;
      message = "Invalid JSON body.";
    } else if (error.code === "EBADCSRFTOKEN") {
      status = 403;
      message = "Invalid CSRF token.";
    } else if (status < 500) {
      message = error.message || message;
    }

    if (status >= 500) {
      logger.error("Unhandled request error", {
        id: req.id,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        error,
      });
    }

    if (isApi || req.accepts(["html", "json"]) === "json") {
      return res.status(status).json({
        error: message,
        code: error.code || (status >= 500 ? "server_error" : "request_error"),
        requestId: req.id,
      });
    }

    if (status >= 500) {
      return res.status(status).type("text/plain").send("Server error");
    }
    return sendHtmlFile(res, path.join(config.root, "404", "index.html"), status);
  });

  app.locals.cache = cache;
  app.locals.events = events;

  return app;
}

module.exports = { createApp, serveStatic, contentSecurityPolicy };
