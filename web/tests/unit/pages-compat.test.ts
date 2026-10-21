import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyPagesCompat, parseRedirects, redirectFile, redirectPage } from '../../scripts/pages-compat';

function tmpSite(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-pages-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}
const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8');
const OPTS = { siteUrl: 'https://rioku.dev', domain: 'rioku.dev' };

describe('GitHub Pages compatibility', () => {
  it('parses _redirects and re-validates every rule', () => {
    expect(parseRedirects('/history /roadmap 301\n\n# c\n/mods/a /games/g/mods/a 301\n')).toEqual([
      { from: '/history', to: '/roadmap', status: 301 },
      { from: '/mods/a', to: '/games/g/mods/a', status: 301 },
    ]);
    expect(() => parseRedirects('/x https://evil.example/ 301')).toThrow();
    expect(() => parseRedirects('/x javascript:alert(1) 301')).toThrow();
  });

  it('maps a redirect source to a file (never the home page)', () => {
    expect(redirectFile('/history')).toBe('history.html');
    expect(redirectFile('/mods/a/history')).toBe('mods/a/history.html');
    expect(redirectFile('/')).toBeNull();
  });

  it('writes a redirect page with meta refresh, canonical, JS replace and noindex', () => {
    const html = redirectPage('/roadmap', 'https://rioku.dev/');
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=/roadmap">');
    expect(html).toContain('<link rel="canonical" href="https://rioku.dev/roadmap">');
    expect(html).toContain('location.replace("/roadmap"+location.search+location.hash)');
    expect(html).toContain('<meta name="robots" content="noindex">');
    // external targets stay absolute; a target with its own query string is not extended
    const ext = redirectPage('https://github.com/riokulabs?tab=repositories', 'https://rioku.dev');
    expect(ext).toContain('href="https://github.com/riokulabs?tab=repositories"');
    expect(ext).toContain('location.replace("https://github.com/riokulabs?tab=repositories")');
  });

  it('emits redirect pages, CNAME, .nojekyll and directory shims', () => {
    const dist = tmpSite({
      'index.html': 'home',
      '404.html': 'lost',
      'mods.html': 'mods index',
      'games/g/mods/a.html': 'mod a',
      'games/g/mods/a/history.html': 'history a',
      _redirects: '/mods/a /games/g/mods/a 301\n/mods/a/history /games/g/mods/a/history 301\n/history /roadmap 301\n/history /elsewhere 301\n',
    });
    const r = applyPagesCompat(dist, OPTS);
    expect(r.redirects.sort()).toEqual(['history.html', 'mods/a.html', 'mods/a/history.html']);
    expect(r.skipped).toEqual(['/history']); // first match wins, like _redirects
    expect(read(dist, 'history.html')).toContain('url=/roadmap');
    expect(read(dist, 'mods/a/history.html')).toContain('url=/games/g/mods/a/history');
    expect(read(dist, 'CNAME')).toBe('rioku.dev\n');
    expect(fs.existsSync(path.join(dist, '.nojekyll'))).toBe(true);
    // X.html next to a directory X/ gets X/index.html
    expect(r.shims.sort()).toEqual(['games/g/mods/a/index.html', 'mods/a/index.html', 'mods/index.html']);
    expect(read(dist, 'games/g/mods/a/index.html')).toBe('mod a');
    expect(read(dist, 'mods/a/index.html')).toContain('url=/games/g/mods/a"');
    // untouched
    expect(read(dist, 'index.html')).toBe('home');
    expect(read(dist, '404.html')).toBe('lost');
  });

  it('works without a _redirects file', () => {
    const dist = tmpSite({ 'index.html': 'home', '404.html': 'lost' });
    expect(applyPagesCompat(dist, OPTS).redirects).toEqual([]);
    expect(read(dist, 'CNAME')).toBe('rioku.dev\n');
  });
});

describe('redirect safety', () => {
  const mk = (rules: string, files: Record<string, string> = {}) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-'));
    fs.writeFileSync(path.join(dir, '_redirects'), rules);
    for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); }
    return dir;
  };
  const opts = { siteUrl: 'https://rioku.dev', domain: 'rioku.dev' };
  it('refuses to replace a page the build made', () => {
    expect(() => applyPagesCompat(mk('/about /roadmap 301\n', { 'about.html': 'real' }), opts)).toThrow(/would replace the page/);
  });
  it('refuses the 404 page and index pages', () => {
    expect(() => applyPagesCompat(mk('/404 / 301\n'), opts)).toThrow(/reserved/);
    expect(() => applyPagesCompat(mk('/blog/index / 301\n'), opts)).toThrow(/reserved/);
  });
  it('refuses to write outside dist', () => {
    expect(() => applyPagesCompat(mk('/../escape / 301\n'), opts)).toThrow(/must match|outside dist/);
  });
});
