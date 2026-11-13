"use strict";

/* ------------------------------------------------------------------
   Admin clip editor
   Loads a video record, then saves edits through the admin proxy.
------------------------------------------------------------------ */

(function () {
  const ytId = new URLSearchParams(window.location.search).get("id") || "";

  function $(id) {
    return document.getElementById(id);
  }

  function parse(xhr) {
    if (!xhr) return null;
    if (typeof xhr.json === "function") return xhr.json();
    try {
      return JSON.parse(xhr.response);
    } catch (_) {
      return null;
    }
  }

  function loadImg() {
    const img = $("img");
    const url = $("imgUrl");
    if (!img || !url) return;
    img.src = url.value;
    img.onerror = function () {
      img.src = "../../visit/image.png";
    };
  }

  if (!/^[A-Za-z0-9_-]{6,20}$/.test(ytId)) {
    alert("File Not Found", "This video id is missing or invalid.", function () {
      window.location.href = "../videos/";
    });
    return;
  }

  const imgUrl = $("imgUrl");
  if (imgUrl) {
    imgUrl.addEventListener("change", loadImg);
    imgUrl.addEventListener("keyup", loadImg);
  }

  (async function load() {
    const result = await db.get(new db.Coll("videos", { ytid: ytId }));
    const data = parse(result);
    const record = Array.isArray(data) ? data[0] : null;

    if (!record) {
      alert("Data Not Found", "This video is not installed yet. Opening the installer.", function () {
        window.location.href = "../init/?id=" + encodeURIComponent(ytId);
      });
      setTimeout(function () {
        window.location.href = "../init/?id=" + encodeURIComponent(ytId);
      }, 1800);
      return;
    }

    $("title").value = record.title || "";
    $("password").value = record.pw || "";
    $("date").value = record.date || "";
    $("ytid").value = record.ytid || ytId;
    const sid = $("sid");
    sid.value = record._id || "";
    $("vurl").value = record.url || "";
    $("imgUrl").value = record.thumb || "";
    loadImg();

    $("submit").addEventListener("click", async function () {
      const button = $("submit");
      button.disabled = true;
      button.textContent = "Saving…";

      const saved = await db.put("videos/" + (record._id || ""), {
        title: $("title").value,
        pw: $("password").value,
        date: $("date").value,
        ytid: $("ytid").value,
        url: $("vurl").value,
        thumb: $("imgUrl").value,
        description: record.description || "",
      });

      button.disabled = false;
      button.textContent = "Save";

      if (saved.status !== 200) {
        alert("Saving Unsuccessful!", "The changes were not saved. Please try again.");
      } else {
        alert("Saved Successfully", "The clip has been updated.");
      }
    });
  })();
})();
