"use strict";

/* ------------------------------------------------------------------
   D74 Edits — admin shell
   Shared chrome, session guard, mobile navigation, toasts, charts and
   the SSE bridge. No animation or transition is used anywhere here.
------------------------------------------------------------------ */

(function (global) {
  const script = document.currentScript;
  const ADMIN_BASE = script
    ? new URL(".", script.src).pathname.replace(/\/+$/, "") + "/"
    : "/Admin/";
  const LOGIN_URL = ADMIN_BASE + "admin_login/";
  const PAGE = document.body.dataset.adminPage || "dashboard";
  const TITLE = document.body.dataset.adminTitle || "Control room";

  const NAV = [
    { id: "dashboard", label: "Dashboard", href: ADMIN_BASE, icon: "grid-outline" },
    { id: "analytics", label: "Analytics", href: ADMIN_BASE + "analytics/", icon: "stats-chart-outline" },
    { id: "videos", label: "Videos", href: ADMIN_BASE + "videos/", icon: "videocam-outline" },
    { id: "sync", label: "Bulk sync", href: ADMIN_BASE + "sync/", icon: "cloud-download-outline" },
    { id: "channels", label: "Live channels", href: ADMIN_BASE + "channels/", icon: "tv-outline" },
    { id: "accounts", label: "Accounts", href: ADMIN_BASE + "accounts/", icon: "people-outline" },
    { id: "themes", label: "Themes", href: ADMIN_BASE + "themes/", icon: "color-palette-outline" },
    { id: "monitoring", label: "Monitoring", href: ADMIN_BASE + "monitoring/", icon: "pulse-outline" },
  ];

  const TOOLS = [
    { id: "install", label: "Installer", href: ADMIN_BASE + "init/", icon: "cloud-upload-outline" },
    { id: "editor", label: "Editor", href: ADMIN_BASE + "edit_video/", icon: "create-outline" },
  ];

  const state = {
    ready: false,
    session: null,
    readyCallbacks: [],
    eventHandlers: new Set(),
    stream: null,
    redirecting: false,
    expiresAt: 0,
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function redirectToLogin(reason) {
    if (state.redirecting) return;
    state.redirecting = true;
    const next = encodeURIComponent(global.location.pathname + global.location.search);
    const suffix = reason ? "?reason=" + encodeURIComponent(reason) + "&next=" + next : "?next=" + next;
    global.location.replace(LOGIN_URL + suffix);
  }

  function navMarkup(items, active) {
    return items
      .map(
        (item) =>
          '<a class="admin-nav-link' + (item.id === active ? " is-active" : "") + '" href="' +
          item.href + '"' + (item.id === active ? ' aria-current="page"' : "") + ">" +
          '<ion-icon name="' + item.icon + '" aria-hidden="true"></ion-icon>' +
          "<span>" + item.label + "</span>" +
          "</a>"
      )
      .join("");
  }

  function shellMarkup() {
    return (
      '<div class="admin-shell" id="adminShell">' +
      '<div class="admin-scrim" data-shell-close hidden></div>' +
      '<aside class="admin-side" id="adminSide" aria-label="Administration">' +
      '<a class="admin-brand" href="' + ADMIN_BASE + '">' +
      '<span class="admin-brand-logo"><img src="/logo.png" alt=""></span>' +
      '<span class="admin-brand-text"><strong>D74 Edits</strong><small>Control room</small></span>' +
      "</a>" +
      '<nav class="admin-nav" aria-label="Main">' +
      '<span class="admin-nav-label">Overview</span>' +
      navMarkup(NAV, PAGE) +
      '<span class="admin-nav-label">Content tools</span>' +
      navMarkup(TOOLS, PAGE) +
      "</nav>" +
      '<div class="admin-side-foot">' +
      '<a class="admin-side-link" href="/" target="_blank" rel="noopener">' +
      '<ion-icon name="open-outline" aria-hidden="true"></ion-icon><span>Open public site</span></a>' +
      '<span class="admin-side-meta" id="adminShellMeta">Session loading…</span>' +
      "</div>" +
      "</aside>" +
      '<div class="admin-main">' +
      '<header class="admin-top">' +
      '<button class="admin-menu" type="button" data-shell-menu aria-expanded="false" aria-controls="adminSide" aria-label="Toggle navigation">' +
      '<ion-icon name="menu-outline" aria-hidden="true"></ion-icon>' +
      "</button>" +
      '<div class="admin-top-title"><span class="admin-eyebrow">Admin</span><h1>' + escapeHtml(TITLE) + "</h1></div>" +
      '<div class="admin-top-actions">' +
      '<span class="admin-session-pill" id="adminSessionPill" hidden></span>' +
      '<span class="admin-user"><span class="admin-avatar" id="adminAvatar">A</span><span id="adminName">admin</span></span>' +
      '<button class="admin-signout" type="button" data-shell-logout>Sign out</button>' +
      "</div>" +
      "</header>" +
      '<main class="admin-content" id="adminMain" tabindex="-1"></main>' +
      "</div>" +
      "</div>" +
      '<div class="admin-toasts" id="adminToasts" role="status" aria-live="polite"></div>'
    );
  }

  function mount() {
    const root = document.getElementById("adminRoot");
    if (root) root.innerHTML = shellMarkup();

    const template = document.getElementById("adminPage");
    const main = document.getElementById("adminMain");
    if (template && template instanceof HTMLTemplateElement && main) {
      main.appendChild(template.content.cloneNode(true));
      template.remove();
    }

    const menu = document.querySelector("[data-shell-menu]");
    const shell = document.getElementById("adminShell");
    const scrim = document.querySelector("[data-shell-close]");
    const closeMenu = () => {
      shell.classList.remove("is-open");
      if (scrim) scrim.hidden = true;
      if (menu) menu.setAttribute("aria-expanded", "false");
    };

    if (menu && shell) {
      menu.addEventListener("click", () => {
        const open = !shell.classList.contains("is-open");
        shell.classList.toggle("is-open", open);
        if (scrim) scrim.hidden = !open;
        menu.setAttribute("aria-expanded", String(open));
      });
    }
    if (scrim) scrim.addEventListener("click", closeMenu);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });
    document.querySelectorAll(".admin-nav-link").forEach((link) => {
      link.addEventListener("click", closeMenu);
    });

    const logout = document.querySelector("[data-shell-logout]");
    if (logout) {
      logout.addEventListener("click", async () => {
        logout.disabled = true;
        try {
          await db.adminLogout();
        } catch (_) {}
        global.location.replace(LOGIN_URL);
      });
    }
  }

  function setSessionChrome(session) {
    const name = (session && (session.name || session.username)) || "admin";
    const nameEl = document.getElementById("adminName");
    const avatar = document.getElementById("adminAvatar");
    const pill = document.getElementById("adminSessionPill");
    const meta = document.getElementById("adminShellMeta");
    if (nameEl) nameEl.textContent = name;
    if (avatar) avatar.textContent = String(name).slice(0, 1).toUpperCase();
    state.expiresAt = session && session.expiresAt ? new Date(session.expiresAt).getTime() : 0;
    if (meta) {
      meta.textContent = session && session.expiresAt
        ? "Session until " + new Date(session.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "Local memory session";
    }
    if (pill) {
      pill.hidden = false;
      pill.textContent = "Secure session";
    }
    updateCountdown();
  }

  function updateCountdown() {
    const pill = document.getElementById("adminSessionPill");
    if (!pill || !state.expiresAt) return;
    const minutes = Math.max(0, Math.round((state.expiresAt - Date.now()) / 60000));
    pill.textContent = minutes > 0 ? minutes + "m left" : "expiring";
  }

  async function guard() {
    const result = await db.adminSession();
    if (!result || result.status === 401) {
      redirectToLogin("expired");
      return false;
    }
    if (!result.ok) {
      // A network hiccup should not destroy a working session.
      const body = result.json() || {};
      toast(body.error || "Could not verify the administrator session.", "error");
      return false;
    }
    const body = result.json() || {};
    state.session = (body.admin) || null;
    if (!state.session) {
      redirectToLogin("expired");
      return false;
    }
    if (state.session.csrfToken) db.setCsrfToken(state.session.csrfToken);
    setSessionChrome(state.session);
    return true;
  }

  function startEvents() {
    if (state.stream || typeof db.subscribeEvents !== "function") return;
    state.stream = db.subscribeEvents({
      onEvent(event) {
        state.eventHandlers.forEach((handler) => {
          try {
            handler(event);
          } catch (_) {}
        });
        if (event.type === "security:revoked" || event.type === "security:revoked-all" || event.type === "security:login") {
          db.adminSession().then((result) => {
            if (result && result.status === 401) redirectToLogin("revoked");
          }).catch(() => {});
        }
      },
    });
  }

  function toast(message, tone) {
    const host = document.getElementById("adminToasts");
    if (!host) return;
    const item = document.createElement("div");
    item.className = "admin-toast" + (tone ? " admin-toast--" + tone : "");
    item.innerHTML = "<span>" + escapeHtml(message) + "</span>";
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss");
    close.textContent = "×";
    close.addEventListener("click", () => item.remove());
    item.appendChild(close);
    host.appendChild(item);
    setTimeout(() => item.remove(), 7000);
  }

  function onReady(callback) {
    if (typeof callback !== "function") return;
    if (state.ready) callback(state.session);
    else state.readyCallbacks.push(callback);
  }

  function onEvent(handler) {
    if (typeof handler === "function") state.eventHandlers.add(handler);
    return () => state.eventHandlers.delete(handler);
  }

  function number(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "—";
    return numeric.toLocaleString();
  }

  function date(value, options) {
    if (!value) return "—";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleString([], options || { dateStyle: "medium", timeStyle: "short" });
  }

  function timeAgo(value) {
    if (!value) return "never";
    const diff = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(diff)) return "—";
    const minutes = Math.round(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return minutes + "m ago";
    const hours = Math.round(minutes / 60);
    if (hours < 24) return hours + "h ago";
    return Math.round(hours / 24) + "d ago";
  }

  function bytes(mb) {
    return Number(mb || 0) + " MB";
  }

  /* ----------------------------- charts ----------------------------- */

  const SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs || {})) {
      node.setAttribute(key, String(value));
    }
    return node;
  }

  function lineChart(host, series, options = {}) {
    if (!host) return;
    const rows = Array.isArray(series) ? series.slice() : [];
    host.innerHTML = "";
    const width = Math.max(320, host.clientWidth || 640);
    const height = options.height || 190;
    const pad = { top: 16, right: 14, bottom: 24, left: 34 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const svg = svgEl("svg", {
      viewBox: "0 0 " + width + " " + height,
      width: "100%",
      height: height,
      role: "img",
      "aria-label": options.label || "Traffic chart",
      preserveAspectRatio: "none",
    });

    if (!rows.length) {
      const text = svgEl("text", {
        x: width / 2,
        y: height / 2,
        "text-anchor": "middle",
        fill: "var(--muted)",
        "font-size": "12",
      });
      text.textContent = options.empty || "No data yet";
      svg.appendChild(text);
      host.appendChild(svg);
      return;
    }

    const primaryKey = options.value || "requests";
    const secondaryKey = options.secondary || "errors";
    const values = rows.map((row) => Number(row[primaryKey]) || 0);
    const secondary = secondaryKey ? rows.map((row) => Number(row[secondaryKey]) || 0) : [];
    const peak = Math.max(1, ...values, ...secondary);
    const step = rows.length > 1 ? plotW / (rows.length - 1) : plotW;

    const x = (index) => pad.left + (rows.length > 1 ? index * step : plotW / 2);
    const y = (value) => pad.top + plotH - (Number(value) / peak) * plotH;

    // Horizontal grid lines and labels.
    for (let line = 0; line <= 3; line += 1) {
      const value = (peak / 3) * line;
      const lineY = y(value);
      svg.appendChild(
        svgEl("line", {
          x1: pad.left,
          x2: width - pad.right,
          y1: lineY,
          y2: lineY,
          stroke: "var(--border)",
          "stroke-width": "1",
        })
      );
      const label = svgEl("text", {
        x: pad.left - 6,
        y: lineY + 3,
        "text-anchor": "end",
        fill: "var(--muted)",
        "font-size": "9",
        "font-family": "var(--font-mono)",
      });
      label.textContent = Math.round(value);
      svg.appendChild(label);
    }

    const pathFor = (list) =>
      list
        .map((value, index) => (index === 0 ? "M" : "L") + x(index).toFixed(1) + " " + y(value).toFixed(1))
        .join(" ");

    if (secondaryKey) {
      svg.appendChild(
        svgEl("path", {
          d: pathFor(secondary),
          fill: "none",
          stroke: "var(--danger)",
          "stroke-width": "1.4",
          "stroke-linejoin": "round",
          "stroke-linecap": "round",
          opacity: "0.9",
        })
      );
    }

    const primaryPath = pathFor(values);
    const area = primaryPath + " L" + x(rows.length - 1) + " " + y(0) + " L" + x(0) + " " + y(0) + " Z";
    svg.appendChild(
      svgEl("path", {
        d: area,
        fill: "color-mix(in srgb, var(--accent) 14%, transparent)",
        stroke: "none",
      })
    );
    svg.appendChild(
      svgEl("path", {
        d: primaryPath,
        fill: "none",
        stroke: "var(--accent)",
        "stroke-width": "2",
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      })
    );

    const first = rows[0];
    const last = rows[rows.length - 1];
    const labelTime = (value) => {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return "";
      return options.timeFormat === "day"
        ? parsed.toLocaleDateString([], { month: "short", day: "numeric" })
        : parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    };
    const startLabel = svgEl("text", {
      x: pad.left,
      y: height - 6,
      fill: "var(--muted)",
      "font-size": "9",
      "font-family": "var(--font-mono)",
    });
    startLabel.textContent = labelTime(first.t);
    svg.appendChild(startLabel);
    const endLabel = svgEl("text", {
      x: width - pad.right,
      y: height - 6,
      "text-anchor": "end",
      fill: "var(--muted)",
      "font-size": "9",
      "font-family": "var(--font-mono)",
    });
    endLabel.textContent = labelTime(last.t);
    svg.appendChild(endLabel);

    host.appendChild(svg);
  }

  function barList(host, entries, options = {}) {
    if (!host) return;
    const rows = Array.isArray(entries) ? entries : [];
    host.innerHTML = "";
    if (!rows.length) {
      host.innerHTML = '<p class="admin-muted">' + escapeHtml(options.empty || "No data yet") + "</p>";
      return;
    }
    const peak = Math.max(1, ...rows.map((row) => Number(row.value) || 0));
    const list = document.createElement("div");
    list.className = "admin-bars";
    rows.forEach((row) => {
      const item = document.createElement("div");
      item.className = "admin-bar-row";
      const percent = Math.max(1, Math.round(((Number(row.value) || 0) / peak) * 100));
      item.innerHTML =
        '<span class="admin-bar-label" title="' + escapeHtml(row.label) + '">' + escapeHtml(row.label) + "</span>" +
        '<span class="admin-bar-track"><span class="admin-bar-fill" style="width:' + percent + '%"></span></span>' +
        '<span class="admin-bar-value">' + number(row.value) + "</span>";
      list.appendChild(item);
    });
    host.appendChild(list);
  }

  function emptyState(host, icon, title, message) {
    if (!host) return;
    host.innerHTML =
      '<div class="admin-empty"><ion-icon name="' + escapeHtml(icon || "file-tray-outline") +
      '" aria-hidden="true"></ion-icon><h3>' + escapeHtml(title || "Nothing here") +
      "</h3><p>" + escapeHtml(message || "") + "</p></div>";
  }

  async function boot() {
    mount();

    const ok = await guard();
    if (!ok) return;

    startEvents();
    setInterval(updateCountdown, 30000);
    setInterval(async () => {
      const result = await db.adminSession();
      if (result && result.status === 401) redirectToLogin("expired");
    }, 240000);

    state.ready = true;
    state.readyCallbacks.splice(0).forEach((callback) => {
      try {
        callback(state.session);
      } catch (error) {
        console.error(error);
      }
    });
    document.dispatchEvent(
      new CustomEvent("admin:ready", { detail: { session: state.session, page: PAGE } })
    );
  }

  global.Admin = {
    base: ADMIN_BASE,
    loginUrl: LOGIN_URL,
    page: PAGE,
    title: TITLE,
    state,
    ready: onReady,
    onEvent,
    toast,
    escape: escapeHtml,
    number,
    date,
    timeAgo,
    bytes,
    lineChart,
    barList,
    emptyState,
    redirectToLogin,
    refreshSession: () => db.adminSession(),
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
