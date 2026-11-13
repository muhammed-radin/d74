"use strict";

/* ------------------------------------------------------------------
   Admin dashboard — session guard, counts and logout.
------------------------------------------------------------------ */

(function () {
  const token = db.adminToken();
  if (!token) {
    window.location.replace("admin_login/");
    return;
  }

  function parse(xhr) {
    if (!xhr) return null;
    if (typeof xhr.json === "function") return xhr.json();
    try {
      return JSON.parse(xhr.response);
    } catch (_) {
      return null;
    }
  }

  function sessionPayload() {
    try {
      let encoded = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
      while (encoded.length % 4) encoded += "=";
      const json = atob(encoded);
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  const sessionEl = document.getElementById("statSession");
  const payload = sessionPayload();
  if (sessionEl) {
    if (payload && payload.exp) {
      const minutes = Math.max(0, Math.round((payload.exp * 1000 - Date.now()) / 60000));
      sessionEl.textContent = minutes >= 60 ? Math.round(minutes / 60) + "h left" : minutes + "m left";
    } else {
      sessionEl.textContent = "Active";
    }
  }

  const logout = document.getElementById("adminLogout");
  if (logout) {
    logout.addEventListener("click", function () {
      if (!window.confirm("End this admin session?")) return;
      db.setAdminToken("");
      window.location.replace("admin_login/");
    });
  }

  async function count(collection) {
    const xhr = await db.get(collection);
    if (xhr.status === 401) {
      db.setAdminToken("");
      window.location.replace("admin_login/");
      return null;
    }
    const data = parse(xhr);
    return Array.isArray(data) ? data.length : null;
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value == null ? "—" : String(value);
  }

  (async function loadCounts() {
    const [videos, accounts, themes] = await Promise.all([
      count("videos"),
      count("account"),
      count("themes"),
    ]);
    setText("statVideos", videos);
    setText("statAccounts", accounts);
    setText("statThemes", themes);
  })();
})();
