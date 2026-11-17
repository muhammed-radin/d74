# D74 Edits

Free football clips, highlights and live TV channels — rebuilt as a fast, responsive site behind a hardened Express server with a secure admin control room.

![D74 Edits](logo.png)

## Highlights

- **Broadcast-inspired design** — near-black canvas, sharp borders, one lime accent, editorial typography and restrained motion. The D74 logo appears in every navigation bar.
- **Screen-fit hero + motion** — the landing hero uses `svh`/`lvh`/`vh` so it fills exactly one screen. anime.js drives the headline reveal, counters, scroll reveals, pointer tilt and magnetic buttons, with reduced-motion and no-CDN fallbacks.
- **Responsive everywhere** — public pages and the admin all work from 360 px phones to wide desktops.
- **No secrets in the browser** — restdb, RapidAPI and admin credentials live in `.env` and are only read by the Node process.
- **Secure administrator sessions** — server-side sessions in an `httpOnly`, `SameSite=Strict` cookie; CSRF tokens; idle and absolute expiry; device binding; session-id regeneration; revoke-one and revoke-all; full audit trail.
- **Caching that respects the quota** — restdb reads are cached with stale-while-revalidate and single-flight coalescing. Redis is used when available, otherwise a bounded in-memory cache takes over automatically.
- **Event-driven updates** — an SSE stream pushes video, theme, account, sync and security events to open tabs. Admin pages and the public site refresh without polling.
- **Quota-aware YouTube sync** — a cron job paginates each channel's uploads playlist (not search) and merges multiple channels into one `videos` collection while staying inside the 500 requests/day plan.
- **Admin dashboard, analytics and monitoring** — traffic, error rate, cache hit rate, unique visitors, DB/YouTube quota, sync state, runtime health, sessions, audit trail and live events.
- **Zero motion in admin** — the admin disables every animation and transition, including the public button effects.

## Requirements

- **Node.js 18+** (uses the built-in `fetch` and `AbortSignal.timeout`).
- A restdb.io database and a RapidAPI key.
- Redis is optional but recommended for multi-instance deployments.

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

### Database collections

The server allow-lists five restdb collections: `videos`, `account`, `themes`, `promotions` and `custom`. Reads of a missing collection return an empty list, but writes fail. Create `themes` and `promotions` in the restdb dashboard before using those admin pages; a write returns `409` with a clear “collection does not exist” message until then. Never store secrets in `custom` — it is only readable by an administrator session.

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
| `logo` | Optional http(s) URL or site-relative path. Cards fall back to initials when absent. |
| `description`, `category`, `country`, `language` | Optional metadata shown in the admin and used by search. |
| `status` | `active` appears publicly; `hidden` stays administrator-only. |
| `featured`, `order` | Editorial priority and manual sort order. |
| `sources[]` | One or more HLS, DASH or MP4 URLs, each with an optional label and format. DASH ClearKey key id/key pairs are supported. |

The player walks the sources in order and fails over when an upstream is unavailable. Saving writes `server/data/channels.json` atomically with `0600` permissions. That file is gitignored because it contains private stream and DRM configuration. Public list responses expose only summaries; stream URLs and ClearKey values appear only in the single-channel response consumed by the player. Every create, update and delete is audited, rate-limited, CSRF-protected and broadcast to open admin tabs over SSE.

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
| `RESTDB_BASE_URL` / `RESTDB_API_KEY` | restdb.io endpoint and key (server only). |
| `RAPIDAPI_KEY` | RapidAPI key for YouTube and football. |
| `YOUTUBE_CHANNEL_ID` / `YOUTUBE_CHANNEL_IDS` | One or more channels for the feed and cron sync. |
| `ADSENSE_CLIENT` / `ADSENSE_SLOT_*` | AdSense publisher id and placement slot ids. Leave blank to show D74 house ads. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Administrator login. Prefer `ADMIN_PASSWORD_HASH` in production. |
| `ADMIN_SESSION_HOURS` / `ADMIN_SESSION_IDLE_MINUTES` | Absolute and idle session lifetimes. |
| `REDIS_URL` | Enables Redis for cache and sessions. |
| `DB_DAILY_LIMIT` / `YT_DAILY_LIMIT` | Daily quota caps (`0` disables). |

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
| `POST /api/videos/unlock` | Verify a download password and return the URL. |
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
| `POST /api/admin/youtube/sync` | Start a sync (`{ dryRun, wait, pages, maxNew }`). |
| `POST /api/admin/cache/clear` | Clear cached data. |
| `GET/POST /api/admin/channels` | List all channel documents or create one. |
| `PUT/DELETE /api/admin/channels/:id` | Update or delete a channel. Writes require admin + CSRF. |
| `GET /api/admin/videos` / `accounts` / `themes` | Admin lists. |
| `GET/POST/PUT/DELETE /api/db/*` | Allow-listed restdb proxy. Writes require admin + CSRF. |

