/**
 * Typed Strapi 5 REST client for the build (ARCHITECTURE §4). Node-only; the token never reaches the browser.
 *
 * - Every collection query asks for `status=published` and `filters[visibility][$in]=[public,unlisted]` explicitly
 *   (the server's visibility guard enforces the same; this is defence in depth).
 * - Explicit populate per query; dynamic zones use `on` fragments (the guard rejects other forms).
 * - No relational filters (the guard rejects them): related data is resolved client-side by documentId/slug.
 * - Pagination: pageSize 100 until done. Retries: exponential backoff, 6 attempts (Strapi Cloud Starter cold start).
 * - The ~17 collections and single types are fetched concurrently, 6 at a time (pages of one collection in order).
 *
 * Returns the raw collections in the same shape as web/fixtures/content.json; lib/load.ts filters, asserts and
 * normalises both the same way.
 */
import qs from 'qs';

const IMAGE = { populate: { file: true } };
const VIDEO = { populate: { mp4: true, webm: true, poster: true } };
const VISUAL = { populate: { image: IMAGE, video: VIDEO } };
const GALLERY_ITEM = { populate: { image: IMAGE, video: VIDEO } };
const SEO = { populate: { ogImage: IMAGE } };
const LINK = true;
const REF = (field: string) => ({ fields: [field, 'visibility'] });

export const SECTIONS = {
  on: {
    'sections.rich-text': true,
    'sections.image': { populate: { image: IMAGE } },
    'sections.gallery': { populate: { items: GALLERY_ITEM } },
    'sections.loop-video': { populate: { video: VIDEO } },
    'sections.compare': { populate: { before: IMAGE, after: IMAGE } },
    'sections.code': true,
    'sections.callout': true,
    'sections.quote': true,
    'sections.model-embed': { populate: { model: REF('slug') } },
    'sections.mod-card': { populate: { mod: REF('slug') } },
    'sections.timeline-embed': { populate: { family: REF('familyId') } },
    'sections.stat-grid': { populate: { stats: true } },
  },
};

/** Collection → [REST path, populate]. */
export const COLLECTIONS: Record<string, [string, Record<string, unknown>]> = {
  categories: ['categories', {}],
  tags: ['tags', {}],
  authors: ['authors', { avatar: IMAGE, links: LINK }],
  games: ['games', { art: IMAGE, links: LINK, seo: SEO }],
  mods: ['mods', {
    heroMedia: VISUAL, cardImage: IMAGE, stats: true, specs: true, features: { populate: { visual: VISUAL } }, gallery: GALLERY_ITEM,
    body: SECTIONS, tags: REF('slug'), game: REF('slug'), seo: SEO,
  }],
  modReleases: ['mod-releases', { highlights: true, mod: REF('slug') }],
  timelineFamilies: ['timeline-families', { stages: { populate: { image: IMAGE, thumb: IMAGE } }, mod: REF('slug') }],
  milestones: ['milestones', { mod: REF('slug') }],
  blocks: ['block-3d-models', { poster: IMAGE, fallbackLoop: VIDEO, mod: REF('slug'), glb: true, animations: true, paintPresets: true }],
  blogPosts: ['blog-posts', {
    cover: IMAGE, author: REF('slug'), category: REF('slug'), tags: REF('slug'), relatedMods: REF('slug'), games: REF('slug'), body: SECTIONS, seo: SEO,
  }],
  redirects: ['redirects', {}],
};

export const SINGLES: Record<string, [string, Record<string, unknown>]> = {
  siteSettings: ['site-settings', { defaultSeo: SEO, logo: IMAGE, logoMark: IMAGE, socialLinks: LINK }],
  navigation: ['navigation', { header: LINK, footer: { populate: { links: LINK } } }],
  homePage: ['home-page', {
    heroMedia: VISUAL, ctaPrimary: LINK, ctaSecondary: LINK, featuredMod: REF('slug'), historyFamily: REF('familyId'),
    principles: { populate: { visual: VISUAL } }, seo: SEO,
  }],
  aboutPage: ['about-page', { body: SECTIONS, seo: SEO }],
  brandPage: ['brand-page', { body: SECTIONS, downloads: { populate: { file: true } }, seo: SEO }],
  legalPage: ['legal-page', { body: SECTIONS, seo: SEO }],
};

