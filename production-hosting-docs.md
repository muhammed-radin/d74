# D74 Edits — Production Hosting Guide

D74 Edits is a free football clip and live TV site. It combines a public clip library,
search, a live channel browser, an embedded player, optional accounts and free downloads.
The front end is plain HTML, CSS and JavaScript served by an Express server. Firestore stores
the records, Redis can cache them, and `yt-dlp` resolves downloads when a record has no direct
file link.

This guide explains how to run the project on **Render**, including the free tier, every
environment variable, where to get each value, and the external keep-alive that stops a free
web service from sleeping.

> The current production URL is assumed to be `https://d74.onrender.com`. Replace it with your
> own Render URL or custom domain everywhere in this guide if yours is different.

---

## 1. What you are deploying

| Layer | Technology | Purpose |
| --- | --- | --- |
| Web server | Node.js 18+ / Express 4 | Serves pages, API routes, downloads and admin tools |
| Front end | HTML + CSS + vanilla JS | Landing page, Explore, Search, Live TV, viewer, settings, auth, admin |
| Database | Google Firebase Firestore (server-side REST) | Clips, channels, accounts, themes, promotions, bulk-job state |
| Cache / sessions | Redis (optional) or in-memory | Read cache, rate counters, admin session store |
| YouTube data | RapidAPI YouTube v3 | Channel uploads and metadata for the cron and bulk sync |
| Downloads | `yt-dlp` (+ optional `ffmpeg`) | Free download fallback when no direct URL exists |
| Ads | Google AdSense (optional) | Monetisation; D74 house ads appear when unset |
| Hosting | Render Web Service | HTTPS, process supervision, deploy from GitHub |

Key routes after deployment:

- `/` — landing page
- `/explore/` — clip feed
- `/search/` — search
- `/livestreams/` — live TV browser
- `/visit/?id=YOUTUBE_ID` — clip detail, player and free download
- `/privacy/` and `/terms/` — legal pages
- `/Admin/` — administrator area (login required)
- `/api/health` — lightweight health check (used by Render and keep-alive)
- `/api/config` — public feature flags and AdSense identifiers

The repository already includes `.env.example`, `render.yaml`, `robots.txt`, `sitemap.xml`,
`ads.txt` and `.github/workflows/keep-alive.yml`.

---

## 2. Before you start

You need:

1. A **GitHub account** with this repository pushed to it.
2. A **Render account** — <https://render.com>. The free plan is enough to start.
3. A **Firebase project** with Firestore enabled — <https://console.firebase.google.com>.
4. A **RapidAPI account** subscribed to a YouTube v3 API — <https://rapidapi.com>.
5. Optional: a **Redis-compatible** instance (Render Key Value, Upstash, Redis Cloud).
6. Optional: an **AdSense** account and an approved site.
7. Optional: a **YouTube cookies file** if `yt-dlp` hits bot checks from Render's IP ranges.

You do **not** need a paid Render plan, a custom domain, or a credit card for the basic free
setup. Some optional services (managed Redis, a persistent disk) may require a paid plan.

---

## 3. Deploy on Render

### Option A — Dashboard (recommended for the first deploy)

1. Push the repository to GitHub.
2. In Render, choose **New → Web Service** and connect the repository.
3. Use these settings:

   | Setting | Value |
   | --- | --- |
   | Name | `d74` (this becomes `d74.onrender.com`) |
   | Region | Closest to your users |
   | Branch | `main` (or your production branch) |
   | Runtime | `Node` |
   | Build command | see below |
   | Start command | `npm start` |
   | Health check path | `/api/health` |
   | Plan | `Free` |

4. Build command:

   ```bash
   npm ci && mkdir -p bin && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o bin/yt-dlp && chmod +x bin/yt-dlp
   ```

   This installs dependencies and downloads the standalone Linux `yt-dlp` binary into
   `bin/yt-dlp`. It does not need Python on the server. If you prefer pip and your Render
   image has Python, `npm ci && pip install --user -U yt-dlp` also works; then set
   `YTDLP_PATH=/opt/render/.local/bin/yt-dlp`.

5. Add the environment variables from section 4. At minimum:

   ```text
   NODE_ENV=production
   NODE_VERSION=22
   TRUST_PROXY=1
   PUBLIC_ORIGIN=https://d74.onrender.com
   SESSION_SECRET=<generated>
   RAPIDAPI_KEY=<your key>
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD_HASH=<generated hash>
   FIREBASE_PROJECT_ID=<your project id>
   FIREBASE_SERVICE_ACCOUNT_PATH=/etc/secrets/firebase-service-account.json
   YTDLP_PATH=bin/yt-dlp
   YTDLP_ENABLED=true
   ```

