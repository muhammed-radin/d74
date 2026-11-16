import { gsap, ScrollTrigger } from '../utils/gsap.js';

function appendSplit(node, target) {
  if (node.nodeType === Node.TEXT_NODE) {
    const parts = node.textContent.split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        target.appendChild(document.createTextNode(' '));
        continue;
      }
      const word = document.createElement('span');
      word.className = 'word';
      const inner = document.createElement('span');
      inner.className = 'word__inner';
      inner.textContent = part;
      word.appendChild(inner);
      target.appendChild(word);
    }
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const clone = node.cloneNode(false);
  clone.textContent = '';
  Array.from(node.childNodes).forEach((child) => appendSplit(child, clone));
  target.appendChild(clone);
}

function splitWords(root) {
  if (!root || root.dataset.splitDone === 'true') return;
  const fragment = document.createDocumentFragment();
  Array.from(root.childNodes).forEach((node) => appendSplit(node, fragment));
  root.textContent = '';
  root.appendChild(fragment);
  root.dataset.splitDone = 'true';
}

export function initTextAnimations(reducedMotion) {
  if (reducedMotion) {
    document.querySelectorAll('[data-reveal], [data-hero-reveal]').forEach((el) => {
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
    return { playHero() {} };
  }

  document.querySelectorAll('[data-split]').forEach(splitWords);

  const heroWords = gsap.utils.toArray('.hero .word__inner');
  const heroReveals = gsap.utils.toArray('.hero [data-hero-reveal]').filter(
    (el) => !el.classList.contains('hero__side'),
  );

  gsap.set(heroWords, { yPercent: 115, rotate: 4 });
  gsap.set(heroReveals, { opacity: 0, y: 24 });

  const heroTimeline = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });
  heroTimeline
    .to(heroReveals, { opacity: 1, y: 0, duration: 0.85, stagger: 0.09 }, 0)
    .to(heroWords, { yPercent: 0, rotate: 0, duration: 1.05, stagger: 0.055, ease: 'power4.out' }, 0.08)
    .fromTo('.hero__side', { opacity: 0, scale: 0.94, y: 26 }, { opacity: 1, scale: 1, y: 0, duration: 1.1, ease: 'power3.out' }, 0.35);

  const splitTargets = gsap.utils.toArray('[data-split]:not(.hero__title)');
  splitTargets.forEach((target) => {
    const words = target.querySelectorAll('.word__inner');
    gsap.set(words, { yPercent: 115, rotate: 2 });
    ScrollTrigger.create({
      trigger: target,
      start: 'top 86%',
      once: true,
      onEnter: () => {
        gsap.to(words, {
          yPercent: 0,
          rotate: 0,
          duration: 0.95,
          stagger: 0.035,
          ease: 'power3.out',
          overwrite: true,
        });
      },
    });
  });

  ScrollTrigger.batch('[data-reveal]', {
    start: 'top 89%',
    once: true,
    onEnter: (batch) => {
      gsap.to(batch, {
        opacity: 1,
        y: 0,
        duration: 0.9,
        stagger: 0.08,
        ease: 'power3.out',
        overwrite: true,
      });
    },
  });

  gsap.utils.toArray('[data-parallax]').forEach((el) => {
    const depth = Number(el.dataset.parallax) || 0.2;
    gsap.to(el, {
      y: () => -window.innerHeight * depth,
      ease: 'none',
      scrollTrigger: {
        trigger: el,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
      },
    });
  });

  return { playHero: () => heroTimeline.play(0) };
}
