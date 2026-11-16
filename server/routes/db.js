"use strict";

/* ------------------------------------------------------------------
   D74 Edits — allow-listed database proxy
   Public reads are limited to videos/themes/promotions and sanitised.
   Every write and every account/custom read requires an administrator
   session plus a CSRF token.
------------------------------------------------------------------ */

const express = require("express");
const config = require("../config");
const logger = require("../logger");
const db = require("../db");
const { asyncHandler, sameOrigin } = require("../http");
const { rateLimit } = require("../rate-limit");
const sessions = require("../sessions");
const { safeEqualStrings } = require("../auth");

const router = express.Router();

const dbGetLimit = rateLimit({ name: "db-get", windowMs: 60 * 1000, max: 180 });
const dbWriteLimit = rateLimit({ name: "db-write", windowMs: 60 * 1000, max: config.rateLimits.dbWriteMax });

const PUBLIC_COLLECTIONS = new Set(["videos", "themes", "promotions"]);

const VIDEO_FIELDS = new Set([
  "title", "description", "date", "thumb", "ytid", "url", "pw",
  "channelId", "channelTitle", "source", "tags", "category",
]);
const ACCOUNT_FIELDS = new Set([
  "name", "email", "password", "passwordHash", "salt", "date", "location",
  "languages", "device", "platform", "brandsAndVersion", "model", "status",
]);
const THEME_FIELDS = new Set(["name", "slug", "description", "accent", "ytids", "createdAt", "updatedAt"]);
const GENERIC_FIELDS = new Set([
  "name", "slug", "title", "description", "accent", "ytids", "url", "thumb",
  "date", "ytid", "pw", "active", "order", "createdAt", "updatedAt", "json",
]);

function invalid(res, message, status = 400) {
  return res.status(status).json({ error: message });
}

function pathFromRequest(req) {
  return String(req.url || "").replace(/^\/+/, "");
}

function collectionOf(pathAndQuery) {
  return String(pathAndQuery).split("?")[0].split("/")[0];
}

function validDataPath(pathAndQuery) {
  return /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)?(\?.*)?$/.test(String(pathAndQuery || ""));
}

function queryString(pathAndQuery) {
  const index = String(pathAndQuery).indexOf("?");
  return index >= 0 ? pathAndQuery.slice(index + 1) : "";
}

function safeText(value, max = 500) {
  return String(value == null ? "" : value).slice(0, max);
}

function safeHttpUrl(value, { allowEmpty = true } = {}) {
  const text = String(value == null ? "" : value).trim();
  if (!text && allowEmpty) return "";
  try {
    const parsed = new URL(text);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.href.slice(0, 2000);
  } catch (_) {
    return null;
  }
}

function pick(body, allowed) {
  const result = {};
  if (!body || typeof body !== "object" || Array.isArray(body)) return result;
  for (const [key, value] of Object.entries(body)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (!allowed.has(key)) continue;
    result[key] = value;
  }
  return result;
}

function sanitizeWriteBody(collection, body) {
  if (collection === "videos") {
    const clean = pick(body, VIDEO_FIELDS);
    if (clean.title != null) clean.title = safeText(clean.title, 300);
    if (clean.description != null) clean.description = safeText(clean.description, 4000);
    if (clean.date != null) clean.date = safeText(clean.date, 40);
    if (clean.ytid != null && !/^[A-Za-z0-9_-]{6,20}$/.test(String(clean.ytid))) {
      throw Object.assign(new Error("Invalid YouTube id."), { status: 400 });
    }
    if (clean.url != null) {
      const url = safeHttpUrl(clean.url);
      if (url === null) throw Object.assign(new Error("Invalid download URL."), { status: 400 });
      clean.url = url;
    }
    if (clean.thumb != null) {
      const thumb = safeHttpUrl(clean.thumb);
      if (thumb === null) throw Object.assign(new Error("Invalid thumbnail URL."), { status: 400 });
      clean.thumb = thumb;
    }
    if (clean.pw != null) clean.pw = safeText(clean.pw, 120);
    if (clean.channelId != null) clean.channelId = safeText(clean.channelId, 80);
    if (clean.channelTitle != null) clean.channelTitle = safeText(clean.channelTitle, 120);
    if (clean.source != null) clean.source = safeText(clean.source, 40);
    return clean;
  }

  if (collection === "account") {
    const clean = pick(body, ACCOUNT_FIELDS);
    for (const key of ["name", "email", "location", "languages", "device", "platform", "brandsAndVersion", "model", "status"]) {
      if (clean[key] != null) clean[key] = safeText(clean[key], key === "brandsAndVersion" ? 2000 : 240);
    }
    return clean;
  }

  if (collection === "themes") {
    const clean = pick(body, THEME_FIELDS);
    for (const key of ["name", "slug", "description", "accent"]) {
      if (clean[key] != null) clean[key] = safeText(clean[key], key === "description" ? 2000 : 200);
    }
    if (clean.ytids != null) {
      if (!Array.isArray(clean.ytids)) throw Object.assign(new Error("ytids must be an array."), { status: 400 });
      clean.ytids = clean.ytids
        .map((value) => String(value))
        .filter((value) => /^[A-Za-z0-9_-]{6,20}$/.test(value))
        .slice(0, 200);
    }
    return clean;
  }

  return pick(body, GENERIC_FIELDS);
}

