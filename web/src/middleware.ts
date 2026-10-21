/**
 * Preview Worker gate + draft data (ARCHITECTURE §6). In the static build (__SITE_PREVIEW__ false) this is a no-op:
 * the static site never reads drafts, never sees the preview token and has no /preview route.
 *
 * Preview Worker:
 *  - GET /preview?path=&exp=&sig=  → signed-link check (signature + 10 min expiry, lib/preview.ts) → signed 1 h
 *    cookie (Secure; HttpOnly; SameSite=None; Partitioned) → 302 to the path; expired or invalid → 401;
 *  - everything else needs the cookie (else 401), runs with that request's DRAFT content (every visibility) in
 *    lib/site.ts previewStore, and gets noindex / no-store / frame-ancestors headers;
 *  - feeds, OG cards and control files are not served from the preview host (404).
 */
import { defineMiddleware } from 'astro:middleware';
import { runtimeEnv } from '#site-env';
import { COOKIE, handlePreviewLink, previewHeaders, usableSecret, verifyCookieValue } from './lib/preview';
import { previewStore } from './lib/site';
import { fetchStrapi } from './lib/strapi';
import { normalise } from './lib/load';
import type { Site } from './lib/types';

let cached: { at: number; site: Site } | null = null;
const CACHE_MS = 5_000;   // one editor clicking around: refetch at most every 5 s

async function draftSite(): Promise<Site> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.site;
  const url = await runtimeEnv('STRAPI_URL');
  const token = await runtimeEnv('STRAPI_PREVIEW_TOKEN');
  if (!url || !token) throw new Error('preview Worker needs STRAPI_URL and STRAPI_PREVIEW_TOKEN');
  const raw = await fetchStrapi({ url, token, drafts: true, retries: 4, baseDelayMs: 1000 });
  // Drafts of every visibility, on purpose (the banner says so). No build assertion here: nothing is published.
  const { site } = normalise(raw, 'strapi', { remoteBase: url });
  cached = { at: Date.now(), site };
  return site;
}

const NOT_ON_PREVIEW = /^\/(og\/|rss\.xml$|mods\/releases\.xml$|sitemap|_headers$|_redirects$|site\.webmanifest$)/;

export const onRequest = defineMiddleware(async (ctx, next) => {
  if (!__SITE_PREVIEW__) return next();
  // Prerendered routes in the Worker build (feeds, OG) are built in Node and never served from the preview host.
  if (ctx.isPrerendered) return next();
  const headers = previewHeaders(await runtimeEnv('STRAPI_ADMIN_ORIGIN'));
  const reply = (body: string, status: number, extra: Record<string, string> = {}) =>
    new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...headers, ...extra } });
  const secret = await runtimeEnv('PREVIEW_SECRET');
  if (!usableSecret(secret)) return reply('Preview is not configured (PREVIEW_SECRET missing or shorter than 32 characters).', 503);

  const url = new URL(ctx.request.url);
  if (url.pathname === '/robots.txt') return reply('User-agent: *\nDisallow: /\n', 200);
  if (url.pathname === '/preview') return handlePreviewLink(url, secret, headers);
  if (!(await verifyCookieValue(secret, ctx.cookies.get(COOKIE)?.value))) {
    return reply('Preview: open this page from the CMS ("Open preview").', 401);
  }
  if (NOT_ON_PREVIEW.test(url.pathname)) return reply('Not served on the preview site.', 404);

  let site: Site;
  try {
    site = await draftSite();
  } catch (e) {
    // Strapi Cloud Starter sleeps when idle: say so instead of a bare error (ARCHITECTURE §2)
    console.error('[preview] draft fetch failed:', e);
    return reply('Waking the CMS… reload in a few seconds. (The preview could not read drafts from Strapi.)', 503, { 'Retry-After': '5' });
  }
  // Render AND drain the body inside the store, so a streamed render can't run outside this request's draft data.
  return previewStore.run(site, async () => {
    const r = await next();
    const out = new Response(await r.arrayBuffer(), r);
    for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
    return out;
  });
});
