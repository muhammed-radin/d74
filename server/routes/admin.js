"use strict";

/* ------------------------------------------------------------------
   D74 Edits — administrator API
   Session management, dashboard, analytics, monitoring, audit and the
   YouTube sync controls.
------------------------------------------------------------------ */

const express = require("express");
const config = require("../config");
const logger = require("../logger");
const db = require("../db");
const { cache } = require("../cache");
const { quota } = require("../quota");
const { events } = require("../events");
const { analytics } = require("../analytics");
const { youtube } = require("../youtube");
const channels = require("../channels");
const { bulkSync } = require("../bulk-sync");
const { verifyAdminCredentials } = require("../auth");
const { asyncHandler, clientIp, hash, sameOrigin } = require("../http");
const { rateLimit } = require("../rate-limit");
const sessions = require("../sessions");

const router = express.Router();

const adminLoginLimit = rateLimit({
  name: "admin-login",
  windowMs: config.admin.windowMinutes * 60 * 1000,
  max: config.admin.maxLoginAttempts,
  skipSuccessful: true,
  key: (req) => String((req.body && req.body.username) || ""),
});

const channelWriteLimit = rateLimit({
  name: "admin-channels",
  windowMs: 60 * 1000,
  max: 60,
});

const bulkControlLimit = rateLimit({
  name: "admin-bulk",
  windowMs: 60 * 1000,
  max: 120,
});

const videoBulkLimit = rateLimit({
  name: "admin-video-bulk",
  windowMs: 60 * 1000,
  max: 20,
});

function audit(req, action, meta = {}) {
  analytics.audit(action, {
    actor: meta.actor || (req.admin ? req.admin.username : "admin"),
    ip: clientIp(req),
    userAgent: req.get("user-agent"),
    severity: meta.severity,
    meta: meta.meta,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(config.session.cookieName, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: config.session.secureCookie,
  });
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function currentSessionKey(req) {
  // Derive the public session key from the live session id. The raw id is
  // never included in a response; only this hash is compared client-side.
  return req.sessionID ? hash(req.sessionID) : "";
}

/* ------------------------------ login ------------------------------ */

router.post(
  "/login",
  adminLoginLimit,
  asyncHandler(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (config.isProd && !sameOrigin(req)) {
      return res.status(403).json({ error: "Cross-origin login rejected.", code: "bad_origin" });
    }
    const username = String((req.body && req.body.username) || "").trim();
    const password = String((req.body && req.body.password) || "");
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }

    const result = verifyAdminCredentials(username, password);
    if (!result.ok) {
      const reason = result.reason === "not-configured" ? "Admin login is not configured." : "Invalid administrator credentials.";
      audit(req, "admin.login.failed", {
        actor: username || "unknown",
        severity: "warn",
        meta: { reason: result.reason },
      });
      return res.status(result.reason === "not-configured" ? 503 : 401).json({ error: reason });
    }

    const admin = await sessions.startAdminSession(req, {
      name: config.admin.username,
      username: config.admin.username,
    });
    audit(req, "admin.login", { actor: config.admin.username, meta: { at: admin.issuedAt } });
    return res.json({
      admin,
      csrfToken: admin.csrfToken,
      name: admin.name,
      expiresAt: admin.expiresAt,
    });
  })
);

router.post(
  "/logout",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(sessions.requireCsrf),
  asyncHandler(async (req, res) => {
    audit(req, "admin.logout");
    await sessions.logout(req);
    clearSessionCookie(res);
    res.json({ ok: true });
  })
);

router.get(
  "/session",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(async (req, res) => {
    const active = await sessions.activeSessions();
    res.json({
      admin: req.admin,
      activeSessions: active.length,
      totalSessions: active.length,
    });
  })
);

router.post(
  "/session/rotate",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(sessions.requireCsrf),
  asyncHandler(async (req, res) => {
    const result = await sessions.rotateSession(req);
    if (!result.ok) {
      return res.status(401).json({ error: "Administrator session required.", code: "admin_required" });
    }
    audit(req, "admin.session.rotated");
    res.json({ ok: true, csrfToken: result.csrfToken });
  })
);

/* ---------------------------- dashboard ---------------------------- */

