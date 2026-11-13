"use strict";

/* ------------------------------------------------------------------
   D74 Edits — landing motion layer (anime.js)
   Loaded only on the landing page, before view/ui.js. When anime.js is
   unavailable or the user prefers reduced motion we do nothing and the
   CSS/IntersectionObserver fallback in view/ui.js takes over.
------------------------------------------------------------------ */

(function (global, document) {
  if (!global.anime) return;
  if (global.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const anime = global.anime;
  const EASE = "cubicBezier(0.16, 1, 0.3, 1)";
  const hero = document.querySelector(".hero-screen");

  /* Tell ui.js to stand down on the effects this file owns. */
  global.D74_MOTION = "anime";

  /* ---------------------------------------------------------------
     Split the hero headline into animatable words without losing the
     <em> accent styling.
  ---------------------------------------------------------------- */

  function splitWords(root) {
    if (!root) return;
    const fragment = document.createDocumentFragment();

    function pushWord(text, source) {
      if (!text) return;
      const word = document.createElement("span");
      word.className = "word";
      const inner = document.createElement("span");
      inner.className = "word-inner";
      if (source) {
        const clone = source.cloneNode(false);
        clone.textContent = text;
        inner.appendChild(clone);
      } else {
        inner.textContent = text;
      }
      word.appendChild(inner);
      fragment.appendChild(word);
    }

    Array.from(root.childNodes).forEach(function (node) {
      if (node.nodeType === Node.TEXT_NODE) {
        node.textContent.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) fragment.appendChild(document.createTextNode(" "));
          else pushWord(part, null);
        });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        node.textContent.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) fragment.appendChild(document.createTextNode(" "));
          else pushWord(part, node);
        });
      }
    });

    root.textContent = "";
    root.appendChild(fragment);
  }

  const heroTitle = document.querySelector(".hero-title");
  splitWords(heroTitle);

  /* ---------------------------------------------------------------
     Initial states — set in JS so the page is still readable without
     JavaScript or anime.js.
  ---------------------------------------------------------------- */

  const heroCopy = ".hero-eyebrow, .hero-sub, .hero-actions";
  anime.set(heroCopy, { opacity: 0, translateY: 18 });
  anime.set(".hero-stats > div", { opacity: 0, translateY: 18 });
  anime.set(".hero-title .word-inner", { translateY: "115%", rotate: 3 });
  anime.set(".visual-stage", { opacity: 0, scale: 0.94, translateY: 26 });
  anime.set(".stage-card", { opacity: 0, translateY: 16 });
  anime.set(".stage-float", { opacity: 0, translateY: 14, scale: 0.9 });
  anime.set(".hero-scroll", { opacity: 0 });

  /* ---------------------------------------------------------------
     Hero entrance timeline.
  ---------------------------------------------------------------- */

  if (hero) {
    const timeline = anime.timeline({ easing: EASE, duration: 900 });

    timeline
      .add(
        {
          targets: ".topbar",
          translateY: [-74, 0],
          opacity: [0, 1],
          duration: 800,
          easing: "easeOutExpo",
        },
        0
      )
      .add(
        {
          targets: ".hero-eyebrow",
          opacity: [0, 1],
          translateY: [18, 0],
          duration: 700,
        },
        "-=520"
      )
      .add(
        {
          targets: ".hero-title .word-inner",
          translateY: ["115%", "0%"],
          rotate: [3, 0],
          duration: 1000,
          delay: anime.stagger(55),
        },
        "-=560"
      )
      .add(
        {
          targets: ".hero-sub",
          opacity: [0, 1],
          translateY: [18, 0],
          duration: 800,
        },
        "-=800"
      )
      .add(
        {
          targets: ".hero-actions",
          opacity: [0, 1],
          translateY: [18, 0],
          duration: 800,
        },
        "-=700"
      )
      .add(
        {
          targets: ".hero-stats > div",
          opacity: [0, 1],
          translateY: [18, 0],
          duration: 700,
          delay: anime.stagger(90),
        },
        "-=660"
      )
      .add(
        {
          targets: ".visual-stage",
          opacity: [0, 1],
          scale: [0.94, 1],
          translateY: [26, 0],
          duration: 1100,
        },
        "-=980"
      )
      .add(
        {
          targets: ".stage-card",
          opacity: [0, 1],
          translateY: [16, 0],
          duration: 800,
        },
        "-=900"
      )
      .add(
        {
          targets: ".stage-float",
          opacity: [0, 1],
          translateY: [14, 0],
          scale: [0.9, 1],
          duration: 700,
          delay: anime.stagger(140),
        },
        "-=780"
      )
      .add(
        {
          targets: ".hero-scroll",
          opacity: [0, 1],
          duration: 700,
        },
        "-=500"
      );

    timeline.finished.then(function () {
      /* Hero elements are done; clear the entrance styles that would
         otherwise block hover transforms. */
      document.querySelectorAll(".hero-title .word-inner").forEach(function (node) {
        node.style.transform = "";
      });
      document
        .querySelectorAll(".hero-eyebrow, .hero-sub, .hero-actions, .hero-stats > div")
        .forEach(function (node) {
          node.style.opacity = "";
          node.style.transform = "";
        });
      document.querySelectorAll(".hero-scroll").forEach(function (node) {
        node.style.opacity = "";
      });
      document.querySelectorAll(".stage-card").forEach(function (node) {
        node.style.opacity = "";
        node.style.transform = "";
      });
      document.querySelectorAll(".topbar").forEach(function (node) {
        node.style.opacity = "";
        node.style.transform = "";
      });

      anime({
        targets: ".stage-float",
        translateY: [0, -6],
        direction: "alternate",
        loop: true,
        duration: 2800,
        delay: anime.stagger(420),
        easing: "easeInOutSine",
      });

      anime({
        targets: ".stage-play",
        scale: [1, 1.07],
        direction: "alternate",
        loop: true,
        duration: 1700,
        easing: "easeInOutSine",
      });
    });
  }

  /* ---------------------------------------------------------------
     Counters.
  ---------------------------------------------------------------- */

  document.querySelectorAll("[data-count]").forEach(function (node, index) {
    const target = Number(node.dataset.count);
    if (!Number.isFinite(target)) return;
    const state = { value: 0 };
    anime({
      targets: state,
      value: target,
      round: 1,
      duration: 1800,
      delay: 1150 + index * 140,
      easing: "easeOutExpo",
      update: function () {
        node.textContent = Math.round(state.value).toLocaleString();
      },
    });
  });

  /* ---------------------------------------------------------------
     Scroll-triggered section reveals (the hero is handled above).
  ---------------------------------------------------------------- */

  const revealNodes = Array.from(document.querySelectorAll("[data-reveal]")).filter(
    function (node) {
      return !node.closest(".hero-screen");
    }
  );

  if ("IntersectionObserver" in global && revealNodes.length) {
    revealNodes.forEach(function (node) {
      const delay = Number(node.dataset.revealDelay || 0);
      anime.set(node, { opacity: 0, translateY: 34 });

      const observer = new IntersectionObserver(
        function (entries, obs) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            obs.unobserve(entry.target);
            anime({
              targets: entry.target,
              opacity: [0, 1],
              translateY: [34, 0],
              duration: 1000,
              delay: delay,
              easing: EASE,
              complete: function () {
                entry.target.style.opacity = "";
                entry.target.style.transform = "";
              },
            });
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -50px 0px" }
      );
      observer.observe(node);
    });
  } else {
    revealNodes.forEach(function (node) {
      node.style.opacity = "";
      node.style.transform = "";
    });
  }

  /* ---------------------------------------------------------------
     Pointer interactions: tilt, spotlight and magnetic buttons.
  ---------------------------------------------------------------- */

  function onPointerLeave(node) {
    anime({
      targets: node,
      rotateX: 0,
      rotateY: 0,
      translateY: 0,
      duration: 750,
      easing: "easeOutElastic(1, 0.6)",
      complete: function () {
        node.style.transform = "";
      },
    });
  }

  document.querySelectorAll("[data-tilt]").forEach(function (node) {
    const floats = Array.from(node.querySelectorAll(".stage-float"));

    node.addEventListener("pointermove", function (event) {
      if (event.pointerType === "touch") return;
      const rect = node.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;

      node.style.transform =
        "perspective(1000px) rotateX(" +
        (-y * 5).toFixed(2) +
        "deg) rotateY(" +
        (x * 6).toFixed(2) +
        "deg) translateY(-4px)";

      node.style.setProperty("--px", ((x + 0.5) * 100).toFixed(1) + "%");
      node.style.setProperty("--py", ((y + 0.5) * 100).toFixed(1) + "%");

      floats.forEach(function (float, index) {
        const depth = index === 0 ? 10 : -10;
        float.style.translate = (x * depth).toFixed(2) + "px " + (y * depth).toFixed(2) + "px";
      });
    });

    node.addEventListener("pointerleave", function () {
      floats.forEach(function (float) {
        float.style.translate = "";
      });
      onPointerLeave(node);
    });
  });

  document.querySelectorAll(".feature-card").forEach(function (card) {
    card.addEventListener("pointermove", function (event) {
      if (event.pointerType === "touch") return;
      const rect = card.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;

      card.style.setProperty("--mx", (px * 100).toFixed(1) + "%");
      card.style.setProperty("--my", (py * 100).toFixed(1) + "%");
      card.style.transform =
        "perspective(900px) rotateX(" +
        ((0.5 - py) * 3.2).toFixed(2) +
        "deg) rotateY(" +
        ((px - 0.5) * 3.6).toFixed(2) +
        "deg) translateY(-4px)";
    });

    card.addEventListener("pointerleave", function () {
      onPointerLeave(card);
    });
  });

  document.querySelectorAll("[data-magnetic]").forEach(function (element) {
    element.addEventListener("pointermove", function (event) {
      if (event.pointerType === "touch") return;
      const rect = element.getBoundingClientRect();
      const dx = (event.clientX - rect.left - rect.width / 2) * 0.18;
      const dy = (event.clientY - rect.top - rect.height / 2) * 0.26;
      element.style.transform =
        "translate(" + dx.toFixed(2) + "px, " + dy.toFixed(2) + "px)";
    });

    element.addEventListener("pointerleave", function () {
      anime({
        targets: element,
        translateX: 0,
        translateY: 0,
        duration: 850,
        easing: "easeOutElastic(1, 0.45)",
        complete: function () {
          element.style.transform = "";
        },
      });
    });
  });

  /* ---------------------------------------------------------------
     Reading progress bar.
  ---------------------------------------------------------------- */

  const progress = document.createElement("div");
  progress.className = "scroll-progress";
  progress.setAttribute("aria-hidden", "true");
  document.body.appendChild(progress);

  let queued = false;

  function paintProgress() {
    const max = document.documentElement.scrollHeight - global.innerHeight;
    const value = max > 0 ? Math.min(1, Math.max(0, global.scrollY / max)) : 0;
    progress.style.transform = "scaleX(" + value.toFixed(4) + ")";
    queued = false;
  }

  global.addEventListener(
    "scroll",
    function () {
      if (queued) return;
      queued = true;
      global.requestAnimationFrame(paintProgress);
    },
    { passive: true }
  );
  global.addEventListener("resize", paintProgress);
  paintProgress();
})(window, document);
