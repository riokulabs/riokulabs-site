import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { assertPublicOnly, filterVisible, normalise } from '../../src/lib/load';
import { loadPrivacyLists, PrivacyAssertionError } from '../../src/lib/privacy';

const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../fixtures/content.json'), 'utf8'));
const lists = loadPrivacyLists();
const json = (v: unknown) => JSON.stringify(v);

describe('visibility filter on the fixtures', () => {
  const f = filterVisible(raw);
  it('drops the private canaries everywhere', () => {
    const text = json(f);
    expect(text).not.toMatch(/zz[ _-]?private[ _-]?canary/i);
    expect(f.mods.map((m: any) => m.slug)).not.toContain('zz-private-canary');
    expect(f.blogPosts.map((p: any) => p.slug)).not.toContain('zz-private-canary-post');
    expect(f.timelineFamilies.map((x: any) => x.familyId)).not.toContain('zz-private-canary-family');
    expect(f.milestones.map((m: any) => m.label)).not.toContain('ZZ private canary milestone');
  });
  it('keeps public and unlisted entries', () => {
    expect(f.mods.map((m: any) => m.slug)).toEqual(expect.arrayContaining(['data-center', 'fixture-test-bench']));
    expect(f.blogPosts.map((p: any) => p.slug)).toContain('section-test-bench');
  });
  it('strips relations and sections that point at private entries', () => {
    const bench = f.blogPosts.find((p: any) => p.slug === 'section-test-bench');
    expect(bench.relatedMods.map((m: any) => m.slug)).toEqual(['data-center']);
    expect(bench.body.filter((s: any) => s.__component === 'sections.mod-card')).toHaveLength(1);
    expect(bench.body.filter((s: any) => s.__component === 'sections.timeline-embed')).toHaveLength(1);
  });
  it('drops releases whose mod is hidden', () => {
    expect(f.modReleases.every((r: any) => r.mod)).toBe(true);
    expect(f.modReleases).toHaveLength(2);
  });
  it('passes the build assertion', () => {
    expect(() => assertPublicOnly(f, lists)).not.toThrow();
  });
});

describe('build assertion', () => {
  it('fails on an unfiltered snapshot (private entries present), naming the documentId', () => {
    try {
      assertPublicOnly(raw, lists);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PrivacyAssertionError);
      expect((e as Error).message).toMatch(/visibility private/);
    }
  });
  it('fails when a public entry carries a deny-pattern term', () => {
    const f = filterVisible(raw);
    f.mods[0].tagline = 'Now with a zz private canary launcher';
    expect(() => assertPublicOnly(f, lists)).toThrow(/PRIVACY (mods#|@[0-9a-f]{8})/);
  });
  it('fails on an IP term in product text (mods, site settings)', () => {
    const f = filterVisible(raw);
    f.mods[0].tagline = 'Inspired by the zz-ip-canary';
    expect(() => assertPublicOnly(f, lists)).toThrow(/IP (mods#|@[0-9a-f]{8})/);
    const g = filterVisible(raw);
    g.siteSettings.description = 'Mods like the zz-ip-canary';
    expect(() => assertPublicOnly(g, lists)).toThrow(/IP (siteSettings|@[0-9a-f]{8})/);
  });
  it('allows an IP term anywhere in a blog post (nominative reference), but not a deny-pattern term', () => {
    const f = filterVisible(raw);
    const post = f.blogPosts[0];
    post.title = 'The zz-ip-canary drive that inspired this mod';
    post.excerpt = 'Why the zzipc drive scene stuck with us';
    post.seo = { ...(post.seo ?? {}), metaTitle: 'zz ip canary', metaDescription: 'about zzipc' };
    post.body = [...(post.body ?? []), { __component: 'sections.quote', text: 'like the zz-ip-canary' }];
    expect(() => assertPublicOnly(f, lists)).not.toThrow();
    post.excerpt = 'and the zz private canary';
    expect(() => assertPublicOnly(f, lists)).toThrow(/PRIVACY (blogPosts#|@[0-9a-f]{8})/);
  });
  it('fails when a private relation slips into a public entry', () => {
    const f = filterVisible(raw);
    f.blogPosts[0].relatedMods.push({ id: 1, documentId: 'x', slug: 'hidden', visibility: 'private' });
    expect(() => assertPublicOnly(f, lists)).toThrow(/non-public entry x/);
  });
});

describe('normalise', () => {
  const { site, media } = normalise(filterVisible(raw), 'fixtures');
  it('builds the Data Center with 16 stills and 6 loops', () => {
    const dc = site.mods.find((m) => m.slug === 'data-center')!;
    expect(dc.gallery.filter((g) => g.kind === 'image')).toHaveLength(16);
    expect(dc.gallery.filter((g) => g.kind === 'loop')).toHaveLength(6);
    expect(dc.families).toHaveLength(6);
  });
  it('collects only media from visible content', () => {
    expect(media.length).toBeGreaterThan(100);
    expect(media.every((m) => !/zz[ _-]?private[ _-]?canary/i.test(m.key))).toBe(true);
  });
  it('computes reading time', () => {
    expect(site.posts.every((p) => p.readingMinutes >= 1)).toBe(true);
  });
});

describe('games (2026-10-20 structure)', () => {
  const f = filterVisible(raw);
  const { site } = normalise(f, 'fixtures');
  it('keeps the public game and drops the private canary game', () => {
    expect(site.games.map((g) => g.slug)).toEqual(['space-engineers-2']);
    expect(site.games[0].shortName).toBe('SE2');
    expect(site.games[0].legalNotice).toMatch(/Keen Software House/);
  });
  it('drops a PUBLIC mod whose game is private, and strips relations to it', () => {
    expect(raw.mods.find((m: any) => m.slug === 'orphan-canary-mod').visibility).toBe('public');
    expect(f.mods.map((m: any) => m.slug)).not.toContain('orphan-canary-mod');
    expect(JSON.stringify(f)).not.toMatch(/orphan-canary|canary-private-game/);
  });
  it('drops a mod with no game at all (fail safe)', () => {
    const r = structuredClone(raw);
    r.mods.find((m: any) => m.slug === 'data-center').game = null;
    expect(filterVisible(r).mods.map((m: any) => m.slug)).not.toContain('data-center');
  });
  it('gives every built mod its game, and posts the games of their related mods', () => {
    expect(site.mods.every((m) => m.game === 'space-engineers-2')).toBe(true);
    expect(site.posts.every((p) => p.games.includes('space-engineers-2'))).toBe(true);
    expect(site.posts.flatMap((p) => p.games)).not.toContain('canary-private-game');
  });
  it('takes the display name from the identity config, not the CMS', () => {
    const r = structuredClone(raw);
    r.siteSettings.siteName = 'Something else';
    expect(normalise(filterVisible(r), 'fixtures').site.settings.siteName).toBe('Rioku Labs');
  });
  it('fails the build assertion on a leftover of a retired studio name', () => {
    const g = filterVisible(raw);
    g.blogPosts[0].excerpt = 'News from ZZ Retired Brand';
    expect(() => assertPublicOnly(g, lists)).toThrow(/BRAND (blogPosts#|@[0-9a-f]{8})/);
    const h = filterVisible(raw);
    h.mods[0].tagline = 'A ZZRB mod';
    expect(() => assertPublicOnly(h, lists)).toThrow(/BRAND (mods#|@[0-9a-f]{8})/);
  });
  it('still allows a near miss of a retired term', () => {
    const g = filterVisible(raw);
    g.blogPosts[0].excerpt = 'The zzrbx block series';
    expect(() => assertPublicOnly(g, lists)).not.toThrow();
  });
});
