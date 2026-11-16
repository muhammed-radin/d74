"use strict";

/* ------------------------------------------------------------------
   Administrator sign in
   Credentials are verified by /api/admin/login. The browser receives an
   httpOnly session cookie plus a CSRF token; no credential or token is
   ever written to localStorage.
------------------------------------------------------------------ */

(function () {
  const form = document.getElementById("adminForm");
  const username = document.getElementById("username");
  const password = document.getElementById("password");
  const submit = document.getElementById("submit");
  const errorBox = document.getElementById("formError");
  const toggle = document.getElementById("passwordToggle");
  const note = document.getElementById("loginNote");

  const params = new URLSearchParams(window.location.search);
  const reason = params.get("reason") || "";
  const requestedNext = params.get("next") || "";

  function safeNext(value) {
    const text = String(value || "");
    if (!text.startsWith("/Admin/")) return "/Admin/";
    if (text.startsWith("//") || text.includes("\\") || text.includes("\n")) return "/Admin/";
    return text;
  }

  const nextUrl = safeNext(requestedNext);

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add("show");
  }

  function clearError() {
    errorBox.textContent = "";
    errorBox.classList.remove("show");
  }

  function loading(on) {
    submit.disabled = on;
    submit.setAttribute("aria-busy", String(on));
    submit.querySelector("span").textContent = on ? "Signing in…" : "Sign in";
  }

  if (reason === "expired") {
    showError("Your session expired. Sign in again to continue.");
  } else if (reason === "revoked") {
    showError("This session was revoked. Sign in again to continue.");
  }

  if (toggle) {
    toggle.addEventListener("click", () => {
      const showing = password.type === "text";
      password.type = showing ? "password" : "text";
      toggle.textContent = showing ? "Show" : "Hide";
      toggle.setAttribute("aria-pressed", String(!showing));
      toggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    });
  }

  db.adminSession()
    .then((result) => {
      if (result && result.ok) window.location.replace(nextUrl);
    })
    .catch(() => {});

  [username, password].forEach((input) => {
    input.addEventListener("input", clearError);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError();

    const user = username.value.trim();
    const pass = password.value;
    if (!user || !pass) {
      showError("Enter both the username and password.");
      return;
    }

    loading(true);
    try {
      const result = await db.adminLogin(user, pass);
      const body = result.json() || {};
      if (result.ok) {
        window.location.replace(nextUrl);
        return;
      }
      if (result.status === 429) {
        showError("Too many attempts. Wait a few minutes before trying again.");
      } else if (result.status === 503) {
        showError(body.error || "Administrator login is not configured on the server.");
      } else if (result.status === 401) {
        showError("Invalid administrator credentials.");
        password.value = "";
        password.focus();
      } else if (result.status === 0) {
        showError("The API is unreachable. Start the server with node server.js.");
      } else {
        showError(body.error || "Sign in failed. Try again.");
      }
    } catch (_) {
      showError("Network error. Check the server and try again.");
    } finally {
      loading(false);
    }
  });

  if (username) username.focus();
  if (note) {
    note.setAttribute(
      "title",
      "Rate limits apply per address and per username. All attempts are audited."
    );
  }
})();
