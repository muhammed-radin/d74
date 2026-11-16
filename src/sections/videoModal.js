export function initVideoModal() {
  const dialog = document.getElementById('videoModal');
  const player = document.getElementById('videoModalPlayer');
  const closeButton = document.getElementById('videoModalClose');
  const title = document.getElementById('videoModalTitle');
  const kicker = document.getElementById('videoModalKicker');
  const description = document.getElementById('videoModalDescription');
  let lastFocus = null;

  if (!dialog || !player) {
    return { open() {}, close() {} };
  }

  const releasePlayer = () => {
    player.pause();
    player.removeAttribute('src');
    player.load();
  };

  const open = (video) => {
    lastFocus = document.activeElement;
    title.textContent = video.title;
    kicker.textContent = `${video.category} · ${video.meta}`;
    description.textContent = video.description;

    const mobile = window.matchMedia('(max-width: 768px)').matches;
    const source = mobile ? video.sources[1] || video.sources[0] : video.sources[0];
    player.poster = video.poster;
    player.src = source.src;
    player.load();

    if (!dialog.open) dialog.showModal();
    document.body.classList.add('modal-open');
    window.__d74Lenis?.stop();
    requestAnimationFrame(() => player.play().catch(() => {}));
  };

  const close = () => {
    if (!dialog.open) return;
    dialog.close();
  };

  closeButton?.addEventListener('click', close);

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  dialog.addEventListener('close', () => {
    releasePlayer();
    document.body.classList.remove('modal-open');
    window.__d74Lenis?.start();
    if (lastFocus instanceof HTMLElement) lastFocus.focus();
  });

  dialog.addEventListener('cancel', () => {
    releasePlayer();
  });

  return { open, close };
}