router.get(
  "/dashboard",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(async (req, res) => {
    const warnings = [];
    const load = async (collection, ttl = 120) => {
      try {
        return safeArray(await db.getAll(collection, { ttl, staleTtl: 900 }));
      } catch (error) {
        warnings.push("Could not load " + collection + ": " + error.message);
        return [];
      }
    };

    const [videos, accounts, themes, quotaStatus, youtubeStatus, auditLog, activeSessions, traffic] =
      await Promise.all([
        load("videos"),
        load("account"),
        load("themes"),
        quota.snapshot().catch(() => null),
        youtube.status().catch(() => null),
        analytics.auditLog(10).catch(() => []),
        sessions.activeSessions().catch(() => []),
        Promise.resolve(analytics.snapshot("24h")),
      ]);

    const cacheInfo = cache.snapshot();
    const currentKey = currentSessionKey(req);
    const recentVideos = videos
      .slice()
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .slice(0, 6)
      .map((video) => db.prepareVideoRecord(video, { stripSecrets: true }));

    if (!cacheInfo.redis) warnings.push("Redis is not connected; this instance is using its in-memory cache.");
    if (quotaStatus && quotaStatus.db.limit && quotaStatus.db.percent >= 80) {
      warnings.push("Database daily quota is at " + quotaStatus.db.percent + "%.");
    }
    if (quotaStatus && quotaStatus.youtube.limit && quotaStatus.youtube.percent >= 80) {
      warnings.push("YouTube daily quota is at " + quotaStatus.youtube.percent + "%.");
    }
    if (youtubeStatus && youtubeStatus.lastResult && youtubeStatus.lastResult.errors) {
      warnings.push("The last YouTube sync reported " + youtubeStatus.lastResult.errors + " error(s).");
    }

    res.json({
      generatedAt: new Date().toISOString(),
      session: req.admin,
      stats: {
        videos: videos.length,
        downloadable: videos.filter((video) => Boolean(video.url) && video.url !== "https://youtube.com/watch?v=" + video.ytid).length,
        accounts: accounts.length,
        themes: themes.length,
        requestsToday: traffic.totals.requestsToday,
        uniqueVisitors: traffic.totals.uniqueVisitors,
        errorRate: traffic.totals.errorRate,
        avgMs: traffic.totals.avgMs,
        cacheHitRate: cacheInfo.hitRate,
        activeSessions: activeSessions.length,
        openEvents: events.count(),
      },
      traffic,
      quota: quotaStatus,
      youtube: youtubeStatus,
      cache: cacheInfo,
      system: analytics.system(),
      audit: auditLog,
      sessions: activeSessions.map((row) => ({ ...row, current: row.key === currentKey })),
      events: events.recentEvents(15, { admin: true }),
      recentVideos,
      warnings,
    });
  })
);

router.get(
  "/analytics",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(async (req, res) => {
    const range = String(req.query.range || "24h");
    const snapshot = analytics.snapshot(range);
    const [quotaStatus, youtubeStatus] = await Promise.all([
      quota.snapshot().catch(() => null),
      youtube.status().catch(() => null),
    ]);
    res.json({
      ...snapshot,
      quota: quotaStatus,
      youtube: youtubeStatus,
      system: analytics.system(),
      cache: cache.snapshot(),
    });
  })
);

router.get(
  "/monitoring",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(async (req, res) => {
    const [quotaStatus, youtubeStatus, activeSessions] = await Promise.all([
      quota.snapshot().catch(() => null),
      youtube.status().catch(() => null),
      sessions.activeSessions().catch(() => []),
    ]);
    const cacheInfo = cache.snapshot();
    const alerts = [];
    if (!cacheInfo.redis) {
      alerts.push({ level: "warn", message: "Redis is offline. Cache and sessions are memory-only on this instance." });
    }
    if (quotaStatus && quotaStatus.db.limit && quotaStatus.db.percent >= 80) {
      alerts.push({ level: quotaStatus.db.percent >= 95 ? "error" : "warn", message: "Database quota at " + quotaStatus.db.percent + "%." });
    }
    if (quotaStatus && quotaStatus.youtube.limit && quotaStatus.youtube.percent >= 80) {
      alerts.push({ level: quotaStatus.youtube.percent >= 95 ? "error" : "warn", message: "YouTube quota at " + quotaStatus.youtube.percent + "%." });
    }
    if (youtubeStatus && youtubeStatus.running) {
      alerts.push({ level: "info", message: "A YouTube sync is currently running." });
    }
    if (cacheInfo.errors > 0) {
      alerts.push({ level: "warn", message: cacheInfo.errors + " cache operation error(s) recorded." });
    }

    res.json({
      generatedAt: new Date().toISOString(),
      system: analytics.system(),
      cache: cacheInfo,
      quota: quotaStatus,
      youtube: youtubeStatus,
      sessions: { active: activeSessions.length, max: config.session.maxSessions },
      events: { clients: events.count(), recent: events.recentEvents(20, { admin: true }) },
      analytics: {
        lastHour: analytics.totalsFor("1h"),
        last24Hours: analytics.totalsFor("24h"),
        last7Days: analytics.totalsFor("7d"),
      },
      alerts,
    });
  })
);

