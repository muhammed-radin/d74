"use strict";

/* ------------------------------------------------------------------
   D74 Edits — free YouTube downloads through yt-dlp
   Clips whose database record has no direct link are resolved at
   request time with yt-dlp. The extracted media is streamed straight to
   the browser with an attachment header, so no signed URL is exposed
   and nothing is written to disk.

   Everything is optional/configurable:
     YTDLP_PATH             binary (default "yt-dlp")
     YTDLP_FORMAT           yt-dlp -f selector
     YTDLP_COOKIES          path to a Netscape cookies file
     YTDLP_EXTRACTOR_ARGS   e.g. "youtube:player_client=web"
     YTDLP_EXTRA_ARGS       extra arguments, split on whitespace
------------------------------------------------------------------ */

const { spawn } = require("child_process");
const fs = require("fs");
const config = require("./config");
const logger = require("./logger");
const ytjs = require("./ytjs");

const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;
const URL_LINE = /^https?:\/\/\S+$/i;
const MAX_STDERR = 16 * 1024;

let availability = { checkedAt: 0, ok: false, version: "", error: "" };
const infoCache = new Map();

function safeId(value) {
  const id = String(value || "").trim();
  return VIDEO_ID.test(id) ? id : "";
}

function watchUrl(id) {
  return "https://www.youtube.com/watch?v=" + encodeURIComponent(id);
}

function splitArgs(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  const found = text.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return found.map((part) => {
    if (
      (part.startsWith('"') && part.endsWith('"')) ||
      (part.startsWith("'") && part.endsWith("'"))
    ) {
      return part.slice(1, -1);
    }
    return part;
  });
}

function binary() {
  return config.ytdlp.path || "yt-dlp";
}

function cookiesFile() {
  const file = config.ytdlp.cookies;
  if (!file) return "";
  try {
    return fs.existsSync(file) ? file : "";
  } catch (_) {
    return "";
  }
}

function baseArgs() {
  const args = ["--no-playlist", "--no-warnings", "--no-progress", "--no-color"];
  const cookies = cookiesFile();
  if (cookies) args.push("--cookies", cookies);
  if (config.ytdlp.extractorArgs) args.push("--extractor-args", config.ytdlp.extractorArgs);
  args.push(...splitArgs(config.ytdlp.extraArgs));
  return args;
}

/* yt-dlp reports the useful reason on stderr. Turn the common cases into
   a stable code and a message an end user can act on. */
function describeFailure(stderr) {
  const text = String(stderr || "").toLowerCase();
  if (text.includes("sign in to confirm") || text.includes("not a bot")) {
    return {
      status: 502,
      code: "ytdlp_bot_check",
      message:
        "YouTube asked the server to verify it is not a bot. Ask the administrator to add a yt-dlp cookies file (YTDLP_COOKIES).",
    };
  }
  if (text.includes("private video") || text.includes("members-only")) {
    return { status: 403, code: "ytdlp_private", message: "This video is private and cannot be downloaded." };
  }
  if (text.includes("video unavailable") || text.includes("does not exist")) {
    return { status: 404, code: "ytdlp_unavailable", message: "This video is not available on YouTube." };
  }
  if (text.includes("requested format is not available")) {
    return {
      status: 422,
      code: "ytdlp_format",
      message: "No downloadable format was found for this clip.",
    };
  }
  if (text.includes("timed out") || text.includes("timeout")) {
    return { status: 504, code: "ytdlp_timeout", message: "YouTube took too long to respond. Try again." };
  }
  return {
    status: 502,
    code: "ytdlp_failed",
    message: "The download service could not fetch this clip right now.",
  };
}

function failureFrom(stderr) {
  const detail = describeFailure(stderr);
  return Object.assign(new Error(detail.message), detail);
}

function cacheGet(id) {
  const entry = infoCache.get(id);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    infoCache.delete(id);
    return null;
  }
  return entry;
}

function cacheSet(id, url) {
  infoCache.set(id, {
    url,
    expiresAt: Date.now() + config.ytdlp.infoTtlSeconds * 1000,
  });
  if (infoCache.size > 200) {
    const oldest = infoCache.keys().next().value;
    if (oldest) infoCache.delete(oldest);
  }
}

