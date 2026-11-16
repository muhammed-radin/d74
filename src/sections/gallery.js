import { site } from '../config/site.js';
import { gsap, ScrollTrigger } from '../utils/gsap.js';
import { clamp } from '../utils/math.js';

function iconPlay() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z" /></svg>';
}

function cardTemplate(video, index) {
  return `
    <span class="gallery-card__media">
      <img src="${video.poster}" alt="" width="720" height="405" loading="${index < 2 ? 'eager' : 'lazy'}" decoding="async" />
      <span class="gallery-card__shade"></span>
      <span class="gallery-card__play">${iconPlay()}</span>
      <span class="gallery-card__tag">${video.category}</span>
      <span class="gallery-card__time">${video.meta}</span>
    </span>
    <span class="gallery-card__body">
      <span class="gallery-card__index">${String(index + 1).padStart(2, '0')}</span>
      <span class="gallery-card__title">${video.title}</span>
      <span class="gallery-card__meta">${video.category} · ${video.meta}</span>
    </span>
  `;
}

export function initGallery({ onOpen, reducedMotion = false }) {
  const track = document.getElementById('galleryTrack');
  const gallery = document.getElementById('gallery');
  if (!track || !gallery) return;

  const cards = site.videos.map((video, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gallery-card';
    button.dataset.videoId = video.id;
    button.style.setProperty('--card-accent', video.accent);
    button.setAttribute('aria-label', `Watch ${video.title}. ${video.category}. ${video.meta}`);
    button.innerHTML = cardTemplate(video, index);
    button.addEventListener('click', () => onOpen(video));
    track.appendChild(button);
    return button;
  });

  const mobileQuery = window.matchMedia('(max-width: 768px)');
  const mobile = () => mobileQuery.matches;
  let target = 0;
  let current = 0;
  let maxShift = 0;

  const measure = () => {
    cards.forEach((card) => {
      card._offset = card.offsetLeft;
    });
    maxShift = Math.max(0, track.scrollWidth - gallery.clientWidth + 24);
  };

  if (!reducedMotion) {
    ScrollTrigger.create({
      trigger: gallery,
      start: 'top bottom',
      end: 'bottom top',
      onUpdate: (self) => {
        target = self.progress;
      },
    });
  }

  const tick = () => {
    if (mobile() || reducedMotion) return;
    current += (target - current) * 0.075;
    const x = -current * maxShift;
    track.style.transform = `translate3d(${x}px, 0, 0)`;

    const center = window.innerWidth / 2;
    for (const card of cards) {
      const offset = card._offset + x + card.offsetWidth / 2 - center;
      const rotate = clamp((-offset / window.innerWidth) * 44, -30, 30);
      const depth = -Math.min(Math.abs(offset) * 0.12, 120);
      const scale = 1 - Math.min(Math.abs(offset) / window.innerWidth, 0.55) * 0.08;
      card.style.transform = `translate3d(0, 0, ${depth}px) rotateY(${rotate}deg) scale(${scale})`;
    }
  };

  measure();
  window.addEventListener('resize', measure, { passive: true });
  if (!reducedMotion) gsap.ticker.add(tick);
  window.addEventListener('load', measure, { once: true });
  window.setTimeout(measure, 600);

  return { cards };
}