6. Add secret files (Render dashboard → your service → **Environment → Secret Files**):
   - `firebase-service-account.json` — the service-account JSON from Firebase.
   - Optional `yt-dlp-cookies.txt` — a Netscape-format cookies file.

   Render mounts secret files under `/etc/secrets/<filename>` for Linux services. The path
   above matches the Firebase filename.

7. Deploy. The first build can take a few minutes. A free instance may take 30–60 seconds
   to wake after sleeping.

8. Open `/api/health`. A healthy service returns JSON similar to:

   ```json
   {"ok":true,"uptime":42,"version":"2.0.0","cache":{"driver":"redis","redis":true},"timestamp":"..."}
   ```

9. Sign in at `/Admin/` with `ADMIN_USERNAME` and the password whose hash you set.

### Option B — Blueprint (`render.yaml`)

The repository includes a `render.yaml` blueprint. In Render choose **New → Blueprint**,
connect the repository, and apply it. The blueprint creates a free Node web service with the
build command, start command, health check and the non-secret environment variables.

Values marked `sync: false` are not stored in git. Render asks for them during setup. Add the
Firebase service-account file and any cookies file as **Secret Files** afterwards.

> If you change the service name, update `PUBLIC_ORIGIN`, the keep-alive URL and the canonical
> links in `privacy/index.html` and `terms/index.html`.

### Render free-tier facts

- **512 MB RAM**, shared CPU, one instance.
- **No persistent disk.** The filesystem is ephemeral; never store uploads, cookies or the
  database in the repository folder. Firestore and Render Secret Files are the durable stores.
- **Sleeps after 15 minutes without external HTTP traffic.** See section 6.
- **750 instance hours per month** — enough for one always-on free service in a 30/31-day month.
- A cold start takes roughly 30–60 seconds, sometimes longer after a deploy.

---

## 4. Environment variables

Copy `.env.example` for local development. On Render, add variables in the dashboard
(**Environment → Environment Variables**) or in `render.yaml`.

Legend: **R** = required in production, **S** = strongly recommended, **O** = optional.

### 4.1 Core

