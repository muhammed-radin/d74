"use strict";

/* ------------------------------------------------------------------
   D74 Edits — distributed rate limiter
   Uses the shared cache so limits hold across Node instances when Redis
   is enabled. Successful logins can be skipped so only failures count.
------------------------------------------------------------------ */

const { cache } = require("./cache");
const { clientIp, hash } = require("./http");

function rateLimit(options = {}) {
  const {
    name = "general",
    windowMs = 60000,
    max = 60,
    skipSuccessful = false,
    key = null,
  } = options;
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));

  return async function limiter(req, res, next) {
    try {
      const suffix = typeof key === "function" ? String((await key(req)) || "") : "";
      const bucket = "rl:" + name + ":" + clientIp(req) + (suffix ? ":" + hash(suffix) : "");
      const count = await cache.incr(bucket, 1, windowSeconds);

      res.setHeader("RateLimit-Limit", max);
      res.setHeader("RateLimit-Remaining", Math.max(0, max - count));
      res.setHeader("RateLimit-Reset", windowSeconds);
      res.setHeader("RateLimit-Policy", max + ";" + "w=" + windowSeconds);

      if (count > max) {
        res.setHeader("Retry-After", windowSeconds);
        return res.status(429).json({
          error: "Too many requests. Please try again later.",
          code: "rate_limited",
          retryAfter: windowSeconds,
        });
      }

      if (skipSuccessful) {
        res.on("finish", () => {
          if (res.statusCode < 400) cache.incr(bucket, -1, windowSeconds).catch(() => {});
        });
      }
      return next();
    } catch (error) {
      // Never take the site down because the limiter storage failed.
      return next();
    }
  };
}

module.exports = { rateLimit };
