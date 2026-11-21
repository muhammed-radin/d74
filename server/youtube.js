"use strict";

/* ------------------------------------------------------------------
   D74 Edits — YouTube sync
   The site is backed by the database, not by live RapidAPI calls. A cron
   job pulls the uploads playlist of every configured channel into the
   videos collection. The default schedule and page limits keep usage far
   below the 500 requests/day RapidAPI allowance.
------------------------------------------------------------------ */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cron = require("node-cron");
const config = require("./config");
const logger = require("./logger");
const { cache } = require("./cache");
const { quota } = require("./quota");
const { events } = require("./events");
const db = require("./db");
const { analytics } = require("./analytics");

const STATE_FILE = path.join(config.root, "server", "data", "sync-state.json");

function hash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 16);
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function bestThumbnail(thumbnails) {
  const set = thumbnails || {};
  const candidate = set.maxres || set.high || set.medium || set.standard || set.default;
  return (candidate && candidate.url) || "";
}

class YouTubeSync {
  constructor() {
    this.running = false;
    this.externalLock = false;
    this.externalLockReason = "";
    this.trigger = null;
    this.task = null;
    this.lastResult = null;
    this.state = this.loadState();
    this.startedAt = Date.now();
  }

  loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
        return {
          channels: parsed.channels && typeof parsed.channels === "object" ? parsed.channels : {},
          lastRunAt: parsed.lastRunAt || null,
          lastResult: parsed.lastResult || null,
        };
      }
    } catch (error) {
      logger.warn("Could not read YouTube sync state", { error: error.message });
    }
    return { channels: {}, lastRunAt: null, lastResult: null };
  }

  persistState() {
    try {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      const tmp = STATE_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
      fs.renameSync(tmp, STATE_FILE);
    } catch (error) {
      logger.warn("Could not persist YouTube sync state", { error: error.message });
    }
  }

  async init() {
    await events.init().catch(() => {});
    if (!config.youtube.syncEnabled) {
      logger.info("YouTube cron sync disabled");
      return;
    }
    if (!cron.validate(config.youtube.syncCron)) {
      logger.warn("Invalid YT_SYNC_CRON; sync disabled", { cron: config.youtube.syncCron });
      return;
    }
    this.task = cron.schedule(
      config.youtube.syncCron,
      () => {
        this.syncAll("cron").catch((error) => {
          logger.error("Scheduled YouTube sync failed", { error: error.message });
        });
      },
      { timezone: config.youtube.syncTimezone, scheduled: true }
    );
    logger.info("YouTube sync scheduled", {
      cron: config.youtube.syncCron,
      timezone: config.youtube.syncTimezone,
      channels: config.youtube.channels.map((channel) => channel.name),
    });

    if (config.youtube.syncOnStart) {
      const timer = setTimeout(() => {
        this.syncAll("startup").catch((error) => {
          logger.error("Startup YouTube sync failed", { error: error.message });
        });
      }, 12000);
      timer.unref?.();
    }
  }

  stop() {
    if (this.task) this.task.stop();
  }

  async rapid(apiPath, params = {}, options = {}) {
    const ttl = options.ttl != null ? options.ttl : config.cache.youtubeTtl;
    const key = options.cacheKey || "yt:api:" + hash(apiPath + "?" + new URLSearchParams(params).toString());
    if (!options.force) {
      const cached = await cache.get(key);
      if (cached !== undefined) return cached;
    }

    const check = await quota.check("youtube");
    if (!check.allowed) {
      throw Object.assign(new Error("Daily YouTube API quota reached. Try again after midnight UTC."), {
        status: 503,
        code: "yt_quota",
      });
    }

    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") search.set(name, String(value));
    }
    const url = "https://" + config.youtube.host + apiPath + "?" + search.toString();

    let response;
    try {
      response = await fetch(url, {
        headers: {
          "X-RapidAPI-Key": process.env.RAPIDAPI_KEY || "",
          "X-RapidAPI-Host": config.youtube.host,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(config.youtube.requestTimeoutMs),
      });
    } catch (error) {
      await quota.consume("youtube").catch(() => {});
      throw Object.assign(new Error("YouTube service unreachable."), { status: 502, code: "yt_unreachable" });
    }

    await quota.consume("youtube").catch(() => {});
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = null;
    }
    if (response.status >= 500) {
      throw Object.assign(new Error("YouTube service returned an error."), { status: 502, code: "yt_upstream" });
    }
    if (response.status >= 400) {
      throw Object.assign(new Error((data && data.message) || "YouTube request rejected."), {
        status: response.status,
        code: "yt_rejected",
      });
    }

    await cache.set(key, data, ttl);
    return data;
  }

  async resolveChannel(channel) {
    if (channel.uploadsPlaylistId) {
      return {
        id: channel.id,
        name: channel.name,
        title: channel.name,
        uploadsPlaylistId: channel.uploadsPlaylistId,
      };
    }
    const key = "yt:channel:" + channel.id;
    const cached = await cache.get(key);
    if (cached) return cached;

    const data = await this.rapid(
      "/channels",
      { part: "snippet,contentDetails", id: channel.id, maxResults: 1 },
      { ttl: 30 * 86400, cacheKey: key }
    );
    const item = data && Array.isArray(data.items) ? data.items[0] : null;
    const uploads = item && item.contentDetails && item.contentDetails.relatedPlaylists
      ? item.contentDetails.relatedPlaylists.uploads
      : "";
    if (!uploads) {
      throw Object.assign(new Error("Channel uploads playlist not found for " + channel.id), {
        status: 404,
        code: "yt_channel",
      });
    }
    const resolved = {
      id: channel.id,
      name: channel.name,
      title: (item.snippet && item.snippet.title) || channel.name,
      thumbnail: bestThumbnail(item.snippet && item.snippet.thumbnails),
      uploadsPlaylistId: uploads,
    };
    await cache.set(key, resolved, 30 * 86400);
    return resolved;
  }

  async fetchPlaylist(playlistId, pageToken, options = {}) {
    const params = {
      part: "snippet,contentDetails",
      playlistId,
      maxResults: options.maxResults || 25,
    };
    if (pageToken) params.pageToken = pageToken;
    return this.rapid("/playlistItems", params, {
      ttl: options.ttl != null ? options.ttl : 300,
      force: options.force,
      cacheKey: "yt:playlist:" + playlistId + ":" + (pageToken || "first") + ":" + params.maxResults,
    });
  }

  mapItem(item, channel) {
    const snippet = (item && item.snippet) || {};
    const content = (item && item.contentDetails) || {};
    const resource = snippet.resourceId || {};
    const ytid = resource.videoId || content.videoId || "";
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(ytid)) return null;
    const record = {
      ytid,
      title: decodeHtml(snippet.title || "Untitled clip"),
      description: String(snippet.description || "").slice(0, 800),
      date: snippet.publishedAt || content.videoPublishedAt || new Date().toISOString(),
      thumb: bestThumbnail(snippet.thumbnails),
      channelId: channel.id,
      channelTitle: channel.title || channel.name,
      source: "youtube-sync",
    };
    return record;
  }

  async syncAll(trigger = "manual", options = {}) {
    if (this.running || this.externalLock) {
      return {
        started: false,
        running: true,
        locked: Boolean(this.externalLock),
        message: this.externalLock
          ? "A bulk sync job is active. Pause or stop it first."
          : "A sync is already running.",
      };
    }
    this.running = true;
    this.trigger = trigger;
    const startedAt = Date.now();
    const dryRun = Boolean(options.dryRun);
    const pages = Math.max(1, Math.min(10, Number(options.pages) || config.youtube.syncPages));
    const maxNew = Math.max(1, Math.min(100, Number(options.maxNew) || config.youtube.syncMaxNew));

    events.broadcast("sync:started", { trigger, dryRun, pages, startedAt: new Date(startedAt).toISOString() });
    analytics.audit("youtube.sync.started", { actor: "system", meta: { trigger, dryRun, pages } });

    const summary = {
      trigger,
      dryRun,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: null,
      durationMs: 0,
      channels: [],
      created: 0,
      scanned: 0,
      skipped: 0,
      errors: [],
    };

    try {
      const existing = await db.getAll("videos", { ttl: 60 });
      const known = new Set((Array.isArray(existing) ? existing : []).map((row) => row.ytid).filter(Boolean));

      for (const channel of config.youtube.channels) {
        const channelResult = {
          id: channel.id,
          name: channel.name,
          title: channel.name,
          status: "pending",
          scanned: 0,
          created: 0,
          skipped: 0,
          error: null,
        };
        try {
          const resolved = await this.resolveChannel(channel);
          channelResult.title = resolved.title || channel.name;
          channelResult.uploadsPlaylistId = resolved.uploadsPlaylistId;
          let pageToken = null;

          for (let page = 0; page < pages; page += 1) {
            const data = await this.fetchPlaylist(resolved.uploadsPlaylistId, pageToken, {
              maxResults: 25,
              force: options.force,
            });
            const items = data && Array.isArray(data.items) ? data.items : [];
            for (const item of items) {
              if (channelResult.created >= maxNew) break;
              const record = this.mapItem(item, resolved);
              if (!record) continue;
              channelResult.scanned += 1;
              summary.scanned += 1;
              const dedupe = record.ytid;
              if (known.has(dedupe)) {
                channelResult.skipped += 1;
                summary.skipped += 1;
                continue;
              }
              known.add(dedupe);
              if (dryRun) {
                channelResult.created += 1;
                summary.created += 1;
                continue;
              }
              const result = await db.write("POST", "videos", record);
              if (result.status === 201 || result.status === 200) {
                channelResult.created += 1;
                summary.created += 1;
              } else if (result.status === 409) {
                channelResult.skipped += 1;
                summary.skipped += 1;
              } else {
                summary.errors.push({ channel: channel.id, status: result.status, ytid: record.ytid });
              }
              events.broadcast("sync:progress", {
                channel: channel.id,
                created: channelResult.created,
                scanned: channelResult.scanned,
                ytid: record.ytid,
              });
            }
            pageToken = data && data.nextPageToken;
            if (!pageToken || channelResult.created >= maxNew) break;
          }
          channelResult.status = "ok";
        } catch (error) {
          channelResult.status = "error";
          channelResult.error = error.message;
          summary.errors.push({ channel: channel.id, error: error.message, code: error.code });
          logger.warn("YouTube channel sync failed", { channel: channel.id, error: error.message });
        }

        summary.channels.push(channelResult);
        this.state.channels[channel.id] = {
          id: channel.id,
          name: channel.name,
          title: channelResult.title,
          lastSyncAt: new Date().toISOString(),
          status: channelResult.status,
          error: channelResult.error,
          scanned: channelResult.scanned,
          created: channelResult.created,
        };
        this.persistState();
      }
    } finally {
      summary.finishedAt = new Date().toISOString();
      summary.durationMs = Date.now() - startedAt;
      this.running = false;
      this.trigger = null;
      this.lastResult = summary;
      this.state.lastRunAt = summary.finishedAt;
      this.state.lastResult = {
        trigger,
        dryRun,
        created: summary.created,
        scanned: summary.scanned,
        errors: summary.errors.length,
        durationMs: summary.durationMs,
        finishedAt: summary.finishedAt,
      };
      this.persistState();

      events.broadcast("sync:completed", {
        trigger,
        dryRun,
        created: summary.created,
        scanned: summary.scanned,
        skipped: summary.skipped,
        errors: summary.errors.length,
        durationMs: summary.durationMs,
      });
      analytics.audit("youtube.sync.completed", {
        actor: "system",
        severity: summary.errors.length ? "warn" : "info",
        meta: {
          trigger,
          dryRun,
          created: summary.created,
          scanned: summary.scanned,
          skipped: summary.skipped,
          errors: summary.errors.length,
        },
      });
    }

    return summary;
  }

  async startSync(trigger = "manual", options = {}) {
    if (this.running || this.externalLock) {
      return { started: false, running: true, locked: Boolean(this.externalLock) };
    }
    // syncAll claims the lock synchronously before its first await, so it is
    // safe to start it without awaiting and return immediately.
    const promise = this.syncAll(trigger, options);
    promise.catch((error) => logger.error("YouTube sync failed", { error: error.message }));
    return { started: true, running: true };
  }

  setExternalLock(locked, reason = "") {
    this.externalLock = Boolean(locked);
    this.externalLockReason = locked ? String(reason || "bulk-sync") : "";
  }

  isBusy() {
    return this.running || this.externalLock;
  }

  mapApiVideo(item) {
    const snippet = (item && item.snippet) || {};
    const content = (item && item.contentDetails) || {};
    const ytid = String((item && item.id) || "").trim();
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(ytid)) return null;
    const record = {
      ytid,
      title: decodeHtml(snippet.title || "Untitled clip"),
      description: String(snippet.description || "").slice(0, 800),
      date: snippet.publishedAt || content.publishedAt || new Date().toISOString(),
      thumb: bestThumbnail(snippet.thumbnails),
      channelId: String(snippet.channelId || "").slice(0, 80),
      channelTitle: String(snippet.channelTitle || "").slice(0, 120),
      source: "bulk-add",
    };
    return record;
  }

  async addByIds(ids) {
    const unique = [];
    const seen = new Set();
    for (const value of Array.isArray(ids) ? ids : []) {
      const id = String(value || "").trim();
      if (!/^[A-Za-z0-9_-]{6,20}$/.test(id) || seen.has(id)) continue;
      seen.add(id);
      unique.push(id);
    }
    if (!unique.length) {
      return { requested: 0, created: 0, skipped: 0, errors: [], items: [] };
    }

    const summary = { requested: unique.length, created: 0, skipped: 0, errors: [], items: [] };
    for (let index = 0; index < unique.length; index += 50) {
      const chunk = unique.slice(index, index + 50);
      try {
        const data = await this.rapid(
          "/videos",
          { part: "snippet,contentDetails", id: chunk.join(",") },
          { force: true, cacheKey: "yt:bulk-videos:" + hash(chunk.join(",")) }
        );
        const items = (data && Array.isArray(data.items) ? data.items : []).slice();
        for (const item of items) {
          const record = this.mapApiVideo(item);
          if (!record) {
            summary.errors.push({ ytid: item && item.id, error: "invalid_video" });
            continue;
          }
          try {
            const result = await db.write("POST", "videos", record);
            if (result.status === 201 || result.status === 200) {
              summary.created += 1;
              summary.items.push({ ytid: record.ytid, status: "created" });
            } else if (result.status === 409) {
              summary.skipped += 1;
              summary.items.push({ ytid: record.ytid, status: "exists" });
            } else {
              summary.errors.push({ ytid: record.ytid, error: "write_" + result.status });
            }
          } catch (error) {
            if (error.status === 409 || error.code === "already_exists") {
              summary.skipped += 1;
              summary.items.push({ ytid: record.ytid, status: "exists" });
            } else {
              summary.errors.push({ ytid: record.ytid, error: error.message });
            }
          }
        }
        const returned = new Set(items.map((item) => String(item && item.id)));
        chunk.forEach((id) => {
          if (!returned.has(id)) summary.errors.push({ ytid: id, error: "not_found" });
        });
      } catch (error) {
        summary.errors.push({ chunk: chunk.slice(0, 3).join(","), error: error.message, code: error.code });
      }
    }
    events.broadcast("videos:bulk-added", {
      requested: summary.requested,
      created: summary.created,
      skipped: summary.skipped,
      errors: summary.errors.length,
    }, { adminOnly: true });
    analytics.audit("youtube.bulk-add.completed", {
      actor: "system",
      severity: summary.errors.length ? "warn" : "info",
      meta: {
        requested: summary.requested,
        created: summary.created,
        skipped: summary.skipped,
        errors: summary.errors.length,
      },
    });
    return summary;
  }

  async getFeed({ max = 20, offset = 0 } = {}) {
    const rows = await db.getAll("videos", { ttl: 60 });
    const items = (Array.isArray(rows) ? rows : [])
      .filter((row) => /^[A-Za-z0-9_-]{6,20}$/.test(row.ytid || ""))
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    if (items.length) {
      const slice = items.slice(offset, offset + max).map((row) => ({
        id: { kind: "youtube#video", videoId: row.ytid },
        snippet: {
          title: row.title || "Untitled clip",
          description: row.description || "",
          publishedAt: row.date || new Date().toISOString(),
          channelTitle: row.channelTitle || "",
          thumbnails: {
            medium: { url: row.thumb || "" },
            high: { url: row.thumb || "" },
          },
        },
      }));
      return {
        source: "database",
        items: slice,
        nextPageToken: offset + max < items.length ? "db:" + (offset + max) : undefined,
        total: items.length,
      };
    }

    // Empty database: fall back to a small live request per channel.
    const live = [];
    let pageToken = null;
    for (const channel of config.youtube.channels) {
      try {
        const data = await this.rapid(
          "/search",
          {
            channelId: channel.id,
            part: "snippet,id",
            order: "date",
            maxResults: Math.min(25, max),
          },
          { ttl: 900, cacheKey: "yt:livefeed:" + channel.id }
        );
        const items = data && Array.isArray(data.items) ? data.items : [];
        live.push(...items.filter((item) => item.id && item.id.videoId));
        pageToken = data && data.nextPageToken ? data.nextPageToken : pageToken;
      } catch (error) {
        logger.warn("Live YouTube feed failed", { channel: channel.id, error: error.message });
      }
    }
    live.sort((a, b) => new Date((b.snippet && b.snippet.publishedAt) || 0) - new Date((a.snippet && a.snippet.publishedAt) || 0));
    return {
      source: "rapidapi",
      items: live.slice(0, max),
      nextPageToken: pageToken || undefined,
      total: live.length,
    };
  }

  async getVideoDetails(id) {
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
      throw Object.assign(new Error("Invalid video id."), { status: 400, code: "invalid_id" });
    }
    const rows = await db.getAll("videos", { ttl: 60 });
    const record = (Array.isArray(rows) ? rows : []).find((row) => row.ytid === id);
    if (record) {
      return {
        source: "database",
        items: [
          {
            id,
            snippet: {
              title: record.title || "Untitled clip",
              description: record.description || "",
              publishedAt: record.date || new Date().toISOString(),
              channelTitle: record.channelTitle || "",
              thumbnails: {
                medium: { url: record.thumb || "" },
                high: { url: record.thumb || "" },
              },
            },
          },
        ],
      };
    }
    const data = await this.rapid(
      "/videos",
      { part: "contentDetails,snippet,statistics", id },
      { ttl: config.cache.youtubeVideoTtl, cacheKey: "yt:video:" + id }
    );
    return { source: "rapidapi", ...data };
  }

  async status() {
    const quotaStatus = await quota.status("youtube");
    return {
      enabled: config.youtube.syncEnabled,
      running: this.running,
      externalLock: this.externalLock,
      externalLockReason: this.externalLockReason || null,
      busy: this.isBusy(),
      trigger: this.trigger,
      cron: config.youtube.syncCron,
      timezone: config.youtube.syncTimezone,
      pages: config.youtube.syncPages,
      maxNew: config.youtube.syncMaxNew,
      quota: quotaStatus,
      lastRunAt: this.state.lastRunAt,
      lastResult: this.state.lastResult,
      lastRun: this.lastResult,
      channels: config.youtube.channels.map((channel) => {
        const state = this.state.channels[channel.id] || {};
        return {
          id: channel.id,
          name: channel.name,
          title: state.title || channel.name,
          lastSyncAt: state.lastSyncAt || null,
          status: state.status || "idle",
          error: state.error || null,
          scanned: state.scanned || 0,
          created: state.created || 0,
        };
      }),
    };
  }
}

module.exports = { YouTubeSync, youtube: new YouTubeSync() };