export interface StrapiOptions {
  url: string;
  token: string;
  includeUnlisted?: boolean;
  /**
   * Preview Worker only: fetch the DRAFT version of every entry, of every visibility (private included; the preview
   * site shows them with a banner). Needs the site-preview token (the CMS guard bypasses only that token).
   * The static build (scripts/fetch-content.ts) never sets this.
   */
  drafts?: boolean;
  fetchImpl?: typeof fetch;
  retries?: number;
  baseDelayMs?: number;
  /** How many collections/single types are fetched at once (default 6; a Worker allows 6 open connections). */
  concurrency?: number;
}

/**
 * Runs `fn` over `items` with at most `limit` calls in flight; results keep the input order. After the first failure
 * no new calls start, and the first error is thrown once the calls already running have settled.
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed: { error: unknown } | null = null;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i]);
      } catch (error) {
        failed ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failed) throw (failed as { error: unknown }).error;
  return results;
}

export async function fetchWithRetry(url: string, init: RequestInit, opts: { retries: number; baseDelayMs: number; fetchImpl: typeof fetch }) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < opts.retries; attempt++) {
    try {
      const res = await opts.fetchImpl(url, init);
      // 4xx other than 408/429 are our fault: don't retry.
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    if (attempt < opts.retries - 1) await new Promise((r) => setTimeout(r, opts.baseDelayMs * 2 ** attempt));
  }
  throw new Error(`Strapi request failed after ${opts.retries} attempts: ${url.split('?')[0]} (${String(lastErr)})`);
}

export function buildQuery(populate: Record<string, unknown>, extra: Record<string, unknown> = {}, status: 'published' | 'draft' = 'published') {
  return qs.stringify({ status, populate, ...extra }, { encodeValuesOnly: true });
}

export async function fetchStrapi(opts: StrapiOptions): Promise<Record<string, any>> {
  // (wrapped: workerd throws 'Illegal invocation' when the global fetch is called as a method of another object)
  const fetchImpl = opts.fetchImpl ?? ((u: RequestInfo | URL, i?: RequestInit) => fetch(u, i));
  const retry = { retries: opts.retries ?? 6, baseDelayMs: opts.baseDelayMs ?? 1500, fetchImpl };
  const headers: Record<string, string> = { Authorization: `Bearer ${opts.token}` };
  if (opts.includeUnlisted !== false) headers['X-Site-Include-Unlisted'] = '1';
  const base = opts.url.replace(/\/$/, '') + '/api/';
  const visibilities = opts.includeUnlisted === false ? ['public'] : ['public', 'unlisted'];

  const getJson = async (path: string, query: string) => {
    const res = await fetchWithRetry(`${base}${path}?${query}`, { headers }, retry);
    if (res.status === 404) return { data: null };
    if (!res.ok) throw new Error(`Strapi ${res.status} on /api/${path}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  };

  // A collection's pages are read one after another; collections and single types are independent, so they are
  // fetched concurrently (at most `concurrency` at a time).
  const collection = async ([path, populate]: [string, Record<string, unknown>]) => {
    const all: any[] = [];
    for (let page = 1; ; page++) {
      const q = buildQuery(populate, {
        ...(opts.drafts ? {} : { filters: { visibility: { $in: visibilities } } }),
        pagination: { page, pageSize: 100 },
      }, opts.drafts ? 'draft' : 'published');
      const json = await getJson(path, q);
      all.push(...(json.data ?? []));
      const p = json.meta?.pagination;
      if (!p || page >= p.pageCount) break;
    }
    return all;
  };
  const single = async ([path, populate]: [string, Record<string, unknown>]) =>
    (await getJson(path, buildQuery(populate, {}, opts.drafts ? 'draft' : 'published'))).data;

  const tasks: [string, () => Promise<unknown>][] = [
    ...Object.entries(COLLECTIONS).map(([key, spec]) => [key, () => collection(spec)] as [string, () => Promise<unknown>]),
    ...Object.entries(SINGLES).map(([key, spec]) => [key, () => single(spec)] as [string, () => Promise<unknown>]),
  ];
  const values = await mapLimit(tasks, opts.concurrency ?? 6, ([, run]) => run());
  const out: Record<string, any> = {};
  tasks.forEach(([key], i) => { out[key] = values[i]; });
  return out;
}

/** Absolute URL of a Strapi media file (local provider returns /uploads/..., Strapi Cloud returns absolute URLs). */
export function mediaUrl(strapiUrl: string, url: string): string {
  return /^https?:\/\//.test(url) ? url : strapiUrl.replace(/\/$/, '') + url;
}
