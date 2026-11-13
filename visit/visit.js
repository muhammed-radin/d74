"use strict";

/* ------------------------------------------------------------------
   Clip detail controller
   Metadata comes from the YouTube proxy; download passwords are checked
   by the server so the link never reaches the browser until unlocked.
------------------------------------------------------------------ */

(function () {
  const esc =
    window.D74UI && D74UI.escapeHTML
      ? D74UI.escapeHTML
      : (value) => String(value == null ? "" : value);

  const thumb = document.getElementById("thumb");
  const title = document.getElementById("title");
  const date = document.getElementById("date");
  const views = document.getElementById("views");
  const summary = document.getElementById("summary");
  const description = document.getElementById("pr");
  const tags = document.getElementById("tags");
  const dl = document.getElementById("dl");
  const wt = document.getElementById("wt");
  const note = document.getElementById("downloadNote");
  const loader = document.getElementById("pageLoader");

  const modal = document.getElementById("unlockModal");
  const scrim = document.getElementById("unlockScrim");
  const closeBtn = document.getElementById("unlockClose");
  const form = document.getElementById("unlockForm");
  const password = document.getElementById("unlockPassword");
  const unlockError = document.getElementById("unlockError");
  const unlockSubmit = document.getElementById("unlockSubmit");

  const id = new URLSearchParams(window.location.search).get("id") || "";

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
    if (!Number.isFinite(number)) return "—";
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

  function failState(message) {
    if (title) title.textContent = "Clip not found";
    if (summary) {
      summary.innerHTML =
        esc(message) + ' <a href="../explore/">Browse other clips</a>.';
    }
    if (thumb) thumb.src = "image.png";
    if (date) date.textContent = "—";
    if (views) views.textContent = "—";
    if (description) description.textContent = "This clip could not be loaded.";
    if (dl) dl.hidden = true;
    if (wt) wt.hidden = true;
    if (note) note.hidden = true;
    hideLoader();
  }

  function openModal() {
    if (!modal || !scrim) return;
    modal.hidden = false;
    scrim.classList.add("open");
    document.body.style.overflow = "hidden";
    if (unlockError) unlockError.classList.remove("show");
    if (password) {
      password.value = "";
      setTimeout(() => password.focus(), 50);
    }
  }

  function closeModal() {
    if (!modal || !scrim) return;
    modal.hidden = true;
    scrim.classList.remove("open");
    document.body.style.overflow = "";
  }

  /* --------------------------- metadata --------------------------- */

  async function loadVideo() {
    const result = await db.getVideo(id);
    const data = parse(result);

    if (!data || !Array.isArray(data.items) || !data.items.length) {
      failState("We couldn't load this clip right now.");
      if (result && result.status === 0) {
        failState("The video service is unreachable. Check your connection.");
      }
      return;
    }

    const item = data.items[0];
    const snippet = item.snippet || {};
    const stats = item.statistics || {};
    const thumbs = snippet.thumbnails || {};
    const image =
      (thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || thumbs.default || {}).url || "image.png";

    if (thumb) thumb.src = image;
    if (title) {
      title.textContent = snippet.title || "Football clip";
      document.title = (snippet.title || "Clip") + " · D74 Edits";
    }
    if (date) date.textContent = readableDate(snippet.publishedAt);
    if (views) views.textContent = compact(stats.viewCount);
    if (summary) {
      const short = String(snippet.description || "").split("\n")[0].trim();
      summary.textContent = short || "A free football clip from D74 Edits.";
    }
    if (description) description.innerHTML = renderDescription(snippet.description || "No description provided.");

    if (tags) {
      tags.innerHTML = "";
      const list = Array.isArray(snippet.tags) ? snippet.tags.slice(0, 14) : [];
      list.forEach(function (tag) {
        const chip = document.createElement("a");
        chip.className = "tag";
        chip.href = "../search/?q=" + encodeURIComponent(tag);
        chip.textContent = tag;
        tags.appendChild(chip);
      });
      if (!list.length) tags.innerHTML = '<span class="small" style="color:var(--muted)">No tags</span>';
    }

    if (wt) {
      wt.addEventListener("click", function () {
        window.open("https://youtube.com/watch?v=" + encodeURIComponent(id), "_blank", "noopener,noreferrer");
      });
    }

    await loadDownloadAvailability();
    hideLoader();
  }

  /* -------------------------- downloads --------------------------- */

  async function loadDownloadAvailability() {
    const result = await db.get(new db.Coll("videos", { ytid: id }));
    const data = parse(result);
    const available =
      Array.isArray(data) && data.some((record) => record && record.downloadable === true);
    if (dl) dl.hidden = !available;
    if (note) note.hidden = !available;
  }

  if (dl) dl.addEventListener("click", openModal);
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (scrim) scrim.addEventListener("click", closeModal);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && modal && !modal.hidden) closeModal();
  });

  if (form) {
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (unlockError) unlockError.classList.remove("show");

      const value = password ? password.value : "";
      if (!value) {
        if (unlockError) {
          unlockError.textContent = "Please enter the download password.";
          unlockError.classList.add("show");
        }
        return;
      }

      unlockSubmit.disabled = true;
      unlockSubmit.classList.add("is-loading");
      unlockSubmit.innerHTML = '<span class="loader-sml"></span> Unlocking…';

      const result = await db.unlockClip(id, value);
      const data = parse(result);

      unlockSubmit.disabled = false;
      unlockSubmit.classList.remove("is-loading");
      unlockSubmit.innerHTML = "Unlock & download";

      if (result.status === 200 && data && data.url) {
        closeModal();
        if (window.toast) toast("Unlocked. Starting your download…", "success", 2200);
        startDownload(data.url);
        return;
      }

      let message = (data && data.error) || "Could not unlock this download.";
      if (result.status === 0) message = "Network unavailable. Check your connection.";
      if (result.status === 429) message = "Too many attempts. Please wait a few minutes.";
      if (unlockError) {
        unlockError.textContent = message;
        unlockError.classList.add("show");
      }
    });
  }

  function startDownload(url) {
    try {
      const parsed = new URL(url, window.location.href);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("bad url");
    } catch (_) {
      if (window.toast) toast("The download link is invalid.", "error");
      return;
    }

    try {
      if (localStorage.getItem("app") || localStorage.getItem("appCH")) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else if (String(url).includes("ddl=true")) {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "freeClip.mp4";
        anchor.rel = "noopener";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } else {
        window.location.href = url;
      }
    } catch (_) {
      window.location.href = url;
    }
  }

  /* ------------------------------ boot ---------------------------- */

  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
    failState("No clip was selected.");
  } else {
    loadVideo();
  }
})();
