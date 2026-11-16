"use strict";

/* ------------------------------------------------------------------
   D74 Edits — small structured logger
   JSON in production, readable lines in development. Secrets are
   redacted before anything reaches stdout.
------------------------------------------------------------------ */

const config = require("./config");

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const activeLevel = LEVELS[config.logLevel] == null ? LEVELS.info : LEVELS[config.logLevel];
const REDACT = /^(password|pass|token|secret|authorization|cookie|apikey|api_key|x-apikey|csrf|session)$/i;

function clean(value, depth = 0) {
  if (value == null) return value;
  if (depth > 4) return "[deep]";
  if (value instanceof Error) {
    return { name: value.name, message: value.message, code: value.code, stack: config.isProd ? undefined : value.stack };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => clean(item, depth + 1));
  if (typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = REDACT.test(key) ? "[redacted]" : clean(item, depth + 1);
    }
    return output;
  }
  if (typeof value === "string" && value.length > 500) return value.slice(0, 500) + "…";
  return value;
}

function write(level, message, meta) {
  if (LEVELS[level] > activeLevel) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: String(message),
    ...(meta && typeof meta === "object" ? clean(meta) : meta ? { detail: clean(meta) } : {}),
  };
  const line = config.isProd ? JSON.stringify(entry) : formatPretty(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function formatPretty(entry) {
  const { ts, level, msg, ...rest } = entry;
  const suffix = Object.keys(rest).length ? " " + JSON.stringify(rest) : "";
  return `${ts.slice(11, 23)} ${level.toUpperCase().padEnd(5)} ${msg}${suffix}`;
}

module.exports = {
  error: (message, meta) => write("error", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  info: (message, meta) => write("info", message, meta),
  debug: (message, meta) => write("debug", message, meta),
  child(bindings) {
    return {
      error: (message, meta) => write("error", message, { ...bindings, ...meta }),
      warn: (message, meta) => write("warn", message, { ...bindings, ...meta }),
      info: (message, meta) => write("info", message, { ...bindings, ...meta }),
      debug: (message, meta) => write("debug", message, { ...bindings, ...meta }),
    };
  },
};
