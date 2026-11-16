import { gsap } from '../utils/gsap.js';

export function initNav(scroll) {
  const nav = document.getElementById('nav');
  const toggle = document.getElementById('navToggle');
  const menu = document.getElementById('mobileMenu');
  const year = document.getElementById('year');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (year) year.textContent = String(new Date().getFullYear());
  if (menu) menu.inert = true;

  const setMenu = (open) => {
    if (!menu || !toggle) return;
    document.body.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu.setAttribute('aria-hidden', String(!open));
    menu.inert = !open;

    if (open) {
      scroll?.stop?.();
      const first = menu.querySelector('a');
      window.setTimeout(() => first?.focus(), 80);
    } else {
      scroll?.start?.();
    }
  };

  toggle?.addEventListener('click', () => {
    setMenu(!document.body.classList.contains('menu-open'));
  });

  menu?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => setMenu(false));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('menu-open')) {
      setMenu(false);
      toggle?.focus();
    }
  });

  const updateNav = () => {
    nav?.classList.toggle('is-scrolled', window.scrollY > 36);
  };

  window.addEventListener('scroll', updateNav, { passive: true });
  updateNav();

  if (finePointer) {
    document.querySelectorAll('.nav__links a, .footer__links a').forEach((link) => {
      link.addEventListener('pointerenter', () => gsap.to(link, { opacity: 1, duration: 0.25 }));
      link.addEventListener('pointerleave', () => gsap.to(link, { opacity: 0.68, duration: 0.25 }));
    });
  }

  return { setMenu };
}
