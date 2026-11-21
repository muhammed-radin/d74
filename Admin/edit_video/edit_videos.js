"use strict";

/* ------------------------------------------------------------------
   Admin clip editor
   Loads a video record by YouTube id, then saves or deletes it through
   the authenticated database proxy.
------------------------------------------------------------------ */

(function () {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  const ytId = params.get("id") || "";
  let record = null;
  let saving = false;

  function status(message, tone) {
    const box = $("editStatus");
    if (!box) return;
    box.className = "admin-alert" + (tone ? " admin-alert--" + tone : " admin-alert--info");
    box.innerHTML =
      '<ion-icon name="' + (tone === "error" ? "alert-circle-outline" : tone === "warn" ? "warning-outline" : "information-circle-outline") +
      '" aria-hidden="true"></ion-icon><span>' + Admin.escape(message) + "</span>";
  }

  function error(message) {
    const box = $("editError");
    if (!box) return;
    box.textContent = message || "";
    box.classList.toggle("show", Boolean(message));
  }

  function isPageUrl(value, ytid) {
    if (!value) return true;
    const id = String(ytid || "");
    return (
      value === "https://youtube.com/watch?v=" + id ||
      value === "https://www.youtube.com/watch?v=" + id
    );
  }

  function isDownloadable(row) {
    return Boolean(row && row.ytid);
  }

  function downloadLabel(row) {
    if (!row) return "No clip id";
    if (isPageUrl(row.url, row.ytid)) {
      return row.ytid ? "YouTube (yt-dlp)" : "No clip id";
    }
    return "Direct link";
  }

  function renderPreview() {
    if (!record) return;
    const thumb = record.thumb || "https://i.ytimg.com/vi/" + encodeURIComponent(ytId) + "/mqdefault.jpg";
    $("editPreviewImg").src = thumb;
    $("editPreviewImg").onerror = function () {
      this.src = "/visit/image.png";
    };
    $("editPreviewTitle").textContent = record.title || "Untitled clip";
    $("editPreviewChannel").textContent = record.channelTitle || "D74 Edits";
    $("editPreviewDate").textContent = Admin.date(record.date, { dateStyle: "medium" });
    const ready = isDownloadable(record);
    const badge = $("editDownloadable");
    badge.textContent = ready ? "free download" : "no clip id";
    badge.className = "admin-badge admin-badge--" + (ready ? "ok" : "neutral");
    $("editRecordInfo").innerHTML = [
      ["Record id", record._id || "—"],
      ["YouTube id", record.ytid || ytId],
      ["Source", record.source || "—"],
      ["Download", downloadLabel(record)],
    ]
      .map(([key, value]) => "<dt>" + key + "</dt><dd>" + Admin.escape(value) + "</dd>")
      .join("");
    const open = $("editOpen");
    if (open && ytId) {
      open.href = "/visit/?id=" + encodeURIComponent(ytId);
      open.hidden = false;
    }
  }

  function fill() {
    $("editTitle").value = record.title || "";
    $("editDate").value = record.date || "";
    $("editChannel").value = record.channelTitle || "";
    $("editThumb").value = record.thumb || "";
    $("editDescription").value = record.description || "";
    $("editUrl").value = isPageUrl(record.url, record.ytid || ytId) ? "" : record.url || "";
    $("editYtid").value = record.ytid || ytId;
    $("editMetaState").textContent = "Loaded " + Admin.timeAgo(record.date);
    renderPreview();
  }

  async function load() {
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(ytId)) {
      status("No valid YouTube id was provided.", "warn");
      $("editForm").querySelectorAll("input,textarea,button").forEach((node) => {
        node.disabled = true;
      });
      return;
    }
    status("Loading " + ytId + "…");
    const result = await db.get(new db.Coll("videos", { ytid: ytId }));
    if (result.status === 401) {
      Admin.redirectToLogin("expired");
      return;
    }
    const rows = result.json();
    if (!result.ok) {
      status((rows && rows.error) || "Could not load the clip.", "error");
      return;
    }
    record = Array.isArray(rows) ? rows[0] : rows;
    if (!record) {
      status("This clip is not in the database yet. Install it first.", "warn");
      $("editSave").disabled = true;
      $("editDelete").disabled = true;
      return;
    }
    fill();
    status("Clip loaded. Changes are saved to the database.", "info");
  }

  async function save(event) {
    event.preventDefault();
    if (!record || saving) return;
    error("");
    const title = $("editTitle").value.trim();
    if (!title) {
      error("A title is required.");
      return;
    }
    const payload = {
      title,
      date: $("editDate").value.trim(),
      channelTitle: $("editChannel").value.trim(),
      thumb: $("editThumb").value.trim(),
      description: $("editDescription").value.trim(),
      url: $("editUrl").value.trim(),
    };
    saving = true;
    const button = $("editSave");
    if (button) button.disabled = true;
    try {
      const result = await db.put("videos/" + encodeURIComponent(record._id), payload);
      if (result.status === 401) {
        Admin.redirectToLogin("expired");
        return;
      }
      const body = result.json() || {};
      if (!result.ok) {
        error(body.error || "Could not save the clip.");
        return;
      }
      record = Object.assign({}, record, payload, body && typeof body === "object" ? body : {});
      fill();
      status("Changes saved.", "ok");
      Admin.toast("Clip updated.", "ok");
    } finally {
      saving = false;
      if (button) button.disabled = false;
    }
  }

  async function remove() {
    if (!record) return;
    if (!window.confirm('Delete "' + (record.title || record.ytid || "this clip") + '" from the database?')) return;
    const result = await db.remove("videos/" + encodeURIComponent(record._id));
    if (result.status === 401) {
      Admin.redirectToLogin("expired");
      return;
    }
    const body = result.json() || {};
    if (!result.ok) {
      error(body.error || "Could not delete the clip.");
      return;
    }
    Admin.toast("Clip deleted.", "ok");
    window.location.href = "/Admin/videos/";
  }

  Admin.ready(() => {
    $("editForm").addEventListener("submit", save);
    $("editDelete").addEventListener("click", remove);
    $("editTitle").addEventListener("input", () => error(""));
    load();
    Admin.onEvent((event) => {
      if (event.type === "video:deleted" && record && event.data && event.data.ytid === record.ytid) {
        Admin.toast("This clip was deleted in another session.", "warn");
      }
    });
  });
})();
