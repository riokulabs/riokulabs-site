/**
 * After `astro build` in preview mode: remove the prerendered feeds and OG cards from the Worker's static assets.
 * (They had to be prerendered: they need Node at build. Static assets are served before the Worker runs, so the
 * middleware's 404 for them would never fire.) The preview host serves pages only.
 */
import fs from 'node:fs';
import path from 'node:path';

const client = path.resolve('dist-preview', 'client');
const gone: string[] = [];
for (const rel of ['rss.xml', 'mods/releases.xml', 'og', 'site.webmanifest', '_redirects']) {
  const p = path.join(client, rel);
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
    gone.push(rel);
  }
}
for (const f of fs.readdirSync(client)) if (/^sitemap/.test(f)) { fs.rmSync(path.join(client, f)); gone.push(f); }
console.log(`preview-strip: removed ${gone.join(', ') || 'nothing'}`);
