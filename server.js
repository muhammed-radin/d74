"use strict";

/**
 * D74 Edits — zero-dependency application server.
 *
 * Responsibilities:
 *   • Serve the static front-end.
 *   • Keep every private API credential on the server (.env).
 *   • Proxy the data layer, YouTube, football and admin APIs.
 *   • Add sane security headers and simple abuse protection.
 *
 * Run: node server.js
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/* ------------------------------------------------------------------ */
/*  Tiny .env loader (no external dependency)                          */
/* ------------------------------------------------------------------ */

function loadEnv(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (_) {
    /* .env is optional — production environments inject variables directly */
  }
}

loadEnv(path.join(__dirname, ".env"));

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === "production";

const REQUIRED =
  process.env.NODE_ENV === "test"
    ? []
    : ["RESTDB_API_KEY", "RAPIDAPI_KEY", "SESSION_SECRET", "ADMIN_PASSWORD"];

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length) {
  console.warn(
    "\n⚠  Missing environment variables: " +
      missing.join(", ") +
      "\n   Copy .env.example to .env and fill them in.\n"
  );
  if (IS_PROD) process.exit(1);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mpd": "application/dash+xml",
  ".m3u8": "application/vnd.apple.mpegurl",
};

function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()"
  );
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      // JW Player 8 evaluates player configuration internally, so it needs eval.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net https://ssl.p.jwpcdn.com http://ssl.p.jwpcdn.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: https:",
      "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
      "frame-src 'self' https:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join("; ")
  );
  if (IS_PROD) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJson(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (_) {
        reject(Object.assign(new Error("Invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

/* Allow the static front-end to call the API from a separate local dev
   server (Live Server, Codespaces, Gitpod). Production stays same-origin. */
function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin || IS_PROD) return false;

  let allowed = false;
  let wildcard = false;
  if (origin === "null") {
    allowed = true;
    wildcard = true;
  } else {
    try {
      const hostname = new URL(origin).hostname;
      allowed =
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname === "[::1]" ||
        hostname.endsWith(".app.github.dev") ||
        hostname.endsWith(".githubpreview.dev") ||
        hostname.endsWith(".gitpod.io");
    } catch (_) {
      return false;
    }
  }
  if (!allowed) return false;

  if (wildcard) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");
  res.setHeader("Access-Control-Max-Age", "600");
  return true;
}

/* Simple in-memory rate limiter. For multi-instance deployments use Redis. */
const buckets = new Map();
function rateLimit(req, { windowMs = 60000, max = 60, key = "" } = {}) {
  const bucketKey = key + ":" + clientIp(req);
  const now = Date.now();
  const entry = buckets.get(bucketKey) || { count: 0, reset: now + windowMs };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + windowMs;
  }
  entry.count += 1;
  buckets.set(bucketKey, entry);
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
  }
  return {
    allowed: entry.count <= max,
    remaining: Math.max(0, max - entry.count),
    reset: entry.reset,
  };
}

/* ------------------------------------------------------------------ */
/*  Sessions (HMAC-signed tokens, no external deps)                    */
/* ------------------------------------------------------------------ */

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signToken(payload, ttlSeconds) {
  const body = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = b64url(JSON.stringify(body));
  const sig = crypto
    .createHmac("sha256", process.env.SESSION_SECRET || "dev-secret")
    .update(encoded)
    .digest("base64url");
  return encoded + "." + sig;
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [encoded, sig] = token.split(".");
  const expected = crypto
    .createHmac("sha256", process.env.SESSION_SECRET || "dev-secret")
    .update(encoded)
    .digest("base64url");
  const a = Buffer.from(sig || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString());
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function bearer(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function requireAdmin(req, res) {
  const payload = verifyToken(bearer(req));
  if (!payload || payload.role !== "admin") {
    sendJson(res, 401, { error: "Admin authentication required." });
    return null;
  }
  return payload;
}

/* ------------------------------------------------------------------ */
/*  Password hashing                                                   */
/* ------------------------------------------------------------------ */

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, useSalt, 64).toString("hex");
  return { salt: useSalt, hash };
}

function verifyPassword(password, record) {
  if (!record.passwordHash || !record.salt) return false;
  const candidate = crypto.scryptSync(password, record.salt, 64);
  const stored = Buffer.from(record.passwordHash, "hex");
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

/* ------------------------------------------------------------------ */
/*  Upstream clients                                                   */
/* ------------------------------------------------------------------ */

async function upstream(url, options = {}, timeout = 15000) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = text;
  }
  return { status: response.status, data, headers: response.headers };
}

