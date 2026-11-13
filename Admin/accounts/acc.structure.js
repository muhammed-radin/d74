const acc_ui = {
  escape(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  },
  create(acc) {
    const esc = acc_ui.escape;
    return new TagString(`<div class="acc">
            <ion-icon name="person-outline"></ion-icon>
            <div class="sp">
            <div class="name">${esc(acc.name)}</div>
            <p><strong>Email:</strong> ${esc(acc.email)}</p>
            <p><strong>Device:</strong> ${esc(acc.device || "no information about device")}</p>
            <p><strong>Location:</strong> ${esc(acc.location || "location not saved")}</p>
            <p><strong>Id:</strong> ${esc(acc._id)}</p>
            <p><strong>Date:</strong> ${esc(acc.date || "no about date")}</p>
            <p><strong>Languages:</strong> ${esc(acc.languages || "no information about languages")}</p>
            <p><strong>Platform:</strong> ${esc(acc.platform || "no information about platform or OS")}</p>
            <p><strong>Brands &amp; Version (JSON):</strong> ${esc(acc.brandsAndVersion || "no information about brands and version")}</p>
            <p><strong>Model:</strong> ${esc(acc.model || "no information about device model")}</p>
            <span>unsubscriber</span>
            </div>
          </div>`);
  },
  createTitleBar(xhr) {
    let count = "—";
    try {
      const data = JSON.parse(xhr.response);
      count = Array.isArray(data) ? data.length : "—";
    } catch (_) {}
    return new TagString(`<p class="acc gr">
            <ion-icon name="people-outline"></ion-icon>
            <sp class="sp">${acc_ui.escape(count)} Accounts</sp>
            <span class="sp">[ ${acc_ui.escape(xhr.status)} ]</span>
          </p>`);
  },
};
