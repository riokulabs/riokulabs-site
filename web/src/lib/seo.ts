/** Props of components/Seo.astro (shared with layouts/Base.astro). */
export interface SeoProps {
  title?: string;
  description?: string;
  path: string;
  ogPath?: string;
  ogAlt?: string;
  type?: 'website' | 'article';
  noindex?: boolean;
  /** false: no canonical link or og:url (the 404 page, which has no address of its own). Default true. */
  canonical?: boolean;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  publishedTime?: string;
  modifiedTime?: string;
}

/**
 * Meta description of at most `max` characters. Longer text is cut at the last word boundary that leaves room for an
 * ellipsis, with trailing punctuation dropped, so search results never show half a word.
 */
export function metaDescription(text: string, max = 160): string {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const room = s.slice(0, max - 1); // one character is kept for the ellipsis
  const space = room.lastIndexOf(' ');
  const cut = s[max - 1] === ' ' ? room : space > 0 ? room.slice(0, space) : room;
  const out = (cut || room).replace(/[\s,;:.\-–—]+$/, '');
  return `${out || room}…`;
}

/** Longest full title (page title + " · " + studio name) the keyword titles aim for, so results don't truncate them. */
export const TITLE_MAX = 65;

/** "a" or "an" before a game name ("an Elite mod", "a Space Engineers 2 mod"). */
const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/**
 * Page title of a mod page: "<Mod>: a <Game> mod", or "<Mod>: <Game> mod" and then just "<Mod>" when the longer form
 * would push the full title (with " · <studio>") past TITLE_MAX characters.
 */
export function modTitle(mod: string, game: string | undefined, studio: string): string {
  if (!game) return mod;
  const fits = (t: string) => `${t} · ${studio}`.length <= TITLE_MAX;
  return [`${mod}: ${article(game)} ${game} mod`, `${mod}: ${game} mod`].find(fits) ?? mod;
}

/** Page title of the dev-log index: "Dev log: <Game> modding" (just "Dev log" without a game or when too long). */
export function blogTitle(game: string | undefined, studio: string): string {
  const t = game ? `Dev log: ${game} modding` : 'Dev log';
  return `${t} · ${studio}`.length <= TITLE_MAX ? t : 'Dev log';
}

/** Home page title when the CMS sets none: "<Studio> · <Game> mods" (just the studio name without a game). */
export const homeTitle = (studio: string, game?: string) => (game ? `${studio} · ${game} mods` : studio);

/** CollectionPage JSON-LD with an ItemList of the page's entries, in display order. URLs are absolute. */
export function collectionJsonLd(page: { name: string; description?: string; url: string }, items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: page.name, url: page.url,
    ...(page.description ? { description: page.description } : {}),
    mainEntity: {
      '@type': 'ItemList', numberOfItems: items.length,
      itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, url: it.url })),
    },
  };
}
