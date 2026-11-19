"use strict";

/* Card renderer for YouTube search results. */

const d74_structure = {
  create(data, id, index = 0) {
    const esc = window.D74UI ? window.D74UI.escapeHTML : (v) => String(v == null ? "" : v);
    const snippet = (data && data.snippet) || {};
    const thumbs = snippet.thumbnails || {};
    const image = (thumbs.medium || thumbs.high || thumbs.default || {}).url || "../logo.png";
    const videoId = (data && data.id && data.id.videoId) || "";
    const title = snippet.title || "Untitled clip";
    const published = snippet.publishedAt
      ? window.dayjs
        ? window.dayjs(snippet.publishedAt).fromNow()
        : String(snippet.publishedAt).slice(0, 10)
      : "Recently";

    return new TagString(`
<article class="clip-card enter" id="${esc(id)}" style="animation-delay:${Math.min(index * 45, 400)}ms">
  <a class="clip-link" href="../visit/?id=${encodeURIComponent(videoId)}" aria-label="${esc(title)}">
    <div class="clip-thumb">
      <img loading="lazy" src="${esc(image)}" alt="" onerror="this.onerror=null;this.src='../logo.png';this.classList.add('is-logo');this.parentNode.classList.add('is-fallback')">
      <span class="clip-play" aria-hidden="true"><ion-icon name="play"></ion-icon></span>
    </div>
    <div class="clip-body">
      <div class="clip-title">${esc(title)}</div>
      <div class="clip-meta">
        <span class="clip-channel">D74 Edits</span>
        <span>${esc(published)}</span>
      </div>
    </div>
  </a>
</article>`);
  },
};
