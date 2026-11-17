"use strict";

/* ------------------------------------------------------------------
   D74 Edits — event hub
   One EventEmitter for the process, Server-Sent Events for browsers and
   Redis pub/sub so several Node instances stay in sync.
------------------------------------------------------------------ */

const { EventEmitter } = require("events");
const crypto = require("crypto");
const config = require("./config");
const logger = require("./logger");
const { cache } = require("./cache");

class EventHub {
  constructor() {
    this.instance = crypto.randomBytes(6).toString("hex");
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(50);
    this.clients = new Map();
    this.recent = [];
    this.recentLimit = config.analytics.recentLimit;
    this.sequence = 0;
    this.subscribed = false;
  }

  async init() {
    if (this.subscribed) return;
    this.subscribed = true;
    await cache.subscribe("events", (message) => {
      if (!message || message.origin === this.instance) return;
      this.deliver(message, { remote: true });
    });
  }

  broadcast(type, data = {}, options = {}) {
    const event = {
      id: ++this.sequence,
      type: String(type),
      data: data && typeof data === "object" ? data : { value: data },
      ts: new Date().toISOString(),
      adminOnly: Boolean(options.adminOnly),
      origin: this.instance,
    };
    this.deliver(event, { remote: false, publish: true });
    return event;
  }

  deliver(event, { remote = false, publish = false } = {}) {
    this.recent.unshift(event);
    if (this.recent.length > this.recentLimit) this.recent.length = this.recentLimit;

    for (const client of this.clients.values()) {
      if (event.adminOnly && !client.admin) continue;
      this.write(client, event);
    }

    if (publish) cache.publish("events", event).catch(() => {});
    if (!remote && process.env.NODE_ENV !== "production") {
      logger.debug("event", { type: event.type });
    }
  }

  addClient(req, res, { admin = false, validate = null } = {}) {
    const id = crypto.randomBytes(8).toString("hex");
    const client = { id, req, res, admin, startedAt: Date.now() };
    this.clients.set(id, client);

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write("retry: 5000\n\n");

    const hello = {
      id: 0,
      type: "hello",
      ts: new Date().toISOString(),
      data: { instance: this.instance, admin, heartbeat: 25000 },
    };
    this.write(client, hello);

    let heartbeat = null;
    let guard = null;
    const cleanup = () => {
      if (heartbeat) clearInterval(heartbeat);
      if (guard) clearInterval(guard);
      this.removeClient(id);
    };

    heartbeat = setInterval(() => {
      try {
        res.write(": ping " + Date.now() + "\n\n");
      } catch (_) {
        cleanup();
      }
    }, 25000);
    heartbeat.unref?.();

    // A long-lived admin stream must not outlive its session. Re-check
    // the session periodically and drop the client once it is revoked.
    if (admin && typeof validate === "function") {
      guard = setInterval(async () => {
        try {
          const ok = await validate();
          if (!ok) cleanup();
        } catch (_) {
          cleanup();
        }
      }, 60000);
      guard.unref?.();
    }

    req.on("close", cleanup);
    req.on("error", cleanup);

    return client;
  }

  write(client, event) {
    try {
      // Send every event as a default "message" event so a single
      // EventSource.onmessage handler can route on event.type.
      client.res.write("data: " + JSON.stringify(event) + "\n\n");
    } catch (_) {
      this.removeClient(client.id);
    }
  }

  removeClient(id) {
    const client = this.clients.get(id);
    if (!client) return;
    try {
      client.res.end();
    } catch (_) {}
    this.clients.delete(id);
  }

  recentEvents(limit = 20, { admin = false } = {}) {
    return this.recent
      .filter((event) => admin || !event.adminOnly)
      .slice(0, Math.max(1, Math.min(limit, this.recentLimit)))
      .map((event) => ({
        id: event.id,
        type: event.type,
        data: event.data,
        ts: event.ts,
      }));
  }

  count() {
    return this.clients.size;
  }

  close() {
    for (const id of Array.from(this.clients.keys())) this.removeClient(id);
  }
}

module.exports = { EventHub, events: new EventHub() };