Public `videos` responses are sanitised: `pw` and `url` are stripped and replaced with a computed `downloadable` boolean. Authenticated administrators can still read the full record through the admin proxy.

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

- `.env`, `server/data/channels.json`, `server/data/youtube-channels.json` and `server/data/sync-state.json` are gitignored.
- Static serving blocks `server/`, `node_modules/`, dotfiles, directory listings and path traversal.
- Helmet sets CSP, `X-Content-Type-Options`, `X-Frame-Options`, a strict referrer policy and a permissions policy.
- Login, signup, unlock, admin login and YouTube endpoints are rate limited.
- Administrator sessions expire on the server for both idle time and absolute age; a long-lived admin event stream is revalidated and dropped when its session is revoked, logged out or idle-expired.
- API responses are `no-store`; public cached database responses use a short `max-age`/`stale-while-revalidate` window.
- Download passwords are compared server-side with a timing-safe comparison.
- Legacy plaintext accounts are upgraded to scrypt on their next successful login.

### ⚠️ Rotate every key

Earlier versions of this project committed real credentials to git. Deleting them from the current files does **not** remove them from git history. Before deploying:

1. Rotate the restdb.io API key.
2. Rotate the RapidAPI key.
3. Change the admin password.
4. Generate a fresh `SESSION_SECRET`.
5. If the repository is public, consider rewriting history or starting a clean repository.

## Project layout

```
.
├── server.js                 # Express bootstrap + graceful shutdown
├── server/
│   ├── app.js                # middleware chain, CSP, static serving, errors
│   ├── config.js             # env loading and normalisation
│   ├── cache.js              # Redis + bounded memory cache
│   ├── db.js                 # metered, cached data layer
│   ├── sessions.js           # admin sessions, CSRF, revocation
│   ├── analytics.js          # traffic, audit and runtime metrics
│   ├── events.js             # SSE hub
│   ├── youtube.js            # quota-aware multi-channel cron sync
│   ├── quota.js              # daily DB/YouTube counters
│   └── routes/               # public, admin and database routers
├── .env.example              # environment template
├── scripts/check.js          # syntax + CSS health check
├── server/data/              # channels.json (gitignored), sync state
├── view/                     # shared design system (app.css, color.css, ui.js, d74.js, motion.js)
├── index.html                # landing page
├── explore/                  # clip feed + matches + channels
├── search/                   # search page
├── livestreams/              # live TV browser
├── livehelper/player.html    # isolated Video.js live player
├── visit/                    # clip detail + download unlock
├── login/ signup/            # auth pages
├── settings/                 # theme, accent, account
├── 404/
└── Admin/                    # shell, dashboard, analytics, videos, channels,
                              # accounts, themes, monitoring, installer, editor, login
```

## Motion

The landing page loads anime.js from jsDelivr (`cdn.jsdelivr.net`, already allowed by the CSP). If the script is blocked, or the visitor has `prefers-reduced-motion` enabled, `view/motion.js` exits and the CSS/IntersectionObserver fallback in `view/ui.js` handles reveals, counters and tilt. To self-host, save `anime.min.js` into `view/` and point the script tag at it.

The admin deliberately ignores `view/ui.js` and `view/motion.js`, and `Admin/admin.css` forces `animation: none` and `transition: none` on every element.

## Credits

Built for D74 Edits. Football data via RapidAPI, video metadata via YouTube, live streams via their respective providers.