function restdbPath(pathAndQuery) {
  const base = (process.env.RESTDB_BASE_URL || "").replace(/\/+$/, "");
  if (!base) throw Object.assign(new Error("RESTDB_BASE_URL not set"), { status: 500 });
  return base + "/" + pathAndQuery.replace(/^\/+/, "");
}

async function restdb(method, pathAndQuery, body) {
  const headers = {
    "x-apikey": process.env.RESTDB_API_KEY || "",
    "cache-control": "no-cache",
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  return upstream(restdbPath(pathAndQuery), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function restdbQuery(filters) {
  return "?q=" + encodeURIComponent(JSON.stringify(filters));
}

/* ------------------------------------------------------------------ */
/*  API route handlers                                                 */
/* ------------------------------------------------------------------ */

const ACCOUNT_FIELDS = ["name", "email", "password", "passwordHash", "salt", "date", "location", "languages"];

function publicAccount(record) {
  if (!record || typeof record !== "object") return null;
  return {
    id: record._id || record.id,
    name: record.name || "Guest",
    email: record.email || "",
    date: record.date || "",
  };
}

async function handleSignup(req, res) {
  const limit = rateLimit(req, { windowMs: 10 * 60 * 1000, max: 10, key: "signup" });
  if (!limit.allowed) return sendJson(res, 429, { error: "Too many attempts. Try again later." });

  const body = await readJson(req);
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (name.length < 2 || name.length > 48)
    return sendJson(res, 400, { error: "Name must be 2–48 characters." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    return sendJson(res, 400, { error: "Please enter a valid email address." });
  if (password.length < 8)
    return sendJson(res, 400, { error: "Password must be at least 8 characters." });

  const existing = await restdb("GET", "account" + restdbQuery({ email }));
  if (existing.status >= 500) return sendJson(res, 502, { error: "Data service unavailable." });
  if (Array.isArray(existing.data) && existing.data.length)
    return sendJson(res, 409, { error: "An account with this email already exists." });

  const { salt, hash } = hashPassword(password);
  const record = {
    name,
    email,
    passwordHash: hash,
    salt,
    date: new Date().toISOString(),
    location: "server",
  };
  const created = await restdb("POST", "account", record);
  if (created.status >= 300)
    return sendJson(res, 502, { error: "Could not create the account." });

  return sendJson(res, 201, {
    user: publicAccount({ ...record, _id: created.data && created.data._id }),
  });
}

async function handleLogin(req, res) {
  const limit = rateLimit(req, { windowMs: 10 * 60 * 1000, max: 12, key: "login" });
  if (!limit.allowed) return sendJson(res, 429, { error: "Too many attempts. Try again later." });

  const body = await readJson(req);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) return sendJson(res, 400, { error: "Email and password are required." });

  const found = await restdb("GET", "account" + restdbQuery({ email }));
  if (found.status >= 500) return sendJson(res, 502, { error: "Data service unavailable." });
  const record = Array.isArray(found.data) ? found.data[0] : null;
  if (!record) return sendJson(res, 401, { error: "Invalid email or password." });

  let valid = verifyPassword(password, record);
  let upgraded = false;

  // Backwards compatibility with legacy plaintext records. Successful
  // logins are transparently upgraded to a salted scrypt hash.
  if (!valid && typeof record.password === "string" && record.password === password) {
    valid = true;
    const { salt, hash } = hashPassword(password);
    restdb("PUT", "account/" + encodeURIComponent(record._id), {
      passwordHash: hash,
      salt,
      password: "",
    }).catch(() => {});
    upgraded = true;
  }

  if (!valid) return sendJson(res, 401, { error: "Invalid email or password." });
  return sendJson(res, 200, { user: publicAccount(record), upgraded });
}

async function handleAdminLogin(req, res) {
  const limit = rateLimit(req, { windowMs: 15 * 60 * 1000, max: 8, key: "admin" });
  if (!limit.allowed) return sendJson(res, 429, { error: "Too many attempts. Try again later." });

  const body = await readJson(req);
  const username = String(body.username || "");
  const password = String(body.password || "");

  const expectedUser = process.env.ADMIN_USERNAME || "admin";
  const expectedPass = process.env.ADMIN_PASSWORD || "";
  const userOk = username.length === expectedUser.length &&
    crypto.timingSafeEqual(Buffer.from(username), Buffer.from(expectedUser));
  const passOk = password.length === expectedPass.length &&
    crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expectedPass));

  if (!expectedPass || !userOk || !passOk)
    return sendJson(res, 401, { error: "Invalid administrator credentials." });

  const hours = Number(process.env.ADMIN_SESSION_HOURS) || 12;
  return sendJson(res, 200, {
    token: signToken({ role: "admin", name: username }, hours * 3600),
    expiresIn: hours * 3600,
    name: username,
  });
}

const DB_ALLOWLIST = new Set(["account", "videos", "custom", "themes", "promotions"]);

function dbCollectionAllowed(pathAndQuery) {
  const collection = pathAndQuery.split("?")[0].split("/")[0];
  return DB_ALLOWLIST.has(collection);
}

async function handleDb(req, res, url) {
  const pathAndQuery = url.pathname.replace(/^\/api\/db\/?/, "");
  if (!pathAndQuery || !dbCollectionAllowed(pathAndQuery))
    return sendJson(res, 404, { error: "Unknown collection." });
  if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)?(\?.*)?$/.test(pathAndQuery))
    return sendJson(res, 400, { error: "Invalid data path." });

  const collection = pathAndQuery.split("?")[0].split("/")[0];
  const query = url.search || "";

  if (req.method === "GET") {
    const isPublic = collection === "videos" || collection === "promotions" || collection === "themes";
    const admin = verifyToken(bearer(req));
    if (!isPublic && !admin) return requireAdmin(req, res);
    const limit = rateLimit(req, { windowMs: 60000, max: 90, key: "db-get:" + collection });
    if (!limit.allowed) return sendJson(res, 429, { error: "Slow down." });
    const result = await restdb("GET", pathAndQuery + query);
    const data =
      collection === "videos" ? prepareVideoRecords(result.data, !admin) : result.data;
    return sendJson(res, result.status, data);
  }

  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const isAccountCreate = req.method === "POST" && collection === "account" && !pathAndQuery.includes("/");
    if (!isAccountCreate && !requireAdmin(req, res)) return;
    const body = req.method === "DELETE" ? undefined : await readJson(req);
    if (body && collection === "account") {
      for (const key of Object.keys(body)) {
        if (!ACCOUNT_FIELDS.includes(key)) delete body[key];
      }
    }
    const result = await restdb(req.method, pathAndQuery + query, body);
    return sendJson(res, result.status, result.data);
  }

  return sendJson(res, 405, { error: "Method not allowed." });
}

