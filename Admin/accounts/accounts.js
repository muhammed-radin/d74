"use strict";

/* ------------------------------------------------------------------
   Admin accounts
------------------------------------------------------------------ */

(function () {
  const $ = (id) => document.getElementById(id);
  const state = { all: [], query: "" };

  function text(id, value) {
    const node = $(id);
    if (node) node.textContent = value;
  }

  function filtered() {
    const query = state.query.trim().toLowerCase();
    if (!query) return state.all;
    return state.all.filter((row) =>
      [row.name, row.email, row._id, row.platform, row.location]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }

  function details(row) {
    const fields = [
      ["Account id", row._id],
      ["Languages", row.languages],
      ["Device", row.device],
      ["Platform", row.platform],
      ["Brands and version", row.brandsAndVersion],
      ["Model", row.model],
      ["Status", row.status],
    ];
    return (
      '<details class="admin-details"><summary>View</summary><div><dl class="admin-dl">' +
      fields
        .map(([key, value]) => "<dt>" + key + "</dt><dd>" + Admin.escape(value || "not recorded") + "</dd>")
        .join("") +
      "</dl></div></details>"
    );
  }

  function render() {
    const host = $("accountsBody");
    if (!host) return;
    const rows = filtered();
    text("accShowing", Admin.number(rows.length));
    text("accountsCount", rows.length + " of " + state.all.length + " accounts");

    if (!rows.length) {
      host.innerHTML =
        '<tr><td colspan="7"><div class="admin-empty"><ion-icon name="people-outline" aria-hidden="true"></ion-icon>' +
        "<h3>" + (state.all.length ? "No matches" : "No accounts yet") + "</h3><p>" +
        (state.all.length ? "Try another search." : "New signups will appear here.") +
        "</p></div></td></tr>";
      return;
    }

    host.innerHTML = rows
      .map(
        (row) =>
          "<tr><td><strong>" + Admin.escape(row.name || "Guest") + "</strong></td><td>" +
          Admin.escape(row.email || "—") + '</td><td class="is-nowrap admin-muted">' +
          Admin.date(row.date, { dateStyle: "medium" }) + "</td><td>" +
          Admin.escape(row.platform || "—") + '</td><td class="admin-truncate">' +
          Admin.escape(row.location || "—") + "</td><td>" + details(row) +
          '</td><td class="is-right"><button class="btn btn-danger btn-sm" type="button" data-delete="' +
          Admin.escape(row._id || "") + '" data-name="' + Admin.escape(row.name || row.email || row._id || "") +
          '">Delete</button></td></tr>'
      )
      .join("");

    host.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.dataset.delete;
        if (!id) return;
        if (!window.confirm('Delete the account for "' + (button.dataset.name || id) + '"?')) return;
        button.disabled = true;
        const result = await db.remove("account/" + encodeURIComponent(id));
        if (result.status === 401) {
          Admin.redirectToLogin("expired");
          return;
        }
        if (result.ok) {
          state.all = state.all.filter((row) => row._id !== id);
          render();
          Admin.toast("Account deleted.", "ok");
        } else {
          const body = result.json() || {};
          Admin.toast(body.error || "Could not delete the account.", "error");
          button.disabled = false;
        }
      });
    });
  }

  function summary() {
    text("accTotal", Admin.number(state.all.length));
    const sorted = state.all
      .slice()
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    const newest = sorted[0];
    text("accNewest", newest ? (newest.name || newest.email || "Guest") : "—");
    text("accNewestMeta", newest ? Admin.date(newest.date) : "No signups yet");
    const platforms = new Set(state.all.map((row) => row.platform).filter(Boolean));
    text("accPlatforms", Admin.number(platforms.size));
  }

  async function load() {
    const result = await db.adminAccounts();
    if (result.status === 401) {
      Admin.redirectToLogin("expired");
      return;
    }
    const body = result.json() || {};
    if (!result.ok) {
      Admin.toast(body.error || "Could not load accounts.", "error");
      return;
    }
    state.all = Array.isArray(body.items) ? body.items : [];
    summary();
    render();
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state.all, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "d74-accounts-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  Admin.ready(() => {
    const search = $("accountsSearch");
    let timer = null;
    if (search) {
      search.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          state.query = search.value;
          render();
        }, 220);
      });
    }
    const refresh = $("accountsRefresh");
    if (refresh) refresh.addEventListener("click", load);
    const exportButton = $("accountsExport");
    if (exportButton) exportButton.addEventListener("click", exportJson);

    load();
    Admin.onEvent((event) => {
      if (event.type === "account:changed" || event.type === "db:changed") load();
    });
  });
})();
