import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import qs from 'qs';
import { COOKIE_TTL_S, makeCookieValue, previewHeaders, safeEqual, safePreviewPath, usableSecret, verifyCookieValue } from '../../src/lib/preview';
import { fetchStrapi } from '../../src/lib/strapi';

const SECRET = 'a'.repeat(64);

describe('preview secret and cookie', () => {
  it('compares secrets in constant time and correctly', async () => {
    expect(await safeEqual(SECRET, SECRET)).toBe(true);
    expect(await safeEqual(SECRET, SECRET.slice(0, 63) + 'b')).toBe(false);
    expect(await safeEqual('', SECRET)).toBe(false);
  });
  it('requires a long secret', () => {
    expect(usableSecret('short')).toBe(false);
    expect(usableSecret(undefined)).toBe(false);
    expect(usableSecret(SECRET)).toBe(true);
  });
  it('signs and verifies the cookie; it never contains the secret', async () => {
    const now = 1_800_000_000;
    const v = await makeCookieValue(SECRET, now);
    expect(v).not.toContain(SECRET);
    expect(await verifyCookieValue(SECRET, v, now + 10)).toBe(true);
  });
  it('rejects expired, tampered, forged-expiry and other-secret cookies', async () => {
    const now = 1_800_000_000;
    const v = await makeCookieValue(SECRET, now);
    expect(await verifyCookieValue(SECRET, v, now + COOKIE_TTL_S + 1)).toBe(false);
    const [exp, mac] = v.split('.');
    expect(await verifyCookieValue(SECRET, `${Number(exp) + 3600}.${mac}`, now)).toBe(false);
    expect(await verifyCookieValue(SECRET, `${exp}.${'0'.repeat(64)}`, now)).toBe(false);
    expect(await verifyCookieValue('b'.repeat(64), v, now)).toBe(false);
    expect(await verifyCookieValue(SECRET, undefined, now)).toBe(false);
    expect(await verifyCookieValue(SECRET, 'garbage', now)).toBe(false);
  });
  it('allows only plain same-site paths', () => {
    expect(safePreviewPath('/blog/a-post')).toBe('/blog/a-post');
    expect(safePreviewPath('/')).toBe('/');
    for (const bad of ['//evil.com', 'https://evil.com', '/a/../b', '/a?x=1', 'blog', '/A B', '/\\evil', null]) expect(safePreviewPath(bad)).toBeNull();
  });
  it('sets noindex, no-store and a CMS-only frame-ancestors', () => {
    const h = previewHeaders('https://x.strapiapp.com');
    expect(h['X-Robots-Tag']).toMatch(/noindex/);
    expect(h['Cache-Control']).toBe('no-store');
    expect(h['Content-Security-Policy']).toBe('frame-ancestors https://x.strapiapp.com');
    expect(previewHeaders('javascript:alert(1)')['Content-Security-Policy']).toBe("frame-ancestors 'self'");
  });
});

describe('drafts never reach the static build', () => {
  const capture = async (opts: Partial<Parameters<typeof fetchStrapi>[0]>) => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ data: [], meta: { pagination: { page: 1, pageCount: 1 } } }));
    }) as unknown as typeof fetch;
    await fetchStrapi({ url: 'http://cms', token: 'T', fetchImpl: fake, baseDelayMs: 1, ...opts });
    return urls.map((u) => qs.parse(new URL(u).search.slice(1)) as any);
  };
  it('the default (static) client asks only for published, public/unlisted entries', async () => {
    const qsAll = await capture({});
    expect(qsAll.length).toBeGreaterThan(10);
    expect(qsAll.every((q) => q.status === 'published')).toBe(true);
    expect(qsAll.filter((q) => q.pagination).every((q) => JSON.stringify(q.filters.visibility.$in) === '["public","unlisted"]')).toBe(true);
  });
  it('only the explicit preview mode asks for drafts', async () => {
    const qsAll = await capture({ drafts: true });
    expect(qsAll.every((q) => q.status === 'draft')).toBe(true);
  });
  it('the static build script uses the build token and never the preview token or drafts', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../scripts/fetch-content.ts'), 'utf8');
    expect(src).toContain('STRAPI_BUILD_TOKEN');
    expect(src).not.toContain('STRAPI_PREVIEW_TOKEN');
    expect(src).not.toMatch(/drafts\s*:\s*true/);
  });
  it('the static build drops anything unpublished even if the API returned it', async () => {
    const { filterVisible } = await import('../../src/lib/load');
    const f = filterVisible({ blogPosts: [{ documentId: 'd', slug: 'x', visibility: 'public', publishedAt: null }] });
    expect(f.blogPosts).toEqual([]);
  });
  it('the static config never injects a /preview route or reads drafts at request time', () => {
    const cfg = fs.readFileSync(path.resolve(__dirname, '../../astro.config.mjs'), 'utf8');
    expect(cfg).toMatch(/output: PREVIEW \? 'server' : 'static'/);
    expect(fs.existsSync(path.resolve(__dirname, '../../src/pages/preview'))).toBe(false);
  });
});
