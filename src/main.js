import { site } from './config/site.js';
import { onReady, $ } from './utils/dom.js';
import { detectQuality } from './utils/quality.js';
import { isWebGLAvailable } from './utils/webgl.js';
import { Preloader } from './sections/preloader.js';
import { initScroll } from './sections/scroll.js';
import { initTextAnimations } from './sections/text.js';
import { initCounters } from './sections/counters.js';
import { initNav } from './sections/nav.js';
import { initGallery } from './sections/gallery.js';
import { initVideoModal } from './sections/videoModal.js';
import { initCursor, initMagnetic } from './sections/cursor.js';

onReady(async () => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) document.body.classList.add('reduced-motion');
  const preloader = new Preloader();
  preloader.setProgress(10);

  const quality = detectQuality(site.quality);
  document.documentElement.dataset.quality = quality.label;

  const hasWebGL = !reducedMotion && isWebGLAvailable();
  if (!hasWebGL) document.body.classList.add('no-webgl');

  let experience = null;
  let experiencePromise = null;
  let mode = '2d';

  const scroll = initScroll({
    reducedMotion,
    onProgress: (progress) => {
      window.__d74Experience?.setProgress(progress);
    },
  });
  window.__d74Lenis = scroll.lenis;

  const initExperience = () => {
    if (!hasWebGL) return Promise.resolve(null);
    if (experience) return Promise.resolve(experience);
    if (experiencePromise) return experiencePromise;

    experiencePromise = (async () => {
      try {
        const { Experience } = await import('./scene/Experience.js');
        const canvas = $('#scene');
        if (!canvas) throw new Error('Scene canvas missing');
        experience = new Experience(canvas, site, quality);
        experience.init();
        window.__d74Experience = experience;
        scroll.update();
        document.body.classList.add('scene-ready');
        return experience;
      } catch (error) {
        console.error('[D74] WebGL scene failed to start.', error);
        document.body.classList.add('no-webgl');
        experience?.dispose();
        experience = null;
        return null;
      }
    })();

    return experiencePromise;
  };

  const text = initTextAnimations(reducedMotion);
  initCounters(reducedMotion);
  initNav(scroll);

  const videoModal = initVideoModal();
  initGallery({ onOpen: videoModal.open, reducedMotion });
  initCursor(reducedMotion);
  initMagnetic(reducedMotion);

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  const modeButtons = document.querySelectorAll('[data-mode]');
  const applyMode = (next) => {
    mode = next === '2d' ? '2d' : '3d';
    document.body.classList.toggle('mode-2d', mode === '2d');
    document.body.classList.toggle('mode-3d', mode === '3d');
    modeButtons.forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    if (mode === '2d') {
      experience?.stop();
    } else {
      initExperience().then((scene) => {
        if (mode === '3d' && scene) {
          scene.resize();
          scene.start();
        }
      });
    }
  };

  modeButtons.forEach((button) => {
    button.addEventListener('click', () => applyMode(button.dataset.mode));
  });

  // 2D is always the initial background. The 3D scene is opt-in for the
  // current visit; reloading returns to the plain dark 2D background.
  applyMode('2d');

  preloader.setProgress(32);
  await preloader.wait();
  preloader.finish();
  text.playHero();

  window.addEventListener('pagehide', () => {
    experience?.dispose();
  }, { once: true });
});
