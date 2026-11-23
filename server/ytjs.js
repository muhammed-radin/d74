"use strict";

const logger = require("./logger");
const config = require("./config");
const fs = require("fs");

const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

function safeId(value) {
  const id = String(value || "").trim();
  return VIDEO_ID.test(id) ? id : "";
}

function cookieString() {
  const file = config.ytdlp.cookies;
  if (!file) return "";
  try {
    if (!fs.existsSync(file)) return "";
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    const pairs = [];
    for (const line of lines) {
      if (!line || line.startsWith("#")) continue;
      const parts = line.split("\t");
      if (parts.length >= 7) pairs.push(parts[5] + "=" + parts[6]);
    }
    return pairs.join("; ");
  } catch (_) {
    return "";
  }
}

const instances = new Map();

function getInnertube(cookie) {
  const key = cookie || "";
  if (!instances.has(key)) {
    const promise = (async () => {
      const mod = await import("youtubei.js");
      const Platform = mod.Platform;
      const vm = require("vm");
      if (Platform && Platform.shim) {
        Platform.shim.eval = (data, env) => {
          const ctx = vm.createContext(Object.assign({}, env || {}, { console }));
          const code = "function __run__() {\n" + String(data && data.output ? data.output : "") + "\n}\n__run__();";
          return new vm.Script(code).runInContext(ctx, { timeout: 5000 });
        };
      }
      const Innertube = mod.default || mod.Innertube;
      return Innertube.create(cookie ? { cookie } : {});
    })().catch((error) => {
      instances.delete(key);
      throw error;
    });
    instances.set(key, promise);
  }
  return instances.get(key);
}

function strategies() {
  const list = [{ client: "ANDROID", cookie: "" }];
  const c = cookieString();
  if (c) list.push({ client: "WEB", cookie: c });
  return list;
}

async function available() {
  if (!config.youtubejs.enabled) return false;
  try {
    const yt = await getInnertube(cookieString());
    return Boolean(yt);
  } catch (error) {
    return false;
  }
}

async function resolveUrl(ytid) {
  const id = safeId(ytid);
  if (!id) throw Object.assign(new Error("Invalid clip id."), { status: 400, code: "invalid_id" });
  if (!config.youtubejs.enabled) throw Object.assign(new Error("YouTube.js disabled."), { status: 503, code: "youtubejs_disabled" });

  let lastError = null;
  for (const strategy of strategies()) {
    try {
      const yt = await getInnertube(strategy.cookie);
      const info = await yt.getInfo(id, { client: strategy.client });
      const format = info.chooseFormat({ type: "video+audio", quality: "best", format: "mp4" });
      const url = await format.decipher(info.actions.session.player);
      if (url) return url;
    } catch (error) {
      lastError = error;
    }
  }
  throw Object.assign(new Error((lastError && lastError.message) || "No downloadable stream was found for this clip."), {
    status: 422,
    code: "youtubejs_no_stream",
  });
}

function downloadHeaders(title) {
  const ytdlp = require("./ytdlp");
  return ytdlp.downloadHeaders(title);
}

async function stream(ytid, req, res, options = {}) {
  const id = safeId(ytid);
  if (!id) return false;
  if (!config.youtubejs.enabled) return false;

  let webStream = null;
  let lastError = null;
  for (const strategy of strategies()) {
    try {
      const yt = await getInnertube(strategy.cookie);
      const info = await yt.getInfo(id, { client: strategy.client });
      webStream = await info.download({ type: "video+audio", quality: "best", format: "mp4", client: strategy.client });
      if (webStream) break;
    } catch (error) {
      lastError = error;
      webStream = null;
    }
  }

  if (!webStream || typeof webStream.getReader !== "function") {
    logger.warn("YouTube.js download failed", {
      ytid: id,
      code: "youtubejs_failed",
      error: (lastError && lastError.message) || String(lastError || "no stream"),
    });
    if (!res.headersSent) return false;
    try { res.destroy(); } catch (_) {}
    return false;
  }

  try {
    res.writeHead(200, downloadHeaders(options.title));
  } catch (error) {
    logger.warn("YouTube.js download failed", { ytid: id, code: "youtubejs_failed", error: error.message });
    if (!res.headersSent) return false;
    try { res.destroy(); } catch (_) {}
    return false;
  }

  const { Readable } = require("stream");
  const nodeStream = Readable.fromWeb(webStream);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      req.removeListener("close", onClose);
      resolve(ok);
    };
    const onClose = () => {
      try { nodeStream.destroy(); } catch (_) {}
    };
    req.on("close", onClose);
    nodeStream.on("error", (error) => {
      logger.warn("YouTube.js download failed", {
        ytid: id,
        code: "youtubejs_failed",
        error: (error && error.message) || String(error),
      });
      try { res.destroy(); } catch (_) {}
      finish(false);
    });
    res.on("finish", () => finish(true));
    nodeStream.pipe(res);
  });
}

module.exports = {
  safeId,
  available,
  resolveUrl,
  stream,
};
