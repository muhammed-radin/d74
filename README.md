# D74 Edits

Free football clips, highlights and live TV channels — rebuilt as a fast, responsive site behind a hardened Express server with a secure admin control room.

![D74 Edits](logo.png)

## Highlights

- **Broadcast-inspired design** — near-black canvas, sharp borders, one lime accent, editorial typography and restrained motion. The D74 logo appears in every navigation bar.
- **Screen-fit hero + motion** — the landing hero uses `svh`/`lvh`/`vh` so it fills exactly one screen. anime.js drives the headline reveal, counters, scroll reveals, pointer tilt and magnetic buttons, with reduced-motion and no-CDN fallbacks.
- **Responsive everywhere** — public pages and the admin all work from 360 px phones to wide desktops.
- **No secrets in the browser** — Firebase service-account credentials, RapidAPI keys and admin secrets live in `.env` and are only read by the Node process.
- **Secure administrator sessions** — server-side sessions in an `httpOnly`, `SameSite=Strict` cookie; CSRF tokens; idle and absolute expiry; device binding; session-id regeneration; revoke-one and revoke-all; full audit trail.
- **Free downloads, no passwords** — every clip downloads without a password or PIN. A record with a direct file link uses that link; otherwise the server fetches the clip from YouTube with `yt-dlp` and streams it to the browser as an attachment, so no signed URL reaches the page.
- **Caching that respects the quota** — Firestore reads are cached with stale-while-revalidate and single-flight coalescing. Redis is used when available, otherwise a bounded in-memory cache takes over automatically.
- **Event-driven updates** — an SSE stream pushes video, theme, account, sync and security events to open tabs. Admin pages and the public site refresh without polling.
- **Quota-aware YouTube sync** — a cron job paginates each channel's uploads playlist (not search) and merges multiple channels into one `videos` collection while staying inside the 500 requests/day plan.
- **Long-running bulk sync** — a resumable server job clears the library and loads every channel one at a time in batches of 30, waits 30 minutes between batches and stops at 300 new videos per day. Pause, resume, stop, skip and complete controls live in **Admin → Bulk sync**.
- **Admin dashboard, analytics and monitoring** — traffic, error rate, cache hit rate, unique visitors, DB/YouTube quota, sync state, runtime health, sessions, audit trail and live events.
- **Zero motion in admin** — the admin disables every animation and transition, including the public button effects.

## Requirements

- **Node.js 18+** (uses the built-in `fetch` and `AbortSignal.timeout`).
- A Firebase project with Firestore enabled and a server-side service account.
- A RapidAPI key.
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) for free YouTube downloads (`pip install -U yt-dlp`, or `apt install yt-dlp`). `ffmpeg` is optional and only needed if you choose a merged format.
- Redis is optional but recommended for multi-instance deployments. Without `REDIS_URL` the server logs `Cache driver: memory` and uses a bounded in-process cache.

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Create the environment file
cp .env.example .env
#    edit .env and fill in real values

# 3. Run
npm start
# or: node server.js
```

Open <http://localhost:3005>. The admin control room is at <http://localhost:3005/Admin/>.

The live catalogue starts empty. Sign in to the admin and use **Live channels** to publish channels; no channel data is hardcoded in the site.

For development with automatic restarts:

```bash
npm run dev
```

Verify every JavaScript and CSS file without starting anything:

```bash
npm run check
```

### Database providers

Firebase Firestore is the primary database. The server authenticates with a Google service account and talks to the Firestore REST API; the browser never receives the service account or an access token. Any of these shapes work:

```ini
# Inline JSON (single line) or base64-encoded JSON
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}

# Or a mounted file
FIREBASE_SERVICE_ACCOUNT_PATH=/run/secrets/firebase-service-account.json
# GOOGLE_APPLICATION_CREDENTIALS also works

# Or individual values
FIREBASE_PROJECT_ID=your-project
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

