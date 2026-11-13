"use strict";

/* ------------------------------------------------------------------
   Signup controller — the server hashes the password before storage.
------------------------------------------------------------------ */

(function () {
  const form = document.getElementById("signupForm");
  const name = document.getElementById("username");
  const email = document.getElementById("email");
  const password = document.getElementById("password");
  const confirm = document.getElementById("confPass");
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

  function clearError() {
    errorBox.classList.remove("show");
    errorBox.textContent = "";
  }

  function loading(on) {
    submit.disabled = on;
    submit.classList.toggle("is-loading", on);
    submit.innerHTML = on
      ? '<span class="loader-sml"></span> Creating account…'
      : "Create account";
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    clearError();

    const nameValue = name.value.trim();
    const emailValue = email.value.trim().toLowerCase();
    const passwordValue = password.value;

    if (nameValue.length < 2 || nameValue.length > 48) {
      return showError("Your name must be between 2 and 48 characters.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailValue)) {
      return showError("Please enter a valid email address.");
    }
    if (passwordValue.length < 8) {
      return showError("Password must be at least 8 characters.");
    }
    if (passwordValue !== confirm.value) {
      return showError("The passwords do not match.");
    }

    loading(true);
    const created = await db.signup(nameValue, emailValue, passwordValue);
    const createdData = parse(created);

    if (created.status !== 201) {
      loading(false);
      if (created.status === 0) return showError("Network unavailable. Check your connection.");
      if (created.status === 429) return showError("Too many attempts. Please wait a few minutes.");
      if (created.status === 409) return showError("An account with this email already exists. Try logging in.");
      return showError((createdData && createdData.error) || "Could not create your account.");
    }

    // Sign the new account straight in so there is no extra step.
    const loggedIn = await db.login(emailValue, passwordValue);
    const loggedInData = parse(loggedIn);
    loading(false);

    if (loggedIn.status === 200 && loggedInData && loggedInData.user) {
      try {
        localStorage.setItem("user", JSON.stringify(loggedInData.user));
      } catch (_) {}
      if (window.toast) toast("Account created. Welcome to D74 Edits!", "success", 1400);
      window.location.href = "../explore/";
      return;
    }

    if (window.toast) toast("Account created — please log in.", "success", 1600);
    window.location.href = "../login/?email=" + encodeURIComponent(emailValue);
  });
})();
