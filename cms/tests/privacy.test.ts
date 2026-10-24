import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  checkPublishable,
  compilePatterns,
  findDenyHit,
  IP_EXEMPT_TYPES,
  isIpExemptFolder,
  loadPrivacyConfig,
  loadPrivacyLocal,
  mergePrivacy,
  scanDeep,
  stripNonVisible,
  withVisibilityFilter,
} from '../src/utils/privacy';
import { shouldBypass } from '../src/middlewares/visibility-guard';

const cfg = loadPrivacyConfig(path.resolve(__dirname, '..'));
const deny = compilePatterns(cfg.denyPatterns, 'i');
const ip = compilePatterns(cfg.ipDenyTerms, 'i');
const retired = compilePatterns(cfg.retiredBrandTerms ?? [], 'i');
// The private lists (gitignored config/privacy.local.json) are optional: without them every test below runs on the
// synthetic canaries in config/privacy.json; with them, their testSamples are checked against the merged lists too.
const local = loadPrivacyLocal(path.resolve(__dirname, '..')) as { testSamples?: Record<string, string[]> } | null;

describe('deny patterns', () => {
  it('match the synthetic private canary in any case and spelling', () => {
    for (const t of ['ZZ private canary test', 'zz-private-canary', 'ZZ_PRIVATE_CANARY v2', 'a canary private mod']) {
      expect(findDenyHit({ title: t }, deny), t).not.toBeNull();
    }
  });
  it('leave ordinary mod names alone', () => {
    for (const t of ['Data Center', 'Idea fixture A', 'Cable trays that always line up', 'Canary yellow paint']) {
      expect(findDenyHit({ title: t, slug: t.toLowerCase().replace(/ /g, '-') }, deny), t).toBeNull();
    }
  });
  it('honour word boundaries and lookbehinds (synthetic IP and retired terms)', () => {
    expect(scanDeep({ a: 'about zzipc here' }, ip)).toHaveLength(1);
    expect(scanDeep({ a: 'zzipcx' }, ip)).toHaveLength(0);
    expect(scanDeep({ a: 'by ZZRB.', b: 'ZZRB_Paint', c: 'zz retired brand' }, retired)).toHaveLength(3);
    expect(scanDeep({ a: 'xzzrb', b: 'zzrb2' }, retired)).toHaveLength(0);
  });
});

// Skipped under CI: a failure message would print a private term into the public Actions log.
describe.skipIf(!local || !!process.env.CI)('private lists (only with config/privacy.local.json, not in CI)', () => {
  const s = local?.testSamples ?? {};
  it('add to the public canaries instead of replacing them', () => {
    expect(cfg.denyPatterns.length).toBeGreaterThan(2);
    expect(findDenyHit({ title: 'zz private canary' }, deny)).not.toBeNull();
  });
  it('catch every deny, IP and retired sample, and allow every allowed sample', () => {
    for (const t of s.deny ?? []) expect(findDenyHit({ title: t }, deny), t).not.toBeNull();
    for (const t of s.ip ?? []) expect(findDenyHit({ title: t }, ip), t).not.toBeNull();
    for (const t of s.retired ?? []) expect(scanDeep({ t }, retired).length, t).toBeGreaterThan(0);
    for (const t of s.allowed ?? []) expect(scanDeep({ t }, [...deny, ...ip, ...retired]), t).toEqual([]);
  });
});

describe('config merge', () => {
  it('concatenates arrays without duplicates, merges objects, lets scalars from the private side win', () => {
    const merged = mergePrivacy(
      { denyPatterns: ['a'], public: { x: 1 }, privateDraft: { blogPosts: ['p'] }, version: 1 },
      { denyPatterns: ['a', 'b'], privateDraft: { ideaMods: [{ slug: 'i' }] }, version: 2, neverSeed: ['n/'] },
    );
    expect(merged).toEqual({ denyPatterns: ['a', 'b'], public: { x: 1 }, privateDraft: { blogPosts: ['p'], ideaMods: [{ slug: 'i' }] }, version: 2, neverSeed: ['n/'] });
  });
});

describe('publish guard decision', () => {
  it('rejects a public entry titled "ZZ private canary test"', () => {
    const r = checkPublishable({ title: 'ZZ private canary test', visibility: 'public' }, { hasVisibility: true, deny, ip });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/private project/);
  });
  it('rejects unlisted too (reachable by URL)', () => {
    expect(checkPublishable({ name: 'zz-private-canary', visibility: 'unlisted' }, { hasVisibility: true, deny, ip }).ok).toBe(false);
  });
  it('allows the same entry while it is private', () => {
    expect(checkPublishable({ title: 'ZZ private canary test', visibility: 'private' }, { hasVisibility: true, deny, ip }).ok).toBe(true);
  });
  it('treats single types (no visibility) as always public', () => {
    expect(checkPublishable({ title: 'ZZ private canary showcase' }, { hasVisibility: false, deny, ip }).ok).toBe(false);
  });
  it('rejects IP deny terms in public titles', () => {
    expect(checkPublishable({ title: 'A zz-ip-canary style drive', visibility: 'public' }, { hasVisibility: true, deny, ip }).ok).toBe(false);
  });
  it('passes clean public entries', () => {
    expect(checkPublishable({ name: 'Data Center', slug: 'data-center', visibility: 'public' }, { hasVisibility: true, deny, ip }).ok).toBe(true);
  });
});

