"use strict";

/* ------------------------------------------------------------------
   Admin bulk sync — long-running channel-by-channel YouTube job.
   All state comes from the server, so the page can be closed and
   reopened (or the server restarted) without losing progress.
------------------------------------------------------------------ */

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (value) => (window.Admin ? Admin.escape(value) : String(value == null ? "" : value));

  const state = {
    status: null,
    videos: [],
    filter: "",
    selected: new Set(),
    busy: false,
    nextRunAt: 0,
    timer: null,
  };

  function text(id, value) {
    const node = $(id);
    if (node) node.textContent = value == null ? "—" : String(value);
  }

  function number(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toLocaleString() : "—";
  }

  function sessionExpired(result) {
    if (result && result.status === 401) {
      Admin.redirectToLogin("expired");
      return true;
    }
    return false;
  }

  function toast(message, tone) {
    if (window.Admin) Admin.toast(message, tone);
  }

  function parseBody(result) {
    const body = result && typeof result.json === "function" ? result.json() : null;
    return body && typeof body === "object" ? body : {};
  }

  function badge(status) {
    const tone =
      status === "running"
        ? "ok"
        : status === "paused"
          ? "warn"
          : status === "completed"
            ? "ok"
            : status === "error"
              ? "error"
              : status === "stopped"
                ? "error"
                : "info";
    return '<span class="admin-badge admin-badge--' + tone + '">' + esc(status || "idle") + "</span>";
  }

  function channelBadge(status) {
    const tone =
      status === "done"
        ? "ok"
        : status === "skipped"
          ? "warn"
          : status === "syncing"
            ? "info"
            : "accent";
    return '<span class="admin-badge admin-badge--' + tone + '">' + esc(status || "pending") + "</span>";
  }

  function countdown(seconds) {
    if (seconds == null || !Number.isFinite(Number(seconds))) return "—";
    let remaining = Math.max(0, Math.round(Number(seconds)));
    const hours = Math.floor(remaining / 3600);
    remaining -= hours * 3600;
    const minutes = Math.floor(remaining / 60);
    const secs = remaining - minutes * 60;
    if (hours) return hours + "h " + String(minutes).padStart(2, "0") + "m";
    if (minutes) return minutes + "m " + String(secs).padStart(2, "0") + "s";
    return secs + "s";
  }

  function render() {
    const status = state.status;
    if (!status) return;

    const jobStatus = status.status || "idle";
    const running = jobStatus === "running";
    const paused = jobStatus === "paused";

    const badgeNode = $("bulkStatusBadge");
    if (badgeNode) {
      badgeNode.className =
        "admin-badge admin-badge--" +
        (running ? "ok" : paused ? "warn" : jobStatus === "error" || jobStatus === "stopped" ? "error" : jobStatus === "completed" ? "ok" : "info");
      badgeNode.textContent = jobStatus;
    }

    text("bulkStatStatus", jobStatus);
    text("bulkStatPhase", status.phase || "—");

    const current = status.currentChannel || null;
    text("bulkStatChannel", current ? current.title || current.name : "—");
    text(
      "bulkStatChannelMeta",
      current
        ? "Channel " + (Number(status.currentChannelIndex || 0) + 1) + " of " + (status.channels || []).length +
          " · " + (current.pendingCount || 0) + " queued"
        : "No channel selected"
    );

    const synced = Number(status.syncedToday || 0);
    const limit = Number(status.dailyLimit || 0);
    text("bulkStatToday", number(synced) + " / " + number(limit));
    text("bulkStatTodayMeta", number(status.remainingToday || 0) + " left today");

    text("bulkStatTotal", number(status.totalCreated));
    text(
      "bulkStatTotalMeta",
      "Scanned " + number(status.totalScanned) + " · skipped " + number(status.totalSkipped) +
        " · errors " + number(status.totalErrors)
    );

    text("bulkStatDb", number(status.videosCount));
    text(
      "bulkStatDbMeta",
      status.provider
        ? status.provider.name + (status.provider.fallback ? " (local fallback)" : "")
        : "—"
    );

    state.nextRunAt = status.nextRunAt ? new Date(status.nextRunAt).getTime() : 0;
    text("bulkStatNext", running ? countdown(status.secondsToNextRun) : paused ? "paused" : "—");
    text(
      "bulkStatNextMeta",
      status.nextRunAt && running ? new Date(status.nextRunAt).toLocaleTimeString() : "Not scheduled"
    );

    const percent = limit > 0 ? Math.min(100, Math.round((synced / limit) * 100)) : 0;
    const fill = $("bulkProgressFill");
    if (fill) {
      fill.style.width = percent + "%";
      fill.dataset.tone = percent >= 100 ? "warn" : "ok";
    }
    text("bulkProgressText", number(synced) + " / " + number(limit) + " videos today");
    text("bulkProgressPercent", percent + "%");
    text(
      "bulkProgressMeta",
      "Batch " + number(status.batchSize) + " · delay " + number(status.delayMinutes) + " min · daily " + number(limit)
    );

    const provider = status.provider || {};
    text(
      "bulkProviderNote",
      provider.name
        ? "Primary database: " + provider.name +
            (provider.firebaseProjectId ? " (" + provider.firebaseProjectId + ")" : "") +
            (provider.fallback ? " — " + (provider.reason || "credentials missing") : "")
        : "Database provider unknown."
    );

    text(
      "bulkLockNote",
      status.locked ? "Regular sync blocked while bulk job is active" : "Regular sync available"
    );

    renderChannels(status);
    renderLogs(status);
    renderButtons(status);
  }

  function renderChannels(status) {
    const host = $("bulkChannelRows");
    if (!host) return;
    const channels = Array.isArray(status.channels) ? status.channels : [];
    text("bulkQueueCount", channels.length + " channels");
    if (!channels.length) {
      host.innerHTML = '<tr><td colspan="8"><span class="admin-muted">No YouTube channels are configured.</span></td></tr>';
      return;
    }
    host.innerHTML = channels
      .map((channel, index) => {
        const isCurrent = index === Number(status.currentChannelIndex || 0) && ["running", "paused"].includes(status.status);
        return (
          "<tr" + (isCurrent ? ' class="is-current"' : "") + ">" +
          '<td class="is-mono">' + (index + 1) + "</td>" +
          "<td><strong>" + esc(channel.title || channel.name || channel.id) + "</strong>" +
          '<span class="admin-channel-sub">' + esc(channel.id) + "</span></td>" +
          "<td>" + channelBadge(channel.status) + (isCurrent ? ' <span class="admin-badge admin-badge--accent">current</span>' : "") + "</td>" +
          '<td class="is-right is-mono">' + number(channel.created) + "</td>" +
          '<td class="is-right is-mono">' + number(channel.scanned) + "</td>" +
          '<td class="is-right is-mono">' + number(channel.skipped) + "</td>" +
          '<td class="is-right is-mono">' + number(channel.errors) + "</td>" +
          "<td>" + esc(Admin.timeAgo(channel.lastSyncAt)) + "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function renderLogs(status) {
    const host = $("bulkLogList");
    if (!host) return;
    const logs = Array.isArray(status.logs) ? status.logs : [];
    if (!logs.length) {
      host.innerHTML = '<li class="admin-muted">No activity yet.</li>';
      return;
    }
    host.innerHTML = logs
      .map(
        (entry) =>
          '<li class="admin-log-item admin-log-item--' + esc(entry.level || "info") + '">' +
          '<span class="admin-log-time">' + esc(Admin.date(entry.at, { timeStyle: "medium" })) + "</span>" +
          "<span>" + esc(entry.message) + "</span></li>"
      )
      .join("");
  }

  function renderButtons(status) {
    const running = status.status === "running";
    const paused = status.status === "paused";
    const active = running || paused;
    const set = (id, disabled) => {
      const node = $(id);
      if (node) node.disabled = Boolean(disabled) || state.busy;
    };

    set("bulkStart", running);
    set("bulkPause", !running);
    set("bulkResume", !(paused || status.status === "stopped" || status.status === "error"));
    set("bulkStop", !active);
    set("bulkSyncNow", status.status === "completed");
    set("bulkNext", !active);
    set("bulkComplete", !active);
    set("bulkFinish", !active);
    set("bulkReset", running);
    set("bulkStopClose", !active);
  }

  function tickCountdown() {
    if (!state.nextRunAt || !state.status || state.status.status !== "running") return;
    const seconds = Math.max(0, Math.round((state.nextRunAt - Date.now()) / 1000));
    text("bulkStatNext", countdown(seconds));
  }

  async function load() {
    const result = await db.adminBulkStatus();
    if (sessionExpired(result)) return;
    const body = parseBody(result);
    if (!result.ok) {
      toast(body.error || "Could not load bulk sync status.", "error");
      return;
    }
    state.status = body;
    render();
  }

  async function control(action, runner, options = {}) {
    if (state.busy) return;
    if (options.confirm && !window.confirm(options.confirm)) return;
    state.busy = true;
    renderButtons(state.status || {});
    try {
      const result = await runner();
      if (sessionExpired(result)) return;
      const body = parseBody(result);
      if (!result.ok) {
        toast(body.error || "The action failed.", "error");
        return;
      }
      if (options.success) toast(options.success, "ok");
      state.status = body;
      render();
      await load();
    } finally {
      state.busy = false;
      if (state.status) renderButtons(state.status);
    }
  }

  function optionsFromInputs() {
    const clear = $("bulkClearVideos");
    return {
      batchSize: Number($("bulkBatchSize").value) || undefined,
      dailyLimit: Number($("bulkDailyLimit").value) || undefined,
      delayMinutes: Number($("bulkDelay").value) || undefined,
      clearVideos: Boolean(clear && clear.checked),
    };
  }

  function renderPicker() {
    const host = $("bulkVideoPicker");
    if (!host) return;
    const filter = state.filter.toLowerCase();
    const rows = state.videos.filter((row) => {
      if (!filter) return true;
      return [row.title, row.ytid, row.channelTitle]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(filter));
    });

    text("bulkPickerCount", rows.length + " shown · " + state.videos.length + " loaded");
    text("bulkVideoNote", state.selected.size + " selected");

    if (!rows.length) {
      host.innerHTML = '<p class="admin-muted">No videos match. Use Refresh to reload the library.</p>';
      return;
    }

    host.innerHTML = rows
      .slice(0, 300)
      .map((row) => {
        const id = String(row._id || row.id || row.ytid || "");
        const checked = state.selected.has(id) ? " checked" : "";
        return (
          '<label class="admin-video-pick">' +
          '<input type="checkbox" data-video-id="' + esc(id) + '"' + checked + ">" +
          '<span class="admin-video-pick-body">' +
          "<strong>" + esc(row.title || "Untitled clip") + "</strong>" +
          '<span class="admin-channel-sub">' + esc(row.channelTitle || "—") + " · " + esc(row.ytid || id) + "</span>" +
          "</span></label>"
        );
      })
      .join("");

    host.querySelectorAll("input[data-video-id]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const id = checkbox.getAttribute("data-video-id");
        if (checkbox.checked) state.selected.add(id);
        else state.selected.delete(id);
        text("bulkVideoNote", state.selected.size + " selected");
      });
    });
  }

  async function loadVideos() {
    const result = await db.adminVideos({ limit: 1000 });
    if (sessionExpired(result)) return;
    const body = parseBody(result);
    if (!result.ok) {
      toast(body.error || "Could not load the video library.", "error");
      return;
    }
    state.videos = Array.isArray(body.items) ? body.items : [];
    state.selected = new Set(
      Array.from(state.selected).filter((id) =>
        state.videos.some((row) => String(row._id || row.id || row.ytid || "") === id)
      )
    );
    renderPicker();
  }

  function bind() {
    $("bulkRefresh").addEventListener("click", () => load());

    $("bulkStart").addEventListener("click", () => {
      const options = optionsFromInputs();
      control("start", () => db.adminBulkStart(options), {
        confirm: options.clearVideos
          ? "Delete every video in the database and start a fresh bulk sync?"
          : null,
        success: "Bulk sync started.",
      });
    });
    $("bulkPause").addEventListener("click", () =>
      control("pause", () => db.adminBulkPause(), { success: "Bulk sync paused." })
    );
    $("bulkResume").addEventListener("click", () =>
      control("resume", () => db.adminBulkResume(optionsFromInputs()), { success: "Bulk sync resumed." })
    );
    $("bulkStop").addEventListener("click", () =>
      control("stop", () => db.adminBulkStop(), {
        confirm: "Stop the bulk sync job? Progress is kept so you can start again.",
        success: "Bulk sync stopped.",
      })
    );
    $("bulkSyncNow").addEventListener("click", () =>
      control("sync-now", () => db.adminBulkSyncNow(), { success: "Immediate batch requested." })
    );
    $("bulkNext").addEventListener("click", () =>
      control("next-channel", () => db.adminBulkNextChannel(), {
        confirm: "Skip the current channel and move to the next one?",
        success: "Moved to the next channel.",
      })
    );
    $("bulkComplete").addEventListener("click", () =>
      control("complete-channel", () => db.adminBulkCompleteChannel(), {
        success: "Channel marked complete.",
      })
    );
    $("bulkFinish").addEventListener("click", () =>
      control("finish", () => db.adminBulkFinish(), {
        confirm: "Mark the whole bulk job complete and release the regular sync?",
        success: "Bulk sync marked complete.",
      })
    );
    $("bulkReset").addEventListener("click", () =>
      control("reset", () => db.adminBulkReset(), {
        confirm: "Reset all job progress? Videos already stored are not deleted.",
        success: "Bulk sync job reset.",
      })
    );
    $("bulkStopClose").addEventListener("click", async () => {
      const result = await db.adminBulkStop();
      if (sessionExpired(result)) return;
      window.location.replace("/Admin/");
    });

    $("bulkVideoSearch").addEventListener("input", (event) => {
      state.filter = event.target.value || "";
      renderPicker();
    });
    $("bulkVideoSelectAll").addEventListener("click", () => {
      const filter = state.filter.toLowerCase();
      state.videos
        .filter((row) =>
          !filter ||
          [row.title, row.ytid, row.channelTitle]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(filter))
        )
        .slice(0, 300)
        .forEach((row) => state.selected.add(String(row._id || row.id || row.ytid || "")));
      renderPicker();
    });
    $("bulkVideoClear").addEventListener("click", () => {
      state.selected.clear();
      renderPicker();
    });
    $("bulkVideoDelete").addEventListener("click", async () => {
      const ids = Array.from(state.selected);
      if (!ids.length) return toast("Select at least one video.", "warn");
      if (!window.confirm("Delete " + ids.length + " video(s) from the database?")) return;
      state.busy = true;
      try {
        const result = await db.adminVideosBulkDelete(ids);
        if (sessionExpired(result)) return;
        const body = parseBody(result);
        if (!result.ok) return toast(body.error || "Could not delete those videos.", "error");
        toast("Deleted " + number(body.deleted) + " video(s).", "ok");
        state.selected.clear();
        await loadVideos();
        await load();
      } finally {
        state.busy = false;
      }
    });

    $("bulkAddButton").addEventListener("click", async () => {
      const value = $("bulkAddText").value.trim();
      if (!value) return toast("Paste at least one YouTube id.", "warn");
      state.busy = true;
      const button = $("bulkAddButton");
      if (button) button.disabled = true;
      try {
        const result = await db.adminVideosBulkAdd(value);
        if (sessionExpired(result)) return;
        const body = parseBody(result);
        if (!result.ok) {
          toast(body.error || "Could not add those videos.", "error");
          text("bulkAddResult", body.error || "Could not add those videos.");
          return;
        }
        text(
          "bulkAddResult",
          "Requested " + number(body.requested) + " · added " + number(body.created) +
            " · skipped " + number(body.skipped) + " · errors " + number((body.errors || []).length)
        );
        toast("Added " + number(body.created) + " video(s).", "ok");
        $("bulkAddText").value = "";
        await loadVideos();
        await load();
      } finally {
        state.busy = false;
        if (button) button.disabled = false;
      }
    });

    $("bulkDeleteAllButton").addEventListener("click", async () => {
      const confirm = $("bulkDeleteAllConfirm").value.trim();
      if (confirm !== "DELETE ALL VIDEOS") {
        return toast('Type "DELETE ALL VIDEOS" to confirm.', "warn");
      }
      state.busy = true;
      try {
        const result = await db.adminVideosDeleteAll(confirm);
        if (sessionExpired(result)) return;
        const body = parseBody(result);
        if (!result.ok) return toast(body.error || "Could not clear the video library.", "error");
        toast("Deleted " + number(body.deleted) + " video(s).", "ok");
        $("bulkDeleteAllConfirm").value = "";
        state.selected.clear();
        state.videos = [];
        renderPicker();
        await load();
      } finally {
        state.busy = false;
      }
    });

    if (typeof Admin.onEvent === "function") {
      Admin.onEvent((event) => {
        const type = event && event.type;
        if (!type) return;
        if (type.indexOf("bulk:") === 0 || type === "videos:cleared" || type === "video:created" || type === "video:deleted") {
          load();
        }
        if (type === "video:created" || type === "video:deleted" || type === "videos:cleared") {
          loadVideos();
        }
      });
    }
  }

  Admin.ready(async () => {
    bind();
    await load();
    await loadVideos();
    state.timer = setInterval(tickCountdown, 1000);
    setInterval(load, 15000);
  });
})();
