"use strict";

/* ------------------------------------------------------------------
   D74 Edits — public API
   Config, channels, member auth, clip unlocking, football, YouTube feed
   and the public event stream.
------------------------------------------------------------------ */

const express = require("express");
const crypto = require("crypto");
const config = require("../config");
const logger = require("../logger");
const { cache } = require("../cache");
const db = require("../db");
const { events } = require("../events");
const { analytics } = require("../analytics");
const { youtube } = require("../youtube");
const channels = require("../channels");
const { hashPassword, verifyPassword, safeEqualStrings } = require("../auth");
const { asyncHandler, clientIp, hash } = require("../http");
const { rateLimit } = require("../rate-limit");
const { sessionInfo, stillActive } = require("../sessions");

const router = express.Router();

const signupLimit = rateLimit({ name: "signup", windowMs: 10 * 60 * 1000, max: 10 });
const loginLimit = rateLimit({
  name: "login",
  windowMs: 10 * 60 * 1000,
  max: config.rateLimits.loginMax,
  skipSuccessful: true,
  key: (req) => String((req.body && req.body.email) || "").toLowerCase(),
});
const unlockLimit = rateLimit({ name: "unlock", windowMs: 10 * 60 * 1000, max: config.rateLimits.unlockMax });
const youtubeLimit = rateLimit({ name: "youtube", windowMs: 60 * 1000, max: config.rateLimits.youtubeMax });
const footballLimit = rateLimit({ name: "football", windowMs: 60 * 1000, max: 30 });

function publicCache(res, seconds = 30) {
  res.setHeader("Cache-Control", "public, max-age=" + seconds + ", stale-while-revalidate=" + seconds * 2);
}

function publicAccount(record) {
  return {
    id: record._id || record.id,
    name: record.name || "Guest",
    email: record.email || "",
    date: record.date || "",
  };
}

function audit(req, action, meta = {}) {
  analytics.audit(action, {
    actor: meta.actor || "anonymous",
    ip: clientIp(req),
    userAgent: req.get("user-agent"),
    severity: meta.severity,
    meta: meta.meta,
  });
}

router.get("/health", (req, res) => {
  const snapshot = cache.snapshot();
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    version: require("../../package.json").version,
    cache: { driver: snapshot.driver, redis: snapshot.redis, hitRate: snapshot.hitRate },
    events: events.count(),
    timestamp: new Date().toISOString(),
  });
});

router.get("/config", (req, res) => {
  publicCache(res, 300);
  res.json({
    siteName: "D74 Edits",
    jwplayerKey: process.env.JWPLAYER_KEY || "",
    youtubeChannel: "https://youtube.com/@d74edits67",
    theme: "dark",
    adsense: {
      enabled: config.adsense.enabled && Boolean(config.adsense.client),
      client: config.adsense.client,
      slots: config.adsense.slots,
    },
    features: {
      redis: cache.connected,
      youtubeSync: config.youtube.syncEnabled,
      youtubeChannels: config.youtube.channels.length,
      analytics: true,
      ads: config.adsense.enabled && Boolean(config.adsense.client),
    },
  });
});

router.get(
  "/channels",
  asyncHandler(async (req, res) => {
    const list = await channels.list();
    publicCache(res, 60);
    res.json(list);
  })
);

router.get(
  "/channels/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      return res.status(400).json({ error: "Invalid channel id." });
    }
    const channel = await channels.get(id);
    if (!channel) return res.status(404).json({ error: "Channel not found." });
    publicCache(res, 120);
    return res.json(channel);
  })
);