async function handleYoutubeVideos(req, res, url) {
  const id = String(url.searchParams.get("id") || "");
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id))
    return sendJson(res, 400, { error: "Invalid video id." });
  const limit = rateLimit(req, { windowMs: 60000, max: 60, key: "yt-videos" });
  if (!limit.allowed) return sendJson(res, 429, { error: "Slow down." });

  const target =
    "https://" +
    (process.env.YOUTUBE_RAPIDAPI_HOST || "youtube-v31.p.rapidapi.com") +
    "/videos?part=contentDetails%2Csnippet%2Cstatistics&id=" +
    encodeURIComponent(id);
  const result = await upstream(target, {
    headers: {
      "X-RapidAPI-Key": process.env.RAPIDAPI_KEY || "",
      "X-RapidAPI-Host": process.env.YOUTUBE_RAPIDAPI_HOST || "youtube-v31.p.rapidapi.com",
    },
  });
  return sendJson(res, result.status, result.data);
}

async function handleYoutubeSearch(req, res, url) {
  const limit = rateLimit(req, { windowMs: 60000, max: 40, key: "yt-search" });
  if (!limit.allowed) return sendJson(res, 429, { error: "Slow down." });
  const pageToken = url.searchParams.get("pageToken") || "";
  const channelId = process.env.YOUTUBE_CHANNEL_ID || "UCFodctpE1wtpFhWw716uCgg";
  let target =
    "https://" +
    (process.env.YOUTUBE_RAPIDAPI_HOST || "youtube-v31.p.rapidapi.com") +
    "/search?channelId=" +
    encodeURIComponent(channelId) +
    "&part=snippet%2Cid&order=date&maxResults=15";
  if (pageToken && /^[A-Za-z0-9_%=,-]{1,300}$/.test(pageToken)) {
    target += "&pageToken=" + encodeURIComponent(pageToken);
  }
  const result = await upstream(target, {
    headers: {
      "X-RapidAPI-Key": process.env.RAPIDAPI_KEY || "",
      "X-RapidAPI-Host": process.env.YOUTUBE_RAPIDAPI_HOST || "youtube-v31.p.rapidapi.com",
    },
  });
  return sendJson(res, result.status, result.data);
}

