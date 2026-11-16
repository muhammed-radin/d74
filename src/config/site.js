/* ------------------------------------------------------------------
   D74 Edits — landing content & experience config
   Edit copy, navigation, video cards and quality tiers here.
------------------------------------------------------------------ */

export const site = {
  name: 'D74 Edits',
  tagline: 'Football, free',
  description:
    'Free football clips, match highlights, skills, goals and live TV. No subscription, no watermark, no noise.',

  nav: [
    { label: 'Explore', href: 'explore/', key: 'explore' },
    { label: 'Live TV', href: 'livestreams/', key: 'live' },
    { label: 'Search', href: 'search/', key: 'search' },
    { label: 'Settings', href: 'settings/', key: 'settings' },
  ],

  hero: {
    eyebrow: 'Free clips · Live TV · Zero watermark',
    titleLead: 'Every football moment.',
    titleAccent: 'Free. In your feed.',
    sub: 'Match highlights, elite skills, goals and tactical breakdowns — cut for the replay and ready when you are. No subscription. No watermark. No noise.',
    primaryCta: { label: 'Explore clips', href: 'explore/' },
    secondaryCta: { label: 'Watch live', href: 'livestreams/' },
    stats: [
      { value: 168, suffix: '+', label: 'Live channels' },
      { value: 8000, suffix: '+', label: 'Free clips' },
      { value: 0, suffix: '', label: 'Subscription fees' },
    ],
  },

  kickoff: {
    kicker: '01 / Kick-off',
    title: 'The lights are on. The pitch is yours.',
    copy: 'From the tunnel to the top corner. Scroll to take the shot.',
    mark: 'KICK OFF',
  },

  pitch: {
    kicker: '02 / The pitch',
    title: 'Every angle. Every goal. Every touch.',
    copy: 'Highlights cut for the replay. Skills slowed to a crawl. Tactics broken down frame by frame. This is football the way you actually watch it.',
    tags: ['Goals', 'Skills', 'Tactics', 'Fan edits'],
    scoreboard: {
      home: 'D74',
      away: 'FANS',
      minute: "90'",
      status: 'LIVE',
    },
  },

  showcase: {
    kicker: '03 / The feed',
    title: 'Pick your replay.',
    copy: 'Fresh clips, hand-picked. Tap a card to watch. Swipe on mobile.',
    hint: 'Scroll to rotate · Tap to watch',
  },

  stats: {
    kicker: '04 / By the numbers',
    title: 'Built for the 90th minute.',
    copy: 'A feed that keeps up with the group chat. New drops, live channels and the moments everyone is talking about.',
    items: [
      { value: 8000, suffix: '+', label: 'Clips in the feed', detail: 'Highlights, skills, goals and fan edits.' },
      { value: 168, suffix: '+', label: 'Live channels', detail: 'Football from around the world, in one place.' },
      { value: 24, suffix: '/7', label: 'Always on', detail: 'The feed does not stop for full-time.' },
      { value: 0, suffix: '', label: 'Watermarks', detail: 'Clean clips. Your screen, your rules.' },
    ],
  },

  final: {
    kicker: '05 / Your move',
    titleLead: 'The game doesn’t wait.',
    titleAccent: 'Neither should you.',
    copy: 'Open the feed. Find the clip. Send it to the group chat. Watching needs no account — sign up only when you want downloads and saved clips.',
    primaryCta: { label: 'Explore clips', href: 'explore/' },
    secondaryCta: { label: 'Create a free account', href: 'signup/' },
  },

  footer: {
    note: 'Clips belong to their respective owners. Built for the love of the game.',
    links: [
      { label: 'Explore', href: 'explore/' },
      { label: 'Live TV', href: 'livestreams/' },
      { label: 'Search', href: 'search/' },
      { label: 'Log in', href: 'login/' },
    ],
  },

  /* Free-licensed stock clips from Mixkit. Replace `poster`, `sources`
     and `href` with your own clips whenever you are ready. */
  videos: [
    {
      id: 'overhead-out-of-reach',
      title: 'Overhead. Out of reach.',
      category: 'Goals',
      meta: '0:13 · 2.4M views',
      description: 'A chest-down, overhead finish on the street court. No angle, no chance.',
      poster: 'https://assets.mixkit.co/videos/2916/2916-thumb-720-0.jpg',
      sources: [
        { src: 'https://assets.mixkit.co/videos/2916/2916-720.mp4', type: 'video/mp4' },
        { src: 'https://assets.mixkit.co/videos/2916/2916-360.mp4', type: 'video/mp4' },
      ],
      accent: '#d7ff3f',
    },
    {
      id: 'top-corner-only',
      title: 'Top corner. Only.',
      category: 'Skills',
      meta: '0:05 · 1.8M views',
      description: 'Chest control, half-turn, finish. The kind of clip that gets replayed in slow motion.',
      poster: 'https://assets.mixkit.co/videos/43497/43497-thumb-720-0.jpg',
      sources: [
        { src: 'https://assets.mixkit.co/videos/43497/43497-720.mp4', type: 'video/mp4' },
        { src: 'https://assets.mixkit.co/videos/43497/43497-360.mp4', type: 'video/mp4' },
      ],
      accent: '#78e6ff',
    },
    {
      id: 'touch-before-thunder',
      title: 'The touch before the thunder.',
      category: 'Skills',
      meta: '0:12 · 960K views',
      description: 'Slow it down. Watch the first touch, the weight of the pass, the strike.',
      poster: 'https://assets.mixkit.co/videos/736/736-thumb-720-0.jpg',
      sources: [
        { src: 'https://assets.mixkit.co/videos/736/736-720.mp4', type: 'video/mp4' },
        { src: 'https://assets.mixkit.co/videos/736/736-360.mp4', type: 'video/mp4' },
      ],
      accent: '#a78bfa',
    },
    {
      id: 'street-rules',
      title: 'Street rules. No whistle.',
      category: 'Fan edits',
      meta: '0:07 · 3.1M views',
      description: 'Two-on-two, concrete pitch, no referee. Just the next goal and the next challenge.',
      poster: 'https://assets.mixkit.co/videos/43522/43522-thumb-720-0.jpg',
      sources: [
        { src: 'https://assets.mixkit.co/videos/43522/43522-720.mp4', type: 'video/mp4' },
        { src: 'https://assets.mixkit.co/videos/43522/43522-360.mp4', type: 'video/mp4' },
      ],
      accent: '#ffcf5c',
    },
    {
      id: 'keep-away-elevated',
      title: 'Keep-away, elevated.',
      category: 'Tutorials',
      meta: '0:17 · 740K views',
      description: 'Two players, one ball, a whole lot of touches. Learn the rhythm, then take it to the pitch.',
      poster: 'https://assets.mixkit.co/videos/43478/43478-thumb-720-0.jpg',
      sources: [
        { src: 'https://assets.mixkit.co/videos/43478/43478-720.mp4', type: 'video/mp4' },
        { src: 'https://assets.mixkit.co/videos/43478/43478-360.mp4', type: 'video/mp4' },
      ],
      accent: '#65e39a',
    },
    {
      id: 'break-the-line',
      title: 'Break the line.',
      category: 'Tactics',
      meta: '0:13 · 1.2M views',
      description: 'One touch forward, one pass through, one finish. The simplest way to beat a low block.',
      poster: 'https://assets.mixkit.co/videos/2921/2921-thumb-720-3.jpg',
      sources: [
        { src: 'https://assets.mixkit.co/videos/2921/2921-720.mp4', type: 'video/mp4' },
        { src: 'https://assets.mixkit.co/videos/2921/2921-360.mp4', type: 'video/mp4' },
      ],
      accent: '#d7ff3f',
    },
  ],

  /* Quality tiers are stepped down automatically by the runtime FPS scaler.
     `particles` and `confetti` are maximum counts, not all rendered at once. */
  quality: {
    low: {
      label: 'low',
      pixelRatio: 1.25,
      antialias: false,
      shadows: false,
      particles: 360,
      confetti: 0,
      postFX: false,
      ballSegments: 48,
      netSegments: [24, 8],
      dustSize: 0.055,
      bloom: 0.4,
    },
    medium: {
      label: 'medium',
      pixelRatio: 1.5,
      antialias: true,
      shadows: true,
      particles: 900,
      confetti: 180,
      postFX: true,
      ballSegments: 72,
      netSegments: [36, 12],
      dustSize: 0.06,
      bloom: 0.68,
    },
    high: {
      label: 'high',
      pixelRatio: 2,
      antialias: true,
      shadows: true,
      particles: 1800,
      confetti: 420,
      postFX: true,
      ballSegments: 96,
      netSegments: [48, 16],
      dustSize: 0.065,
      bloom: 0.92,
    },
  },
};

export const palette = {
  bg: '#050608',
  ink: '#f4f5f6',
  muted: '#8b939d',
  accent: '#d7ff3f',
  accent2: '#78e6ff',
  accent3: '#a78bfa',
  warning: '#ffcf5c',
};