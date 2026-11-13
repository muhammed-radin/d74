"use strict";

/* ------------------------------------------------------------------
   Admin login — credentials are verified by /api/admin/login and the
   browser only ever receives a short-lived signed session token.
------------------------------------------------------------------ */

(function () {
  if (db.adminToken()) {
    window.location.replace("../");
    return;
  }

  const form = document.getElementById("adminForm");
  const username = document.getElementById("username");
  const password = document.getElementById("password");
  const submit = document.getElementById("submit");
  const errorBox = document.getElementById("formError");

  function parse(xhr) {
    if (!xhr) return null;
    if (typeof xhr.json === "function") return xhr.json();
    try {
      return JSON.parse(xhr.response);
    } catch (_) {
      return null;
    }
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add("show");
  }

  function loading(on) {
    submit.disabled = on;
    submit.classList.toggle("is-loading", on);
    submit.innerHTML = on ? '<span class="loader-sml"></span> Signing in…' : "Sign in";
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    errorBox.classList.remove("show");

    const user = username.value.trim();
    const pass = password.value;

    if (!user || !pass) {
      showError("Enter both your username and password.");
      return;
    }

    loading(true);
    const xhr = await db.adminLogin(user, pass);
    loading(false);
    const data = parse(xhr);

    if (xhr.status === 200 && data && data.token) {
      db.setAdminToken(data.token, { name: data.name || user });
      window.location.href = "../";
      return;
    }

    if (xhr.status === 0) return showError("Network unavailable. Check your connection.");
    if (xhr.status === 429) return showError("Too many attempts. Try again in a few minutes.");
    showError((data && data.error) || "Invalid administrator credentials.");
    password.value = "";
    password.focus();
  });
})();