| Variable | Use | Example | Where it comes from |
| --- | --- | --- | --- |
| `NODE_ENV` | **R.** Enables production mode: secure cookies, HSTS, hidden internal errors, fail-fast checks. | `production` | Set manually. |
| `PORT` | Port the server listens on. Render injects this automatically; do not hard-code it. | `10000` | Render. Locally `3005`. |
| `NODE_VERSION` | Pins the Node runtime used by Render. | `22` | Set manually. Node 18+ is required. |
| `PUBLIC_ORIGIN` | **S.** Canonical public origin used for links and logs. | `https://d74.onrender.com` | Your Render URL or custom domain. |
| `TRUST_PROXY` | **R on Render.** Trust one proxy hop so client IPs and HTTPS are detected correctly. | `1` | Set manually. Without it, rate limits and secure cookies can misbehave. |
| `CORS_ORIGINS` | Only needed if a separate front end calls the API. Comma-separated origins. | `https://app.example.com` | Leave blank for the bundled site. |
| `SESSION_SECRET` | **R.** Signs cookies and salts analytics. Use 32+ random bytes and keep it stable. | `4f9c…` | Generate: `openssl rand -hex 32` or `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `LOG_LEVEL` | O. `debug`, `info`, `warn` or `error`. | `info` | Set manually. |

### 4.2 Firebase / Firestore

| Variable | Use | Example | Where it comes from |
| --- | --- | --- | --- |
| `DB_PROVIDER` | **R.** `firebase` for production; `local` only for development; `restdb` is legacy. | `firebase` | Set manually. |
| `FIREBASE_PROJECT_ID` | **S.** The Firebase project that contains Firestore. | `d74-edits` | Firebase console → Project settings → General → Project ID. |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | **R.** Path to the mounted service-account JSON. Preferred on Render. | `/etc/secrets/firebase-service-account.json` | Upload the JSON as a Render Secret File. |
| `FIREBASE_SERVICE_ACCOUNT` | Alternative to the file: inline JSON or base64-encoded JSON. | `{"type":"service_account",…}` | Firebase service-account JSON. Keep it secret. |
| `FIREBASE_CLIENT_EMAIL` | Alternative split layout. | `firebase-adminsdk-…@project.iam.gserviceaccount.com` | Service-account JSON. |
| `FIREBASE_PRIVATE_KEY` | Alternative split layout. Keep `\n` escapes. | `"-----BEGIN PRIVATE KEY-----\n…"` | Service-account JSON. |
| `FIREBASE_COLLECTION_PREFIX` | O. Prefix collections for staging vs production in one project. | `staging_` | Choose a short alphanumeric value. |
| `LOCAL_DB_FILE` | Development only. Path for the JSON fallback. | `server/data/local-db.json` | Ignored in production. |

**How to create the Firebase credentials**

1. Open <https://console.firebase.google.com>, create a project and enable **Firestore**
   in Native mode.
2. Go to **Project settings → Service accounts → Generate new private key**. A JSON file
   downloads.
3. In Google Cloud **IAM & Admin → IAM**, give the service account the **Cloud Datastore User**
   role (`roles/datastore.user`) for that project. The Firebase Admin SDK role also works, but
   is broader than needed.
4. Upload the JSON to Render as the secret file above. Never commit it.
5. If you use the inline form, keep the entire JSON on one line and escape newlines in the
   private key. The file-based form is easier to rotate.

Firestore collections used by the app: `videos`, `channels`, `account`, `themes`, `custom`,
`promotions` and `jobs`. The server is the only client; Firestore security rules can deny all
direct browser access.

The Firebase **Spark** plan includes a daily read/write quota. D74 caches reads and coalesces
bursts, but a busy site should use the Blaze plan with a budget alert.

### 4.3 RapidAPI / YouTube

| Variable | Use | Example | Where it comes from |
| --- | --- | --- | --- |
| `RAPIDAPI_KEY` | **R.** Server-side key for YouTube and football metadata. | `abc123…` | RapidAPI dashboard → your app → **Security → X-RapidAPI-Key**. |
| `YOUTUBE_RAPIDAPI_HOST` | Host for the YouTube API. | `youtube-v31.p.rapidapi.com` | The YouTube v3 listing on RapidAPI. |
| `FOOTBALL_RAPIDAPI_HOST` | Host for the football video API. | `free-football-soccer-videos.p.rapidapi.com` | The football listing on RapidAPI. |
| `YOUTUBE_CHANNEL_ID` | **R** for the default feed. One channel ID. | `UCFodctpE1wtpFhWw716uCgg` | YouTube channel → Share → Copy channel ID, or the channel URL. |
| `YOUTUBE_CHANNEL_IDS` | O. Comma-separated list; overrides/supplements the single ID. | `UC…,UC…` | Same as above. |

**How to get the RapidAPI key**

1. Create a RapidAPI account.
2. Subscribe to **YouTube v3** (`youtube-v31.p.rapidapi.com`) and, if you use the football
   rail, **Free Football Soccer Videos**.
3. Open the endpoint page, choose a plan (the free plan is fine for a small site) and copy the
   `X-RapidAPI-Key` value into `RAPIDAPI_KEY`.

RapidAPI and YouTube quotas are enforced by `YT_DAILY_LIMIT` and `YT_QUOTA_RESERVE`; the cron
sync pauses before the daily reserve is exhausted.

### 4.4 Admin and sessions

| Variable | Use | Example | Where it comes from |
| --- | --- | --- | --- |
| `ADMIN_USERNAME` | **R.** Administrator login name. | `admin` | Choose a non-obvious name. |
| `ADMIN_PASSWORD` | Plain password. Simpler, but the hash is preferred in production. | `long-random-password` | Generate a unique password. |
| `ADMIN_PASSWORD_HASH` | **R** (instead of the plain password). scrypt hash. | `scrypt$salt$hash` | Generate with the command below. |
| `ADMIN_SESSION_HOURS` | Absolute session lifetime. | `12` | Choose. |
| `ADMIN_SESSION_IDLE_MINUTES` | Idle timeout. | `45` | Choose. |
| `ADMIN_MAX_SESSIONS` | Maximum concurrent admin sessions. | `5` | Choose. |
| `ADMIN_ROTATE_MINUTES` | How often the CSRF token rotates. | `30` | Choose. |
| `ADMIN_BIND_USER_AGENT` | Bind a session to the browser user agent. | `true` | Keep `true` unless it causes problems. |
| `ADMIN_BIND_IP` | Bind a session to an IP. Off by default because mobile IPs change. | `false` | Choose. |
| `ADMIN_MAX_LOGIN_ATTEMPTS` | Failed login attempts before a cooldown. | `5` | Choose. |
| `ADMIN_LOGIN_WINDOW_MINUTES` | Window for the attempt counter. | `15` | Choose. |
| `ADMIN_COOKIE_SECURE` | Development only; production is always forced secure. | `true` | Leave unset in production. |

Generate the admin hash locally, then paste only the hash into Render:

```bash
node -e "const a=require('./server/auth');const h=a.hashPassword(process.argv[1]);console.log('scrypt$'+h.salt+'$'+h.hash)" 'your-strong-password'
```

Generate a strong password with `openssl rand -base64 24`. If both `ADMIN_PASSWORD` and
`ADMIN_PASSWORD_HASH` are set, the hash is the value to trust; remove the plain password after
you have confirmed the hash works.

### 4.5 Redis and cache

| Variable | Use | Example | Where it comes from |
| --- | --- | --- | --- |
| `REDIS_URL` | **S.** Enables Redis for cache and admin sessions. | `redis://default:pass@host:6379` | Render Key Value, Upstash, Redis Cloud, or a VPS. Use `rediss://` for TLS if required. |
| `REDIS_ENABLED` | Turn Redis on/off explicitly. | `true` | Defaults to true when `REDIS_URL` is set. |
| `REDIS_TLS` | Force TLS when the URL scheme does not already imply it. | `true` | Provider instructions. |
| `REDIS_CONNECT_TIMEOUT_MS` | Connection timeout. | `3000` | Choose. |
| `CACHE_PREFIX` | Key prefix; useful when sharing one Redis database. | `d74:` | Choose. |
| `CACHE_MAX_ENTRIES` | In-memory cache bound when Redis is unavailable. | `5000` | Choose. |
| `DB_CACHE_TTL` | Database read cache in seconds. | `60` | Tune. |
| `DB_STALE_TTL` | Serve stale data while revalidating, in seconds. | `300` | Tune. |
| `YOUTUBE_CACHE_TTL` | YouTube API cache in seconds. | `900` | Tune. |
| `YOUTUBE_VIDEO_CACHE_TTL` | Per-video cache in seconds. | `21600` | Tune. |
| `FOOTBALL_CACHE_TTL` | Football feed cache. | `120` | Tune. |

