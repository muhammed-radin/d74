const old_card_ui = {
  create(data, id) {
    const esc = (value) =>
      String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    const snippet = (data && data.snippet) || {};
    const thumbs = snippet.thumbnails || {};
    const thumb = (thumbs.medium || thumbs.high || thumbs.default || {}).url || "";
    const rawId = (data && data.id && data.id.videoId) || "";
    const videoId = /^[A-Za-z0-9_-]{6,20}$/.test(rawId) ? rawId : "";
    const title = snippet.title || "Untitled clip";
    const published = snippet.publishedAt
      ? window.dayjs
        ? dayjs(snippet.publishedAt).fromNow()
        : String(snippet.publishedAt).slice(0, 10)
      : "";

    return new TagString(`<div class="card" id="${esc(id)}">
          <div class="card-date">${esc(published)}</div>
          <div class="card-img" onclick="redirctTo('../edit_video/?id=${videoId}')">
            <img loading="lazy" src="${esc(thumb)}" alt="yt">
          </div>
          <div class="card-title" onclick="redirctTo('../edit_video/?id=${videoId}')">${esc(title)}</div>
          <div class="card-opt-icon" onclick="openOptions('${esc(id + "2")}')">
            <ion-icon name="ellipsis-horizontal"></ion-icon>
          </div>
          <div class="card-options" id="${esc(id + "2")}">
            <div class="card-head">
              Options
            </div>
            <div class="card-body">
              <p class="card-opt" onclick="redirctTo('../../visit/?id=${videoId}')">
                View
              </p>
              <p class="card-opt" onclick="redirctTo('../edit_video/?id=${videoId}')">
                Edit
              </p>
              <p class="card-opt" onclick="closeOptions('${esc(id + "2")}')">
                Close
              </p>
            </div>
        </div>
    `);
  },
};
