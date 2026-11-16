# D74 Edits

Free football clips, highlights and 168 live TV channels — rebuilt as a fast, responsive site behind a hardened Express server with a secure admin control room.

![D74 Edits](logo.png)

## Highlights

- **Broadcast-inspired design** — near-black canvas, sharp borders, one lime accent, editorial typography and restrained motion. The D74 logo appears in every navigation bar.
- **Scroll-driven 3D landing** — a persistent Three.js scene with a procedural PBR football, floodlight tunnel, shader-rippled goal net, instanced particles/confetti, bloom and a damped camera path. All copy, gallery cards and the video modal stay in real DOM.
- **Screen-fit hero + motion** — the landing hero uses `svh`/`lvh`/`vh` so it fills exactly one screen. GSAP + ScrollTrigger + Lenis drive the headline reveal, counters, scroll reveals and magnetic buttons, with reduced-motion and no-WebGL fallbacks.
- **Responsive everywhere** — public pages and the admin all work from 360 px phones to wide desktops.
- **No secrets in the browser** — restdb, RapidAPI, JW Player and admin credentials live in `.env` and are only read by the Node process.
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

# 3. Add the live channel data (gitignored — it contains DRM keys)
#    server/data/channels.json

# 4. Landing page dev server (Vite, hot reload)
npm run dev
# open http://localhost:5173

