import type { APIRoute, GetStaticPaths } from 'astro';
import { legacyModRedirects, site } from '../lib/site';
import { assertSafeRedirect } from '../lib/safety';

/**
 * Cloudflare Workers static-assets control files (underscore files can't be Astro pages, hence the param route).
 * _redirects: the CMS Redirect entries (CONTENT-MODEL §3.8) first, then the generated 301s from the pre-2026-10-20
 * flat mod URLs (/mods/<slug>[/history]) to their game URLs. First match wins, so a CMS entry can override.
 * _headers: long cache for hashed assets, security headers; preview builds add noindex (SPEC §7).
 */
export const getStaticPaths: GetStaticPaths = () => [{ params: { file: '_redirects' } }, { params: { file: '_headers' } }];

export const GET: APIRoute = ({ params }) => {
  // Only the two control files (in the preview Worker this route is not prerendered and getStaticPaths is ignored).
  if (params.file !== '_redirects' && params.file !== '_headers') return new Response('Not found', { status: 404 });
  if (params.file === '_redirects') {
    // Re-validated here too (defence in depth): one bad rule fails the build.
    const seen = new Set<string>();
    const lines = [...site().redirects, ...legacyModRedirects()].flatMap((r) => {
      const v = assertSafeRedirect(r);
      if (seen.has(v.from)) return [];
      seen.add(v.from);
      return [`${v.from} ${v.to} ${r.permanent ? 301 : 302}`];
    });
    return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain' } });
  }
  // Preview builds, and production before launch (SITE_NOINDEX=1 on *.workers.dev), tell crawlers to stay away.
  const preview = __SITE_PREVIEW__ || (process.env.SITE_NOINDEX ?? import.meta.env.SITE_NOINDEX) === '1';
  const body = [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '  X-Frame-Options: DENY',
    ...(preview ? ['  X-Robots-Tag: noindex, nofollow'] : []),
    '/_astro/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/media/*',
    '  Cache-Control: public, max-age=604800',
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain' } });
};
