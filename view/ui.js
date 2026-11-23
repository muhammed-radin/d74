"use strict";

/* ------------------------------------------------------------------
   D74 Edits — shared UI behaviour
   Drawer, theme, reveal animations, active navigation, toasts.
------------------------------------------------------------------ */

(function () {
  const THEMES = ["light", "blue", "dark", "green", "black"];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* --------------------------- escaping --------------------------- */

  function escapeHTML(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeUrl(value, fallback = "#") {
    try {
      const url = new URL(String(value), window.location.href);
      if (["http:", "https:"].includes(url.protocol)) return url.href;
    } catch (_) {}
    return fallback;
  }

  /* ---------------------------- theme ----------------------------- */

  function applyTheme(theme) {
    const body = document.body;
    THEMES.forEach(function (name) {
      body.classList.remove(name);
    });
    body.classList.add(THEMES.includes(theme) ? theme : "dark");
    try {
      localStorage.setItem("theme", THEMES.includes(theme) ? theme : "dark");
    } catch (_) {}
    document
      .querySelectorAll("[data-theme-icon]")
      .forEach(function (icon) {
        icon.setAttribute(
          "name",
          body.classList.contains("light") ? "moon-outline" : "sunny-outline"
        );
      });
  }

  function currentTheme() {
    let stored = "dark";
    try {
      stored = localStorage.getItem("theme") || "dark";
    } catch (_) {}
    return stored;
  }

  function initTheme() {
    applyTheme(currentTheme());
  }

  /* ---------------------------- accent ---------------------------- */

  const ACCENT_KEY = "accent";
  const DEFAULT_ACCENT = "#d7ff3f";

  function applyAccent(hex) {
    const value = String(hex || "").trim();
    if (!/^#[0-9a-f]{6}$/i.test(value)) return DEFAULT_ACCENT;
    [document.documentElement, document.body].forEach(function (node) {
      node.style.setProperty("--accent", value);
      node.style.setProperty("--theme-color", value);
    });
    try {
      localStorage.setItem(ACCENT_KEY, value);
    } catch (_) {}
    document.querySelectorAll("[data-accent]").forEach(function (swatch) {
      swatch.classList.toggle(
        "active",
        swatch.dataset.accent.toLowerCase() === value.toLowerCase()
      );
    });
    return value;
  }

  function currentAccent() {
    try {
      return localStorage.getItem(ACCENT_KEY) || DEFAULT_ACCENT;
    } catch (_) {
      return DEFAULT_ACCENT;
    }
  }

  function initAccent() {
    const stored = currentAccent();
    if (stored !== DEFAULT_ACCENT) applyAccent(stored);
  }

  /* ---------------------------- drawer ---------------------------- */

  function initDrawer() {
    const drawer = document.getElementById("drawer");
    const scrim = document.getElementById("scrim");
    if (!drawer || !scrim) return;

    function open() {
      drawer.classList.add("open");
      scrim.classList.add("open");
      document.body.style.overflow = "hidden";
      const opener = document.getElementById("drawerOpen");
      if (opener) opener.setAttribute("aria-expanded", "true");
    }

    function close() {
      drawer.classList.remove("open");
      scrim.classList.remove("open");
      document.body.style.overflow = "";
      const opener = document.getElementById("drawerOpen");
      if (opener) opener.setAttribute("aria-expanded", "false");
    }

    const opener = document.getElementById("drawerOpen");
    const closer = document.getElementById("drawerClose");
    if (opener) opener.addEventListener("click", open);
    if (closer) closer.addEventListener("click", close);
    scrim.addEventListener("click", close);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") close();
    });
    drawer.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", close);
    });
  }

  /* -------------------------- navigation -------------------------- */

  function initActiveNav() {
    const path = window.location.pathname.replace(/\/index\.html$/, "/");
    const map = [
      { match: /^\/explore(?:\/|$)/, key: "explore" },
      { match: /^\/search(?:\/|$)/, key: "search" },
      { match: /^\/livestreams(?:\/|$)/, key: "livestreams" },
      { match: /^\/settings(?:\/|$)/, key: "settings" },
      { match: /^\/visit(?:\/|$)/, key: "explore" },
      { match: /^\/login(?:\/|$)|^\/signup(?:\/|$)/, key: "login" },
    ];
    const active =
      path === "/" || path === "/index.html"
        ? { key: "home" }
        : map.find((item) => item.match.test(path));
    if (!active) return;
    document
      .querySelectorAll("[data-nav]")
      .forEach(function (element) {
        element.classList.toggle("active", element.dataset.nav === active.key);
      });
  }

  /* --------------------------- mobile dock ------------------------ */

  function initDock() {
    const dock = document.querySelector(".dock");
    if (!dock) return;

    let indicator = dock.querySelector(".dock-indicator");
    if (!indicator) {
      indicator = document.createElement("span");
      indicator.className = "dock-indicator";
      indicator.setAttribute("aria-hidden", "true");
      dock.prepend(indicator);
    }

    const links = Array.from(dock.querySelectorAll(".dock-link"));

    function place() {
      const active = dock.querySelector(".dock-link.active");
      dock.classList.toggle("dock--idle", !active);
      if (!active) return;
      /* offsetLeft/offsetWidth are layout values and are not affected by
         the dock's entrance transform, unlike getBoundingClientRect(). */
      dock.style.setProperty("--dock-x", active.offsetLeft + "px");
      dock.style.setProperty("--dock-w", active.offsetWidth + "px");
      dock.classList.add("dock--ready");
    }

    /* Two frames lets Ionicons and webfonts settle before measuring. */
    requestAnimationFrame(function () {
      requestAnimationFrame(place);
    });

    window.addEventListener("resize", place, { passive: true });
    window.addEventListener("pageshow", place);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(place).catch(function () {});
    }
    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(place);
      observer.observe(dock);
      links.forEach(function (link) {
        observer.observe(link);
      });
    }
  }

  /* --------------------------- reveal ----------------------------- */

  function initReveal() {
    if (window.D74_MOTION === "anime") return;
    const nodes = Array.from(document.querySelectorAll("[data-reveal]"));
    if (!nodes.length) return;
    nodes.forEach(function (node, index) {
      node.classList.add("reveal");
      const delay = node.dataset.revealDelay || (index % 6) * 70;
      node.style.setProperty("--reveal-delay", delay + "ms");
    });
    if (reduced || !("IntersectionObserver" in window)) {
      nodes.forEach((node) => node.classList.add("in"));
      return;
    }
    const observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
    );
    nodes.forEach((node) => observer.observe(node));
  }

  /* --------------------------- counters --------------------------- */

  function initCounters() {
    if (window.D74_MOTION === "anime") return;
    const nodes = document.querySelectorAll("[data-count]");
    if (!nodes.length) return;
    nodes.forEach(function (node) {
      const target = Number(node.dataset.count);
      if (!Number.isFinite(target)) return;
      if (reduced) {
        node.textContent = target.toLocaleString();
        return;
      }
      const duration = 1200;
      const start = performance.now();
      function tick(now) {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        node.textContent = Math.round(target * eased).toLocaleString();
        if (progress < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  /* ------------------------------ tilt ---------------------------- */

  function initTilt() {
    if (reduced || window.D74_MOTION === "anime") return;
    document.querySelectorAll("[data-tilt]").forEach(function (node) {
      node.addEventListener("pointermove", function (event) {
        const rect = node.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        node.style.transform =
          "perspective(900px) rotateX(" +
          (-y * 4).toFixed(2) +
          "deg) rotateY(" +
          (x * 4).toFixed(2) +
          "deg) translateY(-4px)";
      });
      node.addEventListener("pointerleave", function () {
        node.style.transform = "";
      });
    });
  }

  /* ----------------------------- toasts --------------------------- */

  function toast(message, type = "info", timeout = 3800) {
    let stack = document.querySelector(".toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "toast-stack";
      stack.setAttribute("role", "status");
      stack.setAttribute("aria-live", "polite");
      document.body.appendChild(stack);
    }
    const item = document.createElement("div");
    item.className = "toast " + type;
    item.textContent = message;
    stack.appendChild(item);
    setTimeout(function () {
      item.style.opacity = "0";
      item.style.transform = "translateX(20px)";
      item.style.transition = "all .3s ease";
      setTimeout(() => item.remove(), 320);
    }, timeout);
  }

  /* ----------------------------- auth UI -------------------------- */

  function initAuthUI() {
    const loginLink = document.getElementById("loginLink");
    if (!loginLink) return;
    let user = null;
    try {
      user = JSON.parse(localStorage.getItem("user") || "null");
    } catch (_) {}
    if (!user || !user.email || String(user.email).includes("guest.local")) return;
    loginLink.textContent = "Account";
    loginLink.setAttribute("href", "../settings");
    const avatar = document.querySelector("[data-avatar]");
    if (avatar) {
      avatar.textContent = (user.name || user.email || "D").slice(0, 1);
      avatar.hidden = false;
    }
  }

  /* ----------------------------- misc ----------------------------- */

  function initMisc() {
    document.querySelectorAll("[data-year]").forEach(function (node) {
      node.textContent = new Date().getFullYear();
    });
    document.querySelectorAll("[data-password-toggle]").forEach(function (button) {
      button.addEventListener("click", function () {
        const input = document.getElementById(button.dataset.passwordToggle);
        if (!input) return;
        input.type = input.type === "password" ? "text" : "password";
        const icon = button.querySelector("ion-icon");
        if (icon) {
          icon.setAttribute(
            "name",
            input.type === "password" ? "eye-outline" : "eye-off-outline"
          );
        }
      });
    });
    // Close legacy option popovers when clicking the backdrop.
    document.addEventListener("click", function (event) {
      if (!event.target.closest(".card-options, .card-opt-icon")) {
        document.querySelectorAll(".card-options").forEach(function (panel) {
          if (panel.style.display === "block") panel.style.display = "none";
        });
      }
    });
  }

  /* ----------------------------- boot ----------------------------- */

  function boot() {
    initTheme();
    initAccent();
    initDrawer();
    initActiveNav();
    initDock();
    initReveal();
    initCounters();
    initTilt();
    initAuthUI();
    initMisc();

    document.querySelectorAll("[data-theme-toggle]").forEach(function (button) {
      button.addEventListener("click", function () {
        applyTheme(document.body.classList.contains("light") ? "dark" : "light");
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.D74UI = {
    applyTheme: applyTheme,
    currentTheme: currentTheme,
    applyAccent: applyAccent,
    currentAccent: currentAccent,
    toast: toast,
    escapeHTML: escapeHTML,
    safeUrl: safeUrl,
  };
  window.toast = toast;
})();
