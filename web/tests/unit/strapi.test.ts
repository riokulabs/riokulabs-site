import { describe, expect, it } from 'vitest';
import qs from 'qs';
import { buildQuery, COLLECTIONS, fetchStrapi, fetchWithRetry, mapLimit, SECTIONS, SINGLES } from '../../src/lib/strapi';

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

  // A fake Strapi that answers after a short delay and records how many requests were open at once.
  const slowStrapi = (opts: { failOn?: string } = {}) => {
    let open = 0;
    const stats = { maxOpen: 0, calls: 0 };
    const fake = (async (url: string) => {
      const u = new URL(url);
      stats.calls++;
      open++;
      stats.maxOpen = Math.max(stats.maxOpen, open);
      await new Promise((r) => setTimeout(r, 5));
      open--;
      if (opts.failOn && u.pathname.endsWith(`/${opts.failOn}`)) return new Response('nope', { status: 403 });
      const page = Number((qs.parse(u.search.slice(1)) as any).pagination?.page ?? 1);
      const isSingle = !(qs.parse(u.search.slice(1)) as any).pagination;
      if (isSingle) return new Response(JSON.stringify({ data: { id: u.pathname } }));
      return new Response(JSON.stringify({ data: [{ slug: `${u.pathname.split('/').pop()}-${page}` }], meta: { pagination: { page, pageCount: u.pathname.endsWith('/mods') ? 3 : 1 } } }));
    }) as unknown as typeof fetch;
    return { fake, stats };
  };

  it('fetches collections and single types concurrently, at most 6 at a time, and keeps every key in order', async () => {
    const { fake, stats } = slowStrapi();
    const out = await fetchStrapi({ url: 'http://cms', token: 'T', fetchImpl: fake, baseDelayMs: 1 });
    expect(stats.maxOpen).toBeGreaterThan(1);
    expect(stats.maxOpen).toBeLessThanOrEqual(6);
    expect(Object.keys(out)).toEqual([...Object.keys(COLLECTIONS), ...Object.keys(SINGLES)]);
    expect(out.mods.map((m: any) => m.slug)).toEqual(['mods-1', 'mods-2', 'mods-3']);   // pages still in order
    expect(out.homePage).toEqual({ id: '/api/home-page' });
  });
  it('honours a custom concurrency (1 = one request at a time)', async () => {
    const { fake, stats } = slowStrapi();
    await fetchStrapi({ url: 'http://cms', token: 'T', fetchImpl: fake, baseDelayMs: 1, concurrency: 1 });
    expect(stats.maxOpen).toBe(1);
  });
  it('still fails the whole fetch on a Strapi error, and starts no new requests after it', async () => {
    const { fake, stats } = slowStrapi({ failOn: 'tags' });
    await expect(fetchStrapi({ url: 'http://cms', token: 'T', fetchImpl: fake, baseDelayMs: 1, retries: 1 })).rejects.toThrow(/Strapi 403 on \/api\/tags/);
    // Requests already in flight may finish, but the remaining ~14 types are never requested.
    expect(stats.calls).toBeLessThan(Object.keys(COLLECTIONS).length + Object.keys(SINGLES).length);
  });
});

describe('mapLimit', () => {
  it('keeps the input order and never runs more than the limit', async () => {
    let open = 0;
    let maxOpen = 0;
    const out = await mapLimit([30, 5, 20, 1, 10], 2, async (ms) => {
      open++;
      maxOpen = Math.max(maxOpen, open);
      await new Promise((r) => setTimeout(r, ms));
      open--;
      return ms * 2;
    });
    expect(out).toEqual([60, 10, 40, 2, 20]);
    expect(maxOpen).toBe(2);
  });
  it('handles an empty list', async () => {
    expect(await mapLimit([], 6, async (x) => x)).toEqual([]);
  });
});
