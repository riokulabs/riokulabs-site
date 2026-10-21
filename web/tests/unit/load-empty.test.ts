/**
 * Optional CMS content that is empty or missing: normalise must give the pages safe shapes (no nulls where the
 * types promise arrays, no half-built media), and CMS builds must stop when a core single type is missing.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { assertCoreContent, filterVisible, MissingContentError, normalise } from '../../src/lib/load';

const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../fixtures/content.json'), 'utf8'));
const game = raw.games.find((g: any) => g.slug === 'space-engineers-2');
const ref = (e: any, field = 'slug') => ({ documentId: e.documentId, [field]: e[field], visibility: e.visibility });

function bareMod(extra: Record<string, unknown> = {}) {
  return {
    documentId: 'bare-mod', slug: 'bare-mod', name: 'Bare mod', tagline: 'Nothing but a name.', modStatus: 'wip', visibility: 'public',
    publishedAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z', game: ref(game),
    heroMedia: null, cardImage: null, gallery: null, features: null, stats: null, specs: null, body: null, tags: null, seo: null,
    ...extra,
  };
}
function barePost(extra: Record<string, unknown> = {}) {
  return {
    documentId: 'bare-post', slug: 'bare-post', title: 'Bare post', excerpt: 'No cover, no tags.', spoiler: false, date: '2026-10-20',
    visibility: 'public', publishedAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z',
    cover: null, author: null, category: null, tags: null, relatedMods: null, games: null, body: null, seo: null,
    ...extra,
  };
}
function build(mutate: (r: any) => void) {
  const r = structuredClone(raw);
  mutate(r);
  return normalise(filterVisible(r), 'fixtures');
}

describe('normalise: a mod with no media and no optional lists', () => {
  const { site } = build((r) => r.mods.push(bareMod()));
  const mod = site.mods.find((m) => m.slug === 'bare-mod')!;
  it('keeps the mod, with empty arrays and no media', () => {
    expect(mod).toBeDefined();
    expect(mod.hero).toBeUndefined();
    expect(mod.card).toBeUndefined();
    expect(mod.gallery).toEqual([]);
    expect(mod.features).toEqual([]);
    expect(mod.stats).toEqual([]);
    expect(mod.specs).toEqual([]);
    expect(mod.body).toEqual([]);
    expect(mod.tags).toEqual([]);
    expect(mod.releases).toEqual([]);
    expect(mod.families).toEqual([]);
    expect(mod.seo).toBeUndefined();
  });
  it('drops half-built media instead of passing it on', () => {
    const { site: s } = build((r) => r.mods.push(bareMod({
      heroMedia: { kind: 'video', video: { mp4: { url: 'seed:showcase/x.mp4', mime: 'video/mp4' }, poster: null } },
      gallery: [null, { kind: 'image', image: { alt: 'no file', file: null } }, { kind: 'loop', video: null }],
      features: [{ title: 'Feature without a visual', visual: null }, { title: 'Feature with an empty image', visual: { kind: 'image', image: { file: null } } }],
      body: [{ __component: 'sections.gallery', items: [{ kind: 'image', image: null }] }, { __component: 'sections.image', image: null }],
    })));
    const m = s.mods.find((x) => x.slug === 'bare-mod')!;
    expect(m.hero).toBeUndefined();
    expect(m.gallery).toEqual([]);
    expect(m.features.map((f) => f.visual)).toEqual([undefined, undefined]);
    expect(m.body).toEqual([]); // empty gallery and image sections are dropped
  });
  it('collects no media for it', () => {
    const { media: withBare } = build((r) => r.mods.push(bareMod()));
    const { media: without } = build(() => undefined);
    expect(withBare.map((m) => m.key).sort()).toEqual(without.map((m) => m.key).sort());
  });
});

describe('normalise: a post with no cover, tags or body', () => {
  const { site } = build((r) => r.blogPosts.push(barePost()));
  const post = site.posts.find((p) => p.slug === 'bare-post')!;
  it('keeps the post with safe empty values', () => {
    expect(post.cover).toBeUndefined();
    expect(post.tags).toEqual([]);
    expect(post.relatedMods).toEqual([]);
    expect(post.games).toEqual([]);
    expect(post.body).toEqual([]);
    expect(post.author).toBeUndefined();
    expect(post.category).toBeUndefined();
    expect(post.readingMinutes).toBe(1);
  });
});

describe('normalise: images carry their MIME type (RSS enclosures)', () => {
  it('copies file.mime onto Img, and leaves it unset when the CMS gives none', () => {
    const { site } = build((r) => {
      const p = barePost({ cover: { alt: 'png cover', file: { url: 'seed:showcase/img/datacenter-hall-overhead.jpg', mime: 'image/png', width: 10, height: 10 } } });
      r.blogPosts.push(p, barePost({ documentId: 'bare-post-2', slug: 'bare-post-2', cover: { alt: 'no mime', file: { url: 'seed:showcase/img/datacenter-hall-overhead.jpg' } } }));
    });
    expect(site.posts.find((p) => p.slug === 'bare-post')!.cover!.mime).toBe('image/png');
    expect(site.posts.find((p) => p.slug === 'bare-post-2')!.cover!.mime).toBeUndefined();
  });
});

describe('normalise: missing single types (fixtures and previews)', () => {
  const { site } = build((r) => {
    for (const k of ['siteSettings', 'navigation', 'homePage', 'aboutPage', 'brandPage', 'legalPage']) r[k] = null;
  });
  it('falls back to empty values instead of throwing', () => {
    expect(site.settings.siteName).toBe('Rioku Labs');
    expect(site.settings.description).toBe('');
    expect(site.nav.header).toEqual([]);
    expect(site.nav.footer).toEqual([]);
    expect(site.home.heroTagline).toBe('');
    expect(site.home.heroMedia).toBeUndefined();
    expect(site.home.principles).toEqual([]);
    expect(site.about.title).toBe('About');
    expect(site.about.body).toEqual([]);
    expect(site.legal.body).toEqual([]);
  });
});

describe('core content assertion (CMS builds)', () => {
  it('passes on the fixtures', () => {
    expect(() => assertCoreContent(raw)).not.toThrow();
  });
  it('names every missing or unpublished core single type', () => {
    const r = { ...raw, navigation: null, homePage: undefined };
    expect(() => assertCoreContent(r)).toThrow(MissingContentError);
    expect(() => assertCoreContent(r)).toThrow(/missing or unpublished: navigation, home-page\./);
    expect(() => assertCoreContent({ ...raw, siteSettings: null })).toThrow(/: site-settings\. Publish it/);
  });
  it('does not require the optional pages', () => {
    expect(() => assertCoreContent({ ...raw, aboutPage: null, brandPage: null, legalPage: null })).not.toThrow();
  });
  it('rejects a non-object single (a malformed response)', () => {
    expect(() => assertCoreContent({ ...raw, homePage: [] })).toThrow(/home-page/);
  });
});
