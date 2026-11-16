"use strict";

/* ------------------------------------------------------------------
   D74 Edits — data client
   All privileged calls go through the local server proxy; no API keys
   are ever shipped to the browser.

   Administrator auth is a server-side session stored in an httpOnly,
   SameSite=Strict cookie. The browser never sees the session id. A CSRF
   token is kept in memory and refreshed from /api/admin/session.

   When the static pages are opened through a separate preview server
   (Live Server, Codespaces, etc.) the client retries the Node app and
   tells the user if neither can be reached.
------------------------------------------------------------------ */

(function (global) {
  const META = document.querySelector('meta[name="d74-api-base"]');
  const CONFIGURED_BASE = String(
    global.D74_API_BASE || (META && META.content) || ""
  ).replace(/\/+$/, "");

  const state = {
    apiBase: CONFIGURED_BASE,
    fallbackIndex: 0,
    fallbackAttempted: false,
    warned: false,
    csrfToken: "",
    admin: null,
    refreshing: null,
  };

  function adminToken() {
    // Legacy guard helper. The real credential is the httpOnly cookie.
    return state.csrfToken || "";
  }

  function csrfToken() {
    return state.csrfToken;
  }

  function setCsrfToken(token) {
    state.csrfToken = String(token || "");
    return state.csrfToken;
  }

  function pseudoXhr(status, data, headers) {
    const text = typeof data === "string" ? data : JSON.stringify(data);
    const headerMap = headers || {};
    return {
      status: status,
      readyState: 4,
      response: text,
      responseText: text,
      ok: status >= 200 && status < 300,
      headers: headerMap,
      getResponseHeader(name) {
        return headerMap[String(name).toLowerCase()] || null;
      },
      json() {
        try {
          return JSON.parse(text);
        } catch (_) {
          return null;
        }
      },
    };
  }

  /* Work out where the Node backend lives when this page is served by
     a different dev/preview server. Handles localhost and the common
     port-forwarded hosts used by Codespaces and Gitpod. */
  function devApiPorts() {
    const metaPort = document.querySelector('meta[name="d74-api-port"]');
    const ports = [];
    if (metaPort && metaPort.content) ports.push(String(metaPort.content).trim());
    ports.push("3005", "3000");
    return Array.from(new Set(ports.filter(Boolean)));
  }

  function devApiBases() {
    const protocol = global.location.protocol;
    const hostname = global.location.hostname;

    if (protocol === "file:") {
      return devApiPorts().map((port) => "http://localhost:" + port);
    }

    const bases = [];
    const codespace = hostname.match(
      /^(.*)-(\d+)\.(app\.github\.dev|githubpreview\.dev|codespaces\.app)$/
    );
    if (codespace) {
      for (const port of devApiPorts()) {
        bases.push(protocol + "//" + codespace[1] + "-" + port + "." + codespace[3]);
      }
      return bases;
    }

    if (hostname.endsWith(".gitpod.io")) {
      for (const port of devApiPorts()) {
        bases.push(protocol + "//" + port + "-" + hostname);
      }
      return bases;
    }

    for (const port of devApiPorts()) {
      bases.push(protocol + "//" + hostname + ":" + port);
    }
    return bases;
  }

  function showApiWarning() {
    if (state.warned || !/^https?:$/.test(global.location.protocol)) return;
    if (document.querySelector(".api-warning")) return;
    state.warned = true;

    const box = document.createElement("div");
    box.className = "api-warning";
    box.setAttribute("role", "status");
    box.innerHTML =
      "<div><strong>API offline</strong><p>Start the site with " +
      "<code>node server.js</code> so <code>/api</code> can respond. " +
      "If you use a separate dev server, the client retries the Node app " +
      "automatically.</p></div>" +
      '<button type="button" aria-label="Dismiss">×</button>';
    box.querySelector("button").addEventListener("click", function () {
      box.remove();
    });
    document.body.appendChild(box);
  }

  function requestUrl(path, base) {
    if (!base) return path;
    return base.replace(/\/+$/, "") + path;
  }

  async function fetchOnce(path, init, base) {
    let response;
    try {
      response = await fetch(requestUrl(path, base), init);
    } catch (_) {
      return { response: null, data: { error: "Network unavailable." }, json: false, headers: {} };
    }

    const headers = {};
    if (response.headers && typeof response.headers.forEach === "function") {
      response.headers.forEach((value, key) => {
        headers[String(key).toLowerCase()] = value;
      });
    }
    const text = await response.text();
    let data;
    let json = false;
    try {
      data = text ? JSON.parse(text) : {};
      json = true;
    } catch (_) {
      data = text;
    }
    return { response, data, json, headers };
  }

  function shouldTryFallback(attempt) {
    if (!attempt.response) return true;
    if (attempt.json) return false;
    return attempt.response.status === 404 || attempt.response.status === 405;
  }

  function needsCsrf(path, method) {
    const verb = String(method || "GET").toUpperCase();
    if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") return false;
    return path.startsWith("/api/db/") || path.startsWith("/api/admin/");
  }

  async function refreshSession() {
    if (state.refreshing) return state.refreshing;
    state.refreshing = (async () => {
      const attempt = await fetchOnce("/api/admin/session", baseInit(), state.apiBase);
      if (attempt.response && attempt.response.ok && attempt.json) {
        const body = attempt.data || {};
        state.admin = body.admin || null;
        if (body.admin && body.admin.csrfToken) setCsrfToken(body.admin.csrfToken);
        else if (body.csrfToken) setCsrfToken(body.csrfToken);
      } else {
        state.admin = null;
        setCsrfToken("");
      }
      return state.admin;
    })().finally(() => {
      state.refreshing = null;
    });
    return state.refreshing;
  }

  function baseInit() {
    return {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
      cache: "no-store",
    };
  }

  async function request(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = Object.assign(
      { Accept: "application/json" },
      options.body ? { "Content-Type": "application/json" } : {},
      options.headers || {}
    );

    if (options.csrf !== false && needsCsrf(path, method) && state.csrfToken) {
      headers["X-CSRF-Token"] = state.csrfToken;
    }

    const init = {
      method,
      headers,
      body: options.body,
      credentials: "include",
      cache: "no-store",
    };

    let attempt = await fetchOnce(path, init, state.apiBase);

    /* A static preview server answers /api/* with its own 404 page (or
       its HTML shell). Retry against the Node app on a dev port. */
    if (
      shouldTryFallback(attempt) &&
      !CONFIGURED_BASE &&
      !state.fallbackAttempted
    ) {
      state.fallbackAttempted = true;
      let bases = devApiBases();
      if (state.apiBase) bases = bases.filter((base) => base !== state.apiBase);
      if (global.location.origin) bases = bases.filter((base) => base !== global.location.origin);
      for (const base of bases) {
        const retry = await fetchOnce(path, init, base);
        if (retry.response && (retry.json || retry.response.ok)) {
          attempt = retry;
          state.apiBase = base;
          break;
        }
      }
    }

    if (!attempt.response || !attempt.json) {
      showApiWarning();
    }

    // A rotated CSRF token or an expired session gets one transparent retry.
    if (
      attempt.response &&
      attempt.response.status === 403 &&
      attempt.json &&
      attempt.data &&
      attempt.data.code === "csrf" &&
      !options._csrfRetry &&
      path.startsWith("/api/admin/")
    ) {
      await refreshSession();
      return request(path, { ...options, _csrfRetry: true });
    }

    if (
      attempt.response &&
      attempt.response.status === 401 &&
      path.startsWith("/api/admin/") &&
      options.sessionCheck !== false
    ) {
      state.admin = null;
      setCsrfToken("");
    }

    const status = attempt.response ? attempt.response.status : 0;
    return pseudoXhr(status, attempt.data, attempt.headers);
  }

  function normalizeCollection(collection) {
    if (collection && collection.collection) {
      const query = collection.queryObj;
      let path = collection.collection;
      if (query && Object.keys(query).length) {
        path += "?q=" + encodeURIComponent(JSON.stringify(query));
      }
      return path;
    }
    return String(collection || "");
  }

  function normalizeBody(data) {
    if (data === undefined || data === null) return undefined;
    if (typeof data === "string") return data;
    return JSON.stringify(data);
  }

  class Coll {
    constructor(collection, queryObj) {
      this.collection = collection;
      this.queryObj = queryObj || {};
    }
    hasQuery() {
      return Object.keys(this.queryObj).length > 0;
    }
    toQURL() {
      let value = this.collection;
      if (this.hasQuery()) {
        value += "?q=" + encodeURIComponent(JSON.stringify(this.queryObj));
      }
      return value;
    }
  }

  /* --------------------------- SSE --------------------------- */

  function subscribeEvents(handlers = {}) {
    if (typeof global.EventSource !== "function") return null;

    const source = new EventSource(requestUrl("/api/events", state.apiBase), {
      withCredentials: true,
    });

    source.onopen = function () {
      if (typeof handlers.onOpen === "function") handlers.onOpen();
    };

    source.onerror = function () {
      if (typeof handlers.onError === "function") handlers.onError();
    };

    source.onmessage = function (message) {
      let event = null;
      try {
        event = JSON.parse(message.data);
      } catch (_) {
        return;
      }
      if (!event || !event.type) return;
      if (typeof handlers.onEvent === "function") handlers.onEvent(event);
      if (typeof handlers[event.type] === "function") handlers[event.type](event);
    };

    return {
      source,
      close() {
        try {
          source.close();
        } catch (_) {}
      },
    };
  }

  /* ------------------------- admin API ------------------------ */

  function adminGet(path) {
    return request(path, { sessionCheck: false });
  }

  const db = {
    Coll: Coll,
    isInited: true,
    adminToken: adminToken,
    csrfToken: csrfToken,
    setCsrfToken: setCsrfToken,

    setAdminToken(token) {
      // Kept for compatibility with older pages. Auth now lives in the
      // httpOnly session cookie; passing an empty value clears local state.
      if (token) return;
      state.admin = null;
      setCsrfToken("");
    },

    session() {
      return refreshSession();
    },

    currentAdmin() {
      return state.admin;
    },

    async get(collection, finish) {
      const result = await request("/api/db/" + normalizeCollection(collection));
      if (typeof finish === "function") finish(result);
      return result;
    },

    async post(collection, data, finish) {
      const result = await request("/api/db/" + normalizeCollection(collection), {
        method: "POST",
        body: normalizeBody(data),
      });
      if (typeof finish === "function") finish(result);
      return result;
    },

    async push(collection, data, finish) {
      return this.post(collection, data, finish);
    },

    async put(collection, data, finish) {
      const result = await request("/api/db/" + normalizeCollection(collection), {
        method: "PUT",
        body: normalizeBody(data),
      });
      if (typeof finish === "function") finish(result);
      return result;
    },

    async remove(collection, finish) {
      const result = await request("/api/db/" + normalizeCollection(collection), {
        method: "DELETE",
      });
      if (typeof finish === "function") finish(result);
      return result;
    },

    getYTchannelVideos(onfinish, pageTkn = false) {
      const query = pageTkn ? "?pageToken=" + encodeURIComponent(pageTkn) : "";
      request("/api/youtube/search" + query).then(function (result) {
        if (typeof onfinish === "function") onfinish(result);
      });
    },

    getLiveAndHL(callback) {
      request("/api/football").then(function (result) {
        if (typeof callback === "function") callback(result);
      });
    },

    getVideo(id) {
      return request("/api/youtube/videos?id=" + encodeURIComponent(id));
    },

    unlockClip(id, password) {
      return request("/api/videos/unlock", {
        method: "POST",
        csrf: false,
        body: JSON.stringify({ id: id, password: password }),
      });
    },

    async login(email, password) {
      return request("/api/auth/login", {
        method: "POST",
        csrf: false,
        body: JSON.stringify({ email, password }),
      });
    },

    async signup(name, email, password) {
      return request("/api/auth/signup", {
        method: "POST",
        csrf: false,
        body: JSON.stringify({ name, email, password }),
      });
    },

    async adminLogin(username, password) {
      const result = await request("/api/admin/login", {
        method: "POST",
        csrf: false,
        sessionCheck: false,
        body: JSON.stringify({ username, password }),
      });
      if (result.ok) {
        const body = result.json() || {};
        state.admin = body.admin || null;
        setCsrfToken(body.csrfToken || (body.admin && body.admin.csrfToken) || "");
      }
      return result;
    },

    async adminLogout() {
      const result = await request("/api/admin/logout", {
        method: "POST",
        sessionCheck: false,
      });
      state.admin = null;
      setCsrfToken("");
      return result;
    },

    adminSession() {
      return adminGet("/api/admin/session");
    },

    adminDashboard() {
      return adminGet("/api/admin/dashboard");
    },

    adminAnalytics(range = "24h") {
      return adminGet("/api/admin/analytics?range=" + encodeURIComponent(range));
    },

    adminMonitoring() {
      return adminGet("/api/admin/monitoring");
    },

    adminAudit(limit = 60) {
      return adminGet("/api/admin/audit?limit=" + encodeURIComponent(limit));
    },

    adminSessions() {
      return adminGet("/api/admin/sessions");
    },

    adminRevokeSession(key) {
      return request("/api/admin/sessions/" + encodeURIComponent(key), {
        method: "DELETE",
        sessionCheck: false,
      });
    },

    adminRevokeAll() {
      return request("/api/admin/sessions", {
        method: "DELETE",
        sessionCheck: false,
      });
    },

    adminYoutubeStatus() {
      return adminGet("/api/admin/youtube/status");
    },

    adminYoutubeSync(options = {}) {
      return request("/api/admin/youtube/sync", {
        method: "POST",
        sessionCheck: false,
        body: normalizeBody(options),
      });
    },

    adminCacheClear() {
      return request("/api/admin/cache/clear", {
        method: "POST",
        sessionCheck: false,
      });
    },

    adminVideos(params = {}) {
      const search = new URLSearchParams();
      if (params.q) search.set("q", params.q);
      if (params.offset != null) search.set("offset", String(params.offset));
      if (params.limit != null) search.set("limit", String(params.limit));
      const query = search.toString();
      return adminGet("/api/admin/videos" + (query ? "?" + query : ""));
    },

    adminAccounts() {
      return adminGet("/api/admin/accounts");
    },

    adminThemes() {
      return adminGet("/api/admin/themes");
    },

    async channels() {
      return request("/api/channels");
    },

    async channel(id) {
      return request("/api/channels/" + encodeURIComponent(id));
    },

    subscribeEvents: subscribeEvents,
  };

  global.db = db;
  global.D74Api = {
    request: request,
    pseudoXhr: pseudoXhr,
    refreshSession: refreshSession,
    subscribeEvents: subscribeEvents,
    base() {
      return state.apiBase;
    },
  };
})(window);
