import { gsap, ScrollTrigger } from '../utils/gsap.js';
import { formatNumber } from '../utils/math.js';

export function initCounters(reducedMotion) {
  if (reducedMotion) return;

  document.querySelectorAll('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count) || 0;
    const state = { value: 0 };

    ScrollTrigger.create({
      trigger: el,
      start: 'top 88%',
      once: true,
      onEnter: () => {
        gsap.to(state, {
          value: target,
          duration: 1.6,
          ease: 'power2.out',
          onUpdate: () => {
            el.textContent = formatNumber(state.value);
          },
        });
      },
    });
  });
}
