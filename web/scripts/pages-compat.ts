/**
 * Post-build step for GitHub Pages (the production host since 2026-10-20). Pages serves files only: it
 * ignores the Cloudflare control files `_redirects` and `_headers`, so this step makes the static output work there:
 *
 * 1. every rule in dist/_redirects (CMS Redirect entries, legacy /mods/<slug> URLs, /history → /roadmap) becomes a
 *    small HTML page at `<from>.html` (meta refresh + canonical + JS `location.replace`, noindex);
 * 2. `CNAME` with the identity domain and an empty `.nojekyll`;
 * 3. directory-collision shim: where `X.html` and a directory `X/` both exist (e.g. a mod page and its /history
 *    page), Pages may answer `/X` with a 301 to `/X/` instead of serving `X.html`, so `X/index.html` gets a copy
 *    (its canonical link still names `/X`).
 *
 * `_redirects` and `_headers` stay in dist (harmless on Pages, still used if the site is ever served by Cloudflare).
 * Runs before lint-dist in `postbuild`, so the generated pages are privacy-linted too.
 *   npm run pages:compat [-- <dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import identity from '../src/config/identity.json';
import { assertSafeRedirect } from '../src/lib/safety';

export interface Rule { from: string; to: string; status: number }

/** Parse a Cloudflare-style `_redirects` file (`from to status` per line; `#` comments). Every rule is re-validated. */
export function parseRedirects(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [from, to, status = '301'] = line.split(/\s+/);
    const v = assertSafeRedirect({ from, to });
    rules.push({ from: v.from, to: v.to, status: Number(status) });
  }
  return rules;
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The HTML page that stands in for one redirect rule. `siteUrl` makes site-relative targets absolute for canonical. */
export function redirectPage(to: string, siteUrl: string): string {
  const abs = to.startsWith('/') ? siteUrl.replace(/\/$/, '') + to : to;
  // Keep the visitor's query string and fragment when the target has none of its own (as Cloudflare does).
  const keep = !/[?#]/.test(to);
  const js = `location.replace(${JSON.stringify(to).replace(/</g, '\\u003c')}${keep ? '+location.search+location.hash' : ''})`;
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<title>Moved</title>',
    '<meta name="robots" content="noindex">',
    `<link rel="canonical" href="${escAttr(abs)}">`,
    `<meta http-equiv="refresh" content="0; url=${escAttr(to)}">`,
    `<script>${js}</script>`,
    `</head><body><p>This page has moved to <a href="${escAttr(to)}">${escAttr(abs)}</a>.</p></body></html>`,
    '',
  ].join('\n');
}

/** dist-relative file for a redirect source (`/history` → `history.html`); null for the site root. */
export function redirectFile(from: string): string | null {
  const p = from.replace(/\/+$/, '');
  return p ? `${p.slice(1)}.html` : null;
}

/** Files a redirect may never write: the error page, any index page, the Pages control files. */
const RESERVED = /(^|\/)(404|index)\.html$|^(CNAME|\.nojekyll)$/i;

export interface CompatResult { redirects: string[]; skipped: string[]; shims: string[] }

export function applyPagesCompat(dist: string, opts: { siteUrl: string; domain: string }): CompatResult {
  const out: CompatResult = { redirects: [], skipped: [], shims: [] };
  const redirectsFile = path.join(dist, '_redirects');
  const rules = fs.existsSync(redirectsFile) ? parseRedirects(fs.readFileSync(redirectsFile, 'utf8')) : [];
  const seen = new Set<string>();
  for (const r of rules) {
    const rel = redirectFile(r.from);
    // First match wins in _redirects; never replace the home page with a redirect.
    if (!rel || seen.has(rel)) {
      out.skipped.push(r.from);
      continue;
    }
    seen.add(rel);
    const file = path.resolve(dist, rel);
    // Redirect rules (some come from CMS Redirect entries) may only add new pages: never write outside dist/, never
    // touch reserved files, never replace a page the build made. A rule that would is a content mistake: fail loudly.
    if (!file.startsWith(path.resolve(dist) + path.sep)) throw new Error(`redirect ${r.from} would write outside dist/`);
    if (RESERVED.test(rel)) throw new Error(`redirect ${r.from} would replace the reserved file ${rel}`);
    if (fs.existsSync(file)) throw new Error(`redirect ${r.from} would replace the page ${rel}; remove the rule or the page`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, redirectPage(r.to, opts.siteUrl));
    out.redirects.push(rel);
  }

  fs.writeFileSync(path.join(dist, 'CNAME'), opts.domain + '\n');
  fs.writeFileSync(path.join(dist, '.nojekyll'), '');

  const htmlFiles = fs.readdirSync(dist, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.html'))
    .map((d) => path.relative(dist, path.join(d.parentPath, d.name)));
  for (const rel of htmlFiles) {
    if (path.basename(rel) === 'index.html') continue;
    const dir = path.join(dist, rel.slice(0, -'.html'.length));
    const index = path.join(dir, 'index.html');
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory() && !fs.existsSync(index)) {
      fs.copyFileSync(path.join(dist, rel), index);
      out.shims.push(path.relative(dist, index));
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = path.resolve(process.argv[2] ?? 'dist');
  if (!fs.existsSync(path.join(dist, '404.html'))) {
    console.error(`pages-compat: ${dist}/404.html missing (GitHub Pages serves it for unknown paths); build first`);
    process.exit(1);
  }
  const siteUrl = process.env.SITE_URL || `https://${identity.domain}`;
  try {
    const r = applyPagesCompat(dist, { siteUrl, domain: identity.domain });
    console.log(`pages-compat: OK (${r.redirects.length} redirect pages, ${r.shims.length} directory shims, CNAME ${identity.domain}, .nojekyll` +
      `${r.skipped.length ? `; skipped ${r.skipped.join(', ')}` : ''})`);
  } catch (e) {
    console.error(`pages-compat: ${(e as Error).message}`);
    process.exit(1);
  }
}
