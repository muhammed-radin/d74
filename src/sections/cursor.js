import { gsap } from '../utils/gsap.js';

const finePointer = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

export function initCursor(reducedMotion) {
  if (reducedMotion || !finePointer()) return;

  const root = document.querySelector('.cursor');
  const ring = document.querySelector('.cursor__ring');
  const dot = document.querySelector('.cursor__dot');
  if (!root || !ring || !dot) return;

  document.body.classList.add('has-cursor');
  gsap.set([ring, dot], { xPercent: -50, yPercent: -50, opacity: 0 });

  let visible = false;
  window.addEventListener('pointermove', (event) => {
    if (!visible) {
      visible = true;
      gsap.to([ring, dot], { opacity: 1, duration: 0.2 });
    }
    gsap.to(ring, { x: event.clientX, y: event.clientY, duration: 0.42, ease: 'power3.out' });
    gsap.to(dot, { x: event.clientX, y: event.clientY, duration: 0.08, ease: 'power2.out' });
  }, { passive: true });

  document.addEventListener('pointerover', (event) => {
    if (event.target.closest('a, button, [data-magnetic]')) ring.classList.add('is-hovering');
  });
  document.addEventListener('pointerout', (event) => {
    if (event.target.closest('a, button, [data-magnetic]')) ring.classList.remove('is-hovering');
  });

  document.addEventListener('pointerleave', () => {
    gsap.to([ring, dot], { opacity: 0, duration: 0.2 });
    visible = false;
  });
}

export function initMagnetic(reducedMotion) {
  if (reducedMotion || !finePointer()) return;

  document.querySelectorAll('[data-magnetic]').forEach((el) => {
    el.addEventListener('pointermove', (event) => {
      const rect = el.getBoundingClientRect();
      const x = (event.clientX - rect.left - rect.width / 2) * 0.24;
      const y = (event.clientY - rect.top - rect.height / 2) * 0.34;
      gsap.to(el, { x, y, duration: 0.35, ease: 'power2.out' });
    });

    el.addEventListener('pointerleave', () => {
      gsap.to(el, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1, 0.4)' });
    });
  });
}
