"use strict";

/* ------------------------------------------------------------------
   D74 Edits — analytics + audit
   Rolling in-memory buckets for charts, Redis counters for daily totals,
   hashed visitors for privacy, and a bounded audit trail.
------------------------------------------------------------------ */

const crypto = require("crypto");
const { monitorEventLoopDelay } = require("perf_hooks");
const config = require("./config");
const logger = require("./logger");
const { cache } = require("./cache");
const { events } = require("./events");
const { maskIp } = require("./sessions");

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function ttlUntilTomorrow() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return Math.max(60, Math.ceil((next.getTime() - now.getTime()) / 1000) + 3600);
}

function normalisePath(pathname) {
  let value = String(pathname || "/").split("?")[0];
  value = value.replace(/\/[0-9a-f]{16,}\b/gi, "/:id");
  value = value.replace(/\/[A-Za-z0-9_-]{20,}\b/g, "/:id");
  value = value.replace(/\/\d+\b/g, "/:n");
  if (value.length > 120) value = value.slice(0, 120);
  return value || "/";
}

class Analytics {
  constructor(cacheStore = cache, options = config) {
    this.cache = cacheStore;
    this.config = options;
    this.startedAt = Date.now();
    this.minutes = [];
    this.hours = [];
    this.days = [];
    this.recent = [];
    this.auditTrail = [];
    this.pathStats = new Map();
    this.visitors = new Map();
    this.timer = null;
    this.histogram = monitorEventLoopDelay({ resolution: 20 });
    try {
      this.histogram.enable();
    } catch (_) {}
    this.startTick();
  }

  startTick() {
    this.timer = setInterval(() => {
      const today = this.totalsFor("24h");
      events.broadcast("analytics:tick", {
        requests: today.requests,
        errors: today.errors,
        errorRate: today.errorRate,
        avgMs: today.avgMs,
        cacheHitRate: this.cache.snapshot().hitRate,
      });
    }, this.config.analytics.tickMs);
    this.timer.unref?.();
  }

  hashIp(ip) {
    return crypto
      .createHmac("sha256", this.config.analytics.salt)
      .update(String(ip || "unknown"))
      .digest("hex")
      .slice(0, 24);
  }

  bucket(list, size) {
    const now = Date.now();
    const key = Math.floor(now / size) * size;
    let bucket = list[list.length - 1];
    if (!bucket || bucket.key !== key) {
      bucket = {
        key,
        requests: 0,
        errors: 0,
        totalMs: 0,
        cacheHits: 0,
        cacheMisses: 0,
        statuses: {},
      };
      list.push(bucket);
      const max = size === 60000 ? this.config.analytics.minuteBuckets
        : size === 3600000 ? this.config.analytics.hourBuckets
          : this.config.analytics.dayBuckets;
      while (list.length > max) list.shift();
    }
    return bucket;
  }

  updateBucket(bucket, status, duration, cacheHit) {
    bucket.requests += 1;
    if (status >= 400) bucket.errors += 1;
    bucket.totalMs += duration;
    if (cacheHit) bucket.cacheHits += 1;
    else bucket.cacheMisses += 1;
    bucket.statuses[status] = (bucket.statuses[status] || 0) + 1;
  }

