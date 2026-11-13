"use strict";

/* ------------------------------------------------------------------
   Search controller
------------------------------------------------------------------ */

(function () {
  const form = document.getElementById("searchForm");
  const input = document.getElementById("searcher");
  const results = document.getElementById("results");
  const empty = document.getElementById("searchEmpty");
  const count = document.getElementById("resultCount");
  const loader = document.getElementById("pageLoader");
  const chips = document.getElementById("trendingChips");

  let library = [];
  let ready = false;
  let timer = null;

  function esc(value) {
    return window.D74UI ? D74UI.escapeHTML(value) : String(value == null ? "" : value);
  }

  function setLoader(show) {
    if (loader) loader.classList.toggle("is-hidden", !show);
  }

  function currentQuery() {
    return (input && input.value ? input.value : "").trim();
  }

  function render() {
    if (!results) return;
    const query = currentQuery().toLowerCase();
    const filtered = query
      ? library.filter(function (item) {
          const haystack = [
            item.title,
            item.description,
            Array.isArray(item.tags) ? item.tags.join(" ") : "",
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(query);
        })
      : library.slice(0, 24);

    results.innerHTML = "";
    if (!filtered.length) {
      if (empty) empty.hidden = false;
      if (count) {
        count.textContent = query
          ? 'No clips match "' + query + '"'
          : "The library is empty right now.";
      }
      return;
    }

    if (empty) empty.hidden = true;
    filtered.forEach(function (item, index) {
      const id = "search_" + (item.ytid || index) + "_" + index;
      results.appendChild(search_page_card.create(item, id, index).parseElement()[0]);
    });
    if (count) {
      count.textContent =
        (query ? filtered.length + " result" + (filtered.length === 1 ? "" : "s") + " for “" + currentQuery() + "”" : "Showing " + filtered.length + " of " + library.length + " clips");
    }
  }

  function scheduleRender() {
    clearTimeout(timer);
    timer = setTimeout(render, 180);
  }

  function loadLibrary() {
    setLoader(true);
    db.get(new db.Coll("videos", {}), function (xhr) {
      const data = xhr && typeof xhr.json === "function" ? xhr.json() : null;
      library = Array.isArray(data)
        ? data.filter(function (item) {
            return item && (item.title || item.ytid);
          })
        : [];
      ready = true;
      setLoader(false);
      if (!library.length && window.toast) {
        toast("Could not load the clip library right now.", "error");
      }
      render();
    });
  }

  if (input) {
    input.addEventListener("input", scheduleRender);
    const initial = new URLSearchParams(window.location.search).get("q");
    if (initial) input.value = initial;
  }

  if (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      render();
      const query = currentQuery();
      const url = query ? "?q=" + encodeURIComponent(query) : window.location.pathname;
      window.history.replaceState(null, "", url);
    });
  }

  if (chips) {
    chips.addEventListener("click", function (event) {
      const chip = event.target.closest(".chip");
      if (!chip || !input) return;
      input.value = chip.textContent.trim();
      render();
      window.history.replaceState(
        null,
        "",
        "?q=" + encodeURIComponent(input.value)
      );
    });
  }

  loadLibrary();
})();
