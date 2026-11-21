"use strict";

/* ------------------------------------------------------------------
   Clip detail controller
   Metadata comes from the YouTube proxy (with the database as a
   fallback). Downloads are free: the viewer asks the server to prepare
   the file, then delegates to the yt-dlp streaming endpoint. Nothing is
   password-protected and no download URL is exposed in the page.
------------------------------------------------------------------ */

(function () {
  const esc =
    window.D74UI && D74UI.escapeHTML
      ? D74UI.escapeHTML
      : (value) => String(value == null ? "" : value);

  const $ = (id) => document.getElementById(id);

  const thumb = $("thumb");
  const title = $("title");
  const channel = $("channel");
  const date = $("date");
  const views = $("views");
  const summary = $("summary");
  const description = $("pr");
  const tags = $("tags");
  const dl = $("dl");
  const dlLabel = $("dlLabel");
  const wt = $("wt");
  const copyLink = $("copyLink");
  const note = $("downloadNote");
  const loader = $("pageLoader");
  const player = $("player");
  const playBtn = $("playBtn");
  const similarSection = $("similarSection");
  const similarGrid = $("similarGrid");

  const id = new URLSearchParams(window.location.search).get("id") || "";
  const validId = /^[A-Za-z0-9_-]{6,20}$/.test(id);

  let record = null;
  let downloading = false;

  function parse(xhr) {
    if (!xhr) return null;
    if (typeof xhr.json === "function") return xhr.json();
    try {
      return JSON.parse(xhr.response);
    } catch (_) {
      return null;
    }
  }

  function hideLoader() {
    if (loader) loader.classList.add("is-hidden");
  }

  function compact(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return "";
    return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(number) +
      " views";
  }

  function readableDate(value) {
    if (!value) return "—";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
    return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function linkify(escaped) {
    return escaped.replace(/(https?:\/\/[^\s<]+)/g, function (url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + "</a>";
    });
  }

  function renderDescription(text) {
    const escaped = esc(text || "").replace(/\r\n/g, "\n");
    return linkify(escaped).replace(/\n/g, "<br>");
  }

  function bestThumb(item, row) {
    if (row && row.thumb) return row.thumb;
    const snippet = (item && item.snippet) || {};
    const thumbs = snippet.thumbnails || {};
    return (
      (thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || thumbs.default || {}).url ||
      (validId ? "https://i.ytimg.com/vi/" + encodeURIComponent(id) + "/hqdefault.jpg" : "image.png")
    );
  }

  function failState(message) {
    if (title) title.textContent = "Clip not found";
    if (summary) {
      summary.innerHTML = esc(message) + ' <a href="../explore/">Browse other clips</a>.';
    }
    if (thumb) thumb.src = "image.png";
    if (channel) channel.textContent = "D74 Edits";
    if (date) date.textContent = "—";
    if (views) views.textContent = "";
    if (description) description.textContent = "This clip could not be loaded.";
    if (dl) dl.hidden = true;
    if (wt) wt.hidden = true;
    if (copyLink) copyLink.hidden = true;
    if (note) note.hidden = true;
    if (playBtn) playBtn.hidden = true;
    hideLoader();
  }

  /* --------------------------- player ----------------------------- */

  function play() {
    if (!player || !validId || player.querySelector("iframe")) return;
    const iframe = document.createElement("iframe");
    iframe.className = "video-iframe";
    iframe.src =
      "https://www.youtube-nocookie.com/embed/" +
      encodeURIComponent(id) +
      "?autoplay=1&rel=0&modestbranding=1&playsinline=1";
    iframe.title = (title && title.textContent) || "D74 clip";
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.setAttribute("allowfullscreen", "");
    iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    player.classList.add("is-playing");
    player.appendChild(iframe);
  }

  /* --------------------------- metadata --------------------------- */

  function render(item, row) {
    const snippet = (item && item.snippet) || {};
    const stats = (item && item.statistics) || {};
    const image = bestThumb(item, row);
    const heading = snippet.title || (row && row.title) || "Football clip";
    const channelName = snippet.channelTitle || (row && row.channelTitle) || "D74 Edits";
    const published = snippet.publishedAt || (row && row.date) || "";
    const text = snippet.description || (row && row.description) || "";

    if (thumb) thumb.src = image;
    if (title) title.textContent = heading;
    if (dl) dl.setAttribute("href", "/api/videos/download?id=" + encodeURIComponent(id));
    if (channel) channel.textContent = channelName;
    if (date) date.textContent = readableDate(published);
    if (views) views.textContent = compact(stats.viewCount);
    if (summary) {
      const short = String(text || "").split("\n")[0].trim();
      summary.textContent = short || "A free football clip from D74 Edits.";
    }
    if (description) description.innerHTML = renderDescription(text || "No description provided.");
    document.title = heading + " · D74 Edits";

    if (tags) {
      tags.innerHTML = "";
      const list = Array.isArray(snippet.tags)
        ? snippet.tags
        : Array.isArray(row && row.tags)
          ? row.tags
          : [];
      list.slice(0, 14).forEach(function (tag) {
        const chip = document.createElement("a");
        chip.className = "tag";
        chip.href = "../search/?q=" + encodeURIComponent(tag);
        chip.textContent = tag;
        tags.appendChild(chip);
      });
      if (!list.length) tags.innerHTML = '<span class="small" style="color:var(--muted)">No tags</span>';
    }
  }

  async function loadVideo() {
    const results = await Promise.all([
      db.getVideo(id).catch(() => null),
      db.get(new db.Coll("videos", { ytid: id })).catch(() => null),
    ]);

    const detail = parse(results[0]);
    const rows = parse(results[1]);
    record = Array.isArray(rows) ? rows[0] : rows;

    const item = detail && Array.isArray(detail.items) ? detail.items[0] : null;
    if (!item && !record) {
      const offline = results[0] && results[0].status === 0;
      failState(
        offline
          ? "The video service is unreachable. Check your connection."
          : "We couldn't load this clip right now."
      );
      return;
    }

    render(item, record);
    hideLoader();
    loadSimilar();
  }

  /* --------------------------- similar ---------------------------- */

  function card(row, index) {
    const image = row.thumb || "https://i.ytimg.com/vi/" + encodeURIComponent(row.ytid) + "/mqdefault.jpg";
    const when = row.date ? readableDate(row.date) : "";
    return (
      '<article class="clip-card enter" style="animation-delay:' +
      Math.min(index * 40, 360) +
      'ms">' +
      '<a class="clip-link" href="../visit/?id=' +
      encodeURIComponent(row.ytid) +
      '" aria-label="' +
      esc(row.title) +
      '">' +
      '<div class="clip-thumb">' +
      '<img loading="lazy" src="' +
      esc(image) +
      '" alt="" onerror="this.onerror=null;this.src=\'../logo.png\';this.classList.add(\'is-logo\');this.parentNode.classList.add(\'is-fallback\')">' +
      '<span class="clip-play" aria-hidden="true"><ion-icon name="play"></ion-icon></span>' +
      "</div>" +
      '<div class="clip-body"><div class="clip-title">' +
      esc(row.title || "Untitled clip") +
      '</div><div class="clip-meta"><span class="clip-channel">' +
      esc(row.channelTitle || "D74 Edits") +
      "</span><span>" +
      esc(when) +
      "</span></div></div></a></article>"
    );
  }

  async function loadSimilar() {
    if (!similarSection || !similarGrid || !validId) return;
    try {
      const response = await fetch(
        "/api/videos/similar?id=" + encodeURIComponent(id) + "&limit=8",
        { headers: { Accept: "application/json" } }
      );
      if (!response.ok) return;
      const data = await response.json();
      const items = (data && Array.isArray(data.items) ? data.items : []).filter(
        (row) => row && /^[A-Za-z0-9_-]{6,20}$/.test(String(row.ytid || ""))
      );
      if (!items.length) return;
      similarGrid.innerHTML = items.map(card).join("");
      similarSection.hidden = false;
    } catch (_) {
      // Recommendations are an enhancement; never block the page.
    }
  }

  /* -------------------------- downloads --------------------------- */

  function setDownloading(on) {
    if (!dl) return;
    dl.classList.toggle("is-loading", on);
    dl.setAttribute("aria-busy", on ? "true" : "false");
    if (dlLabel) dlLabel.textContent = on ? "Preparing…" : "Download free";
  }

  async function startDownload(event) {
    event.preventDefault();
    if (downloading || !validId) return;
    downloading = true;
    setDownloading(true);
    try {
      const response = await fetch(
        "/api/videos/download?id=" + encodeURIComponent(id) + "&mode=url",
        { headers: { Accept: "application/json" } }
      );
      let data = null;
      try {
        data = await response.json();
      } catch (_) {
        data = null;
      }
      if (!response.ok) {
        const message = (data && data.error) || "This clip isn't available for download right now.";
        if (window.toast) toast(message, "error", 5000);
        downloading = false;
        setDownloading(false);
        return;
      }
      const target = (data && data.stream) || "/api/videos/download?id=" + encodeURIComponent(id);
      if (window.toast) toast("Preparing your free download…", "success", 2400);
      window.location.href = target;
      window.setTimeout(function () {
        downloading = false;
        setDownloading(false);
      }, 5000);
      return;
    } catch (_) {
      if (window.toast) toast("Network unavailable. Check your connection.", "error");
      downloading = false;
      setDownloading(false);
    }
  }

  if (dl) dl.addEventListener("click", startDownload);
  if (playBtn) playBtn.addEventListener("click", play);
  if (thumb) thumb.addEventListener("click", play);
  if (wt) {
    wt.addEventListener("click", function () {
      if (!validId) return;
      window.open("https://youtube.com/watch?v=" + encodeURIComponent(id), "_blank", "noopener,noreferrer");
    });
  }
  if (copyLink) {
    copyLink.addEventListener("click", async function () {
      const url = window.location.href;
      try {
        await navigator.clipboard.writeText(url);
        if (window.toast) toast("Link copied.", "success", 1800);
      } catch (_) {
        window.prompt("Copy this link", url);
      }
    });
  }

  /* ------------------------------ boot ---------------------------- */

  if (!validId) {
    failState("No clip was selected.");
  } else {
    loadVideo();
  }
})();