  recordRequest(req, res, durationMs) {
    const duration = Math.max(0, Math.round(durationMs || 0));
    const status = res.statusCode || 0;
    const path = normalisePath(req.path || req.originalUrl || "/");
    const method = req.method || "GET";
    const cacheHit = Boolean(res.locals && res.locals.cacheHit);
    const now = Date.now();

    this.updateBucket(this.bucket(this.minutes, 60 * 1000), status, duration, cacheHit);
    this.updateBucket(this.bucket(this.hours, 60 * 60 * 1000), status, duration, cacheHit);
    this.updateBucket(this.bucket(this.days, 24 * 60 * 60 * 1000), status, duration, cacheHit);

    const stats = this.pathStats.get(path) || { path, count: 0, errors: 0, totalMs: 0 };
    stats.count += 1;
    if (status >= 400) stats.errors += 1;
    stats.totalMs += duration;
    this.pathStats.set(path, stats);
    if (this.pathStats.size > 400) {
      const oldest = this.pathStats.keys().next().value;
      this.pathStats.delete(oldest);
    }

    this.recent.unshift({
      ts: new Date(now).toISOString(),
      method,
      path,
      status,
      ms: duration,
      cacheHit,
    });
    if (this.recent.length > this.config.analytics.recentLimit) this.recent.length = this.config.analytics.recentLimit;

    const day = dayKey(new Date(now));
    const ttl = ttlUntilTomorrow();
    this.cache.incr("analytics:req:" + day, 1, ttl).catch(() => {});
    this.cache.incr("analytics:path:" + day + ":" + path, 1, ttl).catch(() => {});
    this.cache.incr("analytics:status:" + day + ":" + status, 1, ttl).catch(() => {});
    if (status >= 400) this.cache.incr("analytics:err:" + day, 1, ttl).catch(() => {});
    const visitor = this.hashIp(req.ip || req.socket?.remoteAddress || "unknown");
    this.cache.pfadd("analytics:uv:" + day, visitor, ttl).catch(() => {});
    let set = this.visitors.get(day);
    if (!set) {
      set = new Set();
      this.visitors.set(day, set);
      if (this.visitors.size > 40) {
        const oldest = this.visitors.keys().next().value;
        this.visitors.delete(oldest);
      }
    }
    set.add(visitor);
  }

  seriesFor(range, buckets, stepMs) {
    const now = Date.now();
    const durations = { "1h": 60 * 60 * 1000, "24h": 24 * 60 * 60 * 1000, "7d": 7 * 24 * 60 * 60 * 1000, "30d": 30 * 24 * 60 * 60 * 1000 };
    const span = durations[range] || durations["24h"];
    const cutoff = now - span;
    return buckets
      .filter((bucket) => bucket.key >= cutoff)
      .map((bucket) => ({
        t: new Date(bucket.key).toISOString(),
        requests: bucket.requests,
        errors: bucket.errors,
        avgMs: bucket.requests ? Math.round(bucket.totalMs / bucket.requests) : 0,
        cacheHits: bucket.cacheHits,
        cacheMisses: bucket.cacheMisses,
        stepMs,
      }));
  }

  totalsFrom(buckets, range) {
    const durations = { "1h": 60 * 60 * 1000, "24h": 24 * 60 * 60 * 1000, "7d": 7 * 24 * 60 * 60 * 1000, "30d": 30 * 24 * 60 * 60 * 1000 };
    const cutoff = Date.now() - (durations[range] || durations["24h"]);
    const selected = buckets.filter((bucket) => bucket.key >= cutoff);
    let requests = 0;
    let errors = 0;
    let totalMs = 0;
    let cacheHits = 0;
    for (const bucket of selected) {
      requests += bucket.requests;
      errors += bucket.errors;
      totalMs += bucket.totalMs;
      cacheHits += bucket.cacheHits;
    }
    return {
      requests,
      errors,
      errorRate: requests ? Number(((errors / requests) * 100).toFixed(2)) : 0,
      avgMs: requests ? Math.round(totalMs / requests) : 0,
      cacheHits,
      cacheHitRate: requests ? Number(((cacheHits / requests) * 100).toFixed(1)) : 0,
    };
  }

  statusBreakdown(buckets, range) {
    const durations = { "1h": 60 * 60 * 1000, "24h": 24 * 60 * 60 * 1000, "7d": 7 * 24 * 60 * 60 * 1000, "30d": 30 * 24 * 60 * 60 * 1000 };
    const cutoff = Date.now() - (durations[range] || durations["24h"]);
    const statuses = {};
    for (const bucket of buckets) {
      if (bucket.key < cutoff) continue;
      for (const [status, count] of Object.entries(bucket.statuses)) {
        statuses[status] = (statuses[status] || 0) + count;
      }
    }
    return statuses;
  }

  uniqueVisitors(range) {
    const durations = { "1h": 1, "24h": 1, "7d": 7, "30d": 30 };
    const days = durations[range] || 1;
    const union = new Set();
    for (let index = 0; index < days; index += 1) {
      const date = new Date(Date.now() - index * 86400000);
      const set = this.visitors.get(dayKey(date));
      if (set) set.forEach((value) => union.add(value));
    }
    return union.size;
  }

