"use strict";

/* ------------------------------------------------------------------
   D74 Edits — data client
   All privileged calls go through the local server proxy; no API keys
   are ever shipped to the browser.

   The client talks to the same origin by default. When the static
   pages are opened through a separate preview server (Live Server,
   Codespaces, etc.) it automatically retries against the Node app on
   port 3000 and tells the user if neither can be reached.
------------------------------------------------------------------ */

(function (global) {
  const TOKEN_KEY = "adminToken";
  const META = document.querySelector('meta[name="d74-api-base"]');
  const CONFIGURED_BASE = String(
    global.D74_API_BASE || (META && META.content) || ""
  ).replace(/\/+$/, "");

  let apiBase = CONFIGURED_BASE;
  let fallbackAttempted = false;
  let warned = false;

  function adminToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch (_) {
      return "";
    }
  }

  function pseudoXhr(status, data) {
    const text = typeof data === "string" ? data : JSON.stringify(data);
    return {
      status: status,
      readyState: 4,
      response: text,
      responseText: text,
      ok: status >= 200 && status < 300,
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
  function devApiBase() {
    const protocol = global.location.protocol;
    const hostname = global.location.hostname;

    if (protocol === "file:") return "http://localhost:3000";

    const codespace = hostname.match(
      /^(.*)-(\d+)\.(app\.github\.dev|githubpreview\.dev)$/
    );
    if (codespace) {
      return protocol + "//" + codespace[1] + "-3000." + codespace[3];
    }

    if (hostname.endsWith(".gitpod.io")) {
      return protocol + "//3000-" + hostname;
    }

    return protocol + "//" + hostname + ":3000";
  }

  function showApiWarning() {
    if (warned || !/^https?:$/.test(global.location.protocol)) return;
    if (document.querySelector(".api-warning")) return;
    warned = true;

    const box = document.createElement("div");
    box.className = "api-warning";
    box.setAttribute("role", "status");
    box.innerHTML =
      "<div><strong>API offline</strong><p>Start the site with " +
      "<code>node server.js</code> so <code>/api</code> can respond. " +
      "If you use a separate dev server, the client retries the Node app " +
      "on port 3000 automatically.</p></div>" +
      '<button type="button" aria-label="Dismiss">×</button>';
    box.querySelector("button").addEventListener("click", function () {
      box.remove();
    });
    document.body.appendChild(box);
  }

  async function fetchOnce(path, headers, init, base) {
    let response;
    try {
      response = await fetch(base + path, init);
    } catch (_) {
      return { response: null, data: { error: "Network unavailable." }, json: false };
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
    return { response: response, data: data, json: json };
  }

  async function request(path, options = {}) {
    const headers = Object.assign(
      { Accept: "application/json" },
      options.body ? { "Content-Type": "application/json" } : {},
      options.headers || {}
    );
    const token = adminToken();
    if (token && options.admin !== false) {
      headers.Authorization = "Bearer " + token;
    }

    const init = {
      method: options.method || "GET",
      headers: headers,
      body: options.body,
      credentials: "same-origin",
      cache: "no-store",
    };

    let attempt = await fetchOnce(path, headers, init, apiBase);

    /* A static preview server answers /api/* with its own 404 page (or
       its HTML shell). Retry once against the Node app on port 3000. */
    const looksStatic = !attempt.response || !attempt.json;
    if (looksStatic && !CONFIGURED_BASE && !fallbackAttempted) {
      fallbackAttempted = true;
      const fallback = devApiBase();
      if (fallback && fallback !== global.location.origin && fallback !== apiBase) {
        apiBase = fallback;
        attempt = await fetchOnce(path, headers, init, apiBase);
      }
    }

    if (!attempt.response || !attempt.json) {
      showApiWarning();
    }

    const status = attempt.response ? attempt.response.status : 0;
    return pseudoXhr(status, attempt.data);
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

  const db = {
    Coll: Coll,
    isInited: true,
    adminToken: adminToken,

    setAdminToken(token, user) {
      try {
        if (token) {
          localStorage.setItem(TOKEN_KEY, token);
          localStorage.setItem(
            "admin",
            JSON.stringify({
              name: (user && user.name) || "admin",
              date: Date.now(),
              expaire: "-1",
            })
          );
        } else {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem("admin");
        }
      } catch (_) {}
    },

    async get(collection, finish, typeCode = 0) {
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
        admin: false,
        body: JSON.stringify({ id: id, password: password }),
      });
    },

    async login(email, password) {
      return request("/api/auth/login", {
        method: "POST",
        admin: false,
        body: JSON.stringify({ email, password }),
      });
    },

    async signup(name, email, password) {
      return request("/api/auth/signup", {
        method: "POST",
        admin: false,
        body: JSON.stringify({ name, email, password }),
      });
    },

    async adminLogin(username, password) {
      return request("/api/admin/login", {
        method: "POST",
        admin: false,
        body: JSON.stringify({ username, password }),
      });
    },

    async channels() {
      return request("/api/channels");
    },

    async channel(id) {
      return request("/api/channels/" + encodeURIComponent(id));
    },
  };

  global.db = db;
  global.D74Api = {
    request: request,
    pseudoXhr: pseudoXhr,
    base() {
      return apiBase;
    },
  };
})(window);
