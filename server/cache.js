"use strict";

/* ------------------------------------------------------------------
   D74 Edits — cache layer
   Redis when available, a bounded in-memory LRU-ish store otherwise.
   Also provides the primitives the rest of the server needs: counters,
   sets, lists, HyperLogLog and pub/sub.
------------------------------------------------------------------ */

const { createClient } = require("redis");
const config = require("./config");
const logger = require("./logger");

const INCR_WITH_TTL = `
local value = redis.call('INCRBY', KEYS[1], ARGV[1])
if redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return value
`;

const PFADD_WITH_TTL = `
local added = redis.call('PFADD', KEYS[1], ARGV[1])
if redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return added
`;

class Cache {
  constructor(options = config) {
    this.config = options;
    this.prefix = options.cache.prefix;
    this.maxEntries = options.cache.maxEntries;
    this.memory = new Map();
    this.inflight = new Map();
    this.client = null;
    this.subscriber = null;
    this.connected = false;
    this.connecting = false;
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      errors: 0,
    };
    this.startedAt = Date.now();
  }

  key(name) {
    return this.prefix + String(name);
  }

  async init() {
    if (!this.config.redis.enabled || !this.config.redis.url) {
      logger.info("Cache driver: memory (set REDIS_URL to enable Redis)");
      return this;
    }

    this.connecting = true;
    const client = createClient({
      url: this.config.redis.url,
      socket: {
        connectTimeout: this.config.redis.connectTimeoutMs,
        tls: this.config.redis.tls || undefined,
        reconnectStrategy: (retries) => {
          if (retries > 8) return false;
          return Math.min(250 * retries, 3000);
        },
      },
    });

    client.on("error", (error) => {
      this.stats.errors += 1;
      if (this.connected) {
        this.connected = false;
        logger.warn("Redis error; continuing on memory cache", { error: error.message });
      }
    });
    client.on("ready", () => {
      this.connected = true;
      this.connecting = false;
      logger.info("Cache driver: Redis", { url: safeRedisUrl(this.config.redis.url) });
    });
    client.on("end", () => {
      this.connected = false;
    });

    try {
      const connect = client.connect();
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Redis connection timed out")), this.config.redis.connectTimeoutMs + 500)
      );
      await Promise.race([connect, timeout]);
      this.client = client;
      this.connected = true;
    } catch (error) {
      this.stats.errors += 1;
      this.connected = false;
      this.connecting = false;
      logger.warn("Redis unavailable; using memory cache", { error: error.message });
      try {
        client.disconnect();
      } catch (_) {}
    }
    return this;
  }

  async close() {
    try {
      if (this.subscriber) await this.subscriber.quit();
    } catch (_) {}
    try {
      if (this.client && this.client.isOpen) await this.client.quit();
    } catch (_) {}
    this.client = null;
    this.subscriber = null;
    this.connected = false;
  }

  /* --------------------------- basics --------------------------- */

  async get(name) {
    const key = this.key(name);
    if (this.connected && this.client) {
      try {
        const raw = await this.client.get(key);
        if (raw == null) {
          this.stats.misses += 1;
          return undefined;
        }
        this.stats.hits += 1;
        return JSON.parse(raw);
      } catch (error) {
        this.stats.errors += 1;
        logger.debug("Cache get failed", { key, error: error.message });
      }
    }
    const entry = this.memoryGet(key);
    if (entry === undefined) this.stats.misses += 1;
    else this.stats.hits += 1;
    return entry;
  }

  async set(name, value, ttlSeconds = this.config.cache.defaultTtl) {
    if (value === undefined) return false;
    const key = this.key(name);
    const ttl = Math.max(1, Math.round(ttlSeconds));
    if (this.connected && this.client) {
      try {
        await this.client.set(key, JSON.stringify(value), { EX: ttl });
        this.stats.sets += 1;
        return true;
      } catch (error) {
        this.stats.errors += 1;
        logger.debug("Cache set failed", { key, error: error.message });
      }
    }
    this.memorySet(key, value, ttl);
    return true;
  }

  async del(name) {
    const key = this.key(name);
    this.memory.delete(key);
    this.stats.deletes += 1;
    if (this.connected && this.client) {
      try {
        await this.client.del(key);
      } catch (error) {
        this.stats.errors += 1;
      }
    }
  }

  async delPrefix(pattern) {
    const full = this.key(pattern);
    for (const key of Array.from(this.memory.keys())) {
      if (key.startsWith(full)) this.memory.delete(key);
    }
    if (this.connected && this.client) {
      try {
        for await (const key of this.client.scanIterator({ MATCH: full + "*", COUNT: 200 })) {
          await this.client.del(key);
        }
      } catch (error) {
        this.stats.errors += 1;
        logger.debug("Cache prefix delete failed", { pattern: full, error: error.message });
      }
    }
    this.stats.deletes += 1;
  }

  async keys(prefix) {
    const full = this.key(prefix);
    const found = new Set();
    for (const key of this.memory.keys()) {
      if (key.startsWith(full)) found.add(key.slice(this.prefix.length));
    }
    if (this.connected && this.client) {
      try {
        for await (const key of this.client.scanIterator({ MATCH: full + "*", COUNT: 200 })) {
          found.add(key.slice(this.prefix.length));
        }
      } catch (_) {}
    }
    return Array.from(found);
  }

  /* ----------------------- single flight ------------------------ */

  async getOrSet(name, ttlSeconds, producer, options = {}) {
    const { staleTtl = 0, force = false } = options;
    if (!force) {
      const hit = await this.get(name);
      if (hit !== undefined) return hit;
      if (staleTtl > 0) {
        const stale = await this.get(name + ":stale");
        if (stale !== undefined) {
          // Serve immediately, refresh in the background.
          this.refresh(name, ttlSeconds, producer, staleTtl).catch(() => {});
          return stale;
        }
      }
    }
    if (this.inflight.has(name)) return this.inflight.get(name);
    const promise = this.refresh(name, ttlSeconds, producer, staleTtl).finally(() => {
      this.inflight.delete(name);
    });
    this.inflight.set(name, promise);
    return promise;
  }

  async refresh(name, ttlSeconds, producer, staleTtl = 0) {
    const value = await producer();
    if (value === undefined || value === null) return value;
    await this.set(name, value, ttlSeconds);
    if (staleTtl > 0) await this.set(name + ":stale", value, ttlSeconds + staleTtl);
    return value;
  }

  /* -------------------------- counters -------------------------- */

  async incr(name, by = 1, ttlSeconds = 86400) {
    const key = this.key(name);
    if (this.connected && this.client) {
      try {
        const value = await this.client.eval(INCR_WITH_TTL, {
          keys: [key],
          arguments: [String(by), String(Math.max(1, Math.round(ttlSeconds)))],
        });
        return Number(value);
      } catch (error) {
        this.stats.errors += 1;
      }
    }
    const entry = this.memoryGet(key);
    const current = entry == null ? 0 : Number(entry) || 0;
    const next = current + by;
    this.memorySet(key, next, ttlSeconds);
    return next;
  }

  async pfadd(name, value, ttlSeconds = 86400) {
    const key = this.key(name);
    if (this.connected && this.client) {
      try {
        return Boolean(
          await this.client.eval(PFADD_WITH_TTL, {
            keys: [key],
            arguments: [String(value), String(Math.max(1, Math.round(ttlSeconds)))],
          })
        );
      } catch (error) {
        this.stats.errors += 1;
      }
    }
    const entry = this.memoryGet(key);
    const set = entry instanceof Set ? entry : new Set();
    const before = set.size;
    set.add(String(value));
    this.memorySet(key, set, ttlSeconds);
    return set.size !== before;
  }

  async pfcount(names) {
    const list = Array.isArray(names) ? names : [names];
    if (this.connected && this.client) {
      try {
        const keys = list.map((name) => this.key(name));
        return Number(await this.client.pfCount(keys));
      } catch (error) {
        this.stats.errors += 1;
      }
    }
    const union = new Set();
    for (const name of list) {
      const entry = this.memoryGet(this.key(name));
      if (entry instanceof Set) entry.forEach((item) => union.add(item));
    }
    return union.size;
  }

  /* ---------------------------- lists --------------------------- */

  async lpush(name, value, maxLength = 250, ttlSeconds = 604800) {
    const key = this.key(name);
    const payload = JSON.stringify(value);
    if (this.connected && this.client) {
      try {
        await this.client
          .multi()
          .lPush(key, payload)
          .lTrim(key, 0, Math.max(0, maxLength - 1))
          .expire(key, ttlSeconds)
          .exec();
        return;
      } catch (error) {
        this.stats.errors += 1;
      }
    }
    const entry = this.memoryGet(key);
    const list = Array.isArray(entry) ? entry : [];
    list.unshift(value);
    if (list.length > maxLength) list.length = maxLength;
    this.memorySet(key, list, ttlSeconds);
  }

  async lrange(name, start = 0, stop = 49) {
    const key = this.key(name);
    if (this.connected && this.client) {
      try {
        const rows = await this.client.lRange(key, start, stop);
        return rows.map((row) => {
          try {
            return JSON.parse(row);
          } catch (_) {
            return row;
          }
        });
      } catch (error) {
        this.stats.errors += 1;
      }
    }
    const entry = this.memoryGet(key);
    if (!Array.isArray(entry)) return [];
    return entry.slice(start, stop + 1);
  }

  /* ---------------------------- sets ---------------------------- */

  async sadd(name, member, ttlSeconds = 86400) {
    const key = this.key(name);
    if (this.connected && this.client) {
      try {
        await this.client.sAdd(key, String(member));
        await this.client.expire(key, ttlSeconds);
        return;
      } catch (error) {
        this.stats.errors += 1;
      }
    }
    const entry = this.memoryGet(key);
    const set = entry instanceof Set ? entry : new Set();
    set.add(String(member));
    this.memorySet(key, set, ttlSeconds);
  }

  async srem(name, member) {
    const key = this.key(name);
    if (this.connected && this.client) {
      try {
        await this.client.sRem(key, String(member));
      } catch (error) {
        this.stats.errors += 1;
      }
      return;
    }
    const entry = this.memoryGet(key);
    if (entry instanceof Set) entry.delete(String(member));
  }

  async smembers(name) {
    const key = this.key(name);
    if (this.connected && this.client) {
      try {
        return await this.client.sMembers(key);
      } catch (error) {
        this.stats.errors += 1;
      }
    }
    const entry = this.memoryGet(key);
    return entry instanceof Set ? Array.from(entry) : [];
  }

  async scard(name) {
    return (await this.smembers(name)).length;
  }

  /* --------------------------- pub/sub -------------------------- */

  async publish(channel, payload) {
    if (!this.connected || !this.client) return;
    try {
      await this.client.publish(this.key(channel), JSON.stringify(payload));
    } catch (error) {
      this.stats.errors += 1;
    }
  }

  async subscribe(channel, handler) {
    if (!this.connected || !this.client) return;
    try {
      if (!this.subscriber) {
        this.subscriber = this.client.duplicate();
        this.subscriber.on("error", (error) => {
          this.stats.errors += 1;
          logger.debug("Redis subscriber error", { error: error.message });
        });
        await this.subscriber.connect();
      }
      await this.subscriber.subscribe(this.key(channel), (message) => {
        try {
          handler(JSON.parse(message));
        } catch (_) {}
      });
    } catch (error) {
      logger.debug("Redis subscribe failed", { error: error.message });
    }
  }

  /* --------------------------- memory --------------------------- */

  memoryGet(key) {
    const entry = this.memory.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return undefined;
    }
    return entry.value;
  }

  memorySet(key, value, ttlSeconds) {
    if (this.memory.size >= this.maxEntries && !this.memory.has(key)) {
      let oldestKey = null;
      let oldestAt = Infinity;
      for (const [candidate, entry] of this.memory) {
        if (entry.createdAt < oldestAt) {
          oldestAt = entry.createdAt;
          oldestKey = candidate;
        }
      }
      if (oldestKey) {
        this.memory.delete(oldestKey);
        this.stats.evictions += 1;
      }
    }
    this.memory.set(key, {
      value,
      createdAt: Date.now(),
      expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0,
    });
    this.stats.sets += 1;
  }

  snapshot() {
    const total = this.stats.hits + this.stats.misses;
    return {
      driver: this.connected ? "redis" : "memory",
      redis: this.connected,
      prefix: this.prefix,
      entries: this.memory.size,
      maxEntries: this.maxEntries,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total ? Number(((this.stats.hits / total) * 100).toFixed(1)) : 0,
      sets: this.stats.sets,
      deletes: this.stats.deletes,
      evictions: this.stats.evictions,
      errors: this.stats.errors,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }
}

function safeRedisUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch (_) {
    return "redis";
  }
}

module.exports = { Cache, cache: new Cache(config) };
