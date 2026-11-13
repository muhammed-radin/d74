"use strict";

/* ------------------------------------------------------------------
   Settings controller — theme, accent and account details.
------------------------------------------------------------------ */

(function () {
  const themeSelect = document.getElementById("theme");
  const swatches = document.getElementById("swatches");
  const motionState = document.getElementById("motionState");
  const guestBox = document.getElementById("accountGuest");
  const userBox = document.getElementById("accountUser");
  const nameEl = document.getElementById("accountName");
  const emailEl = document.getElementById("accountEmail");
  const dateEl = document.getElementById("accountDate");
  const avatar = document.getElementById("avatar");
  const revealId = document.getElementById("revealId");
  const logout = document.getElementById("logout");
  const accountSummary = document.getElementById("accountSummary");

  /* ---------------------------- theme ----------------------------- */

  if (themeSelect) {
    themeSelect.value = window.D74UI ? D74UI.currentTheme() : "dark";
    themeSelect.addEventListener("change", function () {
      if (window.D74UI) D74UI.applyTheme(themeSelect.value);
      if (window.toast) toast("Theme updated.", "success", 1600);
    });
  }

  if (swatches) {
    swatches.addEventListener("click", function (event) {
      const button = event.target.closest("[data-accent]");
      if (!button || !window.D74UI) return;
      D74UI.applyAccent(button.dataset.accent);
      if (window.toast) toast("Accent colour updated.", "success", 1600);
    });
  }

  if (window.D74UI) {
    document.querySelectorAll("[data-accent]").forEach(function (swatch) {
      swatch.classList.toggle(
        "active",
        swatch.dataset.accent.toLowerCase() === D74UI.currentAccent().toLowerCase()
      );
    });
  }

  if (motionState) {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    motionState.textContent = reduced ? "Reduced" : "Full";
  }

  /* --------------------------- account ---------------------------- */

  let user = null;
  try {
    user = JSON.parse(localStorage.getItem("user") || "null");
  } catch (_) {}

  const isGuest =
    !user ||
    user.guest === true ||
    String(user.email || "").includes("guest.local");

  if (guestBox) guestBox.hidden = !isGuest;
  if (userBox) userBox.hidden = isGuest;

  if (!isGuest) {
    if (accountSummary) accountSummary.textContent = "Signed in on this device.";
    if (nameEl) nameEl.textContent = user.name || "D74 fan";
    if (emailEl) emailEl.textContent = user.email || "No email on file";
    if (avatar) avatar.textContent = String(user.name || user.email || "D").charAt(0);

    if (dateEl) {
      const raw = user.date || "";
      const parsed = raw ? new Date(raw) : null;
      dateEl.textContent =
        parsed && !Number.isNaN(parsed.getTime())
          ? parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
          : "—";
    }

    if (revealId) {
      const id = String(user.id || user._id || "—");
      let shown = false;
      revealId.addEventListener("click", function () {
        shown = !shown;
        revealId.textContent = shown ? "Hide" : "Show";
        revealId.setAttribute("aria-pressed", shown ? "true" : "false");
        if (shown) {
          revealId.dataset.id = id;
          emailEl.insertAdjacentHTML(
            "afterend",
            '<p class="muted account-id" style="margin-top:4px;font-size:0.72rem">ID: ' +
              D74UI.escapeHTML(id) +
              "</p>"
          );
        } else {
          const node = document.querySelector(".account-id");
          if (node) node.remove();
        }
      });
    }
  } else if (accountSummary) {
    accountSummary.textContent = "Sign up free to unlock downloads.";
  }

  if (logout) {
    logout.addEventListener("click", function () {
      if (!window.confirm("Log out of this device?")) return;
      try {
        localStorage.removeItem("user");
      } catch (_) {}
      window.location.href = "../login/";
    });
  }
})();
