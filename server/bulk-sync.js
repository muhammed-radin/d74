"use strict";

/* ------------------------------------------------------------------
   D74 Edits — long-running bulk YouTube sync
   Walks every configured YouTube channel one at a time, loading the
   uploads playlist into the database in batches of 30. After each batch
   the job waits 30 minutes, and it stops at 300 new videos per UTC day.
   State is persisted in the database so a restart resumes exactly where
   it left off. The regular cron sync is locked out while this job is
   active.
------------------------------------------------------------------ */

const config = require("./config");
const logger = require("./logger");
const db = require("./db");
const { youtube } = require("./youtube");
const { events } = require("./events");
const { analytics } = require("./analytics");

const JOB_ID = "bulk-sync";
const JOB_COLLECTION = "jobs";

function nowIso() {
  return new Date().toISOString();
}

function utcDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function nextUtcMidnight() {
  const date = new Date();
  date.setUTCHours(24, 0, 5, 0);
  return date.getTime();
}

function defaultChannel(channel) {
  return {
    id: channel.id,
    name: channel.name,
    title: channel.name,
    status: "pending",
    pageToken: null,
    pendingItems: [],
    scanned: 0,
    created: 0,
    skipped: 0,
    errors: 0,
    lastError: null,
    lastSyncAt: null,
  };
}

class BulkSync {
  constructor() {
    this.state = this.defaultState();
    this.timer = null;
    this.ticking = false;
    this.ready = false;
  }

  defaultState() {
    const channels = config.youtube.channels.map(defaultChannel);
    return {
      id: JOB_ID,
      status: "idle",
      phase: "idle",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      startedAt: null,
      completedAt: null,
      currentChannelIndex: 0,
      channels,
      batchSize: config.bulk.batchSize,
      dailyLimit: config.bulk.dailyLimit,
      delayMinutes: config.bulk.delayMinutes,
      dayKey: utcDayKey(),
      syncedToday: 0,
      totalCreated: 0,
      totalScanned: 0,
      totalSkipped: 0,
      totalErrors: 0,
      nextRunAt: null,
      lastBatch: null,
      lastError: null,
      logs: [],
    };
  }

  async init() {
    let saved = null;
    try {
      const row = await db.getRecord(JOB_COLLECTION, JOB_ID, {
        ttl: 0,
        staleTtl: 0,
        force: true,
      });
      if (row && typeof row === "object") saved = row;
    } catch (error) {
      if (error.status !== 404) {
        logger.warn("Could not load bulk sync state", { error: error.message });
      }
    }

    if (saved) {
      this.state = this.mergeState(saved);
      if (this.state.dayKey !== utcDayKey()) {
        this.state.dayKey = utcDayKey();
        this.state.syncedToday = 0;
      }
    } else {
      this.state = this.defaultState();
    }

    this.applyChannelConfig();
    this.ready = true;

    if (["running", "paused"].includes(this.state.status)) {
      youtube.setExternalLock(true, "bulk-sync");
    } else {
      youtube.setExternalLock(false);
    }

    if (this.state.status === "running") {
      const delay = this.state.nextRunAt
        ? Math.max(0, new Date(this.state.nextRunAt).getTime() - Date.now())
        : 1000;
      this.schedule(delay);
    }

    logger.info("Bulk sync ready", {
      status: this.state.status,
      current: this.currentChannel() ? this.currentChannel().title : null,
      syncedToday: this.state.syncedToday,
      dailyLimit: this.state.dailyLimit,
    });
  }

  mergeState(saved) {
    const base = this.defaultState();
    return {
      ...base,
      ...saved,
      id: JOB_ID,
      channels: Array.isArray(saved.channels) && saved.channels.length ? saved.channels : base.channels,
      logs: Array.isArray(saved.logs) ? saved.logs.slice(0, 60) : [],
      batchSize: Math.max(1, Math.min(50, Number(saved.batchSize) || base.batchSize)),
      dailyLimit: Math.max(1, Number(saved.dailyLimit) || base.dailyLimit),
      delayMinutes: Math.max(1, Number(saved.delayMinutes) || base.delayMinutes),
    };
  }