Without Redis, the server logs:

```text
Cache driver: memory
Admin session store: memory
```

That still works for one instance, but admin sessions are lost on restart and each deploy.
With `REDIS_URL`, the startup log should say `Cache driver: Redis` and
`Admin session store: redis`. Check `/api/health` for `"cache":{"driver":"redis"}`.

Render Key Value: create a Key Value instance, copy its **internal connection string** into
`REDIS_URL`, and keep the service in the same region. Upstash works too; use the TLS URL it
provides.

### 4.6 Free downloads (`yt-dlp`)

| Variable | Use | Example | Where it comes from |
| --- | --- | --- | --- |
| `YTDLP_ENABLED` | Enable/disable the fallback. | `true` | Set manually. |
| `YTDLP_PATH` | Binary name or path. On Render with the provided build command: `bin/yt-dlp`. | `bin/yt-dlp` | The downloaded standalone binary. |
| `YTDLP_COOKIES` | Netscape cookies file used when YouTube asks to “confirm you’re not a bot”. | `/etc/secrets/yt-dlp-cookies.txt` | Export from a browser with a cookies.txt extension. |
| `YTDLP_FORMAT` | Format selector. A single progressive MP4 avoids `ffmpeg` merging. | `best[ext=mp4]/best` | Choose a yt-dlp format expression. |
| `YTDLP_EXTRACTOR_ARGS` | Extra extractor arguments. | `youtube:player_client=web` | yt-dlp documentation; use only if needed. |
| `YTDLP_EXTRA_ARGS` | Additional arguments, whitespace separated. | `--no-check-certificates` | Use sparingly. |
| `YTDLP_START_TIMEOUT_MS` | Time allowed before the first byte. | `45000` | Increase on slow networks. |
| `YTDLP_INFO_TTL` | Cache lifetime for resolved media URLs, seconds. | `300` | Choose. |
| `DOWNLOAD_RATE_LIMIT_MAX` | Download requests per 10 minutes per address. | `30` | Tune to your traffic. |

