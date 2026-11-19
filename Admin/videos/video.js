"use strict";

/* ------------------------------------------------------------------
   Admin videos — database library and YouTube uploads feed
------------------------------------------------------------------ */

(function () {
  const $ = (id) => document.getElementById(id);
  const state = {
    view: "library",
    query: "",
    filter: "all",
    offset: 0,
    limit: 24,
    all: [],
    feed: [],
    pageToken: "",
    loading: false,
  };

  function text(id, value) {
    const node = $(id);
    if (node) node.textContent = value;
  }

  function thumbForLibrary(row) {
    if (row.thumb) return row.thumb;
    if (row.ytid) return "https://i.ytimg.com/vi/" + encodeURIComponent(row.ytid) + "/mqdefault.jpg";
    return "/visit/image.png";
  }

  function thumbForFeed(item) {
    const snippet = item.snippet || {};
    const thumbs = snippet.thumbnails || {};
    return (thumbs.medium || thumbs.high || thumbs.default || {}).url || "/visit/image.png";
  }

  function libraryCard(row) {
    const id = row._id || row.id || "";
    const videoId = row.ytid || "";
    const ready = Boolean(row.downloadable);
    return (
      '<article class="admin-video-card">' +
      '<div class="admin-video-thumb"><img loading="lazy" src="' + Admin.escape(thumbForLibrary(row)) +
      '" alt=""><span class="admin-badge admin-badge--' + (ready ? "ok" : "neutral") + '">' +
      (ready ? "downloadable" : "page only") + "</span></div>" +
      '<div class="admin-video-body">' +
      '<div class="admin-video-title" title="' + Admin.escape(row.title) + '">' + Admin.escape(row.title || "Untitled clip") + "</div>" +
      '<div class="admin-video-meta"><span>' + Admin.escape(row.channelTitle || "D74 Edits") + "</span><span>" +
      Admin.date(row.date, { dateStyle: "medium" }) + "</span></div>" +
      '<div class="admin-video-actions">' +
      (videoId
        ? '<a class="btn btn-ghost btn-sm" href="/Admin/edit_video/?id=' + encodeURIComponent(videoId) + '">Edit</a>' +
          '<a class="btn btn-ghost btn-sm" href="/visit/?id=' + encodeURIComponent(videoId) + '" target="_blank" rel="noopener">Open</a>'
        : "") +
      '<button class="btn btn-danger btn-sm" type="button" data-delete="' + Admin.escape(id) +
      '" data-title="' + Admin.escape(row.title || videoId) + '">Delete</button>' +
      "</div></div></article>"
    );
  }

  function feedCard(item) {
    const snippet = item.snippet || {};
    const rawId = (item.id && (item.id.videoId || item.id)) || "";
    const videoId = typeof rawId === "string" ? rawId : "";
    return (
      '<article class="admin-video-card">' +
      '<div class="admin-video-thumb"><img loading="lazy" src="' + Admin.escape(thumbForFeed(item)) +
      '" alt=""><span class="admin-badge admin-badge--accent">youtube</span></div>' +
      '<div class="admin-video-body">' +
      '<div class="admin-video-title" title="' + Admin.escape(snippet.title) + '">' +
      Admin.escape(snippet.title || "Untitled clip") + "</div>" +
      '<div class="admin-video-meta"><span>' + Admin.escape(snippet.channelTitle || "Channel") + "</span><span>" +
      Admin.date(snippet.publishedAt, { dateStyle: "medium" }) + "</span></div>" +
      '<div class="admin-video-actions">' +
      (videoId
        ? '<a class="btn btn-primary btn-sm" href="/Admin/init/?id=' + encodeURIComponent(videoId) + '">Install</a>' +
          '<a class="btn btn-ghost btn-sm" href="https://youtube.com/watch?v=' + encodeURIComponent(videoId) +
          '" target="_blank" rel="noopener">YouTube</a>'
        : '<span class="admin-muted">No video id</span>') +
      "</div></div></article>"
    );
  }

  function visibleLibrary() {
    const query = state.query.trim().toLowerCase();
    return state.all.filter((row) => {
      const downloadable = Boolean(row.downloadable);
      if (state.filter === "downloadable" && !downloadable) return false;
      if (state.filter === "page" && downloadable) return false;
      if (!query) return true;
      return [row.title, row.ytid, row.channelTitle, row.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }

  function renderLibrary() {
    const host = $("videoGrid");
    if (!host) return;
    const rows = visibleLibrary();
    const page = rows.slice(state.offset, state.offset + state.limit);
    text("videosCount", rows.length + " records");
    if (!page.length) {
      Admin.emptyState(
        host,
        "videocam-off-outline",
        state.all.length ? "No matches" : "Library is empty",
        state.all.length
          ? "Adjust the search or filter, or sync the YouTube channel."
          : "Install a clip or run a channel sync to populate the database."
      );
    } else {
      host.innerHTML = page.map(libraryCard).join("");
    }
    const start = rows.length ? state.offset + 1 : 0;
    const end = Math.min(rows.length, state.offset + state.limit);
    text("videoPageInfo", start + "–" + end + " of " + rows.length);
    const prev = $("videoPrev");
    const next = $("videoNext");
    if (prev) prev.disabled = state.offset <= 0;
    if (next) next.disabled = state.offset + state.limit >= rows.length;
    bindDelete();
  }

  function renderFeed() {
    const host = $("videoGrid");
    if (!host) return;
    if (!state.feed.length) {
      Admin.emptyState(host, "logo-youtube", "No channel videos", "The live feed returned no clips. Try Refresh.");
    } else {
      host.innerHTML = state.feed.map(feedCard).join("");
    }
    text("videosCount", state.feed.length + " feed clips");
    text("videoPageInfo", state.feed.length ? state.feed.length + " loaded from YouTube" : "—");
    const prev = $("videoPrev");
    const next = $("videoNext");
    if (prev) prev.disabled = true;
    if (next) next.disabled = !state.pageToken;
  }

  function bindDelete() {
    document.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.dataset.delete;
        if (!id) return;
        if (!window.confirm('Delete "' + (button.dataset.title || id) + '" from the database?')) return;
        button.disabled = true;
        const result = await db.remove("videos/" + encodeURIComponent(id));
        if (result.status === 401) {
          Admin.redirectToLogin("expired");
          return;
        }
        if (result.ok) {
          state.all = state.all.filter((row) => (row._id || row.id) !== id);
          renderLibrary();
          Admin.toast("Video record deleted.", "ok");
        } else {
          const body = result.json() || {};
          Admin.toast(body.error || "Could not delete the record.", "error");
          button.disabled = false;
        }
      });
    });
  }

  async function loadLibrary() {
    if (state.loading) return;
    state.loading = true;
    const result = await db.adminVideos({ limit: 1000 });
    state.loading = false;
    if (result.status === 401) {
      Admin.redirectToLogin("expired");
      return;
    }
    const body = result.json() || {};
    if (!result.ok) {
      Admin.toast(body.error || "Could not load the video library.", "error");
      return;
    }
    state.all = Array.isArray(body.items) ? body.items : [];
    state.offset = Math.min(state.offset, Math.max(0, state.all.length - 1));
    renderLibrary();
  }

  function loadFeed(more) {
    if (state.loading) return;
    state.loading = true;
    const host = $("videoGrid");
    if (!more && host) host.innerHTML = '<p class="admin-muted" style="padding:16px">Loading channel feed…</p>';
    db.getYTchannelVideos((xhr) => {
      state.loading = false;
      if (xhr.status === 401) {
        Admin.redirectToLogin("expired");
        return;
      }
      const body = xhr.json() || {};
      if (!xhr.ok || !Array.isArray(body.items)) {
        state.feed = [];
        state.pageToken = "";
        Admin.emptyState(host, "cloud-offline-outline", "Channel unavailable",
          (body && body.error) || "YouTube did not respond. Try again shortly.");
        return;
      }
      state.feed = more ? state.feed.concat(body.items) : body.items;
      state.pageToken = body.nextPageToken || "";
      renderFeed();
    }, more && state.pageToken ? state.pageToken : false);
  }

  async function loadSync() {
    const result = await db.adminYoutubeStatus();
    if (result.status === 401) return;
    const body = result.json() || {};
    if (!result.ok) return;
    const status = $("videoSyncStatus");
    if (status) {
      status.textContent = body.running ? "running" : body.enabled ? "scheduled" : "disabled";
      status.className = "admin-badge " + (body.running ? "admin-badge--info" : body.enabled ? "admin-badge--ok" : "admin-badge--warn");
    }
    const host = $("videoSyncChannels");
    if (host) {
      const channels = Array.isArray(body.channels) ? body.channels : [];
      host.innerHTML = channels.length
        ? channels
            .map(
              (channel) =>
                '<div class="admin-alert"><ion-icon name="logo-youtube" aria-hidden="true"></ion-icon><span>' +
                "<strong>" + Admin.escape(channel.title || channel.name) + "</strong> · " +
                Admin.escape(channel.status || "idle") + '<br><span class="admin-muted">Last sync ' +
                Admin.timeAgo(channel.lastSyncAt) + " · " + Admin.number(channel.created) + " added</span></span></div>"
            )
            .join("")
        : '<p class="admin-muted">No channels configured.</p>';
    }
  }

  function switchView(view) {
    state.view = view;
    state.offset = 0;
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.view === view);
    });
    const filter = $("videosFilter");
    const search = $("videosSearch");
    if (filter) filter.disabled = view !== "library";
    if (search) search.disabled = view !== "library";
    if (view === "library") {
      loadLibrary();
    } else {
      state.feed = [];
      state.pageToken = "";
      loadFeed(false);
    }
  }

  async function startSync() {
    const button = $("videosSync");
    if (button) button.disabled = true;
    const result = await db.adminYoutubeSync({ wait: false });
    const body = result.json() || {};
    if (result.status === 409) Admin.toast(body.error || "A sync is already running.", "warn");
    else if (!result.ok) Admin.toast(body.error || "Could not start the sync.", "error");
    else Admin.toast("Sync started. This page updates as clips arrive.", "ok");
    if (button) button.disabled = false;
  }

  Admin.ready(() => {
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => switchView(button.dataset.view));
    });

    const search = $("videosSearch");
    let searchTimer = null;
    if (search) {
      search.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          state.query = search.value;
          state.offset = 0;
          renderLibrary();
        }, 220);
      });
    }

    const filter = $("videosFilter");
    if (filter) {
      filter.addEventListener("change", () => {
        state.filter = filter.value;
        state.offset = 0;
        renderLibrary();
      });
    }

    const prev = $("videoPrev");
    if (prev) {
      prev.addEventListener("click", () => {
        if (state.view !== "library") return;
        state.offset = Math.max(0, state.offset - state.limit);
        renderLibrary();
      });
    }
    const next = $("videoNext");
    if (next) {
      next.addEventListener("click", () => {
        if (state.view === "library") {
          state.offset += state.limit;
          renderLibrary();
        } else if (state.pageToken) {
          loadFeed(true);
        }
      });
    }

    const refresh = $("videosRefresh");
    if (refresh) {
      refresh.addEventListener("click", () => {
        if (state.view === "library") loadLibrary();
        else {
          state.feed = [];
          state.pageToken = "";
          loadFeed(false);
        }
        loadSync();
      });
    }

    const sync = $("videosSync");
    if (sync) sync.addEventListener("click", startSync);

    // Replace broken YouTube thumbnails with the local placeholder.
    const grid = $("videoGrid");
    if (grid) {
      grid.addEventListener(
        "error",
        (event) => {
          const image = event.target;
          if (!image || image.tagName !== "IMG" || image.dataset.fallback) return;
          image.dataset.fallback = "1";
          image.src = "/visit/image.png";
        },
        true
      );
    }

    loadLibrary();
    loadSync();

    Admin.onEvent((event) => {
      if (event.type === "sync:completed") {
        Admin.toast("YouTube sync completed.", "ok");
        loadSync();
        if (state.view === "library") loadLibrary();
      } else if (event.type === "video:created" || event.type === "video:updated" || event.type === "video:deleted") {
        if (state.view === "library") loadLibrary();
      }
    });
  });
})();