router.get(
  "/audit",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(async (req, res) => {
    const limit = Math.max(1, Math.min(250, Number(req.query.limit) || 60));
    res.json({ items: await analytics.auditLog(limit) });
  })
);

/* ---------------------------- sessions ----------------------------- */

router.get(
  "/sessions",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(async (req, res) => {
    const currentKey = currentSessionKey(req);
    const list = await sessions.activeSessions();
    res.json({
      currentKey,
      max: config.session.maxSessions,
      items: list.map((row) => ({ ...row, current: row.key === currentKey })),
    });
  })
);

router.delete(
  "/sessions/:key",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(sessions.requireCsrf),
  asyncHandler(async (req, res) => {
    const result = await sessions.revokeSession(req, String(req.params.key || ""));
    if (!result) return res.status(404).json({ error: "Session not found." });
    audit(req, "admin.session.revoked", { severity: "warn", meta: { own: result === "current" } });
    if (result === "current") clearSessionCookie(res);
    res.json({ ok: true, current: result === "current" });
  })
);

router.delete(
  "/sessions",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(sessions.requireCsrf),
  asyncHandler(async (req, res) => {
    const result = await sessions.revokeAll(req, { keepCurrent: true });
    audit(req, "admin.sessions.revoked-all", { severity: "warn", meta: result });
    const info = await sessions.sessionInfo(req);
    res.json({ ok: true, ...result, csrfToken: info ? info.csrfToken : null });
  })
);

/* ----------------------------- youtube ----------------------------- */

router.get(
  "/youtube/status",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(async (req, res) => {
    res.json(await youtube.status());
  })
);

router.post(
  "/youtube/sync",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(sessions.requireCsrf),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const options = {
      dryRun: Boolean(body.dryRun || req.query.dryRun),
      pages: Number(body.pages || req.query.pages) || config.youtube.syncPages,
      maxNew: Number(body.maxNew || req.query.maxNew) || config.youtube.syncMaxNew,
      force: Boolean(body.force || req.query.force),
    };
    const wait = Boolean(body.wait || req.query.wait) || options.dryRun;

    audit(req, "youtube.sync.requested", { meta: options });
    if (youtube.isBusy()) {
      return res.status(409).json({
        error: youtube.externalLock
          ? "A bulk sync job is active. Pause or stop it before running the regular sync."
          : "A sync is already running.",
        code: youtube.externalLock ? "sync_locked" : "sync_running",
        bulk: bulkSync.snapshot(),
      });
    }

    if (wait) {
      const result = await youtube.syncAll("manual", options);
      return res.json(result);
    }

    const started = await youtube.startSync("manual", options);
    return res.status(202).json(started);
  })
);

/* --------------------------- bulk sync ----------------------------- */

router.get(
  "/bulk/status",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(async (req, res) => {
    let videosCount = null;
    try {
      videosCount = await db.count("videos", { ttl: 10, staleTtl: 60 });
    } catch (_) {}
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ...bulkSync.snapshot(),
      videosCount,
      provider: db.providerInfo(),
      youtube: {
        running: youtube.running,
        externalLock: Boolean(youtube.externalLock),
      },
    });
  })
);

function bulkOptions(req) {
  const body = req.body || {};
  return {
    reset: Boolean(body.reset),
    clearVideos: Boolean(body.clearVideos),
    batchSize: Number(body.batchSize) || undefined,
    dailyLimit: Number(body.dailyLimit) || undefined,
    delayMinutes: Number(body.delayMinutes) || undefined,
  };
}

