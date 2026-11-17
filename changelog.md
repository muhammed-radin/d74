## ChangeLog
### 0A
- loader ui changed ( dotted border )
- structure formated [ explore page ]

### 0B
- desktop ui bug fixes 

### 0C 
- search page structure formated
- admin accounts structure formated
- admin videos structure formated and code shorted

### 0D
- created ad testing page
- added meta tag for google verification

### 0E 
- live player added

### 0F
- changed theme color blue
- replaced icons to tv icon in menu box ( footer )
- and linked live page

### 0G
- renamed folder `live` to `livehelper`
- created new page for live streams
- and linked live streaming page
- explore page title changed
- live streams page basic completed

### 0H
- created new file `blank.html` on `livehelper`
- changed url of stream iframe

### 0I
- changed font in `blank.html`
- bug fixes ( d74.js added )
- animations added

### 0J ( Major Update )
- in d74, decreased youtube video api max limitations
- created new css file for explore page animations
- increased z-index of nav bar and left box
- in settings page, changed font of heading
- ui bug fixes
- explore page d74's cards structure changed / updated 
- row and column view in explore page
- coolLoop bug fixes
- formated methods in `explore.js`

### 0K
- `explore.js` bug fix 
- at explore js: pasted data updated
- limited ui cards in explore
- styling bug fixes

### 0L
- sharable live streamings urls
- styling bug fixes 
- settings page updated

### 0M
- Added new tv live cards on explore page
- explore page basic completed

### 0N
- at search page, added helper tags ( trending searchs )

### 0P 
- blue colour theme colours updated
- icons changed

### 0Q
- explore page bug fix

### 0Q1
- user more data collected (device model)

### 0Q2
- player bug fix ( stretching )

### 0R
- accounts ui bug fixes and animation

### 0S
- using firestore for db
- multiserver app

### 0T
- `d74.js` FBDB bug fixes

### 0U 
- d74 server client bug fix

### 0V 
- formated with prettier
- removed over data collecting from user

### 0W ( Major Security & Design Update )
- redesigned every page with a new responsive design system
- added animated landing page, ambient orbs, glass cards and scroll reveals
- added `server.js` (zero dependencies) to serve files and proxy privileged APIs
- moved restdb, RapidAPI, video player and admin credentials into `.env`
- removed browser-side Firebase access and all hard-coded API keys
- passwords now hashed with scrypt; legacy accounts upgrade on next login
- download passwords verified by `POST /api/videos/unlock`; public video data no longer exposes `pw` or `url`
- admin login now uses signed, expiring session tokens; removed the old backdoor
- moved 168 channel configs out of client JS and into server-side data
- added security headers, CSP, rate limiting and path-traversal protection
- added mobile dock navigation and new login, signup, settings, clip detail and 404 pages
- added README with setup and key-rotation instructions

### 0X ( Design refinement )
- added the D74 logo to every navigation bar and drawer
- replaced ambient orbs, gradient text and glass panels with a sharper broadcast-style system
- reworked landing typography, section rhythm, ticker, feature cards, CTA and footer spacing
- added API fallback for static preview servers plus a clear offline notice
- added CORS preflight support for local development on a separate port
- refreshed 404, auth, admin shell and form styling

### 0Y ( Motion & screen-fit hero )
- made the landing hero exactly one screen tall using `vh`, `lvh` and `svh` units
- added anime.js entrance timeline with masked word reveals, staged hero copy and stage floats
- added anime-driven counters, scroll reveals, pointer tilt, stage spotlight and magnetic buttons
- added reading-progress line, rotating logo, play pulse, icon pop, shine sweep and underline hovers
- added a scroll cue, short-screen hero fallback and reduced-motion / no-CDN fallbacks

### 0Z ( Express rebuild, secure admin, analytics & caching )
- replaced the single-file server with an Express app, routers, structured logging and graceful shutdown
- added Helmet CSP, CORS origin control, cross-origin mutation guard, request ids and strict body limits
- rebuilt administrator auth as server-side sessions: httpOnly SameSite=Strict cookie, CSRF tokens, server-enforced idle + absolute expiry, UA binding, session-id regeneration, max sessions with store eviction and global revocation
- revalidates long-lived admin event streams so a revoked, logged-out or idle session cannot keep receiving privileged events
- added scrypt `ADMIN_PASSWORD_HASH` support with a plaintext fallback hashed at boot; removed the session id from every API response
- added a metered data layer with Redis/in-memory cache, stale-while-revalidate, single-flight reads and write invalidation
- added quota tracking for restdb and YouTube with optional hard stops
- added an SSE event bus and event-driven refresh for admin and public pages
- added a quota-aware multi-channel YouTube cron sync using uploads-playlist pagination instead of search
- added the admin dashboard, analytics, monitoring, videos, accounts, themes, installer and editor pages
- rebuilt the admin as a shared, responsive, completely animation-free shell with mobile navigation
- added per-address login throttling, audit trail, active-session management and cache controls
- kept `pw` and `url` out of public video responses and exposed only a computed `downloadable` flag
- added `npm run check`, a full README rewrite and an updated `.env.example`

### 10 ( AdSense ad cards )
- added designed, responsive ad cards to Explore and Live TV with `view/ads.js` and `view/ads.css`
- real AdSense `<ins>` units are used when `ADSENSE_CLIENT` and slot ids are configured
- missing configuration and local previews fall back to D74 house-ad cards; blocked scripts keep the reserved card height instead of breaking the layout
- added validated `ADSENSE_*` settings, exposed only through `GET /api/config`
- extended the CSP for AdSense scripts, ad frames and quality-check domains
- reserved card heights and a shortened live channel rail prevent layout shift on every breakpoint

### 11 ( Live channel manager )
- replaced the hardcoded catalogue with administrator-managed channel documents and removed every existing live channel
- added create, edit, hide and delete controls in **Admin → Live channels**, including multiple ordered stream sources and optional DASH ClearKey pairs
- added atomic `0600` writes, server-side validation, duplicate-id protection, audit entries, write rate limits, CSRF checks and SSE refresh events
- public channel lists return lightweight summaries; stream URLs and DRM values stay in the single-channel response used by the player
- the player now fails over between administrator-configured sources and uses the channel logo as its poster
- Explore and Live TV show admin-provided logos, metadata and honest empty states; removed fixed “168 channels” copy from the public site
