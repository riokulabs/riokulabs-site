import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import qs from 'qs';
import {
  COOKIE, COOKIE_TTL_S, handlePreviewLink, LINK_TTL_S, makeCookieValue, previewHeaders, safeEqual, safePreviewPath, signPreviewLink,
  usableSecret, verifyCookieValue, verifyPreviewLink,
} from '../../src/lib/preview';
import { fetchStrapi } from '../../src/lib/strapi';

const SECRET = 'a'.repeat(64);
// Same vector as cms/tests/preview-link.test.ts: the CMS (node:crypto) and the Worker (Web Crypto) must agree.
const VECTOR = { path: '/blog/a-post', exp: 1_800_000_600, sig: 'FIn-0ornne9Mn6nffypFYt0gYzvNkx0nJ5z4dIRoXjY' };

describe('signed preview links', () => {
  const now = VECTOR.exp - LINK_TTL_S;   // the moment the CMS signed the link
  const link = (p: Partial<Record<'path' | 'exp' | 'sig', string>> = {}) =>
    ({ path: VECTOR.path, exp: String(VECTOR.exp), sig: VECTOR.sig, ...p });
  const previewUrl = (p: Record<string, string>) => new URL(`https://preview.example.test/preview?${new URLSearchParams(p)}`);
  const H = previewHeaders('https://cms.example.test');

  it('signs exactly like the CMS (HMAC-SHA256 of path.exp, base64url)', async () => {
    expect(LINK_TTL_S).toBe(600);
    expect(await signPreviewLink(SECRET, VECTOR.path, VECTOR.exp)).toBe(VECTOR.sig);
  });
  it('accepts a fresh link, until it expires', async () => {
    expect(await verifyPreviewLink(SECRET, link(), now)).toBe('ok');
    expect(await verifyPreviewLink(SECRET, link(), VECTOR.exp - 1)).toBe('ok');
    expect(await verifyPreviewLink(SECRET, link(), VECTOR.exp)).toBe('expired');
    expect(await verifyPreviewLink(SECRET, link(), VECTOR.exp + 3600)).toBe('expired');
  });
  it('rejects a tampered path, a tampered expiry, another secret and malformed links', async () => {
    expect(await verifyPreviewLink(SECRET, link({ path: '/blog/other-post' }), now)).toBe('invalid');
    expect(await verifyPreviewLink(SECRET, link({ exp: String(VECTOR.exp + 60) }), now)).toBe('invalid');
    expect(await verifyPreviewLink('b'.repeat(64), link(), now)).toBe('invalid');
    expect(await verifyPreviewLink(SECRET, link({ sig: VECTOR.sig.slice(0, -1) + (VECTOR.sig.endsWith('A') ? 'B' : 'A') }), now)).toBe('invalid');
    expect(await verifyPreviewLink(SECRET, { path: VECTOR.path, exp: String(VECTOR.exp), sig: null }, now)).toBe('invalid');
    expect(await verifyPreviewLink(SECRET, link({ exp: '1.8e9' }), now)).toBe('invalid');
    expect(await verifyPreviewLink(SECRET, link({ sig: SECRET }), now)).toBe('invalid');
  });
  it('rejects a correctly signed link that lives longer than a fresh one (a leaked secret can\'t mint long links)', async () => {
    const far = now + 24 * 3600;
    const sig = await signPreviewLink(SECRET, VECTOR.path, far);
    expect(await verifyPreviewLink(SECRET, { path: VECTOR.path, exp: String(far), sig }, now)).toBe('invalid');
  });
  it('GET /preview with a valid link: 302 to the path with the iframe-safe session cookie and the preview headers', async () => {
    const r = await handlePreviewLink(previewUrl(link()), SECRET, H, now);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(VECTOR.path);
    const cookie = r.headers.get('set-cookie')!;
    for (const attr of ['Secure', 'HttpOnly', 'SameSite=None', 'Partitioned', 'Path=/', `Max-Age=${COOKIE_TTL_S}`]) expect(cookie).toContain(attr);
    const value = cookie.split(';')[0].slice(COOKIE.length + 1);
    expect(await verifyCookieValue(SECRET, value, now + 10)).toBe(true);
    expect(cookie).not.toContain(SECRET);
    expect(r.headers.get('x-robots-tag')).toMatch(/noindex/);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('content-security-policy')).toBe('frame-ancestors https://cms.example.test');
  });
  it('GET /preview with an expired, invalid or old raw-secret link: 401, noindex, no cookie', async () => {
    const cases: [URL, RegExp][] = [
      [previewUrl(link()), /expired/],                                     // checked after the 10 minutes
      [previewUrl(link({ path: '/blog/other-post' })), /not valid/],
      [previewUrl({ secret: SECRET, path: VECTOR.path, status: 'draft' }), /not valid/],   // the old form is gone
      [previewUrl({}), /not valid/],
    ];
    for (const [i, [url, msg]] of cases.entries()) {
      const r = await handlePreviewLink(url, SECRET, H, i === 0 ? VECTOR.exp + 1 : now);
      expect(r.status).toBe(401);
      expect(await r.text()).toMatch(msg);
      expect(r.headers.get('set-cookie')).toBeNull();
      expect(r.headers.get('x-robots-tag')).toMatch(/noindex/);
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
  });
  it('GET /preview with a signed but off-site path: 400, no cookie', async () => {
    const exp = now + LINK_TTL_S;
    const sig = await signPreviewLink(SECRET, '//evil.example', exp);
    const r = await handlePreviewLink(previewUrl({ path: '//evil.example', exp: String(exp), sig }), SECRET, H, now);
    expect(r.status).toBe(400);
    expect(r.headers.get('set-cookie')).toBeNull();
  });
});

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
    // Only the admin origin may frame the preview: anything else (or nothing) means no framing at all.
    expect(previewHeaders('javascript:alert(1)')['Content-Security-Policy']).toBe("frame-ancestors 'none'");
    expect(previewHeaders('https://cms.example.test/admin')['Content-Security-Policy']).toBe("frame-ancestors 'none'");
    expect(previewHeaders('https://a.example.test https://evil.example')['Content-Security-Policy']).toBe("frame-ancestors 'none'");
    expect(previewHeaders(undefined)['Content-Security-Policy']).toBe("frame-ancestors 'none'");
    expect(previewHeaders('http://127.0.0.1:1337')['Content-Security-Policy']).toBe('frame-ancestors http://127.0.0.1:1337');
  });
});

describe('preview Worker config', () => {
  const read = (f: string) => fs.readFileSync(path.resolve(__dirname, '../..', f), 'utf8');
  const cfg = JSON.parse(read('wrangler.preview.jsonc').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, ''));
  const identity = JSON.parse(read('src/config/identity.json'));
  it('is served only on the preview.<domain> custom domain, with no workers.dev or version preview URLs', () => {
    expect(cfg.routes).toEqual([{ pattern: `preview.${identity.domain}`, custom_domain: true }]);
    expect(cfg.workers_dev).toBe(false);
    expect(cfg.preview_urls).toBe(false);
  });
  it('holds no secrets or account IDs, and keeps the dashboard vars on deploy', () => {
    expect(Object.keys(cfg.vars)).toEqual(['SITE_MODE']);
    expect(cfg.keep_vars).toBe(true);
    expect(cfg.account_id).toBeUndefined();
    expect(JSON.stringify(cfg)).not.toMatch(/PREVIEW_SECRET|STRAPI_PREVIEW_TOKEN|zone_id/);
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
