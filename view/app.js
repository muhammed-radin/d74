"use strict";

/* ------------------------------------------------------------------
   D74 Edits — shared legacy helpers
   Kept small on purpose. Modern UI behaviour lives in view/ui.js.
------------------------------------------------------------------ */

var nowUrl = typeof nowUrl === "string" ? nowUrl : "";
var heading = typeof heading === "string" ? heading : "D74 Edits";

const THEME_LIST = ["light", "blue", "dark", "green", "black"];

function setTheme(theme) {
  const next = THEME_LIST.includes(theme) ? theme : "dark";
  THEME_LIST.forEach(function (name) {
    document.body.classList.remove(name);
  });
  document.body.classList.add(next);
  try {
    localStorage.setItem("theme", next);
  } catch (_) {}
}

function setThemeColor(color) {
  document.documentElement.style.setProperty("--theme-color", color);
  try {
    localStorage.setItem("theme-color", color);
  } catch (_) {}
}

(function restorePreferences() {
  try {
    const theme = localStorage.getItem("theme");
    if (theme && THEME_LIST.includes(theme)) {
      THEME_LIST.forEach((name) => document.body.classList.remove(name));
      document.body.classList.add(theme);
    }
    const color = localStorage.getItem("theme-color");
    if (color) {
      document.documentElement.style.setProperty("--theme-color", color);
    }
  } catch (_) {}
})();

function redirctTo(url) {
  window.location.href = url;
}

function addScript(path) {
  const script = document.createElement("script");
  script.src = nowUrl + path;
  document.body.appendChild(script);
}

/* ------------------------- guest session ------------------------- */

(function guestSession() {
  let user = null;
  try {
    user = JSON.parse(localStorage.getItem("user") || "null");
  } catch (_) {}
  if (user) return;
  const name = "guest" + Math.floor(Math.random() * 9999);
  try {
    localStorage.setItem(
      "user",
      JSON.stringify({
        name: name,
        email: name + "@guest.local",
        guest: true,
        date: new Date().toISOString(),
      })
    );
  } catch (_) {}
})();

/* --------------------------- login link -------------------------- */

(function paintLoginLink() {
  const loginLink = document.getElementById("loginLink");
  if (!loginLink) return;
  let user = null;
  try {
    user = JSON.parse(localStorage.getItem("user") || "null");
  } catch (_) {}
  if (
    user &&
    user.email &&
    user.guest !== true &&
    !String(user.email).includes("guest.local")
  ) {
    loginLink.dataset.signedIn = "true";
  }
})();

/* --------------------------- compat nav -------------------------- */

(function compatNavigation() {
  const leftBar = document.querySelector(".left-bar");
  const menuOpener = document.getElementById("menuOpener");
  const closer = document.getElementById("leftBarCloser");
  if (!leftBar || !menuOpener) return;
  menuOpener.addEventListener("click", function () {
    leftBar.style.display = "block";
  });
  if (closer) {
    closer.addEventListener("click", function () {
      leftBar.style.display = "none";
    });
  }
})();

if (localStorage.getItem("admin")) {
  const host =
    document.querySelector(".drawer-links") ||
    document.querySelector(".left-bar .left-box");
  if (host) {
    const link = document.createElement("a");
    link.className = "drawer-link";
    link.href =
      (location.pathname.includes("/Admin/") ? "" : "../Admin/") + "";
    link.innerHTML =
      '<ion-icon name="shield-checkmark-outline"></ion-icon><span>Admin<small class="sub">You are an administrator</small></span>';
    host.appendChild(link);
  }
}

/* --------------------------- utilities --------------------------- */

class TagString extends String {
  constructor(code) {
    super(code);
  }

  parse(next) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(this), "text/html");
    if (typeof next === "function") next({ content: doc, str: this });
    return doc;
  }

  parseElement() {
    return this.parse().body.children;
  }

  setOptions(obj = {}) {
    let doc = this.parse();
    doc = doc.body.children[0];
    Object.keys(obj).forEach(function (key) {
      doc[key] = obj[key];
    });
    return new TagString(doc.outerHTML);
  }

  setAttributes(obj = {}) {
    let doc = this.parse();
    doc = doc.body.children[0];
    Object.keys(obj).forEach(function (key) {
      if (doc.setAttribute) doc.setAttribute(key, obj[key]);
    });
    return new TagString(doc.outerHTML);
  }

  child(html) {
    let doc = this.parse();
    doc = doc.body.children[0];
    doc.innerHTML = html;
    return new TagString(doc.outerHTML);
  }

  data(next) {
    if (typeof next === "function") {
      const data = next(this);
      if (data) return data;
    }
    return this;
  }
}

function coolLoop(arr, callback, index = 0, time = 10) {
  return new Promise(function (resolve) {
    if (!Array.isArray(arr) || arr.length === 0) return resolve();
    let cursor = index;
    function step() {
      if (cursor >= arr.length) return resolve();
      callback(arr[cursor], cursor);
      cursor += 1;
      if (cursor < arr.length) {
        setTimeout(step, time);
      } else {
        resolve();
      }
    }
    step();
  });
}
