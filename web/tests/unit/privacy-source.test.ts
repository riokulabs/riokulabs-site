import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchPrivacyLocal, PrivacyListsAccessError, resolvePrivacyLists, resolvePrivacyLocal } from '../../src/lib/privacy-source';

// Synthetic terms only: each source has its own, so a test can tell which one won.
const STRAPI_LISTS = { denyPatterns: ['zz[ _-]?cms[ _-]?deny'], ipDenyTerms: ['zz[ _-]?cms[ _-]?ip'], retiredBrandTerms: [] };
const FILE_LISTS = { denyPatterns: ['zz[ _-]?file[ _-]?deny'], ipDenyTerms: [], retiredBrandTerms: [] };
const ENV_LISTS = { denyPatterns: ['zz[ _-]?env[ _-]?deny'], ipDenyTerms: [], retiredBrandTerms: [] };

const noFile = path.join(os.tmpdir(), 'no-such-privacy-local.json');
function localFile() {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-local-')), 'privacy.local.json');
  fs.writeFileSync(f, JSON.stringify(FILE_LISTS));
  return f;
}

/** A mocked Strapi answering GET /api/privacy-lists. */
function strapi(status: number, data: unknown = STRAPI_LISTS) {
  const calls: { url: string; auth?: string }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, auth: (init.headers as Record<string, string>)?.Authorization });
    return new Response(JSON.stringify(status === 200 ? { data, meta: {} } : { data: null, error: { status } }), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const strapiEnv = { SITE_DATA: 'strapi', STRAPI_URL: 'https://cms.example/', STRAPI_BUILD_TOKEN: 'build-token' } as NodeJS.ProcessEnv;

describe('build privacy lists: Strapi > file > env', () => {
  it('a Strapi build reads the CMS entry with the build token', async () => {
    const s = strapi(200);
    const r = await resolvePrivacyLocal({ env: { ...strapiEnv, PRIVACY_LOCAL_JSON: JSON.stringify(ENV_LISTS) }, localFile: localFile(), fetchImpl: s.impl, retries: 1 });
    expect(r).toEqual({ source: 'strapi', local: STRAPI_LISTS });
    expect(s.calls).toEqual([{ url: 'https://cms.example/api/privacy-lists', auth: 'Bearer build-token' }]);
  });
  it('compiles the CMS lists over the public canaries', async () => {
    const { source, lists } = await resolvePrivacyLists({ env: strapiEnv, localFile: noFile, fetchImpl: strapi(200).impl, retries: 1 });
    expect(source).toBe('strapi');
    expect(lists.deny.some((r) => r.test('ZZ CMS deny'))).toBe(true);
    expect(lists.deny.some((r) => r.test('zz private canary'))).toBe(true);
    expect(lists.ip.some((r) => r.test('zz-cms-ip'))).toBe(true);
  });
  it('an empty CMS entry, or a CMS without the type (404), falls back to the file, then env', async () => {
    const env = { ...strapiEnv, PRIVACY_LOCAL_JSON: JSON.stringify(ENV_LISTS) };
    expect((await resolvePrivacyLocal({ env, localFile: localFile(), fetchImpl: strapi(200, null).impl, retries: 1 })).source).toBe('file');
    expect((await resolvePrivacyLocal({ env, localFile: noFile, fetchImpl: strapi(404).impl, retries: 1 })).source).toBe('env');
    expect((await resolvePrivacyLocal({ env: strapiEnv, localFile: noFile, fetchImpl: strapi(200, { denyPatterns: [], ipDenyTerms: [], retiredBrandTerms: [] }).impl, retries: 1 })).source).toBe('none');
  });
  it('a token without access fails instead of falling back', async () => {
    await expect(resolvePrivacyLocal({ env: strapiEnv, localFile: localFile(), fetchImpl: strapi(403).impl, retries: 1 })).rejects.toThrow(PrivacyListsAccessError);
    await expect(fetchPrivacyLocal({ url: 'https://cms.example', token: 't', fetchImpl: strapi(401).impl, retries: 1 })).rejects.toThrow(/find permission on Privacy-lists/);
  });
  it('rejects a malformed answer', async () => {
    await expect(fetchPrivacyLocal({ url: 'https://cms.example', token: 't', fetchImpl: strapi(200, { denyPatterns: 'x' }).impl, retries: 1 })).rejects.toThrow(/not a list of strings/);
  });
  it('fixtures and preview builds never call Strapi', async () => {
    const s = strapi(200);
    expect((await resolvePrivacyLocal({ env: { ...strapiEnv, SITE_DATA: 'fixtures' }, localFile: localFile(), fetchImpl: s.impl })).source).toBe('file');
    expect((await resolvePrivacyLocal({ env: { ...strapiEnv, SITE_MODE: 'preview' }, localFile: noFile, fetchImpl: s.impl })).source).toBe('none');
    expect(s.calls).toHaveLength(0);
  });
  it('without a token a Strapi build uses the file/env only', async () => {
    const s = strapi(200);
    const env = { SITE_DATA: 'strapi', PRIVACY_LOCAL_JSON: JSON.stringify(ENV_LISTS) } as NodeJS.ProcessEnv;
    expect(await resolvePrivacyLocal({ env, localFile: noFile, fetchImpl: s.impl })).toEqual({ source: 'env', local: ENV_LISTS });
    expect(s.calls).toHaveLength(0);
  });
});
