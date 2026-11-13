"use strict";

/* ------------------------------------------------------------------
   Admin clip installer — metadata is fetched through the server proxy.
------------------------------------------------------------------ */

(function () {
  const ytId = new URLSearchParams(window.location.search).get("id") || "";
  const sub = document.getElementById("sub");
  const progress = document.getElementById("load");
  const center = document.querySelector(".center");

  function setStatus(text, value) {
    if (sub) sub.textContent = text;
    if (progress && typeof value === "number") progress.value = value;
  }

  if (!/^[A-Za-z0-9_-]{6,20}$/.test(ytId)) {
    setStatus("No valid video id was provided.", 0);
    if (center) {
      const link = document.createElement("a");
      link.className = "btn btn-ghost btn-sm";
      link.href = "../videos/";
      link.textContent = "Back to videos";
      link.style.marginTop = "14px";
      center.appendChild(link);
    }
    return;
  }

  (async function install() {
    setStatus("Getting video details…", 10);
    const result = await db.getVideo(ytId);
    let data = null;
    try {
      data = typeof result.json === "function" ? result.json() : JSON.parse(result.response);
    } catch (_) {}

    const item = data && Array.isArray(data.items) ? data.items[0] : null;
    if (!item || !item.snippet) {
      setStatus("Could not load this video from YouTube. Check the id and try again.", 0);
      return;
    }

    const snippet = item.snippet;
    const thumb =
      (snippet.thumbnails && (snippet.thumbnails.medium || snippet.thumbnails.high) || {}).url || "";
    const description = String(
      (snippet.localized && snippet.localized.description) || snippet.description || ""
    ).slice(0, 200);

    setStatus("Installing…", 50);

    const created = await db.push("videos", {
      thumb: thumb,
      date: snippet.publishedAt,
      ytid: ytId,
      pw: "d4f2cwyw7",
      description: description,
      url: "https://youtube.com/watch?v=" + ytId,
      title: snippet.title,
    });

    if (created.status !== 201) {
      setStatus("Upload failed (" + created.status + "). Please try again.", 50);
      return;
    }

    setStatus("Successfully installed.", 100);
    if (center) {
      const link = document.createElement("a");
      link.className = "btn btn-primary btn-sm";
      link.href = "../edit_video/?id=" + encodeURIComponent(ytId);
      link.textContent = "Open editor";
      link.style.marginTop = "14px";
      center.appendChild(link);
    }
  })();
})();
