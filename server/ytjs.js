"use strict";

const logger = require("./logger");
const config = require("./config");

const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

function safeId(value) {
  const id = String(value || "").trim();
  return VIDEO_ID.test(id) ? id : "";
}

let instancePromise = null;

function getInnertube() {
  if (!instancePromise) {
    instancePromise = (async () => {
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
      return Innertube.create();
    })().catch((error) => {
      instancePromise = null;
      throw error;
    });
  }
  return instancePromise;
}

async function available() {
  if (!config.youtubejs.enabled) return false;
  try {
    const yt = await getInnertube();
    return Boolean(yt);
  } catch (error) {
    return false;
  }
}

async function resolveUrl(ytid) {
  if (!config.youtubejs.enabled) throw Object.assign(new Error("YouTube.js disabled."), { status: 503, code: "youtubejs_disabled" });
  const id = safeId(ytid);
  if (!id) throw Object.assign(new Error("Invalid clip id."), { status: 400, code: "invalid_id" });
  const yt = await getInnertube();
  const info = await yt.getInfo(id, { client: "ANDROID" });
  const format = info.chooseFormat({ type: "video+audio", quality: "best", format: "mp4" });
  const url = await format.decipher(info.actions.session.player);
  if (!url) {
    throw Object.assign(new Error("No downloadable stream was found for this clip."), {
      status: 422,
      code: "youtubejs_no_stream",
    });
  }
  return url;
}

function downloadHeaders(title) {
  const ytdlp = require("./ytdlp");
  return ytdlp.downloadHeaders(title);
}

async function stream(ytid, req, res, options = {}) {
  if (!config.youtubejs.enabled) return false;
  const id = safeId(ytid);
  if (!id) return false;
  let webStream = null;
  try {
    const yt = await getInnertube();
    const info = await yt.getInfo(id, { client: "ANDROID" });
    webStream = await info.download({ type: "video+audio", quality: "best", format: "mp4", client: "ANDROID" });
  } catch (error) {
    logger.warn("YouTube.js download failed", {
      ytid: id,
      code: "youtubejs_failed",
      error: (error && error.message) || String(error),
    });
    if (!res.headersSent) return false;
    try {
      res.destroy();
    } catch (_) {}
    return false;
  }

  if (!webStream || typeof webStream.getReader !== "function") {
    logger.warn("YouTube.js download failed", { ytid: id, code: "youtubejs_no_stream" });
    if (!res.headersSent) return false;
    try {
      res.destroy();
    } catch (_) {}
    return false;
  }

  try {
    res.writeHead(200, downloadHeaders(options.title));
  } catch (error) {
    logger.warn("YouTube.js download failed", { ytid: id, code: "youtubejs_failed", error: error.message });
    if (!res.headersSent) return false;
    try {
      res.destroy();
    } catch (_) {}
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
      try {
        nodeStream.destroy();
      } catch (_) {}
    };
    req.on("close", onClose);
    nodeStream.on("error", (error) => {
      logger.warn("YouTube.js download failed", {
        ytid: id,
        code: "youtubejs_failed",
        error: (error && error.message) || String(error),
      });
      try {
        res.destroy();
      } catch (_) {}
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
