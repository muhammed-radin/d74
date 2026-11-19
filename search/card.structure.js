"use strict";

/* Card renderer for the search page. */

const search_page_card = {
  create(data, id, index = 0) {
    const esc = window.D74UI ? window.D74UI.escapeHTML : (v) => String(v == null ? "" : v);
    const title = (data && data.title) || "Untitled clip";
    const thumb = (data && data.thumb) || "../logo.png";
    const ytid = (data && data.ytid) || "";
    const date = data && data.date
      ? window.dayjs
        ? window.dayjs(data.date).fromNow()
        : String(data.date).slice(0, 10)
      : "";

    return new TagString(`
<article class="clip-card enter" id="${esc(id)}" style="animation-delay:${Math.min(index * 40, 360)}ms">
  <a class="clip-link" href="../visit/?id=${encodeURIComponent(ytid)}" aria-label="${esc(title)}">
    <div class="clip-thumb">
      <img loading="lazy" src="${esc(thumb)}" alt="" onerror="this.onerror=null;this.src='../logo.png';this.classList.add('is-logo');this.parentNode.classList.add('is-fallback')">
      <span class="clip-play" aria-hidden="true"><ion-icon name="play"></ion-icon></span>
      ${date ? `<span class="clip-duration">${esc(date)}</span>` : ""}
    </div>
    <div class="clip-body">
      <div class="clip-title">${esc(title)}</div>
      <div class="clip-meta">
        <span class="clip-channel">D74 Edits</span>
        <span>${esc((data && data.tags && data.tags[0]) || "Football")}</span>
      </div>
    </div>
  </a>
</article>`);
  },
};