async function adminFromRequest(req) {
  const info = await sessions.sessionInfo(req).catch(() => null);
  if (!info) return null;
  req.admin = info;
  return info;
}

function checkCsrf(req, info) {
  if (!sameOrigin(req)) return "bad_origin";
  const token = String(req.get("x-csrf-token") || "");
  if (!token || !safeEqualStrings(token, info.csrfToken)) return "csrf";
  return null;
}

function sanitizeResponse(collection, data, admin) {
  if (collection === "videos") return db.prepareVideos(data, { stripSecrets: !admin });
  if (collection === "account") return db.prepareAccounts(data);
  return data;
}

router.all(
  "*",
  asyncHandler(async (req, res) => {
    const pathAndQuery = pathFromRequest(req);
    if (!pathAndQuery || pathAndQuery.length > 600) {
      return invalid(res, "Invalid data path.", 400);
    }
    if (!validDataPath(pathAndQuery)) return invalid(res, "Invalid data path.", 400);

    const collection = collectionOf(pathAndQuery);
    if (!config.db.allowlist.has(collection)) return invalid(res, "Unknown collection.", 404);

    const isPublic = PUBLIC_COLLECTIONS.has(collection);
    let admin = null;

    if (req.method === "GET" || req.method === "HEAD") {
      // Public collections can be read anonymously, but an authenticated
      // administrator still receives the full record (download URL and
      // password) so the editor can manage it. Only the response below
      // decides whether secrets are stripped.
      admin = await adminFromRequest(req);
      if (!isPublic && !admin) {
        return invalid(res, "Administrator session required.", 401);
      }
      const limit = await dbGetLimit(req, res, () => {});
      // The limiter writes the 429 response itself; stop here if it did.
      if (res.headersSent) return;
      void limit;

      const data = await db.read(pathAndQuery, {
        ttl: collection === "account" ? 30 : config.cache.dbTtl,
        staleTtl: config.cache.dbStaleTtl,
      });
      const payload = sanitizeResponse(collection, data, Boolean(admin));
      if (isPublic && !admin) {
        res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=45");
      } else if (admin) {
        // Records returned to an administrator may contain download URLs
        // and passwords; never let a shared cache store them.
        res.setHeader("Cache-Control", "private, no-store");
      }
      return res.json(payload);
    }

    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      return invalid(res, "Method not allowed.", 405);
    }

    admin = await adminFromRequest(req);
    if (!admin) return invalid(res, "Administrator session required.", 401);

    const reason = checkCsrf(req, admin);
    if (reason === "bad_origin") return invalid(res, "Cross-origin request rejected.", 403);
    if (reason === "csrf") return invalid(res, "Invalid or missing CSRF token.", 403);

    await dbWriteLimit(req, res, () => {});
    if (res.headersSent) return;

    let body;
    if (req.method !== "DELETE") {
      body = sanitizeWriteBody(collection, req.body || {});
      if (collection === "account" && body.password) {
        const { hashPassword } = require("../auth");
        const { salt, hash } = hashPassword(body.password);
        body.passwordHash = hash;
        body.salt = salt;
        body.password = "";
      }
    }

    const result = await db.write(req.method, pathAndQuery, body);
    return res.status(result.status).json(sanitizeResponse(collection, result.data, true));
  })
);

module.exports = router;
