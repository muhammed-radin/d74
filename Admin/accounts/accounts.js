"use strict";

(function () {
  function parse(xhr) {
    if (!xhr) return null;
    if (typeof xhr.json === "function") return xhr.json();
    try {
      return JSON.parse(xhr.response);
    } catch (_) {
      return null;
    }
  }

  db.get("account", function (xhr) {
    if (xhr.status === 401) {
      db.setAdminToken("");
      window.location.href = "../admin_login/";
      return;
    }

    if (xhr.status !== 200) {
      alert("Server Error", "Could not load accounts. Please try again.");
      return;
    }

    const data = parse(xhr);
    document.querySelector(".body").appendChild(acc_ui.createTitleBar(xhr).parseElement()[0]);

    if (!Array.isArray(data) || !data.length) {
      document.querySelector(".body").insertAdjacentHTML(
        "beforeend",
        '<div class="empty-state" style="width:100%"><ion-icon name="people-outline"></ion-icon>' +
          "<h3>No accounts yet</h3><p>New signups will appear here.</p></div>"
      );
      return;
    }

    data.forEach(function (acc) {
      document.querySelector(".body").appendChild(acc_ui.create(acc).parseElement()[0]);
    });
  });
})();
