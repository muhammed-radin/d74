"use strict";

/* ------------------------------------------------------------------
   Admin dashboard
   Renders /api/admin/dashboard and keeps it live through SSE.
------------------------------------------------------------------ */

(function () {
  const $ = (id) => document.getElementById(id);
  let reloadTimer = null;
  let loading = false;

  function text(id, value) {
    const node = $(id);
    if (node) node.textContent = value;
  }

  function tone(value, warn, error) {
    if (value >= error) return "error";
    if (value >= warn) return "warn";
    return "ok";
  }

  function badge(label, kind) {
    return '<span class="admin-badge admin-badge--' + kind + '">' + Admin.escape(label) + "</span>";
  }

  function warnings(list) {
    const host = $("dashWarnings");
    if (!host) return;
    const rows = Array.isArray(list) ? list : [];
    host.innerHTML = rows
      .map(
        (message) =>
          '<div class="admin-alert admin-alert--warn"><ion-icon name="alert-circle-outline" aria-hidden="true"></ion-icon><span>' +
          Admin.escape(message) +
          "</span></div>"
      )
      .join("");
  }

  function quotaFill(barId, metaId, textId, info) {
    const bar = $(barId);
    const meta = $(metaId);
    const label = $(textId);
    if (!bar || !meta || !label) return;
    if (!info || !info.limit) {
      bar.style.width = "0%";
      label.textContent = "No cap configured";
      meta.textContent = "Cached reads remain available even if the upstream plan changes.";
      return;
    }
    const percent = Math.max(0, Math.min(100, Number(info.percent) || 0));
    bar.style.width = percent + "%";
    bar.dataset.tone = percent >= 95 ? "error" : percent >= 80 ? "warn" : "ok";
    label.textContent = Admin.number(info.used) + " / " + Admin.number(info.limit) + " (" + percent + "%)";
    meta.textContent =
      (info.remaining == null ? "Unlimited" : Admin.number(info.remaining) + " remaining") +
      (info.hardStop ? " · hard stop enabled" : " · soft limit") +
      " · resets " + Admin.timeAgo(info.resetsAt).replace(" ago", "");
  }

  function renderStats(data) {
    const stats = data.stats || {};
    text("statVideos", Admin.number(stats.videos));
    text("statDownloadable", Admin.number(stats.downloadable));
    text("statAccounts", Admin.number(stats.accounts));
    text("statRequests", Admin.number(stats.requestsToday));
    text("statRpm", (Math.round(((stats.requestsToday || 0) / 1440) * 10) / 10).toFixed(1));
    text("statVisitors", Admin.number(stats.uniqueVisitors));
    text("statCache", (stats.cacheHitRate == null ? "—" : stats.cacheHitRate + "%"));
    text("statCacheDriver", data.cache ? (data.cache.redis ? "Redis" : "Memory fallback") : "—");
    text("statErrors", (stats.errorRate == null ? "—" : stats.errorRate + "%"));
    text("statAvgMs", (stats.avgMs == null ? "—" : stats.avgMs + " ms"));
    text("statSessions", Admin.number(stats.activeSessions));
    text("statEvents", Admin.number(stats.openEvents));

    const errorsCard = $("statErrorsCard");
    if (errorsCard) {
      errorsCard.dataset.tone = Number(stats.errorRate) >= 5 ? "error" : Number(stats.errorRate) >= 1 ? "warn" : "ok";
    }
  }

  function renderChart(traffic) {
    const host = $("dashChart");
    if (!host) return;
    Admin.lineChart(host, (traffic && traffic.series) || [], {
      value: "requests",
      secondary: "errors",
      label: "Requests and errors over the last 24 hours",
      empty: "Traffic will appear here as requests arrive.",
    });
    text("dashChartMeta", traffic && traffic.range ? "Last " + traffic.range : "Last 24 hours");
  }

  function renderSync(youtube) {
    if (!youtube) return;
    const status = $("syncStatus");
    if (status) {
      status.textContent = youtube.running ? "running" : youtube.enabled ? "scheduled" : "disabled";
      status.className =
        "admin-badge " +
        (youtube.running ? "admin-badge--info" : youtube.enabled ? "admin-badge--ok" : "admin-badge--warn");
    }

    const host = $("syncChannels");
    if (host) {
      const channels = Array.isArray(youtube.channels) ? youtube.channels : [];
      host.innerHTML = channels.length
        ? channels
            .map((channel) => {
              const kind = channel.status === "error" ? "error" : channel.status === "ok" ? "ok" : "neutral";
              return (
                '<div class="admin-alert">' +
                '<ion-icon name="logo-youtube" aria-hidden="true"></ion-icon>' +
                "<span><strong>" + Admin.escape(channel.title || channel.name) + "</strong> " +
                badge(channel.status || "idle", kind) +
                '<br><span class="admin-mono">' + Admin.escape(channel.id) + "</span><br>" +
                '<span class="admin-muted">Last sync ' + Admin.timeAgo(channel.lastSyncAt) +
                " · scanned " + Admin.number(channel.scanned) + " · added " + Admin.number(channel.created) +
                (channel.error ? " · " + Admin.escape(channel.error) : "") +
                "</span></span></div>"
              );
            })
            .join("")
        : '<div class="admin-alert admin-alert--warn"><ion-icon name="alert-circle-outline" aria-hidden="true"></ion-icon><span>No YouTube channels are configured. Add <code class="admin-code">YOUTUBE_CHANNEL_IDS</code> or a gitignored <code class="admin-code">server/data/youtube-channels.json</code>.</span></div>';
    }

    const last = youtube.lastResult;
    text(
      "syncResult",
      last
        ? "Last run " + Admin.timeAgo(last.finishedAt) + " · " + (last.dryRun ? "dry run" : "live") +
            " · " + Admin.number(last.scanned) + " scanned · " + Admin.number(last.created) + " added · " +
            Admin.number(last.errors) + " errors"
        : "No sync has run in this process yet."
    );
  }

  function renderAudit(items) {
    const host = $("dashAudit");
    if (!host) return;
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) {
      host.innerHTML = '<tr><td colspan="4" class="admin-muted">No audit events yet.</td></tr>';
      return;
    }
    host.innerHTML = rows
      .map((row) => {
        const kind = row.severity === "error" ? "error" : row.severity === "warn" ? "warn" : "neutral";
        return (
          "<tr><td class=\"admin-mono\">" + Admin.escape(row.action) + "</td><td>" +
          Admin.escape(row.actor || "system") + "</td><td>" + badge(row.severity || "info", kind) +
          "</td><td class=\"is-nowrap admin-muted\">" + Admin.timeAgo(row.ts) + "</td></tr>"
        );
      })
      .join("");
  }

  function renderVideos(items) {
    const host = $("recentVideosBody");
    if (!host) return;
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) {
      host.innerHTML = '<tr><td colspan="5" class="admin-muted">No videos in the database yet.</td></tr>';
      return;
    }
    host.innerHTML = rows
      .map(
        (video) =>
          "<tr><td><span class=\"admin-truncate\" title=\"" + Admin.escape(video.title) + "\">" +
          Admin.escape(video.title || "Untitled") + "</span></td><td class=\"admin-muted\">" +
          Admin.escape(video.channelTitle || "—") + "</td><td class=\"is-nowrap admin-muted\">" +
          Admin.date(video.date, { dateStyle: "medium" }) + "</td><td>" +
          (video.downloadable ? badge("ready", "ok") : badge("page only", "neutral")) +
          "</td><td class=\"is-right\"><a class=\"btn btn-ghost btn-sm\" href=\"/Admin/edit_video/?id=" +
          encodeURIComponent(video.ytid || "") + "\">Edit</a></td></tr>"
      )
      .join("");
  }

  function renderSessions(items) {
    const host = $("dashSessions");
    if (!host) return;
    const rows = Array.isArray(items) ? items : [];
    text("dashSessionCount", rows.length + " active");
    if (!rows.length) {
      host.innerHTML = '<tr><td colspan="7" class="admin-muted">No active sessions.</td></tr>';
      return;
    }
    host.innerHTML = rows
      .map(
        (row) =>
          "<tr><td>" + Admin.escape(row.name || row.username || "admin") +
          (row.current ? " " + badge("current", "accent") : "") +
          "</td><td class=\"admin-mono\">" + Admin.escape(row.ip || "—") +
          "</td><td class=\"admin-truncate admin-muted\" title=\"" + Admin.escape(row.userAgent || "") + "\">" +
          Admin.escape(row.userAgent || "—") +
          "</td><td class=\"is-nowrap admin-muted\">" + Admin.date(row.createdAt) +
          "</td><td class=\"is-nowrap admin-muted\">" + Admin.timeAgo(row.lastSeen) +
          "</td><td class=\"is-nowrap admin-muted\">" + Admin.date(row.expiresAt) +
          '</td><td class="is-right">' +
          (row.current
            ? '<span class="admin-muted">—</span>'
            : '<button class="btn btn-danger btn-sm" type="button" data-revoke="' +
              Admin.escape(row.key) + '">Revoke</button>') +
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
          scheduleReload(400);
        } else {
          Admin.toast(body.error || "Could not revoke the session.", "error");
          button.disabled = false;
        }
      });
    });
  }

  function renderSystem(system) {
    const host = $("dashSystem");
    if (!host) return;
    if (!system) {
      host.innerHTML = "<dt>Status</dt><dd>Unavailable</dd>";
      return;
    }
    const uptime = system.uptimeSeconds || 0;
    const uptimeText =
      Math.floor(uptime / 86400) + "d " + Math.floor((uptime % 86400) / 3600) + "h " +
      Math.floor((uptime % 3600) / 60) + "m";
    host.innerHTML = [
      ["Status", "online"],
      ["Node", Admin.escape(system.node || "—")],
      ["Uptime", uptimeText],
      ["Memory RSS", Admin.bytes(system.memory && system.memory.rssMb)],
      ["Heap", Admin.bytes(system.memory && system.memory.heapUsedMb) + " used"],
      ["Event loop", (system.eventLoop ? system.eventLoop.meanMs + " ms mean · " + system.eventLoop.p99Ms + " ms p99" : "—")],
      ["Load average", Array.isArray(system.loadAverage) ? system.loadAverage.join(" / ") : "—"],
      ["SSE clients", Admin.number(system.eventsClients)],
    ]
      .map(([key, value]) => "<dt>" + key + "</dt><dd>" + value + "</dd>")
      .join("");
    text("dashRuntimeAt", Admin.date(new Date(), { timeStyle: "medium" }));
  }

  function render(data) {
    renderStats(data);
    warnings(data.warnings);
    renderChart(data.traffic);
    renderSync(data.youtube);
    if (data.quota) {
      quotaFill("quotaDbBar", "quotaDbMeta", "quotaDbText", data.quota.db);
      quotaFill("quotaYoutubeBar", "quotaYoutubeMeta", "quotaYoutubeText", data.quota.youtube);
    }
    renderAudit(data.audit);
    renderVideos(data.recentVideos);
    renderSessions(data.sessions);
    renderSystem(data.system);
    text("dashUpdated", "Updated " + Admin.date(data.generatedAt, { timeStyle: "medium" }));
  }

  async function load() {
    if (loading) return;
    loading = true;
    const refresh = $("dashRefresh");
    if (refresh) refresh.disabled = true;
    try {
      const result = await db.adminDashboard();
      if (result.status === 401) {
        Admin.redirectToLogin("expired");
        return;
      }
      const body = result.json() || {};
      if (!result.ok) {
        Admin.toast(body.error || "Could not load the dashboard.", "error");
        return;
      }
      render(body);
    } finally {
      loading = false;
      if (refresh) refresh.disabled = false;
    }
  }

  function scheduleReload(delay) {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(load, delay || 1500);
  }

  async function runSync(dryRun) {
    const live = $("syncNow");
    const dry = $("syncDry");
    if (live) live.disabled = true;
    if (dry) dry.disabled = true;
    try {
      const payload = dryRun
        ? { dryRun: true, wait: true, pages: 1, maxNew: 5 }
        : { wait: false };
      const result = await db.adminYoutubeSync(payload);
      const body = result.json() || {};
      if (result.status === 409) {
        Admin.toast("A sync is already running.", "warn");
      } else if (!result.ok) {
        Admin.toast(body.error || "The sync could not be started.", "error");
      } else if (result.status === 202) {
        Admin.toast("Sync started. Progress is streamed live.", "ok");
      } else {
        Admin.toast(
          "Dry run finished: " + Admin.number(body.scanned || 0) + " scanned, " +
            Admin.number(body.created || 0) + " would be added.",
          "ok"
        );
      }
      scheduleReload(600);
    } finally {
      if (live) live.disabled = false;
      if (dry) dry.disabled = false;
    }
  }

  Admin.ready(() => {
    load();
    const refresh = $("dashRefresh");
    if (refresh) refresh.addEventListener("click", load);
    const live = $("syncNow");
    if (live) live.addEventListener("click", () => runSync(false));
    const dry = $("syncDry");
    if (dry) dry.addEventListener("click", () => runSync(true));

    Admin.onEvent((event) => {
      if (event.type === "sync:started") {
        Admin.toast("YouTube sync started.", "info");
        scheduleReload(800);
      } else if (event.type === "sync:completed") {
        Admin.toast(
          "Sync finished: " + Admin.number(event.data.created) + " added, " +
            Admin.number(event.data.errors) + " errors.",
          event.data.errors ? "warn" : "ok"
        );
        scheduleReload(800);
      } else if (
        event.type === "analytics:tick" ||
        event.type === "security:login" ||
        event.type === "security:logout" ||
        event.type === "security:revoked" ||
        event.type === "audit" ||
        event.type === "db:changed" ||
        event.type === "cache:cleared"
      ) {
        scheduleReload(1800);
      }
    });
  });
})();