**Install `yt-dlp` on Render**

The build command in section 3 downloads the standalone Linux binary:

```bash
mkdir -p bin
curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
  -o bin/yt-dlp
chmod +x bin/yt-dlp
```

Then set `YTDLP_PATH=bin/yt-dlp`. The binary is re-downloaded on every deploy, so it stays
current. The standalone build needs no Python and no system packages.

If you use pip instead (only if the runtime has Python 3):

```bash
npm ci && pip install --user -U yt-dlp
# then set YTDLP_PATH=/opt/render/.local/bin/yt-dlp
```

**Bot checks and cookies**

YouTube often treats datacenter IPs as suspicious. When that happens, `/api/health` stays
green but a download returns `ytdlp_bot_check` with a message asking for cookies. To fix it:

1. Sign in to a **dedicated** YouTube account in a browser (not your main account).
2. Export a Netscape-format `cookies.txt` file with a reputable extension.
3. In Render, add it as a secret file named `yt-dlp-cookies.txt`.
4. Set `YTDLP_COOKIES=/etc/secrets/yt-dlp-cookies.txt`.
5. Redeploy or restart. Cookies expire; replace them when downloads start failing again.

Cookies are sensitive. Treat the file like a password, never commit it, and rotate it if it
leaks.

**`ffmpeg`**

The default format is a single progressive MP4 and needs no `ffmpeg`. If you set a merged
format such as `bestvideo+bestaudio`, you must install a static `ffmpeg` binary and point
`YTDLP_EXTRA_ARGS` at it, or use a custom Docker image. On the free tier, keeping the default
format is simpler and uses less memory.

**Copyright**

Only offer downloads for content you are allowed to distribute, and respond to takedown
requests. The legal pages explain personal-use expectations, but they do not grant rights to
third-party clips.

### 4.7 AdSense

| Variable | Use | Example | Where it comes from |
| --- | --- | --- | --- |
| `ADSENSE_ENABLED` | Turn ad slots on/off. | `true` | Set manually. |
| `ADSENSE_CLIENT` | Publisher ID. | `ca-pub-1234567890123456` | AdSense → Account → Settings → Account information. |
| `ADSENSE_SLOT_EXPLORE` | Explore rail slot. | `1234567890` | AdSense → Ads → By ad unit. |
| `ADSENSE_SLOT_EXPLORE_INLINE` | Explore inline slot. | `1234567890` | Same. |
| `ADSENSE_SLOT_LIVE` | Live TV slot. | `1234567890` | Same. |
| `ADSENSE_SLOT_LIVE_SIDE` | Live TV side slot. | `1234567890` | Same. |

Only values matching the AdSense format are exposed through `/api/config`. If the client or a
slot is missing or invalid, the site shows a designed D74 house ad instead of an empty box.
Update the publisher ID in `ads.txt` to match `ADSENSE_CLIENT` before going live.

### 4.8 YouTube sync and bulk sync

| Variable | Use | Default / example | Notes |
| --- | --- | --- | --- |
| `YT_SYNC_ENABLED` | Enable the cron sync. | `true` | Use `false` if you manage the library only in admin. |
| `YT_SYNC_ON_START` | Run a sync when the server starts. | `false` | Avoid on free instances that restart often. |
| `YT_SYNC_CRON` | Cron expression. | `17 */6 * * *` | Every six hours at :17. |
| `YT_SYNC_TIMEZONE` | Cron timezone. | `UTC` | IANA name. |
| `YT_SYNC_MAX_NEW` | New videos per run. | `25` | Lower to save API quota. |
| `YT_SYNC_PAGES` | Upload pages per run. | `1` | Each page costs API quota. |
| `YT_SYNC_OVERLAP_HOURS` | Re-check window for late uploads. | `48` | Choose. |
| `YT_TIMEOUT_MS` | Upstream request timeout. | `15000` | Choose. |
| `BULK_BATCH_SIZE` | Bulk job batch size. | `30` | 1–50. |
| `BULK_DAILY_LIMIT` | New videos per UTC day. | `300` | Bulk job stops at the cap. |
| `BULK_DELAY_MINUTES` | Delay between batches. | `30` | Choose. |

The bulk job state lives in the `jobs` collection, so a Render restart resumes where it left
off. A free instance that sleeps between requests will continue the job on the next wake-up.

