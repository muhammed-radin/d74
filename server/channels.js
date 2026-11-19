"use strict";

/* ------------------------------------------------------------------
   D74 Edits — live channel catalogue
   Channels are administrator-managed documents in the configured
   database (Firebase by default), not a server-side JSON file. The
   legacy file is imported once so an existing catalogue is not lost.

   Public reads are cached and expose summaries only. Stream URLs and
   ClearKey values stay in the single-channel response consumed by the
   player. Writes are validated and invalidate both the channel list and
   the database read cache.
------------------------------------------------------------------ */

const fs = require("fs");
const path = require("path");
const config = require("./config");
const db = require("./db");
const { cache } = require("./cache");
const logger = require("./logger");

const COLLECTION = "channels";
const LEGACY_FILE = path.join(config.root, "server", "data", "channels.json");
const LIST_KEY = "channels:list";
const LIST_TTL = 60;
const LIST_STALE_TTL = 240;

const LIMITS = {
  title: 120,
  logo: 2048,
  description: 600,
  category: 48,
  country: 48,
  language: 48,
  sources: 12,
  sourceLabel: 60,
  sourceUrl: 4096,
};

const SOURCE_TYPES = new Set(["auto", "hls", "dash", "mp4"]);
const STATUSES = new Set(["active", "hidden"]);

