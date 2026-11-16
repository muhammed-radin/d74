"use strict";

/* ------------------------------------------------------------------
   D74 Edits — HTTP helpers
------------------------------------------------------------------ */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const config = require("./config");

function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
}

function allowedOrigin(req, origin) {
  if (!origin) return true;
  if (config.publicOrigin && origin === config.publicOrigin) return true;
  if (config.cors.origins.includes(origin)) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.host === req.get("host")) return true;
    // Local preview servers (Live Server, Codespaces, Gitpod) in dev only.
    if (!config.isProd) {
      const hostname = parsed.hostname;
      if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)) return true;
      if (/\.(app\.github\.dev|githubpreview\.dev|codespaces\.app|gitpod\.io)$/.test(hostname)) {
        return true;
      }
    }
  } catch (_) {}
  return false;
}

function sameOrigin(req, origin) {
  return allowedOrigin(req, origin);
}

function requestContext(req, res, next) {
  req.id = crypto.randomBytes(8).toString("hex");
  res.setHeader("X-Request-Id", req.id);
  next();
}

function apiHeaders(req, res, next) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
}

const BLOCKED_SEGMENTS = new Set([
  "server",
  "node_modules",
  ".git",
  ".github",
  ".vscode",
  ".idea",
  "scripts",
]);

const BLOCKED_FILES = new Set([
  "server.js",
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "procfile",
  ".env",
  ".env.example",
  ".gitignore",
  "opencode.json",
]);

function blockedPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch (_) {
    return true;
  }
  if (decoded.includes("\0")) return true;
  const segments = decoded.split("/").filter(Boolean);
  for (const segment of segments) {
    if (BLOCKED_SEGMENTS.has(segment) || segment.startsWith(".")) return true;
  }
  const last = segments.length ? segments[segments.length - 1].toLowerCase() : "";
  return BLOCKED_FILES.has(last);
}

function safeJoin(root, requested) {
  let decoded;
  try {
    decoded = decodeURIComponent(requested);
  } catch (_) {
    return null;
  }
  const target = path.join(root, decoded);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return target;
}

function sendHtmlFile(res, file, status = 200) {
  try {
    if (!fs.existsSync(file)) {
      res.status(status).type("text/plain").send("Not found");
      return;
    }
    res.status(status);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    fs.createReadStream(file).pipe(res);
  } catch (_) {
    res.status(500).type("text/plain").send("Server error");
  }
}

module.exports = {
  asyncHandler,
  clientIp,
  hash,
  allowedOrigin,
  sameOrigin,
  requestContext,
  apiHeaders,
  blockedPath,
  safeJoin,
  sendHtmlFile,
};
