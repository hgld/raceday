// Tiny dev server. Mirrors the Vercel config: clean URLs, trailing slash,
// `/r` -> `/r/index.html`. Node only, no dependencies.
//   node scripts/serve.mjs [port]

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.argv[2] || process.env.PORT || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ics': 'text/calendar; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

async function tryFile(p) {
  try {
    const s = await stat(p);
    if (s.isFile()) return p;
  } catch (e) {
    /* not there */
  }
  return null;
}

async function resolvePath(pathname) {
  const clean = decodeURIComponent(pathname.split('?')[0]);
  if (clean.includes('..')) return null;
  const base = join(ROOT, clean);
  return (
    (await tryFile(base)) ||
    (await tryFile(join(base, 'index.html'))) ||
    (await tryFile(base + '.html')) ||
    null
  );
}

createServer(async (req, res) => {
  const file = await resolvePath(new URL(req.url, 'http://x').pathname);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
    return;
  }
  const body = await readFile(file);
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(body);
}).listen(PORT, () => {
  console.log('Race Day dev server on http://localhost:' + PORT);
});
