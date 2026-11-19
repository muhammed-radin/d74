"use strict";

/* ------------------------------------------------------------------
   D74 Edits — metered data layer
   Every database read goes through this module. Reads are cached (with
   a stale-while-revalidate window) and coalesced so a burst of visitors
   costs one upstream request instead of hundreds. Writes invalidate the
   affected collection and emit an event for connected clients.
------------------------------------------------------------------ */

const crypto = require("crypto");
const config = require("./config");
const logger = require("./logger");
const { cache } = require("./cache");
const { quota } = require("./quota");
const { events } = require("./events");
const store = require("./store");

class DataError extends Error {
  constructor(message, status = 502, code = "data_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function hash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 16);
}

function collectionOf(pathAndQuery) {
  return String(pathAndQuery || "").split("?")[0].split("/")[0];
}

function validPath(pathAndQuery) {
  return /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)?(\?.*)?$/.test(String(pathAndQuery || ""));
}

function buildPath(collection, query, max) {
  let path = collection;
  if (typeof query === "string" && query.trim()) {
    path += query.startsWith("?") ? query : "?" + query;
  } else if (query && typeof query === "object") {
    path += "?q=" + encodeURIComponent(JSON.stringify(query));
  } else {
    path += "?q=" + encodeURIComponent(JSON.stringify({}));
  }
  if (max && !/[?&]max=/.test(path)) path += "&max=" + encodeURIComponent(String(max));
  return path;
}

function upstreamUrl(pathAndQuery) {
  return String(pathAndQuery || "").replace(/^\/+/, "");
}

async function request(method, pathAndQuery, body) {
  if (!validPath(pathAndQuery)) throw new DataError("Invalid data path.", 400, "invalid_path");
  const collection = collectionOf(pathAndQuery);
  if (!config.db.allowlist.has(collection)) throw new DataError("Unknown collection.", 404, "unknown_collection");

  const check = await quota.check("db");
  if (!check.allowed) {
    throw new DataError("Daily database quota reached. Cached data is still available.", 503, "db_quota");
  }

  try {
    return await store.request(method, upstreamUrl(pathAndQuery), body);
  } catch (error) {
    if (error instanceof DataError) throw error;
    throw Object.assign(new DataError(error.message || "Data service error.", error.status || 502, error.code || "data_error"), {
      fields: error.fields,
      firebaseStatus: error.firebaseStatus,
    });
  } finally {
    if (store.remote) await quota.consume("db").catch(() => {});
  }
}

async function init() {
  return store.init();
}

function providerInfo() {
  return store.describe();
}

async function clearCollection(collection) {
  if (!config.db.allowlist.has(collection)) {
    throw new DataError("Unknown collection.", 404, "unknown_collection");
  }
  const result = await request("DELETE", collection);
  await invalidate(collection);
  events.broadcast(collection === "videos" ? "videos:cleared" : "db:cleared", {
    collection,
    deleted: (result.data && result.data.deleted) || 0,
  }, { adminOnly: true });
  logger.info("Data collection cleared", {
    collection,
    deleted: (result.data && result.data.deleted) || 0,
  });
  return result;
}

async function read(pathAndQuery, options = {}) {
  const ttl = options.ttl != null ? options.ttl : config.cache.dbTtl;
  const staleTtl = options.staleTtl != null ? options.staleTtl : config.cache.dbStaleTtl;
  const key = "db:path:" + hash(pathAndQuery);
  const cached = await cache.getOrSet(
    key,
    ttl,
    async () => {
      const result = await request("GET", pathAndQuery);
      return result.status >= 200 && result.status < 300 ? result.data : null;
    },
    { staleTtl, force: Boolean(options.force) }
  );
  await rememberPathKey(collectionOf(pathAndQuery), pathAndQuery);
  return cached;
}

