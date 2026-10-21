import { describe, expect, it } from 'vitest';
import adminConfig from '../config/admin';
import { PREVIEW_LINK_TTL_S, previewLink, signPreviewPath, usablePreviewSecret } from '../src/utils/preview-link';

const SECRET = 'a'.repeat(64);
const NOW = 1_800_000_000;
// Same vector as web/tests/unit/preview.test.ts: the CMS (node:crypto) and the Worker (Web Crypto) must agree.
const VECTOR = { path: '/blog/a-post', exp: 1_800_000_600, sig: 'FIn-0ornne9Mn6nffypFYt0gYzvNkx0nJ5z4dIRoXjY' };

describe('signed preview links', () => {
  it('signs path.exp with HMAC-SHA256, base64url without padding', () => {
    expect(signPreviewPath(SECRET, VECTOR.path, VECTOR.exp)).toBe(VECTOR.sig);
  });
  it('builds /preview?path&exp&sig, expiring in 10 minutes, without the secret', () => {
    const link = previewLink('https://preview.example.test/', SECRET, VECTOR.path, NOW)!;
    const u = new URL(link);
    expect(u.origin + u.pathname).toBe('https://preview.example.test/preview');
    expect([...u.searchParams.keys()]).toEqual(['path', 'exp', 'sig']);
    expect(u.searchParams.get('path')).toBe(VECTOR.path);
    expect(Number(u.searchParams.get('exp'))).toBe(NOW + PREVIEW_LINK_TTL_S);
    expect(PREVIEW_LINK_TTL_S).toBe(600);
    expect(u.searchParams.get('sig')).toBe(VECTOR.sig);
    expect(link).not.toContain(SECRET);
    expect(link).not.toContain('secret=');
  });
  it('a different path, expiry or secret gives a different signature', () => {
    expect(signPreviewPath(SECRET, '/blog/other', VECTOR.exp)).not.toBe(VECTOR.sig);
    expect(signPreviewPath(SECRET, VECTOR.path, VECTOR.exp + 1)).not.toBe(VECTOR.sig);
    expect(signPreviewPath('b'.repeat(64), VECTOR.path, VECTOR.exp)).not.toBe(VECTOR.sig);
  });
  it('gives no link without a preview URL or with a short secret', () => {
    expect(previewLink(undefined, SECRET, '/')).toBeNull();
    expect(previewLink('https://p.example.test', 'short', '/')).toBeNull();
    expect(previewLink('https://p.example.test', undefined, '/')).toBeNull();
    expect(usablePreviewSecret(SECRET)).toBe(true);
  });
});

describe('admin preview handler', () => {
  const makeEnv = (vars: Record<string, string>) => {
    const env: any = (name: string, def?: string) => vars[name] ?? def;
    env.bool = (_name: string, def: boolean) => def;
    return env;
  };
  const handler = (vars: Record<string, string>) => (adminConfig({ env: makeEnv(vars) } as any) as any).preview;

  it('returns a signed link for a fixed page, never the raw secret', async () => {
    const preview = handler({ PREVIEW_URL: 'https://preview.example.test', PREVIEW_SECRET: SECRET });
    expect(preview.enabled).toBe(true);
    expect(preview.config.allowedOrigins).toEqual(['https://preview.example.test']);
    const link: string = await preview.config.handler('api::milestone.milestone', { status: 'draft' });
    const u = new URL(link);
    expect(u.pathname).toBe('/preview');
    expect(u.searchParams.get('path')).toBe('/roadmap');
    const exp = Number(u.searchParams.get('exp'));
    const now = Math.floor(Date.now() / 1000);
    expect(exp).toBeGreaterThan(now);
    expect(exp).toBeLessThanOrEqual(now + PREVIEW_LINK_TTL_S);
    expect(u.searchParams.get('sig')).toBe(signPreviewPath(SECRET, '/roadmap', exp));
    expect(link).not.toContain(SECRET);
  });
  it('is disabled without PREVIEW_URL and gives no link with a short secret', async () => {
    expect(handler({}).enabled).toBe(false);
    const preview = handler({ PREVIEW_URL: 'https://preview.example.test', PREVIEW_SECRET: 'short' });
    expect(await preview.config.handler('api::milestone.milestone', { status: 'draft' })).toBeNull();
  });
  it('gives no link for content types the site does not show', async () => {
    const preview = handler({ PREVIEW_URL: 'https://preview.example.test', PREVIEW_SECRET: SECRET });
    expect(await preview.config.handler('api::redirect.redirect', { status: 'draft' })).toBeNull();
  });
});
