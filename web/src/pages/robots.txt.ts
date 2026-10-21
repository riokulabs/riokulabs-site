import type { APIRoute } from 'astro';
/** Production: allow all + sitemap. Preview deployments (SITE_MODE=preview) disallow everything (SPEC §7). */
export const GET: APIRoute = ({ site }) => {
  const preview = __SITE_PREVIEW__ || (process.env.SITE_NOINDEX ?? import.meta.env.SITE_NOINDEX) === '1';
  const body = preview
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap-index.xml', site).href}\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
