"use strict";

/* ------------------------------------------------------------------
   D74 Edits — shared ad cards

   Every placement is a designed card rather than a bare ad unit. When
   AdSense is configured the card hosts a real responsive <ins> unit.
   When it is not configured the same card renders a D74 house ad, so
   the layout never shows an empty or broken space.

   Markup:
     <div class="ad-slot" data-ad-placement="explore"></div>

   The publisher id and slot ids come from GET /api/config and are
   validated again here before anything is loaded from Google.
------------------------------------------------------------------ */

(function (global, document) {
  const LOADER_URL = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";

  const SLOTS = {
    explore: {
      key: "explore",
      variant: "wide",
      house: {
        kicker: "D74 House Ad",
        title: "168 live channels. One tap.",
        copy: "Football, sport and entertainment from around the world — free, no subscription.",
        cta: "Open Live TV",
        href: "../livestreams/",
      },
    },
    "explore-inline": {
      key: "exploreInline",
      variant: "inline",
      house: {
        kicker: "D74 House Ad",
        title: "Find the clip you remember.",
        copy: "Search goals, players and competitions across the full D74 archive.",
        cta: "Search clips",
        href: "../search/",
      },
    },
    live: {
      key: "live",
      variant: "wide",
      house: {
        kicker: "D74 House Ad",
        title: "Keep the feed going.",
        copy: "Fresh football clips and match highlights, curated every day.",
        cta: "Explore clips",
        href: "../explore/",
      },
    },
    "live-side": {
      key: "liveSide",
      variant: "side",
      house: {
        kicker: "D74 House Ad",
        title: "Free football. No subscription.",
        copy: "168 live channels plus a daily feed of downloadable clips.",
        cta: "Browse Explore",
        href: "../explore/",
      },
    },
  };

  const state = {
    config: null,
    pending: null,
    loaderAdded: false,
  };

  function validClient(value) {
    return /^ca-pub-\d{10,20}$/.test(String(value || ""));
  }

  function validSlot(value) {
    return /^\d{5,20}$/.test(String(value || ""));
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /* ---------------------------- config ---------------------------- */

  function readConfig() {
    if (state.config) return Promise.resolve(state.config);
    if (state.pending) return state.pending;

    const api = global.D74Api;
    let request;
    if (api && typeof api.request === "function") {
      request = Promise.resolve(api.request("/api/config")).then(function (result) {
        return result && typeof result.json === "function" ? result.json() : null;
      });
    } else {
      request = fetch("/api/config", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      }).then(function (response) {
        return response.ok ? response.json() : null;
      });
    }

    state.pending = request
      .then(function (data) {
        state.config = data && typeof data === "object" ? data : {};
        return state.config;
      })
      .catch(function () {
        // Do not cache a failed request; the next mount may recover.
        state.pending = null;
        return {};
      });

    return state.pending;
  }

  function settingsFor(data, spec) {
    const ads = data && data.adsense;
    if (!ads || ads.enabled === false) return null;
    const client = validClient(ads.client) ? ads.client : "";
    const slots = ads.slots || {};
    const slot = validSlot(slots[spec.key]) ? slots[spec.key] : "";
    return client && slot ? { client: client, slot: slot } : null;
  }

  /* --------------------------- Adsense ---------------------------- */

  function ensureLoader(client) {
    if (state.loaderAdded) return;
    if (document.querySelector("script[data-d74-adsense]")) {
      state.loaderAdded = true;
      return;
    }
    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src = LOADER_URL + "?client=" + encodeURIComponent(client);
    script.setAttribute("data-d74-adsense", "");
    document.head.appendChild(script);
    state.loaderAdded = true;
  }

  function pushAd() {
    try {
      (global.adsbygoogle = global.adsbygoogle || []).push({});
    } catch (_) {
      /* An ad blocker is a normal condition, not a page error. */
    }
  }

  /* ---------------------------- chrome ---------------------------- */

  function buildCard(spec, meta) {
    const card = element("div", "ad-card ad-card--" + spec.variant);
    card.setAttribute("role", "complementary");
    card.setAttribute("aria-label", "Advertisement");

    const top = element("div", "ad-card__top");
    const tag = element("span", "ad-card__tag");
    tag.appendChild(element("i", "", ""));
    tag.appendChild(document.createTextNode("Advertisement"));
    top.appendChild(tag);
    top.appendChild(element("span", "ad-card__meta", meta));
    card.appendChild(top);

    const body = element("div", "ad-card__body");
    card.appendChild(body);

    const foot = element("div", "ad-card__foot");
    foot.appendChild(element("span", "", "Ads keep D74 free to use."));
    foot.appendChild(element("span", "ad-card__foot-dot", ""));
    foot.appendChild(
      element("span", "ad-card__foot-note", spec.variant === "side" ? "D74 / 01" : "D74 / Partner")
    );
    card.appendChild(foot);

    return { card: card, body: body };
  }

  function mount(node, card) {
    clear(node);
    node.appendChild(card);
    if (node.dataset.adPlacement === "live-side") {
      const side = node.closest(".live-side");
      if (side) side.classList.add("has-ad");
    }
  }

  /* ---------------------------- ad unit --------------------------- */

  function renderUnit(node, spec, settings) {
    const parts = buildCard(spec, "Sponsored");

    const unit = element("div", "ad-card__unit");
    unit.appendChild(element("span", "ad-card__placeholder", "Advertisement space"));

    const ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.style.display = "block";
    ins.style.width = "100%";
    ins.setAttribute("data-ad-client", settings.client);
    ins.setAttribute("data-ad-slot", settings.slot);
    ins.setAttribute("data-ad-format", "auto");
    ins.setAttribute("data-full-width-responsive", "true");
    unit.appendChild(ins);

    parts.body.appendChild(unit);
    mount(node, parts.card);
    ensureLoader(settings.client);
    pushAd();
  }

  /* --------------------------- house ad --------------------------- */

  function renderHouse(node, spec) {
    const parts = buildCard(spec, "D74 promotion");
    const house = element("div", "ad-house ad-house--" + spec.variant);

    house.appendChild(element("span", "ad-house__stamp", "D74"));

    const copy = element("div", "ad-house__copy");
    copy.appendChild(element("span", "ad-house__kicker", spec.house.kicker));
    copy.appendChild(element("h3", "ad-house__title", spec.house.title));
    copy.appendChild(element("p", "ad-house__text", spec.house.copy));

    const link = element("a", "ad-house__cta");
    link.href = spec.house.href;
    link.appendChild(document.createTextNode(spec.house.cta));
    link.appendChild(element("span", "ad-house__arrow", "→"));
    copy.appendChild(link);

    house.appendChild(copy);
    parts.body.appendChild(house);
    mount(node, parts.card);
  }

  /* ----------------------------- boot ----------------------------- */

  function mountNode(node) {
    const spec = SLOTS[node.dataset.adPlacement];
    if (!spec) return;
    readConfig().then(function (data) {
      const settings = settingsFor(data, spec);
      if (settings) renderUnit(node, spec, settings);
      else renderHouse(node, spec);
    });
  }

  function init(root) {
    const scope = root || document;
    const nodes = scope.querySelectorAll("[data-ad-placement]");
    for (let index = 0; index < nodes.length; index += 1) {
      if (!nodes[index].dataset.adMounted) {
        nodes[index].dataset.adMounted = "true";
        mountNode(nodes[index]);
      }
    }
  }

  global.D74Ads = {
    mount: init,
    refresh: function () {
      state.config = null;
      state.pending = null;
      const nodes = document.querySelectorAll("[data-ad-placement]");
      for (let index = 0; index < nodes.length; index += 1) {
        delete nodes[index].dataset.adMounted;
      }
      init(document);
    },
  };

  init(document);
})(window, document);
