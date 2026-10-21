/** Mod release feed (SPEC §9): one item per public release of a public mod. */
import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { listedMods, modUrl, site, versionAnchor } from '../../lib/site';

export const GET: APIRoute = (context) => {
  const items = listedMods()
    .flatMap((m) => m.releases.filter((r) => r.visibility === 'public').map((r) => ({ m, r })))
    .sort((a, b) => b.r.releasedAt.localeCompare(a.r.releasedAt))
    .map(({ m, r }) => ({
      title: `${m.name} ${r.version} (${site().games.find((g) => g.slug === m.game)?.shortName ?? m.game})`,
      link: `${modUrl(m)}#${versionAnchor(r.version)}`,
      pubDate: new Date(r.releasedAt),
      description: r.highlights.join(' · ') || `${m.name} ${r.version}`,
    }));
  return rss({
    title: `${site().settings.siteName}: mod releases`,
    description: `New releases of ${site().settings.siteName} game mods.`,
    site: context.site!,
    items,
    xmlns: { atom: 'http://www.w3.org/2005/Atom' },
    customData: `<language>en-gb</language><atom:link href="${new URL('/mods/releases.xml', context.site).href}" rel="self" type="application/rss+xml"/>`,
    trailingSlash: false,
  });
};