class ChannelError extends Error {
  constructor(message, status = 400, code = "invalid_channel", fields = null) {
    super(message);
    this.name = "ChannelError";
    this.status = status;
    this.code = code;
    if (fields) this.fields = fields;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function text(value, max) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function validId(id) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(String(id || ""));
}

function validUrl(value) {
  const url = String(value || "").trim();
  if (!url || url.length > LIMITS.sourceUrl) return false;
  return /^(https?:)?\/\/[^\s]+$/i.test(url);
}

function validLogo(value) {
  const logo = String(value || "").trim();
  if (!logo) return "";
  if (logo.length > LIMITS.logo) return null;
  if (/^\/[^/]/.test(logo)) return logo;
  if (/^(https?:)?\/\/[^\s]+$/i.test(logo)) return logo;
  return null;
}

function inferType(url) {
  const clean = String(url || "").split("?")[0].toLowerCase();
  if (clean.endsWith(".m3u8")) return "hls";
  if (clean.endsWith(".mpd")) return "dash";
  if (clean.endsWith(".mp4") || clean.endsWith(".webm") || clean.endsWith(".m4v")) return "mp4";
  return "auto";
}

function hexKey(value) {
  return /^[0-9a-f]{32}$/i.test(String(value || "").trim());
}

function normalizeSource(raw, index) {
  const input = raw && typeof raw === "object" ? raw : {};
  const url = String(input.url || "").trim();
  if (!validUrl(url)) {
    throw new ChannelError(
      "Source " + (index + 1) + " needs a valid http(s) stream URL.",
      400,
      "invalid_source",
      { field: "sources." + index + ".url" }
    );
  }

  const requestedType = String(input.type || "").trim().toLowerCase();
  const type = SOURCE_TYPES.has(requestedType) ? requestedType : inferType(url);
  const label = text(input.label, LIMITS.sourceLabel) || "Source " + (index + 1);
  const keyId = String(input.keyId || input.k1 || "").trim();
  const key = String(input.key || input.k2 || "").trim();

  if (keyId || key) {
    if (!hexKey(keyId) || !hexKey(key)) {
      throw new ChannelError(
        "ClearKey ids and keys must be 32-character hexadecimal values.",
        400,
        "invalid_drm_key",
        { field: "sources." + index + ".key" }
      );
    }
  }

  const source = { label, type, url };
  if (keyId && key) {
    source.keyId = keyId;
    source.key = key;
  }
  return source;
}

function normalizeSources(raw) {
  if (!Array.isArray(raw)) {
    throw new ChannelError("Add at least one stream source.", 400, "missing_sources");
  }

  const seen = new Set();
  const sources = [];
  raw.forEach((source, index) => {
    const normalized = normalizeSource(source, index);
    if (seen.has(normalized.url)) return;
    seen.add(normalized.url);
    sources.push(normalized);
  });

  if (!sources.length) {
    throw new ChannelError("Add at least one stream source.", 400, "missing_sources");
  }
  if (sources.length > LIMITS.sources) {
    throw new ChannelError(
      "A channel can have at most " + LIMITS.sources + " sources.",
      400,
      "too_many_sources"
    );
  }
  return sources;
}

function normalizeChannel(body, { id, existing = null, touch = true } = {}) {
  const input = body && typeof body === "object" ? body : {};
  const channelId = String(id || input.id || "").trim();

  if (!validId(channelId)) {
    throw new ChannelError(
      "Channel id must be 1–64 characters using letters, numbers, hyphens or underscores.",
      400,
      "invalid_channel_id",
      { field: "id" }
    );
  }

  const title = text(input.title, LIMITS.title);
  if (!title) {
    throw new ChannelError("A channel title is required.", 400, "missing_title", { field: "title" });
  }

  const logo = validLogo(input.logo);
  if (logo === null) {
    throw new ChannelError(
      "Logo URL must be an http(s) URL or a path starting with /.",
      400,
      "invalid_logo",
      { field: "logo" }
    );
  }

  const orderValue = Number(input.order);
  const order = Number.isFinite(orderValue) ? Math.max(0, Math.min(9999, Math.round(orderValue))) : 0;
  const status = STATUSES.has(String(input.status || "").toLowerCase())
    ? String(input.status).toLowerCase()
    : "active";
  const updatedAt = touch ? nowIso() : (existing && existing.updatedAt) || nowIso();

  return {
    id: channelId,
    title,
    logo,
    description: text(input.description, LIMITS.description),
    category: text(input.category, LIMITS.category),
    country: text(input.country, LIMITS.country),
    language: text(input.language, LIMITS.language),
    status,
    featured: Boolean(input.featured),
    order,
    sources: normalizeSources(input.sources),
    createdAt: existing && existing.createdAt ? existing.createdAt : updatedAt,
    updatedAt,
  };
}

function cleanChannel(row) {
  if (!row || typeof row !== "object" || !validId(row.id)) return null;
  try {
    return normalizeChannel(row, { id: row.id, existing: row, touch: false });
  } catch (error) {
    logger.warn("Skipped invalid channel document", { id: row.id, error: error.message });
    return null;
  }
}

function sortChannels(channels) {
  return channels.slice().sort((a, b) => {
    const orderDiff = Number(a.order || 0) - Number(b.order || 0);
    if (orderDiff !== 0) return orderDiff;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

function publicSummary(channel) {
  return {
    id: channel.id,
    title: channel.title,
    name: channel.title,
    logo: channel.logo || "",
    category: channel.category || "",
    country: channel.country || "",
    language: channel.language || "",
    featured: Boolean(channel.featured),
    order: Number(channel.order) || 0,
    sourceCount: Array.isArray(channel.sources) ? channel.sources.length : 0,
  };
}

function publicChannel(channel) {
  return {
    ...publicSummary(channel),
    description: channel.description || "",
    sources: (channel.sources || []).map((source) => {
      const item = {
        label: source.label || "Source",
        type: source.type || "auto",
        url: source.url,
      };
      if (source.keyId && source.key) {
        item.keyId = source.keyId;
        item.key = source.key;
      }
      return item;
    }),
  };
}

async function readAll(options = {}) {
  const rows = await db.getAll(COLLECTION, {
    ttl: options.ttl != null ? options.ttl : 30,
    staleTtl: options.staleTtl != null ? options.staleTtl : 120,
    force: Boolean(options.force),
  });
  return sortChannels((Array.isArray(rows) ? rows : []).map(cleanChannel).filter(Boolean));
}

async function listAll() {
  return readAll();
}

async function list() {
  return cache.getOrSet(
    LIST_KEY,
    LIST_TTL,
    async () =>
      (await readAll({ ttl: 60, staleTtl: 180 }))
        .filter((channel) => channel.status === "active")
        .map(publicSummary),
    { staleTtl: LIST_STALE_TTL }
  );
}

async function get(id) {
  if (!validId(id)) return null;
  const row = await db.getRecord(COLLECTION, id, { ttl: 30, staleTtl: 120 });
  const channel = cleanChannel(row);
  if (!channel || channel.status !== "active") return null;
  return publicChannel(channel);
}

async function invalidate() {
  await Promise.all([cache.del(LIST_KEY), cache.del(LIST_KEY + ":stale")]);
}

async function findOne(id, options = {}) {
  const row = await db.getRecord(COLLECTION, id, {
    ttl: options.ttl != null ? options.ttl : 0,
    staleTtl: options.staleTtl != null ? options.staleTtl : 0,
    force: options.force !== false,
  });
  return cleanChannel(row);
}

async function create(body) {
  const requestedId = String((body && body.id) || "").trim();
  if (!validId(requestedId)) {
    throw new ChannelError(
      "Channel id must be 1–64 characters using letters, numbers, hyphens or underscores.",
      400,
      "invalid_channel_id",
      { field: "id" }
    );
  }

  if (await findOne(requestedId)) {
    throw new ChannelError(
      "A channel with that id already exists.",
      409,
      "channel_exists",
      { field: "id" }
    );
  }

  const channel = normalizeChannel(body, { id: requestedId });
  try {
    await db.write("POST", COLLECTION, channel);
  } catch (error) {
    if (error.status === 409 || error.code === "already_exists") {
      throw new ChannelError(
        "A channel with that id already exists.",
        409,
        "channel_exists",
        { field: "id" }
      );
    }
    throw error;
  }
  await invalidate();
  return channel;
}

async function update(id, body) {
  if (!validId(id)) {
    throw new ChannelError("Invalid channel id.", 400, "invalid_channel_id");
  }
  const bodyId = String((body && body.id) || "").trim();
  if (bodyId && bodyId !== id) {
    throw new ChannelError(
      "Channel id cannot be changed. Create a new channel instead.",
      400,
      "channel_id_immutable",
      { field: "id" }
    );
  }

  const existing = await findOne(id);
  if (!existing) {
    throw new ChannelError("Channel not found.", 404, "channel_not_found");
  }

  const channel = normalizeChannel(body, { id, existing });
  await db.write("PUT", COLLECTION + "/" + encodeURIComponent(id), channel);
  await invalidate();
  return channel;
}

async function remove(id) {
  if (!validId(id)) {
    throw new ChannelError("Invalid channel id.", 400, "invalid_channel_id");
  }
  const existing = await findOne(id);
  if (!existing) {
    throw new ChannelError("Channel not found.", 404, "channel_not_found");
  }
  await db.write("DELETE", COLLECTION + "/" + encodeURIComponent(id), undefined);
  await invalidate();
  return { id: existing.id, title: existing.title };
}

async function clear() {
  await invalidate();
}

/* --------------------------- migration ---------------------------- */

function readLegacyFile() {
  if (!fs.existsSync(LEGACY_FILE)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(LEGACY_FILE, "utf8"));
    if (parsed && Array.isArray(parsed.channels)) return parsed.channels;
  } catch (error) {
    logger.warn("Could not read legacy channels.json", { error: error.message });
  }
  return null;
}

function archiveLegacyFile() {
  try {
    const target = LEGACY_FILE + ".migrated-" + Date.now();
    fs.renameSync(LEGACY_FILE, target);
    return target;
  } catch (error) {
    logger.warn("Could not archive legacy channels.json", { error: error.message });
    return null;
  }
}

async function importRows(rows, source) {
  let imported = 0;
  for (const row of rows) {
    try {
      if (!row || !validId(row.id)) continue;
      const channel = normalizeChannel(row, { id: row.id, existing: row, touch: false });
      await db.write("PUT", COLLECTION + "/" + encodeURIComponent(channel.id), channel);
      imported += 1;
    } catch (error) {
      logger.warn("Could not import channel", {
        source,
        id: row && row.id,
        error: error.message,
      });
    }
  }
  return imported;
}

function readLocalFallback() {
  const file = config.db.localFile;
  if (!file || !fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const rows = parsed && parsed.collections && parsed.collections.channels;
    if (!rows || typeof rows !== "object") return [];
    return Object.entries(rows).map(([id, row]) => ({
      ...(row && typeof row === "object" ? row : {}),
      id: (row && row.id) || id,
    }));
  } catch (error) {
    logger.warn("Could not read the local development database for channel migration", {
      error: error.message,
    });
    return [];
  }
}

async function init() {
  let existing = [];
  try {
    existing = await readAll({ force: true, ttl: 0, staleTtl: 0 });
  } catch (error) {
    logger.warn("Could not check the channel database; keeping legacy file", {
      error: error.message,
    });
    return;
  }

  const legacy = readLegacyFile();

  if (existing.length) {
    if (legacy) {
      const archived = archiveLegacyFile();
      logger.info("Channel database already has records; legacy file archived", { archived });
    }
    return;
  }

  let imported = 0;
  if (legacy) {
    imported = await importRows(legacy, "legacy-file");
    if (imported) {
      await invalidate();
      const archived = archiveLegacyFile();
      logger.info("Imported legacy channels into the database", { imported, archived });
    }
  }

  if (imported || db.providerInfo().name === "local") return;

  // Moving from the development file to Firebase: carry the channel
  // catalogue over once, and only while the remote collection is empty.
  const localRows = readLocalFallback();
  if (!localRows.length) return;
  imported = await importRows(localRows, "local-development-db");
  if (imported) {
    await invalidate();
    logger.info("Imported development channels into the active database", { imported });
  }
}

module.exports = {
  ChannelError,
  init,
  list,
  listAll,
  get,
  create,
  update,
  remove,
  clear,
};
