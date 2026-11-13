"use strict";

/* ------------------------------------------------------------------
   Login controller — credentials are verified by the server.
------------------------------------------------------------------ */

(function () {
  const form = document.getElementById("loginForm");
  const email = document.getElementById("email");
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
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.classList.add("show");
  }

  function clearError() {
    if (!errorBox) return;
    errorBox.classList.remove("show");
    errorBox.textContent = "";
  }

  function isGuest(user) {
    return (
      !user ||
      user.guest === true ||
      String(user.email || "").includes("guest.local")
    );
  }

  function nextUrl() {
    const next = new URLSearchParams(window.location.search).get("next");
    if (!next) return "../explore/";
    try {
      const target = new URL(next, window.location.href);
      if (target.origin !== window.location.origin) return "../explore/";
      if (target.pathname.startsWith("/login")) return "../explore/";
      return target.pathname + target.search + target.hash;
    } catch (_) {
      return "../explore/";
    }
  }

  function loading(on) {
    if (!submit) return;
    submit.disabled = on;
    submit.classList.toggle("is-loading", on);
    submit.innerHTML = on
      ? '<span class="loader-sml"></span> Logging in…'
      : "Log in";
  }

  // Already signed in? Skip the form.
  let existing = null;
  try {
    existing = JSON.parse(localStorage.getItem("user") || "null");
  } catch (_) {}
  if (existing && !isGuest(existing)) {
    window.location.replace(nextUrl());
    return;
  }

  const preset = new URLSearchParams(window.location.search).get("email");
  if (preset && email) email.value = preset;

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    clearError();

    const emailValue = email.value.trim().toLowerCase();
    const passwordValue = password.value;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailValue)) {
      return showError("Please enter a valid email address.");
    }
    if (!passwordValue) {
      return showError("Please enter your password.");
    }

    loading(true);
    const xhr = await db.login(emailValue, passwordValue);
    loading(false);
    const data = parse(xhr);

    if (xhr.status === 200 && data && data.user) {
      try {
        localStorage.setItem("user", JSON.stringify(data.user));
      } catch (_) {}
      if (window.toast) toast("Welcome back, " + (data.user.name || "friend") + "!", "success", 1500);
      window.location.href = nextUrl();
      return;
    }

    if (xhr.status === 0) {
      return showError("Network unavailable. Check your connection and try again.");
    }
    if (xhr.status === 429) {
      return showError("Too many attempts. Please wait a few minutes.");
    }
    showError((data && data.error) || "Invalid email or password.");
  });
})();
