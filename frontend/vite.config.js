import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GameDuplicator lives at the repo root. Serving it from the SAME origin as the
// console (this Vite server, :3000) is what makes the "Import my GameDuplicator
// games" one-click work: localStorage is per-origin, so games created at
// /gameduplicator/ land in the console's localStorage where the import reads them.
const GAME_DUPLICATOR_ROOT = fileURLToPath(new URL('../GameDuplicator', import.meta.url));

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.map': 'application/json; charset=utf-8',
};

/** Serve the GameDuplicator directory at /gameduplicator/ (same origin as the console). */
function gameDuplicatorMiddleware(req, res, next) {
  const url = (req.url || '').split('?')[0];
  if (!url.startsWith('/gameduplicator')) return next();

  let rel = decodeURIComponent(url.slice('/gameduplicator'.length));
  if (rel === '' || rel === '/') rel = '/index.html';

  const target = path.resolve(GAME_DUPLICATOR_ROOT, `.${rel}`);
  // Block path traversal outside the GameDuplicator root.
  if (target !== GAME_DUPLICATOR_ROOT && !target.startsWith(GAME_DUPLICATOR_ROOT + path.sep)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  res.setHeader('Content-Type', CONTENT_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream');
  fs.createReadStream(target).pipe(res);
  return undefined;
}

function serveGameDuplicator() {
  return {
    name: 'serve-gameduplicator',
    configureServer(server) {
      server.middlewares.use(gameDuplicatorMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(gameDuplicatorMiddleware);
    },
  };
}

// The Workstation UI embeds the built game in an <iframe> as its main view. The
// gateway serves the engine with `frame-ancestors 'self'` + `X-Frame-Options:
// SAMEORIGIN`, which would block the console (:3000) from framing :8080. Proxying
// the engine + its manifest objects through this dev server makes the iframe
// same-origin, so both headers are satisfied with no backend/security change.
// (The classic Console UI opens the game in a new tab and does not need this.)
const ENGINE_PROXY = {
  '/v1/browser-engine': { target: 'http://localhost:8080', changeOrigin: false },
  '/v1/objects': { target: 'http://localhost:8080', changeOrigin: false },
};

export default defineConfig({
  plugins: [react(), serveGameDuplicator()],
  server: { proxy: ENGINE_PROXY },
  preview: { proxy: ENGINE_PROXY },
});