  applyChannelConfig() {
    const existing = new Map(this.state.channels.map((channel) => [channel.id, channel]));
    const merged = config.youtube.channels.map((channel) => {
      const prior = existing.get(channel.id);
      if (!prior) return defaultChannel(channel);
      return {
        ...defaultChannel(channel),
        ...prior,
        name: prior.name || channel.name,
        title: prior.title || channel.name,
        pendingItems: Array.isArray(prior.pendingItems) ? prior.pendingItems : [],
      };
    });
    this.state.channels = merged;
    if (this.state.currentChannelIndex >= merged.length) {
      this.state.currentChannelIndex = Math.max(0, merged.length - 1);
    }
  }

  currentChannel() {
    return this.state.channels[this.state.currentChannelIndex] || null;
  }

  snapshot() {
    const current = this.currentChannel();
    const nextRunAt = this.state.nextRunAt;
    return {
      ...this.state,
      channels: this.state.channels.map(({ pendingItems, ...channel }) => ({
        ...channel,
        pendingCount: Array.isArray(pendingItems) ? pendingItems.length : 0,
      })),
      currentChannel: current
        ? {
            id: current.id,
            name: current.name,
            title: current.title,
            status: current.status,
            created: current.created,
            scanned: current.scanned,
            skipped: current.skipped,
            errors: current.errors,
            pendingCount: Array.isArray(current.pendingItems) ? current.pendingItems.length : 0,
            pageToken: Boolean(current.pageToken),
          }
        : null,
      running: this.state.status === "running",
      locked: Boolean(youtube.externalLock),
      remainingToday: Math.max(0, this.state.dailyLimit - this.state.syncedToday),
      secondsToNextRun:
        nextRunAt && this.state.status === "running"
          ? Math.max(0, Math.round((new Date(nextRunAt).getTime() - Date.now()) / 1000))
          : null,
      now: nowIso(),
    };
  }

  log(message, level = "info") {
    this.state.logs.unshift({ at: nowIso(), level, message: String(message).slice(0, 300) });
    this.state.logs = this.state.logs.slice(0, 60);
  }

  async save() {
    this.state.updatedAt = nowIso();
    try {
      await db.write("PUT", JOB_COLLECTION + "/" + JOB_ID, this.state);
    } catch (error) {
      logger.warn("Could not persist bulk sync state", { error: error.message });
    }
    events.broadcast("bulk:changed", {
      status: this.state.status,
      phase: this.state.phase,
      syncedToday: this.state.syncedToday,
      currentChannelIndex: this.state.currentChannelIndex,
    }, { adminOnly: true });
  }