function available() {
  if (!config.ytdlp.enabled) {
    return Promise.resolve({ ok: false, version: "", error: "yt-dlp downloads are disabled." });
  }
  if (Date.now() - availability.checkedAt < 60000) {
    return Promise.resolve(availability);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      availability = { checkedAt: Date.now(), ...result };
      resolve(availability);
    };
    let child;
    try {
      child = spawn(binary(), ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      finish({ ok: false, version: "", error: error.message });
      return;
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch (_) {}
      finish({ ok: false, version: "", error: "yt-dlp did not respond." });
    }, 5000);
    child.stdout.on("data", (chunk) => {
      out += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      err += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({
        ok: false,
        version: "",
        error:
          error && error.code === "ENOENT"
            ? "yt-dlp is not installed on the server."
            : (error && error.message) || "yt-dlp is not available.",
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const version = out.trim().split("\n")[0] || "";
      finish({
        ok: code === 0 && Boolean(version),
        version,
        error: code === 0 ? "" : err.trim().slice(0, 300) || "yt-dlp exited with code " + code,
      });
    });
  });
}

function run(args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binary(), args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(Object.assign(new Error("yt-dlp could not be started."), {
        status: 503,
        code: "ytdlp_unavailable",
      }));
      return;
    }
    let out = "";
    let err = "";
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch (_) {}
      finish(Object.assign(new Error("YouTube took too long to respond."), {
        status: 504,
        code: "ytdlp_timeout",
      }));
    }, Math.max(5000, timeoutMs));
    child.stdout.on("data", (chunk) => {
      out += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      if (err.length < MAX_STDERR) err += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      const missing = error && error.code === "ENOENT";
      finish(
        Object.assign(new Error(missing ? "yt-dlp is not installed on the server." : "yt-dlp could not be started."), {
          status: 503,
          code: "ytdlp_unavailable",
          cause: error,
        })
      );
    });
    child.on("close", (code) => {
      if (code === 0) finish(null, { stdout: out, stderr: err });
      else finish(failureFrom(err));
    });
  });
}

/* Resolve a playable/downloadable media URL. Cached briefly because the
   signed URLs expire, but long enough to avoid spawning yt-dlp twice for
   the same click. */
async function resolveUrl(ytid) {
  const id = safeId(ytid);
  if (!id) {
    throw Object.assign(new Error("Invalid clip id."), { status: 400, code: "invalid_id" });
  }
  const cached = cacheGet(id);
  if (cached) return cached.url;

  try {
    const url = await ytjs.resolveUrl(id);
    if (url) {
      cacheSet(id, url);
      return url;
    }
  } catch (error) {
    logger.warn("YouTube.js resolve failed", {
      ytid: id,
      code: "youtubejs_failed",
      error: (error && error.message) || String(error),
    });
  }

  if (!config.ytdlp.enabled) {
    throw Object.assign(new Error("Downloads are disabled on this server."), {
      status: 503,
      code: "ytdlp_disabled",
    });
  }

  const result = await run([...baseArgs(), "-f", config.ytdlp.format, "--get-url", watchUrl(id)]);
  const url = String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => URL_LINE.test(line));
  if (!url) {
    throw Object.assign(new Error("No downloadable stream was found for this clip."), {
      status: 422,
      code: "ytdlp_no_stream",
    });
  }
  cacheSet(id, url);
  return url;
}

