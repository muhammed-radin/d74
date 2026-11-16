"use strict";

/* ------------------------------------------------------------------
   D74 Edits — live channel catalogue
   server/data/channels.json is gitignored because it contains private
   stream and DRM configuration. Reads are cached in Redis/memory.
------------------------------------------------------------------ */

const fs = require("fs");
const path = require("path");
const config = require("./config");
const { cache } = require("./cache");
const logger = require("./logger");

const FILE = path.join(config.root, "server", "data", "channels.json");

function readFile() {
  if (!fs.existsSync(FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (error) {
    logger.warn("Could not read channels.json", { error: error.message });
    return {};
  }
}

function prettyName(id) {
  return String(id)
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function list() {
  const channels = await cache.getOrSet("channels:file", 300, readFile, { staleTtl: 900 });
  return Object.keys(channels || {})
    .sort()
    .map((id) => ({ id, name: prettyName(id) }));
}

async function get(id) {
  const channels = await cache.getOrSet("channels:file", 300, readFile, { staleTtl: 900 });
  if (!channels || !channels[id]) return null;
  return { id, name: prettyName(id), ...channels[id] };
}

function clear() {
  return cache.del("channels:file");
}

module.exports = { list, get, clear };
