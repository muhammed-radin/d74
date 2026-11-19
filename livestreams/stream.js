"use strict";

/* ------------------------------------------------------------------
   Live TV controller
   Channel list comes from the server; player resolves keys server-side.
------------------------------------------------------------------ */

(function () {
  const frame = document.getElementById("frame");
  const title = document.getElementById("title");
  const list = document.getElementById("list");
  const count = document.getElementById("channelCount");
  const search = document.getElementById("channelSearch");
  const random = document.getElementById("randomChannel");
  const loader = document.getElementById("pageLoader");

  const esc =
    window.D74UI && D74UI.escapeHTML
      ? D74UI.escapeHTML
      : (value) => String(value == null ? "" : value);

  let channels = [];
  let currentId = "";

  function params() {
    return new URLSearchParams(window.location.search);
  }

  function hideLoader() {
    if (loader) loader.classList.add("is-hidden");
  }

  function channelTitle(channel) {
    return String((channel && (channel.title || channel.name)) || (channel && channel.id) || "Live TV");
  }

  function safeLogo(value) {
    const logo = String(value || "").trim();
    if (/^\/[^/]/.test(logo)) return logo;
    if (/^(https?:)?\/\/[^\s]+$/i.test(logo)) return logo;
    return "";
  }

  function initials(name) {
    return String(name || "TV")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase();
  }

  function setActive(id) {
    list.querySelectorAll(".channel-btn").forEach(function (button) {
      button.classList.toggle("active", button.dataset.id === id);
      button.setAttribute("aria-pressed", button.dataset.id === id ? "true" : "false");
    });
  }

  function play(id, options = {}) {
    const channel = channels.find((item) => item.id === id);
    if (!channel || !frame) return;
    currentId = id;
    frame.src = "../livehelper/player.html?id=" + encodeURIComponent(id);
    if (title) title.textContent = channelTitle(channel);
    document.title = channelTitle(channel) + " · D74 Edits Live TV";
    setActive(id);
    try {
      localStorage.setItem("lastChannel", id);
    } catch (_) {}
    if (options.updateUrl !== false) {
      const query = params();
      query.set("id", id);
      try {
        history.replaceState(null, "", "?" + query.toString());
      } catch (_) {}
    }
    if (options.toast) {
      const active = list.querySelector('.channel-btn[data-id="' + CSS.escape(id) + '"]');
      if (active) active.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function render(filter) {
    if (!list) return;
    const term = String(filter || "").trim().toLowerCase();
    const visible = channels.filter(function (channel) {
      const name = channelTitle(channel);
      return (
        !term ||
        name.toLowerCase().includes(term) ||
        channel.id.toLowerCase().includes(term) ||
        String(channel.category || "").toLowerCase().includes(term) ||
        String(channel.country || "").toLowerCase().includes(term)
      );
    });

    list.innerHTML = "";
    if (!visible.length) {
      list.innerHTML =
        '<div class="empty-state" style="grid-column:1/-1">' +
        '<ion-icon name="tv-outline"></ion-icon>' +
        "<h3>No channels found</h3><p>Try a different name.</p></div>";
      return;
    }

    const fragment = document.createDocumentFragment();
    visible.forEach(function (channel) {
      const name = channelTitle(channel);
      const logo = safeLogo(channel.logo);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "channel-btn" + (channel.id === currentId ? " active" : "");
      button.dataset.id = channel.id;
      button.setAttribute("aria-pressed", channel.id === currentId ? "true" : "false");
      button.innerHTML =
        (logo
          ? '<span class="channel-avatar channel-avatar--logo"><img src="' +
            esc(logo) +
            '" alt="" loading="lazy" onerror="this.onerror=null;this.src=\'/logo.png\'"></span>'
          : '<span class="channel-avatar channel-avatar--logo"><img src="/logo.png" alt="" loading="lazy"></span>') +
        "<span>" + esc(name) + "</span>" +
        '<ion-icon name="play-circle-outline"></ion-icon>';
      button.addEventListener("click", function () {
        play(channel.id);
      });
      fragment.appendChild(button);
    });
    list.appendChild(fragment);
  }

  function boot(data, failed) {
    channels = Array.isArray(data) ? data : [];
    if (!channels.length) {
      if (count) count.textContent = failed ? "Unavailable" : "No channels yet";
      list.innerHTML = failed
        ? '<div class="empty-state" style="grid-column:1/-1">' +
          '<ion-icon name="cloud-offline-outline"></ion-icon>' +
          "<h3>Channels unavailable</h3><p>Live TV could not load. Try refreshing.</p></div>"
        : '<div class="empty-state" style="grid-column:1/-1">' +
          '<ion-icon name="tv-outline"></ion-icon>' +
          "<h3>No channels yet</h3><p>Live TV channels will appear here once they are published.</p></div>";
      hideLoader();
      return;
    }

    channels.sort(function (a, b) {
      const order = (Number(a.order) || 0) - (Number(b.order) || 0);
      return order || channelTitle(a).localeCompare(channelTitle(b));
    });

    if (count) {
      count.textContent =
        channels.length + (channels.length === 1 ? " channel available" : " channels available");
    }

    const requested = params().get("id");
    let last = "";
    try {
      last = localStorage.getItem("lastChannel") || "";
    } catch (_) {}

    const initial =
      channels.find((channel) => channel.id === requested) ||
      channels.find((channel) => channel.id === last) ||
      channels[0];

    render("");
    if (initial) play(initial.id, { updateUrl: Boolean(requested) });
    hideLoader();
  }

  if (search) {
    search.addEventListener("input", function () {
      render(search.value);
    });
  }

  if (random) {
    random.addEventListener("click", function () {
      if (!channels.length) return;
      const next = channels[Math.floor(Math.random() * channels.length)];
      play(next.id, { toast: true });
    });
  }

  if (frame) {
    frame.addEventListener("load", hideLoader);
  }

  db.channels().then(function (xhr) {
    let data = null;
    try {
      data = typeof xhr.json === "function" ? xhr.json() : JSON.parse(xhr.response);
    } catch (_) {}
    const failed = !xhr || xhr.status === 0 || xhr.status === 401 || xhr.status >= 500;
    boot(Array.isArray(data) ? data : null, failed);
  });
})();
