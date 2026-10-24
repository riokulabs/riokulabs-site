// @ts-check
/**
 * Sitemap data from .cache/site.json, for the @astrojs/sitemap integration in astro.config.mjs (plain JS so the config
 * can import it). Only public and unlisted entries ever reach site.json; unlisted ones are built but never listed.
 */

/** @typedef {{ slug: string; game?: string; visibility: string; updatedAt?: string; releases?: { releasedAt?: string; visibility?: string }[] }} SitemapMod */
/** @typedef {{ slug: string; visibility: string; date: string; updatedAt?: string }} SitemapPost */
/** @typedef {{ slug: string; visibility: string }} SitemapGame */
/** @typedef {{ mods: SitemapMod[]; posts: SitemapPost[]; games: SitemapGame[] }} SitemapSite */

/** @param {Pick<SitemapMod, 'game' | 'slug'>} m */
const modPath = (m) => (m.game ? `/games/${m.game}/mods/${m.slug}` : `/mods/${m.slug}`);

/**
 * Paths of unlisted pages: reachable by URL, never in the sitemap (CONTENT-MODEL §5).
 * @param {SitemapSite} site
 * @returns {Set<string>}
 */
export function unlistedPaths(site) {
  return new Set([
    ...site.mods.filter((m) => m.visibility !== 'public').flatMap((m) => [modPath(m), `${modPath(m)}/history`]),
    ...site.games.filter((g) => g.visibility !== 'public').map((g) => `/games/${g.slug}`),
    ...site.posts.filter((p) => p.visibility !== 'public').map((p) => `/blog/${p.slug}`),
  ]);
}

/**
 * The later of ISO dates/timestamps (compared as instants), or undefined when there are none.
 * @param {(string | undefined | null)[]} dates
 */
function latest(dates) {
  const ok = /** @type {string[]} */ (dates.filter((d) => d && !Number.isNaN(Date.parse(d))));
  return ok.length ? ok.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a)) : undefined;
}

/**
 * <lastmod> per page path: a blog post's last edit (or its date, whichever is later), a mod page's last edit or
 * newest public release (whichever is later; its history page shares it). Public entries only.
 * @param {SitemapSite} site
 * @returns {Map<string, string>}
 */
export function lastmodByPath(site) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const p of site.posts) {
    if (p.visibility !== 'public') continue;
    const d = latest([p.date, p.updatedAt]);
    if (d) out.set(`/blog/${p.slug}`, new Date(d).toISOString());
  }
  for (const m of site.mods) {
    if (m.visibility !== 'public') continue;
    const d = latest([m.updatedAt, ...(m.releases ?? []).filter((r) => (r.visibility ?? 'public') === 'public').map((r) => r.releasedAt)]);
    if (!d) continue;
    const iso = new Date(d).toISOString();
    out.set(modPath(m), iso);
    out.set(`${modPath(m)}/history`, iso);
  }
  return out;
}