  schedule(delayMs) {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.state.status !== "running") return;
    const delay = Math.max(50, Number(delayMs) || 50);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.tick().catch((error) => {
        logger.error("Bulk sync tick failed", { error: error.message });
      });
    }, delay);
    this.timer.unref?.();
  }

  requireReady() {
    if (!this.ready) throw Object.assign(new Error("Bulk sync is still starting."), { status: 503 });
  }

  applyOptions(options = {}) {
    this.state.batchSize = Math.max(
      1,
      Math.min(50, Number(options.batchSize) || this.state.batchSize)
    );
    this.state.dailyLimit = Math.max(
      1,
      Math.min(5000, Number(options.dailyLimit) || this.state.dailyLimit)
    );
    this.state.delayMinutes = Math.max(
      1,
      Math.min(1440, Number(options.delayMinutes) || this.state.delayMinutes)
    );
  }

  async start(options = {}) {
    this.requireReady();

    if (this.state.status === "running") {
      return { started: false, ...this.snapshot() };
    }
    if (this.state.status === "paused") {
      return this.resume(options);
    }

    const reset = Boolean(options.reset);
    const resumable =
      !reset &&
      this.state.startedAt &&
      !["completed", "stopped", "error"].includes(this.state.status);

    if (!resumable) {
      const settings = {
        batchSize: this.state.batchSize,
        dailyLimit: this.state.dailyLimit,
        delayMinutes: this.state.delayMinutes,
      };
      this.state = this.defaultState();
      this.applyOptions({ ...settings, ...options });
    } else {
      this.applyOptions(options);
    }

    if (!this.state.channels.length) {
      this.log("No YouTube channels are configured.", "error");
      this.state.status = "error";
      this.state.phase = "error";
      this.state.lastError = "No YouTube channels configured.";
      await this.save();
      return { started: false, ...this.snapshot() };
    }

    this.state.status = "running";
    this.state.phase = "syncing";
    this.state.startedAt = this.state.startedAt || nowIso();
    this.state.completedAt = null;
    this.state.nextRunAt = nowIso();
    this.state.lastError = null;
    youtube.setExternalLock(true, "bulk-sync");
    this.log(reset ? "Bulk sync started from the beginning." : "Bulk sync started.");
    await this.save();
    this.schedule(50);
    return {
      started: true,
      ...this.snapshot(),
    };
  }

  async pause() {
    this.requireReady();
    if (this.state.status !== "running") {
      return { paused: false, ...this.snapshot() };
    }
    this.state.status = "paused";
    this.state.phase = "paused";
    this.state.nextRunAt = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.log("Bulk sync paused.");
    await this.save();
    return { paused: true, ...this.snapshot() };
  }

  async resume(options = {}) {
    this.requireReady();
    if (!["paused", "stopped", "error"].includes(this.state.status)) {
      return { started: false, ...this.snapshot() };
    }
    if (!this.state.startedAt) return this.start({ ...options, reset: false });
    this.applyOptions(options);
    this.state.status = "running";
    this.state.phase = "syncing";
    this.state.lastError = null;
    this.state.nextRunAt = nowIso();
    youtube.setExternalLock(true, "bulk-sync");
    this.log("Bulk sync resumed.");
    await this.save();
    this.schedule(50);
    return { started: true, ...this.snapshot() };
  }

  async reset() {
    this.requireReady();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const settings = {
      batchSize: this.state.batchSize,
      dailyLimit: this.state.dailyLimit,
      delayMinutes: this.state.delayMinutes,
    };
    this.state = this.defaultState();
    this.applyOptions(settings);
    youtube.setExternalLock(false);
    this.log("Bulk sync job reset. Start again to sync from the beginning.");
    await this.save();
    return { reset: true, ...this.snapshot() };
  }

  async stop() {
    this.requireReady();
    this.state.status = "stopped";
    this.state.phase = "stopped";
    this.state.nextRunAt = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    youtube.setExternalLock(false);
    this.log("Bulk sync stopped by administrator.");
    await this.save();
    return { stopped: true, ...this.snapshot() };
  }

  async finish(reason = "All configured channels are complete.") {
    this.state.status = "completed";
    this.state.phase = "done";
    this.state.completedAt = nowIso();
    this.state.nextRunAt = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    youtube.setExternalLock(false);
    this.log(reason);
    await this.save();
    events.broadcast("bulk:completed", {
      created: this.state.totalCreated,
      scanned: this.state.totalScanned,
      skipped: this.state.totalSkipped,
      errors: this.state.totalErrors,
    }, { adminOnly: true });
    analytics.audit("youtube.bulk-sync.completed", {
      actor: "system",
      meta: {
        created: this.state.totalCreated,
        scanned: this.state.totalScanned,
        skipped: this.state.totalSkipped,
        errors: this.state.totalErrors,
      },
    });
  }

  advanceChannel(status = "done") {
    const current = this.currentChannel();
    if (current) {
      current.status = status;
      current.lastSyncAt = nowIso();
    }
    this.state.currentChannelIndex += 1;
    if (this.state.currentChannelIndex >= this.state.channels.length) {
      return true;
    }
    return false;
  }

  async nextChannel() {
    this.requireReady();
    if (!["running", "paused"].includes(this.state.status)) {
      return { moved: false, ...this.snapshot() };
    }
    const done = this.advanceChannel("skipped");
    this.log("Moved to the next channel.");
    if (done) {
      await this.finish("All channels were skipped or completed.");
    } else if (this.state.status === "running") {
      this.state.nextRunAt = nowIso();
      await this.save();
      this.schedule(50);
    } else {
      await this.save();
    }
    return { moved: true, ...this.snapshot() };
  }

  async completeChannel() {
    this.requireReady();
    if (!["running", "paused"].includes(this.state.status)) {
      return { moved: false, ...this.snapshot() };
    }
    const done = this.advanceChannel("done");
    this.log("Current channel marked complete.");
    if (done) {
      await this.finish("All configured channels are complete.");
    } else if (this.state.status === "running") {
      this.state.nextRunAt = nowIso();
      await this.save();
      this.schedule(50);
    } else {
      await this.save();
    }
    return { moved: true, ...this.snapshot() };
  }

  async syncNow() {
    this.requireReady();
    if (!["running", "paused", "stopped", "error"].includes(this.state.status)) {
      return this.start({ reset: false });
    }
    if (this.state.status !== "running") {
      this.state.status = "running";
      this.state.phase = "syncing";
      youtube.setExternalLock(true, "bulk-sync");
    }
    this.state.nextRunAt = nowIso();
    this.log("Immediate batch requested.");
    await this.save();
    this.schedule(50);
    return { started: true, ...this.snapshot() };
  }

  async tick() {
    if (this.ticking || this.state.status !== "running") return;
    this.ticking = true;
    try {
      if (!config.youtube.channels.length) {
        await this.finish("No YouTube channels are configured.");
        return;
      }

      if (this.state.dayKey !== utcDayKey()) {
        this.state.dayKey = utcDayKey();
        this.state.syncedToday = 0;
      }

      if (this.state.syncedToday >= this.state.dailyLimit) {
        this.state.phase = "daily-pause";
        this.state.nextRunAt = new Date(nextUtcMidnight()).toISOString();
        this.log("Daily video limit reached; waiting for the next UTC day.");
        await this.save();
        this.schedule(nextUtcMidnight() - Date.now());
        return;
      }

      let channel = this.currentChannel();
      if (!channel || ["done", "skipped"].includes(channel.status)) {
        if (this.advanceChannel("done")) {
          await this.finish("All configured channels are complete.");
          return;
        }
        channel = this.currentChannel();
      }

      const startedAt = Date.now();
      const batch = await this.processBatch(channel);
      this.state.lastBatch = {
        ...batch,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: nowIso(),
        durationMs: Date.now() - startedAt,
      };

      // A pause/stop can land while a batch is in flight. Persist the batch
      // but do not schedule the next one or change the phase in that case.
      if (this.state.status !== "running") {
        await this.save();
        return;
      }

      if (channel.pendingItems.length === 0 && !channel.pageToken) {
        const finishedAll = this.advanceChannel("done");
        this.log("Channel complete: " + (channel.title || channel.name));
        if (finishedAll) {
          await this.finish("All configured channels are complete.");
          return;
        }
      }

      if (this.state.syncedToday >= this.state.dailyLimit) {
        this.state.phase = "daily-pause";
        this.state.nextRunAt = new Date(nextUtcMidnight()).toISOString();
        this.log("Daily video limit reached; waiting for the next UTC day.");
        await this.save();
        this.schedule(nextUtcMidnight() - Date.now());
        return;
      }

      this.state.phase = "waiting";
      this.state.nextRunAt = new Date(Date.now() + this.state.delayMinutes * 60000).toISOString();
      await this.save();
      this.schedule(this.state.delayMinutes * 60000);
    } catch (error) {
      this.state.lastError = error.message;
      this.state.totalErrors += 1;
      const channel = this.currentChannel();
      if (channel) {
        channel.errors += 1;
        channel.lastError = error.message;
      }
      const delayMs = error.code === "yt_quota" ? 60 * 60000 : this.state.delayMinutes * 60000;
      this.state.phase = "error-wait";
      this.state.nextRunAt = new Date(Date.now() + delayMs).toISOString();
      this.log("Batch failed: " + error.message, "error");
      logger.warn("Bulk sync batch failed", {
        error: error.message,
        code: error.code,
        channel: channel && channel.id,
      });
      await this.save();
      this.schedule(delayMs);
    } finally {
      this.ticking = false;
    }
  }

  async processBatch(channel) {
    const resolved = await youtube.resolveChannel({
      id: channel.id,
      name: channel.name,
      uploadsPlaylistId: channel.uploadsPlaylistId,
    });
    channel.title = resolved.title || channel.title || channel.name;
    channel.uploadsPlaylistId = resolved.uploadsPlaylistId;
    channel.lastSyncAt = nowIso();

    let fetchErrors = 0;
    let pageFetched = 0;

    if (!channel.pendingItems.length) {
      const data = await youtube.fetchPlaylist(resolved.uploadsPlaylistId, channel.pageToken || null, {
        maxResults: Math.max(1, Math.min(50, this.state.batchSize)),
        force: true,
      });
      const items = data && Array.isArray(data.items) ? data.items : [];
      channel.pageToken = (data && data.nextPageToken) || null;

      // Store mapped video documents, never raw RapidAPI pages. This keeps
      // the job document free of nested arrays and makes a restart resume
      // with exactly the batch that was pending.
      channel.pendingItems = items
        .map((item) => youtube.mapItem(item, resolved))
        .filter(Boolean);
      fetchErrors = items.length - channel.pendingItems.length;
      pageFetched = channel.pendingItems.length;

      if (fetchErrors > 0) {
        channel.errors += fetchErrors;
        this.state.totalErrors += fetchErrors;
      }

      if (!channel.pendingItems.length && !channel.pageToken) {
        return {
          channel: channel.id,
          scanned: 0,
          created: 0,
          skipped: 0,
          errors: fetchErrors,
          pageFetched: 0,
        };
      }
    }

    const batch = {
      channel: channel.id,
      scanned: 0,
      created: 0,
      skipped: 0,
      errors: fetchErrors,
      pageFetched,
    };

    const slice = channel.pendingItems.splice(0, this.state.batchSize);
    for (let index = 0; index < slice.length; index += 1) {
      if (this.state.syncedToday >= this.state.dailyLimit) {
        channel.pendingItems = slice.slice(index).concat(channel.pendingItems);
        break;
      }
      const record = slice[index];
      if (!record) {
        batch.errors += 1;
        channel.errors += 1;
        this.state.totalErrors += 1;
        continue;
      }
      batch.scanned += 1;
      channel.scanned += 1;
      this.state.totalScanned += 1;
      try {
        const result = await db.write("POST", "videos", record);
        if (result.status === 201 || result.status === 200) {
          batch.created += 1;
          channel.created += 1;
          this.state.totalCreated += 1;
          this.state.syncedToday += 1;
        } else if (result.status === 409) {
          batch.skipped += 1;
          channel.skipped += 1;
          this.state.totalSkipped += 1;
        } else {
          batch.errors += 1;
          channel.errors += 1;
          this.state.totalErrors += 1;
        }
      } catch (error) {
        if (error.status === 409 || error.code === "already_exists") {
          batch.skipped += 1;
          channel.skipped += 1;
          this.state.totalSkipped += 1;
        } else {
          batch.errors += 1;
          channel.errors += 1;
          this.state.totalErrors += 1;
          channel.lastError = error.message;
        }
      }
      events.broadcast("bulk:progress", {
        channel: channel.id,
        title: channel.title,
        created: this.state.totalCreated,
        syncedToday: this.state.syncedToday,
        dailyLimit: this.state.dailyLimit,
        ytid: record.ytid,
      }, { adminOnly: true });
    }

    if (!channel.pendingItems.length && !channel.pageToken) {
      channel.status = "done";
    }
    return batch;
  }
}

const bulkSync = new BulkSync();

module.exports = { BulkSync, bulkSync, JOB_ID };