async function getAll(collection, options = {}) {
  const query = options.query || {};
  const pageSize = Math.min(1000, options.pageSize || config.db.pageSize);
  const key = "db:all:" + collection + ":" + pageSize + ":" + hash(JSON.stringify(query));
  const ttl = options.ttl != null ? options.ttl : config.cache.dbTtl;
  const staleTtl = options.staleTtl != null ? options.staleTtl : config.cache.dbStaleTtl;

  return cache.getOrSet(
    key,
    ttl,
    async () => {
      const results = [];
      let skip = 0;
      for (let page = 0; page < 10; page += 1) {
        const path = buildPath(collection, query, pageSize) + "&skip=" + skip;
        const result = await request("GET", path);
        const rows = Array.isArray(result.data) ? result.data : [];
        results.push(...rows);
        if (rows.length < pageSize) break;
        skip += pageSize;
      }
      if (results.length >= pageSize * 10) {
        logger.warn("Collection pagination hit the safety cap", { collection, count: results.length });
      }
      return results;
    },
    { staleTtl, force: Boolean(options.force) }
  );
}

async function getCollection(collection, options = {}) {
  const path = buildPath(collection, options.query || {}, options.max || 1000);
  return read(path, options);
}

async function getRecord(collection, id, options = {}) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(id))) throw new DataError("Invalid record id.", 400, "invalid_id");
  const path = collection + "/" + id;
  return read(path, options);
}

async function invalidate(collection, id) {
  await cache.delPrefix("db:all:" + collection + ":");
  // Path keys are hashes, so clear the ones belonging to this collection
  // using the small index maintained by read().
  const index = (await cache.get("db:index:" + collection)) || [];
  await Promise.all(index.map((entry) => cache.del("db:path:" + entry)));
  await cache.del("db:index:" + collection);
  if (id) await cache.del("db:record:" + collection + ":" + id);
}

async function rememberPathKey(collection, pathAndQuery) {
  const key = "db:index:" + collection;
  const index = (await cache.get(key)) || [];
  const hashed = hash(pathAndQuery);
  if (!index.includes(hashed)) {
    index.push(hashed);
    if (index.length > 200) index.shift();
    await cache.set(key, index, 86400);
  }
}

async function write(method, pathAndQuery, body) {
  const collection = collectionOf(pathAndQuery);
  const result = await request(method, pathAndQuery, body);
  if (result.status < 200 || result.status >= 300) return result;

  const id =
    result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? result.data._id || result.data.id
      : null;

  await invalidate(collection, id);

  const eventType =
    collection === "videos"
      ? method === "POST"
        ? "video:created"
        : method === "DELETE"
          ? "video:deleted"
          : "video:updated"
      : collection === "account"
        ? "account:changed"
        : collection === "themes"
          ? "theme:changed"
          : "db:changed";

  const preview = result.data && typeof result.data === "object" ? result.data : {};
  events.broadcast(eventType, {
    collection,
    method,
    id,
    ytid: preview.ytid || undefined,
    title: preview.title || undefined,
  });
  events.broadcast("db:changed", { collection, method, id }, { adminOnly: true });

  logger.info("Data write", { collection, method, id, status: result.status });
  return result;
}

async function count(collection, options = {}) {
  const rows = await getAll(collection, {
    ...options,
    ttl: options.ttl != null ? options.ttl : 300,
    staleTtl: options.staleTtl != null ? options.staleTtl : 900,
  });
  return Array.isArray(rows) ? rows.length : 0;
}

/* ---------------------------- sanitising --------------------------- */

function prepareVideoRecord(record, { stripSecrets = true } = {}) {
  if (!record || typeof record !== "object") return record;
  const clean = { ...record };
  const pageUrl = "https://youtube.com/watch?v=" + clean.ytid;
  clean.downloadable = Boolean(clean.url) && clean.url !== pageUrl;
  if (stripSecrets) {
    delete clean.pw;
    delete clean.url;
  }
  return clean;
}

function prepareVideos(data, options = {}) {
  if (Array.isArray(data)) return data.map((record) => prepareVideoRecord(record, options));
  return prepareVideoRecord(data, options);
}

function prepareAccount(record) {
  if (!record || typeof record !== "object") return record;
  const clean = { ...record };
  delete clean.password;
  delete clean.passwordHash;
  delete clean.salt;
  return clean;
}

function prepareAccounts(data) {
  if (Array.isArray(data)) return data.map(prepareAccount);
  return prepareAccount(data);
}

module.exports = {
  DataError,
  request,
  read,
  getAll,
  getCollection,
  getRecord,
  write,
  invalidate,
  count,
  clearCollection,
  init,
  providerInfo,
  rememberPathKey,
  prepareVideos,
  prepareVideoRecord,
  prepareAccount,
  prepareAccounts,
  collectionOf,
  buildPath,
};
