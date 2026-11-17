"use strict";

/* ------------------------------------------------------------------
   D74 Edits — live channel catalogue
   Channels are administrator-managed documents stored in
   server/data/channels.json. The file is gitignored because it holds
   private stream and DRM configuration.

   The store is versioned, validated on write, written atomically and
   cached for public reads. Every mutation clears the cached list and
   its stale copy so the public site updates immediately.
------------------------------------------------------------------ */

const fs = require("fs");
const path = require("path");
const config = require("./config");
const { cache } = require("./cache");
const logger = require("./logger");

const FILE = path.join(config.root, "server", "data", "channels.json");
const DATA_DIR = path.dirname(FILE);
const VERSION = 1;
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

function emptyStore() {
  return { version: VERSION, updatedAt: null, channels: [] };
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

  const source = {
    label,
    type,
    url,
  };
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

function readStore() {
  if (!fs.existsSync(FILE)) return emptyStore();
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (error) {
    logger.warn("Could not read channels.json", { error: error.message });
    return emptyStore();
  }

  // The old catalogue was an object of id -> { url, k1, k2 } documents.
  // It is intentionally not migrated: the administrator now owns the
  // catalogue and starts from a clean, empty store.
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.channels)) {
    return emptyStore();
  }

  const channels = [];
  parsed.channels.forEach((channel) => {
    if (
      !channel ||
      typeof channel !== "object" ||
      !validId(channel.id) ||
      !String(channel.title || "").trim() ||
      !Array.isArray(channel.sources)
    ) {
      return;
    }
    try {
      channels.push(normalizeChannel(channel, { id: channel.id, existing: channel, touch: false }));
    } catch (error) {
      logger.warn("Skipped invalid channel document", { id: channel.id, error: error.message });
    }
  });

  return {
    version: Number(parsed.version) || VERSION,
    updatedAt: parsed.updatedAt || null,
    channels,
  };
}

function writeStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const payload = JSON.stringify(store, null, 2) + "\n";
  const tmp = FILE + "." + process.pid + ".tmp";
  try {
    fs.writeFileSync(tmp, payload, { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch (_) {}
    throw error;
  }
  try {
    fs.chmodSync(FILE, 0o600);
  } catch (_) {}
}

let writeChain = Promise.resolve();

function queueWrite(operation) {
  const run = writeChain.then(operation, operation);
  writeChain = run.catch(() => {});
  return run;
}

async function invalidate() {
  await Promise.all([cache.del(LIST_KEY), cache.del(LIST_KEY + ":stale")]);
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

function listAll() {
  return sortChannels(readStore().channels);
}

async function list() {
  return cache.getOrSet(
    LIST_KEY,
    LIST_TTL,
    async () =>
      sortChannels(readStore().channels)
        .filter((channel) => channel.status === "active")
        .map(publicSummary),
    { staleTtl: LIST_STALE_TTL }
  );
}

async function get(id) {
  const store = readStore();
  const channel = store.channels.find((item) => item.id === id);
  if (!channel || channel.status !== "active") return null;
  return publicChannel(channel);
}

function create(body) {
  return queueWrite(async () => {
    const requestedId = String((body && body.id) || "").trim();
    if (!validId(requestedId)) {
      throw new ChannelError(
        "Channel id must be 1–64 characters using letters, numbers, hyphens or underscores.",
        400,
        "invalid_channel_id",
        { field: "id" }
      );
    }

    const store = readStore();
    if (store.channels.some((channel) => channel.id === requestedId)) {
      throw new ChannelError(
        "A channel with that id already exists.",
        409,
        "channel_exists",
        { field: "id" }
      );
    }

    const channel = normalizeChannel(body, { id: requestedId });
    store.channels.push(channel);
    store.version = VERSION;
    store.updatedAt = nowIso();
    writeStore(store);
    await invalidate();
    return channel;
  });
}

function update(id, body) {
  return queueWrite(async () => {
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

    const store = readStore();
    const index = store.channels.findIndex((channel) => channel.id === id);
    if (index === -1) {
      throw new ChannelError("Channel not found.", 404, "channel_not_found");
    }

    const channel = normalizeChannel(body, { id, existing: store.channels[index] });
    store.channels[index] = channel;
    store.version = VERSION;
    store.updatedAt = nowIso();
    writeStore(store);
    await invalidate();
    return channel;
  });
}

function remove(id) {
  return queueWrite(async () => {
    if (!validId(id)) {
      throw new ChannelError("Invalid channel id.", 400, "invalid_channel_id");
    }
    const store = readStore();
    const index = store.channels.findIndex((channel) => channel.id === id);
    if (index === -1) {
      throw new ChannelError("Channel not found.", 404, "channel_not_found");
    }
    const [removed] = store.channels.splice(index, 1);
    store.version = VERSION;
    store.updatedAt = nowIso();
    writeStore(store);
    await invalidate();
    return { id: removed.id, title: removed.title };
  });
}

function clear() {
  return invalidate();
}

module.exports = {
  ChannelError,
  list,
  listAll,
  get,
  create,
  update,
  remove,
  clear,
};
