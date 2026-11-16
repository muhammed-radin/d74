"use strict";

/* ------------------------------------------------------------------
   Admin monitoring
   Sessions, audit, quota, cache, runtime and live events.
------------------------------------------------------------------ */

(function () {
  const $ = (id) => document.getElementById(id);
  const state = { loading: false, timer: null, liveEvents: [] };

  function text(id, value) {
    const node = $(id);
    if (node) node.textContent = value;
  }

  function badge(label, kind) {
    return '<span class="admin-badge admin-badge--' + kind + '">' + Admin.escape(label) + "</span>";
  }

  function renderAlerts(alerts) {
    const host = $("monAlerts");
    if (!host) return;
    const rows = Array.isArray(alerts) ? alerts : [];
    text("monAlertCount", rows.length);
    host.innerHTML = rows
      .map((alert) => {
        const kind = alert.level === "error" ? "error" : alert.level === "warn" ? "warn" : "info";
        return (
          '<div class="admin-alert admin-alert--' + kind + '"><ion-icon name="' +
          (kind === "error" ? "alert-circle-outline" : kind === "warn" ? "warning-outline" : "information-circle-outline") +
          '" aria-hidden="true"></ion-icon><span>' + Admin.escape(alert.message) + "</span></div>"
        );
      })
      .join("");
  }

  function quotaFill(barId, textId, metaId, info) {
    const bar = $(barId);
    const label = $(textId);
    const meta = $(metaId);
    if (!bar || !label || !meta) return;
    if (!info || !info.limit) {
      bar.style.width = "0%";
      label.textContent = "No cap";
      meta.textContent = info && info.used ? Admin.number(info.used) + " used today" : "Unlimited";
      return;
    }
    const percent = Math.max(0, Math.min(100, Number(info.percent) || 0));
    bar.style.width = percent + "%";
    bar.dataset.tone = percent >= 95 ? "error" : percent >= 80 ? "warn" : "ok";
    label.textContent = Admin.number(info.used) + " / " + Admin.number(info.limit) + " (" + percent + "%)";
    meta.textContent =
      Admin.number(info.remaining) + " remaining · " + (info.hardStop ? "hard stop" : "soft limit") +
      " · resets " + Admin.date(info.resetsAt);
  }

  function renderSessions(items, max) {
    const host = $("monSessionBody");
    if (!host) return;
    const rows = Array.isArray(items) ? items : [];
    text("monSessionCount", rows.length + " of " + (max || "?") + " allowed");
    text("monSessions", rows.length);
    text("monSessionsMeta", "max " + (max || "?") + " concurrent");
    if (!rows.length) {
      host.innerHTML = '<tr><td colspan="7" class="admin-muted">No active sessions.</td></tr>';
      return;
    }
    host.innerHTML = rows
      .map(
        (row) =>
          "<tr><td>" + Admin.escape(row.name || row.username || "admin") +
          (row.current ? " " + badge("current", "accent") : "") +
          '</td><td class="admin-mono">' + Admin.escape(row.ip || "—") +
          '</td><td class="admin-truncate admin-muted" title="' + Admin.escape(row.userAgent || "") + '">' +
          Admin.escape(row.userAgent || "—") +
          '</td><td class="is-nowrap admin-muted">' + Admin.date(row.createdAt) +
          '</td><td class="is-nowrap admin-muted">' + Admin.timeAgo(row.lastSeen) +
          '</td><td class="is-nowrap admin-muted">' + Admin.date(row.expiresAt) +
          '</td><td class="is-right">' +
          (row.current
            ? '<span class="admin-muted">—</span>'
            : '<button class="btn btn-danger btn-sm" type="button" data-revoke="' + Admin.escape(row.key) + '">Revoke</button>') +
          "</td></tr>"
      )
      .join("");

    host.querySelectorAll("[data-revoke]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!window.confirm("Revoke this administrator session?")) return;
        button.disabled = true;
        const result = await db.adminRevokeSession(button.dataset.revoke);
        const body = result.json() || {};
        if (result.status === 401 || body.current) {
          Admin.redirectToLogin("revoked");
          return;
        }
        if (result.ok) {
          Admin.toast("Session revoked.", "ok");
          load();
        } else {
          Admin.toast(body.error || "Could not revoke the session.", "error");
          button.disabled = false;
        }
      });
    });
  }

  function renderAudit(items) {
    const host = $("monAuditBody");
    if (!host) return;
    const rows = Array.isArray(items) ? items : [];
    text("monAuditCount", rows.length + " entries");
    if (!rows.length) {
      host.innerHTML = '<tr><td colspan="5" class="admin-muted">No audit events yet.</td></tr>';
      return;
    }
    host.innerHTML = rows
      .map((row) => {
        const kind = row.severity === "error" ? "error" : row.severity === "warn" ? "warn" : "neutral";
        return (
          '<tr><td class="admin-mono">' + Admin.escape(row.action) + "</td><td>" +
          Admin.escape(row.actor || "system") + "</td><td>" + badge(row.severity || "info", kind) +
          '</td><td class="admin-mono">' + Admin.escape(row.ip || "—") +
          '</td><td class="is-nowrap admin-muted">' + Admin.timeAgo(row.ts) + "</td></tr>"
        );
      })
      .join("");
  }

  function renderCache(cache) {
    const host = $("monCacheInfo");
    if (!host || !cache) return;
    text("monCacheDriver", cache.redis ? "Redis" : "Memory");
    text("monCacheMeta", cache.hitRate + "% hit rate · " + Admin.number(cache.entries) + " entries");
    host.innerHTML = [
      ["Driver", cache.redis ? "Redis" : "Memory fallback"],
      ["Prefix", cache.prefix],
      ["Entries", Admin.number(cache.entries) + " / " + Admin.number(cache.maxEntries)],
      ["Hit rate", cache.hitRate + "%"],
      ["Hits", Admin.number(cache.hits)],
      ["Misses", Admin.number(cache.misses)],
      ["Evictions", Admin.number(cache.evictions)],
      ["Errors", Admin.number(cache.errors)],
    ]
      .map(([key, value]) => "<dt>" + key + "</dt><dd>" + Admin.escape(value) + "</dd>")
      .join("");
  }

  function renderSystem(system) {
    const host = $("monSystem");
    if (!host || !system) return;
    text("monLoop", system.eventLoop ? system.eventLoop.p99Ms + " ms" : "—");
    text("monLoopMeta", system.eventLoop ? system.eventLoop.meanMs + " ms mean · " + system.eventLoop.maxMs + " ms max" : "—");
    text("monMemory", Admin.bytes(system.memory && system.memory.rssMb));
    text("monMemoryMeta", (system.memory ? system.memory.heapUsedMb : 0) + " MB heap · " + system.node);
    text("monClients", Admin.number(system.eventsClients));
    const uptime = system.uptimeSeconds || 0;
    host.innerHTML = [
      ["Status", "online"],
      ["Node", Admin.escape(system.node || "—")],
      ["Uptime", Math.floor(uptime / 3600) + "h " + Math.floor((uptime % 3600) / 60) + "m"],
      ["PID", Admin.number(system.pid)],
      ["RSS", Admin.bytes(system.memory && system.memory.rssMb)],
      ["Heap", Admin.bytes(system.memory && system.memory.heapUsedMb)],
      ["Load average", Array.isArray(system.loadAverage) ? system.loadAverage.join(" / ") : "—"],
      ["Started", Admin.date(system.startedAt)],
    ]
      .map(([key, value]) => "<dt>" + key + "</dt><dd>" + Admin.escape(value) + "</dd>")
      .join("");
  }

  function renderEvents(list) {
    const host = $("monEventsBody");
    if (!host) return;
    const rows = Array.isArray(list) ? list : [];
    text("monEventsCount", rows.length + " recent");
    if (!rows.length) {
      host.innerHTML = '<tr><td colspan="3" class="admin-muted">No events yet.</td></tr>';
      return;
    }
    host.innerHTML = rows
      .map(
        (event) =>
          '<tr><td class="admin-mono">' + Admin.escape(event.type) +
          '</td><td class="admin-truncate admin-mono" title="' + Admin.escape(JSON.stringify(event.data || {})) + '">' +
          Admin.escape(JSON.stringify(event.data || {})) +
          '</td><td class="is-nowrap admin-muted">' + Admin.timeAgo(event.ts) + "</td></tr>"
      )
      .join("");
  }

  function renderQuota(quota) {
    if (!quota) return;
    quotaFill("monDbBar", "monDbBarText", "monDbBarMeta", quota.db);
    quotaFill("monYtBar", "monYtBarText", "monYtBarMeta", quota.youtube);
    text("monDbQuota", quota.db && quota.db.limit ? (quota.db.percent + "%") : "—");
    text("monDbQuotaMeta", quota.db && quota.db.limit ? Admin.number(quota.db.used) + " / " + Admin.number(quota.db.limit) : "No cap configured");
    text("monYtQuota", quota.youtube && quota.youtube.limit ? (quota.youtube.percent + "%") : "—");
    text("monYtQuotaMeta", quota.youtube && quota.youtube.limit
      ? Admin.number(quota.youtube.used) + " / " + Admin.number(quota.youtube.limit)
      : "No cap configured");
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    const refresh = $("monRefresh");
    if (refresh) refresh.disabled = true;
    try {
      const [monitoring, sessions, audit] = await Promise.all([
        db.adminMonitoring(),
        db.adminSessions(),
        db.adminAudit(100),
      ]);
      if (monitoring.status === 401 || sessions.status === 401) {
        Admin.redirectToLogin("expired");
        return;
      }
      const body = monitoring.json() || {};
      if (!monitoring.ok) {
        Admin.toast(body.error || "Could not load monitoring data.", "error");
        return;
      }
      renderAlerts(body.alerts);
      renderCache(body.cache);
      renderSystem(body.system);
      renderQuota(body.quota);
      text("monClients", Admin.number(body.events && body.events.clients));
      renderEvents(body.events && body.events.recent);
      renderSessions((sessions.json() || {}).items, (sessions.json() || {}).max);
      renderAudit((audit.json() || {}).items);
      text("monGenerated", "Generated " + Admin.date(body.generatedAt, { timeStyle: "medium" }));
    } finally {
      state.loading = false;
      if (refresh) refresh.disabled = false;
    }
  }

  function schedule(delay) {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      if (document.visibilityState !== "hidden") load();
    }, delay || 1800);
  }

  async function revokeAll() {
    if (!window.confirm("Revoke every administrator session except this one?")) return;
    const button = $("monRevokeAll");
    if (button) button.disabled = true;
    const result = await db.adminRevokeAll();
    const body = result.json() || {};
    if (result.status === 401) {
      Admin.redirectToLogin("revoked");
      return;
    }
    if (result.ok) {
      if (body.csrfToken) db.setCsrfToken(body.csrfToken);
      Admin.toast("Revoked " + Admin.number(body.revoked) + " other session(s).", "ok");
      load();
    } else {
      Admin.toast(body.error || "Could not revoke sessions.", "error");
    }
    if (button) button.disabled = false;
  }

  async function clearCache() {
    if (!window.confirm("Clear cached database, YouTube and channel data?")) return;
    const button = $("monCacheClear");
    if (button) button.disabled = true;
    const result = await db.adminCacheClear();
    const body = result.json() || {};
    if (result.status === 401) {
      Admin.redirectToLogin("expired");
      return;
    }
    if (result.ok) {
      Admin.toast("Cache cleared.", "ok");
      load();
    } else {
      Admin.toast(body.error || "Could not clear the cache.", "error");
    }
    if (button) button.disabled = false;
  }

  Admin.ready(() => {
    const refresh = $("monRefresh");
    if (refresh) refresh.addEventListener("click", load);
    const revoke = $("monRevokeAll");
    if (revoke) revoke.addEventListener("click", revokeAll);
    const clear = $("monCacheClear");
    if (clear) clear.addEventListener("click", clearCache);

    load();
    Admin.onEvent((event) => {
      if (!state.liveEvents.length && event.type === "hello") return;
      state.liveEvents.unshift({ type: event.type, data: event.data, ts: event.ts });
      state.liveEvents = state.liveEvents.slice(0, 25);
      renderEvents(state.liveEvents);
      if (
        event.type === "security:login" ||
        event.type === "security:logout" ||
        event.type === "security:revoked" ||
        event.type === "security:revoked-all" ||
        event.type === "audit" ||
        event.type === "cache:cleared" ||
        event.type === "synced"
      ) {
        schedule(1200);
      }
    });
  });
})();
