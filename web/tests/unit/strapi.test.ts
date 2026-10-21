import { describe, expect, it } from 'vitest';
import qs from 'qs';
import { buildQuery, COLLECTIONS, fetchStrapi, fetchWithRetry, SECTIONS } from '../../src/lib/strapi';

describe('query building', () => {
  it('always asks for published content and uses on-fragments for dynamic zones', () => {
    const q = qs.parse(buildQuery(COLLECTIONS.mods[1], { filters: { visibility: { $in: ['public'] } } }), { depth: 20 }) as any;
    expect(q.status).toBe('published');
    expect(q.filters.visibility.$in).toEqual(['public']);
    expect(Object.keys(q.populate.body.on)).toEqual(Object.keys(SECTIONS.on));
  });
  it('never filters through relations (the CMS guard would reject it)', () => {
    for (const [, populate] of Object.values(COLLECTIONS)) expect(JSON.stringify(populate)).not.toMatch(/"filters"/);
  });
});

describe('retries', () => {
  it('retries 5xx and network errors, then succeeds', async () => {
    let n = 0;
    const fake = (async () => {
      n++;
      if (n === 1) throw new Error('ECONNRESET');
      if (n === 2) return new Response('waking', { status: 503 });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const res = await fetchWithRetry('http://x/api/mods', {}, { retries: 6, baseDelayMs: 1, fetchImpl: fake });
    expect(res.status).toBe(200);
    expect(n).toBe(3);
  });
  it('does not retry a 400', async () => {
    let n = 0;
    const fake = (async () => { n++; return new Response('bad', { status: 400 }); }) as unknown as typeof fetch;
    await fetchWithRetry('http://x', {}, { retries: 6, baseDelayMs: 1, fetchImpl: fake });
    expect(n).toBe(1);
  });
  it('gives up after the configured attempts', async () => {
    const fake = (async () => new Response('down', { status: 502 })) as unknown as typeof fetch;
    await expect(fetchWithRetry('http://x/api/mods?a=1', {}, { retries: 3, baseDelayMs: 1, fetchImpl: fake })).rejects.toThrow(/after 3 attempts/);
  });
});

describe('fetchStrapi', () => {
  it('paginates, sends the token and the unlisted header', async () => {
    const seen: { url: string; headers: any }[] = [];
    const fake = (async (url: string, init: any) => {
      seen.push({ url, headers: init.headers });
      const u = new URL(url);
      const page = Number(qs.parse(u.search.slice(1)).pagination ? (qs.parse(u.search.slice(1)) as any).pagination.page : 1);
      if (u.pathname.endsWith('/mods')) return new Response(JSON.stringify({ data: [{ slug: `m${page}` }], meta: { pagination: { page, pageCount: 2 } } }));
      return new Response(JSON.stringify({ data: [], meta: { pagination: { page: 1, pageCount: 1 } } }));
    }) as unknown as typeof fetch;
    const out = await fetchStrapi({ url: 'http://cms', token: 'T', fetchImpl: fake, baseDelayMs: 1 });
    expect(out.mods.map((m: any) => m.slug)).toEqual(['m1', 'm2']);
    expect(seen[0].headers.Authorization).toBe('Bearer T');
    expect(seen[0].headers['X-Site-Include-Unlisted']).toBe('1');
  });
});
