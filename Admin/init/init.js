"use strict";

/* ------------------------------------------------------------------
   Admin installer
   Fetches metadata through the server proxy, then writes the record
   through the authenticated database proxy.
------------------------------------------------------------------ */

(function () {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  let ytId = params.get("id") || "";
  let loaded = false;

  function status(message, tone) {
    const box = $("installStatus");
    if (!box) return;
    box.className = "admin-alert" + (tone ? " admin-alert--" + tone : " admin-alert--info");
    box.innerHTML =
      '<ion-icon name="' + (tone === "error" ? "alert-circle-outline" : tone === "warn" ? "warning-outline" : "information-circle-outline") +
      '" aria-hidden="true"></ion-icon><span>' + Admin.escape(message) + "</span>";
  }

  function error(message) {
    const box = $("installError");
    if (!box) return;
    box.textContent = message || "";
    box.classList.toggle("show", Boolean(message));
  }

  function decode(value) {
    return String(value || "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'");
  }

  function bestThumb(thumbs) {
    const set = thumbs || {};
    return ((set.maxres || set.high || set.medium || set.standard || set.default || {}).url) || "";
  }

  function preview(item) {
    const host = $("installPreview");
    if (!host) return;
    const snippet = item.snippet || {};
    const thumb = bestThumb(snippet.thumbnails) || ($("installThumb") && $("installThumb").value);
    host.innerHTML =
      '<div class="admin-video-card">' +
      '<div class="admin-video-thumb"><img src="' + Admin.escape(thumb || "/visit/image.png") + '" alt=""></div>' +
      '<div class="admin-video-body"><div class="admin-video-title">' +
      Admin.escape(decode(snippet.title || "Untitled clip")) + "</div>" +
      '<div class="admin-video-meta"><span>' + Admin.escape(snippet.channelTitle || "YouTube") +
      "</span><span>" + Admin.date(snippet.publishedAt, { dateStyle: "medium" }) + "</span></div>" +
      '<div class="admin-actions"><a class="btn btn-ghost btn-sm" href="https://youtube.com/watch?v=' +
      encodeURIComponent(ytId) + '" target="_blank" rel="noopener">Open on YouTube</a></div></div></div>';
    const source = $("installSource");
    if (source) source.textContent = item.__source || "youtube";
  }

  function fill(item) {
    const snippet = item.snippet || {};
    $("installTitle").value = decode(snippet.title || "");
    $("installDate").value = snippet.publishedAt || "";
    $("installChannel").value = snippet.channelTitle || "";
    $("installThumb").value = bestThumb(snippet.thumbnails) ||
      "https://i.ytimg.com/vi/" + encodeURIComponent(ytId) + "/mqdefault.jpg";
    $("installDescription").value = decode(snippet.description || "");
    const youtube = $("installYoutube");
    if (youtube) {
      youtube.href = "https://youtube.com/watch?v=" + encodeURIComponent(ytId);
      youtube.hidden = false;
    }
    const save = $("installSave");
    if (save) save.disabled = false;
    loaded = true;
  }

  async function load() {
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(ytId)) {
      status("No valid video id was provided. Pick a clip from the Videos page or enter an id.", "warn");
      return;
    }
    $("lookupId").value = ytId;
    status("Fetching metadata for " + ytId + "…");
    const result = await db.getVideo(ytId);
    if (result.status === 401) {
      Admin.redirectToLogin("expired");
      return;
    }
    const body = result.json() || {};
    if (!result.ok) {
      status((body && body.error) || "Could not fetch video metadata.", "error");
      return;
    }
    const item = body && Array.isArray(body.items) ? body.items[0] : null;
    if (!item) {
      status("YouTube returned no metadata for this id.", "error");
      return;
    }
    item.__source = body.source || "youtube";
    fill(item);
    preview(item);
    status("Metadata loaded. Review the record and create it.", "info");
  }

  async function save(event) {
    event.preventDefault();
    error("");
    if (!loaded) {
      error("Load the video metadata first.");
      return;
    }
    const title = $("installTitle").value.trim();
    if (!title) {
      error("A title is required.");
      return;
    }
    const record = {
      ytid: ytId,
      title,
      description: $("installDescription").value.trim(),
      date: $("installDate").value.trim() || new Date().toISOString(),
      thumb: $("installThumb").value.trim(),
      channelTitle: $("installChannel").value.trim(),
      source: "admin-installer",
    };
    const url = $("installUrl").value.trim();
    if (url) record.url = url;

    const button = $("installSave");
    if (button) button.disabled = true;
    status("Creating the database record…");
    try {
      const result = await db.push("videos", record);
      if (result.status === 401) {
        Admin.redirectToLogin("expired");
        return;
      }
      const body = result.json() || {};
      if (!result.ok) {
        status(body.error || "Could not create the record.", "error");
        error(body.error || "Could not create the record.");
        return;
      }
      const meta = $("installMetaState");
      if (meta) meta.textContent = "Saved";
      status("Record created. The public site and admin library update automatically.", "ok");
      Admin.toast("Video record created.", "ok");
      setTimeout(() => {
        window.location.href = "/Admin/videos/";
      }, 900);
    } finally {
      if (button) button.disabled = false;
    }
  }

  Admin.ready(() => {
    $("lookupForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const value = $("lookupId").value.trim();
      if (!/^[A-Za-z0-9_-]{6,20}$/.test(value)) {
        status("Enter a valid YouTube video id.", "warn");
        return;
      }
      ytId = value;
      window.history.replaceState(null, "", "/Admin/init/?id=" + encodeURIComponent(value));
      load();
    });
    $("installForm").addEventListener("submit", save);
    $("installTitle").addEventListener("input", () => error(""));
    load();
  });
})();
