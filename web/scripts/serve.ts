/**
 * Tiny static server for dist/ that behaves like Cloudflare Workers static assets closely enough for Lighthouse and
 * Playwright: clean URLs (/mods → mods.html), 404.html, brotli/gzip for text, immutable cache for /_astro/*,
 * byte ranges for video. Local only (binds 127.0.0.1).   npx tsx scripts/serve.ts [port]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve('dist');
const PORT = Number(process.argv[2] ?? 4322);
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.xml': 'application/xml',
  '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.xsl': 'text/xsl',
};
const TEXT = /\.(html|css|js|json|xml|txt|svg)$/;

/** dist/_redirects, like Workers static assets: exact `from to status` lines, evaluated before assets. */
const REDIRECTS = new Map<string, { to: string; status: number }>();
try {
  for (const line of fs.readFileSync(path.join(ROOT, '_redirects'), 'utf8').split('\n')) {
    const [from, to, status] = line.trim().split(/\s+/);
    if (from && to && !REDIRECTS.has(from)) REDIRECTS.set(from, { to, status: Number(status ?? 302) });
  }
} catch { /* no redirects */ }

function resolve(urlPath: string): string | null {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const candidates = clean === '/' ? ['index.html'] : [clean, `${clean}.html`, path.join(clean, 'index.html')];
  for (const c of candidates) {
    const f = path.resolve(ROOT, '.' + (c.startsWith('/') ? c : '/' + c));
    if (!f.startsWith(ROOT + path.sep) && f !== ROOT) return null;
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
}

http.createServer((req, res) => {
  const [pathname, query] = (req.url ?? '/').split('?');
  const redirect = REDIRECTS.get(pathname.replace(/\/$/, '') || '/');
  if (redirect) {
    res.writeHead(redirect.status, { Location: redirect.to + (query ? `?${query}` : ''), 'Cache-Control': 'public, max-age=0' });
    res.end();
    return;
  }
  let file = resolve(req.url ?? '/');
  let status = 200;
  if (!file) { file = path.join(ROOT, '404.html'); status = 404; }
  const ext = path.extname(file);
  const headers: Record<string, string> = { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' };
  headers['Cache-Control'] = req.url?.startsWith('/_astro/') ? 'public, max-age=31536000, immutable' : ext === '.html' ? 'public, max-age=0, must-revalidate' : 'public, max-age=604800';
  const stat = fs.statSync(file);
  const range = req.headers.range;
  if (range && /\.(mp4|webm)$/.test(file)) {
    const [s, e] = range.replace('bytes=', '').split('-');
    const start = Number(s); const end = e ? Number(e) : stat.size - 1;
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  const enc = String(req.headers['accept-encoding'] ?? '');
  if (TEXT.test(file) && /\bbr\b/.test(enc)) {
    res.writeHead(status, { ...headers, 'Content-Encoding': 'br', Vary: 'Accept-Encoding' });
    fs.createReadStream(file).pipe(zlib.createBrotliCompress()).pipe(res);
  } else if (TEXT.test(file) && /\bgzip\b/.test(enc)) {
    res.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
    fs.createReadStream(file).pipe(zlib.createGzip()).pipe(res);
  } else {
    res.writeHead(status, { ...headers, 'Content-Length': String(stat.size), 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  }
}).listen(PORT, '127.0.0.1', () => console.log(`serving dist on http://127.0.0.1:${PORT}`));
