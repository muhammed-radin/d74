"use strict";

/* ------------------------------------------------------------------
   Admin themes — create, edit and delete editorial collections
------------------------------------------------------------------ */

(function () {
  const $ = (id) => document.getElementById(id);
  const state = { items: [], editing: null, saving: false };

  function text(id, value) {
    const node = $(id);
    if (node) node.textContent = value;
  }

  function setError(message) {
    const box = $("themeError");
    if (!box) return;
    box.textContent = message || "";
    box.classList.toggle("show", Boolean(message));
  }

  function slugify(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120);
  }

  function parseIds(value) {
    return Array.from(
      new Set(
        String(value || "")
          .split(/[\s,]+/)
          .map((item) => item.trim())
          .filter((item) => /^[A-Za-z0-9_-]{6,20}$/.test(item))
      )
    ).slice(0, 200);
  }

  function fillForm(row) {
    state.editing = row;
    text("themeFormTitle", row ? "Edit theme" : "New theme");
    $("themeName").value = row ? row.name || "" : "";
    $("themeSlug").value = row ? row.slug || "" : "";
    $("themeAccent").value = row ? row.accent || "" : "";
    $("themeDescription").value = row ? row.description || "" : "";
    $("themeYtids").value = row && Array.isArray(row.ytids) ? row.ytids.join("\n") : "";
    $("themeUpdated").value = row && row.updatedAt ? Admin.date(row.updatedAt) : "Set automatically";
    $("themeSave").textContent = row ? "Save changes" : "Create theme";
    const remove = $("themeDelete");
    if (remove) remove.hidden = !row;
    setError("");
    $("themeName").focus();
  }

  function render() {
    const host = $("themesBody");
    if (!host) return;
    text("themesCount", state.items.length + " themes");
    if (!state.items.length) {
      host.innerHTML =
        '<tr><td colspan="6"><div class="admin-empty"><ion-icon name="color-palette-outline" aria-hidden="true"></ion-icon>' +
        "<h3>No themes yet</h3><p>Create the first collection with the form.</p></div></td></tr>";
      return;
    }
    host.innerHTML = state.items
      .map((row) => {
        const count = Array.isArray(row.ytids) ? row.ytids.length : 0;
        const accent = /^#[0-9a-f]{3,8}$/i.test(String(row.accent || "")) ? row.accent : "var(--accent)";
        return (
          '<tr><td><strong>' + Admin.escape(row.name || "Untitled") + "</strong></td><td class=\"admin-mono\">" +
          Admin.escape(row.slug || "—") + '</td><td><span class="admin-badge"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' +
          Admin.escape(accent) + '"></span> ' + Admin.escape(row.accent || "default") + "</span></td><td>" +
          Admin.number(count) + '</td><td class="is-nowrap admin-muted">' +
          Admin.date(row.updatedAt || row.createdAt, { dateStyle: "medium" }) +
          '</td><td class="is-right"><button class="btn btn-ghost btn-sm" type="button" data-edit="' +
          Admin.escape(row._id || "") + '">Edit</button></td></tr>'
        );
      })
      .join("");

    host.querySelectorAll("[data-edit]").forEach((button) => {
      button.addEventListener("click", () => {
        const row = state.items.find((item) => item._id === button.dataset.edit);
        if (row) fillForm(row);
      });
    });
  }

  async function load() {
    const result = await db.adminThemes();
    if (result.status === 401) {
      Admin.redirectToLogin("expired");
      return;
    }
    const body = result.json() || {};
    if (!result.ok) {
      Admin.toast(body.error || "Could not load themes.", "error");
      return;
    }
    state.items = Array.isArray(body.items) ? body.items : [];
    render();
  }

  async function save(event) {
    event.preventDefault();
    if (state.saving) return;
    setError("");

    const name = $("themeName").value.trim();
    if (!name) {
      setError("A theme name is required.");
      $("themeName").focus();
      return;
    }
    const slug = slugify($("themeSlug").value || name);
    const payload = {
      name,
      slug,
      description: $("themeDescription").value.trim(),
      accent: $("themeAccent").value.trim().slice(0, 40),
      ytids: parseIds($("themeYtids").value),
      updatedAt: new Date().toISOString(),
    };
    if (!state.editing) payload.createdAt = payload.updatedAt;

    state.saving = true;
    const button = $("themeSave");
    if (button) button.disabled = true;
    try {
      const result = state.editing
        ? await db.put("themes/" + encodeURIComponent(state.editing._id), payload)
        : await db.post("themes", payload);
      if (result.status === 401) {
        Admin.redirectToLogin("expired");
        return;
      }
      const body = result.json() || {};
      if (!result.ok) {
        setError(body.error || "Could not save the theme.");
        return;
      }
      Admin.toast(state.editing ? "Theme updated." : "Theme created.", "ok");
      fillForm(null);
      await load();
    } finally {
      state.saving = false;
      if (button) button.disabled = false;
    }
  }

  async function remove() {
    if (!state.editing) return;
    if (!window.confirm('Delete the theme "' + (state.editing.name || state.editing._id) + '"?')) return;
    const result = await db.remove("themes/" + encodeURIComponent(state.editing._id));
    if (result.status === 401) {
      Admin.redirectToLogin("expired");
      return;
    }
    const body = result.json() || {};
    if (!result.ok) {
      setError(body.error || "Could not delete the theme.");
      return;
    }
    Admin.toast("Theme deleted.", "ok");
    fillForm(null);
    await load();
  }

  Admin.ready(() => {
    $("themeForm").addEventListener("submit", save);
    $("themeReset").addEventListener("click", () => fillForm(null));
    $("themeDelete").addEventListener("click", remove);
    $("themeName").addEventListener("input", () => {
      const slug = $("themeSlug");
      if (slug && !state.editing && !slug.dataset.touched) slug.value = slugify($("themeName").value);
    });
    $("themeSlug").addEventListener("input", () => {
      $("themeSlug").dataset.touched = "1";
    });
    $("themesRefresh").addEventListener("click", load);

    load();
    Admin.onEvent((event) => {
      if (event.type === "theme:changed" || event.type === "db:changed") load();
    });
  });
})();