### 4.9 Quotas, rate limits, analytics and logging

| Variable | Use | Default |
| --- | --- | --- |
| `DB_DAILY_LIMIT` | Daily database operation cap; `0` disables. | `0` |
| `DB_QUOTA_HARD_STOP` | Reject writes at the cap instead of only warning. | `false` |
| `YT_DAILY_LIMIT` | YouTube API calls per UTC day. | `500` |
| `YT_QUOTA_RESERVE` | Calls kept in reserve. | `20` |
| `RATE_LIMIT_WINDOW_MS` | Global window. | `60000` |
| `RATE_LIMIT_MAX` | Global requests per window. | `600` |
| `API_RATE_LIMIT_MAX` | API requests per window. | `240` |
| `LOGIN_RATE_LIMIT_MAX` | Member login attempts. | `12` |
| `ADMIN_LOGIN_RATE_LIMIT_MAX` | Admin login attempts. | `6` |
| `UNLOCK_RATE_LIMIT_MAX` | Legacy unlock alias requests. | `25` |
| `YOUTUBE_RATE_LIMIT_MAX` | YouTube proxy requests. | `60` |
| `DB_WRITE_RATE_LIMIT_MAX` | Database writes. | `90` |
| `DOWNLOAD_RATE_LIMIT_MAX` | Download requests per 10 minutes. | `30` |
| `ANALYTICS_SALT` | Salt for visitor hashes. Defaults to `SESSION_SECRET`. | — |
| `ANALYTICS_RECENT_LIMIT` | Recent events retained. | `250` |
| `ANALYTICS_AUDIT_LIMIT` | Audit entries retained. | `250` |
| `ANALYTICS_TICK_MS` | Analytics flush interval. | `15000` |
| `ANALYTICS_CACHE_TTL` | Analytics cache. | `86400` |

### 4.10 Keep-alive and legacy variables

| Variable | Use | Default |
| --- | --- | --- |
| `KEEP_ALIVE_SELF` | Self-ping the local health route. Does **not** stop Render from sleeping. | `false` |
| `KEEP_ALIVE_INTERVAL_MS` | Self-ping interval. | `600000` |
| `RESTDB_BASE_URL` | Legacy restdb base URL. Used only with `DB_PROVIDER=restdb`. | — |
| `RESTDB_API_KEY` | Legacy restdb key. | — |

Do not use restdb for a new deployment. It is kept only for compatibility.

---

## 5. Secret files on Render

Render secret files are the safest way to ship JSON keys and cookie files. They are mounted
read-only at `/etc/secrets/<filename>` and are not visible in the dashboard after upload.

| Secret file | Environment variable | Content |
| --- | --- | --- |
| `firebase-service-account.json` | `FIREBASE_SERVICE_ACCOUNT_PATH=/etc/secrets/firebase-service-account.json` | Firebase service-account JSON |
| `yt-dlp-cookies.txt` | `YTDLP_COOKIES=/etc/secrets/yt-dlp-cookies.txt` | Netscape cookies file |

If you prefer inline variables, `FIREBASE_SERVICE_ACCOUNT` accepts the full JSON (one line) or
base64-encoded JSON. Inline variables are convenient but easier to leak in screenshots and
support bundles; prefer secret files.

---

## 6. Keep-alive: stop the free instance from sleeping

### Why the internal ping does not work

Render defines activity as **inbound HTTP traffic to the service**. A timer inside the
Node process that calls its own `/api/health` never leaves the container, so Render does not
count it and still sleeps the instance after 15 minutes. The old self-ping in this project
used the wrong host and port as well; it has been replaced by an opt-in local warm-up and an
external workflow.

### What is included

`.github/workflows/keep-alive.yml` runs outside Render on GitHub Actions and requests:

```text
https://d74.onrender.com/api/health
```

every 10 minutes, with three attempts and a 70-second timeout so a cold start can finish. It
fails the workflow if the endpoint never returns `200` with `"ok":true`.

### Enable it

1. Push the workflow to the default branch.
2. In GitHub, open **Settings → Secrets and variables → Actions → Variables**.
3. Add `RENDER_SERVICE_URL` with your service origin, for example:

   ```text
   https://d74.onrender.com
   ```

   A repository **secret** with the same name also works. If neither is set, the workflow uses
   `https://d74.onrender.com`.
4. Open **Actions → Render keep-alive → Run workflow** once to test. The log should show
   `Service is awake and healthy.`