async function handleFootball(req, res) {
  const limit = rateLimit(req, { windowMs: 60000, max: 30, key: "football" });
  if (!limit.allowed) return sendJson(res, 429, { error: "Slow down." });
  const host = process.env.FOOTBALL_RAPIDAPI_HOST || "free-football-soccer-videos.p.rapidapi.com";
  const result = await upstream("https://" + host, {
    headers: {
      "x-rapidapi-key": process.env.RAPIDAPI_KEY || "",
      "x-rapidapi-host": host,
    },
  });
  return sendJson(res, result.status, result.data);
}

function prepareVideoRecords(data, stripSecrets) {
  const prepare = (record) => {
    if (!record || typeof record !== "object") return record;
    const clean = { ...record };
    const pageUrl = "https://youtube.com/watch?v=" + clean.ytid;
    clean.downloadable = Boolean(clean.url) && clean.url !== pageUrl;
    if (stripSecrets) {
      delete clean.pw;
      delete clean.url;
    }
    return clean;
  };
  if (Array.isArray(data)) return data.map(prepare);
  return prepare(data);
}

async function handleVideoUnlock(req, res) {
  const limit = rateLimit(req, { windowMs: 10 * 60 * 1000, max: 25, key: "unlock" });
  if (!limit.allowed) return sendJson(res, 429, { error: "Too many attempts. Try again later." });

  const body = await readJson(req);
  const id = String(body.id || body.ytid || "").trim();
  const password = String(body.password || "");
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id))
    return sendJson(res, 400, { error: "Invalid clip id." });
  if (!password) return sendJson(res, 400, { error: "Password is required." });

  const found = await restdb("GET", "videos" + restdbQuery({ ytid: id }));
  if (found.status >= 500) return sendJson(res, 502, { error: "Data service unavailable." });
  const record = Array.isArray(found.data) ? found.data[0] : null;
  if (!record) return sendJson(res, 404, { error: "This clip is not available for download." });

  const expected = String(record.pw || "");
  const supplied = password;
  let valid = false;
  if (expected && expected.length === supplied.length) {
    valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
  }
  if (!valid) return sendJson(res, 401, { error: "Incorrect download password." });

  if (!record.url) return sendJson(res, 404, { error: "No download link was provided for this clip." });
  if (record.url === "https://youtube.com/watch?v=" + record.ytid)
    return sendJson(res, 404, { error: "This clip is not available for download." });
  return sendJson(res, 200, { url: record.url });
}


/* ------------------------------------------------------------------ */
/*  Static files                                                       */
/* ------------------------------------------------------------------ */

const BLOCKED_SEGMENTS = new Set([
  "server",
  "node_modules",
  ".git",
  ".github",
  ".vscode",
  ".idea",
]);

const BLOCKED_FILES = new Set([
  "server.js",
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "procfile",
]);

function safeStaticPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch (_) {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const segments = decoded.split("/").filter(Boolean);
  for (const segment of segments) {
    if (BLOCKED_SEGMENTS.has(segment) || segment.startsWith(".")) return null;
  }
  if (segments.length && BLOCKED_FILES.has(segments[segments.length - 1].toLowerCase()))
    return null;
  let filePath = path.join(ROOT, decoded);
  const relative = path.relative(ROOT, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (!decoded.endsWith("/")) return { redirect: decoded + "/" };
      filePath = path.join(filePath, "index.html");
      if (!fs.existsSync(filePath)) return null;
    }
  } catch (_) {
    if (!path.extname(filePath)) {
      const withHtml = filePath + ".html";
      if (fs.existsSync(withHtml)) return { filePath: withHtml };
      const indexFile = path.join(filePath, "index.html");
      if (fs.existsSync(indexFile)) return { filePath: indexFile };
    }
    return null;
  }
  return { filePath };
}

