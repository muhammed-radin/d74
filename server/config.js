"use strict";

/* ------------------------------------------------------------------
   D74 Edits — central configuration
   Loads .env once and normalises every tunable the server needs.
------------------------------------------------------------------ */

const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(ROOT, ".env") });

const env = process.env;

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function csv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const DB_PROVIDER = String(env.DB_PROVIDER || "firebase").trim().toLowerCase();

/* Firebase credentials stay server-side. Accept the common service
   account shapes so deployments can use an inline JSON value, a mounted
   file, or the individual client_email/private_key variables. */
function readJsonFile(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.warn("[config] Could not read " + label + ":", error.message);
    return null;
  }
}

function parseFirebaseAccount() {
  const inline = String(env.FIREBASE_SERVICE_ACCOUNT || "").trim();
  if (inline) {
    try {
      const text = /^[A-Za-z0-9+/=]+$/.test(inline) && !inline.startsWith("{")
        ? Buffer.from(inline, "base64").toString("utf8")
        : inline;
      const parsed = JSON.parse(text);
      if (parsed && parsed.client_email && parsed.private_key) return parsed;
    } catch (error) {
      console.warn("[config] FIREBASE_SERVICE_ACCOUNT is not valid JSON:", error.message);
    }
  }

  const pathValue =
    env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    env.GOOGLE_APPLICATION_CREDENTIALS ||
    "";
  if (pathValue) {
    const file = path.isAbsolute(pathValue) ? pathValue : path.join(ROOT, pathValue);
    const parsed = readJsonFile(file, "Firebase service account");
    if (parsed && parsed.client_email && parsed.private_key) return parsed;
  }

  const clientEmail = String(env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKey = String(env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
  if (clientEmail && privateKey) {
    return {
      type: "service_account",
      project_id: String(env.FIREBASE_PROJECT_ID || "").trim(),
      client_email: clientEmail,
      private_key: privateKey,
    };
  }

  return null;
}

const firebaseAccount = parseFirebaseAccount();
const firebaseProjectId = String(
  (firebaseAccount && firebaseAccount.project_id) || env.FIREBASE_PROJECT_ID || ""
).trim();

/* AdSense identifiers are public, but they still have a fixed shape.
   Reject anything else so a typo cannot leak a malformed value into
   the page or the Content-Security-Policy. */
function adsenseClient(value) {
  const id = String(value || "").trim();
  return /^ca-pub-\d{10,20}$/.test(id) ? id : "";
}

function adsenseSlot(value) {
  const id = String(value || "").trim();
  return /^\d{5,20}$/.test(id) ? id : "";
}

const NODE_ENV = env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";
const IS_TEST = NODE_ENV === "test";

/* ---------------------------- channels ---------------------------- */

const FALLBACK_CHANNEL = "UCFodctpE1wtpFhWw716uCgg";

function normaliseChannel(entry, index) {
  if (!entry) return null;
  if (typeof entry === "string") {
    const id = entry.trim();
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return null;
    return { id, name: "Channel " + (index + 1) };
  }
  const id = String(entry.id || entry.channelId || entry.channel || "").trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return null;
  return {
    id,
    name: String(entry.name || entry.title || "Channel " + (index + 1)).slice(0, 80),
    uploadsPlaylistId: String(entry.uploadsPlaylistId || "").slice(0, 80) || undefined,
  };
}

function readChannelFile() {
  const file = path.join(ROOT, "server", "data", "youtube-channels.json");
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = Array.isArray(parsed) ? parsed : parsed.channels;
    return Array.isArray(list) ? list : [];
  } catch (error) {
    console.warn("[config] Could not read server/data/youtube-channels.json:", error.message);
    return [];
  }
}

function buildChannels() {
  const merged = [];
  const seen = new Set();

  const add = (entry) => {
    const channel = normaliseChannel(entry, merged.length);
    if (!channel || seen.has(channel.id)) return;
    seen.add(channel.id);
    merged.push(channel);
  };

  readChannelFile().forEach(add);

  const envChannels = csv(env.YOUTUBE_CHANNEL_IDS || env.YOUTUBE_CHANNEL_ID);
  envChannels.forEach((id, index) => add({ id, name: "YouTube " + (index + 1) }));

  if (!merged.length && !IS_TEST) add({ id: FALLBACK_CHANNEL, name: "D74 Edits" });

  return merged;
}

/* ------------------------- admin password -------------------------- */

function parsePasswordHash(value) {
  if (!value) return null;
  const parts = String(value).split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return null;
  if (!parts[1] || !parts[2]) return null;
  return { salt: parts[1], hash: parts[2] };
}

/* ---------------------------- required ----------------------------- */

const adminPasswordHash = parsePasswordHash(env.ADMIN_PASSWORD_HASH);
const sessionSecret = env.SESSION_SECRET || (IS_PROD ? "" : "d74-dev-only-" + require("crypto").randomBytes(16).toString("hex"));

const required = [
  ["SESSION_SECRET", Boolean(env.SESSION_SECRET)],
  ["RAPIDAPI_KEY", Boolean(env.RAPIDAPI_KEY)],
  ["ADMIN_PASSWORD or ADMIN_PASSWORD_HASH", Boolean(env.ADMIN_PASSWORD || adminPasswordHash)],
];
if (DB_PROVIDER === "restdb") {
  required.push(["RESTDB_API_KEY", Boolean(env.RESTDB_API_KEY)]);
}

const missing = required.filter(([, present]) => !present).map(([name]) => name);
if (missing.length && !IS_TEST) {
  const message =
    "\n⚠  Missing environment variables: " + missing.join(", ") +
    "\n   Copy .env.example to .env and fill them in.\n";
  if (IS_PROD) {
    console.error(message);
    process.exit(1);
  } else {
    console.warn(message);
  }
}

if (!adminPasswordHash && env.ADMIN_PASSWORD) {
  // The plaintext value never leaves this module; it is replaced by a
  // salted scrypt hash at boot and compared in constant time per login.
}

const adminSessionHours = Math.max(1, Math.min(168, num(env.ADMIN_SESSION_HOURS, 12)));
const adminIdleMinutes = Math.max(5, Math.min(adminSessionHours * 60, num(env.ADMIN_SESSION_IDLE_MINUTES, 45)));

function trustProxySetting(value) {
  if (value === undefined || value === null || value === "") return 0;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text);
  if (["1", "true", "yes", "on"].includes(text.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(text.toLowerCase())) return false;
  // Express also accepts "loopback" and subnet expressions.
  return text;
}

const config = {
  root: ROOT,
  env: NODE_ENV,
  isProd: IS_PROD,
  isTest: IS_TEST,
  port: num(env.PORT, 3005),
  trustProxy: trustProxySetting(env.TRUST_PROXY !== undefined ? env.TRUST_PROXY : env.TRUST_PROXY_HOPS),
  publicOrigin: String(env.PUBLIC_ORIGIN || "").replace(/\/+$/, ""),

  session: {
    secret: sessionSecret,
    cookieName: IS_PROD ? "__Host-d74.sid" : "d74.sid",
    idleMinutes: adminIdleMinutes,
    absoluteHours: adminSessionHours,
    rotateMinutes: Math.max(5, num(env.ADMIN_ROTATE_MINUTES, 30)),
    maxSessions: Math.max(1, num(env.ADMIN_MAX_SESSIONS, 5)),
    bindUserAgent: bool(env.ADMIN_BIND_USER_AGENT, true),
    bindIp: bool(env.ADMIN_BIND_IP, false),
    // The __Host- cookie prefix requires Secure, so production is always
    // forced on regardless of the environment file.
    secureCookie: IS_PROD ? true : bool(env.ADMIN_COOKIE_SECURE, false),
  },

  admin: {
    username: env.ADMIN_USERNAME || "admin",
    password: env.ADMIN_PASSWORD || "",
    passwordHash: adminPasswordHash,
    maxLoginAttempts: Math.max(3, num(env.ADMIN_MAX_LOGIN_ATTEMPTS, 5)),
    windowMinutes: Math.max(1, num(env.ADMIN_LOGIN_WINDOW_MINUTES, 15)),
  },

  /* AdSense IDs are public by design. Only a valid publisher id and
     numeric slot ids ever reach the browser. */
  adsense: {
    enabled: bool(env.ADSENSE_ENABLED, true),
    client: adsenseClient(env.ADSENSE_CLIENT),
    slots: {
      explore: adsenseSlot(env.ADSENSE_SLOT_EXPLORE),
      exploreInline: adsenseSlot(env.ADSENSE_SLOT_EXPLORE_INLINE),
      live: adsenseSlot(env.ADSENSE_SLOT_LIVE),
      liveSide: adsenseSlot(env.ADSENSE_SLOT_LIVE_SIDE),
    },
  },

  redis: {
    url: env.REDIS_URL || "",
    enabled: bool(env.REDIS_ENABLED, Boolean(env.REDIS_URL)),
    tls: bool(env.REDIS_TLS, false),
    connectTimeoutMs: Math.max(500, num(env.REDIS_CONNECT_TIMEOUT_MS, 3000)),
  },

  /* The self-ping only warms the local event loop; Render does not treat
     it as activity and will still sleep the free instance. Real keep-alive
     traffic must come from outside the service (see the GitHub workflow). */
  keepAlive: {
    self: bool(env.KEEP_ALIVE_SELF, false),
    intervalMs: Math.max(60000, num(env.KEEP_ALIVE_INTERVAL_MS, 600000)),
  },

  cache: {
    prefix: env.CACHE_PREFIX || "d74:",
    maxEntries: Math.max(100, num(env.CACHE_MAX_ENTRIES, 5000)),
    defaultTtl: Math.max(5, num(env.CACHE_DEFAULT_TTL, 60)),
    dbTtl: Math.max(5, num(env.DB_CACHE_TTL, 60)),
    dbStaleTtl: Math.max(0, num(env.DB_STALE_TTL, 300)),
    youtubeTtl: Math.max(30, num(env.YOUTUBE_CACHE_TTL, 900)),
    youtubeVideoTtl: Math.max(60, num(env.YOUTUBE_VIDEO_CACHE_TTL, 21600)),
    analyticsTtl: Math.max(60, num(env.ANALYTICS_CACHE_TTL, 86400)),
  },

  db: {
    provider: ["firebase", "local", "restdb"].includes(DB_PROVIDER) ? DB_PROVIDER : "firebase",
    baseUrl: String(env.RESTDB_BASE_URL || "").replace(/\/+$/, ""),
    apiKey: env.RESTDB_API_KEY || "",
    timeoutMs: Math.max(2000, num(env.DB_TIMEOUT_MS, 15000)),
    dailyLimit: Math.max(0, num(env.DB_DAILY_LIMIT, 0)),
    hardStop: bool(env.DB_QUOTA_HARD_STOP, false),
    pageSize: Math.max(50, Math.min(1000, num(env.DB_PAGE_SIZE, 1000))),
    allowlist: new Set(["account", "videos", "custom", "themes", "promotions", "channels", "jobs"]),
    localFile: String(env.LOCAL_DB_FILE || path.join(ROOT, "server", "data", "local-db.json")),
    firebase: {
      projectId: firebaseProjectId,
      account: firebaseAccount,
      collectionPrefix: String(env.FIREBASE_COLLECTION_PREFIX || "").replace(/[^A-Za-z0-9_-]/g, ""),
    },
  },

  bulk: {
    batchSize: Math.max(1, Math.min(50, num(env.BULK_BATCH_SIZE, 30))),
    dailyLimit: Math.max(1, Math.min(5000, num(env.BULK_DAILY_LIMIT, 300))),
    delayMinutes: Math.max(1, Math.min(1440, num(env.BULK_DELAY_MINUTES, 30))),
  },

  youtube: {
    host: env.YOUTUBE_RAPIDAPI_HOST || "youtube-v31.p.rapidapi.com",
    dailyLimit: Math.max(0, num(env.YT_DAILY_LIMIT, 500)),
    reserve: Math.max(0, num(env.YT_QUOTA_RESERVE, 20)),
    syncCron: env.YT_SYNC_CRON || "17 */6 * * *",
    syncTimezone: env.YT_SYNC_TIMEZONE || "UTC",
    syncEnabled: bool(env.YT_SYNC_ENABLED, true),
    syncOnStart: bool(env.YT_SYNC_ON_START, false),
    syncMaxNew: Math.max(1, Math.min(100, num(env.YT_SYNC_MAX_NEW, 25))),
    syncPages: Math.max(1, Math.min(10, num(env.YT_SYNC_PAGES, 1))),
    syncOverlapHours: Math.max(1, num(env.YT_SYNC_OVERLAP_HOURS, 48)),
    requestTimeoutMs: Math.max(3000, num(env.YT_TIMEOUT_MS, 15000)),
    channels: buildChannels(),
  },

  football: {
    host: env.FOOTBALL_RAPIDAPI_HOST || "free-football-soccer-videos.p.rapidapi.com",
    ttl: Math.max(30, num(env.FOOTBALL_CACHE_TTL, 120)),
  },

  /* Downloads are free: a clip with no direct link is fetched from
     YouTube with yt-dlp. The binary, format, cookies and extra arguments
     are all configurable so deployments can tune the extractor. */
  youtubejs: {
    enabled: bool(env.YOUTUBEJS_ENABLED, true),
  },

  ytdlp: {
    enabled: bool(env.YTDLP_ENABLED, true),
    path: String(env.YTDLP_PATH || "yt-dlp").trim() || "yt-dlp",
    cookies: String(env.YTDLP_COOKIES || "").trim(),
    format: String(env.YTDLP_FORMAT || "best[ext=mp4]/best").trim(),
    extractorArgs: String(env.YTDLP_EXTRACTOR_ARGS || "").trim(),
    extraArgs: String(env.YTDLP_EXTRA_ARGS || "").trim(),
    startTimeoutMs: Math.max(5000, num(env.YTDLP_START_TIMEOUT_MS, 45000)),
    infoTtlSeconds: Math.max(30, num(env.YTDLP_INFO_TTL, 300)),
  },

  analytics: {
    salt: env.ANALYTICS_SALT || sessionSecret,
    recentLimit: Math.max(20, num(env.ANALYTICS_RECENT_LIMIT, 250)),
    auditLimit: Math.max(20, num(env.ANALYTICS_AUDIT_LIMIT, 250)),
    minuteBuckets: 1440,
    hourBuckets: 720,
    dayBuckets: 120,
    tickMs: Math.max(5000, num(env.ANALYTICS_TICK_MS, 15000)),
  },

  cors: {
    origins: csv(env.CORS_ORIGINS),
  },

  logLevel: env.LOG_LEVEL || (IS_PROD ? "info" : "debug"),
  rateLimits: {
    globalWindowMs: Math.max(1000, num(env.RATE_LIMIT_WINDOW_MS, 60 * 1000)),
    globalMax: Math.max(20, num(env.RATE_LIMIT_MAX, 600)),
    apiMax: Math.max(10, num(env.API_RATE_LIMIT_MAX, 240)),
    loginMax: Math.max(3, num(env.LOGIN_RATE_LIMIT_MAX, 12)),
    adminLoginMax: Math.max(3, num(env.ADMIN_LOGIN_RATE_LIMIT_MAX, 6)),
    unlockMax: Math.max(3, num(env.UNLOCK_RATE_LIMIT_MAX, 25)),
    youtubeMax: Math.max(5, num(env.YOUTUBE_RATE_LIMIT_MAX, 60)),
    dbWriteMax: Math.max(5, num(env.DB_WRITE_RATE_LIMIT_MAX, 90)),
    downloadMax: Math.max(3, num(env.DOWNLOAD_RATE_LIMIT_MAX, 30)),
  },
};

module.exports = config;