describe('IP terms are product rules, not discussion rules', () => {
  const post = 'api::blog-post.blog-post';
  it('exempts blog posts only', () => {
    expect(IP_EXEMPT_TYPES).toEqual([post]);
  });
  it('publishes a blog post that names an IP term', () => {
    const entry = { title: 'The zz-ip-canary drive that inspired us', excerpt: 'A nod to zzipc', slug: 'zz-ip-canary-drive', visibility: 'public' };
    expect(checkPublishable(entry, { uid: post, hasVisibility: true, deny, ip })).toEqual({ ok: true });
  });
  it('refuses the same term on a mod, a block, a release and a single type', () => {
    for (const uid of ['api::mod.mod', 'api::block-3d-model.block-3d-model', 'api::mod-release.mod-release', 'api::timeline-family.timeline-family']) {
      const r = checkPublishable({ name: 'A zz-ip-canary drive', visibility: 'public' }, { uid, hasVisibility: true, deny, ip });
      expect(r.ok, uid).toBe(false);
      expect(r.reason).toMatch(/IP deny list/);
    }
    expect(checkPublishable({ title: 'About zzipc' }, { uid: 'api::home-page.home-page', hasVisibility: false, deny, ip }).ok).toBe(false);
  });
  it('still refuses a deny-pattern term in a blog post', () => {
    const r = checkPublishable({ title: 'News about the zz private canary', visibility: 'public' }, { uid: post, hasVisibility: true, deny, ip });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/private project/);
  });
  it('recognises Blog media folders by their top-level name', () => {
    for (const f of ['Blog', 'blog', 'Blog/Drive post', '/Blog/a/b']) expect(isIpExemptFolder(f), f).toBe(true);
    for (const f of [undefined, '', 'Mods/Blog', 'Blogroll', 'Data Center']) expect(isIpExemptFolder(f), String(f)).toBe(false);
  });
});

describe('visibility filter merge', () => {
  it('adds the guard when there are no filters', () => {
    expect(withVisibilityFilter({}, ['public'])).toEqual({ filters: { visibility: { $in: ['public'] } } });
  });
  it('keeps caller filters under $and', () => {
    const q = withVisibilityFilter({ filters: { slug: { $eq: 'x' } }, populate: '*' }, ['public']);
    expect(q).toEqual({ populate: '*', filters: { $and: [{ slug: { $eq: 'x' } }, { visibility: { $in: ['public'] } }] } });
  });
  it('cannot be widened by a caller asking for private', () => {
    const q = withVisibilityFilter({ filters: { visibility: { $eq: 'private' } } }, ['public']);
    expect(q.filters.$and).toContainEqual({ visibility: { $in: ['public'] } });
  });
});

describe('response strip', () => {
  it('drops private relations from arrays and nulls single relations', () => {
    const body = {
      data: [
        {
          name: 'Data Center', visibility: 'public',
          posts: [{ title: 'ok', visibility: 'public' }, { title: 'secret', visibility: 'private' }],
          featured: { title: 'hidden', visibility: 'private' },
          stats: [{ value: '42U', label: 'rack' }],
        },
      ],
    };
    const removed = stripNonVisible(body, ['public']);
    expect(removed).toBe(2);
    expect(body.data[0].posts).toHaveLength(1);
    expect(body.data[0].featured).toBeNull();
    expect(body.data[0].stats).toHaveLength(1);
  });
  it('keeps unlisted when allowed', () => {
    const body = { data: { visibility: 'public', rel: { visibility: 'unlisted' } } };
    expect(stripNonVisible(body, ['public', 'unlisted'])).toBe(0);
  });
});

describe('bypass', () => {
  it('only the preview token bypasses', () => {
    expect(shouldBypass({ strategy: { name: 'api-token' }, credentials: { name: 'site-preview' } })).toBe(true);
    expect(shouldBypass({ strategy: { name: 'content-api-token' }, credentials: { name: 'site-preview' } })).toBe(true);
    expect(shouldBypass({ strategy: { name: 'content-api-token' }, credentials: { name: 'site-build' } })).toBe(false);
    expect(shouldBypass({ strategy: { name: 'users-permissions' }, credentials: { name: 'site-preview' } })).toBe(false);
    expect(shouldBypass({ strategy: { name: 'api-token' }, credentials: { name: 'site-build' } })).toBe(false);
    expect(shouldBypass(undefined)).toBe(false);
  });
});

describe('deep scan', () => {
  it('finds a deny term anywhere in nested content', () => {
    const hits = scanDeep({ body: [{ content: [{ text: 'hello' }, { text: 'about the zz private canary' }] }] }, deny);
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe('$.body[0].content[1].text');
  });
});
