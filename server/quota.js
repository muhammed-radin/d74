"use strict";

/* ------------------------------------------------------------------
   D74 Edits — daily quota tracker
   Used for the metered restdb plan and the RapidAPI YouTube plan.
   Counters live in Redis when available and reset at UTC midnight.
------------------------------------------------------------------ */

const config = require("./config");
const { cache } = require("./cache");

class Quota {
  constructor(cacheStore, options = config) {
    this.cache = cacheStore;
    this.config = options;
  }

  dayKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
  }

  secondsUntilReset() {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
    return Math.max(60, Math.ceil((next.getTime() - now.getTime()) / 1000) + 3600);
  }

  key(name) {
    return "quota:" + name + ":" + this.dayKey();
  }

  limits(name) {
    if (name === "db") {
      return { limit: this.config.db.dailyLimit, hardStop: this.config.db.hardStop };
    }
    if (name === "youtube") {
      const limit = this.config.youtube.dailyLimit;
      return {
        limit,
        hardStop: true,
        reserve: this.config.youtube.reserve,
        effective: limit > 0 ? Math.max(0, limit - this.config.youtube.reserve) : 0,
      };
    }
    return { limit: 0, hardStop: false };
  }

  async used(name) {
    const value = await this.cache.get(this.key(name));
    return Number(value) || 0;
  }

  async check(name) {
    const limits = this.limits(name);
    const used = await this.used(name);
    const effective = limits.effective != null ? limits.effective : limits.limit;
    const unlimited = !limits.limit || limits.limit <= 0;
    const allowed = unlimited || used < effective;
    return {
      allowed: limits.hardStop ? allowed : true,
      overLimit: !unlimited && used >= effective,
      used,
      limit: limits.limit,
      effective: unlimited ? 0 : effective,
      remaining: unlimited ? null : Math.max(0, effective - used),
      hardStop: Boolean(limits.hardStop),
      resetsAt: new Date(Date.now() + this.secondsUntilReset() * 1000).toISOString(),
    };
  }

  async consume(name, count = 1) {
    return this.cache.incr(this.key(name), count, this.secondsUntilReset());
  }

  async status(name) {
    const info = await this.check(name);
    return {
      name,
      used: info.used,
      limit: info.limit,
      effective: info.effective,
      remaining: info.remaining,
      percent: info.limit > 0 ? Math.min(100, Math.round((info.used / info.limit) * 100)) : 0,
      hardStop: info.hardStop,
      resetsAt: info.resetsAt,
    };
  }

  async snapshot() {
    const [db, youtube] = await Promise.all([this.status("db"), this.status("youtube")]);
    return { db, youtube };
  }
}

module.exports = { Quota, quota: new Quota(cache, config) };
