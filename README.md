# D74 Edits

Free football clips, highlights and 168 live TV channels — rebuilt as a fast, responsive site with a small Node server in front of every privileged API.

![D74 Edits](logo.png)

## What changed in this redesign

- **Broadcast-inspired design system** — near-black canvas, sharp borders, one lime accent, editorial typography and restrained motion. The D74 logo now appears in the navigation on every page.
- **Screen-fit hero + motion** — the landing hero uses `svh`/`lvh`/`vh` so it fills exactly one screen on mobile and desktop. anime.js drives the headline mask reveal, a staged entrance timeline, counters, scroll reveals, pointer tilt and magnetic buttons, with a reduced-motion and no-CDN fallback.
- **Responsive on every page** — landing, explore, search, live TV, clip detail, login, signup, settings, 404 and the admin dashboard.
- **No secrets in the browser** — the restdb, RapidAPI and JW Player keys now live in `.env` and are only read by `server.js`.
- **Server-side auth** — passwords are salted and hashed with scrypt. Legacy plaintext accounts are upgraded automatically on their next successful login.
- **Server-side download unlocking** — the clip password and download URL never reach the browser until the password is verified.
- **Signed admin sessions** — the old database password check and long-press backdoor are gone. Admin routes require an HMAC-signed, expiring token.

## Quick start

Requirements: **Node.js 18+** (no npm dependencies).

```bash
# 1. Install the environment file
cp .env.example .env
#    then edit .env and fill in real values

# 2. Add the live channel data (not committed — it contains DRM keys)
#    server/data/channels.json

# 3. Run
npm start
# or: node server.js
```

Open <http://localhost:3000>.

For development with automatic restarts:

```bash
npm run dev
```

### API 404s

Every `/api/*` route is provided by `server.js`. If you open the pages through a separate static preview server, the client automatically retries the Node app on port 3000 (including Codespaces and Gitpod port-forwarding). The Node process still has to be running. To point at a different backend, set a global before `view/d74.js` loads:

```html
<script>window.D74_API_BASE = "https://your-api.example.com";</script>
```

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (default `3000`). |
| `NODE_ENV` | Set to `production` to enable HSTS and hide internal errors. |
| `SESSION_SECRET` | HMAC key for admin session tokens. Use a long random value. |
| `RESTDB_BASE_URL` | restdb.io REST base, e.g. `https://your-db.restdb.io/rest`. |
| `RESTDB_API_KEY` | restdb.io API key (server only). |
| `RAPIDAPI_KEY` | RapidAPI key for YouTube and football APIs. |
| `YOUTUBE_RAPIDAPI_HOST` | YouTube API host (default `youtube-v31.p.rapidapi.com`). |
| `FOOTBALL_RAPIDAPI_HOST` | Football API host. |
| `YOUTUBE_CHANNEL_ID` | Channel used by the explore feed. |
| `JWPLAYER_KEY` | JW Player licence key used by the live player. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Administrator login. Set a strong unique password. |
| `ADMIN_SESSION_HOURS` | Admin token lifetime (default `12`). |

Generate a session secret with:

```bash
openssl rand -hex 32
```

## Channel data

`server/data/channels.json` maps channel ids to stream details:

```json
{
  "CHANNEL_ID": {
    "url": "https://example.com/live/master.mpd",
    "k1": "clear-key-id",
    "k2": "clear-key"
  }
}
```

- `.mpd` streams use the optional `k1`/`k2` ClearKey pair.
- `.m3u8` streams are played without DRM keys.
- The file is gitignored because it contains private stream and DRM configuration. Upload it to your deployment separately.

Without the file the site still runs; Live TV simply reports that channels are unavailable.

## API surface

All endpoints are served by `server.js`:

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | Health check. |
| `GET /api/config` | Public site config (includes the JW Player key used by the player iframe). |
| `GET /api/channels` | Channel `{ id, name }` list. |
| `GET /api/channels/:id` | One channel's stream details + DRM keys. |
| `POST /api/auth/signup` | Create an account (scrypt hash). |
| `POST /api/auth/login` | Verify an account. |
| `POST /api/admin/login` | Returns a signed admin token. |
| `GET/POST/PUT/DELETE /api/db/*` | Allow-listed restdb proxy. |
| `GET /api/youtube/search` | Explore feed (RapidAPI). |
| `GET /api/youtube/videos?id=` | Clip metadata (RapidAPI). |
| `GET /api/football` | Today's matches (RapidAPI). |
| `POST /api/videos/unlock` | Verifies a download password and returns the URL. |

Public `videos` responses are sanitised: `pw` and `url` are stripped unless the request carries a valid admin token.

## Security notes

- `.env`, `server/data/channels.json` and `node_modules/` are gitignored.
- Static serving blocks `server/`, `node_modules/`, dotfiles and path traversal.
- Security headers include CSP, `X-Content-Type-Options`, `X-Frame-Options`, a strict referrer policy and a permissions policy.
- Login, signup, unlock and admin login endpoints are rate limited.
- Admin tokens are signed with HMAC-SHA256 and verified with a timing-safe comparison.
- The CSP allows `'unsafe-inline'` because a few pages still use inline bootstrap scripts, and `'unsafe-eval'` because JW Player 8 requires it. Tighten these if you migrate all scripts to external files or replace the player.
- Download passwords are compared server-side with a timing-safe comparison.

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
├── server.js              # static server, API proxy, auth, security headers
├── .env.example           # environment template
├── server/data/           # channels.json (gitignored)
├── view/                  # shared design system (app.css, color.css, ui.js, d74.js, app.js)
├── index.html             # landing page
├── explore/               # clip feed + matches + channels
├── search/                # search page
├── livestreams/           # live TV browser
├── livehelper/player.html # isolated JW Player page
├── visit/                 # clip detail + download unlock
├── login/ signup/         # auth pages
├── settings/              # theme, accent, account
├── 404/
└── Admin/                 # dashboard, videos, accounts, themes, installer, editor
```

## Motion

The landing page loads anime.js from jsDelivr (`cdn.jsdelivr.net`, already allowed by the CSP). If the script is blocked, or the visitor has `prefers-reduced-motion` enabled, `view/motion.js` exits and the CSS/IntersectionObserver fallback in `view/ui.js` handles reveals, counters and tilt. To self-host, save `anime.min.js` into `view/` and point the script tag at it.

## Credits

Built for D74 Edits. Football data via RapidAPI, video metadata via YouTube, live streams via their respective providers.
