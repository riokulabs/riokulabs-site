import { describe, expect, it } from 'vitest';
import { lastmodByPath, unlistedPaths } from '../../src/lib/sitemap.mjs';
import { LOGO_PATH } from '../../src/config/brand';
import identity from '../../src/config/identity.json';

const site = {
  games: [{ slug: 'g', visibility: 'public' }, { slug: 'h', visibility: 'unlisted' }],
  posts: [
    { slug: 'edited', visibility: 'public', date: '2026-10-10', updatedAt: '2026-10-12T08:00:00.000Z' },
    { slug: 'backdated-edit', visibility: 'public', date: '2026-10-20', updatedAt: '2026-10-19T12:00:00.000Z' },
    { slug: 'hidden', visibility: 'unlisted', date: '2026-10-11', updatedAt: '2026-10-11T00:00:00.000Z' },
  ],
  mods: [
    { slug: 'm', game: 'g', visibility: 'public', updatedAt: '2026-10-01T00:00:00.000Z', releases: [{ releasedAt: '2026-10-05T00:00:00.000Z', visibility: 'public' }, { releasedAt: '2026-10-09T00:00:00.000Z', visibility: 'unlisted' }] },
    { slug: 'n', game: 'g', visibility: 'public', updatedAt: '2026-10-07T00:00:00.000Z', releases: [] },
    { slug: 'u', game: 'g', visibility: 'unlisted', updatedAt: '2026-10-08T00:00:00.000Z', releases: [] },
  ],
};

describe('sitemap data (src/lib/sitemap.mjs)', () => {
  it('posts: the later of the last edit and the post date', () => {
    const m = lastmodByPath(site);
    expect(m.get('/blog/edited')).toBe('2026-10-12T08:00:00.000Z');
    expect(m.get('/blog/backdated-edit')).toBe('2026-10-20T00:00:00.000Z');
  });
  it('mods: the later of the last edit and the newest public release, shared with the history page', () => {
    const m = lastmodByPath(site);
    expect(m.get('/games/g/mods/m')).toBe('2026-10-05T00:00:00.000Z');
    expect(m.get('/games/g/mods/m/history')).toBe('2026-10-05T00:00:00.000Z');
    expect(m.get('/games/g/mods/n')).toBe('2026-10-07T00:00:00.000Z');
  });
  it('never dates unlisted entries, and lists them as unlisted', () => {
    const m = lastmodByPath(site);
    expect(m.has('/blog/hidden')).toBe(false);
    expect(m.has('/games/g/mods/u')).toBe(false);
    expect([...unlistedPaths(site)].sort()).toEqual(['/blog/hidden', '/games/g/mods/u', '/games/g/mods/u/history', '/games/h']);
  });
});

describe('identity: Organization logo fallback', () => {
  it('has a PNG logo path, and no profile list (profiles are CMS social links)', () => {
    expect(LOGO_PATH).toMatch(/^\/[\w-]+\.png$/);
    expect(identity).not.toHaveProperty('profiles');
  });
});