`DB_PROVIDER` selects the store: `firebase` (default), `restdb` (kept for compatibility but disabled by default) or `local`. Production refuses to start without Firebase credentials so channels and videos cannot depend on an ephemeral container disk. Development falls back to `server/data/local-db.json`, which is gitignored and written with `0600` permissions. When you switch from the local fallback to Firebase while the remote `channels` collection is empty, the server imports the local channel catalogue once; the legacy `server/data/channels.json` is also imported once and archived.

The allow-listed collections are `videos`, `account`, `themes`, `promotions`, `custom`, `channels` and `jobs`. Public reads are limited to sanitised `videos`, `themes` and `promotions`; `channels` summaries are exposed through dedicated routes. Every other read and every write requires an administrator session plus a CSRF token. Never store secrets in `custom` — it is only readable by an administrator session.

### API 404s

Every `/api/*` route is served by the Express app. If you open the pages through a separate static preview server, the client automatically retries the Node app on port `3005`/`3000` (including Codespaces and Gitpod port-forwarding). The Node process still has to be running. To point at a different backend, set a global before `view/d74.js` loads:

```html
<script>window.D74_API_BASE = "https://your-api.example.com";</script>
```

## Administrator access

Open `/Admin/` and sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD` (or `ADMIN_PASSWORD_HASH`). Passwords are verified with salted **scrypt** and compared in constant time.

Security model:

| Control | Behaviour |
| --- | --- |
| Session storage | Server-side store (Redis when configured, bounded memory otherwise). |
| Cookie | `httpOnly`, `SameSite=Strict`, `Secure` in production, `__Host-` prefix in production. |
| CSRF | Per-session token required on every mutating admin/database request. |
| Expiry | Server-enforced idle timeout plus an absolute lifetime; the CSRF token rotates periodically and the session id is regenerated on demand. |
| Binding | User-agent bound by default (IP binding optional). |
| Limits | Per-address and per-username login throttling, global API limits and write limits. |
| Revocation | Revoke one session or every other session; a global revocation epoch invalidates old cookies instantly. |
| Audit | Logins, logouts, revocations, syncs, cache clears, channel changes and database writes are recorded. |

The admin shell, dashboard, analytics, videos, live channels, accounts, themes, monitoring, installer and editor all share one responsive, animation-free interface. The browser only ever holds the session cookie and an in-memory CSRF token — never the session id.

## Live channels

Live TV has no hardcoded catalogue. Open **Admin → Live channels** to create, edit, hide or delete channel documents. The public list is empty until at least one active channel is saved.

Each document stores:

| Field | Notes |
| --- | --- |
| `id` | Stable public id (letters, numbers, hyphens or underscores). Immutable after creation. |
| `title` | Display name used by Explore and Live TV. |
| `logo` | Optional http(s) URL or site-relative path. Cards fall back to the D74 logo when absent or broken. |
| `description`, `category`, `country`, `language` | Optional metadata shown in the admin and used by search. |
| `status` | `active` appears publicly; `hidden` stays administrator-only. |
| `featured`, `order` | Editorial priority and manual sort order. |
| `sources[]` | One or more HLS, DASH or MP4 URLs, each with an optional label and format. DASH ClearKey key id/key pairs are supported. |

The player walks the sources in order and fails over when an upstream is unavailable. Channel documents are stored in the database (`channels` collection, Firebase by default), not in a server-only JSON file, so they survive restarts and redeploys. A legacy `server/data/channels.json` is imported once and archived. Public list responses expose only summaries; stream URLs and ClearKey values appear only in the single-channel response consumed by the player. Every create, update and delete is audited, rate-limited, CSRF-protected and broadcast to open admin tabs over SSE.

## YouTube sync (two channels)

The cron sync reads each channel's **uploads playlist**, one page per run by default, so a full check costs a handful of requests instead of search quota. Configure channels in either place (they are merged and de-duplicated):

```bash
# .env
YOUTUBE_CHANNEL_IDS=UCFodctpE1wtpFhWw716uCgg,SECOND_CHANNEL_ID
```

```json
// server/data/youtube-channels.json (gitignored)
[
  { "id": "UCFodctpE1wtpFhWw716uCgg", "name": "D74 Edits" },
  { "id": "SECOND_CHANNEL_ID", "name": "Second channel" }
]
```

Defaults: every 6 hours (`17 */6 * * *` UTC), up to 25 new clips and one page per channel per run. Override with `YT_SYNC_CRON`, `YT_SYNC_MAX_NEW` and `YT_SYNC_PAGES`. Run a dry run from the dashboard before enabling a large sync. Sync state is stored in the gitignored `server/data/sync-state.json`.

## Bulk sync

**Admin → Bulk sync** is a long-running server job for loading a full channel archive into the database:

1. Optionally clear every video document first (**Danger zone → Delete all videos**).
2. Press **Start job**. The job walks the configured YouTube channels in order.
3. Each batch loads 30 uploads playlist items. The next batch waits 30 minutes.
4. The job stops at 300 newly created videos per UTC day and resumes automatically after midnight UTC.
5. When a channel's uploads are exhausted, the job advances to the next channel after the normal delay.
6. When every channel is complete, the job closes itself and releases the regular sync.

Controls: **Pause**, **Resume**, **Stop**, **Sync current channel now**, **Move to next channel**, **Mark channel complete**, **Mark all complete**, **Reset job**, and **Stop & close page**. Job state (channel index, page tokens, pending items, counters, logs) is persisted in the `jobs` collection, so a restart resumes exactly where it stopped. While the job is running or paused, `youtube.externalLock` blocks the cron and manual regular sync; stopping the job clears the lock.

The page also includes bulk video tools: select and delete thousands of records, add up to 500 videos by YouTube id in one request, and a guarded delete-all that requires typing `DELETE ALL VIDEOS`.

Tune the job with `BULK_BATCH_SIZE` (default 30), `BULK_DAILY_LIMIT` (default 300) and `BULK_DELAY_MINUTES` (default 30).

## Free downloads

Downloads are free and no longer use a password or PIN. The viewer on `/visit/?id=…` always offers **Download free**:

1. If the video record has a **direct download URL** (`url` different from the YouTube watch page), the server redirects to that file or streams it, whichever the host supports.
2. If `url` is empty or is the normal YouTube page, the server runs `yt-dlp`, resolves the selected format and streams the media through `/api/videos/download?id=…` with `Content-Disposition: attachment`. Nothing is written to disk and no signed URL is exposed in the page.
3. The legacy `POST /api/videos/unlock` endpoint still answers for old open tabs, but it ignores any password and simply returns the free download URL.

`GET /api/videos/download?id=…&mode=url` returns JSON (`{ source, title, url, stream }`) instead of a file, so the viewer can show a clear error when YouTube asks for a bot check. `GET /api/videos/similar?id=…` powers the “More like this” rail using the clip’s channel, tags, category and title words.

Install `yt-dlp` on the server (`pip install -U yt-dlp` or `apt install yt-dlp`) and keep it on `PATH`, or set `YTDLP_PATH`. On cloud/VPS addresses YouTube sometimes asks for a sign-in check; export a Netscape cookie file from a browser and point `YTDLP_COOKIES` at it.

| Variable | Purpose |
| --- | --- |
| `YTDLP_ENABLED` | Turn the yt-dlp fallback on/off (default `true`). |
| `YTDLP_PATH` | Binary name or absolute path (default `yt-dlp`). |
| `YTDLP_FORMAT` | Format selector (default `best[ext=mp4]/best`, a single progressive file). |
| `YTDLP_COOKIES` | Netscape cookies file for bot checks. |
| `YTDLP_EXTRACTOR_ARGS` | Extra `--extractor-args`, e.g. `youtube:player_client=web`. |
| `YTDLP_EXTRA_ARGS` | Any other yt-dlp arguments, whitespace-separated. |
| `YTDLP_START_TIMEOUT_MS` | Time allowed before the first byte is returned (default 45 s). |
| `DOWNLOAD_RATE_LIMIT_MAX` | Download requests per 10 minutes per address (default 30). |

## Caching and quotas

- Reads of `videos`, `themes`, `promotions` and `account` go through the cached data layer. Concurrent misses collapse into a single upstream request.
- Fresh entries are served for `DB_CACHE_TTL` (60 s by default); stale entries may be served for `DB_STALE_TTL` (300 s) while a refresh runs in the background.
- YouTube metadata is cached much longer (`YOUTUBE_CACHE_TTL`, `YOUTUBE_VIDEO_CACHE_TTL`) because the daily quota is small.
- `DB_DAILY_LIMIT` and `YT_DAILY_LIMIT` track daily usage. Set `DB_QUOTA_HARD_STOP=true` to reject writes once the DB cap is reached; cached reads stay available either way.
- Clear the cache from **Monitoring → Cache** or `POST /api/admin/cache/clear`.

The cache driver is reported on the dashboard. If Redis is missing or unreachable, the server logs a warning, falls back to memory, and keeps serving.

## Environment

See [`.env.example`](.env.example) for the complete, commented list. The most important values:

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (default `3005`). |
| `NODE_ENV` | `production` enables HSTS, secure cookies and hidden internal errors. |
| `SESSION_SECRET` | Signs cookies and anonymises analytics. Use a long random value. |
| `DB_PROVIDER` | `firebase` (default), `restdb` (disabled legacy) or `local` (development only). |
| `FIREBASE_SERVICE_ACCOUNT` / `FIREBASE_SERVICE_ACCOUNT_PATH` | Server-side Google service account for Firestore. |
| `RAPIDAPI_KEY` | RapidAPI key for YouTube and football. |
| `YOUTUBE_CHANNEL_ID` / `YOUTUBE_CHANNEL_IDS` | One or more channels for the feed and cron sync. |
| `ADSENSE_CLIENT` / `ADSENSE_SLOT_*` | AdSense publisher id and placement slot ids. Leave blank to show D74 house ads. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Administrator login. Prefer `ADMIN_PASSWORD_HASH` in production. |
| `ADMIN_SESSION_HOURS` / `ADMIN_SESSION_IDLE_MINUTES` | Absolute and idle session lifetimes. |
| `REDIS_URL` | Enables Redis for cache and sessions. Without it the server logs `Cache driver: memory`. |
| `YTDLP_PATH` / `YTDLP_COOKIES` / `YTDLP_FORMAT` | Free download binary, cookie file and format selector. |
| `DOWNLOAD_RATE_LIMIT_MAX` | Free download requests per 10 minutes per address. |
| `DB_DAILY_LIMIT` / `YT_DAILY_LIMIT` | Daily quota caps (`0` disables). |
| `BULK_BATCH_SIZE` / `BULK_DAILY_LIMIT` / `BULK_DELAY_MINUTES` | Bulk sync batch size, daily cap and delay. |

Generate a session secret:

```bash
openssl rand -hex 32
```

Generate an admin password hash:

```bash
node -e "const a=require('./server/auth');const h=a.hashPassword(process.argv[1]);console.log('scrypt$'+h.salt+'$'+h.hash)" 'your-password'
```

## Advertising

Explore and Live TV host designed ad cards from `view/ads.js` and `view/ads.css`. Each card reserves its height up front and follows the near-black/acid-lime design system.

Configure real AdSense units in `.env`:

```ini
ADSENSE_CLIENT=ca-pub-0000000000000000
ADSENSE_SLOT_EXPLORE=0000000000
ADSENSE_SLOT_EXPLORE_INLINE=0000000000
ADSENSE_SLOT_LIVE=0000000000
ADSENSE_SLOT_LIVE_SIDE=0000000000
```

| Page | Placement | Environment variable |
| --- | --- | --- |
| Explore | Leaderboard below the hero | `ADSENSE_SLOT_EXPLORE` |
| Explore | Inline card below the clip grid | `ADSENSE_SLOT_EXPLORE_INLINE` |
| Live TV | Leaderboard below the hero | `ADSENSE_SLOT_LIVE` |
| Live TV | Rectangle in the channel rail | `ADSENSE_SLOT_LIVE_SIDE` |

The server validates the `ca-pub-…` publisher id and numeric slot ids; only those values reach the browser through `GET /api/config`. If the client or a slot is missing, the card renders a tasteful D74 house ad, so there is never an empty or broken placement. Local previews without the Node API use the same fallback. If a configured ad is blocked, the card keeps its reserved height and shows a neutral placeholder instead of collapsing the layout. Set `ADSENSE_ENABLED=false` to force house ads everywhere.

AdSense domains are allow-listed in the CSP for scripts, frames and images.

## API surface

All endpoints are served by the Express app.

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | Health check. |
| `GET /api/config` | Public site config and validated AdSense ids. |
| `GET /api/channels` | Active channel summaries `{ id, title, logo, category, country, sourceCount }`. |
| `GET /api/channels/:id` | One active channel with its ordered sources (URLs + optional ClearKey). |
| `POST /api/auth/signup` | Create an account (scrypt hash). |
| `POST /api/auth/login` | Verify an account. |
| `POST /api/videos/unlock` | Legacy alias. Ignores the password and returns the free download URL. |
| `GET /api/videos/download?id=` | Free download. Streams the file (yt-dlp) or redirects to a direct link. Add `mode=url` for JSON. |
| `GET /api/videos/similar?id=` | Related clips for the viewer (same channel, tags, category, title words). |
| `GET /api/youtube/search` | Explore feed (RapidAPI, cached). |
| `GET /api/youtube/videos?id=` | Clip metadata (RapidAPI, cached). |
| `GET /api/football` | Today's matches (RapidAPI, cached). |
| `GET /api/events` | Server-sent events (hello, heartbeat, data and security events). |
| `POST /api/admin/login` | Create an administrator session. |
| `POST /api/admin/logout` | Revoke the current session. |
| `GET /api/admin/session` | Current session details + fresh CSRF token. |
| `POST /api/admin/session/rotate` | Regenerate the session id and return a fresh CSRF token. The old cookie stops working immediately. |
| `GET /api/admin/dashboard` | Dashboard totals, quota, sync, audit, sessions, runtime. |
| `GET /api/admin/analytics?range=` | Traffic series, status codes, paths, recent requests. |
| `GET /api/admin/monitoring` | Alerts, cache, quota, runtime, live events. |
| `GET /api/admin/audit?limit=` | Audit trail. |
| `GET/DELETE /api/admin/sessions/:key` | List or revoke sessions. |
| `GET /api/admin/youtube/status` | Sync schedule and per-channel state. |
| `POST /api/admin/youtube/sync` | Start a sync (`{ dryRun, wait, pages, maxNew }`). Returns `409 sync_locked` while a bulk job is active. |
| `GET /api/admin/bulk/status` | Bulk job snapshot, channel queue, logs, video count and provider. |
| `POST /api/admin/bulk/start` / `pause` / `resume` / `stop` | Bulk job lifecycle controls. |
| `POST /api/admin/bulk/sync-now` / `next-channel` / `complete-channel` / `finish` / `reset` | Bulk job queue controls. |
| `POST /api/admin/videos/delete-all` | Clear the videos collection (requires `confirm: "DELETE ALL VIDEOS"`). |
| `POST /api/admin/videos/bulk-delete` / `bulk-add` | Delete selected documents or add videos by YouTube id. |
| `POST /api/admin/cache/clear` | Clear cached data. |
| `GET/POST /api/admin/channels` | List all channel documents or create one. |
| `PUT/DELETE /api/admin/channels/:id` | Update or delete a channel. Writes require admin + CSRF. |
| `GET /api/admin/videos` / `accounts` / `themes` | Admin lists. |
| `GET/POST/PUT/DELETE /api/db/*` | Allow-listed database proxy. Writes require admin + CSRF. |

Public `videos` responses are sanitised: `pw` and `url` are stripped and replaced with computed `downloadable` and `downloadSource` fields (`youtube`, `link` or `none`). Authenticated administrators can still read the full record through the admin proxy.

## Test setup

Generate a test admin account and a short-lived session:

```bash
# bad password → 401
curl -i -X POST http://localhost:3005/api/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"wrong"}'
```

Then use the `d74.sid` cookie from a successful login for `/api/admin/*` reads and send `X-CSRF-Token` on writes.

## Security notes

- `.env`, `server/data/channels.json` (legacy import), `server/data/youtube-channels.json`, `server/data/local-db.json` and `server/data/sync-state.json` are gitignored.
- Static serving blocks `server/`, `node_modules/`, dotfiles, directory listings and path traversal.
- Helmet sets CSP, `X-Content-Type-Options`, `X-Frame-Options`, a strict referrer policy and a permissions policy.
- Login, signup, download, admin login and YouTube endpoints are rate limited.
- Administrator sessions expire on the server for both idle time and absolute age; a long-lived admin event stream is revalidated and dropped when its session is revoked, logged out or idle-expired.
- API responses are `no-store`; public cached database responses use a short `max-age`/`stale-while-revalidate` window.
- Downloads are free and rate-limited per address. `yt-dlp` is spawned with an argument array (never a shell), the clip id is validated, and only http(s) direct links are followed.
- Legacy plaintext accounts are upgraded to scrypt on their next successful login.

### ⚠️ Rotate every key

Earlier versions of this project committed real credentials to git. Deleting them from the current files does **not** remove them from git history. Before deploying:

1. Rotate the Firebase service-account key.
2. Rotate the RapidAPI key.
3. Change the admin password.
4. Generate a fresh `SESSION_SECRET`.
5. If the repository still has the legacy restdb key, rotate that too.
6. If the repository is public, consider rewriting history or starting a clean repository.

## Project layout

```
.
├── server.js                 # Express bootstrap + graceful shutdown
├── server/
│   ├── app.js                # middleware chain, CSP, static serving, errors
│   ├── config.js             # env loading and normalisation
│   ├── cache.js              # Redis + bounded memory cache
│   ├── db.js                 # metered, cached data layer
│   ├── store/                # firebase, local and legacy restdb providers
│   ├── channels.js           # DB-backed live channel catalogue
│   ├── bulk-sync.js          # persistent bulk YouTube sync engine
│   ├── sessions.js           # admin sessions, CSRF, revocation
│   ├── analytics.js          # traffic, audit and runtime metrics
│   ├── events.js             # SSE hub
│   ├── youtube.js            # quota-aware multi-channel cron sync
│   ├── ytdlp.js              # free download resolver and streaming proxy
│   ├── quota.js              # daily DB/YouTube counters
│   └── routes/               # public, admin and database routers
├── .env.example              # environment template
├── scripts/check.js          # syntax + CSS health check
├── server/data/              # legacy import, sync state, local fallback (gitignored)
├── view/                     # shared design system (app.css, color.css, ui.js, d74.js, motion.js)
├── index.html                # landing page
├── explore/                  # clip feed + matches + channels
├── search/                   # search page
├── livestreams/              # live TV browser
├── livehelper/player.html    # isolated Video.js live player
├── visit/                    # clip detail, player and free downloads
├── login/ signup/            # auth pages
├── settings/                 # theme, accent, account
├── 404/
└── Admin/                    # shell, dashboard, analytics, videos, sync, channels,
                              # accounts, themes, monitoring, installer, editor, login
```

## Motion

The landing page loads anime.js from jsDelivr (`cdn.jsdelivr.net`, already allowed by the CSP). If the script is blocked, or the visitor has `prefers-reduced-motion` enabled, `view/motion.js` exits and the CSS/IntersectionObserver fallback in `view/ui.js` handles reveals, counters and tilt. To self-host, save `anime.min.js` into `view/` and point the script tag at it.

The admin deliberately ignores `view/ui.js` and `view/motion.js`, and `Admin/admin.css` forces `animation: none` and `transition: none` on every element.

## Credits

Built for D74 Edits. Football data via RapidAPI, video metadata via YouTube, live streams via their respective providers.