router.post(
  "/bulk/start",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(sessions.requireCsrf),
  bulkControlLimit,
  asyncHandler(async (req, res) => {
    const options = bulkOptions(req);
    audit(req, "youtube.bulk-sync.started", { meta: options });

    let cleared = null;
    if (options.clearVideos) {
      const removed = await db.clearCollection("videos");
      cleared = (removed.data && removed.data.deleted) || 0;
      audit(req, "videos.delete-all", {
        severity: "warn",
        meta: { deleted: cleared, reason: "bulk-sync-start" },
      });
    }

    const result = await bulkSync.start({ ...options, reset: Boolean(options.reset || options.clearVideos) });
    res.json({ ...result, cleared });
  })
);

router.post(
  "/bulk/pause",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(sessions.requireCsrf),
  bulkControlLimit,
  asyncHandler(async (req, res) => {
    const result = await bulkSync.pause();
    audit(req, "youtube.bulk-sync.paused", { severity: "warn" });
    res.json(result);
  })
);

router.post(
  "/bulk/resume",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(sessions.requireCsrf),
  bulkControlLimit,
  asyncHandler(async (req, res) => {
    const result = await bulkSync.resume(bulkOptions(req));
    audit(req, "youtube.bulk-sync.resumed");
    res.json(result);
  })
);

router.post(
  "/bulk/stop",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(sessions.requireCsrf),
  bulkControlLimit,
  asyncHandler(async (req, res) => {
    const result = await bulkSync.stop();
    audit(req, "youtube.bulk-sync.stopped", { severity: "warn" });
    res.json(result);
  })
);

router.post(
  "/bulk/next-channel",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(sessions.requireCsrf),
  bulkControlLimit,
  asyncHandler(async (req, res) => {
    const result = await bulkSync.nextChannel();
    audit(req, "youtube.bulk-sync.next-channel", {
      meta: { index: result.currentChannelIndex },
    });
    res.json(result);
  })
);

router.post(
  "/bulk/complete-channel",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(sessions.requireCsrf),
  bulkControlLimit,
  asyncHandler(async (req, res) => {
    const result = await bulkSync.completeChannel();
    audit(req, "youtube.bulk-sync.complete-channel", {
      meta: { index: result.currentChannelIndex },
    });
    res.json(result);
  })
);

router.post(
  "/bulk/finish",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(sessions.requireCsrf),
  bulkControlLimit,
  asyncHandler(async (req, res) => {
    await bulkSync.finish("Marked complete by administrator.");
    audit(req, "youtube.bulk-sync.finished", { severity: "warn" });
    res.json(bulkSync.snapshot());
  })
);

router.post(
  "/bulk/sync-now",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(sessions.requireCsrf),
  bulkControlLimit,
  asyncHandler(async (req, res) => {
    const result = await bulkSync.syncNow();
    audit(req, "youtube.bulk-sync.sync-now");
    res.json(result);
  })
);

router.post(
  "/bulk/reset",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(sessions.requireCsrf),
  bulkControlLimit,
  asyncHandler(async (req, res) => {
    const result = await bulkSync.reset();
    audit(req, "youtube.bulk-sync.reset", { severity: "warn" });
    res.json(result);
  })
);

/* ------------------------ bulk video library ----------------------- */

router.post(
  "/videos/delete-all",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(sessions.requireCsrf),
  videoBulkLimit,
  asyncHandler(async (req, res) => {
    const confirm = String((req.body && req.body.confirm) || "");
    if (confirm !== "DELETE ALL VIDEOS") {
      return res.status(400).json({
        error: 'Type "DELETE ALL VIDEOS" to confirm.',
        code: "confirm_required",
      });
    }
    const result = await db.clearCollection("videos");
    const deleted = (result.data && result.data.deleted) || 0;
    audit(req, "videos.delete-all", { severity: "warn", meta: { deleted } });
    res.json({ ok: true, deleted });
  })
);

router.post(
  "/videos/bulk-delete",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(sessions.requireCsrf),
  videoBulkLimit,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const raw = Array.isArray(body.ids) ? body.ids : Array.isArray(body.ytids) ? body.ytids : [];
    const ids = Array.from(
      new Set(
        raw
          .map((value) => String(value || "").trim())
          .filter((value) => /^[A-Za-z0-9_-]{1,150}$/.test(value))
      )
    ).slice(0, 500);

    if (!ids.length) {
      return res.status(400).json({ error: "Select at least one video.", code: "missing_ids" });
    }

    let deleted = 0;
    const errors = [];
    for (const id of ids) {
      try {
        await db.write("DELETE", "videos/" + encodeURIComponent(id), undefined);
        deleted += 1;
      } catch (error) {
        errors.push({ id, error: error.message });
      }
    }
    audit(req, "videos.bulk-deleted", {
      severity: "warn",
      meta: { requested: ids.length, deleted, errors: errors.length },
    });
    res.json({ ok: true, requested: ids.length, deleted, errors });
  })
);

