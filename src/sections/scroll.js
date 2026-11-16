import Lenis from 'lenis';
import { gsap, ScrollTrigger } from '../utils/gsap.js';

export function initScroll({ reducedMotion, onProgress }) {
  let lenis = null;

  if (!reducedMotion) {
    lenis = new Lenis({
      duration: 1.15,
      smoothWheel: true,
      wheelMultiplier: 0.9,
      touchMultiplier: 1.35,
      easing: (t) => 1 - Math.pow(1 - t, 3),
    });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  const update = () => {
    const limit = document.documentElement.scrollHeight - window.innerHeight;
    const progress = limit > 0 ? window.scrollY / limit : 0;
    onProgress(Math.min(1, Math.max(0, progress)));
  };

  if (lenis) lenis.on('scroll', update);
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  window.addEventListener('load', () => ScrollTrigger.refresh());
  update();

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const selector = link.getAttribute('href');
      if (!selector || selector.length < 2) return;
      const target = document.querySelector(selector);
      if (!target) return;
      event.preventDefault();
      if (lenis) lenis.scrollTo(target, { duration: 1.2 });
      else target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
    });
  });

  return {
    lenis,
    update,
    scrollTo: (target) => {
      if (lenis) lenis.scrollTo(target, { duration: 1.2 });
      else target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
    },
    stop: () => lenis?.stop(),
    start: () => lenis?.start(),
  };
}
