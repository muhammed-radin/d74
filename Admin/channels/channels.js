"use strict";

/* ------------------------------------------------------------------
   Admin live channels — create, edit and delete Live TV documents
------------------------------------------------------------------ */

(function () {
  const $ = (id) => document.getElementById(id);
  const state = {
    items: [],
    editing: null,
    saving: false,
    filter: "",
  };

  function setError(message) {
    const box = $("channelError");
    if (!box) return;
    box.textContent = message || "";
    box.classList.toggle("show", Boolean(message));
  }

  function slugify(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
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

  function safeLogo(value) {
    const logo = String(value || "").trim();
    if (/^\/[^/]/.test(logo)) return logo;
    if (/^(https?:)?\/\/[^\s]+$/i.test(logo)) return logo;
    return "";
  }

  function safeStreamUrl(value) {
    const url = String(value || "").trim();
    return /^(https?:)?\/\/[^\s]+$/i.test(url);
  }

  function isHexKey(value) {
    return /^[0-9a-f]{32}$/i.test(String(value || "").trim());
  }

  function channelTitle(row) {
    return String((row && (row.title || row.name)) || (row && row.id) || "Untitled channel");
  }

  function logoMarkup(row, className) {
    const logo = safeLogo(row && row.logo);
    const name = channelTitle(row);
    if (logo) {
      return (
        '<span class="' + className + '"><img src="' + Admin.escape(logo) +
        '" alt="" loading="lazy" data-logo-fallback="' + Admin.escape(initials(name)) + '"></span>'
      );
    }
    return '<span class="' + className + '">' + Admin.escape(initials(name)) + "</span>";
  }

  function bindLogoFallbacks(host) {
    if (!host) return;
    host.querySelectorAll("img[data-logo-fallback]").forEach((img) => {
      img.addEventListener("error", () => {
        const span = img.parentElement;
        if (!span) return;
        span.textContent = img.dataset.logoFallback || "TV";
      });
    });
  }

  function setLogoPreview() {
    const host = $("channelLogoPreview");
    if (!host) return;
    const logo = safeLogo($("channelLogo").value);
    const name = $("channelTitle").value.trim();
    const fallback = name ? initials(name) : "TV";
    host.innerHTML = "";
    if (logo) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = logo;
      img.addEventListener("error", () => {
        host.textContent = fallback;
      });
      host.appendChild(img);
    } else {
      host.textContent = fallback;
    }
  }

  /* ---------------------------- sources ---------------------------- */

  function sourceRows() {
    const host = $("channelSources");
    return host ? Array.from(host.querySelectorAll("[data-source]")) : [];
  }

  function updateSourceLabels() {
    const rows = sourceRows();
    rows.forEach((row, index) => {
      const title = row.querySelector("[data-source-title]");
      if (title) title.textContent = "Source " + (index + 1);
      const remove = row.querySelector("[data-source-remove]");
      if (remove) remove.hidden = rows.length <= 1;
    });
  }

  function addSource(source) {
    const host = $("channelSources");
    const template = $("channelSourceTemplate");
    if (!host || !template) return;
    const row = template.content.firstElementChild.cloneNode(true);
    const data = source && typeof source === "object" ? source : {};
    row.querySelector("[data-source-label]").value = data.label || "";
    row.querySelector("[data-source-type]").value = data.type || "auto";
    row.querySelector("[data-source-url]").value = data.url || "";
    row.querySelector("[data-source-keyid]").value = data.keyId || "";
    row.querySelector("[data-source-key]").value = data.key || "";
    row.querySelector("[data-source-remove]").addEventListener("click", () => {
      row.remove();
      updateSourceLabels();
    });
    host.appendChild(row);
    updateSourceLabels();
    return row;
  }

  function resetSources(sources) {
    const host = $("channelSources");
    if (!host) return;
    host.innerHTML = "";
    const list = Array.isArray(sources) && sources.length ? sources : [{}];
    list.forEach((source) => addSource(source));
  }

  function collectSources() {
    const rows = sourceRows();
    const sources = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const url = row.querySelector("[data-source-url]").value.trim();
      const label = row.querySelector("[data-source-label]").value.trim();
      const type = row.querySelector("[data-source-type]").value;
      const keyId = row.querySelector("[data-source-keyid]").value.trim();
      const key = row.querySelector("[data-source-key]").value.trim();

      if (!url) {
        return { error: "Source " + (index + 1) + " needs a stream URL.", field: row.querySelector("[data-source-url]") };
      }
      if (!safeStreamUrl(url)) {
        return {
          error: "Source " + (index + 1) + " must be an http(s) stream URL.",
          field: row.querySelector("[data-source-url]"),
        };
      }
      if ((keyId && !key) || (!keyId && key)) {
        return {
          error: "Source " + (index + 1) + " needs both a ClearKey key ID and key, or neither.",
          field: row.querySelector(keyId ? "[data-source-key]" : "[data-source-keyid]"),
        };
      }
      if (keyId && !isHexKey(keyId)) {
        return {
          error: "Source " + (index + 1) + " has an invalid ClearKey key ID. Use 32 hexadecimal characters.",
          field: row.querySelector("[data-source-keyid]"),
        };
      }
      if (key && !isHexKey(key)) {
        return {
          error: "Source " + (index + 1) + " has an invalid ClearKey key. Use 32 hexadecimal characters.",
          field: row.querySelector("[data-source-key]"),
        };
      }

      const source = { label, type, url };
      if (keyId && key) {
        source.keyId = keyId;
        source.key = key;
      }
      sources.push(source);
    }

    if (!sources.length) {
      return { error: "Add at least one stream source.", field: $("channelAddSource") };
    }
    return { sources };
  }

  /* ----------------------------- form ------------------------------ */

  function fillForm(row) {
    state.editing = row || null;
    const editing = Boolean(row);
    $("channelFormTitle").textContent = editing ? "Edit channel" : "New channel";
    $("channelEditingBadge").hidden = !editing;
    $("channelId").value = editing ? row.id : "";
    $("channelId").disabled = editing;
    $("channelId").dataset.touched = editing ? "1" : "";
    $("channelTitle").value = editing ? row.title || "" : "";
    $("channelLogo").value = editing ? row.logo || "" : "";
    $("channelCategory").value = editing ? row.category || "" : "";
    $("channelCountry").value = editing ? row.country || "" : "";
    $("channelLanguage").value = editing ? row.language || "" : "";
    $("channelOrder").value = editing ? String(Number(row.order) || 0) : "0";
    $("channelStatus").value = editing && row.status === "hidden" ? "hidden" : "active";
    $("channelFeatured").checked = Boolean(editing && row.featured);
    $("channelDescription").value = editing ? row.description || "" : "";
    $("channelSave").textContent = editing ? "Save changes" : "Create channel";
    $("channelDelete").hidden = !editing;
    resetSources(editing ? row.sources : null);
    setLogoPreview();
    setError("");
  }

  function resetForm() {
    const form = $("channelForm");
    if (form) form.reset();
    fillForm(null);
  }

  function collect() {
    const id = $("channelId").value.trim();
    const title = $("channelTitle").value.trim();
    const logo = $("channelLogo").value.trim();

    if (!state.editing) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
        return {
          error: "Channel id must be 1–64 characters using letters, numbers, hyphens or underscores.",
          field: $("channelId"),
        };
      }
    }
    if (!title) {
      return { error: "A channel title is required.", field: $("channelTitle") };
    }
    if (logo && !safeLogo(logo)) {
      return {
        error: "Logo URL must be an http(s) URL or a path starting with /.",
        field: $("channelLogo"),
      };
    }

    const collected = collectSources();
    if (collected.error) return collected;

    const payload = {
      title,
      logo,
      description: $("channelDescription").value.trim(),
      category: $("channelCategory").value.trim(),
      country: $("channelCountry").value.trim(),
      language: $("channelLanguage").value.trim(),
      status: $("channelStatus").value,
      featured: $("channelFeatured").checked,
      order: Number($("channelOrder").value) || 0,
      sources: collected.sources,
    };
    if (!state.editing) payload.id = id;
    return { payload };
  }

  /* ---------------------------- rendering -------------------------- */

  function render() {
    const host = $("channelsBody");
    if (!host) return;
    const active = state.items.filter((row) => row.status === "active").length;
    const hidden = state.items.length - active;
    const summary = $("channelsSummary");
    if (summary) {
      summary.textContent =
        state.items.length + (state.items.length === 1 ? " channel" : " channels") +
        " · " + active + " active" + (hidden ? " · " + hidden + " hidden" : "");
    }
    const count = $("channelsCount");
    if (count) count.textContent = state.items.length + (state.items.length === 1 ? " item" : " items");

    const term = state.filter.trim().toLowerCase();
    const visible = state.items.filter((row) => {
      if (!term) return true;
      return [row.id, channelTitle(row), row.category, row.country, row.language]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });

    if (!visible.length) {
      host.innerHTML =
        '<tr><td colspan="7"><div class="admin-empty"><ion-icon name="tv-outline" aria-hidden="true"></ion-icon>' +
        "<h3>" + (state.items.length ? "No matching channels" : "No live channels yet") + "</h3>" +
        "<p>" +
        (state.items.length
          ? "Try a different search term."
          : "Create the first channel with the form. The public Live TV page stays empty until a channel is published.") +
        "</p></div></td></tr>";
      return;
    }

    host.innerHTML = visible
      .map((row) => {
        const status = row.status === "hidden"
          ? '<span class="admin-badge admin-badge--warn">Hidden</span>'
          : '<span class="admin-badge admin-badge--ok">Active</span>';
        const featured = row.featured
          ? ' <span class="admin-badge admin-badge--accent">Featured</span>'
          : "";
        const sources = Array.isArray(row.sources) ? row.sources.length : 0;
        return (
          '<tr>' +
          '<td><div class="admin-channel-identity">' +
          logoMarkup(row, "admin-channel-thumb") +
          '<div class="admin-channel-copy"><strong>' + Admin.escape(channelTitle(row)) + "</strong>" +
          '<span class="admin-channel-sub">' + Admin.escape(row.id || "") + "</span></div></div></td>" +
          '<td class="admin-col-secondary">' + (row.category ? Admin.escape(row.category) : '<span class="admin-muted">—</span>') +
          (row.country ? '<span class="admin-channel-sub">' + Admin.escape(row.country) + "</span>" : "") +
          "</td>" +
          '<td class="admin-col-secondary">' + Admin.number(sources) + "</td>" +
          "<td>" + status + featured + "</td>" +
          '<td class="admin-col-secondary admin-mono">' + Number(row.order || 0) + "</td>" +
          '<td class="admin-col-secondary is-nowrap admin-muted">' + Admin.date(row.updatedAt || row.createdAt, { dateStyle: "medium" }) + "</td>" +
          '<td class="is-right"><div class="admin-row-actions">' +
          '<button class="btn btn-ghost btn-sm" type="button" data-edit="' + Admin.escape(row.id) + '">Edit</button>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-delete="' + Admin.escape(row.id) + '">Delete</button>' +
          "</div></td>" +
          "</tr>"
        );
      })
      .join("");

    bindLogoFallbacks(host);
    host.querySelectorAll("[data-edit]").forEach((button) => {
      button.addEventListener("click", () => {
        const row = state.items.find((item) => item.id === button.dataset.edit);
        if (!row) return;
        fillForm(row);
        $("channelForm").scrollIntoView({ block: "start" });
        $("channelTitle").focus();
      });
    });
    host.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        const row = state.items.find((item) => item.id === button.dataset.delete);
        if (row) removeChannel(row);
      });
    });
  }

  /* ----------------------------- data ------------------------------ */

  function handleUnauthorized(result) {
    if (result && result.status === 401) {
      Admin.redirectToLogin("expired");
      return true;
    }
    return false;
  }

  /* Older cached copies of view/d74.js may not expose the channel
     helpers yet. Fall back to D74Api so the page keeps working. */
  function direct(path, options = {}) {
    return D74Api.request(path, {
      method: options.method || "GET",
      sessionCheck: false,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  }

  function listChannels() {
    return typeof db.adminChannels === "function"
      ? db.adminChannels()
      : direct("/api/admin/channels");
  }

  function createChannel(payload) {
    return typeof db.adminChannelCreate === "function"
      ? db.adminChannelCreate(payload)
      : direct("/api/admin/channels", { method: "POST", body: payload });
  }

  function updateChannel(id, payload) {
    return typeof db.adminChannelUpdate === "function"
      ? db.adminChannelUpdate(id, payload)
      : direct("/api/admin/channels/" + encodeURIComponent(id), {
          method: "PUT",
          body: payload,
        });
  }

  function deleteChannel(id) {
    return typeof db.adminChannelDelete === "function"
      ? db.adminChannelDelete(id)
      : direct("/api/admin/channels/" + encodeURIComponent(id), { method: "DELETE" });
  }

  async function load() {
    const result = await listChannels();
    if (handleUnauthorized(result)) return;
    const body = result.json() || {};
    if (!result.ok) {
      Admin.toast(body.error || "Could not load live channels.", "error");
      return;
    }
    state.items = Array.isArray(body.items) ? body.items : [];
    if (state.editing && !state.items.some((row) => row.id === state.editing.id)) {
      resetForm();
    }
    render();
  }

  async function save(event) {
    event.preventDefault();
    if (state.saving) return;
    setError("");

    const collected = collect();
    if (collected.error) {
      setError(collected.error);
      if (collected.field && collected.field.focus) collected.field.focus();
      return;
    }

    state.saving = true;
    const button = $("channelSave");
    if (button) button.disabled = true;
    try {
      const result = state.editing
        ? await updateChannel(state.editing.id, collected.payload)
        : await createChannel(collected.payload);
      if (handleUnauthorized(result)) return;
      const body = result.json() || {};
      if (!result.ok) {
        setError(body.error || "Could not save the channel.");
        const field = body.fields && body.fields.field;
        if (field && $("channel" + field.charAt(0).toUpperCase() + field.slice(1))) {
          $("channel" + field.charAt(0).toUpperCase() + field.slice(1)).focus();
        }
        return;
      }
      Admin.toast(state.editing ? "Channel updated." : "Channel created.", "ok");
      resetForm();
      await load();
    } finally {
      state.saving = false;
      if (button) button.disabled = false;
    }
  }

  async function removeChannel(row) {
    const name = channelTitle(row);
    if (!window.confirm('Delete the channel "' + name + '"? It disappears from Live TV immediately.')) return;
    const result = await deleteChannel(row.id);
    if (handleUnauthorized(result)) return;
    const body = result.json() || {};
    if (!result.ok) {
      Admin.toast(body.error || "Could not delete the channel.", "error");
      return;
    }
    if (state.editing && state.editing.id === row.id) resetForm();
    Admin.toast("Channel deleted.", "ok");
    await load();
  }

  Admin.ready(() => {
    $("channelForm").addEventListener("submit", save);
    $("channelReset").addEventListener("click", resetForm);
    $("channelNew").addEventListener("click", () => {
      resetForm();
      $("channelId").focus();
    });
    $("channelsRefresh").addEventListener("click", load);
    $("channelAddSource").addEventListener("click", () => {
      const row = addSource({});
      const url = row && row.querySelector("[data-source-url]");
      if (url) url.focus();
    });
    $("channelDelete").addEventListener("click", () => {
      if (state.editing) removeChannel(state.editing);
    });
    $("channelTitle").addEventListener("input", () => {
      if (!state.editing && !$("channelId").dataset.touched) {
        $("channelId").value = slugify($("channelTitle").value);
      }
      setLogoPreview();
    });
    $("channelId").addEventListener("input", () => {
      $("channelId").dataset.touched = "1";
    });
    $("channelLogo").addEventListener("input", setLogoPreview);
    $("channelsSearch").addEventListener("input", () => {
      state.filter = $("channelsSearch").value;
      render();
    });

    resetForm();
    load();
    Admin.onEvent((event) => {
      if (event.type === "channels:changed" && !state.saving) load();
    });
  });
})();
