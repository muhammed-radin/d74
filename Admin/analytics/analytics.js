"use strict";

/* ------------------------------------------------------------------
   Admin analytics
------------------------------------------------------------------ */

(function () {
  const $ = (id) => document.getElementById(id);
  const state = { range: "24h", loading: false, timer: null };

  function text(id, value) {
    const node = $(id);
    if (node) node.textContent = value;
  }

  function rangeLabel(range) {
    return { "1h": "Last hour", "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days" }[range] || range;
  }

  function quotaFill(barId, textId, metaId, info) {
    const bar = $(barId);
    const label = $(textId);
    const meta = $(metaId);
    if (!bar || !label || !meta) return;
    if (!info || !info.limit) {
      bar.style.width = "0%";
      label.textContent = "No cap";
      meta.textContent = info && info.used ? Admin.number(info.used) + " requests today" : "Unlimited";
      return;
    }
    const percent = Math.max(0, Math.min(100, Number(info.percent) || 0));
    bar.style.width = percent + "%";
    bar.dataset.tone = percent >= 95 ? "error" : percent >= 80 ? "warn" : "ok";
    label.textContent = Admin.number(info.used) + " / " + Admin.number(info.limit);
    meta.textContent = Admin.number(info.remaining) + " remaining · resets " + Admin.date(info.resetsAt);
  }

  function renderStatus(statuses) {
    const host = $("anaStatus");
    if (!host) return;
    const entries = Object.entries(statuses || {})
      .map(([status, count]) => ({ status: Number(status), count: Number(count) || 0 }))
      .sort((a, b) => b.count - a.count);
    text("anaStatusCount", entries.reduce((sum, row) => sum + row.count, 0) + " responses");
    if (!entries.length) {
      Admin.emptyState(host, "analytics-outline", "No responses yet", "Status codes appear after the first requests.");
      return;
    }
    host.innerHTML =
      '<div class="admin-stack">' +
      entries
        .map((row) => {
          const kind = row.status >= 500 ? "error" : row.status >= 400 ? "warn" : row.status >= 300 ? "info" : "ok";
          const percent = Math.max(1, Math.round((row.count / entries[0].count) * 100));
          return (
            '<div class="admin-progress"><div class="admin-progress-head"><span>' +
            '<span class="admin-badge admin-badge--' + kind + '">' + row.status + "</span></span>" +
            "<strong>" + Admin.number(row.count) + "</strong></div>" +
            '<div class="admin-progress-track"><div class="admin-progress-fill" data-tone="' +
            (kind === "error" ? "error" : kind === "warn" ? "warn" : "ok") + '" style="width:' + percent + '%"></div></div></div>'
          );
        })
        .join("") +
      "</div>";
  }

  function renderPaths(paths) {
    Admin.barList(
      $("anaPaths"),
      (Array.isArray(paths) ? paths : []).map((row) => ({ label: row.path, value: row.count })),
      { empty: "Paths are recorded as traffic arrives." }
    );
  }

  function renderRecent(rows) {
    const host = $("anaRecent");
    if (!host) return;
    const list = Array.isArray(rows) ? rows : [];
    text("anaRecentCount", list.length + " shown");
    if (!list.length) {
      host.innerHTML = '<tr><td colspan="6" class="admin-muted">No requests recorded yet.</td></tr>';
      return;
    }
    host.innerHTML = list
      .map((row) => {
        const kind = row.status >= 500 ? "error" : row.status >= 400 ? "warn" : "ok";
        return (
          '<tr><td class="is-nowrap admin-muted">' + Admin.date(row.ts, { timeStyle: "medium" }) +
          '</td><td class="admin-mono">' + Admin.escape(row.method) +
          '</td><td class="admin-truncate admin-mono" title="' + Admin.escape(row.path) + '">' + Admin.escape(row.path) +
          '</td><td><span class="admin-badge admin-badge--' + kind + '">' + row.status +
          '</span></td><td class="is-nowrap admin-mono">' + Admin.number(row.ms) + " ms" +
          '</td><td class="admin-muted">' + (row.cacheHit ? "hit" : "miss") + "</td></tr>"
        );
      })
      .join("");
  }

  function renderSystem(system) {
    const host = $("anaSystem");
    if (!host || !system) return;
    host.innerHTML = [
      ["Node", Admin.escape(system.node || "—")],
      ["Memory", Admin.bytes(system.memory && system.memory.rssMb) + " RSS"],
      ["Event loop", system.eventLoop ? system.eventLoop.meanMs + " ms mean" : "—"],
      ["SSE clients", Admin.number(system.eventsClients)],
    ]
      .map(([key, value]) => "<dt>" + key + "</dt><dd>" + value + "</dd>")
      .join("");
  }

  function render(data) {
    const totals = data.totals || {};
    text("anaRequests", Admin.number(totals.requests));
    text("anaRangeLabel", rangeLabel(data.range));
    text("anaAvg", (totals.avgMs == null ? "—" : totals.avgMs + " ms"));
    const series = Array.isArray(data.series) ? data.series : [];
    const peak = series.reduce((max, row) => Math.max(max, Number(row.requests) || 0), 0);
    text("anaPeak", series.length ? "peak " + Admin.number(peak) + " req/bucket" : "no buckets yet");
    text("anaErrors", (totals.errorRate == null ? "—" : totals.errorRate + "%"));
    text("anaErrorCount", Admin.number(totals.errors) + " errors");
    const errorsCard = $("anaErrorsCard");
    if (errorsCard) {
      errorsCard.dataset.tone = Number(totals.errorRate) >= 5 ? "error" : Number(totals.errorRate) >= 1 ? "warn" : "ok";
    }
    text("anaCache", (totals.cacheHitRate == null ? "—" : totals.cacheHitRate + "%"));
    text("anaCacheDetail", Admin.number(totals.cacheHits) + " hits");
    text("anaVisitors", Admin.number(totals.uniqueVisitors));
    text("anaDriver", data.cache ? (data.cache.redis ? "Redis" : "Memory") : "—");
    text("anaDriverMeta", data.cache ? Admin.number(data.cache.entries) + " entries · " + data.cache.hitRate + "% hit rate" : "—");
    text("anaChartMeta", rangeLabel(data.range));

    Admin.lineChart($("analyticsChart"), series, {
      value: "requests",
      secondary: "errors",
      timeFormat: data.range === "7d" || data.range === "30d" ? "day" : "time",
      label: "Requests and errors for " + rangeLabel(data.range),
      empty: "Requests will plot here as they arrive.",
    });
    renderStatus(data.statuses);
    renderPaths(data.topPaths);
    renderRecent(data.recentRequests);
    if (data.quota) {
      quotaFill("anaDbBar", "anaDbText", "anaDbMeta", data.quota.db);
      quotaFill("anaYtBar", "anaYtText", "anaYtMeta", data.quota.youtube);
    }
    renderSystem(data.system);
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    const button = $("analyticsRefresh");
    if (button) button.disabled = true;
    try {
      const result = await db.adminAnalytics(state.range);
      if (result.status === 401) {
        Admin.redirectToLogin("expired");
        return;
      }
      const body = result.json() || {};
      if (!result.ok) {
        Admin.toast(body.error || "Could not load analytics.", "error");
        return;
      }
      render(body);
    } finally {
      state.loading = false;
      if (button) button.disabled = false;
    }
  }

  function schedule(delay) {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      if (document.visibilityState !== "hidden") load();
    }, delay || 2000);
  }

  Admin.ready(() => {
    document.querySelectorAll("[data-range]").forEach((button) => {
      button.addEventListener("click", () => {
        state.range = button.dataset.range;
        document.querySelectorAll("[data-range]").forEach((item) => {
          item.classList.toggle("is-active", item === button);
        });
        load();
      });
    });
    const refresh = $("analyticsRefresh");
    if (refresh) refresh.addEventListener("click", load);

    load();
    Admin.onEvent((event) => {
      if (event.type === "analytics:tick") schedule(1200);
      if (event.type === "db:changed" || event.type === "cache:cleared") schedule(1800);
    });
  });
})();