function serveStatic(req, res, url) {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Method not allowed");
  }
  const resolved = safeStaticPath(url.pathname);
  if (!resolved) {
    const fallback = path.join(ROOT, "404", "index.html");
    if (fs.existsSync(fallback)) {
      const data = fs.readFileSync(fallback);
      res.writeHead(404, { "Content-Type": MIME[".html"] });
      return res.end(req.method === "HEAD" ? undefined : data);
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  if (resolved.redirect) {
    res.writeHead(308, { Location: resolved.redirect });
    return res.end();
  }

  const ext = path.extname(resolved.filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const isHtml = ext === ".html";
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": isHtml ? "no-cache" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(resolved.filePath)
    .on("error", () => {
      if (!res.headersSent) res.writeHead(500);
      res.end("Server error");
    })
    .pipe(res);
}

/* ------------------------------------------------------------------ */
/*  Channel data                                                       */
/* ------------------------------------------------------------------ */

function loadChannels() {
  const file = path.join(ROOT, "server", "data", "channels.json");
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return {};
  }
}

function prettyChannelName(id) {
  return id
    .replace(/_/g, " ")
    .replace(/\b([A-Z]{2,})\b/g, (m) => m)
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/*  Router                                                             */
/* ------------------------------------------------------------------ */

async function route(req, res) {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const pathname = url.pathname;

  securityHeaders(res);

  if (pathname.startsWith("/api/")) {
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    try {
      if (pathname === "/api/health")
        return sendJson(res, 200, { ok: true, uptime: process.uptime() });

      if (pathname === "/api/config" && req.method === "GET")
        return sendJson(res, 200, {
          siteName: "D74 Edits",
          jwplayerKey: process.env.JWPLAYER_KEY || "",
          youtubeChannel: "https://youtube.com/@d74edits67",
          theme: "dark",
        });

      if (pathname === "/api/channels" && req.method === "GET") {
        const channels = loadChannels();
        return sendJson(
          res,
          200,
          Object.keys(channels)
            .sort()
            .map((id) => ({ id, name: prettyChannelName(id) }))
        );
      }

      if (pathname.startsWith("/api/channels/") && req.method === "GET") {
        const id = decodeURIComponent(pathname.slice("/api/channels/".length));
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(id))
          return sendJson(res, 400, { error: "Invalid channel id." });
        const channels = loadChannels();
        if (!channels[id]) return sendJson(res, 404, { error: "Channel not found." });
        return sendJson(res, 200, { id, name: prettyChannelName(id), ...channels[id] });
      }

      if (pathname === "/api/auth/signup" && req.method === "POST")
        return await handleSignup(req, res);
      if (pathname === "/api/auth/login" && req.method === "POST")
        return await handleLogin(req, res);
      if (pathname === "/api/admin/login" && req.method === "POST")
        return await handleAdminLogin(req, res);

      if (pathname.startsWith("/api/db/")) return await handleDb(req, res, url);

      if (pathname === "/api/youtube/videos" && req.method === "GET")
        return await handleYoutubeVideos(req, res, url);
      if (pathname === "/api/youtube/search" && req.method === "GET")
        return await handleYoutubeSearch(req, res, url);
      if (pathname === "/api/football" && req.method === "GET")
        return await handleFootball(req, res);
      if (pathname === "/api/videos/unlock" && req.method === "POST")
        return await handleVideoUnlock(req, res);

      return sendJson(res, 404, { error: "Unknown API endpoint." });
    } catch (error) {
      const status = error.status || 502;
      if (!IS_PROD) console.error("[api]", req.method, pathname, error);
      return sendJson(res, status, {
        error:
          status >= 500
            ? "Upstream service unavailable. Please try again."
            : error.message,
      });
    }
  }

  return serveStatic(req, res, url);
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error("[fatal]", error);
    if (!res.headersSent) {
      securityHeaders(res);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end("Internal server error");
  });
});

server.listen(PORT, () => {
  console.log(`\n  D74 Edits — running at http://localhost:${PORT}`);
  console.log(`  Environment: ${process.env.NODE_ENV || "development"}\n`);
});

module.exports = server;