function disposition(filename) {
  const fallback = String(filename || "d74-clip.mp4")
    .replace(/[^\w\-. ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || "d74-clip";
  const name = fallback.toLowerCase().endsWith(".mp4") ? fallback : fallback + ".mp4";
  const encoded = encodeURIComponent(name);
  return 'attachment; filename="' + name.replace(/"/g, "") + '"; filename*=UTF-8\'\'' + encoded;
}

function downloadHeaders(title) {
  return {
    "Content-Type": "video/mp4",
    "Content-Disposition": disposition(title),
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  };
}

/* Stream the clip through the server. Browsers always receive an
   attachment, so a click saves a file instead of opening the YouTube
   player. Resolves when the response is finished or has failed. */
function streamYtdlp(ytid, req, res, options = {}) {
  return new Promise((resolve) => {
    const id = safeId(ytid);
    if (!id) {
      res.status(400).json({ error: "Invalid clip id.", code: "invalid_id" });
      resolve();
      return;
    }
    if (!config.ytdlp.enabled) {
      res.status(503).json({ error: "Downloads are disabled on this server.", code: "ytdlp_disabled" });
      resolve();
      return;
    }

    const args = [
      ...baseArgs(),
      "-f",
      config.ytdlp.format,
      "-o",
      "-",
      watchUrl(id),
    ];

    let child;
    try {
      child = spawn(binary(), args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      res.status(503).json({ error: "yt-dlp is not available on the server.", code: "ytdlp_unavailable" });
      resolve();
      return;
    }

    let started = false;
    let stderr = "";
    let settled = false;

    const cleanup = () => {
      clearTimeout(startTimer);
      req.removeListener("close", onClose);
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!res.headersSent) {
        const detail = error && error.code ? error : describeFailure(stderr);
        res.status(detail.status || 502).json({ error: detail.message, code: detail.code || "ytdlp_failed" });
      } else {
        try {
          res.destroy();
        } catch (_) {}
      }
      logger.warn("yt-dlp download failed", {
        ytid: id,
        code: (error && error.code) || "ytdlp_failed",
        error: (error && error.message) || String(stderr).slice(0, 300),
      });
      resolve();
    };

    const onClose = () => {
      if (!started) return;
      try {
        child.kill("SIGKILL");
      } catch (_) {}
    };
    req.on("close", onClose);

    const startTimer = setTimeout(() => {
      if (started) return;
      try {
        child.kill("SIGKILL");
      } catch (_) {}
      fail(Object.assign(new Error("YouTube took too long to start the download."), {
        status: 504,
        code: "ytdlp_timeout",
      }));
    }, config.ytdlp.startTimeoutMs);

    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_STDERR) stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      fail(
        Object.assign(new Error(error && error.code === "ENOENT"
          ? "yt-dlp is not installed on the server."
          : "yt-dlp could not be started."), {
          status: 503,
          code: "ytdlp_unavailable",
        })
      );
    });

    child.stdout.once("data", (chunk) => {
      if (settled) return;
      started = true;
      clearTimeout(startTimer);
      res.writeHead(200, downloadHeaders(options.title));
      res.write(chunk);
      child.stdout.pipe(res);
    });

    child.on("close", (code) => {
      if (!started) {
        if (code === 0) {
          fail(Object.assign(new Error("yt-dlp returned no data."), {
            status: 502,
            code: "ytdlp_empty",
          }));
        } else {
          fail(failureFrom(stderr));
        }
        return;
      }
      finish();
    });
  });
}

/* Quick metadata probe. Used by the viewer to decide whether the
   download button should be enabled. */
async function probe(ytid) {
  const id = safeId(ytid);
  if (!id) return { ok: false, code: "invalid_id" };
  const jsOk = await ytjs.available();
  if (jsOk) return { ok: true, version: "youtube.js", provider: "youtubejs" };
  if (!config.ytdlp.enabled) return { ok: false, code: "ytdlp_disabled" };
  const state = await available();
  if (!state.ok) {
    return { ok: false, code: "ytdlp_unavailable", message: state.error || "yt-dlp is not installed." };
  }
  return { ok: true, version: state.version, provider: "ytdlp" };
}

function stream(ytid, req, res, options = {}) {
  const id = safeId(ytid);
  if (!id) {
    res.status(400).json({ error: "Invalid clip id.", code: "invalid_id" });
    return Promise.resolve();
  }

  return (async () => {
    const jsOk = await ytjs.stream(id, req, res, options);
    if (jsOk) return;
    if (res.headersSent) return;

    if (!config.ytdlp.enabled) {
      res.status(503).json({ error: "Downloads are disabled on this server.", code: "ytdlp_disabled" });
      return;
    }

    const fallbackOk = await new Promise((resolve) => {
      // delegate to original yt-dlp implementation
      streamYtdlp(id, req, res, options).then(() => resolve(true)).catch(() => resolve(false));
    });
    if (!fallbackOk && !res.headersSent) {
      res.status(502).json({ error: "The download service could not fetch this clip right now.", code: "ytdlp_failed" });
    }
  })();
}

module.exports = {
  VIDEO_ID,
  safeId,
  watchUrl,
  available,
  probe,
  resolveUrl,
  stream,
  describeFailure,
  downloadHeaders,
};
