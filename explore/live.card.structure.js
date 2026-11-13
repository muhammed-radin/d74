"use strict";

/* Card renderer for the free-football-soccer-videos API. */

const live_card_ui = {
  create(data) {
    const esc = window.D74UI ? window.D74UI.escapeHTML : (v) => String(v == null ? "" : v);
    const side1 = (data && data.side1 && data.side1.name) || "Team A";
    const side2 = (data && data.side2 && data.side2.name) || "Team B";
    const competition = (data && data.competition && data.competition.name) || "Football";
    const thumbnail = (data && data.thumbnail) || "";
    const date = data && data.date
      ? window.dayjs
        ? window.dayjs(data.date).fromNow()
        : String(data.date).slice(0, 10)
      : "Today";
    const videos = (data && data.videos) || [];

    return new TagString(`
<article class="match-card enter">
  <div class="match-thumb">
    <img loading="lazy" src="${esc(thumbnail)}" alt="" onerror="this.style.opacity=0">
    <span class="badge badge-live" style="position:absolute;top:10px;left:10px">Live</span>
  </div>
  <div class="match-body">
    <div class="match-teams">${esc(side1)} <span class="match-vs">VS</span> ${esc(side2)}</div>
    <div class="match-comp">${esc(competition)} · ${esc(date)}</div>
    <div class="match-links">
      ${live_card_ui.listPlayLinks(videos)}
    </div>
  </div>
</article>`);
  },

  createViewMoreCard() {
    return new TagString(`
<a class="more-card" href="../search/">
  <span>Explore more<br>matches & clips</span>
</a>`);
  },

  listPlayLinks(videos) {
    const esc = window.D74UI ? window.D74UI.escapeHTML : (v) => String(v == null ? "" : v);
    if (!Array.isArray(videos) || !videos.length) {
      return '<span class="match-comp">Streams loading…</span>';
    }
    return videos
      .map(function (video, index) {
        const embed = String((video && video.embed) || "");
        const match = embed.match(/https?:\/\/[^\s"'<>]+/);
        const url = match ? match[0] : "";
        const title = (video && video.title) || "Watch stream";
        if (!url) return "";
        return `
        <button class="match-link" type="button" data-stream-url="${esc(url)}">
          <span>${esc(title)}</span>
          <ion-icon name="play-circle-outline"></ion-icon>
        </button>`;
      })
      .filter(Boolean)
      .join("");
  },
};
