#!/usr/bin/env node
/**
 * Serves ./public the way GitHub Pages serves it: plain files, no /api.
 * Useful to check the static fallback (prices, validation, ticket) locally.
 *
 *   npm run preview   →  http://127.0.0.1:4173
 */
import { createReadStream, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', 'public');
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

http
  .createServer((req, res) => {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.join(ROOT, pathname);

    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    try {
      const info = statSync(file);
      if (info.isDirectory()) throw Object.assign(new Error('dir'), { code: 'ENOENT' });
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': info.size
      });
      createReadStream(file).pipe(res);
    } catch {
      try {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        createReadStream(path.join(ROOT, '404.html')).pipe(res);
      } catch {
        res.writeHead(404).end('404');
      }
    }
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`\n  Static preview (same files GitHub Pages serves)`);
    console.log(`  → http://127.0.0.1:${PORT}\n`);
  });
