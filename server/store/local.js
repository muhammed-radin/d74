"use strict";

/* ------------------------------------------------------------------
   D74 Edits — local development database
   Used only when Firebase is not configured (or DB_PROVIDER=local).
   The file is gitignored, written atomically and kept at 0600 because
   it can contain account hashes and live-channel DRM keys.
------------------------------------------------------------------ */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("../config");
const logger = require("../logger");

const FILE = config.db.localFile;
const DATA_DIR = path.dirname(FILE);

let loaded = null;
let writeChain = Promise.resolve();

function emptyState() {
  return { version: 1, updatedAt: null, collections: {} };
}

function ensureLoaded() {
  if (loaded) return loaded;
  ensureDirectory();
  if (!fs.existsSync(FILE)) {
    loaded = emptyState();
    return loaded;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (!parsed || typeof parsed !== "object" || typeof parsed.collections !== "object") {
      throw new Error("Invalid local database shape.");
    }
    loaded = parsed;
  } catch (error) {
    const backup = FILE + ".corrupt-" + Date.now();
    try {
      fs.renameSync(FILE, backup);
    } catch (_) {}
    logger.error("Local database was corrupt; starting empty", {
      file: FILE,
      backup,
      error: error.message,
    });
    loaded = emptyState();
  }
  return loaded;
}

function ensureDirectory() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

function writeState() {
  ensureDirectory();
  const state = ensureLoaded();
  state.updatedAt = new Date().toISOString();
  const payload = JSON.stringify(state, null, 2) + "\n";
  const tmp = FILE + "." + process.pid + ".tmp";
  return new Promise((resolve, reject) => {
    try {
      fs.writeFileSync(tmp, payload, { mode: 0o600 });
      fs.renameSync(tmp, FILE);
      try {
        fs.chmodSync(FILE, 0o600);
      } catch (_) {}
      resolve();
    } catch (error) {
      try {
        fs.unlinkSync(tmp);
      } catch (_) {}
      reject(error);
    }
  });
}

function queueWrite(operation) {
  const run = writeChain.then(operation, operation);
  writeChain = run.catch(() => {});
  return run;
}

function collectionStore(name) {
  const state = ensureLoaded();
  if (!state.collections[name] || typeof state.collections[name] !== "object") {
    state.collections[name] = {};
  }
  return state.collections[name];
}

function safeDocId(value) {
  const id = String(value == null ? "" : value)
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .slice(0, 150);
  return id || crypto.randomBytes(12).toString("hex");
}

function documentId(collection, body) {
  if (body && body._id != null) return safeDocId(body._id);
  if (body && body.id != null) return safeDocId(body.id);
  if (collection === "videos" && body && body.ytid) return safeDocId(body.ytid);
  return safeDocId(crypto.randomBytes(12).toString("hex"));
}

function withId(id, record) {
  const clean = { ...record };
  delete clean._id;
  clean._id = id;
  return clean;
}

function parsePath(pathAndQuery) {
  const url = new URL("http://local/" + String(pathAndQuery || "").replace(/^\/+/, ""));
  const segments = url.pathname.split("/").filter(Boolean);
  let query = {};
  const raw = url.searchParams.get("q");
  if (raw) {
    try {
      query = JSON.parse(raw) || {};
    } catch (_) {
      throw Object.assign(new Error("Invalid database query."), {
        status: 400,
        code: "invalid_query",
      });
    }
  }
  const maxValue = Number(url.searchParams.get("max"));
  const skipValue = Number(url.searchParams.get("skip"));
  return {
    collection: segments[0] || "",
    id: segments[1] || "",
    query: query && typeof query === "object" ? query : {},
    max: Number.isFinite(maxValue) && maxValue > 0 ? Math.floor(maxValue) : 1000,
    skip: Number.isFinite(skipValue) && skipValue > 0 ? Math.floor(skipValue) : 0,
  };
}

function matches(record, query) {
  for (const [key, expected] of Object.entries(query || {})) {
    if (key.startsWith("$")) continue;
    const actual = record[key];
    if (Array.isArray(expected)) {
      if (!expected.some((value) => value === actual)) return false;
      continue;
    }
    if (expected && typeof expected === "object") {
      if ("$ne" in expected && actual === expected.$ne) return false;
      if ("$in" in expected && Array.isArray(expected.$in) && !expected.$in.includes(actual)) return false;
      if ("$regex" in expected) {
        try {
          if (!new RegExp(String(expected.$regex), expected.$options || "i").test(String(actual))) return false;
        } catch (_) {
          return false;
        }
      }
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function clone(record) {
  return JSON.parse(JSON.stringify(record));
}

async function request(method, pathAndQuery, body) {
  const parsed = parsePath(pathAndQuery);
  if (!parsed.collection) {
    throw Object.assign(new Error("Invalid data path."), { status: 400, code: "invalid_path" });
  }

  if (method === "GET" || method === "HEAD") {
    const docs = collectionStore(parsed.collection);
    if (parsed.id) {
      if (!Object.prototype.hasOwnProperty.call(docs, parsed.id)) {
        return { status: 404, data: null, headers: new Headers() };
      }
      return { status: 200, data: withId(parsed.id, clone(docs[parsed.id])), headers: new Headers() };
    }
    const rows = Object.keys(docs)
      .map((id) => withId(id, clone(docs[id])))
      .filter((row) => matches(row, parsed.query))
      .slice(parsed.skip, parsed.skip + parsed.max);
    return { status: 200, data: rows, headers: new Headers() };
  }

  if (method === "DELETE" && !parsed.id) {
    return queueWrite(async () => {
      const state = ensureLoaded();
      const removed = Object.keys(state.collections[parsed.collection] || {}).length;
      state.collections[parsed.collection] = {};
      await writeState();
      return { status: 200, data: { deleted: removed }, headers: new Headers() };
    });
  }

  if (method === "POST") {
    return queueWrite(async () => {
      const docs = collectionStore(parsed.collection);
      const id = documentId(parsed.collection, body);
      if (Object.prototype.hasOwnProperty.call(docs, id)) {
        throw Object.assign(new Error("A record with that id already exists."), {
          status: 409,
          code: "already_exists",
        });
      }
      const record = { ...(body || {}) };
      delete record._id;
      delete record.id;
      if (body && body.id != null && parsed.collection !== "videos") record.id = body.id;
      docs[id] = record;
      await writeState();
      return { status: 201, data: withId(id, clone(record)), headers: new Headers() };
    });
  }

  if (["PUT", "PATCH"].includes(method)) {
    return queueWrite(async () => {
      if (!parsed.id) {
        throw Object.assign(new Error("A record id is required."), { status: 400, code: "missing_id" });
      }
      const docs = collectionStore(parsed.collection);
      const record = { ...(body || {}) };
      delete record._id;
      delete record.id;
      if (body && body.id != null && parsed.collection !== "videos") record.id = body.id;
      docs[parsed.id] = record;
      await writeState();
      return { status: 200, data: withId(parsed.id, clone(record)), headers: new Headers() };
    });
  }

  if (method === "DELETE") {
    return queueWrite(async () => {
      const docs = collectionStore(parsed.collection);
      delete docs[parsed.id];
      await writeState();
      return { status: 200, data: { _id: parsed.id }, headers: new Headers() };
    });
  }

  throw Object.assign(new Error("Method not allowed."), { status: 405, code: "method_not_allowed" });
}

async function init() {
  ensureLoaded();
  return { name: "local", file: FILE };
}

module.exports = {
  name: "local",
  remote: false,
  configured: () => true,
  init,
  request,
};
