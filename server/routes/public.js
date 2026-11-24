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
const ytdlp = require("../ytdlp");
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
const downloadLimit = rateLimit({ name: "download", windowMs: 10 * 60 * 1000, max: config.rateLimits.downloadMax });
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

/* A record can carry a direct file URL supplied by the administrator.
   The YouTube watch page that sync stores is not a download link, so it
   is treated as "no override" and yt-dlp is used instead. */
function directDownloadLink(value, ytid) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return "";
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return "";
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const id = String(ytid || "");
  if (host === "youtube.com" || host === "m.youtube.com") {
    if (parsed.pathname === "/watch" && parsed.searchParams.get("v") === id) return "";
    if (parsed.pathname === "/shorts/" + id) return "";
    if (parsed.pathname === "/embed/" + id) return "";
  }
  if (host === "youtu.be" && parsed.pathname.replace(/^\//, "") === id) return "";
  return parsed.toString();
}

function words(value) {
  return new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((word) => word.length > 3)
  );
}

function sharedWords(a, b) {
  const left = words(a);
  if (!left.size) return 0;
  let shared = 0;
  words(b).forEach((word) => {
    if (left.has(word)) shared += 1;
  });
  return shared;
}

router.get("/health", (req, res) => {
  const snapshot = cache.snapshot();
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Expires", "0");
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
      freeDownloads: config.youtubejs.enabled || config.ytdlp.enabled,
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

/* Free download. No password and no pre-published link is required:
   a direct link wins, otherwise the clip is fetched from YouTube with
   yt-dlp and streamed back as an attachment. */
router.get(
  "/videos/download",
  downloadLimit,
  asyncHandler(async (req, res) => {
    const id = ytdlp.safeId(req.query.id || req.query.ytid);
    if (!id) return res.status(400).json({ error: "Invalid clip id.", code: "invalid_id" });

    let record = null;
    try {
      const found = await db.getCollection("videos", { query: { ytid: id }, ttl: 15, staleTtl: 60 });
      record = Array.isArray(found) ? found[0] : null;
    } catch (_) {
      record = null;
    }

    const title = (record && record.title) || "D74 clip";
    const direct = directDownloadLink(record && record.url, id);
    const wantsJson = String(req.query.mode || "") === "url" || String(req.query.format || "") === "json";

    if (direct) {
      if (wantsJson) {
        return res.json({
          source: "link",
          title,
          url: direct,
          stream: "/api/videos/download?id=" + encodeURIComponent(id),
        });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.redirect(302, direct);
    }

    if (wantsJson) {
      const state = await ytdlp.probe(id);
      if (!state.ok) {
        const detail = ytdlp.describeFailure(state.message || "");
        return res.status(state.code === "ytdlp_unavailable" ? 503 : 502).json({
          error: state.message || detail.message,
          code: state.code || detail.code,
        });
      }
      // Resolve now so a bot check or missing format is reported as JSON
      // instead of being written into the browser's download bar.
      try {
        const resolved = await ytdlp.resolveUrl(id);
        return res.json({
          source: "youtube",
          title,
          url: resolved,
          stream: "/api/videos/download?id=" + encodeURIComponent(id),
        });
      } catch (error) {
        return res.status(Number(error.status) || 502).json({
          error: error.message || "The download service could not fetch this clip.",
          code: error.code || "ytdlp_failed",
        });
      }
    }

    if (req.method === "HEAD") {
      res.status(200).set(ytdlp.downloadHeaders(title)).end();
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    await ytdlp.stream(id, req, res, { title });
  })
);

/* Lightweight recommendations for the viewer. Prefers the same channel,
   then shared tags and title words, then the newest clips. */
router.get(
  "/videos/similar",
  asyncHandler(async (req, res) => {
    const id = ytdlp.safeId(req.query.id);
    if (!id) return res.status(400).json({ error: "Invalid clip id.", code: "invalid_id" });
    const limit = Math.max(1, Math.min(24, Number(req.query.limit) || 8));

    const payload = await cache.getOrSet(
      "videos:similar:" + id + ":" + limit,
      60,
      async () => {
        const rows = await db.getAll("videos", { ttl: 60 }).catch(() => []);
        const all = (Array.isArray(rows) ? rows : []).filter(
          (row) => row && /^[A-Za-z0-9_-]{6,20}$/.test(String(row.ytid || ""))
        );
        const current = all.find((row) => row.ytid === id) || null;
        const currentTags = new Set(
          (Array.isArray(current && current.tags) ? current.tags : []).map((tag) => String(tag).toLowerCase())
        );

        const scored = all
          .filter((row) => row.ytid !== id)
          .map((row) => {
            let score = 0;
            if (current) {
              if (current.channelId && row.channelId && row.channelId === current.channelId) score += 8;
              if (current.channelTitle && row.channelTitle && row.channelTitle === current.channelTitle) score += 5;
              if (currentTags.size) {
                const tags = Array.isArray(row.tags) ? row.tags : [];
                tags.forEach((tag) => {
                  if (currentTags.has(String(tag).toLowerCase())) score += 2;
                });
              }
              score += sharedWords(current.title, row.title) * 1.5;
              if (current.category && row.category && row.category === current.category) score += 2;
            }
            const when = new Date(row.date || 0).getTime();
            return { row, score, when: Number.isFinite(when) ? when : 0 };
          })
          .sort((a, b) => b.score - a.score || b.when - a.when)
          .slice(0, limit)
          .map((entry) => entry.row);

        return {
          source: "database",
          items: db.prepareVideos(scored, { stripSecrets: true }),
        };
      }
    );

    publicCache(res, 60);
    return res.json(payload);
  })
);

/* Legacy alias kept for older open tabs. Downloads are free now, so the
   password is ignored and the caller receives the free download URL. */
router.post(
  "/videos/unlock",
  unlockLimit,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const id = ytdlp.safeId(body.id || body.ytid);
    if (!id) return res.status(400).json({ error: "Invalid clip id.", code: "invalid_id" });

    let record = null;
    try {
      const found = await db.getCollection("videos", { query: { ytid: id }, ttl: 15, staleTtl: 60 });
      record = Array.isArray(found) ? found[0] : null;
    } catch (_) {
      record = null;
    }
    const direct = directDownloadLink(record && record.url, id);
    return res.json({
      url: direct || "/api/videos/download?id=" + encodeURIComponent(id),
      source: direct ? "link" : "youtube",
      deprecated: true,
      message: "Downloads are free. This endpoint no longer needs a password.",
    });
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
