"use strict";

/* ------------------------------------------------------------------
   D74 Edits — administrator sessions
   Server-side sessions with an httpOnly, SameSite=Strict cookie, CSRF
   tokens, idle + absolute expiry, user-agent binding, CSRF rotation and
   on-demand session-id regeneration, plus a global revocation epoch.
------------------------------------------------------------------ */

const crypto = require("crypto");
const session = require("express-session");
const RedisStoreFactory = require("connect-redis").default;
const memorystore = require("memorystore");
const config = require("./config");
const logger = require("./logger");
const { cache } = require("./cache");
const { events } = require("./events");
const { safeEqualStrings } = require("./auth");
const { allowedOrigin } = require("./http");

const MemoryStore = memorystore(session);
const ADMIN_KEY = "admin";
const EPOCH_KEY = "admin:epoch";
const SESSION_SET_KEY = "admin:sessions";
const SESSION_KEY_PREFIX = "admin:session:";

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24);
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function userAgent(req) {
  return String(req.get("user-agent") || "unknown").slice(0, 300);
}

function regenerate(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function save(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function destroy(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

function createSessionMiddleware() {
  let store;
  let driver = "memory";
  if (cache.connected && cache.client) {
    store = new RedisStoreFactory({
      client: cache.client,
      prefix: "d74:sess:",
      ttl: config.session.absoluteHours * 3600,
      disableTouch: false,
    });
    driver = "redis";
  } else {
    store = new MemoryStore({
      checkPeriod: 120000,
      stale: false,
      max: 10000,
    });
  }

  const middleware = session({
    name: config.session.cookieName,
    secret: config.session.secret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: Boolean(config.trustProxy),
    cookie: {
      httpOnly: true,
      secure: config.session.secureCookie,
      sameSite: "strict",
      path: "/",
      maxAge: config.session.idleMinutes * 60 * 1000,
    },
  });

  logger.info("Admin session store: " + driver);
  return { middleware, store, driver };
}

async function currentEpoch() {
  return Number(await cache.get(EPOCH_KEY)) || 1;
}

async function startAdminSession(req, meta = {}) {
  await regenerate(req);
  const now = Date.now();
  const epoch = await currentEpoch();
  const csrf = randomToken(24);
  const ip = clientIp(req);
  const ua = userAgent(req);

  req.session[ADMIN_KEY] = {
    name: meta.name || config.admin.username,
    username: meta.username || config.admin.username,
    issuedAt: now,
    lastSeen: now,
    absoluteExpiresAt: now + config.session.absoluteHours * 3600 * 1000,
    rotatedAt: now,
    epoch,
    csrf,
    ipHash: hash(ip),
    uaHash: hash(ua),
  };
  await save(req);

  const sid = req.sessionID;
  const record = {
    sid,
    key: hash(sid),
    name: req.session[ADMIN_KEY].name,
    username: req.session[ADMIN_KEY].username,
    ip,
    userAgent: ua,
    createdAt: now,
    lastSeen: now,
    expiresAt: req.session[ADMIN_KEY].absoluteExpiresAt,
  };
  await cache.set(SESSION_KEY_PREFIX + sid, record, config.session.absoluteHours * 3600);
  await cache.sadd(SESSION_SET_KEY, sid, config.session.absoluteHours * 3600 + 3600);
  await enforceSessionLimit(sid);

  events.broadcast("security:login", {
    name: record.name,
    ip: maskIp(ip),
    at: new Date(now).toISOString(),
  }, { adminOnly: true });

  logger.info("Admin session created", { sid: sid.slice(0, 8), ip: maskIp(ip) });
  return sessionInfoFrom(req, true);
}

async function sessionInfoFrom(req, fresh = false) {
  const data = req.session && req.session[ADMIN_KEY];
  if (!data) return null;

  const now = Date.now();
  const epoch = await currentEpoch();
  const uaHash = hash(userAgent(req));
  const ipHash = hash(clientIp(req));

  let invalid = null;
  if (!data.absoluteExpiresAt || data.absoluteExpiresAt <= now) invalid = "expired";
  else if (Number(data.epoch) !== Number(epoch)) invalid = "revoked";
  else if (config.session.bindUserAgent && data.uaHash && data.uaHash !== uaHash) invalid = "user-agent";
  else if (config.session.bindIp && data.ipHash && data.ipHash !== ipHash) invalid = "ip";

  if (invalid) {
    logger.warn("Admin session rejected", { reason: invalid, sid: String(req.sessionID).slice(0, 8) });
    await destroy(req).catch(() => {});
    return null;
  }

  if (!fresh && now - Number(data.lastSeen || 0) > 60000) {
    data.lastSeen = now;
    req.session[ADMIN_KEY] = data;
    await save(req).catch(() => {});
    const record = await cache.get(SESSION_KEY_PREFIX + req.sessionID);
    if (record) {
      record.lastSeen = now;
      await cache.set(SESSION_KEY_PREFIX + req.sessionID, record, config.session.absoluteHours * 3600);
    }
  }

  return {
    authenticated: true,
    name: data.name,
    username: data.username,
    csrfToken: data.csrf,
    issuedAt: new Date(data.issuedAt).toISOString(),
    lastSeen: new Date(data.lastSeen || now).toISOString(),
    expiresAt: new Date(data.absoluteExpiresAt).toISOString(),
    idleMinutes: config.session.idleMinutes,
    absoluteHours: config.session.absoluteHours,
    rotateMinutes: config.session.rotateMinutes,
    ip: maskIp(clientIp(req)),
    userAgent: userAgent(req),
    sessionAgeSeconds: Math.round((now - data.issuedAt) / 1000),
  };
}

function sessionInfo(req) {
  return sessionInfoFrom(req);
}

async function requireAdmin(req, res, next) {
  try {
    const info = await sessionInfoFrom(req);
    if (!info) {
      return res.status(401).json({ error: "Administrator session required.", code: "admin_required" });
    }
    req.admin = info;
    // Rotate the CSRF token periodically without changing the session id.
    const data = req.session[ADMIN_KEY];
    if (Date.now() - Number(data.rotatedAt || 0) > config.session.rotateMinutes * 60000) {
      data.csrf = randomToken(24);
      data.rotatedAt = Date.now();
      req.session[ADMIN_KEY] = data;
      await save(req).catch(() => {});
      req.admin.csrfToken = data.csrf;
      events.broadcast("security:rotated", { sid: req.sessionID.slice(0, 8) }, { adminOnly: true });
    }
    return next();
  } catch (error) {
    logger.error("Session check failed", { error });
    return res.status(500).json({ error: "Could not verify the session." });
  }
}

function sameOrigin(req) {
  return allowedOrigin(req, req.get("origin"));
}

async function requireCsrf(req, res, next) {
  if (!req.admin) return res.status(401).json({ error: "Administrator session required." });
  if (!sameOrigin(req)) {
    return res.status(403).json({ error: "Cross-origin request rejected.", code: "bad_origin" });
  }
  const supplied = String(req.get("x-csrf-token") || "");
  if (!supplied || !safeEqualStrings(supplied, req.admin.csrfToken)) {
    return res.status(403).json({ error: "Invalid or missing CSRF token.", code: "csrf" });
  }
  return next();
}

async function logout(req) {
  const sid = req.sessionID;
  const data = req.session && req.session[ADMIN_KEY];
  await destroy(req).catch(() => {});
  if (sid) {
    await cache.srem(SESSION_SET_KEY, sid);
    await cache.del(SESSION_KEY_PREFIX + sid);
  }
  if (data) {
    events.broadcast("security:logout", { name: data.name }, { adminOnly: true });
    logger.info("Admin session ended", { sid: String(sid).slice(0, 8) });
  }
}

/* Issue a brand-new session id, keep the authenticated identity, and
   return a fresh CSRF token. The old store entry and cache record are
   dropped, so a stolen cookie stops working the moment it is rotated. */
async function rotateSession(req) {
  const data = req.session && req.session[ADMIN_KEY];
  if (!data) {
    return { ok: false, reason: "missing" };
  }

  const oldSid = req.sessionID;
  const oldRecord = await cache.get(SESSION_KEY_PREFIX + oldSid);

  await regenerate(req);
  const now = Date.now();
  const newSid = req.sessionID;

  const next = {
    ...data,
    csrf: randomToken(24),
    rotatedAt: now,
    lastSeen: now,
  };
  req.session[ADMIN_KEY] = next;
  await save(req);

  await cache.srem(SESSION_SET_KEY, oldSid);
  await cache.del(SESSION_KEY_PREFIX + oldSid);

  const record = {
    sid: newSid,
    key: hash(newSid),
    name: next.name,
    username: next.username,
    ip: (oldRecord && oldRecord.ip) || clientIp(req),
    userAgent: (oldRecord && oldRecord.userAgent) || userAgent(req),
    createdAt: (oldRecord && oldRecord.createdAt) || now,
    lastSeen: now,
    expiresAt: next.absoluteExpiresAt,
  };
  await cache.set(SESSION_KEY_PREFIX + newSid, record, config.session.absoluteHours * 3600);
  await cache.sadd(SESSION_SET_KEY, newSid, config.session.absoluteHours * 3600 + 3600);

  events.broadcast("security:rotated", { sid: newSid.slice(0, 8) }, { adminOnly: true });
  logger.info("Admin session rotated", { sid: newSid.slice(0, 8) });
  return { ok: true, csrfToken: next.csrf };
}

async function activeSessions({ includeFull = false } = {}) {
  const ids = await cache.smembers(SESSION_SET_KEY);
  const now = Date.now();
  const records = [];
  for (const sid of ids) {
    const record = await cache.get(SESSION_KEY_PREFIX + sid);
    if (!record) {
      await cache.srem(SESSION_SET_KEY, sid);
      continue;
    }
    if (record.expiresAt && record.expiresAt <= now) {
      await cache.srem(SESSION_SET_KEY, sid);
      await cache.del(SESSION_KEY_PREFIX + sid);
      continue;
    }
    const row = {
      key: record.key || hash(sid),
      name: record.name,
      username: record.username,
      ip: maskIp(record.ip),
      userAgent: record.userAgent,
      createdAt: new Date(record.createdAt).toISOString(),
      lastSeen: new Date(record.lastSeen).toISOString(),
      expiresAt: new Date(record.expiresAt).toISOString(),
    };
    if (includeFull) row.sidFull = sid;
    records.push(row);
  }
  records.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
  return records;
}

async function revokeSession(req, key) {
  if (!key) return false;
  const ids = await cache.smembers(SESSION_SET_KEY);
  let target = null;
  for (const sid of ids) {
    const record = await cache.get(SESSION_KEY_PREFIX + sid);
    if ((record && record.key === key) || hash(sid) === key) {
      target = sid;
      break;
    }
  }
  if (!target) return false;

  await cache.srem(SESSION_SET_KEY, target);
  await cache.del(SESSION_KEY_PREFIX + target);
  const store = req.app.get("d74.sessionStore");
  if (store && typeof store.destroy === "function") {
    await new Promise((resolve) => store.destroy(target, () => resolve()));
  }
  const current = target === req.sessionID;
  if (current) await destroy(req).catch(() => {});
  events.broadcast("security:revoked", { key }, { adminOnly: true });
  return current ? "current" : true;
}

async function revokeAll(req, { keepCurrent = true } = {}) {
  const epoch = (await currentEpoch()) + 1;
  await cache.set(EPOCH_KEY, epoch, config.session.absoluteHours * 3600 + 86400);
  const ids = await cache.smembers(SESSION_SET_KEY);
  const store = req.app.get("d74.sessionStore");
  let revoked = 0;
  for (const sid of ids) {
    if (keepCurrent && sid === req.sessionID) continue;
    await cache.srem(SESSION_SET_KEY, sid);
    await cache.del(SESSION_KEY_PREFIX + sid);
    if (store && typeof store.destroy === "function") {
      await new Promise((resolve) => store.destroy(sid, () => resolve()));
    }
    revoked += 1;
  }
  if (keepCurrent && req.session && req.session[ADMIN_KEY]) {
    req.session[ADMIN_KEY].epoch = epoch;
    req.session[ADMIN_KEY].csrf = randomToken(24);
    req.session[ADMIN_KEY].rotatedAt = Date.now();
    await save(req).catch(() => {});
  }
  events.broadcast("security:revoked-all", { revoked, epoch }, { adminOnly: true });
  logger.warn("Admin sessions revoked", { revoked, keepCurrent });
  return { revoked, epoch };
}

async function enforceSessionLimit(keepSid) {
  if (config.session.maxSessions <= 0) return;
  const records = await activeSessions({ includeFull: true });
  if (records.length <= config.session.maxSessions) return;
  const stale = records.filter((record) => record.sidFull !== keepSid).slice(config.session.maxSessions - 1);
  for (const record of stale) {
    await cache.srem(SESSION_SET_KEY, record.sidFull);
    await cache.del(SESSION_KEY_PREFIX + record.sidFull);
  }
}

function maskIp(ip) {
  const value = String(ip || "unknown").replace(/^::ffff:/, "");
  if (value === "::1" || value === "127.0.0.1" || value === "localhost") return "local";
  if (value.includes(".")) {
    const parts = value.split(".");
    if (parts.length === 4) return parts.slice(0, 3).join(".") + ".x";
  }
  if (value.includes(":")) {
    const parts = value.split(":").filter(Boolean);
    if (!parts.length) return "unknown";
    return parts.slice(0, 2).join(":") + "::x";
  }
  return "unknown";
}

module.exports = {
  createSessionMiddleware,
  startAdminSession,
  sessionInfo,
  requireAdmin,
  requireCsrf,
  rotateSession,
  logout,
  activeSessions,
  revokeSession,
  revokeAll,
  sameOrigin,
  maskIp,
  hash,
  SESSION_KEY_PREFIX,
  SESSION_SET_KEY,
};
