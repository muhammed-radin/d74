"use strict";

/* ------------------------------------------------------------------
   Explore feed controller
------------------------------------------------------------------ */

(function () {
  const clipsBox = document.getElementById("clipsbox");
  const exploreBox = document.getElementById("explorebox");
  const matchesBox = document.getElementById("matchtoday");
  const channelBox = document.getElementById("channelbox");
  const loader = document.getElementById("pageLoader");
  const clipsLoader = document.getElementById("clipsLoader");
  let pageToken = null;
  let loadingVideos = false;
  let pendingLoads = 2;

  function parse(xhr) {
    if (!xhr) return null;
    if (typeof xhr.json === "function") return xhr.json();
    try {
      return JSON.parse(xhr.response);
    } catch (_) {
      return null;
    }
  }

  function finishLoad() {
    if (pendingLoads > 0) pendingLoads -= 1;
    if (pendingLoads <= 0 && loader) loader.classList.add("is-hidden");
  }

  function emptyState(icon, title, copy) {
    return (
      '<div class="empty-state" style="grid-column:1/-1;width:100%">' +
      '<ion-icon name="' + icon + '"></ion-icon>' +
      "<h3>" + title + "</h3><p>" + copy + "</p></div>"
    );
  }

  function playLive(url) {
    if (!url) return;
    try {
      const parsed = new URL(url, window.location.href);
      if (!["http:", "https:"].includes(parsed.protocol)) return;
      window.open(parsed.href, "_blank", "noopener,noreferrer");
    } catch (_) {}
  }

  document.addEventListener("click", function (event) {
    const trigger = event.target.closest("[data-stream-url]");
    if (trigger) {
      playLive(trigger.dataset.streamUrl);
    }
  });

  /* ---------------------------- matches --------------------------- */

  function loadMatches() {
    if (!matchesBox) return;
    db.getLiveAndHL(function (xhr) {
      const data = parse(xhr);
      matchesBox.innerHTML = "";
      if (!Array.isArray(data) || !data.length) {
        matchesBox.innerHTML = emptyState(
          "football-outline",
          "No matches right now",
          "Check back soon, or open live TV to browse all channels."
        );
        finishLoad();
        return;
      }
      const sorted = data
        .slice()
        .sort(function (a, b) {
          return String(b.date || "").localeCompare(String(a.date || ""));
        })
        .slice(0, 12);

      sorted.forEach(function (match) {
        matchesBox.appendChild(live_card_ui.create(match).parseElement()[0]);
      });
      matchesBox.appendChild(live_card_ui.createViewMoreCard().parseElement()[0]);
      finishLoad();
    });
  }

  /* ----------------------------- videos --------------------------- */

  function createLoadButton() {
    if (!clipsLoader) return;
    clipsLoader.innerHTML =
      '<button class="btn btn-ghost btn-block" type="button" id="loadMoreBtn">' +
      '<ion-icon name="add-circle-outline"></ion-icon> Load more clips</button>';
    const button = document.getElementById("loadMoreBtn");
    if (button) {
      button.addEventListener("click", function () {
        if (!pageToken || loadingVideos) return;
        button.classList.add("is-loading");
        button.innerHTML = '<span class="loader-sml"></span> Loading…';
        loadVideos(pageToken, clipsBox, true);
      });
    }
  }

  function renderVideos(result, root, append) {
    const data = parse(result);
    if (!root) return;
    if (!data || !Array.isArray(data.items) || data.status >= 400) {
      if (!append) {
        root.innerHTML = emptyState(
          "cloud-offline-outline",
          "Clips are taking a break",
          "The video service did not respond. Try refreshing in a moment."
        );
      }
      if (window.toast) toast("Could not load clips right now.", "error");
      return;
    }

    if (!append) root.innerHTML = "";
    data.items.forEach(function (item, index) {
      if (!item || !item.id || !item.id.videoId) return;
      const id = "clip_" + (item.id.videoId || index) + "_" + index;
      root.appendChild(d74_structure.create(item, id, index).parseElement()[0]);
    });
    pageToken = data.nextPageToken || null;
    if (!append) createLoadButton();
    if (!pageToken && clipsLoader) clipsLoader.innerHTML = "";
  }

  function loadVideos(token, root, append) {
    if (loadingVideos) return;
    loadingVideos = true;
    db.getYTchannelVideos(function (result) {
      loadingVideos = false;
      renderVideos(result, root, append);
      if (!append && root === clipsBox) finishLoad();
    }, token || false);
  }

  /* ---------------------------- channels -------------------------- */

  function initials(name) {
    const parts = String(name || "TV").trim().split(/\s+/);
    return parts
      .slice(0, 2)
      .map(function (part) {
        return part.charAt(0);
      })
      .join("")
      .toUpperCase();
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

  function esc(value) {
    return window.D74UI
      ? D74UI.escapeHTML(value)
      : String(value == null ? "" : value);
  }

  function loadChannels() {
    if (!channelBox) return;
    db.channels().then(function (xhr) {
      const data = parse(xhr);
      if (!Array.isArray(data) || !data.length) {
        channelBox.innerHTML = emptyState(
          "tv-outline",
          "No channels yet",
          "Live TV channels will appear here once they are published."
        );
        return;
      }
      channelBox.innerHTML = "";
      data
        .slice()
        .sort(function (a, b) {
          return (
            Number(Boolean(b.featured)) - Number(Boolean(a.featured)) ||
            (Number(a.order) || 0) - (Number(b.order) || 0) ||
            channelTitle(a).localeCompare(channelTitle(b))
          );
        })
        .slice(0, 14)
        .forEach(function (channel, index) {
          const name = channelTitle(channel);
          const logo = safeLogo(channel.logo);
          const card = document.createElement("a");
          card.className = "channel-card enter";
          card.href = "../livestreams/?id=" + encodeURIComponent(channel.id);
          card.style.animationDelay = Math.min(index * 40, 360) + "ms";
          card.innerHTML =
            '<div class="channel-logo">' +
            (logo
              ? '<img src="' + esc(logo) + '" alt="" loading="lazy" onerror="this.onerror=null;this.src=\'../logo.png\';this.classList.add(\'is-logo\')">'
              : '<img class="is-logo" src="../logo.png" alt="" loading="lazy">') +
            "</div>" +
            '<div class="channel-name">' +
            esc(name) +
            "</div>" +
            '<span class="badge badge-accent">Live</span>';
          channelBox.appendChild(card);
        });
    });
  }

  /* ----------------------------- search --------------------------- */

  const searchForm = document.getElementById("exploreSearch");
  if (searchForm) {
    searchForm.addEventListener("submit", function (event) {
      event.preventDefault();
      const input = document.getElementById("exploreSearchInput");
      const query = (input && input.value.trim()) || "";
      window.location.href = "../search/" + (query ? "?q=" + encodeURIComponent(query) : "");
    });
  }

  /* ------------------------------ boot ---------------------------- */

  loadMatches();
  loadVideos(null, clipsBox, false);
  loadChannels();

  // A second page populates the "Discover more" grid once the feed is warm.
  setTimeout(function () {
    if (pageToken && exploreBox && !exploreBox.children.length) {
      db.getYTchannelVideos(function (result) {
        renderVideos(result, exploreBox, false);
      }, pageToken);
    }
  }, 1600);
})();