router.post(
  "/auth/signup",
  signupLimit,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (name.length < 2 || name.length > 48) {
      return res.status(400).json({ error: "Name must be 2–48 characters." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const existing = await db.getCollection("account", {
      query: { email },
      ttl: 5,
      staleTtl: 0,
      force: true,
    });
    if (Array.isArray(existing) && existing.length) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    const { salt, hash: passwordHash } = hashPassword(password);
    const record = {
      name,
      email,
      passwordHash,
      salt,
      date: new Date().toISOString(),
      location: "server",
    };
    const created = await db.write("POST", "account", record);
    if (created.status >= 300) {
      return res.status(502).json({ error: "Could not create the account." });
    }

    audit(req, "member.signup", {
      actor: "member",
      meta: { accountId: created.data && created.data._id },
    });
    return res.status(201).json({
      user: publicAccount({ ...record, _id: created.data && created.data._id }),
    });
  })
);

router.post(
  "/auth/login",
  loginLimit,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const found = await db.getCollection("account", { query: { email }, ttl: 30, staleTtl: 120 });
    const record = Array.isArray(found) ? found[0] : null;
    if (!record) {
      audit(req, "member.login.failed", { severity: "warn", meta: { reason: "unknown-email" } });
      return res.status(401).json({ error: "Invalid email or password." });
    }

    let valid = verifyPassword(password, record);
    let upgraded = false;

    if (
      !valid &&
      typeof record.password === "string" &&
      record.password &&
      safeEqualStrings(record.password, password)
    ) {
      valid = true;
      const { salt, hash: passwordHash } = hashPassword(password);
      db.write("PUT", "account/" + encodeURIComponent(record._id), {
        passwordHash,
        salt,
        password: "",
      }).catch(() => {});
      upgraded = true;
    }

    if (!valid) {
      audit(req, "member.login.failed", { severity: "warn", meta: { reason: "bad-password" } });
      return res.status(401).json({ error: "Invalid email or password." });
    }

    return res.json({ user: publicAccount(record), upgraded });
  })
);

router.post(
  "/videos/unlock",
  unlockLimit,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const id = String(body.id || body.ytid || "").trim();
    const password = String(body.password || "");
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
      return res.status(400).json({ error: "Invalid clip id." });
    }
    if (!password) return res.status(400).json({ error: "Password is required." });

    const found = await db.getCollection("videos", { query: { ytid: id }, ttl: 15, staleTtl: 60 });
    const record = Array.isArray(found) ? found[0] : null;
    if (!record) {
      return res.status(404).json({ error: "This clip is not available for download." });
    }

    const expected = String(record.pw || "");
    if (!expected || !safeEqualStrings(expected, password)) {
      audit(req, "clip.unlock.failed", { severity: "warn", meta: { ytid: id } });
      return res.status(401).json({ error: "Incorrect download password." });
    }

    if (!record.url || record.url === "https://youtube.com/watch?v=" + record.ytid) {
      return res.status(404).json({ error: "No download link was provided for this clip." });
    }
    return res.json({ url: record.url });
  })
);

router.get(
  "/youtube/search",
  youtubeLimit,
  asyncHandler(async (req, res) => {
    const token = String(req.query.pageToken || "");
    let offset = 0;
    if (token.startsWith("db:")) {
      offset = Math.max(0, Number(token.slice(3)) || 0);
    }
    const feed = await youtube.getFeed({ max: 15, offset });
    publicCache(res, 30);
    res.json(feed);
  })
);

router.get(
  "/youtube/videos",
  youtubeLimit,
  asyncHandler(async (req, res) => {
    const id = String(req.query.id || "");
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
      return res.status(400).json({ error: "Invalid video id." });
    }
    const details = await youtube.getVideoDetails(id);
    publicCache(res, 300);
    return res.json(details);
  })
);

router.get(
  "/football",
  footballLimit,
  asyncHandler(async (req, res) => {
    const data = await cache.getOrSet(
      "football:today",
      config.football.ttl,
      async () => {
        const response = await fetch("https://" + config.football.host, {
          headers: {
            "x-rapidapi-key": process.env.RAPIDAPI_KEY || "",
            "x-rapidapi-host": config.football.host,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(12000),
        });
        const text = await response.text();
        try {
          return JSON.parse(text);
        } catch (_) {
          return [];
        }
      },
      { staleTtl: 600 }
    );
    publicCache(res, 60);
    res.json(data);
  })
);

router.get(
  "/events",
  asyncHandler(async (req, res) => {
    const info = await sessionInfo(req).catch(() => null);
    events.addClient(req, res, {
      admin: Boolean(info),
      // Long-lived admin streams re-check the session so revocation
      // (or logout) ends them instead of leaving a privileged feed open.
      validate: info ? () => stillActive(req) : null,
    });
  })
);

module.exports = router;