# 5. API / full site server (Express, auto-restart)
npm run dev:api
# open http://localhost:3005
```

Production build and serve:

```bash
npm run build   # writes dist/
npm start       # Express serves dist/ first, then the legacy pages
```

The admin control room is at <http://localhost:3005/Admin/>.

Verify every JavaScript and CSS file without starting anything:

```bash
npm run check
```

## 3D landing experience

The landing page is a Vite + vanilla JavaScript app with a persistent Three.js scene behind semantic HTML. The scene uses a baked PMREM environment for ball/goal reflections, a procedural PBR football with seam bump and contact shadow, a sagging shader net, instanced crowd and LED boards, volumetric floodlights, dust/confetti/fireworks and a damped camera path with a goal-side impact shake.

```text
index.html                  landing markup, SEO and accessible content
src/config/site.js          copy, nav, video cards, quality tiers
src/main.js                 boot sequence and feature wiring
src/scene/                  renderer, ball, pitch, stadium, particles, post FX
src/shaders/                glow, floodlight, net and post-processing shaders
src/sections/               preloader, scroll, text, gallery, modal, cursor
src/styles/main.css         landing design system and responsive rules
```

### Replace the copy and videos

- **Copy:** edit `src/config/site.js` (`hero`, `kickoff`, `pitch`, `showcase`, `stats`, `final`, `footer`).
- **Video cards:** edit `site.videos`. Each item needs `title`, `category`, `meta`, `description`, `poster`, `sources` and `accent`. The sample clips are free-licensed Mixkit stock footage; swap in your own MP4/WebM sources.
- **Navigation:** edit `site.nav`. The footer links are in `site.footer.links`.
- **Brand colours:** edit the tokens at the top of `src/styles/main.css` (`--accent`, `--accent-2`, `--accent-3`, `--bg`).

### Replace the procedural 3D assets

- **2D / 3D switch:** the navbar has a `BG 3D / 2D` control. 2D is always the initial background and is a plain, static dark background with no 2D animation or effects. 3D lazy-loads the Three.js scene only when selected for the current visit; reloading returns to 2D.
- **Football texture:** `src/scene/textures.js` → `createBallTextures()`. It builds a real spherical truncated-icosahedron panel layout and returns colour, normal and roughness maps. Replace it with your own texture set if you have one.
- **Pitch texture:** `createPitchTexture()` in the same file. Swap it for a photographed turf map or your own line-marking texture.
- **Ball material:** `src/scene/Ball.js` → `MeshPhysicalMaterial`. Add normal/roughness maps there.
- **Net:** `src/shaders/net.js` is a vertex-rippled grid shader. The shot progress and hit point are driven from `src/scene/Experience.js`.
- **Particles/confetti/fireworks:** `src/scene/Dust.js`, `Confetti.js`, `Fireworks.js`. Counts come from `site.quality`.

### Tweak the scroll timeline

`src/scene/Experience.js` owns the camera and ball timeline.

- `cameraCurve` — Catmull-Rom camera path. Each point is a scroll section (hero → tunnel → pitch → feed → stats → final).
- `lookCurve` — matching look-at targets.
- `Ball.update()` — ball position by scroll progress. The key ranges are: hero `0–0.12`, tunnel `0.12–0.28`, approach `0.28–0.36`, shot `0.36–0.50`, net reaction `0.50–0.62`, hidden `0.62–0.84`, final rise `0.84–1.0`.
- `Pitch.update()` — net ripple window (`0.46–0.56`).
- `Confetti` / `Fireworks` activate at `0.86` / `0.875`.

Scroll progress is normalised from the whole document by `src/sections/scroll.js`. To change section timing, move the corresponding curve points or remap `p` inside `Experience.update()`.

### Performance and accessibility

- Quality tiers live in `site.quality` (`low`, `medium`, `high`). `src/utils/quality.js` picks an initial tier from pointer type, viewport, CPU cores, memory and network. `QualityManager` steps down automatically if measured FPS stays below 45.
- Pixel ratio is capped at the tier value (`1.25` low, `1.5` medium, `2` high) and at `1.5` on mobile.
- Mobile bloom is capped at `0.28` strength with a higher threshold; low-tier mobile disables post-processing entirely.
- Post-processing, shadows, particle density and confetti are tier-controlled.
- `prefers-reduced-motion` skips Lenis, skips the WebGL scene and shows the static SVG fallback with all content intact.
- No WebGL (or a scene boot failure) shows `public/hero-fallback.svg`; the HTML content is never hidden behind the canvas. The default 2D mode remains plain dark and works without WebGL.
- Gallery cards are real DOM buttons for SEO, keyboard access and screen readers; the 3D depth/tilt is CSS 3D. The video modal is a native `<dialog>`.
- The landing CSS is inlined into the document head by a small Vite plugin, so there is no unstyled first paint and no extra render-blocking CSS request.
- The preloader waits for `window.load` and fonts with a 2.6s cap, then reveals the hero copy. The WebGL chunk is dynamically imported after the first paint.

### Deploy

- **Express:** `npm run build && npm start`. `server/app.js` serves `dist/` first and falls back to the existing public pages.
- **Static host:** `npm run build`, then upload `dist/`. Set `base` in `vite.config.mjs` if the site is hosted under a sub-path.
- **CDN/cache:** hashed assets are in `dist/assets/`; HTML is sent with `no-cache`. The remote sample videos and Google Fonts are external; self-host them if you need a fully offline build.

### Optional upgrades

- Stadium ambience and UI sounds via Web Audio (mute by default).
- A goal-celebration easter egg: confetti + net ripple + camera shake triggered by the final CTA.
- WebGPU renderer (`three/webgpu`) with a WebGL fallback.
- Draco-compressed geometry and KTX2 textures for heavier hero assets.
- HDR environment maps for more realistic ball reflections.
- Per-card video textures in the Three.js scene (keep the DOM gallery as the accessible layer).
- A/B test the hero headline and CTA from `site.js` with your analytics tool.

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
| Expiry | Idle timeout plus an absolute lifetime; the CSRF token rotates periodically and the session id is regenerated on demand. |
| Binding | User-agent bound by default (IP binding optional). |
| Limits | Per-address and per-username login throttling, global API limits and write limits. |
| Revocation | Revoke one session or every other session; a global revocation epoch invalidates old cookies instantly. |
| Audit | Logins, logouts, revocations, syncs, cache clears and database writes are recorded. |

The admin shell, dashboard, analytics, videos, accounts, themes, monitoring, installer and editor all share one responsive, animation-free interface. The browser only ever holds the session cookie and an in-memory CSRF token — never the session id.

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
| `JWPLAYER_KEY` | JW Player licence key used by the live player. |
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

## API surface

All endpoints are served by the Express app.

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | Health check. |
| `GET /api/config` | Public site config (includes the JW Player key used by the player iframe). |
| `GET /api/channels` | Channel `{ id, name }` list. |
| `GET /api/channels/:id` | One channel's stream details + DRM keys. |
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
- Helmet sets CSP, `X-Content-Type-Options`, `X-Frame-Options`, a strict referrer policy and a permissions policy. The CSP keeps `'unsafe-eval'` and the JW Player CDN because JW Player 8 requires them.
- Login, signup, unlock, admin login and YouTube endpoints are rate limited.
- API responses are `no-store`; public cached database responses use a short `max-age`/`stale-while-revalidate` window.
- Download passwords are compared server-side with a timing-safe comparison.
- Legacy plaintext accounts are upgraded to scrypt on their next successful login.

### ⚠️ Rotate every key

Earlier versions of this project committed real credentials to git. Deleting them from the current files does **not** remove them from git history. Before deploying:

1. Rotate the restdb.io API key.
2. Rotate the RapidAPI key.
3. Rotate/reissue the JW Player licence key.
4. Change the admin password.
5. Generate a fresh `SESSION_SECRET`.
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
│   ├── sessions.js           # admin sessions, CSRF, revocation
│   ├── analytics.js          # traffic, audit and runtime metrics
│   ├── events.js             # SSE hub
│   ├── youtube.js            # quota-aware multi-channel cron sync
│   ├── quota.js              # daily DB/YouTube counters
│   └── routes/               # public, admin and database routers
├── .env.example              # environment template
├── scripts/check.js          # syntax + CSS health check
├── server/data/              # channels.json (gitignored), sync state
├── src/                      # Vite 3D landing app (scene, sections, shaders, styles)
├── public/                   # static landing assets and fallback artwork
├── dist/                     # `npm run build` output, served by Express
├── view/                     # shared design system for the legacy public pages
├── index.html                # Vite landing page
├── explore/                  # clip feed + matches + channels
├── search/                   # search page
├── livestreams/              # live TV browser
├── livehelper/player.html    # isolated JW Player page
├── visit/                    # clip detail + download unlock
├── login/ signup/            # auth pages
├── settings/                 # theme, accent, account
├── 404/
└── Admin/                    # shell, dashboard, analytics, videos, accounts,
                              # themes, monitoring, installer, editor, login
```

## Motion

The landing page uses GSAP + ScrollTrigger and Lenis for damped scrolling, with a single Three.js scene behind the HTML. Text reveals, counters, gallery rotation and the modal are real DOM interactions. The WebGL scene is dynamically imported and starts after the preloader; if it fails or WebGL is unavailable, the static SVG fallback and all copy remain.

The legacy public pages still use `view/ui.js` and `view/motion.js` (anime.js). The admin deliberately ignores both, and `Admin/admin.css` forces `animation: none` and `transition: none` on every element.

## Credits

Built for D74 Edits. Football data via RapidAPI, video metadata via YouTube, live streams via their respective providers.