5. Leave the schedule enabled. Check the run history after a day.

The endpoint returns quickly and does not touch Firestore, so it is cheap:

```json
{"ok":true,"uptime":123,"version":"2.0.0","cache":{"driver":"redis","redis":true}}
```

### Make it more reliable

GitHub Actions scheduled runs can be delayed during busy periods, and GitHub disables
schedules after 60 days without repository activity (it emails the owner first). For
guaranteed timing, add a second external monitor:

- **cron-job.org** — free, 1-minute granularity, HTTP GET every 10 minutes.
- **UptimeRobot** — free monitor, 5-minute interval, keyword check for `"ok":true`.
- Any small VPS or serverless cron:

  ```bash
  */10 * * * * curl -fsS --max-time 60 https://d74.onrender.com/api/health >/dev/null
  ```

Set the monitor to expect **HTTP 200**, allow up to **60 seconds** for a cold start, and alert
you if it fails twice in a row. Do not ping more often than every 5 minutes; 10 minutes is
enough and avoids needless free-tier hours.

### Keep the service warm without keeping it awake?

You cannot have both on the free tier: either external traffic keeps it awake, or it sleeps
after 15 minutes. If sleeping is acceptable, disable the workflow and the site will cold-start
on the next visit. Paid Render plans remove the sleep behaviour.

---

## 7. Firebase setup details

1. **Create the project** in the Firebase console and add Firestore.
2. **Choose a location** close to your Render region to reduce latency.
3. **Create the service account** and grant `roles/datastore.user`.
4. **Download the JSON key** once. Upload it as a Render secret file.
5. **Do not enable client access.** The browser never talks to Firestore; all requests go
   through the Express API. You can set Firestore rules to deny all reads and writes from
   clients.
6. **Seed the database.** Sign in to `/Admin/`, open **Live channels** to create channels, and
   use **Bulk sync** to import a channel archive. The first sync needs a valid
   `YOUTUBE_CHANNEL_ID` and `RAPIDAPI_KEY`.

If you see `Firebase credentials are missing` in production, the service will refuse to start
rather than silently use an ephemeral local file. Add the secret file and redeploy.

---

## 8. AdSense setup details

1. Add the site in AdSense and complete verification.
2. Set `ADSENSE_CLIENT` and the slot IDs.
3. Update `ads.txt` with the publisher ID AdSense gives you.
4. Deploy and open `/api/config` to confirm `"ads":true`.
5. Use the AdSense preview tool or the browser console to confirm slots fill.

If ads do not fill, the site shows a house ad. Check the AdSense policy centre for
`ads.txt`, consent and content issues. The site's CSP already allows Google ad domains.

---

## 9. Custom domain and HTTPS

1. In Render, open **Settings → Custom Domains**, add the domain and follow the DNS records.
2. Render issues and renews TLS automatically.
3. Set `PUBLIC_ORIGIN=https://your-domain.example` and keep `TRUST_PROXY=1`.
4. Update `RENDER_SERVICE_URL` in GitHub to the custom domain so keep-alive follows it.
5. Update the canonical URLs in `privacy/index.html`, `terms/index.html` and `sitemap.xml`.
6. Keep the old `onrender.com` URL working or set up a redirect.

Secure cookies use the `__Host-` prefix in production, so the site must be served over HTTPS.
Local HTTP development uses a non-prefixed cookie automatically.

---

## 10. Operations and checks

### Health and logs

- `GET /api/health` — process uptime, cache driver, event count.
- `GET /api/config` — public feature flags (never secrets).
- Render dashboard → **Logs** — startup lines, request errors and warnings.
- Admin → **Monitoring** — cache driver, request rate, error rate, sessions.

A healthy startup log looks like:

```text
Starting D74 Edits {"env":"production","port":10000,"youtubeChannels":1}
Cache driver: Redis
Data provider: firebase {"remote":true}
Free downloads ready {"driver":"yt-dlp","version":"…"}
Admin session store: redis
Listening on http://localhost:10000
Keep-alive endpoint {"url":"https://d74.onrender.com/api/health"}
```

The `Listening on http://localhost:…` line is internal; Render exposes it over HTTPS.

### After every deploy