  totalsFor(range) {
    if (range === "1h" || range === "24h") return this.totalsFrom(this.minutes, range);
    if (range === "7d") return this.totalsFrom(this.hours, range);
    return this.totalsFrom(this.days, range);
  }

  snapshot(range = "24h") {
    const safeRange = ["1h", "24h", "7d", "30d"].includes(range) ? range : "24h";
    const buckets = safeRange === "1h" || safeRange === "24h" ? this.minutes : safeRange === "7d" ? this.hours : this.days;
    const totals = this.totalsFrom(buckets, safeRange);
    const statuses = this.statusBreakdown(buckets, safeRange);
    const topPaths = Array.from(this.pathStats.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
      .map((row) => ({
        path: row.path,
        count: row.count,
        errors: row.errors,
        avgMs: row.count ? Math.round(row.totalMs / row.count) : 0,
      }));

    return {
      range: safeRange,
      generatedAt: new Date().toISOString(),
      totals: {
        ...totals,
        uniqueVisitors: this.uniqueVisitors(safeRange),
        requestsToday: this.totalsFrom(this.minutes, "24h").requests,
      },
      series: this.seriesFor(
        safeRange,
        buckets,
        safeRange === "1h" || safeRange === "24h" ? 60000 : safeRange === "7d" ? 3600000 : 86400000
      ),
      statuses,
      topPaths,
      recentRequests: this.recent.slice(0, 40),
      cache: this.cache.snapshot(),
    };
  }

  recentRequests(limit = 50) {
    return this.recent.slice(0, Math.max(1, Math.min(limit, this.config.analytics.recentLimit)));
  }

  system() {
    const memory = process.memoryUsage();
    return {
      node: process.version,
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      startedAt: new Date(this.startedAt).toISOString(),
      memory: {
        rssMb: Math.round(memory.rss / 1048576),
        heapUsedMb: Math.round(memory.heapUsed / 1048576),
        heapTotalMb: Math.round(memory.heapTotal / 1048576),
        externalMb: Math.round(memory.external / 1048576),
      },
      loadAverage: require("os").loadavg().map((value) => Number(value.toFixed(2))),
      eventLoop: {
        meanMs: Number((this.histogram.mean / 1e6).toFixed(2)),
        maxMs: Number((this.histogram.max / 1e6).toFixed(2)),
        p99Ms: Number((this.histogram.percentile(99) / 1e6).toFixed(2)),
      },
      eventsClients: events.count(),
    };
  }

  audit(action, meta = {}) {
    const entry = {
      id: crypto.randomBytes(6).toString("hex"),
      action: String(action),
      severity: meta.severity || "info",
      actor: meta.actor || "system",
      ip: meta.ip ? maskIp(meta.ip) : undefined,
      userAgent: meta.userAgent ? String(meta.userAgent).slice(0, 180) : undefined,
      meta: meta.meta && typeof meta.meta === "object" ? meta.meta : undefined,
      ts: new Date().toISOString(),
    };
    this.auditTrail.unshift(entry);
    if (this.auditTrail.length > this.config.analytics.auditLimit) this.auditTrail.length = this.config.analytics.auditLimit;
    this.cache.lpush("audit:recent", entry, this.config.analytics.auditLimit, 7 * 86400).catch(() => {});
    events.broadcast("audit", entry, { adminOnly: true });
    const level = entry.severity === "error" ? "error" : entry.severity === "warn" ? "warn" : "info";
    logger[level]("audit " + entry.action, { actor: entry.actor, ip: entry.ip });
    return entry;
  }

  async auditLog(limit = 60) {
    const safeLimit = Math.max(1, Math.min(limit, this.config.analytics.auditLimit));
    if (this.auditTrail.length) return this.auditTrail.slice(0, safeLimit);
    const stored = await this.cache.lrange("audit:recent", 0, safeLimit - 1);
    return Array.isArray(stored) ? stored : [];
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    try {
      this.histogram.disable();
    } catch (_) {}
  }
}

module.exports = { Analytics, analytics: new Analytics(cache, config) };