router.post(
  "/videos/bulk-add",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(sessions.requireCsrf),
  videoBulkLimit,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const raw = Array.isArray(body.ids)
      ? body.ids
      : String(body.text || body.ids || "").split(/[\s,;]+/);
    const ids = raw.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 500);
    if (!ids.length) {
      return res.status(400).json({ error: "Add at least one YouTube id.", code: "missing_ids" });
    }
    const result = await youtube.addByIds(ids);
    audit(req, "videos.bulk-added", {
      severity: result.errors.length ? "warn" : "info",
      meta: {
        requested: result.requested,
        created: result.created,
        skipped: result.skipped,
        errors: result.errors.length,
      },
    });
    res.json({ ok: true, ...result });
  })
);

/* ------------------------- maintenance ----------------------------- */

router.post(
  "/cache/clear",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(sessions.requireCsrf),
  asyncHandler(async (req, res) => {
    await cache.delPrefix("db:");
    await cache.delPrefix("yt:");
    await channels.clear();
    await cache.del("football:today");
    events.broadcast("cache:cleared", { at: new Date().toISOString() }, { adminOnly: true });
    audit(req, "cache.cleared", { severity: "warn" });
    res.json({ ok: true, cache: cache.snapshot() });
  })
);

/* --------------------------- admin lists --------------------------- */

router.get(
  "/videos",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(async (req, res) => {
    const rows = db.prepareVideos(
      safeArray(await db.getAll("videos", { ttl: 30, staleTtl: 300 })),
      { stripSecrets: false }
    );
    const query = String(req.query.q || "").trim().toLowerCase();
    const filtered = query
      ? rows.filter((row) =>
          [row.title, row.ytid, row.channelTitle, row.description]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query))
        )
      : rows;
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 50));
    res.json({
      total: filtered.length,
      offset,
      limit,
      items: filtered.slice(offset, offset + limit),
    });
  })
);

router.get(
  "/accounts",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(async (req, res) => {
    const rows = safeArray(await db.getAll("account", { ttl: 60, staleTtl: 300 })).map(db.prepareAccount);
    res.json({ total: rows.length, items: rows });
  })
);

router.get(
  "/themes",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(async (req, res) => {
    const rows = safeArray(await db.getAll("themes", { ttl: 60, staleTtl: 300 }));
    res.json({ total: rows.length, items: rows });
  })
);

/* ---------------------------- channels ----------------------------- */

router.get(
  "/channels",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(async (req, res) => {
    const items = await channels.listAll();
    res.json({ total: items.length, items });
  })
);

router.post(
  "/channels",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(sessions.requireCsrf),
  channelWriteLimit,
  asyncHandler(async (req, res) => {
    const channel = await channels.create(req.body || {});
    audit(req, "channel.created", { meta: { id: channel.id, title: channel.title } });
    events.broadcast("channels:changed", { action: "created", id: channel.id }, { adminOnly: true });
    res.status(201).json({ ok: true, channel });
  })
);

router.put(
  "/channels/:id",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(sessions.requireCsrf),
  channelWriteLimit,
  asyncHandler(async (req, res) => {
    const channel = await channels.update(String(req.params.id || ""), req.body || {});
    audit(req, "channel.updated", { meta: { id: channel.id, title: channel.title } });
    events.broadcast("channels:changed", { action: "updated", id: channel.id }, { adminOnly: true });
    res.json({ ok: true, channel });
  })
);

router.delete(
  "/channels/:id",
  asyncHandler(sessions.requireAdmin),
  asyncHandler(sessions.requireCsrf),
  channelWriteLimit,
  asyncHandler(async (req, res) => {
    const removed = await channels.remove(String(req.params.id || ""));
    audit(req, "channel.deleted", {
      severity: "warn",
      meta: { id: removed.id, title: removed.title },
    });
    events.broadcast("channels:changed", { action: "deleted", id: removed.id }, { adminOnly: true });
    res.json({ ok: true, id: removed.id });
  })
);

module.exports = router;