- [ ] `/api/health` returns `200` and `"ok":true`.
- [ ] `/api/config` shows the expected features and ad state.
- [ ] Explore, Search, Live TV and a clip page load without console errors.
- [ ] Mobile bottom navigation works at 390 px wide.
- [ ] A free download either redirects or starts streaming.
- [ ] Admin login works and the session survives a restart when Redis is configured.
- [ ] Privacy and Terms links work from the landing page, drawer and auth pages.

### Updates

- Rebuild the service to refresh the `yt-dlp` binary (`latest` URL).
- Run `npm audit` and update dependencies regularly.
- Rotate `SESSION_SECRET` only when you accept that all sessions are invalidated.
- Rotate Firebase, RapidAPI and cookie credentials if they leak.

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Deploy exits immediately with “Missing environment variables” | `SESSION_SECRET`, `RAPIDAPI_KEY`, an admin password/hash is absent | Add the variable in Render and redeploy. |
| `Production requires Firebase…` | No service account file or inline JSON | Upload `firebase-service-account.json` and set `FIREBASE_SERVICE_ACCOUNT_PATH`. |
| `Cache driver: memory` | `REDIS_URL` missing or unreachable | Add the internal Redis URL; check region and TLS. |
| Admin login appears to succeed, then loops | Proxy/HTTPS not trusted, or `PUBLIC_ORIGIN` is wrong | Set `TRUST_PROXY=1` and the correct HTTPS origin. Clear cookies and retry. |
| Service still sleeps after 15 minutes | Keep-alive is internal, disabled, or pointed at the wrong URL | Enable the GitHub workflow, set `RENDER_SERVICE_URL`, test it manually; add an uptime monitor. |
| Download returns `ytdlp_unavailable` | Binary missing or `YTDLP_PATH` wrong | Rebuild with the build command; confirm `bin/yt-dlp` is executable. |
| Download returns `ytdlp_bot_check` | YouTube wants a signed-in session | Add `YTDLP_COOKIES` as a secret file and redeploy. |
| Download returns `ytdlp_private` or `ytdlp_unavailable_video` | Video is private, removed or region-locked | Use a direct file URL or choose another clip. |
| Download starts then stalls | Large file, upstream throttling, or proxy request limits | Prefer a direct MP4 URL for large clips; keep the progressive format. |
| Firestore `PERMISSION_DENIED` | Wrong project, missing role, or API disabled | Check `FIREBASE_PROJECT_ID`, the `roles/datastore.user` grant and the Firestore API. |
| 429s from RapidAPI | YouTube quota exhausted | Lower `YT_SYNC_MAX_NEW`/`YT_SYNC_PAGES`, raise the plan, or wait for the daily reset. |
| Ads show house placeholders | Missing/invalid client or slot IDs | Check `/api/config` and the AdSense unit IDs. |
| Cold start is slow | Free tier spins down | Keep-alive, or move to a paid always-on plan. |

Useful commands for a local reproduction:

```bash
npm ci
cp .env.example .env
# fill .env, then:
npm run check
npm start
curl -sS http://localhost:3005/api/health
```

---

## 12. Security checklist

- [ ] Never commit `.env`, service-account JSON, cookies, or API keys.
- [ ] Use Render Secret Files for Firebase and yt-dlp cookies.
- [ ] Use `ADMIN_PASSWORD_HASH`, not a plain password, in production.
- [ ] Keep `NODE_ENV=production`, `TRUST_PROXY=1` and `PUBLIC_ORIGIN` set.
- [ ] Use a unique `SESSION_SECRET` of 32+ random bytes.
- [ ] Enable Redis so admin sessions survive restarts.
- [ ] Restrict Firestore rules to deny direct browser access.
- [ ] Update `ads.txt`, canonical URLs and `sitemap.xml` for the live domain.
- [ ] Keep the keep-alive URL on HTTPS and use a low-privilege monitor.
- [ ] Review Admin → Monitoring and Render logs after deploys.
- [ ] Rotate any credential that was ever committed to git history.
- [ ] Confirm you have rights to distribute the clips you offer for download.

---

## 13. Cost notes

A minimal production setup can stay at **$0**:

- Render free web service (sleeps without keep-alive; 750 hours/month).
- Firebase Spark plan within the daily quota.
- RapidAPI free plan within the call limit.
- GitHub Actions scheduled workflow for keep-alive.
- AdSense has no fixed fee.

Optional costs: a Render paid instance for always-on service, Render Key Value or Upstash for
Redis, a custom domain, and a higher RapidAPI/Firebase plan for heavy traffic. Set billing
alerts before upgrading anything.
