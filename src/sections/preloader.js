import { formatNumber } from '../utils/math.js';

export class Preloader {
  constructor() {
    this.root = document.getElementById('preloader');
    this.bar = document.getElementById('preloaderBar');
    this.percent = document.getElementById('preloaderPct');
    this.target = 0;
    this.current = 0;
    this.done = false;
    this.raf = 0;
    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
  }

  setProgress(value) {
    this.target = Math.max(this.target, Math.min(100, Number(value) || 0));
  }

  tick() {
    if (this.done) return;
    this.current += (this.target - this.current) * 0.11;
    if (Math.abs(this.target - this.current) < 0.2) this.current = this.target;

    if (this.bar) this.bar.style.transform = `scaleX(${this.current / 100})`;
    if (this.percent) this.percent.textContent = `${Math.round(this.current)}%`;
    this.raf = requestAnimationFrame(this.tick);
  }

  async wait() {
    const loaded = new Promise((resolve) => {
      if (document.readyState === 'complete') resolve();
      else window.addEventListener('load', resolve, { once: true });
    });
    const fonts = document.fonts?.ready || Promise.resolve();
    const timeout = new Promise((resolve) => window.setTimeout(resolve, 2600));
    await Promise.race([Promise.all([loaded, fonts]), timeout]);
  }

  finish() {
    this.setProgress(100);
    this.done = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.bar) this.bar.style.transform = 'scaleX(1)';
    if (this.percent) this.percent.textContent = '100%';
    window.setTimeout(() => {
      this.root?.classList.add('is-done');
      this.root?.setAttribute('aria-hidden', 'true');
      document.documentElement.classList.remove('is-loading');
    }, 360);
  }
}

export { formatNumber };
