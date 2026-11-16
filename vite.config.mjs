import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));

/* Vite serves CSS imports through JavaScript in dev. That is fine after
   hydration, but it lets the first paint flash unstyled HTML. Inlining the
   landing stylesheet into the document head removes the FOUC and the extra
   render-blocking request in both dev and production. */
const inlineLandingCss = {
  name: 'inline-landing-css',
  transformIndexHtml: {
    order: 'pre',
    handler(html) {
      const css = fs.readFileSync(path.join(root, 'src/styles/main.css'), 'utf8');
      return html.replace('</head>', `<style data-landing-css>${css}</style></head>`);
    },
  },
  handleHotUpdate({ file, server }) {
    if (file.endsWith('src/styles/main.css')) {
      server.ws.send({ type: 'full-reload' });
    }
  },
};

export default defineConfig({
  base: './',
  plugins: [inlineLandingCss],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    cssMinify: true,
  },
  optimizeDeps: {
    include: ['three', 'gsap', 'lenis'],
  },
});
